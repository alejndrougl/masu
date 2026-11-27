// Recorre lo que un pintor haría de verdad y comprueba cada cosa.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [img, out, photo, port = '5199'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name} ${extra}`);
  if (!ok) fails.push(name);
};
page.on('pageerror', (e) => check(`sin errores: ${e.message.slice(0, 170)}`, false));
await page.addInitScript(() => {
  window.__printed = 0;
  window.print = () => window.__printed++;
});
await page.goto(`http://localhost:${port}/`);
// Tema: se elige desde el inicio y sobrevive a una recarga
const themeOf = () => page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join(' '));
await page.click('.empty-copy button:has-text("Negro")');
await page.waitForTimeout(150);
check('el inicio ofrece el negro', /tinta rgb\(10, 10, 10\)/.test(await themeOf()), await themeOf());
await page.reload();
await page.waitForSelector('.empty-copy');
check('el negro se recuerda al recargar', (await themeOf()).startsWith('tinta'), await themeOf());
await page.click('.empty-copy button:has-text("Claro")');
await page.waitForTimeout(150);
check('vuelve al claro', (await themeOf()).startsWith('papel'));
await page.setInputFiles('#picker', img);
await page.waitForSelector('.stage canvas');
await page.click('.home');
await page.waitForSelector('.empty-copy');
check('Inicio regresa a la pantalla principal', true);
await page.setInputFiles('#picker', img);
await page.waitForSelector('.stage canvas');
const railText = await page.locator('.rail').innerText();
check('el riel no lleva kanji, solo el sello', (railText.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).join('').replace(/升+/, '升') === '升', railText.match(/[\u4e00-\u9fff]/g)?.join(''));
check('cada modo tiene símbolo', (await page.locator('.rail li .mark').count()) === 13);
const quiet = () => page.waitForFunction(() => !document.querySelector('.status-step') && document.querySelector('.section'), null, { timeout: 200000 });
const mode = async (name) => {
  await page.click(`.rail button:has-text("${name}")`);
  await page.waitForTimeout(350);
  await quiet();
  await page.waitForTimeout(350);
};
await quiet();
await page.waitForTimeout(600);
await quiet();

// Lectura
check('abre en Lectura con hallazgos', (await page.locator('.findings li').count()) >= 5);
await page.click('.findings button:has-text("Composición")');
await page.waitForTimeout(400);
await quiet();
check('un hallazgo lleva a su modo', (await page.locator('.panel-head h2').textContent()) === 'Composición');

// Composición: varios esquemas e identifica
const schemes = await page.locator('.schemes li').count();
check('compara varios esquemas', schemes >= 7, `${schemes}`);
await page.click('.schemes button:has-text("Regla de tercios")');
await page.waitForTimeout(250);
const reframe = await page.locator('button:has-text("Reencuadrar")').count();
if (reframe) {
  await page.click('button:has-text("Reencuadrar")');
  await page.waitForTimeout(1600);
  await quiet();
  const after = await page.locator('.schemes button:has-text("Regla de tercios") small').textContent();
  check('al reencuadrar el esquema mejora', after === 'Domina' || after === 'En parte', after);
} else {
  check('reencuadre: no hay foto de sobra o ya encaja', true);
}
for (const t of ['Peso visual', 'Atención']) await page.click(`.toggle:has-text("${t}")`);
await page.waitForTimeout(350);
await page.screenshot({ path: join(out, 'guias.png') });
for (const t of ['Peso visual', 'Atención']) await page.click(`.toggle:has-text("${t}")`);

