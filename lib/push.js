// Avisos push para despertar el teléfono cuando la app está cerrada.
//
// El navegador entrega el aviso al service worker, que lo muestra como
// notificación del sistema con vibración. Al tocarla se abre Whataka y la
// llamada entra con la oferta que el relé dejó guardada.
const webpush = require('web-push');

const MAX_POR_PEER = 5;
const MAX_PEERS = 5000;
const TTL_LLAMADA_MS = 75 * 1000;

const suscripciones = new Map(); // peerId -> Map(endpoint -> subscription)
const llamadasPendientes = new Map(); // callId -> { to, frames, at }
const candidatosPendientes = new Map(); // callId -> [payload]

function vapid() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (publicKey && privateKey) return { publicKey, privateKey, efimeras: false };
  // Sin claves configuradas se generan al arrancar: sirve para desarrollo y
  // para que la app no se rompa, pero cada reinicio invalida las suscripciones.
  const nuevas = webpush.generateVAPIDKeys();
  return { publicKey: nuevas.publicKey, privateKey: nuevas.privateKey, efimeras: true };
}

const claves = vapid();
try {
  webpush.setVapidDetails('mailto:hola@whataka.vip', claves.publicKey, claves.privateKey);
} catch (err) {
  // Una clave mal copiada en el panel no puede tumbar el relé: sin avisos se
  // pierden llamadas, pero con el relé caído se pierde todo.
  console.warn('Claves VAPID inválidas, se usan efímeras:', err.message);
  const nuevas = webpush.generateVAPIDKeys();
  claves.publicKey = nuevas.publicKey;
  claves.privateKey = nuevas.privateKey;
  claves.efimeras = true;
  webpush.setVapidDetails('mailto:hola@whataka.vip', claves.publicKey, claves.privateKey);
}

function clavePublica() {
  return claves.publicKey;
}

function suscribir(peerId, subscription) {
  if (!peerId || !subscription || !subscription.endpoint) return false;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 500) return false;
  if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) return false;

  if (!suscripciones.has(peerId) && suscripciones.size >= MAX_PEERS) {
    const masVieja = suscripciones.keys().next().value;
    suscripciones.delete(masVieja);
  }
  const suyas = suscripciones.get(peerId) || new Map();
  suyas.set(subscription.endpoint, subscription);
  while (suyas.size > MAX_POR_PEER) suyas.delete(suyas.keys().next().value);
  suscripciones.set(peerId, suyas);
  return true;
}

function desuscribir(peerId, endpoint) {
  const suyas = suscripciones.get(peerId);
  if (!suyas) return false;
  if (endpoint) suyas.delete(endpoint);
  else suscripciones.delete(peerId);
  if (suyas.size === 0) suscripciones.delete(peerId);
  return true;
}

function cuantas(peerId) {
  const suyas = suscripciones.get(peerId);
  return suyas ? suyas.size : 0;
}

async function enviar(peerId, carga, { ttl = 60, urgencia = 'high' } = {}) {
  const suyas = suscripciones.get(peerId);
  if (!suyas || suyas.size === 0) return 0;
  let entregados = 0;
  await Promise.all([...suyas.values()].map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(carga), { TTL: ttl, urgency: urgencia });
      entregados += 1;
    } catch (err) {
      // 404/410: el navegador ya no existe (app desinstalada, permiso revocado).
      if (err && (err.statusCode === 404 || err.statusCode === 410)) suyas.delete(sub.endpoint);
      else console.warn('push rechazado:', err && (err.statusCode || err.message));
    }
  }));
  if (suyas.size === 0) suscripciones.delete(peerId);
  return entregados;
}

// Un aviso de llamada es un aviso suelto: el teléfono vibra una vez y se
// queda el cartel. Para que suene como un teléfono hay que insistir: se repite
// el aviso cada pocos segundos hasta que contestan, cuelgan o se agota el
// tiempo. Cada repetición vuelve a sonar y a vibrar en el móvil.
const repiques = new Map(); // callId -> { timer, peerId }
const REPIQUE_CADA_MS = Number(process.env.REPIQUE_CADA_MS) || 4000;
const REPIQUE_DURACION_MS = Number(process.env.REPIQUE_DURACION_MS) || 60000;

