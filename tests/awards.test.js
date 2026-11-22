'use strict';
// Нагороди й налаштування компанії: досягнення, XP, рейтинг, вимкнення функцій адміном.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-aw-'));
const { db } = require('../server/db');
const chats = require('../server/chats');
const work = require('../server/work');
const ws = require('../server/workspace');
const awards = require('../server/awards');

const mk = (login, extra = {}) => {
  const r = db.prepare("INSERT INTO users (login, name, role, department, created_at) VALUES (?, ?, 'member', ?, ?)").run(login, login, extra.department || '', Date.now() - (extra.days || 0) * 86400e3);
  return Number(r.lastInsertRowid);
};

test('досягнення, XP і рейтинг', () => {
  const a = mk('aw_a', { department: 'Фінанси', days: 40 });
  const b = mk('aw_b', { department: 'Фінанси' });
  const chat = chats.createChat(a, { type: 'group', title: 'T', members: [b] });
  for (let i = 0; i < 3; i++) work.giveKudos(a, chat.id, { to: [b], badge: 'idea', text: 'дякую' });
  const fresh = awards.check(b);
  assert.ok(fresh.some((f) => f.code === 'beloved' && f.tier === 1));
  assert.ok(awards.check(a).some((f) => f.code === 'generous'));
  assert.ok(awards.check(a).length === 0, 'повторно не видається');
  const sb = awards.summary(b);
  assert.ok(sb.xp >= 50 + 30, `xp ${sb.xp}`);
  assert.ok(sb.level >= 2);
  const sa = awards.summary(a);
  assert.strictEqual(sa.achievements.find((x) => x.code === 'veteran').tier, 1);
  const board = awards.leaderboard(a, { period: 'month', dept: 'фінанси' });
  assert.deepStrictEqual(board.map((x) => x.user.id).sort(), [a, b].sort());
  assert.ok(board[0].xp >= board[1].xp);
  assert.ok(awards.feed(a).some((f) => f.type === 'kudos'));
});

test('налаштування компанії: функції й ліміт подяк', () => {
  const admin = { id: mk('aw_admin') };
  const a = mk('aw_c');
  const b = mk('aw_d');
  const chat = chats.createChat(a, { type: 'group', title: 'T2', members: [b] });
  ws.update(admin, { features: { tasks: false }, kudos_month_limit: 1, custom_badges: [{ emoji: '🚀', name: 'Ракета', points: 50 }] });
  assert.throws(() => work.createTask(a, { title: 'x', chat_id: chat.id }), (e) => e.code === 'feature_off');
  const code = ws.get().custom_badges[0].code;
  work.giveKudos(a, chat.id, { to: [b], badge: code, text: '' });
  assert.throws(() => work.giveKudos(a, chat.id, { to: [b], text: '' }), (e) => e.code === 'kudos_limit');
  assert.ok(awards.xpOf(b) >= 50);
  ws.update(admin, { features: { tasks: true }, kudos_month_limit: 0 });
  assert.ok(work.createTask(a, { title: 'x', chat_id: chat.id }));
  assert.throws(() => ws.update(admin, { work_hours: { from: '25:00' } }));
});

test('правила тиші для push', () => {
  const push = require('../server/push');
  const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  assert.ok(push.inRange('23:30', '22:00', '08:00'));
  assert.ok(push.inRange('07:59', '22:00', '08:00'));
  assert.ok(!push.inRange('12:00', '22:00', '08:00'));
  assert.ok(push.inRange('13:00', '12:00', '14:00'));
  const group = { type: 'group' };
  const dm = { type: 'direct' };
  const text = { kind: 'text' };
  assert.ok(push.suppressed({ groupNotify: 'mentions' }, group, text, {}));
  assert.ok(!push.suppressed({ groupNotify: 'mentions' }, dm, text, {}));
  assert.ok(push.suppressed({ notifyTasks: false }, dm, { kind: 'task' }, {}));
  assert.ok(push.suppressed({ notifyMeetings: false }, group, { kind: 'system' }, { event: 'meeting_soon' }));
  const q = { quietHours: { enabled: true, from: '22:00', to: '08:00' } };
  assert.ok(push.suppressed(q, dm, text, {}, at(23)));
  assert.ok(!push.suppressed(q, dm, text, {}, at(10)));
  assert.ok(!push.suppressed({}, group, text, {}));
});
