// WealthLens Hub — Service Worker
// Strategy: cache-first for static assets, network-first for API/auth

const CACHE_NAME = 'wealthlens-v1';
const STATIC_CACHE = 'wealthlens-static-v1';

// Assets to pre-cache on install
const PRE_CACHE = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── Install: pre-cache shell ──────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRE_CACHE))
  );
});

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing logic ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — network-first, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — no cached data available' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets (JS/CSS/fonts/images) — cache-first
  if (
    url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML navigation — network-first, fall back to cached index
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match('/'))
  );
});

// ── Web Push — display notification ──────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'WealthLens Alert', body: '', icon: '/icon-192.png', url: '/' };
  try { if (event.data) Object.assign(data, event.data.json()); } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const match = wins.find(w => w.url.includes(self.location.origin));
      if (match) { match.focus(); match.postMessage({ type: 'NAVIGATE', url }); }
      else clients.openWindow(url);
    })
  );
});

// ── Offline Write Queue (Background Sync) ────────────────────────
const DB_NAME  = 'wealthlens-offline';
const DB_VER   = 1;
const TX_STORE = 'pending-transactions';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(TX_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// Flush all queued transactions to the server
async function flushPendingTransactions() {
  const db = await openOfflineDB();
  const tx = db.transaction(TX_STORE, 'readwrite');
  const store = tx.objectStore(TX_STORE);
  const items = await new Promise((res, rej) => {
    const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej;
  });

  for (const item of items) {
    try {
      const resp = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      if (resp.ok) {
        // Remove from queue on success
        const dt = db.transaction(TX_STORE, 'readwrite');
        dt.objectStore(TX_STORE).delete(item.id);
      }
    } catch {
      // Stay in queue — will retry on next sync
    }
  }
}

self.addEventListener('sync', event => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(flushPendingTransactions());
  }
});
