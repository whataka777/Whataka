'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const WebSocket = require('ws');
const referidos = require('../lib/referidos');

const PORT = 19876;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;

// Clave de firmante y contrato ficticios para probar los vales de minería.
const TEST_SIGNER_KEY = '0x' + '11'.repeat(32);
const TEST_CHAIN_ID = 80002;
const TEST_CONTRACT = '0x' + 'ab'.repeat(20);
const TEST_DONATION_WALLET = '0x' + 'de'.repeat(20);

let child;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return res.json();
    } catch {
      /* todavía arrancando */
    }
    await wait(200);
  }
  throw new Error('el relé no respondió a /health');
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin mensaje ${type}`)), timeoutMs);
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.t !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

function makePeerId(seed) {
  const digest = crypto.createHash('sha256').update(seed).digest();
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = 'wt1';
  for (const b of digest) out += alphabet[b % alphabet.length];
  return out;
}

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CHAIN_ID: String(TEST_CHAIN_ID),
      MINING_CONTRACT: TEST_CONTRACT,
      REPORT_SIGNER_KEY: TEST_SIGNER_KEY,
      DONATION_WALLET: TEST_DONATION_WALLET,
    },
    stdio: 'ignore',
  });
  await waitForHealth();
});

test.after(() => {
  if (child) child.kill('SIGTERM');
});

test('GET /health responde con estado del relé', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'whataka-relay');
});

test('el relé anuncia los permisos que necesita la app', async () => {
  const res = await fetch(`${BASE}/health`);
  const policy = res.headers.get('permissions-policy') || '';
  assert.match(policy, /camera=\(self\)/);
  assert.match(policy, /microphone=\(self\)/);
  assert.match(policy, /notifications=\(self\)/);
});

test('el relé difunde presencia entre pares', async () => {
  const a = await openSocket();
  const b = await openSocket();

  const idA = makePeerId('peer-a');
  const idB = makePeerId('peer-b');

  a.send(JSON.stringify({ t: 'hello', id: idA, name: 'Alicia', agreePub: 'AAA', signPub: 'SSS' }));

  const presenceA = await nextMessage(b, 'presence');
  assert.ok(presenceA.peers.some((p) => p.id === idA && p.name === 'Alicia'));

  b.send(JSON.stringify({ t: 'hello', id: idB, name: 'Bruno', agreePub: 'BBB', signPub: 'TTT' }));
  const presenceB = await nextMessage(a, 'presence');
  assert.ok(presenceB.peers.some((p) => p.id === idB));

  const res = await fetch(`${BASE}/api/peers`);
  const list = await res.json();
  assert.ok(list.count >= 2);

  a.close();
  b.close();
});

test('getkey entrega la clave pública del par en línea', async () => {
  const a = await openSocket();
  const b = await openSocket();

  const idA = makePeerId('key-a');
  const idB = makePeerId('key-b');

  a.send(JSON.stringify({ t: 'hello', id: idA, name: 'A', agreePub: 'PUB-A', signPub: 'S-A' }));
  await nextMessage(a, 'presence');
  b.send(JSON.stringify({ t: 'hello', id: idB, name: 'B', agreePub: 'PUB-B', signPub: 'S-B' }));
  await nextMessage(b, 'presence');

  a.send(JSON.stringify({ t: 'getkey', id: idB }));
  const key = await nextMessage(a, 'key');
  assert.equal(key.id, idB);
  assert.equal(key.agreePub, 'PUB-B');

  a.send(JSON.stringify({ t: 'getkey', id: makePeerId('nadie') }));
  const missing = await nextMessage(a, 'key');
  assert.equal(missing.agreePub, null);

  a.close();
  b.close();
});

test('el relé reenvía el sobre cifrado sin tocarlo', async () => {
  const a = await openSocket();
  const b = await openSocket();

  const idA = makePeerId('msg-a');
  const idB = makePeerId('msg-b');

  a.send(JSON.stringify({ t: 'hello', id: idA, name: 'A', agreePub: 'P-A', signPub: 'S-A' }));
  await nextMessage(a, 'presence');
  b.send(JSON.stringify({ t: 'hello', id: idB, name: 'B', agreePub: 'P-B', signPub: 'S-B' }));
  await nextMessage(b, 'presence');

  const envelope = { t: 'msg', to: idB, iv: 'aXY=', ct: 'Y2lwaGVydGV4dA==' };
  const received = nextMessage(b, 'msg');
  a.send(JSON.stringify(envelope));

  const delivered = await received;
  assert.equal(delivered.from, idA);
  assert.equal(delivered.iv, envelope.iv);
  assert.equal(delivered.ct, envelope.ct);

  a.close();
  b.close();
});

test('MINING_REPORT con firma ECDSA válida se acepta', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signPub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const unsigned = {
    peerId: makePeerId('miner'),
    signPub,
    relayUnits: 20,
    storeUnits: 10,
    uptimeMinutes: 30,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const signature = crypto
    .sign('sha256', Buffer.from(JSON.stringify(unsigned)), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');

  const res = await fetch(`${BASE}/api/mining/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...unsigned, signature }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.score, 19);
  assert.ok(body.reward > 0);
  assert.equal(body.total.reports, 1);
});

