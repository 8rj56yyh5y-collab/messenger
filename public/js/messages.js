// Отрисовка отдельных сообщений (пузыри, вложения, опросы, звонки, системные события).
import { S, userName, chatTitle } from './store.js';
import { t, locale } from './i18n.js';
import { esc, md, avatar, fmtTime, fmtSize, fmtDuration, isEmojiOnly, nameColor, plain, sameDay } from './util.js';
import { icon } from './icons.js';
import { voiceHtml } from './voice.js';
import { BADGES, PRIORITY_COLORS, fmtMoney } from './work-ui.js';

const GROUP_GAP = 5 * 60e3;

export function groupedWith(a, b) {
  return a && b && !a.deleted && !b.deleted && a.kind !== 'system' && b.kind !== 'system' && a.kind !== 'call' && b.kind !== 'call'
    && a.user_id === b.user_id && Math.abs(b.created_at - a.created_at) < GROUP_GAP && sameDay(a.created_at, b.created_at);
}

/** Короткое описание сообщения — для списка чатов, ответов, уведомлений. */
export function previewText(m, { withAuthor = false, chat = null } = {}) {
  if (!m) return '';
  if (m.deleted) return t('msg.deleted');
  let s;
  switch (m.kind) {
    case 'image': s = `🖼 ${m.body ? plain(m.body) : t('msg.photo')}`; break;
    case 'video': s = `🎬 ${m.body ? plain(m.body) : t('msg.video')}`; break;
    case 'voice': s = `🎤 ${t('msg.voice')}${m.file?.meta?.duration ? ` (${fmtDuration(m.file.meta.duration)})` : ''}`; break;
    case 'file': s = `📎 ${m.body ? plain(m.body) : m.file?.name || t('msg.file')}`; break;
    case 'poll': s = `📊 ${m.meta?.question || m.body}`; break;
    case 'call': s = callLabel(m); break;
    case 'task': s = `✅ ${t('task.task')}: ${m.task?.title || m.body}`; break;
    case 'approval': s = `🧾 ${t('appr.short')}: ${m.meta?.title || m.body}`; break;
    case 'kudos': s = `${BADGES[m.meta?.badge] || '🎉'} ${t('kudos.short')}: ${(m.meta?.to || []).map((id) => userName(id).split(' ')[0]).join(', ')}`; break;
    case 'meeting': s = `📅 ${t('meet.short')}: ${m.meeting?.title || m.body}`; break;
    case 'system': return systemText(m);
    default:
      if (m.meta?.ai_notice) return t(`ai.notice.${m.meta.ai_notice}`);
      if (m.meta?.decision) { s = `${m.meta.decision === 'approve' ? '✅' : '❌'} ${t(m.meta.decision === 'approve' ? 'appr.approved_by' : 'appr.rejected_by')}${m.body ? `: ${plain(m.body)}` : ''}`; break; }
      s = (m.file?.mime?.startsWith('video/') && m.meta?.round) ? `⭕ ${t('msg.video_note')}` : plain(m.body);
  }
  if (withAuthor && chat && chat.type === 'group' && m.user_id) {
    const who = m.user_id === S.me.id ? t('msg.you') : userName(m.user_id).split(' ')[0];
    return `<b>${esc(who)}:</b> ${esc(s)}`;
  }
  return withAuthor ? esc(s) : s;
}

function callLabel(m) {
  const mine = m.user_id === S.me.id;
  const video = m.meta?.media === 'video';
  const st = m.meta?.status;
  if (!m.meta?.direct) return `${video ? '🎥' : '📞'} ${t('call.conference')}${m.meta?.duration ? ` · ${fmtDuration(m.meta.duration)}` : ''}`;
  if (st === 'missed') return `${video ? '🎥' : '📞'} ${mine ? t('call.cancelled') : t('call.missed')}`;
  if (st === 'declined') return `${video ? '🎥' : '📞'} ${mine ? t('call.declined_short') : t('call.declined_by_you')}`;
  if (st === 'cancelled') return `${video ? '🎥' : '📞'} ${t('call.cancelled')}`;
  return `${video ? '🎥' : '📞'} ${mine ? t('call.outgoing') : t('call.incoming')} · ${fmtDuration(m.meta?.duration || 0)}`;
}

