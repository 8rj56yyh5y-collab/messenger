// Видео-кружки как в Telegram: запись с фронтальной камеры до 60 секунд, круглый предпросмотр.
import { t, errText } from './i18n.js';
import { esc, fmtDuration } from './util.js';
import { icon } from './icons.js';
import { upload, post } from './api.js';
import { toast } from './dialogs.js';

const MAX_SEC = 60;

export async function recordVideoNote(chatId) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast(t('call.unsupported'), { type: 'error' }); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1 }, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { toast(t('call.no_camera'), { type: 'error' }); return; }
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
  const mimeType = types.find((tp) => MediaRecorder.isTypeSupported?.(tp)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 900_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const el = document.createElement('div');
  el.className = 'vnote-overlay';
  el.innerHTML = `<div class="vnote-stage"><div class="vnote-circle"><video autoplay playsinline muted></video>
      <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="48"/><circle class="prog" cx="50" cy="50" r="48"/></svg></div>
      <div class="vnote-time"><span class="rec-dot"></span><b>0:00</b></div>
      <div class="vnote-actions"><button class="call-btn" data-v="cancel" title="${esc(t('common.cancel'))}">${icon('trash', 22)}</button>
      <button class="call-btn green" data-v="send" title="${esc(t('compose.send'))}">${icon('send', 22)}</button></div>
      <p class="vnote-hint">${esc(t('vnote.hint'))}</p></div>`;
  document.body.appendChild(el);
  const video = el.querySelector('video');
  video.srcObject = stream;
  const started = Date.now();
  rec.start(250);
  const prog = el.querySelector('.prog');
  const timer = setInterval(() => {
    const sec = (Date.now() - started) / 1000;
    el.querySelector('.vnote-time b').textContent = fmtDuration(sec);
    prog.style.strokeDashoffset = String(301.6 * (1 - Math.min(1, sec / MAX_SEC)));
    if (sec >= MAX_SEC) finish(true);
  }, 200);

  let done = false;
  function stop() {
    clearInterval(timer);
    stream.getTracks().forEach((tr) => tr.stop());
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }
  document.addEventListener('keydown', onKey, true);

  async function finish(send) {
    if (done) return;
    done = true;
    const duration = Math.round((Date.now() - started) / 1000);
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    stop();
    if (!send || duration < 1) return;
    const type = (rec.mimeType || 'video/webm').split(';')[0];
    const file = new File([new Blob(chunks, { type })], `video-note.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
    toast(t('vnote.sending'));
    try {
      const f = await upload(file, { meta: { duration, width: 480, height: 480 } });
      await post(`/api/chats/${chatId}/messages`, { kind: 'video', file_id: f.id, round: true });
    } catch (e) { toast(errText(e), { type: 'error' }); }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) finish(b.dataset.v === 'send');
  });
}
