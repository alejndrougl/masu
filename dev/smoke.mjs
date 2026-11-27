// Prueba rápida de la versión final servida por serve.mjs.
import { chromium } from 'playwright';
const [img, port = '4173'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
let bad = 0;
const missing = [];
p.on('pageerror', (e) => { bad++; console.log('ERROR', e.message.slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await p.goto(`http://localhost:${port}/`);
await p.setInputFiles('#picker', img);
await p.waitForSelector('.stage canvas');
const t0 = Date.now();
const quiet = () => p.waitForFunction(() => !document.querySelector('.status-step') && document.querySelector('.section'), null, { timeout: 280000 });
await quiet();
console.log('lectura lista en', Date.now() - t0, 'ms · aislado', await p.evaluate(() => crossOriginIsolated));
for (const m of ['Lectura', 'Lienzo', 'Cuadros', 'Valores', 'Color', 'Sujetos', 'Composición', 'Perspectiva', 'Luz', 'Construcción', 'Figuras', 'Encaje', 'Simplificar', 'Pintar']) {
  await p.click(`.rail button:has-text("${m}")`);
  await p.waitForTimeout(250);
  await quiet();
}
await p.click('.rail button:has-text("Construcción")');
await p.waitForTimeout(400);
await p.click('.stages button:has-text("Bloques")');
await p.waitForTimeout(500);
const hasFigure = await p.locator('.gesture').count();
console.log('figura:', hasFigure ? (await p.locator('.verdict').first().textContent()).slice(0, 40) : 'sin figura', '| trazos', await p.locator('.sheet svg path').count());
await p.click('.rail button:has-text("Perspectiva")');
await p.waitForTimeout(6000);
console.log('perspectiva:', (await p.locator('.verdict').first().textContent()).slice(0, 70));
console.log('errores', bad, '· archivos faltantes', missing.length, missing.slice(0, 3).join(', '));
await b.close();
