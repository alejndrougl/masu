import { COCO_TO_MHR, HAND_L, HAND_R, MHR, MHR_COUNT, PARENT, TOPOLOGICAL, alignment, measureBody, selfDisagreement, type Body3D, type Light, type Measures } from './body';
import { relativeVis } from './framing';
import { POSE } from './gesture';
import { findNeck, nearestOf, regionOf } from './parts';
import type { Pt } from './types';

import { t as tx } from '../i18n';
export type V3 = [number, number, number];

/**
 * Esqueleto listo para dibujar: 70 articulaciones con jerarquía. x e y están en altos de
 * encuadre (x con el aspecto ya aplicado), y z es la cercanía a quien mira en esa misma unidad.
 */
export interface Rig {
  pts: V3[];
  seen: boolean[];
  /** Cuánto se ve más grande cada punto: por estar cerca, o porque el dibujo lo estira. */
  near: number[];
  /** Alto de una cabeza. */
  H: number;
  /** Metros a unidades del encuadre. */
  scale: number;
  /** Largo de los miembros respecto al canon, si no hay malla que los mida. */
  proportion: number;
  measures: Measures | null;
  /** 0 a 1: qué tanto se puede confiar en este esqueleto. */
  sure: number;
  /** Punto medio de la columna. */
  spine: V3;
  light: Light | null;
  /** Las articulaciones tal como las dejó la red: de ahí parte la malla. */
  base?: V3[];
  /** Cómo llevar la malla al encuadre. */
  place?: { k: number; ox: number; oy: number; rootZ: number };
}

/** Correcciones del pintor por articulación, en las mismas unidades que el esqueleto. */
export type RigEdit = Record<number, V3>;

