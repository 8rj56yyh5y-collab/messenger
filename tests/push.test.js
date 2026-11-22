'use strict';
// Web Push: шифрование RFC 8291 и подпись VAPID проверяются «со стороны браузера» —
// фальшивый push-сервис принимает запрос, тест расшифровывает его ключом получателя.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-push-'));
process.env.DATA_DIR = DIR;
process.env.PUSH_ALLOW_HTTP = '1';
const { server } = require('../server/index');

let BASE;
let pushSrv;
const received = [];
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  pushSrv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(chunks), url: req.url }); res.writeHead(201); res.end(); });
  });
  await new Promise((r) => pushSrv.listen(0, '127.0.0.1', r));
});
after(() => {
  server.close(); server.closeAllConnections?.();
  pushSrv.close();
  fs.rmSync(DIR, { recursive: true, force: true });
});

async function req(cookie, method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : cookie };
}

function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const uaPublic = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'разделитель последней записи');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

test('push: шифрование, VAPID, только офлайн-получателю, учёт отключённых чатов', async () => {
  const admin = await req(null, 'POST', '/api/setup', { login: 'boss', name: 'Шеф', password: 'secret123' });
  const a = admin.cookie;
  await req(a, 'POST', '/api/admin/users', { login: 'ivan', name: 'Іван', password: 'ivanpass1' });
  const iv = (await req(null, 'POST', '/api/login', { login: 'ivan', password: 'ivanpass1' })).cookie;

  const key = (await req(iv, 'GET', '/api/push/key')).data.key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);

  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `http://127.0.0.1:${pushSrv.address().port}/push/ivan`;
  const sub = await req(iv, 'POST', '/api/push/subscribe', { endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
  assert.equal(sub.status, 200);

  const ivanId = (await req(iv, 'GET', '/api/me')).data.user.id;
  const dm = (await req(a, 'POST', '/api/chats/direct', { user_id: ivanId })).data;
  await req(a, 'POST', `/api/chats/${dm.id}/messages`, { body: 'Привіт, **Іване**!' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(received.length, 1, 'одно уведомление');
  const r0 = received[0];
  assert.equal(r0.headers['content-encoding'], 'aes128gcm');
  const msg = decrypt(r0.body, ua, auth);
  assert.equal(msg.title, 'Шеф');
  assert.equal(msg.body, 'Привіт, Іване!');
  assert.equal(msg.url, `/#/chat/${dm.id}`);

  // Подпись VAPID проверяется публичным ключом сервера
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(r0.headers.authorization);
  assert.ok(m);
  const [h, p, sig] = m[1].split('.');
  const pub = Buffer.from(m[2], 'base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'подпись VAPID верна');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, `http://127.0.0.1:${pushSrv.address().port}`);

  // Без звука и в отключённом чате — не приходит
  await req(a, 'POST', `/api/chats/${dm.id}/messages`, { body: 'тихо', silent: true });
  await req(iv, 'PATCH', `/api/chats/${dm.id}/me`, { muted_until: Date.now() + 3600e3 });
  await req(a, 'POST', `/api/chats/${dm.id}/messages`, { body: 'в отключённый' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(received.length, 1);

  // Новая задача — push исполнителю
  await req(a, 'POST', '/api/tasks', { title: 'Звірити касу', assignee_id: ivanId });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(received.length, 2);
  assert.equal(decrypt(received[1].body, ua, auth).body, 'Звірити касу');

  // Приложение открыто (есть WebSocket) — push не нужен
  await req(iv, 'PATCH', `/api/chats/${dm.id}/me`, { muted_until: 0 });
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, { headers: { cookie: iv } });
  await new Promise((r) => { ws.onmessage = r; });
  await req(a, 'POST', `/api/chats/${dm.id}/messages`, { body: 'онлайн' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(received.length, 2);
  ws.close();

  // Неверная подписка отклоняется
  assert.equal((await req(iv, 'POST', '/api/push/subscribe', { endpoint, keys: { p256dh: 'abc', auth: 'x' } })).status, 400);
});