export function systemText(m) {
  const meta = m.meta || {};
  const actor = meta.actor === S.me.id ? t('msg.you') : userName(meta.actor);
  const targets = (meta.targets || []).map((id) => (id === S.me.id ? t('msg.you_obj') : userName(id))).join(', ');
  switch (meta.event) {
    case 'created': return t('sys.created', { actor, title: meta.title || '' });
    case 'joined': return t('sys.joined', { actor });
    case 'left': return t('sys.left', { actor: targets || actor });
    case 'added': return t('sys.added', { actor, targets });
    case 'removed': return t('sys.removed', { actor, targets });
    case 'title': return t('sys.title', { actor, title: meta.title });
    case 'pinned': return t('sys.pinned', { actor });
    case 'task_due': return t('sys.task_due', { title: meta.title });
    case 'meeting_soon': return t('sys.meeting_soon', { title: meta.title });
    case 'reminder': {
      const c = S.chats.get(meta.chat_id);
      return t('sys.reminder', { chat: c ? chatTitle(c, t) : '…' });
    }
    default: return meta.event || '';
  }
}

function ticks(m, chat) {
  if (m.user_id !== S.me.id || chat.type === 'saved' || chat.type === 'channel') return '';
  if (m._pending) return `<span class="tick pending">${icon('clock', 13)}</span>`;
  if (m._failed) return `<span class="tick failed">!</span>`;
  const read = chat.others_read_id >= m.id;
  return `<span class="tick ${read ? 'read' : ''}">${icon(read ? 'check2' : 'check', 15)}</span>`;
}

function replyHtml(r) {
  if (!r) return '';
  if (r.deleted) return `<div class="reply-q deleted"><span>${esc(t('msg.deleted'))}</span></div>`;
  const label = r.kind === 'poll' ? `📊 ${r.meta?.question || r.body}` : r.kind === 'image' ? `🖼 ${r.body || t('msg.photo')}` : r.kind === 'voice' ? `🎤 ${t('msg.voice')}`
    : r.kind === 'video' ? `🎬 ${r.body || t('msg.video')}` : r.kind === 'file' ? `📎 ${r.body || r.file?.name || t('msg.file')}` : plain(r.body);
  return `<div class="reply-q" data-action="jump" data-id="${r.id}" style="--c:${nameColor(r.user_id)}">
    <b>${esc(r.user_id === S.me.id ? t('msg.you') : userName(r.user_id))}</b><span>${esc(label)}</span></div>`;
}

function fileHtml(m) {
  const f = m.file;
  if (!f) return '';
  if (m.kind === 'image') {
    const w = f.meta?.width || 400;
    const h = f.meta?.height || 300;
    const ratio = Math.max(0.4, Math.min(2.5, w / h));
    return `<div class="media" data-action="view-media" data-id="${m.id}" style="aspect-ratio:${ratio}"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy" draggable="false"></div>`;
  }
  if (m.kind === 'video' && m.meta?.round) {
    return `<div class="round-video" data-action="round-play"><video src="${esc(f.url)}" playsinline preload="metadata" muted loop></video>
      <svg class="round-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg><span class="round-dur">${fmtDuration(f.meta?.duration || 0)}</span><span class="round-mute">${icon('micOff', 14)}</span></div>`;
  }
  if (m.kind === 'video') {
    return `<div class="media video" style="aspect-ratio:${f.meta?.width && f.meta?.height ? f.meta.width / f.meta.height : 16 / 9}"><video src="${esc(f.url)}" controls preload="metadata" playsinline></video></div>`;
  }
  if (m.kind === 'voice') return voiceHtml(f, m.user_id === S.me.id);
  const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
  return `<a class="doc" href="${esc(f.url)}?download=1" download="${esc(f.name)}">
    <span class="doc-ic">${ext ? `<b>${esc(ext)}</b>` : icon('file', 22)}</span>
    <span class="doc-info"><span class="doc-name">${esc(f.name)}</span><span class="doc-size">${fmtSize(f.size)}</span></span>
    <span class="doc-dl">${icon('download', 18)}</span></a>`;
}

