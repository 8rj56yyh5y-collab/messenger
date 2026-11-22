'use strict';
// Нагороди: досягнення з рівнями (бронза → срібло → золото), досвід (XP) і рівень співробітника,
// рейтинг за місяць / весь час (компанія або підрозділ) і стрічка визнання.
// Досягнення рахуються з реальної роботи в мессенджері: задачі, подяки, зустрічі, погодження, дзвінки.
const { db } = require('./db');
const { HttpError, int, jsonParse } = require('./util');
const chats = require('./chats');
const rt = require('./realtime');
const ws = require('./workspace');

db.exec(`CREATE TABLE IF NOT EXISTS user_awards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  tier INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code)
)`);

const TIER_XP = [0, 50, 150, 400];
const TASK_XP = 5;
// code, іконка, пороги для бронзи/срібла/золота, як рахувати
const ACH = [
  { code: 'doer', emoji: '✅', tiers: [5, 25, 100], q: "SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done'" },
  { code: 'organizer', emoji: '📋', tiers: [5, 30, 100], q: 'SELECT COUNT(*) AS n FROM tasks WHERE creator_id = ? AND (assignee_id IS NULL OR assignee_id <> creator_id)' },
  { code: 'beloved', emoji: '💖', tiers: [3, 15, 50], q: "SELECT COUNT(*) AS n FROM messages m, json_each(m.meta, '$.to') j WHERE m.kind = 'kudos' AND m.deleted = 0 AND j.value = ?" },
  { code: 'generous', emoji: '🎁', tiers: [3, 15, 50], q: "SELECT COUNT(*) AS n FROM messages WHERE kind = 'kudos' AND deleted = 0 AND user_id = ?" },
  { code: 'host', emoji: '📅', tiers: [3, 15, 50], q: 'SELECT COUNT(*) AS n FROM meetings WHERE created_by = ?' },
  { code: 'connected', emoji: '📞', tiers: [5, 25, 100], q: "SELECT COUNT(*) AS n FROM messages m, json_each(m.meta, '$.participants') j WHERE m.kind = 'call' AND j.value = ?" },
  { code: 'approver', emoji: '🖊️', tiers: [5, 25, 100], q: "SELECT COUNT(*) AS n FROM messages WHERE kind = 'approval' AND json_extract(meta, '$.decisions.\"' || ? || '\"') IS NOT NULL" },
  { code: 'voice', emoji: '💬', tiers: [50, 500, 2000], q: "SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND deleted = 0 AND kind NOT IN ('system', 'call')" },
  { code: 'empathy', emoji: '🤗', tiers: [20, 100, 500], q: 'SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?' },
  { code: 'citizen', emoji: '🗳️', tiers: [3, 15, 50], q: 'SELECT COUNT(DISTINCT message_id) AS n FROM poll_votes WHERE user_id = ?' },
  { code: 'veteran', emoji: '🏛️', tiers: [30, 180, 365], days: true },
];
const LEVEL_TITLES = ['newbie', 'member', 'active', 'pro', 'expert', 'master', 'legend'];

const stmts = new Map();
const prep = (q) => { if (!stmts.has(q)) stmts.set(q, db.prepare(q)); return stmts.get(q); };

function value(a, u) {
  if (a.days) return Math.floor((Date.now() - u.created_at) / 86400e3);
  return prep(a.q).get(u.id).n;
}
const tierOf = (a, v) => a.tiers.filter((x) => v >= x).length;

function badgePoints(code) {
  const w = ws.get();
  return w.custom_badges.find((b) => b.code === code)?.points || w.kudos_points;
}

// XP із подяк (з урахуванням балів значка), задач і досягнень; since — для рейтингу за період
function kudosXp(uid, since = 0) {
  const rows = prep("SELECT m.meta FROM messages m, json_each(m.meta, '$.to') j WHERE m.kind = 'kudos' AND m.deleted = 0 AND j.value = ? AND m.created_at >= ?").all(uid, since);
  return rows.reduce((s, r) => s + badgePoints(jsonParse(r.meta, {}).badge), 0);
}

function levelOf(xp) {
  const lvl = Math.floor(Math.sqrt(xp / 40)) + 1;
  const prev = 40 * (lvl - 1) ** 2;
  const next = 40 * lvl ** 2;
  return { level: lvl, title: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((lvl - 1) / 2))], xp, prev_xp: prev, next_xp: next };
}

// Перевіряє досягнення, фіксує нові рівні й повідомляє власника. Повертає щойно отримані.
function check(uid) {
  const u = chats.userById(uid);
  if (!u || u.is_bot || !ws.on('awards')) return [];
  const have = new Map(prep('SELECT code, tier FROM user_awards WHERE user_id = ?').all(uid).map((r) => [r.code, r.tier]));
  const fresh = [];
  for (const a of ACH) {
    const tier = tierOf(a, value(a, u));
    if (tier > (have.get(a.code) || 0)) {
      prep('INSERT INTO user_awards (user_id, code, tier, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, code) DO UPDATE SET tier = excluded.tier, at = excluded.at').run(uid, a.code, tier, Date.now());
      fresh.push({ code: a.code, emoji: a.emoji, tier });
    }
  }
  if (fresh.length) {
    const lv = levelOf(xpOf(uid));
    for (const f of fresh) rt.toUser(uid, { type: 'award', ...f, level: lv.level });
    rt.emit('work', { event: 'award.unlocked', data: { user: { id: uid, name: u.name, gobsek_id: u.gobsek_id || null }, awards: fresh, level: lv.level } });
  }
  return fresh;
}

