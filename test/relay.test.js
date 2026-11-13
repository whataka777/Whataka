'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 19876;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;

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
    env: { ...process.env, PORT: String(PORT) },
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
