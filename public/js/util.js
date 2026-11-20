// Общие помощники интерфейса: экранирование, разметка сообщений, даты, аватары.
import { t, locale } from './i18n.js';
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms) {
  let tm;
  return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); };
}

// ---------- Разметка сообщений ----------
// Сначала всё экранируется, потом применяется узкий набор правил — так в сообщение нельзя внедрить HTML.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
export function md(text, opts = {}) {
  if (!text) return '';
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(text);
  s = s.replace(/```(?:[a-z0-9_-]+\n)?([\s\S]*?)```\n?/gi, (_, code) => keep(`<pre class="code"><code>${esc(code.replace(/^\n|\n$/g, ''))}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
  s = s.replace(URL_RE, (url) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.length > 70 ? `${url.slice(0, 67)}…` : url)}</a>`));
  s = esc(s);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/(^|[\s(])[_*]([^_*\n]+)[_*](?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" data-action="spoiler">$1</span>')
    .replace(/(^|[\s(])@([a-z0-9._-]{2,40})/gi, (m, pre, login) => `${pre}<span class="mention${opts.me && login.toLowerCase() === opts.me ? ' me' : ''}" data-action="mention" data-login="${login}">@${login}</span>`);
  s = s.replace(/^&gt; ?(.*)$/gm, '<span class="quote">$1</span>');
  s = s.replace(/^[-•] (.*)$/gm, '<span class="li">• $1</span>');
  // Блочные строки (цитата, пункт списка) сами переносятся — лишний <br> после них не нужен.
  s = s.replace(/(<span class="(?:li|quote)">[^\n]*<\/span>)\n/g, '$1');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  return s;
}

/** Текст без разметки — для превью в списке чатов и уведомлений. */
export function plain(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '[code]').replace(/[*_~`|]{1,2}/g, '').replace(/\s+/g, ' ').trim();
}

/** Сообщение только из 1–3 эмодзи показываем крупно. */
export function isEmojiOnly(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 24) return false;
  return /^(\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*\s*){1,3}$/u.test(s);
}

// ---------- Даты ----------
const DAY = 86400e3;
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
let hour12 = false;
export function setTimeFormat(f) { hour12 = f === '12'; }
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12 });
export function fmtListTime(ts) {
  if (!ts) return '';
  const today = startOfDay(Date.now());
  if (ts >= today) return fmtTime(ts);
  if (ts >= today - 6 * DAY) return new Date(ts).toLocaleDateString(locale(), { weekday: 'short' });
  if (new Date(ts).getFullYear() === new Date().getFullYear()) return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  return new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtDay(ts) {
  const today = startOfDay(Date.now());
  const d = startOfDay(ts);
  if (d === today) return t('date.today');
  if (d === today - DAY) return t('date.yesterday');
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12 });
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtLastSeen(ts) {
  if (!ts) return t('presence.long_ago');
  const diff = Date.now() - ts;
  if (diff < 60e3) return t('presence.just_now');
  if (diff < 3600e3) return t('presence.minutes_ago', { n: Math.floor(diff / 60e3) });
  if (ts >= startOfDay(Date.now())) return t('presence.today_at', { time: fmtTime(ts) });
  if (ts >= startOfDay(Date.now()) - DAY) return t('presence.yesterday_at', { time: fmtTime(ts) });
  return t('presence.on_date', { date: new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) });
}
export function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

// ---------- Аватары ----------
export const PALETTE = [
  ['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed'], ['#b8c2cc', '#7c8b99'],
];
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
  return s.toUpperCase();
}
export function avatar(entity, size = 48, opts = {}) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  const online = opts.online ? '<span class="av-online"></span>' : '';
  if (opts.kind === 'saved') return `<span class="av av-icon av-saved" style="${st}">${icon('bookmark', Math.round(size * 0.5))}</span>`;
  if (opts.kind === 'ai') return `<span class="av av-icon av-ai" style="${st}">${icon('sparkles', Math.round(size * 0.5))}${online}</span>`;
  if (entity?.avatar) return `<span class="av" style="${st}"><img src="${esc(entity.avatar)}" alt="" loading="lazy" draggable="false">${online}</span>`;
  const [a, b] = PALETTE[(entity?.color || 0) % PALETTE.length];
  const label = entity?.name || entity?.title || '?';
  return `<span class="av" style="${st};background:linear-gradient(135deg,${a},${b})">${esc(initials(label))}${online}</span>`;
}
export function nameColor(id) {
  const colors = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae', '#d29f3f'];
  return colors[Math.abs(Number(id) || 0) % colors.length];
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
