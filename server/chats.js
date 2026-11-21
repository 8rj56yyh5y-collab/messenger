'use strict';
// Чаты и сообщения: права, выборки, отправка, правка, реакции, опросы, закрепы, поиск.
const crypto = require('node:crypto');
const { db, tx, logEvent } = require('./db');
const { HttpError, str, int, jsonParse } = require('./util');
const rt = require('./realtime');

const MAX_TEXT = 8000;
const EDIT_WINDOW_MS = Number(process.env.EDIT_WINDOW_HOURS || 48) * 3600e3;
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🙏', '👀', '✅', '👎', '💯'];

// ---------- Пользователи ----------
function userSettings(u) { return jsonParse(u.settings, {}); }

function publicUser(u, viewerId) {
  if (!u) return null;
  const s = userSettings(u);
  const hideSeen = s.hideLastSeen && u.id !== viewerId;
  return {
    id: u.id, login: u.login, name: u.name, position: u.position, department: u.department,
    email: s.hideEmail && u.id !== viewerId ? '' : u.email,
    phone: s.hidePhone && u.id !== viewerId ? '' : u.phone,
    bio: u.bio, status: u.status, status_text: u.status_text, color: u.color,
    avatar: u.avatar_file ? `/api/files/${u.avatar_file}` : null,
    role: u.role, is_bot: !!u.is_bot, active: !!u.active,
    online: rt.isOnline(u.id) && !hideSeen,
    last_seen: hideSeen ? null : u.last_seen,
    gobsek: !!u.gobsek_id,
  };
}
const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// ---------- Служебные чаты ----------
let AI_BOT_ID = null;
function aiBotId() {
  if (AI_BOT_ID) return AI_BOT_ID;
  let b = db.prepare("SELECT id FROM users WHERE login = 'ai.assistant' AND is_bot = 1").get();
  if (!b) {
    const r = db.prepare(`INSERT INTO users (login, name, position, role, is_bot, color, created_at, bio)
      VALUES ('ai.assistant', 'Gobsek AI', 'AI', 'member', 1, 5, ?, '')`).run(Date.now());
    b = { id: Number(r.lastInsertRowid) };
  }
  AI_BOT_ID = b.id;
  return AI_BOT_ID;
}

function ensurePersonalChat(uid, type) {
  const key = `${type}:${uid}`;
  let c = db.prepare('SELECT * FROM chats WHERE direct_key = ?').get(key);
  if (c) return c;
  const now = Date.now();
  return tx(() => {
    const r = db.prepare('INSERT INTO chats (type, direct_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(type, key, uid, now, now);
    const id = Number(r.lastInsertRowid);
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, uid, now);
    if (type === 'ai') db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(id, aiBotId(), now);
    return db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  });
}
const ensureSaved = (uid) => ensurePersonalChat(uid, 'saved');
const ensureAi = (uid) => ensurePersonalChat(uid, 'ai');

function getOrCreateDirect(uid, otherId) {
  otherId = int(otherId);
  if (otherId === uid) return ensureSaved(uid);
  const other = userById(otherId);
  if (!other || !other.active) throw new HttpError(404, 'Сотрудник не найден');
  const key = `${Math.min(uid, otherId)}:${Math.max(uid, otherId)}`;
  let c = db.prepare('SELECT * FROM chats WHERE direct_key = ?').get(key);
  if (c) {
    // Если кто-то «удалил» чат у себя — вернём его в список.
    db.prepare('UPDATE chat_members SET archived = 0 WHERE chat_id = ? AND user_id = ? AND archived = 2').run(c.id, uid);
    return c;
  }
  const now = Date.now();
  c = tx(() => {
    const r = db.prepare("INSERT INTO chats (type, direct_key, created_by, created_at, updated_at) VALUES ('direct', ?, ?, ?, ?)")
      .run(key, uid, now, now);
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)");
    ins.run(id, uid, now);
    ins.run(id, otherId, now);
    return db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  });
  return c;
}

// ---------- Доступ ----------
function membership(chatId, uid) {
  return db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?').get(int(chatId), uid);
}
function requireMember(chatId, uid) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(int(chatId));
  const m = chat && membership(chat.id, uid);
  if (!chat || !m) throw new HttpError(404, 'Чат не найден');
  return { chat, m };
}
const isChatAdmin = (m) => m && (m.role === 'owner' || m.role === 'admin');
function canPost(chat, m) {
  if (chat.type === 'channel' || chat.only_admins_post) return isChatAdmin(m);
  return true;
}
function memberIds(chatId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map((r) => r.user_id);
}

// ---------- Сериализация ----------
function fileInfo(fileId) {
  if (!fileId) return null;
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!f) return null;
  return { id: f.id, name: f.name, mime: f.mime, size: f.size, meta: jsonParse(f.meta, {}), url: `/api/files/${f.id}` };
}

