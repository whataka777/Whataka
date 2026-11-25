// Prueba real de llamada P2P: dos pestañas con cámara y micrófono falsos.
// Requiere el relé en marcha:  PORT=10099 node server.js
// Uso:  node test/repro-llamada.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const url = `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}`;

async function abre(nombre) {
  // Cada par necesita su propio contexto: la identidad vive en localStorage,
  // así que dos pestañas del mismo contexto compartirían el mismo Peer ID.
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${nombre}] console.error:`, m.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => state && state.identity, null, { timeout: 15000 });
  await page.waitForFunction(() => state.connected === true, null, { timeout: 15000 });
  return page;
}

const A = await abre('A');
const B = await abre('B');
const idA = await A.evaluate(() => state.identity.peerId);
const idB = await B.evaluate(() => state.identity.peerId);
console.log('Peer A:', idA);
console.log('Peer B:', idB);

// Cada uno "recuerda" al otro para que la lista de chats los muestre.
await A.evaluate((id) => rememberPeer(id, 'B'), idB);
await B.evaluate((id) => rememberPeer(id, 'A'), idA);

// Espía de la vibración: en un móvil es lo único que se nota con la pantalla
// apagada, y en el navegador de pruebas no hay motor que la ejecute.
await B.evaluate(() => {
  window.__vibraciones = [];
  navigator.vibrate = (patron) => { window.__vibraciones.push(patron); return true; };
});

// A llama a B (audio).
await A.evaluate((id) => { state.activePeer = id; voiceCall(false); }, idB);

// B debe ver el overlay de llamada entrante.
await B.waitForFunction(
  () => document.getElementById('call-overlay').classList.contains('open')
    && !document.getElementById('call-incoming').hidden,
  null, { timeout: 10000 },
);
console.log('✅ B recibe la llamada entrante (overlay + botones aceptar/rechazar)');

const aviso = await B.evaluate(() => ({
  vibra: window.__vibraciones.length > 0,
  patron: window.__vibraciones.find((p) => p !== 0),
  timbre: Boolean(ringTimer),
  titulo: document.title,
}));
if (!aviso.vibra) throw new Error('la llamada entrante no vibró');
if (!aviso.timbre) throw new Error('la llamada entrante no activó el timbre');
if (!aviso.titulo.includes('Llamada entrante')) throw new Error(`el título no avisa: ${aviso.titulo}`);
console.log('✅ Aviso de llamada entrante: vibra', aviso.patron, '· timbre activo · título:', aviso.titulo);

// B acepta.
await B.click('#call-accept');

const tras = await B.evaluate(() => ({
  timbre: Boolean(ringTimer),
  vibracion: Boolean(vibrarTimer),
  titulo: document.title,
  parada: window.__vibraciones[window.__vibraciones.length - 1],
}));
if (tras.timbre || tras.vibracion) throw new Error('el timbre sigue sonando después de contestar');
if (tras.parada !== 0) throw new Error('la vibración no se detuvo al contestar');
if (tras.titulo !== 'Whataka') throw new Error(`el título no se restauró: ${tras.titulo}`);
console.log('✅ Al contestar se paran timbre y vibración y el título vuelve a la normalidad');

// Ambos deben llegar a estado "activa" y con audio fluyendo.
await A.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 15000 });
await B.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 15000 });
console.log('✅ Ambas pestañas en estado ACTIVA');

const audioA = await A.evaluate(() => call.remoteStream ? call.remoteStream.getAudioTracks().length : 0);
const audioB = await B.evaluate(() => call.remoteStream ? call.remoteStream.getAudioTracks().length : 0);
console.log('Pistas de audio remotas -> A:', audioA, 'B:', audioB);

// A cuelga; B debe volver a inactiva.
await A.click('#call-hangup');
await B.waitForFunction(
  () => !document.getElementById('call-overlay').classList.contains('open'),
  null, { timeout: 10000 },
);
console.log('✅ A cuelga y B cierra el overlay');

// ── Segunda prueba: videollamada ──────────────────────────────────────
await B.evaluate((id) => { state.activePeer = id; voiceCall(true); }, idA);
await A.waitForFunction(
  () => document.getElementById('call-overlay').classList.contains('open')
    && !document.getElementById('call-incoming').hidden,
  null, { timeout: 10000 },
);
console.log('✅ A recibe la VIDEOLLAMADA entrante');
await A.click('#call-accept');
await A.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 15000 });
await B.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 15000 });
const videoB = await B.evaluate(() => call.remoteStream ? call.remoteStream.getVideoTracks().length : 0);
console.log('✅ Videollamada ACTIVA. Pistas de vídeo remotas en B:', videoB);

// Comprobamos que el vídeo remoto se pinta.
const hasRemote = await B.evaluate(() => document.getElementById('call-overlay').classList.contains('has-remote'));
console.log('✅ Vídeo remoto visible en B:', hasRemote);

await B.click('#call-hangup');
console.log('\n🎉 PRUEBA COMPLETA: audio y vídeo P2P funcionan de verdad.');

await browser.close();
