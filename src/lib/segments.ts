import { blur } from './edges';
import type { Pt } from './types';

export interface Segment {
  a: Pt;
  b: Pt;
  /** Largo en píxeles de la imagen analizada. */
  length: number;
  /** Dirección en radianes, entre 0 y π. */
  angle: number;
}

/**
 * Detector de segmentos al estilo LSD (von Gioi et al.): agrupa píxeles vecinos cuyo
 * borde corre en la misma dirección y ajusta un rectángulo a cada grupo. A diferencia
 * de Hough, una textura no da segmentos largos: da muchos grupos diminutos.
 */
export function detectSegments(L: Uint8Array, w: number, h: number, minLength: number): Segment[] {
  const gray = blur(Float32Array.from(L), w, h, 0.9);
  const n = w * h;
  const mag = new Float32Array(n);
  const ang = new Float32Array(n);
  let peak = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (gray[i + 1] + gray[i + w + 1] - gray[i] - gray[i + w]) / 2;
      const gy = (gray[i + w] + gray[i + w + 1] - gray[i] - gray[i + 1]) / 2;
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      // Ángulo de la línea de nivel: 90° respecto al gradiente.
      ang[i] = Math.atan2(gx, -gy);
      if (m > peak) peak = m;
    }
  }
  const threshold = 2 / Math.sin((22.5 * Math.PI) / 180);
  // Orden por magnitud sin ordenar todo: los bordes fuertes siembran primero.
  const BINS = 1024;
  const scale = (BINS - 1) / (peak || 1);
  const head = new Int32Array(BINS).fill(-1);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (mag[i] <= threshold) continue;
    const b = Math.floor(mag[i] * scale);
    next[i] = head[b];
    head[b] = i;
  }
  const used = new Uint8Array(n);
  const tolerance = Math.cos((22.5 * Math.PI) / 180);
  const out: Segment[] = [];
  const stack: number[] = [];
  const region: number[] = [];
  for (let b = BINS - 1; b >= 0; b--) {
    for (let seed = head[b]; seed >= 0; seed = next[seed]) {
      if (used[seed]) continue;
      region.length = 0;
      stack.length = 0;
      stack.push(seed);
      used[seed] = 1;
      let sx = Math.cos(ang[seed]);
      let sy = Math.sin(ang[seed]);
      while (stack.length) {
        const p = stack.pop()!;
        region.push(p);
        const px = p % w;
        const norm = Math.hypot(sx, sy) || 1;
        const ux = sx / norm;
        const uy = sy / norm;
        for (const q of [p - w - 1, p - w, p - w + 1, p - 1, p + 1, p + w - 1, p + w, p + w + 1]) {
          if (q < 0 || q >= n || used[q] || mag[q] <= threshold) continue;
          const qx = q % w;
          if (Math.abs(qx - px) > 1) continue;
          if (Math.abs(Math.cos(ang[q]) * ux + Math.sin(ang[q]) * uy) < tolerance) continue;
          used[q] = 1;
          stack.push(q);
          sx += Math.cos(ang[q]);
          sy += Math.sin(ang[q]);
        }
      }
      if (region.length < minLength * 0.8) continue;
      const seg = fitRect(region, mag, w);
      if (seg && seg.length >= minLength) out.push(seg);
    }
  }
  return out.sort((p, q) => q.length - p.length);
}

function fitRect(region: number[], mag: Float32Array, w: number): Segment | null {
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (const p of region) {
    const m = mag[p];
    sum += m;
    cx += m * (p % w);
    cy += m * Math.floor(p / w);
  }
  cx /= sum;
  cy /= sum;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of region) {
    const m = mag[p];
    const dx = (p % w) - cx;
    const dy = Math.floor(p / w) - cy;
    xx += m * dx * dx;
    yy += m * dy * dy;
    xy += m * dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let lo = Infinity;
  let hi = -Infinity;
  let thin = 0;
  for (const p of region) {
    const dx = (p % w) - cx;
    const dy = Math.floor(p / w) - cy;
    const t = dx * ux + dy * uy;
    const d = Math.abs(-dx * uy + dy * ux);
    if (t < lo) lo = t;
    if (t > hi) hi = t;
    if (d > thin) thin = d;
  }
  const length = hi - lo;
  const width = Math.max(1, thin * 2);
  // Un segmento es largo y angosto, y sus píxeles llenan el rectángulo.
  if (length / width < 3.2) return null;
  if (region.length / (length * width) < 0.42) return null;
  return {
    a: [cx + lo * ux, cy + lo * uy],
    b: [cx + hi * ux, cy + hi * uy],
    length,
    angle: ((theta % Math.PI) + Math.PI) % Math.PI,
  };
}
