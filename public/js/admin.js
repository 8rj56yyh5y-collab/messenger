// Администрирование: сотрудники, приглашения, статистика, журнал действий.
import { S } from './store.js';
import { t, errText } from './i18n.js';
import { esc, avatar, fmtDateTime, copyText } from './util.js';
import { icon } from './icons.js';
import { get, post, patch, del } from './api.js';
import { modal, toast, confirmDialog } from './dialogs.js';

const TABS = [['stats', 'chart'], ['company', 'building'], ['users', 'users'], ['depts', 'briefcase'], ['invites', 'link'], ['integr', 'hook'], ['audit', 'list']];

export function openAdmin(tab = 'stats') {
  const m = modal({ title: t('side.admin'), wide: true, content: '' });
  const draw = (cur) => {
    m.body.innerHTML = `<div class="tabs">${TABS.map(([k, ic]) => `<button class="tab ${cur === k ? 'on' : ''}" data-tab="${k}">${icon(ic, 16)} ${esc(t(`admin.${k}`))}</button>`).join('')}</div><div class="admin-body"><span class="spinner"></span></div>`;
    m.body.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => draw(b.dataset.tab); });
    VIEWS[cur](m.body.querySelector('.admin-body'), () => draw(cur));
  };
  draw(tab);
}

function credentialsBox(login, password) {
  const text = `${location.origin}\n${t('auth.login')}: ${login}\n${t('auth.password')}: ${password}`;
  modal({
    title: t('admin.credentials'), cls: 'small',
    content: `<p>${esc(t('admin.credentials_hint'))}</p><pre class="code"><code>${esc(text)}</code></pre>
      <div class="modal-actions"><button class="btn" data-a="copy">${esc(t('common.copy'))}</button></div>`,
    onMount: (b) => { b.querySelector('[data-a=copy]').onclick = () => copyText(text).then(() => toast(t('msg.copied'))); },
  });
}

