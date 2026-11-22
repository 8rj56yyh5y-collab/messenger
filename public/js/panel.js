// Правая панель: профиль сотрудника или информация о чате (участники, медиа, файлы, ссылки, настройки).
import { S, on, chatTitle, isMuted, userName } from './store.js';
import { t, errText } from './i18n.js';
import { $, esc, avatar, fmtLastSeen, fmtDateTime, fmtSize, md, copyText, fmtDuration } from './util.js';
import { icon } from './icons.js';
import { get, post, patch, del, upload } from './api.js';
import { modal, toast, confirmDialog, contextMenu, promptDialog } from './dialogs.js';
import { startCall } from './call.js';
import { previewText } from './messages.js';
import * as app from './app.js';
import { renderThread, closeThread } from './thread.js';
import { BADGES } from './work-ui.js';

let P = null; // { type, id, chatId, tab }

export function openPanel(target) {
  P = { tab: 'media', ...target };
  document.body.classList.add('panel-open');
  render();
}
export function closePanel() {
  P = null;
  closeThread();
  document.body.classList.remove('panel-open');
  $('#panel').innerHTML = '';
}
export const panelState = () => P;

on('chat:updated', (id) => { if (P && P.type === 'chat' && P.id === id) render(); });
on('presence', () => { if (P && P.type === 'user') render(); });
on('user:updated', (id) => { if (P && P.type === 'user' && P.id === id) render(); });

async function render() {
  const el = $('#panel');
  if (!P) return;
  if (P.type === 'thread') { renderThread(el, P.id, closePanel); return; }
  const target = { ...P };
  el.innerHTML = `<div class="panel-head"><button class="icon-btn ghost" data-pa="close">${icon('x')}</button><h3>${esc(P.type === 'user' ? t('panel.user') : t('panel.chat'))}</h3>
    <span class="grow"></span>${P.type === 'chat' ? '<span class="panel-edit-slot"></span>' : ''}</div><div class="panel-body"><div class="loading-msgs"><span class="spinner"></span></div></div>`;
  el.onclick = onClick;
  try {
    if (P.type === 'user') {
      const u = await get(`/api/users/${P.id}`);
      if (!P || P.id !== target.id) return;
      el.querySelector('.panel-body').innerHTML = userHtml(u);
    } else {
      const c = await app.loadChatDetails(P.id);
      if (!P || P.id !== target.id) return;
      el.querySelector('.panel-body').innerHTML = chatHtml(c);
      const slot = el.querySelector('.panel-edit-slot');
      if (['owner', 'admin'].includes(c.my_role) && ['group', 'channel'].includes(c.type)) slot.innerHTML = `<button class="icon-btn ghost" data-pa="edit" title="${esc(t('common.edit'))}">${icon('edit')}</button>`;
      loadTab();
    }
  } catch (e) {
    el.querySelector('.panel-body').innerHTML = `<p class="muted center">${esc(errText(e))}</p>`;
  }
}

function statusLine(u) {
  if (u.is_bot) return t('user.bot');
  if (S.online.has(u.id)) return `<span class="online-txt">${esc(t('presence.online'))}</span>`;
  return esc(u.last_seen ? t('presence.last_seen', { when: fmtLastSeen(u.last_seen) }) : t('presence.recently'));
}