// Perspectiva: detectar, marcar y corregir
await mode('Perspectiva');
await page.waitForFunction(() => window.masu.get().depth, null, { timeout: 60000 });
await page.waitForTimeout(500);
const before = await page.locator('.vps li').count();
await page.click('button:has-text("Agregar punto")');
const bp = await page.locator('.sheet').boundingBox();
await page.mouse.click(bp.x + bp.width * 0.52, bp.y + bp.height * 0.4);
await page.waitForTimeout(350);
const withPoint = await page.locator('.vps li').count();
check('agregar un punto de fuga a mano', withPoint === before + 1, `${before} -> ${withPoint}`);
await page.click('.toggle:has-text("Abanico")');
await page.waitForTimeout(250);
await page.screenshot({ path: join(out, 'abanico.png') });
const dragFrom = [bp.x + bp.width * 0.52, bp.y + bp.height * 0.4];
await page.mouse.move(dragFrom[0], dragFrom[1]);
await page.mouse.down();
await page.mouse.move(dragFrom[0] + 90, dragFrom[1] + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(250);
const moved = await page.evaluate(() => window.masu.get().vpEdit.at(-1).point[0]);
check('arrastrar un punto lo mueve', moved > 0.55, moved.toFixed(2));
await page.click('.toggle:has-text("Ver afuera")');
await page.waitForTimeout(350);
await page.click('.toggle:has-text("Ver afuera")');
await page.click('.toggle:has-text("Abanico")');
await page.locator('.vps .x').last().click();
await page.waitForTimeout(250);
check('quitar un punto', (await page.locator('.vps li').count()) === before);

// Valores con color
await mode('Valores');
check('el histograma lleva color', (await page.locator('.hist svg rect').count()) > 50);
await page.click('.hist .minitabs button:has-text("RGB")');
await page.waitForTimeout(150);
check('el histograma tiene vista RGB', (await page.locator('.hist-ch').count()) >= 3);
await page.click('.hist .minitabs button:has-text("Color")');
const spectroColor = await page.evaluate(() => {
  const c = document.querySelector('.spectro canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let tinted = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) tinted++;
  return tinted;
});
check('el espectrograma muestra colores reales', spectroColor > 100, `${spectroColor} celdas`);

// Perspectiva curva a mano
await mode('Perspectiva');
await page.click('.segmented button:has-text("Curvas")');
await page.waitForTimeout(1500);
check('Curvas fuerza la lectura curva', await page.evaluate(() => !!window.masu.get().lensRead?.curve));
await page.locator('.slider:has-text("Curvatura") input').fill('0.6');
await page.waitForTimeout(250);
check('la curvatura cambia la lectura', await page.evaluate(() => Math.abs(window.masu.get().lensRead?.curve?.k + 0.6) < 0.01));
await page.click('.segmented button:has-text("Rectas")');
await page.waitForTimeout(1200);
check('Rectas quita la curva', await page.evaluate(() => { const r = window.masu.get().lensRead; return !!r && !r.curve; }));
await page.click('.segmented button:has-text("Automático")');
await page.waitForTimeout(200);

// Cuerpo 3D y esqueleto
await mode('Construcción');
await page.waitForFunction(() => window.masu.get().subjects.some((s) => s.body), null, { timeout: 200000 }).catch(() => {});
check('hay cuerpo 3D', await page.evaluate(() => window.masu.get().subjects.some((s) => s.body)));
await page.click('.stages button:has-text("Bloques")');
await page.waitForTimeout(500);
check('el visor 3D aparece', (await page.locator('.bodyview canvas').count()) === 1);
await page.click('.toggle:has-text("Mover articulaciones")');
await page.waitForTimeout(300);
const grab = await page.evaluate(() => {
  const s = window.masu.get();
  const m = window.masu.figureModels(s).list.find((x) => x.mannequin);
  const p = m.mannequin.rig.pts[7];
  const r = document.querySelector('.sheet').getBoundingClientRect();
  return { x: r.left + (p[0] / (s.canvas.w / s.canvas.h)) * r.width, y: r.top + p[1] * r.height };
});
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.mouse.move(grab.x + 30, grab.y - 20, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(300);
check('arrastrar mueve la articulación', await page.evaluate(() => Object.values(window.masu.get().rigEdits).some((e) => Object.keys(e).length > 0)));
await page.click('button:has-text("Volver a lo detectado")');
await page.click('.toggle:has-text("Mover articulaciones")');
await page.waitForTimeout(200);

// Construcción y su tira
await mode('Construcción');
await page.click('.stages button:has-text("Bloques")');
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'cilindros.png') });
check('los cilindros se dibujan', (await page.locator('.sheet svg path').count()) > 20);
await page.click('.stages button:has-text("Dibujo final")');
await page.waitForTimeout(700);
await quiet();
const [strip] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('button:has-text("Guardar los 10 pasos")')]);
const stripPath = join(out, 'tira.png');
await strip.saveAs(stripPath);
check('guarda los 10 pasos en una hoja', statSync(stripPath).size > 40000, `${(statSync(stripPath).size / 1e6).toFixed(1)} MB`);
check('hay 10 niveles de construcción', (await page.locator('.stages button').count()) === 10);
for (const [name, pick] of [['Esqueleto', 1], ['Círculos', 2], ['Formas', 4], ['Planos', 5], ['Encaje en rectas', 6], ['Contorno y líneas', 7], ['Dos valores', 8]]) {
  await page.locator('.stages button').nth(pick).click();
  await page.waitForTimeout(500);
  // Luz y sombra se pinta en el lienzo: encima solo lleva el contorno.
  check(`el nivel ${name} dibuja`, (await page.locator('.sheet svg path').count()) > (name === 'Dos valores' ? 0 : 3));
}
await page.locator('.stages button').nth(3).click();
await page.waitForTimeout(400);
const faceSteps = page.locator('section:has-text("La cabeza") .pieces button, .section:has-text("La cabeza") .pieces button');
if (await faceSteps.count()) {
  check('la cabeza se arma por pasos', (await faceSteps.count()) >= 5);
  const methods = page.locator('section:has-text("La cabeza") .chips .chip, .section:has-text("La cabeza") .chips .chip');
  check('hay varios métodos de cabeza', (await methods.count()) >= 2, `${await methods.count()}`);
  await faceSteps.nth(4).click();
  await page.waitForTimeout(300);
  check('elegir un paso acerca la cara', await page.evaluate(() => window.masu.get().faceStage === 5 && !!window.masu.get().closeUp));
  await methods.nth(1).click();
  await page.waitForTimeout(300);
  check('cambiar de método cambia los pasos', await page.evaluate(() => !!window.masu.get().headMethod));
  await faceSteps.nth(0).click();
  await page.waitForTimeout(200);
}
const parts = page.locator('.section:has-text("Ojos, nariz y boca") .chips .chip, section:has-text("Ojos, nariz y boca") .chips .chip');
if (await parts.count()) {
  check('ojos, nariz y boca de cerca', (await parts.count()) === 4, `${await parts.count()}`);
  await parts.first().click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.masu.get().detail);
  await page.click('button:has-text("Siguiente")');
  await page.waitForTimeout(200);
  check('un rasgo avanza por etapas', await page.evaluate((b) => window.masu.get().detail?.stage === b.stage + 1, before));
  check('un rasgo dibuja su construcción', (await page.locator('.sheet svg path').count()) > 3);
  await parts.first().click();
  await page.waitForTimeout(200);
}