export interface RigInput {
  pose?: { pts: Pt[]; vis: number[] };
  aspect: number;
  depth?: (p: Pt) => number;
  /** Cuánto se acerca el tronco a la pose vista. */
  trunkPull?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Aplica lo que el pintor movió. `dragJoint` ya resolvió la cadena: aquí solo se suma. */
function applyEdits(pts: V3[], edit?: RigEdit) {
  if (!edit) return;
  for (const key of Object.keys(edit)) {
    const i = Number(key);
    const d = edit[i];
    if (pts[i]) pts[i] = [pts[i][0] + d[0], pts[i][1] + d[1], pts[i][2] + d[2]];
  }
}

/**
 * Del cuerpo 3D al esqueleto de esta imagen. La profundidad y la coherencia salen del
 * modelo; la posición en pantalla se acerca a lo que de verdad se ve. Por eso un dibujo
 * con piernas largas o cabeza grande conserva sus proporciones: el hueso se estira hasta
 * donde está en el dibujo, y el giro en 3D sigue siendo el del modelo.
 */
export function bodyRig(body: Body3D, screen: Float32Array, input: RigInput, light: Light | null = null): Rig {
  const { aspect, pose } = input;
  // Se ajusta con lo visible solo si el ajuste con todo el cuerpo no calza dentro del cuadro: en un
  // busto la red inventa piernas lejanas que arrastran el tronco. Si calza, se deja como estaba.
  const visibleOnly = selfDisagreement(body.joints, screen, aspect, false) > 0.06;
  const { k, ox, oy } = alignment(body.joints, screen, aspect, visibleOnly);
  const J = body.joints;
  const rootZ = (J[MHR.hipL * 3 + 2] + J[MHR.hipR * 3 + 2]) / 2;
  const base: V3[] = [];
  const near: number[] = [];
  for (let i = 0; i < MHR_COUNT; i++) {
    const dz = J[i * 3 + 2] - rootZ;
    base.push([J[i * 3] * k + ox, J[i * 3 + 1] * k + oy, -dz * k]);
    near.push(clamp(body.distance / (body.distance + dz), 0.6, 3));
  }
  const measures = measureBody(J, body.vertices);
  const H = Math.max(measures.head * 2 * k, 1e-3);

  // Dónde lo ve la pose 2D. Una lectura lejos del modelo y poco segura se ignora.
  const target = new Map<number, { x: number; y: number; w: number }>();
  if (pose) {
    // La confianza no vale lo mismo en una foto que en un dibujo: se mide contra su imagen.
    const best = pose.vis.slice(5, 17).sort((p, q) => q - p).slice(0, 6);
    const peak = Math.max(0.3, best.reduce((p, q) => p + q, 0) / (best.length || 1));
    for (const [coco, mhr] of COCO_TO_MHR) {
      const v = (pose.vis[coco] ?? 0) / peak;
      if (v < 0.5) continue;
      const x = pose.pts[coco][0] * aspect;
      const y = pose.pts[coco][1];
      if (x < -0.05 * aspect || x > 1.05 * aspect || y < -0.05 || y > 1.05) continue;
      const far = Math.hypot(x - base[mhr][0], y - base[mhr][1]) / H;
      const trust = clamp((v - 0.5) / 0.4, 0, 1) * clamp(2.2 - far, 0, 1);
      // Manos y pies se acercan a lo que se ve; el tronco casi no: la red ya lo tiene coherente
      // y tirar de hombros y caderas deforma todo el cuerpo.
      const trunk = mhr === MHR.shoulderL || mhr === MHR.shoulderR || mhr === MHR.hipL || mhr === MHR.hipR;
      if (trust > 0) target.set(mhr, { x, y, w: Math.min(1, trust * 0.92) * (trunk ? (input.trunkPull ?? 0.3) : 1) });
    }
  }
  const pts: V3[] = base.map((p) => [...p] as V3);
  const delta: V3[] = base.map(() => [0, 0, 0]);
  for (const i of TOPOLOGICAL) {
    const parent = PARENT[i];
    const inherited: V3 = parent >= 0 ? delta[parent] : [0, 0, 0];
    let x = base[i][0] + inherited[0];
    let y = base[i][1] + inherited[1];
    const t = target.get(i);
    if (t) {
      x += (t.x - x) * t.w;
      y += (t.y - y) * t.w;
    }
    pts[i] = [x, y, base[i][2]];
    delta[i] = [x - base[i][0], y - base[i][1], 0];
  }
  // Un hueso que el dibujo alarga más que el cuerpo real también se ve más grueso.
  for (const i of TOPOLOGICAL) {
    const parent = PARENT[i];
    if (parent < 0) continue;
    const seenLength = Math.hypot(pts[i][0] - pts[parent][0], pts[i][1] - pts[parent][1], pts[i][2] - pts[parent][2]);
    const realLength = Math.hypot(base[i][0] - base[parent][0], base[i][1] - base[parent][1], base[i][2] - base[parent][2]);
    if (realLength > H * 0.2) near[parent] = Math.max(near[parent], clamp(seenLength / realLength, 0.8, 2));
  }
  const seen = new Array<boolean>(MHR_COUNT).fill(true);
  const s = measures.spine;
  const hip: V3 = [(pts[MHR.hipL][0] + pts[MHR.hipR][0]) / 2, (pts[MHR.hipL][1] + pts[MHR.hipR][1]) / 2, (pts[MHR.hipL][2] + pts[MHR.hipR][2]) / 2];
  const baseHip: V3 = [(base[MHR.hipL][0] + base[MHR.hipR][0]) / 2, (base[MHR.hipL][1] + base[MHR.hipR][1]) / 2, (base[MHR.hipL][2] + base[MHR.hipR][2]) / 2];
  const spine: V3 = [s[0] * k + ox + (hip[0] - baseHip[0]), s[1] * k + oy + (hip[1] - baseHip[1]), -(s[2] - rootZ) * k + (hip[2] - baseHip[2])];
  return { pts, seen, near, H, scale: k, proportion: 1, measures, sure: clamp((body.overlap + body.agree - 0.6) / 0.8, 0, 1), spine, light, base, place: { k, ox, oy, rootZ } };
}

const CANON = { upperArm: 1.45, foreArm: 1.15, thigh: 1.85, shin: 1.7, torso: 2.35, shoulders: 1.75, hips: 0.95, hand: 0.72 } as const;

/**
 * Sin cuerpo 3D: la pose plana se levanta usando largos conocidos. Lo que le falta en
 * pantalla a un hueso se va en profundidad, y el mapa de profundidad da el sentido.
 */
export function poseRig(input: RigInput, headHeight: number, facing: number): Rig | null {
  const { pose, aspect, depth } = input;
  if (!pose) return null;
  const { pts: raw, vis } = pose;
  const seen2 = (i: number) => vis[i] > 0.2 && raw[i][0] > -0.05 && raw[i][0] < 1.05 && raw[i][1] > -0.05 && raw[i][1] < 1.05;
  if (!seen2(POSE.shoulderL) || !seen2(POSE.shoulderR)) return null;
  const P = (i: number): V3 => [raw[i][0] * aspect, raw[i][1], 0];
  const len = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const H = headHeight;
  const pairs: [keyof typeof CANON, [number, number][]][] = [
    ['upperArm', [[POSE.shoulderL, POSE.elbowL], [POSE.shoulderR, POSE.elbowR]]],
    ['foreArm', [[POSE.elbowL, POSE.wristL], [POSE.elbowR, POSE.wristR]]],
    ['thigh', [[POSE.hipL, POSE.kneeL], [POSE.hipR, POSE.kneeR]]],
    ['shin', [[POSE.kneeL, POSE.ankleL], [POSE.kneeR, POSE.ankleR]]],
  ];
  const longest = new Map<string, number>();
  const ratios: number[] = [];
  for (const [name, list] of pairs) {
    let best = 0;
    for (const [p, q] of list) if (seen2(p) && seen2(q)) best = Math.max(best, len(P(p), P(q)));
    longest.set(name, best);
    if (best > 0) ratios.push(best / (CANON[name] * H));
  }
  ratios.sort((p, q) => q - p);
  const k = clamp(ratios.length >= 3 ? ratios[1] : (ratios[0] ?? 1), 0.62, 1.3);
  const bone = (name: keyof typeof CANON) => Math.max(longest.get(name) ?? 0, CANON[name] * H * k);
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const nearer = (a: V3, b: V3) => {
    if (!depth) return { sign: 0, sure: 0 };
    const gap = depth(flat(a)) - depth(flat(b));
    return { sign: Math.sign(gap), sure: clamp(Math.abs(gap) / 0.06, 0, 1) };
  };
  const reachZ = (from: V3, to: V3, length: number, fallback = 0) => {
    const d = len(from, to);
    const gap = Math.sqrt(Math.max(0, length * length - d * d));
    const { sign, sure } = nearer(to, from);
    return from[2] + (sign || fallback) * gap * (0.4 + 0.6 * sure);
  };
  // Lo largo de un hueso sale de sus pares; el tronco no crece con piernas de héroe.
  const out: V3[] = Array.from({ length: MHR_COUNT }, (): V3 => [0, 0, 0]);
  const seen = new Array<boolean>(MHR_COUNT).fill(false);
  const put = (mhr: number, p: V3) => {
    out[mhr] = p;
    seen[mhr] = true;
  };
  const neck2 = (() => {
    const a = P(POSE.shoulderL);
    const b = P(POSE.shoulderR);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0] as V3;
  })();
  const hasHips = seen2(POSE.hipL) && seen2(POSE.hipR);
  const hip2 = seen2(POSE.hipL) && seen2(POSE.hipR) ? Math.hypot((raw[POSE.hipL][0] + raw[POSE.hipR][0] - raw[POSE.shoulderL][0] - raw[POSE.shoulderR][0]) * aspect * 0.5, (raw[POSE.hipL][1] + raw[POSE.hipR][1] - raw[POSE.shoulderL][1] - raw[POSE.shoulderR][1]) * 0.5) : 0;
  const torso = Math.max(hip2, CANON.torso * H * clamp(k, 0.75, 1.08));
  const pelvis: V3 = hasHips ? [(P(POSE.hipL)[0] + P(POSE.hipR)[0]) / 2, (P(POSE.hipL)[1] + P(POSE.hipR)[1]) / 2, 0] : [neck2[0], neck2[1] + torso * 0.9, 0];
  const neck: V3 = [neck2[0], neck2[1], hasHips ? reachZ(pelvis, neck2, torso) : 0];
  put(MHR.neck, neck);
  const pair = (l: V3, r: V3, center: V3, span0: number, prior: number): [V3, V3] => {
    const d = len(l, r);
    const span = Math.max(d, span0);
    const gap = Math.sqrt(Math.max(0, span * span - d * d)) / 2;
    const { sign, sure } = nearer(l, r);
    const dz = (sign || prior) * gap * (0.45 + 0.55 * sure);
    return [[l[0], l[1], center[2] + dz], [r[0], r[1], center[2] - dz]];
  };
  const [shL, shR] = pair(P(POSE.shoulderL), P(POSE.shoulderR), neck, CANON.shoulders * H * k, facing);
  put(MHR.shoulderL, shL);
  put(MHR.shoulderR, shR);
  if (hasHips) {
    const [hl, hr] = pair(P(POSE.hipL), P(POSE.hipR), pelvis, CANON.hips * H * k, Math.sign(shL[2] - shR[2]));
    put(MHR.hipL, hl);
    put(MHR.hipR, hr);
  }
  const chain = (root: V3 | null, joints: [number, number, number, number], names: ['upperArm' | 'thigh', 'foreArm' | 'shin'], prior: number) => {
    const [mid, end, mMid, mEnd] = joints;
    if (!root || !seen2(mid)) return;
    const a = P(mid);
    a[2] = reachZ(root, a, bone(names[0]), prior);
    put(mMid, a);
    if (seen2(end)) {
      const b = P(end);
      b[2] = reachZ(a, b, bone(names[1]), -prior * 0.5);
      put(mEnd, b);
    }
  };
  const legPrior = 0.3;
  chain(seen[MHR.hipL] ? out[MHR.hipL] : null, [POSE.kneeL, POSE.ankleL, MHR.kneeL, MHR.ankleL], ['thigh', 'shin'], legPrior);
  chain(seen[MHR.hipR] ? out[MHR.hipR] : null, [POSE.kneeR, POSE.ankleR, MHR.kneeR, MHR.ankleR], ['thigh', 'shin'], legPrior);
  chain(shL, [POSE.elbowL, POSE.wristL, MHR.elbowL, MHR.wristL], ['upperArm', 'foreArm'], 0);
  chain(shR, [POSE.elbowR, POSE.wristR, MHR.elbowR, MHR.wristR], ['upperArm', 'foreArm'], 0);
  for (const [coco, mhr] of COCO_TO_MHR) {
    if (seen[mhr] || !seen2(coco)) continue;
    const parent = PARENT[mhr];
    const z = parent >= 0 && seen[parent] ? out[parent][2] : neck[2] + H * 0.3;
    put(mhr, [raw[coco][0] * aspect, raw[coco][1], z]);
  }
  const hip: V3 = hasHips ? [(out[MHR.hipL][0] + out[MHR.hipR][0]) / 2, (out[MHR.hipL][1] + out[MHR.hipR][1]) / 2, (out[MHR.hipL][2] + out[MHR.hipR][2]) / 2] : pelvis;
  return { pts: out, seen, near: new Array(MHR_COUNT).fill(1), H, scale: 1, proportion: k, measures: null, sure: 0.4, spine: [(hip[0] + neck[0]) / 2, (hip[1] + neck[1]) / 2, (hip[2] + neck[2]) / 2], light: null };
}

