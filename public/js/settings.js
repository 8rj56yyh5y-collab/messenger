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
const FONTS = { default: '"Onest", system-ui, sans-serif', system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, "SF Mono", Consolas, monospace' };

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
  root.dataset.motion = s.animations === false || s.reduceMotion ? 'off' : 'on';
  const ds = { font: s.font || 'default', msgLayout: s.msgLayout || 'bubbles', bubbleWidth: s.bubbleWidth || 'normal', chatWidth: s.chatWidth || 'full',
    groupAvatars: s.groupAvatars === false ? '0' : '1', chatPreview: s.chatPreview === false ? '0' : '1', contrast: s.contrast ? 'high' : 'normal',
    bigTargets: s.bigTargets ? '1' : '0', underlineLinks: s.underlineLinks ? '1' : '0', mirror: s.mirror === false ? '0' : '1', bigEmoji: s.bigEmoji === false ? '0' : '1' };
  for (const [k, v] of Object.entries(ds)) root.dataset[k] = v;
  document.querySelectorAll('#composer-input').forEach((ta) => { ta.spellcheck = s.spellcheck !== false; });
  document.querySelectorAll('.chat').forEach((el) => { el.style.setProperty('--wall', `var(--wall-${s.wallpaper || 'animated'})`); el.dataset.wall = s.wallpaper || 'animated'; });
}

async function saveSettings(part) {
  Object.assign(S.settings, part);
  applyTheme();
  applyAppearance();
  try { await patch('/api/me', { settings: part }); } catch (e) { toast(errText(e), { type: 'error' }); }
}

const SECTIONS = [
  ['profile', 'user'], ['appearance', 'palette'], ['language', 'globe'], ['notifications', 'bell'],
  ['chats', 'chat'], ['devices', 'video'], ['access', 'access'], ['privacy', 'lock'], ['data', 'database'], ['about', 'info'],
];

// Індекс для пошуку по налаштуваннях: [розділ, ключ перекладу, id елемента для підсвічування]
const INDEX = [
  ['profile', 'profile.name', 'p-name'], ['profile', 'profile.status_text', 'p-st'], ['profile', 'profile.bio', 'p-bio'], ['profile', 'profile.birthday', 'p-bd'], ['profile', 'profile.phone', 'p-phone'],
  ['appearance', 'settings.theme'], ['appearance', 'settings.accent'], ['appearance', 'settings.wallpaper'], ['appearance', 'settings.font_size', 'fs'],
  ['appearance', 'set.font'], ['appearance', 'set.msg_layout'], ['appearance', 'set.bubble_width'], ['appearance', 'set.chat_width', 's-cwidth'],
  ['appearance', 'set.group_avatars', 's-gav'], ['appearance', 'set.chat_preview', 's-prevw'], ['appearance', 'settings.bubble_radius', 'br'], ['appearance', 'settings.compact', 's-compact'], ['appearance', 'settings.animations', 's-anim'],
  ['language', 'settings.language'],
  ['notifications', 'push.title'], ['notifications', 'notify.desktop', 'n-desk'], ['notifications', 'notify.sounds', 'n-sound'], ['notifications', 'set.volume', 'n-vol'], ['notifications', 'notify.preview', 'n-prev'],
  ['notifications', 'set.quiet', 'n-quiet'], ['notifications', 'set.off_hours', 'n-offh'], ['notifications', 'set.group_notify'],
  ['notifications', 'set.n_tasks', 'n-tasks'], ['notifications', 'set.n_approvals', 'n-appr'], ['notifications', 'set.n_kudos', 'n-kudos'], ['notifications', 'set.n_meetings', 'n-meet'], ['notifications', 'set.n_awards', 'n-awards'],
  ['chats', 'settings.send_on_enter', 'c-enter'], ['chats', 'set.spellcheck', 'c-spell'], ['chats', 'set.big_emoji', 'c-bigemoji'], ['chats', 'set.chat_sort'], ['chats', 'set.start_page'],
  ['chats', 'settings.time_format'], ['chats', 'settings.quick_reactions'], ['chats', 'tpl.title', 'c-tpl'], ['chats', 'auto.title', 'c-auto'], ['chats', 'settings.shortcuts'],
  ['devices', 'devices.mic', 'd-mic'], ['devices', 'devices.cam', 'd-cam'], ['devices', 'set.call_mute', 'd-mute'], ['devices', 'set.call_cam_off', 'd-camoff'],
  ['devices', 'set.noise', 'd-noise'], ['devices', 'set.echo', 'd-echo'], ['devices', 'set.agc', 'd-agc'], ['devices', 'set.mirror', 'd-mirror'],
  ['access', 'set.contrast', 'a-contrast'], ['access', 'set.big_targets', 'a-big'], ['access', 'set.underline', 'a-under'], ['access', 'set.reduce_motion', 'a-motion'],
  ['privacy', 'privacy.hide_seen', 'pv-seen'], ['privacy', 'privacy.hide_email', 'pv-email'], ['privacy', 'privacy.hide_phone', 'pv-phone'], ['privacy', 'security.password'], ['privacy', 'security.sessions'],
  ['data', 'set.export'], ['data', 'set.import'], ['data', 'set.clear_cache'], ['data', 'set.reset'],
];

