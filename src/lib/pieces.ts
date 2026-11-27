import { convexHull } from './composition';
import type { Pt } from './types';
import type { V3 } from './volumes';

export type Mask = { data: Uint8Array; w: number; h: number };
export type Frame = { x: V3; y: V3; z: V3 };

/** Cara plana de una forma, para el paso de planos. */
export interface Facet {
  poly: Pt[];
  /** Normal, con z hacia quien mira. */
  n: V3;
  /** Puntos de la imagen que caen en este plano: de ahí sale su color real. */
  samples?: Pt[];
}

/** Pieza de un maniquí, ya proyectada al encuadre (0 a 1). */
export interface Piece {
  id: string;
  /** Nombre del paso al que pertenece. */
  name: string;
  /** Cuál se traza antes: varias piezas pueden compartir paso. */
  step: number;
  /** Mayor es más cerca de quien mira. */
  z: number;
  outline: Pt[];
  /** Tapas: elipses completas, encima del contorno. */
  caps: Pt[][];
  /** Aros que dan la vuelta a la forma. */
  rings: Pt[][];
  /** Ejes de construcción: se ven más fuerte que los aros. */
  axes: Pt[][];
  /** Línea simple del paso de círculos y líneas. */
  stick?: Pt[];
  /** Grandes masas: el paso 2 las dibuja como figura, no como línea. */
  mass?: boolean;
  /** Bolas de articulación. */
  joint?: boolean;
  /** Dedos: línea fina y sin sombra. */
  thin?: boolean;
  /** La misma pieza reducida a planos, sin curvas. */
  planes?: Facet[];
  /** Contorno anatómico, ya no un cilindro. */
  form?: Pt[];
  /** Curvas que rodean la forma. */
  formRings?: Pt[][];
  /** Marcas sobre la forma: esternón, rótula, crestas de la cadera. */
  marks?: Pt[][];
}


export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const size = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / (size(a) || 1));
export const mix = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const TAU = Math.PI * 2;

export function ellipseRing(c: V3, u: V3, v: V3, ru: number, rv: number, count = 48): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * TAU;
    out.push(add(c, add(mul(u, ru * Math.cos(t)), mul(v, rv * Math.sin(t)))));
  }
  return out;
}