const VIEWS = {
  async company(el, redraw) {
    const w = await get('/api/admin/workspace');
    const FEATS = ['ai', 'calls', 'tasks', 'approvals', 'meetings', 'kudos', 'awards', 'polls', 'voice', 'video_notes', 'send_later', 'registration'];
    const DAYS = [1, 2, 3, 4, 5, 6, 0];
    const dayName = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'short' });
    const badgeRow = (b = {}) => `<div class="cb-row" data-code="${esc(b.code || '')}"><input class="input cb-emoji" maxlength="8" value="${esc(b.emoji || '🏅')}">
      <input class="input cb-name" maxlength="40" placeholder="${esc(t('ws.badge_name'))}" value="${esc(b.name || '')}">
      <input class="input cb-pts" type="number" min="1" max="1000" value="${b.points || 10}" title="${esc(t('ws.points'))}">
      <button class="icon-btn ghost" data-a="cb-del">${icon('trash', 18)}</button></div>`;
    el.innerHTML = `<div class="ws-form">
      <section class="ws-sec"><h3>${icon('building', 18)} ${esc(t('ws.company'))}</h3>
        <label class="field"><span>${esc(t('ws.company_name'))}</span><input class="input" id="w-company" maxlength="80" value="${esc(w.company)}" placeholder="ТОВ «Гобсек»"></label>
        <label class="field"><span>${esc(t('ws.welcome'))}</span><textarea class="input" id="w-welcome" rows="2" maxlength="500" placeholder="${esc(t('ws.welcome_ph'))}">${esc(w.welcome)}</textarea></label></section>
      <section class="ws-sec"><h3>${icon('megaphone', 18)} ${esc(t('ws.announcement'))}</h3>
        <p class="muted small">${esc(t('ws.announcement_hint'))}</p>
        <textarea class="input" id="w-ann" rows="2" maxlength="300" placeholder="${esc(t('ws.announcement_ph'))}">${esc(w.announcement.text)}</textarea>
        <div class="seg" id="w-ann-lvl">${['info', 'warn', 'success'].map((l) => `<button class="${w.announcement.level === l ? 'on' : ''}" data-lvl="${l}">${esc(t(`ws.lvl_${l}`))}</button>`).join('')}</div></section>
      <section class="ws-sec"><h3>${icon('sliders', 18)} ${esc(t('ws.features'))}</h3>
        <p class="muted small">${esc(t('ws.features_hint'))}</p>
        <div class="feat-grid">${FEATS.map((f) => `<label class="feat-tile ${w.features[f] !== false ? 'on' : ''}"><input type="checkbox" data-feat="${f}" ${w.features[f] !== false ? 'checked' : ''}>
          <b>${esc(t(`ws.f_${f}`))}</b><small>${esc(t(`ws.fh_${f}`))}</small>${f === 'ai' && !S.meta.ai_available ? `<em>${esc(t('ws.ai_no_key'))}</em>` : ''}</label>`).join('')}</div></section>
      <section class="ws-sec"><h3>${icon('clock', 18)} ${esc(t('ws.rules'))}</h3>
        <div class="grid-2">
          <label class="field"><span>${esc(t('ws.edit_window'))}</span><input class="input" type="number" min="0" id="w-edit" value="${w.edit_window_h}"><small class="muted">${esc(t('ws.zero_unlimited'))}</small></label>
          <label class="field"><span>${esc(t('ws.delete_window'))}</span><input class="input" type="number" min="0" id="w-del" value="${w.delete_window_h}"><small class="muted">${esc(t('ws.zero_unlimited'))}</small></label>
          <label class="field"><span>${esc(t('ws.max_upload'))}</span><input class="input" type="number" min="1" id="w-up" value="${w.max_upload_mb}"></label>
          <label class="field"><span>${esc(t('ws.kudos_limit'))}</span><input class="input" type="number" min="0" id="w-klim" value="${w.kudos_month_limit}"><small class="muted">${esc(t('ws.zero_unlimited'))}</small></label>
        </div></section>
      <section class="ws-sec"><h3>${icon('calendar', 18)} ${esc(t('ws.work_hours'))}</h3>
        <p class="muted small">${esc(t('ws.work_hours_hint'))}</p>
        <div class="row wh-row"><input class="input" type="time" id="w-from" value="${esc(w.work_hours.from)}"> — <input class="input" type="time" id="w-to" value="${esc(w.work_hours.to)}"></div>
        <div class="day-pick">${DAYS.map((d) => `<button class="${w.work_hours.days.includes(d) ? 'on' : ''}" data-day="${d}">${esc(dayName(d))}</button>`).join('')}</div></section>
      <section class="ws-sec"><h3>${icon('award', 18)} ${esc(t('ws.awards'))}</h3>
        <label class="field"><span>${esc(t('ws.kudos_points'))}</span><input class="input" type="number" min="1" id="w-kpts" value="${w.kudos_points}"></label>
        <div class="sec-title">${esc(t('ws.custom_badges'))}</div><p class="muted small">${esc(t('ws.custom_badges_hint'))}</p>
        <div id="cb-list">${w.custom_badges.map(badgeRow).join('')}</div>
        <button class="btn soft sm" data-a="cb-add">${icon('plus', 16)} ${esc(t('ws.badge_add'))}</button></section>
      <div class="ws-save"><button class="btn" data-a="save">${icon('check', 18)} ${esc(t('common.save'))}</button></div></div>`;
    el.addEventListener('change', (e) => { const f = e.target.closest('[data-feat]'); if (f) f.closest('.feat-tile').classList.toggle('on', f.checked); });
    el.onclick = async (e) => {
      const lvl = e.target.closest('[data-lvl]');
      if (lvl) { el.querySelectorAll('[data-lvl]').forEach((b) => b.classList.toggle('on', b === lvl)); return; }
      const day = e.target.closest('[data-day]');
      if (day) { day.classList.toggle('on'); return; }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'cb-add') { el.querySelector('#cb-list').insertAdjacentHTML('beforeend', badgeRow()); return; }
      if (a.dataset.a === 'cb-del') { a.closest('.cb-row').remove(); return; }
      if (a.dataset.a !== 'save') return;
      const v = (id) => el.querySelector(id).value;
      const body = {
        company: v('#w-company'), welcome: v('#w-welcome'),
        announcement: { text: v('#w-ann'), level: el.querySelector('[data-lvl].on')?.dataset.lvl || 'info' },
        features: Object.fromEntries([...el.querySelectorAll('[data-feat]')].map((x) => [x.dataset.feat, x.checked])),
        edit_window_h: Number(v('#w-edit')), delete_window_h: Number(v('#w-del')), max_upload_mb: Number(v('#w-up')),
        kudos_month_limit: Number(v('#w-klim')), kudos_points: Number(v('#w-kpts')),
        work_hours: { from: v('#w-from'), to: v('#w-to'), days: [...el.querySelectorAll('[data-day].on')].map((x) => Number(x.dataset.day)) },
        custom_badges: [...el.querySelectorAll('.cb-row')].map((r) => ({ code: r.dataset.code, emoji: r.querySelector('.cb-emoji').value, name: r.querySelector('.cb-name').value, points: Number(r.querySelector('.cb-pts').value) })),
      };
      a.disabled = true;
      try { await patch('/api/admin/workspace', body); toast(t('common.saved')); redraw(); } catch (err) { toast(errText(err), { type: 'error' }); a.disabled = false; }
    };
  },

  async depts(el, redraw) {
    const o = await get('/api/org');
    const deps = o.departments.filter((d) => d.id);
    const loose = o.departments.filter((d) => !d.id);
    const name = (id) => (id ? S.users.get(id)?.name || '…' : '—');
    el.innerHTML = `<p class="muted">${esc(t('dept.hint'))}</p>
      <div class="row"><button class="btn" data-a="new">${icon('plus', 16)} ${esc(t('dept.new'))}</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('dept.name'))}</th><th>ЦФО</th><th>${esc(t('people.head'))}</th><th>${esc(t('dept.parent'))}</th><th>${esc(t('people.n_people', { n: '' }).trim())}</th><th></th></tr></thead>
      <tbody>${deps.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.chat_id ? ` ${icon('chat', 13)}` : ''}</td><td class="mono">${esc(d.cfo || '')}</td><td>${esc(name(d.head_id))}</td>
        <td>${esc(deps.find((x) => x.id === d.parent_id)?.name || '—')}</td><td>${d.members.length}</td><td class="right"><button class="icon-btn ghost" data-edit="${d.id}">${icon('edit', 18)}</button></td></tr>`).join('')}
      ${loose.map((d) => `<tr class="inactive"><td>${esc(d.name)}</td><td colspan="3" class="muted small">${esc(t('dept.not_created'))}</td><td>${d.members.length}</td><td class="right"><button class="btn sm soft" data-adopt="${esc(d.name)}">${esc(t('common.create'))}</button></td></tr>`).join('')}</tbody></table></div>`;
    const form = (d) => {
      const users = [...S.users.values()].filter((x) => !x.is_bot).sort((a, b) => a.name.localeCompare(b.name));
      const m = modal({
        title: d?.id ? d.name : t('dept.new'), cls: 'small',
        content: `<label class="field"><span>${esc(t('dept.name'))}</span><input class="input" id="dp-name" value="${esc(d?.name || '')}" autofocus></label>
          <label class="field"><span>${esc(t('dept.cfo'))}</span><input class="input" id="dp-cfo" value="${esc(d?.cfo || '')}" placeholder="ЦФО-07"></label>
          <label class="field"><span>${esc(t('people.head'))}</span><select class="input" id="dp-head"><option value="">—</option>${users.map((x) => `<option value="${x.id}" ${d?.head_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(t('dept.parent'))}</span><select class="input" id="dp-parent"><option value="">—</option>${deps.filter((x) => x.id !== d?.id).map((x) => `<option value="${x.id}" ${d?.parent_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          ${d?.chat_id ? '' : `<label class="check"><input type="checkbox" id="dp-chat" ${d?.id ? '' : 'checked'}> ${esc(t('dept.with_chat'))}</label>`}
          <div class="modal-actions">${d?.id ? `<button class="btn danger" data-a="del">${esc(t('common.delete'))}</button><span class="grow"></span>` : ''}<button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(t('common.save'))}</button></div>`,
      });
      m.body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'no') { m.close(); return; }
        try {
          if (a.dataset.a === 'del') { if (!(await confirmDialog(t('dept.del_q', { name: d.name }), { danger: true }))) return; await del(`/api/admin/departments/${d.id}`); }
          if (a.dataset.a === 'yes') {
            const body = { name: m.body.querySelector('#dp-name').value, cfo: m.body.querySelector('#dp-cfo').value, head_id: Number(m.body.querySelector('#dp-head').value) || null,
              parent_id: Number(m.body.querySelector('#dp-parent').value) || null, create_chat: !!m.body.querySelector('#dp-chat')?.checked };
            if (d?.id) await patch(`/api/admin/departments/${d.id}`, body); else await post('/api/admin/departments', body);
          }
          m.close();
          redraw();
        } catch (err) { toast(errText(err), { type: 'error' }); }
      });
    };
    el.querySelector('[data-a=new]').onclick = () => form(null);
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => form(deps.find((x) => x.id === Number(b.dataset.edit))); });
    el.querySelectorAll('[data-adopt]').forEach((b) => { b.onclick = () => form({ name: b.dataset.adopt }); });
  },


  async stats(el) {
    const s = await get('/api/admin/stats');
    const max = Math.max(1, ...s.per_day.map((d) => d.n));
    const tiles = [['users', s.users, 'admin.s_users'], ['eye', s.online, 'admin.s_online'], ['user', s.active_week, 'admin.s_week'], ['users', s.chats, 'admin.s_chats'],
      ['send', s.messages_day, 'admin.s_day'], ['list', s.messages_total, 'admin.s_total'], ['phone', s.calls_week, 'admin.s_calls'], ['file', `${s.files_mb} MB`, 'admin.s_files']];
    el.innerHTML = `<div class="kpis">${tiles.map(([ic, v, l]) => `<div class="kpi">${icon(ic, 18)}<b>${esc(v)}</b><span>${esc(t(l))}</span></div>`).join('')}</div>
      <div class="sec-title">${esc(t('admin.per_day'))}</div>
      <div class="bars" role="img" aria-label="${esc(t('admin.per_day'))}">${s.per_day.map((d) => `<div class="bar" title="${esc(d.d)}: ${d.n}"><i style="height:${Math.max(2, (d.n / max) * 100)}%"></i><small>${esc(d.d.slice(8))}</small></div>`).join('') || `<p class="muted">${esc(t('common.nothing'))}</p>`}</div>`;
  },

  async users(el, redraw) {
    const list = await get('/api/admin/users');
    el.innerHTML = `<div class="row"><input class="input grow" id="au-q" placeholder="${esc(t('contacts.search'))}"><button class="btn" id="au-new">${icon('plus', 16)} ${esc(t('admin.new_user'))}</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('profile.name'))}</th><th>${esc(t('auth.login'))}</th><th>${esc(t('profile.department'))}</th><th>${esc(t('admin.last_active'))}</th><th></th></tr></thead>
      <tbody>${list.map((u) => `<tr data-uid="${u.id}" data-q="${esc(`${u.name} ${u.login} ${u.department} ${u.position}`.toLowerCase())}" class="${u.active ? '' : 'inactive'}">
        <td><div class="cell-user">${avatar(u, 32, { online: u.online })}<div><b>${esc(u.name)}</b><small>${esc(u.position)}</small></div></div></td>
        <td class="mono">${esc(u.login)}${u.role === 'admin' ? ` <span class="role-tag">${esc(t('role.admin'))}</span>` : ''}${u.gobsek_id ? ' <span class="role-tag">Gobsek</span>' : ''}</td>
        <td>${esc(u.department)}</td><td class="muted small">${u.online ? `<span class="online-txt">${esc(t('presence.online'))}</span>` : esc(u.last_active ? fmtDateTime(u.last_active) : '—')}</td>
        <td class="right"><button class="icon-btn ghost" data-edit="${u.id}">${icon('edit', 18)}</button></td></tr>`).join('')}</tbody></table></div>`;
    el.querySelector('#au-q').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('tbody tr').forEach((r) => { r.style.display = r.dataset.q.includes(q) ? '' : 'none'; });
    };
    el.querySelector('#au-new').onclick = () => userForm(null, redraw);
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => userForm(list.find((u) => u.id === Number(b.dataset.edit)), redraw); });
  },

  async invites(el, redraw) {
    const list = await get('/api/admin/invites');
    el.innerHTML = `<p class="muted">${esc(t('admin.invites_hint'))}</p>
      <div class="row"><label class="field"><span>${esc(t('admin.uses'))}</span><input class="input" id="iv-uses" type="number" min="1" max="500" value="10"></label>
      <label class="field"><span>${esc(t('admin.days'))}</span><input class="input" id="iv-days" type="number" min="1" max="90" value="7"></label>
      <label class="field grow"><span>${esc(t('profile.department'))}</span><input class="input" id="iv-dep" placeholder="${esc(t('admin.dept_optional'))}"></label>
      <button class="btn" id="iv-new">${esc(t('admin.create_link'))}</button></div>
      <div class="list">${list.map((i) => {
        const url = `${location.origin}/#/invite/${i.code}`;
        return `<div class="li-row">${icon('link', 20)}<div class="li-main"><b class="mono">${esc(url)}</b><span>${esc(t('admin.invite_left', { n: i.uses_left }))} · ${esc(t('admin.until', { date: fmtDateTime(i.expires_at) }))}${i.department ? ` · ${esc(i.department)}` : ''}</span></div>
          <button class="icon-btn ghost" data-copy="${esc(url)}">${icon('copy', 18)}</button><button class="icon-btn ghost" data-del="${esc(i.code)}">${icon('trash', 18)}</button></div>`;
      }).join('') || `<p class="muted center">${esc(t('admin.no_invites'))}</p>`}</div>`;
    el.querySelector('#iv-new').onclick = async () => {
      try {
        const r = await post('/api/admin/invites', { uses: el.querySelector('#iv-uses').value, days: el.querySelector('#iv-days').value, department: el.querySelector('#iv-dep').value });
        await copyText(`${location.origin}/#/invite/${r.code}`);
        toast(t('admin.link_copied'));
        redraw();
      } catch (e) { toast(errText(e), { type: 'error' }); }
    };
    el.onclick = async (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { copyText(c.dataset.copy).then(() => toast(t('msg.copied'))); return; }
      const d = e.target.closest('[data-del]');
      if (d) { await del(`/api/admin/invites/${d.dataset.del}`); redraw(); }
    };
  },

  async integr(el) {
    const st = await get('/api/admin/integrations');
    const ev = st.gobsek_events;
    const row = (ok, title, text) => `<div class="integ-row"><span class="integ-dot ${ok ? 'on' : ''}"></span><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`;
    el.innerHTML = `<div class="integ">
      ${row(ev.enabled, t('integ.gobsek_events'), ev.enabled ? t('integ.events_stat', { d: ev.delivered, p: ev.pending, f: ev.failed }) + (ev.last_error ? ` · ${ev.last_error}` : '') : t('integ.events_off'))}
      ${row(S.meta.sso, t('integ.sso'), S.meta.sso ? t('about.on') : t('integ.sso_off'))}
      ${row(st.ai, t('integ.ai'), st.ai ? t('about.on') : t('integ.ai_off'))}
      ${row(st.push_devices > 0, t('integ.push'), t('integ.push_stat', { n: st.push_devices }))}
      <p class="muted small">${esc(t('integ.hint'))}</p></div>`;
  },

  async audit(el) {
    const list = await get('/api/admin/audit');
    el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('admin.when'))}</th><th>${esc(t('admin.who'))}</th><th>${esc(t('admin.action'))}</th><th>${esc(t('admin.details'))}</th></tr></thead>
      <tbody>${list.map((a) => `<tr><td class="muted small">${esc(fmtDateTime(a.created_at))}</td><td>${esc(a.user_name || '—')}</td><td class="mono">${esc(a.action)}</td><td class="muted small mono">${esc(String(a.details).slice(0, 120))}</td></tr>`).join('')}</tbody></table></div>`;
  },
};

function userForm(u, redraw) {
  const isNew = !u;
  const m = modal({
    title: isNew ? t('admin.new_user') : u.name,
    content: `<div class="grid-2">
      <label class="field"><span>${esc(t('profile.name'))}</span><input class="input" id="uf-name" value="${esc(u?.name || '')}" required></label>
      <label class="field"><span>${esc(t('auth.login'))}</span><input class="input" id="uf-login" value="${esc(u?.login || '')}" ${isNew ? '' : 'disabled'} placeholder="ivan.petrenko"></label>
      <label class="field"><span>${esc(t('profile.position'))}</span><input class="input" id="uf-pos" value="${esc(u?.position || '')}"></label>
      <label class="field"><span>${esc(t('profile.department'))}</span><input class="input" id="uf-dep" list="dep-list" value="${esc(u?.department || '')}"><datalist id="dep-list"></datalist></label>
      <label class="field"><span>${esc(t('me.manager'))}</span><select class="input" id="uf-mgr"><option value="">${esc(t('admin.mgr_auto'))}</option>${[...S.users.values()].filter((x) => !x.is_bot && x.id !== u?.id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}" ${u?.manager_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>E-mail</span><input class="input" id="uf-email" value="${esc(u?.email || '')}"></label>
      <label class="field"><span>${esc(t('profile.phone'))}</span><input class="input" id="uf-phone" value="${esc(u?.phone || '')}"></label></div>
      <label class="check"><input type="checkbox" id="uf-admin" ${u?.role === 'admin' ? 'checked' : ''}> ${esc(t('admin.is_admin'))}</label>
      ${isNew ? `<p class="muted small">${esc(t('admin.pw_auto'))}</p>` : `<label class="check"><input type="checkbox" id="uf-active" ${u.active ? 'checked' : ''}> ${esc(t('admin.active'))}</label>`}
      <div class="modal-actions">${isNew ? '' : `<button class="btn soft" data-a="reset">${icon('key', 16)} ${esc(t('admin.reset_pw'))}</button><span class="grow"></span>`}
        <button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(isNew ? t('common.create') : t('common.save'))}</button></div>`,
  });
  const b = m.body;
  const val = (id) => b.querySelector(id).value;
  get('/api/org').then((o) => { const dl = b.querySelector('#dep-list'); if (dl) dl.innerHTML = o.departments.map((d) => `<option value="${esc(d.name)}">`).join(''); }).catch(() => {});
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=reset]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('admin.reset_q', { name: u.name })))) return;
    const r = await post(`/api/admin/users/${u.id}/reset-password`);
    credentialsBox(r.login, r.password);
  });
  b.querySelector('[data-a=yes]').onclick = async () => {
    const body = { name: val('#uf-name'), position: val('#uf-pos'), department: val('#uf-dep'), email: val('#uf-email'), phone: val('#uf-phone'), role: b.querySelector('#uf-admin').checked ? 'admin' : 'member', manager_id: Number(val('#uf-mgr')) || null };
    try {
      if (isNew) {
        const r = await post('/api/admin/users', { ...body, login: val('#uf-login') });
        m.close();
        credentialsBox(r.login, r.password);
      } else {
        if (u.id === S.me.id && body.role !== 'admin') { toast(t('admin.self_admin'), { type: 'error' }); return; }
        await patch(`/api/admin/users/${u.id}`, { ...body, active: b.querySelector('#uf-active').checked });
        m.close();
      }
      redraw();
    } catch (e) { toast(errText(e), { type: 'error' }); }
  };
}
