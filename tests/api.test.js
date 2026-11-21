'use strict';
// Сквозные тесты API: настоящий HTTP-сервер на случайном порту и временная база.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-test-'));
process.env.DATA_DIR = DIR;
process.env.GOBSEK_SSO_SECRET = 'test-sso-secret';
delete process.env.ANTHROPIC_API_KEY;

const { server } = require('../server/index');
let BASE;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const opts = { method, headers: { ...headers }, redirect: 'manual' };
    if (this.cookie) opts.headers.cookie = this.cookie;
    if (body !== undefined && !(body instanceof Buffer)) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body) opts.body = body;
    const res = await fetch(BASE + url, opts);
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  patch(u, b = {}) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u); }
}

async function loginAs(login, password) {
  const c = new Client();
  const r = await c.post('/api/login', { login, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

const admin = new Client();
let ivan;
let olena;
let ivanId;
let olenaId;

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  server.closeAllConnections?.();
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('первый запуск: администратор, канал и общий чат', async () => {
  const meta = await admin.get('/api/meta');
  assert.equal(meta.data.needs_setup, true);
  const weak = await admin.post('/api/setup', { login: 'boss', name: 'Шеф', password: '123' });
  assert.equal(weak.data.code, 'pw_short');
  const r = await admin.post('/api/setup', { login: 'boss', name: 'Шеф', password: 'secret123', lang: 'uk' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  const again = await new Client().post('/api/setup', { login: 'x2', name: 'X', password: 'secret123' });
  assert.equal(again.status, 409);
  const chats = await admin.get('/api/chats');
  const types = chats.data.chats.map((c) => c.type).sort();
  assert.deepEqual(types, ['channel', 'group', 'saved']);
  assert.ok(chats.data.chats.some((c) => c.title.includes('Новини')));
});

test('администратор заводит сотрудников; вход и ошибки входа', async () => {
  const r1 = await admin.post('/api/admin/users', { login: 'ivan', name: 'Іван Петренко', department: 'Бухгалтерія', password: 'ivanpass1' });
  assert.equal(r1.status, 200);
  ivanId = r1.data.id;
  const r2 = await admin.post('/api/admin/users', { login: 'olena', name: 'Олена', password: 'olenapass1' });
  olenaId = r2.data.id;
  const dup = await admin.post('/api/admin/users', { login: 'ivan', name: 'Дубль' });
  assert.equal(dup.data.code, 'login_taken');
  const auto = await admin.post('/api/admin/users', { login: 'temp.user', name: 'Временный' });
  assert.match(auto.data.password, /^[A-Za-z2-9]{10}$/);

  const bad = await new Client().post('/api/login', { login: 'ivan', password: 'wrong' });
  assert.equal(bad.status, 401);
  ivan = await loginAs('ivan', 'ivanpass1');
  olena = await loginAs('olena', 'olenapass1');
  const me = await ivan.get('/api/me');
  assert.equal(me.data.user.must_change_pw, true);
  // Новый сотрудник сразу в общем канале и чате
  const list = await ivan.get('/api/chats');
  assert.ok(list.data.chats.some((c) => c.type === 'channel'));
  // Обычный сотрудник не видит админку
  assert.equal((await ivan.get('/api/admin/users')).status, 403);
});

test('ограничение попыток входа', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.post('/api/login', { login: 'temp.user', password: 'nope' });
  const r = await c.post('/api/login', { login: 'temp.user', password: 'nope' });
  assert.equal(r.status, 429);
});

let directId;
test('личный чат: сообщение, непрочитанные, прочтение', async () => {
  const d = await ivan.post('/api/chats/direct', { user_id: olenaId });
  assert.equal(d.status, 200);
  directId = d.data.id;
  const again = await olena.post('/api/chats/direct', { user_id: ivanId });
  assert.equal(again.data.id, directId, 'тот же чат для обоих');
  const m = await ivan.post(`/api/chats/${directId}/messages`, { body: 'Привіт, **Олено**! Звіт по ЦФО готовий' });
  assert.equal(m.status, 200);
  const empty = await ivan.post(`/api/chats/${directId}/messages`, { body: '   ' });
  assert.equal(empty.data.code, 'empty');
  let list = await olena.get('/api/chats');
  const c = list.data.chats.find((x) => x.id === directId);
  assert.equal(c.unread, 1);
  assert.equal(c.peer.id, ivanId);
  await olena.post(`/api/chats/${directId}/read`, {});
  list = await olena.get('/api/chats');
  assert.equal(list.data.chats.find((x) => x.id === directId).unread, 0);
  const iv = (await ivan.get('/api/chats')).data.chats.find((x) => x.id === directId);
  assert.ok(iv.others_read_id >= m.data.id, 'у отправителя — «прочитано»');
});

test('чужой чат недоступен; файлы — только участникам', async () => {
  await admin.post('/api/admin/users', { login: 'outsider', name: 'Сторонній', password: 'outside123' });
  const outsider = await loginAs('outsider', 'outside123');
  const r = await outsider.get(`/api/chats/${directId}/messages`);
  assert.equal(r.status, 404);
  const send = await outsider.post(`/api/chats/${directId}/messages`, { body: 'hi' });
  assert.equal(send.status, 404);

  const up = await ivan.req('POST', '/api/files', Buffer.from('%PDF-1.4 test'), { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('Звіт.pdf') });
  assert.equal(up.status, 200);
  assert.equal(up.data.name, 'Звіт.pdf');
  // До отправки файл видит только загрузивший
  assert.equal((await olena.get(`/api/files/${up.data.id}`)).status, 404);
  await ivan.post(`/api/chats/${directId}/messages`, { kind: 'file', file_id: up.data.id });
  const got = await olena.get(`/api/files/${up.data.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await outsider.get(`/api/files/${up.data.id}`)).status, 404);
  // HTML никогда не отдаётся «как есть»
  const html = await ivan.req('POST', '/api/files', Buffer.from('<script>alert(1)</script>'), { 'content-type': 'text/html', 'x-file-name': 'x.html' });
  const served = await ivan.get(`/api/files/${html.data.id}`);
  assert.equal(served.headers.get('content-type'), 'application/octet-stream');
  assert.match(served.headers.get('content-disposition'), /^attachment/);
});

test('сброс пароля администратором', async () => {
  const users = await admin.get('/api/admin/users');
  const t = users.data.find((u) => u.login === 'temp.user');
  const r = await admin.post(`/api/admin/users/${t.id}/reset-password`);
  assert.match(r.data.password, /^[A-Za-z2-9]{10}$/);
  require('../server/db').db.prepare('DELETE FROM login_fails').run();
  const c = await loginAs('temp.user', r.data.password);
  assert.equal((await c.get('/api/me')).data.user.must_change_pw, true);
});

test('правка, удаление, реакции, ответ', async () => {
  const m = (await olena.post(`/api/chats/${directId}/messages`, { body: 'Дякую!' })).data;
  const ed = await olena.patch(`/api/messages/${m.id}`, { body: 'Дякую, Іване!' });
  assert.equal(ed.data.body, 'Дякую, Іване!');
  assert.ok(ed.data.edited_at);
  assert.equal((await ivan.patch(`/api/messages/${m.id}`, { body: 'взлом' })).status, 403);
  assert.equal((await ivan.del(`/api/messages/${m.id}`)).status, 403);
  const r1 = await ivan.post(`/api/messages/${m.id}/react`, { emoji: '👍' });
  assert.deepEqual(r1.data.reactions.map((x) => [x.emoji, x.users]), [['👍', [ivanId]]]);
  const r2 = await ivan.post(`/api/messages/${m.id}/react`, { emoji: '👍' });
  assert.equal(r2.data.reactions, undefined, 'повторная реакция снимается');
  const rep = await ivan.post(`/api/chats/${directId}/messages`, { body: 'Будь ласка', reply_to: m.id });
  assert.equal(rep.data.reply.id, m.id);
  assert.equal((await olena.del(`/api/messages/${m.id}`)).status, 200);
  const list = await ivan.get(`/api/chats/${directId}/messages`);
  assert.ok(!list.data.some((x) => x.id === m.id));
});

let groupId;
test('группа: участники, упоминания, опрос, роли, канал только для админов', async () => {
  const g = await ivan.post('/api/chats', { type: 'group', title: 'Бухгалтерія', members: [olenaId] });
  assert.equal(g.status, 200);
  groupId = g.data.id;
  assert.equal(g.data.my_role, 'owner');
  const men = await ivan.post(`/api/chats/${groupId}/messages`, { body: '@olena перевір виписку' });
  assert.deepEqual(men.data.meta.mentions, [olenaId]);
  const oc = (await olena.get('/api/chats')).data.chats.find((x) => x.id === groupId);
  assert.equal(oc.mentions, 1);

  const poll = await olena.post(`/api/chats/${groupId}/polls`, { question: 'Коли нарада?', options: ['Пн', 'Вт', ''], anonymous: false });
  assert.deepEqual(poll.data.meta.options, ['Пн', 'Вт']);
  const v = await ivan.post(`/api/messages/${poll.data.id}/vote`, { options: [1] });
  assert.deepEqual(v.data.poll.counts, [0, 1]);
  assert.deepEqual(v.data.poll.voters[1], [ivanId]);
  assert.equal((await olena.post(`/api/messages/${poll.data.id}/close-poll`)).status, 200);
  assert.equal((await ivan.post(`/api/messages/${poll.data.id}/vote`, { options: [0] })).data.code, 'poll_closed');

  // Олена не админ — не может переименовать
  assert.equal((await olena.patch(`/api/chats/${groupId}`, { title: 'X' })).status, 403);
  await ivan.patch(`/api/chats/${groupId}/members/${olenaId}`, { role: 'admin' });
  assert.equal((await olena.patch(`/api/chats/${groupId}`, { title: 'Бухгалтерія ТОВ' })).status, 200);

  // Аватар чата — только своя картинка (чужой файл не «опубликовать» через аватар)
  const secret = await ivan.req('POST', '/api/files', Buffer.from('secret'), { 'content-type': 'image/png', 'x-file-name': 's.png' });
  assert.equal((await olena.patch(`/api/chats/${groupId}`, { avatar_file: secret.data.id })).status, 400);

  // Канал: участник не пишет
  const news = (await ivan.get('/api/chats')).data.chats.find((x) => x.type === 'channel');
  const w = await ivan.post(`/api/chats/${news.id}/messages`, { body: 'Можна?' });
  assert.equal(w.data.code, 'readonly');
  assert.equal((await admin.post(`/api/chats/${news.id}/messages`, { body: 'Оголошення' })).status, 200);
});

test('поиск по сообщениям учитывает доступ', async () => {
  const r = await olena.get(`/api/search?q=${encodeURIComponent('звіт ЦФО')}`);
  assert.ok(r.data.messages.some((m) => m.chat_id === directId));
  const people = await olena.get(`/api/search?q=${encodeURIComponent('бухгалт')}`);
  assert.ok(people.data.users.some((u) => u.id === ivanId));
  const a = await admin.get(`/api/search?q=${encodeURIComponent('звіт')}`);
  assert.ok(!a.data.messages.some((m) => m.chat_id === directId), 'чужая переписка не находится');
});

test('пересылка, закреп, напоминание, отложенное сообщение', async () => {
  const src = (await ivan.post(`/api/chats/${groupId}/messages`, { body: 'Важливо: оплатити до пʼятниці' })).data;
  const fw = await ivan.post('/api/messages/forward', { ids: [src.id], chat_id: directId });
  assert.equal(fw.data[0].fwd.user_id, ivanId);
  assert.equal((await ivan.post(`/api/chats/${groupId}/pin`, { message_id: src.id })).status, 200);
  const det = await olena.get(`/api/chats/${groupId}`);
  assert.equal(det.data.pinned_msg_id, src.id);
  const past = await ivan.post(`/api/messages/${src.id}/remind`, { at: Date.now() - 1000 });
  assert.equal(past.data.code, 'time_past');
  const sc = await ivan.post(`/api/chats/${groupId}/schedule`, { body: 'Нагадую про оплату', at: Date.now() + 60_000 });
  assert.equal(sc.status, 200);
  const rem = await ivan.post(`/api/messages/${src.id}/remind`, { at: Date.now() + 60_000 });
  assert.equal(rem.status, 200);
  // Подкручиваем время и запускаем планировщик
  const { db } = require('../server/db');
  db.prepare('UPDATE scheduled SET run_at = 0').run();
  require('../server/extras').runScheduled();
  const msgs = (await olena.get(`/api/chats/${groupId}/messages`)).data;
  assert.ok(msgs.some((m) => m.body === 'Нагадую про оплату' && m.meta.scheduled));
  const saved = (await ivan.get('/api/chats')).data.chats.find((c) => c.type === 'saved');
  assert.ok(saved.unread >= 1, 'напоминание пришло в «Избранное»');
});

test('входящий вебхук пишет в группу от имени бота', async () => {
  const w = await ivan.post(`/api/chats/${groupId}/webhooks`, { name: 'Gobsek' });
  assert.equal(w.status, 200);
  const token = w.data.token;
  const r = await new Client().post(`/api/hooks/${token}`, { title: 'Задача №42', text: 'Погодити рахунок', url: 'https://gobsek.example/tasks/42' });
  assert.equal(r.status, 200);
  assert.match(r.data.body, /\*\*Задача №42\*\*/);
  assert.equal((await new Client().post('/api/hooks/wrong', { text: 'x' })).status, 404);
  assert.equal((await olena.post(`/api/chats/${groupId}/webhooks`, { name: 'x' })).status, 200, 'админ группы может');
});

function jwt(payload, secret = 'test-sso-secret') {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

test('вход через Gobsek (SSO)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = { user_id: 77, username: 'm.koval', name: 'Марко Коваль', position: 'Логіст', department: 'Логістика', aud: 'gobsek-chat', exp: now + 120 };
  const c = new Client();
  const r = await c.get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a1' })}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const me = await c.get('/api/me');
  assert.equal(me.data.user.name, 'Марко Коваль');
  assert.equal(me.data.user.department, 'Логістика');
  assert.equal(me.data.user.gobsek, true);
  // Повтор той же ссылки
  const replay = await new Client().get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a1' })}`);
  assert.match(replay.headers.get('location'), /sso_used/);
  // Чужая подпись, чужая аудитория, просроченный
  assert.match((await new Client().get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a2' }, 'evil')}`)).headers.get('location'), /sso_bad/);
  assert.match((await new Client().get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a3', aud: 'other' })}`)).headers.get('location'), /sso_bad/);
  assert.match((await new Client().get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a4', exp: now - 5 })}`)).headers.get('location'), /sso_expired/);
  // Повторный вход тем же сотрудником не плодит учётные записи и обновляет должность
  const c2 = new Client();
  await c2.get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a5', position: 'Старший логіст' })}`);
  const me2 = await c2.get('/api/me');
  assert.equal(me2.data.user.id, me.data.user.id);
  assert.equal(me2.data.user.position, 'Старший логіст');
  // Открытый редирект запрещён
  const evil = await new Client().get(`/sso/gobsek?token=${jwt({ ...base, jti: 'a6' })}&next=//evil.com`);
  assert.equal(evil.headers.get('location'), '/');
});

test('приглашение: регистрация по ссылке', async () => {
  const inv = await admin.post('/api/admin/invites', { uses: 1, days: 3, department: 'Продажі' });
  const c = new Client();
  const r = await c.post('/api/register', { code: inv.data.code, login: 'anna', name: 'Анна', password: 'annapass1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.department, 'Продажі');
  const again = await new Client().post('/api/register', { code: inv.data.code, login: 'anna2', name: 'Анна 2', password: 'annapass1' });
  assert.equal(again.data.code, 'invite_invalid');
});

test('защита от запросов с чужого сайта', async () => {
  const r = await ivan.req('POST', `/api/chats/${directId}/messages`, { body: 'csrf' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('профиль и настройки', async () => {
  const r = await olena.patch('/api/me', { status: 'dnd', bio: 'Фінанси', lang: 'pl', settings: { theme: 'dark', hideLastSeen: true, evil: 1 } });
  assert.equal(r.data.user.status, 'dnd');
  assert.equal(r.data.user.settings.theme, 'dark');
  assert.equal(r.data.user.settings.evil, undefined);
  const seen = await ivan.get(`/api/users/${olenaId}`);
  assert.equal(seen.data.last_seen, null, 'скрытое время входа');
  const pw = await olena.post('/api/me/password', { current: 'bad', password: 'newpass123' });
  assert.equal(pw.data.code, 'bad_current');
  assert.equal((await olena.post('/api/me/password', { current: 'olenapass1', password: 'newpass123' })).status, 200);
});

test('WebSocket: приветствие и событие нового сообщения', async () => {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, { headers: { cookie: olena.cookie } });
  const events = [];
  await new Promise((resolve, reject) => {
    ws.onmessage = (e) => { events.push(JSON.parse(e.data)); if (events.length === 1) resolve(); };
    ws.onerror = reject;
  });
  assert.equal(events[0].type, 'hello');
  ws.send(JSON.stringify({ type: 'ping', t: 5 }));
  await ivan.post(`/api/chats/${directId}/messages`, { body: 'Через WebSocket' });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(events.some((e) => e.type === 'pong' && e.t === 5));
  const ev = events.find((e) => e.type === 'message:new');
  assert.equal(ev.message.body, 'Через WebSocket');
  ws.close();
  // Без сессии подключение отклоняется
  const anon = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
  const res = await new Promise((r) => { anon.onerror = () => r('error'); anon.onopen = () => r('open'); });
  assert.equal(res, 'error');
});

test('ИИ без ключа: понятная ошибка и заглушка в чате помощника', async () => {
  const r = await ivan.post('/api/ai/translate', { message_id: 1, lang: 'en' });
  assert.ok([404, 503].includes(r.status));
  const aiChat = await ivan.post('/api/chats/ai');
  await ivan.post(`/api/chats/${aiChat.data.id}/messages`, { body: 'Привіт' });
  await new Promise((res) => setTimeout(res, 50));
  const msgs = (await ivan.get(`/api/chats/${aiChat.data.id}/messages`)).data;
  assert.equal(msgs[msgs.length - 1].meta.ai_notice, 'ai_off');
});
