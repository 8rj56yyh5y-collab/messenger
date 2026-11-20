// Локализация: t('ключ', { параметры }). Значение может быть строкой или объектом форм множественного числа
// { one, few, many, other } — форма выбирается через Intl.PluralRules по параметру n.
import uk from './locales/uk.js';
import ru from './locales/ru.js';
import en from './locales/en.js';
import de from './locales/de.js';
import pl from './locales/pl.js';

export const LANGS = [
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'ru', name: 'Русский', flag: '🌐' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
];
const DICT = { uk, ru, en, de, pl };
const LOCALE = { uk: 'uk-UA', ru: 'ru-RU', en: 'en-GB', de: 'de-DE', pl: 'pl-PL' };

let lang = 'uk';
let plural = new Intl.PluralRules(LOCALE[lang]);

export function detectLang() {
  let saved = null;
  try { saved = localStorage.getItem('gc-lang'); } catch { /* приватный режим */ }
  if (saved && DICT[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || '']) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (DICT[c]) return c;
  }
  return 'uk';
}

export function setLang(l) {
  lang = DICT[l] ? l : 'uk';
  plural = new Intl.PluralRules(LOCALE[lang]);
  document.documentElement.lang = lang;
  try { localStorage.setItem('gc-lang', lang); } catch { /* ignore */ }
}
export const getLang = () => lang;
export const locale = () => LOCALE[lang];

export function t(key, params = {}) {
  let v = DICT[lang][key] ?? DICT.en[key] ?? DICT.ru[key] ?? key;
  if (v && typeof v === 'object') {
    const form = plural.select(Number(params.n) || 0);
    v = v[form] ?? v.other ?? v.many ?? '';
  }
  return String(v).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/** Перевести код ошибки сервера, иначе показать его текст. */
export function errText(e) {
  if (e && e.code && DICT.en[`err.${e.code}`]) return t(`err.${e.code}`);
  return (e && e.message) || t('err.generic');
}
