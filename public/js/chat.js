// Открытый чат: шапка, лента сообщений, поле ввода, меню сообщения, выделение, поиск по чату.
import { S, emit, on, chatTitle, peerOf, isMuted, userName, upsertChat } from './store.js';
import { t, errText } from './i18n.js';
import { $, $$, esc, avatar, fmtDay, sameDay, fmtLastSeen, debounce, copyText, plain, isMobile, fmtDateTime } from './util.js';
import { icon } from './icons.js';
import { get, post, patch, del, upload } from './api.js';
import { messageHtml, dayDivider, groupedWith, previewText } from './messages.js';
import { contextMenu, closeMenu, modal, toast, confirmDialog, pickDateTime } from './dialogs.js';
import { emojiPanelHtml, bindEmojiPanel, pushRecent } from './emoji.js';
import { Recorder, toggleVoice, seekVoice, cycleSpeed } from './voice.js';
import { startCall, joinCall } from './call.js';
import * as app from './app.js';
import { taskDialog, setTaskStatus, approvalDialog, decideApproval, meetingDialog, rsvp, kudosDialog, ackMessage, ackListDialog } from './work-ui.js';
import { recordVideoNote } from './videonote.js';

const PAGE = 50;
let V = null; // состояние открытого чата

export function currentView() { return V; }

function store(chatId) {
  if (!S.messages.has(chatId)) S.messages.set(chatId, { list: [], hasMoreTop: true, hasMoreBottom: false, loaded: false });
  return S.messages.get(chatId);
}

// ---------- Открытие ----------
export async function openChat(chatId, { jumpTo = null } = {}) {
  const chat = S.chats.get(chatId);
  if (!chat) return;
  saveDraft();
  S.current = chatId;
  S.replyTo = null;
  S.editing = null;
  S.selection.clear();
  const main = $('#main');
  main.innerHTML = chatShellHtml(chat);
  document.body.classList.add('chat-open');
  V = {
    chatId, el: main.querySelector('.chat'), list: main.querySelector('.messages'), scroller: main.querySelector('.messages-wrap'),
    loadingTop: false, loadingBottom: false, unreadMarker: chat.unread > 0 ? chat.last_read_id : null, atBottom: true, recorder: null,
  };
  bindChat();
  renderHead();
  renderPinned();
  renderCallBanner();
  renderComposer();
  const st = store(chatId);
  const anchor = jumpTo || (chat.unread > 0 && chat.last_read_id ? chat.last_read_id + 1 : null);
  if (st.loaded && !anchor && !st.hasMoreBottom) {
    renderAll();
    scrollToBottom(false);
    refresh(chatId);
  } else {
    V.list.innerHTML = '<div class="loading-msgs"><span class="spinner"></span></div>';
    await load(chatId, anchor ? { around: anchor } : {});
    if (S.current !== chatId) return;
    renderAll();
    if (jumpTo) highlightMessage(jumpTo);
    else if (anchor) {
      const marker = V.list.querySelector('.unread-divider');
      if (marker) scrollToNode(marker, 'start'); else scrollToBottom(false);
    } else scrollToBottom(false);
  }
  markReadSoon();
  if (!isMobile()) $('#composer-input')?.focus();
  emit('chat:opened', chatId);
}

export function closeChat() {
  saveDraft();
  S.current = null;
  V = null;
  document.body.classList.remove('chat-open');
  $('#main').innerHTML = emptyHtml();
  emit('chat:opened', null);
}

export function emptyHtml() {
  return `<div class="empty-main"><div class="empty-card">${icon('sparkles', 34)}<h3>${esc(t('empty.title'))}</h3><p>${esc(t('empty.text'))}</p>
    <div class="empty-keys"><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ${esc(t('empty.k_search'))}</span><span><kbd>Esc</kbd> ${esc(t('empty.k_close'))}</span><span><kbd>↑</kbd> ${esc(t('empty.k_edit'))}</span></div></div></div>`;
}

async function load(chatId, q) {
  const st = store(chatId);
  const params = new URLSearchParams({ limit: String(PAGE), ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) });
  const list = await get(`/api/chats/${chatId}/messages?${params}`);
  if (q.before) {
    st.list = [...list, ...st.list];
    st.hasMoreTop = list.length >= PAGE;
  } else if (q.after) {
    st.list = [...st.list, ...list];
    st.hasMoreBottom = list.length >= PAGE;
  } else if (q.around) {
    st.list = list;
    st.hasMoreTop = true;
    const chat = S.chats.get(chatId);
    st.hasMoreBottom = list.length > 0 && chat?.last?.id ? list[list.length - 1].id < chat.last.id : false;
  } else {
    st.list = list;
    st.hasMoreTop = list.length >= PAGE;
    st.hasMoreBottom = false;
  }
  st.loaded = true;
  return list;
}

async function refresh(chatId) {
  // Догружаем то, что пришло, пока чат не был открыт (страховка от пропущенных событий).
  const st = store(chatId);
  const last = st.list[st.list.length - 1];
  if (!last) return;
  const fresh = await get(`/api/chats/${chatId}/messages?after=${last.id}&limit=100`).catch(() => []);
  if (fresh.length && S.current === chatId) { for (const m of fresh) addMessage(m); }
}

// ---------- Разметка ----------
function chatShellHtml(chat) {
  return `<section class="chat" data-chat="${chat.id}" style="${wallpaperStyle()}">
    <header class="chat-head">
      <button class="icon-btn ghost only-mobile" data-action="back" aria-label="${esc(t('common.back'))}">${icon('back')}</button>
      <div class="head-main" data-action="info"></div>
      <div class="head-actions"></div>
    </header>
    <div class="chat-search hidden"><span class="cs-ic">${icon('search', 18)}</span><input class="input" placeholder="${esc(t('chat.search_in'))}"><span class="cs-count"></span>
      <button class="icon-btn ghost" data-action="search-close">${icon('x', 18)}</button><div class="cs-results"></div></div>
    <div class="pinned-bar hidden"></div>
    <div class="call-banner hidden"></div>
    <div class="messages-wrap"><div class="messages" role="log" aria-live="polite"></div></div>
    <button class="to-bottom hidden" data-action="to-bottom">${icon('down', 22)}<span class="badge hidden"></span></button>
    <div class="drop-zone hidden"><div>${icon('download', 40)}<b>${esc(t('chat.drop'))}</b></div></div>
    <footer class="composer"></footer>
  </section>`;
}

function wallpaperStyle() {
  const w = S.settings.wallpaper || 'animated';
  return `--wall:var(--wall-${w}, var(--wall-pattern))" data-wall="${w}`;
}

export function renderHead() {
  if (!V) return;
  const chat = S.chats.get(V.chatId);
  if (!chat) return;
  const peer = peerOf(chat);
  const kind = chat.type === 'saved' ? 'saved' : chat.type === 'ai' ? 'ai' : null;
  $('.head-main', V.el).innerHTML = `${avatar(peer || chat, 42, { kind, online: chat.type === 'direct' && S.online.has(peer?.id) })}
    <div class="head-text"><div class="head-title">${esc(chatTitle(chat, t))}${isMuted(chat) ? icon('bellOff', 14, 'muted-ic') : ''}</div>
    <div class="head-sub">${subtitle(chat)}</div></div>`;
  const canCall = ['direct', 'group'].includes(chat.type) || (chat.type === 'channel' && ['owner', 'admin'].includes(chat.my_role));
  $('.head-actions', V.el).innerHTML = `
    <button class="icon-btn ghost" data-action="search" title="${esc(t('chat.search_in'))}">${icon('search')}</button>
    ${canCall ? `<button class="icon-btn ghost" data-action="call" data-media="audio" title="${esc(chat.type === 'direct' ? t('call.audio') : t('call.start_conf'))}">${icon('phone')}</button>
    <button class="icon-btn ghost" data-action="call" data-media="video" title="${esc(t('call.video'))}">${icon('video')}</button>` : ''}
    <button class="icon-btn ghost hide-narrow" data-action="info" title="${esc(t('chat.info'))}">${icon('info')}</button>
    <button class="icon-btn ghost" data-action="chat-menu" title="${esc(t('common.more'))}">${icon('more')}</button>`;
}

function subtitle(chat) {
  const typing = S.typing.get(chat.id);
  if (typing && typing.size) {
    const now = Date.now();
    const active = [...typing].filter(([, v]) => v.until > now);
    if (active.length) {
      const [uid, v] = active[0];
      const verb = t(`typing.${v.action}`);
      const who = chat.type === 'direct' ? '' : `${userName(uid).split(' ')[0]} `;
      return `<span class="typing">${esc(who + verb)}<i></i><i></i><i></i></span>`;
    }
  }
  if (chat.type === 'saved') return esc(t('chat.saved_sub'));
  if (chat.type === 'ai') return esc(S.meta.ai ? t('ai.sub') : t('ai.off_sub'));
  if (chat.type === 'direct') {
    const p = peerOf(chat);
    if (!p) return '';
    if (p.is_bot) return esc(t('user.bot'));
    if (S.online.has(p.id)) return `<span class="online-txt">${esc(t('presence.online'))}</span>`;
    const status = p.status && p.status !== 'available' ? `${t(`status.${p.status}`)} · ` : '';
    return esc(status + (p.last_seen ? t('presence.last_seen', { when: fmtLastSeen(p.last_seen) }) : t('presence.recently')));
  }
  const n = chat.members_count;
  const online = chat.type === 'group' ? onlineCount(chat) : 0;
  const base = chat.type === 'channel' ? t('chat.subscribers', { n }) : t('chat.members', { n });
  return esc(online > 1 ? `${base}, ${t('chat.online_n', { n: online })}` : base);
}
function onlineCount(chat) {
  const det = S.chatDetails?.get(chat.id);
  if (!det) return 0;
  return det.members.filter((m) => S.online.has(m.id)).length;
}

