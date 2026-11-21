'use strict';
// База Gobsek Chat — встроенный SQLite из Node 22 (node:sqlite), без внешних зависимостей.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'chat.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',   -- available | busy | dnd | away | vacation | remote
  status_text TEXT NOT NULL DEFAULT '',
  avatar_file INTEGER,
  color INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  is_bot INTEGER NOT NULL DEFAULT 0,
  pass_hash TEXT NOT NULL DEFAULT '',
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  gobsek_id TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_fails (key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_fails_key ON login_fails(key, ts);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',          -- width/height, duration, waveform
  created_at INTEGER NOT NULL
);

-- Чаты: личный (direct), группа (group), канал (channel), «Избранное» (saved), ИИ-помощник (ai)
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('direct','group','channel','saved','ai')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  avatar_file INTEGER,
  color INTEGER NOT NULL DEFAULT 0,
  direct_key TEXT UNIQUE,                   -- "minId:maxId" для личных чатов, "saved:id", "ai:id"
  invite_code TEXT UNIQUE,
  is_public INTEGER NOT NULL DEFAULT 0,     -- видна в каталоге, вступить может любой сотрудник
  only_admins_post INTEGER NOT NULL DEFAULT 0,
  pinned_msg_id INTEGER,
  last_msg_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  manual_unread INTEGER NOT NULL DEFAULT 0,
  draft TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'text',          -- text|file|image|video|voice|poll|system|call|task|approval|kudos|meeting
  thread_id INTEGER,                         -- ответ в ветке: id корневого сообщения
  body TEXT NOT NULL DEFAULT '',
  file_id INTEGER REFERENCES files(id),
  reply_to INTEGER,
  fwd_user_id INTEGER,
  fwd_name TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  silent INTEGER NOT NULL DEFAULT 0,
  edited_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option)
);

-- Отложенные сообщения и напоминания («напомнить об этом сообщении»)
CREATE TABLE IF NOT EXISTS scheduled (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('message','reminder')),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id INTEGER,
  body TEXT NOT NULL DEFAULT '',
  reply_to INTEGER,
  run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_run ON scheduled(run_at);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  started_by INTEGER NOT NULL REFERENCES users(id),
  media TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER,
  max_participants INTEGER NOT NULL DEFAULT 1,
  message_id INTEGER
);

-- Входящие вебхуки: Gobsek и другие системы пишут в чат от имени бота
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  bot_user_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_used INTEGER
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  department TEXT NOT NULL DEFAULT '',
  uses_left INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Задачи из сообщений
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
  message_id INTEGER,                        -- карточка задачи в чате
  source_msg_id INTEGER,                     -- сообщение, из которого сделана задача
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'todo',       -- todo | doing | review | done | cancelled
  priority TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high | urgent
  due_at INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_creator ON tasks(creator_id, status);

-- «Ознакомлен» для обязательных объявлений
CREATE TABLE IF NOT EXISTS message_acks (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Встречи (нарады) с приглашениями
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id INTEGER,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  created_by INTEGER NOT NULL REFERENCES users(id),
  reminded INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meetings_time ON meetings(starts_at);
CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp TEXT NOT NULL DEFAULT 'pending',      -- pending | yes | no | maybe
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`);

// ---------- Миграции существующих баз ----------
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
(function migrate() {
  // v1 → v2: у messages был CHECK на kind (новые типы карточек не вставлялись) и не было thread_id.
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get()?.sql || '';
  if (sql.includes('CHECK (kind IN')) {
    db.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
    db.exec('BEGIN');
    try {
      db.exec(`ALTER TABLE messages RENAME TO messages_v1;
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id),
          kind TEXT NOT NULL DEFAULT 'text', thread_id INTEGER, body TEXT NOT NULL DEFAULT '', file_id INTEGER REFERENCES files(id),
          reply_to INTEGER, fwd_user_id INTEGER, fwd_name TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}',
          silent INTEGER NOT NULL DEFAULT 0, edited_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
        INSERT INTO messages (id, chat_id, user_id, kind, body, file_id, reply_to, fwd_user_id, fwd_name, meta, silent, edited_at, deleted, created_at)
          SELECT id, chat_id, user_id, kind, body, file_id, reply_to, fwd_user_id, fwd_name, meta, silent, edited_at, deleted, created_at FROM messages_v1;
        DROP TABLE messages_v1;
        CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF body ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
          INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END;`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally {
      db.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
    }
  }
  if (!hasColumn('users', 'birthday')) db.exec("ALTER TABLE users ADD COLUMN birthday TEXT NOT NULL DEFAULT ''"); // ММ-ДД
  db.exec('CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL');
})();

function logEvent(userId, action, details = '') {
  db.prepare('INSERT INTO audit (user_id, action, details, created_at) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, action, typeof details === 'string' ? details : JSON.stringify(details), Date.now());
}

/** Выполнить функцию в транзакции (node:sqlite не даёт готового помощника). */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, logEvent, hasColumn, DATA_DIR, UPLOAD_DIR };
