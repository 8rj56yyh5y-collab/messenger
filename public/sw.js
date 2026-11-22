// Service worker: оболочка приложения доступна без сети, API — всегда из сети.
const CACHE = 'gc-shell-v5';
const SHELL = ['/', '/index.html', '/css/app.css', '/css/design2.css', '/css/design3.css', '/css/design4.css', '/icon.svg', '/manifest.webmanifest', '/js/theme-boot.js'];

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
// Push-уведомления (сервер шлёт их, когда приложение закрыто)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Gobsek Chat', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // Приложение открыто и видно — системное уведомление не нужно
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible') && !d.call) return;
    await self.registration.showNotification(d.title || 'Gobsek Chat', {
      body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icon.svg', badge: '/icon.svg',
      data: { url: d.url || '/' }, requireInteraction: !!d.call, vibrate: d.call ? [300, 150, 300, 150, 300] : [80],
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list[0];
    if (w) { w.focus(); if ('navigate' in w) return w.navigate(url).catch(() => {}); return undefined; }
    return self.clients.openWindow(url);
  }));
});
