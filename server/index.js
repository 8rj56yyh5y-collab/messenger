'use strict';
// Gobsek Chat — HTTP API, раздача интерфейса и WebSocket. Только встроенные модули Node 22.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, logEvent } = require('./db');
const { HttpError, readJson, sendJson, str, int } = require('./util');
const auth = require('./auth');
const chats = require('./chats');
const calls = require('./calls');
const files = require('./files');
const extras = require('./extras');
const ai = require('./ai');
const work = require('./work');
const push = require('./push');
const outbox = require('./outbox');
const org = require('./org');
const ws = require('./workspace');
const awards = require('./awards');
const rt = require('./realtime');
const { acceptUpgrade, Hub } = require('./ws');
const pkg = require('../package.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const APP_NAME = process.env.APP_NAME || 'Gobsek Chat';
const STATUSES = ['available', 'busy', 'dnd', 'away', 'remote', 'vacation'];
const LANGS = ['uk', 'ru', 'en', 'de', 'pl'];

// ---------- Первичная настройка из переменных окружения ----------
(function bootstrapAdmin() {
  const l = process.env.ADMIN_LOGIN;
  const p = process.env.ADMIN_PASSWORD;
  if (!l || !p) return;
  if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n > 0) return;
  try {
    extras.setup({ login: l, name: process.env.ADMIN_NAME || 'Администратор', password: p }, { headers: {}, socket: {} });
    console.log(`Создан администратор «${l}».`);
  } catch (e) { console.error('Не удалось создать администратора:', e.message); }
})();
chats.aiBotId();

// ---------- Маршрутизатор ----------
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler, public: !!opts.public, raw: !!opts.raw });
}

function meUser(u) {
  const out = chats.publicUser(u, u.id);
  out.settings = chats.userSettings(u);
  out.lang = u.lang;
  out.must_change_pw = !!u.must_change_pw;
  out.has_password = !!u.pass_hash;
  out.birthday_full = u.birthday || '';
  return out;
}

// --- Публичные ---
route('GET', '/api/meta', () => ({
  name: APP_NAME, version: pkg.version, ai: ai.enabled() && ws.on('ai'), ai_available: ai.enabled(), sso: !!process.env.GOBSEK_SSO_SECRET,
  gobsek_url: process.env.GOBSEK_URL || '', sso_start: process.env.GOBSEK_SSO_URL || '', needs_setup: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n === 0,
  langs: LANGS, max_upload_mb: Math.min(files.MAX_MB, ws.get().max_upload_mb), reactions: chats.REACTIONS, ws: ws.publicView(),
}), { public: true });

route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req);
  const { user, token } = auth.login(b.login, b.password, req);
  return [{ user: meUser(user) }, { 'Set-Cookie': auth.sessionCookie(token, auth.SESSION_DAYS * 86400) }];
}, { public: true });

route('POST', '/api/setup', async (req) => {
  const b = await readJson(req);
  const { user, token } = extras.setup(b, req);
  return [{ user: meUser(user) }, { 'Set-Cookie': auth.sessionCookie(token, auth.SESSION_DAYS * 86400) }];
}, { public: true });

route('GET', '/api/invites/:code', (req, res, p) => extras.invitePreview(p.code), { public: true });
route('POST', '/api/register', async (req) => {
  const b = await readJson(req);
  const { user, token } = extras.register(b, req);
  return [{ user: meUser(user) }, { 'Set-Cookie': auth.sessionCookie(token, auth.SESSION_DAYS * 86400) }];
}, { public: true });

route('POST', '/api/logout', (req) => {
  auth.logout(req);
  return [{ ok: true }, { 'Set-Cookie': auth.sessionCookie('', 0) }];
}, { public: true });

route('POST', '/api/hooks/:token', async (req, res, p) => extras.incomingWebhook(p.token, await readJson(req)), { public: true });

