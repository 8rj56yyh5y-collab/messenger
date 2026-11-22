// Точка входа: вход, оболочка приложения, события сервера, уведомления, общие окна.
import { S, emit, on, upsertChat, upsertUser, chatTitle, peerOf, isMuted, userName } from './store.js';
import { t, setLang, detectLang, errText, LANGS, getLang } from './i18n.js';
import { $, $$, esc, avatar, fmtDateTime, fmtDuration, plain, isMobile, setTimeFormat } from './util.js';
import { icon } from './icons.js';
import { get, post, patch, del, Socket, setUnauthorizedHandler } from './api.js';
import { modal, toast, confirmDialog, closeTopModal, hasModal, closeMenu, contextMenu } from './dialogs.js';
import { sidebarHtml, bindSidebar, renderList, focusSearch } from './sidebar.js';
import { openChat, closeChat, emptyHtml, currentView, jumpTo } from './chat.js';
import { openPanel as _openPanel, closePanel, panelState } from './panel.js';
import { initCalls, handleCallEvent, startCall, currentCall } from './call.js';
import { previewText } from './messages.js';
import { openSettings, applyTheme, applyAppearance } from './settings.js';
import { openAdmin } from './admin.js';
import { openHelp } from './help.js';
import { showPage, hidePage, currentPage } from './pages.js';
import { syncPush } from './push.js';

let sock = null;
export const socket = () => sock;
S.chatDetails = new Map();