/** Puntos COCO corregidos con el esqueleto: el resto de la lectura usa esto. */
export function cocoFromRig(rig: Rig, pose: { pts: Pt[]; vis: number[] } | undefined, aspect: number): { pts: Pt[]; vis: number[] } {
  const pts: Pt[] = pose ? pose.pts.map((p) => [...p] as Pt) : Array.from({ length: 133 }, (): Pt => [0.5, 0.5]);
  const vis = pose ? [...pose.vis] : new Array<number>(133).fill(0);
  for (const [coco, mhr] of COCO_TO_MHR) {
    if (!rig.seen[mhr]) continue;
    pts[coco] = [rig.pts[mhr][0] / aspect, rig.pts[mhr][1]];
    vis[coco] = Math.max(vis[coco], 0.6);
  }
  return { pts, vis };
}

export interface TrunkInput {
  pose?: { pts: Pt[]; vis: number[] };
  aspect: number;
  /** Partes en el encuadre, a la resolución de la máscara. */
  parts?: Uint8Array;
  w?: number;
  h?: number;
  edit?: RigEdit;
}

/**
 * Lo que la imagen sabe del tronco y el esqueleto no. El cuello se ve: es la frontera entre
 * cabeza y ropa. Y un hombro escondido detrás de la cabeza no está en la cara, que es donde
 * lo deja la pose: el brazo entra al tronco por el punto del tronco más cercano al codo.
 * Codos y muñecas no se tocan: ya están bien leídos.
 */