export function renderPinned() {
  if (!V) return;
  const chat = S.chats.get(V.chatId);
  const bar = $('.pinned-bar', V.el);
  if (!chat.pinned_msg_id) { bar.classList.add('hidden'); return; }
  const m = store(chat.id).list.find((x) => x.id === chat.pinned_msg_id);
  const fill = (msg) => {
    bar.innerHTML = `<div class="pin-line"></div><div class="pin-body" data-action="jump" data-id="${chat.pinned_msg_id}"><b>${esc(t('chat.pinned'))}</b><span>${esc(msg ? previewText(msg) : '…')}</span></div>
      ${['owner', 'admin'].includes(chat.my_role) || ['direct', 'saved', 'ai'].includes(chat.type) ? `<button class="icon-btn ghost" data-action="unpin" title="${esc(t('msg.unpin'))}">${icon('x', 18)}</button>` : ''}`;
    bar.classList.remove('hidden');
  };
  if (m) fill(m);
  else {
    fill(null);
    get(`/api/chats/${chat.id}/messages?around=${chat.pinned_msg_id}&limit=1`).then((l) => { if (V && V.chatId === chat.id) fill(l.find((x) => x.id === chat.pinned_msg_id)); }).catch(() => {});
  }
}

export function renderCallBanner() {
  if (!V) return;
  const bar = $('.call-banner', V.el);
  const c = [...S.calls.values()].find((x) => x.chat_id === V.chatId);
  const chat = S.chats.get(V.chatId);
  if (!c || chat.type === 'direct') { bar.classList.add('hidden'); return; }
  const people = c.peers.map((p) => p.user_id).filter((v, i, a) => a.indexOf(v) === i);
  bar.innerHTML = `<span class="cb-dot"></span><div class="cb-text"><b>${esc(t('call.conf_running'))}</b><span>${esc(t('call.participants', { n: people.length }))}</span></div>
    <div class="cb-avs">${people.slice(0, 4).map((id) => avatar(S.users.get(id) || { id, name: userName(id) }, 26)).join('')}</div>
    <button class="btn sm hl" data-action="join-call" data-id="${c.id}">${esc(t('call.join'))}</button>`;
  bar.classList.remove('hidden');
}

