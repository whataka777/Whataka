'use strict';

// El relé debe exponer los servidores ICE y reenviar la señalización de
// llamadas sin ver nunca el audio ni el vídeo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 10191;

function arranca(env = {}) {
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: 'ignore',
  });
  return child;
}

async function esperaSalud(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el relé no arrancó');
}

test('GET /api/ice devuelve STUN por defecto', async () => {
  const srv = arranca();
  try {
    await esperaSalud();
    const r = await fetch(`http://localhost:${PORT}/api/ice`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.iceServers) && data.iceServers.length >= 1);
    const urls = data.iceServers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    assert.ok(urls.some((u) => String(u).startsWith('stun:')));
  } finally {
    srv.kill();
  }
});

test('GET /api/ice incluye TURN cuando se configura por entorno', async () => {
  const srv = arranca({
    ICE_TURN_URL: 'turn:relay.example:3478',
    ICE_TURN_USERNAME: 'usuario',
    ICE_TURN_CREDENTIAL: 'secreto',
  });
  try {
    await esperaSalud();
    const r = await fetch(`http://localhost:${PORT}/api/ice`);
    const data = await r.json();
    const turn = data.iceServers.find((s) => JSON.stringify(s.urls).includes('turn:'));
    assert.ok(turn, 'debe haber un servidor TURN');
    assert.equal(turn.username, 'usuario');
    assert.equal(turn.credential, 'secreto');
  } finally {
    srv.kill();
  }
});
