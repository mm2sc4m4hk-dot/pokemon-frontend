// Minimaler Service Worker – vor allem nötig, damit Chrome/Android die App
// überhaupt als "installierbar" (Zum Startbildschirm hinzufügen) erkennt.
// iOS Safari braucht das technisch nicht, ignoriert es aber auch nicht.
//
// Grundregeln (Stand "1A"):
//   1. Nichts wird aus dem Cache als HTML ausgeliefert – ein altes index.html
//      zeigt auf alte, gehashte Bundles, die es auf dem Server nicht mehr gibt.
//   2. /__/... gehört Firebase (Auth-Handler, iframe.js) und wird nie
//      angefasst. Andernfalls liefert der catch-Fallback undefined und der
//      Redirect-Login geht lautlos verloren.
//   3. API-Anfragen (Kartendaten, Preise) kommen immer frisch vom Server.
const CACHE_NAME = 'tcg-vault-shell-v3';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Nur unkritische Dateien vorab cachen – kein index.html!
      await cache.addAll(['/manifest.json', '/favicon.svg']).catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Alle alten Caches (inkl. v1/v2 mit stale HTML) entfernen.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Firebase-Auth-Pfade niemals anfassen (Handler, iframe.js, handler.js).
const isFirebaseAuthPath = (pathname) => pathname.startsWith('/__/');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nur eigene Origin-Ziele behandeln; Fremd-Requests (API, Firebase) unangetastet lassen.
  if (url.origin !== self.location.origin) return;
  if (isFirebaseAuthPath(url.pathname)) return;

  // Navigation (HTML): immer aus dem Netz. Nie aus dem Cache – sonst liefern
  // wir ein veraltetes index.html mit toten Bundle-Hashes aus.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error()))
    );
    return;
  }

  // Statische Assets (Bundles, Icons, Manifest): Cache-first. Die Dateinamen
  // enthalten einen Hash, das Inhalt ändert sich also nie unter gleicher URL.
  // Ausnahme: sw.js selbst – sonst würde ein alter Service Worker dauerhaft
  // aus dem Cache kommen und Updates würden nie ankommen.
  if (url.pathname !== '/sw.js' && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || /\.(js|css|svg|png|ico|webmanifest|json)$/.test(url.pathname))) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Alles Übrige (API, Preise, Kartendaten): network-first, Cache nur als Notnagel.
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
  );
});

// ---- Push-Nachrichten (Zielpreis-Alarm) ----
self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'TCG Vault', body: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(data.title || 'TCG Vault', {
    body: data.body || '',
    tag: data.tag || 'tcg-vault',
    renotify: true,
    // icon: '/icon-192.png',   // optional: Pfad zu deinem App-Icon
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'open-tab', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