function settleTrunk(rig: Rig, input: TrunkInput): Rig {
  const { pose, aspect, parts, w, h } = input;
  const pts = rig.pts.map((p) => [...p] as V3);
  const H = rig.H || 0.1;
  if (parts && w && h && rig.seen[MHR.neck]) {
    const now = pts[MHR.neck];
    // Lejos de los dos hombros no hay cuello: se busca cerca de su punto medio.
    const a = pts[MHR.shoulderL];
    const b = pts[MHR.shoulderR];
    const middle: Pt = rig.seen[MHR.shoulderL] && rig.seen[MHR.shoulderR] ? [(a[0] + b[0]) / 2 / aspect, (a[1] + b[1]) / 2] : [now[0] / aspect, now[1]];
    const seen = findNeck(parts, w, h, middle, H * 1.1, aspect);
    // Con la cara girada la barbilla no cae sobre el cuello: su base queda entre ella y los hombros.
    if (seen) pts[MHR.neck] = [((seen[0] + middle[0]) / 2) * aspect, seen[1], now[2]];
  }
  if (pose && parts && w && h) {
    const rel = relativeVis(pose);
    const labelAt = (p: V3) => {
      const x = Math.floor((p[0] / aspect) * w);
      const y = Math.floor(p[1] * h);
      return x >= 0 && y >= 0 && x < w && y < h ? parts[y * w + x] : 0;
    };
    for (const [shoulder, elbow, coco] of [[MHR.shoulderL, MHR.elbowL, POSE.shoulderL], [MHR.shoulderR, MHR.elbowR, POSE.shoulderR]] as const) {
      if (!rig.seen[shoulder] || !rig.seen[elbow] || rel[coco] >= 0.55) continue;
      const now = pts[shoulder];
      const where = regionOf(labelAt(now));
      if (where === 'tronco' || where === 'brazos') continue;
      const e = pts[elbow];
      const neck = pts[MHR.neck];
      // Una manga corta también es tronco para el modelo: el hombro no puede irse hasta el codo.
      const near = (x: number, y: number) => Math.hypot(x * aspect - neck[0], y - neck[1]) <= H * 0.8;
      const entry = nearestOf(parts, w, h, 'tronco', [e[0] / aspect, e[1]], aspect, near);
      if (!entry) continue;
      const x = entry[0] * aspect;
      const y = entry[1];
      const reach = Math.hypot(now[0] - e[0], now[1] - e[1]);
      if (Math.hypot(x - e[0], y - e[1]) > reach * 1.25) continue;
      // Un poco adentro: la orilla del tronco es el borde del hombro, no su centro.
      const inside = H * 0.22 / (Math.hypot(neck[0] - x, neck[1] - y) || 1);
      pts[shoulder] = [x + (neck[0] - x) * inside, y + (neck[1] - y) * inside, now[2]];
    }
  }
  return { ...rig, pts };
}

