'use strict';
// Вход, сессии, пароли, приглашения и вход через Gobsek (SSO).
// Пароли — scrypt с солью; в базе хранится только хеш токена сессии.
const crypto = require('node:crypto');
const { db, logEvent } = require('./db');
const { HttpError } = require('./util');

const COOKIE = 'gc_sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
/** Код ошибки пароля (переводится на клиенте) или null. */
function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'pw_short';
  if (!/\d/.test(s) || !/\p{L}/u.test(s)) return 'pw_weak';
  return null;
}
function randomPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const dig = '23456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += abc[crypto.randomInt(abc.length)];
  for (let i = 0; i < 3; i++) s += dig[crypto.randomInt(dig.length)];
  return s;
}

function parseCookies(header = '') {
  const out = {};
  String(header).split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битая cookie */ }
    }
  });
  return out;
}
function sessionCookie(token, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  // Lax, а не Strict: иначе переход по ссылке из Gobsek (SSO) приходил бы без cookie.
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket?.remoteAddress || '';
}

function createSession(userId, req) {
  const token = randomToken();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha(token), userId, now, now + SESSION_DAYS * 86400e3, now, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return token;
}

/** Пользователь по cookie запроса (или null). Продлевает «последнее использование». */
function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const h = sha(token);
  const row = db.prepare(`SELECT u.*, s.token_hash AS sid FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(h, Date.now());
  if (!row) return null;
  const now = Date.now();
  db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ? AND last_used < ?').run(now, h, now - 60e3);
  return row;
}

function tooManyFails(key) {
  const since = Date.now() - FAIL_WINDOW;
  db.prepare('DELETE FROM login_fails WHERE ts < ?').run(since);
  return db.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND ts >= ?').get(key, since).n >= MAX_FAILS;
}

function login(loginName, password, req) {
  const l = String(loginName || '').trim().toLowerCase();
  const key = `${l}|${clientIp(req)}`;
  if (tooManyFails(key)) throw new HttpError(429, 'Слишком много попыток. Подождите 15 минут.', 'too_many');
  const u = db.prepare('SELECT * FROM users WHERE login = ? AND is_bot = 0').get(l);
  if (!u || !u.active || !verifyPassword(password, u.pass_hash)) {
    db.prepare('INSERT INTO login_fails (key, ts) VALUES (?, ?)').run(key, Date.now());
    throw new HttpError(401, 'Неверный логин или пароль', 'bad_login');
  }
  db.prepare('DELETE FROM login_fails WHERE key = ?').run(key);
  logEvent(u.id, 'login', clientIp(req));
  return { user: u, token: createSession(u.id, req) };
}

function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

// ---------- Вход через Gobsek ----------
// Gobsek выдаёт короткоживущий JWT (HS256), подписанный общим секретом GOBSEK_SSO_SECRET,
// и открывает /sso/gobsek?token=… . Секрет отдельный от основного JWT Gobsek:
// утечка секрета мессенджера не даёт входа в саму систему управления.
const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function verifyJwtHS256(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Некорректный токен входа', 'sso_bad');
  let header;
  let payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new HttpError(401, 'Некорректный токен входа', 'sso_bad');
  }
  if (header.alg !== 'HS256') throw new HttpError(401, 'Неподдерживаемый алгоритм', 'sso_bad');
  const expect = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) throw new HttpError(401, 'Подпись не совпадает', 'sso_bad');
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new HttpError(401, 'Ссылка входа устарела', 'sso_expired');
  if (payload.exp - now > 600) throw new HttpError(401, 'Слишком долгий срок токена входа', 'sso_bad');
  if (payload.aud !== 'gobsek-chat') throw new HttpError(401, 'Токен выдан не для мессенджера', 'sso_bad');
  if (payload.scope && payload.scope !== 'full') throw new HttpError(401, 'Вход в Gobsek не завершён', 'sso_bad');
  return payload;
}

// Повторное использование одного и того же токена запрещено (защита от пересылки ссылки).
const usedJti = new Map();
function ssoLogin(token, req) {
  const secret = process.env.GOBSEK_SSO_SECRET;
  if (!secret) throw new HttpError(404, 'Вход через Gobsek не настроен', 'sso_off');
  const p = verifyJwtHS256(token, secret);
  const jti = String(p.jti || '');
  if (!jti) throw new HttpError(401, 'В токене нет jti', 'sso_bad');
  const now = Date.now();
  for (const [k, exp] of usedJti) if (exp < now) usedJti.delete(k);
  if (usedJti.has(jti)) throw new HttpError(401, 'Ссылка входа уже использована', 'sso_used');
  usedJti.set(jti, p.exp * 1000);

  const gid = String(p.user_id ?? p.sub ?? '');
  const login = String(p.username || '').trim().toLowerCase();
  if (!gid || !login) throw new HttpError(401, 'В токене нет пользователя', 'sso_bad');
  const name = String(p.name || p.username).slice(0, 100);
  const fields = {
    email: String(p.email || '').slice(0, 200),
    position: String(p.position || '').slice(0, 100),
    department: String(p.department || '').slice(0, 100),
  };
  let u = db.prepare('SELECT * FROM users WHERE gobsek_id = ?').get(gid);
  if (!u) {
    // Связываем по логину, если сотрудника уже завели вручную.
    u = db.prepare('SELECT * FROM users WHERE login = ? AND gobsek_id IS NULL AND is_bot = 0').get(login);
    if (u) db.prepare('UPDATE users SET gobsek_id = ? WHERE id = ?').run(gid, u.id);
  }
  if (!u) {
    let l = login;
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(l)) l = `${login}.g${gid}`;
    const isAdmin = String(p.role) === 'admin' && process.env.GOBSEK_ADMINS_ARE_ADMINS === '1';
    const r = db.prepare(`INSERT INTO users (login, name, email, position, department, role, gobsek_id, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(l, name, fields.email, fields.position, fields.department,
      isAdmin ? 'admin' : 'member', gid, crypto.randomInt(8), now);
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
    logEvent(u.id, 'sso_register', gid);
  } else {
    // Gobsek — источник правды по должности и подразделению.
    db.prepare(`UPDATE users SET name = ?, email = CASE WHEN ? <> '' THEN ? ELSE email END,
      position = CASE WHEN ? <> '' THEN ? ELSE position END, department = CASE WHEN ? <> '' THEN ? ELSE department END WHERE id = ?`)
      .run(name, fields.email, fields.email, fields.position, fields.position, fields.department, fields.department, u.id);
  }
  if (!u.active) throw new HttpError(403, 'Учётная запись отключена', 'disabled');
  logEvent(u.id, 'sso_login', clientIp(req));
  try { require('./org').syncUser(u.id); } catch { /* оргструктура необязательна */ }
  return { user: u, token: createSession(u.id, req) };
}

module.exports = {
  COOKIE, SESSION_DAYS, sha, randomToken, hashPassword, verifyPassword, passwordProblem, randomPassword,
  parseCookies, sessionCookie, clientIp, createSession, userFromRequest, login, logout, ssoLogin, verifyJwtHS256,
};