// ---------- Запуск ----------
async function boot() {
  setLang(detectLang());
  applyTheme();
  S.meta = await get('/api/meta').catch(() => ({ name: 'Gobsek Chat', langs: [], reactions: ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉'], max_upload_mb: 100 }));
  document.title = S.meta.name;
  setUnauthorizedHandler(() => { if (S.me) location.reload(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const { user } = await get('/api/me');
    await start(user);
  } catch {
    authScreen();
  }
}

// ---------- Экраны входа ----------
function hashParam(prefix) {
  const m = new RegExp(`^#/${prefix}/([\\w-]+)`).exec(location.hash);
  return m ? m[1] : null;
}

function authShell(inner) {
  const langSel = `<div class="auth-lang">${LANGS.map((l) => `<button class="${l.code === getLang() ? 'on' : ''}" data-lang="${l.code}">${l.code.toUpperCase()}</button>`).join('')}</div>`;
  $('#app').innerHTML = `<div class="auth"><div class="auth-card">${langSel}
    <div class="auth-logo"><span class="logo-mark">${icon('send', 30)}</span><h1>${esc(S.meta.name)}</h1><p>${esc(t('auth.tagline'))}</p></div>${inner}</div>
    <div class="auth-foot">${esc(t('auth.foot'))} · v${esc(S.meta.version || '')}</div></div>`;
  $$('.auth-lang [data-lang]').forEach((b) => { b.onclick = () => { setLang(b.dataset.lang); authScreen(); }; });
}

function authScreen() {
  const ssoErr = new URLSearchParams(location.search).get('sso_error');
  if (S.meta.needs_setup) return setupScreen();
  const invite = hashParam('invite');
  if (invite) return registerScreen(invite);
  authShell(`<form class="auth-form" id="login-form">
      ${ssoErr ? `<div class="form-error">${esc(t(`err.${ssoErr}`))}</div>` : ''}
      <label class="field"><span>${esc(t('auth.login'))}</span><input class="input" name="login" autocomplete="username" required autofocus></label>
      <label class="field"><span>${esc(t('auth.password'))}</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error hidden"></div>
      <button class="btn lg block" type="submit">${esc(t('auth.sign_in'))}</button>
      ${S.meta.sso && S.meta.sso_start ? `<div class="or"><span>${esc(t('auth.or'))}</span></div>
        <a class="btn lg block soft" href="${esc(S.meta.sso_start)}">${icon('shield', 18)} ${esc(t('auth.via_gobsek'))}</a>` : ''}
      <p class="muted small center">${esc(t('auth.no_account'))}</p></form>`);
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = $('#login-form .form-error.hidden') || $('#login-form .form-error');
    try {
      const { user } = await post('/api/login', { login: f.get('login'), password: f.get('password') });
      history.replaceState(null, '', location.pathname + location.hash);
      await start(user);
    } catch (ex) {
      err.textContent = errText(ex);
      err.classList.remove('hidden');
    }
  };
}

function setupScreen() {
  authShell(`<form class="auth-form" id="setup-form"><h2>${esc(t('setup.title'))}</h2><p class="muted">${esc(t('setup.text'))}</p>
    <label class="field"><span>${esc(t('setup.company'))}</span><input class="input" name="company" value="Gobsek"></label>
    <label class="field"><span>${esc(t('profile.name'))}</span><input class="input" name="name" required autofocus></label>
    <label class="field"><span>${esc(t('auth.login'))}</span><input class="input" name="login" required pattern="[a-zA-Z0-9._-]{3,32}"></label>
    <label class="field"><span>${esc(t('auth.password'))}</span><input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></label>
    <div class="form-error hidden"></div><button class="btn lg block" type="submit">${esc(t('setup.create'))}</button></form>`);
  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const { user } = await post('/api/setup', { ...f, lang: getLang() });
      S.meta.needs_setup = false;
      await start(user);
      setTimeout(() => openHelp(), 600);
    } catch (ex) { const el = $('#setup-form .form-error'); el.textContent = errText(ex); el.classList.remove('hidden'); }
  };
}

async function registerScreen(code) {
  let inv;
  try { inv = await get(`/api/invites/${code}`); } catch (e) {
    authShell(`<div class="auth-form"><div class="form-error">${esc(errText(e))}</div><a class="btn block" href="/">${esc(t('auth.sign_in'))}</a></div>`);
    return;
  }
  authShell(`<form class="auth-form" id="reg-form"><h2>${esc(t('register.title'))}</h2><p class="muted">${esc(t('register.text'))}</p>
    <label class="field"><span>${esc(t('profile.name'))}</span><input class="input" name="name" required autofocus placeholder="${esc(t('register.name_ph'))}"></label>
    <label class="field"><span>${esc(t('profile.position'))}</span><input class="input" name="position"></label>
    ${inv.department ? '' : `<label class="field"><span>${esc(t('profile.department'))}</span><input class="input" name="department"></label>`}
    <label class="field"><span>${esc(t('auth.login'))}</span><input class="input" name="login" required pattern="[a-zA-Z0-9._-]{3,32}" placeholder="ivan.petrenko"></label>
    <label class="field"><span>${esc(t('auth.password'))}</span><input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></label>
    <div class="form-error hidden"></div><button class="btn lg block" type="submit">${esc(t('register.create'))}</button></form>`);
  $('#reg-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const { user } = await post('/api/register', { ...f, code, lang: getLang() });
      history.replaceState(null, '', '/');
      await start(user);
      setTimeout(() => openHelp(), 600);
    } catch (ex) { const el = $('#reg-form .form-error'); el.textContent = errText(ex); el.classList.remove('hidden'); }
  };
}

// ---------- Приложение ----------
async function start(user) {
  S.me = user;
  S.settings = user.settings || {};
  upsertUser(user);
  if (user.lang) setLang(user.lang);
  setTimeFormat(S.settings.timeFormat);
  applyTheme();
  applyAppearance();
  $('#app').innerHTML = `<div class="layout">
    <nav id="rail" class="rail">${railHtml()}</nav>
    <aside id="sidebar" class="sidebar">${sidebarHtml()}</aside>
    <main id="main" class="main">${emptyHtml()}</main>
    <aside id="panel" class="panel"></aside></div>
    <div id="drawer" class="drawer"></div>`;
  bindSidebar();
  $('#rail').addEventListener('click', onRailClick);
  const [data, users] = await Promise.all([get('/api/chats'), get('/api/users')]);
  users.forEach(upsertUser);
  data.chats.forEach(upsertChat);
  S.online = new Set(data.online);
  for (const c of data.calls) S.calls.set(c.id, c);
  renderList();
  sock = new Socket(onWs, (st) => { S.connection = st; emit('connection'); if (st === 'online') resync(); });
  initCalls(sock);
  sock.connect();
  window.addEventListener('hashchange', route);
  route();
  refreshBadges();
  syncPush();
  if (user.must_change_pw) setTimeout(() => openSettings('security', { forced: true }), 400);
}

let firstSync = true;
async function resync() {
  if (firstSync) { firstSync = false; return; }
  // После переподключения обновляем список — могли пропустить события.
  try {
    const data = await get('/api/chats');
    data.chats.forEach(upsertChat);
    S.online = new Set(data.online);
    renderList();
    const v = currentView();
    if (v) emit('chat:updated', v.chatId);
  } catch { /* сеть ещё не вернулась */ }
}

// ---------- Маршруты ----------
export function navigate(hash) {
  if (location.hash === `#${hash}` || (!hash && !location.hash)) { route(); return; }
  location.hash = hash;
}
const SECTIONS = ['pulse', 'tasks', 'calendar', 'calls', 'people'];
function setSection(name) {
  S.section = name;
  document.body.dataset.section = name;
  $$('#rail [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === name));
}
function route() {
  const h = location.hash;
  const join = hashParam('join');
  if (join) { history.replaceState(null, '', '#'); joinByCode(join); return; }
  const sec = /^#\/(pulse|tasks|calendar|calls|people)$/.exec(h);
  if (sec && SECTIONS.includes(sec[1])) {
    if (S.current) closeChat();
    closePanel();
    setSection(sec[1]);
    showPage(sec[1]);
    return;
  }
  if (currentPage()) { hidePage(); if (!/^#\/chat\//.test(h)) $('#main').innerHTML = emptyHtml(); }
  setSection('chats');
  const m = /^#\/chat\/(\d+)/.exec(h);
  if (m) {
    const id = Number(m[1]);
    if (S.chats.has(id)) { if (S.current !== id) openChat(id, pendingJump(id)); }
    else navigate('');
    return;
  }
  if (S.current) closeChat();
}

// ---------- Навигационная рельса ----------
const RAIL = [
  ['chats', 'chat', 'nav.chats'], ['pulse', 'activity', 'nav.pulse'], ['tasks', 'kanban', 'nav.tasks'],
  ['calendar', 'calendar', 'nav.calendar'], ['calls', 'phone', 'nav.calls'], ['people', 'users', 'nav.people'],
];
function railHtml() {
  return `<button class="rail-logo" data-rail="drawer" title="${esc(S.meta.name)}">${icon('send', 22)}</button>
    <div class="rail-items">${RAIL.map(([k, ic, label]) => `<button class="rail-item" data-nav="${k}" title="${esc(t(label))}">${icon(ic, 22)}<span>${esc(t(label))}</span><i class="rail-badge hidden" data-badge="${k}"></i></button>`).join('')}</div>
    <span class="grow"></span>
    <button class="rail-item rail-extra" data-rail="ai" title="Gobsek AI">${icon('sparkles', 22)}<span>AI</span></button>
    <button class="rail-item rail-extra" data-rail="settings" title="${esc(t('side.settings'))}">${icon('settings', 22)}<span>${esc(t('nav.settings'))}</span></button>
    <button class="rail-me" data-rail="drawer">${avatar(S.me, 40)}<i class="st-dot st-${S.me.status || 'available'}"></i></button>`;
}
function onRailClick(e) {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const k = nav.dataset.nav;
    if (k === 'chats') navigate(S.lastChat && S.chats.has(S.lastChat) && !isMobile() ? `/chat/${S.lastChat}` : '');
    else navigate(`/${k}`);
    return;
  }
  const r = e.target.closest('[data-rail]');
  if (!r) return;
  if (r.dataset.rail === 'drawer') openDrawer();
  if (r.dataset.rail === 'ai') openAi();
  if (r.dataset.rail === 'settings') openSettings();
}
export function setRailBadges(map) {
  for (const [k, n] of Object.entries(map)) {
    const b = $(`#rail [data-badge="${k}"]`);
    if (!b) continue;
    b.textContent = n > 99 ? '99+' : String(n || '');
    b.classList.toggle('hidden', !n);
  }
}
function unreadChats() {
  let unread = 0;
  for (const c of S.chats.values()) if ((c.unread || c.manual_unread) && !isMuted(c) && !c.archived) unread += 1;
  return unread;
}
let badgeTimer = null;
export function refreshBadges() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    setRailBadges({ chats: unreadChats() });
    try {
      const [tasks, appr, acks] = await Promise.all([get('/api/tasks?scope=mine'), get('/api/approvals/pending'), get('/api/acks/pending')]);
      setRailBadges({ tasks: tasks.filter((x) => !['done', 'cancelled'].includes(x.status)).length, pulse: appr.length + acks.length });
    } catch { /* офлайн */ }
  }, 300);
}
on('chats:changed', () => setRailBadges({ chats: unreadChats() }));
on('tasks:changed', refreshBadges);
on('acks:changed', refreshBadges);
on('chat:opened', (id) => { if (id) S.lastChat = id; });
export function openAdminInvites() { openAdmin('invites'); }
let jump = null;
function pendingJump(id) {
  if (jump && jump.chatId === id) { const j = jump; jump = null; return { jumpTo: j.jumpTo }; }
  return {};
}

