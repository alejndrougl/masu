import { convexHull } from './composition';
import type { Pt } from './types';

/** Hacia dónde corren las aristas: a una fuga, o paralelas si la fuga está en el infinito. */
export type Direction = { point: Pt } | { along: Pt };

/** Caja en perspectiva: seis vértices de silueta y las esquinas interior y oculta. */
export interface Cuboid {
  silhouette: Pt[];
  /** Esquina que mira a quien observa. */
  front: Pt;
  /** Esquina escondida detrás de la caja. */
  back: Pt;
  /** Caras visibles alrededor de la esquina frontal, y la dirección a la que mira cada una. */
  faces: { poly: Pt[]; edge: 'x' | 'y' | 'z' }[];
  /** Aristas que se ven, y las que se trazan solo para comprobar. */
  edges: [Pt, Pt][];
  hidden: [Pt, Pt][];
  /** Cruces en perspectiva de cada cara: reparten sus mitades. */
  centers: [Pt, Pt][];
  /** Cuánto del sólido llena la silueta real: 1 calza justo. */
  fit: number;
}

type Line = { p: Pt; d: Pt };

const toward = (q: Pt, dir: Direction): Pt => ('point' in dir ? [dir.point[0] - q[0], dir.point[1] - q[1]] : dir.along);

/** Las dos rectas de una dirección que tocan a la figura por afuera. */
function tangents(hull: Pt[], dir: Direction): [Line, Line] {
  let lo: Line | null = null;
  let hi: Line | null = null;
  let min = Infinity;
  let max = -Infinity;
  const ref = toward(hull[0], dir);
  const base = Math.atan2(ref[1], ref[0]);
  for (const q of hull) {
    const d = toward(q, dir);
    let value: number;
    if ('point' in dir) {
      let a = Math.atan2(d[1], d[0]) - base;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      value = a;
    } else {
      const n = Math.hypot(d[0], d[1]) || 1;
      value = (q[0] * -d[1] + q[1] * d[0]) / n;
    }
    if (value < min) ((min = value), (lo = { p: q, d }));
    if (value > max) ((max = value), (hi = { p: q, d }));
  }
  return [lo!, hi!];
}

function meet(a: Line, b: Line): Pt | null {
  const det = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / det;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}

function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

