// Delight Restaurant Service Worker — Network-first with offline fallback
const CACHE_NAME = 'delight-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './styles.css',
  './app.js',
  './admin.js',
  './logo.svg',
  './manifest.json',
  './stak-ui.css',
  './stak-ui.js',
  './stak-motion.js',
  './stak.js'
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache, offline page for navigation
self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin (except CDN)
  if (request.method !== 'GET' || (url.origin !== location.origin && !url.hostname.includes('jsdelivr.net'))) return;

  // HTML navigation — network first, then cache, then offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, copy));
        return res;
      }).catch(() => caches.match(request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Static assets — cache first, then network
  if (STATIC_ASSETS.some(a => request.url.endsWith(a.replace('./','')))) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, copy));
        return res;
      }))
    );
    return;
  }

  // Images & other — network first, cache fallback
  event.respondWith(
    fetch(request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, copy));
      }
      return res;
    }).catch(() => caches.match(request))
  );
});

// Background sync for offline orders (if supported)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
});

async function syncOrders() {
  // Placeholder for IndexedDB offline queue
  console.log('[SW] Background sync triggered');
}
