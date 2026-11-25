'use strict';

// Un relé guardado que el navegador no puede usar (http:// en una página https,
// localhost desde el móvil, texto suelto) dejaba la app "desconectada" para
// siempre y sin aviso: las llamadas ni siquiera podían sonar.

const test = require('node:test');
const assert = require('node:assert/strict');
const relayUrl = require('../lib/relay-url');

const OFICIAL = 'https://whataka-relay.onrender.com';

test('sin valor guardado se usa el relé oficial', () => {
  assert.equal(relayUrl.normalizar('', { protocolo: 'https:', oficial: OFICIAL }), '');
  assert.equal(relayUrl.normalizar(null, { protocolo: 'https:', oficial: OFICIAL }), '');
});

test('un relé propio por https se respeta', () => {
  assert.equal(
    relayUrl.normalizar('https://mi-rele.example.com/', { protocolo: 'https:', oficial: OFICIAL }),
    'https://mi-rele.example.com',
  );
});

test('http:// se sube a https:// en una página https (contenido mixto)', () => {
  assert.equal(
    relayUrl.normalizar('http://mi-rele.example.com', { protocolo: 'https:', oficial: OFICIAL }),
    'https://mi-rele.example.com',
  );
  assert.equal(
    relayUrl.normalizar('http://localhost:10000', { protocolo: 'https:', oficial: OFICIAL }),
    '',
  );
});

test('localhost y loopback no valen desde otro dispositivo', () => {
  for (const local of ['http://localhost:10000', 'https://127.0.0.1:8080', 'http://0.0.0.0:3000', 'http://[::1]:9000']) {
    assert.equal(relayUrl.normalizar(local, { protocolo: 'https:', oficial: OFICIAL }), '', local);
    assert.equal(relayUrl.esLocal(local), true, local);
  }
});

test('una dirección sin esquema no se acepta', () => {
  assert.equal(relayUrl.normalizar('whataka-relay.onrender.com', { protocolo: 'https:', oficial: OFICIAL }), '');
  assert.match(relayUrl.motivoAjuste('whataka-relay.onrender.com', { protocolo: 'https:', oficial: OFICIAL }), /http/);
});

test('guardar la dirección oficial equivale a no guardar nada', () => {
  const conBarras = `${OFICIAL}/`;
  assert.equal(relayUrl.normalizar(conBarras, { protocolo: 'https:', oficial: OFICIAL }), '');
  assert.equal(relayUrl.motivoAjuste(conBarras, { protocolo: 'https:', oficial: OFICIAL }), '');
});

test('avisa cuando hay que cambiar http:// por https://', () => {
  assert.match(
    relayUrl.motivoAjuste('http://mi-rele.example.com', { protocolo: 'https:', oficial: OFICIAL }),
    /https/,
  );
  assert.match(
    relayUrl.motivoAjuste('http://localhost:10000', { protocolo: 'https:', oficial: OFICIAL }),
    /local/,
  );
});

test('en desarrollo (página local) sí se acepta un relé local', () => {
  const opciones = { protocolo: 'http:', oficial: OFICIAL, permiteLocal: true };
  assert.equal(relayUrl.normalizar('http://localhost:10000', opciones), 'http://localhost:10000');
  assert.equal(relayUrl.analizar('http://localhost:10000', opciones).utilizable, true);
});

test('analizar distingue una dirección inservible de una válida', () => {
  const opciones = { protocolo: 'https:', oficial: OFICIAL };
  const mala = relayUrl.analizar('localhost:10000', opciones);
  assert.equal(mala.utilizable, false);
  const buena = relayUrl.analizar('https://mi-rele.example.com', opciones);
  assert.equal(buena.utilizable, true);
  assert.equal(buena.url, 'https://mi-rele.example.com');
  const oficial = relayUrl.analizar(OFICIAL, opciones);
  assert.equal(oficial.utilizable, true);
  assert.equal(oficial.url, '');
});
