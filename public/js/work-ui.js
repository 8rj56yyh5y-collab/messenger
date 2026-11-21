// Окна и действия рабочих инструментов: задачи, погодження, встречи, подяки, «ознакомлен».
import { S, userName, chatTitle, peerOf, emit } from './store.js';
import { t, errText } from './i18n.js';
import { esc, avatar, plain, fmtDateTime } from './util.js';
import { locale } from './i18n.js';
import { icon } from './icons.js';
import { get, post, patch } from './api.js';
import { modal, toast, promptDialog } from './dialogs.js';

export const BADGES = {
  teamwork: '🤝', idea: '💡', help: '🛟', speed: '⚡', quality: '💎', leader: '🏆', client: '🎯', mentor: '🧭',
};
export const PRIORITY_COLORS = { low: '#8b95a1', normal: '#3390ec', high: '#f29900', urgent: '#e53935' };
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done'];

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function at(daysFromNow, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
function nextFriday() {
  const d = new Date();
  const add = (5 - d.getDay() + 7) % 7 || 7;
  return at(add, 17);
}

async function membersOf(chatId) {
  if (!chatId) return [...S.users.values()].filter((u) => !u.is_bot && u.active !== false);
  const c = S.chats.get(chatId);
  if (c?.type === 'direct') return [S.me, peerOf(c)].filter(Boolean);
  if (c?.type === 'saved') return [S.me];
  const d = await get(`/api/chats/${chatId}`);
  return d.members.filter((m) => !m.is_bot);
}

function peoplePicker(list, selected, { multi = true, name = 'p' } = {}) {
  return `<div class="people-pick">${list.map((u) => `<label class="pp-item"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${u.id}" ${selected.includes(u.id) ? 'checked' : ''}>
    ${avatar(u, 30)}<span>${esc(u.id === S.me.id ? `${u.name} (${t('msg.you_obj')})` : u.name)}</span></label>`).join('')}</div>`;
}
const picked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => Number(x.value));

// ---------- Задача ----------
export async function taskDialog({ chatId = null, source = null, task = null } = {}) {
  const editing = !!task;
  const cid = task ? task.chat_id : chatId;
  const people = await membersOf(cid).catch(() => []);
  const assignee = task?.assignee_id || (source && source.user_id !== S.me.id ? source.user_id : S.me.id);
  const due = task?.due_at || null;
  const m = modal({
    title: editing ? t('task.edit') : t('task.new'),
    content: `<label class="field"><span>${esc(t('task.title'))}</span><input class="input" id="tk-title" maxlength="200" autofocus value="${esc(task?.title || (source ? plain(source.body).slice(0, 120) : ''))}" placeholder="${esc(t('task.title_ph'))}"></label>
      <label class="field"><span>${esc(t('task.description'))}</span><textarea class="input" id="tk-desc" rows="3" maxlength="2000">${esc(task?.description || '')}</textarea></label>
      <div class="field"><span>${esc(t('task.assignee'))}</span>${peoplePicker(people, [assignee], { multi: false, name: 'tk-as' })}</div>
      <div class="field"><span>${esc(t('task.due'))}</span><div class="chips">
        <button class="chip-btn" data-due="${at(0, 18)}">${esc(t('task.today'))}</button><button class="chip-btn" data-due="${at(1, 12)}">${esc(t('task.tomorrow'))}</button>
        <button class="chip-btn" data-due="${nextFriday()}">${esc(t('task.friday'))}</button><button class="chip-btn" data-due="${at(7, 12)}">${esc(t('task.week'))}</button>
        <button class="chip-btn" data-due="">${esc(t('task.no_due'))}</button></div>
        <input class="input" type="datetime-local" id="tk-due" value="${due ? toLocalInput(due) : ''}"></div>
      <div class="field"><span>${esc(t('task.priority'))}</span><div class="seg prio">${['low', 'normal', 'high', 'urgent'].map((p) => `<button data-prio="${p}" class="${(task?.priority || 'normal') === p ? 'on' : ''}"><i style="background:${PRIORITY_COLORS[p]}"></i>${esc(t(`prio.${p}`))}</button>`).join('')}</div></div>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(editing ? t('common.save') : t('task.create'))}</button></div>`,
  });
  const b = m.body;
  let prio = task?.priority || 'normal';
  b.querySelectorAll('[data-due]').forEach((x) => { x.onclick = () => { b.querySelector('#tk-due').value = x.dataset.due ? toLocalInput(Number(x.dataset.due)) : ''; }; });
  b.querySelectorAll('[data-prio]').forEach((x) => { x.onclick = () => { prio = x.dataset.prio; b.querySelectorAll('[data-prio]').forEach((y) => y.classList.toggle('on', y === x)); }; });
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=yes]').onclick = async () => {
    const dueVal = b.querySelector('#tk-due').value;
    const body = {
      title: b.querySelector('#tk-title').value, description: b.querySelector('#tk-desc').value,
      assignee_id: picked(b, 'tk-as')[0] || S.me.id, due_at: dueVal ? new Date(dueVal).getTime() : null, priority: prio,
    };
    try {
      const out = editing ? await patch(`/api/tasks/${task.id}`, body) : await post('/api/tasks', { ...body, chat_id: chatId, source_msg_id: source?.id });
      m.close();
      toast(editing ? t('common.saved') : t('task.created'));
      emit('tasks:changed', out);
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}

