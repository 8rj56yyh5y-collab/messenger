'use strict';
// Web Push без внешних библиотек: VAPID (RFC 8292) и шифрование aes128gcm (RFC 8291) на node:crypto.
// Уведомления уходят тем, у кого сейчас нет открытого приложения (нет живого WebSocket).
const crypto = require('node:crypto');
const { db } = require('./db');
const { HttpError, str, jsonParse } = require('./util');
const rt = require('./realtime');

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_ok INTEGER
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// ---------- Ключи VAPID: создаются один раз и хранятся в базе ----------
function vapid() {
  const row = db.prepare("SELECT v FROM kv WHERE k = 'vapid'").get();
  if (row) return JSON.parse(row.v);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  db.prepare("INSERT INTO kv (k, v) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

function vapidPrivateKeyObject() {
  const { publicKey, privateKey } = vapid();
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

function vapidHeader(endpoint) {
  const { publicKey } = vapid();
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:admin@localhost' }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: vapidPrivateKeyObject(), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${publicKey}`;
}

// ---------- Шифрование сообщения (RFC 8291, aes128gcm) ----------
function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// ---------- Подписки ----------
function subscribe(uid, b, ua) {
  const endpoint = str(b.endpoint, 1000);
  if (!/^https:\/\//.test(endpoint) && process.env.PUSH_ALLOW_HTTP !== '1') throw new HttpError(400, 'Некорректная подписка');
  const p256dh = str(b.keys?.p256dh, 200);
  const auth = str(b.keys?.auth, 100);
  if (fromB64u(p256dh).length !== 65 || fromB64u(auth).length !== 16) throw new HttpError(400, 'Некорректные ключи подписки');
  db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua`)
    .run(endpoint, uid, p256dh, auth, String(ua || '').slice(0, 200), Date.now());
  return { ok: true };
}
function unsubscribe(uid, endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(str(endpoint, 1000), uid);
  return { ok: true };
}
function count(uid) { return db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(uid).n; }

async function sendTo(sub, data, { ttl = 86400, urgency = 'normal', topic } = {}) {
  const body = encrypt(JSON.stringify(data), sub.p256dh, sub.auth);
  const headers = {
    Authorization: vapidHeader(sub.endpoint), TTL: String(ttl), Urgency: urgency,
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
  };
  if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
    if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
    else if (res.ok) db.prepare('UPDATE push_subs SET last_ok = ? WHERE endpoint = ?').run(Date.now(), sub.endpoint);
    return res.status;
  } catch { return 0; }
}

/** Отправить уведомление пользователю на все его устройства (если приложение у него не открыто). */
async function notifyUser(uid, data, opts = {}) {
  if (!opts.force && rt.isOnline(uid)) return 0;
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(uid);
  const results = await Promise.all(subs.map((s) => sendTo(s, data, opts)));
  return results.filter((x) => x >= 200 && x < 300).length;
}

// ---------- Что и кому отправлять ----------
let chats = null;
function lazyChats() { if (!chats) chats = require('./chats'); return chats; }

function previewOf(row) {
  const meta = jsonParse(row.meta, {});
  const k = row.kind;
  if (k === 'image') return '🖼 Фото';
  if (k === 'video') return meta.round ? '⭕ Видео' : '🎬 Видео';
  if (k === 'voice') return '🎤 Голосовое';
  if (k === 'file') return `📎 ${row.body || 'Файл'}`;
  if (k === 'poll') return `📊 ${row.body}`;
  if (k === 'task') return `✅ ${row.body}`;
  if (k === 'approval') return `🧾 ${meta.title || row.body}`;
  if (k === 'meeting') return `📅 ${row.body}`;
  if (k === 'kudos') return `🎉 ${row.body}`;
  return String(row.body || '').replace(/[*_~`|]{1,2}/g, '').slice(0, 180);
}

// Персональні правила тиші користувача (дублюються на клієнті в app.js → quietNow)
function inRange(hhmm, from, to) {
  if (!from || !to || from === to) return false;
  return from < to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to; // через північ: 22:00–08:00
}
function userClock(tz, now = new Date()) {
  try { return now.toLocaleTimeString('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return now.toTimeString().slice(0, 5); }
}
const KIND_PREF = { task: 'notifyTasks', approval: 'notifyApprovals', kudos: 'notifyKudos', meeting: 'notifyMeetings' };
function suppressed(s, chat, row, meta, now = new Date()) {
  const k = KIND_PREF[row.kind] || (meta.event === 'meeting_soon' ? 'notifyMeetings' : meta.event === 'task_due' ? 'notifyTasks' : null);
  if (k && s[k] === false) return true;
  if (s.groupNotify === 'mentions' && chat.type !== 'direct' && chat.type !== 'saved' && row.kind !== 'system') return true;
  if (s.groupNotify === 'none' && chat.type !== 'direct' && chat.type !== 'saved' && row.kind !== 'system') return true;
  if (s.quietHours?.enabled && inRange(userClock(s.tz, now), s.quietHours.from, s.quietHours.to)) return true;
  if (s.offHoursMute && !require('./workspace').isWorkTime(now)) return true;
  return false;
}

rt.on('message', ({ chat, row, type }) => {
  if (type !== 'message:new' || row.silent) return;
  const c = lazyChats();
  const meta = jsonParse(row.meta, {});
  if (row.kind === 'system' && meta.event !== 'reminder' && meta.event !== 'task_due' && meta.event !== 'meeting_soon') return;
  const author = row.user_id ? c.userById(row.user_id) : null;
  const members = db.prepare('SELECT user_id, muted_until FROM chat_members WHERE chat_id = ?').all(chat.id);
  for (const m of members) {
    if (m.user_id === row.user_id) continue;
    const u = c.userById(m.user_id);
    if (!u || u.is_bot || !u.active) continue;
    const mentioned = (meta.mentions || []).includes(u.id);
    if (row.thread_id && !mentioned) continue;
    if (m.muted_until > Date.now() && !mentioned) continue;
    if (u.status === 'dnd' && !mentioned) continue;
    const s = c.userSettings(u);
    if (s.push === false) continue;
    if (!mentioned && suppressed(s, chat, row, meta)) continue;
    let title = chat.type === 'direct' ? (author?.name || 'Gobsek Chat') : `${chat.title || 'Gobsek Chat'}${author ? ` · ${author.name}` : ''}`;
    if (chat.type === 'saved') title = 'Gobsek Chat';
    const body = s.preview === false ? '💬' : previewOf(row);
    notifyUser(u.id, { title, body, tag: `chat-${chat.id}`, url: `/#/chat/${chat.id}`, chat_id: chat.id }, { topic: `c${chat.id}` }).catch(() => {});
  }
});

// Входящий звонок — срочное уведомление
rt.on('call_started', ({ call, chat, caller }) => {
  if (!call.direct) return;
  const c = lazyChats();
  for (const id of c.memberIds(chat.id)) {
    if (id === caller.id) continue;
    notifyUser(id, { title: caller.name, body: call.media === 'video' ? '🎥 Входящий видеозвонок' : '📞 Входящий звонок', tag: `call-${call.id}`, url: `/#/chat/${chat.id}`, call: true },
      { ttl: 45, urgency: 'high' }).catch(() => {});
  }
});

module.exports = { vapid, subscribe, unsubscribe, count, notifyUser, encrypt, sendTo, suppressed, inRange };
