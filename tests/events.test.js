'use strict';
// События в Gobsek: подпись HMAC, повтор при недоступности, протокол наради с поручениями.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ev-'));
process.env.DATA_DIR = DIR;
process.env.GOBSEK_EVENTS_SECRET = 'ev-secret';
let gobsek;
const got = [];
let failNext = 1;
let BASE;
let server;

before(async () => {
  gobsek = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (failNext > 0) { failNext -= 1; res.writeHead(503); res.end(); return; }
      got.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200); res.end('{}');
    });
  });
  await new Promise((r) => gobsek.listen(0, '127.0.0.1', r));
  process.env.GOBSEK_EVENTS_URL = `http://127.0.0.1:${gobsek.address().port}/api/v1/chat/events`;
  ({ server } = require('../server/index'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); gobsek.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

async function req(cookie, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : cookie };
}

test('события задач и протокола доходят в Gobsek с подписью и повтором', async () => {
  const a = (await req(null, 'POST', '/api/setup', { login: 'boss', name: 'Шеф', password: 'secret123' })).cookie;
  const ivan = (await req(a, 'POST', '/api/admin/users', { login: 'ivan', name: 'Іван Петренко', password: 'ivanpass1' })).data;
  const g = (await req(a, 'POST', '/api/chats', { type: 'group', title: 'Фінанси', members: [ivan.id] })).data;

  await req(a, 'POST', '/api/tasks', { chat_id: g.id, title: 'Звірити касу', assignee_id: ivan.id });
  const outbox = require('../server/outbox');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(got.length, 0, 'первая попытка — 503');
  require('../server/db').db.prepare('UPDATE outbox SET next_at = 0').run();
  await outbox.flush();
  assert.equal(got.length, 1, 'доставлено со второй попытки');
  const e = got[0];
  assert.equal(e.headers['x-gobsek-chat-event'], 'task.created');
  const expected = `sha256=${crypto.createHmac('sha256', 'ev-secret').update(e.body).digest('hex')}`;
  assert.equal(e.headers['x-gobsek-chat-signature'], expected);
  const body = JSON.parse(e.body);
  assert.equal(body.data.task.title, 'Звірити касу');
  assert.equal(body.data.task.assignee.login, 'ivan');

  // Протокол наради: решения + поручения → задачи и событие meeting.minutes
  const mt = (await req(a, 'POST', `/api/chats/${g.id}/meetings`, { title: 'Бюджет', starts_at: Date.now() + 60e3 })).data;
  const saved = await req(a, 'POST', `/api/meetings/${mt.id}/minutes`, {
    summary: 'Обговорили бюджет на грудень.', decisions: ['Ліміт ЦФО «Склад» — 200 тис.'],
    tasks: [{ title: 'Оновити платіжний календар', assignee_id: ivan.id, due_at: Date.now() + 86400e3 }],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.tasks.length, 1);
  assert.equal(saved.data.message.thread_id, mt.message_id, 'протокол — в ветке под встречей');
  assert.match(saved.data.message.body, /Ліміт ЦФО/);
  await new Promise((r) => setTimeout(r, 200));
  await outbox.flush();
  const kinds = got.map((x) => x.headers['x-gobsek-chat-event']);
  assert.ok(kinds.includes('meeting.created'));
  assert.ok(kinds.includes('meeting.minutes'));
  const minutes = JSON.parse(got.find((x) => x.headers['x-gobsek-chat-event'] === 'meeting.minutes').body);
  assert.equal(minutes.data.tasks[0].assignee.login, 'ivan');
  assert.equal((await req(a, 'POST', `/api/meetings/${mt.id}/minutes`, {})).data.code, 'empty');
  const st = (await req(a, 'GET', '/api/admin/integrations')).data;
  assert.equal(st.gobsek_events.enabled, true);
  assert.equal(st.gobsek_events.pending, 0);
});