// ---------- Лента ----------
function renderAll() {
  if (!V) return;
  const st = store(V.chatId);
  const chat = S.chats.get(V.chatId);
  let html = st.hasMoreTop ? '<div class="load-more-top"><span class="spinner"></span></div>' : chatIntro(chat);
  const list = st.list.filter((m) => !m.deleted);
  const isJoin = (m) => m && m.kind === 'system' && m.meta?.event === 'joined';
  list.forEach((m, i) => {
    const prev = list[i - 1];
    if (!prev || !sameDay(prev.created_at, m.created_at)) html += dayDivider(m.created_at, fmtDay(m.created_at));
    if (V.unreadMarker && prev && prev.id <= V.unreadMarker && m.id > V.unreadMarker && m.user_id !== S.me.id) {
      html += `<div class="unread-divider"><span>${esc(t('chat.unread_below'))}</span></div>`;
    }
    // Серию «X присоединился» подряд сворачиваем в одну строку
    if (isJoin(m) && isJoin(prev) && sameDay(prev.created_at, m.created_at)) return;
    if (isJoin(m) && isJoin(list[i + 1])) {
      const run = [];
      for (let j = i; isJoin(list[j]) && sameDay(list[j].created_at, m.created_at); j++) run.push(list[j]);
      const names = run.map((x) => userName(x.meta.actor).split(' ')[0]);
      const text = names.length > 3 ? t('sys.joined_many', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : t('sys.joined', { actor: names.join(', ') });
      html += `<div class="msg system" data-id="${run[run.length - 1].id}"><div class="sys-pill">${esc(text)}</div></div>`;
      return;
    }
    html += messageHtml(m, chat, { prev, next: list[i + 1] });
  });
  if (!list.length && !st.hasMoreTop) html += emptyChatHint(chat);
  V.list.innerHTML = html;
}

function chatIntro(chat) {
  if (chat.type === 'ai') {
    return `<div class="chat-intro ai-intro">${avatar(null, 72, { kind: 'ai' })}<h3>Gobsek AI</h3><p>${esc(t('ai.intro'))}</p>
      <div class="ai-prompts">${['ai.p1', 'ai.p2', 'ai.p3', 'ai.p4'].map((k) => `<button class="chip-btn" data-action="ai-prompt" data-text="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div></div>`;
  }
  if (chat.type === 'saved') return `<div class="chat-intro">${avatar(null, 72, { kind: 'saved' })}<h3>${esc(t('chat.saved'))}</h3><p>${esc(t('chat.saved_intro'))}</p></div>`;
  return '';
}
function emptyChatHint(chat) {
  if (chat.type !== 'direct') return '';
  return `<div class="empty-chat"><div>${esc(t('chat.no_messages'))}</div><div class="hello-stickers">${['👋', '🤝', '☕', '🙂'].map((e) => `<button data-action="send-emoji" data-emoji="${e}">${e}</button>`).join('')}</div></div>`;
}

function nodeOf(id) { return V?.list.querySelector(`.msg[data-id="${id}"]`); }

function replaceNode(m) {
  const st = store(m.chat_id);
  const list = st.list.filter((x) => !x.deleted);
  const i = list.findIndex((x) => x.id === m.id);
  const n = nodeOf(m.id);
  if (!n || i < 0) return;
  const chat = S.chats.get(m.chat_id);
  const tmp = document.createElement('div');
  tmp.innerHTML = messageHtml(list[i], chat, { prev: list[i - 1], next: list[i + 1] });
  const fresh = tmp.firstElementChild;
  if (fresh) {
    if (n.classList.contains('selected')) fresh.classList.add('selected');
    n.replaceWith(fresh);
  } else n.remove();
}

/** Новое сообщение в открытом чате. */
function addMessage(m) {
  if (m.thread_id) return; // ответы в ветке живут в панели ветки
  const st = store(m.chat_id);
  if (st.list.some((x) => x.id === m.id)) { updateMessage(m); return; }
  // Своё сообщение могло уже стоять «в ожидании» с временным id.
  const pendingIdx = m.user_id === S.me.id ? st.list.findIndex((x) => x._pending && x._nonce && x._nonce === m._nonce) : -1;
  if (pendingIdx >= 0) {
    const old = st.list[pendingIdx];
    st.list[pendingIdx] = m;
    if (V && V.chatId === m.chat_id) {
      const n = nodeOf(old.id);
      if (n) n.dataset.id = String(m.id);
      replaceNode(m);
    }
    return;
  }
  if (st.hasMoreBottom) return; // мы далеко в истории — подгрузим при прокрутке вниз
  st.list.push(m);
  if (!V || V.chatId !== m.chat_id) return;
  const wasBottom = isAtBottom();
  const list = st.list.filter((x) => !x.deleted);
  const prev = list[list.length - 2];
  const chat = S.chats.get(m.chat_id);
  let html = '';
  if (!prev || !sameDay(prev.created_at, m.created_at)) html += dayDivider(m.created_at, fmtDay(m.created_at));
  html += messageHtml(m, chat, { prev, next: null });
  V.list.querySelector('.empty-chat')?.remove();
  V.list.insertAdjacentHTML('beforeend', html);
  V.list.lastElementChild?.classList.add('appear');
  if (prev && groupedWith(prev, m)) replaceNode(prev);
  if (wasBottom || m.user_id === S.me.id) scrollToBottom(true);
  else updateToBottom();
  markReadSoon();
}

function updateMessage(m) {
  const st = store(m.chat_id);
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  st.list[i] = { ...st.list[i], ...m };
  if (V && V.chatId === m.chat_id) {
    const wasBottom = isAtBottom();
    replaceNode(st.list[i]);
    if (wasBottom) scrollToBottom(false);
  }
}

function removeMessage(chatId, id) {
  const st = store(chatId);
  const i = st.list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const prev = st.list[i - 1];
  const next = st.list[i + 1];
  st.list.splice(i, 1);
  if (V && V.chatId === chatId) {
    const n = nodeOf(id);
    if (n) {
      n.classList.add('removing');
      setTimeout(() => {
        n.remove();
        if (prev) replaceNode(prev);
        if (next) replaceNode(next);
      }, 180);
    }
  }
}

// Своё сообщение может прийти по WebSocket раньше ответа на POST: сопоставим с «ожидающим» по тексту.
function matchPending(m) {
  if (m.user_id !== S.me.id) return;
  const st = S.messages.get(m.chat_id);
  const p = st && st.list.find((x) => x._pending && x.body === m.body && (x.kind === m.kind || x.file));
  if (p) m._nonce = p._nonce;
}

// ---------- События от сервера ----------
on('ws', (msg) => {
  switch (msg.type) {
    case 'message:new':
      matchPending(msg.message);
      addMessage(msg.message);
      break;
    case 'message:edit':
      updateMessage(msg.message);
      if (V && S.chats.get(V.chatId)?.pinned_msg_id === msg.message.id) renderPinned();
      break;
    case 'message:delete':
      removeMessage(msg.chat_id, msg.id);
      break;
    case 'read':
      if (V && V.chatId === msg.chat_id && msg.user_id !== S.me.id) {
        // Галочки «прочитано» у своих сообщений.
        $$('.msg.mine .tick:not(.read)', V.list).forEach((tk) => {
          const id = Number(tk.closest('.msg').dataset.id);
          if (id <= msg.last_read_id) { tk.classList.add('read'); tk.innerHTML = icon('check2', 15); }
        });
      }
      break;
    case 'typing':
      if (V && V.chatId === msg.chat_id) renderHead();
      break;
    default:
  }
});
on('chat:updated', (id) => {
  if (!V || V.chatId !== id) return;
  renderHead();
  renderPinned();
  renderComposer(true);
});
on('presence', () => { if (V) renderHead(); });
on('call:changed', () => renderCallBanner());

// ---------- Прокрутка ----------
function isAtBottom() {
  const s = V.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
}
function scrollToBottom(smooth) {
  if (!V) return;
  const st = store(V.chatId);
  if (st.hasMoreBottom) {
    load(V.chatId, {}).then(() => { renderAll(); scrollToBottom(false); });
    return;
  }
  requestAnimationFrame(() => {
    if (!V) return;
    V.scroller.scrollTo({ top: V.scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}
// Прокрутка только внутри ленты: scrollIntoView сдвигал бы и всю страницу.
function scrollToNode(node, where = 'center', smooth = false) {
  if (!V || !node) return;
  const s = V.scroller;
  const top = node.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
  const target = where === 'start' ? top - 60 : top - s.clientHeight / 2 + node.offsetHeight / 2;
  s.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}
function updateToBottom() {
  if (!V) return;
  const btn = $('.to-bottom', V.el);
  const chat = S.chats.get(V.chatId);
  const show = !isAtBottom() || store(V.chatId).hasMoreBottom;
  btn.classList.toggle('hidden', !show);
  const badge = btn.querySelector('.badge');
  badge.textContent = chat.unread > 99 ? '99+' : String(chat.unread || '');
  badge.classList.toggle('hidden', !chat.unread);
}

async function onScroll() {
  if (!V) return;
  updateToBottom();
  markReadSoon();
  const st = store(V.chatId);
  const s = V.scroller;
  if (s.scrollTop < 300 && st.hasMoreTop && !V.loadingTop && st.list.length) {
    V.loadingTop = true;
    const chatId = V.chatId;
    const h = s.scrollHeight;
    try {
      await load(chatId, { before: st.list[0].id });
      if (!V || V.chatId !== chatId) return;
      renderAll();
      s.scrollTop = s.scrollHeight - h + s.scrollTop;
    } finally { if (V) V.loadingTop = false; }
  }
  if (st.hasMoreBottom && !V.loadingBottom && s.scrollHeight - s.scrollTop - s.clientHeight < 300) {
    V.loadingBottom = true;
    const chatId = V.chatId;
    try {
      await load(chatId, { after: st.list[st.list.length - 1].id });
      if (!V || V.chatId !== chatId) return;
      const top = s.scrollTop;
      renderAll();
      s.scrollTop = top;
    } finally { if (V) V.loadingBottom = false; }
  }
}

// ---------- Прочтение ----------
const markReadSoon = debounce(() => {
  if (!V || document.hidden) return;
  const chat = S.chats.get(V.chatId);
  const st = store(V.chatId);
  if (!chat || !st.list.length) return;
  const bottom = V.scroller.getBoundingClientRect().bottom;
  let maxId = 0;
  for (const n of $$('.msg', V.list).reverse()) {
    if (n.getBoundingClientRect().top < bottom - 20) { maxId = Number(n.dataset.id); break; }
  }
  if (!maxId) return;
  if (maxId > chat.last_read_id || chat.manual_unread) {
    const unreadLeft = st.list.filter((m) => m.id > maxId && m.user_id !== S.me.id).length + (st.hasMoreBottom ? 1 : 0);
    upsertChat({ id: chat.id, last_read_id: Math.max(maxId, chat.last_read_id), unread: Math.min(chat.unread, unreadLeft), mentions: unreadLeft ? chat.mentions : 0, manual_unread: false });
    emit('chats:changed');
    post(`/api/chats/${chat.id}/read`, { up_to: maxId }).catch(() => {});
    updateToBottom();
  }
}, 350);
document.addEventListener('visibilitychange', () => { if (!document.hidden) markReadSoon(); });
window.addEventListener('focus', () => markReadSoon());

// ---------- Поле ввода ----------
export function renderComposer(soft = false) {
  if (!V) return;
  const chat = S.chats.get(V.chatId);
  const box = $('.composer', V.el);
  const readonly = (chat.type === 'channel' || chat.only_admins_post) && !['owner', 'admin'].includes(chat.my_role);
  if (readonly) {
    box.innerHTML = `<button class="btn soft block" data-action="toggle-mute">${icon(isMuted(chat) ? 'bell' : 'bellOff', 18)} ${esc(isMuted(chat) ? t('chat.unmute') : t('chat.mute'))}</button>`;
    return;
  }
  if (soft && box.querySelector('#composer-input')) return;
  const draft = chat.draft || localDraft(chat.id) || '';
  box.innerHTML = `<div class="compose-ctx hidden"></div>
    <div class="mention-pop hidden"></div>
    <div class="compose-row">
      <div class="compose-box">
        <button class="icon-btn ghost" data-action="emoji" title="${esc(t('compose.emoji'))}">${icon('smile')}</button>
        <textarea id="composer-input" rows="1" placeholder="${esc(chat.type === 'channel' ? t('compose.broadcast') : t('compose.placeholder'))}" maxlength="8000">${esc(draft)}</textarea>
        ${S.meta.ai ? `<button class="icon-btn ghost" data-action="ai-menu" title="${esc(t('ai.assist'))}">${icon('wand')}</button>` : ''}
        <button class="icon-btn ghost" data-action="attach" title="${esc(t('compose.attach'))}">${icon('clip')}</button>
      </div>
      <button class="send-btn" data-action="send" aria-label="${esc(t('compose.send'))}">${icon(draft.trim() ? 'send' : 'mic', 22)}</button>
    </div>
    <div class="emoji-pop hidden">${emojiPanelHtml()}</div>
    <input type="file" class="hidden" id="file-input" multiple>`;
  const ta = $('#composer-input', box);
  autosize(ta);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKeyDown);
  ta.addEventListener('paste', onPaste);
  bindEmojiPanel($('.emoji-pop', box), (e) => insertText(e));
  $('#file-input', box).addEventListener('change', (e) => { const fl = [...e.target.files]; e.target.value = ''; if (fl.length) attachFiles(fl); });
  const send = $('.send-btn', box);
  send.addEventListener('contextmenu', (e) => { e.preventDefault(); sendMenu(send); });
  renderComposeCtx();
}

function localDraft(id) { try { return localStorage.getItem(`gc-draft-${id}`) || ''; } catch { return ''; } }
function saveDraft() {
  if (!V) return;
  const ta = $('#composer-input');
  if (!ta || S.editing) return;
  const chat = S.chats.get(V.chatId);
  const text = ta.value;
  if (!chat || text === (chat.draft || '')) return;
  upsertChat({ id: chat.id, draft: text });
  try { if (text) localStorage.setItem(`gc-draft-${chat.id}`, text); else localStorage.removeItem(`gc-draft-${chat.id}`); } catch { /* ignore */ }
  patch(`/api/chats/${chat.id}/me`, { draft: text }).catch(() => {});
  emit('chats:changed');
}
window.addEventListener('beforeunload', saveDraft);

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
}

let typingSent = 0;
function onInput(e) {
  const ta = e.target;
  autosize(ta);
  const has = ta.value.trim().length > 0;
  const btn = $('.send-btn', V.el);
  btn.innerHTML = icon(has || S.editing ? 'send' : 'mic', 22);
  if (has && Date.now() - typingSent > 3000) {
    typingSent = Date.now();
    app.socket().send({ type: 'typing', chat_id: V.chatId, action: 'typing' });
  }
  mentionAutocomplete(ta);
  templatesPopup(ta);
  saveDraftSoon();
}
const saveDraftSoon = debounce(saveDraft, 1500);

function onKeyDown(e) {
  const ta = e.target;
  const pop = $('.mention-pop', V.el);
  if (!pop.classList.contains('hidden')) {
    const items = $$('.mp-item', pop);
    let i = items.findIndex((x) => x.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((x, j) => x.classList.toggle('on', j === i));
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && items[i]) { e.preventDefault(); if (items[i].dataset.tpl) items[i].click(); else pickMention(items[i].dataset.login); return; }
    if (e.key === 'Escape') { pop.classList.add('hidden'); return; }
  }
  const enterSends = S.settings.sendOnEnter !== false;
  if (e.key === 'Enter' && !e.isComposing && ((enterSends && !e.shiftKey && !e.ctrlKey) || (!enterSends && (e.ctrlKey || e.metaKey)))) {
    e.preventDefault();
    sendCurrent();
    return;
  }
  if (e.key === 'ArrowUp' && !ta.value && !S.editing) {
    const mine = [...store(V.chatId).list].reverse().find((m) => m.user_id === S.me.id && ['text', 'image', 'file', 'video'].includes(m.kind) && !m._pending);
    if (mine) { e.preventDefault(); startEdit(mine); }
    return;
  }
  if (e.key === 'Escape' && (S.replyTo || S.editing)) { e.preventDefault(); cancelCtx(); return; }
  // Быстрое оформление: Ctrl+B / Ctrl+I
  if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'и', 'ш'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    wrapSelection(ta, ['b', 'и'].includes(e.key.toLowerCase()) ? '**' : '_');
  }
}

function wrapSelection(ta, mark) {
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + mark + value.slice(a, b) + mark + value.slice(b);
  ta.setSelectionRange(a + mark.length, b + mark.length);
  ta.dispatchEvent(new Event('input'));
}

function insertText(text) {
  const ta = $('#composer-input');
  if (!ta) return;
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + text + value.slice(b);
  ta.setSelectionRange(a + text.length, a + text.length);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function onPaste(e) {
  const fl = [...(e.clipboardData?.files || [])];
  if (fl.length) { e.preventDefault(); attachFiles(fl); }
}

// --- упоминания ---
function mentionAutocomplete(ta) {
  const pop = $('.mention-pop', V.el);
  const chat = S.chats.get(V.chatId);
  const before = ta.value.slice(0, ta.selectionStart);
  const m = /(^|\s)@([\p{L}0-9._-]*)$/u.exec(before);
  if (!m || chat.type === 'direct' || chat.type === 'saved' || chat.type === 'ai') { pop.classList.add('hidden'); return; }
  const q = m[2].toLowerCase();
  const det = S.chatDetails?.get(chat.id);
  const members = det ? det.members : [];
  if (!det) app.loadChatDetails(chat.id).then(() => mentionAutocomplete(ta));
  const list = members.filter((u) => u.id !== S.me.id && !u.is_bot && (u.login.includes(q) || u.name.toLowerCase().includes(q))).slice(0, 7);
  if (!list.length) { pop.classList.add('hidden'); return; }
  pop.innerHTML = list.map((u, i) => `<button class="mp-item ${i === 0 ? 'on' : ''}" data-login="${esc(u.login)}">${avatar(u, 28)}<b>${esc(u.name)}</b><small>@${esc(u.login)}</small></button>`).join('')
    + (chat.type === 'group' && 'all'.startsWith(q) ? `<button class="mp-item" data-login="all"><span class="av av-icon">@</span><b>${esc(t('compose.mention_all'))}</b><small>@all</small></button>` : '');
  pop.classList.remove('hidden');
  pop.onclick = (e) => { const b = e.target.closest('.mp-item'); if (b) pickMention(b.dataset.login); };
}
function pickMention(login) {
  const ta = $('#composer-input');
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionStart);
  const start = before.replace(/@[\p{L}0-9._-]*$/u, '');
  ta.value = `${start}@${login} ${after}`;
  const pos = start.length + login.length + 2;
  ta.setSelectionRange(pos, pos);
  $('.mention-pop', V.el).classList.add('hidden');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// --- ответ / правка ---
function renderComposeCtx() {
  if (!V) return;
  const box = $('.compose-ctx', V.el);
  if (!box) return;
  const m = S.editing || S.replyTo;
  if (!m) { box.classList.add('hidden'); return; }
  const editing = !!S.editing;
  box.innerHTML = `<span class="cc-ic">${icon(editing ? 'edit' : 'reply', 20)}</span><div class="cc-body" data-action="jump" data-id="${m.id}">
    <b>${esc(editing ? t('compose.editing') : t('compose.reply_to', { name: m.user_id === S.me.id ? t('msg.you') : userName(m.user_id) }))}</b>
    <span>${esc(previewText(m))}</span></div><button class="icon-btn ghost" data-action="cancel-ctx">${icon('x', 18)}</button>`;
  box.classList.remove('hidden');
}
function cancelCtx() {
  const wasEditing = !!S.editing;
  S.replyTo = null;
  S.editing = null;
  renderComposeCtx();
  if (wasEditing) {
    const ta = $('#composer-input');
    ta.value = V.savedText || '';
    ta.dispatchEvent(new Event('input'));
  }
}
export function startReply(m) {
  S.editing = null;
  S.replyTo = m;
  renderComposeCtx();
  $('#composer-input')?.focus();
}
function startEdit(m) {
  const ta = $('#composer-input');
  if (!ta) return;
  if (!S.editing) V.savedText = ta.value;
  S.replyTo = null;
  S.editing = m;
  ta.value = m.body;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
  renderComposeCtx();
}

// --- отправка ---
let nonce = 0;
async function sendCurrent(opts = {}) {
  if (!V) return;
  const ta = $('#composer-input');
  const text = ta.value.trim();
  const chatId = V.chatId;
  if (S.editing) {
    const m = S.editing;
    if (!text && !m.file) return;
    S.editing = null;
    ta.value = V.savedText || '';
    ta.dispatchEvent(new Event('input'));
    renderComposeCtx();
    if (text === m.body) return;
    try { await patch(`/api/messages/${m.id}`, { body: text }); } catch (e) { toast(errText(e), { type: 'error' }); }
    return;
  }
  if (!text) { if (!opts.fromButton) return; startRecording(); return; }
  const reply = S.replyTo;
  S.replyTo = null;
  renderComposeCtx();
  ta.value = '';
  ta.dispatchEvent(new Event('input'));
  try { localStorage.removeItem(`gc-draft-${chatId}`); } catch { /* ignore */ }
  upsertChat({ id: chatId, draft: '' });
  if (opts.at) {
    try {
      await post(`/api/chats/${chatId}/schedule`, { body: text, at: opts.at, reply_to: reply?.id });
      toast(t('compose.scheduled_ok', { when: fmtDateTime(opts.at) }));
    } catch (e) { toast(errText(e), { type: 'error' }); ta.value = text; }
    return;
  }
  // Показываем сообщение сразу, до ответа сервера.
  const tmpId = 1e15 + ++nonce;
  const temp = { id: tmpId, chat_id: chatId, user_id: S.me.id, kind: 'text', body: text, reply: reply ? { ...reply, body: reply.body } : null, meta: {}, created_at: Date.now(), _pending: true, _nonce: tmpId, silent: !!opts.silent };
  pushPending(temp);
  try {
    const m = await post(`/api/chats/${chatId}/messages`, { body: text, reply_to: reply?.id, silent: !!opts.silent, ack_required: !!opts.ack });
    m._nonce = tmpId;
    resolvePending(chatId, tmpId, m);
  } catch (e) {
    failPending(chatId, tmpId);
    toast(errText(e), { type: 'error' });
  }
}

function pushPending(temp) {
  const st = store(temp.chat_id);
  if (st.hasMoreBottom) { scrollToBottom(false); }
  addMessage(temp);
}
function resolvePending(chatId, tmpId, m) {
  const st = store(chatId);
  const i = st.list.findIndex((x) => x.id === tmpId);
  const dup = st.list.findIndex((x) => x.id === m.id);
  if (dup >= 0 && i >= 0) {
    // Сервер уже прислал это сообщение через WebSocket — убираем временное.
    st.list.splice(i, 1);
    nodeOf(tmpId)?.remove();
    return;
  }
  if (i < 0) return;
  st.list[i] = m;
  const n = nodeOf(tmpId);
  if (n) { n.dataset.id = String(m.id); replaceNode(m); }
}
function failPending(chatId, tmpId) {
  const st = store(chatId);
  const m = st.list.find((x) => x.id === tmpId);
  if (!m) return;
  m._pending = false;
  m._failed = true;
  replaceNode(m);
}

function sendMenu(anchor) {
  contextMenu([
    { icon: 'clock', label: t('compose.send_later'), onClick: async () => { const at = await pickDateTime(t('compose.send_later')); if (at) sendCurrent({ at }); } },
    { icon: 'bellOff', label: t('compose.send_silent'), onClick: () => sendCurrent({ silent: true }) },
    { icon: 'calendar', label: t('compose.scheduled_list'), onClick: () => showScheduled() },
    ['group', 'channel'].includes(S.chats.get(V.chatId)?.type) && ['owner', 'admin'].includes(S.chats.get(V.chatId)?.my_role)
      && { icon: 'shield', label: t('ack.send'), onClick: () => sendCurrent({ ack: true }) },
  ], anchor);
}

async function showScheduled() {
  const list = await get(`/api/scheduled?chat_id=${V.chatId}`);
  const m = modal({
    title: t('compose.scheduled_list'),
    content: list.length ? `<div class="list">${list.map((s) => `<div class="li-row" data-sid="${s.id}"><div class="li-main"><b>${esc(fmtDateTime(s.run_at))}</b><span>${esc(s.kind === 'reminder' ? t('msg.reminder') : plain(s.body))}</span></div>
      <button class="icon-btn ghost" data-del="${s.id}">${icon('trash', 18)}</button></div>`).join('')}</div>` : `<p class="muted center">${esc(t('compose.scheduled_empty'))}</p>`,
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    await del(`/api/scheduled/${b.dataset.del}`);
    b.closest('.li-row').remove();
  });
}

// --- голосовые ---
async function startRecording() {
  if (!Recorder.supported()) { toast(t('voice.unsupported'), { type: 'error' }); return; }
  if (V.recorder) return;
  const rec = new Recorder();
  const box = $('.compose-row', V.el);
  try {
    await rec.start((sec, level) => {
      const time = box.querySelector('.rec-time');
      if (time) time.textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      const bars = box.querySelector('.rec-bars');
      if (bars) {
        bars.insertAdjacentHTML('beforeend', `<i style="height:${Math.max(8, level)}%"></i>`);
        while (bars.children.length > 60) bars.firstElementChild.remove();
      }
      if (sec > 600) stopRecording(true);
      if (Math.floor(sec) % 3 === 0) app.socket().send({ type: 'typing', chat_id: V?.chatId, action: 'recording' });
    });
  } catch { toast(t('call.no_mic'), { type: 'error' }); return; }
  V.recorder = rec;
  V.savedRow = box.innerHTML;
  box.innerHTML = `<div class="rec-box"><span class="rec-dot"></span><span class="rec-time">0:00</span><div class="rec-bars"></div>
    <button class="btn soft sm" data-action="rec-cancel">${esc(t('common.cancel'))}</button></div>
    <button class="send-btn" data-action="rec-send">${icon('send', 22)}</button>`;
}
async function stopRecording(send) {
  if (!V || !V.recorder) return;
  const rec = V.recorder;
  V.recorder = null;
  const chatId = V.chatId;
  renderComposer();
  if (!send) { rec.cancel(); return; }
  const out = await rec.stop();
  if (!out || out.duration < 0.7) return;
  const ext = out.blob.type.includes('mp4') ? 'm4a' : out.blob.type.includes('ogg') ? 'ogg' : 'webm';
  await sendFile(chatId, new File([out.blob], `voice.${ext}`, { type: out.blob.type }), { kind: 'voice', meta: { duration: Math.round(out.duration), waveform: out.waveform } });
}

// --- файлы ---
async function imageSize(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) { resolve({}); return; }
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
    img.onerror = () => resolve({});
    img.src = URL.createObjectURL(file);
  });
}
function kindOf(file) {
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) return 'image';
  if (/^video\/(mp4|webm|quicktime|ogg)$/.test(file.type)) return 'video';
  return 'file';
}

