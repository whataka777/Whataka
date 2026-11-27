const test = require('node:test');
const assert = require('node:assert');

const disfraces = require('../lib/disfraces.js');

// Lienzo falso: apunta las llamadas para poder comprobar que se dibuja algo.
function lienzoFalso() {
  const llamadas = [];
  const anotar = (nombre) => (...args) => { llamadas.push({ nombre, args }); };
  const ctx = {
    llamadas,
    save: anotar('save'),
    restore: anotar('restore'),
    translate: anotar('translate'),
    rotate: anotar('rotate'),
    scale: anotar('scale'),
    beginPath: anotar('beginPath'),
    moveTo: anotar('moveTo'),
    lineTo: anotar('lineTo'),
    quadraticCurveTo: anotar('quadraticCurveTo'),
    closePath: anotar('closePath'),
    fill: anotar('fill'),
    stroke: anotar('stroke'),
    arc: anotar('arc'),
    ellipse: anotar('ellipse'),
    fillRect: anotar('fillRect'),
    strokeRect: anotar('strokeRect'),
    clearRect: anotar('clearRect'),
  };
  return ctx;
}

// 68 puntos de una cara de frente, inventados pero con proporciones normales.
function caraInventada({ ancho = 200, alto = 260, centro = { x: 300, y: 240 } } = {}) {
  const puntos = [];
  for (let i = 0; i < 68; i += 1) puntos.push({ x: centro.x, y: centro.y });
  // mandíbula 0..16 (de sien a sien pasando por la barbilla)
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    const angulo = Math.PI * t;
    puntos[i] = {
      x: centro.x - Math.cos(angulo) * (ancho / 2),
      y: centro.y + Math.sin(angulo) * (alto / 2),
    };
  }
  // cejas 17..26
  for (let i = 17; i <= 21; i += 1) puntos[i] = { x: centro.x - 55 + (i - 17) * 22, y: centro.y - 55 };
  for (let i = 22; i <= 26; i += 1) puntos[i] = { x: centro.x + 12 + (i - 22) * 22, y: centro.y - 55 };
  // nariz 27..35
  puntos[30] = { x: centro.x, y: centro.y + 10 };
  // ojos 36..47
  for (let i = 36; i <= 41; i += 1) puntos[i] = { x: centro.x - 60 + (i - 36) * 6, y: centro.y };
  for (let i = 42; i <= 47; i += 1) puntos[i] = { x: centro.x + 30 + (i - 42) * 6, y: centro.y };
  // boca 48..67
  for (let i = 48; i <= 59; i += 1) puntos[i] = { x: centro.x - 30 + (i - 48) * 5, y: centro.y + 90 };
  for (let i = 60; i <= 67; i += 1) puntos[i] = { x: centro.x - 20 + (i - 60) * 5, y: centro.y + 90 };
  // mentón 8
  puntos[8] = { x: centro.x, y: centro.y + alto / 2 };
  return puntos;
}

test('el catálogo no repite identificadores y todo tiene nombre', () => {
  const ids = disfraces.CATALOGO.map((d) => d.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.includes('ninguno'));
  for (const disfraz of disfraces.CATALOGO) {
    assert.ok(disfraz.nombre && disfraz.nombre.length > 1, disfraz.id);
    assert.match(disfraz.color, /^#[0-9a-f]{6}$/i);
  }
  assert.ok(ids.length >= 12, `se esperaban varios disfraces, hay ${ids.length}`);
});

test('puntosCara mide los ojos, la inclinación y la boca', () => {
  const cara = disfraces.puntosCara(caraInventada());
  assert.ok(cara, 'debería devolver medidas');
  assert.ok(cara.distanciaOjos > 50 && cara.distanciaOjos < 130, `distancia ${cara.distanciaOjos}`);
  assert.ok(Math.abs(cara.angulo) < 0.05, `inclinación ${cara.angulo}`);
  assert.ok(cara.anchoCara > 150, `ancho ${cara.anchoCara}`);
  assert.ok(cara.altoCara > 100, `alto ${cara.altoCara}`);
  // La boca está por debajo de los ojos y la nariz entre ambos.
  assert.ok(cara.bocaLocal.y > 0.5, `boca ${cara.bocaLocal.y}`);
  assert.ok(cara.narizLocal.y > 0 && cara.narizLocal.y < cara.bocaLocal.y);
});

test('una cara inclinada se detecta como inclinada', () => {
  const puntos = caraInventada();
  // Se gira 20 grados alrededor del centro de los ojos.
  const rad = (20 * Math.PI) / 180;
  const centro = { x: 300, y: 240 };
  const girados = puntos.map((p) => ({
    x: centro.x + (p.x - centro.x) * Math.cos(rad) - (p.y - centro.y) * Math.sin(rad),
    y: centro.y + (p.x - centro.x) * Math.sin(rad) + (p.y - centro.y) * Math.cos(rad),
  }));
  const cara = disfraces.puntosCara(girados);
  assert.ok(Math.abs(cara.angulo - rad) < 0.05, `ángulo ${cara.angulo} frente a ${rad}`);
});

test('con menos de 68 puntos no hay cara', () => {
  assert.strictEqual(disfraces.puntosCara(null), null);
  assert.strictEqual(disfraces.puntosCara([]), null);
  assert.strictEqual(disfraces.puntosCara(new Array(30).fill({ x: 0, y: 0 })), null);
});

test('cada disfraz dibuja algo sin romperse', () => {
  const cara = disfraces.puntosCara(caraInventada());
  for (const disfraz of disfraces.CATALOGO) {
    if (disfraz.id === 'ninguno') continue;
    const ctx = lienzoFalso();
    assert.strictEqual(disfraces.pintaDisfraz(ctx, disfraz.id, cara), true, disfraz.id);
    assert.ok(ctx.llamadas.length > 5, `${disfraz.id} dibujó ${ctx.llamadas.length} trazos`);
    assert.strictEqual(ctx.llamadas.filter((l) => l.nombre === 'save').length,
      ctx.llamadas.filter((l) => l.nombre === 'restore').length, `${disfraz.id} deja el lienzo descolocado`);
  }
});

test('«ninguno» no pinta nada y un id desconocido tampoco', () => {
  const ctx = lienzoFalso();
  assert.strictEqual(disfraces.pintaDisfraz(ctx, 'ninguno', disfraces.puntosSinteticos()), false);
  assert.strictEqual(disfraces.pintaDisfraz(ctx, 'no-existe', disfraces.puntosSinteticos()), false);
  assert.strictEqual(disfraces.pintaDisfraz(ctx, 'gafas', null), false);
  assert.strictEqual(ctx.llamadas.length, 0);
});

test('las miniaturas se dibujan para todo el catálogo', () => {
  for (const disfraz of disfraces.CATALOGO) {
    const ctx = lienzoFalso();
    assert.doesNotThrow(() => disfraces.pintaMuestra(ctx, disfraz.id, 112));
    assert.ok(ctx.llamadas.length > 3, disfraz.id);
  }
});

test('pintaMuestra también funciona en un lienzo pequeño o grande', () => {
  for (const tamano of [64, 112, 240]) {
    const ctx = lienzoFalso();
    assert.doesNotThrow(() => disfraces.pintaMuestra(ctx, 'zombi', tamano));
  }
});