// Cuadros
await mode('Cuadros');
const box = await page.locator('.sheet').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForSelector('.cell-view');
await page.waitForTimeout(250);
const title = await page.locator('.section-head h3').first().textContent();
check('tocar un cuadro lo abre', /Cuadro [A-Z]+\d+/.test(title), title);
await page.keyboard.press('ArrowRight');
await page.keyboard.press(' ');
await page.waitForTimeout(150);
check('flechas y espacio', (await page.locator('.counter').first().textContent()).startsWith('1/'));

// Valores
await mode('Valores');
await page.click('.segmented button:has-text("Escala")');
await page.waitForTimeout(200);
check('escala de valores', (await page.locator('.scale span').count()) === 5);
await page.click('.segmented button:has-text("Notan")');
await page.waitForTimeout(200);
await page.screenshot({ path: join(out, 'notan.png') });
await page.click('.segmented button:has-text("Zonas")');

// Color
await mode('Color');
for (const v of ['Temperatura', 'Saturación', 'Bordes']) {
  await page.click(`.chip:has-text("${v}")`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `mapa-${v}.png`) });
}
await page.click('.chip:has-text("Foto")');
await page.waitForTimeout(250);
await page.click('.chip:has-text("Zorn")');
await page.waitForFunction(() => document.querySelector('.recipe-swatches'), null, { timeout: 20000 });
check('hay receta con Zorn', (await page.locator('.recipe').count()) > 2);
await page.screenshot({ path: join(out, 'zorn.png') });
const b2 = await page.locator('.sheet').boundingBox();
await page.mouse.click(b2.x + b2.width * 0.5, b2.y + b2.height * 0.55);
await page.waitForTimeout(800);
const sampled = await page.locator('.sample header:has(.x)').count();
check('el gotero toma una muestra', sampled === 1, `${sampled}`);
await page.click('.chip:has-text("Básica")');

// Simplificar: los cinco estilos
await mode('Simplificar');
const sign = () => page.evaluate(() => {
  const c = document.querySelector('.sheet canvas.front');
  const s = document.createElement('canvas');
  s.width = 24;
  s.height = 24;
  const x = s.getContext('2d');
  x.drawImage(c, 0, 0, 24, 24);
  return Array.from(x.getImageData(0, 0, 24, 24).data).join();
});
const looks = new Set([await sign()]);
for (const st of ['Planos', 'Tinta', 'Números', 'Proceso']) {
  await page.click(`.chip:has-text("${st}")`);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(out, `estilo-${st}.png`) });
  looks.add(await sign());
}
check('cada estilo cambia la imagen', looks.size === 5, `${looks.size} de 5`);
await page.click('.stages button:has-text("Acabado")');
await page.waitForTimeout(900);
looks.add(await sign());
check('los pasos del proceso cambian la imagen', looks.size === 6);
await page.click('.chip:has-text("Manchas")');
await page.waitForTimeout(500);
const beforeSlider = await sign();
await page.locator('.slider input').last().fill('3');
await page.waitForTimeout(900);
check('los deslizadores cambian la imagen', (await sign()) !== beforeSlider);

