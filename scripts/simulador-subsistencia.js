'use strict';

/* ¿Cuánto necesito ingresar para subsistir con la app?
 *
 * Datos reales (2026):
 *   - Cuota de autónomo (tarifa plana): ~80 €/mes los 2 primeros años.
 *   - Comisión de cobro con Stripe: 1,5 % + 0,25 € por pago.
 *
 * Pregunta: con una suscripción de X € al mes, ¿cuántos usuarios necesito
 * para cubrir gastos y sacar un sueldo?
 *
 * Uso:  node scripts/simulador-subsistencia.js
 */

const TARIFA_PLANA = 80; // €/mes de cuota de autónomo (año 1 y 2)
const GESTORIA = 60; // €/mes (contabilidad, orientativo)
const STRIPE_PCT = 0.015;
const STRIPE_FIJO = 0.25;

// Ingreso neto real de una suscripción tras la comisión de Stripe.
function netoPorUsuario(precioMes) {
  return precioMes - (precioMes * STRIPE_PCT + STRIPE_FIJO);
}

function usuariosPara(sueldoDeseado, precioMes) {
  const gastos = TARIFA_PLANA + GESTORIA;
  const neto = netoPorUsuario(precioMes);
  return Math.ceil((sueldoDeseado + gastos) / neto);
}

const eur = (n) => `${Math.round(n).toLocaleString('es')} €`;

console.log('Gastos fijos mensuales: cuota autónomo', eur(TARIFA_PLANA), '+ gestoría', eur(GESTORIA), '=', eur(TARIFA_PLANA + GESTORIA), '\n');
console.log('Con suscripción de 5 €/mes (nivel Plata):');
console.log('  neto por usuario tras Stripe:', netoPorUsuario(5).toFixed(2), '€\n');

console.log('Sueldo que quieres   Usuarios de 5 €/mes necesarios');
console.log('───────────────────────────────────────────────────');
for (const sueldo of [0, 500, 1000, 1500, 2000]) {
  const u = usuariosPara(sueldo, 5);
  const etiqueta = sueldo === 0 ? 'solo cubrir gastos' : `cobrar ${eur(sueldo)}/mes`;
  console.log(`${String(etiqueta).padStart(20)}   ${String(u.toLocaleString('es')).padStart(6)} usuarios`);
}

console.log('\nCon suscripción de 15 €/mes (nivel Oro):');
console.log('  neto por usuario tras Stripe:', netoPorUsuario(15).toFixed(2), '€');
for (const sueldo of [1000, 2000]) {
  console.log(`  para ${eur(sueldo)}/mes → ${usuariosPara(sueldo, 15).toLocaleString('es')} usuarios`);
}

console.log('\nLección: cada usuario de 5 €/mes deja ~4,7 € netos.');
console.log('Para vivir con 1.000 €/mes hacen falta ~240 usuarios de pago.');
console.log('Ese es el objetivo concreto. Sin usuarios, no hay subsistencia.');