export function openChatById(id, opts = {}) {
  if (!S.chats.has(id)) return;
  closeTopModal();
  if (S.current === id) {
    if (opts.jumpTo) jumpTo(opts.jumpTo, opts.q || '');
    return;
  }
  if (opts.jumpTo) jump = { chatId: id, jumpTo: opts.jumpTo };
  navigate(`/chat/${id}`);
  if (isMobile()) closePanel();
}

export async function openDirect(userId) {
  try {
    const c = userId === S.me.id ? await post('/api/chats/saved') : await post('/api/chats/direct', { user_id: userId });
    upsertChat(c);
    renderList();
    openChatById(c.id);
    return c;
  } catch (e) { showError(e); return null; }
}

export function openUserByLogin(login) {
  const u = [...S.users.values()].find((x) => x.login.toLowerCase() === String(login).toLowerCase());
  if (u) openPanel({ type: 'user', id: u.id });
}

export function openPanel(target) {
  _openPanel(target);
}

export function applyChat(c) {
  upsertChat(c);
  renderList();
  emit('chat:updated', c.id);
}

export function showError(e) { toast(errText(e), { type: 'error' }); }

export async function loadChatDetails(id, force = false) {
  if (!force && S.chatDetails.has(id)) return S.chatDetails.get(id);
  const d = await get(`/api/chats/${id}`);
  d.members?.forEach((m) => upsertUser(m));
  S.chatDetails.set(id, d);
  return d;
}

