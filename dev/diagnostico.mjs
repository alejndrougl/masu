// Diagnóstico de Construcción: cada paso de una imagen en tema oscuro, ventana completa (para ver
// también la interfaz) y solo el escenario. Uso: node dev/diagnostico.mjs salida puerto pasos archivo...
// Variables: ANCHO y ALTO (ventana, 1400x900), METODO (bodyMethod), ESTILO (drawStyle: realista, anime, cartoon, caricatura, concept, pintura).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
const [out, port, stepsArg, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = Number(process.env.ANCHO ?? 1400);
const H = Number(process.env.ALTO ?? 900);
const b = await chromium.launch();
for (const f of files) {
  const name = basename(f).replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '-').slice(0, 24);
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  page.on('pageerror', (e) => console.log('ERROR', name, e.message.slice(0, 200)));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.empty-copy');
  await page.setInputFiles('#picker', f);
  await page.waitForSelector('.stage canvas');
  await page.evaluate(([m, e, f]) => {
    const extra = { theme: 'tinta' };
    if (m) extra.bodyMethod = m;
    if (e) { extra.drawStyle = e; extra.exaggeration = { realista: 0, anime: 0.25, cartoon: 0.6, caricatura: 0.5, concept: 0.3, pintura: 0 }[e] ?? 0; }
    if (f) extra.encajePhoto = f;
    window.masu.set(extra);
  }, [process.env.METODO ?? '', process.env.ESTILO ?? '', process.env.FOTO ? Number(process.env.FOTO) : 0]);
  await page.click('.rail button:has-text("Construcción")');
  await page.waitForFunction(() => { const s = window.masu?.get(); return s && s.figuresReady && s.depth && !s.visionStep; }, null, { timeout: 240000 });
  for (const st of stepsArg.split(',')) {
    await page.locator('.stages button').nth(Number(st) - 1).click();
    if (Number(st) >= 7) await page.waitForFunction(() => window.masu.get().formStrokes.length > 0 && !document.querySelector('.status-step'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, `${name}-${st}-app.png`) });
    await page.locator('.stage').screenshot({ path: join(out, `${name}-${st}.png`) });
  }
  console.log('listo', name, JSON.stringify(await page.evaluate(() => globalThis.__organicMs ?? null)));
  await page.close();
}
await b.close();
