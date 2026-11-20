// Голосовые сообщения: запись с «волной» и проигрыватель с перемоткой и скоростью.
import { fmtDuration } from './util.js';
import { icon } from './icons.js';

export class Recorder {
  constructor() {
    this.chunks = [];
    this.levels = [];
    this.started = 0;
  }
  static supported() { return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder); }

  async start(onTick) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mimeType = types.find((tp) => MediaRecorder.isTypeSupported?.(tp)) || '';
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    src.connect(this.analyser);
    const data = new Uint8Array(this.analyser.fftSize);
    this.rec.start(250);
    this.started = Date.now();
    const tick = () => {
      if (!this.rec || this.rec.state !== 'recording') return;
      this.analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      this.levels.push(Math.min(100, Math.round((peak / 128) * 160)));
      if (onTick) onTick((Date.now() - this.started) / 1000, this.levels[this.levels.length - 1]);
      this.raf = setTimeout(tick, 80);
    };
    tick();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) { resolve(null); return; }
      const duration = (Date.now() - this.started) / 1000;
      this.rec.onstop = () => {
        const type = this.rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        this.cleanup();
        resolve({ blob, duration, waveform: compress(this.levels, 48) });
      };
      this.rec.stop();
    });
  }

  cancel() {
    if (this.rec && this.rec.state === 'recording') { this.rec.onstop = null; this.rec.stop(); }
    this.cleanup();
  }

  cleanup() {
    clearTimeout(this.raf);
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }
}

function compress(levels, n) {
  if (!levels.length) return new Array(n).fill(8);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * levels.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * levels.length));
    let max = 0;
    for (let j = a; j < b && j < levels.length; j++) max = Math.max(max, levels[j]);
    out.push(Math.max(6, max));
  }
  return out;
}

// ---------- Проигрыватель ----------
let current = null; // { audio, el }
const SPEEDS = [1, 1.5, 2];

export function voiceHtml(file, mine) {
  const wf = (file.meta?.waveform?.length ? file.meta.waveform : new Array(40).fill(20));
  const bars = wf.map((v) => `<i style="height:${Math.max(12, v)}%"></i>`).join('');
  return `<div class="voice ${mine ? 'mine' : ''}" data-voice="${file.url}" data-duration="${file.meta?.duration || 0}">
    <button class="voice-play" data-action="voice-play" aria-label="play">${icon('play', 18)}</button>
    <div class="voice-main"><div class="voice-wave" data-action="voice-seek">${bars}<div class="voice-progress"></div></div>
    <div class="voice-meta"><span class="voice-time">${fmtDuration(file.meta?.duration || 0)}</span><button class="voice-speed" data-action="voice-speed">1×</button></div></div></div>`;
}

function setProgress(el, audio) {
  const d = audio.duration && Number.isFinite(audio.duration) ? audio.duration : Number(el.dataset.duration) || 1;
  const p = Math.min(1, audio.currentTime / d);
  el.querySelector('.voice-progress').style.width = `${p * 100}%`;
  el.querySelectorAll('.voice-wave i').forEach((bar, i, all) => bar.classList.toggle('on', i / all.length <= p));
  el.querySelector('.voice-time').textContent = fmtDuration(audio.paused && audio.currentTime === 0 ? d : audio.currentTime);
}

export function toggleVoice(el) {
  if (current && current.el === el) {
    if (current.audio.paused) current.audio.play(); else current.audio.pause();
    return;
  }
  if (current) { current.audio.pause(); }
  const audio = new Audio(el.dataset.voice);
  audio.playbackRate = Number(el.dataset.speed || 1);
  current = { audio, el };
  const btn = el.querySelector('.voice-play');
  audio.onplay = () => { btn.innerHTML = icon('pause', 18); el.classList.add('playing'); };
  audio.onpause = () => { btn.innerHTML = icon('play', 18); el.classList.remove('playing'); };
  audio.ontimeupdate = () => setProgress(el, audio);
  audio.onended = () => {
    btn.innerHTML = icon('play', 18);
    el.classList.remove('playing');
    audio.currentTime = 0;
    setProgress(el, audio);
    // Автопроигрывание следующего голосового, как в Telegram.
    const all = [...document.querySelectorAll('.messages .voice')];
    const next = all[all.indexOf(el) + 1];
    current = null;
    if (next) toggleVoice(next);
  };
  audio.play().catch(() => {});
}

export function seekVoice(el, ev) {
  const wave = el.querySelector('.voice-wave');
  const r = wave.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  if (!current || current.el !== el) toggleVoice(el);
  const a = current.audio;
  const go = () => { a.currentTime = p * (Number.isFinite(a.duration) ? a.duration : Number(el.dataset.duration)); };
  if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
}

export function cycleSpeed(el) {
  const cur = Number(el.dataset.speed || 1);
  const next = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length];
  el.dataset.speed = next;
  el.querySelector('.voice-speed').textContent = `${next}×`;
  if (current && current.el === el) current.audio.playbackRate = next;
}
