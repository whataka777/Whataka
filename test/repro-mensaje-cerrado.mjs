// Prueba del caso normal de un chat: escribir a alguien con la app CERRADA.
// B se abre una vez para tener identidad y claves, se cierra, A escribe y B
// vuelve a abrirse: el mensaje tiene que estar ahí y A tiene que verlo como
// entregado.
// Uso:  PORT=10099 node server.js &  node test/repro-mensaje-cerrado.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';
const url = (extra = '') => `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}${extra}`;

const browser = await chromium.launch();

async function conecta(page) {
  await page.waitForFunction(() => state && state.identity && state.connected === true, null, { timeout: 20000 });
}

// B entra primero: así A lo ve en la lista de presencia con su clave pública.
const ctxB = await browser.newContext();
const B1 = await ctxB.newPage();
B1.on('console', (m) => { if (m.type() === 'error') console.log('[B] error:', m.text()); });
await B1.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(B1);
const idB = await B1.evaluate(() => state.identity.peerId);
console.log('Peer B:', idB);

const ctxA = await browser.newContext();
const A = await ctxA.newPage();
A.on('console', (m) => { if (m.type() === 'error') console.log('[A] error:', m.text()); });
await A.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(A);
const idA = await A.evaluate(() => state.identity.peerId);
console.log('Peer A:', idA);

await A.waitForFunction((id) => state.peers[id]?.agreePub, idB, { timeout: 10000 });
console.log('✅ A conoce la clave pública de B');

await B1.close();
await A.waitForFunction((id) => !state.online.has(id), idB, { timeout: 10000 });
console.log('✅ B cerrada: A ya no lo ve en línea');

await A.evaluate((id) => openChat(id), idB);
await A.fill('#msg-input', 'Hola desde el móvil');
await A.click('#btn-send-msg');

await A.waitForFunction(
  (id) => (state.messages[id] || []).some((m) => m.delivery === 'pendiente'),
  idB, { timeout: 15000 },
);
const guardado = await A.evaluate((id) => state.messages[id].at(-1), idB);
console.log('✅ A escribe a alguien dormido y el mensaje queda en cola (⏱):', guardado.text);
if (!guardado.id) throw new Error('el mensaje salió sin identificador');

// B vuelve a abrirse, como al tocar el aviso del sistema.
const B2 = await ctxB.newPage();
B2.on('console', (m) => { if (m.type() === 'error') console.log('[B] error:', m.text()); });
await B2.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(B2);
await B2.waitForFunction(
  (id) => (state.messages[id] || []).some((m) => m.text === 'Hola desde el móvil'),
  idA, { timeout: 15000 },
);
console.log('✅ B, recién abierta, recibe el mensaje que quedó guardado');

await A.waitForFunction(
  (id) => (state.messages[id] || []).some((m) => m.delivery === 'entregado'),
  idB, { timeout: 15000 },
);
console.log('✅ A ve el mensaje como entregado (✓✓) tras el acuse');

// Sin duplicados: B recarga y el mensaje no vuelve a aparecer.
await B2.reload({ waitUntil: 'domcontentloaded' });
await conecta(B2);
await B2.waitForTimeout(1200);
const veces = await B2.evaluate((id) => (state.messages[id] || []).filter((m) => m.text === 'Hola desde el móvil').length, idA);
if (veces !== 1) throw new Error(`el mensaje se duplicó: ${veces} copias`);
console.log('✅ Sin duplicados al reconectar (acuse correcto)');

await browser.close();
console.log('\n🎉 Escribir a una app cerrada funciona: se guarda, se entrega y se acusa.');