export async function setTaskStatus(id, status) {
  try {
    const out = await patch(`/api/tasks/${id}`, { status });
    emit('tasks:changed', out);
    if (status === 'done') confetti();
    return out;
  } catch (e) { toast(errText(e), { type: 'error' }); return null; }
}

// ---------- Погодження ----------
export async function approvalDialog(chatId) {
  const people = (await membersOf(chatId)).filter((u) => u.id !== S.me.id);
  const m = modal({
    title: t('appr.new'),
    content: `<label class="field"><span>${esc(t('appr.subject'))}</span><input class="input" id="ap-title" maxlength="200" autofocus placeholder="${esc(t('appr.subject_ph'))}"></label>
      <div class="grid-amount"><label class="field"><span>${esc(t('appr.amount'))}</span><input class="input" id="ap-amount" type="number" min="0" step="0.01" placeholder="0.00"></label>
      <label class="field"><span>${esc(t('appr.currency'))}</span><select class="input" id="ap-cur"><option>UAH</option><option>USD</option><option>EUR</option><option>PLN</option></select></label></div>
      <label class="field"><span>${esc(t('appr.details'))}</span><textarea class="input" id="ap-desc" rows="3" maxlength="2000" placeholder="${esc(t('appr.details_ph'))}"></textarea></label>
      <div class="field"><span>${esc(t('appr.approvers'))}</span>${people.length ? peoplePicker(people, [], { name: 'ap-who' }) : `<p class="muted small">${esc(t('appr.no_people'))}</p>`}</div>
      <div class="seg" id="ap-mode"><button class="on" data-mode="all">${esc(t('appr.mode_all'))}</button><button data-mode="any">${esc(t('appr.mode_any'))}</button></div>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('appr.send'))}</button></div>`,
  });
  const b = m.body;
  let mode = 'all';
  b.querySelectorAll('[data-mode]').forEach((x) => { x.onclick = () => { mode = x.dataset.mode; b.querySelectorAll('[data-mode]').forEach((y) => y.classList.toggle('on', y === x)); }; });
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=yes]').onclick = async () => {
    try {
      await post(`/api/chats/${chatId}/approvals`, {
        title: b.querySelector('#ap-title').value, amount: b.querySelector('#ap-amount').value, currency: b.querySelector('#ap-cur').value,
        description: b.querySelector('#ap-desc').value, approvers: picked(b, 'ap-who'), mode,
      });
      m.close();
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}

export async function decideApproval(msgId, decision) {
  let comment = '';
  if (decision === 'reject') {
    comment = await promptDialog(t('appr.reject_reason'), { ok: t('appr.reject'), multiline: true });
    if (comment === null) return;
  }
  try { await post(`/api/messages/${msgId}/decide`, { decision, comment }); } catch (e) { toast(errText(e), { type: 'error' }); }
}

export function fmtMoney(amount, currency) {
  if (amount == null) return '';
  try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || 'UAH', maximumFractionDigits: 2 }).format(amount); } catch { return `${amount} ${currency}`; }
}

// ---------- Встреча ----------
export async function meetingDialog(chatId = null) {
  const chatsList = [...S.chats.values()].filter((c) => ['group', 'direct', 'channel'].includes(c.type) && !(c.type === 'channel' && !['owner', 'admin'].includes(c.my_role)))
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const start = new Date(Date.now() + 3600e3);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const m = modal({
    title: t('meet.new'),
    content: `<label class="field"><span>${esc(t('meet.topic'))}</span><input class="input" id="mt-title" maxlength="200" autofocus placeholder="${esc(t('meet.topic_ph'))}"></label>
      ${chatId ? '' : `<label class="field"><span>${esc(t('meet.chat'))}</span><select class="input" id="mt-chat">${chatsList.map((c) => `<option value="${c.id}">${esc(chatTitle(c, t))}</option>`).join('')}</select></label>`}
      <label class="field"><span>${esc(t('meet.when'))}</span><input class="input" type="datetime-local" id="mt-at" value="${toLocalInput(start.getTime())}"></label>
      <div class="field"><span>${esc(t('meet.duration'))}</span><div class="seg" id="mt-dur">${[15, 30, 45, 60, 90].map((d) => `<button data-d="${d}" class="${d === 30 ? 'on' : ''}">${d} ${esc(t('meet.min'))}</button>`).join('')}</div></div>
      <label class="field"><span>${esc(t('meet.agenda'))}</span><textarea class="input" id="mt-desc" rows="3" maxlength="2000" placeholder="${esc(t('meet.agenda_ph'))}"></textarea></label>
      <p class="muted small">${icon('info', 14)} ${esc(t('meet.hint'))}</p>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('meet.create'))}</button></div>`,
  });
  const b = m.body;
  let dur = 30;
  b.querySelectorAll('[data-d]').forEach((x) => { x.onclick = () => { dur = Number(x.dataset.d); b.querySelectorAll('[data-d]').forEach((y) => y.classList.toggle('on', y === x)); }; });
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=yes]').onclick = async () => {
    const cid = chatId || Number(b.querySelector('#mt-chat').value);
    try {
      const out = await post(`/api/chats/${cid}/meetings`, {
        title: b.querySelector('#mt-title').value, starts_at: new Date(b.querySelector('#mt-at').value).getTime(), duration_min: dur, description: b.querySelector('#mt-desc').value,
      });
      m.close();
      toast(t('meet.created', { when: fmtDateTime(out.starts_at) }));
      emit('meetings:changed');
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}

