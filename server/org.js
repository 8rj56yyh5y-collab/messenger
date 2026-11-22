'use strict';
// Оргструктура как в Gobsek: подразделения (руководитель, ЦФО, вышестоящее), руководитель сотрудника,
// автоматический чат подразделения и статистика профиля.
const crypto = require('node:crypto');
const { db, tx, logEvent, hasColumn } = require('./db');
const { HttpError, str, int, jsonParse } = require('./util');
const chats = require('./chats');
const rt = require('./realtime');

db.exec(`CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  head_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cfo TEXT NOT NULL DEFAULT '',            -- код ЦФО в Gobsek
  chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
  color INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);`);
if (!hasColumn('users', 'manager_id')) db.exec('ALTER TABLE users ADD COLUMN manager_id INTEGER');

// SQLite не сравнивает кириллицу без учёта регистра — сравниваем в JS.
const norm = (s) => String(s || '').trim().toLocaleLowerCase();
const deptByName = (name) => { const n = norm(name); return n ? db.prepare('SELECT * FROM departments').all().find((d) => norm(d.name) === n) : undefined; };
const usersOfDept = (name) => db.prepare('SELECT id, name, department, manager_id FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name').all().filter((u) => norm(u.department) === norm(name));

/** Сотрудника — в чат его подразделения (и в департамент по названию, если его ещё нет). */
function syncUser(uid) {
  const u = chats.userById(uid);
  if (!u || u.is_bot || !u.active || !u.department) return;
  const d = deptByName(u.department);
  if (!d || !d.chat_id) return;
  if (!db.prepare('SELECT id FROM chats WHERE id = ?').get(d.chat_id)) return;
  if (!chats.membership(d.chat_id, uid)) {
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").run(d.chat_id, uid, d.head_id === uid ? 'admin' : 'member', Date.now());
    try { chats.systemMessage(d.chat_id, uid, 'joined'); } catch { /* ignore */ }
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(d.chat_id);
    rt.toUser(uid, { type: 'chat:new', chat: chats.serializeChat(chat, uid) });
  }
}

function deptView(d, viewerId) {
  const members = usersOfDept(d.name).map((r) => r.id);
  return {
    id: d.id, name: d.name, parent_id: d.parent_id, head_id: d.head_id, cfo: d.cfo, chat_id: d.chat_id, color: d.color,
    members, in_chat: d.chat_id ? !!chats.membership(d.chat_id, viewerId) : false,
  };
}

function orgView(uid) {
  const deps = db.prepare('SELECT * FROM departments ORDER BY name').all().map((d) => deptView(d, uid));
  // Подразделения, которые есть у сотрудников, но не заведены отдельно, — тоже показываем
  const known = new Set(deps.map((d) => norm(d.name)));
  const extra = db.prepare("SELECT DISTINCT department FROM users WHERE active = 1 AND is_bot = 0 AND department <> ''").all()
    .map((r) => r.department).filter((n) => { const k = norm(n); if (known.has(k)) return false; known.add(k); return true; });
  for (const name of extra) deps.push({ id: null, name, parent_id: null, head_id: null, cfo: '', chat_id: null, members: deptView({ name }, uid).members, in_chat: false });
  const managers = Object.fromEntries(db.prepare('SELECT id, manager_id FROM users WHERE manager_id IS NOT NULL AND active = 1').all().map((r) => [r.id, r.manager_id]));
  return { departments: deps, managers };
}

