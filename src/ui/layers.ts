import { labToRgb } from '../lib/color';
import { partsInFrame, regionOf, type Region } from '../lib/parts';
import { zoneOf } from '../lib/tones';
import { notanMask } from '../lib/notan';
import { figureInFrame } from '../state/engine';
import type { Frame, State } from '../state/store';
import { figureModels, isScene, mainFigures } from './overlays';
import { paintLight } from './light-draw';

export function paperRgb(theme: State['theme']): [number, number, number] {
  return theme === 'papel' ? [242, 238, 229] : [10, 10, 10];
}

/** Escala de N valores iguales, del negro al blanco, como una gama de grises. */
function paintScale(frame: Frame, steps: number): Uint8ClampedArray {
  const n = frame.w * frame.h;
  const out = new Uint8ClampedArray(n * 4);
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const level = Math.min(steps - 1, Math.floor((i / 256) * steps));
    table[i] = labToRgb((level / (steps - 1)) * 100, 0, 0)[0];
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = table[frame.L[i]];
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}

/** Notan: dos valores, luz contra sombra. */
function paintNotan(frame: Frame, cut: number): Uint8ClampedArray {
  const n = frame.w * frame.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = frame.L[i] < cut ? 24 : 240;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v - 8;
    out[p + 3] = 255;
  }
  return out;
}

/** Las cuatro manchas de valor, o solo las zonas elegidas sobre papel. */
function paintValues(frame: Frame, thresholds: State['thresholds'], zones: State['zones'], paper: [number, number, number]): Uint8ClampedArray {
  const n = frame.w * frame.h;
  const out = new Uint8ClampedArray(n * 4);
  const { L, rgba } = frame;
  const any = zones.some(Boolean);
  const zoneTable = new Uint8Array(256);
  const sum = [0, 0, 0, 0];
  const count = [0, 0, 0, 0];
  for (let i = 0; i < 256; i++) {
    const z = zoneOf(i, thresholds);
    zoneTable[i] = z;
    sum[z] += i * frame.stats.hist[i];
    count[z] += frame.stats.hist[i];
  }
  if (!any) {
    const fallback = [32, 96, 160, 224];
    const tone = sum.map((v, z) => {
      const level = count[z] ? v / count[z] : fallback[z];
      return Math.round(255 * (((level / 2.55 + 16) / 116) ** 3 > 0.008856 ? ((level / 2.55 + 16) / 116) ** 3 : level / 2.55 / 903.3) ** (1 / 2.2));
    });
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = tone[zoneTable[L[i]]];
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
      out[p + 3] = 255;
    }
    return out;
  }
  const [pr, pg, pb] = paper;
  const keep = zones.map(Boolean);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (keep[zoneTable[L[i]]]) {
      out[p] = rgba[p];
      out[p + 1] = rgba[p + 1];
      out[p + 2] = rgba[p + 2];
    } else {
      const ghost = L[i] * 0.1;
      out[p] = pr * 0.9 + ghost;
      out[p + 1] = pg * 0.9 + ghost;
      out[p + 2] = pb * 0.9 + ghost;
    }
    out[p + 3] = 255;
  }
  return out;
}

const PART_TINT: Partial<Record<Region, [number, number, number]>> = { cabeza: [227, 35, 27], tronco: [255, 230, 0], brazos: [150, 150, 150], piernas: [40, 40, 40], pies: [245, 245, 240] };

/** Cada parte en su color: deja ver qué entendió Masu de cada figura. */
function paintParts(frame: Frame, s: State, out: Uint8ClampedArray) {
  const { image } = s;
  if (!image) return;
  for (const sub of s.subjects) {
    if (!sub.parts) continue;
    const labels = partsInFrame(sub.parts, frame.rect, image, frame.w, frame.h);
    for (let i = 0, p = 0; i < labels.length; i++, p += 4) {
      const tint = PART_TINT[regionOf(labels[i])];
      if (!tint) continue;
      out[p] = out[p] * 0.4 + tint[0] * 0.6;
      out[p + 1] = out[p + 1] * 0.4 + tint[1] * 0.6;
      out[p + 2] = out[p + 2] * 0.4 + tint[2] * 0.6;
    }
  }
}

