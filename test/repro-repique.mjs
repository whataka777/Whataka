// Con la app abierta, el móvil tiene que sonar por su cuenta y el relé no debe
// mandar avisos: si repicara también, sonarían dos veces.
// Uso:  PORT=10099 node server.js &  node test/repro-repique.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';
const url = (extra = '') => `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}${extra}`;

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

async function conecta(page) {
  await page.waitForFunction(() => state && state.identity && state.connected === true, null, { timeout: 20000 });
}

async function repiques() {
  const res = await fetch(`${RELAY}/health`);
  const datos = await res.json();
  return datos.repiques;
}

const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });
const B = await ctxB.newPage();
await B.addInitScript(() => {
  window.__vibraciones = [];
  navigator.vibrate = (patron) => { window.__vibraciones.push(patron); return true; };
});
await B.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(B);
const idB = await B.evaluate(() => state.identity.peerId);

const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
const A = await ctxA.newPage();
await A.goto(url(), { waitUntil: 'domcontentloaded' });
await conecta(A);
const idA = await A.evaluate(() => state.identity.peerId);
console.log('Peer A:', idA, '· Peer B:', idB);

await A.evaluate((id) => rememberPeer(id, 'Bruno'), idB);
await B.evaluate((id) => rememberPeer(id, 'Alicia'), idA);
await A.waitForTimeout(600);

await A.evaluate((id) => { state.activePeer = id; voiceCall(false); }, idB);
await B.waitForSelector('#call-incoming:not([hidden])', { timeout: 15000 });

// Se deja sonar sin contestar: es justo la ventana en la que el relé podría
// pensar que el móvil está sordo.
await A.waitForTimeout(4500);

const estado = await B.evaluate(() => ({
  timbre: Boolean(ringTimer),
  titulo: document.title,
  vibraciones: window.__vibraciones.length,
}));
if (!estado.timbre) throw new Error('el móvil abierto no está timbrando');
if (!estado.titulo.includes('Llamada entrante')) throw new Error(`título inesperado: ${estado.titulo}`);
console.log(`✅ La app abierta timbra sola (${estado.vibraciones} vibraciones) sin contestar`);

const activos = await repiques();
if (activos !== 0) throw new Error(`el relé está repicando encima (${activos} repiques)`);
console.log('✅ El relé no manda avisos: la app confirmó que tiene la llamada en pantalla');

await A.evaluate(() => colgarLlamada());
await A.waitForTimeout(1200);
if ((await repiques()) !== 0) throw new Error('quedó un repique colgado tras colgar');
console.log('✅ Al colgar no queda ningún repique pendiente');

await browser.close();
console.log('\n🎉 El teléfono suena una sola vez, por donde toca.');