async function attachFiles(fileList) {
  if (!V) return;
  const max = S.meta.max_upload_mb * 1048576;
  const files = fileList.filter((f) => {
    if (f.size > max) { toast(t('err.too_big_n', { name: f.name, n: S.meta.max_upload_mb }), { type: 'error' }); return false; }
    return true;
  });
  if (!files.length) return;
  const chatId = V.chatId;
  const previews = await Promise.all(files.map(async (f) => ({ f, kind: kindOf(f), url: kindOf(f) === 'image' ? URL.createObjectURL(f) : null })));
  const m = modal({
    title: t('compose.send_files', { n: files.length }),
    content: `<div class="attach-list">${previews.map((p) => p.url ? `<div class="attach-img"><img src="${p.url}" alt=""></div>`
      : `<div class="doc">${`<span class="doc-ic">${icon('file', 22)}</span>`}<span class="doc-info"><span class="doc-name">${esc(p.f.name)}</span><span class="doc-size">${(p.f.size / 1048576).toFixed(2)} MB</span></span></div>`).join('')}</div>
      <label class="check"><input type="checkbox" id="as-files"> ${esc(t('compose.as_files'))}</label>
      <textarea class="input" id="attach-caption" rows="2" placeholder="${esc(t('compose.caption'))}">${esc($('#composer-input')?.value || '')}</textarea>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('compose.send'))}</button></div>`,
    onClose: () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)),
  });
  m.body.querySelector('[data-a=no]').onclick = () => m.close();
  const go = async () => {
    const caption = m.body.querySelector('#attach-caption').value.trim();
    const asFiles = m.body.querySelector('#as-files').checked;
    m.close();
    const ta = $('#composer-input');
    if (caption && ta && ta.value.trim() === caption) { ta.value = ''; ta.dispatchEvent(new Event('input')); }
    for (let i = 0; i < previews.length; i++) {
      const p = previews[i];
      await sendFile(chatId, p.f, { kind: asFiles ? 'file' : p.kind, caption: i === 0 ? caption : '' });
    }
  };
  m.body.querySelector('[data-a=yes]').onclick = go;
  m.body.querySelector('#attach-caption').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
}

