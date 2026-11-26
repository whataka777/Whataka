'use strict';

/* Configuración "valiosa" del token WTK (WhaTakaTTC).
 *
 * Objetivo (petición del usuario): que el token sea MÁS valioso, que el creador
 * NO reciba ganancias, y aun así atraer usuarios. La palanca es la ESCASEZ:
 *
 *   1) autoMintTopUp = false  -> las recompensas salen solo del fondo; nadie se
 *      diluye acuñando de más cuando el fondo se agota.
 *   2) annualMintCap = 0      -> candado duro: NI EL DUEÑO puede acuñar nunca
 *      más. La oferta queda congelada para siempre.
 *   3) paused = false         -> la minería sigue activa para los usuarios.
 *
 * Todas son onlyOwner. El script simula cada llamada (staticCall) antes de
 * enviarla, fija el nonce explícito (encadenar tx seguidas revienta en algunos
 * nodos) y respeta el mínimo de gasPrice de Amoy (25 gwei).
 *
 * Uso:
 *   RPC_URL=... OWNER_KEY=0x... node scripts/config-valor.js
 *   Añade DRY_RUN=1 para solo simular y no enviar nada.
 */

const { ethers } = require('ethers');

const ABI = [
  'function owner() view returns (address)',
  'function autoMintTopUp() view returns (bool)',
  'function annualMintCap() view returns (uint256)',
  'function paused() view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function setAutoMintTopUp(bool enabled)',
  'function setAnnualMintCap(uint256 newCap)',
  'function setPaused(bool isPaused)',
];

async function main() {
  const RPC_URL = process.env.RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com';
  const CONTRACT = process.env.WTK_CONTRACT || '0x57C997a406a0295dEb8A16117969873AAf4B41Fb';
  const KEY = (process.env.OWNER_KEY || '').trim();
  const DRY_RUN = process.env.DRY_RUN === '1';
  const MIN_GWEI = BigInt(process.env.MIN_GAS_PRICE_GWEI || 25);

  if (!KEY) throw new Error('Falta OWNER_KEY (clave privada del dueño del contrato).');

  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(KEY, provider);
  const contract = new ethers.Contract(CONTRACT, ABI, wallet);

  const net = await provider.getNetwork();
  console.log(`Red: ${net.name} (chainId ${net.chainId})`);
  console.log(`Contrato: ${CONTRACT}`);
  console.log(`Firmante: ${wallet.address}`);

  const owner = await contract.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`La clave no es del dueño. owner=${owner} firmante=${wallet.address}`);
  }
  const balance = await provider.getBalance(wallet.address);
  console.log(`Saldo del dueño: ${ethers.formatEther(balance)} POL`);

  console.log('\n--- Estado ANTES ---');
  console.log('autoMintTopUp :', await contract.autoMintTopUp());
  console.log('annualMintCap :', ethers.formatUnits(await contract.annualMintCap(), 18));
  console.log('paused        :', await contract.paused());
  console.log('totalSupply   :', ethers.formatUnits(await contract.totalSupply(), 18));

  const feeData = await provider.getFeeData();
  let gasPrice = feeData.gasPrice || 0n;
  if (gasPrice < MIN_GWEI * 10n ** 9n) gasPrice = MIN_GWEI * 10n ** 9n;
  console.log(`\ngasPrice a usar: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

  const steps = [
    { name: 'setAutoMintTopUp(false)', run: () => contract.setAutoMintTopUp.staticCall(false), send: () => contract.setAutoMintTopUp(false) },
    { name: 'setAnnualMintCap(0)', run: () => contract.setAnnualMintCap.staticCall(0n), send: () => contract.setAnnualMintCap(0n) },
    { name: 'setPaused(false)', run: () => contract.setPaused.staticCall(false), send: () => contract.setPaused(false) },
  ];

  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  for (const step of steps) {
    console.log(`\n>> ${step.name}`);
    await step.run(); // simula; si revierte, se lanza y no se envía nada
    console.log('   simulación OK');
    if (DRY_RUN) {
      console.log('   DRY_RUN: no se envía');
      nonce++;
      continue;
    }
    const tx = await step.send({ nonce, gasPrice, gasLimit: 120000n });
    console.log(`   enviada: ${tx.hash} (nonce ${nonce})`);
    const rc = await tx.wait();
    console.log(`   confirmada en bloque ${rc.blockNumber}`);
    nonce++;
  }

  console.log('\n--- Estado DESPUÉS ---');
  console.log('autoMintTopUp :', await contract.autoMintTopUp());
  console.log('annualMintCap :', ethers.formatUnits(await contract.annualMintCap(), 18));
  console.log('paused        :', await contract.paused());
  console.log('totalSupply   :', ethers.formatUnits(await contract.totalSupply(), 18));
  console.log('\nListo: la oferta queda congelada (nadie puede acuñar) y la minería sigue activa.');
}

main().catch((err) => {
  console.error('\nERROR:', err.shortMessage || err.message);
  process.exit(1);
});
