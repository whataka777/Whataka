const CACHE = 'whataka-v75';
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
  './lib/efectos.js',
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

// ── Avisos de llamada ───────────────────────────────────────────────────────
// Con la app cerrada este es el único camino para que el teléfono suene: el
// relé manda el push, el sistema despierta el service worker y aquí se muestra
// la notificación con vibración. Al tocarla se abre la llamada.
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }
  const nombre = datos.nombre || 'Alguien';

  // El que llamaba se cansó: se quita el cartel de "Contestar" del teléfono.
  if (datos.tipo === 'colgado') {
    event.waitUntil((async () => {
      const lista = await self.registration.getNotifications({ tag: `llamada-${datos.callId || 'sin-id'}` });
      for (const aviso of lista) aviso.close();
    })());
    return;
  }
  if (datos.tipo === 'mensaje') {
    event.waitUntil(
      self.registration.showNotification(`Mensaje de ${nombre}`, {
        body: 'Toca para abrir Whataka',
        tag: `mensaje-${datos.de || 'alguien'}`,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: datos,
      }),
    );
    return;
  }
  if (datos.tipo !== 'llamada') return;
  event.waitUntil(
    self.registration.showNotification(
      datos.video ? `Videollamada de ${nombre}` : `Llamada de ${nombre}`,
      {
        body: 'Toca para contestar en Whataka',
        tag: `llamada-${datos.callId || 'sin-id'}`,
        // El relé repite el aviso cada pocos segundos mientras suena: con el
        // mismo tag y renotify, cada repetición vuelve a sonar y a vibrar en
        // lugar de amontonar notificaciones.
        requireInteraction: true,
        renotify: true,
        silent: false,
        timestamp: Date.now(),
        // Patrón largo, tipo timbre de teléfono, no un pitido suelto.
        vibrate: [900, 400, 900, 400, 900, 400, 900, 400, 900],
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: datos,
        actions: [
          { action: 'contestar', title: 'Contestar' },
          { action: 'rechazar', title: 'Rechazar' },
        ],
      },
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  const datos = event.notification.data || {};
  event.notification.close();
  if (event.action === 'rechazar') return;

  const contestar = event.action === 'contestar';
  const url = new URL('./index.html', self.registration.scope);
  if (datos.tipo === 'mensaje') {
    if (datos.de) url.searchParams.set('chat', datos.de);
    event.waitUntil((async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin !== self.location.origin) continue;
        ventana.postMessage({ ...datos, tipo: 'aviso-mensaje' });
        return ventana.focus();
      }
      return self.clients.openWindow(url.toString());
    })());
    return;
  }
  if (datos.callId) url.searchParams.set('llamada', datos.callId);
  if (datos.de) url.searchParams.set('de', datos.de);
  url.searchParams.set('video', datos.video ? '1' : '0');
  url.searchParams.set('contestar', contestar ? '1' : '0');

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const ventana of ventanas) {
      if (new URL(ventana.url).origin !== self.location.origin) continue;
      ventana.postMessage({ ...datos, tipo: 'aviso-llamada', contestar });
      return ventana.focus();
    }
    return self.clients.openWindow(url.toString());
  })());
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
