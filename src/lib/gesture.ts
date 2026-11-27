import type { Pt } from './types';

/** Curva suave que pasa exactamente por los puntos dados. */
export function catmullRom(pts: Pt[], perSegment = 16): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export type CurveShape = 'recta' | 'C' | 'S';

export interface Gesture {
  shape: CurveShape;
  /** Inclinación respecto a la vertical, en grados. Positiva: hacia la derecha. */
  lean: number;
  /** Separación máxima de la cuerda, como fracción de su largo. */
  bend: number;
}

/** Lee la forma de una curva: recta, en C o en S. */
export function readGesture(curve: Pt[], aspect: number): Gesture {
  const pts = curve.map(([x, y]): Pt => [x * aspect, y]);
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const dev = pts.map((p) => (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len / len);
  const bend = Math.max(...dev.map(Math.abs));
  const noise = 0.035;
  let sign = 0;
  let flips = 0;
  for (const d of dev) {
    if (Math.abs(d) < noise) continue;
    const s = Math.sign(d);
    if (sign && s !== sign) flips++;
    sign = s;
  }
  const top = a[1] <= b[1] ? a : b;
  const bottom = a[1] <= b[1] ? b : a;
  const lean = (Math.atan2(top[0] - bottom[0], bottom[1] - top[1]) * 180) / Math.PI;
  const shape: CurveShape = bend < 0.05 ? 'recta' : flips >= 1 ? 'S' : 'C';
  return { shape, lean, bend };
}

/** Puntos del cuerpo en COCO-WholeBody (DWPose). */
export const POSE = {
  nose: 0,
  eyeL: 1,
  eyeR: 2,
  earL: 3,
  earR: 4,
  shoulderL: 5,
  shoulderR: 6,
  elbowL: 7,
  elbowR: 8,
  wristL: 9,
  wristR: 10,
  hipL: 11,
  hipR: 12,
  kneeL: 13,
  kneeR: 14,
  ankleL: 15,
  ankleR: 16,
  bigToeL: 17,
  heelL: 19,
  bigToeR: 20,
  heelR: 22,
  face: 23,
  handL: 91,
  handR: 112,
} as const;

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function turnAngle(a: Pt, b: Pt, c: Pt): number {
  const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(u - v);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * Línea de acción de una persona: de la cabeza por la columna hasta el pie que
 * continúa el movimiento. Se elige la pierna que menos quiebra el flujo del torso.
 */
export function poseLine(pts: Pt[], vis: number[]): Pt[] | null {
  const seen = (i: number) => (vis[i] ?? 0) > 0.25;
  const core = [POSE.shoulderL, POSE.shoulderR, POSE.hipL, POSE.hipR];
  if (!core.every(seen)) return null;
  const neck = mid(pts[POSE.shoulderL], pts[POSE.shoulderR]);
  const pelvis = mid(pts[POSE.hipL], pts[POSE.hipR]);
  const head = seen(POSE.earL) && seen(POSE.earR) ? mid(pts[POSE.earL], pts[POSE.earR]) : seen(POSE.nose) ? pts[POSE.nose] : null;
  const line: Pt[] = [];
  if (head) line.push(head);
  line.push(neck, mid(neck, pelvis), pelvis);
  const legs = [
    { knee: POSE.kneeL, ankle: POSE.ankleL },
    { knee: POSE.kneeR, ankle: POSE.ankleR },
  ].filter((l) => seen(l.knee) && seen(l.ankle));
  if (legs.length) {
    const cost = (l: (typeof legs)[number]) => turnAngle(neck, pelvis, pts[l.knee]) + turnAngle(pelvis, pts[l.knee], pts[l.ankle]) * 0.6;
    const plant = legs.reduce((best, l) => (cost(l) < cost(best) - 0.08 || (Math.abs(cost(l) - cost(best)) <= 0.08 && pts[l.ankle][1] > pts[best.ankle][1]) ? l : best));
    // Una pierna muy doblada no continúa el gesto: la línea termina en la rodilla.
    const hooked = turnAngle(pelvis, pts[plant.knee], pts[plant.ankle]) > 1.75;
    line.push(pts[plant.knee]);
    if (!hooked) line.push(pts[plant.ankle]);
  }
  return line;
}

export interface MaskSpine {
  line: Pt[];
  /** Largo del recorrido, normalizado a la diagonal del encuadre. */
  length: number;
  /** Qué tan alargada es la forma; bajo 1.35 no hay eje real. */
  elongation: number;
}

/** Distancia de cada píxel al borde de la figura (chaflán 3-4). */
export function distanceToEdge(mask: Uint8Array, w: number, h: number): Uint16Array {
  const FAR = 60000;
  const d = new Uint16Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? FAR : 0;
  // Fuera del encuadre también es fuera de la figura.
  for (let x = 0; x < w; x++) {
    if (d[x]) d[x] = 3;
    if (d[(h - 1) * w + x]) d[(h - 1) * w + x] = 3;
  }
  for (let y = 0; y < h; y++) {
    if (d[y * w]) d[y * w] = 3;
    if (d[y * w + w - 1]) d[y * w + w - 1] = 3;
  }
  const relax = (i: number, j: number, cost: number) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost;
  };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      relax(i, i - 1, 3);
      relax(i, i - w, 3);
      relax(i, i - w - 1, 4);
      relax(i, i - w + 1, 4);
    }
  }
  for (let y = h - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      relax(i, i + 1, 3);
      relax(i, i + w, 3);
      relax(i, i + w + 1, 4);
      relax(i, i + w - 1, 4);
    }
  }
  return d;
}

