// Звонки и видеоконференции на WebRTC. Схема «каждый с каждым» (до ~8–12 участников),
// согласование по шаблону «perfect negotiation», чтобы встречные предложения не ломали соединение.
import { S, userName, emit } from './store.js';
import { t } from './i18n.js';
import { esc, avatar, fmtDuration, $ } from './util.js';
import { icon } from './icons.js';
import { toast } from './dialogs.js';

let socket = null;
let call = null;       // текущий звонок
let ringing = null;    // входящий звонок { call, caller, chat }
let tone = null;

export function initCalls(sock) { socket = sock; }
export const currentCall = () => call;
// Отладка звонков: localStorage['gc-debug'] = '1' → window.__gcCall() в консоли.
try { if (localStorage.getItem('gc-debug')) window.__gcCall = () => call; } catch { /* ignore */ }

// ---------- Звуки (генерируются, без файлов) ----------
function playTone(kind) {
  stopTone();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.frequency.value = kind === 'ring' ? 660 : 440;
    osc.start();
    let on = false;
    let step = 0;
    const pattern = kind === 'ring' ? [400, 200, 400, 1800] : [1000, 3000];
    const loop = () => {
      on = step % 2 === 0;
      gain.gain.setTargetAtTime(on ? 0.12 : 0, ctx.currentTime, 0.02);
      if (kind === 'ring') osc.frequency.value = step % 4 === 0 ? 660 : 880;
      tone.timer = setTimeout(loop, pattern[step % pattern.length]);
      step++;
    };
    tone = { ctx, timer: null };
    loop();
  } catch { tone = null; }
}
function stopTone() {
  if (!tone) return;
  clearTimeout(tone.timer);
  tone.ctx.close().catch(() => {});
  tone = null;
}
function beep(freq = 520, ms = 160) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ms);
  } catch { /* ignore */ }
}

// ---------- Медиа ----------
function deviceConstraints(kind) {
  let id = null;
  try { id = localStorage.getItem(kind === 'audio' ? 'gc-mic' : 'gc-cam'); } catch { /* ignore */ }
  if (kind === 'audio') return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { ideal: id } } : {}) };
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 }, ...(id ? { deviceId: { ideal: id } } : {}) };
}

async function getLocalMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceConstraints('audio'), video: video ? deviceConstraints('video') : false });
  } catch (e) {
    if (video) {
      // Нет камеры — звоним хотя бы с микрофоном.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: deviceConstraints('audio') });
        toast(t('call.no_camera'));
        return s;
      } catch { /* дальше — без микрофона */ }
    }
    toast(t('call.no_mic'), { type: 'error' });
    return new MediaStream();
  }
}

