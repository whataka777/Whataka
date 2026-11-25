// Buzón de mensajes: lo que llega para alguien que no está conectado se queda
// aquí hasta que su móvil aparezca. Sin esto, escribir a un teléfono dormido
// pierde el mensaje y el que escribe ni se entera.
//
// Los sobres siguen cifrados de extremo a extremo: el relé guarda el mismo
// criptograma que le habría reenviado, y no puede leerlo.
const TTL_MS = Number(process.env.BUZON_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const MAX_POR_PEER = 200;
const MAX_BYTES_POR_PEER = 2 * 1024 * 1024;
const MAX_PEERS = 5000;

const buzon = new Map(); // peerId -> [{ id, from, iv, ct, at }]

function bytes(sobre) {
  return sobre.iv.length + sobre.ct.length;
}

function guardar(peerId, sobre) {
  if (!peerId || !sobre || !sobre.id) return false;
  if (!buzon.has(peerId) && buzon.size >= MAX_PEERS) {
    buzon.delete(buzon.keys().next().value);
  }
  const lista = buzon.get(peerId) || [];
  if (lista.length >= MAX_POR_PEER) return false;
  const ocupado = lista.reduce((total, s) => total + bytes(s), 0);
  if (ocupado + bytes(sobre) > MAX_BYTES_POR_PEER) return false;
  lista.push({ ...sobre, at: Date.now() });
  buzon.set(peerId, lista);
  return true;
}

function pendientes(peerId) {
  limpiar();
  return (buzon.get(peerId) || []).map(({ at, ...sobre }) => sobre);
}

function acusar(peerId, ids) {
  const lista = buzon.get(peerId);
  if (!lista || !Array.isArray(ids) || !ids.length) return [];
  const pedidos = new Set(ids.slice(0, 200));
  const quitados = [];
  const quedan = [];
  for (const sobre of lista) {
    if (pedidos.has(sobre.id)) quitados.push(sobre);
    else quedan.push(sobre);
  }
  if (quedan.length) buzon.set(peerId, quedan);
  else buzon.delete(peerId);
  return quitados;
}

function cuantos(peerId) {
  const lista = buzon.get(peerId);
  return lista ? lista.length : 0;
}

function limpiar() {
  const ahora = Date.now();
  for (const [peerId, lista] of buzon) {
    const vivos = lista.filter((sobre) => ahora - sobre.at <= TTL_MS);
    if (vivos.length) buzon.set(peerId, vivos);
    else buzon.delete(peerId);
  }
}

const limpieza = setInterval(limpiar, 60000);
limpieza.unref();

module.exports = { guardar, pendientes, acusar, cuantos, limpiar, TTL_MS };
