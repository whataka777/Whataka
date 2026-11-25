'use strict';

/* Valida un token de minería de Whataka contra la blockchain, sin webs de
 * terceros y sin desplegar nada: solo llamadas JSON-RPC al nodo.
 *
 *   node scripts/validar-token.cjs [dirección]
 *
 * Por defecto valida el token Whataka WTK de Polygon Amoy. Si existe la clave
 * del oráculo en /workspace/.whataka-keys/signer.key, además simula un cobro
 * (eth_call) para comprobar que el pago funcionaría de verdad.
 */

const { ethers } = require('ethers');
const fs = require('node:fs');

const CONTRACT = process.argv[2] || '0x7FC7502fC87e36ab08846C193264182805b5F536';
const SIGNER_KEY_FILE = '/workspace/.whataka-keys/signer.key';
const CHAIN = 80002;

const RPCS = {
  137: 'https://polygon-bor-rpc.publicnode.com',
  56: 'https://bsc-dataseed.binance.org',
  80002: 'https://polygon-amoy-bor-rpc.publicnode.com',
  1: 'https://ethereum-rpc.publicnode.com',
};
const NET = { 137: 'Polygon mainnet', 56: 'BSC', 80002: 'Polygon Amoy', 1: 'Ethereum' };
const SEP = '\n' + '─'.repeat(60) + '\n';

const ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function rewardPool() view returns (uint256)',
  'function reportSigner() view returns (address)',
  'function owner() view returns (address)',
  'function rewardFactor() view returns (uint256)',
  'function paused() view returns (bool)',
  'function rewardFor(uint256,uint256,uint256,uint256,uint256) view returns (uint256)',
  'function claimMiningReward(bytes32,uint256,uint256,uint256,uint256,uint256,uint256,bytes)',
];

const fmt = (v) => ethers.formatUnits(v, 18);

async function codeLen(chain, addr) {
  try {
    const code = await new ethers.JsonRpcProvider(RPCS[chain]).getCode(addr);
    return code && code !== '0x' ? code.length : 0;
  } catch (err) {
    return 'ERROR: ' + (err.shortMessage || err.message);
  }
}

