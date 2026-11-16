'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/niveles');

test('el nivel más bajo es Bronce y es gratis', () => {
  const n = N.nivelDe(0);
  assert.equal(n.id, 'bronce');
  assert.equal(n.precioUsd, 0);
});

test('los puntos suben de nivel en el umbral exacto', () => {
  assert.equal(N.nivelDe(499).id, 'bronce');
  assert.equal(N.nivelDe(500).id, 'plata');
  assert.equal(N.nivelDe(1499).id, 'plata');
  assert.equal(N.nivelDe(1500).id, 'oro');
  assert.equal(N.nivelDe(5000).id, 'platino');
  assert.equal(N.nivelDe(15000).id, 'diamante');
});

test('no hay nivel por encima de Diamante', () => {
  assert.equal(N.nivelDe(999999).id, 'diamante');
  assert.equal(N.siguienteNivel(999999), null);
});

test('los puntos negativos o basura cuentan como cero', () => {
  assert.equal(N.nivelDe(-100).id, 'bronce');
  assert.equal(N.nivelDe(NaN).id, 'bronce');
  assert.equal(N.nivelDe(undefined).id, 'bronce');
});

test('el pago da 100 puntos por dólar', () => {
  assert.equal(N.puntosPorPago(5), 500);
  assert.equal(N.puntosPorPago(15), 1500);
  assert.equal(N.puntosPorPago(0), 0);
});

test('un pago de 5 $ sube justo a Plata', () => {
  assert.equal(N.nivelDe(N.puntosPorPago(5)).id, 'plata');
});

test('un pago de 15 $ sube justo a Oro', () => {
  assert.equal(N.nivelDe(N.puntosPorPago(15)).id, 'oro');
});

test('la barra de progreso llega al 100 % en el máximo', () => {
  const p = N.progreso(20000);
  assert.equal(p.porcentaje, 100);
  assert.equal(p.siguiente, null);
  assert.equal(p.faltan, 0);
});

test('la barra de progreso calcula el porcentaje correcto', () => {
  // Entre Bronce (0) y Plata (500), con 250 puntos va por la mitad.
  const p = N.progreso(250);
  assert.equal(p.actual.id, 'bronce');
  assert.equal(p.siguiente.id, 'plata');
  assert.equal(p.porcentaje, 50);
  assert.equal(p.faltan, 250);
});

test('la quema usa la mitad del pago y el precio del WTK', () => {
  // 10 $, mitad = 5 $; a 0,0001 $/WTK son 50.000 WTK.
  assert.equal(N.quemaPorPago(10, 0.0001), 50000);
});

test('sin precio de WTK no se quema nada (no se puede dividir por cero)', () => {
  assert.equal(N.quemaPorPago(10, 0), 0);
  assert.equal(N.quemaPorPago(10, null), 0);
});

test('los beneficios crecen con el nivel', () => {
  assert.ok(N.beneficiosDe(5000).length >= N.beneficiosDe(0).length);
  assert.ok(N.beneficiosDe(0).includes('Con anuncios'));
  assert.ok(N.beneficiosDe(500).includes('Sin anuncios'));
});

test('la escalera es coherente: precios y puntos suben a la vez', () => {
  const l = N.todosLosNiveles();
  for (let i = 1; i < l.length; i += 1) {
    assert.ok(l[i].puntos > l[i - 1].puntos, `${l[i].id} debe pedir más puntos`);
    assert.ok(l[i].precioUsd > l[i - 1].precioUsd, `${l[i].id} debe costar más`);
  }
  // Cada nivel se alcanza con un único pago de su precio.
  for (const n of l) {
    assert.equal(N.nivelDe(N.puntosPorPago(n.precioUsd)).id, n.id);
  }
});
