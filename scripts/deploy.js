'use strict';

/* Despliega el contrato de minería de WhaTaka sin depender de Remix.
 *
 * Uso:
 *   RPC_URL="https://rpc-amoy.polygon.technology" \
 *   DEPLOYER_KEY="0x..." \
 *   REPORT_SIGNER_ADDRESS="0x..." \
 *   node scripts/deploy.js
 *
 * Variables:
 *   RPC_URL                (obligatoria) nodo JSON-RPC de la red destino.
 *   DEPLOYER_KEY           (obligatoria) clave privada que paga el gas.
 *   REPORT_SIGNER_ADDRESS  (obligatoria) dirección del backend que firma vales.
 *   CONTRACT               "ttc" (por defecto) o "rewards".
 *   TTC_TOKEN              solo para CONTRACT=rewards: el ERC-20 a pagar.
 *
 * Para "ttc" (token propio con halving), además:
 *   INITIAL_SUPPLY   WTK de arranque del fondo, en WTK (por defecto 1000000).
 *   HALVING_SECONDS  segundos por época (por defecto 31536000 = 1 año).
 *   REWARD_FACTOR    WTK por punto en la época 0 (por defecto 0.001).
 *   ANNUAL_MINT_CAP  tope de emisión anual, en WTK (por defecto 100000000).
 *
 * Al terminar imprime la dirección y los valores exactos para Render.
 * Requiere haber compilado antes:  npm run compile
 */

const fs = require('node:fs');
const path = require('node:path');

let ethers;
try {
  ethers = require('ethers');
} catch {
  console.error('Falta ethers. Ejecuta: npm install');
  process.exit(1);
}

const ARTIFACTS = path.join(__dirname, '..', 'contracts', 'artifacts');

function artifact(name) {
  const file = path.join(ARTIFACTS, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`No existe ${file}. Ejecuta antes: npm run compile`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`Falta la variable ${name}.`);
    process.exit(1);
  }
  return value;
}

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

async function main() {
  const rpcUrl = required('RPC_URL');
  const deployerKey = required('DEPLOYER_KEY');
  const signerAddress = required('REPORT_SIGNER_ADDRESS');

  if (!isAddress(signerAddress)) {
    console.error('REPORT_SIGNER_ADDRESS no es una dirección válida.');
    process.exit(1);
  }

  const kind = (process.env.CONTRACT || 'ttc').trim().toLowerCase();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(deployerKey, provider);

  const net = await provider.getNetwork();
  const balance = await provider.getBalance(deployer.address);

  console.log('Red          :', net.chainId.toString());
  console.log('Desplegador  :', deployer.address);
  console.log('Saldo gas    :', ethers.formatEther(balance), 'nativo');
  console.log('Firmante     :', signerAddress);
  console.log('');

  if (balance === 0n) {
    console.error('La cuenta no tiene saldo para pagar el gas. Fondea la wallet y reintenta.');
    process.exit(1);
  }

  let factory;
  let args;

  if (kind === 'rewards') {
    const token = required('TTC_TOKEN');
    if (!isAddress(token)) {
      console.error('TTC_TOKEN no es una dirección válida.');
      process.exit(1);
    }
    const art = artifact('WhaTakaMiningRewards');
    factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
    args = [token, signerAddress];
    console.log('Contrato     : WhaTakaMiningRewards');
    console.log('WTK a pagar  :', token);
  } else if (kind === 'ttc') {
    const art = artifact('WhaTakaTTC');
    const initialSupply = ethers.parseUnits(process.env.INITIAL_SUPPLY || '1000000', 18);
    const halvingSeconds = BigInt(process.env.HALVING_SECONDS || '31536000');
    const rewardFactor = ethers.parseUnits(process.env.REWARD_FACTOR || '0.001', 18);
    const annualMintCap = ethers.parseUnits(process.env.ANNUAL_MINT_CAP || '100000000', 18);

    factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
    args = [signerAddress, initialSupply, halvingSeconds, rewardFactor, annualMintCap];

    console.log('Contrato     : WhaTakaTTC');
    console.log('Suministro   :', ethers.formatUnits(initialSupply, 18), 'WTK al fondo');
    console.log('Halving cada :', halvingSeconds.toString(), 's');
    console.log('Factor época0:', ethers.formatUnits(rewardFactor, 18), 'WTK/punto');
    console.log('Tope anual   :', ethers.formatUnits(annualMintCap, 18), 'WTK');
  } else {
    console.error('CONTRACT debe ser "ttc" o "rewards".');
    process.exit(1);
  }

  console.log('\nDesplegando…');
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  console.log('Tx           :', tx.hash);

  const receipt = await tx.wait();
  const address = await contract.getAddress();

  console.log('\n✅ Desplegado en', address);
  console.log('   Bloque:', receipt.blockNumber, '· gas usado:', receipt.gasUsed.toString());

  console.log('\nConfigura esto en Render (servicio whataka-relay → Environment):');
  console.log(`   CHAIN_ID=${net.chainId.toString()}`);
  console.log(`   MINING_CONTRACT=${address}`);
  console.log('   REPORT_SIGNER_KEY=<la clave privada de la dirección firmante>');

  console.log('\nGuarda el despliegue en tu registro:');
  const record = {
    contract: kind,
    address,
    chainId: Number(net.chainId),
    reportSigner: signerAddress,
    txHash: tx.hash,
    block: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
  };
  console.log('  ' + JSON.stringify(record));
}

main().catch((err) => {
  console.error('\nFallo el despliegue:', err.shortMessage || err.message);
  process.exit(1);
});