function paintFigures(frame: Frame, s: State): Uint8ClampedArray {
  const n = frame.w * frame.h;
  const out = new Uint8ClampedArray(frame.rgba);
  if (s.showParts) {
    paintParts(frame, s, out);
    return out;
  }
  const selected = s.figures.filter((f) => f.id === s.selectedFigure);
  if (!selected.length) return out;
  const mask = new Uint8Array(n);
  for (const f of selected) {
    const m = figureInFrame(f, frame.rect, frame.w, frame.h);
    for (let i = 0; i < n; i++) if (m[i]) mask[i] = 1;
  }
  const [pr, pg, pb] = paperRgb(s.theme);
  const [ir, ig, ib] = s.theme === 'papel' ? [10, 10, 10] : [242, 238, 229];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (mask[i]) {
      if (s.silhouette) {
        out[p] = ir;
        out[p + 1] = ig;
        out[p + 2] = ib;
      }
    } else if (s.silhouette) {
      out[p] = pr;
      out[p + 1] = pg;
      out[p + 2] = pb;
    } else {
      out[p] = pr * 0.86 + out[p] * 0.14;
      out[p + 1] = pg * 0.86 + out[p + 1] * 0.14;
      out[p + 2] = pb * 0.86 + out[p + 2] * 0.14;
    }
  }
  return out;
}

const colorMasses = new WeakMap<object, Map<number, OffscreenCanvas>>();

/** Las figuras que se pintan: las mismas que se construyen. En una escena, toda la imagen. */
function leadingFigures(s: State) {
  if (isScene(s)) return [];
  const list = mainFigures(figureModels(s).list, s);
  const main = s.figures.filter((f) => list.some((m) => m.id === f.id));
  // Un paraguas en la mano es parte del cuadro aunque se haya recortado aparte.
  const held = s.figures.filter((f) => !main.includes(f) && main.some((q) => {
    const x = Math.max(0, Math.min(f.box.x + f.box.w, q.box.x + q.box.w) - Math.max(f.box.x, q.box.x));
    const y = Math.max(0, Math.min(f.box.y + f.box.h, q.box.y + q.box.h) - Math.max(f.box.y, q.box.y));
    return x * y > f.box.w * f.box.h * 0.08 && f.box.w * f.box.h > q.box.w * q.box.h * 0.2;
  }));
  return [...main, ...held];
}

/**
 * La figura en manchas de color, como se pinta: primero pocas masas y al final más. Es el color
 * real de la imagen reducido a una paleta corta, y sale de agrupar los colores que de verdad
 * hay, no de una lista fija: sirve igual para una foto, un óleo o un personaje plano.
 */
function paintFigureColor(ctx: CanvasRenderingContext2D, s: State, count: number, keepBackground = false) {
  const { frame } = s;
  if (!frame) return;
  const { w, h, rgba } = frame;
  let held = colorMasses.get(frame);
  if (!held) colorMasses.set(frame, (held = new Map()));
  const key = count * 1000 + leadingFigures(s).length + (s.theme === 'papel' ? 0 : 500) + (keepBackground ? 0.5 : 0);
  let layer = held.get(key);
  if (!layer) {
    const [pr, pg, pb] = paperRgb(s.theme);
    const mask = new Uint8Array(w * h);
    const list = leadingFigures(s);
    for (const f of list) {
      const m = figureInFrame(f, frame.rect, w, h);
      for (let i = 0; i < m.length; i++) if (m[i]) mask[i] = 1;
    }
    const whole = !list.length;
    // Con el fondo conservado, la paleta sale de toda la imagen y lo de fuera de la figura se atenúa.
    const everything = whole || keepBackground;
    // Se suaviza por canal: las manchas deben ser formas, no ruido.
    const channel = (c: number) => {
      const src = new Float32Array(w * h);
      for (let i = 0, p = c; i < w * h; i++, p += 4) src[i] = rgba[p];
      if (Math.max(w, h) < 420) return src;
      return softChannel(src, w, h, count <= 8 ? 2 : 1);
    };
    const R0 = channel(0);
    const G0 = channel(1);
    const B0 = channel(2);
    const sample: number[] = [];
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 24000)));
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (everything || mask[y * w + x]) sample.push(y * w + x);
    const centers: [number, number, number][] = [];
    for (let k = 0; k < count && sample.length; k++) {
      // Se reparte por luminosidad para que haya luces, medios y oscuros en cada paleta.
      const i = sample[Math.floor(((k + 0.5) / count) * sample.length)];
      centers.push([R0[i], G0[i], B0[i]]);
    }
    const sorted = [...sample].sort((p, q) => R0[p] + G0[p] + B0[p] - R0[q] - G0[q] - B0[q]);
    for (let k = 0; k < centers.length; k++) {
      const i = sorted[Math.floor(((k + 0.5) / centers.length) * sorted.length)];
      centers[k] = [R0[i], G0[i], B0[i]];
    }
    for (let round = 0; round < 10; round++) {
      const sum = centers.map(() => [0, 0, 0, 0]);
      for (const i of sample) {
        let best = 0;
        let least = Infinity;
        for (let k = 0; k < centers.length; k++) {
          const d = (R0[i] - centers[k][0]) ** 2 + (G0[i] - centers[k][1]) ** 2 + (B0[i] - centers[k][2]) ** 2;
          if (d < least) {
            least = d;
            best = k;
          }
        }
        sum[best][0] += R0[i];
        sum[best][1] += G0[i];
        sum[best][2] += B0[i];
        sum[best][3]++;
      }
      sum.forEach((v, k) => {
        if (v[3]) centers[k] = [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
      });
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      out[p + 3] = 255;
      if (!mask[i] && !everything) {
        out[p] = pr;
        out[p + 1] = pg;
        out[p + 2] = pb;
        continue;
      }
      let best = 0;
      let least = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const d = (R0[i] - centers[k][0]) ** 2 + (G0[i] - centers[k][1]) ** 2 + (B0[i] - centers[k][2]) ** 2;
        if (d < least) {
          least = d;
          best = k;
        }
      }
      // El fondo queda a media fuerza: la figura sigue siendo lo que se construyó.
      const fade = !mask[i] && !whole ? 0.55 : 1;
      out[p] = pr + (centers[best][0] - pr) * fade;
      out[p + 1] = pg + (centers[best][1] - pg) * fade;
      out[p + 2] = pb + (centers[best][2] - pb) * fade;
    }
    layer = new OffscreenCanvas(w, h);
    layer.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
    held.set(key, layer);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Paso 9 de una figura: toda ella en dos valores, sobre el papel. */