/** Dijkstra dentro de la figura. Devuelve el punto más lejano y de dónde vino cada píxel. */
function walk(seeds: number | number[], w: number, h: number, inside: Uint8Array, price: Float32Array) {
  const n = w * h;
  const cost = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const list = Array.isArray(seeds) ? seeds : [seeds];
  const heap: number[] = [...list];
  const pos = new Int32Array(n).fill(-1);
  list.forEach((v, i) => {
    pos[v] = i;
    cost[v] = 0;
  });
  const start = list[0];
  const swap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b], heap[a]];
    pos[heap[a]] = a;
    pos[heap[b]] = b;
  };
  const up = (start2: number) => {
    let i = start2;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cost[heap[p]] <= cost[heap[i]]) break;
      swap(p, i);
      i = p;
    }
  };
  const down = (start2: number) => {
    let i = start2;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l;
      if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r;
      if (m === i) break;
      swap(m, i);
      i = m;
    }
  };
  const steps: [number, number, number][] = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [1, 1, 1.41]];
  let far = start;
  while (heap.length) {
    const u = heap[0];
    const last = heap.pop()!;
    pos[u] = -2;
    if (heap.length) {
      heap[0] = last;
      pos[last] = 0;
      down(0);
    }
    if (cost[u] > cost[far]) far = u;
    const ux = u % w;
    const uy = Math.floor(u / w);
    for (const [dx, dy, len] of steps) {
      const x = ux + dx;
      const y = uy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = y * w + x;
      if (!inside[v] || pos[v] === -2) continue;
      const c = cost[u] + len * price[v];
      if (c < cost[v]) {
        cost[v] = c;
        from[v] = u;
        if (pos[v] === -1) {
          heap.push(v);
          pos[v] = heap.length - 1;
        }
        up(pos[v]);
      }
    }
  }
  return { far, from, cost };
}

function startPixel(mask: Uint8Array, w: number, h: number, head?: Pt | null): number {
  if (head) {
    const hx = head[0] * w;
    const hy = head[1] * h;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const d = (i % w - hx) ** 2 + (Math.floor(i / w) - hy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  for (let i = 0; i < mask.length; i++) if (mask[i]) return i;
  return 0;
}

function resample(path: Pt[], count: number): Pt[] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const out: Pt[] = [path[0]];
  const step = total / (count - 1);
  let run = 0;
  let next = step;
  for (let i = 1; i < path.length && out.length < count - 1; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    while (run + seg >= next && out.length < count - 1) {
      const t = (next - run) / (seg || 1);
      out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]);
      next += step;
    }
    run += seg;
  }
  out.push(path[path.length - 1]);
  return out;
}

