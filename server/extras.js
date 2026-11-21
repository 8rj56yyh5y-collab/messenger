'use strict';
// Отложенные сообщения, напоминания, входящие вебхуки (Gobsek и другие системы), администрирование.
const crypto = require('node:crypto');
const { db, tx, logEvent } = require('./db');
const { HttpError, str, int } = require('./util');
const auth = require('./auth');
const chats = require('./chats');
const rt = require('./realtime');

// ---------- Отложенные сообщения и напоминания ----------
function schedule(uid, chatId, b) {
  const { chat, m } = chats.requireMember(chatId, uid);
  if (!chats.canPost(chat, m)) throw new HttpError(403, 'Писать сюда нельзя', 'readonly');
  const at = int(b.at);
  if (at < Date.now() + 30e3) throw new HttpError(400, 'Время должно быть в будущем', 'time_past');
  const body = str(b.body, 8000);
  if (!body) throw new HttpError(400, 'Пустое сообщение', 'empty');
  const r = db.prepare("INSERT INTO scheduled (kind, user_id, chat_id, body, reply_to, run_at, created_at) VALUES ('message', ?, ?, ?, ?, ?, ?)")
    .run(uid, chat.id, body, b.reply_to ? int(b.reply_to) : null, at, Date.now());
  return { id: Number(r.lastInsertRowid), chat_id: chat.id, body, run_at: at, kind: 'message' };
}

function remind(uid, msgId, at) {
  const msg = chats.messageRow(msgId);
  if (!msg || msg.deleted) throw new HttpError(404, 'Сообщение не найдено');
  chats.requireMember(msg.chat_id, uid);
  const t = int(at);
  if (t < Date.now() + 30e3) throw new HttpError(400, 'Время должно быть в будущем', 'time_past');
  const r = db.prepare("INSERT INTO scheduled (kind, user_id, chat_id, message_id, run_at, created_at) VALUES ('reminder', ?, ?, ?, ?, ?)")
    .run(uid, msg.chat_id, msg.id, t, Date.now());
  return { id: Number(r.lastInsertRowid), run_at: t, kind: 'reminder' };
}

function listScheduled(uid, chatId) {
  const rows = chatId
    ? db.prepare('SELECT * FROM scheduled WHERE user_id = ? AND chat_id = ? ORDER BY run_at').all(uid, int(chatId))
    : db.prepare('SELECT * FROM scheduled WHERE user_id = ? ORDER BY run_at').all(uid);
  return rows;
}

function cancelScheduled(uid, id) {
  const r = db.prepare('DELETE FROM scheduled WHERE id = ? AND user_id = ?').run(int(id), uid);
  if (!r.changes) throw new HttpError(404, 'Не найдено');
  return { ok: true };
}

function runScheduled() {
  const due = db.prepare('SELECT * FROM scheduled WHERE run_at <= ? ORDER BY run_at LIMIT 50').all(Date.now());
  for (const s of due) {
    db.prepare('DELETE FROM scheduled WHERE id = ?').run(s.id);
    try {
      if (s.kind === 'message') {
        if (!chats.membership(s.chat_id, s.user_id)) continue;
        chats.postMessage(s.user_id, s.chat_id, { body: s.body, reply_to: s.reply_to, meta: { scheduled: true }, keepDraft: true });
      } else {
        const saved = chats.ensureSaved(s.user_id);
        const msg = chats.messageRow(s.message_id);
        // Без автора (user_id = NULL): так напоминание считается непрочитанным и «звенит».
        chats.postMessage(null, saved.id, {
          kind: 'system', system: true,
          meta: { event: 'reminder', actor: s.user_id, chat_id: s.chat_id, message_id: s.message_id, preview: msg && !msg.deleted ? msg.body.slice(0, 300) : '' },
        });
        rt.toUser(s.user_id, { type: 'reminder', chat_id: s.chat_id, message_id: s.message_id, preview: msg ? msg.body.slice(0, 140) : '' });
      }
    } catch { /* чат удалён — пропускаем */ }
  }
}

let timer = null;
function startScheduler() {
  if (timer) return;
  timer = setInterval(runScheduled, 15e3);
  timer.unref();
}

