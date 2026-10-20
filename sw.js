// OMP Remote service worker: caches the app shell only. Nothing personal is ever cached — data arrives sealed over
// the relay WebSocket and lives only in memory.
const CACHE = 'omp-remote-0.1.0';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'js/app.js', 'js/e2e.js', 'js/relay.js', 'manifest.webmanifest', 'img/omp-mark.svg', 'img/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
