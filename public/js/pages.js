// Разделы навигационной рельсы: Пульс компании, Задачи, Календарь, Звонки, Люди.
import { S, on, emit, chatTitle, userName } from './store.js';
import { t, errText, getLang } from './i18n.js';
import { $, esc, avatar, fmtTime, fmtDateTime, fmtDuration, md, fmtLastSeen, isMobile } from './util.js';
import { icon } from './icons.js';
import { get, post } from './api.js';
import { toast, modal } from './dialogs.js';
import { previewText } from './messages.js';
import { startCall } from './call.js';
import {
  taskDialog, setTaskStatus, meetingDialog, rsvp, kudosDialog, decideApproval, ackMessage, BADGES, PRIORITY_COLORS, TASK_STATUSES, fmtMoney, minutesDialog,
} from './work-ui.js';
import * as app from './app.js';

let current = null;
export const currentPage = () => current;

export function showPage(name) {
  current = name;
  const main = $('#main');
  main.innerHTML = `<section class="page page-${name}"><div class="page-inner"><div class="loading-msgs"><span class="spinner"></span></div></div></section>`;
  main.onclick = onClick;
  RENDER[name]?.();
}
export function hidePage() { current = null; $('#main').onclick = null; }

function inner() { return $('#main .page-inner'); }
function head(title, sub = '', actions = '') {
  return `<header class="page-head"><button class="icon-btn ghost only-mobile" data-pg="menu">${icon('menu')}</button>
    <div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><span class="grow"></span>${actions}</header>`;
}
const card = (title, body, { ic = '', cls = '', action = '' } = {}) => `<div class="pcard ${cls}"><div class="pcard-head">${ic ? `<span class="pc-ic">${icon(ic, 18)}</span>` : ''}<h3>${title}</h3><span class="grow"></span>${action}</div>${body}</div>`;
const empty = (text, ic = 'check2') => `<div class="pempty">${icon(ic, 22)}<span>${esc(text)}</span></div>`;

function greeting() {
  const h = new Date().getHours();
  const key = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
  return t(`pulse.hello_${key}`, { name: S.me.name.split(' ')[0] });
}

function dueText(ts) {
  if (!ts) return '';
  const overdue = ts < Date.now();
  return `<span class="due ${overdue ? 'overdue' : ''}">${icon('clock', 12)}${esc(fmtDateTime(ts))}</span>`;
}

function taskRow(tk) {
  return `<div class="trow" data-task="${tk.id}"><button class="tcheck ${tk.status === 'done' ? 'on' : ''}" data-pg="task-done" data-tid="${tk.id}" aria-label="done">${icon('check', 14)}</button>
    <div class="tr-main"><b>${esc(tk.title)}</b><span>${tk.chat ? esc(tk.chat.type === 'saved' ? t('chat.saved') : tk.chat.title || t('chat.type_direct')) : ''}</span></div>
    <i class="prio-dot" style="background:${PRIORITY_COLORS[tk.priority]}"></i>${dueText(tk.due_at)}</div>`;
}

function meetingRow(m) {
  const d = new Date(m.starts_at);
  const live = Date.now() > m.starts_at - 10 * 60e3 && Date.now() < m.starts_at + m.duration_min * 60e3;
  return `<div class="mrow ${live ? 'live' : ''}"><div class="mr-time"><b>${fmtTime(m.starts_at)}</b><small>${esc(d.toLocaleDateString(getLang(), { weekday: 'short', day: 'numeric' }))}</small></div>
    <div class="mr-main"><b>${esc(m.title)}</b><span>${esc(m.chat?.title || '')} · ${m.duration_min} ${esc(t('meet.min'))}</span></div>
    ${live ? `<button class="btn sm hl" data-pg="join" data-chat="${m.chat_id}">${icon('video', 14)} ${esc(t('call.join'))}</button>`
      : m.my_rsvp === 'pending' ? `<button class="btn sm soft" data-pg="rsvp" data-mid="${m.id}" data-r="yes">${esc(t('rsvp.yes'))}</button>` : `<span class="rsvp-tag r-${m.my_rsvp}">${esc(t(`rsvp.${m.my_rsvp}`))}</span>`}</div>`;
}

