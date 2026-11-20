// Окна, всплывающие меню, подсказки и подтверждения.
import { esc, $ } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

let stack = [];

/** Открыть модальное окно. content — HTML; onMount(el) вызывается после вставки. */
export function modal({ title = '', content = '', cls = '', onMount, onClose, wide = false, back = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
    <div class="modal-head">${back ? `<button class="icon-btn ghost" data-m="back" aria-label="${esc(t('common.back'))}">${icon('back')}</button>` : ''}
      <h3>${esc(title)}</h3><button class="icon-btn ghost" data-m="close" aria-label="${esc(t('common.close'))}">${icon('x')}</button></div>
    <div class="modal-body">${content}</div></div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  const api = {
    el: wrap.querySelector('.modal'),
    body: wrap.querySelector('.modal-body'),
    close() {
      if (api.closed) return;
      api.closed = true;
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 180);
      stack = stack.filter((x) => x !== api);
      if (onClose) onClose();
    },
    setTitle(s) { wrap.querySelector('.modal-head h3').textContent = s; },
    setContent(html) { api.body.innerHTML = html; },
  };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) api.close(); });
  wrap.querySelector('[data-m=close]').onclick = () => api.close();
  const b = wrap.querySelector('[data-m=back]');
  if (b) b.onclick = () => { api.close(); back(); };
  stack.push(api);
  if (onMount) onMount(api.body, api);
  const first = wrap.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 50);
  return api;
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}
export const hasModal = () => stack.length > 0;

export function confirmDialog(text, { ok = t('common.ok'), danger = false, title = '', extra = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, cls: 'small',
      content: `<p class="confirm-text">${esc(text)}</p>${extra}<div class="modal-actions">
        <button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button>
        <button class="btn ${danger ? 'danger-fill' : ''}" data-a="yes" autofocus>${esc(ok)}</button></div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.body.querySelector('[data-a=no]').onclick = () => m.close();
    m.body.querySelector('[data-a=yes]').onclick = () => {
      done = true;
      const checks = {};
      m.body.querySelectorAll('input[type=checkbox][name]').forEach((c) => { checks[c.name] = c.checked; });
      m.close();
      resolve(Object.keys(checks).length ? checks : true);
    };
  });
}

export function promptDialog(title, { value = '', placeholder = '', ok = t('common.save'), multiline = false, type = 'text' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const field = multiline
      ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>`
      : `<input class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>`;
    const m = modal({
      title, cls: 'small',
      content: `${field}<div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button>
        <button class="btn" data-a="yes">${esc(ok)}</button></div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const inp = m.body.querySelector('.input');
    const submit = () => { done = true; const v = inp.value; m.close(); resolve(v); };
    m.body.querySelector('[data-a=no]').onclick = () => m.close();
    m.body.querySelector('[data-a=yes]').onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  });
}

// ---------- Всплывающее меню ----------
let menuEl = null;
export function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
/**
 * items: [{ icon, label, onClick, danger, sep, html }]
 * at: { x, y } или элемент-якорь.
 */
export function contextMenu(items, at, { header = '' } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'ctx-menu';
  el.innerHTML = header + items.filter(Boolean).map((it, i) => {
    if (it.sep) return '<div class="ctx-sep"></div>';
    if (it.html) return it.html;
    return `<button class="ctx-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? icon(it.icon, 18) : ''}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`;
  }).join('');
  document.body.appendChild(el);
  menuEl = el;
  const list = items.filter(Boolean);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items.filter(Boolean)[Number(b.dataset.i)] || list[Number(b.dataset.i)];
    closeMenu();
    if (it && it.onClick) it.onClick();
  });
  let x;
  let y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.right - el.offsetWidth;
    y = r.bottom + 4;
    if (x < 8) x = r.left;
  } else { x = at.x; y = at.y; }
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = Math.max(8, y - h - (at instanceof Element ? at.getBoundingClientRect().height + 8 : 0));
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}
document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ---------- Уведомления внизу экрана ----------
export function toast(text, { type = '', action, actionLabel, timeout = 3500 } = {}) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="link-btn">${esc(actionLabel)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { action(); el.remove(); };
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, timeout);
}

/** Окно выбора даты и времени (для отложенной отправки и напоминаний). */
export function pickDateTime(title) {
  return new Promise((resolve) => {
    let done = false;
    const now = new Date();
    const presets = [
      { k: 'in20m', at: () => Date.now() + 20 * 60e3 },
      { k: 'in1h', at: () => Date.now() + 3600e3 },
      { k: 'in3h', at: () => Date.now() + 3 * 3600e3 },
      { k: 'tomorrow9', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); } },
      { k: 'monday9', at: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.getTime(); } },
    ];
    const pad = (n) => String(n).padStart(2, '0');
    const local = new Date(now.getTime() + 3600e3);
    const val = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
    const m = modal({
      title, cls: 'small',
      content: `<div class="preset-grid">${presets.map((p, i) => `<button class="chip-btn" data-p="${i}">${esc(t(`time.${p.k}`))}</button>`).join('')}</div>
        <label class="field"><span>${esc(t('time.custom'))}</span><input class="input" type="datetime-local" value="${val}"></label>
        <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('common.ok'))}</button></div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const finish = (ts) => { done = true; m.close(); resolve(ts); };
    m.body.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => finish(presets[Number(b.dataset.p)].at()); });
    m.body.querySelector('[data-a=no]').onclick = () => m.close();
    m.body.querySelector('[data-a=yes]').onclick = () => {
      const v = m.body.querySelector('input').value;
      if (v) finish(new Date(v).getTime());
    };
  });
}
