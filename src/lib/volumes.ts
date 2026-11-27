import { bestTriangle, convexHull } from './composition';
import { distanceToEdge } from './gesture';
import type { Pt } from './types';

import { t as tx } from '../i18n';
export interface Turn {
  yaw: number;
  pitch: number;
  roll: number;
}

export type V3 = [number, number, number];

/** Rostro genérico en 3D, en los mismos puntos que usa la pose (68 puntos de iBUG). */
const FACE_MODEL: [number, V3][] = [
  [30, [0, 0, 0]], // punta de la nariz
  [8, [0, 330, -65]], // mentón
  [36, [-225, -170, -135]], // ojo, comisura exterior
  [45, [225, -170, -135]],
  [39, [-75, -170, -160]], // ojo, comisura interior
  [42, [75, -170, -160]],
  [48, [-150, 150, -125]], // boca
  [54, [150, 150, -125]],
  [27, [0, -180, -110]], // puente de la nariz
];

/** Rotación, escala y traslado de un modelo 3D a lo que se ve: a, b y c son las filas. */
export interface OrthoFit {
  a: V3;
  b: V3;
  c: V3;
  s: number;
  t: Pt;
}

/**
 * Proyección ortográfica: se ajusta una matriz 2×3 entre el rostro 3D genérico y lo
 * visto, y se ortonormaliza. Sirve para anime, máscaras y dibujos, donde no hay malla facial.
 */
export function fitOrtho(pts: Pt[], vis: number[], aspect: number): OrthoFit | null {
  const used = FACE_MODEL.filter(([i]) => vis[i] > 0.25);
  if (used.length < 5) return null;
  const n = used.length;
  const X = used.map(([, v]) => v);
  const u = used.map(([i]) => pts[i][0] * aspect);
  const v = used.map(([i]) => pts[i][1]);
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / n;
  const mu = mean(u);
  const mv = mean(v);
  const mx: V3 = [mean(X.map((p) => p[0])), mean(X.map((p) => p[1])), mean(X.map((p) => p[2]))];
  const A = X.map((p): V3 => [p[0] - mx[0], p[1] - mx[1], p[2] - mx[2]]);
  // Ecuaciones normales: AᵀA m = Aᵀb para cada fila de la matriz.
  const ata: number[][] = [0, 1, 2].map((r) => [0, 1, 2].map((c) => A.reduce((s, a) => s + a[r] * a[c], 0)));
  const solve = (b: number[]): V3 | null => {
    const aty = [0, 1, 2].map((r) => A.reduce((s, a, i) => s + a[r] * b[i], 0));
    const M = ata.map((row, i) => [...row, aty[i]]);
    for (let i = 0; i < 3; i++) {
      let pivot = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
      [M[i], M[pivot]] = [M[pivot], M[i]];
      if (Math.abs(M[i][i]) < 1e-9) return null;
      const d = M[i][i];
      for (let c = i; c < 4; c++) M[i][c] /= d;
      for (let r = 0; r < 3; r++) {
        if (r === i) continue;
        const f = M[r][i];
        for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
      }
    }
    return [M[0][3], M[1][3], M[2][3]];
  };
  const r1 = solve(u.map((q) => q - mu));
  const r2 = solve(v.map((q) => q - mv));
  if (!r1 || !r2) return null;
  const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a: V3): V3 => {
    const l = length(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const a = norm(r1);
  const dotAB = a[0] * r2[0] + a[1] * r2[1] + a[2] * r2[2];
  const b = norm([r2[0] - dotAB * a[0], r2[1] - dotAB * a[1], r2[2] - dotAB * a[2]]);
  const c = cross(a, b);
  const s = (length(r1) + length(r2)) / 2;
  const t: Pt = [mu - s * (a[0] * mx[0] + a[1] * mx[1] + a[2] * mx[2]), mv - s * (b[0] * mx[0] + b[1] * mx[1] + b[2] * mx[2])];
  return { a, b, c, s, t };
}

/** c es el eje z del modelo visto por la cámara: hacia dónde apunta la nariz. */
export function turnOf({ a, b, c }: OrthoFit): Turn {
  const deg = (t: number) => Math.round((t * 180) / Math.PI);
  return {
    yaw: deg(Math.atan2(a[2], c[2])),
    pitch: deg(Math.asin(Math.max(-1, Math.min(1, b[2])))),
    roll: deg(Math.atan2(-a[1], b[1])),
  };
}

/** Hacia dónde mira un rostro a partir de sus puntos 2D. */
export function headTurn(pts: Pt[], vis: number[], aspect: number): Turn | null {
  const fit = fitOrtho(pts, vis, aspect);
  return fit ? turnOf(fit) : null;
}

/** Dirección de la mirada, escrita como se la dirías a alguien. */
export function describeTurn(t: Turn): string {
  const side = Math.abs(t.yaw) < 10 ? '' : t.yaw > 0 ? tx('common.la_derecha_2') : tx('common.la_izquierda_2');
  const height = Math.abs(t.pitch) < 10 ? '' : t.pitch > 0 ? tx('common.abajo') : tx('common.arriba');
  if (!side && !height) return tx('volumes.mira_de_frente');
  return tx('volumes.mira', { v1: [height, side].filter(Boolean).join(tx('common.sep_y')) });
}

/** Punta de la flecha que sale de la cara, relativa a su radio. */
export function gazeTip(t: Turn): Pt {
  const rad = Math.PI / 180;
  const cp = Math.cos(t.pitch * rad);
  return [Math.sin(t.yaw * rad) * cp, Math.sin(t.pitch * rad)];
}

export interface Circle {
  c: Pt;
  /** En altos de encuadre. */
  r: number;
}

/**
 * Descompone una silueta en círculos: el mayor que cabe, luego el mayor que cabe en
 * lo que queda, y así. Es lo que hace un dibujante con una masa desconocida.
 */
export function massCircles(mask: Uint8Array, w: number, h: number, count = 9): Circle[] {
  const field = distanceToEdge(mask, w, h);
  const free = Float32Array.from(field, (v) => v / 3);
  const out: Circle[] = [];
  let first = 0;
  for (let k = 0; k < count; k++) {
    let best = -1;
    let r = 0;
    for (let i = 0; i < free.length; i++) {
      if (free[i] > r) {
        r = free[i];
        best = i;
      }
    }
    if (best < 0) break;
    if (!first) first = r;
    if (r < Math.max(first * 0.2, 3)) break;
    const cx = best % w;
    const cy = Math.floor(best / w);
    out.push({ c: [cx / w, cy / h], r: r / h });
    const reach = r * 1.25;
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= reach * reach) free[y * w + x] = 0;
    }
  }
  return out;
}

