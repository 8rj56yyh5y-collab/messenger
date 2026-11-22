// Настройки: профиль, оформление, язык, уведомления, чаты, приватность и безопасность, звонки.
import { S, emit } from './store.js';
import { t, LANGS, setLang, getLang, errText } from './i18n.js';
import { $, esc, avatar, fmtDateTime, setTimeFormat } from './util.js';
import { icon } from './icons.js';
import { get, patch, post, del, upload } from './api.js';
import { modal, toast, confirmDialog } from './dialogs.js';
import { pushSupported, pushState, enablePush, disablePush } from './push.js';

const ACCENTS = {
  blue: ['#3390ec', '#8774e1'], violet: ['#8774e1', '#c86bd6'], green: ['#4fae4e', '#2fa3a0'], lime: ['#86b300', '#3d9a50'],
  orange: ['#f08a24', '#e5533d'], pink: ['#e05a8c', '#a65be0'], graphite: ['#5f6b7a', '#2f3640'],
};
const WALLPAPERS = ['animated', 'pattern', 'gradient', 'aurora', 'plain', 'dots'];

export function applyTheme() {
  const pref = S.settings?.theme || (() => { try { return localStorage.getItem('gc-theme'); } catch { return null; } })() || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('gc-theme', pref); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = dark ? '#0f1115' : '#ffffff';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

export function applyAppearance() {
  const s = S.settings || {};
  const root = document.documentElement;
  const [a, b] = ACCENTS[s.accent] || ACCENTS.blue;
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-2', b);
  root.style.setProperty('--font-scale', String((Number(s.fontSize) || 15) / 15));
  root.style.setProperty('--bubble-r', `${Number(s.bubbleRadius ?? 16)}px`);
  root.dataset.compact = s.compact ? '1' : '0';
  root.dataset.motion = s.animations === false ? 'off' : 'on';
  document.querySelectorAll('.chat').forEach((el) => { el.style.setProperty('--wall', `var(--wall-${s.wallpaper || 'animated'})`); el.dataset.wall = s.wallpaper || 'animated'; });
}

async function saveSettings(part) {
  Object.assign(S.settings, part);
  applyTheme();
  applyAppearance();
  try { await patch('/api/me', { settings: part }); } catch (e) { toast(errText(e), { type: 'error' }); }
}

const SECTIONS = [
  ['profile', 'user'], ['appearance', 'sun'], ['language', 'globe'], ['notifications', 'bell'],
  ['chats', 'send'], ['privacy', 'lock'], ['devices', 'video'], ['about', 'info'],
];

export function openSettings(section = null, { forced = false } = {}) {
  const m = modal({ title: t('side.settings'), wide: true, cls: 'settings-modal', content: '' });
  const draw = (sec) => {
    m.body.innerHTML = `<div class="settings"><nav class="set-nav">${SECTIONS.map(([k, ic]) => `<button class="${sec === k ? 'on' : ''}" data-sec="${k}">${icon(ic, 20)}<span>${esc(t(`settings.${k}`))}</span></button>`).join('')}</nav>
      <div class="set-body"></div></div>`;
    m.body.querySelector('.settings').classList.toggle('has-sec', !!sec);
    m.body.querySelectorAll('[data-sec]').forEach((b) => { b.onclick = () => draw(b.dataset.sec); });
    const body = m.body.querySelector('.set-body');
    if (!sec) { body.innerHTML = profileCard(); body.querySelector('[data-go]')?.addEventListener('click', () => draw('profile')); return; }
    body.innerHTML = `<button class="link-btn only-mobile set-back" data-back>${icon('back', 16)} ${esc(t('common.back'))}</button>`;
    body.querySelector('[data-back]').onclick = () => draw(null);
    const wrap = document.createElement('div');
    body.appendChild(wrap);
    RENDER[sec](wrap, { forced, redraw: () => draw(sec) });
  };
  if (section === 'security') section = 'privacy';
  draw(section || (window.matchMedia('(max-width: 760px)').matches ? null : 'profile'));
  return m;
}

function profileCard() {
  return `<div class="set-card" data-go>${avatar(S.me, 72)}<div><b>${esc(S.me.name)}</b><span>${esc(S.me.position || `@${S.me.login}`)}</span></div></div>`;
}

const toggle = (id, label, on, hint = '') => `<label class="switch-row"><div><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div>
  <input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''}></label>`;

const RENDER = {
  profile(el) {
    const u = S.me;
    const fromGobsek = u.gobsek;
    el.innerHTML = `<h2>${esc(t('settings.profile'))}</h2>
      <div class="avatar-edit"><label class="av-pick">${avatar(u, 110)}<input type="file" accept="image/*" hidden><span>${icon('image', 20)}</span></label>
      ${u.avatar ? `<button class="link-btn" id="av-del">${esc(t('profile.remove_photo'))}</button>` : ''}</div>
      <label class="field"><span>${esc(t('profile.name'))}</span><input class="input" id="p-name" maxlength="100" value="${esc(u.name)}"></label>
      <label class="field"><span>${esc(t('profile.status_text'))}</span><input class="input" id="p-st" maxlength="100" value="${esc(u.status_text)}" placeholder="${esc(t('profile.status_ph'))}"></label>
      <label class="field"><span>${esc(t('profile.bio'))}</span><textarea class="input" id="p-bio" rows="3" maxlength="300" placeholder="${esc(t('profile.bio_ph'))}">${esc(u.bio)}</textarea></label>
      <div class="grid-2">
        <label class="field"><span>${esc(t('profile.position'))}</span><input class="input" id="p-pos" maxlength="100" value="${esc(u.position)}" ${fromGobsek ? 'disabled' : ''}></label>
        <label class="field"><span>${esc(t('profile.department'))}</span><input class="input" id="p-dep" maxlength="100" value="${esc(u.department)}" ${fromGobsek ? 'disabled' : ''}></label>
        <label class="field"><span>E-mail</span><input class="input" id="p-email" type="email" maxlength="100" value="${esc(u.email)}"></label>
        <label class="field"><span>${esc(t('profile.phone'))}</span><input class="input" id="p-phone" maxlength="40" value="${esc(u.phone)}"></label>
        <label class="field"><span>${esc(t('profile.birthday'))}</span><input class="input" id="p-bd" type="date" value="${esc(/^\d{4}-/.test(u.birthday_full || '') ? u.birthday_full : '')}"></label>
      </div>
      ${fromGobsek ? `<p class="muted small">${icon('shield', 14)} ${esc(t('profile.from_gobsek'))}</p>` : ''}
      <p class="muted small">@${esc(u.login)}</p>
      <div class="modal-actions"><button class="btn" id="p-save">${esc(t('common.save'))}</button></div>`;
    let avatarFile;
    el.querySelector('.av-pick input').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const up = await upload(f);
        avatarFile = up.id;
        el.querySelector('.av-pick .av').outerHTML = `<span class="av" style="width:110px;height:110px"><img src="${up.url}" alt=""></span>`;
      } catch (err) { toast(errText(err), { type: 'error' }); }
    };
    el.querySelector('#av-del')?.addEventListener('click', async () => {
      const { user } = await patch('/api/me', { avatar_file: null });
      Object.assign(S.me, user);
      RENDER.profile(el);
    });
    el.querySelector('#p-save').onclick = async () => {
      const body = {
        name: el.querySelector('#p-name').value, status_text: el.querySelector('#p-st').value, bio: el.querySelector('#p-bio').value,
        email: el.querySelector('#p-email').value, phone: el.querySelector('#p-phone').value, birthday: el.querySelector('#p-bd').value,
      };
      if (!fromGobsek) { body.position = el.querySelector('#p-pos').value; body.department = el.querySelector('#p-dep').value; }
      if (avatarFile) body.avatar_file = avatarFile;
      try {
        const { user } = await patch('/api/me', body);
        Object.assign(S.me, user);
        S.users.set(user.id, { ...S.users.get(user.id), ...user });
        toast(t('common.saved'));
      } catch (e) { toast(errText(e), { type: 'error' }); }
    };
  },

  appearance(el) {
    const s = S.settings;
    const theme = s.theme || 'system';
    el.innerHTML = `<h2>${esc(t('settings.appearance'))}</h2>
      <div class="sec-title">${esc(t('settings.theme'))}</div>
      <div class="theme-pick">${['light', 'dark', 'system'].map((k) => `<button class="theme-opt ${theme === k ? 'on' : ''}" data-theme="${k}"><span class="tp tp-${k}"><i></i><i></i></span>${esc(t(`theme.${k}`))}</button>`).join('')}</div>
      <div class="sec-title">${esc(t('settings.accent'))}</div>
      <div class="accent-pick">${Object.entries(ACCENTS).map(([k, [a, b]]) => `<button class="accent ${((s.accent || 'blue') === k) ? 'on' : ''}" data-accent="${k}" style="background:linear-gradient(135deg,${a},${b})" title="${k}"></button>`).join('')}</div>
      <div class="sec-title">${esc(t('settings.wallpaper'))}</div>
      <div class="wall-pick">${WALLPAPERS.map((w) => `<button class="wall ${(s.wallpaper || 'animated') === w ? 'on' : ''} w-${w}" data-wall="${w}" style="background:var(--wall-${w})"><span>${esc(t(`wall.${w}`))}</span></button>`).join('')}</div>
      <div class="sec-title">${esc(t('settings.font_size'))} <small id="fs-val">${Number(s.fontSize) || 15}px</small></div>
      <input type="range" min="13" max="20" step="1" value="${Number(s.fontSize) || 15}" id="fs" class="range">
      <div class="sec-title">${esc(t('settings.bubble_radius'))} <small id="br-val">${s.bubbleRadius ?? 16}px</small></div>
      <input type="range" min="4" max="22" step="1" value="${s.bubbleRadius ?? 16}" id="br" class="range">
      <div class="preview-bubbles"><div class="pb in">${esc(t('settings.preview_in'))}</div><div class="pb out">${esc(t('settings.preview_out'))}</div></div>
      ${toggle('s-compact', t('settings.compact'), s.compact, t('settings.compact_hint'))}
      ${toggle('s-anim', t('settings.animations'), s.animations !== false)}`;
    el.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { saveSettings({ theme: b.dataset.theme }); RENDER.appearance(el); }; });
    el.querySelectorAll('[data-accent]').forEach((b) => { b.onclick = () => { saveSettings({ accent: b.dataset.accent }); RENDER.appearance(el); }; });
    el.querySelectorAll('[data-wall]').forEach((b) => { b.onclick = () => { saveSettings({ wallpaper: b.dataset.wall }); RENDER.appearance(el); }; });
    const fs = el.querySelector('#fs');
    fs.oninput = () => { el.querySelector('#fs-val').textContent = `${fs.value}px`; S.settings.fontSize = Number(fs.value); applyAppearance(); };
    fs.onchange = () => saveSettings({ fontSize: Number(fs.value) });
    const br = el.querySelector('#br');
    br.oninput = () => { el.querySelector('#br-val').textContent = `${br.value}px`; S.settings.bubbleRadius = Number(br.value); applyAppearance(); };
    br.onchange = () => saveSettings({ bubbleRadius: Number(br.value) });
    el.querySelector('#s-compact').onchange = (e) => saveSettings({ compact: e.target.checked });
    el.querySelector('#s-anim').onchange = (e) => saveSettings({ animations: e.target.checked });
  },

  language(el) {
    el.innerHTML = `<h2>${esc(t('settings.language'))}</h2><div class="list">${LANGS.map((l) => `<button class="li-row lang-row ${getLang() === l.code ? 'on' : ''}" data-lang="${l.code}">
      <span class="flag">${l.flag}</span><div class="li-main"><b>${esc(l.name)}</b><span>${esc(l.code.toUpperCase())}</span></div>${getLang() === l.code ? icon('check', 20) : ''}</button>`).join('')}</div>
      <p class="muted small">${esc(t('settings.lang_hint'))}</p>`;
    el.querySelectorAll('[data-lang]').forEach((b) => {
      b.onclick = async () => {
        setLang(b.dataset.lang);
        await patch('/api/me', { lang: b.dataset.lang }).catch(() => {});
        location.reload();
      };
    });
  },

  notifications(el) {
    const s = S.settings;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    el.innerHTML = `<h2>${esc(t('settings.notifications'))}</h2>
      ${perm !== 'granted' ? `<div class="note">${icon('bell', 18)}<div>${esc(perm === 'denied' ? t('notify.denied') : perm === 'unsupported' ? t('notify.unsupported') : t('notify.ask'))}
        ${perm === 'default' ? `<button class="btn sm" id="n-ask">${esc(t('notify.enable'))}</button>` : ''}</div></div>` : ''}
      <div class="push-box"><div class="push-ic">${icon('bell', 22)}</div><div class="grow"><b>${esc(t('push.title'))}</b><small id="push-st">${esc(t('push.checking'))}</small></div>
        <button class="btn sm" id="push-btn" disabled>…</button></div>
      ${toggle('n-desk', t('notify.desktop'), s.notifications !== false, t('notify.desktop_hint'))}
      ${toggle('n-sound', t('notify.sounds'), s.sounds !== false)}
      ${toggle('n-prev', t('notify.preview'), s.preview !== false, t('notify.preview_hint'))}
      <p class="muted small">${esc(t('notify.dnd_hint'))}</p>
      <button class="btn soft sm" id="n-test">${esc(t('notify.test'))}</button>`;
    el.querySelector('#n-ask')?.addEventListener('click', () => Notification.requestPermission().then(() => RENDER.notifications(el)));
    const pst = async () => {
      const st = await pushState().catch(() => 'unsupported');
      const btn = el.querySelector('#push-btn');
      const lbl = el.querySelector('#push-st');
      if (!btn) return;
      lbl.textContent = t(`push.st_${st}`);
      btn.disabled = st === 'unsupported' || st === 'denied';
      btn.textContent = st === 'on' ? t('push.disable') : t('push.enable');
      btn.className = st === 'on' ? 'btn sm soft' : 'btn sm';
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          if (st === 'on') { await disablePush(); try { localStorage.setItem('gc-push', 'off'); } catch { /* ignore */ } } else {
            await enablePush(); try { localStorage.removeItem('gc-push'); } catch { /* ignore */ }
            await post('/api/push/test');
          }
        } catch (e) { toast(e.message === 'denied' ? t('notify.denied') : t('push.failed'), { type: 'error' }); }
        pst();
      };
    };
    pst();
    el.querySelector('#n-desk').onchange = (e) => saveSettings({ notifications: e.target.checked });
    el.querySelector('#n-sound').onchange = (e) => saveSettings({ sounds: e.target.checked });
    el.querySelector('#n-prev').onchange = (e) => saveSettings({ preview: e.target.checked });
    el.querySelector('#n-test').onclick = () => {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(S.meta.name, { body: t('notify.test_body'), icon: '/icon.svg' });
      else toast(t('notify.test_body'));
    };
  },

  chats(el) {
    const s = S.settings;
    const quick = s.quickReactions || S.meta.reactions.slice(0, 7);
    el.innerHTML = `<h2>${esc(t('settings.chats'))}</h2>
      ${toggle('c-enter', t('settings.send_on_enter'), s.sendOnEnter !== false, t('settings.send_on_enter_hint'))}
      <div class="sec-title">${esc(t('settings.time_format'))}</div>
      <div class="seg"><button class="${s.timeFormat !== '12' ? 'on' : ''}" data-tf="24">24h · 14:30</button><button class="${s.timeFormat === '12' ? 'on' : ''}" data-tf="12">12h · 2:30 PM</button></div>
      <div class="sec-title">${esc(t('settings.quick_reactions'))}</div>
      <p class="muted small">${esc(t('settings.quick_hint'))}</p>
      <div class="react-pick">${S.meta.reactions.map((e) => `<button class="${quick.includes(e) ? 'on' : ''}" data-r="${e}">${e}</button>`).join('')}</div>
      <div class="sec-title">${esc(t('tpl.title'))}</div>
      <p class="muted small">${esc(t('tpl.hint'))}</p>
      <textarea class="input" id="c-tpl" rows="4" placeholder="${esc(t('tpl.ph'))}">${esc((s.templates || []).join('\n'))}</textarea>
      <div class="sec-title">${esc(t('auto.title'))}</div>
      ${toggle('c-auto', t('auto.enable'), s.autoReply?.enabled, t('auto.hint'))}
      <textarea class="input" id="c-auto-text" rows="2" maxlength="1000" placeholder="${esc(t('auto.ph'))}">${esc(s.autoReply?.text || '')}</textarea>
      <div class="sec-title">${esc(t('settings.shortcuts'))}</div>
      <div class="shortcuts">${[['Ctrl+K', 'sc.search'], ['Alt+↑/↓', 'sc.switch'], ['Esc', 'sc.close'], ['↑', 'sc.edit_last'], ['Ctrl+B / Ctrl+I', 'sc.format'], ['Shift+Enter', 'sc.newline'], ['M / V', 'sc.call'], ['Ctrl+,', 'sc.settings']]
      .map(([k, l]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t(l))}</span></div>`).join('')}</div>`;
    el.querySelector('#c-enter').onchange = (e) => saveSettings({ sendOnEnter: e.target.checked });
    el.querySelector('#c-tpl').onchange = (e) => saveSettings({ templates: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50) });
    const saveAuto = () => saveSettings({ autoReply: { enabled: el.querySelector('#c-auto').checked, text: el.querySelector('#c-auto-text').value.trim() } });
    el.querySelector('#c-auto').onchange = saveAuto;
    el.querySelector('#c-auto-text').onchange = saveAuto;
    el.querySelectorAll('[data-tf]').forEach((b) => { b.onclick = () => { saveSettings({ timeFormat: b.dataset.tf }); setTimeFormat(b.dataset.tf); RENDER.chats(el); }; });
    el.querySelectorAll('[data-r]').forEach((b) => {
      b.onclick = () => {
        let q = [...(S.settings.quickReactions || S.meta.reactions.slice(0, 7))];
        if (q.includes(b.dataset.r)) q = q.filter((x) => x !== b.dataset.r); else q.push(b.dataset.r);
        if (!q.length || q.length > 7) { toast(t('settings.quick_limit')); return; }
        saveSettings({ quickReactions: q });
        RENDER.chats(el);
      };
    });
  },

  async privacy(el, { forced }) {
    const s = S.settings;
    el.innerHTML = `<h2>${esc(t('settings.privacy'))}</h2>
      ${forced ? `<div class="note warn">${icon('key', 18)}<div>${esc(t('security.must_change'))}</div></div>` : ''}
      ${toggle('pv-seen', t('privacy.hide_seen'), s.hideLastSeen, t('privacy.hide_seen_hint'))}
      ${toggle('pv-email', t('privacy.hide_email'), s.hideEmail)}
      ${toggle('pv-phone', t('privacy.hide_phone'), s.hidePhone)}
      <div class="sec-title">${esc(t('security.password'))}</div>
      <form id="pw-form" class="stack">
        ${S.me.has_password ? `<input class="input" type="password" name="current" placeholder="${esc(t('security.current'))}" autocomplete="current-password" required>` : ''}
        <input class="input" type="password" name="password" placeholder="${esc(t('security.new'))}" autocomplete="new-password" minlength="8" required>
        <div class="form-error hidden"></div><button class="btn sm" type="submit">${esc(t('security.change'))}</button></form>
      <div class="sec-title">${esc(t('security.sessions'))}</div><div class="sessions"><span class="spinner sm"></span></div>
      <p class="muted small">${icon('shield', 14)} ${esc(t('security.e2e_note'))}</p>`;
    el.querySelector('#pv-seen').onchange = (e) => saveSettings({ hideLastSeen: e.target.checked });
    el.querySelector('#pv-email').onchange = (e) => saveSettings({ hideEmail: e.target.checked });
    el.querySelector('#pv-phone').onchange = (e) => saveSettings({ hidePhone: e.target.checked });
    el.querySelector('#pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await post('/api/me/password', f);
        S.me.must_change_pw = false;
        S.me.has_password = true;
        toast(t('security.changed'));
        e.target.reset();
      } catch (err) { const x = el.querySelector('#pw-form .form-error'); x.textContent = errText(err); x.classList.remove('hidden'); }
    };
    const list = await get('/api/me/sessions').catch(() => []);
    const box = el.querySelector('.sessions');
    if (!box) return;
    box.innerHTML = list.map((s2) => `<div class="li-row">${icon(/Mobile|Android|iPhone/i.test(s2.ua) ? 'phone' : 'screen', 22)}<div class="li-main"><b>${esc(browserName(s2.ua))}${s2.current ? ` · <span class="online-txt">${esc(t('security.this_device'))}</span>` : ''}</b>
      <span>${esc(s2.ip)} · ${esc(fmtDateTime(s2.last_used))}</span></div>${s2.current ? '' : `<button class="icon-btn ghost" data-kill="${s2.id}">${icon('x', 18)}</button>`}</div>`).join('')
      + (list.length > 1 ? `<button class="btn soft sm danger" id="kill-all">${esc(t('security.logout_others'))}</button>` : '');
    box.onclick = async (e) => {
      const k = e.target.closest('[data-kill]');
      if (k) { await del(`/api/me/sessions/${k.dataset.kill}`); RENDER.privacy(el, {}); return; }
      if (e.target.closest('#kill-all') && await confirmDialog(t('security.logout_others_q'), { danger: true })) { await del('/api/me/sessions/others'); RENDER.privacy(el, {}); }
    };
  },

  async devices(el) {
    el.innerHTML = `<h2>${esc(t('settings.devices'))}</h2><p class="muted small">${esc(t('devices.hint'))}</p>
      <div class="dev-preview"><video autoplay playsinline muted></video><div class="meter"><i></i></div></div>
      <label class="field"><span>${esc(t('devices.mic'))}</span><select class="input" id="d-mic"></select></label>
      <label class="field"><span>${esc(t('devices.cam'))}</span><select class="input" id="d-cam"></select></label>
      <button class="btn soft sm" id="d-test">${icon('video', 16)} ${esc(t('devices.test'))}</button>`;
    let stream = null;
    const fill = async () => {
      const devs = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
      const pick = (kind, id, key) => {
        const sel = el.querySelector(id);
        const cur = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
        sel.innerHTML = `<option value="">${esc(t('devices.default'))}</option>${devs.filter((d) => d.kind === kind).map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `${kind} ${i + 1}`)}</option>`).join('')}`;
        sel.onchange = () => { try { if (sel.value) localStorage.setItem(key, sel.value); else localStorage.removeItem(key); } catch { /* ignore */ } };
      };
      pick('audioinput', '#d-mic', 'gc-mic');
      pick('videoinput', '#d-cam', 'gc-cam');
    };
    fill();
    el.querySelector('#d-test').onclick = async () => {
      if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; el.querySelector('video').srcObject = null; return; }
      try {
        const mic = el.querySelector('#d-mic').value;
        const cam = el.querySelector('#d-cam').value;
        stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { deviceId: { exact: mic } } : true, video: cam ? { deviceId: { exact: cam } } : true });
        el.querySelector('video').srcObject = stream;
        fill();
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(an);
        const data = new Uint8Array(an.fftSize);
        const tick = () => {
          if (!stream || !el.isConnected) { ctx.close(); stream?.getTracks().forEach((tr) => tr.stop()); return; }
          an.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          const bar = el.querySelector('.meter i');
          if (bar) bar.style.width = `${Math.min(100, peak * 1.6)}%`;
          requestAnimationFrame(tick);
        };
        tick();
      } catch { toast(t('call.no_mic'), { type: 'error' }); }
    };
  },

  about(el) {
    el.innerHTML = `<h2>${esc(t('settings.about'))}</h2>
      <div class="about"><span class="logo-mark">${icon('send', 30)}</span><h3>${esc(S.meta.name)}</h3><p class="muted">v${esc(S.meta.version)}</p>
      <p>${esc(t('about.text'))}</p>
      <ul class="feature-list">${['about.f1', 'about.f2', 'about.f3', 'about.f4', 'about.f5', 'about.f6'].map((k) => `<li>${icon('check', 16)} ${esc(t(k))}</li>`).join('')}</ul>
      <p class="muted small">${esc(t('about.ai', { state: S.meta.ai ? t('about.on') : t('about.off') }))}<br>${esc(t('about.sso', { state: S.meta.sso ? t('about.on') : t('about.off') }))}</p></div>`;
  },
};
RENDER.security = RENDER.privacy;

function browserName(ua) {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'macOS' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
}

emit('settings:ready');
