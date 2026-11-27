import { ellipsoidFacets, organicLimb, type LimbKind } from './forms';
import { catmullRom } from './gesture';
import type { Block, Mannequin } from './mannequin';
import { add, ballPiece, clamp, cross, ellipsoidLines, ellipsoidOutline, limbPiece, measuredRadius, mix, mul, size, sub, unit, type Facet, type Frame, type Mask, type Piece } from './pieces';
import type { AnimalMarks, Pt } from './types';
import type { V3 } from './volumes';

import { t as tx } from '../i18n';
/** Orden de AP-10K. */
const A = { eyeL: 0, eyeR: 1, nose: 2, neck: 3, tail: 4, shoulderL: 5, elbowL: 6, pawFL: 7, shoulderR: 8, elbowR: 9, pawFR: 10, hipL: 11, kneeL: 12, pawBL: 13, hipR: 14, kneeR: 15, pawBR: 16 } as const;

const LEGS = [
  { root: A.shoulderL, mid: A.elbowL, end: A.pawFL, front: true },
  { root: A.shoulderR, mid: A.elbowR, end: A.pawFR, front: true },
  { root: A.hipL, mid: A.kneeL, end: A.pawBL, front: false },
  { root: A.hipR, mid: A.kneeR, end: A.pawBR, front: false },
];

/** La red solo conoce cuadrúpedos: un ave o un pez se resuelven por masas. */
export function animalIsUsable(m: AnimalMarks | undefined, label: string): boolean {
  if (!m) return false;
  if (/p[aá]jaro|ave|pez|bird|fish/i.test(label)) return false;
  const peak = Math.max(...m.vis);
  const v = m.vis.map((x) => x / (peak || 1));
  const trunk = [A.neck, A.tail, A.shoulderL, A.shoulderR, A.hipL, A.hipR].filter((i) => v[i] > 0.5).length;
  const paws = LEGS.filter((l) => v[l.end] > 0.5 && v[l.mid] > 0.5).length;
  return trunk >= 4 && paws >= 2;
}

const dot2 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1];

export interface AnimalInput {
  marks: AnimalMarks;
  aspect: number;
  mask?: Mask;
  depth?: (p: Pt) => number;
  label: string;
}

export interface AnimalBuild {
  mannequin: Mannequin;
  action: Pt[];
  sticks: [Pt, Pt][];
  joints: Pt[];
  /** Largo del tronco en cabezas. */
  length: number;
}

/**
 * La cola sigue su propia curva: el camino más largo por la silueta desde donde arranca. Las
 * patas quedan fuera para que el camino no se vaya por una de ellas.
 */
