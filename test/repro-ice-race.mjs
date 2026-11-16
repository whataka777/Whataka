// Regresión: los candidatos ICE que llegan mientras suena la llamada (antes de
// que el receptor acepte) NO deben perderse. Antes del arreglo se descartaban y,
// en redes reales (móvil / NAT estricto), la llamada se quedaba en "conectando".
//
// Requiere el relé en marcha:  PORT=10099 node server.js
// Uso:  node test/repro-ice-race.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const url = `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}`;

async function abre() {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => state && state.identity, null, { timeout: 20000 });
  await p.waitForFunction(() => state.connected === true, null, { timeout: 20000 });
  return p;
}

const A = await abre();
const B = await abre();
const idA = await A.evaluate(() => state.identity.peerId);
const idB = await B.evaluate(() => state.identity.peerId);
await A.evaluate((id) => rememberPeer(id, 'B'), idB);
await B.evaluate((id) => rememberPeer(id, 'A'), idA);

// Instrumentamos a B: cuántos ICE recibe y cuántos se aplican de verdad.
await B.evaluate(() => {
  window.__ice = { recibidos: 0, aplicados: 0 };
  const origRecibir = window.recibirSenal;
  window.recibirSenal = async function (m) {
    if (m.kind === 'ice') window.__ice.recibidos++;
    return origRecibir.apply(this, arguments);
  };
  const origCrear = window.creaPeerConnection;
  window.creaPeerConnection = function () {
    const pc = origCrear.apply(this, arguments);
    const add = pc.addIceCandidate.bind(pc);
    pc.addIceCandidate = function (c) { window.__ice.aplicados++; return add(c); };
    return pc;
  };
});

await A.evaluate((id) => { state.activePeer = id; voiceCall(false); }, idB);
await B.waitForFunction(() => !document.getElementById('call-incoming').hidden, null, { timeout: 15000 });

// Dejamos sonar la llamada: los candidatos ICE del llamante llegan ahora.
await new Promise((r) => setTimeout(r, 6000));
await B.click('#call-accept');
await new Promise((r) => setTimeout(r, 6000));

const m = await B.evaluate(() => ({ ...window.__ice }));
console.log('ICE recibidos:', m.recibidos, '| aplicados:', m.aplicados, '| perdidos:', m.recibidos - m.aplicados);
await browser.close();

if (m.recibidos > 0 && m.aplicados >= m.recibidos) {
  console.log('✅ No se pierde ningún candidato ICE');
  process.exit(0);
}
console.error('❌ Se perdieron candidatos ICE: la llamada fallará en redes reales');
process.exit(1);
