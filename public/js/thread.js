// Ветка обсуждения под сообщением — в правой панели, со своим полем ввода.
import { S, on, upsertUser } from './store.js';
import { t, errText } from './i18n.js';
import { $, esc } from './util.js';
import { icon } from './icons.js';
import { get, post } from './api.js';
import { messageHtml } from './messages.js';
import { toast } from './dialogs.js';
import { handleCardAction } from './chat.js';
import * as app from './app.js';

let T = null; // { rootId, chatId, root, replies, el }

export async function renderThread(el, rootId, onClose) {
  T = { rootId, el, root: null, replies: [] };
  el.innerHTML = `<div class="panel-head"><button class="icon-btn ghost" data-th="close">${icon('x')}</button><h3>${esc(t('thread.title'))}</h3></div>
    <div class="panel-body thread-body"><div class="loading-msgs"><span class="spinner"></span></div></div>
    <div class="thread-compose"><textarea id="thread-input" rows="1" placeholder="${esc(t('thread.placeholder'))}" maxlength="8000"></textarea>
      <button class="send-btn sm" data-th="send" aria-label="send">${icon('send', 18)}</button></div>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-th]');
    if (b?.dataset.th === 'close') onClose();
    if (b?.dataset.th === 'send') send();
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'user') app.openPanel({ type: 'user', id: Number(a.dataset.uid) });
    else if (a.dataset.action === 'react') post(`/api/messages/${a.dataset.id}/react`, { emoji: a.dataset.emoji }).catch(() => {});
    else handleCardAction(a.dataset.action, a);
  };
  const ta = el.querySelector('#thread-input');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  try {
    const d = await get(`/api/messages/${rootId}/thread`);
    if (!T || T.rootId !== rootId) return;
    T.root = d.root;
    T.chatId = d.root.chat_id;
    T.replies = d.replies;
    draw(true);
    ta.focus();
  } catch (e) {
    el.querySelector('.thread-body').innerHTML = `<p class="muted center">${esc(errText(e))}</p>`;
  }
}

export function closeThread() { T = null; }

function draw(scroll) {
  if (!T || !T.root) return;
  const chat = S.chats.get(T.chatId) || { type: 'group', id: T.chatId };
  const view = { ...chat, type: chat.type === 'channel' ? 'group' : chat.type };
  const body = T.el.querySelector('.thread-body');
  body.innerHTML = `<div class="messages thread-root">${messageHtml({ ...T.root, thread: null }, view, {})}</div>
    <div class="thread-sep"><span>${esc(t('thread.replies', { n: T.replies.length }))}</span></div>
    <div class="messages thread-list">${T.replies.map((m, i) => messageHtml(m, view, { prev: T.replies[i - 1], next: T.replies[i + 1] })).join('') || `<p class="muted center small">${esc(t('thread.empty'))}</p>`}</div>`;
  if (scroll) body.scrollTop = body.scrollHeight;
}

async function send() {
  if (!T) return;
  const ta = $('#thread-input');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  ta.style.height = 'auto';
  try { await post(`/api/chats/${T.chatId}/messages`, { body: text, thread_id: T.rootId }); } catch (e) { toast(errText(e), { type: 'error' }); ta.value = text; }
}

on('ws', (msg) => {
  if (!T) return;
  const m = msg.message;
  if (msg.type === 'message:new' && m?.thread_id === T.rootId) {
    if (!T.replies.some((x) => x.id === m.id)) T.replies.push(m);
    if (m.user_id && !S.users.has(m.user_id)) upsertUser({ id: m.user_id, name: '…' });
    const body = T.el.querySelector('.thread-body');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    draw(atBottom || m.user_id === S.me.id);
  } else if (msg.type === 'message:edit' && m) {
    if (m.id === T.rootId) { T.root = m; draw(false); }
    const i = T.replies.findIndex((x) => x.id === m.id);
    if (i >= 0) { T.replies[i] = m; draw(false); }
  } else if (msg.type === 'message:delete') {
    T.replies = T.replies.filter((x) => x.id !== msg.id);
    draw(false);
  }
});
