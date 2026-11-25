const CACHE = 'whataka-v62';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './lib/llamadas.js',
  './lib/niveles.js',
  './lib/referidos.js',
  './lib/donaciones.js',
  './lib/stickers.js',
  './lib/relay-url.js',
  './vendor/ethers.umd.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Estrategia "red primero": con conexión siempre se sirve la última versión fresca
// y se refresca la caché para que los cambios visuales se vean de inmediato.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        // No se guardan respuestas de error: un 404 durante un despliegue se
        // quedaría cacheado y se serviría para siempre sin conexión.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
        // Solo una navegación puede caer a index.html: devolver HTML a una
        // petición de script la rompe con un error de sintaxis.
        if (request.mode === 'navigate') {
          const index = await caches.match('./index.html');
          if (index) return index;
        }
        return Response.error();
      }),
  );
});