test('MINING_REPORT con firma manipulada se rechaza', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signPub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const unsigned = {
    peerId: makePeerId('cheater'),
    signPub,
    relayUnits: 999999,
    storeUnits: 0,
    uptimeMinutes: 0,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const signature = crypto
    .sign('sha256', Buffer.from(JSON.stringify(unsigned)), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');

  const res = await fetch(`${BASE}/api/mining/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...unsigned, relayUnits: 1, signature }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /firma/i);
});

test('un peerId mal formado no puede entrar al relé', async () => {
  const ws = await openSocket();
  ws.send(JSON.stringify({ t: 'hello', id: 'no-valido', name: 'X' }));
  const code = await new Promise((resolve) => ws.on('close', resolve));
  assert.equal(code, 1008);
});

test('la foto de perfil se difunde solo si es una miniatura JPEG válida', async () => {
  const a = await openSocket();
  const b = await openSocket();

  const idA = makePeerId('foto-a');
  const idB = makePeerId('foto-b');
  const photo = `data:image/jpeg;base64,${'A'.repeat(200)}`;

  const seenByB = nextMessage(b, 'presence');
  a.send(JSON.stringify({ t: 'hello', id: idA, name: 'Con foto', photo, agreePub: 'P-A', signPub: 'S-A' }));
  const presence = await seenByB;
  const peerA = presence.peers.find((p) => p.id === idA);
  assert.equal(peerA.photo, photo);

  // Una foto que no sea JPEG (por ejemplo un SVG) se ignora.
  const seenByA = nextMessage(a, 'presence');
  b.send(JSON.stringify({ t: 'hello', id: idB, name: 'Sin foto', photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', agreePub: 'P-B', signPub: 'S-B' }));
  const presence2 = await seenByA;
  const peerB = presence2.peers.find((p) => p.id === idB);
  assert.equal(peerB.photo, undefined);
  assert.equal(peerB.name, 'Sin foto');

  a.close();
  b.close();
});

test('GET /api/mining/config publica contrato y cadena', async () => {
  const res = await fetch(`${BASE}/api/mining/config`);
  assert.equal(res.status, 200);
  const cfg = await res.json();
  assert.equal(cfg.configured, true);
  assert.equal(cfg.chainId, TEST_CHAIN_ID);
  assert.equal(cfg.contract, TEST_CONTRACT);
  assert.equal(cfg.weights.relay, 5);
  assert.equal(cfg.weights.call, 10);
});

async function registrarCarteraDePrueba(peerId, wallet) {
  const donaciones = require('../lib/donaciones');
  const signature = await wallet.signMessage(
    donaciones.mensajeRegistroCartera(peerId, wallet.address),
  );
  const res = await fetch(`${BASE}/api/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId, address: wallet.address, signature }),
  });
  assert.equal(res.status, 200);
}

