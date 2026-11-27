import { MHR } from '../lib/body';
import type { FigureModel } from '../lib/figure';
import type { Rig } from '../lib/rig';
import { PART } from '../lib/surface';
import type { Pt } from '../lib/types';
import type { Prim, View } from './overlays';
import { LIGHT, ROJO } from './palette';

/**
 * El maniquí como lo dibuja quien enseña figura: monigote con articulaciones, luego cajas para la
 * caja torácica y la pelvis (con su plano de abajo y de arriba rayado), cilindros con su elipse en
 * cada extremo para brazos y piernas, cuñas para los pies y las líneas de hombros y caderas
 * prolongadas con una flecha, que dicen hacia dónde gira el cuerpo. Todo sale del esqueleto 3D:
 * la elipse se abre según cuánto apunta el hueso hacia quien mira.
 */

type V3 = [number, number, number];

const INK = 'var(--ink)';
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const size = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = size(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mid = (a: V3, b: V3): V3 => mul(add(a, b), 0.5);
const f = (n: number) => n.toFixed(1);

export interface Ctx {
  rig: Rig;
  v: View;
  /** Del esqueleto (x en proporción de alto) a la vista. */
  at: (p: V3) => Pt;
  H: number;
  seen: (i: number) => boolean;
  absent: Set<number>;
}

export function ctxOf(model: FigureModel, v: View): Ctx | null {
  const rig = model.mannequin?.rig;
  if (!rig) return null;
  const at = (p: V3): Pt => [p[0] * v.H, p[1] * v.H];
  const inFrame = (p: V3) => p[0] * v.H > -v.W * 0.1 && p[0] * v.H < v.W * 1.1 && p[1] > -0.1 && p[1] < 1.1;
  return { rig, v, at, H: rig.H, seen: (i) => !!rig.seen[i] && !!rig.pts[i] && inFrame(rig.pts[i]), absent: new Set(model.surface?.absent ?? []) };
}

const line = (a: Pt, b: Pt) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;
const poly = (ps: Pt[], closed = true) => `M${ps.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}${closed ? 'Z' : ''}`;

/** Elipse en pantalla: centro, semieje mayor (dirección y largo) y semieje menor. */
function ellipse(c: Pt, major: Pt, minor: number): string {
  const len = Math.hypot(major[0], major[1]) || 1;
  const ux = major[0] / len;
  const uy = major[1] / len;
  const pts: Pt[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const a = Math.cos(t) * len;
    const b = Math.sin(t) * minor;
    pts.push([c[0] + ux * a - uy * b, c[1] + uy * a + ux * b]);
  }
  return poly(pts, false);
}

function arrow(from: Pt, to: Pt, head: number): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const bx = to[0] - ux * head;
  const by = to[1] - uy * head;
  return `${line(from, to)}M${f(bx - uy * head * 0.45)} ${f(by + ux * head * 0.45)}L${f(to[0])} ${f(to[1])}L${f(bx + uy * head * 0.45)} ${f(by - ux * head * 0.45)}`;
}

/** Hacia dónde mira el pecho: con la nariz si se ve; si no, se supone de espaldas. */
function frontOf(c: Ctx, across: V3, up: V3): V3 {
  let front = unit(cross(across, up));
  const { rig } = c;
  if (c.seen(MHR.nose) && c.seen(MHR.neck)) {
    if (dot(sub(rig.pts[MHR.nose], rig.pts[MHR.neck]), front) < 0) front = mul(front, -1);
  } else if (front[2] > 0) front = mul(front, -1);
  return front;
}

