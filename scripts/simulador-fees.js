'use strict';

/* Simulador de comisiones (fees) de un mercado WTK/USDT dentro de la app.
 *
 * Idea del usuario: en vez de quemar, montar una "rueda": permitir comprar y
 * vender WTK dentro de la app, solo contra USDT, y cobrar una comisión.
 *
 * Este script calcula SOLO los ingresos por comisión (la parte fácil).
 * OJO: montar ese mercado en la app es una actividad regulada (ver
 * docs/EXCHANGE-Y-RUEDA.md). Esto es para entender los números, no la legalidad.
 *
 * Uso:  node scripts/simulador-fees.js
 */

const FEE = 0.003; // 0,3 % por operación (como Uniswap/QuickSwap)

function ingresos(usuarios, opsPorUsuarioMes, tamanoMedioUsd) {
  const volumen = usuarios * opsPorUsuarioMes * tamanoMedioUsd;
  return { volumen, ingreso: volumen * FEE };
}

const usd = (n) => `$${Math.round(n).toLocaleString('es')}`;

console.log(`Comisión por operación: ${(FEE * 100).toFixed(1)} %\n`);
console.log('Usuarios  Ops/mes  Ticket   Volumen/mes     Ingreso/mes');
console.log('──────────────────────────────────────────────────────────');
for (const [u, ops, ticket] of [
  [100, 2, 10],
  [1_000, 2, 10],
  [10_000, 3, 20],
  [50_000, 4, 25],
  [100_000, 5, 30],
]) {
  const r = ingresos(u, ops, ticket);
  console.log(
    `${String(u.toLocaleString('es')).padStart(8)}  ${String(ops).padStart(7)}  ${usd(ticket).padStart(6)}   ${usd(r.volumen).padStart(12)}   ${usd(r.ingreso).padStart(11)}`
  );
}

console.log('\nLección: las comisiones solo dan dinero si HAY VOLUMEN.');
console.log('Sin usuarios que compren y vendan, la "rueda" no gira: se queda parada.');
console.log('Y el volumen alto es justo lo que exige licencia (MiCA).');
