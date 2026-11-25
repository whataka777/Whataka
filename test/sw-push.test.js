'use strict';

// Ejecuta el service worker real en un entorno simulado para comprobar el
// aviso de llamada: título, vibración, botones y a dónde abre al tocarlo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGEN = 'https://whataka.vip';

function cargarSW() {
  const manejadores = new Map();
  const notificaciones = [];
  const ventanas = [];
  const abiertas = [];

  const self = {
    location: { origin: ORIGEN },
    addEventListener: (tipo, fn) => manejadores.set(tipo, fn),
    skipWaiting: async () => {},
    registration: {
      scope: `${ORIGEN}/`,
      showNotification: async (titulo, opciones) => { notificaciones.push({ titulo, opciones }); },
      getNotifications: async ({ tag } = {}) => notificaciones
        .filter((n) => !tag || n.opciones.tag === tag)
        .map((n) => ({ tag: n.opciones.tag, close: () => { n.cerrada = true; } })),
    },
    clients: {
      matchAll: async () => ventanas,
      openWindow: async (url) => { abiertas.push(url); return { url }; },
    },
  };

  const cacheVacia = {
    addAll: async () => {},
    put: async () => {},
    match: async () => null,
  };
  const caches = {
    open: async () => cacheVacia,
    keys: async () => [],
    match: async () => null,
    delete: async () => true,
  };

  const contexto = vm.createContext({
    self,
    caches,
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Response: { error: () => ({ tipo: 'error' }) },
    URL,
    console,
  });
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  vm.runInContext(codigo, contexto);

  return { manejadores, notificaciones, ventanas, abiertas };
}

function eventoPush(datos) {
  let pendiente;
  const event = {
    data: datos === null ? null : { json: () => datos },
    waitUntil: (p) => { pendiente = p; },
  };
  return { event, listo: () => pendiente };
}

function eventoClick(accion, datos) {
  let pendiente;
  let cerrada = false;
  const event = {
    action: accion,
    notification: { data: datos, close: () => { cerrada = true; } },
    waitUntil: (p) => { pendiente = p; },
  };
  return { event, listo: () => pendiente, cerrada: () => cerrada };
}

test('un push de llamada muestra aviso con vibración y botones', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const { event, listo } = eventoPush({
    tipo: 'llamada', de: 'wt1abc', callId: 'c-1', video: false, nombre: 'Bruno',
  });

  manejadores.get('push')(event);
  await listo();

  assert.equal(notificaciones.length, 1);
  const { titulo, opciones } = notificaciones[0];
  assert.equal(titulo, 'Llamada de Bruno');
  assert.equal(opciones.body, 'Toca para contestar en Whataka');
  assert.equal(opciones.requireInteraction, true);
  assert.ok(Array.isArray(opciones.vibrate) && opciones.vibrate.length >= 5, 'debe vibrar');
  assert.equal(opciones.actions.map((a) => a.action).join(','), 'contestar,rechazar');
  assert.equal(opciones.data.callId, 'c-1');
  assert.equal(opciones.tag, 'llamada-c-1');
  assert.equal(opciones.renotify, true, 'cada repetición vuelve a sonar');
  assert.equal(opciones.silent, false);
  assert.ok(opciones.vibrate.length >= 9, 'patrón largo de timbre');
});

test('una videollamada se anuncia como videollamada', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const { event, listo } = eventoPush({ tipo: 'llamada', video: true, nombre: 'Ana', callId: 'c-2' });

  manejadores.get('push')(event);
  await listo();

  assert.equal(notificaciones[0].titulo, 'Videollamada de Ana');
});

test('un push que no es de llamada ni de mensaje no muestra nada', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const { event, listo } = eventoPush({ tipo: 'otra-cosa' });

  manejadores.get('push')(event);
  await listo();

  assert.equal(notificaciones.length, 0);
});

test('sin datos no revienta y no avisa de nada', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const { event, listo } = eventoPush(null);

  manejadores.get('push')(event);
  await listo();

  assert.equal(notificaciones.length, 0);
});

test('tocar "Contestar" abre la app pidiendo la llamada', async () => {
  const { manejadores, abiertas } = cargarSW();
  const { event, listo, cerrada } = eventoClick('contestar', {
    tipo: 'llamada', de: 'wt1abc', callId: 'c-3', video: true, nombre: 'Bruno',
  });

  manejadores.get('notificationclick')(event);
  await listo();

  assert.equal(cerrada(), true, 'la notificación se cierra al tocarla');
  assert.equal(abiertas.length, 1);
  const url = new URL(abiertas[0]);
  assert.equal(url.pathname, '/index.html');
  assert.equal(url.searchParams.get('llamada'), 'c-3');
  assert.equal(url.searchParams.get('de'), 'wt1abc');
  assert.equal(url.searchParams.get('video'), '1');
  assert.equal(url.searchParams.get('contestar'), '1');
});

