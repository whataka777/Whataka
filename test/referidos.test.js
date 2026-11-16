'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ref = require('../lib/referidos');

const PEER_A = 'wt1' + 'A'.repeat(40);
const PEER_B = 'wt1' + 'B'.repeat(40);

test('valida el formato del Peer ID', () => {
  assert.equal(ref.esPeerIdValido(PEER_A), true);
  assert.equal(ref.esPeerIdValido('wt1'), false);
  assert.equal(ref.esPeerIdValido('wt0' + 'A'.repeat(40)), false, 'no admite 0');
  assert.equal(ref.esPeerIdValido('otra' + 'A'.repeat(40)), false);
  assert.equal(ref.esPeerIdValido(123), false);
});

test('el enlace de invitación lleva el Peer ID como ?ref', () => {
  const url = ref.enlaceInvitacion('https://whataka777.github.io/Whataka/', PEER_A);
  assert.equal(url, `https://whataka777.github.io/Whataka/?ref=${PEER_A}`);
  assert.equal(ref.enlaceInvitacion('https://x', 'malo'), '');
});

test('el código de invitación es la cola del Peer ID', () => {
  assert.equal(ref.codigoInvitacion(PEER_A), PEER_A.slice(-8));
  assert.equal(ref.codigoInvitacion('nope'), '');
});

test('la escalera de estatus sube con los invitados', () => {
  assert.equal(ref.estatusPorInvitados(0).id, 'recluta');
  assert.equal(ref.estatusPorInvitados(99).id, 'recluta');
  assert.equal(ref.estatusPorInvitados(100).id, 'bronce');
  assert.equal(ref.estatusPorInvitados(250).id, 'plata');
  assert.equal(ref.estatusPorInvitados(500).id, 'oro');
  assert.equal(ref.estatusPorInvitados(750).id, 'platino');
  assert.equal(ref.estatusPorInvitados(1000).id, 'diamante');
  assert.equal(ref.estatusPorInvitados(99999).id, 'legendario', 'no se pasa del máximo');
});

test('el progreso apunta al siguiente estatus', () => {
  const p = ref.progresoEstatus(300);
  assert.equal(p.actual.id, 'plata');
  assert.equal(p.siguiente.id, 'oro');
  assert.equal(p.faltan, 200);
  assert.ok(p.porcentaje >= 0 && p.porcentaje <= 100);

  const max = ref.progresoEstatus(2000);
  assert.equal(max.siguiente, null);
  assert.equal(max.porcentaje, 100);
});

test('cada invitado aporta puntos para los niveles', () => {
  assert.equal(ref.puntosPorInvitados(0), 0);
  assert.equal(ref.puntosPorInvitados(1), ref.PUNTOS_POR_INVITADO);
  assert.equal(ref.puntosPorInvitados(10), 10 * ref.PUNTOS_POR_INVITADO);
  assert.equal(ref.puntosPorInvitados(-5), 0);
});

test('invitar sube los MISMOS niveles que pagar (Bronce…Diamante)', () => {
  const niveles = require('../lib/niveles');
  const porId = (id) => niveles.NIVELES.find((n) => n.id === id);
  // Cada tramo de la escalera de referidos apunta a un nivel real.
  for (const e of ref.ESTATUS) {
    if (!e.nivelId) continue;
    assert.ok(porId(e.nivelId), `el nivel ${e.nivelId} existe`);
  }
  // 100 invitados = Bronce, 250 = Plata, 500 = Oro, 750 = Platino, 1000 = Diamante.
  assert.equal(ref.estatusPorInvitados(100).nivelId, 'bronce');
  assert.equal(ref.estatusPorInvitados(250).nivelId, 'plata');
  assert.equal(ref.estatusPorInvitados(500).nivelId, 'oro');
  assert.equal(ref.estatusPorInvitados(750).nivelId, 'platino');
  assert.equal(ref.estatusPorInvitados(1000).nivelId, 'diamante');
});

test('la posición en el ranking ordena por invitados', () => {
  const tabla = [
    { peerId: PEER_A, count: 3 },
    { peerId: PEER_B, count: 7 },
  ];
  assert.equal(ref.posicionEnRanking(PEER_B, tabla), 1);
  assert.equal(ref.posicionEnRanking(PEER_A, tabla), 2);
  assert.equal(ref.posicionEnRanking('wt1' + 'C'.repeat(40), tabla), null);
});

test('el mensaje de invitación incluye a los dos y es estable', () => {
  const m = ref.mensajeInvitacion(PEER_A, PEER_B);
  assert.match(m, new RegExp(PEER_A));
  assert.match(m, new RegExp(PEER_B));
  assert.equal(m, ref.mensajeInvitacion(PEER_A, PEER_B));
});

test('el texto para compartir incluye el enlace y no promete dinero', () => {
  const t = ref.textoCompartir(PEER_A, 'https://x');
  assert.match(t, /https:\/\/x\/\?ref=/);
  assert.doesNotMatch(t, /\$|dólares|dinero|gana dinero|invierte/i);
});

test('base58 coincide con el formato del Peer ID', () => {
  const out = ref.base58(Buffer.from([0, 1, 2, 3, 255]));
  assert.match(out, /^[1-9A-HJ-NP-Za-km-z]+$/);
});