/** Une los círculos con el árbol más corto: las líneas que los conectan. */
export function linkCircles(circles: Circle[], aspect: number): [number, number][] {
  const n = circles.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  inTree[0] = true;
  const links: [number, number][] = [];
  for (let k = 1; k < n; k++) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let a = 0; a < n; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < n; b++) {
        if (inTree[b]) continue;
        const d = Math.hypot((circles[a].c[0] - circles[b].c[0]) * aspect, circles[a].c[1] - circles[b].c[1]) - circles[a].r - circles[b].r;
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestB < 0) break;
    inTree[bestB] = true;
    links.push([bestA, bestB]);
  }
  return links;
}

export type PrimitiveKind = 'esfera' | 'cilindro' | 'caja' | 'cono';

export interface Primitive {
  kind: PrimitiveKind;
  name: string;
  /** Centro, normalizado. */
  c: Pt;
  /** Semiejes en píxeles de la máscara. */
  major: number;
  minor: number;
  /** Ángulo del eje mayor, en radianes. */
  angle: number;
  /** Solo en caja y cono: esquinas, normalizadas. */
  corners?: Pt[];
  /** Qué tan bien describe la silueta, 0 a 1. */
  fit: number;
}

const CLASS_SHAPE: Record<string, PrimitiveKind> = {
  Botella: 'cilindro', Taza: 'cilindro', Florero: 'cilindro', Copa: 'cono', Tazón: 'cilindro', Reloj: 'esfera',
  Pelota: 'esfera', Manzana: 'esfera', Naranja: 'esfera', Dona: 'esfera', Pizza: 'esfera',
  Coche: 'caja', Autobús: 'caja', Camión: 'caja', Tren: 'caja', Laptop: 'caja', Televisión: 'caja', Libro: 'caja',
  Maleta: 'caja', Microondas: 'caja', Horno: 'caja', Refrigerador: 'caja', Cama: 'caja', Sofá: 'caja', Mochila: 'caja',
  Teclado: 'caja', Celular: 'caja', Mesa: 'caja',
};

