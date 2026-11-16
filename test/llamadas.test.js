'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ESTADOS, crear, formatearDuracion, nuevoCallId } = require('../lib/llamadas.js');

test('empieza inactiva', () => {
  const c = crear();
  assert.equal(c.estado, ESTADOS.INACTIVA);
  assert.equal(c.enCurso, false);
  assert.equal(c.terminada, false);
});

test('flujo completo de quien llama: llamando -> conectando -> activa -> terminada', () => {
  const c = crear();
  c.iniciar({ callId: 'c1', peer: 'wt1abc', video: true });
  assert.equal(c.estado, ESTADOS.LLAMANDO);
  assert.equal(c.video, true);
  assert.equal(c.peer, 'wt1abc');
  c.conectar();
  assert.equal(c.estado, ESTADOS.CONECTANDO);
  c.activar();
  assert.equal(c.estado, ESTADOS.ACTIVA);
  assert.equal(c.activa, true);
  c.colgar();
  assert.equal(c.estado, ESTADOS.TERMINADA);
  assert.equal(c.terminada, true);
});

test('flujo de quien recibe: sonando -> aceptar -> activa', () => {
  const c = crear();
  c.recibir({ callId: 'c2', peer: 'wt1xyz', video: false });
  assert.equal(c.estado, ESTADOS.SONANDO);
  c.aceptar();
  assert.equal(c.estado, ESTADOS.CONECTANDO);
  c.activar();
  assert.equal(c.estado, ESTADOS.ACTIVA);
});

test('rechazar desde sonando', () => {
  const c = crear();
  c.recibir({ callId: 'c3', peer: 'wt1q' });
  c.rechazar();
  assert.equal(c.estado, ESTADOS.RECHAZADA);
  assert.equal(c.terminada, true);
});

test('sin conexión si el contacto está offline', () => {
  const c = crear();
  c.iniciar({ callId: 'c4', peer: 'wt1off' });
  c.sinConexion();
  assert.equal(c.estado, ESTADOS.SIN_CONEXION);
  assert.equal(c.terminada, true);
});

test('no permite transiciones inválidas (doble toque, mensajes tardíos)', () => {
  const c = crear();
  c.iniciar({ callId: 'c5', peer: 'wt1a' });
  assert.throws(() => c.activar(), /Transición inválida/);
  c.conectar();
  assert.throws(() => c.iniciar({ callId: 'c6', peer: 'wt1b' }), /Transición inválida/);
  c.activar();
  assert.throws(() => c.activar(), /Transición inválida/);
});

test('una llamada terminada no admite más cambios', () => {
  const c = crear();
  c.iniciar({ callId: 'c7', peer: 'wt1a' });
  c.colgar();
  assert.throws(() => c.conectar(), /Transición inválida/);
  assert.throws(() => c.iniciar({ callId: 'c8', peer: 'wt1b' }), /Transición inválida/);
});

test('duración cuenta desde que se conecta', () => {
  let t = 1000;
  const c = crear(() => t);
  c.iniciar({ callId: 'c9', peer: 'wt1a' });
  t = 2000;
  c.conectar();
  t = 3000;
  c.activar();
  assert.equal(c.duracion(3000), 0);
  assert.equal(c.duracion(4000), 1);
  assert.equal(c.duracion(65000), 62);
});

test('formatearDuracion da m:ss', () => {
  assert.equal(formatearDuracion(0), '0:00');
  assert.equal(formatearDuracion(5), '0:05');
  assert.equal(formatearDuracion(65), '1:05');
  assert.equal(formatearDuracion(3725), '62:05');
  assert.equal(formatearDuracion(-3), '0:00');
});

test('nuevoCallId es único y con forma esperada', () => {
  const a = nuevoCallId();
  const b = nuevoCallId();
  assert.match(a, /^c[0-9a-z]+$/);
  assert.notEqual(a, b);
});

test('resumen refleja el estado', () => {
  const c = crear();
  c.iniciar({ callId: 'cx', peer: 'wt1z', video: true });
  const r = c.resumen();
  assert.equal(r.estado, ESTADOS.LLAMANDO);
  assert.equal(r.callId, 'cx');
  assert.equal(r.peer, 'wt1z');
  assert.equal(r.video, true);
});