function pollResults(msg, meta, viewerId) {
  const rows = db.prepare('SELECT user_id, option FROM poll_votes WHERE message_id = ?').all(msg.id);
  const counts = meta.options.map(() => 0);
  const voters = meta.options.map(() => []);
  const mine = [];
  const people = new Set();
  for (const r of rows) {
    if (r.option < 0 || r.option >= counts.length) continue;
    counts[r.option] += 1;
    people.add(r.user_id);
    if (!meta.anonymous) voters[r.option].push(r.user_id);
    if (r.user_id === viewerId) mine.push(r.option);
  }
  return { counts, voters: meta.anonymous ? null : voters, mine, total: people.size };
}

function serializeMessage(m, viewerId) {
  if (!m) return null;
  if (m.deleted) return { id: m.id, chat_id: m.chat_id, deleted: true };
  const meta = jsonParse(m.meta, {});
  const out = {
    id: m.id, chat_id: m.chat_id, user_id: m.user_id, kind: m.kind, body: m.body,
    file: fileInfo(m.file_id), reply_to: m.reply_to, meta,
    fwd: m.fwd_user_id || m.fwd_name ? { user_id: m.fwd_user_id, name: m.fwd_name } : null,
    silent: !!m.silent, edited_at: m.edited_at, created_at: m.created_at,
  };
  if (m.reply_to) {
    const r = db.prepare('SELECT id, user_id, kind, body, file_id, deleted, meta FROM messages WHERE id = ?').get(m.reply_to);
    if (r && !r.deleted) {
      const f = r.file_id ? db.prepare('SELECT name, mime FROM files WHERE id = ?').get(r.file_id) : null;
      out.reply = { id: r.id, user_id: r.user_id, kind: r.kind, body: r.body.slice(0, 200), file: f, meta: r.kind === 'poll' ? { question: jsonParse(r.meta, {}).question } : undefined };
    } else out.reply = { id: m.reply_to, deleted: true };
  }
  const reacts = db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY created_at').all(m.id);
  if (reacts.length) {
    const map = new Map();
    for (const r of reacts) {
      if (!map.has(r.emoji)) map.set(r.emoji, []);
      map.get(r.emoji).push(r.user_id);
    }
    out.reactions = [...map].map(([emoji, users]) => ({ emoji, users, mine: users.includes(viewerId) }));
  }
  if (m.kind === 'poll') out.poll = pollResults(m, meta, viewerId);
  return out;
}

function messageRow(id) { return db.prepare('SELECT * FROM messages WHERE id = ?').get(int(id)); }

