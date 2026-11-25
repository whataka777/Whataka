// El relé se cae y vuelve: la app tiene que reconectar sola, sin recargar.
// Uso: node test/repro-reconexion.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 10098;
const BASE = `http://localhost:${PORT}`;

function arrancaRelay() {
  const proc = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  return proc;
}

async function esperaServidor(intentos = 60) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('el relé no arrancó');
}

let relay = arrancaRelay();
await esperaServidor();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => state && state.identity && state.connected === true, null, { timeout: 20000 });
console.log('✅ La app está conectada');

relay.kill('SIGKILL');
await page.waitForFunction(() => state.connected === false, null, { timeout: 10000 });
const intentos = await page.evaluate(() => state.relayIntentos);
console.log('✅ El relé cae y la app se entera al instante (intentos:', intentos, ')');

relay = arrancaRelay();
await esperaServidor();

// El móvil recupera cobertura: reconectar ya, sin esperar el turno de la espera progresiva.
await page.evaluate(() => window.dispatchEvent(new Event('online')));
const t0 = Date.now();
await page.waitForFunction(() => state.connected === true, null, { timeout: 15000 });
const tardanza = Date.now() - t0;
console.log(`✅ Vuelve a conectar sola en ${tardanza} ms tras recuperar la red`);
if (tardanza > 5000) throw new Error('tardó demasiado en reconectar');

const latido = await page.evaluate(() => typeof latidoTimer === 'number');
if (!latido) throw new Error('el latido del cliente no está activo');
console.log('✅ Latido activo: la conexión no se queda muda a través del NAT');

// Y sin el aviso del navegador, la espera progresiva también reconecta.
relay.kill('SIGKILL');
await page.waitForFunction(() => state.connected === false, null, { timeout: 10000 });
relay = arrancaRelay();
await esperaServidor();
await page.waitForFunction(() => state.connected === true, null, { timeout: 40000 });
console.log('✅ También reconecta sola por su cuenta, sin tocar nada');

await browser.close();
relay.kill('SIGKILL');
console.log('\n🎉 Reconexión automática verificada.');
