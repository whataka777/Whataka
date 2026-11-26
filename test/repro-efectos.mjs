// Comprueba en un navegador de verdad que:
//  1. la vista pequeña de la videollamada se mueve (no se queda fija),
//  2. el lápiz abre el panel con varios fondos y varios filtros,
//  3. el fondo elegido llega al otro lado de la llamada,
//  4. el filtro elegido llega al otro lado,
//  5. volver a "Sin fondo"/"Normal" devuelve la cámara.
import { chromium } from 'playwright';

const BASE = process.env.WHATAKA_BASE || 'http://localhost:10099';
const url = `${BASE}/index.html?relay=${encodeURIComponent(BASE)}`;
let fallos = 0;
const comprueba = (ok, texto) => {
  console.log(`${ok ? '✅' : '❌'} ${texto}`);
  if (!ok) fallos += 1;
};

const b = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

async function abre(nombre) {
  const ctx = await b.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 420, height: 880 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[${nombre}] error JS:`, e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.connected === true, null, { timeout: 25000 });
  return p;
}

// Color medio de una franja del vídeo, leído del propio elemento.
const colorDeVideo = (p, selector, zona) => p.evaluate(({ selector, zona }) => {
  const v = document.querySelector(selector);
  if (!v || !v.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const ctx = c.getContext('2d');
  ctx.drawImage(v, 0, 0, 64, 36);
  const alto = zona === 'arriba' ? [0, 12] : [24, 36];
  const d = ctx.getImageData(0, alto[0], 64, alto[1] - alto[0]).data;
  let r = 0, g = 0, az = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; az += d[i + 2]; }
  const n = d.length / 4;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(az / n) };
}, { selector, zona });

const A = await abre('A');
const B = await abre('B');
const idA = await A.evaluate(() => state.identity.peerId);
const idB = await B.evaluate(() => state.identity.peerId);
await A.evaluate((id) => rememberPeer(id, 'Bruno'), idB);
await B.evaluate((id) => rememberPeer(id, 'Alicia'), idA);
await A.waitForTimeout(500);

await A.evaluate((id) => { state.activePeer = id; voiceCall(true); }, idB);
await B.waitForSelector('#call-incoming:not([hidden])', { timeout: 20000 });
await B.evaluate(() => aceptarLlamada());
await A.waitForTimeout(3000);

// 1. La vista pequeña avanza.
const antes = await A.evaluate(() => document.getElementById('call-local-video').currentTime);
await A.waitForTimeout(800);
const despues = await A.evaluate(() => document.getElementById('call-local-video').currentTime);
comprueba(despues > antes, `la vista pequeña se mueve (${antes.toFixed(2)}s → ${despues.toFixed(2)}s)`);

// Se queda fija si el navegador la pausa al ocultarse: al mostrarla debe volver.
await A.evaluate(() => {
  document.getElementById('call-local-video').pause();
  mostrarOverlayLlamada(false);
  mostrarOverlayLlamada(true);
});
await A.waitForTimeout(500);
comprueba(await A.evaluate(() => !document.getElementById('call-local-video').paused),
  'al volver a mostrar la llamada, la vista pequeña se reanuda');

// 2. El lápiz abre el panel con fondos y filtros.
comprueba(await A.evaluate(() => getComputedStyle(document.getElementById('call-efectos-btn')).display !== 'none'),
  'el lápiz aparece en la videollamada');
await A.click('#call-efectos-btn');
await A.waitForTimeout(400);
const panel = await A.evaluate(() => ({
  abierto: !document.getElementById('call-efectos').hidden,
  fondos: document.querySelectorAll('#call-efectos-fondos [data-efecto]').length,
  filtros: document.querySelectorAll('#call-efectos-filtros [data-efecto]').length,
}));
comprueba(panel.abierto, 'el panel de efectos se abre');
comprueba(panel.fondos >= 6, `hay varios fondos (${panel.fondos})`);
comprueba(panel.filtros >= 6, `hay varios filtros (${panel.filtros})`);
await A.screenshot({ path: '/tmp/efectos-panel.png' });

// 3. Un filtro llega al otro lado: en blanco y negro el color se aplana.
const colorAntes = await colorDeVideo(B, '#call-remote-video', 'arriba');
await A.click('#call-efectos-filtros [data-efecto="bw"]');
await A.waitForTimeout(1500);
const colorBw = await colorDeVideo(B, '#call-remote-video', 'arriba');
const plano = colorBw && Math.abs(colorBw.r - colorBw.g) < 12 && Math.abs(colorBw.g - colorBw.b) < 12;
comprueba(Boolean(plano), `el filtro B/N llega al otro lado (antes ${JSON.stringify(colorAntes)} → ${JSON.stringify(colorBw)})`);

// 4. Un fondo llega al otro lado: el atardecer pinta la parte de arriba morada.
await A.click('#call-efectos-fondos [data-efecto="atardecer"]');
await A.waitForTimeout(6000);
const colorFondo = await colorDeVideo(B, '#call-remote-video', 'arriba');
const morado = colorFondo && colorFondo.r > 40 && colorFondo.b > colorFondo.g;
comprueba(Boolean(morado), `el fondo llega al otro lado (${JSON.stringify(colorFondo)})`);
const tieneMascara = await A.evaluate(() => Boolean(call.efectos && call.efectos.tieneMascara()));
comprueba(tieneMascara, 'la segmentación de la persona está funcionando');

// 5. Volver a la normalidad devuelve la cámara.
await A.click('#call-efectos-fondos [data-efecto="ninguno"]');
await A.click('#call-efectos-filtros [data-efecto="normal"]');
await A.waitForTimeout(2500);
const colorVuelta = await colorDeVideo(B, '#call-remote-video', 'arriba');
comprueba(Boolean(colorVuelta && !(colorVuelta.r > 40 && colorVuelta.b > colorVuelta.g)),
  `al quitar el efecto vuelve la cámara (${JSON.stringify(colorVuelta)})`);
comprueba(await A.evaluate(() => call.efectos === null), 'el lienzo de efectos se apaga al no haber efecto');

// La llamada sigue en pie después de todo esto.
comprueba(await A.evaluate(() => call.pc && call.pc.connectionState === 'connected'),
  'la llamada sigue conectada después de los efectos');

await b.close();
console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
