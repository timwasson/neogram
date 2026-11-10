/**
 * Neogram PWA Service Worker (v1.0)
 * Offline caching, navigation fallback, and carrier status management.
 */

const CACHE_NAME = 'neogram-shell-v6';

const STATIC_PRECACHE = [
  '/',
  '/offline.html',
  '/css/neogram.css',
  '/js/retroAudio.js',
  '/js/aimMessenger.js',
  '/js/notifications.js',
  '/js/notifications.js?v=3.3',
  '/js/pwa.js',
  '/js/pwa.js?v=3.2',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: Pre-cache app shell & offline fallback
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[:> SW] Pre-caching core shell assets (v2)...');
      return cache.addAll(STATIC_PRECACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up legacy caches & notify clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[:> SW] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()).then(async () => {
      const allClients = await self.clients.matchAll();
      for (const client of allClients) {
        client.postMessage({ type: 'CACHE_UPDATED' });
      }
    })
  );
});

// Fetch: Strategy dispatcher
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip WebSockets and non-GET requests
  if (req.method !== 'GET' || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // 1. Navigation Requests (HTML Pages) -> Network first, fallback to cache, then offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          // Clone and update cache
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return networkRes;
        })
        .catch(async () => {
          const cachedRes = await caches.match(req);
          if (cachedRes) return cachedRes;
          const fallback = await caches.match('/offline.html');
          return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // 2. Static Assets (CSS, JS, Fonts, Images) -> Cache first, fallback to network & update cache
  if (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        if (cachedRes) {
          // Revalidate in background
          fetch(req).then((netRes) => {
            if (netRes && netRes.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, netRes));
            }
          }).catch(() => {});
          return cachedRes;
        }

        return fetch(req).then((netRes) => {
          const clone = netRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return netRes;
        });
      })
    );
    return;
  }

  // 3. All other requests -> Network with cache fallback
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// Background Sync (for offline photo publishing)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-posts') {
    console.log('[:> SW BACKGROUND SYNC] Carrier re-established. Syncing buffered posts...');
    event.waitUntil(syncBufferedPosts());
  }
});

async function syncBufferedPosts() {
  // Notify all open client windows that network has returned
  const allClients = await self.clients.matchAll();
  for (const client of allClients) {
    client.postMessage({ type: 'CARRIER_RESTORED' });
  }
}

// Push event: invoked when an OS-level web push alert arrives via APNs / FCM
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_err) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || '[:> NEOGRAM ALERT]';
  const options = {
    body: data.body || 'New cyberspace activity detected.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'neogram-' + Date.now(),
    data: {
      url: (data.data && data.data.url) || data.linkUrl || '/',
      id: data.data && data.data.id,
    },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// PushSubscriptionChange: Auto-recover if APNs/browser rotates or invalidates the push token
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    fetch('/api/notifications/vapid-public-key')
      .then((res) => res.json())
      .then((data) => {
        if (!data || !data.publicKey) throw new Error('Missing VAPID public key');
        const padding = '='.repeat((4 - (data.publicKey.length % 4)) % 4);
        const base64 = (data.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const applicationServerKey = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          applicationServerKey[i] = rawData.charCodeAt(i);
        }
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      })
      .then((newSub) => {
        const subJson = newSub.toJSON();
        return fetch('/api/notifications/push-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            keys: subJson.keys,
          }),
        });
      })
      .catch((err) => {
        console.warn('[:> SW PUSH RE-SUBSCRIBE WARN]', err);
      })
  );
});

// Notification Click: Focus window and navigate to target URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