async function sendFile(chatId, file, { kind, caption = '', meta = {} }) {
  const reply = S.replyTo;
  S.replyTo = null;
  renderComposeCtx();
  const sizeMeta = kind === 'image' ? await imageSize(file) : {};
  const tmpId = 1e15 + ++nonce;
  const temp = { id: tmpId, chat_id: chatId, user_id: S.me.id, kind: 'file', body: caption || '', file: { name: file.name, size: file.size, url: '#', meta: {} }, meta: {}, created_at: Date.now(), _pending: true, _nonce: tmpId };
  pushPending(temp);
  const n = nodeOf(tmpId);
  const bar = document.createElement('div');
  bar.className = 'upload-progress';
  n?.querySelector('.bubble')?.appendChild(bar);
  app.socket().send({ type: 'typing', chat_id: chatId, action: 'uploading' });
  try {
    const f = await upload(file, { meta: { ...sizeMeta, ...meta }, onProgress: (p) => { const el = nodeOf(tmpId)?.querySelector('.upload-progress'); if (el) el.style.width = `${Math.round(p * 100)}%`; } });
    const m = await post(`/api/chats/${chatId}/messages`, { kind, file_id: f.id, body: caption, reply_to: reply?.id });
    m._nonce = tmpId;
    resolvePending(chatId, tmpId, m);
  } catch (e) {
    failPending(chatId, tmpId);
    toast(errText(e), { type: 'error' });
  }
}

// --- опрос ---
function pollDialog() {
  const chatId = V.chatId;
  const m = modal({
    title: t('poll.new'),
    content: `<label class="field"><span>${esc(t('poll.question'))}</span><input class="input" id="pq" maxlength="300" autofocus></label>
      <div class="field"><span>${esc(t('poll.options'))}</span><div id="popts">${[0, 1].map(() => `<input class="input popt" maxlength="120">`).join('')}</div>
      <button class="link-btn" id="padd">+ ${esc(t('poll.add_option'))}</button></div>
      <label class="check"><input type="checkbox" id="panon" checked> ${esc(t('poll.anonymous'))}</label>
      <label class="check"><input type="checkbox" id="pmulti"> ${esc(t('poll.multiple'))}</label>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('poll.create'))}</button></div>`,
  });
  const b = m.body;
  b.querySelector('#padd').onclick = () => {
    if (b.querySelectorAll('.popt').length >= 12) return;
    b.querySelector('#popts').insertAdjacentHTML('beforeend', '<input class="input popt" maxlength="120">');
    b.querySelector('.popt:last-child').focus();
  };
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=yes]').onclick = async () => {
    try {
      await post(`/api/chats/${chatId}/polls`, {
        question: b.querySelector('#pq').value, options: [...b.querySelectorAll('.popt')].map((x) => x.value),
        anonymous: b.querySelector('#panon').checked, multiple: b.querySelector('#pmulti').checked,
      });
      m.close();
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}

// ---------- Меню сообщения ----------
function msgById(id) { return store(V.chatId).list.find((m) => m.id === Number(id)); }