function pollHtml(m) {
  const meta = m.meta;
  const p = m.poll || { counts: [], mine: [], total: 0 };
  const voted = p.mine.length > 0 || meta.closed;
  const max = Math.max(1, ...p.counts);
  const opts = meta.options.map((o, i) => {
    const n = p.counts[i] || 0;
    const pct = p.total ? Math.round((n / p.total) * 100) : 0;
    const mine = p.mine.includes(i);
    const voters = p.voters?.[i]?.slice(0, 3).map((uid) => avatar(S.users.get(uid) || { id: uid, name: userName(uid) }, 18)).join('') || '';
    return `<button class="poll-opt ${voted ? 'voted' : ''} ${mine ? 'mine' : ''} ${n === max && voted && n ? 'top' : ''}" data-action="vote" data-id="${m.id}" data-opt="${i}" ${meta.closed ? 'disabled' : ''}>
      <span class="poll-check">${meta.multiple ? (mine ? '☑' : '☐') : mine ? '●' : '○'}</span>
      ${voted ? `<span class="poll-pct">${pct}%</span>` : ''}<span class="poll-text">${esc(o)}</span>
      ${voters ? `<span class="poll-voters">${voters}</span>` : ''}
      ${voted ? `<span class="poll-bar" style="width:${pct}%"></span>` : ''}</button>`;
  }).join('');
  const kind = meta.closed ? t('poll.closed') : meta.anonymous ? t('poll.anonymous') : t('poll.public');
  return `<div class="poll"><div class="poll-q">${esc(meta.question)}</div><div class="poll-kind">${esc(kind)}${meta.multiple ? ` · ${esc(t('poll.multiple'))}` : ''}</div>
    <div class="poll-opts">${opts}</div>
    <div class="poll-foot">${esc(t('poll.votes', { n: p.total }))}${!meta.closed && m.user_id === S.me.id ? ` · <button class="link-btn" data-action="close-poll" data-id="${m.id}">${esc(t('poll.close'))}</button>` : ''}</div></div>`;
}

function callHtml(m) {
  const st = m.meta?.status;
  const bad = st === 'missed' || st === 'declined' || st === 'cancelled';
  const mine = m.user_id === S.me.id;
  return `<div class="call-msg ${bad && !mine ? 'missed' : ''}">
    <span class="call-ic">${icon(mine ? 'phoneOut' : 'phoneIn', 18)}</span>
    <span class="call-txt"><b>${esc(callLabel(m).replace(/^\S+\s/, ''))}</b></span>
    <button class="icon-btn ghost" data-action="call-back" data-media="${m.meta?.media || 'audio'}" title="${esc(t('call.call_back'))}">${icon(m.meta?.media === 'video' ? 'video' : 'phone', 18)}</button></div>`;
}

function reactionsHtml(m) {
  if (!m.reactions?.length) return '';
  return `<div class="reactions">${m.reactions.map((r) => `<button class="react ${r.mine ? 'mine' : ''}" data-action="react" data-id="${m.id}" data-emoji="${r.emoji}"
    title="${esc(r.users.map((u) => userName(u)).join(', '))}"><span>${r.emoji}</span>${r.users.length <= 3 && r.users.length > 1
    ? `<span class="react-avs">${r.users.map((u) => avatar(S.users.get(u) || (u === S.me.id ? S.me : { id: u, name: userName(u) }), 18)).join('')}</span>` : `<b>${r.users.length}</b>`}</button>`).join('')}</div>`;
}

