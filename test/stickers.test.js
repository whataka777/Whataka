'use strict';

const test = require('node:test');
const assert = require('node:assert');
const s = require('../lib/stickers.js');

test('hay stickers suficientes y con campos completos', () => {
  assert.ok(s.todos().length >= 20);
  for (const st of s.todos()) {
    assert.ok(st.id, 'id');
    assert.ok(st.emoji, `emoji de ${st.id}`);
    assert.ok(st.label, `label de ${st.id}`);
    assert.ok(st.anim && st.anim.startsWith('st-'), `anim de ${st.id}`);
    assert.ok(s.CATEGORIAS.some((c) => c.id === st.cat), `cat de ${st.id}`);
  }
});

test('los ids no se repiten', () => {
  const ids = s.todos().map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('incluye los saludos pedidos', () => {
  assert.ok(s.porId('buenos-dias'));
  assert.ok(s.porId('buenas-tardes'));
  assert.ok(s.porId('buenas-noches'));
});

test('el fuego de corazones existe y suelta corazones', () => {
  const f = s.porId('fuegos-corazon');
  assert.ok(f);
  assert.ok(f.spark.length >= 3);
  assert.ok(f.spark.some((e) => e.includes('❤') || e.includes('💖')));
});

test('porId devuelve null si no existe', () => {
  assert.strictEqual(s.porId('no-existe'), null);
  assert.strictEqual(s.porId(undefined), null);
});

test('esStickerId valida correctamente', () => {
  assert.strictEqual(s.esStickerId('fuegos'), true);
  assert.strictEqual(s.esStickerId('🥭'), false);
  assert.strictEqual(s.esStickerId(''), false);
});

test('normalizar convierte un id válido y descarta lo demás', () => {
  assert.strictEqual(s.normalizar('confeti'), 'confeti');
  assert.strictEqual(s.normalizar('basura'), null);
});

test('porCategorias cubre todos los stickers sin perder ninguno', () => {
  const total = s.porCategorias().reduce((n, c) => n + c.stickers.length, 0);
  assert.strictEqual(total, s.todos().length);
});

test('cada categoría declarada tiene al menos un sticker', () => {
  for (const c of s.porCategorias()) {
    assert.ok(c.stickers.length > 0, `categoría vacía: ${c.id}`);
  }
});

test('porCategoria filtra bien', () => {
  assert.strictEqual(s.porCategoria('amor').every((x) => x.cat === 'amor'), true);
  assert.strictEqual(s.porCategoria('inexistente').length, 0);
});

test('todos() devuelve una copia (no la lista interna)', () => {
  const a = s.todos();
  a.push({ id: 'falso' });
  assert.strictEqual(s.todos().length, a.length - 1);
});
