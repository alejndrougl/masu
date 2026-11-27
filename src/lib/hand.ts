import { convexHull } from './composition';
import { catmullRom, POSE } from './gesture';
import type { Block, Mannequin } from './mannequin';
import { add, clamp, cross, limbPiece, measuredRadius, mix, mul, size, smoothClosed, sub, unit, type Facet, type Mask, type Piece } from './pieces';
import type { HandMarks, Pt } from './types';
import type { V3 } from './volumes';

import { t as tx, tr } from '../i18n';
/** Del pulgar al meñique: base, medio, último y punta. */
export const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

const NAMES = ['Pulgar', 'Índice', 'Medio', 'Anular', 'Meñique'];
/** Largo de cada falange sin escorzo, respecto a la palma. */
const PHALANX = [
  [0.46, 0.36, 0.3],
  [0.47, 0.27, 0.21],
  [0.52, 0.31, 0.23],
  [0.48, 0.29, 0.22],
  [0.37, 0.21, 0.19],
];
const WIDTH = [1.16, 1, 1.02, 0.96, 0.82];

type Pose = { pts: Pt[]; vis: number[] } | undefined;
const dist2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Un pie engaña a los modelos de mano: cinco dedos y una base. Se distingue porque sus
 * dedos son cortos y rectos respecto a la planta, mientras que unos dedos cortos de mano
 * solo se ven así si están doblados. Si hay un cuerpo, el tobillo lo confirma.
 */
export function looksLikeFoot(hand: HandMarks, poses: Pose[]): boolean {
  const { pts } = hand;
  const palm = dist2(pts[0], pts[9]) || 1e-6;
  let reach = 0;
  let straight = 0;
  for (const f of FINGERS.slice(1)) {
    const span = dist2(pts[f[0]], pts[f[3]]);
    const along = dist2(pts[f[0]], pts[f[1]]) + dist2(pts[f[1]], pts[f[2]]) + dist2(pts[f[2]], pts[f[3]]);
    reach += span / palm / 4;
    straight += span / (along || 1e-6) / 4;
  }
  const center = pts[9];
  for (const pose of poses) {
    if (!pose) continue;
    const near = (i: number) => (pose.vis[i] > 0.3 ? dist2(pose.pts[i], center) : Infinity);
    const ankle = Math.min(near(POSE.ankleL), near(POSE.ankleR));
    const wrist = Math.min(near(POSE.wristL), near(POSE.wristR));
    if (Number.isFinite(ankle) && ankle < wrist * 0.7 && ankle < palm * 3) return true;
  }
  return reach < 0.62 && straight > 0.72;
}

/** Lleva los puntos a 3D: lo que da el modelo, o lo que falta a cada falange para medir lo suyo. */
function lift(m: HandMarks, aspect: number): V3[] {
  const flat = m.pts.map(([x, y]): Pt => [x * aspect, y]);
  if (m.world) {
    const w = m.world;
    let seen = 0;
    let real = 0;
    for (const f of FINGERS) {
      for (let i = 0; i < 3; i++) {
        seen += dist2(flat[f[i]], flat[f[i + 1]]);
        real += Math.hypot(w[f[i]][0] - w[f[i + 1]][0], w[f[i]][1] - w[f[i + 1]][1]);
      }
    }
    const k = seen / (real || 1);
    return flat.map(([x, y], i) => [x, y, (w[i][2] - w[0][2]) * k]);
  }
  const palm = Math.max(dist2(flat[0], flat[9]), dist2(flat[5], flat[17]) * 1.25);
  const out: V3[] = flat.map(([x, y]) => [x, y, 0]);
  FINGERS.forEach((f, n) => {
    let z = 0;
    for (let i = 0; i < 3; i++) {
      const want = PHALANX[n][i] * palm;
      const have = dist2(flat[f[i]], flat[f[i + 1]]);
      z += Math.sqrt(Math.max(0, want * want - have * have)) * 0.7;
      out[f[i + 1]][2] = z;
    }
  });
  return out;
}

/** Elipse de una articulación: siempre se abre un poco, para que el dedo se lea redondo. */
function jointRing(c: V3, dir: V3, r: number, aspect: number): Pt[] {
  const along2 = Math.hypot(dir[0], dir[1]) || 1;
  const ax = dir[0] / along2;
  const ay = dir[1] / along2;
  const open = Math.max(0.3, Math.abs(dir[2]));
  const out: Pt[] = [];
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const u = r * Math.cos(t);
    const v = r * open * Math.sin(t);
    out.push([(c[0] - ay * u + ax * v) / aspect, c[1] + ax * u + ay * v]);
  }
  return out;
}

export interface HandBuild {
  mannequin: Mannequin;
  action: Pt[];
  sticks: [Pt, Pt][];
  joints: Pt[];
  /** Hacia dónde va cada dedo: de la base a la punta. */
  arrows: [Pt, Pt][];
  box: { x: number; y: number; w: number; h: number };
}

export interface HandInput {
  marks: HandMarks;
  aspect: number;
  mask?: Mask;
  id?: string;
  foot?: boolean;
}

/**
 * Mano por el método de los ejes: primero la cuña de la palma, luego el pulgar con su
 * masa, y cada dedo como tres piezas que se doblan en elipses. Todo sale de sus puntos.
 */