function pathLength(p: Pt[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return n;
}

/**
 * Línea de una figura cualquiera: el recorrido más largo que nace en su cabeza
 * y corre por el centro de la forma. Sin cabeza conocida parte de su punta superior.
 */
export function maskSpine(mask: Uint8Array, w: number, h: number, head?: Pt | null): MaskSpine | null {
  const d = distanceToEdge(mask, w, h);
  let seed = -1;
  let area = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < d.length; i++) {
    if (!mask[i]) continue;
    area++;
    sx += i % w;
    sy += Math.floor(i / w);
    if (seed < 0 || d[i] > d[seed]) seed = i;
  }
  if (area < 30 || seed < 0) return null;
  const mx = sx / area;
  const my = sy / area;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < d.length; i++) {
    if (!mask[i]) continue;
    const x = (i % w) - mx;
    const y = Math.floor(i / w) - my;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  xx /= area;
  yy /= area;
  xy /= area;
  const gap = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const elongation = Math.sqrt((xx + yy + gap) / 2 / Math.max(1e-6, (xx + yy - gap) / 2));

  // Caminar pegado al borde cuesta más: así el trazo va por el centro de la forma.
  const price = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) if (mask[i]) price[i] = 1 + 9 / (1 + d[i] / 3);
  const a = startPixel(mask, w, h, head);
  const { far: b, from } = walk(a, w, h, mask, price);
  const path: Pt[] = [];
  for (let v = b; v >= 0; v = from[v]) path.push([v % w, Math.floor(v / w)]);
  if (path.length < 4) return null;
  let line = resample(path, 13);
  for (let pass = 0; pass < 2; pass++) {
    const prev = line;
    line = prev.map((p, i): Pt => {
      if (i === 0 || i === prev.length - 1) return p;
      return [(prev[i - 1][0] + 2 * p[0] + prev[i + 1][0]) / 4, (prev[i - 1][1] + 2 * p[1] + prev[i + 1][1]) / 4];
    });
  }
  if (line[0][1] > line[line.length - 1][1]) line.reverse();
  return { line: line.map(([x, y]): Pt => [x / w, y / h]), length: pathLength(line) / Math.hypot(w, h), elongation };
}

export interface MaskSkeleton {
  /** Tronco y ramas, normalizados. El primero va de la cabeza a la punta opuesta. */
  paths: Pt[][];
  distance: Uint16Array;
}

/**
 * Esqueleto de una silueta cualquiera: el recorrido principal y luego las puntas
 * que más se alejan de él. En un perro salen patas y cola; en un árbol, sus ramas.
 */
export function maskSkeleton(mask: Uint8Array, w: number, h: number, head?: Pt | null, branches = 5): MaskSkeleton | null {
  const distance = distanceToEdge(mask, w, h);
  const price = new Float32Array(w * h);
  let area = 0;
  for (let i = 0; i < distance.length; i++) {
    if (!mask[i]) continue;
    area++;
    price[i] = 1 + 9 / (1 + distance[i] / 3);
  }
  if (area < 30) return null;
  const a = startPixel(mask, w, h, head);
  const first = walk(a, w, h, mask, price);
  const trace = (v0: number, from: Int32Array, stop?: Set<number>) => {
    const out: number[] = [];
    for (let v = v0; v >= 0; v = from[v]) {
      out.push(v);
      if (stop?.has(v)) break;
    }
    return out;
  };
  const main = trace(first.far, first.from);
  if (main.length < 4) return null;
  const onTree = new Set(main);
  const toPts = (ids: number[]) => ids.map((v): Pt => [v % w, Math.floor(v / w)]);
  const paths: Pt[][] = [toPts(main)];
  const mainLength = pathLength(paths[0]);
  for (let i = 0; i < branches; i++) {
    const res = walk([...onTree], w, h, mask, price);
    const ids = trace(res.far, res.from);
    const pts = toPts(ids);
    if (pathLength(pts) < mainLength * 0.16) break;
    ids.forEach((v) => onTree.add(v));
    paths.push(pts);
  }
  const clean = paths.map((p, i) => {
    const count = i === 0 ? 11 : 6;
    let line = resample(p, count);
    const prev = line;
    line = prev.map((q, j): Pt => {
      if (j === 0 || j === prev.length - 1) return q;
      return [(prev[j - 1][0] + 2 * q[0] + prev[j + 1][0]) / 4, (prev[j - 1][1] + 2 * q[1] + prev[j + 1][1]) / 4];
    });
    return line.map(([x, y]): Pt => [x / w, y / h]);
  });
  if (clean[0][0][1] > clean[0][clean[0].length - 1][1] && !head) clean[0].reverse();
  return { paths: clean, distance };
}

/** Pincelada de grosor variable, como un trazo de tinta. */
export function brushPath(curve: Pt[], width: number): string {
  if (curve.length < 2) return '';
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = curve.length;
  for (let i = 0; i < n; i++) {
    const a = curve[Math.max(0, i - 1)];
    const b = curve[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (n - 1);
    const r = (width / 2) * Math.sin(Math.PI * t ** 0.8) ** 0.7;
    left.push([curve[i][0] - (dy / len) * r, curve[i][1] + (dx / len) * r]);
    right.push([curve[i][0] + (dy / len) * r, curve[i][1] - (dx / len) * r]);
  }
  const fmt = ([x, y]: Pt) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  return `M${left.map(fmt).join('L')}L${right.reverse().map(fmt).join('L')}Z`;
}