test('el vale solo paga las unidades que mide el relé', async () => {
  const voucher = require('../lib/voucher');
  const { ethers } = require('ethers');
  const wallet = ethers.Wallet.createRandom();
  const peerId = makePeerId('minero-honesto');
  const otroId = makePeerId('receptor-honesto');
  await registrarCarteraDePrueba(peerId, wallet);

  const a = await openSocket();
  const b = await openSocket();
  a.send(JSON.stringify({ t: 'hello', id: peerId, name: 'Minero' }));
  b.send(JSON.stringify({ t: 'hello', id: otroId, name: 'Receptor' }));
  await wait(150);
  for (let i = 0; i < 3; i += 1) {
    a.send(JSON.stringify({ t: 'msg', to: otroId, iv: 'iv', ct: 'ct' }));
  }
  await wait(200);

  const res = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // El cliente intenta inflar su trabajo; el relé debe ignorarlo.
    body: JSON.stringify({
      user: wallet.address,
      peerId,
      relayUnits: '1000000000',
      storeUnits: '1000000000',
      uptimeUnits: '1000000000',
      callUnits: '1000000000',
      reputationUnits: '1000000000',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  // Solo los 3 sobres reenviados; el resto de categorías no se pueden medir.
  assert.equal(data.units.relay, '3');
  assert.equal(data.units.store, '0');
  assert.equal(data.score, '15'); // 3 * 5
  assert.equal(data.rewardFormatted, '0.015');
  assert.match(data.reportHash, /^0x[0-9a-f]{64}$/);

  const recovered = ethers.verifyMessage(
    ethers.getBytes(
      voucher.voucherDigest({
        chainId: TEST_CHAIN_ID,
        contract: TEST_CONTRACT,
        user: wallet.address,
        reportHash: data.reportHash,
        units: { relay: 3n, store: 0n, uptime: 0n, call: 0n, reputation: 0n },
        deadline: data.deadline,
      }),
    ),
    data.signature,
  );
  assert.equal(recovered, voucher.signerAddress(TEST_SIGNER_KEY));

  // Un segundo vale inmediato choca con el enfriamiento.
  const again = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: wallet.address, peerId }),
  });
  assert.equal(again.status, 429);
  const cooled = await again.json();
  assert.ok(cooled.retryAfter > 0);

  // Y otra cartera no puede cobrar el trabajo de este nodo.
  const otra = ethers.Wallet.createRandom();
  const robo = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: otra.address, peerId }),
  });
  assert.equal(robo.status, 403);

  a.close();
  b.close();
});

test('GET /api/mining/status publica lo medido y lo pendiente', async () => {
  const peerId = makePeerId('minero-honesto');
  const res = await fetch(`${BASE}/api/mining/status/${peerId}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.units.relay, '3');
  assert.equal(data.claimable.relay, '0'); // ya se cobraron
  assert.ok(data.cooldownSeconds > 0);
});

test('el vale exige que la cartera esté registrada por el nodo', async () => {
  const { ethers } = require('ethers');
  const wallet = ethers.Wallet.createRandom();
  const peerId = makePeerId('sin-cartera');
  const res = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: wallet.address, peerId }),
  });
  assert.equal(res.status, 409);
});

test('el vale rechaza un nodo sin actividad medida', async () => {
  const { ethers } = require('ethers');
  const wallet = ethers.Wallet.createRandom();
  const peerId = makePeerId('ocioso');
  await registrarCarteraDePrueba(peerId, wallet);
  const res = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: wallet.address, peerId }),
  });
  assert.equal(res.status, 400);
});

test('el vale rechaza una dirección de wallet inválida', async () => {
  const res = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'no-es-direccion', relayUnits: '1' }),
  });
  assert.equal(res.status, 400);
});

test('el vale rechaza una petición sin peerId', async () => {
  const res = await fetch(`${BASE}/api/mining/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: '0x' + 'cd'.repeat(20) }),
  });
  assert.equal(res.status, 400);
});

// ── Donaciones: destino y registro de carteras ──────────────────────────────

test('GET /api/donations/config publica la cartera de donaciones', async () => {
  const res = await fetch(`${BASE}/api/donations/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.wallet, TEST_DONATION_WALLET);
  assert.equal(body.configured, true);
  assert.equal(body.chainId, TEST_CHAIN_ID);
});

test('el registro de cartera acepta una firma válida del dueño', async () => {
  const { ethers } = require('ethers');
  const donaciones = require('../lib/donaciones');
  const wallet = ethers.Wallet.createRandom();
  const peerId = makePeerId('cartera-valida');

  const signature = await wallet.signMessage(
    donaciones.mensajeRegistroCartera(peerId, wallet.address),
  );

  const res = await fetch(`${BASE}/api/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId, address: wallet.address, signature }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.wallet.address, wallet.address);

  // Y queda consultable por Peer ID.
  const got = await fetch(`${BASE}/api/wallets/${peerId}`);
  assert.equal(got.status, 200);
  const stored = await got.json();
  assert.equal(stored.wallet.address, wallet.address);
});

