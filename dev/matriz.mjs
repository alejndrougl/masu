// Batería de Construcción: cada imagen se analiza una vez y se recorren estilos y pasos en tema
// oscuro. Deja salida/<estilo>/<imagen>-<paso>.png. Uso: node dev/matriz.mjs salida puerto pasos estilos archivo...
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
const [out, port, stepsArg, stylesArg, ...files] = process.argv.slice(2);
const EXAG = { realista: 0, anime: 0.25, cartoon: 0.6, caricatura: 0.5, concept: 0.3, pintura: 0 };
const b = await chromium.launch();
for (const f of files) {
  const name = basename(f).replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '-').slice(0, 24);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  if (process.env.IDIOMA) await ctx.addInitScript((l) => { try { localStorage.setItem('masu-idioma', l); } catch {} }, process.env.IDIOMA);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERROR', name, e.message.slice(0, 200)));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.empty-copy');
  await page.setInputFiles('#picker', f);
  await page.waitForSelector('.stage canvas');
  await page.evaluate(() => window.masu.set({ theme: 'tinta', encajePhoto: 0.3 }));
  await page.click('.rail li:nth-child(10) button'); // Construcción, en cualquier idioma
  const ok = await page.waitForFunction(() => { const s = window.masu?.get(); return s && s.figuresReady && s.depth && !s.visionStep; }, null, { timeout: 400000 }).then(() => true, () => false);
  if (!ok) { console.log('sin terminar', name); await page.close(); continue; }
  for (const style of stylesArg.split(',')) {
    mkdirSync(join(out, style), { recursive: true });
    await page.evaluate(([st, ex]) => window.masu.set({ drawStyle: st, exaggeration: ex }), [style, EXAG[style] ?? 0]);
    for (const st of stepsArg.split(',')) {
      await page.locator('.stages button').nth(Number(st) - 1).click();
      await page.waitForTimeout(900);
      await page.locator('.stage').screenshot({ path: join(out, style, `${name}-${st}.png`) });
    }
  }
  console.log('listo', name);
  await page.close();
}
await b.close();