/** Una caja: centro, tres ejes unitarios y medias medidas. Devuelve aristas visibles, ocultas y la cara rayada. */
function boxPrims(c: Ctx, center: V3, ax: V3, ay: V3, az: V3, ha: number, hb: number, hd: number, hatchNormal: V3 | null, weight: number): Prim[] {
  const corner = (sa: number, sb: number, sd: number): V3 => add(add(add(center, mul(ax, ha * sa)), mul(ay, hb * sb)), mul(az, hd * sd));
  // Cada cara con su normal y sus cuatro esquinas en orden.
  const faces: { n: V3; q: V3[] }[] = [
    { n: ax, q: [corner(1, 1, 1), corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1)] },
    { n: mul(ax, -1), q: [corner(-1, 1, 1), corner(-1, 1, -1), corner(-1, -1, -1), corner(-1, -1, 1)] },
    { n: ay, q: [corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1), corner(-1, 1, 1)] },
    { n: mul(ay, -1), q: [corner(1, -1, 1), corner(-1, -1, 1), corner(-1, -1, -1), corner(1, -1, -1)] },
    { n: az, q: [corner(1, 1, 1), corner(-1, 1, 1), corner(-1, -1, 1), corner(1, -1, 1)] },
    { n: mul(az, -1), q: [corner(1, 1, -1), corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1)] },
  ];
  // z crece hacia quien mira: la cara se ve si su normal apunta hacia allá.
  const visible = faces.map((fc) => fc.n[2] > 0.02);
  const key = (a: V3, b: V3) => [a, b].map((p) => p.map((n) => n.toFixed(4)).join(',')).sort().join('|');
  const edges = new Map<string, { a: V3; b: V3; seen: boolean }>();
  faces.forEach((fc, k) => {
    for (let i = 0; i < 4; i++) {
      const a = fc.q[i];
      const b = fc.q[(i + 1) % 4];
      const id = key(a, b);
      const e = edges.get(id) ?? { a, b, seen: false };
      e.seen ||= visible[k];
      edges.set(id, e);
    }
  });
  let shown = '';
  let hidden = '';
  for (const e of edges.values()) {
    const d = line(c.at(e.a), c.at(e.b));
    if (e.seen) shown += d;
    else hidden += d;
  }
  const out: Prim[] = [];
  // Lo de atrás se insinúa: un dibujante construye a través de la forma.
  if (hidden) out.push({ t: 'path', d: hidden, stroke: INK, w: 0.8, alpha: 0.28, dash: [4, 4] });
  if (hatchNormal) {
    const k = faces.findIndex((fc) => dot(fc.n, hatchNormal) > 0.99);
    // Convención de taller: la base del pecho y la tapa de la pelvis se rayan siempre, porque se
    // miran a través de la cintura; si queda de espaldas a quien mira, el rayado va más tenue.
    if (k >= 0) {
      const back = !visible[k];
      if (back) out.push({ t: 'path', d: poly(faces[k].q.map(c.at)), stroke: INK, w: 0.8, alpha: 0.35 });
      const [p0, p1, p2, p3] = faces[k].q.map(c.at);
      let d = '';
      const n = 7;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        d += line([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], [p3[0] + (p2[0] - p3[0]) * t, p3[1] + (p2[1] - p3[1]) * t]);
      }
      out.push({ t: 'path', d, stroke: INK, w: 0.9, alpha: back ? 0.3 : 0.6 });
    }
  }
  out.push({ t: 'path', d: shown, stroke: INK, w: weight, alpha: 0.95, cap: 'round' });
  return out;
}

/** Cilindro de un hueso: dos costados y la elipse de cada extremo, abierta según el escorzo. */
function cylinderPrims(c: Ctx, a: V3, b: V3, ra: number, rb: number, weight: number): Prim[] {
  const A = c.at(a);
  const B = c.at(b);
  const sx = B[0] - A[0];
  const sy = B[1] - A[1];
  const sl = Math.hypot(sx, sy) || 1;
  const px = -sy / sl;
  const py = sx / sl;
  const d3 = sub(b, a);
  // Cuánto apunta el hueso hacia quien mira: de frente la tapa es un círculo, de lado una línea.
  const open = Math.min(1, Math.abs(d3[2]) / (size(d3) || 1));
  const scale = c.v.H;
  const RA = ra * scale;
  const RB = rb * scale;
  const sides = line([A[0] + px * RA, A[1] + py * RA], [B[0] + px * RB, B[1] + py * RB]) + line([A[0] - px * RA, A[1] - py * RA], [B[0] - px * RB, B[1] - py * RB]);
  const capA = ellipse(A, [px * RA, py * RA], Math.max(RA * 0.12, RA * open));
  const capB = ellipse(B, [px * RB, py * RB], Math.max(RB * 0.12, RB * open));
  return [
    { t: 'path', d: sides, stroke: INK, w: weight, alpha: 0.95, cap: 'round' },
    { t: 'path', d: capA + capB, stroke: INK, w: weight * 0.7, alpha: 0.8 },
  ];
}