function tailPath(mask: Mask | undefined, base: V3, away: V3, length: number, aspect: number, legs: [V3, V3][]): { pts: V3[]; radii: number[] } | null {
  if (!mask) return null;
  const { data, w, h } = mask;
  const sx = (x: number) => ((x + 0.5) / w) * aspect;
  const sy = (y: number) => (y + 0.5) / h;
  const toSegment = (x: number, y: number, a: V3, b: V3) => {
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1e-9), 0, 1);
    return Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t);
  };
  const open = (i: number) => {
    if (!data[i]) return false;
    const x = sx(i % w);
    const y = sy(Math.floor(i / w));
    if ((x - base[0]) * away[0] + (y - base[1]) * away[1] <= -length * 0.02) return false;
    return !legs.some(([a, b]) => toSegment(x, y, a, b) < length * 0.09);
  };
  let start = -1;
  let least = length * 0.2;
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    const d = Math.hypot(sx(i % w) - base[0], sy(Math.floor(i / w)) - base[1]);
    if (d < least && open(i)) {
      least = d;
      start = i;
    }
  }
  if (start < 0) return null;
  const steps = new Int32Array(w * h).fill(-1);
  const from = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  steps[start] = 0;
  let far = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const j = qy * w + qx;
        if (steps[j] >= 0 || !open(j)) continue;
        steps[j] = steps[i] + 1;
        from[j] = i;
        queue[tail++] = j;
        if (steps[j] > steps[far]) far = j;
      }
    }
  }
  const raw: V3[] = [];
  for (let i = far; i >= 0; i = from[i]) raw.push([sx(i % w), sy(Math.floor(i / w)), base[2]]);
  raw.reverse();
  let span = 0;
  for (let i = 1; i < raw.length; i++) span += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  if (span < length * 0.12 || span > length * 1.1) return null;
  const count = 10;
  const sample = Array.from({ length: count }, (_, i) => raw[Math.round((i / (count - 1)) * (raw.length - 1))]);
  // Cada punto se centra entre los dos bordes: el camino más corto va pegado a la orilla.
  const radii: number[] = [];
  const pts: V3[] = sample.map((p, i) => {
    const prev = sample[Math.max(0, i - 1)];
    const next = sample[Math.min(count - 1, i + 1)];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const n = Math.hypot(tx, ty) || 1;
    const ux = -ty / n;
    const uy = tx / n;
    const reach = (sign: number) => {
      for (let d = 0; d < length * 0.2; d += 0.5 / h) {
        const x = Math.floor(((p[0] + ux * d * sign) / aspect) * w);
        const y = Math.floor((p[1] + uy * d * sign) * h);
        if (x < 0 || y < 0 || x >= w || y >= h || !data[y * w + x]) return d;
      }
      return length * 0.2;
    };
    const a = reach(1);
    const b = reach(-1);
    radii.push((a + b) / 2);
    return [p[0] + ux * ((a - b) / 2), p[1] + uy * ((a - b) / 2), p[2]];
  });
  for (let round = 0; round < 2; round++) {
    for (let i = 1; i < count - 1; i++) {
      pts[i] = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4, pts[i][2]];
      radii[i] = (radii[i - 1] + radii[i] * 2 + radii[i + 1]) / 4;
    }
  }
  radii[count - 1] = Math.min(radii[count - 1], radii[count - 2] * 0.6);
  return { pts, radii };
}

/** Una forma que sigue una curva: contorno, aros y planos a los dos lados. */
function ribbon(pts: V3[], radii: number[], aspect: number): { outline: Pt[]; rings: Pt[][]; planes: Facet[]; axis: Pt[] } {
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const left: V3[] = [];
  const right: V3[] = [];
  const sides: V3[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = unit(sub(b, a));
    const side: V3 = [-t[1], t[0], 0];
    sides.push(side);
    left.push(add(p, mul(side, radii[i])));
    right.push(add(p, mul(side, -radii[i])));
  });
  const rings: Pt[][] = [];
  const planes: Facet[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (i && i % 2 === 0) rings.push([flat(left[i]), flat(pts[i]), flat(right[i])]);
    const n = (side: V3, k: number): V3 => unit([side[0] * k, side[1] * k, 0.8]);
    planes.push({ poly: [left[i], left[i + 1], pts[i + 1], pts[i]].map(flat), n: n(sides[i], 0.6) });
    planes.push({ poly: [pts[i], pts[i + 1], right[i + 1], right[i]].map(flat), n: n(sides[i], -0.6) });
  }
  return { outline: [...left, ...[...right].reverse()].map(flat), rings, planes, axis: pts.map(flat) };
}

/**
 * Las orejas: en cada dirección se mide hasta dónde llega la silueta desde el cráneo, y donde se
 * sale de verdad hay una oreja. La borda del cráneo no llega tan lejos y el lado del cuello no
 * cuenta. Una oreja que cae sobre el cuerpo no se separa de él: entonces se refleja la otra.
 */
