'use strict';
// Оргструктура: подразделения, руководители, чат подразделения, профиль.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-org-'));
process.env.DATA_DIR = DIR;
const { server } = require('../server/index');
let BASE;
before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); BASE = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); server.closeAllConnections?.(); fs.rmSync(DIR, { recursive: true, force: true }); });

async function req(cookie, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : cookie };
}

test('подразделения, руководители, чат отдела и профиль', async () => {
  const a = (await req(null, 'POST', '/api/setup', { login: 'boss', name: 'Шеф', password: 'secret123' })).cookie;
  const olena = (await req(a, 'POST', '/api/admin/users', { login: 'olena', name: 'Олена', department: 'Фінанси', password: 'olenapass1' })).data;
  const ivan = (await req(a, 'POST', '/api/admin/users', { login: 'ivan', name: 'Іван', department: 'Фінанси', password: 'ivanpass1' })).data;

  const d = await req(a, 'POST', '/api/admin/departments', { name: 'Фінанси', head_id: olena.id, cfo: 'ЦФО-07' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.ok(d.data.chat_id, 'создан чат подразделения');
  assert.deepEqual(d.data.members.sort(), [olena.id, ivan.id].sort());
  assert.equal((await req(a, 'POST', '/api/admin/departments', { name: 'фінанси' })).data.code, 'dept_exists');

  const iv = (await req(null, 'POST', '/api/login', { login: 'ivan', password: 'ivanpass1' })).cookie;
  const chatsList = (await req(iv, 'GET', '/api/chats')).data.chats;
  assert.ok(chatsList.some((c) => c.id === d.data.chat_id), 'Іван в чате отдела');
  const ol = (await req(null, 'POST', '/api/login', { login: 'olena', password: 'olenapass1' })).cookie;
  const det = (await req(ol, 'GET', `/api/chats/${d.data.chat_id}`)).data;
  assert.ok(['owner', 'admin'].includes(det.my_role), 'руководитель — админ чата отдела');

  // Руководитель по подразделению, затем явный
  let pr = (await req(iv, 'GET', '/api/me/profile')).data;
  assert.equal(pr.manager, olena.id);
  assert.equal(pr.department.cfo, 'ЦФО-07');
  assert.equal(pr.tasks.open, 0);
  const bossId = (await req(a, 'GET', '/api/me')).data.user.id;
  await req(a, 'PATCH', `/api/admin/users/${ivan.id}`, { manager_id: bossId });
  pr = (await req(iv, 'GET', '/api/me/profile')).data;
  assert.equal(pr.manager, bossId);
  assert.equal((await req(a, 'PATCH', `/api/admin/users/${ivan.id}`, { manager_id: ivan.id })).status, 400);
  const olp = (await req(ol, 'GET', '/api/me/profile')).data;
  assert.ok(!olp.reports.includes(ivan.id), 'у Івана теперь другой руководитель');

  // Новый сотрудник отдела сразу попадает в чат
  const maria = (await req(a, 'POST', '/api/admin/users', { login: 'maria', name: 'Марія', department: 'Фінанси', password: 'mariapass1' })).data;
  const org = (await req(iv, 'GET', '/api/org')).data;
  const fin = org.departments.find((x) => x.name === 'Фінанси');
  assert.ok(fin.members.includes(maria.id));
  const card = (await req(iv, 'GET', `/api/users/${olena.id}`)).data;
  assert.equal(card.org.department.name, 'Фінанси');
  assert.equal(card.org.tasks, undefined, 'чужая рабочая статистика не отдаётся');
  // Переименование подразделения переносит сотрудников
  await req(a, 'PATCH', `/api/admin/departments/${fin.id}`, { name: 'Фінансовий відділ' });
  assert.equal((await req(iv, 'GET', '/api/me')).data.user.department, 'Фінансовий відділ');
});