// ---------- События сервера ----------
function onWs(msg) {
  switch (msg.type) {
    case 'hello':
      S.online = new Set(msg.online || []);
      handleCallEvent(msg);
      emit('presence');
      break;
    case 'message:new': {
      const m = msg.message;
      if (['approval', 'task'].includes(m.kind) || m.meta?.ack_required) refreshBadges();
      if (m.thread_id) {
        // Ответ в ветке: уведомляем, только если упомянули меня
        if (m.user_id !== S.me.id && m.meta?.mentions?.includes(S.me.id)) notify(S.chats.get(m.chat_id), m, false);
        break;
      }
      const c = S.chats.get(m.chat_id);
      if (!c) { reloadChat(m.chat_id); break; }
      const mine = m.user_id === S.me.id;
      const viewing = S.current === m.chat_id && !document.hidden;
      const patchc = { id: c.id, last: m, updated_at: m.created_at };
      if (!mine && m.kind !== 'system' && !viewing) {
        patchc.unread = (c.unread || 0) + 1;
        if (m.meta?.mentions?.includes(S.me.id)) patchc.mentions = (c.mentions || 0) + 1;
      }
      if (mine) { patchc.last_read_id = m.id; patchc.unread = 0; patchc.mentions = 0; }
      if (c.archived && !mine && !isMuted(c)) patchc.archived = 0;
      upsertChat(patchc);
      clearTyping(m.chat_id, m.user_id);
      emit('chats:changed');
      if (!mine && (m.kind !== 'system' || m.meta?.event === 'reminder')) notify(S.chats.get(m.chat_id), m, viewing);
      break;
    }
    case 'message:edit': {
      const c = S.chats.get(msg.chat_id);
      if (c && c.last?.id === msg.message.id) { upsertChat({ id: c.id, last: msg.message }); emit('chats:changed'); }
      break;
    }
    case 'message:delete': {
      const c = S.chats.get(msg.chat_id);
      if (c && c.last?.id === msg.id) reloadChat(c.id);
      break;
    }
    case 'read': {
      const c = S.chats.get(msg.chat_id);
      if (!c) break;
      if (msg.user_id === S.me.id) upsertChat({ id: c.id, last_read_id: msg.last_read_id, unread: c.last && c.last.id <= msg.last_read_id ? 0 : c.unread, mentions: 0, manual_unread: false });
      else upsertChat({ id: c.id, others_read_id: Math.max(c.others_read_id || 0, msg.last_read_id) });
      emit('chats:changed');
      break;
    }
    case 'typing': {
      if (!S.typing.has(msg.chat_id)) S.typing.set(msg.chat_id, new Map());
      S.typing.get(msg.chat_id).set(msg.user_id, { action: msg.action, until: Date.now() + 5000 });
      emit('chats:changed');
      setTimeout(() => { emit('chats:changed'); if (S.current === msg.chat_id) emit('ws', { type: 'typing', chat_id: msg.chat_id }); }, 5200);
      break;
    }
    case 'presence':
      if (msg.online) S.online.add(msg.user_id); else S.online.delete(msg.user_id);
      upsertUser({ id: msg.user_id, last_seen: msg.last_seen, online: msg.online });
      emit('presence');
      break;
    case 'chat:new':
    case 'chat:update':
      upsertChat(msg.chat);
      S.chatDetails.delete(msg.chat.id);
      renderList();
      emit('chat:updated', msg.chat.id);
      break;
    case 'chat:remove':
      S.chats.delete(msg.chat_id);
      S.messages.delete(msg.chat_id);
      S.chatDetails.delete(msg.chat_id);
      if (S.current === msg.chat_id) navigate('');
      if (panelState()?.id === msg.chat_id) closePanel();
      renderList();
      break;
    case 'user:update':
      upsertUser(msg.user);
      if (msg.user.id === S.me.id) Object.assign(S.me, msg.user);
      emit('presence');
      emit('user:updated', msg.user.id);
      break;
    case 'reminder':
      break;
    case 'task:update':
      if (msg.actor !== S.me.id) {
        const tk = msg.task;
        toast(t(msg.what === 'created' ? 'task.notify_new' : msg.what === 'status:done' ? 'task.notify_done' : 'task.notify_upd', { title: tk.title, name: userName(msg.actor) }),
          { action: () => navigate('/tasks'), actionLabel: t('common.open'), timeout: 6000 });
        if (msg.what === 'created') ping();
      }
      refreshBadges();
      break;
    case 'approval:done':
      toast(t(msg.status === 'approved' ? 'appr.notify_ok' : 'appr.notify_no', { title: msg.title }), { type: msg.status === 'approved' ? '' : 'error', action: () => openChatById(msg.chat_id, { jumpTo: msg.message_id }), actionLabel: t('common.open'), timeout: 8000 });
      refreshBadges();
      break;
    case 'meeting:soon':
      toast(t('meet.soon', { title: msg.meeting.title }), { action: () => { openChatById(msg.meeting.chat_id); startCall(msg.meeting.chat_id, 'video'); }, actionLabel: t('call.join'), timeout: 15000 });
      ping();
      break;
    default:
      if (msg.type.startsWith('call:') || msg.type === 'rtc:signal') {
        handleCallEvent(msg);
        if (msg.type === 'call:conference') conferenceToast(msg);
      }
  }
  emit('ws', msg);
}
on('call:conference', conferenceToast);

function conferenceToast(msg) {
  if (!msg.caller || msg.caller.id === S.me.id) return;
  const c = S.chats.get(msg.call.chat_id);
  if (!c || isMuted(c)) return;
  toast(t('call.conf_started', { name: msg.caller.name, chat: chatTitle(c, t) }), { action: () => openChatById(c.id), actionLabel: t('common.open'), timeout: 8000 });
}

function clearTyping(chatId, userId) {
  S.typing.get(chatId)?.delete(userId);
}

async function reloadChat(id) {
  try {
    const d = await get(`/api/chats/${id}`);
    delete d.members;
    upsertChat(d);
    renderList();
  } catch { /* нет доступа */ }
}

// ---------- Уведомления ----------
let audioCtx = null;
function ping() {
  if (S.settings.sounds === false) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.09, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.3);
  } catch { /* без звука */ }
}

function notify(chat, m, viewing) {
  if (!chat) return;
  const mentioned = m.meta?.mentions?.includes(S.me.id);
  if ((isMuted(chat) && !mentioned) || m.silent) return;
  const status = S.me.status;
  if (status === 'dnd' && !mentioned) return;
  if (viewing) return;
  ping();
  if (S.settings.notifications === false || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const title = chat.type === 'direct' ? userName(m.user_id) : `${chatTitle(chat, t)}${m.user_id ? ` · ${userName(m.user_id)}` : ''}`;
  const body = S.settings.preview === false ? t('notify.new_message') : previewText(m);
  try {
    const n = new Notification(title, { body: plain(body).slice(0, 200), tag: `chat-${chat.id}`, icon: '/icon.svg', silent: true });
    n.onclick = () => { window.focus(); openChatById(chat.id); n.close(); };
  } catch { /* некоторые браузеры требуют SW */ }
}

export function askNotifications() {
  // Разрешение спрашиваем по первому действию пользователя; после согласия — сразу подписка на push
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then((p) => { if (p === 'granted') syncPush(); });
}
document.addEventListener('click', function once() { askNotifications(); document.removeEventListener('click', once); });

// ---------- Действия с чатами ----------
export function muteDialog(c) {
  if (isMuted(c)) {
    patch(`/api/chats/${c.id}/me`, { muted_until: 0 }).then(applyChat).catch(showError);
    return;
  }
  const opts = [
    ['mute.1h', 3600e3], ['mute.8h', 8 * 3600e3], ['mute.1d', 86400e3], ['mute.1w', 7 * 86400e3], ['mute.forever', 100 * 365 * 86400e3],
  ];
  const m = modal({
    title: t('chat.mute'), cls: 'small',
    content: `<div class="list">${opts.map(([k, ms]) => `<button class="li-row" data-ms="${ms}">${icon('bellOff', 20)}<div class="li-main"><b>${esc(t(k))}</b></div></button>`).join('')}</div>`,
  });
  m.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ms]');
    if (!b) return;
    m.close();
    patch(`/api/chats/${c.id}/me`, { muted_until: Date.now() + Number(b.dataset.ms) }).then(applyChat).catch(showError);
  });
}

