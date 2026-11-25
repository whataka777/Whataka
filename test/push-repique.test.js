'use strict';

// El repique es lo que hace que el teléfono suene como un teléfono: un aviso
// push cada pocos segundos mientras la llamada espera. Aquí se comprueba el
// ciclo de vida con temporizadores reales y sin suscripciones: los avisos no
// salen a ningún sitio, pero el bucle y sus paradas son los de verdad.
const test = require('node:test');
const assert = require('node:assert/strict');

const push = require('../lib/push');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('el repique insiste y se apaga solo al agotarse el tiempo', async () => {
  const carga = { tipo: 'llamada', callId: 'repique-1', de: 'wt1a' };
  push.repicar('wt1b', carga, { cada: 40, hasta: 160 });

  assert.equal(push.repiquesActivos(), 1, 'empieza a repicar enseguida');
  await espera(120);
  assert.equal(push.repiquesActivos(), 1, 'sigue repicando mientras espera');
  await espera(200);
  assert.equal(push.repiquesActivos(), 0, 'deja de repicar al agotarse el tiempo');
});

test('colgar para el repique en el acto', async () => {
  const carga = { tipo: 'llamada', callId: 'repique-2', de: 'wt1a' };
  push.repicar('wt1b', carga, { cada: 30, hasta: 5000 });
  assert.equal(push.repiquesActivos(), 1);

  assert.equal(push.pararRepique('repique-2'), true);
  assert.equal(push.repiquesActivos(), 0);
  await espera(120);
  assert.equal(push.repiquesActivos(), 0, 'no se reactiva solo');
});

test('cuando el móvil aparece se paran todos sus repiques', async () => {
  push.repicar('wt1c', { tipo: 'llamada', callId: 'repique-3' }, { cada: 30, hasta: 5000 });
  push.repicar('wt1c', { tipo: 'llamada', callId: 'repique-4' }, { cada: 30, hasta: 5000 });
  push.repicar('wt1d', { tipo: 'llamada', callId: 'repique-5' }, { cada: 30, hasta: 5000 });
  assert.equal(push.repiquesActivos(), 3);

  push.pararRepiquesDe('wt1c');
  assert.equal(push.repiquesActivos(), 1, 'solo queda el de otro contacto');

  push.pararRepiquesDe('wt1d');
  assert.equal(push.repiquesActivos(), 0);
});

test('con retraso no repica hasta que toca', async () => {
  push.repicar('wt1e', { tipo: 'llamada', callId: 'repique-6' }, { cada: 30, hasta: 5000, retraso: 120 });
  assert.equal(push.repiquesActivos(), 1, 'el repique queda programado');
  await espera(60);
  assert.equal(push.repiquesActivos(), 1);
  await espera(120);
  assert.equal(push.repiquesActivos(), 1, 'ya está repicando');
  push.pararRepique('repique-6');
  assert.equal(push.repiquesActivos(), 0);
});

test('entregar las llamadas pendientes también corta el repique', async () => {
  push.guardarLlamada('repique-7', {
    to: 'wt1f',
    from: 'wt1a',
    frame: { t: 'call', from: 'wt1a', callId: 'repique-7', kind: 'offer' },
  });
  push.repicar('wt1f', { tipo: 'llamada', callId: 'repique-7' }, { cada: 30, hasta: 5000 });
  assert.equal(push.repiquesActivos(), 1);

  const pendientes = push.tomarPendientes('wt1f');
  assert.equal(pendientes.length, 1);
  assert.equal(push.repiquesActivos(), 0, 'el móvil ya está despierto');
});