export function buildHand({ marks, aspect, mask, id = 'mano', foot }: HandInput): HandBuild {
  const P = lift(marks, aspect);
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const wrist = P[0];
  const mid = P[9];
  const span = Math.max(size(sub(P[5], P[17])), size(sub(wrist, mid)) * 0.68);
  const base = span / 8;
  const seen = measuredRadius(mask, flat(P[9]), flat(P[10]), aspect, base * 4);
  const r0 = seen === null ? base : clamp(seen, base * 0.7, base * 1.35);
  const pieces: Piece[] = [];
  const blocks: Block[] = [];
  const palmName = foot ? tx('common.empeine') : tx('hand.palma');

  // Cuña de la palma: angosta en la muñeca, ancha en los nudillos.
  const across = unit(sub(P[5], P[17]));
  const wristHalf = span * (foot ? 0.42 : 0.33);
  const wristA = add(wrist, mul(across, wristHalf));
  const wristB = add(wrist, mul(across, -wristHalf));
  const edgeA = add(P[5], mul(across, r0 * 0.9));
  const edgeB = add(P[17], mul(across, -r0 * 0.9));
  const wedge: V3[] = [wristA, P[1], edgeA, P[9], P[13], edgeB, wristB];
  const hull = convexHull(wedge.map((p): Pt => [p[0], p[1]]));
  const palmZ = (wrist[2] + P[5][2] + P[9][2] + P[13][2] + P[17][2]) / 5;
  const n = unit(cross(sub(P[5], wrist), sub(P[17], wrist)));
  const normal: V3 = n[2] < 0 ? mul(n, -1) : n;
  const palmQuad = [wristA, edgeA, edgeB, wristB].map(flat);
  const facets: Facet[] = [{ n: normal, poly: palmQuad }];
  const knuckles = catmullRom([P[5], P[9], P[13], P[17]].map(flat), 8);
  pieces.push({
    id: `${id}-palma`,
    name: palmName,
    step: 1,
    z: palmZ,
    outline: smoothClosed(hull.map(([x, y]): Pt => [x / aspect, y]), 1),
    caps: [],
    rings: [],
    axes: [knuckles, [flat(wristA), flat(wristB)]],
    stick: [flat(wrist), flat(mid)],
    mass: true,
    planes: facets,
  });
  blocks.push({ id: `${id}-palma`, name: palmName, order: 1, a: flat(wrist), b: flat(mid), ra: wristHalf, rb: span * 0.52 });

  const order = [{ step: 1, name: palmName, note: foot ? tx('hand.una_cuna_del_tobillo') : tx('hand.una_cuna_de_la') }];
  FINGERS.forEach((f, i) => {
    const step = foot ? 2 : i + 2;
    const name = foot ? tx('hand.dedos') : tr(NAMES[i]);
    if (!foot || i === 0) {
      order.push({
        step,
        name,
        note: foot ? tx('hand.cortos_rectos_van_juntos') : i === 0 ? tx('hand.sale_del_costado_de') : tx('hand.tres_piezas_cada_una'),
      });
    }
    const width = r0 * WIDTH[i] * (foot ? 0.85 : 1);
    const axis: Pt[] = [];
    for (let k = 0; k < 3; k++) {
      const a = P[f[k]];
      const b = P[f[k + 1]];
      if (size(sub(b, a)) < 1e-5) continue;
      const ra = width * (1 - k * 0.13);
      const rb = width * (0.87 - k * 0.13);
      const piece = limbPiece(`${id}-d${i}-${k}`, name, step, a, b, ra, rb, aspect, { rings: [] });
      const dir = unit(sub(b, a));
      pieces.push({
        ...piece,
        caps: [jointRing(a, dir, ra, aspect), ...(k === 2 ? [] : [jointRing(b, dir, rb, aspect)])],
        outline: smoothClosed(piece.outline, 2),
      });
      axis.push(flat(a));
      if (k === 2) axis.push(flat(b));
    }
    if (i === 0) {
      // La masa del pulgar: nace de la base de la palma.
      const root = mix(wrist, P[1], 0.35);
      const mass = limbPiece(`${id}-tenar`, name, step, root, P[2], width * 1.5, width * 1.02, aspect, { rings: [0.5] });
      pieces.push({ ...mass, caps: [], outline: smoothClosed(mass.outline, 2), z: mass.z - span * 0.02 });
    }
    if (axis.length > 1) pieces.filter((p) => p.step === step && p.id.endsWith('-0')).forEach((p) => p.axes.push(axis));
    blocks.push({ id: `${id}-d${i}`, name, order: step, a: flat(P[f[0]]), b: flat(P[f[3]]), ra: width, rb: width * 0.7 });
  });

  const sticks: [Pt, Pt][] = [];
  for (const f of FINGERS) {
    sticks.push([flat(wrist), flat(P[f[0]])]);
    for (let k = 0; k < 3; k++) sticks.push([flat(P[f[k]]), flat(P[f[k + 1]])]);
  }
  sticks.push([flat(P[5]), flat(P[17])]);
  const arrows = FINGERS.map((f): [Pt, Pt] => [flat(P[f[0]]), flat(P[f[3]])]);
  const line = [wrist, mid, P[10], P[11], P[12]].map(flat);
  const action = catmullRom(line, 10);
  const all = pieces.flatMap((p) => p.outline);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const nearest = [...pieces].sort((a, b) => b.z - a.z)[0];
  const mannequin: Mannequin = {
    pieces,
    spine: action,
    tilts: [[flat(P[5]), flat(P[17])]],
    head: null,
    hands: [],
    order,
    headHeight: size(sub(wrist, mid)),
    chest: 0,
    blocks,
    rig: null,
    light: null,
    nearest: nearest?.name ?? null,
  };
  return { mannequin, action, sticks, joints: P.map(flat), arrows, box: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 } };
}