// ---------- Входящие вебхуки ----------
function botForWebhook(name) {
  const login = `bot.${crypto.createHash('sha1').update(name).digest('hex').slice(0, 10)}`;
  let b = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  if (!b) {
    const r = db.prepare('INSERT INTO users (login, name, position, is_bot, color, created_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(login, name, 'Bot', crypto.randomInt(8), Date.now());
    b = { id: Number(r.lastInsertRowid) };
  }
  return b.id;
}

function createWebhook(uid, chatId, name) {
  const { chat, m } = chats.requireMember(chatId, uid);
  if (!chats.isChatAdmin(m) && chat.type !== 'saved') throw new HttpError(403, 'Только для администраторов чата');
  if (!['group', 'channel', 'saved'].includes(chat.type)) throw new HttpError(400, 'Вебхуки — только для групп и каналов');
  const n = str(name, 60) || 'Gobsek';
  const token = auth.randomToken(24);
  const botId = botForWebhook(n);
  db.prepare("INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(chat.id, botId, Date.now());
  const r = db.prepare('INSERT INTO webhooks (chat_id, name, token_hash, bot_user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(chat.id, n, auth.sha(token), botId, uid, Date.now());
  logEvent(uid, 'webhook_create', { chat: chat.id, name: n });
  return { id: Number(r.lastInsertRowid), name: n, token, path: `/api/hooks/${token}` };
}

function deleteWebhook(uid, chatId, id) {
  const { m } = chats.requireMember(chatId, uid);
  if (!chats.isChatAdmin(m)) throw new HttpError(403, 'Только для администраторов чата');
  db.prepare('DELETE FROM webhooks WHERE id = ? AND chat_id = ?').run(int(id), int(chatId));
  return { ok: true };
}

/** Входящее сообщение от внешней системы. Тело: { text, title?, url?, silent? } (Markdown чата). */
function incomingWebhook(token, b) {
  const h = db.prepare('SELECT * FROM webhooks WHERE token_hash = ?').get(auth.sha(token));
  if (!h) throw new HttpError(404, 'Вебхук не найден');
  const parts = [];
  if (b.title) parts.push(`**${str(b.title, 200)}**`);
  if (b.text) parts.push(str(b.text, 6000));
  if (b.url && /^https?:\/\//i.test(String(b.url))) parts.push(str(b.url, 500));
  const body = parts.join('\n');
  if (!body) throw new HttpError(400, 'Нужен text');
  db.prepare('UPDATE webhooks SET last_used = ? WHERE id = ?').run(Date.now(), h.id);
  return chats.postMessage(h.bot_user_id, h.chat_id, { body, silent: !!b.silent, system: true, kind: 'text', meta: { via: 'webhook' } });
}

// ---------- Администрирование ----------
function requireAdmin(user) {
  if (user.role !== 'admin') throw new HttpError(403, 'Только для администратора');
}

function adminUsers() {
  return db.prepare(`SELECT id, login, name, email, phone, position, department, role, active, is_bot, gobsek_id, created_at, last_seen,
    (SELECT MAX(last_used) FROM sessions s WHERE s.user_id = users.id) AS last_active
    FROM users WHERE is_bot = 0 ORDER BY active DESC, name`).all().map((u) => ({ ...u, online: rt.isOnline(u.id) }));
}

function validLogin(l) {
  const s = String(l || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(s)) throw new HttpError(400, 'Логин: 3–32 символа, латиница, цифры, точка, дефис', 'login_invalid');
  if (s.startsWith('bot.') || s === 'ai.assistant') throw new HttpError(400, 'Такой логин зарезервирован', 'login_invalid');
  return s;
}

function createUser(admin, b) {
  requireAdmin(admin);
  const login = validLogin(b.login);
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw new HttpError(409, 'Логин уже занят', 'login_taken');
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Укажите имя', 'name_required');
  const password = b.password ? String(b.password) : auth.randomPassword();
  const prob = auth.passwordProblem(password);
  if (prob) throw new HttpError(400, 'Слабый пароль', prob);
  const r = db.prepare(`INSERT INTO users (login, name, email, phone, position, department, role, pass_hash, must_change_pw, color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(login, name, str(b.email, 200), str(b.phone, 40), str(b.position, 100), str(b.department, 100),
    b.role === 'admin' ? 'admin' : 'member', auth.hashPassword(password), crypto.randomInt(8), Date.now());
  const id = Number(r.lastInsertRowid);
  logEvent(admin.id, 'user_create', { id, login });
  autoJoinDefault(id);
  return { id, login, password };
}

function updateUser(admin, id, b) {
  requireAdmin(admin);
  const u = chats.userById(int(id));
  if (!u || u.is_bot) throw new HttpError(404, 'Не найден');
  const sets = [];
  const vals = [];
  for (const k of ['name', 'email', 'phone', 'position', 'department', 'birthday']) if (k in b) { sets.push(`${k} = ?`); vals.push(str(b[k], 200)); }
  if ('role' in b) {
    if (u.id === admin.id && b.role !== 'admin') throw new HttpError(400, 'Нельзя снять права с себя');
    sets.push('role = ?'); vals.push(b.role === 'admin' ? 'admin' : 'member');
  }
  if ('active' in b) {
    if (u.id === admin.id && !b.active) throw new HttpError(400, 'Нельзя отключить себя');
    sets.push('active = ?'); vals.push(b.active ? 1 : 0);
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, u.id);
  if ('active' in b && !b.active) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    rt.kickUser(u.id);
  }
  logEvent(admin.id, 'user_update', { id: u.id, fields: Object.keys(b) });
  rt.toAll({ type: 'user:update', user: chats.publicUser(chats.userById(u.id), 0) });
  return { ok: true };
}

function resetPassword(admin, id) {
  requireAdmin(admin);
  const u = chats.userById(int(id));
  if (!u || u.is_bot) throw new HttpError(404, 'Не найден');
  const password = auth.randomPassword();
  db.prepare('UPDATE users SET pass_hash = ?, must_change_pw = 1 WHERE id = ?').run(auth.hashPassword(password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  rt.kickUser(u.id);
  logEvent(admin.id, 'password_reset', { id: u.id });
  return { login: u.login, password };
}

function createInvite(admin, b) {
  requireAdmin(admin);
  const code = auth.randomToken(12);
  const days = Math.min(Math.max(int(b.days) || 7, 1), 90);
  const uses = Math.min(Math.max(int(b.uses) || 1, 1), 500);
  db.prepare('INSERT INTO invites (code, created_by, role, department, uses_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(code, admin.id, b.role === 'admin' ? 'admin' : 'member', str(b.department, 100), uses, Date.now() + days * 86400e3, Date.now());
  logEvent(admin.id, 'invite_create', { uses, days });
  return { code, uses_left: uses, expires_at: Date.now() + days * 86400e3 };
}
function listInvites(admin) {
  requireAdmin(admin);
  return db.prepare('SELECT * FROM invites WHERE expires_at > ? AND uses_left > 0 ORDER BY created_at DESC').all(Date.now());
}
function deleteInvite(admin, code) {
  requireAdmin(admin);
  db.prepare('DELETE FROM invites WHERE code = ?').run(str(code, 40));
  return { ok: true };
}
function invitePreview(code) {
  const inv = db.prepare('SELECT * FROM invites WHERE code = ? AND expires_at > ? AND uses_left > 0').get(str(code, 40), Date.now());
  if (!inv) throw new HttpError(404, 'Приглашение недействительно', 'invite_invalid');
  return { department: inv.department, expires_at: inv.expires_at };
}

function register(b, req) {
  const inv = db.prepare('SELECT * FROM invites WHERE code = ? AND expires_at > ? AND uses_left > 0').get(str(b.code, 40), Date.now());
  if (!inv) throw new HttpError(404, 'Приглашение недействительно', 'invite_invalid');
  const login = validLogin(b.login);
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw new HttpError(409, 'Логин уже занят', 'login_taken');
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Укажите имя', 'name_required');
  const prob = auth.passwordProblem(b.password);
  if (prob) throw new HttpError(400, 'Слабый пароль', prob);
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO users (login, name, position, department, role, pass_hash, color, lang, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(login, name, str(b.position, 100), inv.department || str(b.department, 100), inv.role,
      auth.hashPassword(b.password), crypto.randomInt(8), str(b.lang, 5), Date.now());
    db.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?').run(inv.code);
    return Number(r.lastInsertRowid);
  });
  logEvent(id, 'register', { invite_by: inv.created_by });
  autoJoinDefault(id);
  return { user: chats.userById(id), token: auth.createSession(id, req) };
}

const DEFAULT_CHAT_NAMES = {
  uk: ['Новини', 'Загальний чат'], ru: ['Новости', 'Общий чат'], en: ['News', 'General'], de: ['Neuigkeiten', 'Allgemein'], pl: ['Aktualności', 'Ogólny'],
};

/** Первый запуск: создать администратора, общий канал и общий чат. */
function setup(b, req) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n > 0) throw new HttpError(409, 'Уже настроено');
  const login = validLogin(b.login);
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Укажите имя', 'name_required');
  const prob = auth.passwordProblem(b.password);
  if (prob) throw new HttpError(400, 'Слабый пароль', prob);
  const r = db.prepare("INSERT INTO users (login, name, position, role, pass_hash, color, lang, created_at) VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)")
    .run(login, name, str(b.position, 100), auth.hashPassword(b.password), crypto.randomInt(8), str(b.lang, 5), Date.now());
  const id = Number(r.lastInsertRowid);
  const company = str(b.company, 80) || process.env.COMPANY_NAME || 'Gobsek';
  const names = DEFAULT_CHAT_NAMES[str(b.lang, 5)] || DEFAULT_CHAT_NAMES.uk;
  const news = chats.createChat(id, { type: 'channel', title: `${company} · ${names[0]}`, description: '', is_public: true });
  const general = chats.createChat(id, { type: 'group', title: `${company} · ${names[1]}`, description: '', is_public: true });
  setDefaultChats([news.id, general.id]);
  logEvent(id, 'setup');
  return { user: chats.userById(id), token: auth.createSession(id, req) };
}

function setDefaultChats(ids) {
  db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  db.prepare("INSERT INTO kv (k, v) VALUES ('default_chats', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(ids));
}
function defaultChats() {
  db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  const row = db.prepare("SELECT v FROM kv WHERE k = 'default_chats'").get();
  try { return row ? JSON.parse(row.v) : []; } catch { return []; }
}
/** Новые сотрудники сразу попадают в общий канал и общий чат. */
function autoJoinDefault(uid) {
  for (const cid of defaultChats()) {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(cid);
    if (chat && !chats.membership(cid, uid)) {
      db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(cid, uid, Date.now());
      try { chats.systemMessage(cid, uid, 'joined'); } catch { /* ignore */ }
    }
  }
}

function stats(admin) {
  requireAdmin(admin);
  const day = Date.now() - 86400e3;
  const week = Date.now() - 7 * 86400e3;
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  const perDay = db.prepare(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS n
    FROM messages WHERE created_at > ? AND kind <> 'system' GROUP BY d ORDER BY d`).all(Date.now() - 30 * 86400e3);
  return {
    users: one('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0 AND active = 1'),
    online: rt.onlineIds().length,
    active_week: one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_used > ?', week),
    chats: one("SELECT COUNT(*) AS n FROM chats WHERE type IN ('group','channel')"),
    messages_day: one("SELECT COUNT(*) AS n FROM messages WHERE created_at > ? AND kind <> 'system'", day),
    messages_total: one("SELECT COUNT(*) AS n FROM messages WHERE kind <> 'system'"),
    calls_week: one('SELECT COUNT(*) AS n FROM calls WHERE started_at > ?', week),
    files_mb: Math.round((db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files').get().n / 1048576) * 10) / 10,
    per_day: perDay,
  };
}

function auditLog(admin) {
  requireAdmin(admin);
  return db.prepare(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300`).all();
}

module.exports = {
  schedule, remind, listScheduled, cancelScheduled, runScheduled, startScheduler,
  createWebhook, deleteWebhook, incomingWebhook,
  requireAdmin, adminUsers, createUser, updateUser, resetPassword, createInvite, listInvites, deleteInvite, invitePreview,
  register, setup, autoJoinDefault, setDefaultChats, stats, auditLog, validLogin,
};
