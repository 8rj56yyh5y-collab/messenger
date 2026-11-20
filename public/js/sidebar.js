// Левая колонка: поиск, папки, список чатов, боковое меню.
import { S, emit, on, chatTitle, peerOf, isMuted, userName } from './store.js';
import { t } from './i18n.js';
import { $, esc, avatar, fmtListTime, debounce, fmtDateTime } from './util.js';
import { icon } from './icons.js';
import { get, patch } from './api.js';
import { previewText } from './messages.js';
import { contextMenu } from './dialogs.js';
import * as app from './app.js';

const FOLDERS = ['all', 'unread', 'personal', 'groups', 'channels'];

export function sidebarHtml() {
  return `<div class="side-head">
      <button class="icon-btn ghost" data-sa="drawer" aria-label="menu">${icon('menu')}</button>
      <div class="search-box">${icon('search', 18)}<input id="side-search" placeholder="${esc(t('common.search'))}" autocomplete="off"><button class="icon-btn ghost xs hidden" data-sa="search-clear">${icon('x', 16)}</button></div>
    </div>
    <div class="conn-state hidden"></div>
    <div class="folders" role="tablist"></div>
    <div class="side-body"><div class="chat-list" role="list"></div><div class="search-results hidden"></div></div>
    <button class="fab" data-sa="new" aria-label="${esc(t('side.new'))}">${icon('edit', 22)}</button>`;
}

export function bindSidebar() {
  const side = $('#sidebar');
  side.addEventListener('click', onClick);
  side.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-chat]');
    if (!row) return;
    e.preventDefault();
    chatRowMenu(Number(row.dataset.chat), { x: e.clientX, y: e.clientY });
  });
  const inp = $('#side-search');
  inp.addEventListener('input', () => {
    side.querySelector('[data-sa=search-clear]').classList.toggle('hidden', !inp.value);
    globalSearch(inp.value);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { inp.value = ''; globalSearch(''); inp.blur(); }
    if (e.key === 'Enter') { const first = side.querySelector('.search-results [data-chat], .search-results [data-user]'); first?.click(); }
  });
  renderFolders();
  renderList();
}

function counts() {
  const c = { all: 0, unread: 0, personal: 0, groups: 0, channels: 0, archive: 0 };
  for (const ch of S.chats.values()) {
    const un = ch.unread > 0 || ch.manual_unread ? 1 : 0;
    if (!un || isMuted(ch)) continue;
    if (ch.archived) { c.archive += 1; continue; }
    c.all += 1; c.unread += 1;
    if (['direct', 'saved', 'ai'].includes(ch.type)) c.personal += 1;
    if (ch.type === 'group') c.groups += 1;
    if (ch.type === 'channel') c.channels += 1;
  }
  return c;
}

function renderFolders() {
  const el = $('#sidebar .folders');
  if (!el) return;
  const c = counts();
  const hasArchive = [...S.chats.values()].some((x) => x.archived);
  const list = hasArchive ? [...FOLDERS, 'archive'] : FOLDERS;
  if (!hasArchive && S.folder === 'archive') S.folder = 'all';
  el.innerHTML = list.map((f) => `<button class="folder ${S.folder === f ? 'on' : ''}" data-folder="${f}" role="tab">${esc(t(`folder.${f}`))}${c[f] ? `<span class="fbadge">${c[f]}</span>` : ''}</button>`).join('');
}

function inFolder(c) {
  if (S.folder === 'archive') return !!c.archived;
  if (c.archived) return false;
  switch (S.folder) {
    case 'unread': return c.unread > 0 || c.manual_unread || c.id === S.current;
    case 'personal': return ['direct', 'saved', 'ai'].includes(c.type);
    case 'groups': return c.type === 'group';
    case 'channels': return c.type === 'channel';
    default: return true;
  }
}

