'use strict';
// Демо-режим: заполняет пустую базу сотрудниками, группами, каналом и перепиской, затем запускает сервер.
// Запуск: npm run demo  (данные — в data-demo/, вход: admin / demo1234, у всех остальных пароль тот же).
const path = require('node:path');

process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-demo');
const { db } = require('./db');
const auth = require('./auth');
const chats = require('./chats');
const extras = require('./extras');
const work = require('./work');
const org = require('./org');

const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const fake = { headers: {}, socket: {} };

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n > 0) return false;
  const { user: admin } = extras.setup({ login: 'admin', name: 'Олександр Коваль', position: 'Директор', password: PASSWORD, company: 'Gobsek', lang: 'uk' }, fake);
  db.prepare("UPDATE users SET department = 'Керівництво', status_text = 'На звʼязку до 19:00' WHERE id = ?").run(admin.id);
  const people = [
    ['olena', 'Олена Шевченко', 'Фінансовий директор', 'Фінанси'],
    ['ivan', 'Іван Петренко', 'Головний бухгалтер', 'Бухгалтерія'],
    ['maria', 'Марія Бондаренко', 'Бухгалтер', 'Бухгалтерія'],
    ['dmytro', 'Дмитро Мельник', 'Керівник відділу продажів', 'Продажі'],
    ['anna', 'Анна Ткаченко', 'Менеджер з продажу', 'Продажі'],
    ['serhii', 'Сергій Кравченко', 'Начальник цеху БХ', 'Виробництво'],
    ['natalia', 'Наталія Лисенко', 'HR-менеджер', 'Кадри'],
    ['andrii', 'Андрій Савченко', 'Логіст', 'Логістика'],
    ['yulia', 'Юлія Руденко', 'Юрист', 'Юридичний відділ'],
  ];
  const ids = {};
  for (const [login, name, position, department] of people) {
    const r = db.prepare(`INSERT INTO users (login, name, position, department, role, pass_hash, color, lang, created_at, last_seen)
      VALUES (?, ?, ?, ?, 'member', ?, ?, 'uk', ?, ?)`).run(login, name, position, department, auth.hashPassword(PASSWORD),
      Object.keys(ids).length % 8, Date.now(), Date.now() - Math.floor(Math.random() * 5 * 3600e3));
    ids[login] = Number(r.lastInsertRowid);
    extras.autoJoinDefault(ids[login]);
  }
  db.prepare("UPDATE users SET status = 'remote' WHERE id = ?").run(ids.olena);
  db.prepare("UPDATE users SET status = 'busy', status_text = 'Нарада до 12:00' WHERE id = ?").run(ids.dmytro);
  db.prepare("UPDATE users SET status = 'vacation' WHERE id = ?").run(ids.yulia);

  // Сообщения с «прошедшим» временем: двигаем created_at назад после вставки.
  let clock = Date.now() - 26 * 3600e3;
  const say = (uid, chatId, body, extra = {}) => {
    clock += (2 + Math.random() * 20) * 60e3;
    const m = chats.postMessage(uid, chatId, { body, ...extra });
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(clock, m.id);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(clock, chatId);
    return m;
  };
  // Служебные «создан чат» — тоже в прошлое, иначе они окажутся «сегодня» над вчерашней перепиской.
  const backdate = (chatId) => db.prepare("UPDATE messages SET created_at = ? WHERE chat_id = ? AND kind = 'system'").run(clock - 3600e3, chatId);
  const channels = db.prepare("SELECT id, type FROM chats WHERE type IN ('channel','group') ORDER BY id").all();
  const news = channels.find((c) => c.type === 'channel').id;
  const general = channels.find((c) => c.type === 'group').id;
  channels.forEach((c) => backdate(c.id));
  say(admin.id, news, '**Вітаємо в Gobsek Chat!** 🎉\nТепер уся робоча переписка, дзвінки й наради — тут. Інструкція — у меню ☰ → «Інструкція».');
  say(admin.id, news, 'З понеділка звіти по ЦФО здаємо до 10:00. Шаблон — у Gobsek, розділ «Бюджетування».');
  say(ids.natalia, general, 'Колеги, нагадую: у пʼятницю корпоративний обід о 13:00 🍕');
  say(ids.ivan, general, 'Дякую! Буду 👍');
  say(ids.serhii, general, 'Цех теж буде, але після 13:30 — завершуємо зміну.');

  const fin = chats.createChat(ids.olena, { type: 'group', title: 'Фінанси · щоденні платежі', description: 'Платіжний календар, погодження, виписки', members: [admin.id, ids.ivan, ids.maria] });
  backdate(fin.id);
  say(ids.olena, fin.id, 'Доброго ранку! На сьогодні в календарі 14 платежів на 1,2 млн ₴. Прошу погодити до 11:00.');
  say(ids.ivan, fin.id, 'Виписки ОТП і ПУМБ вже імпортовані, розбіжностей немає ✅');
  const q = say(ids.maria, fin.id, '@olena оренда складу — платимо з рахунку Ощаду чи з Райффайзену?');
  say(ids.olena, fin.id, 'З Ощаду, там залишок більший.', { reply_to: q.id });
  chats.sendPoll(ids.olena, fin.id, { question: 'Коли зручно провести нараду з бюджету на грудень?', options: ['Вівторок 10:00', 'Середа 14:00', 'Четвер 11:00'], anonymous: false });

  const sales = chats.createChat(ids.dmytro, { type: 'group', title: 'Відділ продажів', is_public: true, members: [ids.anna, ids.andrii, admin.id] });
  backdate(sales.id);
  say(ids.dmytro, sales.id, 'План на тиждень: закрити угоду з «Металтрейд» і відвантажити 40 т брухту на Запоріжжя.');
  say(ids.anna, sales.id, 'Договір з «Металтрейд» у юриста, обіцяли завтра.');
  say(ids.andrii, sales.id, 'Машини на четвер замовив 🚛');
  say(ids.dmytro, sales.id, 'Супер, дякую! **Анно**, підготуй рахунок, як тільки буде підпис.');

  const dm = chats.getOrCreateDirect(admin.id, ids.olena);
  say(ids.olena, dm.id, 'Олександре, підготувала звіт по капіталовкладеннях за жовтень. Скинути сюди чи в Gobsek?');
  say(admin.id, dm.id, 'Давай сюди, глянемо разом о 15:00 голосом.');
  say(ids.olena, dm.id, 'Добре, зателефоную 📞');
  const dm2 = chats.getOrCreateDirect(admin.id, ids.serhii);
  say(ids.serhii, dm2.id, 'Екструдер на лінії 2 знову зупинився, викликав сервіс.');
  say(admin.id, dm2.id, 'Тримай в курсі. Якщо до вечора не запустять — переводимо замовлення на лінію 1.');
  say(ids.serhii, dm2.id, 'Зрозумів 👌');

  // ----- Оргструктура: подразделения с руководителями и ЦФО -----
  const mk = (name, head, cfo, parent, chat = false) => org.createDepartment(admin, { name, head_id: head, cfo, parent_id: parent, create_chat: chat });
  const dTop = mk('Керівництво', admin.id, 'ЦФО-01', null);
  const dFin = mk('Фінанси', ids.olena, 'ЦФО-02', dTop.id);
  mk('Бухгалтерія', ids.ivan, 'ЦФО-03', dFin.id, true);
  const dSales = mk('Продажі', ids.dmytro, 'ЦФО-04', dTop.id);
  mk('Логістика', ids.andrii, 'ЦФО-06', dSales.id);
  mk('Виробництво', ids.serhii, 'ЦФО-05', dTop.id, true);
  mk('Кадри', ids.natalia, 'ЦФО-08', dTop.id);
  mk('Юридичний відділ', ids.yulia, 'ЦФО-09', dTop.id);
  db.prepare('UPDATE users SET manager_id = ? WHERE id IN (?, ?, ?, ?, ?)').run(admin.id, ids.olena, ids.dmytro, ids.serhii, ids.natalia, ids.yulia);
  db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(ids.olena, ids.ivan);

  // ----- Рабочие инструменты: задачи, погодження, подяки, встречи, ознакомление, ветки, дни рождения -----
  const day = 86400e3;
  const mmdd = (offset) => { const d = new Date(Date.now() + offset * day); return `1990-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(mmdd(0), ids.natalia);
  db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(mmdd(3), ids.dmytro);
  db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run('1988-03-14', admin.id);
  db.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(Date.now() - 3 * day, ids.yulia, ids.andrii);

  work.createTask(ids.olena, { chat_id: fin.id, title: 'Звірити сальдо з 1С за жовтень', description: 'ОТП, ПУМБ, Ощад — розбіжності скинути в гілку', assignee_id: ids.ivan, due_at: Date.now() + 5 * 3600e3, priority: 'high' });
  const t2 = work.createTask(admin.id, { chat_id: fin.id, title: 'Підготувати бюджет ЦФО «Виробництво» на грудень', assignee_id: ids.olena, due_at: Date.now() + 2 * day, priority: 'normal' });
  work.createTask(admin.id, { title: 'Погодити договір з «Металтрейд»', assignee_id: admin.id, due_at: Date.now() - 2 * 3600e3, priority: 'urgent' });
  work.createTask(ids.dmytro, { chat_id: sales.id, title: 'Виставити рахунок «Металтрейд» на 40 т', assignee_id: ids.anna, due_at: Date.now() + day, priority: 'high' });
  work.createTask(ids.serhii, { title: 'Замовити ножі для дробарки', assignee_id: admin.id, due_at: Date.now() + 4 * day, priority: 'low' });
  const t6 = work.createTask(admin.id, { chat_id: sales.id, title: 'Звіт по відвантаженнях за тиждень', assignee_id: ids.dmytro, priority: 'normal' });
  work.updateTask(ids.olena, t2.id, { status: 'doing' });
  work.updateTask(ids.dmytro, t6.id, { status: 'review' });
  const t7 = work.createTask(admin.id, { title: 'Оновити регламент інкасації', assignee_id: admin.id, priority: 'normal' });
  work.updateTask(admin.id, t7.id, { status: 'done' });

  work.createApproval(ids.olena, fin.id, { title: 'Оплата оренди складу за грудень', amount: 45000, currency: 'UAH', description: 'ТОВ «Логістик-Парк», договір №14/2026, ЦФО «Склад»', approvers: [admin.id, ids.ivan] });
  const ap2 = work.createApproval(ids.dmytro, sales.id, { title: 'Знижка 3% для «Металтрейд»', amount: 18600, description: 'Обсяг 40 т, постійний клієнт', approvers: [admin.id] });
  work.decide(admin.id, ap2.id, { decision: 'approve', comment: 'Ок, але тільки на цю партію' });

  work.giveKudos(ids.olena, general, { to: [ids.ivan, ids.maria], badge: 'speed', text: 'Дякую, що закрили місяць на 2 дні раніше! 🚀' });
  work.giveKudos(ids.dmytro, general, { to: [ids.andrii], badge: 'help', text: 'Андрію, дякую за машини у пʼятницю ввечері' });
  work.giveKudos(admin.id, general, { to: [ids.serhii], badge: 'quality', text: 'Лінія 2 знову працює — без браку. Респект цеху!' });

  const soon = new Date(Date.now() + 40 * 60e3); soon.setMinutes(soon.getMinutes() < 30 ? 30 : 0, 0, 0); if (soon < Date.now() + 15 * 60e3) soon.setTime(soon.getTime() + 30 * 60e3);
  work.createMeeting(admin.id, fin.id, { title: 'Бюджет на грудень', starts_at: soon.getTime(), duration_min: 45, description: '1. Підсумки жовтня\n2. Ліміти ЦФО\n3. Платіжний календар' });
  // Уже прошедшая планёрка с обсуждением в ветке — на ней можно попробовать «Протокол»
  const past = work.createMeeting(admin.id, fin.id, { title: 'Ранкова планірка фінансів', starts_at: Date.now() + 60e3, duration_min: 30, description: '1. Залишки на рахунках\n2. Платежі дня\n3. Звірка з 1С' });
  db.prepare('UPDATE meetings SET starts_at = ?, reminded = 1 WHERE id = ?').run(Date.now() - 2 * 3600e3, past.id);
  chats.sendMessage(ids.olena, fin.id, { body: 'Залишок на ПУМБ 1,8 млн, на Ощаді 640 тис. Оренду платимо з Ощаду.', thread_id: past.message_id });
  chats.sendMessage(ids.ivan, fin.id, { body: 'Звірку з 1С зроблю до 15:00, розбіжність лише по ПУМБ.', thread_id: past.message_id });
  chats.sendMessage(admin.id, fin.id, { body: 'Добре. Маріє, підготуй до четверга реєстр платежів на наступний тиждень.', thread_id: past.message_id });
  const tmr = new Date(Date.now() + day); tmr.setHours(10, 0, 0, 0);
  work.createMeeting(ids.dmytro, sales.id, { title: 'Планірка відділу продажів', starts_at: tmr.getTime(), duration_min: 30 });
  const fri = new Date(Date.now() + 2 * day); fri.setHours(15, 0, 0, 0);
  work.createMeeting(admin.id, general, { title: 'Загальні збори компанії', starts_at: fri.getTime(), duration_min: 60 });

  const reg = chats.sendMessage(admin.id, news, { body: '📌 **Новий регламент платежів** з 1 грудня: заявки на оплату — лише через Gobsek, до 12:00 дня оплати. Прохання ознайомитися.', ack_required: true });
  chats.ack(ids.olena, reg.id);
  chats.ack(ids.ivan, reg.id);
  const root = chats.sendMessage(ids.ivan, fin.id, { body: 'Колеги, по виписці ПУМБ є платіж 12 400 ₴ без призначення. Хто знає, що це?' });
  chats.sendMessage(ids.maria, fin.id, { body: 'Це повернення від «Вторметресурс», акт у мене', thread_id: root.id });
  chats.sendMessage(ids.olena, fin.id, { body: 'Дякую, Маріє! Ivan, проведи як повернення.', thread_id: root.id });

  // Прочитано всё, кроме пары последних — чтобы были непрочитанные.
  db.prepare('UPDATE chat_members SET last_read_id = (SELECT COALESCE(MAX(id), 0) FROM messages WHERE chat_id = chat_members.chat_id)').run();
  db.prepare('UPDATE chat_members SET last_read_id = last_read_id - 2 WHERE user_id = ? AND chat_id IN (?, ?)').run(admin.id, fin.id, dm2.id);
  chats.ensureAi(admin.id);
  // Налаштування компанії, власний значок і кілька подяк — щоб сторінка «Нагороди» була живою
  require('./workspace').update(admin, {
    company: 'ТОВ «Гобсек»', welcome: 'Робочий мессенджер компанії. Вхід — тим самим логіном, що й у Gobsek.',
    announcement: { text: 'У пʼятницю о 16:00 — загальні збори в залі №2 і онлайн. Підсумки кварталу й нагородження 🏆', level: 'info' },
    custom_badges: [{ code: 'c_hero', emoji: '🦸', name: 'Герой кварталу', points: 50 }],
  });
  work.giveKudos(admin.id, general, { to: [ids.olena], badge: 'c_hero', text: 'Олено, бюджет на рік — це було потужно!' });
  work.giveKudos(ids.maria, general, { to: [ids.olena], badge: 'mentor', text: 'Дякую за терпіння з новою звітністю' });
  work.giveKudos(ids.ivan, general, { to: [ids.maria], badge: 'teamwork', text: '' });
  const awards = require('./awards');
  for (const id of [admin.id, ...Object.values(ids)]) awards.check(id);
  console.log(`Демо-данные созданы. Вход: admin / ${PASSWORD} (у всех сотрудников тот же пароль: olena, ivan, maria, dmytro, anna, serhii, natalia, andrii, yulia).`);
  return true;
}

seed();
require('./index').server.listen(Number(process.env.PORT) || 3000, () => {
  console.log(`Gobsek Chat (демо) — http://localhost:${Number(process.env.PORT) || 3000}`);
});