function unreadCount(chatId, uid, lastRead) {
  return db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND deleted = 0 AND (user_id IS NULL OR user_id <> ?)')
    .get(chatId, lastRead, uid).n;
}
function mentionCount(chatId, uid, lastRead) {
  // Упоминания хранятся в meta.mentions (массив id). JSON-поиск в SQLite.
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND deleted = 0
    AND EXISTS (SELECT 1 FROM json_each(messages.meta, '$.mentions') WHERE value = ?)`).get(chatId, lastRead, uid).n;
}

function serializeChat(chat, uid, m) {
  m = m || membership(chat.id, uid);
  const out = {
    id: chat.id, type: chat.type, title: chat.title, description: chat.description,
    avatar: chat.avatar_file ? `/api/files/${chat.avatar_file}` : null, color: chat.color,
    is_public: !!chat.is_public, only_admins_post: !!chat.only_admins_post,
    invite_code: m && isChatAdmin(m) ? chat.invite_code : null,
    pinned_msg_id: chat.pinned_msg_id, created_at: chat.created_at, updated_at: chat.updated_at,
    my_role: m?.role || null, muted_until: m?.muted_until || 0, pinned_at: m?.pinned_at || null,
    archived: m?.archived || 0, manual_unread: !!m?.manual_unread, draft: m?.draft || '',
    last_read_id: m?.last_read_id || 0,
  };
  out.unread = m ? unreadCount(chat.id, uid, m.last_read_id) : 0;
  out.mentions = m && out.unread ? mentionCount(chat.id, uid, m.last_read_id) : 0;
  // Самое дальнее место, до которого дочитали другие (для галочек «прочитано»).
  out.others_read_id = db.prepare('SELECT COALESCE(MAX(last_read_id), 0) AS v FROM chat_members WHERE chat_id = ? AND user_id <> ?').get(chat.id, uid).v;
  out.members_count = db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(chat.id).n;
  const last = chat.last_msg_id ? messageRow(chat.last_msg_id) : null;
  out.last = last && !last.deleted ? serializeMessage(last, uid) : null;
  if (chat.type === 'direct') {
    const otherId = chat.direct_key.split(':').map(Number).find((x) => x !== uid);
    out.peer = publicUser(userById(otherId), uid);
  }
  if (chat.type === 'ai') out.peer = publicUser(userById(aiBotId()), uid);
  return out;
}

function listChats(uid) {
  ensureSaved(uid);
  const rows = db.prepare(`SELECT c.*, cm.role AS m_role FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ? AND cm.archived <> 2 ORDER BY c.updated_at DESC`).all(uid);
  return rows.map((c) => serializeChat(c, uid));
}

function chatDetails(chatId, uid) {
  const { chat, m } = requireMember(chatId, uid);
  const out = serializeChat(chat, uid, m);
  out.members = db.prepare(`SELECT cm.user_id, cm.role, cm.joined_at, cm.last_read_id FROM chat_members cm
    JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`)
    .all(chat.id).map((r) => ({ ...publicUser(userById(r.user_id), uid), chat_role: r.role, joined_at: r.joined_at, last_read_id: r.last_read_id }));
  const counts = db.prepare(`SELECT
      SUM(CASE WHEN kind IN ('image','video') THEN 1 ELSE 0 END) AS media,
      SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files,
      SUM(CASE WHEN kind = 'voice' THEN 1 ELSE 0 END) AS voice,
      SUM(CASE WHEN kind = 'text' AND body LIKE '%http%' THEN 1 ELSE 0 END) AS links
    FROM messages WHERE chat_id = ? AND deleted = 0`).get(chat.id);
  out.counts = { media: counts.media || 0, files: counts.files || 0, voice: counts.voice || 0, links: counts.links || 0 };
  out.webhooks = isChatAdmin(m) ? db.prepare('SELECT id, name, created_at, last_used FROM webhooks WHERE chat_id = ?').all(chat.id) : [];
  return out;
}

// ---------- Выборка сообщений ----------
function getMessages(chatId, uid, q = {}) {
  const { chat } = requireMember(chatId, uid);
  const limit = Math.min(Math.max(int(q.limit) || 50, 1), 100);
  let rows;
  if (q.around) {
    const a = int(q.around);
    const before = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?').all(chat.id, a, Math.floor(limit / 2));
    const after = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id >= ? AND deleted = 0 ORDER BY id ASC LIMIT ?').all(chat.id, a, Math.ceil(limit / 2));
    rows = [...before.reverse(), ...after];
  } else if (q.after) {
    rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id > ? AND deleted = 0 ORDER BY id ASC LIMIT ?').all(chat.id, int(q.after), limit);
  } else if (q.before) {
    rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?').all(chat.id, int(q.before), limit).reverse();
  } else {
    rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?').all(chat.id, limit).reverse();
  }
  return rows.map((m) => serializeMessage(m, uid));
}

function chatMedia(chatId, uid, kind) {
  const { chat } = requireMember(chatId, uid);
  const kinds = { media: "kind IN ('image','video')", files: "kind = 'file'", voice: "kind = 'voice'", links: "kind = 'text' AND body LIKE '%http%'" };
  const cond = kinds[kind];
  if (!cond) throw new HttpError(400, 'Неизвестный тип');
  return db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 AND ${cond} ORDER BY id DESC LIMIT 200`).all(chat.id)
    .map((m) => serializeMessage(m, uid));
}

// ---------- Отправка ----------
function extractMentions(body, chatId) {
  const logins = [...new Set([...String(body).matchAll(/(^|[\s(])@([a-z0-9._-]{2,40})/gi)].map((x) => x[2].toLowerCase()))];
  const ids = [];
  for (const l of logins) {
    if (l === 'all' || l === 'все' || l === 'всі') {
      ids.push(...memberIds(chatId));
      continue;
    }
    const u = db.prepare('SELECT id FROM users WHERE login = ?').get(l);
    if (u && membership(chatId, u.id)) ids.push(u.id);
  }
  return [...new Set(ids)];
}

function touchChat(chatId, msgId, ts) {
  db.prepare('UPDATE chats SET last_msg_id = ?, updated_at = ? WHERE id = ?').run(msgId, ts, chatId);
}

/**
 * Записать сообщение в чат и разослать участникам.
 * opts: { body, kind, file_id, reply_to, meta, silent, fwd_user_id, fwd_name, system }
 */
function postMessage(uid, chatId, opts = {}) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(int(chatId));
  if (!chat) throw new HttpError(404, 'Чат не найден');
  if (!opts.system) {
    const m = membership(chat.id, uid);
    if (!m) throw new HttpError(404, 'Чат не найден');
    if (!canPost(chat, m)) throw new HttpError(403, 'Писать в этот канал могут только администраторы', 'readonly');
  }
  const kind = opts.kind || 'text';
  const body = str(opts.body, MAX_TEXT);
  let fileId = opts.file_id ? int(opts.file_id) : null;
  if (fileId) {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!f) throw new HttpError(400, 'Файл не найден');
    // Чужой файл можно отправить только если он уже есть в доступном чате (пересылка).
    if (f.user_id !== uid && !opts.system && !fileAccessible(fileId, uid)) throw new HttpError(403, 'Нет доступа к файлу');
  }
  if (kind === 'text' && !body && !fileId && !opts.system) throw new HttpError(400, 'Пустое сообщение', 'empty');
  let replyTo = opts.reply_to ? int(opts.reply_to) : null;
  if (replyTo) {
    const r = messageRow(replyTo);
    if (!r || r.chat_id !== chat.id) replyTo = null;
  }
  const meta = { ...(opts.meta || {}) };
  if (kind !== 'system' && body) {
    const mentions = extractMentions(body, chat.id).filter((x) => x !== uid);
    if (mentions.length) meta.mentions = mentions;
  }
  const now = Date.now();
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO messages (chat_id, user_id, kind, body, file_id, reply_to, fwd_user_id, fwd_name, meta, silent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chat.id, opts.system && !uid ? null : uid, kind, body, fileId, replyTo,
      opts.fwd_user_id || null, opts.fwd_name || '', JSON.stringify(meta), opts.silent ? 1 : 0, now);
    const mid = Number(r.lastInsertRowid);
    touchChat(chat.id, mid, now);
    if (uid) db.prepare('UPDATE chat_members SET last_read_id = ?, manual_unread = 0, draft = CASE WHEN ? THEN draft ELSE \'\' END WHERE chat_id = ? AND user_id = ?')
      .run(mid, opts.keepDraft ? 1 : 0, chat.id, uid);
    // Удалённый у себя личный чат «воскресает» при новом сообщении.
    db.prepare('UPDATE chat_members SET archived = 0 WHERE chat_id = ? AND archived = 2').run(chat.id);
    return mid;
  });
  const row = messageRow(id);
  broadcastMessage(chat, row, 'message:new');
  return serializeMessage(row, uid);
}

