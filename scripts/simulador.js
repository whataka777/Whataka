'use strict';

/* Simulador del lanzamiento de WTK.
 *
 * Responde a: "si pongo X dinero en el pool, ¿qué precio tiene el WTK, cuánto
 * gana un usuario minando y cuánto dura el fondo?".
 *
 * Hay DOS palancas para que minar valga la pena:
 *   1) El PRECIO del WTK  = USDC en el pool ÷ WTK en el pool.
 *   2) El PAGO por punto  = rewardFactor (WTK por punto de score).
 *
 * Uso:
 *   node scripts/simulador.js
 *   USDC=1000 WTK=5000000 FACTOR=0.05 node scripts/simulador.js
 */

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const REWARD_FACTOR_DEF = 0.001; // WTK por punto (el que trae el contrato)
const FONDO = 90_000_000;        // WTK en el fondo (tras el ensayo)

function scoreOf({ relay, store, uptime, call, reputation }) {
  return relay * 5 + store * 8 + uptime * 1 + call * 10 + reputation * 3;
}
function venta(wtkVendidos, rWtk, rUsdc, feeBps = 30) {
  const inWithFee = wtkVendidos * (10000 - feeBps);
  return (inWithFee * rUsdc) / (rWtk * 10000 + inWithFee);
}

function escenario(titulo, { USDC, WTK, factor, minero, usuarios }) {
  const p0 = USDC / WTK;
  const sc = scoreOf(minero);
  const wtkMes = sc * factor * 30;         // 1 reporte/día durante un mes
  const usdcMes = wtkMes * p0;

  console.log(`\n━━━ ${titulo} ━━━`);
  console.log(`  Pool: ${WTK.toLocaleString()} WTK + ${USDC.toLocaleString()} USDC`);
  console.log(`  Precio WTK: ${p0.toFixed(8)} USDC  ·  Pago: ${factor} WTK/punto`);
  console.log(`  Un usuario activo gana: ${wtkMes.toFixed(0)} WTK/mes = ${usdcMes.toFixed(4)} USDC/mes`);

  const consumoMes = wtkMes * usuarios;
  const meses = FONDO / consumoMes;
  console.log(`  ${usuarios.toLocaleString()} usuarios consumen ${(consumoMes / 1e6).toFixed(2)}M WTK/mes → el fondo dura ${meses < 1 ? (meses * 30).toFixed(0) + ' días' : meses.toFixed(0) + ' meses'}`);

  const fuera = venta(consumoMes, WTK, USDC);
  const pFin = (USDC - fuera) / (WTK + consumoMes);
  console.log(`  Si TODOS venden lo minado: salen ${fuera.toFixed(0)} USDC y el precio cae un ${((1 - pFin / p0) * 100).toFixed(0)} %`);
}

function main() {
  const USDC = num(process.env.USDC, 1000);
  const WTK = num(process.env.WTK, 10000000);
  const usuarios = num(process.env.USUARIOS, 1000);
  const minero = {
    relay: num(process.env.MINERO_RELAY, 100),
    store: num(process.env.MINERO_STORE, 50),
    uptime: num(process.env.MINERO_UPTIME, 1440),
    call: num(process.env.MINERO_CALL, 0),
    reputation: num(process.env.MINERO_REPUTATION, 0),
  };

  console.log('════════════════════════════════════════════════════════');
  console.log('  SIMULADOR DE LANZAMIENTO WTK');
  console.log('════════════════════════════════════════════════════════');
  console.log(`Inversión: ${USDC} USDC · ${usuarios.toLocaleString()} usuarios activos`);
  console.log(`Nodo de ejemplo: ${scoreOf(minero)} puntos por reporte`);

  escenario('A) Configuración ACTUAL del contrato (pago 0,001 WTK/punto)', { USDC, WTK, factor: REWARD_FACTOR_DEF, minero, usuarios });
  for (const f of [0.01, 0.05, 0.1]) {
    escenario(`B) Subiendo el pago a ${f} WTK/punto`, { USDC, WTK, factor: f, minero, usuarios });
  }
  escenario('C) Menos WTK en el pool (precio más alto)', { USDC, WTK: WTK / 5, factor: 0.05, minero, usuarios });

  console.log('\n════════════════════════════════════════════════════════');
  console.log('LECTURA:');
  console.log('· Con 1.000 USDC el precio es bajo: hay que SUBIR el pago por punto');
  console.log('  (rewardFactor) para que minar valga algo.');
  console.log('· Cuanto más pagas, antes se agota el fondo (90M WTK).');
  console.log('· Si los usuarios VENDEN todo, el precio cae. La solución de fondo es');
  console.log('  dar UTILIDAD al WTK dentro de la app (que no quieran venderlo).');
}

main();