function isConvex(poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

/** El punto más cercano a tres rectas: en una caja perfecta se cruzan en uno solo. */
function nearest(lines: Line[]): Pt | null {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  for (const { p, d: dir } of lines) {
    const n = Math.hypot(dir[0], dir[1]) || 1;
    const nx = -dir[1] / n;
    const ny = dir[0] / n;
    const off = nx * p[0] + ny * p[1];
    a += nx * nx;
    b += nx * ny;
    c += ny * ny;
    d += nx * off;
    e += ny * off;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-9) return null;
  return [(c * d - b * e) / det, (a * e - b * d) / det];
}

function faceCross(q: Pt[], dirs: [Direction, Direction]): [Pt, Pt][] {
  const center = meet({ p: q[0], d: [q[2][0] - q[0][0], q[2][1] - q[0][1]] }, { p: q[1], d: [q[3][0] - q[1][0], q[3][1] - q[1][1]] });
  if (!center) return [];
  const out: [Pt, Pt][] = [];
  const edges: [Pt, Pt][] = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
  for (const dir of dirs) {
    const line: Line = { p: center, d: toward(center, dir) };
    const hits: Pt[] = [];
    for (const [a, b] of edges) {
      const hit = meet(line, { p: a, d: [b[0] - a[0], b[1] - a[1]] });
      if (!hit) continue;
      const t = (hit[0] - a[0]) * (b[0] - a[0]) + (hit[1] - a[1]) * (b[1] - a[1]);
      const len = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (t >= -1e-6 && t <= len + 1e-6) hits.push(hit);
    }
    if (hits.length >= 2) out.push([hits[0], hits[hits.length - 1]]);
  }
  return out;
}

/**
 * Caja de un objeto dentro de su escena. Desde cada fuga salen dos rectas que apenas
 * tocan la silueta; esas seis rectas forman el hexágono que proyecta una caja, y de ahí
 * salen la esquina frontal y las caras. Es la construcción a mano de un dibujante, y por
 * eso el objeto queda en la misma perspectiva que el cuarto donde está.
 * Todo en coordenadas del encuadre con el aspecto aplicado.
 */
export function boxFromVanishing(outline: Pt[], x: Direction, y: Direction, z: Direction, horizon: number | null): Cuboid | null {
  const hull = convexHull(outline);
  if (hull.length < 4) return null;
  const sets: [Line, Line][] = [tangents(hull, x), tangents(hull, y), tangents(hull, z)];
  const hullArea = Math.abs(area(hull));
  let best: { poly: Pt[]; lines: Line[]; order: number[]; ratio: number } | null = null;
  for (const order of [[0, 1, 2], [0, 2, 1]]) {
    for (let m = 0; m < 8; m++) {
      const lines: Line[] = [];
      for (let k = 0; k < 3; k++) lines.push(sets[order[k]][(m >> k) & 1]);
      for (let k = 0; k < 3; k++) lines.push(sets[order[k]][1 - ((m >> k) & 1)]);
      const poly: Pt[] = [];
      for (let i = 0; i < 6; i++) {
        const v = meet(lines[i], lines[(i + 1) % 6]);
        if (!v) break;
        poly.push(v);
      }
      if (poly.length !== 6 || !isConvex(poly)) continue;
      const a = Math.abs(area(poly));
      if (a < hullArea * 0.98) continue;
      const ratio = a / hullArea;
      if (!best || ratio < best.ratio) best = { poly, lines, order, ratio };
    }
  }
  if (!best || best.ratio > 2.6) return null;
  const { poly, order } = best;
  const dirs = [x, y, z];
  // En cada vértice se cruzan dos familias; la arista interior corre por la tercera.
  const third = (i: number) => dirs[order[(i + 2) % 3]];
  const inner = (idx: number[]) => nearest(idx.map((i) => ({ p: poly[i], d: toward(poly[i], third(i)) })));
  const a = inner([0, 2, 4]);
  const b = inner([1, 3, 5]);
  if (!a || !b) return null;
  // La vertical de la esquina frontal arranca del vértice más bajo si se ve desde arriba.
  const r = (order.indexOf(2) + 1) % 3;
  const lowA = poly[r === 0 ? 0 : r === 1 ? 4 : 2];
  const lowB = poly[r === 0 ? 3 : r === 1 ? 1 : 5];
  const middle = poly.reduce((acc, p) => acc + p[1], 0) / 6;
  const above = horizon === null || horizon <= middle;
  const pickA = above ? lowA[1] >= lowB[1] : lowA[1] <= lowB[1];
  const front = pickA ? a : b;
  const back = pickA ? b : a;
  const link = pickA ? [0, 2, 4] : [1, 3, 5];
  const rest = pickA ? [1, 3, 5] : [0, 2, 4];
  const names = ['x', 'y', 'z'] as const;
  const familyOf = (i: number) => order[(i + 2) % 3];
  const faces = link.map((i, k) => {
    const next = link[(k + 1) % 3];
    // Dos familias la recorren: la tercera es hacia donde mira.
    return { poly: [front, poly[i], poly[(i + 1) % 6], poly[next]], edge: names[3 - familyOf(i) - familyOf(next)] };
  });
  const centers: [Pt, Pt][] = [];
  link.forEach((i, k) => {
    const next = link[(k + 1) % 3];
    const list = [familyOf(i), familyOf(next)].map((f) => dirs[f]) as [Direction, Direction];
    centers.push(...faceCross([front, poly[i], poly[(i + 1) % 6], poly[next]], list));
  });
  return {
    silhouette: poly,
    front,
    back,
    faces,
    edges: link.map((i) => [front, poly[i]]),
    hidden: rest.map((i) => [back, poly[i]]),
    centers,
    fit: 1 / best.ratio,
  };
}
