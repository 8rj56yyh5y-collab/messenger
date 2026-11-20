// Состояние приложения и простая шина событий.
export const S = {
  meta: null,
  me: null,
  settings: {},
  chats: new Map(),
  users: new Map(),
  online: new Set(),
  messages: new Map(),      // chatId -> { list, hasMoreTop, hasMoreBottom }
  current: null,            // id открытого чата
  folder: 'all',
  typing: new Map(),        // chatId -> Map(userId -> { action, until })
  calls: new Map(),         // активные звонки (с сервера)
  replyTo: null,
  editing: null,
  selection: new Set(),
  panel: null,              // правая панель: { type: 'chat'|'user', id }
  connection: 'connecting',
};

const handlers = new Map();
export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => handlers.get(name).delete(fn);
}
export function emit(name, data) {
  for (const fn of handlers.get(name) || []) {
    try { fn(data); } catch (e) { console.error(name, e); }
  }
}

export function upsertUser(u) {
  if (!u) return;
  const prev = S.users.get(u.id) || {};
  S.users.set(u.id, { ...prev, ...u });
  if (u.online) S.online.add(u.id);
}

export function upsertChat(c) {
  if (!c) return;
  if (c.peer) upsertUser(c.peer);
  const prev = S.chats.get(c.id) || {};
  S.chats.set(c.id, { ...prev, ...c });
}

export function chatTitle(c, t) {
  if (!c) return '';
  if (c.type === 'saved') return t('chat.saved');
  if (c.type === 'ai') return 'Gobsek AI';
  if (c.type === 'direct') return S.users.get(c.peer?.id)?.name || c.peer?.name || '?';
  return c.title;
}

export function isMuted(c) { return c && c.muted_until > Date.now(); }

export function peerOf(c) { return c && c.peer ? S.users.get(c.peer.id) || c.peer : null; }

export function userName(id) {
  if (id === S.me?.id) return S.me.name;
  return S.users.get(id)?.name || '…';
}
