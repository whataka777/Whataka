'use strict';

/* Donaciones finalistas de WhaTaka.
 *
 * Idea: el usuario puede donar, SI QUIERE, y el destino está CLARO: pagar los
 * costes de mantener la app viva (Render = servidor; Porkbun = dominio). No es
 * una cuota obligatoria ni una inversión: es una donación voluntaria con un fin
 * concreto. Eso es lo más limpio y lo más honesto.
 *
 * Costes reales (2026):
 *   · Render: el servicio `whataka-relay` en plan free cuesta 0 $/mes. Si se sube
 *     a "Starter" para que no se duerma, son 7 $/mes.
 *   · Porkbun: dominio .com a ~11 $/año ≈ 0,92 $/mes.
 *
 * Este módulo es puro: no toca la red ni la cadena, solo calcula.
 */

// Costes mensuales reales de mantener la app viva (en USD).
const COSTES = [
  { id: 'render', nombre: 'Render (servidor)', emoji: '🖥️', usdMes: 7, nota: 'plan Starter, para que no se duerma' },
  { id: 'porkbun', nombre: 'Porkbun (dominio)', emoji: '🌐', usdMes: 0.92, nota: 'dominio .com, ~11 $/año' },
];

// Importes sugeridos, para que el usuario no tenga que pensar.
const IMPORTES_SUGERIDOS = [1, 3, 5, 10];

// Donaciones en WTK: el usuario firma una transferencia ERC-20 directa a la
// cartera del creador. Sin custodia: el token va del usuario al creador en una
// sola transacción, la app no lo toca.
const DECIMALES_WTK = 18;
const IMPORTES_WTK = [100, 500, 1000, 5000];

/** Convierte una cantidad de WTK (humana) a unidades base (wei), con BigInt. */
function aUnidadesWtk(wtk) {
  const n = Math.max(0, Number(wtk) || 0);
  // Se redondea a 9 decimales antes de pasar a BigInt: así el error de coma
  // flotante (0.1 → 0.100000000000000006) no llega a la cadena.
  const [entera, decimal = ''] = n.toFixed(9).split('.');
  const decimalesRellenos = (decimal + '0'.repeat(DECIMALES_WTK)).slice(0, DECIMALES_WTK);
  return BigInt(entera) * 10n ** BigInt(DECIMALES_WTK) + BigInt(decimalesRellenos || '0');
}

/** Formatea una cantidad de WTK para mostrarla (miles con punto, como en es-ES). */
function formatearWtk(wtk) {
  const n = Math.round(Number(wtk) || 0);
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} WTK`;
}

const usd = (n) => `$${n.toFixed(2)}`;

/** Coste total mensual de mantener la app viva. */
function costeMensual() {
  return COSTES.reduce((s, c) => s + c.usdMes, 0);
}

/** Coste total anual (12 meses). */
function costeAnual() {
  return costeMensual() * 12;
}

/**
 * ¿Cuántos meses de app cubre una donación de `importe` dólares?
 * @returns {{meses:number, cubreTodo:boolean, restante:number}}
 */
function mesesCubiertos(importe) {
  const total = Math.max(0, Number(importe) || 0);
  const mensual = costeMensual();
  // Redondeo a 9 decimales para evitar que la coma flotante dé 11,9999 en vez de 12.
  const meses = mensual > 0 ? Number((total / mensual).toFixed(9)) : 0;
  return {
    meses: Math.floor(meses),
    cubreTodo: total >= mensual,
    restante: Math.max(0, total - mensual),
  };
}

/** Texto humano: "3,2 meses" o "cubre 5 meses de la app". */
function textoMeses(importe) {
  const r = mesesCubiertos(importe);
  if (r.meses < 1) {
    const dias = Math.round((r.restante > 0 ? r.restante : (Number(importe) || 0)) / costeMensual() * 30);
    return `cubre ${dias} días de la app`;
  }
  return r.meses === 1 ? 'cubre 1 mes de la app' : `cubre ${r.meses} meses de la app`;
}

/**
 * Reparto de una donación entre los costes, en orden (Render primero).
 * @returns {Array<{id:string,nombre:string,emoji:string,usd:number,completo:boolean}>}
 */
function repartoDe(importe) {
  let resto = Math.max(0, Number(importe) || 0);
  return COSTES.map((c) => {
    const pone = Math.min(resto, c.usdMes);
    resto -= pone;
    return { id: c.id, nombre: c.nombre, emoji: c.emoji, usd: pone, completo: pone >= c.usdMes - 1e-9 };
  });
}

/** Todos los costes, para pintarlos. */
function todosLosCostes() {
  return COSTES.map((c) => ({ ...c }));
}

// Exporta en Node (tests) y en el navegador (app.js). Mismo código, sin duplicar.
// Nombre propio (no `API`) para no chocar con el de niveles.js en el ámbito global.
const DONACIONES_API = {
  COSTES,
  IMPORTES_SUGERIDOS,
  IMPORTES_WTK,
  DECIMALES_WTK,
  aUnidadesWtk,
  formatearWtk,
  costeMensual,
  costeAnual,
  mesesCubiertos,
  textoMeses,
  repartoDe,
  todosLosCostes,
  formatearUsd: usd,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DONACIONES_API;
} else if (typeof window !== 'undefined') {
  window.WhaTakaDonaciones = DONACIONES_API;
}
