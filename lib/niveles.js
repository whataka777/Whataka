'use strict';

/* Niveles de estatus de WhaTaka.
 *
 * La app vende un SERVICIO (una suscripción de pago único) y, con ese dinero,
 * compra WTK en el mercado y los quema. A cambio, el usuario sube de nivel y
 * recibe ventajas. Esto es legal: el usuario compra un servicio, no invierte.
 *
 * Dos fuentes de puntos:
 *   · PAGO: cada dólar pagado da `PUNTOS_POR_USD` puntos (y dispara una quema).
 *   · ACTIVIDAD: usar la app (minar, días activo) también da puntos, para que
 *     quien no paga pueda subir poco a poco.
 *
 * Este módulo es puro: no toca la red ni la cadena, solo calcula.
 */

// Cuántos puntos da cada dólar pagado.
const PUNTOS_POR_USD = 100;

// Fracción de cada pago que se dedica a comprar y quemar WTK.
const FRACCION_QUEMA = 0.5;

// Escalera de niveles. `puntos` es el mínimo acumulado para alcanzarlo.
const NIVELES = [
  {
    id: 'bronce',
    nombre: 'Bronce',
    emoji: '🥉',
    color: '#cd7f32',
    puntos: 0,
    precioUsd: 0,
    beneficios: ['Chat cifrado', 'Llamadas P2P', 'Con anuncios'],
  },
  {
    id: 'plata',
    nombre: 'Plata',
    emoji: '🥈',
    color: '#c0c0c0',
    puntos: 500,
    precioUsd: 5,
    beneficios: ['Sin anuncios', '1 GB de almacén', 'Temas básicos'],
  },
  {
    id: 'oro',
    nombre: 'Oro',
    emoji: '🥇',
    color: '#ffd700',
    puntos: 1500,
    precioUsd: 15,
    beneficios: ['Todo lo de Plata', '5 GB', 'Stickers premium', 'Insignia dorada'],
  },
  {
    id: 'platino',
    nombre: 'Platino',
    emoji: '💎',
    color: '#e5e4e2',
    puntos: 5000,
    precioUsd: 50,
    beneficios: ['Todo lo de Oro', '20 GB', 'Soporte prioritario', 'Insignia animada'],
  },
  {
    id: 'diamante',
    nombre: 'Diamante',
    emoji: '💠',
    color: '#b9f2ff',
    puntos: 15000,
    precioUsd: 150,
    beneficios: ['Todo lo de Platino', '100 GB', 'Funciones exclusivas', 'Voto en la app'],
  },
];

/** Nivel que corresponde a unos puntos acumulados. */
function nivelDe(puntos) {
  const p = Math.max(0, Number(puntos) || 0);
  let actual = NIVELES[0];
  for (const n of NIVELES) {
    if (p >= n.puntos) actual = n;
  }
  return actual;
}

/** Siguiente nivel, o null si ya está en el máximo. */
function siguienteNivel(puntos) {
  const p = Math.max(0, Number(puntos) || 0);
  return NIVELES.find((n) => n.puntos > p) || null;
}

/** Progreso hacia el siguiente nivel (para pintar la barra). */
function progreso(puntos) {
  const p = Math.max(0, Number(puntos) || 0);
  const actual = nivelDe(p);
  const siguiente = siguienteNivel(p);
  if (!siguiente) {
    return { actual, siguiente: null, faltan: 0, porcentaje: 100 };
  }
  const base = actual.puntos;
  const meta = siguiente.puntos;
  const porcentaje = Math.min(100, Math.round(((p - base) / (meta - base)) * 100));
  return { actual, siguiente, faltan: meta - p, porcentaje };
}

/** Puntos que aporta un pago en dólares. */
function puntosPorPago(usd) {
  return Math.round(Math.max(0, Number(usd) || 0) * PUNTOS_POR_USD);
}

/** Cuántos WTK se queman con un pago, dado el precio del WTK en dólares. */
function quemaPorPago(usd, precioWtkUsd) {
  const precio = Number(precioWtkUsd) || 0;
  if (precio <= 0) return 0;
  return (Math.max(0, Number(usd) || 0) * FRACCION_QUEMA) / precio;
}

/** Beneficios que tiene un usuario con esos puntos. */
function beneficiosDe(puntos) {
  return nivelDe(puntos).beneficios;
}

/** Escalera completa, para pintarla en la app. */
function todosLosNiveles() {
  return NIVELES.map((n) => ({ ...n }));
}

// Exporta en Node (tests) y en el navegador (app.js). Mismo código, sin duplicar.
const API = {
  PUNTOS_POR_USD,
  FRACCION_QUEMA,
  NIVELES,
  nivelDe,
  siguienteNivel,
  progreso,
  puntosPorPago,
  quemaPorPago,
  beneficiosDe,
  todosLosNiveles,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.WhaTakaNiveles = API;
}
