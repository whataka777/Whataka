'use strict';

/* Lee el estado real de un token WhaTakaTTC desplegado y comprueba que la clave
 * del servidor es la que el contrato acepta como firmante de vales.
 *
 * Uso:
 *   node scripts/verificar-contrato.js <dirección>
 *   REPORT_SIGNER_KEY=0x... node scripts/verificar-contrato.js <dirección>
 */

const { ethers } = require('ethers');
const artefacto = require('../contracts/artifacts/WhaTakaTTC.json');

const DIRECCION = process.argv[2];
const RPC = process.env.RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com';
const CADENA = Number(process.env.CHAIN_ID || 80002);

if (!DIRECCION || !/^0x[0-9a-fA-F]{40}$/.test(DIRECCION)) {
  console.error('Falta la dirección. Uso: node scripts/verificar-contrato.js 0x...');
  process.exit(1);
}

(async () => {
  const proveedor = new ethers.JsonRpcProvider(RPC, CADENA, { staticNetwork: true });
  const codigo = await proveedor.getCode(DIRECCION);
  if (codigo === '0x') {
    console.error(`En ${DIRECCION} no hay ningún contrato en la cadena ${CADENA}`);
    process.exit(1);
  }

  const c = new ethers.Contract(DIRECCION, artefacto.abi, proveedor);
  const leer = async (fn, ...args) => {
    try { return await c[fn](...args); } catch { return null; }
  };

  const [nombre, simbolo, decimales, suministro, fondo, dueno, firmante, pausado, tope, halving, factor] =
    await Promise.all([
      leer('name'), leer('symbol'), leer('decimals'), leer('totalSupply'),
      leer('balanceOf', DIRECCION), leer('owner'), leer('reportSigner'), leer('paused'),
      leer('annualMintCap'), leer('halvingInterval'), leer('rewardFactor'),
    ]);

  const fmt = (v) => (v === null ? '—' : ethers.formatUnits(v, 18));
  console.log('contrato           :', DIRECCION);
  console.log('red                :', CADENA);
  console.log('código             :', (codigo.length - 2) / 2, 'bytes');
  console.log('nombre             :', nombre);
  console.log('símbolo            :', simbolo);
  console.log('decimales          :', decimales === null ? '—' : decimales.toString());
  console.log('suministro         :', fmt(suministro));
  console.log('fondo del contrato :', fmt(fondo));
  console.log('dueño              :', dueno);
  console.log('firmante de vales  :', firmante);
  console.log('pausado            :', pausado);
  console.log('tope anual         :', fmt(tope));
  console.log('halving            :', halving === null ? '—' : Number(halving) / 86400 + ' días');
  console.log('factor             :', fmt(factor), 'por punto');

  if (process.env.REPORT_SIGNER_KEY) {
    const clave = new ethers.Wallet(process.env.REPORT_SIGNER_KEY).address;
    console.log('');
    console.log('clave del servidor :', clave);
    console.log('¿el contrato la acepta?',
      clave.toLowerCase() === String(firmante).toLowerCase() ? 'SÍ' : 'NO — no podrá pagar vales');
  }
})().catch((e) => {
  console.error('Error:', e.shortMessage || e.message);
  process.exit(1);
});