export async function markChatRead(c) {
  await post(`/api/chats/${c.id}/read`, {}).catch(showError);
  upsertChat({ id: c.id, unread: 0, mentions: 0, manual_unread: false });
  renderList();
}

export async function leaveChat(c) {
  const ok = await confirmDialog(t(c.type === 'channel' ? 'chat.leave_channel_q' : 'chat.leave_group_q', { title: c.title }), { danger: true, ok: t('chat.leave') });
  if (!ok) return;
  try { await del(`/api/chats/${c.id}/members/${S.me.id}`); } catch (e) { showError(e); }
}

export async function hideDirect(c) {
  const ok = await confirmDialog(t('chat.delete_direct_q', { name: chatTitle(c, t) }), { danger: true, ok: t('common.delete') });
  if (!ok) return;
  try { await post(`/api/chats/${c.id}/hide`); } catch (e) { showError(e); }
}

// ---------- Боковое меню ----------
export function openDrawer() {
  const d = $('#drawer');
  const me = S.me;
  const dark = document.documentElement.dataset.theme === 'dark';
  d.innerHTML = `<div class="drawer-panel">
      <div class="drawer-head" data-da="profile">${avatar(me, 64)}<div><b>${esc(me.name)}</b><span>${esc(me.position || `@${me.login}`)}</span></div>
        <button class="icon-btn ghost" data-da="theme" title="${esc(t('settings.theme'))}">${icon(dark ? 'sun' : 'moon')}</button></div>
      <div class="drawer-status">${['available', 'busy', 'dnd', 'away', 'remote', 'vacation'].map((s) => `<button class="st-dot-btn ${me.status === s ? 'on' : ''}" data-status="${s}" title="${esc(t(`status.${s}`))}"><span class="st-dot st-${s}"></span>${esc(t(`status.${s}`))}</button>`).join('')}</div>
      <nav class="drawer-nav">
        <button data-da="saved">${icon('bookmark')}<span>${esc(t('chat.saved'))}</span></button>
        <button data-da="ai">${icon('sparkles')}<span>Gobsek AI</span>${S.meta.ai ? '' : `<small>${esc(t('ai.off_short'))}</small>`}</button>
        <button data-da="pulse">${icon('activity')}<span>${esc(t('nav.pulse'))}</span></button>
        <button data-da="tasks">${icon('kanban')}<span>${esc(t('nav.tasks'))}</span></button>
        <button data-da="calendar">${icon('calendar')}<span>${esc(t('nav.calendar'))}</span></button>
        <button data-da="contacts">${icon('contacts')}<span>${esc(t('side.contacts'))}</span></button>
        <button data-da="calls">${icon('phone')}<span>${esc(t('side.calls'))}</span></button>
        <button data-da="group">${icon('users')}<span>${esc(t('side.new_group'))}</span></button>
        <button data-da="channel">${icon('megaphone')}<span>${esc(t('side.new_channel'))}</span></button>
        <button data-da="catalog">${icon('globe')}<span>${esc(t('side.catalog'))}</span></button>
        <div class="drawer-sep"></div>
        <button data-da="settings">${icon('settings')}<span>${esc(t('side.settings'))}</span></button>
        ${me.role === 'admin' ? `<button data-da="admin">${icon('shield')}<span>${esc(t('side.admin'))}</span></button>` : ''}
        <button data-da="help">${icon('help')}<span>${esc(t('side.help'))}</span></button>
        ${S.meta.gobsek_url ? `<a href="${esc(S.meta.gobsek_url)}" target="_blank" rel="noopener">${icon('link')}<span>${esc(t('side.open_gobsek'))}</span></a>` : ''}
        <button data-da="logout" class="danger">${icon('logout')}<span>${esc(t('side.logout'))}</span></button>
      </nav>
      <div class="drawer-foot">${esc(S.meta.name)} · v${esc(S.meta.version || '')}</div></div>`;
  d.classList.add('open');
  d.onclick = async (e) => {
    if (e.target === d) { closeDrawer(); return; }
    const st = e.target.closest('[data-status]');
    if (st) {
      const { user } = await patch('/api/me', { status: st.dataset.status });
      Object.assign(S.me, user);
      openDrawer();
      return;
    }
    const b = e.target.closest('[data-da]');
    if (!b) return;
    const a = b.dataset.da;
    if (a === 'theme') {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      S.settings.theme = next;
      applyTheme();
      patch('/api/me', { settings: { theme: next } }).catch(() => {});
      openDrawer();
      return;
    }
    closeDrawer();
    switch (a) {
      case 'profile': openSettings('profile'); break;
      case 'saved': openDirect(S.me.id); break;
      case 'ai': openAi(); break;
      case 'contacts': openContacts(); break;
      case 'calls': navigate('/calls'); break;
      case 'pulse': navigate('/pulse'); break;
      case 'tasks': navigate('/tasks'); break;
      case 'calendar': navigate('/calendar'); break;
      case 'group': newChatDialog('group'); break;
      case 'channel': newChatDialog('channel'); break;
      case 'catalog': openCatalog(); break;
      case 'settings': openSettings(); break;
      case 'admin': openAdmin(); break;
      case 'help': openHelp(); break;
      case 'logout': logout(); break;
      default:
    }
  };
}
export function closeDrawer() { $('#drawer')?.classList.remove('open'); }