test('el registro rechaza una firma que no corresponde a la cartera', async () => {
  const { ethers } = require('ethers');
  const donaciones = require('../lib/donaciones');
  const dueño = ethers.Wallet.createRandom();
  const otro = ethers.Wallet.createRandom();
  const peerId = makePeerId('cartera-ajena');

  // `otro` firma el mensaje, pero decimos que la cartera es la de `dueño`.
  const signature = await otro.signMessage(
    donaciones.mensajeRegistroCartera(peerId, dueño.address),
  );

  const res = await fetch(`${BASE}/api/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId, address: dueño.address, signature }),
  });
  assert.equal(res.status, 400);
});

test('el registro rechaza una firma que apunta a otro Peer ID', async () => {
  const { ethers } = require('ethers');
  const donaciones = require('../lib/donaciones');
  const wallet = ethers.Wallet.createRandom();

  // La firma vale para otro Peer ID, así que no debe valer aquí.
  const signature = await wallet.signMessage(
    donaciones.mensajeRegistroCartera(makePeerId('otro-peer'), wallet.address),
  );

  const res = await fetch(`${BASE}/api/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId: makePeerId('cartera-cross'), address: wallet.address, signature }),
  });
  assert.equal(res.status, 400);
});

test('el registro rechaza Peer ID, cartera o firma mal formados', async () => {
  const bad = [
    { peerId: 'no-es-peer', address: '0x' + 'aa'.repeat(20), signature: '0x' + 'bb'.repeat(65) },
    { peerId: makePeerId('malo-addr'), address: 'no-es-cartera', signature: '0x' + 'bb'.repeat(65) },
    { peerId: makePeerId('mala-firma'), address: '0x' + 'aa'.repeat(20), signature: 'xyz' },
  ];
  for (const body of bad) {
    const res = await fetch(`${BASE}/api/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('consultar una cartera no registrada responde 404', async () => {
  const res = await fetch(`${BASE}/api/wallets/${makePeerId('sin-cartera')}`);
  assert.equal(res.status, 404);
});

// ── Referidos ────────────────────────────────────────────────────────────────

// Crea una identidad real (clave P-256) y su Peer ID, como hace la app:
// sha256(SPKI) en base58 con prefijo "wt1". Así el relé puede comprobar que el
// Peer ID declarado sale de la clave pública.
function makeIdentity(seed) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const signPub = der.toString('base64');
  // Igual que la app: sha256(SPKI) en base58, con prefijo "wt1".
  const digest = crypto.createHash('sha256').update(der).digest();
  const peerId = 'wt1' + referidos.base58(digest);
  return { privateKey, signPub, peerId, seed };
}

function firmaInvitacion(privateKey, mensaje) {
  return crypto
    .sign('sha256', Buffer.from(mensaje), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');
}

async function registrarInvitacion(invitado, padrino, extra = {}) {
  const mensaje = referidos.mensajeInvitacion(invitado.peerId, padrino);
  const body = {
    invitado: invitado.peerId,
    padrino,
    signPub: invitado.signPub,
    signature: firmaInvitacion(invitado.privateKey, mensaje),
    ...extra,
  };
  const res = await fetch(`${BASE}/api/referrals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body };
}

test('un invitado firmado queda registrado y suma al padrino', async () => {
  const padrino = makeIdentity('padrino-1').peerId;
  const invitado = makeIdentity('invitado-1');

  const { res } = await registrarInvitacion(invitado, padrino);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.padrino, padrino);
  assert.equal(data.invitados, 1);
  assert.equal(data.estatus, 'recluta');
  assert.equal(data.puntos, referidos.PUNTOS_POR_INVITADO);

  const consulta = await fetch(`${BASE}/api/referrals/${padrino}`);
  const info = await consulta.json();
  assert.equal(info.invitados, 1);
  assert.equal(info.estatus.id, 'recluta');
  assert.equal(info.posicion, 1);
});

test('el relé rechaza una firma que no es del invitado', async () => {
  const padrino = makeIdentity('padrino-2').peerId;
  const invitado = makeIdentity('invitado-2');
  const ajeno = makeIdentity('ajeno-2');

  // Firma correcta en forma, pero hecha por otra clave.
  const mensaje = referidos.mensajeInvitacion(invitado.peerId, padrino);
  const res = await fetch(`${BASE}/api/referrals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invitado: invitado.peerId,
      padrino,
      signPub: invitado.signPub,
      signature: firmaInvitacion(ajeno.privateKey, mensaje),
    }),
  });
  assert.equal(res.status, 400);
});

test('el relé rechaza un Peer ID que no sale de la clave pública', async () => {
  const padrino = makeIdentity('padrino-3').peerId;
  const invitado = makeIdentity('invitado-3');

  // Clave válida, pero declarando el Peer ID de otra persona.
  const otro = makeIdentity('otro-3');
  const mensaje = referidos.mensajeInvitacion(otro.peerId, padrino);
  const res = await fetch(`${BASE}/api/referrals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invitado: otro.peerId,
      padrino,
      signPub: invitado.signPub,
      signature: firmaInvitacion(invitado.privateKey, mensaje),
    }),
  });
  assert.equal(res.status, 400);
});

