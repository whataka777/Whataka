'use strict';

// Aquí no se simula el envío: se levanta un servicio push de verdad (HTTPS con
// certificado propio), se suscribe un móvil de verdad y se cuentan los avisos
// que llegan. Es lo que demuestra que el repique sale del relé y que el cuerpo
// va cifrado, que es justo lo que no se puede ver desde el navegador.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const push = require('../lib/push');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function certificado() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whataka-push-'));
  const clave = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', clave, '-out', cert,
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(clave), cert: fs.readFileSync(cert) };
}

function servicioPush() {
  const recibidos = [];
  const servidor = https.createServer(certificado(), (req, res) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      recibidos.push({
        url: req.url,
        cabeceras: req.headers,
        cuerpo: Buffer.concat(trozos),
      });
      res.writeHead(201, { Location: 'https://127.0.0.1/recibo' });
      res.end();
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, recibidos, puerto: servidor.address().port }));
  });
}

function suscripcionDeMentira(puerto, nombre) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://127.0.0.1:${puerto}/push/${nombre}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

test('el aviso llega al servicio push, va firmado y cifrado', async () => {
  const { servidor, recibidos, puerto } = await servicioPush();
  const peer = 'wt1pushbasico';
  assert.equal(push.suscribir(peer, suscripcionDeMentira(puerto, 'basico')), true);

  const entregados = await push.enviar(peer, { tipo: 'llamada', callId: 'c-1', de: 'wt1otro' });
  assert.equal(entregados, 1, 'el servicio push aceptó el aviso');
  assert.equal(recibidos.length, 1);

  const [aviso] = recibidos;
  assert.match(aviso.cabeceras.authorization || '', /^vapid t=/, 'va firmado con VAPID');
  assert.match(aviso.cabeceras['content-encoding'] || '', /aes128gcm/);
  assert.ok(aviso.cuerpo.length > 0, 'el cuerpo lleva el aviso cifrado');
  assert.equal(aviso.cuerpo.includes(Buffer.from('llamada')), false, 'el servicio push no ve el contenido');
  assert.equal(aviso.cabeceras.urgency, 'high', 'se pide entrega inmediata');

  servidor.close();
});

test('el repique manda varios avisos y para cuando se cuelga', async () => {
  const { servidor, recibidos, puerto } = await servicioPush();
  const peer = 'wt1pushrepique';
  push.suscribir(peer, suscripcionDeMentira(puerto, 'repique'));

  const carga = { tipo: 'llamada', callId: 'c-2', de: 'wt1otro' };
  push.repicar(peer, carga, { cada: 120, hasta: 400 });

  await espera(500);
  const durante = recibidos.length;
  assert.ok(durante >= 3, `el móvil recibe varios avisos (llegaron ${durante})`);

  push.pararRepique('c-2');
  await espera(300);
  assert.equal(recibidos.length, durante, 'al colgar dejan de llegar avisos');

  servidor.close();
});

test('una suscripción muerta se descarta sola', async () => {
  const peer = 'wt1pushmuerto';
  // Nadie escucha en ese puerto: el servicio push responde con error de red.
  push.suscribir(peer, suscripcionDeMentira(9, 'muerto'));
  const entregados = await push.enviar(peer, { tipo: 'llamada', callId: 'c-3' });
  assert.equal(entregados, 0);
});