/** Radio de una parte: el ancho medido en la silueta si lo hay, si no el de la malla, si no el canon. */
export function radiusOf(model: FigureModel, key: string, part: number, end: 0 | 1, fallback: number): number {
  const fit = model.shapes?.find((s) => s.key === key);
  if (fit) {
    const i = end === 0 ? 1 : fit.left.length - 2;
    const r = (fit.left[i] + fit.right[i]) / 2;
    if (r > 0) return r;
  }
  const r = model.surface?.radii[part]?.[end];
  return r && r > 0 ? r : fallback;
}

export interface Trunk {
  up: V3;
  across: V3;
  front: V3;
  chest: { c: V3; a: number; b: number; d: number };
  hips: { c: V3; a: number; b: number; d: number; across: V3; front: V3; up: V3 };
}

/** Gira un vector alrededor de un eje unitario (Rodrigues). */
function rotate(v: V3, axis: V3, angle: number): V3 {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return add(add(mul(v, cs), mul(cross(axis, v), sn)), mul(axis, dot(axis, v) * (1 - cs)));
}

/**
 * Las cajas se orientan como las dibuja un profesor de figura: inclinadas con la línea de hombros
 * (o de caderas) y la columna tal como se ven en la imagen, giradas lo que gira el pecho, y con la
 * línea del horizonte a la altura de la cintura: por eso se ve la base de la caja torácica y la
 * tapa de la pelvis. Tomar los ejes directamente del modelo 3D las giraba de más y dejaban de
 * abrazar el cuerpo que se ve.
 */
