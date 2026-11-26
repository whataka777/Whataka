'use strict';

/* Simula un cobro de minería contra el contrato, sin gastar gas ni acuñar nada.
 * Comprueba dos cosas: que el contrato acepta el vale firmado por el relé y que
 * rechaza uno firmado por cualquier otra clave.
 *
 * Uso:
 *   REPORT_SIGNER_KEY=0x... node scripts/simular-cobro.js <contrato> [usuario]
 */

const { ethers } = require('ethers');
const voucher = require('../lib/voucher');
const artefacto = require('../contracts/artifacts/WhaTakaTTC.json');

const CONTRATO = process.argv[2];
const USUARIO = process.argv[3] || '0x8416Ca157c5f24c188F06673eBF37FB902B767c2';
const RPC = process.env.RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com';
const CADENA = Number(process.env.CHAIN_ID || 80002);
const CLAVE = process.env.REPORT_SIGNER_KEY;

if (!CONTRATO || !CLAVE) {
  console.error('Uso: REPORT_SIGNER_KEY=0x... node scripts/simular-cobro.js <contrato> [usuario]');
  process.exit(1);
}

const UNIDADES = { relay: 12n, store: 30n, uptime: 60n, call: 4n, reputation: 3n };

(async () => {
  const proveedor = new ethers.JsonRpcProvider(RPC, CADENA, { staticNetwork: true });
  const c = new ethers.Contract(CONTRATO, artefacto.abi, proveedor);

  const reportHash = voucher.reportHashFor('simulacion', Date.now().toString());
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const firmanteContrato = await c.reportSigner();
  const firmanteClave = voucher.signerAddress(CLAVE);

  console.log('contrato            :', CONTRATO);
  console.log('firmante del contrato:', firmanteContrato);
  console.log('clave del servidor  :', firmanteClave);
  console.log('puntos del ejemplo  :', voucher.scoreOf(UNIDADES).toString());
  console.log('recompensa          :', voucher.formatReward(UNIDADES), 'wtk');
  console.log('');

  const vale = voucher.signVoucher(CLAVE, {
    chainId: CADENA, contract: CONTRATO, user: USUARIO,
    reportHash, units: UNIDADES, deadline,
  });

  const cobrar = (firma) => c.claimMiningReward.staticCall(
    reportHash, UNIDADES.relay, UNIDADES.store, UNIDADES.uptime,
    UNIDADES.call, UNIDADES.reputation, deadline, firma, { from: USUARIO },
  );

  try {
    await cobrar(vale);
    console.log('✅ el contrato acepta el vale del relé');
  } catch (e) {
    console.log('❌ el contrato RECHAZÓ el vale del relé:', e.shortMessage || e.message);
    process.exitCode = 1;
  }

  const impostor = ethers.Wallet.createRandom();
  const falso = voucher.signVoucher(impostor.privateKey, {
    chainId: CADENA, contract: CONTRATO, user: USUARIO,
    reportHash, units: UNIDADES, deadline,
  });

  try {
    await cobrar(falso);
    console.log('❌ el contrato aceptó un vale firmado por otra clave');
    process.exitCode = 1;
  } catch (e) {
    console.log('✅ el contrato rechaza un vale firmado por otra clave:', (e.shortMessage || e.message).slice(0, 60));
  }
})().catch((e) => {
  console.error('Error:', e.shortMessage || e.message);
  process.exit(1);
});
