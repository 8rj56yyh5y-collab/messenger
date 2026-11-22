'use strict';
// Налаштування компанії (робочого простору): що ввімкнено, ліміти, оголошення, робочі години, власні значки.
// Зберігаються одним JSON у таблиці workspace; клієнт отримує їх через /api/meta (поле ws).
const { db, logEvent } = require('./db');
const { HttpError, str, int, jsonParse } = require('./util');

db.exec('CREATE TABLE IF NOT EXISTS workspace (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

const FEATURES = ['ai', 'calls', 'tasks', 'approvals', 'meetings', 'kudos', 'awards', 'polls', 'voice', 'video_notes', 'send_later', 'registration'];
const DEFAULTS = {
  company: '',
  welcome: '',
  announcement: { text: '', level: 'info', id: 0 },
  features: Object.fromEntries(FEATURES.map((f) => [f, true])),
  edit_window_h: Number(process.env.EDIT_WINDOW_HOURS || 48),
  delete_window_h: 0,
  max_upload_mb: Number(process.env.MAX_UPLOAD_MB) || 100,
  kudos_month_limit: 0,
  kudos_points: 10,
  work_hours: { from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5] },
  custom_badges: [],
};

let cache = null;
function get() {
  if (cache) return cache;
  const row = db.prepare("SELECT value FROM workspace WHERE key = 'settings'").get();
  const v = jsonParse(row?.value, {});
  cache = { ...DEFAULTS, ...v, features: { ...DEFAULTS.features, ...(v.features || {}) }, work_hours: { ...DEFAULTS.work_hours, ...(v.work_hours || {}) }, announcement: { ...DEFAULTS.announcement, ...(v.announcement || {}) } };
  return cache;
}
const on = (f) => get().features[f] !== false;
function requireFeature(f) { if (!on(f)) throw new HttpError(403, 'Функцію вимкнено адміністратором', 'feature_off'); }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function update(admin, b) {
  const cur = get();
  const next = JSON.parse(JSON.stringify(cur));
  if ('company' in b) next.company = str(b.company, 80);
  if ('welcome' in b) next.welcome = str(b.welcome, 500);
  if (b.announcement && typeof b.announcement === 'object') {
    const text = str(b.announcement.text, 300);
    const level = ['info', 'warn', 'success'].includes(b.announcement.level) ? b.announcement.level : 'info';
    next.announcement = { text, level, id: text && (text !== cur.announcement.text || level !== cur.announcement.level) ? Date.now() : cur.announcement.id };
  }
  if (b.features && typeof b.features === 'object') for (const f of FEATURES) if (f in b.features) next.features[f] = !!b.features[f];
  const num = (k, min, max) => { if (k in b) { const n = int(b[k]); if (n === null || n < min || n > max) throw new HttpError(400, `Невірне значення: ${k}`, 'bad_value'); next[k] = n; } };
  num('edit_window_h', 0, 24 * 365);
  num('delete_window_h', 0, 24 * 365);
  num('max_upload_mb', 1, Number(process.env.MAX_UPLOAD_MB) || 100);
  num('kudos_month_limit', 0, 1000);
  num('kudos_points', 1, 1000);
  if (b.work_hours && typeof b.work_hours === 'object') {
    const w = b.work_hours;
    if (w.from !== undefined) { if (!HHMM.test(w.from)) throw new HttpError(400, 'Час: ГГ:ХХ', 'bad_value'); next.work_hours.from = w.from; }
    if (w.to !== undefined) { if (!HHMM.test(w.to)) throw new HttpError(400, 'Час: ГГ:ХХ', 'bad_value'); next.work_hours.to = w.to; }
    if (Array.isArray(w.days)) next.work_hours.days = [...new Set(w.days.map(int).filter((d) => d >= 0 && d <= 6))].sort();
  }
  if (Array.isArray(b.custom_badges)) {
    next.custom_badges = b.custom_badges.slice(0, 24).map((x, i) => ({
      code: /^c_[a-z0-9_]{1,20}$/.test(x.code || '') ? x.code : `c_${Date.now().toString(36)}${i}`,
      emoji: str(x.emoji, 8) || '🏅', name: str(x.name, 40), points: Math.min(Math.max(int(x.points) || 10, 1), 1000),
    })).filter((x) => x.name);
  }
  db.prepare("INSERT INTO workspace (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  cache = null;
  logEvent(admin.id, 'workspace_update', { keys: Object.keys(b) });
  const out = get();
  require('./realtime').toAll({ type: 'workspace', ws: publicView() });
  return out;
}

// Те, що бачать усі користувачі (без внутрішніх полів)
function publicView() {
  const w = get();
  return { company: w.company, welcome: w.welcome, announcement: w.announcement, features: w.features, edit_window_h: w.edit_window_h,
    delete_window_h: w.delete_window_h, max_upload_mb: w.max_upload_mb, kudos_month_limit: w.kudos_month_limit, work_hours: w.work_hours, custom_badges: w.custom_badges };
}

// Чи зараз робочий час компанії (за часом сервера)
function isWorkTime(now = new Date()) {
  const w = get().work_hours;
  if (!w.days.includes(now.getDay())) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = w.from.split(':').map(Number);
  const [th, tm] = w.to.split(':').map(Number);
  return m >= fh * 60 + fm && m < th * 60 + tm;
}

function _reset() { cache = null; }

module.exports = { get, on, requireFeature, update, publicView, isWorkTime, FEATURES, _reset };