export function trunkOf(c: Ctx, model: FigureModel): Trunk | null {
  const { rig } = c;
  const P = (i: number) => rig.pts[i];
  if (![MHR.shoulderL, MHR.shoulderR, MHR.hipL, MHR.hipR].every((i) => rig.pts[i])) return null;
  const sh = mid(P(MHR.shoulderL), P(MHR.shoulderR));
  const hp = mid(P(MHR.hipL), P(MHR.hipR));
  const flat2 = (q: V3): V3 => unit([q[0], q[1], 0]);
  const up = flat2(sub(sh, hp));
  const inPlane = (q: V3): V3 => unit(sub(flat2(q), mul(up, dot(flat2(q), up))));
  const view: V3 = [0, 0, 1];
  const turned = (line: V3, degrees: number): V3 => {
    // El modelo 3D dice hacia qué lado se aleja la línea; el ángulo sale de la lectura del pecho.
    const side = Math.sign(line[2]) || 1;
    const a = (Math.min(75, Math.abs(degrees)) * Math.PI) / 180;
    return unit(add(mul(inPlane(line), Math.cos(a)), mul(view, Math.sin(a) * side)));
  };
  const shoulderLine = sub(P(MHR.shoulderR), P(MHR.shoulderL));
  const hipLine = sub(P(MHR.hipR), P(MHR.hipL));
  const chestTurn = model.chest ?? (Math.atan2(Math.abs(shoulderLine[2]) * 0.5, Math.hypot(shoulderLine[0], shoulderLine[1])) * 180) / Math.PI;
  const hipTurn = (Math.atan2(Math.abs(hipLine[2]) * 0.5, Math.hypot(hipLine[0], hipLine[1])) * 180) / Math.PI;
  const across0 = turned(shoulderLine, chestTurn);
  // La pelvis gira menos que el pecho casi siempre: se toma la menor de las dos lecturas.
  const hipAcross0 = turned(hipLine, Math.min(hipTurn, Math.abs(chestTurn) + 10));
  const facing = (across: V3): V3 => frontOf(c, across, up);
  // Horizonte en la cintura: el pecho se ve un poco desde abajo y la pelvis un poco desde arriba.
  const PITCH = (10 * Math.PI) / 180;
  const front0 = facing(across0);
  const chestUp = rotate(up, across0, Math.sign(front0[2] || 1) * PITCH);
  const chestFront = rotate(front0, across0, Math.sign(front0[2] || 1) * PITCH);
  const hipFront0 = facing(hipAcross0);
  const hipUp = rotate(up, hipAcross0, -Math.sign(hipFront0[2] || 1) * PITCH);
  const hipFront = rotate(hipFront0, hipAcross0, -Math.sign(hipFront0[2] || 1) * PITCH);
  const torso = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]);
  const sw = Math.hypot(shoulderLine[0], shoulderLine[1]) / Math.max(0.3, Math.cos((Math.min(75, Math.abs(chestTurn)) * Math.PI) / 180));
  const s = model.surface;
  const depth = s?.chest && s.chest.a > 0 ? Math.max(0.55, Math.min(0.95, s.chest.d / s.chest.a)) : 0.72;
  // El ancho sale de la silueta medida del tórax si la hay; la distancia entre hombros es mínima.
  const torax = model.shapes?.find((q) => q.key === 'torax');
  const measured = torax ? torax.left.slice(2, -2).concat(torax.right.slice(2, -2)).reduce((a, b) => a + b, 0) / (2 * (torax.left.length - 4)) : 0;
  // Medidas en cabezas, como se enseñan: la caja torácica mide cerca de 1.5 cabezas de ancho y
  // 1.3 de alto; la pelvis, algo más angosta y mucho más baja. Fuera de eso deja de verse humana.
  const H = rig.H;
  const clampH = (x: number, lo: number, hi: number) => Math.max(H * lo, Math.min(H * hi, x));
  const ca = clampH(Math.max(sw * 0.45, Math.min(measured, sw * 0.8)), 0.55, 0.85);
  const cb = clampH(torso * 0.3, 0.5, 0.72);
  const chest = { c: sub(sh, mul(up, cb + H * 0.05)), a: ca, b: cb, d: ca * depth };
  const hw = Math.hypot(hipLine[0], hipLine[1]) / Math.max(0.3, Math.cos((Math.min(75, hipTurn) * Math.PI) / 180));
  const ha = clampH(Math.max(hw * 0.95, ca * 0.85), 0.5, 0.8);
  const hips = { c: add(hp, mul(up, torso * 0.04)), a: ha, b: clampH(torso * 0.15, 0.3, 0.45), d: ha * depth * 0.95, across: hipAcross0, front: hipFront, up: hipUp };
  return { up: chestUp, across: across0, front: chestFront, chest, hips };
}

const LIMBS: { key: [string, string]; part: [number, number]; j: [number, number, number]; canon: [number, number, number] }[] = [
  { key: ['brazoL', 'antebrazoL'], part: [PART.brazoL, PART.antebrazoL], j: [MHR.shoulderL, MHR.elbowL, MHR.wristL], canon: [0.24, 0.19, 0.15] },
  { key: ['brazoR', 'antebrazoR'], part: [PART.brazoR, PART.antebrazoR], j: [MHR.shoulderR, MHR.elbowR, MHR.wristR], canon: [0.24, 0.19, 0.15] },
  { key: ['musloL', 'piernaL'], part: [PART.musloL, PART.piernaL], j: [MHR.hipL, MHR.kneeL, MHR.ankleL], canon: [0.36, 0.26, 0.17] },
  { key: ['musloR', 'piernaR'], part: [PART.musloR, PART.piernaR], j: [MHR.hipR, MHR.kneeR, MHR.ankleR], canon: [0.36, 0.26, 0.17] },
];

