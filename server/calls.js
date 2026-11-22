'use strict';
// Звонки и конференции. Медиа идёт браузер↔браузер (WebRTC, полносвязная схема) или через TURN;
// сервер только сводит участников: хранит состояние звонка в памяти и пересылает SDP/ICE.
// Личный чат — звонок «звонит» собеседнику; группа/канал — конференция, к которой можно присоединиться.
const crypto = require('node:crypto');
const { db } = require('./db');
const { int } = require('./util');
const rt = require('./realtime');
const chats = require('./chats');

const RING_MS = 45e3;
const MAX_PEERS = Number(process.env.CALL_MAX_PEERS) || 12;
const calls = new Map();       // callId -> call
const byChat = new Map();      // chatId -> callId

function iceServers(uid) {
  if (process.env.ICE_SERVERS) {
    try { return JSON.parse(process.env.ICE_SERVERS); } catch { /* ниже — значения по умолчанию */ }
  }
  const list = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()) }];
  if (process.env.TURN_URLS && process.env.TURN_SECRET) {
    // Временные учётные данные coturn (use-auth-secret): username = срок:пользователь.
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${uid}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    list.push({ urls: process.env.TURN_URLS.split(',').map((s) => s.trim()), username, credential });
  }
  return list;
}

function view(call) {
  return {
    id: call.id, chat_id: call.chatId, media: call.media, started_by: call.startedBy,
    started_at: call.startedAt, answered_at: call.answeredAt, direct: call.direct,
    peers: [...call.peers.values()].map((p) => ({ conn_id: p.connId, user_id: p.userId, joined_at: p.joinedAt, audio: p.audio, video: p.video, screen: p.screen, hand: p.hand })),
  };
}

function notifyChat(call, ev) {
  rt.toUsers(chats.memberIds(call.chatId), ev);
}

function activeCallsFor(uid) {
  const out = [];
  for (const call of calls.values()) if (chats.membership(call.chatId, uid)) out.push(view(call));
  return out;
}

function addPeer(call, conn, media) {
  call.peers.set(conn.id, {
    connId: conn.id, userId: conn.user.id, joinedAt: Date.now(),
    audio: true, video: media === 'video', screen: false, hand: false,
  });
  call.everJoined.add(conn.user.id);
  call.maxPeers = Math.max(call.maxPeers, call.peers.size);
}

function start(conn, { chat_id, media }) {
  const uid = conn.user.id;
  if (!require('./workspace').on('calls')) return conn.send({ type: 'call:error', code: 'feature_off' });
  const { chat, m } = chats.requireMember(chat_id, uid);
  if (!['direct', 'group', 'channel'].includes(chat.type)) return conn.send({ type: 'call:error', code: 'call_unsupported' });
  if (chat.type === 'channel' && !chats.isChatAdmin(m)) return conn.send({ type: 'call:error', code: 'call_forbidden' });
  const existing = byChat.get(chat.id);
  if (existing) return join(conn, { call_id: existing, media });
  if (chat.type === 'direct') {
    const otherId = chat.direct_key.split(':').map(Number).find((x) => x !== uid);
    const other = chats.userById(otherId);
    if (!other || !other.active) return conn.send({ type: 'call:error', code: 'call_unavailable' });
  }
  const md = media === 'video' ? 'video' : 'audio';
  const now = Date.now();
  const r = db.prepare('INSERT INTO calls (chat_id, started_by, media, started_at) VALUES (?, ?, ?, ?)').run(chat.id, uid, md, now);
  const call = {
    id: Number(r.lastInsertRowid), chatId: chat.id, media: md, startedBy: uid, startedAt: now, answeredAt: null,
    direct: chat.type === 'direct', peers: new Map(), everJoined: new Set(), declined: new Set(), maxPeers: 1, timer: null,
  };
  calls.set(call.id, call);
  byChat.set(chat.id, call.id);
  addPeer(call, conn, md);
  conn.send({ type: 'call:joined', call: view(call), ice: iceServers(uid) });
  const caller = chats.publicUser(conn.user, 0);
  for (const id of chats.memberIds(chat.id)) {
    if (id === uid) continue;
    rt.toUser(id, { type: 'call:ring', call: view(call), caller, chat: chats.serializeChat(chat, id), ring: call.direct });
  }
  rt.toUser(uid, { type: 'call:state', call: view(call) });
  call.timer = setTimeout(() => {
    // Никто не ответил: личный звонок — «пропущен», конференция остаётся открытой, пока в ней есть люди.
    if (call.direct && !call.answeredAt) end(call, 'missed');
  }, RING_MS);
  call.timer.unref?.();
  rt.emit('call_started', { call, chat, caller: conn.user });
}

function join(conn, { call_id, media }) {
  const call = calls.get(int(call_id));
  if (!call) return conn.send({ type: 'call:error', code: 'call_ended' });
  const uid = conn.user.id;
  if (!chats.membership(call.chatId, uid)) return conn.send({ type: 'call:error', code: 'call_forbidden' });
  if (call.peers.has(conn.id)) return conn.send({ type: 'call:joined', call: view(call), ice: iceServers(uid) });
  if (call.peers.size >= MAX_PEERS) return conn.send({ type: 'call:error', code: 'call_full' });
  // Тот же человек с другого устройства — переносим звонок (как «ответить на этом устройстве»).
  for (const p of [...call.peers.values()]) {
    if (p.userId !== uid) continue;
    rt.toConn(p.connId, { type: 'call:ended', call_id: call.id, status: 'moved' });
    leave({ id: p.connId, user: { id: uid } }, { call_id: call.id }, true);
  }
  const existing = [...call.peers.values()];
  addPeer(call, conn, media === 'video' ? 'video' : media === 'audio' ? 'audio' : call.media);
  if (!call.answeredAt && uid !== call.startedBy) {
    call.answeredAt = Date.now();
    db.prepare('UPDATE calls SET answered_at = ? WHERE id = ?').run(call.answeredAt, call.id);
  }
  conn.send({ type: 'call:joined', call: view(call), ice: iceServers(uid), existing: existing.map((p) => p.connId) });
  rt.toUser(uid, { type: 'call:ring_stop', call_id: call.id });
  for (const p of existing) rt.toConn(p.connId, { type: 'call:peer_joined', call_id: call.id, peer: view(call).peers.find((x) => x.conn_id === conn.id) });
  notifyChat(call, { type: 'call:state', call: view(call) });
}