function sortChats(list) {
  return list.sort((a, b) => {
    if (!!a.pinned_at !== !!b.pinned_at) return a.pinned_at ? -1 : 1;
    if (a.pinned_at && b.pinned_at) return a.pinned_at - b.pinned_at;
    const ta = Math.max(a.last?.created_at || a.updated_at || 0, a.draft ? a.updated_at : 0);
    const tb = Math.max(b.last?.created_at || b.updated_at || 0, b.draft ? b.updated_at : 0);
    return tb - ta;
  });
}

function typingText(c) {
  const map = S.typing.get(c.id);
  if (!map) return '';
  const now = Date.now();
  const act = [...map].filter(([, v]) => v.until > now);
  if (!act.length) return '';
  const [uid, v] = act[0];
  const who = c.type === 'direct' ? '' : `${userName(uid).split(' ')[0]} `;
  return `<span class="typing">${esc(who + t(`typing.${v.action}`))}<i></i><i></i><i></i></span>`;
}

function rowHtml(c) {
  const peer = peerOf(c);
  const kind = c.type === 'saved' ? 'saved' : c.type === 'ai' ? 'ai' : null;
  const online = c.type === 'direct' && peer && S.online.has(peer.id);
  const last = c.last;
  const draft = c.draft && c.id !== S.current ? `<span class="draft">${esc(t('chat.draft'))}:</span> ${esc(c.draft.slice(0, 80))}` : '';
  const typing = typingText(c);
  let preview = typing || draft || (last ? previewText(last, { withAuthor: true, chat: c }) : `<span class="muted">${esc(c.type === 'saved' ? t('chat.saved_sub') : c.type === 'ai' ? t('ai.sub') : t('chat.no_messages'))}</span>`);
  if (!typing && !draft && last && last.user_id === S.me.id && c.type !== 'saved' && c.type !== 'channel' && last.kind !== 'system' && last.kind !== 'call') {
    const read = c.others_read_id >= last.id;
    preview = `<span class="tick ${read ? 'read' : ''}">${icon(read ? 'check2' : 'check', 15)}</span>${preview}`;
  }
  const muted = isMuted(c);
  const unread = c.unread > 0 ? `<span class="ubadge ${muted ? 'muted' : ''}">${c.unread > 999 ? '999+' : c.unread}</span>` : c.manual_unread ? `<span class="ubadge dot ${muted ? 'muted' : ''}"></span>` : '';
  const mention = c.mentions > 0 ? `<span class="ubadge at">@</span>` : '';
  const callNow = [...S.calls.values()].some((x) => x.chat_id === c.id);
  const typeIc = c.type === 'channel' ? icon('megaphone', 14, 'type-ic') : c.type === 'group' ? icon('users', 14, 'type-ic') : '';
  return `<div class="chat-row ${c.id === S.current ? 'on' : ''}" data-chat="${c.id}" role="listitem" tabindex="0">
    ${avatar(peer || c, 52, { kind, online })}
    <div class="cr-main">
      <div class="cr-top"><span class="cr-title">${typeIc}${esc(chatTitle(c, t))}${peer?.is_bot && c.type !== 'ai' ? ' <span class="bot-badge">bot</span>' : ''}${muted ? icon('bellOff', 13, 'muted-ic') : ''}</span>
        <span class="cr-time">${callNow ? `<span class="live-call">${icon('phone', 12)}</span>` : ''}${fmtListTime(last?.created_at || c.updated_at)}</span></div>
      <div class="cr-bottom"><span class="cr-prev">${preview}</span><span class="cr-badges">${mention}${unread}${c.pinned_at && !unread && !mention ? icon('pin', 14, 'pin-ic') : ''}</span></div>
    </div></div>`;
}

export function renderList() {
  const el = $('#sidebar .chat-list');
  if (!el) return;
  const list = sortChats([...S.chats.values()].filter(inFolder));
  if (!list.length) {
    el.innerHTML = `<div class="side-empty">${icon(S.folder === 'unread' ? 'check2' : 'users', 34)}<p>${esc(S.folder === 'unread' ? t('side.all_read') : t('side.no_chats'))}</p>
      ${S.folder === 'all' ? `<button class="btn sm" data-sa="contacts">${esc(t('side.find_people'))}</button>` : ''}</div>`;
  } else el.innerHTML = list.map(rowHtml).join('');
  renderFolders();
  updateTitleBadge();
}