/** Corrige con lo que se ve y luego suma lo que movió el pintor: en ese orden, siempre. */
export function finishRig(rig: Rig, input: TrunkInput): Rig {
  const settled = settleTrunk(rig, input);
  if (!input.edit) return settled;
  const pts = settled.pts.map((p) => [...p] as V3);
  applyEdits(pts, input.edit);
  return { ...settled, pts };
}

/** Suma desplazamientos a un esqueleto, sin tocar el original. */
export function moveJoints(rig: Rig, shift: Record<number, V3>): Rig {
  const pts = rig.pts.map((p) => [...p] as V3);
  applyEdits(pts, shift);
  return { ...rig, pts };
}

/** Articulaciones que se pueden tomar y mover, con su nombre. */
export const HANDLES: { id: number; name: string }[] = [
  { id: MHR.neck, name: 'cuello' },
  { id: MHR.shoulderL, name: 'hombro' },
  { id: MHR.shoulderR, name: 'hombro' },
  { id: MHR.elbowL, name: 'codo' },
  { id: MHR.elbowR, name: 'codo' },
  { id: MHR.wristL, get name() { return tx('common.muneca'); } },
  { id: MHR.wristR, get name() { return tx('common.muneca'); } },
  { id: MHR.hipL, name: 'cadera' },
  { id: MHR.hipR, name: 'cadera' },
  { id: MHR.kneeL, name: 'rodilla' },
  { id: MHR.kneeR, name: 'rodilla' },
  { id: MHR.ankleL, name: 'tobillo' },
  { id: MHR.ankleR, name: 'tobillo' },
];

