'use strict';
// Демо-режим: заполняет пустую базу сотрудниками, группами, каналом и перепиской, затем запускает сервер.
// Запуск: npm run demo  (данные — в data-demo/, вход: admin / demo1234, у всех остальных пароль тот же).
const path = require('node:path');

process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-demo');
const { db } = require('./db');
const auth = require('./auth');
const chats = require('./chats');
const extras = require('./extras');

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

  // Прочитано всё, кроме пары последних — чтобы были непрочитанные.
  db.prepare('UPDATE chat_members SET last_read_id = (SELECT COALESCE(MAX(id), 0) FROM messages WHERE chat_id = chat_members.chat_id)').run();
  db.prepare('UPDATE chat_members SET last_read_id = last_read_id - 2 WHERE user_id = ? AND chat_id IN (?, ?)').run(admin.id, fin.id, dm2.id);
  chats.ensureAi(admin.id);
  console.log(`Демо-данные созданы. Вход: admin / ${PASSWORD} (у всех сотрудников тот же пароль: olena, ivan, maria, dmytro, anna, serhii, natalia, andrii, yulia).`);
  return true;
}

seed();
require('./index').server.listen(Number(process.env.PORT) || 3000, () => {
  console.log(`Gobsek Chat (демо) — http://localhost:${Number(process.env.PORT) || 3000}`);
});
