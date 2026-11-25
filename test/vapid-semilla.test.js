'use strict';

// Las claves VAPID derivadas de una semilla tienen que ser válidas de verdad:
// si la privada no casa con la pública, Google y Apple rechazan cada aviso y el
// teléfono no suena nunca. Aquí se comprueba la firma del JWT que viaja en cada
// envío, y que la misma semilla da la misma clave en otro proceso (que es lo
// que hace que un reinicio del relé no rompa las suscripciones).
process.env.VAPID_SEED = 'semilla-de-prueba-whataka';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const push = require('../lib/push');
const webpush = require('web-push');

function puntoAPublicKey(punto) {
  const bytes = Buffer.from(punto, 'base64url');
  assert.equal(bytes.length, 65, 'una clave pública P-256 sin comprimir mide 65 bytes');
  assert.equal(bytes[0], 4, 'va sin comprimir');
  return crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: bytes.subarray(1, 33).toString('base64url'),
      y: bytes.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

test('la semilla da un par VAPID que firma de verdad', () => {
  const publica = push.clavePublica();
  assert.equal(push.efimeras, false, 'con semilla no son claves de usar y tirar');

  // Una suscripción real: par de claves P-256 del móvil y su secreto de 16 bytes.
  const movil = crypto.createECDH('prime256v1');
  movil.generateKeys();
  const suscripcion = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: {
      p256dh: movil.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
  const { headers } = webpush.generateRequestDetails(suscripcion, 'hola');
  const autorizacion = headers.Authorization || headers.authorization;
  assert.match(autorizacion, /^vapid t=/);

  const jwt = autorizacion.slice('vapid t='.length).split(',')[0];
  const [cabecera, cuerpo, firma] = jwt.split('.');
  assert.ok(firma, 'el JWT va firmado');

  const valida = crypto.verify(
    'sha256',
    Buffer.from(`${cabecera}.${cuerpo}`),
    { key: puntoAPublicKey(publica), dsaEncoding: 'ieee-p1363' },
    Buffer.from(firma, 'base64url'),
  );
  assert.equal(valida, true, 'la firma casa con la clave pública que se publica');

  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  assert.equal(datos.aud, 'https://fcm.googleapis.com', 'el aviso va dirigido al servicio push');
  assert.equal(datos.sub, 'mailto:hola@whataka.vip');
});

test('otro arranque con la misma semilla da la misma clave', () => {
  const salida = execFileSync(process.execPath, [
    '-e', "console.log(require('./lib/push').clavePublica())",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, VAPID_SEED: 'semilla-de-prueba-whataka' },
    encoding: 'utf8',
  }).trim();
  assert.equal(salida, push.clavePublica(), 'un reinicio no invalida las suscripciones');
});

test('otra semilla da otra clave', () => {
  const salida = execFileSync(process.execPath, [
    '-e', "console.log(require('./lib/push').clavePublica())",
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, VAPID_SEED: 'otra-semilla-distinta' },
    encoding: 'utf8',
  }).trim();
  assert.notEqual(salida, push.clavePublica());
});