function broadcastMessage(chat, row, type) {
  const ids = memberIds(chat.id);
  for (const id of ids) rt.toUser(id, { type, chat_id: chat.id, message: serializeMessage(row, id) });
  rt.emit('message', { chat, row, type });
}

function sendMessage(uid, chatId, b) {
  const kind = ['text', 'file', 'image', 'video', 'voice'].includes(b.kind) ? b.kind : 'text';
  return postMessage(uid, chatId, { body: b.body, kind, file_id: b.file_id, reply_to: b.reply_to, silent: !!b.silent });
}

function sendPoll(uid, chatId, b) {
  const question = str(b.question, 300);
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => str(o, 120)).filter(Boolean).slice(0, 12);
  if (!question || options.length < 2) throw new HttpError(400, 'Нужен вопрос и минимум два варианта', 'poll_invalid');
  return postMessage(uid, chatId, {
    kind: 'poll', body: question,
    meta: { question, options, multiple: !!b.multiple, anonymous: b.anonymous !== false, closed: false },
  });
}

function systemMessage(chatId, actorId, event, extra = {}) {
  return postMessage(actorId, chatId, { kind: 'system', system: true, meta: { event, actor: actorId, ...extra } });
}

// ---------- Правка, удаление, реакции ----------
function editMessage(uid, msgId, body) {
  const m = messageRow(msgId);
  if (!m || m.deleted) throw new HttpError(404, 'Сообщение не найдено');
  requireMember(m.chat_id, uid);
  if (m.user_id !== uid) throw new HttpError(403, 'Можно править только свои сообщения');
  if (!['text', 'file', 'image', 'video'].includes(m.kind)) throw new HttpError(400, 'Это сообщение нельзя изменить');
  if (Date.now() - m.created_at > EDIT_WINDOW_MS) throw new HttpError(403, 'Время на правку истекло', 'edit_expired');
  const text = str(body, MAX_TEXT);
  if (!text && !m.file_id) throw new HttpError(400, 'Пустое сообщение', 'empty');
  const meta = jsonParse(m.meta, {});
  const mentions = extractMentions(text, m.chat_id).filter((x) => x !== uid);
  if (mentions.length) meta.mentions = mentions; else delete meta.mentions;
  db.prepare('UPDATE messages SET body = ?, meta = ?, edited_at = ? WHERE id = ?').run(text, JSON.stringify(meta), Date.now(), m.id);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(m.chat_id);
  broadcastMessage(chat, messageRow(m.id), 'message:edit');
  return serializeMessage(messageRow(m.id), uid);
}

function deleteMessage(uid, msgId) {
  const m = messageRow(msgId);
  if (!m || m.deleted) throw new HttpError(404, 'Сообщение не найдено');
  const { chat, m: mem } = requireMember(m.chat_id, uid);
  const own = m.user_id === uid;
  if (!own && !isChatAdmin(mem) && chat.type !== 'saved') throw new HttpError(403, 'Нельзя удалить чужое сообщение');
  if (m.kind === 'system' && !isChatAdmin(mem)) throw new HttpError(403, 'Нельзя удалить');
  tx(() => {
    db.prepare("UPDATE messages SET deleted = 1, body = '', meta = '{}' WHERE id = ?").run(m.id);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(m.id);
    if (chat.pinned_msg_id === m.id) db.prepare('UPDATE chats SET pinned_msg_id = NULL WHERE id = ?').run(chat.id);
    if (chat.last_msg_id === m.id) {
      const prev = db.prepare('SELECT id FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1').get(chat.id);
      db.prepare('UPDATE chats SET last_msg_id = ? WHERE id = ?').run(prev ? prev.id : null, chat.id);
    }
  });
  if (!own) logEvent(uid, 'message_delete_other', { chat: chat.id, msg: m.id });
  rt.toUsers(memberIds(chat.id), { type: 'message:delete', chat_id: chat.id, id: m.id });
  return { ok: true };
}