// ---------- Начало, вход, выход ----------
export async function startCall(chatId, media = 'audio') {
  if (call) { expand(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast(t('call.unsupported'), { type: 'error' }); return; }
  const existing = [...S.calls.values()].find((c) => c.chat_id === chatId);
  call = newCallState(chatId, existing ? existing.media : media);
  call.local = await getLocalMedia(media === 'video');
  call.video = call.local.getVideoTracks().length > 0;
  render();
  if (existing) socket.send({ type: 'call:join', call_id: existing.id, media });
  else {
    socket.send({ type: 'call:start', chat_id: chatId, media });
    if (S.chats.get(chatId)?.type === 'direct') playTone('ringback');
  }
}

export async function joinCall(callId, media) {
  const c = S.calls.get(callId) || ringing?.call;
  if (!c) return;
  if (call) {
    if (call.id === callId) { expand(); return; }
    hangup();
  }
  stopRinging();
  call = newCallState(c.chat_id, media || c.media);
  call.local = await getLocalMedia(media === 'video');
  call.video = call.local.getVideoTracks().length > 0;
  render();
  socket.send({ type: 'call:join', call_id: callId, media: media || c.media });
}

function newCallState(chatId, media) {
  return {
    id: null, chatId, media, peers: new Map(), local: null, screen: null, mic: true, video: false, hand: false,
    started: Date.now(), answered: null, minimized: false, layout: 'grid', ice: [], timer: null, levels: null,
    pinned: null, pendingSignals: [],
  };
}

export function hangup() {
  if (!call) return;
  if (call.id) socket.send({ type: 'call:leave', call_id: call.id });
  cleanup();
  beep(380, 220);
}

function cleanup() {
  stopTone();
  if (!call) return;
  for (const p of call.peers.values()) closePeer(p);
  call.local?.getTracks().forEach((tr) => tr.stop());
  call.screen?.getTracks().forEach((tr) => tr.stop());
  clearInterval(call.timer);
  if (call.levels) { clearInterval(call.levels.timer); call.levels.ctx.close().catch(() => {}); }
  call = null;
  $('#call')?.remove();
  $('#call-pill')?.remove();
  document.body.classList.remove('in-call');
  emit('call:changed');
}

// ---------- Соединения с участниками ----------
function polite(remoteConnId) { return socket.connId < remoteConnId; }

/**
 * Соединение с участником. Первое предложение всегда делает тот, кто вошёл в звонок позже:
 * старые участники создают соединение без своих дорожек и добавляют их, только получив это
 * предложение (addTrack до setRemoteDescription привязывает их к m-строкам предложения).
 * Так при входе не бывает встречных предложений; повторные согласования (камера, экран)
 * разруливает «perfect negotiation».
 */
function ensurePeer(connId, userId, { addTracks = true } = {}) {
  let p = call.peers.get(connId);
  if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: call.ice, bundlePolicy: 'max-bundle' });
  p = { connId, userId, pc, stream: new MediaStream(), makingOffer: false, ignoreOffer: false, polite: polite(connId),
    state: { audio: true, video: false, screen: false, hand: false }, pendingIce: [], tracksAdded: false };
  call.peers.set(connId, p);
  if (addTracks) addLocalTracks(p);
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      send(connId, { sdp: pc.localDescription });
    } catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = (e) => { if (e.candidate) send(connId, { candidate: e.candidate }); };
  pc.ontrack = (e) => {
    const stream = p.stream;
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    e.track.onunmute = () => renderTiles();
    e.track.onended = () => { stream.removeTrack(e.track); renderTiles(); };
    renderTiles();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce?.();
    renderTiles();
  };
  pc.oniceconnectionstatechange = () => renderTiles();
  return p;
}

function addLocalTracks(p) {
  if (p.tracksAdded) return;
  p.tracksAdded = true;
  for (const tr of call.local.getTracks()) p.pc.addTrack(tr, call.local);
  if (call.screen) {
    const st = call.screen.getVideoTracks()[0];
    const vs = p.pc.getSenders().find((x) => x.track?.kind === 'video');
    if (vs) vs.replaceTrack(st); else p.pc.addTrack(st, call.local);
  }
}

function peerConnected(p) {
  const ice = p.pc.iceConnectionState;
  return ice === 'connected' || ice === 'completed' || p.pc.connectionState === 'connected';
}

function closePeer(p) {
  try { p.pc.close(); } catch { /* ignore */ }
  p.stream.getTracks().forEach((tr) => tr.stop());
}

function send(to, data) {
  socket.send({ type: 'rtc:signal', call_id: call.id, to, data: JSON.parse(JSON.stringify(data)) });
}

async function onSignal(msg) {
  if (!call || msg.call_id !== call.id) return;
  const p = ensurePeer(msg.from, msg.from_user);
  const { pc } = p;
  const { sdp, candidate } = msg.data;
  try {
    if (sdp) {
      const collision = sdp.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      if (sdp.type === 'offer') addLocalTracks(p);
      await pc.setRemoteDescription(sdp);
      for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (sdp.type === 'offer') {
        await pc.setLocalDescription();
        send(msg.from, { sdp: pc.localDescription });
      }
    } else if (candidate) {
      if (!pc.remoteDescription) { p.pendingIce.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn('signal', e); }
}

// ---------- Управление ----------
function broadcastState() {
  if (!call?.id) return;
  socket.send({ type: 'call:media', call_id: call.id, audio: call.mic, video: call.video, screen: !!call.screen, hand: call.hand });
}

export function toggleMic() {
  if (!call) return;
  call.mic = !call.mic;
  call.local.getAudioTracks().forEach((tr) => { tr.enabled = call.mic; });
  broadcastState();
  render();
}

export async function toggleCamera() {
  if (!call) return;
  if (call.video) {
    call.local.getVideoTracks().forEach((tr) => { tr.stop(); call.local.removeTrack(tr); });
    for (const p of call.peers.values()) {
      if (!p.tracksAdded) continue;
      const s = p.pc.getSenders().find((x) => x.track?.kind === 'video' && !call.screen);
      if (s) s.replaceTrack(null);
    }
    call.video = false;
  } else {
    let track;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: deviceConstraints('video') });
      track = s.getVideoTracks()[0];
    } catch { toast(t('call.no_camera'), { type: 'error' }); return; }
    call.local.addTrack(track);
    call.video = true;
    if (!call.screen) {
      for (const p of call.peers.values()) {
        if (!p.tracksAdded) continue;
        const s = p.pc.getSenders().find((x) => x.track === null || x.track?.kind === 'video');
        if (s) s.replaceTrack(track); else p.pc.addTrack(track, call.local);
      }
    }
  }
  broadcastState();
  render();
}