function paintFigureNotan(ctx: CanvasRenderingContext2D, s: State) {
  const { frame } = s;
  if (!frame) return;
  const { w, h } = frame;
  let held = colorMasses.get(frame);
  if (!held) colorMasses.set(frame, (held = new Map()));
  const list = leadingFigures(s);
  const key = 9e6 + list.length + (s.theme === 'papel' ? 0 : 500);
  let layer = held.get(key);
  if (!layer) {
    const [pr, pg, pb] = paperRgb(s.theme);
    const mask = new Uint8Array(w * h);
    for (const f of list) {
      const m = figureInFrame(f, frame.rect, w, h);
      for (let i = 0; i < m.length; i++) if (m[i]) mask[i] = 1;
    }
    const { dark } = notanMask(frame.L, mask, w, h);
    // Los dos valores se leen sobre el papel de cualquier tema.
    const night = s.theme !== 'papel';
    const shade = night ? [64, 62, 58] : [38, 36, 34];
    const light = night ? [236, 232, 222] : [208, 204, 194];
    const edge = night ? [150, 148, 142] : [120, 118, 112];
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        const i = y * w + x;
        out[p + 3] = 255;
        let c: number[] = [pr, pg, pb];
        if (mask[i]) {
          c = dark[i] ? shade : light;
          // Filo de la silueta: un píxel de borde.
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) c = edge;
        }
        out[p] = c[0];
        out[p + 1] = c[1];
        out[p + 2] = c[2];
      }
    }
    layer = new OffscreenCanvas(w, h);
    layer.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
    held.set(key, layer);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function softChannel(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round((Math.max(w, h) / 500) * radius));
  const pass = (from: Float32Array, stepA: number, stepB: number, lenA: number, lenB: number) => {
    const dst = new Float32Array(w * h);
    for (let b = 0; b < lenB; b++) {
      let sum = 0;
      const at = (a: number) => from[b * stepB + Math.max(0, Math.min(lenA - 1, a)) * stepA];
      for (let a = -r; a <= r; a++) sum += at(a);
      for (let a = 0; a < lenA; a++) {
        dst[b * stepB + a * stepA] = sum / (2 * r + 1);
        sum += at(a + r + 1) - at(a - r);
      }
    }
    return dst;
  };
  return pass(pass(src, 1, w, w, h), w, 1, h, w);
}

