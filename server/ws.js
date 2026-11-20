'use strict';
// WebSocket (RFC 6455) без внешних библиотек + «хаб» живых подключений.
// Сервер шлёт события (новые сообщения, набор текста, присутствие, сигналы звонков),
// клиент шлёт только лёгкие события; всё, что меняет данные, идёт через REST.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 2 * 1024 * 1024;

class WsConn extends EventEmitter {
  constructor(socket, user) {
    super();
    this.id = crypto.randomBytes(8).toString('hex');
    this.socket = socket;
    this.user = user;
    this.alive = true;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.close(1009);
      if (!masked) return this.close(1002); // клиент обязан маскировать кадры
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._onFrame(fin, op, data);
      if (this.closed) return;
    }
  }

  _onFrame(fin, op, data) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._send(0xA, data); return; }
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.fragments.push(data);
      const total = this.fragments.reduce((s, b) => s + b.length, 0);
      if (total > MAX_FRAME) { this.close(1009); return; }
      if (!fin) return;
      const msg = Buffer.concat(this.fragments).toString('utf8');
      this.fragments = [];
      this.alive = true;
      let obj;
      try { obj = JSON.parse(msg); } catch { return; }
      if (obj && typeof obj === 'object') this.emit('message', obj);
    }
  }

  _send(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) { this._send(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (this.closed) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this._send(0x8, b);
    this.closed = true;
    this.socket.end();
    this._finish();
  }

  _finish() {
    if (this._done) return;
    this._done = true;
    this.closed = true;
    this.socket.destroy();
    this.emit('close');
  }
}

/** Принять апгрейд, если запрос корректный. Возвращает WsConn или null. */
function acceptUpgrade(req, socket, user) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  return new WsConn(socket, user);
}

// ---------- Хаб ----------
class Hub extends EventEmitter {
  constructor() {
    super();
    this.byUser = new Map(); // userId -> Set<WsConn>
    this.byId = new Map();   // connId -> WsConn
    this.timer = setInterval(() => this._heartbeat(), 25e3);
    this.timer.unref();
  }

  add(conn) {
    const uid = conn.user.id;
    const first = !this.byUser.has(uid);
    if (first) this.byUser.set(uid, new Set());
    this.byUser.get(uid).add(conn);
    this.byId.set(conn.id, conn);
    conn.on('close', () => {
      this.byId.delete(conn.id);
      const set = this.byUser.get(uid);
      if (set) {
        set.delete(conn);
        if (!set.size) {
          this.byUser.delete(uid);
          this.emit('offline', uid);
        }
      }
      this.emit('conn_closed', conn);
    });
    if (first) this.emit('online', uid);
  }

  isOnline(uid) { return this.byUser.has(uid); }
  onlineIds() { return [...this.byUser.keys()]; }

  toUser(uid, event, exceptConn) {
    const set = this.byUser.get(uid);
    if (!set) return;
    for (const c of set) if (c !== exceptConn) c.send(event);
  }
  toUsers(uids, event, exceptConn) {
    for (const uid of new Set(uids)) this.toUser(uid, event, exceptConn);
  }
  toConn(connId, event) {
    const c = this.byId.get(connId);
    if (c) c.send(event);
    return !!c;
  }
  toAll(event) {
    for (const c of this.byId.values()) c.send(event);
  }
  kickUser(uid) {
    const set = this.byUser.get(uid);
    if (set) for (const c of [...set]) c.close(4001);
  }

  _heartbeat() {
    for (const c of this.byId.values()) {
      if (!c.alive) { c.close(1001); continue; }
      c.alive = false;
      c.ping();
    }
  }
}

module.exports = { acceptUpgrade, Hub, WsConn };
