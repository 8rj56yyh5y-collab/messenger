'use strict';
// Загрузка и отдача файлов. Тело запроса — сам файл; имя и метаданные — в заголовках.
// Отдаётся только тем, у кого есть доступ (участники чата, где файл отправлен; аватары — всем сотрудникам).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, UPLOAD_DIR } = require('./db');
const { HttpError, int, jsonParse } = require('./util');
const chats = require('./chats');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
const maxMb = () => Math.min(MAX_MB, require('./workspace').get().max_upload_mb || MAX_MB);
// Встраивать в страницу можно только безопасные типы; остальное — скачиванием.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;

function upload(req, user) {
  return new Promise((resolve, reject) => {
    const len = int(req.headers['content-length']);
    if (len > maxMb() * 1024 * 1024) return reject(new HttpError(413, `Файл больше ${maxMb()} МБ`, 'too_big'));
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch { /* оставим file */ }
    name = name.replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'file';
    const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
    let meta = {};
    try { meta = JSON.parse(decodeURIComponent(String(req.headers['x-file-meta'] || '{}'))); } catch { meta = {}; }
    const safeMeta = {};
    for (const k of ['width', 'height', 'duration']) if (Number.isFinite(Number(meta[k]))) safeMeta[k] = Number(meta[k]);
    if (Array.isArray(meta.waveform)) safeMeta.waveform = meta.waveform.slice(0, 64).map((x) => Math.max(0, Math.min(100, int(x))));
    const stored = `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}`;
    const full = path.join(UPLOAD_DIR, stored);
    const out = fs.createWriteStream(full, { flags: 'wx' });
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxMb() * 1024 * 1024 && !failed) {
        failed = true;
        out.destroy();
        fs.rm(full, { force: true }, () => {});
        req.destroy();
        reject(new HttpError(413, `Файл больше ${maxMb()} МБ`, 'too_big'));
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      if (!size) { fs.rm(full, { force: true }, () => {}); reject(new HttpError(400, 'Пустой файл')); return; }
      const r = db.prepare('INSERT INTO files (user_id, name, mime, size, stored, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, name, mime, size, stored, JSON.stringify(safeMeta), Date.now());
      const id = Number(r.lastInsertRowid);
      resolve({ id, name, mime, size, meta: safeMeta, url: `/api/files/${id}` });
    });
    out.on('error', (e) => { if (!failed) reject(e); });
  });
}

function serve(req, res, user, id, download) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(int(id));
  if (!f || !chats.fileAccessible(f.id, user.id)) throw new HttpError(404, 'Файл не найден');
  const full = path.join(UPLOAD_DIR, f.stored);
  let stat;
  try { stat = fs.statSync(full); } catch { throw new HttpError(404, 'Файл не найден'); }
  const inline = INLINE.test(f.mime) && !download;
  const headers = {
    'Content-Type': inline ? f.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? int(range[1]) : stat.size - int(range[2]);
    let end = range[1] && range[2] ? int(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full).pipe(res);
}

function fileMeta(id) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(int(id));
  return f ? { ...f, meta: jsonParse(f.meta, {}) } : null;
}

module.exports = { upload, serve, fileMeta, MAX_MB };