/** Líneas de hombros y caderas prolongadas, con flecha hacia donde mira el cuerpo. */
function guidePrims(c: Ctx, t: Trunk): Prim[] {
  const { rig, v } = c;
  const out: Prim[] = [];
  for (const [l, r, front] of [[MHR.shoulderL, MHR.shoulderR, t.front], [MHR.hipL, MHR.hipR, t.hips.front]] as const) {
    if (!rig.pts[l] || !rig.pts[r]) continue;
    const L = c.at(rig.pts[l]);
    const R = c.at(rig.pts[r]);
    const dx = R[0] - L[0];
    const dy = R[1] - L[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const reach = Math.max(len * 0.9, v.H * 0.08);
    // La flecha va del lado hacia el que gira el frente.
    const toward = front[0] >= 0 === ux >= 0 ? 1 : -1;
    const a: Pt = toward > 0 ? [L[0] - ux * reach * 0.5, L[1] - uy * reach * 0.5] : [R[0] + ux * reach * 0.5, R[1] + uy * reach * 0.5];
    const b: Pt = toward > 0 ? [R[0] + ux * reach, R[1] + uy * reach] : [L[0] - ux * reach, L[1] - uy * reach];
    out.push({ t: 'path', d: arrow(a, b, 11 * v.unit), stroke: INK, w: 1, alpha: 0.55, cap: 'round' });
  }
  return out;
}

function headPrims(c: Ctx, model: FigureModel, weight: number, withJaw = false): Prim[] {
  const out: Prim[] = [];
  const head = model.mannequin?.head;
  const { v } = c;
  const path = (pts: Pt[], closed: boolean) => poly(pts.map(([x, y]): Pt => [x * v.W, y * v.H]), closed);
  if (head?.ball?.length) {
    // La bola del cráneo; en el maniquí, con la quijada, como el óvalo de la cabeza.
    out.push({ t: 'path', d: path(withJaw && head.outline?.length ? head.outline : head.ball, true), stroke: INK, w: weight, alpha: 0.95 });
    // La cruz de la cara: el eje central y la línea de cejas, curvados sobre la bola según mira.
    const axes = head.axes.filter((a) => a.length > 1).map((a) => path(a, false)).join('');
    if (axes) out.push({ t: 'path', d: axes, stroke: INK, w: weight * 0.6, alpha: 0.75 });
  } else if (model.head && model.head.r > 0) {
    const cx = model.head.c[0] * v.W;
    const cy = model.head.c[1] * v.H;
    const r = model.head.r * v.H;
    out.push({ t: 'path', d: ellipse([cx, cy], [r * 0.85, 0], r * 1.05), stroke: INK, w: weight, alpha: 0.95 });
    out.push({ t: 'path', d: line([cx, cy - r], [cx, cy + r]) + line([cx - r * 0.85, cy], [cx + r * 0.85, cy]), stroke: INK, w: weight * 0.6, alpha: 0.7 });
  }
  return out;
}

/** Bloque de mano o pie como trapecio en la dirección del hueso, como se marca en el monigote. */
function blockPrims(c: Ctx, base: V3, dir: Pt, length: number, w0: number, w1: number, weight: number): Prim[] {
  const B = c.at(base);
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / l;
  const uy = dir[1] / l;
  const L = length * c.v.H;
  const W0 = w0 * c.v.H;
  const W1 = w1 * c.v.H;
  const E: Pt = [B[0] + ux * L, B[1] + uy * L];
  return [{ t: 'path', d: poly([[B[0] - uy * W0, B[1] + ux * W0], [B[0] + uy * W0, B[1] - ux * W0], [E[0] + uy * W1, E[1] - ux * W1], [E[0] - uy * W1, E[1] + ux * W1]]), stroke: INK, w: weight, alpha: 0.9 }];
}

/** Cuña del pie en 3D: del talón a los dedos, alta atrás y baja adelante. */
function footPrims(c: Ctx, side: 'L' | 'R', weight: number): Prim[] {
  const { rig, H } = c;
  const ankle = side === 'L' ? MHR.ankleL : MHR.ankleR;
  const toe = side === 'L' ? MHR.toeL : MHR.toeR;
  const heel = side === 'L' ? MHR.heelL : MHR.heelR;
  if (!c.seen(ankle) || !rig.pts[toe] || !rig.pts[heel]) return [];
  const A = rig.pts[ankle];
  const T = rig.pts[toe];
  const He = rig.pts[heel];
  const fwd = unit(sub(T, He));
  const up = unit(sub(A, mid(T, He)));
  const side3 = unit(cross(fwd, up));
  const w = H * 0.14;
  const hHeel = size(sub(A, He)) * 0.9;
  const hToe = hHeel * 0.3;
  const back = He;
  const front = T;
  const center = mid(back, front);
  const half = size(sub(front, back)) / 2;
  // Se arma como caja y se ajusta: la cara de arriba baja hacia los dedos.
  const corner = (sa: number, sb: number, sd: number): V3 => {
    const along = sd > 0 ? front : back;
    const h = sd > 0 ? hToe : hHeel;
    return add(add(along, mul(side3, w * sa * (sd > 0 ? 0.9 : 1))), mul(up, sb > 0 ? h : 0));
  };
  void center;
  void half;
  const faces: { n: V3; q: V3[] }[] = [
    { n: up, q: [corner(1, 1, 1), corner(-1, 1, 1), corner(-1, 1, -1), corner(1, 1, -1)] },
    { n: mul(up, -1), q: [corner(1, -1, 1), corner(1, -1, -1), corner(-1, -1, -1), corner(-1, -1, 1)] },
    { n: side3, q: [corner(1, 1, 1), corner(1, 1, -1), corner(1, -1, -1), corner(1, -1, 1)] },
    { n: mul(side3, -1), q: [corner(-1, 1, 1), corner(-1, -1, 1), corner(-1, -1, -1), corner(-1, 1, -1)] },
    { n: fwd, q: [corner(1, 1, 1), corner(1, -1, 1), corner(-1, -1, 1), corner(-1, 1, 1)] },
    { n: mul(fwd, -1), q: [corner(1, 1, -1), corner(-1, 1, -1), corner(-1, -1, -1), corner(1, -1, -1)] },
  ];
  let d = '';
  let hatch = '';
  faces.forEach((fc) => {
    if (fc.n[2] <= 0.02) return;
    d += poly(fc.q.map(c.at));
    // La punta de frente se raya, como el plano que mira a quien dibuja.
    if (fc.n === faces[4].n) {
      const [p0, p1, p2, p3] = fc.q.map(c.at);
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        hatch += line([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], [p3[0] + (p2[0] - p3[0]) * t, p3[1] + (p2[1] - p3[1]) * t]);
      }
    }
  });
  const out: Prim[] = [{ t: 'path', d, stroke: INK, w: weight, alpha: 0.95 }];
  if (hatch) out.push({ t: 'path', d: hatch, stroke: INK, w: 0.8, alpha: 0.55 });
  return out;
}