function react(uid, msgId, emoji) {
  const m = messageRow(msgId);
  if (!m || m.deleted) throw new HttpError(404, 'Сообщение не найдено');
  const { chat } = requireMember(m.chat_id, uid);
  const e = str(emoji, 16);
  if (!e || (!REACTIONS.includes(e) && !/^\p{Extended_Pictographic}/u.test(e))) throw new HttpError(400, 'Неизвестная реакция');
  const had = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, uid, e);
  if (had) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, uid, e);
  else {
    const n = db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE message_id = ? AND user_id = ?').get(m.id, uid).n;
    if (n >= 3) throw new HttpError(400, 'Не больше трёх реакций на сообщение', 'react_limit');
    db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(m.id, uid, e, Date.now());
  }
  broadcastMessage(chat, messageRow(m.id), 'message:edit');
  if (!had && m.user_id && m.user_id !== uid) rt.emit('reaction', { chat, msg: m, uid, emoji: e });
  return serializeMessage(messageRow(m.id), uid);
}

function vote(uid, msgId, options) {
  const m = messageRow(msgId);
  if (!m || m.deleted || m.kind !== 'poll') throw new HttpError(404, 'Опрос не найден');
  const { chat } = requireMember(m.chat_id, uid);
  const meta = jsonParse(m.meta, {});
  if (meta.closed) throw new HttpError(400, 'Опрос закрыт', 'poll_closed');
  let opts = (Array.isArray(options) ? options : [options]).map(int).filter((o) => o >= 0 && o < meta.options.length);
  opts = [...new Set(opts)];
  if (!meta.multiple) opts = opts.slice(0, 1);
  tx(() => {
    db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(m.id, uid);
    for (const o of opts) db.prepare('INSERT INTO poll_votes (message_id, user_id, option) VALUES (?, ?, ?)').run(m.id, uid, o);
  });
  broadcastMessage(chat, messageRow(m.id), 'message:edit');
  return serializeMessage(messageRow(m.id), uid);
}

function closePoll(uid, msgId) {
  const m = messageRow(msgId);
  if (!m || m.kind !== 'poll') throw new HttpError(404, 'Опрос не найден');
  const { chat, m: mem } = requireMember(m.chat_id, uid);
  if (m.user_id !== uid && !isChatAdmin(mem)) throw new HttpError(403, 'Закрыть опрос может автор');
  const meta = jsonParse(m.meta, {});
  meta.closed = true;
  db.prepare('UPDATE messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), m.id);
  broadcastMessage(chat, messageRow(m.id), 'message:edit');
  return serializeMessage(messageRow(m.id), uid);
}

function pinMessage(uid, chatId, msgId) {
  const { chat, m } = requireMember(chatId, uid);
  if (chat.type !== 'direct' && chat.type !== 'saved' && chat.type !== 'ai' && !isChatAdmin(m)) throw new HttpError(403, 'Закреплять могут администраторы');
  let id = null;
  if (msgId) {
    const msg = messageRow(msgId);
    if (!msg || msg.chat_id !== chat.id || msg.deleted) throw new HttpError(404, 'Сообщение не найдено');
    id = msg.id;
  }
  db.prepare('UPDATE chats SET pinned_msg_id = ? WHERE id = ?').run(id, chat.id);
  if (id) systemMessage(chat.id, uid, 'pinned', { message_id: id });
  notifyChatUpdate(chat.id);
  return { ok: true };
}

function forward(uid, msgIds, toChatId) {
  const target = requireMember(toChatId, uid);
  if (!canPost(target.chat, target.m)) throw new HttpError(403, 'Писать в этот канал нельзя', 'readonly');
  const out = [];
  for (const id of (Array.isArray(msgIds) ? msgIds : [msgIds]).slice(0, 50)) {
    const m = messageRow(id);
    if (!m || m.deleted || !membership(m.chat_id, uid) || m.kind === 'system' || m.kind === 'call') continue;
    const src = m.fwd_user_id || m.fwd_name ? { id: m.fwd_user_id, name: m.fwd_name } : { id: m.user_id, name: userById(m.user_id)?.name || '' };
    const isPoll = m.kind === 'poll';
    out.push(postMessage(uid, target.chat.id, {
      kind: isPoll ? 'text' : m.kind, body: isPoll ? `📊 ${m.body}` : m.body, file_id: m.file_id,
      fwd_user_id: src.id, fwd_name: src.name, meta: m.kind === 'voice' ? {} : {},
    }));
  }
  return out;
}

// ---------- Прочтение, личные настройки чата ----------
function markRead(uid, chatId, upTo) {
  const { chat, m } = requireMember(chatId, uid);
  const maxId = chat.last_msg_id || 0;
  const id = Math.min(int(upTo) || maxId, maxId);
  if (id > m.last_read_id || m.manual_unread) {
    db.prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?), manual_unread = 0 WHERE chat_id = ? AND user_id = ?').run(id, chat.id, uid);
    rt.toUsers(memberIds(chat.id), { type: 'read', chat_id: chat.id, user_id: uid, last_read_id: Math.max(id, m.last_read_id) });
  }
  return { ok: true };
}

