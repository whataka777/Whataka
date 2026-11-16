'use strict';

const test = require('node:test');
const assert = require('node:assert');
const d = require('../lib/donaciones.js');

test('los costes suman el total mensual', () => {
  const suma = d.COSTES.reduce((s, c) => s + c.usdMes, 0);
  assert.strictEqual(d.costeMensual(), suma);
  assert.ok(d.costeMensual() > 0);
});

test('hay exactamente Render y Porkbun', () => {
  const ids = d.todosLosCostes().map((c) => c.id);
  assert.deepStrictEqual(ids.sort(), ['porkbun', 'render']);
});

test('el coste anual es 12 veces el mensual', () => {
  assert.strictEqual(d.costeAnual(), d.costeMensual() * 12);
});

test('cada coste tiene nombre, emoji y un importe positivo', () => {
  for (const c of d.todosLosCostes()) {
    assert.ok(c.nombre.length > 0);
    assert.ok(c.emoji.length > 0);
    assert.ok(c.usdMes > 0);
  }
});

test('todosLosCostes devuelve copias, no el original', () => {
  const a = d.todosLosCostes();
  a[0].usdMes = 999;
  assert.notStrictEqual(d.COSTES[0].usdMes, 999);
});

test('una donación de 0 no cubre nada', () => {
  const r = d.mesesCubiertos(0);
  assert.strictEqual(r.meses, 0);
  assert.strictEqual(r.cubreTodo, false);
});

test('una donación negativa o basura se trata como 0', () => {
  assert.strictEqual(d.mesesCubiertos(-5).meses, 0);
  assert.strictEqual(d.mesesCubiertos('hola').meses, 0);
});

test('una donación menor que el coste mensual no cubre un mes completo', () => {
  const r = d.mesesCubiertos(1);
  assert.strictEqual(r.meses, 0);
  assert.strictEqual(r.cubreTodo, false);
});

test('una donación justo del coste mensual cubre 1 mes', () => {
  const r = d.mesesCubiertos(d.costeMensual());
  assert.strictEqual(r.meses, 1);
  assert.strictEqual(r.cubreTodo, true);
});

test('el doble del coste mensual cubre 2 meses', () => {
  const r = d.mesesCubiertos(d.costeMensual() * 2);
  assert.strictEqual(r.meses, 2);
});

test('mesesCubiertos calcula bien con importes grandes', () => {
  const r = d.mesesCubiertos(d.costeMensual() * 12);
  assert.strictEqual(r.meses, 12);
});

test('el texto de una donación pequeña habla de días', () => {
  assert.match(d.textoMeses(0.5), /días/);
});

test('el texto de una donación de un mes habla de un mes', () => {
  assert.match(d.textoMeses(d.costeMensual()), /1 mes/);
});

test('el texto de una donación de varios meses lo dice', () => {
  assert.match(d.textoMeses(d.costeMensual() * 3), /3 meses/);
});

test('el reparto cubre Render antes que Porkbun', () => {
  const r = d.repartoDe(3);
  const render = r.find((x) => x.id === 'render');
  const porkbun = r.find((x) => x.id === 'porkbun');
  assert.ok(render.usd > 0);
  assert.strictEqual(render.completo, false); // 3 $ < 7 $ de Render
  assert.strictEqual(porkbun.usd, 0); // no llega a Porkbun
});

test('el reparto no reparte más de lo donado', () => {
  const donado = 4;
  const suma = d.repartoDe(donado).reduce((s, x) => s + x.usd, 0);
  assert.ok(suma <= donado + 1e-9);
});

test('el reparto cubre todos los costes con una donación grande', () => {
  const r = d.repartoDe(d.costeMensual() * 2);
  for (const x of r) assert.strictEqual(x.completo, true);
});

test('los importes sugeridos son crecientes y positivos', () => {
  for (let i = 0; i < d.IMPORTES_SUGERIDOS.length; i++) {
    assert.ok(d.IMPORTES_SUGERIDOS[i] > 0);
    if (i > 0) assert.ok(d.IMPORTES_SUGERIDOS[i] > d.IMPORTES_SUGERIDOS[i - 1]);
  }
});

test('formatearUsd da dos decimales con símbolo', () => {
  assert.strictEqual(d.formatearUsd(7), '$7.00');
});