// Відкладена перевірка: багато подій поспіль → одна перевірка
const pending = new Map();
function touch(uid) {
  if (!uid || pending.has(uid)) return;
  pending.set(uid, setTimeout(() => { pending.delete(uid); try { check(uid); } catch (e) { console.error('awards', e.message); } }, 1500).unref?.() || true);
}

function xpOf(uid, since = 0) {
  const ach = since
    ? prep('SELECT tier FROM user_awards WHERE user_id = ? AND at >= ?').all(uid, since)
    : prep('SELECT tier FROM user_awards WHERE user_id = ?').all(uid);
  const achXp = ach.reduce((s, r) => s + TIER_XP.slice(1, r.tier + 1).reduce((a, b) => a + b, 0), 0);
  const tasks = prep("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done' AND COALESCE(done_at, 0) >= ?").get(uid, since).n;
  return achXp + tasks * TASK_XP + kudosXp(uid, since);
}

function summary(uid) {
  const u = chats.userById(uid);
  if (!u) throw new HttpError(404, 'Користувача не знайдено');
  const have = new Map(prep('SELECT code, tier, at FROM user_awards WHERE user_id = ?').all(uid).map((r) => [r.code, r]));
  return {
    ...levelOf(xpOf(uid)),
    achievements: ACH.map((a) => {
      const v = value(a, u);
      const tier = have.get(a.code)?.tier || 0;
      return { code: a.code, emoji: a.emoji, tier, value: v, tiers: a.tiers, next: a.tiers[tier] ?? null, at: have.get(a.code)?.at || null };
    }),
  };
}

function myAwards(uid) {
  if (!ws.on('awards')) throw new HttpError(403, 'Нагороди вимкнено', 'feature_off');
  check(uid);
  const s = summary(uid);
  const mon = monthStart();
  const rows = prep("SELECT m.meta FROM messages m, json_each(m.meta, '$.to') j WHERE m.kind = 'kudos' AND m.deleted = 0 AND j.value = ?").all(uid);
  const badges = {};
  for (const r of rows) { const b = jsonParse(r.meta, {}).badge; badges[b] = (badges[b] || 0) + 1; }
  const board = leaderboard(uid, { period: 'month' });
  return { ...s, month_xp: xpOf(uid, mon), badges, rank: board.findIndex((x) => x.user.id === uid) + 1 || null, of: board.length };
}

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

function leaderboard(viewerId, { period = 'month', dept = '' } = {}) {
  const since = period === 'all' ? 0 : period === 'week' ? Date.now() - 7 * 86400e3 : monthStart();
  let users = db.prepare('SELECT * FROM users WHERE active = 1 AND is_bot = 0').all();
  if (dept) { const n = String(dept).trim().toLocaleLowerCase(); users = users.filter((u) => String(u.department || '').trim().toLocaleLowerCase() === n); }
  return users.map((u) => {
    const xp = xpOf(u.id, since);
    return { user: chats.publicUser(u, viewerId), xp, level: levelOf(xpOf(u.id)).level,
      kudos: prep("SELECT COUNT(*) AS n FROM messages m, json_each(m.meta, '$.to') j WHERE m.kind = 'kudos' AND m.deleted = 0 AND j.value = ? AND m.created_at >= ?").get(u.id, since).n,
      tasks: prep("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done' AND COALESCE(done_at, 0) >= ?").get(u.id, since).n };
  }).filter((x) => x.xp > 0 || x.user.id === viewerId).sort((a, b) => b.xp - a.xp || a.user.name.localeCompare(b.user.name)).slice(0, 50);
}

// Стрічка визнання: подяки (лише з чатів, де глядач — учасник, або публічні для всіх у компанії) і нові досягнення
function feed(viewerId, limit = 40) {
  const kudos = db.prepare(`SELECT m.* FROM messages m WHERE m.kind = 'kudos' AND m.deleted = 0
    AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = ?) ORDER BY m.id DESC LIMIT ?`).all(viewerId, int(limit))
    .map((m) => { const meta = jsonParse(m.meta, {}); return { type: 'kudos', at: m.created_at, from: m.user_id, to: meta.to || [], badge: meta.badge, text: m.body, chat_id: m.chat_id, message_id: m.id }; });
  const unlocks = db.prepare('SELECT a.* FROM user_awards a JOIN users u ON u.id = a.user_id WHERE u.active = 1 ORDER BY a.at DESC LIMIT ?').all(int(limit))
    .map((r) => ({ type: 'award', at: r.at, user_id: r.user_id, code: r.code, tier: r.tier, emoji: ACH.find((a) => a.code === r.code)?.emoji }));
  return [...kudos, ...unlocks].sort((a, b) => b.at - a.at).slice(0, limit);
}

// Слухаємо події мессенджера
rt.on('message', ({ row }) => {
  if (!row || !row.user_id) return;
  touch(row.user_id);
  if (row.kind === 'kudos') for (const id of jsonParse(row.meta, {}).to || []) touch(id);
  if (row.kind === 'call') for (const id of jsonParse(row.meta, {}).participants || []) touch(id);
});

module.exports = { ACH, check, touch, summary, myAwards, leaderboard, feed, levelOf, xpOf };