async function logout() {
  if (!(await confirmDialog(t('side.logout_q'), { ok: t('side.logout'), danger: true }))) return;
  if (currentCall()) return;
  await post('/api/logout').catch(() => {});
  sock?.close();
  location.href = '/';
}

export async function openAi() {
  try {
    const c = await post('/api/chats/ai');
    upsertChat(c);
    renderList();
    openChatById(c.id);
  } catch (e) { showError(e); }
}

// ---------- Сотрудники ----------
function groupByDept(users) {
  const map = new Map();
  for (const u of users) {
    const d = u.department || t('contacts.no_dept');
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(u);
  }
  return [...map].sort((a, b) => a[0].localeCompare(b[0]));
}

export function openContacts() {
  const users = [...S.users.values()].filter((u) => u.id !== S.me.id && u.active !== false && !u.is_bot);
  const render = (q = '', mode = 'all') => {
    let list = users.filter((u) => !q || `${u.name} ${u.login} ${u.position} ${u.department}`.toLowerCase().includes(q));
    if (mode === 'online') list = list.filter((u) => S.online.has(u.id));
    list.sort((a, b) => (S.online.has(b.id) - S.online.has(a.id)) || a.name.localeCompare(b.name));
    if (!list.length) return `<p class="muted center">${esc(t('search.nothing'))}</p>`;
    return groupByDept(list).map(([dept, us]) => `<div class="sec-title">${esc(dept)} <small>${us.length}</small></div>${us.map((u) => `<div class="li-row" data-uid="${u.id}">${avatar(u, 44, { online: S.online.has(u.id) })}
      <div class="li-main"><b>${esc(u.name)}</b><span>${S.online.has(u.id) ? `<span class="online-txt">${esc(t('presence.online'))}</span>` : esc(u.position || `@${u.login}`)}</span></div>
      ${u.status && u.status !== 'available' ? `<span class="st-dot st-${u.status}" title="${esc(t(`status.${u.status}`))}"></span>` : ''}
      <button class="icon-btn ghost" data-call="${u.id}" title="${esc(t('call.audio'))}">${icon('phone', 18)}</button></div>`).join('')}`).join('');
  };
  const m = modal({
    title: t('side.contacts'),
    content: `<div class="row"><input class="input grow" id="ct-q" placeholder="${esc(t('contacts.search'))}" autofocus>
      <div class="seg"><button class="on" data-mode="all">${esc(t('contacts.all'))}</button><button data-mode="online">${esc(t('presence.online'))}</button></div></div>
      ${S.me.role === 'admin' ? `<button class="link-btn" id="ct-invite">+ ${esc(t('admin.invite_people'))}</button>` : ''}
      <div class="list contacts-list">${render()}</div>`,
  });
  let mode = 'all';
  const q = m.body.querySelector('#ct-q');
  const listEl = m.body.querySelector('.contacts-list');
  q.addEventListener('input', () => { listEl.innerHTML = render(q.value.toLowerCase(), mode); });
  m.body.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; m.body.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); listEl.innerHTML = render(q.value.toLowerCase(), mode); };
  });
  m.body.querySelector('#ct-invite')?.addEventListener('click', () => { m.close(); openAdmin('invites'); });
  m.body.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-call]');
    if (c) { m.close(); const chat = await openDirect(Number(c.dataset.call)); if (chat) startCall(chat.id, 'audio'); return; }
    const r = e.target.closest('[data-uid]');
    if (r) { m.close(); openDirect(Number(r.dataset.uid)); }
  });
}

/** Выбор нескольких сотрудников (новая группа, добавление участников). */
export function pickPeople(title, onDone, { exclude = [], okLabel = t('common.done') } = {}) {
  const users = [...S.users.values()].filter((u) => u.id !== S.me.id && !u.is_bot && u.active !== false && !exclude.includes(u.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const picked = new Set();
  const m = modal({
    title,
    content: `<div class="picked"></div><input class="input" id="pp-q" placeholder="${esc(t('contacts.search'))}" autofocus>
      <div class="list pick-list">${users.map((u) => `<label class="li-row" data-name="${esc(`${u.name} ${u.login} ${u.department} ${u.position}`.toLowerCase())}">
        <input type="checkbox" value="${u.id}">${avatar(u, 40)}<div class="li-main"><b>${esc(u.name)}</b><span>${esc([u.position, u.department].filter(Boolean).join(' · '))}</span></div></label>`).join('')}</div>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(okLabel)}</button></div>`,
  });
  const chips = m.body.querySelector('.picked');
  const redraw = () => {
    chips.innerHTML = [...picked].map((id) => `<span class="chip" data-un="${id}">${avatar(S.users.get(id), 22)}${esc(S.users.get(id).name.split(' ')[0])} ×</span>`).join('');
  };
  m.body.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const id = Number(e.target.value);
    if (e.target.checked) picked.add(id); else picked.delete(id);
    redraw();
  });
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('[data-un]');
    if (!c) return;
    picked.delete(Number(c.dataset.un));
    const cb = m.body.querySelector(`input[value="${c.dataset.un}"]`);
    if (cb) cb.checked = false;
    redraw();
  });
  m.body.querySelector('#pp-q').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    m.body.querySelectorAll('.pick-list .li-row').forEach((r) => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
  });
  m.body.querySelector('[data-a=no]').onclick = () => m.close();
  m.body.querySelector('[data-a=yes]').onclick = () => { m.close(); onDone([...picked]); };
}