function userHtml(u) {
  const me = u.id === S.me.id;
  const status = u.status && u.status !== 'available' ? `<div class="status-chip st-${u.status}">${esc(t(`status.${u.status}`))}${u.status_text ? ` · ${esc(u.status_text)}` : ''}</div>`
    : u.status_text ? `<div class="status-chip">${esc(u.status_text)}</div>` : '';
  const rows = [
    u.position && ['briefcase', u.position, t('profile.position')],
    u.department && ['users', u.department, t('profile.department')],
    ['at', `@${u.login}`, t('profile.login')],
    u.email && ['link', u.email, 'E-mail', `mailto:${u.email}`],
    u.phone && ['phone', u.phone, t('profile.phone'), `tel:${u.phone}`],
  ].filter(Boolean);
  return `<div class="profile-hero">${avatar(u, 120, { kind: u.login === 'ai.assistant' ? 'ai' : null })}<h2>${esc(u.name)}</h2><div class="muted">${statusLine(u)}</div>${status}
      ${u.gobsek ? `<div class="gobsek-badge">${icon('shield', 14)} Gobsek</div>` : ''}</div>
    ${me ? '' : `<div class="panel-actions">
      <button class="pa-btn" data-pa="message" data-uid="${u.id}">${icon('send')}<span>${esc(t('panel.message'))}</span></button>
      ${u.is_bot ? '' : `<button class="pa-btn" data-pa="call" data-uid="${u.id}" data-media="audio">${icon('phone')}<span>${esc(t('call.audio'))}</span></button>
      <button class="pa-btn" data-pa="call" data-uid="${u.id}" data-media="video">${icon('video')}<span>${esc(t('call.video'))}</span></button>`}
      ${P.chatId ? `<button class="pa-btn" data-pa="mute-chat">${icon(isMuted(S.chats.get(P.chatId)) ? 'bell' : 'bellOff')}<span>${esc(isMuted(S.chats.get(P.chatId)) ? t('chat.unmute') : t('chat.mute'))}</span></button>` : ''}
    </div>`}
    ${u.bio ? `<div class="panel-sec"><div class="bio">${md(u.bio)}</div></div>` : ''}
    ${orgHtml(u)}
    <div class="panel-sec info-rows">${rows.map(([ic, val, label, href]) => `<div class="info-row" ${href ? '' : `data-pa="copy" data-text="${esc(val)}"`}>${icon(ic, 20)}<div>
      ${href ? `<a href="${esc(href)}">${esc(val)}</a>` : `<b>${esc(val)}</b>`}<small>${esc(label)}</small></div></div>`).join('')}</div>
    ${u.common?.length ? `<div class="panel-sec"><div class="sec-title">${esc(t('panel.common', { n: u.common.length }))}</div>${u.common.map((c) => `<div class="li-row" data-pa="open-chat" data-cid="${c.id}">${avatar(c, 40)}<div class="li-main"><b>${esc(c.title)}</b><span>${esc(t(`chat.type_${c.type}`))}</span></div></div>`).join('')}</div>` : ''}
    ${P.chatId ? mediaTabsHtml() : ''}`;
}

function orgHtml(u) {
  const o = u.org;
  if (!o) return '';
  const person = (id) => S.users.get(id) || { id, name: '…' };
  const mgr = o.manager ? person(o.manager) : null;
  const got = Object.entries(o.kudos?.badges || {}).sort((a, b) => b[1] - a[1]);
  if (!o.department && !mgr && !o.reports.length && !got.length) return '';
  return `<div class="panel-sec org-sec">
    ${o.department ? `<div class="om-row">${icon('briefcase', 18)}<div><b>${esc(o.department.name)}</b><span>${o.department.cfo ? `<span class="cfo-chip">${esc(o.department.cfo)}</span>` : esc(t('profile.department'))}</span></div></div>` : ''}
    ${mgr ? `<div class="om-row" data-pa="member-user" data-uid="${mgr.id}">${avatar(mgr, 34)}<div><b>${esc(mgr.name)}</b><span>${esc(t('me.manager'))}</span></div></div>` : ''}
    ${o.reports.length ? `<div class="om-team"><span class="muted small">${esc(t('me.team', { n: o.reports.length }))}</span><div class="avs">${o.reports.slice(0, 10).map((id) => `<button data-pa="member-user" data-uid="${id}" title="${esc(person(id).name)}">${avatar(person(id), 30)}</button>`).join('')}</div></div>` : ''}
    ${got.length ? `<div class="mini-badges">${got.map(([b, n]) => `<span title="${esc(t(`badge.${b}`))}">${BADGES[b] || '🎉'}${n > 1 ? `<i>${n}</i>` : ''}</span>`).join('')}</div>` : ''}
  </div>`;
}

