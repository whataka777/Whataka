'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manual = fs.readFileSync(path.join(__dirname, '..', 'manual.html'), 'utf8');
const indice = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('el manual está en español y tiene las catorce secciones', () => {
  assert.match(manual, /<html lang="es">/);
  const secciones = [
    'que-es', 'cuenta', 'primeros', 'contactos', 'llamadas', 'mineria',
    'cartera', 'donaciones', 'cambio', 'niveles', 'seguridad', 'problemas', 'glosario',
    'futuro',
  ];
  for (const id of secciones) {
    assert.match(manual, new RegExp(`id="${id}"`), `falta la sección ${id}`);
    assert.match(manual, new RegExp(`href="#${id}"`), `la sección ${id} no está en el índice`);
  }
});

test('el manual explica lo que de verdad hace la cuenta', () => {
  assert.match(manual, /wt1/);
  assert.match(manual, /WHATAKA-CUENTA-1\./);
  assert.match(manual, /80002/);
  assert.match(manual, /QuickSwap/);
  assert.match(manual, /red de pruebas/);
});

test('el manual está ilustrado', () => {
  const figuras = manual.match(/<figure>/g) || [];
  assert.ok(figuras.length >= 5, `solo hay ${figuras.length} ilustraciones`);
  for (const svg of manual.match(/aria-label="[^"]+"/g) || []) {
    assert.ok(svg.length > 12, 'cada ilustración necesita descripción para lectores de pantalla');
  }
});

test('la barra lleva el libro al final, después de los ajustes', () => {
  const ajustes = indice.indexOf('id="nav-manual"');
  assert.ok(ajustes > 0, 'no hay botón del manual');
  assert.ok(indice.indexOf('data-target="tab-settings"') < ajustes, 'el libro va después de la tuerca');
  assert.ok(ajustes < indice.indexOf('</nav>'), 'el libro está dentro de la barra');
  assert.match(app, /nav-manual/);
  assert.match(app, /manual\.html/);
});

test('el relé sirve el manual', () => {
  assert.match(server, /'\/manual\.html'/);
});