export function messageHtml(m, chat, { prev, next, highlight = '' } = {}) {
  if (m.deleted) return '';
  if (m.kind === 'system') {
    if (m.meta?.event === 'reminder') {
      return `<div class="msg system reminder" data-id="${m.id}"><div class="sys-pill reminder-card" data-action="goto" data-chat="${m.meta.chat_id}" data-mid="${m.meta.message_id}">
        ⏰ ${esc(systemText(m))}${m.meta.preview ? `<span class="rem-prev">${esc(plain(m.meta.preview).slice(0, 160))}</span>` : ''}</div></div>`;
    }
    if (m.meta?.event === 'meeting_soon') {
      return `<div class="msg system" data-id="${m.id}"><div class="sys-pill sys-meet">📅 ${esc(systemText(m))}<button class="btn sm hl" data-action="meeting-join" data-mid="${m.meta.meeting_id}">${esc(t('call.join'))}</button></div></div>`;
    }
    if (m.meta?.event === 'task_due') {
      return `<div class="msg system" data-id="${m.id}"><div class="sys-pill reminder-card" data-action="goto" data-chat="${m.meta.chat_id}" data-mid="${m.meta.message_id}">⏰ ${esc(systemText(m))}</div></div>`;
    }
    return `<div class="msg system" data-id="${m.id}"><div class="sys-pill">${esc(systemText(m))}</div></div>`;
  }
  const mine = m.user_id === S.me.id && chat.type !== 'channel';
  const first = !groupedWith(prev, m);
  const last = !groupedWith(m, next);
  const showName = first && !mine && (chat.type === 'group' || (chat.type === 'channel' && false)) && !m.fwd;
  const u = S.users.get(m.user_id) || { id: m.user_id, name: userName(m.user_id) };
  const emojiOnly = m.kind === 'text' && !m.reply && !m.fwd && isEmojiOnly(m.body);
  const mediaOnly = ((m.kind === 'image' || m.kind === 'video') && !m.body && !m.reply && !m.fwd) || (m.kind === 'video' && m.meta?.round);
  const card = ['task', 'approval', 'kudos', 'meeting'].includes(m.kind);
  const aiNotice = m.meta?.ai_notice ? `<div class="ai-notice">${icon('info', 16)} ${esc(t(`ai.notice.${m.meta.ai_notice}`))}</div>` : '';
  let body = '';
  if (m.kind === 'poll') body = pollHtml(m);
  else if (m.kind === 'call') body = callHtml(m);
  else if (m.kind === 'task') body = taskCardHtml(m);
  else if (m.kind === 'approval') body = approvalCardHtml(m);
  else if (m.kind === 'kudos') body = kudosCardHtml(m);
  else if (m.kind === 'meeting') body = meetingCardHtml(m);
  else {
    body = fileHtml(m);
    if (m.meta?.decision) body += `<div class="decision ${m.meta.decision}">${m.meta.decision === 'approve' ? '✅' : '❌'} ${esc(t(m.meta.decision === 'approve' ? 'appr.approved_by' : 'appr.rejected_by'))}</div>`;
    if (m.body) {
      let html = md(m.body, { me: S.me.login });
      if (highlight) html = highlightText(html, highlight);
      body += `<div class="text ${emojiOnly ? 'big-emoji' : ''} ${m.meta?.streaming ? 'streaming' : ''}">${html}</div>`;
    }
    body += aiNotice;
  }
  const time = `<span class="meta">${m.silent ? `<span title="${esc(t('msg.silent'))}">${icon('bellOff', 12)}</span>` : ''}${m.meta?.scheduled ? `<span title="${esc(t('msg.scheduled'))}">${icon('clock', 12)}</span>` : ''}${m.edited_at ? `<span class="edited">${esc(t('msg.edited'))}</span>` : ''}${fmtTime(m.created_at)}${ticks(m, chat)}</span>`;
  const showAvatar = !mine && chat.type === 'group';
  const fwd = m.fwd ? `<div class="fwd">${icon('forward', 14)} ${esc(t('msg.forwarded_from'))} <b>${esc(m.fwd.name || userName(m.fwd.user_id))}</b></div>` : '';
  const via = m.meta?.via === 'webhook' ? `<span class="bot-badge">bot</span>` : '';
  return `<div class="msg ${mine ? 'mine' : ''} ${first ? 'first' : ''} ${last ? 'last' : ''} ${showAvatar ? 'with-av' : ''} kind-${m.kind}" data-id="${m.id}" data-user="${m.user_id || ''}">
    ${showAvatar ? `<div class="msg-av" data-action="user" data-uid="${m.user_id}">${avatar(u, 36)}</div>` : ''}
    <div class="bubble ${emojiOnly ? 'emoji-only' : ''} ${mediaOnly ? 'media-only' : ''} ${card ? `card card-${m.kind}` : ''} ${m.meta?.round ? 'round' : ''}">
      ${showName ? `<div class="author" data-action="user" data-uid="${m.user_id}" style="color:${nameColor(m.user_id)}">${esc(u.name)}${via}${u.position ? `<small>${esc(u.position)}</small>` : ''}</div>` : ''}
      ${fwd}${replyHtml(m.reply)}${m.meta?.ack_required ? `<div class="ack-tag">${icon('shield', 13)} ${esc(t('ack.required'))}</div>` : ''}${body}${m.meta?.auto ? `<div class="auto-tag">${icon('clock', 12)} ${esc(t('msg.auto_reply'))}</div>` : ''}${time}${reactionsHtml(m)}${ackHtml(m)}${threadHtml(m)}
    </div>
    <button class="msg-react-btn" data-action="quick-react" data-id="${m.id}" aria-label="react">${icon('smile', 16)}</button>
  </div>`;
}

