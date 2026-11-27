import { blur } from './edges';
import { rgbToLab } from './color';
import type { Pt } from './types';

export interface MapResult {
  rgba: Uint8ClampedArray;
  /** Reparto, por ejemplo cálido/frío/neutro. */
  shares: number[];
}

const WARM: [number, number, number] = [196, 62, 40];
const COOL: [number, number, number] = [44, 96, 158];
const MID: [number, number, number] = [226, 222, 212];

/** Temperatura de color: dos polos y un neutro al centro. */
export function temperatureMap(rgba: Uint8ClampedArray): MapResult {
  const n = rgba.length >> 2;
  const out = new Uint8ClampedArray(n * 4);
  let warm = 0;
  let cool = 0;
  let neutral = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const [, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    const chroma = Math.hypot(a, b);
    const t = (0.75 * b + 0.45 * a) / 42;
    if (chroma < 6) neutral++;
    else if (t > 0.04) warm++;
    else cool++;
    const v = Math.max(-1, Math.min(1, t));
    const pole = v > 0 ? WARM : COOL;
    const k = Math.abs(v) ** 0.75;
    out[p] = MID[0] + (pole[0] - MID[0]) * k;
    out[p + 1] = MID[1] + (pole[1] - MID[1]) * k;
    out[p + 2] = MID[2] + (pole[2] - MID[2]) * k;
    out[p + 3] = 255;
  }
  return { rgba: out, shares: [warm / n, neutral / n, cool / n] };
}

/** Saturación: un solo tono, de papel a tinta. */
export function saturationMap(rgba: Uint8ClampedArray): MapResult {
  const n = rgba.length >> 2;
  const out = new Uint8ClampedArray(n * 4);
  let vivid = 0;
  let dull = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const [, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    const c = Math.min(1, Math.hypot(a, b) / 72);
    if (c > 0.45) vivid++;
    if (c < 0.12) dull++;
    const v = 242 - 216 * c ** 0.8;
    out[p] = v;
    out[p + 1] = v - 4 * (1 - c);
    out[p + 2] = v - 13 * (1 - c);
    out[p + 3] = 255;
  }
  return { rgba: out, shares: [vivid / n, dull / n] };
}

/** Bordes perdidos y encontrados: duros en tinta, suaves en bermellón claro. */
export function edgeMap(L: Uint8Array, w: number, h: number): MapResult {
  const gray = Float32Array.from(L);
  const diag = Math.hypot(w, h);
  const near = blur(gray, w, h, diag * 0.0012);
  const far = blur(gray, w, h, diag * 0.006);
  const grad = (src: Float32Array, step: number) => {
    const g = new Float32Array(w * h);
    for (let y = step; y < h - step; y++) {
      for (let x = step; x < w - step; x++) {
        const i = y * w + x;
        g[i] = Math.hypot(src[i + step] - src[i - step], src[i + w * step] - src[i - w * step]) / (2 * step);
      }
    }
    return g;
  };
  const g1 = grad(near, 1);
  const g2 = grad(far, 3);
  const out = new Uint8ClampedArray(w * h * 4);
  let hard = 0;
  let soft = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    let r = 242;
    let gr = 238;
    let b = 229;
    if (g1[i] > 9 && g1[i] > g2[i] * 1.9) {
      const k = Math.min(1, (g1[i] - 9) / 16);
      r += (27 - r) * k;
      gr += (26 - gr) * k;
      b += (24 - b) * k;
      if (k > 0.3) hard++;
    } else if (g2[i] > 1.4) {
      const k = Math.min(0.7, (g2[i] - 1.4) / 6);
      r += (196 - r) * k;
      gr += (62 - gr) * k;
      b += (40 - b) * k;
      if (k > 0.2) soft++;
    }
    out[p] = r;
    out[p + 1] = gr;
    out[p + 2] = b;
    out[p + 3] = 255;
  }
  return { rgba: out, shares: [hard / (w * h), soft / (w * h)] };
}

/**
 * Línea de tinta por relación de gaussianas: compara cada zona con su entorno en
 * vez de restarle, así también traza en los oscuros. Devuelve opacidad 0-255.
 */
export function inkLines(L: Uint8Array, w: number, h: number, weight = 1): Uint8Array {
  const gray = Float32Array.from(L);
  const sigma = Math.max(1, Math.hypot(w, h) * 0.0011 * weight);
  const a = blur(gray, w, h, sigma);
  const b = blur(gray, w, h, sigma * 2.2);
  const out = new Uint8Array(w * h);
  const tau = 0.965;
  for (let i = 0; i < out.length; i++) {
    const r = (a[i] + 14) / (b[i] + 14);
    out[i] = r >= tau ? 0 : Math.round(255 * Math.min(1, (tau - r) / 0.07));
  }
  return out;
}

