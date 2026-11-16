'use strict';

/* Lanzamiento de WTK en Polygon real, en un solo comando.
 *
 * Hace, en orden:
 *   1) Muestra el precio del gas AHORA y el coste estimado del lanzamiento.
 *   2) Despliega WhaTakaTTC (el token WTK).
 *   3) Despliega WhaTakaMiningRewards (el que paga las recompensas).
 *   4) Congela la oferta (autoMintTopUp=false, annualMintCap=0, paused=false).
 *   5) Imprime las variables exactas para Render.
 *
 * Uso (simular, NO gasta nada):
 *   DRY_RUN=1 DEPLOYER_KEY=0x... node scripts/lanzar.js
 *
 * Uso (lanzar de verdad en Polygon mainnet):
 *   DEPLOYER_KEY="0x<clave que paga el gas>" \
 *   REPORT_SIGNER_ADDRESS="0x<direccion del oraculo>" \
 *   node scripts/lanzar.js
 *
 * Variables:
 *   DEPLOYER_KEY           (obligatoria) clave privada que paga el gas y queda dueña.
 *   REPORT_SIGNER_ADDRESS  dirección del oráculo. Si no se da, se usa la del
 *                          despliegador (menos seguro: el dueño firmaría los vales).
 *   RPC_URL                por defecto el RPC público de Polygon mainnet.
 *   DRY_RUN=1              solo estima el gas; no envía ninguna transacción.
 *   INITIAL_SUPPLY, HALVING_SECONDS, REWARD_FACTOR, ANNUAL_MINT_CAP  ver deploy.js.
 *
 * Requiere haber compilado:  npm run compile
 */

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

const ARTIFACTS = path.join(__dirname, '..', 'contracts', 'artifacts');
const DEFAULT_RPC = 'https://polygon-bor-rpc.publicnode.com';

// Umbrales de aviso, en dólares, para que el usuario vea si el gas se dispara.
const AVISO_USD = 0.5;   // avisa si el lanzamiento supera esto
const MAXIMO_USD = 5;    // aborta si supera esto (salvo FORZAR=1)

