// Service worker: оболочка приложения доступна без сети, API — всегда из сети.
const CACHE = 'gc-shell-v2';
const SHELL = ['/', '/index.html', '/css/app.css', '/css/design2.css', '/icon.svg', '/manifest.webmanifest', '/js/theme-boot.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/sso/') || url.pathname === '/ws') return;
  // Сначала сеть (чтобы обновления приходили сразу), при её отсутствии — кэш.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || SHELL.includes(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
