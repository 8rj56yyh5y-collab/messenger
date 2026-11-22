'use strict';
// Исходящие события в Gobsek: задачи, погодження, встречи, протоколы, подяки.
// Надёжная доставка через очередь (outbox): при недоступности Gobsek событие повторяется с растущей паузой.
// Включается переменной GOBSEK_EVENTS_URL; подпись тела — HMAC-SHA256 секретом GOBSEK_EVENTS_SECRET.
const crypto = require('node:crypto');
const { db } = require('./db');
const rt = require('./realtime');

db.exec(`CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(delivered_at, next_at);`);

const MAX_ATTEMPTS = 12;
const enabled = () => !!process.env.GOBSEK_EVENTS_URL;

function enqueue(event, data) {
  if (!enabled()) return;
  db.prepare('INSERT INTO outbox (event, payload, next_at, created_at) VALUES (?, ?, ?, ?)')
    .run(event, JSON.stringify({ event, data, ts: new Date().toISOString() }), Date.now(), Date.now());
  setImmediate(flush);
}

function sign(body) {
  return `sha256=${crypto.createHmac('sha256', process.env.GOBSEK_EVENTS_SECRET || '').update(body).digest('hex')}`;
}

let busy = false;
async function flush() {
  if (busy || !enabled()) return;
  busy = true;
  try {
    const rows = db.prepare('SELECT * FROM outbox WHERE delivered_at IS NULL AND attempts < ? AND next_at <= ? ORDER BY id LIMIT 20').all(MAX_ATTEMPTS, Date.now());
    for (const r of rows) {
      let error = '';
      try {
        const res = await fetch(process.env.GOBSEK_EVENTS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'X-Gobsek-Chat-Event': r.event, 'X-Gobsek-Chat-Delivery': String(r.id),
            'X-Gobsek-Chat-Signature': sign(r.payload),
          },
          body: r.payload,
          signal: AbortSignal.timeout(10e3),
        });
        if (res.ok) { db.prepare('UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?').run(Date.now(), r.id); continue; }
        error = `HTTP ${res.status}`;
      } catch (e) { error = String(e.message || e).slice(0, 200); }
      const delay = Math.min(6 * 3600e3, 30e3 * 2 ** r.attempts);
      db.prepare('UPDATE outbox SET attempts = attempts + 1, next_at = ?, last_error = ? WHERE id = ?').run(Date.now() + delay, error, r.id);
    }
  } finally { busy = false; }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(flush, 15e3);
  timer.unref();
}

function stats() {
  return {
    enabled: enabled(),
    pending: db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE delivered_at IS NULL AND attempts < ?').get(MAX_ATTEMPTS).n,
    failed: db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE delivered_at IS NULL AND attempts >= ?').get(MAX_ATTEMPTS).n,
    delivered: db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE delivered_at IS NOT NULL').get().n,
    last_error: db.prepare("SELECT last_error FROM outbox WHERE last_error <> '' ORDER BY id DESC LIMIT 1").get()?.last_error || '',
  };
}

rt.on('work', ({ event, data }) => enqueue(event, data));

module.exports = { enqueue, flush, start, stats, sign, enabled };