function repicar(peerId, carga, { cada = REPIQUE_CADA_MS, hasta = REPIQUE_DURACION_MS, retraso = 0 } = {}) {
  const callId = carga && carga.callId;
  if (!callId) return;
  pararRepique(callId);
  const fin = Date.now() + retraso + hasta;
  const tic = () => {
    enviar(peerId, carga).catch(() => {});
    if (Date.now() >= fin) {
      repiques.delete(callId);
      return;
    }
    const timer = setTimeout(tic, cada);
    if (timer.unref) timer.unref();
    repiques.set(callId, { timer, peerId });
  };
  if (retraso > 0) {
    const timer = setTimeout(tic, retraso);
    if (timer.unref) timer.unref();
    repiques.set(callId, { timer, peerId });
    return;
  }
  tic();
}

function pararRepique(callId) {
  const entrada = repiques.get(callId);
  if (!entrada) return false;
  clearTimeout(entrada.timer);
  repiques.delete(callId);
  return true;
}

function repiquesActivos() {
  return repiques.size;
}

function pararRepiquesDe(peerId) {
  for (const [callId, entrada] of repiques) {
    if (entrada.peerId !== peerId) continue;
    clearTimeout(entrada.timer);
    repiques.delete(callId);
  }
}

// Un aviso de mensaje por contacto cada 30 s: si alguien manda diez seguidos,
// el móvil vibra una vez y ya está.
const ultimoAviso = new Map();
function avisar(peerId, carga) {
  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(peerId) || 0) < 30000) return Promise.resolve(0);
  ultimoAviso.set(peerId, ahora);
  return enviar(peerId, carga);
}

// El relé guarda la oferta unos segundos: el teléfono puede tardar en abrir la
// app y sin esto la llamada se perdería por el camino.
function guardarLlamada(callId, { to, from, frame }) {
  if (!callId) return;
  limpiarLlamadas();
  llamadasPendientes.set(callId, { to, from, frame, at: Date.now() });
}

function guardarCandidato(callId, payload) {
  if (!callId || !payload) return;
  const lista = candidatosPendientes.get(callId) || [];
  if (lista.length >= 60) lista.shift();
  lista.push(payload);
  candidatosPendientes.set(callId, lista);
}

// Se entrega al conectarse: primero la oferta y después sus candidatos, que es
// el orden que la app necesita para no perderlos.
function tomarPendientes(peerId) {
  pararRepiquesDe(peerId);
  const salida = [];
  for (const [callId, entrada] of llamadasPendientes) {
    if (entrada.to !== peerId) continue;
    salida.push(entrada.frame);
    for (const payload of candidatosPendientes.get(callId) || []) {
      salida.push({ t: 'call', from: entrada.from, callId, kind: 'ice', payload });
    }
    llamadasPendientes.delete(callId);
    candidatosPendientes.delete(callId);
  }
  return salida;
}

function hayPendiente(callId) {
  return llamadasPendientes.has(callId);
}

function olvidarLlamada(callId) {
  pararRepique(callId);
  llamadasPendientes.delete(callId);
  candidatosPendientes.delete(callId);
}

function limpiarLlamadas() {
  const ahora = Date.now();
  for (const [callId, entrada] of llamadasPendientes) {
    if (ahora - entrada.at > TTL_LLAMADA_MS) {
      llamadasPendientes.delete(callId);
      candidatosPendientes.delete(callId);
    }
  }
}

const limpieza = setInterval(limpiarLlamadas, 30000);
limpieza.unref();

module.exports = {
  clavePublica,
  suscribir,
  desuscribir,
  cuantas,
  enviar,
  avisar,
  repicar,
  repiquesActivos,
  pararRepique,
  pararRepiquesDe,
  guardarLlamada,
  guardarCandidato,
  tomarPendientes,
  hayPendiente,
  olvidarLlamada,
  efimeras: claves.efimeras,
};