function messageMenu(m, at) {
  const chat = S.chats.get(V.chatId);
  const mine = m.user_id === S.me.id;
  const admin = ['owner', 'admin'].includes(chat.my_role);
  const canPin = admin || ['direct', 'saved', 'ai'].includes(chat.type);
  const canWrite = !((chat.type === 'channel' || chat.only_admins_post) && !admin);
  const editable = mine && ['text', 'image', 'file', 'video'].includes(m.kind);
  const canDelete = mine || admin || chat.type === 'saved';
  const quick = (S.settings.quickReactions || S.meta.reactions.slice(0, 7)).slice(0, 7);
  const header = m.kind === 'system' ? '' : `<div class="ctx-reacts">${quick.map((e) => `<button data-qr="${e}">${e}</button>`).join('')}<button data-qr="+" class="more">${icon('plus', 16)}</button></div>`;
  const items = [
    canWrite && m.kind !== 'system' && { icon: 'reply', label: t('msg.reply'), onClick: () => startReply(m) },
    m.kind !== 'system' && !m.thread_id && ['group', 'channel', 'direct'].includes(chat.type) && { icon: 'chat', label: t('thread.reply'), onClick: () => app.openPanel({ type: 'thread', id: m.id }) },
    m.kind !== 'system' && canWrite && { icon: 'check', label: t('task.from_msg'), onClick: () => taskDialog({ chatId: chat.id, source: m }) },
    !mine && m.user_id && m.kind !== 'system' && ['group', 'direct'].includes(chat.type) && { icon: 'star', label: t('kudos.thank'), onClick: () => kudosDialog(chat.id, [m.user_id]) },
    editable && { icon: 'edit', label: t('msg.edit'), onClick: () => startEdit(m) },
    m.body && m.kind !== 'poll' && { icon: 'copy', label: t('msg.copy'), onClick: () => copyText(m.body).then(() => toast(t('msg.copied'))) },
    canPin && m.kind !== 'system' && { icon: 'pin', label: chat.pinned_msg_id === m.id ? t('msg.unpin') : t('msg.pin'), onClick: () => post(`/api/chats/${chat.id}/pin`, { message_id: chat.pinned_msg_id === m.id ? null : m.id }).catch((e) => toast(errText(e), { type: 'error' })) },
    m.kind !== 'system' && m.kind !== 'call' && { icon: 'forward', label: t('msg.forward'), onClick: () => forwardDialog([m.id]) },
    m.kind !== 'system' && { icon: 'clock', label: t('msg.remind'), onClick: () => remindDialog(m) },
    S.meta.ai && m.body && m.kind !== 'system' && { icon: 'translate', label: t('ai.translate'), onClick: () => translateMessage(m) },
    mine && chat.type === 'group' && { icon: 'eye', label: t('msg.seen_by'), onClick: () => readersDialog(m) },
    m.file && m.file.url !== '#' && { icon: 'download', label: t('msg.download'), onClick: () => { const a = document.createElement('a'); a.href = `${m.file.url}?download=1`; a.download = m.file.name; a.click(); } },
    m.kind !== 'system' && { icon: 'list', label: t('msg.select'), onClick: () => toggleSelect(m.id) },
    canDelete && { sep: true },
    canDelete && { icon: 'trash', label: t('msg.delete'), danger: true, onClick: () => deleteMessages([m.id]) },
  ];
  const el = contextMenu(items, at, { header });
  el.querySelectorAll('[data-qr]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      if (b.dataset.qr === '+') reactionPicker(m, at);
      else react(m.id, b.dataset.qr);
    };
  });
}

function reactionPicker(m, at) {
  const el = contextMenu([], at, { header: `<div class="ctx-emoji">${emojiPanelHtml()}</div>` });
  bindEmojiPanel(el, (e) => { closeMenu(); react(m.id, e); });
}

async function react(id, emoji) {
  pushRecent(emoji);
  try { await post(`/api/messages/${id}/react`, { emoji }); } catch (e) { toast(errText(e), { type: 'error' }); }
}

async function deleteMessages(ids) {
  const chat = S.chats.get(V.chatId);
  const ok = await confirmDialog(ids.length > 1 ? t('msg.delete_n_q', { n: ids.length }) : t('msg.delete_q'), {
    ok: t('msg.delete'), danger: true, extra: chat.type !== 'saved' ? `<p class="muted small">${esc(t('msg.delete_for_all'))}</p>` : '',
  });
  if (!ok) return;
  for (const id of ids) await del(`/api/messages/${id}`).catch((e) => toast(errText(e), { type: 'error' }));
  clearSelection();
}

async function remindDialog(m) {
  const at = await pickDateTime(t('msg.remind'));
  if (!at) return;
  try {
    await post(`/api/messages/${m.id}/remind`, { at });
    toast(t('msg.remind_ok', { when: fmtDateTime(at) }));
  } catch (e) { toast(errText(e), { type: 'error' }); }
}

async function readersDialog(m) {
  const list = await get(`/api/messages/${m.id}/readers`);
  modal({
    title: t('msg.seen_by'), cls: 'small',
    content: list.length ? `<div class="list">${list.map((u) => `<div class="li-row">${avatar(u, 36)}<div class="li-main"><b>${esc(u.name)}</b><span>${esc(u.position || '')}</span></div></div>`).join('')}</div>`
      : `<p class="muted center">${esc(t('msg.seen_nobody'))}</p>`,
  });
}

async function translateMessage(m) {
  const n = nodeOf(m.id);
  const text = n?.querySelector('.text');
  if (!text) return;
  let box = n.querySelector('.translation');
  if (box) { box.remove(); return; }
  box = document.createElement('div');
  box.className = 'translation';
  box.innerHTML = `<span class="spinner sm"></span> ${esc(t('ai.translating'))}`;
  text.after(box);
  try {
    const r = await post('/api/ai/translate', { message_id: m.id, lang: S.me.lang || document.documentElement.lang });
    box.innerHTML = `<small>${icon('translate', 12)} ${esc(t('ai.translated'))}</small>${esc(r.text).replace(/\n/g, '<br>')}`;
  } catch (e) { box.textContent = errText(e); }
}

export function forwardDialog(ids) {
  const list = [...S.chats.values()].filter((c) => !(c.type === 'channel' && !['owner', 'admin'].includes(c.my_role)) && c.type !== 'ai')
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const m = modal({
    title: t('msg.forward_to'),
    content: `<input class="input" id="fw-q" placeholder="${esc(t('common.search'))}" autofocus><div class="list pick-list">${list.map((c) => `<button class="li-row" data-fw="${c.id}" data-name="${esc(chatTitle(c, t).toLowerCase())}">
      ${avatar(peerOf(c) || c, 40, { kind: c.type === 'saved' ? 'saved' : null })}<div class="li-main"><b>${esc(chatTitle(c, t))}</b><span>${esc(c.type === 'direct' ? peerOf(c)?.position || '' : t(`chat.type_${c.type}`))}</span></div></button>`).join('')}</div>`,
  });
  m.body.querySelector('#fw-q').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    m.body.querySelectorAll('[data-fw]').forEach((b) => { b.style.display = b.dataset.name.includes(q) ? '' : 'none'; });
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fw]');
    if (!b) return;
    m.close();
    try {
      await post('/api/messages/forward', { ids, chat_id: Number(b.dataset.fw) });
      clearSelection();
      toast(t('msg.forwarded'), { action: () => app.openChatById(Number(b.dataset.fw)), actionLabel: t('common.open') });
    } catch (err) { toast(errText(err), { type: 'error' }); }
  });
}

// ---------- Выделение ----------
function toggleSelect(id) {
  if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id);
  nodeOf(id)?.classList.toggle('selected', S.selection.has(id));
  renderSelectBar();
}
function clearSelection() {
  S.selection.clear();
  $$('.msg.selected').forEach((n) => n.classList.remove('selected'));
  renderSelectBar();
}
function renderSelectBar() {
  if (!V) return;
  V.el.classList.toggle('selecting', S.selection.size > 0);
  let bar = $('.select-bar', V.el);
  if (!S.selection.size) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'select-bar';
    $('.composer', V.el).before(bar);
  }
  const chat = S.chats.get(V.chatId);
  const admin = ['owner', 'admin'].includes(chat.my_role) || chat.type === 'saved';
  const canDel = admin || [...S.selection].every((id) => msgById(id)?.user_id === S.me.id);
  bar.innerHTML = `<button class="icon-btn ghost" data-action="sel-clear">${icon('x')}</button><b>${esc(t('msg.selected_n', { n: S.selection.size }))}</b>
    <span class="grow"></span><button class="btn soft sm" data-action="sel-copy">${icon('copy', 16)} ${esc(t('msg.copy'))}</button>
    <button class="btn soft sm" data-action="sel-forward">${icon('forward', 16)} ${esc(t('msg.forward'))}</button>
    ${canDel ? `<button class="btn soft sm danger" data-action="sel-delete">${icon('trash', 16)} ${esc(t('msg.delete'))}</button>` : ''}`;
}

// ---------- Поиск по чату ----------
const chatSearch = debounce(async (q) => {
  if (!V) return;
  const box = $('.chat-search', V.el);
  const res = $('.cs-results', box);
  if (q.trim().length < 2) { res.innerHTML = ''; $('.cs-count', box).textContent = ''; return; }
  const r = await get(`/api/search?q=${encodeURIComponent(q)}&chat_id=${V.chatId}`).catch(() => ({ messages: [] }));
  $('.cs-count', box).textContent = r.messages.length ? String(r.messages.length) : t('common.nothing');
  res.innerHTML = r.messages.map((m) => `<button class="cs-item" data-action="jump" data-id="${m.id}" data-q="${esc(q)}">${avatar(S.users.get(m.user_id) || { name: userName(m.user_id) }, 32)}
    <div><b>${esc(userName(m.user_id))}</b><span>${esc(previewText(m)).slice(0, 160)}</span></div><small>${esc(fmtDateTime(m.created_at))}</small></button>`).join('');
}, 300);