function chatHtml(c) {
  const admin = ['owner', 'admin'].includes(c.my_role);
  const link = c.invite_code ? `${location.origin}/#/join/${c.invite_code}` : '';
  const members = c.members || [];
  return `<div class="profile-hero">${avatar(c, 120, { kind: c.type === 'saved' ? 'saved' : c.type === 'ai' ? 'ai' : null })}<h2>${esc(chatTitle(c, t))}</h2>
      <div class="muted">${esc(c.type === 'channel' ? t('chat.subscribers', { n: c.members_count }) : c.type === 'group' ? t('chat.members', { n: c.members_count }) : '')}</div></div>
    <div class="panel-actions">
      <button class="pa-btn" data-pa="mute-chat">${icon(isMuted(c) ? 'bell' : 'bellOff')}<span>${esc(isMuted(c) ? t('chat.unmute') : t('chat.mute'))}</span></button>
      ${c.type === 'group' || admin ? `<button class="pa-btn" data-pa="call-chat" data-media="audio">${icon('phone')}<span>${esc(t('call.conf_short'))}</span></button>` : ''}
      ${S.meta.ai ? `<button class="pa-btn" data-pa="summary">${icon('sparkles')}<span>${esc(t('ai.summary_short'))}</span></button>` : ''}
      ${['group', 'channel'].includes(c.type) ? `<button class="pa-btn danger" data-pa="leave">${icon('logout')}<span>${esc(t('chat.leave'))}</span></button>` : ''}
    </div>
    ${c.description ? `<div class="panel-sec"><div class="bio">${md(c.description)}</div></div>` : ''}
    ${link ? `<div class="panel-sec info-rows"><div class="info-row" data-pa="copy" data-text="${esc(link)}">${icon('link', 20)}<div><b class="mono">${esc(link.replace(/^https?:\/\//, ''))}</b><small>${esc(t('panel.invite_link'))}</small></div></div></div>` : ''}
    ${['group', 'channel'].includes(c.type) ? `<div class="panel-sec"><div class="sec-title">${esc(t('panel.members_n', { n: members.length }))}${(c.type === 'group' || admin) ? `<button class="link-btn" data-pa="add-members">+ ${esc(t('panel.add'))}</button>` : ''}</div>
      ${members.slice(0, 200).map((m) => `<div class="li-row" data-pa="member" data-uid="${m.id}">${avatar(m, 40, { online: S.online.has(m.id) })}<div class="li-main"><b>${esc(m.name)}${m.id === S.me.id ? ` <small>(${esc(t('msg.you_obj'))})</small>` : ''}</b>
        <span>${S.online.has(m.id) ? `<span class="online-txt">${esc(t('presence.online'))}</span>` : esc(m.position || (m.last_seen ? fmtLastSeen(m.last_seen) : ''))}</span></div>
        ${m.chat_role !== 'member' ? `<span class="role-tag">${esc(t(`role.${m.chat_role}`))}</span>` : ''}</div>`).join('')}</div>` : ''}
    ${admin && ['group', 'channel'].includes(c.type) ? `<div class="panel-sec"><div class="sec-title">${esc(t('panel.integrations'))}<button class="link-btn" data-pa="webhook-new">+ ${esc(t('panel.webhook_new'))}</button></div>
      ${(c.webhooks || []).length ? c.webhooks.map((w) => `<div class="li-row">${icon('hook', 22)}<div class="li-main"><b>${esc(w.name)}</b><span>${esc(w.last_used ? t('panel.webhook_used', { when: fmtDateTime(w.last_used) }) : t('panel.webhook_never'))}</span></div>
        <button class="icon-btn ghost" data-pa="webhook-del" data-wid="${w.id}">${icon('trash', 18)}</button></div>`).join('') : `<p class="muted small">${esc(t('panel.webhook_hint'))}</p>`}</div>` : ''}
    ${mediaTabsHtml(c.counts)}`;
}

function mediaTabsHtml(counts = {}) {
  const tabs = ['media', 'files', 'links', 'voice'];
  return `<div class="panel-sec media-sec"><div class="tabs">${tabs.map((tb) => `<button class="tab ${P.tab === tb ? 'on' : ''}" data-pa="tab" data-tab="${tb}">${esc(t(`panel.tab_${tb}`))}${counts[tb] ? ` <small>${counts[tb]}</small>` : ''}</button>`).join('')}</div>
    <div class="tab-body"></div></div>`;
}

async function loadTab() {
  const chatId = P.type === 'chat' ? P.id : P.chatId;
  const body = $('#panel .tab-body');
  if (!chatId || !body) return;
  body.innerHTML = '<div class="loading-msgs"><span class="spinner sm"></span></div>';
  const list = await get(`/api/chats/${chatId}/media?kind=${P.tab}`).catch(() => []);
  if (!$('#panel .tab-body')) return;
  if (!list.length) { body.innerHTML = `<p class="muted center small">${esc(t('panel.empty_tab'))}</p>`; return; }
  if (P.tab === 'media') {
    body.innerHTML = `<div class="media-grid">${list.map((m) => m.kind === 'image'
      ? `<button class="mg-item" data-pa="view" data-mid="${m.id}" data-cid="${chatId}"><img src="${esc(m.file.url)}" loading="lazy" alt=""></button>`
      : `<button class="mg-item video" data-pa="jump" data-mid="${m.id}" data-cid="${chatId}"><video src="${esc(m.file.url)}#t=0.5" preload="metadata" muted></video>${icon('play', 22)}</button>`).join('')}</div>`;
  } else if (P.tab === 'files') {
    body.innerHTML = list.map((m) => `<a class="doc" href="${esc(m.file.url)}?download=1" download="${esc(m.file.name)}"><span class="doc-ic"><b>${esc((m.file.name.split('.').pop() || '').slice(0, 4).toUpperCase())}</b></span>
      <span class="doc-info"><span class="doc-name">${esc(m.file.name)}</span><span class="doc-size">${fmtSize(m.file.size)} · ${esc(fmtDateTime(m.created_at))}</span></span></a>`).join('');
  } else if (P.tab === 'links') {
    body.innerHTML = list.map((m) => {
      const urls = m.body.match(/https?:\/\/[^\s<>"']+/g) || [];
      return urls.map((u) => `<div class="link-item" data-pa="jump" data-mid="${m.id}" data-cid="${chatId}"><span class="link-ic">${esc((new URL(u).hostname[0] || '?').toUpperCase())}</span><div><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a><small>${esc(userName(m.user_id))} · ${esc(fmtDateTime(m.created_at))}</small></div></div>`).join('');
    }).join('');
  } else {
    body.innerHTML = list.map((m) => `<div class="li-row" data-pa="jump" data-mid="${m.id}" data-cid="${chatId}">${icon('mic', 20)}<div class="li-main"><b>${esc(userName(m.user_id))}</b><span>${esc(fmtDateTime(m.created_at))} · ${fmtDuration(m.file?.meta?.duration || 0)}</span></div></div>`).join('');
  }
}

async function onClick(e) {
  const a = e.target.closest('[data-pa]');
  if (!a) return;
  const chat = P?.type === 'chat' ? S.chats.get(P.id) : P?.chatId ? S.chats.get(P.chatId) : null;
  switch (a.dataset.pa) {
    case 'close': closePanel(); break;
    case 'message': app.openDirect(Number(a.dataset.uid)); break;
    case 'call': {
      const c = await app.openDirect(Number(a.dataset.uid));
      if (c) startCall(c.id, a.dataset.media);
      break;
    }
    case 'call-chat': startCall(P.id, a.dataset.media); break;
    case 'mute-chat': if (chat) app.muteDialog(chat); break;
    case 'summary': app.summarizeChat(P.id); break;
    case 'leave': if (chat) app.leaveChat(chat); break;
    case 'copy': copyText(a.dataset.text).then(() => toast(t('msg.copied'))); break;
    case 'open-chat': app.openChatById(Number(a.dataset.cid)); break;
    case 'member-user': openPanel({ type: 'user', id: Number(a.dataset.uid) }); break;
    case 'tab': P.tab = a.dataset.tab; document.querySelectorAll('#panel .tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === P.tab)); loadTab(); break;
    case 'view': app.viewMedia(Number(a.dataset.cid), Number(a.dataset.mid)); break;
    case 'jump': if (!e.target.closest('a')) app.openChatById(Number(a.dataset.cid), { jumpTo: Number(a.dataset.mid) }); break;
    case 'member': memberMenu(Number(a.dataset.uid), a); break;
    case 'add-members': app.pickPeople(t('panel.add_members'), async (ids) => {
      try { await post(`/api/chats/${P.id}/members`, { user_ids: ids }); S.chatDetails.delete(P.id); render(); } catch (err) { toast(errText(err), { type: 'error' }); }
    }, { exclude: (S.chatDetails.get(P.id)?.members || []).map((m) => m.id) }); break;
    case 'edit': editChatDialog(P.id); break;
    case 'webhook-new': webhookDialog(P.id); break;
    case 'webhook-del': {
      if (!(await confirmDialog(t('panel.webhook_del_q'), { danger: true, ok: t('common.delete') }))) break;
      await del(`/api/chats/${P.id}/webhooks/${a.dataset.wid}`);
      S.chatDetails.delete(P.id);
      render();
      break;
    }
    default:
  }
}

function memberMenu(uid, anchor) {
  const c = S.chatDetails.get(P.id);
  if (!c) return;
  const m = c.members.find((x) => x.id === uid);
  const iAmOwner = c.my_role === 'owner';
  const iAmAdmin = ['owner', 'admin'].includes(c.my_role);
  const canKick = uid !== S.me.id && iAmAdmin && m.chat_role !== 'owner' && (m.chat_role !== 'admin' || iAmOwner);
  contextMenu([
    { icon: 'user', label: t('panel.profile'), onClick: () => openPanel({ type: 'user', id: uid }) },
    uid !== S.me.id && { icon: 'send', label: t('panel.message'), onClick: () => app.openDirect(uid) },
    iAmOwner && uid !== S.me.id && m.chat_role !== 'owner' && { icon: 'shield', label: m.chat_role === 'admin' ? t('panel.remove_admin') : t('panel.make_admin'),
      onClick: async () => { await patch(`/api/chats/${c.id}/members/${uid}`, { role: m.chat_role === 'admin' ? 'member' : 'admin' }); S.chatDetails.delete(c.id); render(); } },
    canKick && { icon: 'trash', label: t('panel.remove'), danger: true, onClick: async () => {
      if (!(await confirmDialog(t('panel.remove_q', { name: m.name }), { danger: true, ok: t('panel.remove') }))) return;
      await del(`/api/chats/${c.id}/members/${uid}`); S.chatDetails.delete(c.id); render();
    } },
  ], anchor);
}

function editChatDialog(chatId) {
  const c = S.chatDetails.get(chatId);
  let avatarFile;
  const m = modal({
    title: c.type === 'channel' ? t('panel.edit_channel') : t('panel.edit_group'),
    content: `<div class="avatar-edit"><label class="av-pick">${avatar(c, 96)}<input type="file" accept="image/*" hidden><span>${icon('image', 20)}</span></label></div>
      <label class="field"><span>${esc(t('newchat.title'))}</span><input class="input" id="ec-title" maxlength="80" value="${esc(c.title)}"></label>
      <label class="field"><span>${esc(t('newchat.description'))}</span><textarea class="input" id="ec-desc" rows="3" maxlength="500">${esc(c.description)}</textarea></label>
      <label class="check"><input type="checkbox" id="ec-public" ${c.is_public ? 'checked' : ''}> ${esc(t('newchat.public'))}</label>
      ${c.type === 'group' ? `<label class="check"><input type="checkbox" id="ec-ro" ${c.only_admins_post ? 'checked' : ''}> ${esc(t('panel.only_admins'))}</label>` : ''}
      <button class="link-btn" id="ec-reset">${esc(t('panel.reset_link'))}</button>
      <div class="modal-actions">${c.my_role === 'owner' ? `<button class="btn danger" data-a="del">${esc(t('common.delete'))}</button><span class="grow"></span>` : ''}
        <button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('common.save'))}</button></div>`,
  });
  const b = m.body;
  b.querySelector('.av-pick input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const up = await upload(f);
      avatarFile = up.id;
      b.querySelector('.av-pick .av').outerHTML = `<span class="av" style="width:96px;height:96px"><img src="${up.url}" alt=""></span>`;
    } catch (err) { toast(errText(err), { type: 'error' }); }
  };
  b.querySelector('#ec-reset').onclick = async () => {
    await patch(`/api/chats/${chatId}`, { reset_invite: true });
    S.chatDetails.delete(chatId);
    toast(t('panel.link_reset'));
  };
  b.querySelector('[data-a=no]').onclick = () => m.close();
  const delBtn = b.querySelector('[data-a=del]');
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmDialog(t('panel.delete_chat_q', { title: c.title }), { danger: true, ok: t('common.delete') }))) return;
    await del(`/api/chats/${chatId}`);
    m.close();
  };
  b.querySelector('[data-a=yes]').onclick = async () => {
    const body = { title: b.querySelector('#ec-title').value, description: b.querySelector('#ec-desc').value, is_public: b.querySelector('#ec-public').checked };
    const ro = b.querySelector('#ec-ro');
    if (ro) body.only_admins_post = ro.checked;
    if (avatarFile) body.avatar_file = avatarFile;
    try {
      const out = await patch(`/api/chats/${chatId}`, body);
      S.chatDetails.set(chatId, out);
      app.applyChat(out);
      m.close();
      render();
    } catch (err) { toast(errText(err), { type: 'error' }); }
  };
}

async function webhookDialog(chatId) {
  const name = await promptDialog(t('panel.webhook_name'), { value: 'Gobsek', ok: t('common.create') });
  if (!name) return;
  try {
    const w = await post(`/api/chats/${chatId}/webhooks`, { name });
    const url = `${location.origin}${w.path}`;
    S.chatDetails.delete(chatId);
    render();
    modal({
      title: t('panel.webhook_ready'),
      content: `<p>${esc(t('panel.webhook_once'))}</p><div class="code-box mono" data-copy>${esc(url)}</div>
        <p class="muted small">${esc(t('panel.webhook_example'))}</p>
        <pre class="code"><code>curl -X POST ${esc(url)} \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"Задача №42","text":"Новая задача от Gobsek","url":"https://gobsek.example/tasks/42"}'</code></pre>
        <div class="modal-actions"><button class="btn" data-a="copy">${esc(t('common.copy'))}</button></div>`,
      onMount: (b) => { b.querySelector('[data-a=copy]').onclick = () => copyText(url).then(() => toast(t('msg.copied'))); },
    });
  } catch (err) { toast(errText(err), { type: 'error' }); }
}

export { previewText };