// --- Профиль ---
route('GET', '/api/me', (req, res, p, u) => ({ user: meUser(u) }));
route('PATCH', '/api/me', async (req, res, p, u) => {
  const b = await readJson(req);
  const sets = [];
  const vals = [];
  const fromGobsek = !!u.gobsek_id;
  for (const k of ['name', 'phone', 'bio', 'status_text', 'email', 'position', 'department']) {
    if (!(k in b)) continue;
    if (fromGobsek && ['position', 'department'].includes(k)) continue; // ведётся в Gobsek
    const v = str(b[k], k === 'bio' ? 300 : 100);
    if (k === 'name' && !v) throw new HttpError(400, 'Укажите имя', 'name_required');
    sets.push(`${k} = ?`); vals.push(v);
  }
  if ('status' in b && STATUSES.includes(b.status)) { sets.push('status = ?'); vals.push(b.status); }
  if ('birthday' in b) {
    const bd = String(b.birthday || '').trim();
    if (bd && !/^(\d{4}-)?\d{2}-\d{2}$/.test(bd)) throw new HttpError(400, 'Дата рождения: ГГГГ-ММ-ДД');
    sets.push('birthday = ?'); vals.push(bd);
  }
  if ('lang' in b && (LANGS.includes(b.lang) || b.lang === '')) { sets.push('lang = ?'); vals.push(b.lang); }
  if ('avatar_file' in b) {
    const fid = b.avatar_file ? int(b.avatar_file) : null;
    if (fid) {
      const f = files.fileMeta(fid);
      if (!f || f.user_id !== u.id || !/^image\//.test(f.mime)) throw new HttpError(400, 'Нужна картинка');
    }
    sets.push('avatar_file = ?'); vals.push(fid);
  }
  if (b.settings && typeof b.settings === 'object') {
    const cur = chats.userSettings(u);
    const allowed = ['theme', 'accent', 'wallpaper', 'fontSize', 'bubbleRadius', 'sendOnEnter', 'notifications', 'sounds', 'preview',
      'hideLastSeen', 'hideEmail', 'hidePhone', 'compact', 'animations', 'folders', 'quickReactions', 'readReceipts', 'timeFormat',
      'autoReply', 'templates', 'animatedWallpaper', 'density', 'push',
      'font', 'msgLayout', 'bubbleWidth', 'chatWidth', 'groupAvatars', 'chatPreview', 'contrast', 'bigTargets', 'underlineLinks', 'bigEmoji',
      'quietHours', 'groupNotify', 'notifyTasks', 'notifyApprovals', 'notifyKudos', 'notifyMeetings', 'awardToasts', 'offHoursMute', 'tz',
      'spellcheck', 'chatSort', 'startPage', 'callMuteOnJoin', 'callCamOff', 'noiseSuppression', 'echoCancel', 'autoGain', 'mirror', 'soundVolume'];
    for (const k of allowed) if (k in b.settings) cur[k] = b.settings[k];
    const json = JSON.stringify(cur);
    if (json.length > 20000) throw new HttpError(400, 'Слишком много настроек');
    sets.push('settings = ?'); vals.push(json);
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, u.id);
  const fresh = chats.userById(u.id);
  if ('department' in b) org.syncUser(u.id);
  rt.toAll({ type: 'user:update', user: chats.publicUser(fresh, 0) });
  return { user: meUser(fresh) };
});
route('POST', '/api/me/password', async (req, res, p, u) => {
  const b = await readJson(req);
  if (u.pass_hash && !auth.verifyPassword(b.current, u.pass_hash)) throw new HttpError(400, 'Текущий пароль неверный', 'bad_current');
  const prob = auth.passwordProblem(b.password);
  if (prob) throw new HttpError(400, 'Слабый пароль', prob);
  db.prepare('UPDATE users SET pass_hash = ?, must_change_pw = 0 WHERE id = ?').run(auth.hashPassword(b.password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, u.sid);
  logEvent(u.id, 'password_change');
  return { ok: true };
});
route('GET', '/api/me/sessions', (req, res, p, u) => db.prepare('SELECT token_hash, created_at, last_used, ip, ua FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used DESC')
  .all(u.id, Date.now()).map((s) => ({ id: s.token_hash.slice(0, 16), current: s.token_hash === u.sid, created_at: s.created_at, last_used: s.last_used, ip: s.ip, ua: s.ua })));
route('DELETE', '/api/me/sessions/:id', (req, res, p, u) => {
  if (p.id === 'others') db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, u.sid);
  else db.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ? AND token_hash <> ?').run(u.id, str(p.id, 16), u.sid);
  return { ok: true };
});

// --- Сотрудники ---
route('GET', '/api/users', (req, res, p, u) => db.prepare('SELECT * FROM users WHERE active = 1 AND (is_bot = 0 OR login = \'ai.assistant\') ORDER BY department, name')
  .all().map((x) => chats.publicUser(x, u.id)));
route('GET', '/api/users/:id', (req, res, p, u) => {
  const x = chats.userById(int(p.id));
  if (!x) throw new HttpError(404, 'Не найден');
  const common = db.prepare(`SELECT c.* FROM chats c JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
    JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ? WHERE c.type IN ('group','channel') ORDER BY c.updated_at DESC LIMIT 30`).all(u.id, x.id);
  return { ...chats.publicUser(x, u.id), common: common.map((c) => ({ id: c.id, title: c.title, type: c.type, color: c.color, avatar: c.avatar_file ? `/api/files/${c.avatar_file}` : null })), org: org.profile(x.id, u.id) };
});

// --- Оргструктура и профиль ---
route('GET', '/api/awards', (req, res, p, u) => awards.myAwards(u.id));
route('GET', '/api/awards/leaderboard', (req, res, p, u, q) => { ws.requireFeature('awards'); return awards.leaderboard(u.id, { period: q.get('period') || 'month', dept: q.get('dept') || '' }); });
route('GET', '/api/awards/feed', (req, res, p, u) => { ws.requireFeature('awards'); return awards.feed(u.id); });
route('GET', '/api/users/:id/awards', (req, res, p, u) => { ws.requireFeature('awards'); return awards.summary(int(p.id)); });
route('GET', '/api/org', (req, res, p, u) => org.orgView(u.id));
route('GET', '/api/me/profile', (req, res, p, u) => org.profile(u.id, u.id));
route('GET', '/api/admin/workspace', (req, res, p, u) => { extras.requireAdmin(u); return ws.get(); });
route('PATCH', '/api/admin/workspace', async (req, res, p, u) => { extras.requireAdmin(u); return ws.update(u, await readJson(req)); });
route('POST', '/api/admin/departments', async (req, res, p, u) => { extras.requireAdmin(u); return org.createDepartment(u, await readJson(req)); });
route('PATCH', '/api/admin/departments/:id', async (req, res, p, u) => { extras.requireAdmin(u); return org.updateDepartment(u, p.id, await readJson(req)); });
route('DELETE', '/api/admin/departments/:id', (req, res, p, u) => { extras.requireAdmin(u); return org.deleteDepartment(u, p.id); });

// --- Чаты ---
route('GET', '/api/chats', (req, res, p, u) => ({ chats: chats.listChats(u.id), calls: calls.activeCallsFor(u.id), online: rt.onlineIds() }));
route('POST', '/api/chats', async (req, res, p, u) => chats.createChat(u.id, await readJson(req)));
route('POST', '/api/chats/direct', async (req, res, p, u) => {
  const b = await readJson(req);
  const c = chats.getOrCreateDirect(u.id, b.user_id);
  const out = chats.serializeChat(c, u.id);
  rt.toUser(u.id, { type: 'chat:new', chat: out });
  return out;
});
route('POST', '/api/chats/saved', (req, res, p, u) => chats.serializeChat(chats.ensureSaved(u.id), u.id));
route('POST', '/api/chats/ai', (req, res, p, u) => {
  const c = chats.ensureAi(u.id);
  const out = chats.serializeChat(c, u.id);
  rt.toUser(u.id, { type: 'chat:new', chat: out });
  return out;
});
route('POST', '/api/chats/join', async (req, res, p, u) => {
  const out = chats.joinChat(u.id, await readJson(req));
  rt.toUser(u.id, { type: 'chat:new', chat: out });
  return out;
});
route('GET', '/api/join/:code', (req, res, p) => chats.invitePreview(p.code));
route('GET', '/api/catalog', (req, res, p, u) => chats.publicCatalog(u.id));
route('GET', '/api/chats/:id', (req, res, p, u) => chats.chatDetails(p.id, u.id));
route('PATCH', '/api/chats/:id', async (req, res, p, u) => chats.updateChat(u.id, p.id, await readJson(req)));
route('DELETE', '/api/chats/:id', (req, res, p, u) => chats.deleteChat(u.id, p.id));
route('PATCH', '/api/chats/:id/me', async (req, res, p, u) => chats.updateMembership(u.id, p.id, await readJson(req)));
route('POST', '/api/chats/:id/hide', (req, res, p, u) => chats.clearHistoryForMe(u.id, p.id));
route('GET', '/api/chats/:id/messages', (req, res, p, u, q) => chats.getMessages(p.id, u.id, Object.fromEntries(q)));
route('POST', '/api/chats/:id/messages', async (req, res, p, u) => chats.sendMessage(u.id, p.id, await readJson(req)));
route('POST', '/api/chats/:id/polls', async (req, res, p, u) => chats.sendPoll(u.id, p.id, await readJson(req)));
route('POST', '/api/chats/:id/read', async (req, res, p, u) => chats.markRead(u.id, p.id, (await readJson(req)).up_to));
route('POST', '/api/chats/:id/pin', async (req, res, p, u) => chats.pinMessage(u.id, p.id, (await readJson(req)).message_id));
route('GET', '/api/chats/:id/media', (req, res, p, u, q) => chats.chatMedia(p.id, u.id, q.get('kind')));
route('POST', '/api/chats/:id/members', async (req, res, p, u) => chats.addMembers(u.id, p.id, (await readJson(req)).user_ids));
route('DELETE', '/api/chats/:id/members/:uid', (req, res, p, u) => chats.removeMember(u.id, p.id, p.uid));
route('PATCH', '/api/chats/:id/members/:uid', async (req, res, p, u) => chats.setMemberRole(u.id, p.id, p.uid, (await readJson(req)).role));
route('POST', '/api/chats/:id/schedule', async (req, res, p, u) => extras.schedule(u.id, p.id, await readJson(req)));
route('POST', '/api/chats/:id/webhooks', async (req, res, p, u) => extras.createWebhook(u.id, p.id, (await readJson(req)).name));
route('DELETE', '/api/chats/:id/webhooks/:wid', (req, res, p, u) => extras.deleteWebhook(u.id, p.id, p.wid));

// --- Сообщения ---
route('PATCH', '/api/messages/:id', async (req, res, p, u) => chats.editMessage(u.id, p.id, (await readJson(req)).body));
route('DELETE', '/api/messages/:id', (req, res, p, u) => chats.deleteMessage(u.id, p.id));
route('POST', '/api/messages/:id/react', async (req, res, p, u) => chats.react(u.id, p.id, (await readJson(req)).emoji));
route('POST', '/api/messages/:id/vote', async (req, res, p, u) => chats.vote(u.id, p.id, (await readJson(req)).options));
route('POST', '/api/messages/:id/close-poll', (req, res, p, u) => chats.closePoll(u.id, p.id));
route('POST', '/api/messages/:id/remind', async (req, res, p, u) => extras.remind(u.id, p.id, (await readJson(req)).at));
route('GET', '/api/messages/:id/readers', (req, res, p, u) => {
  const m = chats.messageRow(p.id);
  if (!m) throw new HttpError(404, 'Не найдено');
  chats.requireMember(m.chat_id, u.id);
  return db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND last_read_id >= ? AND user_id <> ? LIMIT 200')
    .all(m.chat_id, m.id, m.user_id || 0).map((r) => chats.publicUser(chats.userById(r.user_id), u.id));
});
route('POST', '/api/messages/forward', async (req, res, p, u) => {
  const b = await readJson(req);
  return chats.forward(u.id, b.ids, b.chat_id);
});
route('GET', '/api/scheduled', (req, res, p, u, q) => extras.listScheduled(u.id, q.get('chat_id')));
route('DELETE', '/api/scheduled/:id', (req, res, p, u) => extras.cancelScheduled(u.id, p.id));
route('GET', '/api/search', (req, res, p, u, q) => chats.search(u.id, q.get('q'), q.get('chat_id')));

route('GET', '/api/messages/:id/thread', (req, res, p, u) => chats.getThread(u.id, p.id));
route('POST', '/api/messages/:id/ack', (req, res, p, u) => chats.ack(u.id, p.id));
route('GET', '/api/messages/:id/acks', (req, res, p, u) => chats.ackList(u.id, p.id));
route('POST', '/api/messages/:id/decide', async (req, res, p, u) => work.decide(u.id, p.id, await readJson(req)));

// --- Работа: задачи, погодження, подяки, встречи, пульс ---
route('GET', '/api/tasks', (req, res, p, u, q) => work.listTasks(u.id, q.get('scope') || 'mine'));
route('POST', '/api/tasks', async (req, res, p, u) => work.createTask(u.id, await readJson(req)));
route('PATCH', '/api/tasks/:id', async (req, res, p, u) => work.updateTask(u.id, p.id, await readJson(req)));
route('POST', '/api/chats/:id/approvals', async (req, res, p, u) => work.createApproval(u.id, p.id, await readJson(req)));
route('GET', '/api/approvals/pending', (req, res, p, u) => work.pendingApprovals(u.id));
route('POST', '/api/chats/:id/kudos', async (req, res, p, u) => work.giveKudos(u.id, p.id, await readJson(req)));
route('GET', '/api/kudos', (req, res, p, u) => work.kudosBoard(u.id));
route('POST', '/api/chats/:id/meetings', async (req, res, p, u) => work.createMeeting(u.id, p.id, await readJson(req)));
route('GET', '/api/meetings', (req, res, p, u, q) => work.listMeetings(u.id, q.get('from'), q.get('to')));
route('POST', '/api/meetings/:id/rsvp', async (req, res, p, u) => work.rsvp(u.id, p.id, (await readJson(req)).rsvp));
route('POST', '/api/meetings/:id/cancel', (req, res, p, u) => work.cancelMeeting(u.id, p.id));
route('GET', '/api/pulse', (req, res, p, u) => work.pulse(u.id));
route('POST', '/api/meetings/:id/minutes', async (req, res, p, u) => work.saveMinutes(u.id, p.id, await readJson(req)));
route('POST', '/api/meetings/:id/minutes/draft', (req, res, p, u) => ai.minutesDraft(u, p.id));
route('GET', '/api/admin/integrations', (req, res, p, u) => { extras.requireAdmin(u); return { gobsek_events: outbox.stats(), push_devices: db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, ai: ai.enabled() }; });
route('GET', '/api/acks/pending', (req, res, p, u) => chats.pendingAcks(u.id));

// --- Push-уведомления ---
route('GET', '/api/push/key', (req, res, p, u) => ({ key: push.vapid().publicKey, devices: push.count(u.id) }));
route('POST', '/api/push/subscribe', async (req, res, p, u) => push.subscribe(u.id, await readJson(req), req.headers['user-agent']));
route('POST', '/api/push/unsubscribe', async (req, res, p, u) => push.unsubscribe(u.id, (await readJson(req)).endpoint));
route('POST', '/api/push/test', async (req, res, p, u) => ({ sent: await push.notifyUser(u.id, { title: APP_NAME, body: '🔔 Push работает', tag: 'test', url: '/' }, { force: true }) }));

// --- Файлы ---
route('POST', '/api/files', (req, res, p, u) => files.upload(req, u), { raw: true });
route('GET', '/api/files/:id', (req, res, p, u, q) => { files.serve(req, res, u, p.id, q.get('download') === '1'); return undefined; });

// --- Звонки ---
route('GET', '/api/calls/ice', (req, res, p, u) => calls.iceServers(u.id));
route('GET', '/api/calls/history', (req, res, p, u) => calls.history(u.id));

// --- ИИ ---
route('POST', '/api/ai/summarize', async (req, res, p, u) => {
  ws.requireFeature('ai');
  const b = await readJson(req);
  return ai.summarize(u, b.chat_id, b.mode);
});
route('POST', '/api/ai/translate', async (req, res, p, u) => {
  ws.requireFeature('ai');
  const b = await readJson(req);
  return ai.translate(u, b.message_id, b.lang);
});
route('POST', '/api/ai/compose', async (req, res, p, u) => ws.requireFeature('ai') ?? ai.compose(u, await readJson(req)));
route('POST', '/api/ai/digest', (req, res, p, u) => ws.requireFeature('ai') ?? ai.digest(u));

// --- Администратор ---
route('GET', '/api/admin/users', (req, res, p, u) => { extras.requireAdmin(u); return extras.adminUsers(); });
route('POST', '/api/admin/users', async (req, res, p, u) => extras.createUser(u, await readJson(req)));
route('PATCH', '/api/admin/users/:id', async (req, res, p, u) => extras.updateUser(u, p.id, await readJson(req)));
route('POST', '/api/admin/users/:id/reset-password', (req, res, p, u) => extras.resetPassword(u, p.id));
route('GET', '/api/admin/invites', (req, res, p, u) => extras.listInvites(u));
route('POST', '/api/admin/invites', async (req, res, p, u) => extras.createInvite(u, await readJson(req)));
route('DELETE', '/api/admin/invites/:code', (req, res, p, u) => extras.deleteInvite(u, p.code));
route('GET', '/api/admin/stats', (req, res, p, u) => extras.stats(u));
route('GET', '/api/admin/audit', (req, res, p, u) => extras.auditLog(u));

// ---------- Статика ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // маршруты SPA
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(full);
    const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
    if (ext === '.html') { headers['Content-Security-Policy'] = CSP; headers['Cache-Control'] = 'no-cache'; } else headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  });
}

