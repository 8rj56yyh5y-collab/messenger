// Разделы навигационной рельсы: Пульс компании, Задачи, Календарь, Звонки, Люди.
import { S, on, emit, chatTitle, userName } from './store.js';
import { t, errText, getLang } from './i18n.js';
import { $, esc, avatar, fmtTime, fmtDateTime, fmtDuration, md, fmtLastSeen } from './util.js';
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
      <div class="toolbar"><div class="search-box">${icon('search', 16)}<input id="people-q" placeholder="${esc(t('contacts.search'))}" value="${esc(S.peopleQuery || '')}"></div>
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
});
export { emit };