/** Delaunay por Bowyer-Watson: suficiente para unos miles de puntos. */
export function delaunay(points: Pt[]): [number, number, number][] {
  const n = points.length;
  const pts: Pt[] = [...points];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  pts.push([mx - d, my - d], [mx, my + d], [mx + d, my - d]);
  type Tri = { a: number; b: number; c: number; x: number; y: number; r: number };
  const circum = (a: number, b: number, c: number): Tri => {
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const [cx, cy] = pts[c];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
    const A = ax * ax + ay * ay;
    const B = bx * bx + by * by;
    const C = cx * cx + cy * cy;
    const x = (A * (by - cy) + B * (cy - ay) + C * (ay - by)) / D;
    const y = (A * (cx - bx) + B * (ax - cx) + C * (bx - ax)) / D;
    return { a, b, c, x, y, r: (ax - x) ** 2 + (ay - y) ** 2 };
  };
  let tris: Tri[] = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const bad: Tri[] = [];
    const good: Tri[] = [];
    for (const t of tris) {
      if ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r) bad.push(t);
      else good.push(t);
    }
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) good.push(circum(u, v, i));
    tris = good;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

export interface PlanesResult {
  points: Pt[];
  triangles: [number, number, number][];
  colors: [number, number, number][];
}

/** Planos: reduce la imagen a facetas, como las caras talladas de una forma. */
export function lowPoly(rgba: Uint8ClampedArray, L: Uint8Array, w: number, h: number, count: number): PlanesResult {
  const gray = blur(Float32Array.from(L), w, h, Math.hypot(w, h) * 0.0016);
  const weight = new Float32Array(w * h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.hypot(gray[i + 1] - gray[i - 1], gray[i + w] - gray[i - w]);
      weight[i] = g * g + 2;
      total += weight[i];
    }
  }
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points: Pt[] = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const edge = 14;
  for (let i = 1; i < edge; i++) {
    points.push([(i / edge) * (w - 1), 0], [(i / edge) * (w - 1), h - 1], [0, (i / edge) * (h - 1)], [w - 1, (i / edge) * (h - 1)]);
  }
  const prob = count / total;
  const minGap = Math.sqrt((w * h) / count) * 0.32;
  const cell = Math.ceil(minGap);
  const taken = new Set<number>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (rand() > weight[y * w + x] * prob) continue;
      const key = Math.floor(y / cell) * 100000 + Math.floor(x / cell);
      if (taken.has(key)) continue;
      taken.add(key);
      points.push([x, y]);
    }
  }
  const triangles = delaunay(points);
  const colors = triangles.map(([a, b, c]): [number, number, number] => {
    let r = 0;
    let g = 0;
    let bl = 0;
    let k = 0;
    const samples: Pt[] = [
      [(points[a][0] + points[b][0] + points[c][0]) / 3, (points[a][1] + points[b][1] + points[c][1]) / 3],
      [(2 * points[a][0] + points[b][0] + points[c][0]) / 4, (2 * points[a][1] + points[b][1] + points[c][1]) / 4],
      [(points[a][0] + 2 * points[b][0] + points[c][0]) / 4, (points[a][1] + 2 * points[b][1] + points[c][1]) / 4],
      [(points[a][0] + points[b][0] + 2 * points[c][0]) / 4, (points[a][1] + points[b][1] + 2 * points[c][1]) / 4],
    ];
    for (const [x, y] of samples) {
      const p = (Math.round(y) * w + Math.round(x)) * 4;
      r += rgba[p];
      g += rgba[p + 1];
      bl += rgba[p + 2];
      k++;
    }
    return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)];
  });
  return { points, triangles, colors };
}

export interface NumberedResult {
  /** Fronteras entre regiones, 1 = línea. */
  lines: Uint8Array;
  labels: { x: number; y: number; n: number }[];
}

/** Pintar por números: regiones cerradas con el número de su color. */
export function numberRegions(labels: Uint8Array, w: number, h: number, minArea: number): NumberedResult {
  const n = w * h;
  const region = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (region[i] >= 0) continue;
    const id = sizes.length;
    const c = labels[i];
    let size = 0;
    region[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < n && region[q] < 0 && labels[q] === c) {
          region[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
    colors.push(c);
  }
  // Las regiones diminutas se funden con su vecina: nadie pinta una mota.
  const merged = new Int32Array(sizes.length).map((_, i) => i);
  const find = (i: number): number => (merged[i] === i ? i : (merged[i] = find(merged[i])));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const a = find(region[i]);
      if (sizes[a] >= minArea) continue;
      const x = i % w;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (q < 0 || q >= n) continue;
        const b = find(region[q]);
        if (b !== a) {
          merged[a] = b;
          sizes[b] += sizes[a];
          break;
        }
      }
    }
  }
  const final = new Int32Array(n);
  for (let i = 0; i < n; i++) final[i] = find(region[i]);
  const lines = new Uint8Array(n);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (final[i] !== final[i + 1] || final[i] !== final[i + w]) lines[i] = 1;
    }
  }
  // El número va en el punto más alejado del borde de cada región.
  const dist = new Uint16Array(n);
  for (let i = 0; i < n; i++) dist[i] = lines[i] ? 0 : 60000;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - w] + 1);
    }
  }
  for (let y = h - 2; y > 0; y--) {
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + w] + 1);
    }
  }
  const best = new Map<number, { at: number; d: number }>();
  for (let i = 0; i < n; i++) {
    const cur = best.get(final[i]);
    if (!cur || dist[i] > cur.d) best.set(final[i], { at: i, d: dist[i] });
  }
  const out: NumberedResult['labels'] = [];
  for (const [id, { at, d }] of best) {
    if (d < 4) continue;
    out.push({ x: (at % w) / w, y: Math.floor(at / w) / h, n: colors[id] + 1 });
  }
  return { lines, labels: out };
}
