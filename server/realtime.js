'use strict';
// Мост между бизнес-логикой и живыми подключениями. Модули шлют события сюда,
// не зная о WebSocket; index.js подключает хаб. Без хаба (тесты) события просто теряются.
const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(50);
let hub = null;

module.exports = {
  attach(h) { hub = h; },
  isOnline: (uid) => !!hub && hub.isOnline(uid),
  onlineIds: () => (hub ? hub.onlineIds() : []),
  toUser: (uid, ev) => hub && hub.toUser(uid, ev),
  toUsers: (uids, ev) => hub && hub.toUsers(uids, ev),
  toConn: (cid, ev) => !!hub && hub.toConn(cid, ev),
  toAll: (ev) => hub && hub.toAll(ev),
  kickUser: (uid) => hub && hub.kickUser(uid),
  emit: (name, data) => bus.emit(name, data),
  on: (name, fn) => bus.on(name, fn),
};