async function main() {
  console.log('\n🔎 VALIDACIÓN DEL TOKEN Whataka CONTRA LA BLOCKCHAIN');
  console.log('   Contrato:', CONTRACT);
  console.log(SEP);

  console.log('PASO 1 y 2 — ¿Existe el contrato? (eth_getCode)');
  for (const chain of [80002, 137, 56, 1]) {
    const n = await codeLen(chain, CONTRACT);
    const ok = typeof n === 'number' && n > 0;
    const detalle = typeof n === 'number' ? (n ? `${n} chars de bytecode` : '0x → NO existe') : n;
    console.log(`  ${ok ? '✅' : '❌'} ${NET[chain].padEnd(16)} (chainId ${String(chain).padEnd(5)})  ${detalle}`);
  }
  console.log(SEP);

  const provider = new ethers.JsonRpcProvider(RPCS[CHAIN]);
  const c = new ethers.Contract(CONTRACT, ABI, provider);

  console.log(`PASO 3 — Metadatos reales (${NET[CHAIN]})`);
  for (const fn of ['name', 'symbol', 'decimals', 'totalSupply']) {
    try {
      const v = await c[fn]();
      console.log(`  ✅ ${fn}() = ${fn === 'totalSupply' ? fmt(v) + ' (unidades base: ' + v + ')' : v}`);
    } catch (err) {
      console.log(`  ❌ ${fn}() → ${(err.shortMessage || err.message).slice(0, 70)}`);
    }
  }
  console.log(SEP);

  console.log('PASO 4 — Checksum EIP-55 de la dirección');
  try {
    console.log('  ✅ Normalizada:', ethers.getAddress(CONTRACT));
  } catch (err) {
    console.log('  ❌', (err.shortMessage || err.message).slice(0, 70));
  }
  console.log(SEP);

  console.log('PASO 5 — Fondo de recompensas (¿ha pagado algo?)');
  let rewardPool = null;
  let totalSupply = null;
  try {
    rewardPool = await c.rewardPool();
    totalSupply = await c.totalSupply();
    const paid = totalSupply - rewardPool;
    console.log('  ✅ rewardPool()  =', fmt(rewardPool), 'WTK');
    console.log('  ✅ totalSupply() =', fmt(totalSupply), 'WTK');
    console.log(`  ${paid === 0n ? '⚠️' : '✅'} WTK pagados    = ${fmt(paid)} WTK`);
    console.log(`  → ${paid === 0n ? 'Nunca se ha pagado nada todavía' : 'Ya se han pagado recompensas'}`);
  } catch (err) {
    console.log('  ❌ →', (err.shortMessage || err.message).slice(0, 70));
  }
  console.log(SEP);

  console.log('PASO 6 — ¿Coincide el oráculo del contrato con el de nuestro backend?');
  let reportSigner = null;
  let ourSigner = null;
  try { reportSigner = await c.reportSigner(); } catch { /* opcional */ }
  try { ourSigner = new ethers.Wallet(fs.readFileSync(SIGNER_KEY_FILE, 'utf8').trim()).address; } catch { /* opcional */ }
  console.log('  reportSigner del contrato   :', reportSigner || '(no legible)');
  console.log('  Firmante de nuestro backend :', ourSigner || '(clave local no disponible)');
  const oracleOk = reportSigner && ourSigner && reportSigner.toLowerCase() === ourSigner.toLowerCase();
  if (reportSigner && ourSigner) {
    console.log(oracleOk ? '  ✅ COINCIDEN → el contrato aceptará nuestros vales'
      : '  ❌ NO coinciden → ningún cobro pasaría');
  }
  for (const fn of ['owner', 'rewardFactor', 'paused']) {
    try {
      const v = await c[fn]();
      console.log(`  ✅ ${fn.padEnd(12)} = ${fn === 'rewardFactor' ? fmt(v) : v}`);
    } catch { /* la vista puede no existir */ }
  }
  console.log(SEP);

  console.log('PASO 7 — Simulación de pago real (eth_call, sin gas)');
  if (!oracleOk) {
    console.log('  ⚠️ Omitida: el oráculo del contrato no coincide con el de este backend.');
    console.log(SEP);
    return;
  }
  const voucher = require('../lib/voucher.js');
  const units = { relay: 10n, store: 5n, uptime: 60n, call: 2n, reputation: 4n };
  const user = '0x000000000000000000000000000000000000dEaD';
  const reportHash = voucher.reportHashFor('wt1validacion', 'v' + Date.now());
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const key = fs.readFileSync(SIGNER_KEY_FILE, 'utf8').trim();
  const sig = voucher.signVoucher(key, {
    chainId: CHAIN, contract: CONTRACT, user, reportHash, units, deadline,
  });

  console.log('  Importe que pagaría rewardFor(...) =', fmt(
    await c.rewardFor(units.relay, units.store, units.uptime, units.call, units.reputation),
  ), 'WTK');

  // El remitente de la simulación tiene que ser el mismo usuario del vale: el
  // contrato comprueba la firma contra msg.sender.
  const args = [
    reportHash, units.relay, units.store, units.uptime,
    units.call, units.reputation, deadline, sig,
  ];
  try {
    await c.claimMiningReward.staticCall(...args, { from: user });
    console.log('  ✅ La simulación NO revierte → el pago FUNCIONARÍA de verdad');
  } catch (err) {
    console.log('  ❌ Revierte →', err.reason || err.shortMessage || err.message);
  }

  const bad = sig.slice(0, -4) + (sig.endsWith('00') ? '11' : '00');
  try {
    await c.claimMiningReward.staticCall(
      reportHash, units.relay, units.store, units.uptime,
      units.call, units.reputation, deadline, bad, { from: user },
    );
    console.log('  ❌ ALARMA: aceptó una firma manipulada');
  } catch (err) {
    console.log('  ✅ Una firma manipulada se RECHAZA →', (err.reason || err.shortMessage || err.message).slice(0, 45));
  }
  console.log(SEP);
}

main().catch((err) => {
  console.error('Falló la validación:', err.message);
  process.exit(1);
});
