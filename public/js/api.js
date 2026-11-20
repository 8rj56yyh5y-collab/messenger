// HTTP API и WebSocket-подключение с автоматическим переподключением.

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'offline', 'offline');
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'auth') onUnauthorized();
    throw new ApiError(res.status, data?.error || res.statusText, data?.code);
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

/** Загрузка файла с прогрессом (XHR — у fetch нет прогресса отправки). */
export function upload(file, { name, meta, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name || file.name || 'file'));
    if (meta) xhr.setRequestHeader('X-File-Meta', encodeURIComponent(JSON.stringify(meta)));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || 'upload', data?.code));
    };
    xhr.onerror = () => reject(new ApiError(0, 'offline', 'offline'));
    xhr.send(file);
    if (onProgress) onProgress(0);
  });
}

// ---------- WebSocket ----------
export class Socket {
  constructor(onEvent, onState) {
    this.onEvent = onEvent;
    this.onState = onState;
    this.ws = null;
    this.retry = 0;
    this.queue = [];
    this.connId = null;
    this.stopped = false;
  }
  connect() {
    this.stopped = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.onState('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.onState('online');
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello') this.connId = msg.conn_id;
      this.onEvent(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.onState('offline');
      if (this.stopped || e.code === 4001) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry++) + Math.random() * 400;
      setTimeout(() => { if (!this.stopped) this.connect(); }, delay);
    };
  }
  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (!msg.type.startsWith('typing')) this.queue.push(msg);
  }
  close() {
    this.stopped = true;
    if (this.ws) this.ws.close();
  }
  get online() { return this.ws && this.ws.readyState === 1; }
}