/** Huesos que dibuja el esqueleto. */
export const SKELETON: [number, number][] = [
  [MHR.neck, MHR.shoulderL],
  [MHR.neck, MHR.shoulderR],
  [MHR.shoulderL, MHR.elbowL],
  [MHR.shoulderR, MHR.elbowR],
  [MHR.elbowL, MHR.wristL],
  [MHR.elbowR, MHR.wristR],
  [MHR.hipL, MHR.kneeL],
  [MHR.hipR, MHR.kneeR],
  [MHR.kneeL, MHR.ankleL],
  [MHR.kneeR, MHR.ankleR],
  [MHR.ankleL, MHR.toeL],
  [MHR.ankleR, MHR.toeR],
];

/** Lados de un dedo para los que se conoce toda la cadena. */
export function fingerChains(side: 'L' | 'R'): number[][] {
  return side === 'L' ? HAND_L : HAND_R;
}

const CHILDREN: number[][] = (() => {
  const out: number[][] = Array.from({ length: MHR_COUNT }, () => []);
  PARENT.forEach((p, i) => {
    if (p >= 0) out[p].push(i);
  });
  return out;
})();

/** Una articulación y todo lo que cuelga de ella. */
function subtree(joint: number): number[] {
  const out = [joint];
  for (let i = 0; i < out.length; i++) out.push(...CHILDREN[out[i]]);
  return out;
}

const minus = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const plus = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const times = (p: V3, k: number): V3 => [p[0] * k, p[1] * k, p[2] * k];
const inner = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const length3 = (p: V3) => Math.hypot(p[0], p[1], p[2]);
const direction = (p: V3): V3 => times(p, 1 / (length3(p) || 1e-9));

/** El giro más corto que lleva una dirección a otra. */
function turnFrom(from: V3, to: V3): (p: V3) => V3 {
  const a = direction(from);
  const b = direction(to);
  const c = inner(a, b);
  const v: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s = 1 / (1 + c || 1e-6);
  return ([x, y, z]) => [
    (1 - s * (v[1] * v[1] + v[2] * v[2])) * x + (s * v[0] * v[1] - v[2]) * y + (s * v[0] * v[2] + v[1]) * z,
    (s * v[0] * v[1] + v[2]) * x + (1 - s * (v[0] * v[0] + v[2] * v[2])) * y + (s * v[1] * v[2] - v[0]) * z,
    (s * v[0] * v[2] - v[1]) * x + (s * v[1] * v[2] + v[0]) * y + (1 - s * (v[0] * v[0] + v[1] * v[1])) * z,
  ];
}

/** Hacia dónde queda un hueso si su punta va a (x, y): su largo no cambia, lo demás es profundidad. */
function reachFor(pivot: V3, tip: V3, x: number, y: number): V3 {
  const bone = minus(tip, pivot);
  const L = length3(bone);
  const dx = x - pivot[0];
  const dy = y - pivot[1];
  const flat = Math.hypot(dx, dy);
  if (flat >= L) return [(dx / (flat || 1)) * L, (dy / (flat || 1)) * L, 0];
  return [dx, dy, (bone[2] >= 0 ? 1 : -1) * Math.sqrt(L * L - flat * flat)];
}

/**
 * Dos huesos que llegan a un punto, como un brazo a su mano. Se resuelve con la ley de cosenos
 * sobre el plano donde ya estaba doblada la articulación, para que el codo no se voltee.
 */
