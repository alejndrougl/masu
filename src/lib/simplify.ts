import { hex, kmeansLab, labToRgb, nameSwatches, nearestPigment, rgbToLab } from './color';
import type { Rect, Subject, Swatch } from './types';

/**
 * Filtro de Kuwahara: aplana la textura pero conserva los bordes,
 * como una pincelada ancha. Usa imágenes integrales: el radio no cambia el costo.
 */
export function kuwahara(rgba: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const W = w + 1;
  const size = W * (h + 1);
  const iR = new Float64Array(size);
  const iG = new Float64Array(size);
  const iB = new Float64Array(size);
  const iL = new Float64Array(size);
  const iQ = new Float64Array(size);
  for (let y = 0; y < h; y++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sl = 0;
    let sq = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      sr += rgba[p];
      sg += rgba[p + 1];
      sb += rgba[p + 2];
      sl += l;
      sq += l * l;
      const i = (y + 1) * W + x + 1;
      iR[i] = iR[i - W] + sr;
      iG[i] = iG[i - W] + sg;
      iB[i] = iB[i - W] + sb;
      iL[i] = iL[i - W] + sl;
      iQ[i] = iQ[i - W] + sq;
    }
  }
  const out = new Uint8ClampedArray(rgba.length);
  const box = (a: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    a[y1 * W + x1] - a[y0 * W + x1] - a[y1 * W + x0] + a[y0 * W + x0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity;
      let bx0 = 0;
      let by0 = 0;
      let bx1 = 0;
      let by1 = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q & 1 ? x : x - r);
        const y0 = Math.max(0, q & 2 ? y : y - r);
        const x1 = Math.min(w, (q & 1 ? x + r : x) + 1);
        const y1 = Math.min(h, (q & 2 ? y + r : y) + 1);
        const n = (x1 - x0) * (y1 - y0);
        const sum = box(iL, x0, y0, x1, y1);
        const v = box(iQ, x0, y0, x1, y1) / n - (sum / n) ** 2;
        if (v < bestVar) {
          bestVar = v;
          bx0 = x0;
          by0 = y0;
          bx1 = x1;
          by1 = y1;
        }
      }
      const n = (bx1 - bx0) * (by1 - by0);
      const p = (y * w + x) * 4;
      out[p] = box(iR, bx0, by0, bx1, by1) / n;
      out[p + 1] = box(iG, bx0, by0, bx1, by1) / n;
      out[p + 2] = box(iB, bx0, by0, bx1, by1) / n;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** Limpia manchas sueltas: cada píxel toma la etiqueta más común alrededor. */
function majority(labels: Uint8Array, w: number, h: number, k: number, r: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  const counts = new Uint32Array(k);
  for (let y = 0; y < h; y++) {
    counts.fill(0);
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
      for (let xx = 0; xx <= Math.min(w - 1, r); xx++) counts[labels[yy * w + xx]]++;
    }
    for (let x = 0; x < w; x++) {
      let best = 0;
      for (let c = 1; c < k; c++) if (counts[c] > counts[best]) best = c;
      out[y * w + x] = best;
      const leaving = x - r;
      const entering = x + r + 1;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        if (leaving >= 0) counts[labels[yy * w + leaving]]--;
        if (entering < w) counts[labels[yy * w + entering]]++;
      }
    }
  }
  return out;
}

export interface SimplifyParams {
  radius: number;
  colors: number;
  mode: 'color' | 'valor';
  clean: number;
  /** Zonas que no se simplifican (rostros), como fracción del encuadre. */
  protect?: Rect[];
}

