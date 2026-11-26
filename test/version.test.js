'use strict';

// Un número de versión repartido en tres archivos se descuadra en cuanto uno
// se actualiza y otro no: el navegador se queda con el app.js viejo en caché, o
// al revés, y nadie entiende por qué "no se actualiza". Esta prueba los ata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8');

test('index.html, el service worker y app.js dicen la misma versión', () => {
  const index = leer('index.html');
  const sw = leer('sw.js');
  const app = leer('app.js');

  const versiones = [...index.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.ok(versiones.length >= 5, 'los assets de index.html van versionados');
  assert.equal(new Set(versiones).size, 1, `versiones distintas en index.html: ${[...new Set(versiones)]}`);

  const cache = sw.match(/const CACHE = 'whataka-v(\d+)'/);
  assert.ok(cache, 'el service worker declara su caché con versión');

  const build = app.match(/const WHATAKA_BUILD = '(\d+)'/);
  assert.ok(build, 'app.js declara su versión');

  const unica = versiones[0];
  assert.equal(cache[1], unica, 'la caché del service worker va con la misma versión que los assets');
  assert.equal(build[1], unica, 'la versión que se ve en Ajustes es la misma');
});

test('el service worker precarga el módulo de efectos', () => {
  const sw = leer('sw.js');
  assert.match(sw, /'\.\/lib\/efectos\.js'/, 'sin él, sin conexión el lápiz no funciona');
});
