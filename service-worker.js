// Network-first service worker.
// Every fetch goes to the network first; the cache exists only as an
// offline fallback. This guarantees the PWA on the home screen always
// serves the latest deploy when there is connectivity.

const CACHE = 'rpg-runtime-v58';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/theme.css',
  './assets/styles.css',
  './assets/app.js',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
