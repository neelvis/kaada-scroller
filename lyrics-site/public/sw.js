importScripts('./cache-manifest.js');
const BASE = new URL(self.registration.scope);
const PREFIX = `kaada-lyrics-shell-${encodeURIComponent(BASE.pathname)}-`;
const CACHE = PREFIX + self.LYRICS_VERSION + '-__LYRICS_VERSION__';
const SHELL = self.LYRICS_SHELL.map(path => new URL(path, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  const normalized = url.href;
  if (!SHELL.includes(normalized)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(normalized)) || fetch(event.request)));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const ready = (await Promise.all(SHELL.map(url => cache.match(url)))).every(Boolean);
    event.source?.postMessage({ type: 'OFFLINE_READY', ready });
  })());
});