function updateMembership(uid, chatId, b) {
  const { chat, m } = requireMember(chatId, uid);
  const sets = [];
  const vals = [];
  if ('muted_until' in b) { sets.push('muted_until = ?'); vals.push(Math.max(0, int(b.muted_until))); }
  if ('pinned' in b) {
    if (b.pinned) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE user_id = ? AND pinned_at IS NOT NULL').get(uid).n;
      if (!m.pinned_at && n >= 10) throw new HttpError(400, 'Можно закрепить не больше 10 чатов', 'pin_limit');
    }
    sets.push('pinned_at = ?'); vals.push(b.pinned ? (m.pinned_at || Date.now()) : null);
  }
  if ('archived' in b) { sets.push('archived = ?'); vals.push(b.archived ? 1 : 0); }
  if ('manual_unread' in b) { sets.push('manual_unread = ?'); vals.push(b.manual_unread ? 1 : 0); }
  if ('draft' in b) { sets.push('draft = ?'); vals.push(str(b.draft, MAX_TEXT)); }
  if (!sets.length) return serializeChat(chat, uid);
  db.prepare(`UPDATE chat_members SET ${sets.join(', ')} WHERE chat_id = ? AND user_id = ?`).run(...vals, chat.id, uid);
  const out = serializeChat(chat, uid);
  if (!('draft' in b) || Object.keys(b).length > 1) rt.toUser(uid, { type: 'chat:update', chat: out });
  return out;
}

function clearHistoryForMe(uid, chatId) {
  // «Удалить чат» для личного чата: прячем у себя; переписка остаётся у собеседника.
  const { chat } = requireMember(chatId, uid);
  if (chat.type !== 'direct') throw new HttpError(400, 'Только для личных чатов');
  db.prepare('UPDATE chat_members SET archived = 2, pinned_at = NULL, last_read_id = ? WHERE chat_id = ? AND user_id = ?').run(chat.last_msg_id || 0, chat.id, uid);
  rt.toUser(uid, { type: 'chat:remove', chat_id: chat.id });
  return { ok: true };
}

// ---------- Группы и каналы ----------
/** Аватар чата — только своя картинка: иначе чужой файл по номеру стал бы виден всем. */
function ownImage(fileId, uid) {
  if (!fileId) return null;
  const f = db.prepare('SELECT user_id, mime FROM files WHERE id = ?').get(int(fileId));
  if (!f || f.user_id !== uid || !/^image\//.test(f.mime)) throw new HttpError(400, 'Нужна своя картинка');
  return int(fileId);
}
function notifyChatUpdate(chatId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  for (const id of memberIds(chatId)) rt.toUser(id, { type: 'chat:update', chat: serializeChat(chat, id) });
}

function createChat(uid, b) {
  const type = b.type === 'channel' ? 'channel' : 'group';
  const title = str(b.title, 80);
  if (!title) throw new HttpError(400, 'Укажите название', 'title_required');
  const members = [...new Set((Array.isArray(b.members) ? b.members : []).map(int).filter((x) => x && x !== uid))];
  const now = Date.now();
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO chats (type, title, description, color, is_public, only_admins_post, invite_code, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(type, title, str(b.description, 500), crypto.randomInt(8), b.is_public ? 1 : 0,
      type === 'channel' ? 1 : 0, crypto.randomBytes(9).toString('base64url'), uid, now, now);
    const cid = Number(r.lastInsertRowid);
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(cid, uid, now);
    const ins = db.prepare("INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)");
    for (const m of members) {
      const u = userById(m);
      if (u && u.active && !u.is_bot) ins.run(cid, m, now);
    }
    if (b.avatar_file) db.prepare('UPDATE chats SET avatar_file = ? WHERE id = ?').run(ownImage(b.avatar_file, uid), cid);
    return cid;
  });
  systemMessage(id, uid, 'created', { title });
  logEvent(uid, 'chat_create', { id, type });
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  for (const m of memberIds(id)) rt.toUser(m, { type: 'chat:new', chat: serializeChat(chat, m) });
  return serializeChat(chat, uid);
}

