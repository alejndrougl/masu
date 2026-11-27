// Junta en una imagen los tres estilos de una misma figura y paso. Uso: node dev/lado-a-lado.mjs carpeta imagen paso
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [dir, name, step] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 2480, height: 760 } });
const uri = (e) => `data:image/png;base64,${readFileSync(resolve(dir, e, `${name}-${step}.png`)).toString('base64')}`;
const imgs = ['realista', 'anime', 'cartoon'].map((e) => `<figure style="margin:0"><img src="${uri(e)}" style="height:720px"><figcaption style="color:#ddd;font:20px sans-serif">${e}</figcaption></figure>`).join('');
await page.setContent(`<body style="background:#0a0a0a;margin:8px;display:flex;gap:8px">${imgs}</body>`);
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(dir, `lado-${name}-${step}.png`) });
await b.close();