function openSearch() {
  const box = $('.chat-search', V.el);
  box.classList.remove('hidden');
  const inp = $('input', box);
  inp.focus();
  inp.oninput = () => chatSearch(inp.value);
  inp.onkeydown = (e) => { if (e.key === 'Escape') closeSearch(); };
}
function closeSearch() {
  const box = $('.chat-search', V.el);
  box.classList.add('hidden');
  $('.cs-results', box).innerHTML = '';
  $('input', box).value = '';
}

export async function jumpTo(id, q = '') {
  if (!V) return;
  const st = store(V.chatId);
  if (!st.list.some((m) => m.id === id)) {
    await load(V.chatId, { around: id });
    renderAll();
  }
  highlightMessage(id, q);
}
function highlightMessage(id, q) {
  const n = nodeOf(id);
  if (!n) return;
  if (q) {
    const m = msgById(id);
    if (m) {
      const tmp = document.createElement('div');
      const st = store(V.chatId).list;
      const i = st.indexOf(m);
      tmp.innerHTML = messageHtml(m, S.chats.get(V.chatId), { prev: st[i - 1], next: st[i + 1], highlight: q });
      n.replaceWith(tmp.firstElementChild);
    }
  }
  const node = nodeOf(id);
  scrollToNode(node, 'center', true);
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1600);
}

// ---------- ИИ ----------
function aiMenu(anchor) {
  const ta = $('#composer-input');
  const has = ta.value.trim().length > 0;
  const run = async (mode) => {
    const original = ta.value;
    ta.disabled = true;
    anchor.classList.add('busy');
    try {
      if (mode === 'reply') {
        const r = await post('/api/ai/compose', { mode, chat_id: V.chatId, text: original });
        showSuggestions(r.suggestions || []);
      } else {
        const r = await post('/api/ai/compose', { mode, text: original });
        ta.value = r.text;
        toast(t('ai.rewritten'), { action: () => { ta.value = original; ta.dispatchEvent(new Event('input')); }, actionLabel: t('common.undo'), timeout: 6000 });
      }
    } catch (e) { toast(errText(e), { type: 'error' }); } finally {
      ta.disabled = false;
      anchor.classList.remove('busy');
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    }
  };
  contextMenu([
    { icon: 'sparkles', label: t('ai.suggest'), onClick: () => run('reply') },
    { icon: 'list', label: t('ai.summarize'), onClick: () => app.summarizeChat(V.chatId) },
    { sep: true },
    has && { icon: 'check', label: t('ai.improve'), onClick: () => run('improve') },
    has && { icon: 'briefcase', label: t('ai.formal'), onClick: () => run('formal') },
    has && { icon: 'smile', label: t('ai.friendly'), onClick: () => run('friendly') },
    has && { icon: 'minimize', label: t('ai.shorter'), onClick: () => run('shorter') },
    has && { icon: 'maximize', label: t('ai.longer'), onClick: () => run('longer') },
    has && { icon: 'translate', label: `${t('ai.translate_to')} English`, onClick: () => run('translate:en') },
    has && { icon: 'translate', label: `${t('ai.translate_to')} Українська`, onClick: () => run('translate:uk') },
    has && { icon: 'translate', label: `${t('ai.translate_to')} Deutsch`, onClick: () => run('translate:de') },
    has && { icon: 'translate', label: `${t('ai.translate_to')} Polski`, onClick: () => run('translate:pl') },
  ], anchor);
}

function showSuggestions(list) {
  if (!V || !list.length) return;
  const box = $('.compose-ctx', V.el);
  box.innerHTML = `<span class="cc-ic">${icon('sparkles', 20)}</span><div class="suggest-row">${list.map((s) => `<button class="chip-btn" data-action="use-suggest">${esc(s)}</button>`).join('')}</div>
    <button class="icon-btn ghost" data-action="cancel-ctx">${icon('x', 18)}</button>`;
  box.classList.remove('hidden');
}

// ---------- Меню чата ----------
function chatMenu(anchor) {
  const chat = S.chats.get(V.chatId);
  const muted = isMuted(chat);
  contextMenu([
    { icon: muted ? 'bell' : 'bellOff', label: muted ? t('chat.unmute') : t('chat.mute'), onClick: () => app.muteDialog(chat) },
    S.meta.ai && chat.type !== 'ai' && { icon: 'sparkles', label: t('ai.summarize'), onClick: () => app.summarizeChat(chat.id) },
    ['group', 'channel', 'direct'].includes(chat.type) && { icon: 'clock', label: t('compose.scheduled_list'), onClick: () => showScheduled() },
    { icon: 'check', label: t('msg.select'), onClick: () => { toast(t('msg.select_hint')); } },
    chat.type === 'group' && ['owner', 'admin'].includes(chat.my_role) && { icon: 'poll', label: t('poll.new'), onClick: () => pollDialog() },
    { icon: 'info', label: t('chat.info'), onClick: () => app.openPanel({ type: 'chat', id: chat.id }) },
    { sep: true },
    chat.type === 'direct' && { icon: 'trash', label: t('chat.delete_direct'), danger: true, onClick: () => app.hideDirect(chat) },
    ['group', 'channel'].includes(chat.type) && { icon: 'logout', label: chat.type === 'channel' ? t('chat.leave_channel') : t('chat.leave_group'), danger: true, onClick: () => app.leaveChat(chat) },
  ], anchor);
}

// ---------- Обработчики ----------
let longPress = null;
function bindChat() {
  const el = V.el;
  V.scroller.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('click', onClick);
  el.addEventListener('contextmenu', (e) => {
    const n = e.target.closest('.msg');
    if (!n || e.target.closest('a, video') || !n.dataset.id) return;
    e.preventDefault();
    const m = msgById(n.dataset.id);
    if (m && !m._pending) messageMenu(m, { x: e.clientX, y: e.clientY });
  });
  // Долгое нажатие на телефоне — меню сообщения.
  el.addEventListener('touchstart', (e) => {
    const n = e.target.closest('.msg');
    if (!n) return;
    const touch = e.touches[0];
    longPress = setTimeout(() => {
      longPress = null;
      const m = msgById(n.dataset.id);
      if (m && !m._pending) { navigator.vibrate?.(15); messageMenu(m, { x: touch.clientX, y: touch.clientY }); }
    }, 450);
  }, { passive: true });
  const cancelLp = () => { clearTimeout(longPress); longPress = null; };
  el.addEventListener('touchmove', cancelLp, { passive: true });
  el.addEventListener('touchend', cancelLp);
  // Двойной клик — ответить; свайп влево на телефоне — ответить.
  el.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.msg');
    if (!n || e.target.closest('.poll, a, button, .voice')) return;
    const m = msgById(n.dataset.id);
    if (m && m.kind !== 'system' && !m._pending) { window.getSelection()?.removeAllRanges(); startReply(m); }
  });
  let sx = 0;
  let sy = 0;
  let swNode = null;
  el.addEventListener('touchstart', (e) => { const n = e.target.closest('.msg:not(.system)'); swNode = n; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!swNode) return;
    const dx = e.touches[0].clientX - sx;
    const dy = Math.abs(e.touches[0].clientY - sy);
    if (dy > 30) { swNode.style.transform = ''; swNode = null; return; }
    if (dx < 0) swNode.style.transform = `translateX(${Math.max(dx, -70)}px)`;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!swNode) return;
    const dx = e.changedTouches[0].clientX - sx;
    swNode.style.transform = '';
    if (dx < -60) { const m = msgById(swNode.dataset.id); if (m && !m._pending) startReply(m); }
    swNode = null;
  });
  // Перетаскивание файлов
  let dragDepth = 0;
  const dz = $('.drop-zone', el);
  el.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; dz.classList.remove('hidden'); } });
  el.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.classList.add('hidden'); });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dz.classList.add('hidden');
    const fl = [...(e.dataTransfer?.files || [])];
    if (fl.length) attachFiles(fl);
  });
}