export function reachTwoBones(root: V3, mid: V3, end: V3, target: V3, lengths?: [number, number]): { mid: V3; end: V3 } {
  const a = lengths ? lengths[0] : length3(minus(mid, root));
  const b = lengths ? lengths[1] : length3(minus(end, mid));
  const to = minus(target, root);
  const d = Math.max(Math.abs(a - b) + 1e-5, Math.min(a + b - 1e-5, length3(to)));
  const dir = direction(to);
  const offset = minus(mid, root);
  let pole = minus(offset, times(dir, inner(offset, dir)));
  if (length3(pole) < 1e-5) pole = [-dir[1], dir[0], 0];
  pole = direction(pole);
  const along = (a * a - b * b + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, a * a - along * along));
  return { mid: plus(plus(root, times(dir, along)), times(pole, out)), end: plus(root, times(dir, d)) };
}

const LIMBS: Record<number, [number, number]> = {
  [MHR.wristL]: [MHR.shoulderL, MHR.elbowL],
  [MHR.wristR]: [MHR.shoulderR, MHR.elbowR],
  [MHR.ankleL]: [MHR.hipL, MHR.kneeL],
  [MHR.ankleR]: [MHR.hipR, MHR.kneeR],
};

/**
 * Mover una articulación como en un programa de animación: nada se traslada solo.
 * Una mano o un pie arrastran su miembro y doblan el codo o la rodilla. Un codo, una rodilla o
 * un hombro giran sobre su padre y todo lo que cuelga gira con ellos. La cadera mueve el cuerpo
 * con los pies plantados, y el cuello inclina el tronco sobre la pelvis.
 */
export function dragJoint(rig: Rig, joint: number, x: number, y: number, edit: RigEdit): RigEdit {
  const pts = rig.pts.map((p) => [...p] as V3);
  const swing = (list: number[], pivot: V3, turn: (p: V3) => V3, to: V3 = pivot) => {
    for (const i of list) pts[i] = plus(to, turn(minus(rig.pts[i], pivot)));
  };
  const limb = LIMBS[joint];
  if (limb) {
    const [root, mid] = limb;
    const solved = reachTwoBones(pts[root], pts[mid], pts[joint], [x, y, pts[joint][2]]);
    const end = subtree(joint);
    swing(subtree(mid).filter((i) => !end.includes(i)), pts[mid], turnFrom(minus(pts[mid], pts[root]), minus(solved.mid, pts[root])), solved.mid);
    swing(end, pts[joint], turnFrom(minus(pts[joint], pts[mid]), minus(solved.end, solved.mid)), solved.end);
  } else if (joint === MHR.hipL || joint === MHR.hipR) {
    const shift: V3 = [x - pts[joint][0], y - pts[joint][1], 0];
    for (const i of [...subtree(MHR.neck), MHR.hipL, MHR.hipR]) pts[i] = plus(rig.pts[i], shift);
    for (const [hip, knee, ankle] of [[MHR.hipL, MHR.kneeL, MHR.ankleL], [MHR.hipR, MHR.kneeR, MHR.ankleR]]) {
      if (!rig.seen[knee] || !rig.seen[ankle]) continue;
      // La cadera ya se movió: los largos se miden con el esqueleto de antes.
      const bones: [number, number] = [length3(minus(rig.pts[knee], rig.pts[hip])), length3(minus(rig.pts[ankle], rig.pts[knee]))];
      const solved = reachTwoBones(pts[hip], rig.pts[knee], rig.pts[ankle], rig.pts[ankle], bones);
      const stay = subtree(ankle);
      swing(subtree(knee).filter((i) => !stay.includes(i)), rig.pts[knee], turnFrom(minus(rig.pts[knee], rig.pts[hip]), minus(solved.mid, pts[hip])), solved.mid);
    }
  } else if (joint === MHR.neck) {
    const pivot = times(plus(pts[MHR.hipL], pts[MHR.hipR]), 0.5);
    swing(subtree(joint), pivot, turnFrom(minus(pts[joint], pivot), reachFor(pivot, pts[joint], x, y)));
  } else if (PARENT[joint] >= 0) {
    const pivot = pts[PARENT[joint]];
    swing(subtree(joint), pivot, turnFrom(minus(pts[joint], pivot), reachFor(pivot, pts[joint], x, y)));
  }
  const next: RigEdit = { ...edit };
  pts.forEach((p, i) => {
    const d = minus(p, rig.pts[i]);
    if (!d[0] && !d[1] && !d[2]) return;
    const old = next[i] ?? [0, 0, 0];
    next[i] = plus(old, d);
  });
  return next;
}