function updateChat(uid, chatId, b) {
  const { chat, m } = requireMember(chatId, uid);
  if (!['group', 'channel'].includes(chat.type)) throw new HttpError(400, 'Этот чат нельзя настраивать');
  if (!isChatAdmin(m)) throw new HttpError(403, 'Только для администраторов чата');
  const sets = [];
  const vals = [];
  if ('title' in b) {
    const t = str(b.title, 80);
    if (!t) throw new HttpError(400, 'Укажите название', 'title_required');
    if (t !== chat.title) { sets.push('title = ?'); vals.push(t); }
  }
  if ('description' in b) { sets.push('description = ?'); vals.push(str(b.description, 500)); }
  if ('is_public' in b) { sets.push('is_public = ?'); vals.push(b.is_public ? 1 : 0); }
  if ('only_admins_post' in b && chat.type === 'group') { sets.push('only_admins_post = ?'); vals.push(b.only_admins_post ? 1 : 0); }
  if ('avatar_file' in b) { sets.push('avatar_file = ?'); vals.push(b.avatar_file ? ownImage(b.avatar_file, uid) : null); }
  if (b.reset_invite) { sets.push('invite_code = ?'); vals.push(crypto.randomBytes(9).toString('base64url')); }
  if (sets.length) db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...vals, chat.id);
  if ('title' in b && str(b.title, 80) !== chat.title) systemMessage(chat.id, uid, 'title', { title: str(b.title, 80) });
  notifyChatUpdate(chat.id);
  return chatDetails(chat.id, uid);
}

function addMembers(uid, chatId, ids) {
  const { chat, m } = requireMember(chatId, uid);
  if (!['group', 'channel'].includes(chat.type)) throw new HttpError(400, 'В этот чат нельзя добавлять');
  if (chat.type === 'channel' && !isChatAdmin(m)) throw new HttpError(403, 'Добавлять в канал могут администраторы');
  const now = Date.now();
  const added = [];
  for (const id of (Array.isArray(ids) ? ids : [ids]).map(int)) {
    const u = userById(id);
    if (!u || !u.active || u.is_bot || membership(chat.id, id)) continue;
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at, last_read_id) VALUES (?, ?, 'member', ?, 0)").run(chat.id, id, now);
    added.push(id);
  }
  if (added.length) {
    systemMessage(chat.id, uid, 'added', { targets: added });
    const fresh = db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id);
    for (const id of added) rt.toUser(id, { type: 'chat:new', chat: serializeChat(fresh, id) });
    notifyChatUpdate(chat.id);
  }
  return chatDetails(chat.id, uid);
}

function removeMember(uid, chatId, targetId) {
  const { chat, m } = requireMember(chatId, uid);
  targetId = int(targetId);
  if (!['group', 'channel'].includes(chat.type)) throw new HttpError(400, 'Нельзя');
  const self = targetId === uid;
  const t = membership(chat.id, targetId);
  if (!t) throw new HttpError(404, 'Участник не найден');
  if (!self) {
    if (!isChatAdmin(m)) throw new HttpError(403, 'Только для администраторов');
    if (t.role === 'owner' || (t.role === 'admin' && m.role !== 'owner')) throw new HttpError(403, 'Нельзя исключить этого участника');
  }
  tx(() => {
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chat.id, targetId);
    if (t.role === 'owner') {
      // Владелец ушёл — права переходят старейшему администратору или участнику.
      const next = db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1").get(chat.id);
      if (next) db.prepare("UPDATE chat_members SET role = 'owner' WHERE chat_id = ? AND user_id = ?").run(chat.id, next.user_id);
    }
  });
  rt.toUser(targetId, { type: 'chat:remove', chat_id: chat.id });
  const left = db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(chat.id).n;
  if (!left) {
    db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
    return { ok: true };
  }
  systemMessage(chat.id, uid, self ? 'left' : 'removed', { targets: [targetId] });
  notifyChatUpdate(chat.id);
  return { ok: true };
}

function setMemberRole(uid, chatId, targetId, role) {
  const { chat, m } = requireMember(chatId, uid);
  if (m.role !== 'owner') throw new HttpError(403, 'Назначать администраторов может владелец');
  const t = membership(chat.id, int(targetId));
  if (!t || t.role === 'owner') throw new HttpError(400, 'Нельзя');
  const r = role === 'admin' ? 'admin' : 'member';
  db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run(r, chat.id, t.user_id);
  notifyChatUpdate(chat.id);
  return chatDetails(chat.id, uid);
}

function deleteChat(uid, chatId) {
  const { chat, m } = requireMember(chatId, uid);
  if (!['group', 'channel'].includes(chat.type) || m.role !== 'owner') throw new HttpError(403, 'Удалить чат может владелец');
  const ids = memberIds(chat.id);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
  logEvent(uid, 'chat_delete', { id: chat.id, title: chat.title });
  rt.toUsers(ids, { type: 'chat:remove', chat_id: chat.id });
  return { ok: true };
}