// ---------- HTTP ----------
function sameOrigin(req) {
  // Защита от CSRF для изменяющих запросов: Origin должен совпадать с хостом (cookie и так SameSite=Lax).
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;

  if (pathname === '/sso/gobsek' && req.method === 'GET') {
    try {
      const { token } = auth.ssoLogin(url.searchParams.get('token'), req);
      const next = url.searchParams.get('next');
      const to = next && /^\/[\w\-/?=&#%.]*$/.test(next) && !next.startsWith('//') ? next : '/';
      res.writeHead(302, { Location: to, 'Set-Cookie': auth.sessionCookie(token, auth.SESSION_DAYS * 86400) });
    } catch (e) {
      res.writeHead(302, { Location: `/?sso_error=${encodeURIComponent(e.code || 'sso_bad')}` });
    }
    res.end();
    return;
  }

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method && !(req.method === 'HEAD' && r.method === 'GET')) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req) && !pathname.startsWith('/api/hooks/')) {
        throw new HttpError(403, 'Запрос с чужого сайта');
      }
      const user = auth.userFromRequest(req);
      if (!r.public && !user) throw new HttpError(401, 'Нужно войти', 'auth');
      const out = await r.handler(req, res, params, user, url.searchParams);
      if (res.headersSent || out === undefined) return;
      if (Array.isArray(out) && out.length === 2 && typeof out[1] === 'object' && !Array.isArray(out[1]) && out[1] && Object.keys(out[1]).every((k) => /^[A-Z]/.test(k))) {
        sendJson(res, 200, out[0], out[1]);
      } else sendJson(res, 200, out);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, code: e.code });
      else {
        console.error(e);
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера', code: 'server' });
      }
    }
    return;
  }
  sendJson(res, 404, { error: 'Не найдено', code: 'not_found' });
}