/** Cajas de los rostros, como fracción del encuadre: ahí viven los ojos y la boca que no se pueden perder. */
export function faceBoxes(subjects: Subject[], image: { w: number; h: number } | null, rect: Rect | null): Rect[] {
  if (!image || !rect) return [];
  const out: Rect[] = [];
  for (const s of subjects) {
    if (s.kind !== 'human-face' && s.kind !== 'anime-face' && s.kind !== 'animal-face') continue;
    const x0 = Math.max(0, (s.box.x * image.w - rect.x) / rect.w);
    const y0 = Math.max(0, (s.box.y * image.h - rect.y) / rect.h);
    const x1 = Math.min(1, ((s.box.x + s.box.w) * image.w - rect.x) / rect.w);
    const y1 = Math.min(1, ((s.box.y + s.box.h) * image.h - rect.y) / rect.h);
    if (x1 - x0 > 0.01 && y1 - y0 > 0.01) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

export interface SimplifyResult {
  rgba: Uint8ClampedArray;
  swatches: Swatch[];
  /** Cada píxel apunta a su color en `swatches`, 0 el más claro. */
  labels: Uint8Array;
}

/** Reduce la imagen a pocas formas planas y una paleta limitada. */
export function simplifyImage(rgba: Uint8ClampedArray, w: number, h: number, p: SimplifyParams): SimplifyResult {
  const n = w * h;
  // Rostros: se marcan con un margen, y ahí no se aplana ni se limpia (ojos y boca son manchas chicas).
  const prot = new Uint8Array(n);
  let hasProt = false;
  for (const f of p.protect ?? []) {
    const mx = f.w * 0.12;
    const my = f.h * 0.12;
    const x0 = Math.max(0, Math.floor((f.x - mx) * w));
    const x1 = Math.min(w, Math.ceil((f.x + f.w + mx) * w));
    const y0 = Math.max(0, Math.floor((f.y - my) * h));
    const y1 = Math.min(h, Math.ceil((f.y + f.h + my) * h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) prot[y * w + x] = 1;
    hasProt = true;
  }
  let flat = p.radius > 0 ? kuwahara(rgba, w, h, p.radius) : rgba;
  if (hasProt && p.radius > 1) {
    const fine = kuwahara(rgba, w, h, 1);
    flat = new Uint8ClampedArray(flat);
    for (let i = 0; i < n; i++) {
      if (!prot[i]) continue;
      const q = i * 4;
      flat[q] = fine[q];
      flat[q + 1] = fine[q + 1];
      flat[q + 2] = fine[q + 2];
    }
  }
  const lab = (q: number): [number, number, number] => {
    const [L, a, b] = rgbToLab(flat[q], flat[q + 1], flat[q + 2]);
    return p.mode === 'valor' ? [L, 0, 0] : [L, a, b];
  };
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(n / 14000)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) samples.push(...lab((y * w + x) * 4));
  }
  const base = kmeansLab(new Float32Array(samples), p.colors, 14).centers;
  const list: number[][] = [];
  for (let i = 0; i < base.length; i += 3) list.push([base[i], base[i + 1], base[i + 2]]);
  const near = (c: number[]) => list.reduce((m, o) => Math.min(m, (o[0] - c[0]) ** 2 + (o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2), Infinity);
  // Los extremos de valor: sin ellos, el blanco de una camisa o el negro de un ojo se vuelven gris.
  const Ls: number[] = [];
  for (let i = 0; i < samples.length; i += 3) Ls.push(samples[i]);
  const sorted = [...Ls].sort((x, y) => x - y);
  const edge = (lo: number, hi: number): number[] | null => {
    const from = sorted[Math.floor(sorted.length * lo)];
    const to = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * hi))];
    let sum = [0, 0, 0];
    let c = 0;
    for (let i = 0; i < samples.length; i += 3) {
      if (samples[i] >= from && samples[i] <= to) {
        sum = [sum[0] + samples[i], sum[1] + samples[i + 1], sum[2] + samples[i + 2]];
        c++;
      }
    }
    return c ? [sum[0] / c, sum[1] / c, sum[2] / c] : null;
  };
  // El centro más claro (y el más oscuro) se corre al extremo real, así no cambia cuántos colores hay.
  const hi = edge(0.97, 1);
  const lo = edge(0, 0.03);
  const extreme = (pick: (a: number, b: number) => boolean, e: number[] | null, gain: (c: number[]) => boolean) => {
    if (!e || !list.length) return;
    let at = 0;
    list.forEach((c, i) => {
      if (pick(c[0], list[at][0])) at = i;
    });
    if (gain(list[at]) && Math.hypot(list[at][0] - e[0], list[at][1] - e[1], list[at][2] - e[2]) > 6) list[at] = e;
  };
  extreme((a, b) => a > b, hi, (c) => hi![0] - c[0] > 6);
  extreme((a, b) => a < b, lo, (c) => c[0] - lo![0] > 6);
  // Los rasgos de cada rostro: un grupo propio para lo más oscuro y lo más claro dentro de la cara.
  if (hasProt) {
    const face: number[] = [];
    const fstep = Math.max(1, Math.floor(Math.sqrt(prot.reduce((a, v) => a + v, 0) / 3000)));
    for (let y = 0; y < h; y += fstep) for (let x = 0; x < w; x += fstep) if (prot[y * w + x]) face.push(...lab((y * w + x) * 4));
    if (face.length >= 12) {
      const { centers } = kmeansLab(new Float32Array(face), 4, 10);
      for (let i = 0; i < centers.length; i += 3) {
        const c = [centers[i], centers[i + 1], centers[i + 2]];
        if (near(c) > 7 * 7) list.push(c);
      }
    }
  }
  const centers = Float32Array.from(list.flat());
  const k = list.length;
  // Tabla 32³ para asignar cada píxel a su centro sin recorrerlos todos.
  const lut = new Int16Array(32768).fill(-1);
  const labelFor = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let c = lut[key];
    if (c < 0) {
      const [L, a0, b0] = rgbToLab(r, g, b);
      const a = p.mode === 'valor' ? 0 : a0;
      const bb = p.mode === 'valor' ? 0 : b0;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (L - centers[i * 3]) ** 2 + (a - centers[i * 3 + 1]) ** 2 + (bb - centers[i * 3 + 2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      lut[key] = best;
      c = best;
    }
    return c;
  };
  let labels: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const q = i * 4;
    labels[i] = labelFor(flat[q], flat[q + 1], flat[q + 2]);
  }
  if (p.clean > 0) {
    const raw = labels;
    labels = majority(labels, w, h, k, p.clean);
    if (hasProt) for (let i = 0; i < n; i++) if (prot[i]) labels[i] = raw[i];
  }
  const rgb: [number, number, number][] = [];
  for (let i = 0; i < k; i++) rgb.push(labToRgb(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]));
  const counts = new Array<number>(k).fill(0);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    counts[c]++;
    const q = i * 4;
    out[q] = rgb[c][0];
    out[q + 1] = rgb[c][1];
    out[q + 2] = rgb[c][2];
    out[q + 3] = 255;
  }
  const ordered = rgb
    .map((color, i) => ({ i, color, L: centers[i * 3], share: counts[i] / n }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.L - a.L);
  const rankOf = new Uint8Array(k);
  ordered.forEach((s, rank) => (rankOf[s.i] = rank));
  const ranked = new Uint8Array(n);
  for (let i = 0; i < n; i++) ranked[i] = rankOf[labels[i]];
  const swatches = nameSwatches(ordered.map(({ color, share }) => ({ rgb: color, hex: hex(color), share, pigment: nearestPigment(color) })));
  return { rgba: out, swatches, labels: ranked };
}
