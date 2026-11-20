// Встроенная инструкция: разделы с поиском. Тексты — в help-content.js на всех языках интерфейса.
import { t, getLang } from './i18n.js';
import { esc, md } from './util.js';
import { icon } from './icons.js';
import { modal } from './dialogs.js';
import HELP from './help-content.js';

export function openHelp(sectionId = null) {
  const sections = HELP[getLang()] || HELP.en;
  const m = modal({ title: t('side.help'), wide: true, cls: 'help-modal', content: '' });
  const draw = (id, q = '') => {
    const ql = q.trim().toLowerCase();
    const list = ql ? sections.filter((s) => `${s.title} ${s.body}`.toLowerCase().includes(ql)) : sections;
    const cur = list.find((s) => s.id === id) || list[0];
    m.body.innerHTML = `<div class="help">
      <nav class="help-nav"><div class="search-box">${icon('search', 16)}<input id="help-q" placeholder="${esc(t('help.search'))}" value="${esc(q)}"></div>
        ${list.map((s) => `<button class="${cur && s.id === cur.id ? 'on' : ''}" data-h="${s.id}">${icon(s.icon, 18)}<span>${esc(s.title)}</span></button>`).join('') || `<p class="muted small">${esc(t('search.nothing'))}</p>`}</nav>
      <article class="help-body">${cur ? `<h2>${icon(cur.icon, 22)} ${esc(cur.title)}</h2><div class="text">${md(cur.body)}</div>` : ''}</article></div>`;
    const inp = m.body.querySelector('#help-q');
    inp.oninput = () => { const pos = inp.selectionStart; draw(cur?.id, inp.value); const n = m.body.querySelector('#help-q'); n.focus(); n.setSelectionRange(pos, pos); };
    m.body.querySelectorAll('[data-h]').forEach((b) => { b.onclick = () => draw(b.dataset.h, q); });
  };
  draw(sectionId);
}
