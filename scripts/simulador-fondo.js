'use strict';

/* ¿Cuánto dura el fondo de minería de WTK?
 *
 * Datos reales leídos de la blockchain (Amoy, 2026-11-16):
 *   totalSupply   = 100.000.000 WTK
 *   fondo (pool)  =  90.000.000 WTK
 *   annualMintCap = 0            -> NADIE puede acuñar más, nunca
 *   autoMintTopUp = false        -> si el fondo se vacía, el minado se PARA
 *   rewardFactor  = 0,001 WTK por punto (se parte por la mitad cada año)
 *
 * Uso:  node scripts/simulador-fondo.js
 */

const FONDO = 90_000_000;
const FACTOR_INICIAL = 0.001;
const PUNTOS_POR_USUARIO_DIA = 2340; // puntos por un reporte diario (medido)
const DIAS_ANIO = 365;

function duracion(usuarios) {
  let factor = FACTOR_INICIAL;
  let restante = FONDO;
  let dias = 0;
  for (let anio = 0; anio < 300; anio++) {
    const wtkDia = usuarios * PUNTOS_POR_USUARIO_DIA * factor;
    const wtkAnio = wtkDia * DIAS_ANIO;
    if (wtkAnio >= restante) {
      dias += restante / wtkDia;
      return { anos: dias / DIAS_ANIO, texto: formatear(dias) };
    }
    restante -= wtkAnio;
    dias += DIAS_ANIO;
    factor /= 2;
  }
  return { anos: Infinity, texto: 'nunca (más de 300 años)' };
}

function formatear(dias) {
  if (dias < 60) return `${Math.round(dias)} días`;
  if (dias < DIAS_ANIO * 2) return `${(dias / DIAS_ANIO).toFixed(1)} años`;
  return `${Math.round(dias / DIAS_ANIO)} años`;
}

console.log('Fondo actual: 90.000.000 WTK (de los 100M). Tope de emisión: 0 (congelado).\n');
console.log('Usuarios activos  →  el fondo se agota en');
console.log('──────────────────────────────────────────');
for (const u of [100, 1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000]) {
  const r = duracion(u);
  const aviso = r.anos < 5 ? '  ⚠️  el minado se pararía' : '';
  console.log(`${String(u.toLocaleString('es')).padStart(12)}  →  ${r.texto}${aviso}`);
}
console.log('\nClave: el halving anual salva el fondo con pocos usuarios.');
console.log('Con muchos usuarios (100.000+), el fondo se agota en ~1 año y el');
console.log('minado se detiene (cap=0, autoMintTopUp=false). Hay que rellenarlo.');