test('nadie puede invitarse a sí mismo', async () => {
  const yo = makeIdentity('solo-1');
  const { res } = await registrarInvitacion(yo, yo.peerId);
  assert.equal(res.status, 400);
});

test('un invitado solo puede tener un padrino', async () => {
  const padrinoA = makeIdentity('padrino-4a').peerId;
  const padrinoB = makeIdentity('padrino-4b').peerId;
  const invitado = makeIdentity('invitado-4');

  const primera = await registrarInvitacion(invitado, padrinoA);
  assert.equal(primera.res.status, 200);

  const segunda = await registrarInvitacion(invitado, padrinoB);
  assert.equal(segunda.res.status, 409);
});

test('el ranking ordena por invitados', async () => {
  const padrinoTop = makeIdentity('padrino-top').peerId;
  const padrinoBajo = makeIdentity('padrino-bajo').peerId;

  await registrarInvitacion(makeIdentity('top-i1'), padrinoTop);
  await registrarInvitacion(makeIdentity('top-i2'), padrinoTop);
  await registrarInvitacion(makeIdentity('bajo-i1'), padrinoBajo);

  const res = await fetch(`${BASE}/api/referrals/ranking`);
  const data = await res.json();
  const posTop = data.ranking.find((e) => e.peerId === padrinoTop);
  const posBajo = data.ranking.find((e) => e.peerId === padrinoBajo);
  assert.equal(posTop.invitados, 2);
  assert.ok(posTop.posicion < posBajo.posicion);
});

test('consultar un Peer ID inválido responde 400', async () => {
  const res = await fetch(`${BASE}/api/referrals/no-es-peer`);
  assert.equal(res.status, 400);
});

// ── Dominio único ────────────────────────────────────────────────────────────
// La identidad vive en localStorage, que es por origen: si la app responde en
// dos direcciones, cada una crea un Peer ID distinto. Las páginas que llegan
// por el subdominio de Render deben acabar en whataka.vip; el WebSocket y la
// API no se tocan, porque la app de GitHub Pages depende de ellos.
function pedirCon(host, ruta, accept) {
  return new Promise((resolve, reject) => {
    const { request } = require('node:http');
    const req = request(
      { host: '127.0.0.1', port: PORT, path: ruta, method: 'GET', headers: { host, accept } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('una página pedida por el subdominio de Render va al dominio propio', async () => {
  const res = await pedirCon('whataka-relay.onrender.com', '/index.html?x=1', 'text/html,*/*');
  assert.equal(res.status, 301);
  assert.equal(res.location, 'https://whataka.vip/index.html?x=1');
});

test('los archivos estáticos del subdominio de Render no se redirigen', async () => {
  const res = await pedirCon('whataka-relay.onrender.com', '/app.js', '*/*');
  assert.equal(res.status, 200);
});

test('el WebSocket y la API no se redirigen aunque pidan HTML', async () => {
  const relay = await pedirCon('whataka-relay.onrender.com', '/relay', 'text/html');
  const api = await pedirCon('whataka-relay.onrender.com', '/api/ice', 'text/html');
  assert.notEqual(relay.status, 301);
  assert.notEqual(api.status, 301);
});

test('el dominio propio sirve la app sin redirección', async () => {
  const res = await pedirCon('whataka.vip', '/', 'text/html');
  assert.equal(res.status, 200);
});