function highlightText(html, q) {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return html;
  // Подсвечиваем только в текстовых узлах (вне тегов).
  return html.replace(/(^|>)([^<]+)/g, (all, gt, text) => gt + text.replace(new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu'), '<mark>$1</mark>'));
}

export function dayDivider(ts, label) {
  return `<div class="day-divider" data-day="${new Date(ts).toDateString()}"><span>${esc(label)}</span></div>`;
}

// ---------- Рабочие карточки ----------
function personChip(id, extra = '') {
  const u = S.users.get(id) || (id === S.me.id ? S.me : { id, name: userName(id) });
  return `<span class="person-chip" data-action="user" data-uid="${id}">${avatar(u, 20)}${esc(id === S.me.id ? t('msg.you') : u.name.split(' ').slice(0, 2).join(' '))}${extra}</span>`;
}

function dueLabel(ts, done) {
  if (!ts) return '';
  const overdue = !done && ts < Date.now();
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const label = sameDay ? `${t('date.today')}, ${fmtTime(ts)}` : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) + `, ${fmtTime(ts)}`;
  return `<span class="due ${overdue ? 'overdue' : ''}">${icon('clock', 13)}${esc(label)}</span>`;
}

export function taskCardHtml(m) {
  const tk = m.task;
  if (!tk) return `<div class="text">${esc(m.body)}</div>`;
  const done = tk.status === 'done';
  const canAct = tk.assignee_id === S.me.id || tk.creator_id === S.me.id;
  const next = { todo: 'doing', doing: 'review', review: 'done' }[tk.status];
  return `<div class="wcard task-card status-${tk.status}">
    <div class="wc-head"><span class="wc-kind" style="--c:${PRIORITY_COLORS[tk.priority]}">${icon('check', 14)} ${esc(t('task.task'))}${tk.priority !== 'normal' ? ` · ${esc(t(`prio.${tk.priority}`))}` : ''}</span>
      <span class="status-chip st-${tk.status}">${esc(t(`tstatus.${tk.status}`))}</span></div>
    <div class="wc-title ${done ? 'done' : ''}" data-action="task-open" data-tid="${tk.id}">${esc(tk.title)}</div>
    ${tk.description ? `<div class="wc-desc">${esc(tk.description).slice(0, 300)}</div>` : ''}
    <div class="wc-meta">${personChip(tk.assignee_id)}${dueLabel(tk.due_at, done)}</div>
    ${canAct && tk.status !== 'done' && tk.status !== 'cancelled' ? `<div class="wc-actions">
      ${next ? `<button class="btn sm" data-action="task-status" data-tid="${tk.id}" data-status="${next}">${esc(t(`task.to_${next}`))}</button>` : ''}
      ${tk.status !== 'done' && next !== 'done' ? `<button class="btn sm soft" data-action="task-status" data-tid="${tk.id}" data-status="done">${icon('check', 14)} ${esc(t('task.to_done'))}</button>` : ''}
    </div>` : ''}
  </div>`;
}

function approvalCardHtml(m) {
  const a = m.meta || {};
  const pendingMine = a.status === 'pending' && (a.approvers || []).includes(S.me.id) && !a.decisions?.[S.me.id];
  const statusIc = { pending: '⏳', approved: '✅', rejected: '❌' }[a.status] || '⏳';
  return `<div class="wcard approval-card ap-${a.status}">
    <div class="wc-head"><span class="wc-kind">${icon('briefcase', 14)} ${esc(t('appr.short'))}</span><span class="status-chip ap-${a.status}">${statusIc} ${esc(t(`appr.st_${a.status}`))}</span></div>
    <div class="wc-title">${esc(a.title)}</div>
    ${a.amount != null ? `<div class="ap-amount">${esc(fmtMoney(a.amount, a.currency))}</div>` : ''}
    ${a.description ? `<div class="wc-desc">${md(a.description)}</div>` : ''}
    <div class="ap-list">${(a.approvers || []).map((id) => {
      const d = a.decisions?.[id];
      return `<div class="ap-row ${d ? d.decision : 'wait'}">${personChip(id)}<span class="ap-state">${d ? (d.decision === 'approve' ? '✅' : '❌') : '⏳'}</span></div>`;
    }).join('')}</div>
    ${a.mode === 'any' ? `<div class="muted small">${esc(t('appr.mode_any'))}</div>` : ''}
    ${pendingMine ? `<div class="wc-actions"><button class="btn sm ok" data-action="approve" data-id="${m.id}">${icon('check', 14)} ${esc(t('appr.approve'))}</button>
      <button class="btn sm soft danger" data-action="reject" data-id="${m.id}">${icon('x', 14)} ${esc(t('appr.reject'))}</button></div>` : ''}
  </div>`;
}

function kudosCardHtml(m) {
  const k = m.meta || {};
  return `<div class="wcard kudos-card badge-${k.badge}">
    <div class="kd-emoji">${BADGES[k.badge] || '🎉'}</div>
    <div class="kd-badge">${esc(t(`badge.${k.badge}`))}</div>
    <div class="kd-to">${(k.to || []).map((id) => personChip(id)).join('')}</div>
    ${m.body ? `<div class="kd-text">${md(m.body)}</div>` : ''}
    <div class="kd-from">${esc(m.user_id === S.me.id ? t('kudos.from_you') : t('kudos.from', { name: userName(m.user_id) }))}</div>
  </div>`;
}

function meetingCardHtml(m) {
  const mt = m.meeting;
  if (!mt) return `<div class="text">${esc(m.body)}</div>`;
  const d = new Date(mt.starts_at);
  const end = mt.starts_at + mt.duration_min * 60e3;
  const live = !mt.cancelled && Date.now() > mt.starts_at - 10 * 60e3 && Date.now() < end;
  const past = Date.now() > end;
  const yes = mt.attendees.filter((a) => a.rsvp === 'yes');
  return `<div class="wcard meeting-card ${mt.cancelled ? 'cancelled' : ''} ${past ? 'past' : ''}">
    <div class="mt-row"><div class="mt-date"><small>${esc(d.toLocaleDateString(locale(), { month: 'short' }))}</small><b>${d.getDate()}</b><small>${esc(d.toLocaleDateString(locale(), { weekday: 'short' }))}</small></div>
    <div class="mt-info"><div class="wc-kind">${icon('calendar', 14)} ${esc(t('meet.short'))}${mt.cancelled ? ` · ${esc(t('meet.cancelled'))}` : ''}</div>
      <div class="wc-title">${esc(mt.title)}</div><div class="mt-time">${fmtTime(mt.starts_at)} – ${fmtTime(end)} · ${mt.duration_min} ${esc(t('meet.min'))}</div></div></div>
    ${mt.description ? `<div class="wc-desc">${md(mt.description)}</div>` : ''}
    <div class="mt-people">${yes.slice(0, 6).map((a) => avatar(S.users.get(a.user_id) || { id: a.user_id, name: userName(a.user_id) }, 24)).join('')}
      <span class="muted small">${esc(t('meet.going', { n: yes.length, total: mt.attendees.length }))}</span></div>
    ${!mt.cancelled && Date.now() > mt.starts_at - 10 * 60e3 && mt.attendees.some((x) => x.user_id === S.me.id) ? `<button class="btn sm soft block mt-minutes" data-action="minutes" data-mid="${mt.id}">📝 ${esc(t('min.button'))}</button>` : ''}
    ${!mt.cancelled && !past ? `<div class="wc-actions">
      ${live ? `<button class="btn sm hl" data-action="meeting-join" data-mid="${mt.id}">${icon('video', 14)} ${esc(t('call.join'))}</button>` : ''}
      ${mt.my_rsvp ? ['yes', 'maybe', 'no'].map((r) => `<button class="btn sm ${mt.my_rsvp === r ? '' : 'soft'}" data-action="rsvp" data-mid="${mt.id}" data-r="${r}">${esc(t(`rsvp.${r}`))}</button>`).join('') : ''}
    </div>` : ''}
  </div>`;
}

function ackHtml(m) {
  if (!m.ack) return '';
  const mine = m.user_id === S.me.id;
  if (!mine && !m.ack.mine) return `<button class="btn sm block ack-btn" data-action="ack" data-id="${m.id}">${icon('check', 15)} ${esc(t('ack.confirm'))}</button>`;
  const pct = m.ack.total ? Math.round((m.ack.count / m.ack.total) * 100) : 0;
  return `<button class="ack-bar" data-action="ack-list" data-id="${m.id}"><span class="ack-p"><i style="width:${pct}%"></i></span>${m.ack.mine ? `${icon('check2', 14)} ` : ''}${esc(t('ack.progress', { n: m.ack.count, total: m.ack.total }))}</button>`;
}

function threadHtml(m) {
  if (m.thread_id || m.kind === 'system') return '';
  const th = m.thread;
  if (!th) return '';
  return `<button class="thread-link" data-action="thread" data-id="${m.id}"><span class="th-avs">${th.users.map((id) => avatar(S.users.get(id) || { id, name: userName(id) }, 20)).join('')}</span>
    <b>${esc(t('thread.replies', { n: th.count }))}</b><span class="muted">${esc(fmtTime(th.last_at))}</span>${icon('right', 14)}</button>`;
}