function onClick(e) {
  const n = e.target.closest('.msg');
  if (S.selection.size && n && !e.target.closest('[data-action=user]')) {
    e.preventDefault();
    if (n.dataset.id && !n.classList.contains('system')) toggleSelect(Number(n.dataset.id));
    return;
  }
  const a = e.target.closest('[data-action]');
  if (!a) {
    if (!e.target.closest('.emoji-pop, [data-action=emoji]')) $('.emoji-pop', V.el)?.classList.add('hidden');
    return;
  }
  const act = a.dataset.action;
  const chat = S.chats.get(V.chatId);
  switch (act) {
    case 'back': app.navigate(''); break;
    case 'info': app.openPanel(chat.type === 'direct' ? { type: 'user', id: peerOf(chat).id, chatId: chat.id } : { type: 'chat', id: chat.id }); break;
    case 'search': openSearch(); break;
    case 'search-close': closeSearch(); break;
    case 'call': startCall(chat.id, a.dataset.media); break;
    case 'call-back': startCall(chat.id, a.dataset.media); break;
    case 'join-call': joinCall(Number(a.dataset.id), 'audio'); break;
    case 'chat-menu': chatMenu(a); break;
    case 'to-bottom': scrollToBottom(true); break;
    case 'send': sendCurrent({ fromButton: true }); break;
    case 'rec-cancel': stopRecording(false); break;
    case 'rec-send': stopRecording(true); break;
    case 'emoji': $('.emoji-pop', V.el).classList.toggle('hidden'); break;
    case 'attach':
      contextMenu([
        { icon: 'image', label: t('compose.photo_video'), onClick: () => { const fi = $('#file-input'); fi.accept = 'image/*,video/*'; fi.click(); } },
        { icon: 'file', label: t('compose.file'), onClick: () => { const fi = $('#file-input'); fi.accept = ''; fi.click(); } },
        { icon: 'videoNote', label: t('vnote.record'), onClick: () => recordVideoNote(chat.id) },
        { sep: true },
        chat.type !== 'ai' && { icon: 'check', label: t('task.new'), onClick: () => taskDialog({ chatId: chat.id }) },
        ['group', 'direct'].includes(chat.type) && { icon: 'briefcase', label: t('appr.new'), onClick: () => approvalDialog(chat.id) },
        ['group', 'direct', 'channel'].includes(chat.type) && { icon: 'calendar', label: t('meet.new'), onClick: () => meetingDialog(chat.id) },
        ['group', 'direct'].includes(chat.type) && { icon: 'star', label: t('kudos.new'), onClick: () => kudosDialog(chat.id) },
        chat.type !== 'direct' && chat.type !== 'saved' && chat.type !== 'ai' && { icon: 'poll', label: t('poll.new'), onClick: () => pollDialog() },
        { sep: true },
        { icon: 'clock', label: t('compose.send_later'), onClick: async () => { if (!$('#composer-input').value.trim()) { toast(t('compose.type_first')); return; } const at = await pickDateTime(t('compose.send_later')); if (at) sendCurrent({ at }); } },
      ], a);
      break;
    case 'ai-menu': aiMenu(a); break;
    case 'ai-prompt': { const ta = $('#composer-input'); ta.value = a.dataset.text; ta.dispatchEvent(new Event('input')); ta.focus(); break; }
    case 'use-suggest': { const ta = $('#composer-input'); ta.value = a.textContent; ta.dispatchEvent(new Event('input')); ta.focus(); cancelCtx(); break; }
    case 'cancel-ctx': cancelCtx(); break;
    case 'jump': jumpTo(Number(a.dataset.id), a.dataset.q || ''); if (a.closest('.cs-results')) { /* остаёмся в поиске */ } break;
    case 'unpin': post(`/api/chats/${chat.id}/pin`, { message_id: null }); break;
    case 'toggle-mute': app.muteDialog(chat); break;
    case 'react': react(Number(a.dataset.id), a.dataset.emoji); break;
    case 'quick-react': { const m = msgById(a.dataset.id); if (m) messageMenu(m, a); break; }
    case 'vote': {
      const m = msgById(a.dataset.id);
      const opt = Number(a.dataset.opt);
      if (!m || m.meta.closed) break;
      let options = [opt];
      if (m.meta.multiple) { const mine = new Set(m.poll.mine); if (mine.has(opt)) mine.delete(opt); else mine.add(opt); options = [...mine]; }
      else if (m.poll.mine.includes(opt)) options = [];
      post(`/api/messages/${m.id}/vote`, { options }).catch((err) => toast(errText(err), { type: 'error' }));
      break;
    }
    case 'close-poll': post(`/api/messages/${a.dataset.id}/close-poll`).catch((err) => toast(errText(err), { type: 'error' })); break;
    case 'user': app.openPanel({ type: 'user', id: Number(a.dataset.uid) }); break;
    case 'thread': app.openPanel({ type: 'thread', id: Number(a.dataset.id) }); break;
    default: if (!handleCardAction(act, a)) { /* нет обработчика */ }
    case 'mention': app.openUserByLogin(a.dataset.login); break;
    case 'spoiler': a.classList.add('shown'); break;
    case 'view-media': app.viewMedia(V.chatId, Number(a.dataset.id)); break;
    case 'voice-play': toggleVoice(a.closest('.voice')); break;
    case 'voice-seek': seekVoice(a.closest('.voice'), e); break;
    case 'voice-speed': cycleSpeed(a.closest('.voice')); break;
    case 'send-emoji': { const ta = $('#composer-input'); ta.value = a.dataset.emoji; sendCurrent(); break; }
    case 'goto': app.openChatById(Number(a.dataset.chat), { jumpTo: Number(a.dataset.mid) }); break;
    case 'sel-clear': clearSelection(); break;
    case 'sel-forward': forwardDialog([...S.selection].sort((x, y) => x - y)); break;
    case 'sel-delete': deleteMessages([...S.selection]); break;
    case 'sel-copy': {
      const text = [...S.selection].sort((x, y) => x - y).map((id) => msgById(id)).filter(Boolean).map((m) => `${userName(m.user_id)}: ${m.body}`).join('\n');
      copyText(text).then(() => toast(t('msg.copied')));
      clearSelection();
      break;
    }
  }
}

// Esc закрывает поиск, выделение, ответ.
document.addEventListener('keydown', (e) => {
  if (!V || e.key !== 'Escape') return;
  if (S.selection.size) { clearSelection(); e.stopPropagation(); }
});

// ---------- Общие действия карточек (лента и панель ветки) ----------
export function handleCardAction(act, a) {
  switch (act) {
    case 'task-status': setTaskStatus(Number(a.dataset.tid), a.dataset.status); return true;
    case 'task-open': {
      const id = Number(a.dataset.tid);
      const msg = [...S.messages.values()].flatMap((x) => x.list).find((x) => x.task?.id === id);
      if (msg?.task) taskDialog({ task: msg.task });
      return true;
    }
    case 'approve': decideApproval(Number(a.dataset.id), 'approve'); return true;
    case 'reject': decideApproval(Number(a.dataset.id), 'reject'); return true;
    case 'rsvp': rsvp(Number(a.dataset.mid), a.dataset.r); return true;
    case 'meeting-join': {
      const id = Number(a.dataset.mid);
      const msg = [...S.messages.values()].flatMap((x) => x.list).find((x) => x.meeting?.id === id || x.meta?.meeting_id === id);
      const chatId = msg?.chat_id || V?.chatId;
      if (chatId) startCall(chatId, 'video');
      return true;
    }
    case 'ack': ackMessage(Number(a.dataset.id)); return true;
    case 'ack-list': ackListDialog(Number(a.dataset.id)); return true;
    case 'round-play': {
      const v = a.querySelector('video');
      if (!v) return true;
      if (v.muted || v.paused) {
        document.querySelectorAll('.round-video.playing video').forEach((x) => { if (x !== v) { x.muted = true; x.closest('.round-video').classList.remove('playing'); } });
        v.muted = false; v.loop = false; v.currentTime = v.paused ? v.currentTime : 0; v.play().catch(() => {});
        a.classList.add('playing', 'expanded');
        v.onended = () => { a.classList.remove('playing', 'expanded'); v.muted = true; v.loop = true; v.play().catch(() => {}); };
        v.ontimeupdate = () => { const ring = a.querySelector('.round-ring circle'); if (ring && v.duration) ring.style.strokeDashoffset = String(301.6 * (1 - v.currentTime / v.duration)); };
      } else { v.pause(); a.classList.remove('playing'); }
      return true;
    }
    default: return false;
  }
}

// Видео-кружки в ленте тихо крутятся, когда видны на экране.
const roundObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target.querySelector('video');
    if (!v || e.target.classList.contains('playing')) continue;
    if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
  }
}, { threshold: 0.6 }) : null;
const roundMut = new MutationObserver(() => {
  if (!roundObserver) return;
  document.querySelectorAll('.round-video:not([data-obs])').forEach((el) => { el.dataset.obs = '1'; roundObserver.observe(el); });
});
roundMut.observe(document.body, { childList: true, subtree: true });

// ---------- Шаблоны быстрых ответов: «/» в начале поля ----------
function templatesPopup(ta) {
  const pop = $('.mention-pop', V.el);
  const m = /^\/([\p{L}0-9 ]*)$/u.exec(ta.value);
  const list = S.settings.templates || [];
  if (!m || !list.length) { if (pop.dataset.mode === 'tpl') { pop.classList.add('hidden'); pop.dataset.mode = ''; } return; }
  const q = m[1].toLowerCase();
  const found = list.filter((x) => x.toLowerCase().includes(q)).slice(0, 8);
  if (!found.length) { pop.classList.add('hidden'); return; }
  pop.dataset.mode = 'tpl';
  pop.innerHTML = `<div class="mp-head">${esc(t('tpl.title'))}</div>` + found.map((x, i) => `<button class="mp-item ${i === 0 ? 'on' : ''}" data-tpl="${esc(x)}">${icon('list', 16)}<b>${esc(x.slice(0, 120))}</b></button>`).join('');
  pop.classList.remove('hidden');
  pop.onclick = (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    ta.value = b.dataset.tpl;
    pop.classList.add('hidden');
    pop.dataset.mode = '';
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
}