function paintFigureInk(ctx: CanvasRenderingContext2D, s: State, over = false) {
  const { frame, ink } = s;
  if (!frame) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const [pr, pg, pb] = paperRgb(s.theme);
  if (!over) {
    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (!ink) return;
  const layer = new OffscreenCanvas(ink.width, ink.height);
  const x = layer.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(ink, 0, 0);
  const img = x.getImageData(0, 0, ink.width, ink.height);
  const mask = new Uint8Array(ink.width * ink.height);
  const list = leadingFigures(s);
  for (const f of list) {
    const m = figureInFrame(f, frame.rect, ink.width, ink.height);
    for (let i = 0; i < m.length; i++) if (m[i]) mask[i] = 1;
  }
  if (list.length) {
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (!mask[i]) {
        img.data[p] = pr;
        img.data[p + 1] = pg;
        img.data[p + 2] = pb;
      }
    }
  }
  // Para sumarse encima, el papel de la tinta debe ser neutro: si no, tiñe lo de abajo.
  if (over && s.theme === 'papel') {
    for (let p = 0; p < img.data.length; p += 4) {
      img.data[p] = Math.min(255, (img.data[p] * 255) / pr);
      img.data[p + 1] = Math.min(255, (img.data[p + 1] * 255) / pg);
      img.data[p + 2] = Math.min(255, (img.data[p + 2] * 255) / pb);
    }
  }
  // Sobre la pintura la línea siempre es oscura, como en el dibujo. En el tema negro la tinta
  // viene clara sobre fondo oscuro, así que se voltea: si no, las sombras salen en negativo.
  if (over && s.theme !== 'papel') {
    const top = 255 - pr;
    for (let p = 0; p < img.data.length; p += 4) {
      img.data[p] = Math.min(255, ((255 - img.data[p]) * 255) / top);
      img.data[p + 1] = Math.min(255, ((255 - img.data[p + 1]) * 255) / top);
      img.data[p + 2] = Math.min(255, ((255 - img.data[p + 2]) * 255) / top);
    }
  }
  x.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Encima de las sombras la tinta se suma, no las tapa.
  if (over) ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(layer, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Pinta la capa base en un canvas del tamaño del encuadre. */
export function paintBase(ctx: CanvasRenderingContext2D, s: State) {
  const { frame, image } = s;
  if (!image) return;
  const canvas = ctx.canvas;
  if (s.mode === 'lienzo' || !frame) return;
  if (s.peek || (s.quick && s.mode === 'construccion')) {
    ctx.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h), 0, 0);
    return;
  }
  if (s.mode === 'luz' && paintLight(ctx, s, paperRgb(s.theme))) return;
  if (s.mode === 'construccion' && s.construction === 10) {
    paintFigureColor(ctx, s, 18, s.keepBackground);
    paintFigureInk(ctx, s, true);
    return;
  }
  if (s.mode === 'construccion' && s.construction === 9) {
    // Una figura: su notan, dos valores. Un lugar no tiene figura que aislar: pocas manchas de color.
    if (isScene(s) || !leadingFigures(s).length) paintFigureColor(ctx, s, 6);
    else paintFigureNotan(ctx, s);
    return;
  }
  if (s.base === 'simple' && s.simplified) {
    ctx.imageSmoothingEnabled = s.style === 'planos' || s.style === 'tinta' || s.style === 'numeros';
    ctx.drawImage(s.simplified.canvas, 0, 0, canvas.width, canvas.height);
    return;
  }
  const map = s.base === 'mapa' ? s.maps[s.mapKind] : undefined;
  if (map) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.canvas, 0, 0, canvas.width, canvas.height);
    return;
  }
  let data: Uint8ClampedArray = frame.rgba;
  if (s.mode === 'figuras') data = paintFigures(frame, s);
  else if (s.base === 'valores') {
    if (s.valueView === 'escala') data = paintScale(frame, s.valueSteps);
    else if (s.valueView === 'notan') data = paintNotan(frame, s.thresholds[1]);
    else data = paintValues(frame, s.thresholds, s.zones, paperRgb(s.theme));
  }
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h), 0, 0);
}

/** Etiqueta de lo que hay que repintar, para no repetir trabajo. */
export function baseKey(s: State): string {
  return [
    s.mode === 'lienzo' ? 'l' : 'r',
    s.base,
    s.mode === 'figuras' ? `f${s.selectedFigure}${s.silhouette}${s.figures.length}${s.showParts}` : '',
    s.mode === 'construccion' ? `c${s.construction}${s.ink ? 1 : 0}${s.figures.length}${s.keepBackground ? 1 : 0}` : '',
    s.theme,
    s.zones.join(),
    s.thresholds.join(),
    s.base === 'simple' ? s.simplifiedRun : '',
    s.valueView,
    s.valueSteps,
    s.base === 'mapa' ? `${s.mapKind}${s.maps[s.mapKind] ? 1 : 0}` : '',
    s.peek ? 'p' : '',
    s.quick ? 'q' : '',
    s.mode === 'luz' ? `z${s.luz.view}${s.figuresReady ? 1 : 0}${s.figures.length}${s.depth ? 1 : 0}${s.lightEdit ? `${s.lightEdit.azimuth}:${s.lightEdit.elevation}` : ''}${s.figurePick ?? ''}` : '',
  ].join('|');
}