/** Corta una línea en los tramos cuya normal mira a la cámara. */
export function visibleRuns<T>(items: T[], front: (t: T) => boolean, at: (t: T) => Pt): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  for (const it of items) {
    if (front(it)) run.push(at(it));
    else if (run.length) {
      if (run.length > 1) out.push(run);
      run = [];
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

export function smoothClosed(loop: Pt[], passes = 2): Pt[] {
  let cur = loop;
  for (let k = 0; k < passes; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

/** Elipse que proyecta un elipsoide: la submatriz 2×2 de R·diag(a²,b²,c²)·Rᵀ. */
export function ellipsoidOutline(c: V3, f: Frame, a: number, b: number, d: number, aspect: number): Pt[] {
  const axes: [V3, number][] = [[f.x, a], [f.y, b], [f.z, d]];
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const [v, r] of axes) {
    xx += v[0] * v[0] * r * r;
    yy += v[1] * v[1] * r * r;
    xy += v[0] * v[1] * r * r;
  }
  const gap = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const major = Math.sqrt(Math.max(1e-12, (xx + yy + gap) / 2));
  const minor = Math.sqrt(Math.max(1e-12, (xx + yy - gap) / 2));
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const out: Pt[] = [];
  for (let i = 0; i < 56; i++) {
    const t = (i / 56) * TAU;
    const px = major * Math.cos(t);
    const py = minor * Math.sin(t);
    out.push([(c[0] + px * Math.cos(angle) - py * Math.sin(angle)) / aspect, c[1] + px * Math.sin(angle) + py * Math.cos(angle)]);
  }
  return out;
}

/** Aros de un elipsoide: paralelos a lo largo de su eje y, y una línea central. */
export function ellipsoidLines(c: V3, f: Frame, a: number, b: number, d: number, aspect: number, levels: number[]) {
  const toWorld = (x: number, y: number, z: number): V3 => add(c, add(mul(f.x, x), add(mul(f.y, y), mul(f.z, z))));
  const normalZ = (x: number, y: number, z: number) => f.x[2] * (x / (a * a)) + f.y[2] * (y / (b * b)) + f.z[2] * (z / (d * d));
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const rings: Pt[][] = [];
  for (const v of levels) {
    const k = Math.sqrt(1 - v * v);
    const items: [number, number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * TAU;
      items.push([a * k * Math.cos(t), b * v, d * k * Math.sin(t)]);
    }
    rings.push(...visibleRuns(items, (p) => normalZ(p[0], p[1], p[2]) >= 0, (p) => flat(toWorld(p[0], p[1], p[2]))));
  }
  const center: [number, number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * TAU;
    center.push([0, b * Math.sin(t), d * Math.cos(t)]);
  }
  const axes = visibleRuns(center, (p) => normalZ(p[0], p[1], p[2]) >= 0, (p) => flat(toWorld(p[0], p[1], p[2])));
  return { rings, axes };
}

/** Las caras visibles de una caja orientada: lo que la luz separa en valores. */
export function boxFacets(c: V3, f: Frame, a: number, b: number, d: number, aspect: number): Facet[] {
  const at = (x: number, y: number, z: number): Pt => {
    const p = add(c, add(mul(f.x, x * a), add(mul(f.y, y * b), mul(f.z, z * d))));
    return [p[0] / aspect, p[1]];
  };
  const out: Facet[] = [];
  const face = (n: V3, u: V3, v: V3, w: number[]) => {
    const world = add(mul(f.x, n[0]), add(mul(f.y, n[1]), mul(f.z, n[2])));
    if (world[2] <= 0.02) return;
    const corner = (s: number, t: number) => at(n[0] + u[0] * s + v[0] * t, n[1] + u[1] * s + v[1] * t, n[2] + u[2] * s + v[2] * t);
    out.push({ n: world, poly: [corner(-w[0], -w[1]), corner(w[0], -w[1]), corner(w[0], w[1]), corner(-w[0], w[1])] });
  };
  face([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1]);
  face([-1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1]);
  face([0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1]);
  face([0, -1, 0], [1, 0, 0], [0, 0, 1], [1, 1]);
  face([0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 1]);
  face([0, 0, -1], [1, 0, 0], [0, 1, 0], [1, 1]);
  return out;
}

/** Miembro como prisma de cuatro caras: la versión tallada del cono. */
function prismFacets(a: V3, b: V3, ra: number, rb: number, e1: V3, e2: V3, aspect: number): Facet[] {
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const dir = unit(sub(b, a));
  const corners = (c: V3, r: number) => [add(c, add(mul(e1, r), mul(e2, r))), add(c, add(mul(e1, -r), mul(e2, r))), add(c, add(mul(e1, -r), mul(e2, -r))), add(c, add(mul(e1, r), mul(e2, -r)))];
  const A = corners(a, ra * 0.9);
  const B = corners(b, rb * 0.9);
  const out: Facet[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const m: V3 = i === 0 ? e2 : i === 1 ? mul(e1, -1) : i === 2 ? mul(e2, -1) : e1;
    if (m[2] > 0.02) out.push({ n: m, poly: [A[i], A[j], B[j], B[i]].map(flat) });
  }
  if (dir[2] > 0.05) out.push({ n: dir, poly: B.map(flat) });
  if (dir[2] < -0.05) out.push({ n: mul(dir, -1), poly: A.map(flat) });
  return out;
}

/** Miembro: cono truncado con tapas planas, como un maniquí de madera. */
export function limbPiece(id: string, name: string, step: number, a: V3, b: V3, ra: number, rb: number, aspect: number, opts: { rings?: number[]; bias?: number } = {}): Piece {
  const dir = unit(sub(b, a));
  const side0 = cross(dir, [0, 0, 1]);
  const e1 = size(side0) > 1e-4 ? unit(side0) : ([1, 0, 0] as V3);
  const e2 = unit(cross(dir, e1));
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const circle = (c: V3, r: number, count = 28) => ellipseRing(c, e1, e2, r, r, count);
  const hull = convexHull([...circle(a, ra), ...circle(b, rb)].map((p): Pt => [p[0], p[1]]));
  const rings: Pt[][] = [];
  for (const t of opts.rings ?? [0.33, 0.66]) {
    const c = mix(a, b, t);
    const r = ra + (rb - ra) * t;
    const items: V3[] = [];
    for (let i = 0; i <= 48; i++) {
      const q = (i / 48) * TAU;
      items.push(add(mul(e1, Math.cos(q)), mul(e2, Math.sin(q))));
    }
    rings.push(...visibleRuns(items, (n) => n[2] >= 0, (n) => flat(add(c, mul(n, r)))));
  }
  const tilt = Math.abs(dir[2]);
  const nearEnd = a[2] > b[2] ? a : b;
  const nearR = a[2] > b[2] ? ra : rb;
  return {
    id,
    name,
    step,
    z: (a[2] + b[2]) / 2 + (opts.bias ?? 0),
    outline: hull.map(([x, y]): Pt => [x / aspect, y]),
    caps: tilt > 0.18 ? [circle(nearEnd, nearR).map(flat)] : [],
    rings,
    axes: [],
    stick: [flat(a), flat(b)],
    planes: prismFacets(a, b, ra, rb, e1, e2, aspect),
  };
}

export function ballPiece(id: string, name: string, step: number, c: V3, r: number, aspect: number): Piece {
  const flat: Pt[] = [];
  for (let i = 0; i < 32; i++) {
    const q = (i / 32) * TAU;
    flat.push([(c[0] + r * Math.cos(q)) / aspect, c[1] + r * Math.sin(q)]);
  }
  return { id, name, step, z: c[2], outline: flat, caps: [], rings: [], axes: [], joint: true };
}

/** Ancho real de un miembro: rayos a ambos lados del eje hasta salir de la silueta. */
export function measuredRadius(mask: Mask | undefined, a: Pt, b: Pt, aspect: number, limit: number): number | null {
  if (!mask) return null;
  const { data, w, h } = mask;
  const dx = (b[0] - a[0]) * aspect;
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-5) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const widths: number[] = [];
  for (const t of [0.3, 0.42, 0.54, 0.66]) {
    const cx = a[0] + (b[0] - a[0]) * t;
    const cy = a[1] + (b[1] - a[1]) * t;
    const ray = (sign: number) => {
      const stepSize = 1 / h;
      for (let d = 0; d < limit; d += stepSize) {
        const x = Math.floor((cx + (sign * nx * d) / aspect) * w);
        const y = Math.floor((cy + sign * ny * d) * h);
        if (x < 0 || y < 0 || x >= w || y >= h || !data[y * w + x]) return d;
      }
      return limit;
    };
    const left = ray(1);
    const right = ray(-1);
    if (left >= limit || right >= limit) continue;
    widths.push((left + right) / 2);
  }
  if (widths.length < 2) return null;
  widths.sort((p, q) => p - q);
  return widths[widths.length >> 1];
}


/**
 * Dibuja las piezas y las compara con la silueta real: cuánto del total coincide. Es el
 * juez de "dibujar y comparar": entre dos lecturas de una misma figura gana la que calza.
 */
export function silhouetteMatch(pieces: Piece[], mask: Mask): number {
  const step = 2;
  const w = Math.floor(mask.w / step);
  const h = Math.floor(mask.h / step);
  const drawn = new Uint8Array(w * h);
  for (const p of pieces) {
    if (p.joint && p.outline.length < 3) continue;
    const poly = p.outline.map(([x, y]): Pt => [x * w, y * h]);
    let y0 = h;
    let y1 = 0;
    for (const [, y] of poly) {
      y0 = Math.min(y0, Math.floor(y));
      y1 = Math.max(y1, Math.ceil(y));
    }
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      const cuts: number[] = [];
      const row = y + 0.5;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if (ay > row !== by > row) cuts.push(ax + ((row - ay) / (by - ay)) * (bx - ax));
      }
      cuts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cuts.length; k += 2) {
        const from = Math.max(0, Math.ceil(cuts[k]));
        const to = Math.min(w - 1, Math.floor(cuts[k + 1]));
        for (let x = from; x <= to; x++) drawn[y * w + x] = 1;
      }
    }
  }
  let both = 0;
  let any = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const real = mask.data[y * step * mask.w + x * step] ? 1 : 0;
      both += real & drawn[y * w + x];
      any += real | drawn[y * w + x];
    }
  }
  return both / (any || 1);
}
