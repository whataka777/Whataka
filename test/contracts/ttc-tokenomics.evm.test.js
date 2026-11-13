'use strict';

/* Prueba de integración de WhaTakaTTC (token ERC-20 + minería sostenible)
 * sobre una EVM real (ganache). Comprueba el halving, el tope anual de
 * emisión, la economía circular y los rechazos de seguridad.
 *
 * Se salta sola si no está ganache instalado o los artefactos no existen:
 *   npm run compile && npm run test:tokenomics
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

const ready = Boolean(ganache && ethers && fs.existsSync(path.join(ARTIFACTS, 'WhaTakaTTC.json')));

const SIGNER_PK = '0x' + '11'.repeat(32);
const CHAIN_ID = 1338;
const EVM_PORT = 18546;

const HALF = 1000n; // segundos por época en los tests
const FACTOR = 10n ** 15n; // 1e15 TTC-wei por punto

const UNITS = { relay: 10n, store: 2n, uptime: 30n, call: 1n, reputation: 5n };
const SCORE = 121n; // 10*5 + 2*8 + 30*1 + 1*10 + 5*3
const REWARD_EPOCH0 = SCORE * FACTOR; // 0.121 TTC

async function expectRevert(promise, match) {
  try {
    await promise;
  } catch (e) {
    const msg = (e.shortMessage || e.message || '').toString().toLowerCase();
    if (match && !msg.includes(match.toLowerCase())) {
      throw new Error(`revirtió con mensaje inesperado: ${msg}`);
    }
    return;
  }
  throw new Error('se esperaba una reversión y no ocurrió');
}

async function nowTs(provider) { return (await provider.getBlock('latest')).timestamp; }

async function advance(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function sign(contract, user, units, reportHash, deadline) {
  return voucher.signVoucher(SIGNER_PK, {
    chainId: CHAIN_ID, contract, user, reportHash, units, deadline,
  });
}

test('WhaTakaTTC: halving, tope anual, economía circular y seguridad', { skip: !ready && 'ganache/artefactos no disponibles' }, async () => {
  const server = ganache.server({
    chain: { chainId: CHAIN_ID },
    logging: { quiet: true },
    wallet: { totalAccounts: 5 },
  });
  await server.listen(EVM_PORT);
  try {
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${EVM_PORT}`);
    const owner = await provider.getSigner(0);
    const user = await provider.getSigner(1);
    const userAddr = await user.getAddress();
    const other = await provider.getSigner(2);

    const art = artifact('WhaTakaTTC');
    const signerAddr = voucher.signerAddress(SIGNER_PK);
    const genesis = ethers.parseUnits('1000', 18);
    const cap = ethers.parseUnits('100', 18); // tope anual: 100 TTC

    const ttc = await new ethers.ContractFactory(art.abi, art.bytecode, owner)
      .deploy(signerAddr, genesis, HALF, FACTOR, cap);
    await ttc.waitForDeployment();
    const addr = await ttc.getAddress();

    // 0. Génesis: 1000 TTC en el pool, sin contar contra el tope anual.
    assert.equal(await ttc.rewardPool(), genesis);
    assert.equal(await ttc.totalSupply(), genesis);
    assert.equal(await ttc.mintedThisYear(), 0n);

    // 1. Halving: la recompensa por punto se parte por la mitad cada época.
    assert.equal(await ttc.rewardFactorAt(0), FACTOR);
    assert.equal(await ttc.rewardFactorAt(1), FACTOR / 2n);
    assert.equal(await ttc.rewardFactorAt(2), FACTOR / 4n);
    assert.equal(await ttc.rewardFactorAt(50), await ttc.minRewardFactor());

    // 2. Reclamo válido en la época 0: paga 0.121 TTC desde el pool (sin acuñar).
    const h0 = voucher.reportHashFor('wt1', 'e0');
    const dl = (await nowTs(provider)) + 600;
    await (await ttc.connect(user).claimMiningReward(
      h0, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl,
      await sign(addr, userAddr, UNITS, h0, dl),
    )).wait();
    assert.equal(await ttc.balanceOf(userAddr), REWARD_EPOCH0);
    assert.equal(await ttc.totalSupply(), genesis, 'no debe acuñar si el pool alcanza');
    assert.equal(await ttc.processedReports(h0), true);

    // 3. Doble gasto: el mismo reportHash se rechaza.
    await expectRevert(ttc.connect(user).claimMiningReward.staticCall(
      h0, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl,
      await sign(addr, userAddr, UNITS, h0, dl),
    ), 'ya procesado');

    // 4. Tras un halving, el mismo score paga la mitad.
    await advance(provider, Number(HALF) + 1); // pasamos a la época 1
    assert.equal(await ttc.currentEpoch(), 1n);
    const h1 = voucher.reportHashFor('wt1', 'e1');
    const dl1 = (await nowTs(provider)) + 600;
    await (await ttc.connect(user).claimMiningReward(
      h1, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl1,
      await sign(addr, userAddr, UNITS, h1, dl1),
    )).wait();
    assert.equal(await ttc.balanceOf(userAddr), REWARD_EPOCH0 + REWARD_EPOCH0 / 2n);
    assert.equal(await ttc.rewardFor(
      UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation,
    ), REWARD_EPOCH0 / 2n);

    // 5. Firma de una clave que no es el oráculo.
    const h2 = voucher.reportHashFor('wt1', 'bad');
    const dl2 = (await nowTs(provider)) + 600;
    const attacker = new ethers.Wallet('0x' + '22'.repeat(32));
    const badSig = await attacker.signMessage(ethers.getBytes(voucher.voucherDigest({
      chainId: CHAIN_ID, contract: addr, user: userAddr, reportHash: h2, units: UNITS, deadline: dl2,
    })));
    await expectRevert(ttc.connect(user).claimMiningReward.staticCall(
      h2, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl2, badSig,
    ), 'oraculo');

    // 6. Vale expirado.
    const past = (await nowTs(provider)) - 10;
    const h3 = voucher.reportHashFor('wt1', 'old');
    await expectRevert(ttc.connect(user).claimMiningReward.staticCall(
      h3, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, past,
      await sign(addr, userAddr, UNITS, h3, past),
    ), 'expirado');

    // 7. Vale de otro usuario: no se puede reutilizar desde otra cuenta.
    await expectRevert(ttc.connect(other).claimMiningReward.staticCall(
      h1, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl1,
      await sign(addr, userAddr, UNITS, h1, dl1),
    ), '');

    // 8. Economía circular: recycleFees mete comisiones en el pool sin acuñar.
    const before = await ttc.rewardPool();
    const supplyBefore = await ttc.totalSupply();
    const fee = ethers.parseUnits('0.05', 18); // el usuario ya tiene saldo por minar
    await (await ttc.connect(user).approve(addr, fee)).wait();
    await (await ttc.connect(user).recycleFees(fee)).wait();
    assert.equal(await ttc.rewardPool(), before + fee);
    assert.equal(await ttc.totalSupply(), supplyBefore, 'reciclar no acuña');

    // 9. Acuñación bajo demanda: si el pool se vacía, se acuña dentro del tope.
    await (await ttc.connect(owner).setAutoMintTopUp(true)).wait();
    // Vaciamos el pool legítimamente rescatando hacia el dueño.
    const poolNow = await ttc.rewardPool();
    await (await ttc.connect(owner).rescueTokens(await owner.getAddress(), poolNow)).wait();
    assert.equal(await ttc.rewardPool(), 0n);

    const h4 = voucher.reportHashFor('wt1', 'topup');
    const dl4 = (await nowTs(provider)) + 600;
    await (await ttc.connect(user).claimMiningReward(
      h4, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl4,
      await sign(addr, userAddr, UNITS, h4, dl4),
    )).wait();
    assert.ok(await ttc.mintedThisYear() > 0n, 'debe acuñar al vaciarse el pool');

    // 10. Tope anual: pedir más de lo que queda en el año revierte.
    const h5 = voucher.reportHashFor('wt1', 'cap');
    const dl5 = (await nowTs(provider)) + 600;
    const hugeUnits = { relay: 10_000_000n, store: 0n, uptime: 0n, call: 0n, reputation: 0n };
    await expectRevert(ttc.connect(user).claimMiningReward.staticCall(
      h5, hugeUnits.relay, hugeUnits.store, hugeUnits.uptime, hugeUnits.call, hugeUnits.reputation, dl5,
      await sign(addr, userAddr, hugeUnits, h5, dl5),
    ), 'tope');

    // 11. Pausa de emergencia: bloquea reclamos.
    await (await ttc.connect(owner).setPaused(true)).wait();
    const h6 = voucher.reportHashFor('wt1', 'paused');
    const dl6 = (await nowTs(provider)) + 600;
    await expectRevert(ttc.connect(user).claimMiningReward.staticCall(
      h6, UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation, dl6,
      await sign(addr, userAddr, UNITS, h6, dl6),
    ), 'pausado');

    // 12. El score on-chain coincide con la librería del backend.
    assert.equal(
      await ttc.scoreOf(UNITS.relay, UNITS.store, UNITS.uptime, UNITS.call, UNITS.reputation),
      voucher.scoreOf(UNITS),
    );
  } finally {
    await server.close();
  }
});

