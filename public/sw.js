// GoToMenu staff service worker. Deliberately tiny: it only makes the app installable and shows a friendly page when the
// device is offline. It NEVER caches orders, API responses or pages (no stale or private data is kept on the tablet).
const CACHE = 'gm-shell-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/offline.css'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
  }
});

// Buffet alerts (Web Push). The message holds only a title, a line of text and the hotel page to open: nothing private.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* plain text */ }
  event.waitUntil(self.registration.showNotification(d.title || 'Buffet', { body: d.body || '', tag: d.tag || 'buffet', renotify: true, icon: '/icons/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c && c.url.includes(url)) return c.focus();
    return self.clients.openWindow(url);
  }));
});
