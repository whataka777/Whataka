'use strict';

/* Prueba de integración del contrato WhaTakaMiningRewards sobre una EVM real
 * (ganache). Comprueba el camino completo: vale firmado -> transferencia de
 * TTC -> evento RewardPaid, y todos los rechazos de seguridad.
 *
 * Se salta sola si no está ganache instalado o los artefactos no existen:
 *   npm run compile && npm run test:contract
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS = path.join(__dirname, '..', '..', 'contracts', 'artifacts');
const voucher = require('../../lib/voucher');

let ganache;
let ethers;
try {
  ganache = require('ganache');
  ethers = require('ethers');
} catch {
  ganache = null;
}

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${name}.json`), 'utf8'));
}

const ready = Boolean(ganache && ethers && fs.existsSync(path.join(ARTIFACTS, 'WhaTakaMiningRewards.json')));

const SIGNER_PK = '0x' + '11'.repeat(32);
const CHAIN_ID = 1337;
const EVM_PORT = 18545;

// Ejecuta la llamada en modo lectura para que la reversión salga al instante.
async function expectRevert(contract, match, ...args) {
  try {
    await contract.claimMiningReward.staticCall(...args);
  } catch (e) {
    const msg = (e.shortMessage || e.message || '').toString().toLowerCase();
    if (match && !msg.includes(match.toLowerCase())) {
      throw new Error(`revirtió con mensaje inesperado: ${msg}`);
    }
    return;
  }
  throw new Error('se esperaba una reversión y no ocurrió');
}

test('WhaTakaMiningRewards: camino completo y rechazos de seguridad', { skip: !ready && 'ganache/artefactos no disponibles' }, async () => {
  const server = ganache.server({
    chain: { chainId: CHAIN_ID },
    logging: { quiet: true },
    wallet: { totalAccounts: 5 },
  });
  await server.listen(EVM_PORT);
  try {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:' + EVM_PORT + '');
    const owner = await provider.getSigner(0);
    const user = await provider.getSigner(1);
    const userAddr = await user.getAddress();

    const ttcArt = artifact('TestTTC');
    const miningArt = artifact('WhaTakaMiningRewards');

    const ttc = await new ethers.ContractFactory(ttcArt.abi, ttcArt.bytecode, owner).deploy();
    await ttc.waitForDeployment();

    const signerAddr = voucher.signerAddress(SIGNER_PK);
    const mining = await new ethers.ContractFactory(miningArt.abi, miningArt.bytecode, owner)
      .deploy(await ttc.getAddress(), signerAddr);
    await mining.waitForDeployment();
    const miningAddr = await mining.getAddress();

    await (await ttc.mint(miningAddr, ethers.parseUnits('1000', 18))).wait();

    const units = { relay: 10n, store: 2n, uptime: 30n, call: 1n, reputation: 5n };
    const expectedReward = voucher.rewardUnits(units); // 0.121 TTC
    const reportHash = voucher.reportHashFor('wt1testpeer', 'nonce123');
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const sig = voucher.signVoucher(SIGNER_PK, {
      chainId: CHAIN_ID, contract: miningAddr, user: userAddr, reportHash, units, deadline,
    });

    // 1. Reclamo válido: paga exactamente la recompensa calculada.
    const rc = await (await mining.connect(user).claimMiningReward(
      reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, sig,
    )).wait();
    assert.equal(await ttc.balanceOf(userAddr), expectedReward);
    assert.equal(await mining.processedReports(reportHash), true);

    // 2. Evento RewardPaid con el importe correcto.
    const ev = rc.logs
      .map((l) => { try { return mining.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === 'RewardPaid');
    assert.ok(ev, 'debe emitirse RewardPaid');
    assert.equal(ev.args.user, userAddr);
    assert.equal(ev.args.amount, expectedReward);
    assert.equal(ev.args.reportHash, reportHash);

    // 3. Doble gasto: el mismo reportHash se rechaza.
    await expectRevert(mining.connect(user), 'ya procesado',
      reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, sig);

    // 4. Unidades manipuladas (el vale no cubre esos números).
    const h2 = voucher.reportHashFor('wt1testpeer', 'nonce456');
    const sig2 = voucher.signVoucher(SIGNER_PK, {
      chainId: CHAIN_ID, contract: miningAddr, user: userAddr, reportHash: h2, units, deadline,
    });
    await expectRevert(mining.connect(user), 'oraculo',
      h2, 999999n, units.store, units.uptime, units.call, units.reputation, deadline, sig2);

    // 5. Firma de una clave que no es el oráculo.
    const attacker = new ethers.Wallet('0x' + '22'.repeat(32));
    const h3 = voucher.reportHashFor('wt1testpeer', 'nonce789');
    const sig3 = await attacker.signMessage(ethers.getBytes(voucher.voucherDigest({
      chainId: CHAIN_ID, contract: miningAddr, user: userAddr, reportHash: h3, units, deadline,
    })));
    await expectRevert(mining.connect(user), 'oraculo',
      h3, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, sig3);

    // 6. Vale expirado.
    const h4 = voucher.reportHashFor('wt1testpeer', 'nonce000');
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig4 = voucher.signVoucher(SIGNER_PK, {
      chainId: CHAIN_ID, contract: miningAddr, user: userAddr, reportHash: h4, units, deadline: past,
    });
    await expectRevert(mining.connect(user), 'expirado',
      h4, units.relay, units.store, units.uptime, units.call, units.reputation, past, sig4);

    // 7. Vale de otro usuario (no se puede reutilizar desde otra cuenta).
    const other = await provider.getSigner(2);
    await expectRevert(mining.connect(other), '',
      reportHash, units.relay, units.store, units.uptime, units.call, units.reputation, deadline, sig);

    // 8. scoreOf/rewardFor on-chain coinciden con la librería del backend.
    assert.equal(
      await mining.scoreOf(units.relay, units.store, units.uptime, units.call, units.reputation),
      voucher.scoreOf(units),
    );
    assert.equal(
      await mining.rewardFor(units.relay, units.store, units.uptime, units.call, units.reputation),
      expectedReward,
    );

    // 9. Tope por reporte.
    const bigUnits = { relay: 1000000000n, store: 0n, uptime: 0n, call: 0n, reputation: 0n };
    const h5 = voucher.reportHashFor('wt1testpeer', 'noncebig');
    const sig5 = voucher.signVoucher(SIGNER_PK, {
      chainId: CHAIN_ID, contract: miningAddr, user: userAddr, reportHash: h5, units: bigUnits, deadline,
    });
    await expectRevert(mining.connect(user), 'tope',
      h5, bigUnits.relay, bigUnits.store, bigUnits.uptime, bigUnits.call, bigUnits.reputation, deadline, sig5);
  } finally {
    await server.close();
  }
});