function createDepartment(admin, b) {
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Укажите название', 'title_required');
  if (deptByName(name)) throw new HttpError(409, 'Такое подразделение уже есть', 'dept_exists');
  const id = Number(db.prepare('INSERT INTO departments (name, parent_id, head_id, cfo, color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, b.parent_id ? int(b.parent_id) : null, b.head_id ? int(b.head_id) : null, str(b.cfo, 30), crypto.randomInt(8), Date.now()).lastInsertRowid);
  if (b.create_chat !== false) createDeptChat(admin, id);
  logEvent(admin.id, 'dept_create', { id, name });
  for (const r of usersOfDept(name)) syncUser(r.id);
  return deptView(db.prepare('SELECT * FROM departments WHERE id = ?').get(id), admin.id);
}

function createDeptChat(admin, id) {
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!d || (d.chat_id && db.prepare('SELECT id FROM chats WHERE id = ?').get(d.chat_id))) return;
  const owner = d.head_id || admin.id;
  const chat = chats.createChat(owner, { type: 'group', title: `🏢 ${d.name}`, description: d.cfo ? `ЦФО ${d.cfo}` : '', members: [] });
  db.prepare('UPDATE departments SET chat_id = ? WHERE id = ?').run(chat.id, id);
  if (owner !== admin.id && !chats.membership(chat.id, admin.id) && norm(chats.userById(admin.id)?.department) === norm(d.name)) {
    db.prepare("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(chat.id, admin.id, Date.now());
  }
}

function updateDepartment(admin, id, b) {
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(int(id));
  if (!d) throw new HttpError(404, 'Не найдено');
  const sets = [];
  const vals = [];
  if ('name' in b) {
    const name = str(b.name, 100);
    if (!name) throw new HttpError(400, 'Укажите название', 'title_required');
    const other = deptByName(name);
    if (other && other.id !== d.id) throw new HttpError(409, 'Такое подразделение уже есть', 'dept_exists');
    sets.push('name = ?'); vals.push(name);
    for (const r of usersOfDept(d.name)) db.prepare('UPDATE users SET department = ? WHERE id = ?').run(name, r.id);
  }
  if ('parent_id' in b) {
    const pid = b.parent_id ? int(b.parent_id) : null;
    if (pid === d.id) throw new HttpError(400, 'Подразделение не может подчиняться само себе');
    sets.push('parent_id = ?'); vals.push(pid);
  }
  if ('head_id' in b) { sets.push('head_id = ?'); vals.push(b.head_id ? int(b.head_id) : null); }
  if ('cfo' in b) { sets.push('cfo = ?'); vals.push(str(b.cfo, 30)); }
  if (sets.length) db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...vals, d.id);
  if (b.create_chat) createDeptChat(admin, d.id);
  const fresh = db.prepare('SELECT * FROM departments WHERE id = ?').get(d.id);
  if (fresh.chat_id && fresh.head_id && chats.membership(fresh.chat_id, fresh.head_id)?.role === 'member') {
    db.prepare("UPDATE chat_members SET role = 'admin' WHERE chat_id = ? AND user_id = ?").run(fresh.chat_id, fresh.head_id);
  }
  for (const r of usersOfDept(fresh.name)) syncUser(r.id);
  logEvent(admin.id, 'dept_update', { id: d.id, fields: Object.keys(b) });
  return deptView(fresh, admin.id);
}

function deleteDepartment(admin, id) {
  db.prepare('UPDATE departments SET parent_id = NULL WHERE parent_id = ?').run(int(id));
  db.prepare('DELETE FROM departments WHERE id = ?').run(int(id));
  logEvent(admin.id, 'dept_delete', { id: int(id) });
  return { ok: true };
}

/** Руководитель сотрудника: назначенный явно, иначе руководитель его подразделения. */
function managerOf(uid) {
  const u = chats.userById(uid);
  if (!u) return null;
  if (u.manager_id && u.manager_id !== uid) return u.manager_id;
  const d = deptByName(u.department);
  if (d && d.head_id && d.head_id !== uid) return d.head_id;
  if (d && d.parent_id) {
    const p = db.prepare('SELECT head_id FROM departments WHERE id = ?').get(d.parent_id);
    if (p?.head_id && p.head_id !== uid) return p.head_id;
  }
  return null;
}
function reportsOf(uid) {
  const direct = db.prepare('SELECT id FROM users WHERE manager_id = ? AND active = 1 AND id <> ?').all(uid, uid).map((r) => r.id);
  const headed = db.prepare('SELECT name FROM departments WHERE head_id = ?').all(uid).map((r) => r.name);
  const inDept = headed.flatMap((n) => usersOfDept(n)).filter((r) => r.id !== uid && !r.manager_id).map((r) => r.id);
  return [...new Set([...direct, ...inDept])];
}

/** Профиль: оргданные и рабочая статистика (для своей страницы и карточки коллеги). */
function profile(uid, viewerId) {
  const u = chats.userById(uid);
  if (!u) throw new HttpError(404, 'Не найден');
  const since = Date.now() - 30 * 86400e3;
  const kudos = db.prepare("SELECT user_id, meta, body, created_at FROM messages WHERE kind = 'kudos' AND deleted = 0").all()
    .filter((m) => (jsonParse(m.meta, {}).to || []).includes(uid));
  const badges = {};
  for (const k of kudos) { const b = jsonParse(k.meta, {}).badge; badges[b] = (badges[b] || 0) + 1; }
  const d = deptByName(u.department);
  const out = {
    manager: managerOf(uid), reports: reportsOf(uid),
    department: d ? { id: d.id, name: d.name, cfo: d.cfo, chat_id: d.chat_id, head_id: d.head_id } : (u.department ? { name: u.department } : null),
    kudos: { total: kudos.length, month: kudos.filter((k) => k.created_at > since).length, badges,
      last: kudos.slice(-3).reverse().map((k) => ({ from: k.user_id, text: k.body, badge: jsonParse(k.meta, {}).badge, at: k.created_at })) },
    member_since: u.created_at,
  };
  if (uid === viewerId) {
    out.tasks = {
      open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status NOT IN ('done','cancelled')").get(uid).n,
      overdue: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status NOT IN ('done','cancelled') AND due_at < ?").get(uid, Date.now()).n,
      done_month: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done' AND done_at > ?").get(uid, since).n,
      created_open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE creator_id = ? AND assignee_id <> ? AND status NOT IN ('done','cancelled')").get(uid, uid).n,
    };
    out.meetings_week = db.prepare('SELECT COUNT(*) AS n FROM meetings m JOIN meeting_attendees a ON a.meeting_id = m.id AND a.user_id = ? WHERE m.starts_at BETWEEN ? AND ? AND m.cancelled = 0')
      .get(uid, Date.now(), Date.now() + 7 * 86400e3).n;
    out.messages_month = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND created_at > ? AND kind <> 'system'").get(uid, since).n;
    out.calls_month = db.prepare('SELECT COUNT(*) AS n FROM calls WHERE started_by = ? AND started_at > ?').get(uid, since).n;
  }
  return out;
}

module.exports = { syncUser, orgView, createDepartment, updateDepartment, deleteDepartment, managerOf, reportsOf, profile, deptByName };