export async function toggleScreen() {
  if (!call) return;
  if (call.screen) { stopScreen(); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { toast(t('call.no_screen'), { type: 'error' }); return; }
  try {
    call.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  } catch { return; }
  const st = call.screen.getVideoTracks()[0];
  st.onended = () => stopScreen();
  for (const p of call.peers.values()) {
    if (!p.tracksAdded) continue;
    const s = p.pc.getSenders().find((x) => x.track === null || x.track?.kind === 'video');
    if (s) s.replaceTrack(st); else p.pc.addTrack(st, call.local);
  }
  broadcastState();
  render();
}

function stopScreen() {
  if (!call?.screen) return;
  call.screen.getTracks().forEach((tr) => tr.stop());
  call.screen = null;
  const cam = call.local.getVideoTracks()[0] || null;
  for (const p of call.peers.values()) {
    if (!p.tracksAdded) continue;
    const s = p.pc.getSenders().find((x) => x.track?.kind === 'video' || x.track === null);
    if (s) s.replaceTrack(cam);
  }
  broadcastState();
  render();
}

function toggleHand() {
  call.hand = !call.hand;
  broadcastState();
  render();
}

function sendReaction(emoji) {
  socket.send({ type: 'call:reaction', call_id: call.id, emoji });
}

function minimize() { call.minimized = true; render(); }
function expand() { if (call) { call.minimized = false; render(); } }

// ---------- События сервера ----------
export function handleCallEvent(msg) {
  switch (msg.type) {
    case 'hello':
      S.calls.clear();
      for (const c of msg.calls || []) S.calls.set(c.id, c);
      emit('call:changed');
      return;
    case 'call:state':
      S.calls.set(msg.call.id, msg.call);
      if (call && call.id === msg.call.id) {
        if (msg.call.answered_at && !call.answered) { call.answered = msg.call.answered_at; stopTone(); }
        render();
      }
      emit('call:changed');
      return;
    case 'call:ring':
      S.calls.set(msg.call.id, msg.call);
      emit('call:changed');
      if (msg.ring && !call) showRinging(msg);
      else if (!msg.ring) emit('call:conference', msg);
      return;
    case 'call:ring_stop':
      if (ringing && ringing.call.id === msg.call_id) stopRinging();
      return;
    case 'call:joined':
      if (!call) { socket.send({ type: 'call:leave', call_id: msg.call.id }); return; }
      call.id = msg.call.id;
      call.ice = msg.ice || [];
      call.media = msg.call.media;
      if (msg.call.answered_at) { call.answered = msg.call.answered_at; stopTone(); }
      S.calls.set(msg.call.id, msg.call);
      for (const peer of msg.call.peers) {
        if (peer.conn_id === socket.connId) continue;
        const p = ensurePeer(peer.conn_id, peer.user_id);
        p.state = { audio: peer.audio, video: peer.video, screen: peer.screen, hand: peer.hand };
      }
      broadcastState();
      render();
      emit('call:changed');
      return;
    case 'call:peer_joined':
      if (!call || call.id !== msg.call_id) return;
      ensurePeer(msg.peer.conn_id, msg.peer.user_id, { addTracks: false }).state = { audio: msg.peer.audio, video: msg.peer.video, screen: false, hand: false };
      if (!call.answered) { call.answered = Date.now(); stopTone(); }
      beep(660, 120);
      render();
      return;
    case 'call:peer_left': {
      if (!call || call.id !== msg.call_id) return;
      const p = call.peers.get(msg.conn_id);
      if (p) { closePeer(p); call.peers.delete(msg.conn_id); }
      render();
      return;
    }
    case 'call:peer_state': {
      const p = call?.peers.get(msg.conn_id);
      if (!p) return;
      const raised = !p.state.hand && msg.state.hand;
      p.state = msg.state;
      if (raised) toast(t('call.hand_raised', { name: userName(p.userId) }));
      renderTiles();
      return;
    }
    case 'call:reaction':
      if (call && call.id === msg.call_id) floatReaction(msg.emoji, msg.user_id);
      return;
    case 'rtc:signal':
      onSignal(msg);
      return;
    case 'call:ended':
      S.calls.delete(msg.call_id);
      if (ringing && ringing.call.id === msg.call_id) stopRinging();
      if (call && call.id === msg.call_id) {
        const st = msg.status;
        cleanup();
        if (st === 'declined') toast(t('call.declined'));
        else if (st === 'missed') toast(t('call.no_answer'));
        else if (st === 'moved') toast(t('call.moved'));
      }
      emit('call:changed');
      return;
    case 'call:error':
      if (call && !call.id) cleanup();
      toast(t(`err.${msg.code}`) === `err.${msg.code}` ? (msg.message || t('err.generic')) : t(`err.${msg.code}`), { type: 'error' });
      return;
    default:
  }
}

// ---------- Входящий звонок ----------
function showRinging(msg) {
  ringing = msg;
  playTone('ring');
  const el = document.createElement('div');
  el.id = 'ringing';
  el.className = 'ringing';
  const video = msg.call.media === 'video';
  el.innerHTML = `<div class="ring-card">
    <div class="ring-av">${avatar(msg.caller, 96)}<span class="ring-pulse"></span></div>
    <div class="ring-name">${esc(msg.caller.name)}</div>
    <div class="ring-sub">${esc(video ? t('call.incoming_video') : t('call.incoming_audio'))}</div>
    <div class="ring-actions">
      <button class="call-btn red" data-r="decline" title="${esc(t('call.decline'))}">${icon('phoneOff', 26)}</button>
      ${video ? `<button class="call-btn green" data-r="audio" title="${esc(t('call.answer_audio'))}">${icon('phone', 26)}</button>` : ''}
      <button class="call-btn green" data-r="accept" title="${esc(t('call.answer'))}">${icon(video ? 'video' : 'phone', 26)}</button>
    </div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const id = msg.call.id;
    if (b.dataset.r === 'decline') { socket.send({ type: 'call:decline', call_id: id }); stopRinging(); }
    if (b.dataset.r === 'accept') joinCall(id, msg.call.media);
    if (b.dataset.r === 'audio') joinCall(id, 'audio');
  });
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(msg.caller.name, { body: video ? t('call.incoming_video') : t('call.incoming_audio'), tag: `call-${msg.call.id}`, requireInteraction: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* ignore */ }
  }
}

function stopRinging() {
  ringing = null;
  stopTone();
  $('#ringing')?.remove();
}

// ---------- Отрисовка ----------
function callTitle() {
  const chat = S.chats.get(call.chatId);
  if (!chat) return '';
  if (chat.type === 'direct') return S.users.get(chat.peer?.id)?.name || chat.peer?.name || '';
  return chat.title;
}

function render() {
  if (!call) return;
  document.body.classList.add('in-call');
  let el = $('#call');
  if (!el) {
    el = document.createElement('div');
    el.id = 'call';
    el.className = 'call';
    el.innerHTML = `<div class="call-top"><div class="call-title"></div><div class="call-sub"></div>
        <div class="call-top-actions"><button class="icon-btn glass" data-c="layout" title="${esc(t('call.layout'))}">${icon('grid')}</button>
        <button class="icon-btn glass" data-c="min" title="${esc(t('call.minimize'))}">${icon('minimize')}</button></div></div>
      <div class="call-stage"><div class="tiles"></div><div class="float-reactions"></div></div>
      <div class="call-bar"></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onCallClick);
    call.timer = setInterval(updateTimer, 1000);
    startLevelMeter();
  }
  el.classList.toggle('hidden', call.minimized);
  el.querySelector('.call-title').textContent = callTitle();
  el.querySelector('.call-bar').innerHTML = `
    <button class="call-btn ${call.mic ? '' : 'off'}" data-c="mic" title="${esc(t('call.mic'))} (M)">${icon(call.mic ? 'mic' : 'micOff', 24)}</button>
    <button class="call-btn ${call.video ? '' : 'off'}" data-c="cam" title="${esc(t('call.camera'))} (V)">${icon(call.video ? 'video' : 'videoOff', 24)}</button>
    <button class="call-btn ${call.screen ? 'on' : ''}" data-c="screen" title="${esc(t('call.screen'))}">${icon('screen', 24)}</button>
    <button class="call-btn ${call.hand ? 'on' : ''}" data-c="hand" title="${esc(t('call.hand'))}">${icon('hand', 24)}</button>
    <div class="call-react-wrap"><button class="call-btn" data-c="react" title="${esc(t('call.react'))}">${icon('smile', 24)}</button>
      <div class="call-react-pop">${['👍', '👏', '❤️', '😂', '🎉', '🔥', '😮', '🙏'].map((e) => `<button data-c="emoji" data-e="${e}">${e}</button>`).join('')}</div></div>
    <button class="call-btn red wide" data-c="hangup" title="${esc(t('call.hangup'))}">${icon('phoneOff', 24)}</button>`;
  renderTiles();
  updateTimer();
  renderPill();
}

