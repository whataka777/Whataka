'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// solc guarda las cadenas largas desplazadas un bit a la derecha y las recoloca
// con SHL al compilar, así que para buscarlas hay que hacer lo mismo.
function comoLaCompilaSolc(texto) {
  const n = BigInt('0x' + Buffer.from(texto, 'utf8').toString('hex')) >> 1n;
  return n.toString(16).padStart(Buffer.byteLength(texto) * 2, '0');
}

test('el token se llama whataka coin y su símbolo es wtk, en minúscula', () => {
  const fuente = leer('contracts/WhaTakaTTC.sol');
  assert.match(fuente, /name\s*=\s*"whataka coin"/);
  assert.match(fuente, /symbol\s*=\s*"wtk"/);
  assert.doesNotMatch(fuente, /"WhaTaka Coin"/);
});

test('el bytecode compilado lleva el nombre nuevo', () => {
  const art = JSON.parse(leer('contracts/artifacts/WhaTakaTTC.json'));
  assert.ok(art.bytecode.toLowerCase().includes(comoLaCompilaSolc('whataka coin')),
    'el bytecode debe contener "whataka coin"');
  assert.ok(!art.bytecode.toLowerCase().includes(comoLaCompilaSolc('WhaTaka Coin')),
    'el bytecode no debe contener el nombre viejo');
});

test('contract-artifact.js está sincronizado con el artefacto', () => {
  const art = JSON.parse(leer('contracts/artifacts/WhaTakaTTC.json'));
  const embebido = leer('contract-artifact.js');
  assert.ok(embebido.includes(art.bytecode.slice(2, 200)), 'el bytecode embebido debe ser el compilado');
  assert.ok(embebido.includes('window.WHATAKA_TTC_ARTIFACT'));
});

test('la página de despliegue viene lista para que el usuario sea el dueño', () => {
  const html = leer('deploy.html');
  assert.match(html, /value="0x2a7F39bDF3dAe21c240536C4d26c05De0087127a"/, 'firmante del relé por defecto');
  assert.match(html, /id="in-supply" value="100000000"/, 'fondo inicial de 100 millones');
  assert.match(html, /dueña/i, 'tiene que avisar de quién queda como dueño');
  assert.match(html, /Coste estimado/, 'muestra el coste antes de firmar');
  assert.match(html, /whataka coin/, 'muestra el nombre nuevo');
  assert.match(html, /portal\.polygon\.technology\/faucet/, 'enlaza un grifo que funciona');
  assert.match(html, /receipt\.contractAddress/, 'la dirección sale del recibo de la cadena');
});

test('la página de despliegue no lleva ninguna clave privada', () => {
  const sinBytecode = leer('contract-artifact.js').replace(/"bytecode": "0x[0-9a-f]+"/, '"bytecode": ""');
  const clave = /0x[0-9a-fA-F]{64}/;
  assert.ok(!clave.test(leer('deploy.html')), 'deploy.html no debe contener claves');
  assert.ok(!clave.test(sinBytecode), 'contract-artifact.js no debe contener claves fuera del bytecode');
});

test('el servidor publica la página de despliegue', () => {
  assert.match(leer('server.js'), /'\/deploy\.html'/);
});
