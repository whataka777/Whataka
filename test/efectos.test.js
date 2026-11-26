'use strict';

// El módulo de efectos vive en el navegador, así que aquí se carga en un
// contexto de mentira y se comprueban las partes que no necesitan pantalla: el
// catálogo y los fondos, que se dibujan con un lienzo simulado que apunta lo
// que se le pide. Sirve para que un fondo nuevo no reviente en la cara del
// usuario a mitad de una llamada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'lib', 'efectos.js'), 'utf8');
const ventana = {};
vm.runInNewContext(codigo, { window: ventana, document: { createElement: () => ({}) }, requestAnimationFrame: () => 0, setInterval: () => 0 });

const { FILTROS, FONDOS, pintaFondo } = ventana.WhatakaEfectos;

function lienzoFalso() {
  const llamadas = [];
  const ctx = {
    llamadas,
    createLinearGradient: () => ({ addColorStop: (...a) => llamadas.push(['parada', ...a]) }),
    fillRect: (...a) => llamadas.push(['fillRect', ...a]),
    clearRect: (...a) => llamadas.push(['clearRect', ...a]),
    drawImage: (...a) => llamadas.push(['drawImage', ...a]),
    save: () => llamadas.push(['save']),
    restore: () => llamadas.push(['restore']),
    beginPath: () => llamadas.push(['beginPath']),
    moveTo: (...a) => llamadas.push(['moveTo', ...a]),
    lineTo: (...a) => llamadas.push(['lineTo', ...a]),
    closePath: () => llamadas.push(['closePath']),
    arc: (...a) => llamadas.push(['arc', ...a]),
    fill: () => llamadas.push(['fill']),
    stroke: () => llamadas.push(['stroke']),
  };
  return ctx;
}

test('hay varios fondos y varios filtros, sin identificadores repetidos', () => {
  assert.ok(FONDOS.length >= 6, `fondos: ${FONDOS.length}`);
  assert.ok(FILTROS.length >= 6, `filtros: ${FILTROS.length}`);
  // Cada fila del panel es independiente, así que un id puede repetirse entre
  // fondos y filtros, pero no dentro de la misma fila.
  const fondos = FONDOS.map((x) => x.id);
  const filtros = FILTROS.map((x) => x.id);
  assert.equal(new Set(fondos).size, fondos.length, 'ningún fondo repetido');
  assert.equal(new Set(filtros).size, filtros.length, 'ningún filtro repetido');
  for (const filtro of FILTROS) {
    assert.ok(filtro.nombre, `${filtro.id} tiene nombre`);
    assert.ok(filtro.css, `${filtro.id} tiene filtro CSS`);
    assert.ok(filtro.muestra, `${filtro.id} tiene miniatura`);
  }
});

test('los fondos que se ofrecen saben pintarse', () => {
  for (const fondo of FONDOS) {
    if (fondo.id === 'ninguno') continue;
    const ctx = lienzoFalso();
    assert.doesNotThrow(() => pintaFondo(ctx, fondo.id, null, 112, 112), `${fondo.id} se pinta`);
    const pinta = ctx.llamadas.some((c) => c[0] === 'fillRect' || c[0] === 'drawImage' || c[0] === 'fill');
    assert.ok(pinta, `${fondo.id} deja algo dibujado`);
  }
});

test('un fondo desconocido no rompe: deja el lienzo limpio', () => {
  const ctx = lienzoFalso();
  pintaFondo(ctx, 'inventado', null, 112, 112);
  assert.deepEqual(ctx.llamadas, [['clearRect', 0, 0, 112, 112]]);
});

test('los fondos con vídeo desenfocan el fotograma en vez de taparlo', () => {
  const ctx = lienzoFalso();
  const video = { readyState: 4 };
  pintaFondo(ctx, 'desenfoque', video, 640, 360);
  assert.ok(ctx.llamadas.some((c) => c[0] === 'drawImage' && c[1] === video),
    'se dibuja el vídeo, no un color plano');
  assert.ok(ctx.llamadas.some((c) => c[0] === 'save') && ctx.llamadas.some((c) => c[0] === 'restore'),
    'el desenfoque no se queda pegado al resto del dibujo');
});
