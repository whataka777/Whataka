'use strict';

(function () {
  /* Sistema de referidos de Whataka.
   *
   * Invitar sirve para UNA cosa: crecer y ganar ESTATUS/POSICIÓN dentro de la
   * app. No da dinero, ni tokens, ni ventajas materiales: solo reconocimiento y
   * un puesto en la tabla de invitadores. Nada que se pueda "cobrar".
   *
   * Este módulo es PURO: no toca la red ni la cadena. Se carga igual en el
   * navegador (app.js) y en el relé (server.js), sin duplicar el código.
   */

  // Alfabeto base58 (sin 0, O, I, l) — el mismo que usa el Peer ID.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Codifica bytes a base58 (igual que el Peer ID de la app). */
function base58(bytes) {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const b of bytes) {
    if (b === 0) out += B58[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

const PEER_RE = /^wt1[1-9A-HJ-NP-Za-km-z]{20,60}$/;

/** ¿Es un Peer ID con el formato correcto? */
function esPeerIdValido(id) {
  return typeof id === 'string' && PEER_RE.test(id);
}

// Escalera de estatus por número de personas invitadas. Solo reconocimiento.
// La idea del usuario: 100 invitados = Bronce, 250 = Plata, y así subiendo
// (cada tramo pide 250 más). `nivelId` enlaza con la escalera de niveles
// (lib/niveles.js), para que invitar suba el MISMO nivel que pagar.
const ESTATUS = [
  { id: 'recluta',    nombre: 'Recluta',    emoji: '🌱', color: '#8bc34a', invitados: 0,    nivelId: null,       frase: 'Empiezas a compartir Whataka.' },
  { id: 'bronce',     nombre: 'Bronce',     emoji: '🥉', color: '#cd7f32', invitados: 100,  nivelId: 'bronce',   frase: 'Ya trajiste a mucha gente.' },
  { id: 'plata',      nombre: 'Plata',      emoji: '🥈', color: '#c0c0c0', invitados: 250,  nivelId: 'plata',    frase: 'Whataka crece contigo.' },
  { id: 'oro',        nombre: 'Oro',        emoji: '🥇', color: '#ffd700', invitados: 500,  nivelId: 'oro',      frase: 'Referente de la comunidad.' },
  { id: 'platino',    nombre: 'Platino',    emoji: '💎', color: '#e5e4e2', invitados: 750,  nivelId: 'platino',  frase: 'Guías a mucha gente.' },
  { id: 'diamante',   nombre: 'Diamante',   emoji: '💠', color: '#b9f2ff', invitados: 1000, nivelId: 'diamante', frase: 'Pilar de la comunidad.' },
  { id: 'legendario', nombre: 'Legendario', emoji: '🔥', color: '#ff5722', invitados: 1500, nivelId: 'diamante', frase: 'Nombre propio en Whataka.' },
];

// Cuántos puntos de estatus da cada persona invitada (alimentan los niveles).
// Referidos es la vía para quien NO puede pagar: cada invitado vale 100 puntos,
// así que con invitar se sube de nivel igual que pagando (1 invitado ≈ 1 $).
const PUNTOS_POR_INVITADO = 100;

/** Estatus que corresponde a un número de invitados. */
function estatusPorInvitados(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  let actual = ESTATUS[0];
  for (const e of ESTATUS) if (k >= e.invitados) actual = e;
  return actual;
}

/** Siguiente estatus, o null si ya está en el máximo. */
function siguienteEstatus(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  return ESTATUS.find((e) => e.invitados > k) || null;
}

/** Progreso hacia el siguiente estatus (para pintar la barra). */
function progresoEstatus(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  const actual = estatusPorInvitados(k);
  const siguiente = siguienteEstatus(k);
  if (!siguiente) {
    return { actual, siguiente: null, faltan: 0, porcentaje: 100 };
  }
  const base = actual.invitados;
  const meta = siguiente.invitados;
  const porcentaje = Math.min(100, Math.round(((k - base) / (meta - base)) * 100));
  return { actual, siguiente, faltan: meta - k, porcentaje };
}

/** Puntos de estatus que aporta tener `n` invitados. */
function puntosPorInvitados(n) {
  return Math.max(0, Math.floor(Number(n) || 0)) * PUNTOS_POR_INVITADO;
}

// Marca corta para compartir el enlace (la última parte del Peer ID).
function codigoInvitacion(peerId) {
  if (!esPeerIdValido(peerId)) return '';
  return peerId.slice(-8);
}

/**
 * Enlace de invitación. `baseUrl` es la dirección donde vive la app; el código
 * viaja como `?ref=<Peer ID>` para que quien lo abra quede vinculado.
 */
function enlaceInvitacion(baseUrl, peerId) {
  if (!esPeerIdValido(peerId)) return '';
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/?ref=${encodeURIComponent(peerId)}`;
}

/**
 * Ordena una lista [{ peerId, count }] por invitados (de mayor a menor) y
 * devuelve la posición (1-based) de `peerId`, o null si no está en la lista.
 */
function posicionEnRanking(peerId, lista) {
  const orden = [...lista].sort((a, b) => b.count - a.count || String(a.peerId).localeCompare(String(b.peerId)));
  const i = orden.findIndex((e) => e.peerId === peerId);
  return i === -1 ? null : i + 1;
}

// Texto que se comparte (sin promesas materiales: solo invitar a la app).
function textoCompartir(peerId, baseUrl) {
  const enlace = enlaceInvitacion(baseUrl, peerId);
  return `Te invito a Whataka, la mensajería cifrada y con llamadas P2P. `
    + `Entra aquí: ${enlace}`;
}

// Mensaje EXACTO que firma el invitado para confirmar que acepta la invitación.
// Debe ser idéntico en el navegador y en el relé, por eso vive aquí. Incluye su
// Peer ID y el del padrino para que la firma no sirva en otro contexto.
function mensajeInvitacion(invitado, padrino) {
  return `Whataka · invitación\nInvitado: ${invitado}\nPadrino: ${padrino}`;
}

const REFERIDOS_API = {
  B58,
  PUNTOS_POR_INVITADO,
  ESTATUS,
  base58,
  esPeerIdValido,
  estatusPorInvitados,
  siguienteEstatus,
  progresoEstatus,
  puntosPorInvitados,
  codigoInvitacion,
  enlaceInvitacion,
  posicionEnRanking,
  textoCompartir,
  mensajeInvitacion,
};

  // Exporta en Node (tests/relé) y en el navegador (app.js). Mismo código.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = REFERIDOS_API;
  } else if (typeof window !== 'undefined') {
    window.WhaTakaReferidos = REFERIDOS_API;
  }
})();