// Herramientas
await page.click('.tool:has-text("Espejo")');
await page.click('.tool:has-text("De cabeza")');
await page.waitForTimeout(200);
const flipped = await page.locator('.sheet-inner').evaluate((e) => e.style.transform);
check('espejo y de cabeza', /scaleX\(-1\).*rotate/.test(flipped), flipped);
await page.click('.tool:has-text("Espejo")');
await page.click('.tool:has-text("De cabeza")');
await mode('Cuadros');
await page.keyboard.press('r');
const b3 = await page.locator('.sheet').boundingBox();
await page.mouse.move(b3.x + 60, b3.y + 60);
await page.mouse.down();
await page.mouse.move(b3.x + 260, b3.y + 200, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(150);
const ruler = await page.locator('.sheet svg text.halo').last().textContent();
check('la regla mide en cm', /cm/.test(ruler), ruler);
await page.keyboard.press('r');
await page.keyboard.down('o');
await page.waitForTimeout(150);
const peek = await page.evaluate(() => window.masu.get().peek);
await page.keyboard.up('o');
check('O muestra la foto', peek);
await page.keyboard.press('?');
await page.waitForTimeout(250);
check('ayuda de teclado', (await page.locator('.help dl div').count()) > 8);
await page.keyboard.press('Escape');

// Pintar
await mode('Pintar');
await page.click('.segmented button:has-text("Orden")');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'ruta.png') });
await page.click('.segmented button:has-text("Dificultad")');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'dificultad.png') });
await page.click('.segmented button:has-text("Limpio")');
await page.click('button:has-text("Seguir con")');
await page.waitForSelector('.focus');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'enfoque.png') });
check('pantalla de pintar', (await page.locator('.focus h2').textContent()).length > 1);
await page.keyboard.press(' ');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('sale de la pantalla de pintar', (await page.locator('.focus').count()) === 0);

// Comparar con mi pintura
await page.locator('input[aria-label="Foto de tu pintura"]').setInputFiles(photo);
await page.waitForSelector('.corners');
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'esquinas.png') });
await page.click('.overlay button:has-text("Comparar")');
await page.waitForTimeout(1500);
check('compara con la foto de la pintura', (await page.locator('button:has-text("Quitar")').count()) === 1);
await page.screenshot({ path: join(out, 'comparar.png') });
await page.click('button:has-text("Quitar")');

// Imprimir
const printing = async (label) => {
  await page.evaluate(() => (window.__printed = 0));
  await page.click('.menu > button');
  await page.waitForTimeout(250);
  await page.click(`.menu-list button:has-text("${label}")`);
  await page.waitForFunction(() => window.__printed > 0, null, { timeout: 30000 });
};
await printing('Tamaño real en hojas carta');
const sheets = await page.locator('.print-page').count();
check('parte a tamaño real en hojas', sheets > 1, `${sheets} hojas`);
await page.emulateMedia({ media: 'print' });
const pdf = join(out, 'tamano-real.pdf');
await page.pdf({ path: pdf, preferCSSPageSize: true });
check('el PDF de tamaño real sale', statSync(pdf).size > 30000, `${(statSync(pdf).size / 1e6).toFixed(1)} MB`);
await page.emulateMedia({ media: 'screen' });
await printing('Cuaderno de trabajo');
const pages = await page.locator('.print-page').count();
check('cuaderno de trabajo', pages >= 3, `${pages} páginas`);
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: join(out, 'cuaderno.pdf'), preferCSSPageSize: true });
await page.emulateMedia({ media: 'screen' });

// Exportar y volver
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('text=Guardar PNG')]);
const p = join(out, 'vista.png');
await dl.saveAs(p);
check('guarda PNG', statSync(p).size > 20000, dl.suggestedFilename());
await page.waitForTimeout(900);
await page.click('.home');
await page.waitForSelector('.empty-copy');
await page.waitForTimeout(600);
check('el inicio ofrece seguir', (await page.locator('.recent').count()) >= 1);
await page.click('.recent');
await page.waitForSelector('.stage canvas');
await quiet();
await page.waitForTimeout(500);
const progress = await page.evaluate(() => window.masu.get().done.length);
check('recupera el avance', progress >= 1, `${progress} cuadros pintados`);

writeFileSync(join(out, 'resultado.txt'), fails.join('\n'));
console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTodo bien');
await browser.close();