function tileHtml(key, userId, { self = false, state = {} } = {}) {
  const u = self ? S.me : S.users.get(userId) || { id: userId, name: userName(userId) };
  const name = self ? `${t('call.you')}` : u.name;
  return `<div class="tile ${state.screen ? 'screen' : ''} ${call.pinned === key ? 'pinned' : ''}" data-tile="${key}">
    <video autoplay playsinline ${self ? 'muted' : ''}></video>
    <div class="tile-av">${avatar(u, 88)}</div>
    <div class="tile-name">${state.audio === false ? icon('micOff', 14) : ''}${esc(name)}${state.hand ? ' ✋' : ''}</div>
    <div class="tile-status"></div></div>`;
}

function renderTiles() {
  if (!call) return;
  const el = $('#call');
  if (!el) return;
  const tiles = el.querySelector('.tiles');
  const keys = ['self', ...call.peers.keys()];
  // Перерисовываем только набор плиток; видео-элементы переиспользуем, чтобы не мигало.
  const existing = new Map([...tiles.children].map((n) => [n.dataset.tile, n]));
  for (const [k, n] of existing) if (!keys.includes(k)) n.remove();
  for (const k of keys) {
    let n = existing.get(k);
    const p = call.peers.get(k);
    const state = k === 'self' ? { audio: call.mic, video: call.video || !!call.screen, screen: !!call.screen, hand: call.hand } : p.state;
    if (!n) {
      const tmp = document.createElement('div');
      tmp.innerHTML = tileHtml(k, p?.userId, { self: k === 'self', state });
      n = tmp.firstElementChild;
      tiles.appendChild(n);
    } else {
      const u = k === 'self' ? S.me : S.users.get(p.userId) || { name: userName(p.userId) };
      n.querySelector('.tile-name').innerHTML = `${state.audio === false ? icon('micOff', 14) : ''}${esc(k === 'self' ? t('call.you') : u.name)}${state.hand ? ' ✋' : ''}`;
      n.classList.toggle('pinned', call.pinned === k);
      n.classList.toggle('screen', !!state.screen);
    }
    const v = n.querySelector('video');
    const stream = k === 'self' ? (call.screen || call.local) : p.stream;
    if (v.srcObject !== stream) {
      v.srcObject = stream;
      v.onresize = () => renderTiles();
      v.onloadeddata = () => renderTiles();
      v.play?.().catch(() => {});
    }
    // Флаг muted у входящей дорожки ненадёжен (Chrome не снимает его после отката согласования),
    // поэтому смотрим на реальные кадры (videoWidth) и на то, что участник сообщил о камере.
    const live = stream && stream.getVideoTracks().some((tr) => tr.readyState === 'live');
    const hasVideo = live && (k === 'self' ? (state.video || state.screen) : (state.video || state.screen) && v.videoWidth > 0);
    n.classList.toggle('has-video', !!hasVideo);
    n.classList.toggle('mirror', k === 'self' && !call.screen);
    n.querySelector('.tile-status').textContent = p && !peerConnected(p) && !(v.videoWidth > 0) ? t('call.connecting') : '';
  }
  tiles.dataset.count = String(Math.min(keys.length, 9));
  tiles.classList.toggle('speaker', call.layout === 'speaker' || !!call.pinned);
  updateTimer();
}