/**
 * Paso 2 como el monigote articulado: palos, cada articulación como un óvalo chico, la pelvis como
 * trapecio, manos y pies como bloques y las líneas guía de hombros y caderas.
 */
export function artistSkeletonPrims(model: FigureModel, v: View): Prim[] | null {
  const c = ctxOf(model, v);
  if (!c) return null;
  const { rig } = c;
  const t = trunkOf(c, model);
  const out: Prim[] = [];
  const weight = 2;
  const P = (i: number) => rig.pts[i];
  if (t) out.push(...guidePrims(c, t));
  let sticks = '';
  const bone = (a: number, b: number) => {
    if (c.seen(a) && c.seen(b)) sticks += line(c.at(P(a)), c.at(P(b)));
  };
  // Columna: del cuello a la pelvis, pasando por el centro del tronco.
  if (t) {
    const hp = mid(P(MHR.hipL), P(MHR.hipR));
    const sh = mid(P(MHR.shoulderL), P(MHR.shoulderR));
    // Del cuello (entre los hombros) a la pelvis; se curva hacia donde se dobla el tronco.
    const bend = rig.spine ? sub(rig.spine, mid(sh, hp)) : ([0, 0, 0] as V3);
    const curve = [sh, add(mid(sh, hp), mul(bend, 1.6)), hp].map(c.at);
    sticks += `M${f(curve[0][0])} ${f(curve[0][1])}Q${f(curve[1][0])} ${f(curve[1][1])} ${f(curve[2][0])} ${f(curve[2][1])}`;
  }
  bone(MHR.shoulderL, MHR.shoulderR);
  for (const l of LIMBS) {
    if (c.absent.has(l.part[0])) continue;
    bone(l.j[0], l.j[1]);
    if (!c.absent.has(l.part[1])) bone(l.j[1], l.j[2]);
  }
  out.push({ t: 'path', d: sticks, stroke: LIGHT, w: weight + 2.5, alpha: 0.5, cap: 'round' }, { t: 'path', d: sticks, stroke: INK, w: weight, alpha: 0.95, cap: 'round' });
  // La pelvis como trapecio: ancho arriba (crestas) y angosto abajo.
  if (t) {
    const { hips } = t;
    const top = add(hips.c, mul(hips.up, hips.b));
    const low = sub(hips.c, mul(hips.up, hips.b));
    const q = [add(top, mul(hips.across, -hips.a)), add(top, mul(hips.across, hips.a)), add(low, mul(hips.across, hips.a * 0.7)), add(low, mul(hips.across, -hips.a * 0.7))].map(c.at);
    out.push({ t: 'path', d: poly(q), stroke: INK, w: weight, alpha: 0.95 });
  }
  // Óvalos en cada articulación, atravesados por el hueso.
  const r = rig.H * 0.075;
  for (const l of LIMBS) {
    for (let k = 0; k < 3; k++) {
      const j = l.j[k];
      if (!c.seen(j) || c.absent.has(l.part[Math.min(1, k)])) continue;
      const toward = k < 2 && c.seen(l.j[k + 1]) ? sub(P(l.j[k + 1]), P(j)) : sub(P(j), P(l.j[k - 1]));
      const at = c.at(P(j));
      const s = c.at(add(P(j), toward));
      const dx = s[0] - at[0];
      const dy = s[1] - at[1];
      const dl = Math.hypot(dx, dy) || 1;
      out.push({ t: 'path', d: ellipse(at, [(-dy / dl) * r * v.H, (dx / dl) * r * v.H], r * v.H * 0.62), stroke: INK, w: 1.4, alpha: 0.9, fill: 'var(--paper)', fillAlpha: 1 });
    }
  }
  // Manos y pies: bloques en la dirección del último hueso.
  for (const [elbow, wrist, part] of [[MHR.elbowL, MHR.wristL, PART.antebrazoL], [MHR.elbowR, MHR.wristR, PART.antebrazoR]] as const) {
    if (!c.seen(elbow) || !c.seen(wrist) || c.absent.has(part)) continue;
    const a = c.at(P(elbow));
    const b = c.at(P(wrist));
    out.push(...blockPrims(c, P(wrist), [b[0] - a[0], b[1] - a[1]], rig.H * 0.55, rig.H * 0.09, rig.H * 0.14, 1.6));
  }
  for (const [knee, ankle, toe, part] of [[MHR.kneeL, MHR.ankleL, MHR.toeL, PART.piernaL], [MHR.kneeR, MHR.ankleR, MHR.toeR, PART.piernaR]] as const) {
    if (!c.seen(ankle) || c.absent.has(part)) continue;
    const a = c.at(P(ankle));
    const dir: Pt = P(toe) ? (([x, y]) => [x - a[0], y - a[1]] as Pt)(c.at(P(toe))) : (([x, y]) => [a[0] - x, a[1] - y] as Pt)(c.at(P(knee)));
    out.push(...blockPrims(c, P(ankle), dir, rig.H * 0.6, rig.H * 0.08, rig.H * 0.13, 1.6));
  }
  out.push(...headPrims(c, model, weight));
  return out;
}