// ── Donaciones en WTK ────────────────────────────────────────────────────────

test('aUnidadesWtk convierte a wei con 18 decimales', () => {
  assert.strictEqual(d.aUnidadesWtk(1), 10n ** 18n);
  assert.strictEqual(d.aUnidadesWtk(1000), 1000n * 10n ** 18n);
});

test('aUnidadesWtk usa BigInt exacto (sin error de coma flotante)', () => {
  // 0.1 no es exacto en coma flotante; con BigInt debe dar exactamente 1e17.
  assert.strictEqual(d.aUnidadesWtk(0.1), 10n ** 17n);
  assert.strictEqual(d.aUnidadesWtk(0.3), 3n * 10n ** 17n);
});

test('aUnidadesWtk tolera valores negativos y basura', () => {
  assert.strictEqual(d.aUnidadesWtk(-5), 0n);
  assert.strictEqual(d.aUnidadesWtk('x'), 0n);
  assert.strictEqual(d.aUnidadesWtk(undefined), 0n);
});

test('aUnidadesWtk devuelve BigInt (no Number) para no perder precisión', () => {
  assert.strictEqual(typeof d.aUnidadesWtk(5000), 'bigint');
});

test('formatearWtk añade la unidad y separa miles', () => {
  assert.strictEqual(d.formatearWtk(1000), '1.000 WTK');
  assert.strictEqual(d.formatearWtk(500), '500 WTK');
});

test('los importes WTK sugeridos son crecientes y positivos', () => {
  for (let i = 0; i < d.IMPORTES_WTK.length; i++) {
    assert.ok(d.IMPORTES_WTK[i] > 0);
    if (i > 0) assert.ok(d.IMPORTES_WTK[i] > d.IMPORTES_WTK[i - 1]);
  }
});

// ── Sala de donaciones (envío y recepción en WTK) ──

test('la sala tiene textos de cabecera y aviso legal', () => {
  assert.ok(d.SALA_TEXTO.titulo.length > 0);
  assert.ok(d.SALA_TEXTO.intro.length > 0);
  assert.ok(/voluntaria/i.test(d.SALA_TEXTO.avisoLegal));
  assert.ok(/no es una inversi[oó]n/i.test(d.SALA_TEXTO.avisoLegal));
});

test('la red del WTK es Polygon Amoy (cadena 80002)', () => {
  assert.strictEqual(d.RED_WTK.chainId, 80002);
  assert.ok(/amoy/i.test(d.RED_WTK.nombre));
});

test('el DEX apunta a un intercambio y avisa de que lo hace el usuario', () => {
  assert.ok(/^https:\/\//.test(d.DEX.url));
  assert.ok(/quickswap/i.test(d.DEX.url));
  assert.ok(/t[uú] en el DEX/i.test(d.DEX.aviso));
});

test('las guías de enviar, recibir y cambiar tienen pasos', () => {
  for (const g of [d.GUIA_ENVIAR, d.GUIA_RECIBIR, d.GUIA_CAMBIAR]) {
    assert.ok(Array.isArray(g));
    assert.ok(g.length >= 3);
    for (const paso of g) assert.ok(typeof paso === 'string' && paso.length > 0);
  }
});

test('la guía de recibir avisa del tema fiscal', () => {
  assert.ok(d.GUIA_RECIBIR.some((p) => /fiscal/i.test(p)));
});

test('la guía de cambiar deja claro que la app NO hace el cambio', () => {
  assert.ok(d.GUIA_CAMBIAR.some((p) => /t[uú] en el DEX/i.test(p)));
  assert.ok(d.GUIA_CAMBIAR.some((p) => /no lo hace|no necesita licencia/i.test(p)));
});

test('el mensaje de registro ata la cartera al Peer ID', () => {
  const m = d.mensajeRegistroCartera('wt1abc', '0xAbC123');
  assert.ok(m.includes('wt1abc'));
  assert.ok(m.includes('0xAbC123'));
  // El mensaje cambia si cambia cualquiera de los dos datos.
  assert.notEqual(m, d.mensajeRegistroCartera('wt1otro', '0xAbC123'));
  assert.notEqual(m, d.mensajeRegistroCartera('wt1abc', '0xOtro'));
});