const NAMES: Record<PrimitiveKind, string> = { get esfera() { return tx('volumes.esfera'); }, get cilindro() { return tx('common.cilindro'); }, get caja() { return tx('common.caja'); }, get cono() { return tx('common.cono'); } };

/** Rectángulo de menor área que contiene un casco convexo. */
function minRect(hull: Pt[]): { corners: Pt[]; area: number; angle: number } | null {
  if (hull.length < 3) return null;
  let best: { corners: Pt[]; area: number; angle: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [px, py] of hull) {
      const u = px * ux + py * uy;
      const v = -px * uy + py * ux;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) {
      const back = (u: number, v: number): Pt => [u * ux - v * uy, u * uy + v * ux];
      best = { corners: [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)], area, angle: t };
    }
  }
  return best;
}

/** Busca el sólido simple que mejor resume la silueta de un objeto. */
export function fitPrimitive(mask: Uint8Array, w: number, h: number, label?: string): Primitive | null {
  let area = 0;
  let sx = 0;
  let sy = 0;
  const edge: Pt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      area++;
      sx += x;
      sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) edge.push([x, y]);
    }
  }
  if (area < 60) return null;
  const cx = sx / area;
  const cy = sy / area;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      xx += (x - cx) ** 2;
      yy += (y - cy) ** 2;
      xy += (x - cx) * (y - cy);
    }
  }
  xx /= area;
  yy /= area;
  xy /= area;
  const gap = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const major = 2 * Math.sqrt((xx + yy + gap) / 2);
  const minor = 2 * Math.sqrt(Math.max(1e-6, (xx + yy - gap) / 2));
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ellipseArea = Math.PI * major * minor;
  const ellipseFit = Math.min(area, ellipseArea) / Math.max(area, ellipseArea);

  const hull = convexHull(edge);
  const rect = minRect(hull);
  const rectFit = rect ? area / rect.area : 0;
  const tri = bestTriangle(hull);
  const triFit = tri ? area / (Math.abs((tri.tri[1][0] - tri.tri[0][0]) * (tri.tri[2][1] - tri.tri[0][1]) - (tri.tri[2][0] - tri.tri[0][0]) * (tri.tri[1][1] - tri.tri[0][1])) / 2 || 1) : 0;
  const triScore = triFit > 1.2 ? 0 : Math.min(triFit, 1 / triFit);

  const norm = (p: Pt): Pt => [p[0] / w, p[1] / h];
  const elongated = major / minor > 1.5;
  const scored: { kind: PrimitiveKind; fit: number }[] = [
    { kind: elongated ? 'cilindro' : 'esfera', fit: ellipseFit * (elongated ? 0.94 : 1) },
    { kind: elongated && rectFit < 0.9 ? 'cilindro' : 'caja', fit: rectFit },
    { kind: 'cono', fit: triScore * 0.95 },
  ];
  const hinted = label ? CLASS_SHAPE[label] : undefined;
  let choice = scored.reduce((a, b) => (b.fit > a.fit ? b : a));
  // Si se sabe qué objeto es, su forma manda aunque la silueta sea irregular.
  if (hinted) choice = { kind: hinted, fit: Math.max(scored.find((s) => s.kind === hinted)?.fit ?? 0.7, 0.7) };
  if (choice.fit < 0.62) return null;
  return {
    kind: choice.kind,
    name: NAMES[choice.kind],
    c: [cx / w, cy / h],
    major,
    minor,
    angle,
    corners: choice.kind === 'caja' ? rect?.corners.map(norm) : choice.kind === 'cono' ? tri?.tri.map(norm) : undefined,
    fit: choice.fit,
  };
}