const RENDER = {
  // ---------- Пульс компании ----------
  async pulse() {
    let p;
    try { p = await get('/api/pulse'); } catch (e) { inner().innerHTML = `<p class="muted center">${esc(errText(e))}</p>`; return; }
    if (current !== 'pulse') return;
    app.setRailBadges({ pulse: p.approvals.length + p.acks.length, tasks: p.counts.tasks_open });
    const today = new Date().toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' });
    const attention = [
      ...p.approvals.map((m) => `<div class="att-item"><span class="att-ic ap">🧾</span><div class="att-main"><b>${esc(m.meta.title)}</b><span>${esc(t('pulse.approval_from', { name: userName(m.user_id) }))}${m.meta.amount != null ? ` · ${esc(fmtMoney(m.meta.amount, m.meta.currency))}` : ''}</span></div>
        <button class="btn sm ok" data-pg="approve" data-id="${m.id}">${icon('check', 14)}</button><button class="btn sm soft" data-pg="goto" data-chat="${m.chat_id}" data-mid="${m.id}">${icon('right', 14)}</button></div>`),
      ...p.acks.map((m) => `<div class="att-item"><span class="att-ic ack">📌</span><div class="att-main"><b>${esc(previewText(m).slice(0, 90))}</b><span>${esc(t('pulse.ack_from', { name: userName(m.user_id) }))}</span></div>
        <button class="btn sm" data-pg="ack" data-id="${m.id}">${esc(t('ack.confirm_short'))}</button><button class="btn sm soft" data-pg="goto" data-chat="${m.chat_id}" data-mid="${m.id}">${icon('right', 14)}</button></div>`),
    ];
    const overdue = p.counts.tasks_overdue;
    inner().innerHTML = `${head(esc(greeting()), esc(today), `<button class="btn soft" data-pg="digest">${icon('sparkles', 16)} ${esc(t('pulse.digest'))}</button>`)}
      <div class="stat-strip">
        <div class="stat"><b>${p.counts.tasks_open}</b><span>${esc(t('pulse.s_tasks'))}</span></div>
        <div class="stat ${overdue ? 'bad' : ''}"><b>${overdue}</b><span>${esc(t('pulse.s_overdue'))}</span></div>
        <div class="stat"><b>${p.meetings.filter((m) => new Date(m.starts_at).toDateString() === new Date().toDateString()).length}</b><span>${esc(t('pulse.s_meet'))}</span></div>
        <div class="stat"><b>${p.online.length + 1}</b><span>${esc(t('pulse.s_online'))}</span></div>
        <div class="stat"><b>${p.kudos.mine.count}</b><span>${esc(t('pulse.s_kudos'))}</span></div>
      </div>
      <div class="pulse-grid">
        ${card(esc(t('pulse.attention')), attention.length ? `<div class="att-list">${attention.join('')}</div>` : empty(t('pulse.attention_empty')), { ic: 'unread', cls: 'span-2 attention' })}
        ${card(esc(t('pulse.my_tasks')), p.tasks.length ? `<div class="tlist">${p.tasks.map(taskRow).join('')}</div>` : empty(t('pulse.tasks_empty')), { ic: 'check', action: `<button class="link-btn" data-pg="nav" data-to="tasks">${esc(t('pulse.all'))}</button>` })}
        ${card(esc(t('pulse.meetings')), p.meetings.length ? `<div class="mlist">${p.meetings.map(meetingRow).join('')}</div>` : empty(t('pulse.meet_empty'), 'calendar'), { ic: 'calendar', action: `<button class="link-btn" data-pg="new-meeting">+ ${esc(t('meet.short'))}</button>` })}
        ${card(esc(t('pulse.birthdays')), p.birthdays.length ? `<div class="bday-list">${p.birthdays.map((b) => `<div class="bday ${b.in_days === 0 ? 'today' : ''}">${avatar(b.user, 44)}<div><b>${esc(b.user.name)}</b><span>${esc(b.in_days === 0 ? t('pulse.bday_today') : t('pulse.bday_in', { n: b.in_days }))}</span></div>
          <button class="btn sm ${b.in_days === 0 ? '' : 'soft'}" data-pg="congrats" data-uid="${b.user.id}">🎂 ${esc(t('pulse.congrats'))}</button></div>`).join('')}</div>` : empty(t('pulse.bday_empty'), 'smile'), { ic: 'cake' })}
        ${card(esc(t('pulse.kudos')), `${p.kudos.top.length ? `<div class="leader">${p.kudos.top.slice(0, 5).map((k, i) => `<div class="lrow"><span class="lpos p${i + 1}">${i + 1}</span>${avatar(k.user, 34)}<div class="lr-main"><b>${esc(k.user.name)}</b><span>${Object.entries(k.badges).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([bd, n]) => `${BADGES[bd] || ''}${n > 1 ? `×${n}` : ''}`).join(' ')}</span></div><b class="lcount">${k.count}</b></div>`).join('')}</div>` : empty(t('pulse.kudos_empty'), 'star')}`,
          { ic: 'trophy', action: `<button class="link-btn" data-pg="kudos">+ ${esc(t('kudos.thank'))}</button>` })}
        ${card(esc(t('pulse.newcomers')), p.newcomers.length ? `<div class="people-row">${p.newcomers.map((u) => `<button class="person-tile" data-pg="user" data-uid="${u.id}">${avatar(u, 52)}<b>${esc(u.name.split(' ')[0])}</b><span>${esc(u.position || u.department || '')}</span></button>`).join('')}</div>` : empty(t('pulse.newcomers_empty'), 'users'), { ic: 'users' })}
        ${card(esc(t('pulse.online')), p.online.length ? `<div class="online-row">${p.online.map((u) => `<button class="story" data-pg="dm" data-uid="${u.id}" title="${esc(u.name)}">${avatar(u, 50, { online: true })}<span>${esc(u.name.split(' ')[0])}</span></button>`).join('')}</div>` : empty(t('pulse.online_empty'), 'eye'), { ic: 'eye', cls: 'span-2' })}
      </div>`;
  },

  // ---------- Доска задач ----------
  async tasks() {
    const scope = S.taskScope || 'mine';
    const list = await get(`/api/tasks?scope=${scope}`).catch(() => []);
    if (current !== 'tasks') return;
    const q = (S.taskQuery || '').toLowerCase();
    const shown = list.filter((tk) => tk.status !== 'cancelled' && (!q || tk.title.toLowerCase().includes(q)));
    if (isMobile()) { S.taskCache = list; tasksMobile(shown, scope); return; }
    const cols = TASK_STATUSES.map((st) => {
      const items = shown.filter((tk) => tk.status === st).sort((a, b) => (a.due_at || Infinity) - (b.due_at || Infinity));
      return `<div class="kcol" data-col="${st}"><div class="kcol-head"><span class="kdot st-${st}"></span><b>${esc(t(`tstatus.${st}`))}</b><span class="kcount">${items.length}</span>
        ${st === 'todo' ? `<button class="icon-btn ghost xs" data-pg="new-task">${icon('plus', 16)}</button>` : ''}</div>
        <div class="kcol-body">${items.map((tk) => `<div class="kcard ${tk.due_at && tk.due_at < Date.now() && st !== 'done' ? 'overdue' : ''}" draggable="true" data-task="${tk.id}" style="--prio:${PRIORITY_COLORS[tk.priority]}">
          <div class="kc-title">${esc(tk.title)}</div>${tk.description ? `<div class="kc-desc">${esc(tk.description).slice(0, 140)}</div>` : ''}
          <div class="kc-foot">${avatar(S.users.get(tk.assignee_id) || (tk.assignee_id === S.me.id ? S.me : { id: tk.assignee_id, name: userName(tk.assignee_id) }), 24)}
            ${tk.chat?.title && tk.chat.type !== 'saved' ? `<span class="kc-chat">${tk.chat.type === 'direct' ? '@' : '#'}${esc(tk.chat.title)}</span>` : ''}<span class="grow"></span>${dueText(tk.due_at)}</div></div>`).join('') || `<div class="kempty">${esc(t('tasks.drop_here'))}</div>`}</div></div>`;
    }).join('');
    inner().innerHTML = `${head(esc(t('nav.tasks')), esc(t('tasks.sub')), `<button class="btn" data-pg="new-task">${icon('plus', 16)} ${esc(t('task.new'))}</button>`)}
      <div class="toolbar"><div class="seg">${['mine', 'created', 'all'].map((s) => `<button class="${scope === s ? 'on' : ''}" data-pg="scope" data-scope="${s}">${esc(t(`tasks.scope_${s}`))}</button>`).join('')}</div>
        <div class="search-box sm">${icon('search', 16)}<input id="task-q" placeholder="${esc(t('common.search'))}" value="${esc(S.taskQuery || '')}"></div></div>
      <div class="kanban">${cols}</div>`;
    const qi = inner().querySelector('#task-q');
    qi.oninput = () => { S.taskQuery = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { RENDER.tasks().then(() => { const n = $('#task-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
    // Перетаскивание карточек между колонками
    const kb = inner().querySelector('.kanban');
    kb.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard'); if (c) { e.dataTransfer.setData('text/task', c.dataset.task); c.classList.add('dragging'); } });
    kb.addEventListener('dragend', (e) => e.target.closest('.kcard')?.classList.remove('dragging'));
    kb.addEventListener('dragover', (e) => { const col = e.target.closest('.kcol'); if (col) { e.preventDefault(); kb.querySelectorAll('.kcol').forEach((x) => x.classList.toggle('drop', x === col)); } });
    kb.addEventListener('dragleave', (e) => { if (!kb.contains(e.relatedTarget)) kb.querySelectorAll('.kcol').forEach((x) => x.classList.remove('drop')); });
    kb.addEventListener('drop', async (e) => {
      const col = e.target.closest('.kcol');
      kb.querySelectorAll('.kcol').forEach((x) => x.classList.remove('drop'));
      const id = Number(e.dataTransfer.getData('text/task'));
      if (!col || !id) return;
      e.preventDefault();
      await setTaskStatus(id, col.dataset.col);
      RENDER.tasks();
    });
    S.taskCache = list;
  },

  // ---------- Календарь ----------
  async calendar() {
    const base = S.calWeek || startOfWeek(new Date());
    const from = base.getTime();
    const to = from + 7 * 86400e3;
    const list = await get(`/api/meetings?from=${from}&to=${to}`).catch(() => []);
    if (current !== 'calendar') return;
    S.calCache = list;
    if (isMobile()) { calendarMobile(list, base); return; }
    const H0 = 8;
    const H1 = 21;
    const days = [...Array(7)].map((_, i) => new Date(from + i * 86400e3));
    const todayStr = new Date().toDateString();
    const label = `${days[0].toLocaleDateString(getLang(), { day: 'numeric', month: 'long' })} — ${days[6].toLocaleDateString(getLang(), { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const hours = [...Array(H1 - H0)].map((_, i) => `<div class="cal-h"><span>${String(H0 + i).padStart(2, '0')}:00</span></div>`).join('');
    const cols = days.map((d) => {
      const evs = list.filter((m) => new Date(m.starts_at).toDateString() === d.toDateString());
      return `<div class="cal-day ${d.toDateString() === todayStr ? 'today' : ''}"><div class="cal-dh"><small>${esc(d.toLocaleDateString(getLang(), { weekday: 'short' }))}</small><b>${d.getDate()}</b></div>
        <div class="cal-slots">${evs.map((m) => {
          const st = new Date(m.starts_at);
          const top = ((st.getHours() + st.getMinutes() / 60) - H0) / (H1 - H0) * 100;
          const h = Math.max(4.5, (m.duration_min / 60) / (H1 - H0) * 100);
          return `<button class="cal-ev ${m.cancelled ? 'cancelled' : ''} r-${m.my_rsvp}" style="top:${Math.max(0, top)}%;height:${h}%" data-pg="meeting" data-mid="${m.id}">
            <b>${esc(m.title)}</b><span>${fmtTime(m.starts_at)} · ${esc(m.chat?.title || '')}</span></button>`;
        }).join('')}${d.toDateString() === todayStr ? `<div class="cal-now" style="top:${((new Date().getHours() + new Date().getMinutes() / 60) - H0) / (H1 - H0) * 100}%"></div>` : ''}</div></div>`;
    }).join('');
    inner().innerHTML = `${head(esc(t('nav.calendar')), esc(label), `<button class="btn" data-pg="new-meeting">${icon('plus', 16)} ${esc(t('meet.new'))}</button>`)}
      <div class="toolbar"><button class="icon-btn" data-pg="week" data-d="-1">${icon('back', 18)}</button><button class="btn soft sm" data-pg="week" data-d="0">${esc(t('date.today'))}</button>
        <button class="icon-btn" data-pg="week" data-d="1">${icon('right', 18)}</button><span class="grow"></span><span class="muted small">${esc(t('cal.count', { n: list.length }))}</span></div>
      <div class="calendar"><div class="cal-hours"><div class="cal-dh"></div><div class="cal-slots">${hours}</div></div>${cols}</div>`;
    S.calCache = list;
  },

  // ---------- Звонки ----------
  async calls() {
    const list = await get('/api/calls/history').catch(() => []);
    if (current !== 'calls') return;
    const filter = S.callFilter || 'all';
    const shown = filter === 'missed' ? list.filter((c) => ['missed', 'declined'].includes(c.status) && !c.outgoing) : list;
    inner().innerHTML = `${head(esc(t('nav.calls')), esc(t('calls.sub')), `<button class="btn" data-pg="new-call">${icon('phone', 16)} ${esc(t('calls.new'))}</button>`)}
      <div class="toolbar"><div class="seg"><button class="${filter === 'all' ? 'on' : ''}" data-pg="cfilter" data-f="all">${esc(t('contacts.all'))}</button><button class="${filter === 'missed' ? 'on' : ''}" data-pg="cfilter" data-f="missed">${esc(t('calls.missed'))}</button></div></div>
      <div class="pcard"><div class="list">${shown.map((c) => {
        const chat = c.chat;
        const peer = chat.peer;
        const bad = ['missed', 'declined', 'cancelled'].includes(c.status) && !c.outgoing;
        const lbl = c.status === 'missed' ? (c.outgoing ? t('call.cancelled') : t('call.missed')) : c.status === 'declined' ? t('call.declined_short') : `${c.outgoing ? t('call.outgoing') : t('call.incoming')}${c.duration ? ` · ${fmtDuration(c.duration)}` : ''}`;
        return `<div class="li-row" data-pg="open-chat" data-chat="${chat.id}">${avatar(peer || chat, 46)}<div class="li-main"><b class="${bad ? 'red' : ''}">${esc(peer?.name || chat.title)}</b>
          <span>${icon(c.outgoing ? 'phoneOut' : 'phoneIn', 13)} ${esc(lbl)} · ${esc(fmtDateTime(c.started_at))}${!peer ? ` · ${esc(t('call.participants', { n: c.participants }))}` : ''}</span></div>
          <button class="icon-btn" data-pg="recall" data-chat="${chat.id}" data-media="audio">${icon('phone', 18)}</button><button class="icon-btn" data-pg="recall" data-chat="${chat.id}" data-media="video">${icon('video', 18)}</button></div>`;
      }).join('') || empty(t('calls.empty'), 'phone')}</div></div>`;
  },

  // ---------- Люди ----------
  async people() {
    if (S.peopleView === 'org') { await orgView(); return; }
    const q = (S.peopleQuery || '').toLowerCase();
    const users = [...S.users.values()].filter((u) => !u.is_bot && u.active !== false && (!q || `${u.name} ${u.login} ${u.position} ${u.department}`.toLowerCase().includes(q)));
    const groups = new Map();
    for (const u of users) {
      const d = u.department || t('contacts.no_dept');
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(u);
    }
    const sorted = [...groups].sort((a, b) => a[0].localeCompare(b[0]));
    const online = users.filter((u) => S.online.has(u.id)).length;
    inner().innerHTML = `${head(esc(t('nav.people')), esc(t('people.sub', { n: users.length, online })), S.me.role === 'admin' ? `<button class="btn soft" data-pg="invite">${icon('plus', 16)} ${esc(t('admin.invite_people'))}</button>` : '')}
      <div class="toolbar">${peopleSeg()}<div class="search-box">${icon('search', 16)}<input id="people-q" placeholder="${esc(t('contacts.search'))}" value="${esc(S.peopleQuery || '')}"></div>
        <div class="dept-chips">${sorted.map(([d, us]) => `<button class="chip-btn" data-pg="dept" data-d="${esc(d)}">${esc(d)} <small>${us.length}</small></button>`).join('')}</div></div>
      ${sorted.map(([d, us]) => `<section class="dept" data-dept="${esc(d)}"><h2>${esc(d)} <small>${us.length}</small></h2><div class="people-grid">${us.sort((a, b) => (S.online.has(b.id) - S.online.has(a.id)) || a.name.localeCompare(b.name)).map((u) => `
        <div class="pcard person" data-pg="user" data-uid="${u.id}">${avatar(u, 64, { online: S.online.has(u.id) })}
          <b>${esc(u.name)}</b><span class="pos">${esc(u.position || '')}</span>
          <span class="pstat">${u.status && u.status !== 'available' ? `<i class="st-dot st-${u.status}"></i>${esc(t(`status.${u.status}`))}` : S.online.has(u.id) ? `<i class="st-dot st-available"></i>${esc(t('presence.online'))}` : esc(u.last_seen ? fmtLastSeen(u.last_seen) : '')}</span>
          ${u.birthday ? `<span class="pbday">🎂 ${esc(u.birthday.split('-').reverse().join('.'))}</span>` : ''}
          ${u.id === S.me.id ? '' : `<div class="pacts"><button class="icon-btn" data-pg="dm" data-uid="${u.id}" title="${esc(t('panel.message'))}">${icon('send', 16)}</button>
          <button class="icon-btn" data-pg="call-user" data-uid="${u.id}" title="${esc(t('call.audio'))}">${icon('phone', 16)}</button></div>`}</div>`).join('')}</div></section>`).join('')}`;
    const qi = inner().querySelector('#people-q');
    qi.oninput = () => { S.peopleQuery = qi.value; RENDER.people(); const n = $('#people-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  },
};

// ---------- Свой профиль ----------
RENDER.me = async function me() {
  let p;
  try { p = await get('/api/me/profile'); } catch (e) { inner().innerHTML = `<p class="muted center">${esc(errText(e))}</p>`; return; }
  if (current !== 'me') return;
  const u = S.me;
  const person = (id) => S.users.get(id) || (id === S.me.id ? S.me : { id, name: userName(id) });
  const mgr = p.manager ? person(p.manager) : null;
  const statuses = ['available', 'busy', 'dnd', 'away', 'remote', 'vacation'];
  const allBadges = Object.keys(BADGES);
  const tiles = [
    ['saved', 'bookmark', t('chat.saved')], ['ai', 'sparkles', 'Gobsek AI'], ['people', 'users', t('nav.people')], ['calls', 'phone', t('nav.calls')],
    ['settings', 'settings', t('side.settings')], ['help', 'help', t('side.help')], ...(u.role === 'admin' ? [['admin', 'shield', t('side.admin')]] : []), ['logout', 'logout', t('side.logout')],
  ];
  inner().innerHTML = `<div class="me-hero">
      <div class="me-cover"></div>
      <div class="me-main">
        <button class="me-av" data-pg="me-photo" title="${esc(t('profile.change_photo'))}">${avatar(u, 108)}<span>${icon('image', 16)}</span></button>
        <div class="me-id"><h1>${esc(u.name)}</h1><p>${esc([u.position, u.department].filter(Boolean).join(' · ') || `@${u.login}`)}</p>
          ${u.status_text ? `<div class="me-status-text">💬 ${esc(u.status_text)}</div>` : ''}</div>
        <button class="btn soft" data-pg="me-edit">${icon('edit', 16)} ${esc(t('me.edit'))}</button>
      </div>
      <div class="me-statuses">${statuses.map((st) => `<button class="st-chip ${u.status === st ? 'on' : ''}" data-pg="me-status" data-st="${st}"><i class="st-dot st-${st}"></i>${esc(t(`status.${st}`))}</button>`).join('')}</div>
    </div>
    <div class="stat-strip me-stats">
      <button class="stat" data-pg="nav" data-to="tasks"><b>${p.tasks.open}</b><span>${esc(t('pulse.s_tasks'))}</span></button>
      <button class="stat ${p.tasks.overdue ? 'bad' : ''}" data-pg="nav" data-to="tasks"><b>${p.tasks.overdue}</b><span>${esc(t('pulse.s_overdue'))}</span></button>
      <div class="stat"><b>${p.tasks.done_month}</b><span>${esc(t('me.done_month'))}</span></div>
      <button class="stat" data-pg="nav" data-to="calendar"><b>${p.meetings_week}</b><span>${esc(t('me.meetings_week'))}</span></button>
      <div class="stat"><b>${p.kudos.total}</b><span>${esc(t('me.kudos_got'))}</span></div>
    </div>
    <div class="pulse-grid me-grid">
      ${card(esc(t('me.org')), `<div class="org-mini">
        ${p.department ? `<div class="om-row">${icon('briefcase', 18)}<div><b>${esc(p.department.name)}</b><span>${p.department.cfo ? `<span class="cfo-chip">${esc(p.department.cfo)}</span>` : esc(t('profile.department'))}</span></div>
          ${p.department.chat_id ? `<button class="btn sm soft" data-pg="open-chat" data-chat="${p.department.chat_id}">${icon('chat', 14)}</button>` : ''}</div>` : ''}
        ${mgr ? `<div class="om-row" data-pg="user" data-uid="${mgr.id}">${avatar(mgr, 36)}<div><b>${esc(mgr.name)}</b><span>${esc(t('me.manager'))}${mgr.position ? ` · ${esc(mgr.position)}` : ''}</span></div>
          <button class="btn sm soft" data-pg="dm" data-uid="${mgr.id}">${icon('send', 14)}</button></div>` : ''}
        ${p.reports.length ? `<div class="om-team"><span class="muted small">${esc(t('me.team', { n: p.reports.length }))}</span><div class="avs">${p.reports.slice(0, 12).map((id) => `<button data-pg="user" data-uid="${id}" title="${esc(person(id).name)}">${avatar(person(id), 34, { online: S.online.has(id) })}</button>`).join('')}</div></div>` : ''}
        ${!p.department && !mgr && !p.reports.length ? empty(t('me.no_org'), 'info') : ''}
        <span class="muted small">${esc(t('me.since', { date: new Date(p.member_since).toLocaleDateString(getLang(), { day: 'numeric', month: 'long', year: 'numeric' }) }))}</span></div>`, { ic: 'users' })}
      ${card(esc(t('me.badges')), `<div class="badge-wall">${allBadges.map((b) => `<div class="bw ${p.kudos.badges[b] ? 'got' : ''}" title="${esc(t(`badge.${b}`))}"><span>${BADGES[b]}</span><small>${esc(t(`badge.${b}`))}</small>${p.kudos.badges[b] ? `<i>${p.kudos.badges[b]}</i>` : ''}</div>`).join('')}</div>
        ${p.kudos.last.length ? `<div class="kd-last">${p.kudos.last.map((k) => `<div class="kd-l">${BADGES[k.badge] || '🎉'}<div><b>${esc(userName(k.from))}</b><span>${esc(k.text || t(`badge.${k.badge}`))}</span></div></div>`).join('')}</div>` : ''}`, { ic: 'trophy' })}
      ${card(esc(t('me.quick')), `<div class="me-tiles">${tiles.map(([k, ic, label]) => `<button class="me-tile ${k === 'logout' ? 'danger' : ''}" data-pg="me-go" data-go="${k}">${icon(ic, 22)}<span>${esc(label)}</span></button>`).join('')}</div>`, { ic: 'grid', cls: 'span-2' })}
    </div>`;
};

async function setMyStatus(st) {
  try {
    const { user } = await (await import('./api.js')).patch('/api/me', { status: st });
    Object.assign(S.me, user);
    emit('presence');
    RENDER.me();
  } catch (e) { toast(errText(e), { type: 'error' }); }
}

// ---------- Задачи на телефоне: вкладки по статусам ----------
function tasksMobile(shown, scope) {
  const st = S.taskTab || 'todo';
  const items = shown.filter((tk) => tk.status === st).sort((a, b) => (a.due_at || Infinity) - (b.due_at || Infinity));
  const next = { todo: 'doing', doing: 'review', review: 'done' }[st];
  inner().innerHTML = `${head(esc(t('nav.tasks')), '', `<button class="icon-btn hl-btn" data-pg="new-task">${icon('plus', 20)}</button>`)}
    <div class="seg full">${['mine', 'created', 'all'].map((s) => `<button class="${scope === s ? 'on' : ''}" data-pg="scope" data-scope="${s}">${esc(t(`tasks.scope_${s}`))}</button>`).join('')}</div>
    <div class="ttabs">${TASK_STATUSES.map((s) => `<button class="ttab ${st === s ? 'on' : ''}" data-pg="ttab" data-st="${s}"><i class="kdot st-${s}"></i>${esc(t(`tstatus.${s}`))}<b>${shown.filter((x) => x.status === s).length}</b></button>`).join('')}</div>
    <div class="mtasks">${items.map((tk) => `<div class="mtask ${tk.due_at && tk.due_at < Date.now() && st !== 'done' ? 'overdue' : ''}" data-task="${tk.id}" style="--prio:${PRIORITY_COLORS[tk.priority]}">
      <div class="mt-main"><b>${esc(tk.title)}</b><div class="mt-sub">${avatar(S.users.get(tk.assignee_id) || (tk.assignee_id === S.me.id ? S.me : { id: tk.assignee_id, name: userName(tk.assignee_id) }), 20)}
        ${tk.chat?.title && tk.chat.type !== 'saved' ? `<span>${esc(tk.chat.title)}</span>` : ''}${dueText(tk.due_at)}</div></div>
      ${next ? `<button class="mt-next" data-pg="task-next" data-tid="${tk.id}" data-st="${next}" title="${esc(t(`task.to_${next}`))}">${icon(next === 'done' ? 'check' : 'right', 18)}</button>` : ''}</div>`).join('') || empty(t('tasks.empty_tab'), 'check2')}</div>`;
}

// ---------- Календарь на телефоне: полоса недели + встречи дня ----------
function calendarMobile(list, base) {
  const days = [...Array(7)].map((_, i) => new Date(base.getTime() + i * 86400e3));
  const todayStr = new Date().toDateString();
  let sel = S.calDay && days.some((d) => d.toDateString() === S.calDay) ? S.calDay : (days.find((d) => d.toDateString() === todayStr) || days[0]).toDateString();
  S.calDay = sel;
  const evs = list.filter((m) => new Date(m.starts_at).toDateString() === sel).sort((a, b) => a.starts_at - b.starts_at);
  const selDate = new Date(sel);
  inner().innerHTML = `${head(esc(t('nav.calendar')), esc(selDate.toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' })), `<button class="icon-btn hl-btn" data-pg="new-meeting">${icon('plus', 20)}</button>`)}
    <div class="week-strip"><button class="icon-btn ghost" data-pg="week" data-d="-1">${icon('back', 18)}</button>
      <div class="ws-days">${days.map((d) => {
        const has = list.filter((m) => new Date(m.starts_at).toDateString() === d.toDateString()).length;
        return `<button class="ws-day ${d.toDateString() === sel ? 'on' : ''} ${d.toDateString() === todayStr ? 'today' : ''}" data-pg="calday" data-day="${esc(d.toDateString())}">
          <small>${esc(d.toLocaleDateString(getLang(), { weekday: 'short' }))}</small><b>${d.getDate()}</b><i class="${has ? 'has' : ''}"></i></button>`;
      }).join('')}</div>
      <button class="icon-btn ghost" data-pg="week" data-d="1">${icon('right', 18)}</button></div>
    <div class="agenda">${evs.map((m) => {
      const end = m.starts_at + m.duration_min * 60e3;
      const live = Date.now() > m.starts_at - 10 * 60e3 && Date.now() < end;
      return `<button class="ag-item ${m.cancelled ? 'cancelled' : ''} ${live ? 'live' : ''} r-${m.my_rsvp}" data-pg="meeting" data-mid="${m.id}">
        <div class="ag-time"><b>${fmtTime(m.starts_at)}</b><small>${fmtTime(end)}</small></div><div class="ag-bar"></div>
        <div class="ag-main"><b>${esc(m.title)}</b><span>${esc(m.chat?.title || '')} · ${m.duration_min} ${esc(t('meet.min'))}</span>
          <div class="ag-people">${m.attendees.filter((a) => a.rsvp === 'yes').slice(0, 5).map((a) => avatar(S.users.get(a.user_id) || { id: a.user_id, name: userName(a.user_id) }, 22)).join('')}</div></div>
        ${live ? `<span class="live-tag">LIVE</span>` : m.my_rsvp === 'pending' ? `<span class="rsvp-tag">?</span>` : ''}</button>`;
    }).join('') || empty(t('cal.day_empty'), 'calendar')}</div>`;
}

// ---------- Оргструктура ----------
function peopleSeg() {
  const v = S.peopleView || 'list';
  return `<div class="seg"><button class="${v === 'list' ? 'on' : ''}" data-pg="pview" data-v="list">${icon('users', 15)} ${esc(t('people.list'))}</button><button class="${v === 'org' ? 'on' : ''}" data-pg="pview" data-v="org">${icon('grid', 15)} ${esc(t('people.org'))}</button></div>`;
}
async function orgView() {
  const o = await get('/api/org').catch(() => ({ departments: [], managers: {} }));
  if (current !== 'people') return;
  const deps = o.departments;
  const byParent = new Map();
  for (const d of deps) {
    const k = d.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(d);
  }
  const person = (id) => S.users.get(id) || { id, name: userName(id) };
  const node = (d, depth) => {
    const head2 = d.head_id ? person(d.head_id) : null;
    const others = d.members.filter((id) => id !== d.head_id);
    const kids = d.id ? byParent.get(d.id) || [] : [];
    return `<div class="org-node" style="--depth:${depth}">
      <div class="org-card">
        <div class="oc-top"><b>${esc(d.name)}</b>${d.cfo ? `<span class="cfo-chip">${esc(d.cfo)}</span>` : ''}<span class="grow"></span>
          ${d.chat_id ? `<button class="icon-btn ghost xs" data-pg="${d.in_chat ? 'open-chat' : 'join-dept'}" data-chat="${d.chat_id}" title="${esc(t('people.dept_chat'))}">${icon('chat', 15)}</button>` : ''}</div>
        ${head2 ? `<div class="oc-head" data-pg="user" data-uid="${head2.id}">${avatar(head2, 40, { online: S.online.has(head2.id) })}<div><b>${esc(head2.name)}</b><span>${esc(head2.position || t('people.head'))}</span></div><span class="head-tag">${esc(t('people.head'))}</span></div>` : ''}
        <div class="oc-members">${others.slice(0, 14).map((id) => `<button data-pg="user" data-uid="${id}" title="${esc(person(id).name)}">${avatar(person(id), 30, { online: S.online.has(id) })}</button>`).join('')}
          ${others.length > 14 ? `<span class="more-n">+${others.length - 14}</span>` : ''}<span class="muted small">${esc(t('people.n_people', { n: d.members.length }))}</span></div>
      </div>
      ${kids.length ? `<div class="org-kids">${kids.map((k) => node(k, depth + 1)).join('')}</div>` : ''}
    </div>`;
  };
  const roots = byParent.get(0) || [];
  inner().innerHTML = `${head(esc(t('nav.people')), esc(t('people.org_sub', { n: deps.length })), S.me.role === 'admin' ? `<button class="btn soft" data-pg="admin-depts">${icon('settings', 16)} ${esc(t('people.manage'))}</button>` : '')}
    <div class="toolbar">${peopleSeg()}</div>
    <div class="org-tree">${roots.map((d) => node(d, 0)).join('') || empty(t('people.org_empty'), 'users')}</div>`;
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function meetingDetails(id) {
  const m = (S.calCache || []).find((x) => x.id === id);
  if (!m) return;
  const end = m.starts_at + m.duration_min * 60e3;
  const live = Date.now() > m.starts_at - 10 * 60e3 && Date.now() < end;
  const md2 = modal({
    title: m.title, cls: 'small',
    content: `<p class="muted">${icon('clock', 14)} ${esc(fmtDateTime(m.starts_at))} – ${fmtTime(end)} · ${esc(m.chat?.title || '')}</p>
      ${m.description ? `<div class="text">${md(m.description)}</div>` : ''}
      <div class="sec-title">${esc(t('meet.attendees'))}</div><div class="list">${m.attendees.map((a) => `<div class="li-row">${avatar(S.users.get(a.user_id) || { name: userName(a.user_id) }, 32)}<div class="li-main"><b>${esc(userName(a.user_id))}</b></div><span class="rsvp-tag r-${a.rsvp}">${esc(t(`rsvp.${a.rsvp}`))}</span></div>`).join('')}</div>
      <div class="modal-actions">${!m.cancelled ? ['yes', 'maybe', 'no'].map((r) => `<button class="btn sm ${m.my_rsvp === r ? '' : 'soft'}" data-r="${r}">${esc(t(`rsvp.${r}`))}</button>`).join('') : ''}
        <span class="grow"></span>${Date.now() > m.starts_at - 10 * 60e3 && !m.cancelled ? `<button class="btn soft sm" data-a="minutes">📝 ${esc(t('min.button'))}</button>` : ''}<button class="btn soft sm" data-a="chat">${icon('send', 14)}</button>${live ? `<button class="btn sm hl" data-a="join">${icon('video', 14)} ${esc(t('call.join'))}</button>` : ''}</div>`,
  });
  md2.body.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]');
    if (r) { await rsvp(m.id, r.dataset.r); md2.close(); RENDER.calendar(); return; }
    const a = e.target.closest('[data-a]');
    if (a?.dataset.a === 'chat') { md2.close(); app.openChatById(m.chat_id, { jumpTo: m.message_id }); }
    if (a?.dataset.a === 'minutes') { md2.close(); minutesDialog(m); }
    if (a?.dataset.a === 'join') { md2.close(); app.openChatById(m.chat_id); startCall(m.chat_id, 'video'); }
  });
}

async function digest() {
  const m = modal({ title: t('pulse.digest'), wide: false, content: `<div class="loading-msgs"><span class="spinner"></span><span>${esc(t('pulse.digest_wait'))}</span></div>` });
  try {
    const r = await post('/api/ai/digest');
    m.body.innerHTML = r.text ? `<p class="muted small">${icon('sparkles', 14)} ${esc(t('pulse.digest_meta', { n: r.count, chats: r.chats }))}</p><div class="text ai-summary">${md(r.text)}</div>`
      : `<div class="pempty big">${icon('check2', 30)}<span>${esc(t('pulse.digest_nothing'))}</span></div>`;
  } catch (e) { m.body.innerHTML = `<p class="form-error">${esc(errText(e))}</p>`; }
}

async function onClick(e) {
  const a = e.target.closest('[data-pg]');
  if (!a) {
    const tk = e.target.closest('[data-task]');
    if (tk) {
      const task = (S.taskCache || []).find((x) => x.id === Number(tk.dataset.task));
      if (task) {
        const md2 = modal({
          title: task.title, cls: 'small',
          content: `<div class="task-detail"><span class="status-chip st-${task.status}">${esc(t(`tstatus.${task.status}`))}</span> <span class="prio-tag" style="--c:${PRIORITY_COLORS[task.priority]}">${esc(t(`prio.${task.priority}`))}</span>
            ${task.description ? `<div class="text">${md(task.description)}</div>` : ''}
            <div class="info-rows"><div class="info-row">${icon('user', 18)}<div><b>${esc(userName(task.assignee_id))}</b><small>${esc(t('task.assignee'))}</small></div></div>
            <div class="info-row">${icon('edit', 18)}<div><b>${esc(userName(task.creator_id))}</b><small>${esc(t('task.creator'))}</small></div></div>
            ${task.due_at ? `<div class="info-row">${icon('clock', 18)}<div><b>${esc(fmtDateTime(task.due_at))}</b><small>${esc(t('task.due'))}</small></div></div>` : ''}</div></div>
            <div class="modal-actions"><button class="btn soft sm" data-a="edit">${icon('edit', 14)} ${esc(t('common.edit'))}</button>${task.chat ? `<button class="btn soft sm" data-a="chat">${icon('send', 14)} ${esc(t('tasks.in_chat'))}</button>` : ''}
              <span class="grow"></span>${task.status !== 'done' ? `<button class="btn sm ok" data-a="done">${icon('check', 14)} ${esc(t('task.to_done'))}</button>` : ''}</div>`,
        });
        md2.body.addEventListener('click', async (ev) => {
          const b = ev.target.closest('[data-a]');
          if (!b) return;
          md2.close();
          if (b.dataset.a === 'edit') taskDialog({ task });
          if (b.dataset.a === 'chat') app.openChatById(task.chat.id, { jumpTo: task.message_id });
          if (b.dataset.a === 'done') { await setTaskStatus(task.id, 'done'); RENDER[current]?.(); }
        });
      }
    }
    return;
  }
  const act = a.dataset.pg;
  switch (act) {
    case 'menu': app.openDrawer(); break;
    case 'nav': app.navigate(`/${a.dataset.to}`); break;
    case 'digest': digest(); break;
    case 'approve': await decideApproval(Number(a.dataset.id), 'approve'); RENDER.pulse(); break;
    case 'ack': await ackMessage(Number(a.dataset.id)); RENDER.pulse(); break;
    case 'goto': app.openChatById(Number(a.dataset.chat), { jumpTo: Number(a.dataset.mid) }); break;
    case 'task-done': e.stopPropagation(); await setTaskStatus(Number(a.dataset.tid), 'done'); RENDER[current]?.(); break;
    case 'new-task': taskDialog({}); break;
    case 'new-meeting': meetingDialog(); break;
    case 'rsvp': await rsvp(Number(a.dataset.mid), a.dataset.r); RENDER[current]?.(); break;
    case 'join': app.openChatById(Number(a.dataset.chat)); startCall(Number(a.dataset.chat), 'video'); break;
    case 'congrats': {
      const c = await app.openDirect(Number(a.dataset.uid));
      if (c) setTimeout(() => { const ta = $('#composer-input'); if (ta) { ta.value = t('pulse.congrats_text'); ta.dispatchEvent(new Event('input')); ta.focus(); } }, 400);
      break;
    }
    case 'kudos': {
      const general = [...S.chats.values()].find((c) => c.type === 'group' && c.is_public) || [...S.chats.values()].find((c) => c.type === 'group');
      if (general) kudosDialog(general.id); else toast(t('kudos.need_group'));
      break;
    }
    case 'user': app.openPanel({ type: 'user', id: Number(a.dataset.uid) }); break;
    case 'dm': e.stopPropagation(); app.openDirect(Number(a.dataset.uid)); break;
    case 'call-user': { e.stopPropagation(); const c = await app.openDirect(Number(a.dataset.uid)); if (c) startCall(c.id, 'audio'); break; }
    case 'scope': S.taskScope = a.dataset.scope; RENDER.tasks(); break;
    case 'week': {
      const d = Number(a.dataset.d);
      S.calWeek = d === 0 ? startOfWeek(new Date()) : new Date((S.calWeek || startOfWeek(new Date())).getTime() + d * 7 * 86400e3);
      S.calDay = null;
      RENDER.calendar();
      break;
    }
    case 'meeting': meetingDetails(Number(a.dataset.mid)); break;
    case 'cfilter': S.callFilter = a.dataset.f; RENDER.calls(); break;
    case 'open-chat': if (!e.target.closest('[data-pg=recall]')) app.openChatById(Number(a.dataset.chat)); break;
    case 'recall': e.stopPropagation(); app.openChatById(Number(a.dataset.chat)); startCall(Number(a.dataset.chat), a.dataset.media); break;
    case 'new-call': app.openContacts(); break;
    case 'dept': $(`#main [data-dept="${CSS.escape(a.dataset.d)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
    case 'invite': app.openAdminInvites(); break;
    case 'pview': S.peopleView = a.dataset.v; RENDER.people(); break;
    case 'admin-depts': app.openAdminTab('depts'); break;
    case 'join-dept': { try { await post('/api/chats/join', { chat_id: Number(a.dataset.chat) }); } catch { /* закрытый чат */ } app.openChatById(Number(a.dataset.chat)); break; }
    case 'ttab': S.taskTab = a.dataset.st; RENDER.tasks(); break;
    case 'task-next': e.stopPropagation(); await setTaskStatus(Number(a.dataset.tid), a.dataset.st); RENDER.tasks(); break;
    case 'calday': S.calDay = a.dataset.day; RENDER.calendar(); break;
    case 'me-status': setMyStatus(a.dataset.st); break;
    case 'me-edit': case 'me-photo': app.openSettingsSection('profile'); break;
    case 'me-go': app.profileGo(a.dataset.go); break;
    default:
  }
}

// Живые обновления разделов
on('tasks:changed', () => { if (current === 'tasks' || current === 'pulse') RENDER[current](); });
on('meetings:changed', () => { if (current === 'calendar' || current === 'pulse') RENDER[current](); });
on('presence', () => { if (current === 'people') RENDER.people(); });
on('ws', (msg) => {
  if (msg.type === 'task:update' && (current === 'tasks' || current === 'pulse')) RENDER[current]();
  if (msg.type === 'approval:done' && current === 'pulse') RENDER.pulse();
  if (msg.type === 'user:update' && current === 'me' && msg.user.id === S.me.id) RENDER.me();
});
// Поворот телефона / изменение ширины — перерисовать раздел под новый макет
let lastMobile = isMobile();
window.addEventListener('resize', () => { const m = isMobile(); if (m !== lastMobile && current) { lastMobile = m; RENDER[current]?.(); } });
export { emit };