export function openSettings(section = null, { forced = false } = {}) {
  const m = modal({ title: t('side.settings'), wide: true, cls: 'settings-modal', content: '' });
  const draw = (sec) => {
    m.body.innerHTML = `<div class="settings"><nav class="set-nav"><div class="set-search">${icon('search', 16)}<input class="input" id="set-q" placeholder="${esc(t('set.search'))}" autocomplete="off"></div>${SECTIONS.map(([k, ic]) => `<button class="${sec === k ? 'on' : ''}" data-sec="${k}">${icon(ic, 20)}<span>${esc(t(`settings.${k}`))}</span></button>`).join('')}</nav>
      <div class="set-body"></div></div>`;
    m.body.querySelector('.settings').classList.toggle('has-sec', !!sec);
    m.body.querySelectorAll('[data-sec]').forEach((b) => { b.onclick = () => draw(b.dataset.sec); });
    const body = m.body.querySelector('.set-body');
    const q = m.body.querySelector('#set-q');
    q.oninput = () => {
      const v = q.value.trim().toLocaleLowerCase();
      m.body.querySelector('.settings').classList.toggle('searching', !!v);
      if (!v) { draw(sec); return; }
      const hits = INDEX.filter(([sc, key]) => t(key).toLocaleLowerCase().includes(v) || t(`settings.${sc}`).toLocaleLowerCase().includes(v));
      body.innerHTML = `<h2>${esc(t('set.search'))}</h2><div class="set-hits">${hits.map(([sc, key, id]) => `<button class="set-hit" data-hs="${sc}" data-hid="${id || ''}"><b>${esc(t(key))}</b><small>${esc(t(`settings.${sc}`))}</small></button>`).join('') || `<p class="muted">${esc(t('set.nothing'))}</p>`}</div>`;
      body.querySelectorAll('[data-hs]').forEach((h) => {
        h.onclick = () => {
          draw(h.dataset.hs);
          const target = h.dataset.hid && m.body.querySelector(`#${h.dataset.hid}`);
          if (!target) return;
          const row = target.closest('.switch-row, .field, label') || target;
          setTimeout(() => {
            // Прокручуємо лише праву частину, а не все вікно (scrollIntoView зсуває й меню)
            let sc = row.parentElement;
            while (sc && sc !== m.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
            if (sc) sc.scrollTo({ top: sc.scrollTop + row.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 3, behavior: 'smooth' });
            row.classList.add('flash');
            target.focus?.({ preventScroll: true });
          }, 60);
        };
      });
    };
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
      <div class="sec-title">${esc(t('set.font'))}</div>
      <div class="font-pick">${['default', 'system', 'rounded', 'serif', 'mono'].map((k) => `<button class="${(s.font || 'default') === k ? 'on' : ''}" data-font="${k}" style="font-family:${FONTS[k]}">${esc(t(`set.font_${k}`))}</button>`).join('')}</div>
      <div class="sec-title">${esc(t('set.msg_layout'))}</div>
      <div class="seg">${['bubbles', 'list'].map((k) => `<button class="${(s.msgLayout || 'bubbles') === k ? 'on' : ''}" data-ml="${k}">${esc(t(`set.ml_${k}`))}</button>`).join('')}</div>
      <p class="muted small">${esc(t('set.msg_layout_hint'))}</p>
      <div class="sec-title">${esc(t('set.bubble_width'))}</div>
      <div class="seg">${['narrow', 'normal', 'wide'].map((k) => `<button class="${(s.bubbleWidth || 'normal') === k ? 'on' : ''}" data-bw="${k}">${esc(t(`set.bw_${k}`))}</button>`).join('')}</div>
      ${toggle('s-cwidth', t('set.chat_width'), s.chatWidth === 'center', t('set.chat_width_hint'))}
      ${toggle('s-gav', t('set.group_avatars'), s.groupAvatars !== false)}
      ${toggle('s-prevw', t('set.chat_preview'), s.chatPreview !== false, t('set.chat_preview_hint'))}
      ${toggle('s-compact', t('settings.compact'), s.compact, t('settings.compact_hint'))}
      ${toggle('s-anim', t('settings.animations'), s.animations !== false)}`;
    el.querySelectorAll('[data-font]').forEach((b) => { b.onclick = () => { saveSettings({ font: b.dataset.font }); RENDER.appearance(el); }; });
    el.querySelectorAll('[data-ml]').forEach((b) => { b.onclick = () => { saveSettings({ msgLayout: b.dataset.ml }); RENDER.appearance(el); }; });
    el.querySelectorAll('[data-bw]').forEach((b) => { b.onclick = () => { saveSettings({ bubbleWidth: b.dataset.bw }); RENDER.appearance(el); }; });
    el.querySelector('#s-cwidth').onchange = (e) => saveSettings({ chatWidth: e.target.checked ? 'center' : 'full' });
    el.querySelector('#s-gav').onchange = (e) => saveSettings({ groupAvatars: e.target.checked });
    el.querySelector('#s-prevw').onchange = (e) => saveSettings({ chatPreview: e.target.checked });
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
      <div class="set-group" data-off="${s.sounds === false ? 1 : 0}" id="n-vol-g"><div class="sec-title">${esc(t('set.volume'))} <small id="n-vol-v">${Math.round((s.soundVolume ?? 0.6) * 100)}%</small></div>
        <input type="range" class="range" id="n-vol" min="0.1" max="1" step="0.1" value="${s.soundVolume ?? 0.6}"></div>
      ${toggle('n-prev', t('notify.preview'), s.preview !== false, t('notify.preview_hint'))}
      <div class="sec-title">${esc(t('set.group_notify'))}</div>
      <div class="seg" id="n-group">${['all', 'mentions', 'none'].map((k) => `<button class="${(s.groupNotify || 'all') === k ? 'on' : ''}" data-gn="${k}">${esc(t(`set.gn_${k}`))}</button>`).join('')}</div>
      <p class="muted small">${esc(t('set.group_notify_hint'))}</p>
      <div class="sec-title">${esc(t('set.quiet_title'))}</div>
      ${toggle('n-quiet', t('set.quiet'), s.quietHours?.enabled, t('set.quiet_hint'))}
      <div class="set-group" data-off="${s.quietHours?.enabled ? 0 : 1}" id="n-quiet-g"><div class="time-pair"><input class="input" type="time" id="n-qf" value="${esc(s.quietHours?.from || '22:00')}"> — <input class="input" type="time" id="n-qt" value="${esc(s.quietHours?.to || '08:00')}"></div></div>
      ${toggle('n-offh', t('set.off_hours'), s.offHoursMute, t('set.off_hours_hint', { from: S.meta.ws?.work_hours?.from || '09:00', to: S.meta.ws?.work_hours?.to || '18:00' }))}
      <div class="sec-title">${esc(t('set.n_types'))}</div>
      ${toggle('n-tasks', t('set.n_tasks'), s.notifyTasks !== false)}
      ${toggle('n-appr', t('set.n_approvals'), s.notifyApprovals !== false)}
      ${toggle('n-meet', t('set.n_meetings'), s.notifyMeetings !== false)}
      ${toggle('n-kudos', t('set.n_kudos'), s.notifyKudos !== false)}
      ${toggle('n-awards', t('set.n_awards'), s.awardToasts !== false)}
      <p class="muted small">${esc(t('notify.dnd_hint'))} ${esc(t('set.mentions_bypass'))}</p>
      <button class="btn soft sm" id="n-test">${esc(t('notify.test'))}</button>`;
    const vol = el.querySelector('#n-vol');
    vol.oninput = () => { el.querySelector('#n-vol-v').textContent = `${Math.round(vol.value * 100)}%`; };
    vol.onchange = () => { saveSettings({ soundVolume: Number(vol.value) }); emit('ping:test'); };
    el.querySelectorAll('[data-gn]').forEach((b) => { b.onclick = () => { saveSettings({ groupNotify: b.dataset.gn }); el.querySelectorAll('[data-gn]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    const saveQuiet = () => {
      const on = el.querySelector('#n-quiet').checked;
      el.querySelector('#n-quiet-g').dataset.off = on ? '0' : '1';
      saveSettings({ quietHours: { enabled: on, from: el.querySelector('#n-qf').value || '22:00', to: el.querySelector('#n-qt').value || '08:00' } });
    };
    el.querySelector('#n-quiet').onchange = saveQuiet;
    el.querySelector('#n-qf').onchange = saveQuiet;
    el.querySelector('#n-qt').onchange = saveQuiet;
    el.querySelector('#n-offh').onchange = (e) => saveSettings({ offHoursMute: e.target.checked });
    for (const [id, key] of [['n-tasks', 'notifyTasks'], ['n-appr', 'notifyApprovals'], ['n-meet', 'notifyMeetings'], ['n-kudos', 'notifyKudos'], ['n-awards', 'awardToasts']]) {
      el.querySelector(`#${id}`).onchange = (e) => saveSettings({ [key]: e.target.checked });
    }
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
    el.querySelector('#n-sound').onchange = (e) => { saveSettings({ sounds: e.target.checked }); el.querySelector('#n-vol-g').dataset.off = e.target.checked ? '0' : '1'; };
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
      ${toggle('c-spell', t('set.spellcheck'), s.spellcheck !== false)}
      ${toggle('c-bigemoji', t('set.big_emoji'), s.bigEmoji !== false, t('set.big_emoji_hint'))}
      <div class="sec-title">${esc(t('set.chat_sort'))}</div>
      <div class="seg">${['recent', 'unread'].map((k) => `<button class="${(s.chatSort || 'recent') === k ? 'on' : ''}" data-cs="${k}">${esc(t(`set.cs_${k}`))}</button>`).join('')}</div>
      <div class="sec-title">${esc(t('set.start_page'))}</div>
      <div class="seg wrap">${['chats', 'pulse', 'tasks', 'calendar'].map((k) => `<button class="${(s.startPage || 'chats') === k ? 'on' : ''}" data-sp="${k}">${esc(t(`nav.${k}`))}</button>`).join('')}</div>
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
    el.querySelector('#c-spell').onchange = (e) => saveSettings({ spellcheck: e.target.checked });
    el.querySelector('#c-bigemoji').onchange = (e) => saveSettings({ bigEmoji: e.target.checked });
    el.querySelectorAll('[data-cs]').forEach((b) => { b.onclick = () => { saveSettings({ chatSort: b.dataset.cs }); emit('chats:changed'); RENDER.chats(el); }; });
    el.querySelectorAll('[data-sp]').forEach((b) => { b.onclick = () => { saveSettings({ startPage: b.dataset.sp }); RENDER.chats(el); }; });
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
      <button class="btn soft sm" id="d-test">${icon('video', 16)} ${esc(t('devices.test'))}</button>
      <div class="sec-title">${esc(t('set.call_join'))}</div>
      ${toggle('d-mute', t('set.call_mute'), S.settings.callMuteOnJoin, t('set.call_mute_hint'))}
      ${toggle('d-camoff', t('set.call_cam_off'), S.settings.callCamOff)}
      ${toggle('d-mirror', t('set.mirror'), S.settings.mirror !== false, t('set.mirror_hint'))}
      <div class="sec-title">${esc(t('set.audio_proc'))}</div>
      ${toggle('d-noise', t('set.noise'), S.settings.noiseSuppression !== false)}
      ${toggle('d-echo', t('set.echo'), S.settings.echoCancel !== false)}
      ${toggle('d-agc', t('set.agc'), S.settings.autoGain !== false)}`;
    for (const [id, key] of [['d-mute', 'callMuteOnJoin'], ['d-camoff', 'callCamOff'], ['d-mirror', 'mirror'], ['d-noise', 'noiseSuppression'], ['d-echo', 'echoCancel'], ['d-agc', 'autoGain']]) {
      el.querySelector(`#${id}`).onchange = (e) => saveSettings({ [key]: e.target.checked });
    }
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

  access(el) {
    const s = S.settings;
    el.innerHTML = `<h2>${esc(t('settings.access'))}</h2><p class="muted small">${esc(t('set.access_hint'))}</p>
      <div class="sec-title">${esc(t('settings.font_size'))} <small id="a-fs-val">${Number(s.fontSize) || 15}px</small></div>
      <input type="range" min="13" max="22" step="1" value="${Number(s.fontSize) || 15}" id="a-fs" class="range">
      ${toggle('a-contrast', t('set.contrast'), s.contrast, t('set.contrast_hint'))}
      ${toggle('a-big', t('set.big_targets'), s.bigTargets, t('set.big_targets_hint'))}
      ${toggle('a-under', t('set.underline'), s.underlineLinks)}
      ${toggle('a-motion', t('set.reduce_motion'), s.animations === false, t('set.reduce_motion_hint'))}`;
    const fs = el.querySelector('#a-fs');
    fs.oninput = () => { el.querySelector('#a-fs-val').textContent = `${fs.value}px`; S.settings.fontSize = Number(fs.value); applyAppearance(); };
    fs.onchange = () => saveSettings({ fontSize: Number(fs.value) });
    el.querySelector('#a-contrast').onchange = (e) => saveSettings({ contrast: e.target.checked });
    el.querySelector('#a-big').onchange = (e) => saveSettings({ bigTargets: e.target.checked });
    el.querySelector('#a-under').onchange = (e) => saveSettings({ underlineLinks: e.target.checked });
    el.querySelector('#a-motion').onchange = (e) => saveSettings({ animations: !e.target.checked });
  },

  async data(el) {
    let usage = '';
    try { const est = await navigator.storage?.estimate?.(); if (est?.usage != null) usage = `${(est.usage / 1048576).toFixed(1)} MB`; } catch { /* ignore */ }
    el.innerHTML = `<h2>${esc(t('settings.data'))}</h2>
      <div class="li-row">${icon('database', 22)}<div class="li-main"><b>${esc(t('set.local_data'))}</b><span>${esc(usage || '—')}</span></div></div>
      <div class="sec-title">${esc(t('set.backup'))}</div><p class="muted small">${esc(t('set.backup_hint'))}</p>
      <div class="row wrap"><button class="btn soft sm" id="dt-export">${icon('download', 16)} ${esc(t('set.export'))}</button>
        <label class="btn soft sm">${icon('file', 16)} ${esc(t('set.import'))}<input type="file" accept="application/json,.json" id="dt-import" hidden></label></div>
      <div class="sec-title">${esc(t('set.maintenance'))}</div>
      <div class="row wrap"><button class="btn soft sm" id="dt-cache">${icon('trash', 16)} ${esc(t('set.clear_cache'))}</button>
        <button class="btn soft sm danger" id="dt-reset">${icon('x', 16)} ${esc(t('set.reset'))}</button></div>
      <p class="muted small">${esc(t('set.clear_cache_hint'))}</p>`;
    el.querySelector('#dt-export').onclick = () => {
      const blob = new Blob([JSON.stringify({ app: 'gobsek-chat', version: S.meta.version, exported_at: new Date().toISOString(), settings: S.settings }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gobsek-chat-settings-${S.me.login}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    el.querySelector('#dt-import').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (!j || typeof j.settings !== 'object') throw new Error('bad');
        await saveSettings(j.settings);
        setTimeFormat(S.settings.timeFormat);
        toast(t('set.imported'));
      } catch { toast(t('set.import_bad'), { type: 'error' }); }
    };
    el.querySelector('#dt-cache').onclick = async () => {
      try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('gc-cache')) localStorage.removeItem(k); } catch { /* ignore */ }
      toast(t('set.cache_cleared'));
      RENDER.data(el);
    };
    el.querySelector('#dt-reset').onclick = async () => {
      if (!(await confirmDialog(t('set.reset_q'), { danger: true }))) return;
      const keep = { folders: S.settings.folders, templates: S.settings.templates, autoReply: S.settings.autoReply, tz: S.settings.tz };
      const blank = Object.fromEntries(Object.keys(S.settings).map((k) => [k, null]));
      S.settings = {};
      await saveSettings({ ...blank, ...keep });
      for (const k of Object.keys(S.settings)) if (S.settings[k] === null) delete S.settings[k];
      applyTheme(); applyAppearance();
      toast(t('set.reset_done'));
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