function leave(conn, { call_id }, silent = false) {
  const call = calls.get(int(call_id));
  if (!call || !call.peers.has(conn.id)) return;
  call.peers.delete(conn.id);
  for (const p of call.peers.values()) rt.toConn(p.connId, { type: 'call:peer_left', call_id: call.id, conn_id: conn.id });
  if (silent) return;
  if (call.peers.size === 0 || (call.direct && call.answeredAt && call.peers.size < 2)) {
    end(call, call.answeredAt || call.maxPeers > 1 ? 'ended' : 'cancelled');
  } else {
    notifyChat(call, { type: 'call:state', call: view(call) });
  }
}

function decline(conn, { call_id }) {
  const call = calls.get(int(call_id));
  if (!call) return;
  rt.toUser(conn.user.id, { type: 'call:ring_stop', call_id: call.id });
  if (call.direct && !call.answeredAt) end(call, 'declined');
  else call.declined.add(conn.user.id);
}

function end(call, status) {
  if (!calls.has(call.id)) return;
  clearTimeout(call.timer);
  calls.delete(call.id);
  byChat.delete(call.chatId);
  const now = Date.now();
  const duration = call.answeredAt ? Math.round((now - call.answeredAt) / 1000) : (status === 'ended' ? Math.round((now - call.startedAt) / 1000) : 0);
  db.prepare('UPDATE calls SET ended_at = ?, max_participants = ? WHERE id = ?').run(now, call.maxPeers, call.id);
  for (const p of call.peers.values()) rt.toConn(p.connId, { type: 'call:ended', call_id: call.id, status });
  notifyChat(call, { type: 'call:ended', call_id: call.id, chat_id: call.chatId, status });
  try {
    const msg = chats.postMessage(call.startedBy, call.chatId, {
      kind: 'call', system: true,
      meta: { call_id: call.id, media: call.media, status, duration, participants: [...call.everJoined], direct: call.direct },
    });
    db.prepare('UPDATE calls SET message_id = ? WHERE id = ?').run(msg.id, call.id);
  } catch { /* чат могли удалить во время звонка */ }
}

function signal(conn, { call_id, to, data }) {
  const call = calls.get(int(call_id));
  if (!call || !call.peers.has(conn.id) || !call.peers.has(String(to))) return;
  if (!data || typeof data !== 'object') return;
  rt.toConn(String(to), { type: 'rtc:signal', call_id: call.id, from: conn.id, from_user: conn.user.id, data });
}

function mediaState(conn, b) {
  const call = calls.get(int(b.call_id));
  const p = call && call.peers.get(conn.id);
  if (!p) return;
  for (const k of ['audio', 'video', 'screen', 'hand']) if (k in b) p[k] = !!b[k];
  for (const q of call.peers.values()) rt.toConn(q.connId, { type: 'call:peer_state', call_id: call.id, conn_id: conn.id, state: { audio: p.audio, video: p.video, screen: p.screen, hand: p.hand } });
}

function reaction(conn, { call_id, emoji }) {
  const call = calls.get(int(call_id));
  if (!call || !call.peers.has(conn.id)) return;
  const e = String(emoji || '').slice(0, 8);
  if (!chats.REACTIONS.includes(e)) return;
  for (const q of call.peers.values()) rt.toConn(q.connId, { type: 'call:reaction', call_id: call.id, conn_id: conn.id, user_id: conn.user.id, emoji: e });
}

function onConnClosed(conn) {
  for (const call of [...calls.values()]) if (call.peers.has(conn.id)) leave(conn, { call_id: call.id });
}

function handle(conn, msg) {
  try {
    switch (msg.type) {
      case 'call:start': return start(conn, msg);
      case 'call:join': return join(conn, msg);
      case 'call:leave': return leave(conn, msg);
      case 'call:decline': return decline(conn, msg);
      case 'call:media': return mediaState(conn, msg);
      case 'call:reaction': return reaction(conn, msg);
      case 'rtc:signal': return signal(conn, msg);
      default: return undefined;
    }
  } catch (e) {
    conn.send({ type: 'call:error', code: e.code || 'call_failed', message: e.message });
    return undefined;
  }
}

function history(uid) {
  return db.prepare(`SELECT c.* FROM calls c JOIN chat_members cm ON cm.chat_id = c.chat_id AND cm.user_id = ?
    WHERE c.ended_at IS NOT NULL ORDER BY c.id DESC LIMIT 100`).all(uid).map((c) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(c.chat_id);
    const msg = c.message_id ? chats.messageRow(c.message_id) : null;
    const meta = msg ? JSON.parse(msg.meta || '{}') : {};
    return {
      id: c.id, chat: chats.serializeChat(chat, uid), media: c.media, started_by: c.started_by,
      started_at: c.started_at, ended_at: c.ended_at, status: meta.status || 'ended', duration: meta.duration || 0,
      participants: c.max_participants, outgoing: c.started_by === uid,
    };
  });
}

module.exports = { handle, onConnClosed, activeCallsFor, iceServers, history, _calls: calls };