function earsOf(mask: Mask | undefined, c: V3, r: number, toNeck: V3, nose: V3, aspect: number): Pt[][] {
  if (!mask) return [];
  const { data, w, h } = mask;
  const BINS = 72;
  const on = (x: number, y: number) => {
    const px = Math.floor((x / aspect) * w);
    const py = Math.floor(y * h);
    return px >= 0 && py >= 0 && px < w && py < h && !!data[py * w + px];
  };
  const dirOf = (b: number): Pt => [Math.cos((b / BINS) * Math.PI * 2), Math.sin((b / BINS) * Math.PI * 2)];
  let reach: number[] = [];
  for (let b = 0; b < BINS; b++) {
    const [dx, dy] = dirOf(b);
    let far = 0;
    let gap = 0;
    for (let d = r * 0.9; d <= r * 2.5; d += 1 / h) {
      if (on(c[0] + dx * d, c[1] + dy * d)) {
        far = d;
        gap = 0;
      } else if ((gap += 1 / h) > r * 0.12) break;
    }
    reach.push(far);
  }
  for (let round = 0; round < 2; round++) reach = reach.map((v, i) => (reach[(i + BINS - 1) % BINS] + v * 2 + reach[(i + 1) % BINS]) / 4);
  // Un hocico largo también se sale del cráneo, pero no es una oreja. De frente queda adentro.
  const toNose = sub(nose, c);
  const snoutOut = size(toNose) > r * 1.1;
  const snoutDir = unit(toNose);
  const isEar = (b: number) => {
    const [dx, dy] = dirOf(b);
    if (snoutOut && dx * snoutDir[0] + dy * snoutDir[1] > 0.45) return false;
    return reach[b] >= r * 1.22 && dx * toNeck[0] + dy * toNeck[1] <= 0.25;
  };
  let start = 0;
  while (start < BINS && isEar(start)) start++;
  if (start === BINS) return [];
  const runs: number[][] = [];
  let run: number[] = [];
  for (let k = 1; k <= BINS; k++) {
    const b = (start + k) % BINS;
    if (isEar(b)) run.push(b);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  const flat = (b: number, d: number): Pt => {
    const [dx, dy] = dirOf(b);
    return [(c[0] + dx * d) / aspect, c[1] + dy * d];
  };
  const lobe = (list: number[]) => list.reduce((n, b) => n + reach[b] - r, 0);
  const loops = runs
    // Una oreja es chica: lo que abarca medio cráneo o se aleja mucho es cuello o lomo.
    .filter((list) => list.length >= 5 && list.length <= 20 && lobe(list) / list.length <= r)
    .sort((p, q) => lobe(q) - lobe(p))
    .slice(0, 2)
    .map((list): Pt[] => [...list.map((b) => flat(b, reach[b])), ...[...list].reverse().map((b) => flat(b, r * 0.97))]);
  if (loops.length !== 1) return loops;
  // Reflejo sobre el eje de la cabeza; solo vale si cae sobre la figura.
  const ax = unit(sub(nose, c));
  const mirror = loops[0].map(([x, y]): Pt => {
    const px = x * aspect - c[0];
    const py = y - c[1];
    const along = px * ax[0] + py * ax[1];
    return [(c[0] + 2 * along * ax[0] - px) / aspect, c[1] + 2 * along * ax[1] - py];
  });
  const hits = mirror.filter(([x, y]) => on(x * aspect, y)).length;
  return hits >= mirror.length * 0.6 ? [loops[0], mirror] : loops;
}

/** Del lomo hacia abajo hasta salir de la silueta: el alto real del cuerpo en ese punto. */
function depthBelow(mask: Mask | undefined, from: V3, down: V3, limit: number, aspect: number): number | null {
  if (!mask) return null;
  const { data, w, h } = mask;
  const step = 1 / h;
  // El punto del lomo puede caer justo afuera: se busca la entrada a la figura.
  let inside = false;
  let start = 0;
  for (let t = -limit * 0.25; t < limit; t += step) {
    const x = Math.floor(((from[0] + down[0] * t) / aspect) * w);
    const y = Math.floor((from[1] + down[1] * t) * h);
    const on = x >= 0 && y >= 0 && x < w && y < h && !!data[y * w + x];
    if (on && !inside) {
      inside = true;
      start = t;
    } else if (!on && inside) {
      return t - start;
    }
  }
  return inside ? limit - start : null;
}

/**
 * Cuadrúpedo: cabeza, caja torácica y cadera como tres masas unidas por el lomo, y cada
 * pata en sus segmentos. El grosor sale de la silueta; lo que queda al frente, de la
 * profundidad, porque en un animal de lado las dos patas de un par casi coinciden.
 */
export function buildAnimal(input: AnimalInput): AnimalBuild {
  const { marks, aspect, mask, depth } = input;
  const peak = Math.max(...marks.vis) || 1;
  const seen = (i: number) => marks.vis[i] / peak > 0.42;
  const flat3 = (i: number): V3 => [marks.pts[i][0] * aspect, marks.pts[i][1], 0];
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const near = (i: number) => (depth ? depth(marks.pts[i]) : 0);

  // Lado cercano de cada par: el de mayor cercanía queda al frente.
  const gapF = near(A.pawFL) + near(A.elbowL) - near(A.pawFR) - near(A.elbowR);
  const gapB = near(A.pawBL) + near(A.kneeL) - near(A.pawBR) - near(A.kneeR);
  const P = (i: number): V3 => flat3(i);

  const neck = P(A.neck);
  const tail = P(A.tail);
  const shoulder = seen(A.shoulderL) && seen(A.shoulderR) ? mix(P(A.shoulderL), P(A.shoulderR), 0.5) : seen(A.shoulderL) ? P(A.shoulderL) : P(A.shoulderR);
  const hip = seen(A.hipL) && seen(A.hipR) ? mix(P(A.hipL), P(A.hipR), 0.5) : seen(A.hipL) ? P(A.hipL) : P(A.hipR);
  const length = size(sub(neck, tail)) || 1e-3;
  const axis = unit(sub(tail, neck));
  const across = unit(cross(axis, [0, 0, 1]));
  // Hacia abajo: el lado donde están las patas.
  const down: V3 = mul(across, Math.sign(across[0] * (hip[0] - tail[0] + shoulder[0] - neck[0]) + across[1] * (hip[1] - tail[1] + shoulder[1] - neck[1])) || 1);

  // La línea de cuello a cola corre por el lomo: las masas cuelgan de ella.
  const tall = (t: number) => depthBelow(mask, mix(neck, tail, t), down, length * 0.9, aspect);
  // Se mide en la panza: en los extremos el rayo seguiría por una pata hasta el suelo.
  const belly = [0.38, 0.46, 0.54, 0.62].map(tall).filter((v): v is number => v !== null).sort((p, q) => p - q);
  const bodyTall = belly[belly.length >> 1] ?? length * 0.4;
  const ribR = clamp((bodyTall / 2) * 1.08, length * 0.12, length * 0.28);
  const hipR = ribR * 0.84;
  const ribA = Math.min(ribR * 1.3, length * 0.32);
  const hipA = Math.min(hipR * 1.14, length * 0.25);
  const ribC = add(mix(neck, tail, 0.24), mul(down, ribR * 0.98));
  const hipC = add(mix(neck, tail, 0.84), mul(down, hipR * 0.96));

  const noseAt = P(A.nose);
  const eyeMid = seen(A.eyeL) && seen(A.eyeR) ? mix(P(A.eyeL), P(A.eyeR), 0.5) : seen(A.eyeL) ? P(A.eyeL) : P(A.eyeR);
  const muzzle = size(sub(noseAt, eyeMid)) || length * 0.1;
  const headR0 = clamp(Math.max(muzzle * 1.05, size(sub(P(A.eyeL), P(A.eyeR))) * 0.95), length * 0.15, length * 0.34);
  const toNeck = unit(sub(neck, eyeMid));
  const headC0 = add(eyeMid, mul(toNeck, headR0 * 0.45));
  // El ancho real de la cabeza sale de la silueta: los ojos solo dan una idea. Se usa un valor
  // bajo de los rayos, porque algunos se van por el cuello o por una oreja.
  const headRays: number[] = [];
  if (mask) {
    for (let k = 0; k < 16; k++) {
      const q = (k / 16) * Math.PI * 2;
      const dx = Math.cos(q);
      const dy = Math.sin(q);
      for (let d = 0; d < length * 0.6; d += 1 / mask.h) {
        const px = Math.floor(((headC0[0] + dx * d) / aspect) * mask.w);
        const py = Math.floor((headC0[1] + dy * d) * mask.h);
        if (px < 0 || py < 0 || px >= mask.w || py >= mask.h || !mask.data[py * mask.w + px]) {
          headRays.push(d);
          break;
        }
      }
    }
    headRays.sort((p, q) => p - q);
  }
  // Se mide lo corto: las orejas caen por los lados y harían de la bola algo que no es.
  const headR = headRays.length >= 8 ? clamp(headRays[Math.floor(headRays.length * 0.3)], headR0 * 0.85, length * 0.3) : headR0;
  const headC = add(eyeMid, mul(toNeck, headR * 0.45));

  const pieces: Piece[] = [];
  const blocks: Block[] = [];
  const frame = (ex: V3, ey: V3): Frame => ({ x: ex, y: ey, z: cross(ex, ey) });
  const trunk = frame(axis, down);
  const mass = (id: string, name: string, step: number, c: V3, a: number, b: number) => {
    const lines = ellipsoidLines(c, trunk, a, b, b, aspect, [-0.45, 0, 0.45]);
    pieces.push({ id, name, step, z: 0, outline: ellipsoidOutline(c, trunk, a, b, b, aspect), caps: [], rings: lines.rings, axes: lines.axes, mass: true, planes: ellipsoidFacets(c, trunk, a, b, b, aspect, 4, 10) });
    blocks.push({ id, name, order: step, a: flat(add(c, mul(axis, -a))), b: flat(add(c, mul(axis, a))), ra: b, rb: b });
  };
  const headFrame = frame(unit(sub(noseAt, eyeMid)), unit(cross([0, 0, 1], unit(sub(noseAt, eyeMid)))));
  pieces.push({ id: 'cabeza', name: tx('common.cabeza'), step: 1, z: headR, outline: ellipsoidOutline(headC, headFrame, headR, headR * 0.86, headR * 0.86, aspect), caps: [], rings: [], axes: [[flat(headC), flat(noseAt)]], mass: true, planes: ellipsoidFacets(headC, headFrame, headR, headR * 0.86, headR * 0.86, aspect, 3, 8) });
  blocks.push({ id: 'cabeza', name: tx('common.cabeza'), order: 1, a: flat(headC), b: flat(noseAt), ra: headR, rb: headR * 0.5 });
  // El hocico es una forma redonda que sale de la cara: de frente casi no tiene largo.
  const snoutC = mix(eyeMid, noseAt, 0.68);
  const snoutLong = Math.max(size(sub(noseAt, eyeMid)) * 0.52, headR * 0.34);
  const snoutWide = headR * 0.4;
  pieces.push({ id: 'hocico', name: tx('common.cabeza'), step: 1, z: headR * 1.1, outline: ellipsoidOutline(snoutC, headFrame, snoutLong, snoutWide, snoutWide, aspect), caps: [], rings: [], axes: [], mass: true, planes: ellipsoidFacets(snoutC, headFrame, snoutLong, snoutWide, snoutWide, aspect, 3, 6) });
  earsOf(mask, headC, headR, toNeck, noseAt, aspect).forEach((loop, i) => {
    pieces.push({ id: `oreja${i}`, name: tx('common.cabeza'), step: 1, z: headR * 0.9, outline: loop, caps: [], rings: [], axes: [], mass: true, planes: [{ poly: loop, n: [0, 0, 1] }] });
  });
  mass('torax', tx('common.caja_toracica'), 2, ribC, ribA, ribR);
  mass('cadera', tx('animal.cadera'), 3, hipC, hipA, hipR);

  const back = limbPiece('lomo', tx('animal.lomo_cuello'), 4, add(ribC, mul(axis, ribA * 0.4)), add(hipC, mul(axis, -hipA * 0.4)), ribR * 0.82, hipR * 0.8, aspect, { rings: [0.5] });
  pieces.push({ ...back, caps: [], z: -headR * 0.1 });
  const neckFrom = add(ribC, mul(axis, -ribA * 0.55));
  const neckPiece = limbPiece('cuello', tx('animal.lomo_cuello'), 4, neckFrom, headC, ribR * 0.62, headR * 0.72, aspect, { rings: [0.5] });
  const neckForm = organicLimb('muslo', neckFrom, headC, ribR * 0.62, 1, aspect, mask);
  pieces.push({ ...neckPiece, caps: [], z: headR * 0.2, form: neckForm.outline, formRings: neckForm.rings, planes: neckForm.planes });

  const sticks: [Pt, Pt][] = [
    [flat(eyeMid), flat(noseAt)],
    [flat(headC), flat(neck)],
    [flat(neck), flat(tail)],
  ];
  const joints: Pt[] = [flat(noseAt), flat(headC), flat(neck), flat(tail)];
  const order = [
    { step: 1, name: tx('common.cabeza'), note: tx('animal.una_bola_un_hocico') },
    { step: 2, name: tx('common.caja_toracica'), note: tx('animal.la_masa_mas_grande') },
    { step: 3, name: tx('animal.cadera'), note: tx('animal.mas_chica_con_su') },
    { step: 4, name: tx('animal.lomo_cuello'), note: tx('animal.une_las_tres_masas') },
  ];
  LEGS.forEach((leg, i) => {
    const hasMid = seen(leg.mid) && seen(leg.root);
    if (!hasMid) return;
    const nearSide = (i % 2 === 0) === ((leg.front ? gapF : gapB) >= 0);
    const z = nearSide ? ribR * 0.5 : -ribR * 0.5;
    const root: V3 = [...P(leg.root).slice(0, 2), z] as V3;
    const mid: V3 = [...P(leg.mid).slice(0, 2), z] as V3;
    const end: V3 | null = seen(leg.end) ? ([...P(leg.end).slice(0, 2), z] as V3) : null;
    const step = (leg.front ? 5 : 6) + (nearSide ? 0 : 0.5);
    const name = leg.front ? tx('animal.patas_de_adelante') : tx('animal.patas_de_atras');
    const r0 = clamp(measuredRadius(mask, flat(root), flat(mid), aspect, ribR * 1.4) ?? ribR * 0.4, ribR * 0.2, ribR * 0.72);
    // La masa del músculo carga hacia donde se dobla la pata, igual que en una persona.
    const inner: 1 | -1 = end && (mid[0] - root[0]) * (end[1] - root[1]) - (mid[1] - root[1]) * (end[0] - root[0]) < 0 ? -1 : 1;
    const shaped = (kind: LimbKind, a: V3, b: V3, r: number) => organicLimb(kind, a, b, r, inner, aspect, mask);
    const upper = limbPiece(`pata${i}-a`, name, step, root, mid, r0, r0 * 0.68, aspect, { rings: [0.5] });
    const upperForm = shaped(leg.front ? 'brazo' : 'muslo', root, mid, r0);
    pieces.push({ ...upper, caps: [], form: upperForm.outline, formRings: upperForm.rings, planes: upperForm.planes });
    pieces.push({ ...ballPiece(`pata${i}-j`, name, step, mid, r0 * 0.66, aspect), z: z + 0.001 });
    // Cada pata cuelga del lomo: sin esto el esqueleto queda en pedazos sueltos.
    const along = clamp(dot2(sub(root, neck), axis) / length, 0, 1);
    sticks.push([flat(mix(neck, tail, along)), flat(root)]);
    sticks.push([flat(root), flat(mid)]);
    joints.push(flat(root), flat(mid));
    blocks.push({ id: `pata${i}-a`, name, order: step, a: flat(root), b: flat(mid), ra: r0, rb: r0 * 0.68 });
    if (end) {
      const r1 = clamp(measuredRadius(mask, flat(mid), flat(end), aspect, ribR) ?? r0 * 0.6, r0 * 0.3, r0 * 0.75);
      const lower = limbPiece(`pata${i}-b`, name, step, mid, end, r1, r1 * 0.7, aspect, { rings: [0.5] });
      const lowerForm = shaped(leg.front ? 'antebrazo' : 'pantorrilla', mid, end, r1);
      pieces.push({ ...lower, caps: [], form: lowerForm.outline, formRings: lowerForm.rings, planes: lowerForm.planes });
      pieces.push({ ...ballPiece(`pata${i}-p`, name, step, end, r1 * 1.05, aspect), z: z + 0.001 });
      sticks.push([flat(mid), flat(end)]);
      joints.push(flat(end));
      blocks.push({ id: `pata${i}-b`, name, order: step + 0.2, a: flat(mid), b: flat(end), ra: r1, rb: r1 * 0.7 });
    }
    if (!order.some((o) => o.name === name)) {
      order.push({ step: leg.front ? 5 : 6, name, note: tx('animal.primero_la_del_frente') });
    }
  });
  // Los pasos de patas se comparan enteros: la del fondo va en el mismo paso.
  for (const p of pieces) p.step = Math.floor(p.step);

  const away = unit(sub(tail, hip));
  const hind = LEGS.filter((l) => !l.front).flatMap((l): [V3, V3][] => [[P(l.root), P(l.mid)], [P(l.mid), P(l.end)]]);
  const curve = tailPath(mask, tail, size(away) > 0.1 ? away : axis, length, aspect, hind);
  const tip = curve ? curve.pts[curve.pts.length - 1] : null;
  if (curve && tip) {
    const form = ribbon(curve.pts, curve.radii, aspect);
    pieces.push({ id: 'cola', name: tx('animal.cola'), step: 7, z: -headR * 0.05, outline: form.outline, caps: [], rings: form.rings, axes: [form.axis], stick: form.axis, form: form.outline, formRings: form.rings, planes: form.planes });
    for (let i = 0; i + 1 < curve.pts.length; i++) sticks.push([flat(curve.pts[i]), flat(curve.pts[i + 1])]);
    joints.push(flat(tip));
    order.push({ step: 7, name: tx('animal.cola'), note: tx('animal.continua_el_lomo_es') });
    blocks.push({ id: 'cola', name: tx('animal.cola'), order: 7, a: flat(tail), b: flat(tip), ra: curve.radii[0], rb: curve.radii[curve.radii.length - 1] });
  }
  const line = [noseAt, headC, add(neck, mul(down, -ribR * 0.2)), add(mix(neck, tail, 0.5), mul(down, -ribR * 0.5)), tail, ...(curve ? curve.pts.filter((_, i) => i % 2 === 1) : [])].map(flat);
  const action = catmullRom(line, 12);
  const mannequin: Mannequin = {
    pieces,
    spine: action,
    tilts: [],
    head: null,
    hands: [],
    order: order.sort((a, b) => a.step - b.step),
    headHeight: headR * 2,
    chest: 0,
    blocks,
    rig: null,
    light: null,
    nearest: null,
  };
  return { mannequin, action, sticks, joints, length: length / (headR * 2) };
}