/**
 * Pasos 3 y 4 como el maniquí de cajas y cilindros: la caja torácica con su plano de abajo rayado,
 * la pelvis con su plano de arriba rayado, cilindros para cada hueso, cuello, cuñas de pies y las
 * líneas guía. En el paso 3 sin elipses ni rayado: solo los volúmenes.
 */
export function artistMannequinPrims(model: FigureModel, v: View, level: 3 | 4): Prim[] | null {
  const c = ctxOf(model, v);
  if (!c) return null;
  const t = trunkOf(c, model);
  if (!t) return null;
  const { rig } = c;
  const P = (i: number) => rig.pts[i];
  const out: Prim[] = [];
  const weight = 1.7;
  out.push(...guidePrims(c, t));
  // Primero lo de atrás: así lo de adelante se lee encima.
  const parts: { z: number; prims: Prim[] }[] = [];
  for (const l of LIMBS) {
    const [a, b, e] = l.j;
    if (!c.seen(a) || !c.seen(b) || c.absent.has(l.part[0])) continue;
    const r0 = radiusOf(model, l.key[0], l.part[0], 0, rig.H * l.canon[0]);
    const r1 = radiusOf(model, l.key[0], l.part[0], 1, rig.H * l.canon[1]);
    parts.push({ z: (P(a)[2] + P(b)[2]) / 2, prims: cylinderPrims(c, P(a), P(b), r0, r1, weight) });
    if (c.seen(e) && !c.absent.has(l.part[1])) {
      const r2 = radiusOf(model, l.key[1], l.part[1], 0, rig.H * l.canon[1]);
      const r3 = radiusOf(model, l.key[1], l.part[1], 1, rig.H * l.canon[2]);
      parts.push({ z: (P(b)[2] + P(e)[2]) / 2, prims: cylinderPrims(c, P(b), P(e), r2 * 0.95, r3, weight) });
    }
  }
  // Cuello: un cilindro corto del tronco a la cabeza.
  if (model.head && model.head.r > 0) {
    const base = mid(P(MHR.shoulderL), P(MHR.shoulderR));
    const head: V3 = [model.head.c[0] * (v.W / v.H), model.head.c[1], base[2]];
    // Hasta la base del cráneo: el centro de la cabeza menos casi un radio.
    const toHead = sub(head, base);
    const reach = Math.max(0.2, 1 - (model.head.r * 0.85) / (size(toHead) || 1));
    const top = add(base, mul(toHead, reach));
    parts.push({ z: base[2], prims: cylinderPrims(c, base, top, rig.H * 0.17, rig.H * 0.15, weight) });
  }
  parts.push({ z: t.chest.c[2], prims: boxPrims(c, t.chest.c, t.across, t.up, t.front, t.chest.a, t.chest.b, t.chest.d, level === 4 ? mul(t.up, -1) : null, weight + 0.3) });
  parts.push({ z: t.hips.c[2], prims: boxPrims(c, t.hips.c, t.hips.across, t.hips.up, t.hips.front, t.hips.a, t.hips.b, t.hips.d, level === 4 ? t.hips.up : null, weight + 0.3) });
  for (const side of ['L', 'R'] as const) {
    const part = side === 'L' ? PART.piernaL : PART.piernaR;
    if (c.absent.has(part)) continue;
    const ankle = side === 'L' ? MHR.ankleL : MHR.ankleR;
    parts.push({ z: c.seen(ankle) ? P(ankle)[2] : 0, prims: footPrims(c, side, weight) });
  }
  for (const [elbow, wrist, part] of [[MHR.elbowL, MHR.wristL, PART.antebrazoL], [MHR.elbowR, MHR.wristR, PART.antebrazoR]] as const) {
    if (!c.seen(elbow) || !c.seen(wrist) || c.absent.has(part)) continue;
    const a = c.at(P(elbow));
    const b = c.at(P(wrist));
    parts.push({ z: P(wrist)[2], prims: blockPrims(c, P(wrist), [b[0] - a[0], b[1] - a[1]], rig.H * 0.55, rig.H * 0.09, rig.H * 0.14, 1.5) });
  }
  parts.sort((p, q) => p.z - q.z);
  for (const p of parts) out.push(...p.prims);
  out.push(...headPrims(c, model, weight + 0.2, true));
  // Una sola nota roja: dónde gira el tronco, la torsión entre las dos cajas.
  void ROJO;
  return out;
}
