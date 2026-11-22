'use strict';
// Рабочие инструменты внутри мессенджера: задачи из сообщений, погодження, подяки (kudos),
// встречи с приглашениями, «Пульс компании» и автоответ в отпуске.
const { db, tx, logEvent } = require('./db');
const { HttpError, str, int, jsonParse } = require('./util');
const chats = require('./chats');
const rt = require('./realtime');

const STATUSES = ['todo', 'doing', 'review', 'done', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const BADGES = ['teamwork', 'idea', 'help', 'speed', 'quality', 'leader', 'client', 'mentor'];

function activeUser(id) {
  const u = chats.userById(int(id));
  if (!u || !u.active || u.is_bot) throw new HttpError(400, 'Сотрудник не найден');
  return u;
}

/** Чат для карточки: указанный, иначе личный с исполнителем. */
function targetChat(uid, chatId, otherId) {
  if (chatId) return chats.requireMember(chatId, uid).chat;
  if (otherId) return chats.getOrCreateDirect(uid, otherId);
  return chats.ensureSaved(uid);
}

/** Название чата с точки зрения пользователя: для личного — имя собеседника. */
function chatLabel(c, uid) {
  if (!c) return null;
  let title = c.title;
  if (c.type === 'direct') {
    const other = chats.userById(String(c.direct_key).split(':').map(Number).find((x) => x !== uid));
    title = other ? other.name : '';
  }
  return { id: c.id, type: c.type, title };
}

/** Сотрудник для внешних систем: Gobsek сопоставляет по gobsek_id или логину. */
function personRef(id) {
  const u = id ? chats.userById(id) : null;
  return u ? { id: u.id, login: u.login, name: u.name, gobsek_id: u.gobsek_id || null, department: u.department || '' } : null;
}
function emitWork(event, data) { rt.emit('work', { event, data }); }

function refreshCard(messageId) {
  const m = messageId && chats.messageRow(messageId);
  if (!m || m.deleted) return;
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(m.chat_id);
  if (chat) chats.broadcastMessage(chat, m, 'message:edit');
}

// ---------- Задачи ----------
function createTask(uid, b) {
  const title = str(b.title, 200);
  if (!title) throw new HttpError(400, 'Укажите название задачи', 'title_required');
  const assignee = b.assignee_id ? activeUser(b.assignee_id) : chats.userById(uid);
  const chat = targetChat(uid, b.chat_id, assignee.id !== uid ? assignee.id : null);
  if (chat.type !== 'saved' && !chats.membership(chat.id, assignee.id)) throw new HttpError(400, 'Исполнитель не состоит в этом чате', 'not_member');
  const due = b.due_at ? int(b.due_at) : null;
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  let source = b.source_msg_id ? chats.messageRow(b.source_msg_id) : null;
  if (source && (source.chat_id !== chat.id || !chats.membership(source.chat_id, uid))) source = null;
  const now = Date.now();
  const id = Number(db.prepare(`INSERT INTO tasks (chat_id, source_msg_id, title, description, assignee_id, creator_id, priority, due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chat.id, source?.id || null, title, str(b.description, 2000), assignee.id, uid, priority, due, now, now).lastInsertRowid);
  const card = chats.postMessage(uid, chat.id, { kind: 'task', body: title, meta: { task_id: id }, reply_to: source?.id });
  db.prepare('UPDATE tasks SET message_id = ? WHERE id = ?').run(card.id, id);
  refreshCard(card.id);
  logEvent(uid, 'task_create', { id, assignee: assignee.id });
  notifyTask(id, uid, 'created');
  return chats.taskView(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function canSeeTask(t, uid) {
  return t.creator_id === uid || t.assignee_id === uid || (t.chat_id && chats.membership(t.chat_id, uid));
}

function updateTask(uid, id, b) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(int(id));
  if (!t || !canSeeTask(t, uid)) throw new HttpError(404, 'Задача не найдена');
  const isCreator = t.creator_id === uid;
  const isAssignee = t.assignee_id === uid;
  const admin = t.chat_id && chats.isChatAdmin(chats.membership(t.chat_id, uid));
  if (!isCreator && !isAssignee && !admin) throw new HttpError(403, 'Менять задачу могут автор и исполнитель', 'forbidden');
  const sets = [];
  const vals = [];
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Неизвестный статус');
    sets.push('status = ?', 'done_at = ?'); vals.push(b.status, b.status === 'done' ? Date.now() : null);
  }
  if (isCreator || admin) {
    if ('title' in b) { const ti = str(b.title, 200); if (!ti) throw new HttpError(400, 'Укажите название', 'title_required'); sets.push('title = ?'); vals.push(ti); }
    if ('description' in b) { sets.push('description = ?'); vals.push(str(b.description, 2000)); }
    if ('priority' in b && PRIORITIES.includes(b.priority)) { sets.push('priority = ?'); vals.push(b.priority); }
    if ('due_at' in b) { sets.push('due_at = ?', 'reminded = 0'); vals.push(b.due_at ? int(b.due_at) : null); }
    if ('assignee_id' in b) {
      const a = activeUser(b.assignee_id);
      if (t.chat_id && !chats.membership(t.chat_id, a.id) && db.prepare('SELECT type FROM chats WHERE id = ?').get(t.chat_id)?.type !== 'saved') throw new HttpError(400, 'Исполнитель не состоит в чате', 'not_member');
      sets.push('assignee_id = ?'); vals.push(a.id);
    }
  }
  if (!sets.length) return chats.taskView(t);
  sets.push('updated_at = ?'); vals.push(Date.now());
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, t.id);
  refreshCard(t.message_id);
  notifyTask(t.id, uid, b.status ? `status:${b.status}` : 'updated');
  return chats.taskView(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
}

function notifyTask(id, actorId, what) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return;
  const ev = { type: 'task:update', task: chats.taskView(t), actor: actorId, what };
  rt.toUsers([t.creator_id, t.assignee_id].filter(Boolean), ev);
  rt.emit('task', { task: t, actorId, what });
  emitWork(what === 'created' ? 'task.created' : what.startsWith('status:') ? 'task.status' : 'task.updated', {
    task: { ...chats.taskView(t), assignee: personRef(t.assignee_id), creator: personRef(t.creator_id) }, actor: personRef(actorId),
  });
  // Push исполнителю о новой задаче и постановщику — о выполнении
  const push = require('./push');
  const actor = chats.userById(actorId)?.name || '';
  if (what === 'created' && t.assignee_id && t.assignee_id !== actorId) {
    push.notifyUser(t.assignee_id, { title: `✅ ${actor}`, body: t.title, tag: `task-${t.id}`, url: '/#/tasks' }).catch(() => {});
  }
  if (what === 'status:done' && t.creator_id !== actorId) {
    push.notifyUser(t.creator_id, { title: `🎉 ${actor}`, body: t.title, tag: `task-${t.id}`, url: '/#/tasks' }).catch(() => {});
  }
}

function listTasks(uid, scope = 'mine') {
  let rows;
  if (scope === 'created') rows = db.prepare('SELECT * FROM tasks WHERE creator_id = ? ORDER BY updated_at DESC LIMIT 500').all(uid);
  else if (scope === 'all') {
    rows = db.prepare(`SELECT t.* FROM tasks t WHERE t.creator_id = ? OR t.assignee_id = ?
      OR EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = t.chat_id AND cm.user_id = ?) ORDER BY t.updated_at DESC LIMIT 800`).all(uid, uid, uid);
  } else rows = db.prepare('SELECT * FROM tasks WHERE assignee_id = ? ORDER BY updated_at DESC LIMIT 500').all(uid);
  return rows.map((t) => {
    const v = chats.taskView(t);
    const c = t.chat_id ? db.prepare('SELECT id, type, title, direct_key FROM chats WHERE id = ?').get(t.chat_id) : null;
    if (c) v.chat = chatLabel(c, uid);
    return v;
  });
}

// ---------- Погодження ----------
function createApproval(uid, chatId, b) {
  const { chat } = chats.requireMember(chatId, uid);
  const title = str(b.title, 200);
  if (!title) throw new HttpError(400, 'Укажите предмет погодження', 'title_required');
  const approvers = [...new Set((Array.isArray(b.approvers) ? b.approvers : []).map(int))].filter((x) => x && x !== uid);
  if (!approvers.length) throw new HttpError(400, 'Выберите, кто погоджує', 'approvers_required');
  for (const a of approvers) if (!chats.membership(chat.id, a)) throw new HttpError(400, 'Согласующий не состоит в чате', 'not_member');
  const amount = b.amount === '' || b.amount == null ? null : Number(b.amount);
  if (amount != null && !Number.isFinite(amount)) throw new HttpError(400, 'Некорректная сумма');
  const meta = {
    title, amount, currency: str(b.currency, 6) || 'UAH', description: str(b.description, 2000), approvers,
    decisions: {}, status: 'pending', mode: b.mode === 'any' ? 'any' : 'all', due_at: b.due_at ? int(b.due_at) : null,
    cfo: str(b.cfo, 30),
  };
  const msg = chats.postMessage(uid, chat.id, { kind: 'approval', body: title, meta: { ...meta, mentions: approvers } });
  emitWork('approval.created', { message_id: msg.id, chat_id: chat.id, ...meta, author: personRef(uid), approvers: approvers.map(personRef) });
  return msg;
}

function decide(uid, msgId, b) {
  const m = chats.messageRow(msgId);
  if (!m || m.deleted || m.kind !== 'approval') throw new HttpError(404, 'Погодження не найдено');
  const { chat } = chats.requireMember(m.chat_id, uid);
  const meta = jsonParse(m.meta, {});
  if (!meta.approvers.includes(uid)) throw new HttpError(403, 'Вы не в списке согласующих', 'forbidden');
  if (meta.status !== 'pending') throw new HttpError(400, 'Погодження уже завершено', 'approval_closed');
  const decision = b.decision === 'reject' ? 'reject' : 'approve';
  const comment = str(b.comment, 500);
  if (decision === 'reject' && !comment) throw new HttpError(400, 'Укажите причину отказа', 'comment_required');
  meta.decisions[uid] = { decision, comment, at: Date.now() };
  const ds = Object.values(meta.decisions);
  if (ds.some((d) => d.decision === 'reject')) meta.status = 'rejected';
  else if (meta.mode === 'any' ? ds.length > 0 : meta.approvers.every((a) => meta.decisions[a]?.decision === 'approve')) meta.status = 'approved';
  db.prepare('UPDATE messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), m.id);
  chats.broadcastMessage(chat, chats.messageRow(m.id), 'message:edit');
  // Решение — ответом в ветке под заявкой, чтобы история была рядом
  chats.postMessage(uid, chat.id, { thread_id: m.id, body: comment || '', kind: 'text', system: true, meta: { decision } });
  if (meta.status !== 'pending') rt.toUser(m.user_id, { type: 'approval:done', message_id: m.id, chat_id: chat.id, status: meta.status, title: meta.title });
  logEvent(uid, 'approval_decide', { msg: m.id, decision });
  emitWork('approval.decided', { message_id: m.id, chat_id: chat.id, title: meta.title, amount: meta.amount, currency: meta.currency,
    decision, comment, status: meta.status, by: personRef(uid), author: personRef(m.user_id) });
  return chats.serializeMessage(chats.messageRow(m.id), uid);
}

function pendingApprovals(uid) {
  return db.prepare(`SELECT m.* FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
    WHERE m.kind = 'approval' AND m.deleted = 0 AND json_extract(m.meta, '$.status') = 'pending'
    AND EXISTS (SELECT 1 FROM json_each(m.meta, '$.approvers') WHERE value = ?)
    AND json_extract(m.meta, '$.decisions."' || ? || '"') IS NULL ORDER BY m.id DESC LIMIT 50`).all(uid, uid, uid)
    .map((m) => chats.serializeMessage(m, uid));
}

// ---------- Подяки ----------
function giveKudos(uid, chatId, b) {
  const { chat } = chats.requireMember(chatId, uid);
  const to = [...new Set((Array.isArray(b.to) ? b.to : [b.to]).map(int))].filter((x) => x && x !== uid);
  if (!to.length) throw new HttpError(400, 'Кому подяка?', 'kudos_to');
  to.forEach(activeUser);
  const badge = BADGES.includes(b.badge) ? b.badge : 'teamwork';
  const msg = chats.postMessage(uid, chat.id, { kind: 'kudos', body: str(b.text, 1000), meta: { to, badge, mentions: to } });
  emitWork('kudos.given', { from: personRef(uid), to: to.map(personRef), badge, text: msg.body });
  return msg;
}

function kudosBoard(uid) {
  const since = Date.now() - 30 * 86400e3;
  const rows = db.prepare("SELECT user_id, meta FROM messages WHERE kind = 'kudos' AND deleted = 0 AND created_at > ?").all(since);
  const got = new Map();
  const gave = new Map();
  for (const r of rows) {
    const meta = jsonParse(r.meta, {});
    gave.set(r.user_id, (gave.get(r.user_id) || 0) + 1);
    for (const id of meta.to || []) {
      const g = got.get(id) || { count: 0, badges: {} };
      g.count += 1;
      g.badges[meta.badge] = (g.badges[meta.badge] || 0) + 1;
      got.set(id, g);
    }
  }
  const top = [...got].sort((a, b) => b[1].count - a[1].count).slice(0, 10)
    .map(([id, g]) => ({ user: chats.publicUser(chats.userById(id), uid), count: g.count, badges: g.badges }));
  return { top, mine: got.get(uid) || { count: 0, badges: {} }, gave: gave.get(uid) || 0, total: rows.length };
}

// ---------- Встречи ----------
function createMeeting(uid, chatId, b) {
  const { chat } = chats.requireMember(chatId, uid);
  const title = str(b.title, 200);
  if (!title) throw new HttpError(400, 'Укажите тему встречи', 'title_required');
  const startsAt = int(b.starts_at);
  if (!startsAt || startsAt < Date.now() - 5 * 60e3) throw new HttpError(400, 'Время должно быть в будущем', 'time_past');
  const duration = Math.min(Math.max(int(b.duration_min) || 30, 5), 480);
  let attendees = Array.isArray(b.attendees) && b.attendees.length ? b.attendees.map(int) : chats.memberIds(chat.id);
  attendees = [...new Set([uid, ...attendees])].filter((id) => chats.membership(chat.id, id) && !chats.userById(id)?.is_bot);
  const id = tx(() => {
    const r = db.prepare('INSERT INTO meetings (chat_id, title, description, starts_at, duration_min, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(chat.id, title, str(b.description, 2000), startsAt, duration, uid, Date.now());
    const mid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO meeting_attendees (meeting_id, user_id, rsvp) VALUES (?, ?, ?)');
    for (const a of attendees) ins.run(mid, a, a === uid ? 'yes' : 'pending');
    return mid;
  });
  const card = chats.postMessage(uid, chat.id, { kind: 'meeting', body: title, meta: { meeting_id: id, mentions: attendees.filter((a) => a !== uid) } });
  db.prepare('UPDATE meetings SET message_id = ? WHERE id = ?').run(card.id, id);
  refreshCard(card.id);
  emitWork('meeting.created', { id, chat_id: chat.id, title, starts_at: startsAt, duration_min: duration, organizer: personRef(uid), attendees: attendees.map(personRef) });
  return chats.meetingView(db.prepare('SELECT * FROM meetings WHERE id = ?').get(id), uid);
}

function rsvp(uid, id, answer) {
  const mt = db.prepare('SELECT * FROM meetings WHERE id = ?').get(int(id));
  if (!mt || !chats.membership(mt.chat_id, uid)) throw new HttpError(404, 'Встреча не найдена');
  const a = ['yes', 'no', 'maybe'].includes(answer) ? answer : 'yes';
  db.prepare('INSERT INTO meeting_attendees (meeting_id, user_id, rsvp) VALUES (?, ?, ?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET rsvp = excluded.rsvp').run(mt.id, uid, a);
  refreshCard(mt.message_id);
  return chats.meetingView(mt, uid);
}

function cancelMeeting(uid, id) {
  const mt = db.prepare('SELECT * FROM meetings WHERE id = ?').get(int(id));
  if (!mt) throw new HttpError(404, 'Встреча не найдена');
  const admin = chats.isChatAdmin(chats.membership(mt.chat_id, uid));
  if (mt.created_by !== uid && !admin) throw new HttpError(403, 'Отменить может организатор', 'forbidden');
  db.prepare('UPDATE meetings SET cancelled = 1 WHERE id = ?').run(mt.id);
  refreshCard(mt.message_id);
  return { ok: true };
}

function listMeetings(uid, from, to) {
  const a = int(from) || Date.now() - 86400e3;
  const b = int(to) || Date.now() + 30 * 86400e3;
  return db.prepare(`SELECT m.* FROM meetings m JOIN meeting_attendees a ON a.meeting_id = m.id AND a.user_id = ?
    WHERE m.starts_at BETWEEN ? AND ? ORDER BY m.starts_at LIMIT 300`).all(uid, a, b).map((mt) => {
    const v = chats.meetingView(mt, uid);
    const c = db.prepare('SELECT * FROM chats WHERE id = ?').get(mt.chat_id);
    if (c) v.chat = chatLabel(c, uid);
    return v;
  });
}

// ---------- Протокол наради ----------
function meetingContext(uid, id) {
  const mt = db.prepare('SELECT * FROM meetings WHERE id = ?').get(int(id));
  if (!mt || !chats.membership(mt.chat_id, uid)) throw new HttpError(404, 'Встреча не найдена');
  return mt;
}

/** Сохранить протокол: сообщение в ветке под карточкой встречи + задачи по поручениям. */
function saveMinutes(uid, id, b) {
  const mt = meetingContext(uid, id);
  const summary = str(b.summary, 4000);
  const decisions = (Array.isArray(b.decisions) ? b.decisions : []).map((x) => str(x, 500)).filter(Boolean).slice(0, 30);
  const items = (Array.isArray(b.tasks) ? b.tasks : []).filter((x) => str(x.title, 200)).slice(0, 30);
  if (!summary && !decisions.length && !items.length) throw new HttpError(400, 'Протокол пустой', 'empty');
  const created = [];
  for (const it of items) {
    try {
      created.push(createTask(uid, { chat_id: mt.chat_id, title: it.title, assignee_id: it.assignee_id || uid, due_at: it.due_at || null, priority: it.priority || 'normal', description: `${mt.title}` }));
    } catch { /* исполнитель мог покинуть чат — пропускаем */ }
  }
  const lines = [`📝 **Протокол: ${mt.title}**`];
  if (summary) lines.push('', summary);
  if (decisions.length) lines.push('', '**Рішення / Решения:**', ...decisions.map((d) => `- ${d}`));
  if (created.length) lines.push('', '**Доручення / Поручения:**', ...created.map((t) => `- ${t.title} — @${chats.userById(t.assignee_id)?.login}`));
  const thread = mt.message_id && chats.messageRow(mt.message_id) && !chats.messageRow(mt.message_id).deleted ? mt.message_id : null;
  const msg = chats.postMessage(uid, mt.chat_id, { body: lines.join('\n'), thread_id: thread, meta: { minutes: { meeting_id: mt.id, decisions, tasks: created.map((t) => t.id) } } });
  emitWork('meeting.minutes', { meeting_id: mt.id, chat_id: mt.chat_id, title: mt.title, starts_at: mt.starts_at, summary, decisions,
    tasks: created.map((t) => ({ ...t, assignee: personRef(t.assignee_id) })), author: personRef(uid) });
  return { message: msg, tasks: created };
}

// ---------- Пульс компании ----------
function pulse(uid) {
  const now = Date.now();
  const d = new Date();
  const mmdd = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const week = [];
  for (let i = 0; i < 7; i++) { const x = new Date(d); x.setDate(d.getDate() + i); week.push(mmdd(x)); }
  const people = db.prepare('SELECT * FROM users WHERE active = 1 AND is_bot = 0').all();
  const birthdays = people.filter((u) => u.birthday && week.includes(u.birthday.slice(-5)))
    .map((u) => ({ user: chats.publicUser(u, uid), in_days: week.indexOf(u.birthday.slice(-5)) }))
    .sort((a, b) => a.in_days - b.in_days);
  const newcomers = people.filter((u) => u.created_at > now - 14 * 86400e3 && u.id !== uid)
    .sort((a, b) => b.created_at - a.created_at).slice(0, 8).map((u) => chats.publicUser(u, uid));
  const myTasks = listTasks(uid, 'mine').filter((t) => !['done', 'cancelled'].includes(t.status))
    .sort((a, b) => (a.due_at || Infinity) - (b.due_at || Infinity)).slice(0, 8);
  const meetings = listMeetings(uid, now - 60 * 60e3, now + 7 * 86400e3).filter((m) => !m.cancelled).slice(0, 8);
  const online = people.filter((u) => rt.isOnline(u.id) && u.id !== uid).slice(0, 24).map((u) => chats.publicUser(u, uid));
  return {
    birthdays, newcomers, tasks: myTasks, meetings, online,
    acks: chats.pendingAcks(uid).slice(0, 10), approvals: pendingApprovals(uid).slice(0, 10), kudos: kudosBoard(uid),
    counts: {
      people: people.length,
      tasks_open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status NOT IN ('done','cancelled')").get(uid).n,
      tasks_overdue: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status NOT IN ('done','cancelled') AND due_at < ?").get(uid, now).n,
    },
  };
}

// ---------- Фоновые напоминания ----------
function tick() {
  const now = Date.now();
  // Срок задачи через час (или уже прошёл) — напоминание исполнителю
  for (const t of db.prepare("SELECT * FROM tasks WHERE reminded = 0 AND due_at IS NOT NULL AND due_at <= ? AND status NOT IN ('done','cancelled')").all(now + 3600e3)) {
    db.prepare('UPDATE tasks SET reminded = 1 WHERE id = ?').run(t.id);
    if (!t.assignee_id) continue;
    try {
      const saved = chats.ensureSaved(t.assignee_id);
      chats.postMessage(null, saved.id, { kind: 'system', system: true, meta: { event: 'task_due', task_id: t.id, title: t.title, due_at: t.due_at, chat_id: t.chat_id, message_id: t.message_id } });
    } catch { /* ignore */ }
  }
  // Встреча через 10 минут — напоминание в чате встречи
  for (const mt of db.prepare('SELECT * FROM meetings WHERE reminded = 0 AND cancelled = 0 AND starts_at <= ?').all(now + 10 * 60e3)) {
    db.prepare('UPDATE meetings SET reminded = 1 WHERE id = ?').run(mt.id);
    if (mt.starts_at < now - 30 * 60e3) continue;
    try {
      chats.postMessage(null, mt.chat_id, { kind: 'system', system: true, meta: { event: 'meeting_soon', meeting_id: mt.id, title: mt.title, starts_at: mt.starts_at, message_id: mt.message_id } });
      const ids = db.prepare("SELECT user_id FROM meeting_attendees WHERE meeting_id = ? AND rsvp <> 'no'").all(mt.id).map((r) => r.user_id);
      rt.toUsers(ids, { type: 'meeting:soon', meeting: chats.meetingView(mt, 0) });
    } catch { /* чат удалён */ }
  }
}
let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 20e3);
  timer.unref();
}

// ---------- Автоответ ----------
const autoSent = new Map();
rt.on('message', ({ chat, row, type }) => {
  if (type !== 'message:new' || chat.type !== 'direct' || !row.user_id || row.kind === 'system' || row.thread_id) return;
  if (jsonParse(row.meta, {}).auto) return;
  const otherId = chat.direct_key.split(':').map(Number).find((x) => x !== row.user_id);
  const other = chats.userById(otherId);
  if (!other || other.is_bot) return;
  const ar = chats.userSettings(other).autoReply;
  if (!ar || !ar.enabled || !ar.text || !['vacation', 'away', 'dnd', 'busy'].includes(other.status)) return;
  const key = `${chat.id}:${row.user_id}`;
  if ((autoSent.get(key) || 0) > Date.now() - 6 * 3600e3) return;
  autoSent.set(key, Date.now());
  setTimeout(() => {
    try { chats.postMessage(other.id, chat.id, { body: str(ar.text, 1000), meta: { auto: true } }); } catch { /* ignore */ }
  }, 400);
});

module.exports = {
  BADGES, createTask, updateTask, listTasks, createApproval, decide, pendingApprovals, giveKudos, kudosBoard,
  createMeeting, rsvp, cancelMeeting, listMeetings, pulse, tick, start, saveMinutes, meetingContext, personRef,
};