export async function rsvp(id, answer) {
  try { await post(`/api/meetings/${id}/rsvp`, { rsvp: answer }); emit('meetings:changed'); } catch (e) { toast(errText(e), { type: 'error' }); }
}

// ---------- Подяка ----------
export async function kudosDialog(chatId, preselect = []) {
  const people = (await membersOf(chatId)).filter((u) => u.id !== S.me.id);
  const m = modal({
    title: t('kudos.new'),
    content: `<div class="field"><span>${esc(t('kudos.to'))}</span>${peoplePicker(people, preselect, { name: 'kd-to' })}</div>
      <div class="field"><span>${esc(t('kudos.badge'))}</span><div class="badge-pick">${Object.entries(BADGES).map(([k, e], i) => `<button class="badge-opt ${i === 0 ? 'on' : ''}" data-badge="${k}"><span>${e}</span><small>${esc(t(`badge.${k}`))}</small></button>`).join('')}</div></div>
      <label class="field"><span>${esc(t('kudos.text'))}</span><textarea class="input" id="kd-text" rows="3" maxlength="1000" placeholder="${esc(t('kudos.text_ph'))}"></textarea></label>
      <div class="modal-actions"><button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('kudos.send'))} 🎉</button></div>`,
  });
  const b = m.body;
  let badge = 'teamwork';
  b.querySelectorAll('[data-badge]').forEach((x) => { x.onclick = () => { badge = x.dataset.badge; b.querySelectorAll('[data-badge]').forEach((y) => y.classList.toggle('on', y === x)); }; });
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=yes]').onclick = async () => {
    try {
      await post(`/api/chats/${chatId}/kudos`, { to: picked(b, 'kd-to'), badge, text: b.querySelector('#kd-text').value });
      m.close();
      confetti();
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}

// ---------- Ознакомление ----------
export async function ackMessage(id) {
  try { await post(`/api/messages/${id}/ack`); toast(t('ack.done')); emit('acks:changed'); } catch (e) { toast(errText(e), { type: 'error' }); }
}
export async function ackListDialog(id) {
  const list = await get(`/api/messages/${id}/acks`);
  const yes = list.filter((u) => u.acked_at);
  const no = list.filter((u) => !u.acked_at);
  modal({
    title: t('ack.title'), cls: 'small',
    content: `<div class="ack-progress"><div style="width:${list.length ? Math.round((yes.length / list.length) * 100) : 0}%"></div></div>
      <p class="muted small">${esc(t('ack.progress', { n: yes.length, total: list.length }))}</p>
      ${no.length ? `<div class="sec-title">${esc(t('ack.not_yet'))} · ${no.length}</div><div class="list">${no.map((u) => `<div class="li-row">${avatar(u, 34)}<div class="li-main"><b>${esc(u.name)}</b><span>${esc(u.position || '')}</span></div></div>`).join('')}</div>` : ''}
      ${yes.length ? `<div class="sec-title">${esc(t('ack.acked'))} · ${yes.length}</div><div class="list">${yes.map((u) => `<div class="li-row">${avatar(u, 34)}<div class="li-main"><b>${esc(u.name)}</b><span>${esc(fmtDateTime(u.acked_at))}</span></div>${icon('check2', 18)}</div>`).join('')}</div>` : ''}`,
  });
}

// ---------- Конфетти ----------
export function confetti() {
  if (S.settings.animations === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.className = 'confetti';
  const colors = ['#3390ec', '#8774e1', '#4fae4e', '#f29900', '#e05a8c', '#2ee6c5'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.3}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    host.appendChild(p);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3400);
}

export { userName };
