// Prueba del caso difícil: llamar a alguien que tiene la app CERRADA.
// B se abre una vez para tener identidad, se cierra, A llama y B vuelve a
// abrirse como lo haría al tocar el aviso del sistema.
// Uso:  PORT=10099 node server.js &  node test/repro-llamada-cerrada.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';
const url = (extra = '') => `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}${extra}`;

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function conecta(page) {
  await page.waitForFunction(() => state && state.identity && state.connected === true, null, { timeout: 20000 });
}

// Contexto propio para A.
const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
const A = await ctxA.newPage();
A.on('console', (m) => { if (m.type() === 'error') console.log('[A] error:', m.text()); });
await A.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(A);
const idA = await A.evaluate(() => state.identity.peerId);
console.log('Peer A:', idA);

// B entra una vez, se apaga, y su identidad queda guardada como en un móvil.
const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });
const B1 = await ctxB.newPage();
await B1.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(B1);
const idB = await B1.evaluate(() => state.identity.peerId);
await B1.close();
console.log('Peer B:', idB, '(app cerrada)');

await A.evaluate((id) => rememberPeer(id, 'Bruno'), idB);
await A.waitForTimeout(800);

// A llama a alguien que no está conectado.
await A.evaluate((id) => { state.activePeer = id; voiceCall(false); }, idB);

// Con avisos activados dice "Avisando…"; sin ellos, "Esperando a que abra".
await A.waitForFunction(
  () => {
    const t = document.getElementById('call-status')?.textContent || '';
    return t.includes('Avisando') || t.includes('Esperando a que abra');
  },
  null, { timeout: 10000 },
);
const estadoA = await A.evaluate(() => ({ estado: call.maquina.estado, texto: document.getElementById('call-status').textContent }));
if (estadoA.estado !== 'llamando') throw new Error(`A colgó en vez de esperar: ${estadoA.estado}`);
console.log('✅ A sigue esperando en vez de colgar:', estadoA.texto);

// B vuelve a abrirse con "Contestar" del aviso del sistema.
const B2 = await ctxB.newPage();
B2.on('console', (m) => { if (m.type() === 'error') console.log('[B] error:', m.text()); });
await B2.goto(url('&contestar=1'), { waitUntil: 'domcontentloaded' });

await B2.waitForFunction(
  () => call.maquina && ['sonando', 'activa'].includes(call.maquina.estado),
  null, { timeout: 25000 },
);
console.log('✅ B, recién abierta, recibe la llamada que quedó guardada');

await A.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 25000 });
await B2.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 25000 });

const audioA = await A.evaluate(() => call.remoteStream?.getAudioTracks().length || 0);
const audioB = await B2.evaluate(() => call.remoteStream?.getAudioTracks().length || 0);
if (!audioA || !audioB) throw new Error(`sin audio remoto (A:${audioA} B:${audioB})`);
console.log('✅ Llamada ACTIVA con audio en los dos lados tras abrir la app desde cero');

await A.click('#call-hangup');
await browser.close();
console.log('\n🎉 Llamar a una app cerrada funciona: se guarda la oferta y se contesta al abrir.');
