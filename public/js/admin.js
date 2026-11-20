// Администрирование: сотрудники, приглашения, статистика, журнал действий.
import { S } from './store.js';
import { t, errText } from './i18n.js';
import { esc, avatar, fmtDateTime, copyText } from './util.js';
import { icon } from './icons.js';
import { get, post, patch, del } from './api.js';
import { modal, toast, confirmDialog } from './dialogs.js';

const TABS = [['stats', 'chart'], ['users', 'users'], ['invites', 'link'], ['audit', 'list']];

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
      <label class="field"><span>${esc(t('profile.department'))}</span><input class="input" id="uf-dep" value="${esc(u?.department || '')}"></label>
      <label class="field"><span>E-mail</span><input class="input" id="uf-email" value="${esc(u?.email || '')}"></label>
      <label class="field"><span>${esc(t('profile.phone'))}</span><input class="input" id="uf-phone" value="${esc(u?.phone || '')}"></label></div>
      <label class="check"><input type="checkbox" id="uf-admin" ${u?.role === 'admin' ? 'checked' : ''}> ${esc(t('admin.is_admin'))}</label>
      ${isNew ? `<p class="muted small">${esc(t('admin.pw_auto'))}</p>` : `<label class="check"><input type="checkbox" id="uf-active" ${u.active ? 'checked' : ''}> ${esc(t('admin.active'))}</label>`}
      <div class="modal-actions">${isNew ? '' : `<button class="btn soft" data-a="reset">${icon('key', 16)} ${esc(t('admin.reset_pw'))}</button><span class="grow"></span>`}
        <button class="btn soft" data-a="no">${esc(t('common.cancel'))}</button><button class="btn" data-a="yes">${esc(isNew ? t('common.create') : t('common.save'))}</button></div>`,
  });
  const b = m.body;
  const val = (id) => b.querySelector(id).value;
  b.querySelector('[data-a=no]').onclick = () => m.close();
  b.querySelector('[data-a=reset]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('admin.reset_q', { name: u.name })))) return;
    const r = await post(`/api/admin/users/${u.id}/reset-password`);
    credentialsBox(r.login, r.password);
  });
  b.querySelector('[data-a=yes]').onclick = async () => {
    const body = { name: val('#uf-name'), position: val('#uf-pos'), department: val('#uf-dep'), email: val('#uf-email'), phone: val('#uf-phone'), role: b.querySelector('#uf-admin').checked ? 'admin' : 'member' };
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