function joinChat(uid, { chat_id, invite_code }) {
  let chat;
  if (invite_code) chat = db.prepare('SELECT * FROM chats WHERE invite_code = ?').get(str(invite_code, 40));
  else chat = db.prepare('SELECT * FROM chats WHERE id = ? AND is_public = 1').get(int(chat_id));
  if (!chat) throw new HttpError(404, 'Приглашение недействительно', 'invite_invalid');
  if (!membership(chat.id, uid)) {
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(chat.id, uid, Date.now());
    systemMessage(chat.id, uid, 'joined');
    notifyChatUpdate(chat.id);
  }
  return serializeChat(db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id), uid);
}

function invitePreview(code) {
  const chat = db.prepare('SELECT * FROM chats WHERE invite_code = ?').get(str(code, 40));
  if (!chat) throw new HttpError(404, 'Приглашение недействительно', 'invite_invalid');
  return {
    id: chat.id, type: chat.type, title: chat.title, description: chat.description, color: chat.color,
    avatar: chat.avatar_file ? `/api/files/${chat.avatar_file}` : null,
    members_count: db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(chat.id).n,
  };
}

function publicCatalog(uid) {
  return db.prepare('SELECT * FROM chats WHERE is_public = 1 ORDER BY updated_at DESC LIMIT 200').all().map((c) => ({
    id: c.id, type: c.type, title: c.title, description: c.description, color: c.color,
    avatar: c.avatar_file ? `/api/files/${c.avatar_file}` : null,
    members_count: db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(c.id).n,
    joined: !!membership(c.id, uid),
  }));
}

// ---------- Поиск ----------
function ftsQuery(q) {
  const words = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return null;
  return words.slice(0, 8).map((w) => `"${w}"*`).join(' ');
}

function search(uid, q, chatId) {
  const text = str(q, 200);
  if (text.length < 2) return { messages: [], users: [], chats: [] };
  const fq = ftsQuery(text);
  let messages = [];
  if (fq) {
    const params = [uid, fq];
    let cond = '';
    if (chatId) { cond = 'AND m.chat_id = ?'; params.push(int(chatId)); }
    messages = db.prepare(`SELECT m.* FROM messages_fts f JOIN messages m ON m.id = f.rowid
      JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
      WHERE messages_fts MATCH ? AND m.deleted = 0 ${cond} ORDER BY m.id DESC LIMIT 60`)
      .all(...params).map((m) => serializeMessage(m, uid));
  }
  if (chatId) return { messages, users: [], chats: [] };
  // LIKE в SQLite не различает регистр только для латиницы — кириллицу сравниваем в JS.
  const ql = text.toLocaleLowerCase();
  const has = (...vals) => vals.some((v) => String(v || '').toLocaleLowerCase().includes(ql));
  const users = db.prepare('SELECT * FROM users WHERE active = 1 AND id <> ? ORDER BY is_bot, name').all(uid)
    .filter((u) => has(u.name, u.login, u.position, u.department)).slice(0, 20).map((u) => publicUser(u, uid));
  const chats = db.prepare(`SELECT c.* FROM chats c LEFT JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
    WHERE c.type IN ('group','channel') AND (cm.user_id IS NOT NULL OR c.is_public = 1)`).all(uid)
    .filter((c) => has(c.title, c.description)).slice(0, 20).map((c) => ({ ...serializeChat(c, uid), joined: !!membership(c.id, uid) }));
  return { messages, users, chats };
}

// ---------- Файлы: доступ ----------
function fileAccessible(fileId, uid) {
  const f = db.prepare('SELECT user_id FROM files WHERE id = ?').get(fileId);
  if (!f) return false;
  if (f.user_id === uid) return true;
  if (db.prepare('SELECT 1 FROM users WHERE avatar_file = ?').get(fileId)) return true;
  if (db.prepare('SELECT 1 FROM chats WHERE avatar_file = ?').get(fileId)) return true;
  return !!db.prepare(`SELECT 1 FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id
    WHERE m.file_id = ? AND m.deleted = 0 AND cm.user_id = ? LIMIT 1`).get(fileId, uid);
}

module.exports = {
  REACTIONS, publicUser, userById, userSettings, aiBotId, ensureSaved, ensureAi, getOrCreateDirect,
  membership, requireMember, isChatAdmin, canPost, memberIds, serializeMessage, serializeChat, messageRow,
  listChats, chatDetails, getMessages, chatMedia, postMessage, sendMessage, sendPoll, systemMessage,
  editMessage, deleteMessage, react, vote, closePoll, pinMessage, forward, markRead, updateMembership,
  clearHistoryForMe, createChat, updateChat, addMembers, removeMember, setMemberRole, deleteChat, joinChat,
  invitePreview, publicCatalog, search, fileAccessible, notifyChatUpdate, broadcastMessage,
};
