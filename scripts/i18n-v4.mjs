// Переводы: профиль, оргструктура, мобильные разделы (uk, ru, en, de, pl). Запуск: node scripts/i18n-v4.mjs
import fs from 'node:fs';
import path from 'node:path';

const P = (one, few, many, other = few) => ({ one, few, many, other });
const E = (one, other) => ({ one, other });
const T = {
  'nav.me': ['Профіль', 'Профиль', 'Profile', 'Profil', 'Profil'],
  'me.edit': ['Редагувати', 'Изменить', 'Edit', 'Bearbeiten', 'Edytuj'],
  'me.done_month': ['виконано за місяць', 'выполнено за месяц', 'done this month', 'erledigt im Monat', 'wykonane w miesiącu'],
  'me.meetings_week': ['зустрічей за тиждень', 'встреч на неделе', 'meetings this week', 'Termine diese Woche', 'spotkań w tygodniu'],
  'me.kudos_got': ['подяк отримано', 'благодарностей получено', 'kudos received', 'Danke erhalten', 'otrzymanych podziękowań'],
  'me.org': ['Моя структура', 'Моя структура', 'My team structure', 'Meine Struktur', 'Moja struktura'],
  'me.manager': ['Керівник', 'Руководитель', 'Manager', 'Vorgesetzte(r)', 'Przełożony'],
  'me.team': [P('Команда: {n} людина', 'Команда: {n} людини', 'Команда: {n} людей'), P('Команда: {n} человек', 'Команда: {n} человека', 'Команда: {n} человек'), E('Team: {n} person', 'Team: {n} people'), E('Team: {n} Person', 'Team: {n} Personen'), P('Zespół: {n} osoba', 'Zespół: {n} osoby', 'Zespół: {n} osób')],
  'me.no_org': ['Підрозділ і керівника призначає адміністратор', 'Подразделение и руководителя назначает администратор', 'The administrator assigns your department and manager', 'Abteilung und Vorgesetzte legt der Administrator fest', 'Dział i przełożonego przypisuje administrator'],
  'me.since': ['У команді з {date}', 'В команде с {date}', 'On the team since {date}', 'Im Team seit {date}', 'W zespole od {date}'],
  'me.badges': ['Мої значки', 'Мои значки', 'My badges', 'Meine Abzeichen', 'Moje odznaki'],
  'me.quick': ['Швидкий доступ', 'Быстрый доступ', 'Quick access', 'Schnellzugriff', 'Szybki dostęp'],
  'profile.change_photo': ['Змінити фото', 'Изменить фото', 'Change photo', 'Foto ändern', 'Zmień zdjęcie'],
  'people.list': ['Список', 'Список', 'List', 'Liste', 'Lista'],
  'people.org': ['Структура', 'Структура', 'Structure', 'Struktur', 'Struktura'],
  'people.head': ['Керівник', 'Руководитель', 'Head', 'Leitung', 'Kierownik'],
  'people.n_people': [P('{n} людина', '{n} людини', '{n} людей'), P('{n} человек', '{n} человека', '{n} человек'), E('{n} person', '{n} people'), E('{n} Person', '{n} Personen'), P('{n} osoba', '{n} osoby', '{n} osób')],
  'people.dept_chat': ['Чат підрозділу', 'Чат подразделения', 'Department chat', 'Abteilungs-Chat', 'Czat działu'],
  'people.org_sub': [P('{n} підрозділ', '{n} підрозділи', '{n} підрозділів'), P('{n} подразделение', '{n} подразделения', '{n} подразделений'), E('{n} department', '{n} departments'), E('{n} Abteilung', '{n} Abteilungen'), P('{n} dział', '{n} działy', '{n} działów')],
  'people.manage': ['Керувати', 'Управлять', 'Manage', 'Verwalten', 'Zarządzaj'],
  'people.org_empty': ['Підрозділів ще немає — адміністратор може створити їх в «Адмініструванні»', 'Подразделений пока нет — администратор может создать их в «Администрировании»', 'No departments yet — an administrator can create them in Administration', 'Noch keine Abteilungen — ein Administrator kann sie anlegen', 'Brak działów — administrator może je utworzyć w Administracji'],
  'admin.depts': ['Підрозділи', 'Подразделения', 'Departments', 'Abteilungen', 'Działy'],
  'admin.mgr_auto': ['Керівник підрозділу (автоматично)', 'Руководитель подразделения (автоматически)', 'Department head (automatic)', 'Abteilungsleitung (automatisch)', 'Kierownik działu (automatycznie)'],
  'dept.hint': ['Підрозділи як у Gobsek: керівник, код ЦФО й вищий підрозділ. Співробітники з такою ж назвою підрозділу автоматично потрапляють у його чат.', 'Подразделения как в Gobsek: руководитель, код ЦФО и вышестоящее подразделение. Сотрудники с таким же названием подразделения автоматически попадают в его чат.', 'Departments as in Gobsek: head, cost-centre code and parent. Employees with the same department name join its chat automatically.', 'Abteilungen wie in Gobsek: Leitung, Kostenstelle und übergeordnete Abteilung. Mitarbeitende mit gleichem Abteilungsnamen kommen automatisch in deren Chat.', 'Działy jak w Gobsek: kierownik, kod MPK i dział nadrzędny. Pracownicy z tą samą nazwą działu automatycznie trafiają do jego czatu.'],
  'dept.new': ['Новий підрозділ', 'Новое подразделение', 'New department', 'Neue Abteilung', 'Nowy dział'],
  'dept.name': ['Назва', 'Название', 'Name', 'Name', 'Nazwa'],
  'dept.cfo': ['Код ЦФО', 'Код ЦФО', 'Cost centre code', 'Kostenstelle', 'Kod MPK'],
  'dept.parent': ['Підпорядковується', 'Подчиняется', 'Reports to', 'Untergeordnet', 'Podlega'],
  'dept.not_created': ['Є в профілях співробітників, але не налаштований', 'Есть в профилях сотрудников, но не настроено', 'Used in profiles but not set up', 'In Profilen verwendet, aber nicht eingerichtet', 'Używany w profilach, ale nieskonfigurowany'],
  'dept.with_chat': ['Створити чат підрозділу', 'Создать чат подразделения', 'Create a department chat', 'Abteilungs-Chat erstellen', 'Utwórz czat działu'],
  'dept.del_q': ['Видалити підрозділ «{name}»? Співробітники й чат залишаться.', 'Удалить подразделение «{name}»? Сотрудники и чат останутся.', 'Delete department "{name}"? Employees and the chat stay.', 'Abteilung „{name}“ löschen? Mitarbeitende und Chat bleiben.', 'Usunąć dział „{name}”? Pracownicy i czat pozostaną.'],
  'tasks.empty_tab': ['Тут порожньо', 'Здесь пусто', 'Nothing here', 'Hier ist nichts', 'Pusto'],
  'cal.day_empty': ['У цей день зустрічей немає', 'В этот день встреч нет', 'No meetings on this day', 'Keine Termine an diesem Tag', 'Brak spotkań tego dnia'],
  'err.dept_exists': ['Такий підрозділ уже є', 'Такое подразделение уже есть', 'This department already exists', 'Diese Abteilung gibt es bereits', 'Taki dział już istnieje'],
};
const LANGS = ['uk', 'ru', 'en', 'de', 'pl'];
for (const [i, lang] of LANGS.entries()) {
  const file = path.resolve('public/js/locales', `${lang}.js`);
  let src = fs.readFileSync(file, 'utf8');
  const lines = Object.entries(T).filter(([k]) => !src.includes(`'${k}':`)).map(([k, v]) => `  '${k}': ${JSON.stringify(v[i])},`);
  if (!lines.length) continue;
  src = src.replace(/\n};\s*$/, `\n  // --- профиль и оргструктура ---\n${lines.join('\n')}\n};\n`);
  fs.writeFileSync(file, src);
  console.log(lang, '+', lines.length);
}