function artifact(name) {
  const file = path.join(ARTIFACTS, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`No existe ${file}. Ejecuta antes: npm run compile`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function precioPol() {
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/POL-USD/spot');
    const j = await r.json();
    return Number(j.data.amount);
  } catch {
    return null;
  }
}

async function main() {
  const DRY_RUN = process.env.DRY_RUN === '1';
  const FORZAR = process.env.FORZAR === '1';
  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC;
  const key = (process.env.DEPLOYER_KEY || '').trim();
  if (!key) {
    console.error('Falta DEPLOYER_KEY (la clave privada que paga el gas).');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const net = await provider.getNetwork();
  const wallet = new ethers.Wallet(key, provider);
  const signerAddress = (process.env.REPORT_SIGNER_ADDRESS || wallet.address).trim();

  const ttcArt = artifact('WhaTakaTTC');
  const rewArt = artifact('WhaTakaMiningRewards');

  // Parámetros del token (los mismos que la guía de lanzamiento).
  const initialSupply = ethers.parseUnits(process.env.INITIAL_SUPPLY || '100000000', 18);
  const halvingSeconds = BigInt(process.env.HALVING_SECONDS || '31536000');
  const rewardFactor = ethers.parseUnits(process.env.REWARD_FACTOR || '0.001', 18);
  const annualMintCap = ethers.parseUnits(process.env.ANNUAL_MINT_CAP || '100000000', 18);

  console.log('════════════════════════════════════════════════════════════');
  console.log('  Lanzamiento de WhaTaka WTK');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Red          :', net.chainId.toString(), net.chainId === 137n ? '(Polygon mainnet)' : '');
  console.log('RPC          :', rpcUrl);
  console.log('Desplegador  :', wallet.address);
  console.log('Firmante     :', signerAddress);
  console.log('Modo         :', DRY_RUN ? 'SIMULACIÓN (no gasta)' : 'REAL');

  const balance = await provider.getBalance(wallet.address);
  console.log('Saldo gas    :', ethers.formatEther(balance), net.chainId === 137n ? 'POL' : 'nativo');

  // ── 1) Precio del gas y coste estimado ───────────────────────────────
  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas || fee.gasPrice || 0n;
  const gwei = Number(gasPrice) / 1e9;
  const pol = await precioPol();

  const ttcFactory = new ethers.ContractFactory(ttcArt.abi, ttcArt.bytecode);
  const ttcTx = await ttcFactory.getDeployTransaction(
    signerAddress, initialSupply, halvingSeconds, rewardFactor, annualMintCap,
  );
  const rewFactory = new ethers.ContractFactory(rewArt.abi, rewArt.bytecode);
  const rewTx = await rewFactory.getDeployTransaction(ethers.ZeroAddress, signerAddress);

  // gasLimit de respaldo si estimateGas falla (p. ej. el nodo rechaza la simulación).
  const fallback = (data) => 32000n + BigInt((data.length - 2) / 2) * 250n;
  const est = async (data) => {
    try {
      return await provider.estimateGas({ from: wallet.address, data });
    } catch {
      return fallback(data);
    }
  };
  const gasTtc = await est(ttcTx.data);
  const gasRew = await est(rewTx.data);
  const gasConfig = 3n * 120000n; // 3 llamadas onlyOwner
  const gasTotal = gasTtc + gasRew + gasConfig;

  const polTotal = Number(ethers.formatEther(gasTotal * gasPrice));
  const usdTotal = pol ? polTotal * pol : null;

  console.log('\n── Precio del gas AHORA ──');
  console.log(`  gasPrice        : ${gwei.toFixed(2)} gwei`);
  console.log(`  POL             : ${pol ? '$' + pol.toFixed(4) : '(precio no disponible)'}`);
  console.log('\n── Coste estimado del lanzamiento ──');
  console.log(`  desplegar WTK   : ${gasTtc.toString()} gas`);
  console.log(`  desplegar premios: ${gasRew.toString()} gas`);
  console.log(`  congelar oferta : ${gasConfig.toString()} gas`);
  console.log(`  TOTAL           : ${gasTotal.toString()} gas`);
  console.log(`  → ${polTotal.toFixed(4)} ${net.chainId === 137n ? 'POL' : 'nativo'}${usdTotal !== null ? '  ≈ $' + usdTotal.toFixed(4) : ''}`);

  if (net.chainId === 137n && usdTotal !== null) {
    if (usdTotal > MAXIMO_USD && !FORZAR) {
      console.error(`\nEl gas se ha disparado (> $${MAXIMO_USD}). Espera un momento de gas bajo o usa FORZAR=1.`);
      process.exit(1);
    }
    if (usdTotal > AVISO_USD) console.log(`\n⚠  El gas está alto hoy ($${usdTotal.toFixed(2)}). Si esperas, suele bajar a menos de $0.05.`);
  }

  if (balance < gasTotal * gasPrice) {
    console.error(`\nSaldo insuficiente: necesitas ~${polTotal.toFixed(4)} ${net.chainId === 137n ? 'POL' : 'nativo'} y tienes ${ethers.formatEther(balance)}.`);
    console.error('Fondea la wallet y reintenta.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN: no se envió nada. Todo listo para lanzar.');
    return;
  }

  // ── 2) Desplegar el token WTK ────────────────────────────────────────
  console.log('\n[1/3] Desplegando el token WTK…');
  const ttc = new ethers.ContractFactory(ttcArt.abi, ttcArt.bytecode, wallet);
  const token = await ttc.deploy(signerAddress, initialSupply, halvingSeconds, rewardFactor, annualMintCap);
  const tokenTx = token.deploymentTransaction();
  console.log('      tx:', tokenTx.hash);
  await tokenTx.wait();
  const tokenAddress = await token.getAddress();
  console.log('      ✅ WTK en', tokenAddress);

  // ── 3) Desplegar el contrato de recompensas ──────────────────────────
  console.log('\n[2/3] Desplegando el contrato de recompensas…');
  const rew = new ethers.ContractFactory(rewArt.abi, rewArt.bytecode, wallet);
  const rewards = await rew.deploy(tokenAddress, signerAddress);
  const rewTxSent = rewards.deploymentTransaction();
  console.log('      tx:', rewTxSent.hash);
  await rewTxSent.wait();
  const rewardsAddress = await rewards.getAddress();
  console.log('      ✅ Premios en', rewardsAddress);

  // ── 4) Congelar la oferta (configuración "valiosa") ──────────────────
  console.log('\n[3/3] Congelando la oferta (autoMintTopUp=false, annualMintCap=0)…');
  const abi = [
    'function setAutoMintTopUp(bool)',
    'function setAnnualMintCap(uint256)',
    'function setPaused(bool)',
    'function autoMintTopUp() view returns (bool)',
    'function annualMintCap() view returns (uint256)',
    'function paused() view returns (bool)',
    'function totalSupply() view returns (uint256)',
  ];
  const t = new ethers.Contract(tokenAddress, abi, wallet);
  let nonce = await provider.getTransactionCount(wallet.address, 'pending');
  for (const [name, fn] of [
    ['setAutoMintTopUp(false)', () => t.setAutoMintTopUp(false)],
    ['setAnnualMintCap(0)', () => t.setAnnualMintCap(0n)],
    ['setPaused(false)', () => t.setPaused(false)],
  ]) {
    const tx = await fn({ nonce, gasPrice, gasLimit: 120000n });
    console.log(`      ${name}: ${tx.hash}`);
    await tx.wait();
    nonce++;
  }
  console.log('      ✅ Oferta congelada; nadie (ni tú) puede acuñar más.');

  // ── 5) Resumen y variables para Render ───────────────────────────────
  const record = {
    chainId: Number(net.chainId),
    token: tokenAddress,
    rewards: rewardsAddress,
    reportSigner: signerAddress,
    totalSupply: ethers.formatUnits(await t.totalSupply(), 18),
    deployedAt: new Date().toISOString(),
  };
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  ✅ LANZADO');
  console.log('════════════════════════════════════════════════════════════');
  console.log(JSON.stringify(record, null, 2));
  console.log('\nConfigura esto en Render (whataka-relay → Environment):');
  console.log(`   CHAIN_ID=${record.chainId}`);
  console.log(`   MINING_CONTRACT=${tokenAddress}`);
  console.log('   REPORT_SIGNER_KEY=<clave privada de la dirección firmante>');
  console.log('\nSiguiente: abrir el pool WTK/USDC en quickswap.exchange (ver docs/PLAN-LANZAMIENTO.md).');

  const outFile = path.join(__dirname, '..', 'deploy-mainnet.json');
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log('\nGuardado en', outFile);
}

main().catch((err) => {
  console.error('\nFallo el lanzamiento:', err.shortMessage || err.message);
  process.exit(1);
});