export function newChatDialog(type) {
  const channel = type === 'channel';
  const m = modal({
    title: channel ? t('side.new_channel') : t('side.new_group'),
    content: `<label class="field"><span>${esc(t('newchat.title'))}</span><input class="input" id="nc-title" maxlength="80" autofocus placeholder="${esc(channel ? t('newchat.channel_ph') : t('newchat.group_ph'))}"></label>
      <label class="field"><span>${esc(t('newchat.description'))}</span><textarea class="input" id="nc-desc" rows="2" maxlength="500"></textarea></label>
      <label class="check"><input type="checkbox" id="nc-public" ${channel ? 'checked' : ''}> ${esc(t('newchat.public'))}</label>
      <p class="muted small">${esc(channel ? t('newchat.channel_hint') : t('newchat.group_hint'))}</p>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('newchat.next'))}</button></div>`,
  });
  m.body.querySelector('[data-a=no]').onclick = () => m.close();
  m.body.querySelector('[data-a=yes]').onclick = () => {
    const title = m.body.querySelector('#nc-title').value.trim();
    if (!title) { m.body.querySelector('#nc-title').focus(); return; }
    const description = m.body.querySelector('#nc-desc').value;
    const isPublic = m.body.querySelector('#nc-public').checked;
    m.close();
    pickPeople(t('newchat.add_people'), async (ids) => {
      try {
        const c = await post('/api/chats', { type, title, description, is_public: isPublic, members: ids });
        upsertChat(c);
        renderList();
        openChatById(c.id);
      } catch (e) { showError(e); }
    }, { okLabel: t('common.create') });
  };
}

export async function openCatalog() {
  const list = await get('/api/catalog').catch(() => []);
  const m = modal({
    title: t('side.catalog'),
    content: list.length ? `<p class="muted small">${esc(t('catalog.hint'))}</p><div class="list">${list.map((c) => `<div class="li-row">${avatar(c, 44)}<div class="li-main"><b>${c.type === 'channel' ? icon('megaphone', 14) : icon('users', 14)} ${esc(c.title)}</b>
      <span>${esc(c.description || (c.type === 'channel' ? t('chat.subscribers', { n: c.members_count }) : t('chat.members', { n: c.members_count })))}</span></div>
      ${c.joined ? `<button class="btn sm soft" data-open="${c.id}">${esc(t('common.open'))}</button>` : `<button class="btn sm" data-join="${c.id}">${esc(c.type === 'channel' ? t('catalog.subscribe') : t('catalog.join'))}</button>`}</div>`).join('')}</div>`
      : `<p class="muted center">${esc(t('catalog.empty'))}</p>`,
  });
  m.body.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { m.close(); openChatById(Number(o.dataset.open)); return; }
    const j = e.target.closest('[data-join]');
    if (!j) return;
    try {
      const c = await post('/api/chats/join', { chat_id: Number(j.dataset.join) });
      upsertChat(c);
      renderList();
      m.close();
      openChatById(c.id);
    } catch (err) { showError(err); }
  });
}

export async function previewPublicChat(id) {
  if (S.chats.has(id)) { openChatById(id); return; }
  const list = await get('/api/catalog').catch(() => []);
  const c = list.find((x) => x.id === id);
  if (!c) return;
  if (await confirmDialog(t('catalog.join_q', { title: c.title }), { ok: c.type === 'channel' ? t('catalog.subscribe') : t('catalog.join') })) {
    try {
      const out = await post('/api/chats/join', { chat_id: id });
      upsertChat(out);
      renderList();
      openChatById(out.id);
    } catch (e) { showError(e); }
  }
}

async function joinByCode(code) {
  try {
    const p = await get(`/api/join/${code}`);
    const existing = S.chats.get(p.id);
    if (existing) { openChatById(p.id); return; }
    const m = modal({
      title: p.type === 'channel' ? t('catalog.invite_channel') : t('catalog.invite_group'), cls: 'small',
      content: `<div class="profile-hero">${avatar(p, 96)}<h2>${esc(p.title)}</h2><div class="muted">${esc(p.type === 'channel' ? t('chat.subscribers', { n: p.members_count }) : t('chat.members', { n: p.members_count }))}</div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}</div><div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button>
        <button class="btn" data-a="yes">${esc(p.type === 'channel' ? t('catalog.subscribe') : t('catalog.join'))}</button></div>`,
    });
    m.body.querySelector('[data-a=no]').onclick = () => m.close();
    m.body.querySelector('[data-a=yes]').onclick = async () => {
      const c = await post('/api/chats/join', { invite_code: code });
      upsertChat(c);
      renderList();
      m.close();
      openChatById(c.id);
    };
  } catch (e) { showError(e); }
}