function updateTitleBadge() {
  let n = 0;
  for (const c of S.chats.values()) if (c.unread && !isMuted(c) && !c.archived) n += 1;
  document.title = n ? `(${n}) ${S.meta?.name || 'Gobsek Chat'}` : S.meta?.name || 'Gobsek Chat';
  if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge?.().catch(() => {}); }
}

export function renderConnState() {
  const el = $('#sidebar .conn-state');
  if (!el) return;
  const st = S.connection;
  el.classList.toggle('hidden', st === 'online');
  el.innerHTML = st === 'online' ? '' : `<span class="spinner sm"></span> ${esc(st === 'connecting' ? t('conn.connecting') : t('conn.offline'))}`;
}

on('chats:changed', renderList);
on('chat:opened', renderList);
on('presence', renderList);
on('call:changed', renderList);
on('connection', renderConnState);

// ---------- Глобальный поиск ----------
const globalSearch = debounce(async (q) => {
  const box = $('#sidebar .search-results');
  const list = $('#sidebar .chat-list');
  const folders = $('#sidebar .folders');
  if (!q.trim()) { box.classList.add('hidden'); list.classList.remove('hidden'); folders.classList.remove('hidden'); return; }
  box.classList.remove('hidden');
  list.classList.add('hidden');
  folders.classList.add('hidden');
  const ql = q.toLowerCase();
  const local = [...S.chats.values()].filter((c) => chatTitle(c, t).toLowerCase().includes(ql)).slice(0, 8);
  box.innerHTML = `<div class="sr-sec">${local.map(rowHtml).join('')}</div><div class="sr-loading"><span class="spinner sm"></span></div>`;
  if (q.trim().length < 2) { box.querySelector('.sr-loading')?.remove(); return; }
  const r = await get(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({ users: [], chats: [], messages: [] }));
  if ($('#side-search').value !== q) return;
  const localIds = new Set(local.map((c) => c.id));
  const directPeers = new Set([...S.chats.values()].filter((c) => c.type === 'direct' && localIds.has(c.id)).map((c) => c.peer?.id));
  const users = r.users.filter((u) => !directPeers.has(u.id));
  const chats = r.chats.filter((c) => !localIds.has(c.id));
  let html = local.length ? `<div class="sr-sec">${local.map(rowHtml).join('')}</div>` : '';
  if (users.length) {
    html += `<div class="sr-title">${esc(t('search.people'))}</div>${users.map((u) => `<div class="chat-row" data-user="${u.id}">${avatar(u, 46, { online: S.online.has(u.id), kind: u.login === 'ai.assistant' ? 'ai' : null })}
      <div class="cr-main"><div class="cr-top"><span class="cr-title">${esc(u.name)}</span></div><div class="cr-bottom"><span class="cr-prev">${esc([u.position, u.department].filter(Boolean).join(' · ') || `@${u.login}`)}</span></div></div></div>`).join('')}`;
  }
  if (chats.length) {
    html += `<div class="sr-title">${esc(t('search.chats'))}</div>${chats.map((c) => `<div class="chat-row" data-join="${c.id}">${avatar(c, 46)}
      <div class="cr-main"><div class="cr-top"><span class="cr-title">${esc(c.title)}</span></div><div class="cr-bottom"><span class="cr-prev">${esc(c.type === 'channel' ? t('chat.subscribers', { n: c.members_count }) : t('chat.members', { n: c.members_count }))}</span></div></div></div>`).join('')}`;
  }
  if (r.messages.length) {
    html += `<div class="sr-title">${esc(t('search.messages'))}</div>${r.messages.map((m) => {
      const c = S.chats.get(m.chat_id);
      if (!c) return '';
      return `<div class="chat-row" data-msg="${m.id}" data-mchat="${m.chat_id}">${avatar(peerOf(c) || c, 46, { kind: c.type === 'saved' ? 'saved' : c.type === 'ai' ? 'ai' : null })}
        <div class="cr-main"><div class="cr-top"><span class="cr-title">${esc(chatTitle(c, t))}</span><span class="cr-time">${esc(fmtDateTime(m.created_at))}</span></div>
        <div class="cr-bottom"><span class="cr-prev">${previewText(m, { withAuthor: true, chat: c })}</span></div></div></div>`;
    }).join('')}`;
  }
  if (!html) html = `<div class="side-empty"><p>${esc(t('search.nothing'))}</p></div>`;
  box.innerHTML = html;
  box.dataset.q = q;
}, 250);

