import { cellName } from '../lib/canvas';
import { currentRect, prepareWorkbook, stepsReady } from '../state/engine';
import { get, type State } from '../state/store';
import { paintBase } from './layers';
import { buildPrims, type Prim } from './overlays';
import { ROJO } from './palette';

import { t as tx, tr } from '../i18n';
const EXPORT_LONG = 3200;

function resolve(color: string | undefined, css: CSSStyleDeclaration): string {
  if (!color) return 'transparent';
  const m = /var\((--[\w-]+)\)/.exec(color);
  return m ? css.getPropertyValue(m[1]).trim() : color;
}

function drawPrims(ctx: OffscreenCanvasRenderingContext2D, prims: Prim[], u: number, css: CSSStyleDeclaration, W: number, H: number) {
  ctx.lineJoin = 'round';
  for (const p of prims) {
    if (p.t === 'text') {
      ctx.font = `${p.weight ?? 400} ${p.size}px "Zen Kaku Gothic New", sans-serif`;
      ctx.textAlign = (p.anchor === 'middle' ? 'center' : (p.anchor ?? 'start')) as CanvasTextAlign;
      if (p.halo) {
        ctx.lineWidth = 3 * u;
        ctx.strokeStyle = p.fill === ROJO && document.documentElement.dataset.theme === 'tinta' ? 'rgba(10,10,10,.85)' : 'rgba(246,242,233,.85)';
        ctx.strokeText(p.s, p.x, p.y);
      }
      ctx.fillStyle = resolve(p.fill, css);
      ctx.fillText(p.s, p.x, p.y);
      continue;
    }
    const path = new Path2D(p.d);
    ctx.save();
    if (p.clip) {
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
    }
    if (p.fill) {
      ctx.globalAlpha = p.fillAlpha ?? p.alpha ?? 1;
      ctx.fillStyle = resolve(p.fill, css);
      ctx.fill(path, p.even ? 'evenodd' : 'nonzero');
    }
    ctx.globalAlpha = p.alpha ?? 1;
    if (p.stroke) {
      ctx.strokeStyle = resolve(p.stroke, css);
      ctx.lineWidth = (p.w ?? 1) * u;
      ctx.lineCap = p.cap ?? 'butt';
      ctx.setLineDash((p.dash ?? []).map((d) => d * u));
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/** Dibuja una vista completa sobre un lienzo fuera de pantalla. */
function renderView(s: State, longSide: number, withMargin: boolean): OffscreenCanvas | null {
  const rect = currentRect();
  if (!s.image || !rect || !s.frame) return null;
  const k = longSide / Math.max(rect.w, rect.h);
  const W = Math.round(rect.w * k);
  const H = Math.round(rect.h * k);
  const u = Math.max(W, H) / 1000;
  const margin = withMargin && s.grid.visible && s.grid.labels ? Math.round(26 * u) : 0;
  const c = new OffscreenCanvas(W + margin * 2, H + margin * 2);
  const ctx = c.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--paper').trim();
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(margin, margin);
  ctx.imageSmoothingQuality = 'high';
  const stepAlpha = s.mode === 'encaje' || (s.mode === 'construccion' && s.construction < 9) ? s.encajePhoto : 1;
  const usesPhoto = s.base === 'foto' && s.mode !== 'figuras' && !(s.mode === 'construccion' && s.construction >= 9);
  if (usesPhoto) {
    ctx.globalAlpha = stepAlpha;
    ctx.drawImage(s.image.bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
    ctx.globalAlpha = 1;
  } else {
    const layer = new OffscreenCanvas(s.frame.w, s.frame.h);
    paintBase(layer.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D, s);
    ctx.imageSmoothingEnabled = s.base !== 'simple' || s.style !== 'manchas';
    ctx.drawImage(layer, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  }
  drawPrims(ctx, buildPrims(s, { W, H, unit: u }), u, css, W, H);
  return c;
}

async function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const stem = (s: State) => (s.image?.name ?? 'masu').replace(/\.[^.]+$/, '');

export async function downloadSheet() {
  const s = get();
  const rect = currentRect();
  if (!rect) return;
  const c = renderView(s, Math.min(EXPORT_LONG, Math.max(rect.w, rect.h) * 1.5), true);
  if (c) await save(await c.convertToBlob({ type: 'image/png' }), `${stem(s)} ${s.canvas.w}x${s.canvas.h} ${s.mode}.png`);
}

const STEP_NAMES = ['1. Línea de acción', '2. Esqueleto', '3. Círculos y líneas', '4. Bloques y volúmenes', '5. Formas', '6. Planos', '7. Encaje en rectas', '8. Contorno y líneas', '9. Luz y sombra', '10. Dibujo final'];

/** Los diez pasos de construcción en una sola hoja, para tenerla junto al caballete. */
export async function downloadSteps() {
  await stepsReady();
  const s = get();
  const panelLong = 900;
  const views = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((construction) => renderView({ ...s, mode: 'construccion', base: 'foto', construction, encajePhoto: Math.min(s.encajePhoto, 0.14), grid: { ...s.grid, visible: false } }, panelLong, false));
  if (views.some((v) => !v)) return;
  const pw = views[0]!.width;
  const ph = views[0]!.height;
  const gap = 90;
  const pad = 60;
  const label = 110;
  const rowGap = 50;
  const c = new OffscreenCanvas(pad * 2 + pw * 5 + gap * 4, pad * 2 + (ph + label) * 2 + rowGap);
  const ctx = c.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--paper').trim();
  ctx.fillRect(0, 0, c.width, c.height);
  const ink = css.getPropertyValue('--ink').trim();
  const shu = css.getPropertyValue('--shu').trim();
  views.forEach((v, i) => {
    const x = pad + (i % 5) * (pw + gap);
    const y = pad + Math.floor(i / 5) * (ph + label + rowGap);
    ctx.drawImage(v!, x, y);
    ctx.fillStyle = ink;
    ctx.font = '500 34px "Shippori Mincho", serif';
    ctx.textAlign = 'center';
    ctx.fillText(tr(STEP_NAMES[i]), x + pw / 2, y + ph + 66);
    if (i % 5 < 4) {
      const ax = x + pw + 18;
      const ay = y + ph / 2;
      ctx.strokeStyle = shu;
      ctx.fillStyle = shu;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + gap - 44, ay);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax + gap - 34, ay);
      ctx.lineTo(ax + gap - 54, ay - 14);
      ctx.lineTo(ax + gap - 54, ay + 14);
      ctx.fill();
    }
  });
  await save(await c.convertToBlob({ type: 'image/png' }), `${stem(s)} construccion.png`);
}

interface PrintPage {
  url: string;
  width: string;
  height: string;
  caption?: string;
}

async function runPrint(pages: PrintPage[], css: string) {
  const host = document.getElementById('print-sheets')!;
  host.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = css;
  host.appendChild(style);
  const done = pages.map(
    (p) =>
      new Promise<void>((ok) => {
        const fig = document.createElement('figure');
        fig.className = 'print-page';
        const img = new Image();
        img.onload = () => ok();
        img.style.width = p.width;
        img.style.height = p.height;
        img.src = p.url;
        fig.appendChild(img);
        if (p.caption) {
          const cap = document.createElement('figcaption');
          cap.textContent = p.caption;
          fig.appendChild(cap);
        }
        host.appendChild(fig);
      }),
  );
  await Promise.all(done);
  window.print();
}

const toUrl = async (c: OffscreenCanvas) => URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));

export async function printView() {
  const s = get();
  const c = renderView(s, 2400, true);
  if (!c) return;
  await runPrint([{ url: await toUrl(c), width: '100%', height: 'auto' }], '@page { margin: 8mm; }');
}

const PAPERS = { carta: [21.59, 27.94], a4: [21, 29.7] } as const;
export type Paper = keyof typeof PAPERS;

/** Parte el lienzo en hojas a tamaño real, con traslape para pegarlas. */
export async function printRealSize(paper: Paper) {
  const s = get();
  const margin = 1;
  const overlap = 1;
  const [pw, ph] = PAPERS[paper];
  const options = [
    { landscape: false, w: pw - margin * 2, h: ph - margin * 2 - 0.8 },
    { landscape: true, w: ph - margin * 2, h: pw - margin * 2 - 0.8 },
  ].map((o) => {
    const stepX = o.w - overlap;
    const stepY = o.h - overlap;
    const cols = Math.max(1, Math.ceil((s.canvas.w - overlap) / stepX));
    const rows = Math.max(1, Math.ceil((s.canvas.h - overlap) / stepY));
    return { ...o, stepX, stepY, cols, rows, pages: cols * rows };
  });
  const best = options[0].pages <= options[1].pages ? options[0] : options[1];
  const dpi = Math.min(150, 9000 / (Math.max(s.canvas.w, s.canvas.h) / 2.54));
  const pxPerCm = dpi / 2.54;
  const rect = currentRect();
  if (!rect) return;
  const long = Math.max(s.canvas.w, s.canvas.h) * pxPerCm;
  const whole = renderView({ ...s, grid: { ...s.grid, labels: false } }, long, false);
  if (!whole) return;
  const pages: PrintPage[] = [];
  const paperName = paper === 'carta' ? 'letter' : 'A4';
  for (let row = 0; row < best.rows; row++) {
    for (let col = 0; col < best.cols; col++) {
      const x = col * best.stepX;
      const y = row * best.stepY;
      const tw = Math.min(best.w, s.canvas.w - x);
      const th = Math.min(best.h, s.canvas.h - y);
      const c = new OffscreenCanvas(Math.round(tw * pxPerCm), Math.round(th * pxPerCm));
      c.getContext('2d')!.drawImage(whole, x * pxPerCm, y * pxPerCm, tw * pxPerCm, th * pxPerCm, 0, 0, c.width, c.height);
      pages.push({
        url: await toUrl(c),
        width: `${tw}cm`,
        height: `${th}cm`,
        caption: tx('exporter.hoja_de_fila_columna', { v1: pages.length + 1, pages: best.pages, v3: row + 1, v4: col + 1, w: s.canvas.w, h: s.canvas.h, v7: cellName(0, 0) }),
      });
    }
  }
  await runPrint(pages, `@page { size: ${paperName} ${best.landscape ? 'landscape' : 'portrait'}; margin: ${margin}cm; }`);
}

/** Cuaderno de trabajo: varias vistas con la misma cuadrícula, listas para el caballete. */
export async function printWorkbook() {
  await prepareWorkbook();
  const s = get();
  const views: { state: State; caption: string }[] = [
    { state: { ...s, mode: 'cuadros', base: 'foto', focus: null }, caption: tx('exporter.referencia_con_cuadricula') },
    { state: { ...s, mode: 'cuadros', base: 'valores', valueView: 'zonas', zones: [false, false, false, false], focus: null }, caption: tx('exporter.valores_oscuros_sombras_medios') },
  ];
  if (s.simplified) views.push({ state: { ...s, mode: 'cuadros', base: 'simple', focus: null }, caption: tx('common.manchas_de_color') });
  if (s.strokes.length) views.push({ state: { ...s, mode: 'encaje', base: 'foto', encajeStage: 3, encajePhoto: 0, focus: null }, caption: tx('common.encaje') });
  const pages: PrintPage[] = [];
  for (const v of views) {
    const c = renderView(v.state, 2200, true);
    if (c) pages.push({ url: await toUrl(c), width: '100%', height: 'auto', caption: v.caption });
  }
  await runPrint(pages, '@page { margin: 10mm; }');
}