// ---------- Журнал звонков ----------
export async function openCalls() {
  const list = await get('/api/calls/history').catch(() => []);
  const m = modal({
    title: t('side.calls'),
    content: list.length ? `<div class="list">${list.map((c) => {
      const chat = c.chat;
      const peer = chat.peer;
      const bad = ['missed', 'declined', 'cancelled'].includes(c.status) && !c.outgoing;
      const label = c.status === 'missed' ? (c.outgoing ? t('call.cancelled') : t('call.missed')) : c.status === 'declined' ? t('call.declined_short')
        : `${c.outgoing ? t('call.outgoing') : t('call.incoming')}${c.duration ? ` · ${fmtDuration(c.duration)}` : ''}`;
      return `<div class="li-row" data-chat="${chat.id}">${avatar(peer || chat, 44)}<div class="li-main"><b class="${bad ? 'red' : ''}">${esc(peer?.name || chat.title)}</b>
        <span>${icon(c.outgoing ? 'phoneOut' : 'phoneIn', 13)} ${esc(label)} · ${esc(fmtDateTime(c.started_at))}${!chat.peer ? ` · ${esc(t('call.participants', { n: c.participants }))}` : ''}</span></div>
        <button class="icon-btn ghost" data-recall="${chat.id}" data-media="${c.media}">${icon(c.media === 'video' ? 'video' : 'phone', 18)}</button></div>`;
    }).join('')}</div>` : `<p class="muted center">${esc(t('calls.empty'))}</p>`,
  });
  m.body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-recall]');
    if (r) { m.close(); openChatById(Number(r.dataset.recall)); startCall(Number(r.dataset.recall), r.dataset.media); return; }
    const row = e.target.closest('[data-chat]');
    if (row) { m.close(); openChatById(Number(row.dataset.chat)); }
  });
}

// ---------- ИИ: пересказ ----------
export async function summarizeChat(chatId) {
  const c = S.chats.get(chatId);
  const mode = c?.unread > 3 ? 'unread' : 'recent';
  const m = modal({
    title: t('ai.summary_title'),
    content: `<div class="ai-summary"><div class="loading-msgs"><span class="spinner"></span><span>${esc(t('ai.summarizing'))}</span></div></div>`,
  });
  try {
    const r = await post('/api/ai/summarize', { chat_id: chatId, mode });
    const { md } = await import('./util.js');
    m.body.innerHTML = r.text
      ? `<p class="muted small">${icon('sparkles', 14)} ${esc(t(mode === 'unread' ? 'ai.summary_unread' : 'ai.summary_recent', { n: r.count }))}</p><div class="ai-summary text">${md(r.text)}</div>`
      : `<p class="muted center">${esc(t('ai.nothing_to_sum'))}</p>`;
  } catch (e) { m.body.innerHTML = `<p class="form-error">${esc(errText(e))}</p>`; }
}

// ---------- Просмотр фото ----------
export function viewMedia(chatId, msgId) {
  const list = (S.messages.get(chatId)?.list || []).filter((x) => x.kind === 'image' && x.file);
  let i = list.findIndex((x) => x.id === msgId);
  if (i < 0) {
    get(`/api/chats/${chatId}/media?kind=media`).then((ms) => {
      const imgs = ms.filter((x) => x.kind === 'image').reverse();
      const j = imgs.findIndex((x) => x.id === msgId);
      if (j >= 0) showViewer(imgs, j, chatId);
    });
    return;
  }
  showViewer(list, i, chatId);
}
function showViewer(list, i, chatId) {
  const el = document.createElement('div');
  el.className = 'viewer';
  const draw = () => {
    const m = list[i];
    el.innerHTML = `<div class="viewer-top"><div class="vt-who">${avatar(S.users.get(m.user_id) || { name: userName(m.user_id) }, 36)}<div><b>${esc(userName(m.user_id))}</b><span>${esc(fmtDateTime(m.created_at))}</span></div></div>
      <span class="grow"></span><span class="vt-count">${i + 1} / ${list.length}</span>
      <a class="icon-btn glass" href="${esc(m.file.url)}?download=1" download="${esc(m.file.name)}">${icon('download')}</a>
      <button class="icon-btn glass" data-v="goto">${icon('reply')}</button><button class="icon-btn glass" data-v="close">${icon('x')}</button></div>
      <div class="viewer-stage">${i > 0 ? `<button class="v-nav prev" data-v="prev">${icon('back', 28)}</button>` : ''}<img src="${esc(m.file.url)}" alt="">${i < list.length - 1 ? `<button class="v-nav next" data-v="next">${icon('right', 28)}</button>` : ''}</div>
      ${m.body ? `<div class="viewer-caption">${esc(m.body)}</div>` : ''}`;
  };
  draw();
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); }
    if (e.key === 'ArrowRight' && i < list.length - 1) { i++; draw(); }
  };
  document.addEventListener('keydown', key, true);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) { if (e.target === el || e.target.classList.contains('viewer-stage')) close(); return; }
    if (b.dataset.v === 'close') close();
    if (b.dataset.v === 'prev') { i--; draw(); }
    if (b.dataset.v === 'next') { i++; draw(); }
    if (b.dataset.v === 'goto') { const id = list[i].id; close(); openChatById(chatId, { jumpTo: id }); }
  });
}

// ---------- Горячие клавиши ----------
document.addEventListener('keydown', (e) => {
  if (!S.me) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) { e.preventDefault(); closeTopModal(); focusSearch(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (e.key === 'Escape') {
    closeMenu();
    if ($('#drawer.open')) { closeDrawer(); return; }
    if (hasModal()) { closeTopModal(); return; }
    if (panelState() && !e.target.closest('textarea, input')) { closePanel(); return; }
    if (S.current && !S.replyTo && !S.editing && !e.target.closest('input')) navigate('');
  }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const rows = $$('#sidebar .chat-list .chat-row');
    const i = rows.findIndex((r) => r.classList.contains('on'));
    const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) openChatById(Number(next.dataset.chat));
  }
});

// Приложение установлено на телефон: возвращаемся в список кнопкой «назад».
window.addEventListener('popstate', () => closeMenu());

export { contextMenu, peerOf };
boot();
