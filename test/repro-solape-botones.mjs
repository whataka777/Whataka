// Regresión: los botones de la llamada no deben montarse.
// Al RECIBIR una llamada se oculta la fila de acciones (colgar/silenciar/cámara)
// y se muestra la de aceptar/rechazar. Al ACEPTAR, al revés. Si ambas filas se
// pintan a la vez, se solapan porque comparten anclaje (bottom: 40px).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';
const url = `${BASE}/index.html?relay=${encodeURIComponent(RELAY)}`;
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

async function abre(viewport) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'], viewport });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => state && state.identity, null, { timeout: 20000 });
  await p.waitForFunction(() => state.connected === true, null, { timeout: 20000 });
  return p;
}
const mide = (p) => p.evaluate(() => {
  const inc = document.getElementById('call-incoming');
  // Si falta el id, cae al selector por clase: así la prueba falla limpio en vez de romper.
  const act = document.getElementById('call-actions') || document.querySelector('.call-actions');
  const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null; };
  const solapan = (a, b) => { if (!a || !b) return false; const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return !(ra.bottom <= rb.top || ra.top >= rb.bottom || ra.right <= rb.left || ra.left >= rb.right); };
  return { incVis: vis(inc), actVis: vis(act), solapan: vis(inc) && vis(act) && solapan(inc, act) };
});

let fallos = 0;
for (const [nombre, video, viewport] of [
  ['escritorio/audio', false, { width: 1280, height: 800 }],
  ['móvil/vídeo', true, { width: 412, height: 892 }],
]) {
  const A = await abre(viewport), B = await abre(viewport);
  const idB = await B.evaluate(() => state.identity.peerId);
  await A.evaluate((id) => rememberPeer(id, 'B'), idB);
  await B.evaluate((id) => rememberPeer(id, 'A'), await A.evaluate(() => state.identity.peerId));
  await A.evaluate(([id, v]) => { state.activePeer = id; voiceCall(v); }, [idB, video]);
  await B.waitForFunction(() => !document.getElementById('call-incoming').hidden, null, { timeout: 15000 });
  const sonando = await mide(B);
  await B.click('#call-accept');
  await B.waitForFunction(() => call.maquina && call.maquina.estado === 'activa', null, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const activa = await mide(B);
  const ok = sonando.incVis && !sonando.actVis && !sonando.solapan
          && !activa.incVis && activa.actVis && !activa.solapan;
  if (!ok) fallos++;
  console.log(`${ok ? '✅' : '❌'} ${nombre}`);
  console.log(`   sonando: aceptar/rechazar=${sonando.incVis} acciones=${sonando.actVis} solapan=${sonando.solapan}`);
  console.log(`   activa : aceptar/rechazar=${activa.incVis} acciones=${activa.actVis} solapan=${activa.solapan}`);
  await A.context().close(); await B.context().close();
}
await browser.close();
console.log(fallos ? `❌ ${fallos} caso(s) con botones montados` : '✅ Ningún botón montado');
process.exit(fallos ? 1 : 0);