function updateTimer() {
  if (!call) return;
  const el = $('#call');
  const sub = el?.querySelector('.call-sub');
  const chat = S.chats.get(call.chatId);
  let text;
  if (!call.id) text = t('call.connecting');
  else if (chat?.type === 'direct' && !call.answered) text = t('call.calling');
  else {
    const n = call.peers.size + 1;
    text = `${fmtDuration((Date.now() - (call.answered || call.started)) / 1000)}${chat?.type !== 'direct' ? ` · ${t('call.participants', { n })}` : ''}`;
  }
  if (sub) sub.textContent = text;
  const pill = $('#call-pill .pill-time');
  if (pill) pill.textContent = text;
}

function renderPill() {
  let pill = $('#call-pill');
  if (!call.minimized) { pill?.remove(); return; }
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'call-pill';
    pill.className = 'call-pill';
    pill.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b?.dataset.c === 'mic') { toggleMic(); return; }
      if (b?.dataset.c === 'hangup') { hangup(); return; }
      expand();
    });
    document.body.appendChild(pill);
  }
  pill.innerHTML = `<span class="pill-dot"></span><b>${esc(callTitle())}</b><span class="pill-time"></span>
    <button class="icon-btn ghost" data-c="mic">${icon(call.mic ? 'mic' : 'micOff', 18)}</button>
    <button class="icon-btn ghost red" data-c="hangup">${icon('phoneOff', 18)}</button>`;
  updateTimer();
}

