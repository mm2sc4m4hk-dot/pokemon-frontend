// Minimaler Service Worker – vor allem nötig, damit Chrome/Android die App
// überhaupt als "installierbar" (Zum Startbildschirm hinzufügen) erkennt.
// iOS Safari braucht das technisch nicht, ignoriert es aber auch nicht.
const CACHE_NAME = 'poketracker-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first für alles außer den paar App-Shell-Dateien: die Kartendaten
// (Suche, Preise) sollen IMMER frisch vom Server kommen, nicht aus dem Cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