function clearSearch() {
  const inp = $('#side-search');
  inp.value = '';
  $('#sidebar [data-sa=search-clear]').classList.add('hidden');
  globalSearch('');
}

// ---------- Меню строки чата ----------
function chatRowMenu(id, at) {
  const c = S.chats.get(id);
  if (!c) return;
  const muted = isMuted(c);
  contextMenu([
    { icon: 'pin', label: c.pinned_at ? t('chat.unpin') : t('chat.pin'), onClick: () => setMember(c, { pinned: !c.pinned_at }) },
    { icon: muted ? 'bell' : 'bellOff', label: muted ? t('chat.unmute') : t('chat.mute'), onClick: () => app.muteDialog(c) },
    c.unread || c.manual_unread
      ? { icon: 'check2', label: t('chat.mark_read'), onClick: () => app.markChatRead(c) }
      : { icon: 'unread', label: t('chat.mark_unread'), onClick: () => setMember(c, { manual_unread: true }) },
    c.type !== 'saved' && { icon: 'archive', label: c.archived ? t('chat.unarchive') : t('chat.archive'), onClick: () => setMember(c, { archived: !c.archived }) },
    { sep: true },
    c.type === 'direct' && { icon: 'trash', label: t('chat.delete_direct'), danger: true, onClick: () => app.hideDirect(c) },
    ['group', 'channel'].includes(c.type) && { icon: 'logout', label: c.type === 'channel' ? t('chat.leave_channel') : t('chat.leave_group'), danger: true, onClick: () => app.leaveChat(c) },
  ], at);
}

async function setMember(c, body) {
  try {
    const out = await patch(`/api/chats/${c.id}/me`, body);
    app.applyChat(out);
  } catch (e) { app.showError(e); }
}

// ---------- Клики ----------
function onClick(e) {
  const sa = e.target.closest('[data-sa]');
  if (sa) {
    switch (sa.dataset.sa) {
      case 'drawer': app.openDrawer(); break;
      case 'new': newMenu(sa); break;
      case 'contacts': app.openContacts(); break;
      case 'search-clear': clearSearch(); break;
      default:
    }
    return;
  }
  const f = e.target.closest('[data-folder]');
  if (f) { S.folder = f.dataset.folder; renderList(); $('#sidebar .side-body').scrollTop = 0; return; }
  const row = e.target.closest('[data-chat]');
  if (row) { app.openChatById(Number(row.dataset.chat)); if ($('#side-search').value) clearSearch(); return; }
  const u = e.target.closest('[data-user]');
  if (u) { app.openDirect(Number(u.dataset.user)); clearSearch(); return; }
  const j = e.target.closest('[data-join]');
  if (j) { app.previewPublicChat(Number(j.dataset.join)); return; }
  const msg = e.target.closest('[data-msg]');
  if (msg) {
    const q = $('#sidebar .search-results').dataset.q || '';
    app.openChatById(Number(msg.dataset.mchat), { jumpTo: Number(msg.dataset.msg), q });
  }
}

function newMenu(anchor) {
  contextMenu([
    { icon: 'user', label: t('side.new_message'), onClick: () => app.openContacts() },
    { icon: 'users', label: t('side.new_group'), onClick: () => app.newChatDialog('group') },
    { icon: 'megaphone', label: t('side.new_channel'), onClick: () => app.newChatDialog('channel') },
    { icon: 'globe', label: t('side.catalog'), onClick: () => app.openCatalog() },
  ], anchor);
}

export function focusSearch() { $('#side-search')?.focus(); }
emit('sidebar:ready');