function onCallClick(e) {
  const b = e.target.closest('[data-c]');
  const tile = e.target.closest('[data-tile]');
  if (!b) {
    if (tile && call) { call.pinned = call.pinned === tile.dataset.tile ? null : tile.dataset.tile; renderTiles(); }
    return;
  }
  switch (b.dataset.c) {
    case 'mic': toggleMic(); break;
    case 'cam': toggleCamera(); break;
    case 'screen': toggleScreen(); break;
    case 'hand': toggleHand(); break;
    case 'react': b.parentElement.classList.toggle('open'); break;
    case 'emoji': sendReaction(b.dataset.e); b.closest('.call-react-wrap').classList.remove('open'); break;
    case 'hangup': hangup(); break;
    case 'min': minimize(); break;
    case 'layout': call.layout = call.layout === 'grid' ? 'speaker' : 'grid'; call.pinned = null; renderTiles(); break;
    default:
  }
}

function floatReaction(emoji, userId) {
  const host = $('#call .float-reactions');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'float-r';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.innerHTML = `<span>${esc(emoji)}</span><small>${esc(userId === S.me.id ? t('call.you') : userName(userId))}</small>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Подсветка говорящего: уровень звука по каждому потоку.
function startLevelMeter() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analysers = new Map();
    const timer = setInterval(() => {
      if (!call) return;
      const entries = [['self', call.local], ...[...call.peers].map(([k, p]) => [k, p.stream])];
      for (const [k, stream] of entries) {
        const track = stream?.getAudioTracks()[0];
        if (!track) continue;
        let a = analysers.get(k);
        if (!a || a.track !== track) {
          try {
            const src = ctx.createMediaStreamSource(new MediaStream([track]));
            const an = ctx.createAnalyser();
            an.fftSize = 256;
            src.connect(an);
            a = { an, track, data: new Uint8Array(an.fftSize) };
            analysers.set(k, a);
          } catch { continue; }
        }
        a.an.getByteTimeDomainData(a.data);
        let peak = 0;
        for (const v of a.data) peak = Math.max(peak, Math.abs(v - 128));
        const tile = document.querySelector(`[data-tile="${k}"]`);
        if (tile) tile.classList.toggle('speaking', peak > 14 && (k !== 'self' || call.mic));
      }
    }, 200);
    call.levels = { ctx, timer };
  } catch { /* без индикатора */ }
}

// Горячие клавиши в звонке
document.addEventListener('keydown', (e) => {
  if (!call || call.minimized || e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'm' || e.key === 'ь') { e.preventDefault(); toggleMic(); }
  if (e.key === 'v' || e.key === 'м') { e.preventDefault(); toggleCamera(); }
});
window.addEventListener('beforeunload', () => { if (call) hangup(); });