test('tocar el aviso (sin botón) abre la app pero no contesta sola', async () => {
  const { manejadores, abiertas } = cargarSW();
  const { event, listo } = eventoClick('', { tipo: 'llamada', callId: 'c-4', de: 'wt1x', video: false });

  manejadores.get('notificationclick')(event);
  await listo();

  const url = new URL(abiertas[0]);
  assert.equal(url.searchParams.get('contestar'), '0');
  assert.equal(url.searchParams.get('llamada'), 'c-4');
});

test('"Rechazar" cierra el aviso y no abre ventanas', async () => {
  const { manejadores, abiertas } = cargarSW();
  const { event, listo, cerrada } = eventoClick('rechazar', { tipo: 'llamada', callId: 'c-5' });

  manejadores.get('notificationclick')(event);
  await listo();

  assert.equal(cerrada(), true);
  assert.equal(abiertas.length, 0);
});

test('con la app ya abierta se le manda el aviso en vez de abrir otra', async () => {
  const { manejadores, ventanas, abiertas } = cargarSW();
  const mensajes = [];
  const ventana = {
    url: `${ORIGEN}/index.html`,
    focus: async () => 'enfocada',
    postMessage: (dato) => mensajes.push(dato),
  };
  ventanas.push(ventana);

  const { event, listo } = eventoClick('contestar', { tipo: 'llamada', callId: 'c-6', de: 'wt1y', video: false });
  manejadores.get('notificationclick')(event);
  await listo();

  assert.equal(abiertas.length, 0, 'no abre una segunda pestaña');
  assert.equal(mensajes.length, 1);
  assert.equal(mensajes[0].tipo, 'aviso-llamada');
  assert.equal(mensajes[0].contestar, true);
});

// ── Avisos de mensaje ───────────────────────────────────────────────────────

test('un push de mensaje avisa sin botones de llamada', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const { event, listo } = eventoPush({ tipo: 'mensaje', de: 'wt1abc', nombre: 'Bruno' });

  manejadores.get('push')(event);
  await listo();

  assert.equal(notificaciones.length, 1);
  const { titulo, opciones } = notificaciones[0];
  assert.equal(titulo, 'Mensaje de Bruno');
  assert.equal(opciones.tag, 'mensaje-wt1abc');
  assert.equal(opciones.actions, undefined, 'un mensaje no se contesta desde el aviso');
});

test('tocar el aviso de mensaje abre la conversación', async () => {
  const { manejadores, abiertas } = cargarSW();
  const { event, listo, cerrada } = eventoClick('', { tipo: 'mensaje', de: 'wt1abc', nombre: 'Bruno' });

  manejadores.get('notificationclick')(event);
  await listo();

  assert.equal(cerrada(), true);
  const url = new URL(abiertas[0]);
  assert.equal(url.searchParams.get('chat'), 'wt1abc');
  assert.equal(url.searchParams.get('llamada'), null);
});

test('con la app abierta el aviso de mensaje abre ese chat sin recargar', async () => {
  const { manejadores, ventanas, abiertas } = cargarSW();
  const mensajes = [];
  ventanas.push({
    url: `${ORIGEN}/index.html`,
    focus: async () => 'enfocada',
    postMessage: (dato) => mensajes.push(dato),
  });

  const { event, listo } = eventoClick('', { tipo: 'mensaje', de: 'wt1zzz', nombre: 'Ana' });
  manejadores.get('notificationclick')(event);
  await listo();

  assert.equal(abiertas.length, 0);
  assert.equal(mensajes.length, 1);
  assert.equal(mensajes[0].tipo, 'aviso-mensaje');
  assert.equal(mensajes[0].de, 'wt1zzz');
});

test('al colgar el que llama se retira el cartel de la llamada', async () => {
  const { manejadores, notificaciones } = cargarSW();
  const pushLlamada = eventoPush({ tipo: 'llamada', de: 'wt1abc', callId: 'c-9', nombre: 'Bruno' });
  manejadores.get('push')(pushLlamada.event);
  await pushLlamada.listo();
  assert.equal(notificaciones.length, 1);

  const colgado = eventoPush({ tipo: 'colgado', callId: 'c-9' });
  manejadores.get('push')(colgado.event);
  await colgado.listo();

  assert.equal(notificaciones.length, 1, 'no se crea otra notificación');
  assert.equal(notificaciones[0].cerrada, true, 'se cierra la que estaba');
});
