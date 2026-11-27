// Auditoría de la interfaz: cada pestaña en tema oscuro a varios tamaños de ventana, y medidas de
// lo que se enciman (elementos que se tapan o se salen). Uso: node dev/interfaz.mjs salida puerto archivo [anchos]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [out, port, file, sizesArg = '1400x900,1280x720,1024x700'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const report = [];
const INSPECT = () => {
      const found = [];
      const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity > 0.05; };
      const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''}${el.textContent ? ` «${el.textContent.trim().slice(0, 30)}»` : ''}`;
      for (const root of document.querySelectorAll('.rail, .panel, .status, .panel-foot, .panel-head')) {
        for (const parent of [root, ...root.querySelectorAll('*')]) {
          const kids = [...parent.children].filter(vis).filter((k) => getComputedStyle(k).position !== 'absolute');
          for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect();
            const c = kids[j].getBoundingClientRect();
            const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
            const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
            if (ox > 2 && oy > 2) found.push(`se enciman: ${label(kids[i])} / ${label(kids[j])} (${Math.round(ox)}×${Math.round(oy)})`);
          }
          if (parent.scrollWidth > parent.clientWidth + 2 && getComputedStyle(parent).overflowX !== 'auto' && parent.clientWidth > 0 && !['svg', 'path'].includes(parent.tagName.toLowerCase())) found.push(`se sale a lo ancho: ${label(parent)} (${parent.scrollWidth} > ${parent.clientWidth})`);
        }
      }
      return [...new Set(found)].slice(0, 25);
    };
const sizes = sizesArg.split(',').map((t) => t.split('x').map(Number));
// Se analiza una sola vez y solo cambia el tamaño de la ventana: el análisis es lo que tarda.
const ctx = await b.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] } });
// IDIOMA=en|es fuerza el idioma de la interfaz (se guarda antes de cargar la página).
if (process.env.IDIOMA) await ctx.addInitScript((l) => { try { localStorage.setItem('masu-idioma', l); } catch {} }, process.env.IDIOMA);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message.slice(0, 200)));
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('.empty-copy');
await page.evaluate(() => window.masu.set({ theme: 'tinta' }));
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${w}x${h}-inicio.png`) });
}
await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
await page.setInputFiles('#picker', file);
await page.waitForSelector('.stage canvas');
await page.click('.rail li:nth-child(10) button'); // Construcción, en cualquier idioma
await page.waitForFunction(() => { const s = window.masu?.get(); return s && s.figuresReady && s.depth && !s.visionStep; }, null, { timeout: 600000 });
const names = await page.$$eval('.rail li button span', (els) => els.map((e) => e.textContent));
for (const [at, name] of names.entries()) {
  await page.click(`.rail li:nth-child(${at + 1}) button`);
  await page.waitForTimeout(at === 7 || at === 8 ? 3500 : 1500); // Perspectiva y Luz tardan más
  for (const [w, h] of sizes) {
    const size = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${size}-${name}.png`) });
    const issues = await page.evaluate(INSPECT);
    report.push(`## ${size} · ${name}\n${issues.map((s) => `- ${s}`).join('\n') || '- (nada)'}`);
  }
}
writeFileSync(join(out, 'encimados.md'), report.join('\n\n'));
await b.close();
console.log('listo');
