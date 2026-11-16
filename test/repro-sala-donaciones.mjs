// Comprueba que la Sala de donaciones abre y muestra taza, manitas, envío/recepción
// en WTK y la guía del DEX, y que NO se llama "billetera".
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:10099';
const RELAY = process.env.RELAY || 'http://localhost:10099';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
await p.goto(`${BASE}/index.html?relay=${encodeURIComponent(RELAY)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof abrirSala === 'function', null, { timeout: 20000 });
await p.click('#btn-sala');
await p.waitForSelector('#sala-screen.active', { timeout: 5000 });

const r = await p.evaluate(() => {
  const txt = document.getElementById('sala-body').innerText;
  const pasos = (id) => document.querySelectorAll(`#${id} li`).length;
  return {
    titulo: document.querySelector('#sala-screen h4').textContent.trim(),
    cafe: !!document.getElementById('sala-cafe') && /café|\$1/i.test(txt),
    manitas: /Mantén WhaTaka viva/.test(txt) && document.getElementById('sala-costes').innerText.includes('Render'),
    enviar: pasos('sala-guia-enviar'),
    recibir: pasos('sala-guia-recibir'),
    cambiar: pasos('sala-guia-cambiar'),
    wtk: /WTK/.test(txt),
    dex: document.getElementById('sala-dex-aviso').textContent.length > 0,
    diceBilletera: /billetera|wallet/i.test(txt),
  };
});
console.log(JSON.stringify(r, null, 2));
const ok = r.titulo.includes('Sala de donaciones') && r.cafe && r.manitas
  && r.enviar >= 3 && r.recibir >= 3 && r.cambiar >= 3 && r.wtk && r.dex && !r.diceBilletera;
console.log(ok ? '✅ Sala de donaciones OK' : '❌ Falta algo en la sala');
await browser.close();
process.exit(ok ? 0 : 1);
