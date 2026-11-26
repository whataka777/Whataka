'use strict';

/* ENSAYO de liquidez del WTK en una testnet (Amoy).
 *
 * Monta todo el "Paso 2" (mercado) en la red de pruebas, gratis, para que el
 * día del lanzamiento en Polygon real solo haya que repetir con QuickSwap.
 *
 * Qué hace, en orden:
 *   1. Despliega el dólar de prueba TestUSD (TUSD), minteable.
 *   2. Despliega el pool de prueba TestPool(WTK, TUSD).
 *   3. Saca WTK del fondo del contrato (rescueTokens, solo el dueño) para
 *      poder aportarlos como liquidez. El fondo es grande; se retiran pocos.
 *   4. Mintea TUSD de prueba y lo da al dueño.
 *   5. Aprueba y añade liquidez al pool: fija el PRECIO del WTK.
 *   6. Hace una compra de prueba (TUSD -> WTK) y muestra el resultado.
 *
 * Uso:
 *   RPC_URL=... DEPLOYER_KEY=0x... node scripts/ensayo-pool.js
 *   Opcional: WTK_CONTRACT, WTK_FOR_POOL (WTK), TUSD_FOR_POOL (TUSD), DRY_RUN=1
 */

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

const ARTIFACTS = path.join(__dirname, '..', 'contracts', 'artifacts');
function artifact(name) {
  const file = path.join(ARTIFACTS, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`No existe ${file}. Ejecuta antes: npm run compile`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const WTK_ABI = [
  'function owner() view returns (address)',
  'function rescueTokens(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function rewardPool() view returns (uint256)',
];

async function main() {
  const RPC_URL = (process.env.RPC_URL || '').trim();
  const KEY = (process.env.DEPLOYER_KEY || '').trim();
  if (!RPC_URL || !KEY) throw new Error('Faltan RPC_URL y DEPLOYER_KEY.');

  const WTK = (process.env.WTK_CONTRACT || '0x57C997a406a0295dEb8A16117969873AAf4B41Fb').trim();
  const WTK_FOR_POOL = ethers.parseUnits(process.env.WTK_FOR_POOL || '10000000', 18); // 10M WTK
  const TUSD_FOR_POOL = ethers.parseUnits(process.env.TUSD_FOR_POOL || '1000', 18);   // 1000 TUSD

  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(KEY, provider);
  const net = await provider.getNetwork();
  console.log(`Red: chainId ${net.chainId} · Firmante: ${wallet.address}`);
  console.log(`Saldo POL: ${ethers.formatEther(await provider.getBalance(wallet.address))}`);

  const fee = await provider.getFeeData();
  let gasPrice = fee.gasPrice || 0n;
  const MIN = 25n * 10n ** 9n;
  if (gasPrice < MIN) gasPrice = MIN;
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');
  const overrides = () => ({ nonce: nonce++, gasPrice });

  // 1. Desplegar TUSD
  const tusdArt = artifact('TestUSD');
  const tusdFactory = new ethers.ContractFactory(tusdArt.abi, tusdArt.bytecode, wallet);
  const tusd = await tusdFactory.deploy(overrides());
  await tusd.waitForDeployment();
  const TUSD = await tusd.getAddress();
  console.log(`\n1) TUSD (dólar de prueba) desplegado: ${TUSD}`);

  // 2. Desplegar el pool
  const poolArt = artifact('TestPool');
  const poolFactory = new ethers.ContractFactory(poolArt.abi, poolArt.bytecode, wallet);
  const pool = await poolFactory.deploy(WTK, TUSD, overrides());
  await pool.waitForDeployment();
  const POOL = await pool.getAddress();
  console.log(`2) Pool WTK/TUSD desplegado: ${POOL}`);

  // 3. Sacar WTK del fondo (solo el dueño puede)
  const wtk = new ethers.Contract(WTK, WTK_ABI, wallet);
  const owner = await wtk.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`La clave no es del dueño del WTK (owner=${owner}).`);
  }
  console.log(`\n3) Retirando ${ethers.formatUnits(WTK_FOR_POOL, 18)} WTK del fondo…`);
  await (await wtk.rescueTokens(wallet.address, WTK_FOR_POOL, overrides())).wait();
  console.log(`   WTK del dueño ahora: ${ethers.formatUnits(await wtk.balanceOf(wallet.address), 18)}`);

  // 4. Mintear TUSD de prueba
  const TUSD_EXTRA = ethers.parseUnits(process.env.TUSD_EXTRA || '1000', 18); // para poder comprar de prueba
  console.log(`\n4) Minteando ${ethers.formatUnits(TUSD_FOR_POOL + TUSD_EXTRA, 18)} TUSD (${ethers.formatUnits(TUSD_FOR_POOL,18)} para el pool + ${ethers.formatUnits(TUSD_EXTRA,18)} para comprar)…`);
  await (await tusd.mint(wallet.address, TUSD_FOR_POOL + TUSD_EXTRA, overrides())).wait();

  // 5. Aprobar y añadir liquidez
  console.log('\n5) Aprobando y añadiendo liquidez…');
  await (await wtk.approve(POOL, WTK_FOR_POOL, overrides())).wait();
  await (await tusd.approve(POOL, TUSD_FOR_POOL, overrides())).wait();
  await (await pool.addLiquidity(WTK_FOR_POOL, TUSD_FOR_POOL, overrides())).wait();

  const [rw, rb] = await pool.reserves();
  const price = await pool.priceWtkInBase();
  console.log(`   Reservas: ${ethers.formatUnits(rw, 18)} WTK / ${ethers.formatUnits(rb, 18)} TUSD`);
  console.log(`   PRECIO DEL WTK: ${ethers.formatUnits(price, 18)} TUSD`);

  // 6. Compra de prueba
  console.log('\n6) Compra de prueba: 10 TUSD -> WTK…');
  const buy = ethers.parseUnits('10', 18);
  await (await tusd.approve(POOL, buy, overrides())).wait();
  const before = await wtk.balanceOf(wallet.address);
  await (await pool.swapBaseForWtk(buy, overrides())).wait();
  const after = await wtk.balanceOf(wallet.address);
  console.log(`   Recibidos: ${ethers.formatUnits(after - before, 18)} WTK por 10 TUSD`);
  console.log(`   Precio tras la compra: ${ethers.formatUnits(await pool.priceWtkInBase(), 18)} TUSD (sube al comprar)`);

  // 7. Venta de prueba (la mitad de lo comprado)
  const sell = (after - before) / 2n;
  console.log('\n7) Venta de prueba: WTK -> TUSD…');
  await (await wtk.approve(POOL, sell, overrides())).wait();
  const tb = await tusd.balanceOf(wallet.address);
  await (await pool.swapWtkForBase(sell, overrides())).wait();
  const ta = await tusd.balanceOf(wallet.address);
  console.log(`   ${ethers.formatUnits(sell, 18)} WTK -> ${ethers.formatUnits(ta - tb, 18)} TUSD`);
  console.log(`   Precio tras la venta: ${ethers.formatUnits(await pool.priceWtkInBase(), 18)} TUSD (baja al vender)`);

  console.log('\n=== REGISTRO DEL ENSAYO (Amoy) ===');
  console.log(JSON.stringify({
    chainId: Number(net.chainId), WTK, TUSD, POOL,
    liquidez: { wtk: ethers.formatUnits(WTK_FOR_POOL, 18), tusd: ethers.formatUnits(TUSD_FOR_POOL, 18) },
    precioInicialTUSD: ethers.formatUnits(price, 18),
  }, null, 2));
  console.log('\nEn Polygon real, este mismo paso se hace en QuickSwap con USDC de verdad.');
}

main().catch((e) => { console.error('\nERROR:', e.shortMessage || e.message); process.exit(1); });