// ---------- WebSocket ----------
const hub = new Hub();
rt.attach(hub);

function presence(uid, online) {
  const now = Date.now();
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, uid);
  const u = chats.userById(uid);
  if (u && chats.userSettings(u).hideLastSeen) return;
  hub.toAll({ type: 'presence', user_id: uid, online, last_seen: now });
}
hub.on('online', (uid) => presence(uid, true));
hub.on('offline', (uid) => presence(uid, false));
hub.on('conn_closed', (conn) => calls.onConnClosed(conn));

const typingCache = new Map();
function onWsMessage(conn, msg) {
  const uid = conn.user.id;
  switch (msg.type) {
    case 'typing': {
      const chatId = int(msg.chat_id);
      const key = `${uid}:${chatId}`;
      const now = Date.now();
      if ((typingCache.get(key) || 0) > now - 2500) return;
      typingCache.set(key, now);
      if (typingCache.size > 5000) typingCache.clear();
      if (!chats.membership(chatId, uid)) return;
      const action = ['typing', 'recording', 'uploading'].includes(msg.action) ? msg.action : 'typing';
      hub.toUsers(chats.memberIds(chatId).filter((x) => x !== uid), { type: 'typing', chat_id: chatId, user_id: uid, action });
      return;
    }
    case 'ping': conn.send({ type: 'pong', t: msg.t }); return;
    default:
      if (String(msg.type || '').startsWith('call:') || msg.type === 'rtc:signal') calls.handle(conn, msg);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  });
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  if (!sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const user = auth.userFromRequest(req);
  if (!user) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  const conn = acceptUpgrade(req, socket, user);
  if (!conn) return;
  hub.add(conn);
  conn.send({ type: 'hello', conn_id: conn.id, calls: calls.activeCallsFor(user.id), online: hub.onlineIds() });
  conn.on('message', (msg) => {
    try { onWsMessage(conn, msg); } catch (e) { console.error('ws', e); }
  });
});

extras.startScheduler();
work.start();
outbox.start();

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`${APP_NAME} ${pkg.version} — http://localhost:${PORT}`);
    console.log(`ИИ: ${ai.enabled() ? `включён (${ai.MODEL})` : 'выключен (нет ANTHROPIC_API_KEY)'} · Вход через Gobsek: ${process.env.GOBSEK_SSO_SECRET ? 'включён' : 'выключен'}`);
  });
}

module.exports = { server, hub };
