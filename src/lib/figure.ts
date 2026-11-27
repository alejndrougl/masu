import { maskContours, polygonArea, simplifyLoop } from './edges';
import { POSE, catmullRom, distanceToEdge, maskSkeleton, maskSpine, poseLine, readGesture, type Gesture } from './gesture';
import { animalIsUsable, buildAnimal } from './animal';
import { MHR, type Body3D } from './body';
import { marksFromLenses, type FaceMarks } from './face';
import { onFigure, readFraming, relativeVis, shouldersBelowHead, type Framing } from './framing';
import { buildHand } from './hand';
import { buildHeadOnly, buildMannequin, type Block, type Mannequin } from './mannequin';
import { bodyOnly, headInMask, lensesByContrast, regionOf, type HeadRead } from './parts';
import { silhouetteMatch } from './pieces';
import { bodyRig, cocoFromRig, finishRig, moveJoints, type Rig, type RigEdit } from './rig';
import { fitProfile, fitsFromBlocks, type ShapeFit } from './shapes';
import { buildSurface, fitTrunk, PART, unseenParts, type BodySurface } from './surface';
import { boxFromVanishing, type Cuboid, type Direction } from './solid';
import { fitPrimitive, headTurn, linkCircles, massCircles, type Circle, type Primitive, type Turn } from './volumes';
import type { AnimalMarks, HandMarks, Pt, SubjectKind } from './types';

import { t as tx } from '../i18n';
export type BonePart = 'cabeza' | 'cuello' | 'tronco' | 'pelvis' | 'brazo' | 'pierna' | 'mano' | 'pie' | 'forma';

export interface Bone {
  a: Pt;
  b: Pt;
  /** Radios medidos en altos de encuadre. */
  ra: number;
  rb: number;
  part: BonePart;
}

export interface Canon {
  count: number;
  name: string;
  /** Miembros acortados por la perspectiva: la medida es de lo visible, no del cuerpo real. */
  foreshortened: boolean;
}

export interface Cylinder {
  a: Pt;
  b: Pt;
  ra: number;
  rb: number;
  /** Cuánto se abre la tapa: 0 de lado, 1 de frente. */
  open: number;
  /** Extremo más cerca de quien mira. */
  near: 'a' | 'b';
  part: BonePart;
}

/** Una medida de esta figura contra la de un cuerpo realista, en cabezas. */
export interface Measure {
  name: string;
  heads: number;
  canon: number;
}

export interface FigureModel {
  /** La superficie 3D real, si la red la dio: de ahí salen formas y planos. */
  surface?: BodySurface | null;
  /** La silueta completa: con ropa suelta y lo que lleva en las manos. */
  silhouette?: Pt[][];
  /** La figura que mejor calza en cada parte, y las demás en orden. */
  shapes?: ShapeFit[];
  id: string;
  label: string;
  source: 'esqueleto' | 'forma';
  /** Qué parte del sujeto hay en la imagen. */
  framing: Framing;
  /** Hacia dónde va cada dedo. */
  arrows: [Pt, Pt][];
  /** Proporciones medidas en esta figura: cada dibujo tiene las suyas. */
  measures: Measure[];
  /** Qué tienen de particular esas proporciones. */
  style: string | null;
  /** Silueta reducida a pocos trazos rectos. */
  angular: Pt[][];
  /** Caja en la perspectiva de la escena, si es un objeto de lados rectos. */
  cuboid: Cuboid | null;
  /** Marcas de cabezas junto a la figura. */
  ruler: { from: Pt; to: Pt; count: number } | null;
  /** Maniquí reconstruido en 3D, cuando hay esqueleto. */
  mannequin: Mannequin | null;
  /** Partes, para leer el encaje como bloques. */
  blocks: Block[];
  /** Volúmenes del paso 3. */
  cylinders: Cylinder[];
  /** Círculos del paso 2 cuando no hay esqueleto. */
  circles: Circle[];
  links: [number, number][];
  primitive: Primitive | null;
  /** Hacia dónde mira la cabeza. */
  turn: Turn | null;
  /** Grados que gira el pecho respecto a quien mira: 0 de frente, positivo a la derecha. */
  chest: number | null;
  action: Pt[];
  gesture: Gesture;
  sticks: [Pt, Pt][];
  joints: Pt[];
  bones: Bone[];
  head: { c: Pt; r: number } | null;
  /** Contorno limpio de la silueta, normalizado. */
  outline: Pt[][];
  shoulders?: [Pt, Pt];
  hips?: [Pt, Pt];
  canon?: Canon;
  /** Grados de inclinación de hombros y cadera, y si se oponen. */
  tilt?: { shoulders: number; hips: number; contrapposto: boolean; edgeOn?: boolean };
}

export interface FigureInput {
  id: string;
  label: string;
  pose?: { pts: Pt[]; vis: number[] };
  mask?: { data: Uint8Array; w: number; h: number };
  aspect: number;
  head?: Pt | null;
  /** Cercanía de un punto: 1 lo más cerca. */
  depth?: (p: Pt) => number;
  turn?: Turn | null;
  kind?: SubjectKind;
  /** Cuerpo 3D con sus puntos ya llevados al encuadre. */
  body?: { body: Body3D; screen: Float32Array } | null;
  edit?: RigEdit;
  /** Rasgos reales de su cara. */
  marks?: FaceMarks | null;
  /** Manos leídas de cerca que pertenecen a esta figura. */
  hands?: HandMarks[];
  /** La mano o el pie, si eso es lo que es esta figura. */
  hand?: HandMarks;
  animal?: AnimalMarks;
  /** Claridad de un punto de la imagen, 0 a 1. */
  luma?: (p: Pt) => number;
  /** Qué es cada píxel de la figura, a la resolución de la máscara. */
  parts?: Uint8Array;
  headRead?: HeadRead | null;
  /** Triángulos de la malla del cuerpo. */
  faces?: Int32Array | null;
  /** Fugas de la escena, para poner los objetos en su perspectiva. */
  scene?: { x: Direction; y: Direction; z: Direction; horizon: number | null } | null;
}

const dist = (a: Pt, b: Pt, aspect: number) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function median(v: number[]): number {
  const s = [...v].sort((p, q) => p - q);
  return s[s.length >> 1] ?? 0;
}

function canonOf(count: number): Canon {
  const rounded = Math.round(count * 2) / 2;
  const name =
    count < 4.2 ? tx('figure.chibi_infantil') : count < 5.8 ? tx('figure.caricatura_joven') : count < 6.8 ? tx('figure.compacto') : count < 7.9 ? tx('common.realista') : count < 8.8 ? tx('figure.heroico') : tx('figure.moda');
  return { count: rounded, name, foreshortened: false };
}

function poseIsUsable(input: FigureInput): boolean {
  const { pose, mask } = input;
  if (!pose) return false;
  const core = [POSE.shoulderL, POSE.shoulderR, POSE.hipL, POSE.hipR, POSE.nose];
  if (core.filter((i) => pose.vis[i] > 0.25).length < 4) return false;
  if (!mask) return true;
  const body = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter((i) => pose.vis[i] > 0.2);
  if (body.length < 6) return false;
  let hits = 0;
  for (const i of body) {
    const [x, y] = pose.pts[i];
    const px = Math.floor(x * mask.w);
    const py = Math.floor(y * mask.h);
    let found = false;
    for (let dy = -3; dy <= 3 && !found; dy++) {
      for (let dx = -3; dx <= 3 && !found; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < mask.w && qy < mask.h && mask.data[qy * mask.w + qx]) found = true;
      }
    }
    if (found) hits++;
  }
  // Un recorte puede quedarse corto; un esqueleto casi fuera de la figura ya es otra cosa.
  return hits / body.length >= 0.45;
}

function headFromPose(pts: Pt[], vis: number[], aspect: number): { c: Pt; r: number } | null {
  const faceIds = Array.from({ length: 68 }, (_, i) => POSE.face + i).filter((i) => vis[i] > 0.3);
  if (faceIds.length >= 24) {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const i of faceIds) {
      x0 = Math.min(x0, pts[i][0]);
      x1 = Math.max(x1, pts[i][0]);
      y0 = Math.min(y0, pts[i][1]);
      y1 = Math.max(y1, pts[i][1]);
    }
    const r = (Math.max((x1 - x0) * aspect, y1 - y0) / 2) * 1.2;
    return { c: [(x0 + x1) / 2, (y0 + y1) / 2 - r * 0.12], r };
  }
  const anchors = [POSE.nose, POSE.eyeL, POSE.eyeR, POSE.earL, POSE.earR].filter((i) => vis[i] > 0.3);
  if (!anchors.length) return null;
  const c = anchors.reduce<Pt>((acc, i) => [acc[0] + pts[i][0] / anchors.length, acc[1] + pts[i][1] / anchors.length], [0, 0]);
  const shoulders = vis[POSE.shoulderL] > 0.3 && vis[POSE.shoulderR] > 0.3 ? dist(pts[POSE.shoulderL], pts[POSE.shoulderR], aspect) : 0;
  const ears = vis[POSE.earL] > 0.3 && vis[POSE.earR] > 0.3 ? dist(pts[POSE.earL], pts[POSE.earR], aspect) : 0;
  const r = ears > 0 ? ears * 0.72 : shoulders * 0.34;
  return r > 0 ? { c, r } : null;
}

/**
 * Ajusta la cabeza a la silueta: lanza rayos hacia el lado contrario al cuello y
 * ajusta un círculo a los bordes que encuentra. Los puntos de la pose solo dan la pista.
 */
export function fitHead(mask: { data: Uint8Array; w: number; h: number }, guess: { c: Pt; r: number }, neck: Pt): { c: Pt; r: number } {
  const { data, w, h } = mask;
  const cx = guess.c[0] * w;
  const cy = guess.c[1] * h;
  const r0 = guess.r * h;
  const up = Math.atan2(cy - neck[1] * h, cx - neck[0] * w);
  const limit = r0 * 2.6;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 27; i++) {
    const a = up + ((i - 13) / 13) * ((Math.PI * 100) / 180);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = 0;
    while (t < limit) {
      const x = Math.round(cx + dx * t);
      const y = Math.round(cy + dy * t);
      if (x < 0 || y < 0 || x >= w || y >= h || !data[y * w + x]) break;
      t += 1;
    }
    if (t >= limit || t < 1) continue;
    xs.push(cx + dx * t);
    ys.push(cy + dy * t);
  }
  if (xs.length < 8) return guess;
  // Círculo por mínimos cuadrados (Kåsa).
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sz = 0;
  let sxz = 0;
  let syz = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sz += z;
    sxz += x * z;
    syz += y * z;
  }
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [-sxz, -syz, -sz];
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const d = A[i][i] || 1e-9;
    for (let c = i; c < 3; c++) A[i][c] /= d;
    b[i] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const px = -b[0] / 2;
  const py = -b[1] / 2;
  const radius = Math.sqrt(Math.max(0, px * px + py * py - b[2]));
  if (!Number.isFinite(radius) || radius < r0 * 0.6 || radius > r0 * 2.4) return guess;
  return { c: [px / w, py / h], r: radius / h };
}

/** Lo común a todo modelo: lo particular de cada tipo se agrega encima. */
const BLANK = { arrows: [] as [Pt, Pt][], measures: [] as Measure[], style: null, angular: [] as Pt[][], cuboid: null, ruler: null };

const REAL = { Torso: 2.35, Brazo: 2.6, Pierna: 3.55, Hombros: 1.75 } as const;

/** Lo que mide esta figura, solo con lo que se ve: un busto no tiene piernas que medir. */
function measuresOf(rig: Rig | null, pose: { pts: Pt[]; vis: number[] } | undefined, headH: number, mask?: FigureInput['mask']): Measure[] {
  if (!rig || !pose || headH <= 0) return [];
  const v = relativeVis(pose);
  const clear = (i: number) => v[i] > 0.5 && pose.pts[i][0] > 0 && pose.pts[i][0] < 1 && pose.pts[i][1] > 0 && pose.pts[i][1] < 1 && onFigure(mask, pose.pts[i]);
  const len = (a: number, b: number) => {
    const p = rig.pts[a];
    const q = rig.pts[b];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  const out: Measure[] = [];
  const push = (name: keyof typeof REAL, length: number) => {
    if (length > 0) out.push({ name, heads: Math.round((length / headH) * 10) / 10, canon: REAL[name] });
  };
  const arm = (s: number, e: number, w: number, cs: number, ce: number, cw: number) => (clear(cs) && clear(ce) && clear(cw) ? len(s, e) + len(e, w) : 0);
  const leg = (h: number, k: number, a: number, ch: number, ck: number, ca: number) => (clear(ch) && clear(ck) && clear(ca) ? len(h, k) + len(k, a) : 0);
  if (clear(POSE.shoulderL) && clear(POSE.shoulderR)) push('Hombros', len(MHR.shoulderL, MHR.shoulderR));
  if (clear(POSE.shoulderL) && clear(POSE.hipL)) push('Torso', len(MHR.neck, MHR.hipL));
  push('Brazo', Math.max(arm(MHR.shoulderL, MHR.elbowL, MHR.wristL, POSE.shoulderL, POSE.elbowL, POSE.wristL), arm(MHR.shoulderR, MHR.elbowR, MHR.wristR, POSE.shoulderR, POSE.elbowR, POSE.wristR)));
  push('Pierna', Math.max(leg(MHR.hipL, MHR.kneeL, MHR.ankleL, POSE.hipL, POSE.kneeL, POSE.ankleL), leg(MHR.hipR, MHR.kneeR, MHR.ankleR, POSE.hipR, POSE.kneeR, POSE.ankleR)));
  return out;
}

function styleOf(measures: Measure[], canon: Canon | undefined): string | null {
  const notes: string[] = [];
  const of = (name: string) => measures.find((m) => m.name === name);
  const word = (name: string, high: string, low: string) => {
    const m = of(name);
    if (!m) return;
    const r = m.heads / m.canon;
    if (r > 1.16) notes.push(high);
    else if (r < 0.84) notes.push(low);
  };
  if (canon && !canon.foreshortened && canon.count < 5.8) notes.push(tx('figure.cabeza_grande'));
  word('Pierna', tx('figure.piernas_largas'), tx('figure.piernas_cortas'));
  word('Brazo', tx('figure.brazos_largos'), tx('figure.brazos_cortos'));
  word('Hombros', tx('figure.hombros_anchos'), tx('figure.hombros_angostos'));
  if (!notes.length) return measures.length >= 2 ? tx('figure.cerca_de_lo_realista') : null;
  const text = notes.length === 1 ? notes[0] : `${notes.slice(0, -1).join(', ')}${tx('common.sep_y')}${notes[notes.length - 1]}`;
  return tx('figure.copia_estas_medidas_no', { v1: text[0].toUpperCase(), v2: text.slice(1) });
}

/**
 * Una mano leída de cerca vale más que una muñeca adivinada. Si una muñeca es dudosa o
 * cae fuera de la figura y hay una mano sin dueño, el brazo va hacia ella, porque esa
 * mano es lo único de ese brazo que de verdad se ve.
 */
function anchorHands(pose: FigureInput['pose'], hands: HandMarks[] | undefined, mask: FigureInput['mask']): FigureInput['pose'] {
  if (!pose || !hands?.length) return pose;
  const pts = [...pose.pts];
  const vis = [...pose.vis];
  const rel = relativeVis(pose);
  const firm = (i: number) => rel[i] > 0.55 && onFigure(mask, pts[i]);
  const dist2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const arms = [
    { shoulder: POSE.shoulderL, elbow: POSE.elbowL, wrist: POSE.wristL },
    { shoulder: POSE.shoulderR, elbow: POSE.elbowR, wrist: POSE.wristR },
  ];
  for (const hand of hands) {
    const at = hand.pts[0];
    if (arms.some((a) => firm(a.wrist) && dist2(pts[a.wrist], at) < 0.06)) continue;
    const free = arms.filter((a) => !firm(a.wrist) && rel[a.shoulder] > 0.4).sort((p, q) => dist2(pts[p.shoulder], at) - dist2(pts[q.shoulder], at))[0];
    if (!free) continue;
    pts[free.wrist] = at;
    vis[free.wrist] = 1;
    if (!firm(free.elbow)) {
      // Sin codo visible, el brazo va casi recto hacia su mano.
      pts[free.elbow] = lerp(pts[free.shoulder], at, 0.5);
      vis[free.elbow] = 0.7;
    }
  }
  return { pts, vis };
}

/**
 * Una cabeza cubierta se lee de la malla 3D, que sabe dónde está aunque el traje sea del color
 * de la piel y haya letras alrededor. Sin malla, queda la silueta acotada por la cara.
 */
function seenHead(input: FigureInput, surface: BodySurface | null): HeadRead | null | undefined {
  const { headRead, pose, mask, aspect, marks } = input;
  // El modelo de caras no entiende un dibujo y lo da por cubierto; si hay ojos, no lo está.
  if (headRead?.covered && (marks?.source === 'malla' || marks?.source === 'dibujo')) return { ...headRead, covered: false };
  if (!headRead?.covered) return headRead;
  const lensesIn = (seen: Pick<HeadRead, 'c' | 'rx' | 'ry'>) => {
    const bright = input.luma ? lensesByContrast(seen, input.luma) : [];
    return bright.length === 2 ? bright : headRead.lenses;
  };
  if (surface?.head) return { ...headRead, ...surface.head, outline: null, lenses: lensesIn(surface.head) };
  if (!pose || !mask) return headRead;
  const at = (i: number): Pt | null => (pose.vis[i] > 0.2 ? pose.pts[i] : null);
  const nose = at(POSE.nose);
  if (!nose) return headRead;
  const ears = [at(POSE.earL), at(POSE.earR)];
  const earSpan = ears[0] && ears[1] ? Math.hypot((ears[0][0] - ears[1][0]) * aspect, ears[0][1] - ears[1][1]) : 0;
  const face = pose.pts.slice(POSE.face, POSE.face + 17);
  const xs = face.map((p) => p[0] * aspect);
  const ys = face.map((p) => p[1]);
  const faceWide = Math.max(...xs) - Math.min(...xs);
  const chin = Math.max(...ys);
  const seen = headInMask(mask, nose, Math.max(earSpan * 1.5, faceWide * 1.25, 0.04), chin);
  return seen ? { ...headRead, ...seen, lenses: lensesIn(seen) } : headRead;
}

/** Qué cara usar: la malla y los ojos de un dibujo mandan; una máscara se lee por sus lentes. */
function faceFor(input: FigureInput): FaceMarks | null {
  const { marks, headRead } = input;
  if (!headRead?.covered || marks?.source === 'malla' || marks?.source === 'dibujo') return marks ?? null;
  return marksFromLenses(headRead.lenses, headRead.outline ?? [], input.aspect, headRead);
}

/** Lo que se decidió para cada cuerpo: se repite igual hasta que cambie la silueta. */
const settled = new WeakMap<object, { pull: number; shift: Record<number, [number, number, number]>; mask?: Uint8Array }>();

function fromPose(original: FigureInput): FigureModel | null {
  const { aspect, mask } = original;
  const anchored = anchorHands(original.pose, original.hands, original.mask);
  // Un cuerpo 3D que no coincide con la pose vista es peor que no tener ninguno.
  const trusted = original.body && (!anchored || original.body.body.agree >= 0.45) ? original.body : null;
  // Con malla no se corrige el tronco en 2D: comprimirlo aplastaría un cuerpo que ya está bien.
  const meshed = !!trusted && !!original.faces;
  const finished = (trunkPull: number) => (trusted ? finishRig(bodyRig(trusted.body, trusted.screen, { pose: anchored, aspect, trunkPull }, trusted.body.light), { pose: anchored, aspect, parts: meshed ? undefined : original.parts, w: mask?.w, h: mask?.h }) : null);
  // Sin capa ni escudo si el modelo de partes entiende la figura; un traje entero no lo entiende,
  // y entonces manda la silueta.
  const labeled = mask && original.parts ? bodyOnly(original.parts, mask.data) : null;
  const useful = !!labeled && !!mask && labeled.reduce((n, v) => n + v, 0) > mask.data.reduce((n, v) => n + (v ? 1 : 0), 0) * 0.6;
  const bodyMask = useful ? { data: labeled!, w: mask!.w, h: mask!.h } : mask;
  const moving = !!original.edit && Object.keys(original.edit).length > 0;
  const skip = [PART.cabeza, PART.manoL, PART.manoR];
  // Lo que la pose casi no vio no se afirma: un antebrazo sin muñeca puede estar detrás de algo.
  const rel = anchored ? relativeVis(anchored) : [];
  const unseen = anchored ? unseenParts(rel) : [];
  // La red 3D siempre entrega el cuerpo entero: un brazo escondido tras la espalda lo pone
  // levantado junto a la cara. Un codo o una muñeca que caen fuera de la figura no se afirman.
  const probe = trusted ? finished(0.3) : null;
  if (probe && mask) {
    // Sobre el pelo tampoco: el pelo es figura, pero un codo encima de la cabeza no es un brazo visto.
    const onHead = (x: number, y: number) => {
      const labels = original.parts;
      if (!labels || labels.length !== mask.w * mask.h) return false;
      const px = Math.floor(x * mask.w);
      const py = Math.floor(y * mask.h);
      if (px < 0 || py < 0 || px >= mask.w || py >= mask.h) return false;
      return regionOf(labels[py * mask.w + px]) === 'cabeza';
    };
    const off = (j: number) => {
      const x = probe.pts[j][0] / aspect;
      const y = probe.pts[j][1];
      return !onFigure(mask, [x, y], 0.01) || onHead(x, y);
    };
    // Solo se duda de lo que la pose 2D tampoco vio bien: un brazo que sí se ve se queda.
    const weak = (coco: number) => (rel[coco] ?? 0) < 0.55;
    const limbs: [number, number, number, number, number, number, number][] = [
      [MHR.elbowL, MHR.wristL, POSE.elbowL, POSE.wristL, PART.brazoL, PART.antebrazoL, PART.manoL],
      [MHR.elbowR, MHR.wristR, POSE.elbowR, POSE.wristR, PART.brazoR, PART.antebrazoR, PART.manoR],
    ];
    for (const [elbow, wrist, elbow2, wrist2, upper, fore, hand] of limbs) {
      if (weak(elbow2) && off(elbow)) unseen.push(upper, fore, hand);
      else if (weak(wrist2) && off(wrist)) unseen.push(fore, hand);
    }
  }
  const surfaceOf = (chosen: Rig | null, still = moving) => (chosen && trusted && original.faces ? buildSurface({ body: trusted.body, faces: original.faces, rig: chosen, aspect, mask: bodyMask, skip, moving: still, unseen }) : null);
  // La lectura se decide una vez: al mover una articulación se sigue con la que se eligió.
  let plan = trusted ? settled.get(trusted.body) : undefined;
  if (trusted && original.faces && (!plan || plan.mask !== mask?.data)) {
    let pull = 0.3;
    let base = finished(pull);
    let first = surfaceOf(base, false);
    // Si la malla se sale de la figura, se prueba con la pose mandando en el tronco. Una silueta
    // negra no tiene nada adentro que guíe a la red.
    if (first && first.inside < 0.86) {
      const other = finished(1);
      const second = surfaceOf(other, false);
      if (second && second.inside > first.inside) {
        pull = 1;
        base = other;
        first = second;
      }
    }
    const shift = base ? fitTrunk({ body: trusted.body, faces: original.faces, rig: base, aspect, mask: bodyMask, skip: [...skip, ...unseen] }) : {};
    plan = { pull, shift, mask: mask?.data };
    settled.set(trusted.body, plan);
  }
  const start = finished(plan?.pull ?? 0.3);
  const fitted = start && plan ? moveJoints(start, plan.shift) : start;
  const rig = fitted && original.edit ? moveJoints(fitted, original.edit) : fitted;
  if (import.meta.env?.DEV) (((globalThis as Record<string, unknown>).__rigDebug ??= {}) as Record<string, unknown>)[original.id] = { pull: plan?.pull, shift: plan?.shift, start, fitted, base0: finished(0.3), base1: finished(1), useful, bodyMask, mask, unseen };
  const surface = surfaceOf(rig);
  const read = seenHead({ ...original, pose: anchored }, surface);
  const input = { ...original, headRead: read, pose: anchored, marks: faceFor({ ...original, headRead: read }) };
  // El esqueleto 3D corrige la pose plana; todo lo demás lee esos mismos puntos.
  const { pts, vis: heard } = rig ? cocoFromRig(rig, input.pose, aspect) : input.pose!;
  // Lo que no se afirma en la forma tampoco va en el esqueleto: cada paso cuenta lo mismo.
  const vis = [...heard];
  if (surface) {
    const off: [number, number][] = [
      [PART.brazoL, POSE.elbowL], [PART.brazoR, POSE.elbowR], [PART.antebrazoL, POSE.wristL], [PART.antebrazoR, POSE.wristR],
      [PART.musloL, POSE.kneeL], [PART.musloR, POSE.kneeR], [PART.piernaL, POSE.ankleL], [PART.piernaR, POSE.ankleR],
      [PART.pelvis, POSE.hipL], [PART.pelvis, POSE.hipR],
    ];
    for (const [part, joint] of off) if (surface.absent.includes(part)) vis[joint] = 0;
  }
  // La línea de acción recorre todo el cuerpo aunque un tramo esté tapado.
  const raw = poseLine(pts, heard);
  if (!raw) return null;
  const seen = (i: number) => vis[i] > 0.3;
  const neck = mid(pts[POSE.shoulderL], pts[POSE.shoulderR]);
  const pelvis = mid(pts[POSE.hipL], pts[POSE.hipR]);
  const firstHead = headFromPose(pts, vis, aspect);
  const head = firstHead && mask ? fitHead(mask, firstHead, neck) : firstHead;
  const unit = head?.r ?? dist(neck, pelvis, aspect) * 0.22;

  const field = mask ? distanceToEdge(mask.data, mask.w, mask.h) : null;
  const radiusAt = (p: Pt) => {
    if (!field || !mask) return 0;
    const x = Math.floor(p[0] * mask.w);
    const y = Math.floor(p[1] * mask.h);
    if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return 0;
    return field[y * mask.w + x] / 3 / mask.h;
  };
  const along = (a: Pt, b: Pt, fallback: number) => {
    const r = median([0.25, 0.4, 0.5, 0.6, 0.75].map((t) => radiusAt(lerp(a, b, t))));
    return Math.min(unit * 0.95, Math.max(unit * 0.18, r || fallback));
  };

  const bones: Bone[] = [];
  const sticks: [Pt, Pt][] = [];
  const joints: Pt[] = [];
  const limb = (from: number, to: number, end: number | null, part: BonePart, fall: number) => {
    if (!seen(from) || !seen(to)) return;
    const a = pts[from];
    const b = pts[to];
    const ra = along(a, b, fall);
    bones.push({ a, b, ra, rb: ra * 0.82, part });
    sticks.push([a, b]);
    joints.push(a, b);
    if (end !== null && seen(end)) {
      const c = pts[end];
      const rc = along(b, c, fall * 0.8);
      bones.push({ a: b, b: c, ra: rc * 1.05, rb: rc * 0.72, part });
      sticks.push([b, c]);
      joints.push(c);
    }
  };
  limb(POSE.hipL, POSE.kneeL, POSE.ankleL, 'pierna', unit * 0.55);
  limb(POSE.hipR, POSE.kneeR, POSE.ankleR, 'pierna', unit * 0.55);
  limb(POSE.shoulderL, POSE.elbowL, POSE.wristL, 'brazo', unit * 0.38);
  limb(POSE.shoulderR, POSE.elbowR, POSE.wristR, 'brazo', unit * 0.38);

  for (const [ankle, toe] of [[POSE.ankleL, POSE.bigToeL], [POSE.ankleR, POSE.bigToeR]] as const) {
    if (seen(ankle) && seen(toe)) {
      bones.push({ a: pts[ankle], b: pts[toe], ra: unit * 0.22, rb: unit * 0.14, part: 'pie' });
      sticks.push([pts[ankle], pts[toe]]);
    }
  }
  for (const [wrist, base] of [[POSE.wristL, POSE.handL], [POSE.wristR, POSE.handR]] as const) {
    const fingers = [5, 9, 13, 17].map((f) => base + f).filter((i) => vis[i] > 0.3);
    if (seen(wrist) && fingers.length >= 2) {
      const c = fingers.reduce<Pt>((acc, i) => [acc[0] + pts[i][0] / fingers.length, acc[1] + pts[i][1] / fingers.length], [0, 0]);
      bones.push({ a: pts[wrist], b: c, ra: unit * 0.2, rb: unit * 0.26, part: 'mano' });
      sticks.push([pts[wrist], c]);
    }
  }

  // El tronco se mide en la silueta: la distancia entre hombros engaña si el cuerpo gira.
  const shoulderHalf = dist(pts[POSE.shoulderL], pts[POSE.shoulderR], aspect) / 2;
  const hipHalf = dist(pts[POSE.hipL], pts[POSE.hipR], aspect) / 2;
  const widthAt = (p: Pt, fallback: number) => {
    const r = radiusAt(p);
    return Math.min(unit * 1.25, r ? Math.min(r, fallback * 1.15) : fallback);
  };
  const upper = lerp(neck, pelvis, 0.2);
  const chest = lerp(neck, pelvis, 0.42);
  const waist = lerp(neck, pelvis, 0.72);
  bones.push({ a: upper, b: chest, ra: widthAt(upper, shoulderHalf * 0.85), rb: widthAt(chest, shoulderHalf * 0.8), part: 'tronco' });
  bones.push({ a: chest, b: waist, ra: widthAt(chest, shoulderHalf * 0.75), rb: widthAt(waist, hipHalf * 0.8), part: 'tronco' });
  const pelvisTop = lerp(neck, pelvis, 0.88);
  const pelvisLow = lerp(neck, pelvis, 1.06);
  bones.push({ a: pelvisTop, b: pelvisLow, ra: widthAt(pelvisTop, hipHalf * 0.85), rb: widthAt(pelvisLow, hipHalf * 0.9), part: 'pelvis' });
  // Sin caderas a la vista el tronco se queda en lo que se alcanza a ver.
  const noHips = surface?.absent.includes(PART.pelvis);
  sticks.push([pts[POSE.shoulderL], pts[POSE.shoulderR]]);
  if (noHips) sticks.push([neck, lerp(neck, pelvis, 0.5)]);
  else sticks.push([pts[POSE.hipL], pts[POSE.hipR]], [neck, pelvis]);
  if (head) {
    bones.push({ a: neck, b: lerp(neck, head.c, 0.55), ra: unit * 0.34, rb: unit * 0.3, part: 'cuello' });
    bones.push({ a: head.c, b: head.c, ra: head.r, rb: head.r, part: 'cabeza' });
    sticks.push([neck, head.c]);
  }
  joints.push(neck);
  if (!noHips) joints.push(pelvis);

  let canon: Canon | undefined;
  if (head) {
    const leg = (hip: number, knee: number, ankle: number) => (seen(knee) && seen(ankle) ? dist(pts[hip], pts[knee], aspect) + dist(pts[knee], pts[ankle], aspect) : 0);
    const legLength = Math.max(leg(POSE.hipL, POSE.kneeL, POSE.ankleL), leg(POSE.hipR, POSE.kneeR, POSE.ankleR));
    if (legLength > 0) {
      const headH = head.r * 2;
      const total = headH * 1.32 + dist(neck, pelvis, aspect) + legLength + headH * 0.2;
      canon = canonOf(total / headH);
      // De pie, torso y pierna rondan 2.5 y 4 cabezas: muy por debajo de eso hay escorzo.
      const torso = dist(neck, pelvis, aspect) / headH;
      const segs = [[POSE.hipL, POSE.kneeL], [POSE.kneeL, POSE.ankleL], [POSE.hipR, POSE.kneeR], [POSE.kneeR, POSE.ankleR]]
        .filter(([p, q]) => seen(p) && seen(q))
        .map(([p, q]) => dist(pts[p], pts[q], aspect));
      const uneven = segs.length >= 2 && Math.max(...segs) / Math.max(1e-6, Math.min(...segs)) > 1.7;
      canon.foreshortened = torso < 1.7 || legLength / headH < 2.6 || uneven;
    }
  }
  const turn = input.turn ?? headTurn(pts.slice(POSE.face, POSE.face + 68), vis.slice(POSE.face, POSE.face + 68), aspect);
  const angle = (l: Pt, r: Pt) => {
    const [a, b] = l[0] < r[0] ? [l, r] : [r, l];
    return (Math.atan2((b[1] - a[1]), (b[0] - a[0]) * aspect) * 180) / Math.PI;
  };
  const sa = angle(pts[POSE.shoulderL], pts[POSE.shoulderR]);
  const ha = angle(pts[POSE.hipL], pts[POSE.hipR]);
  const action = catmullRom(raw, 14);
  const build = (chosen: Rig | null) => buildMannequin({ pts: input.pose?.pts ?? pts, vis: input.pose?.vis ?? vis, aspect, mask, depth: input.depth, turn: input.turn, rig: chosen, edit: input.edit, marks: input.marks, handMarks: input.hands, luma: input.luma, parts: input.parts, headRead: input.headRead, surface: chosen ? surface : null });
  let mannequin = build(rig);
  // Dibujar y comparar: el cuerpo 3D solo se queda si calza con la silueta al menos tan
  // bien como la pose sola. Un paso posterior nunca empeora lo que ya estaba bien.
  // Con superficie no hay nada que comparar: la malla ya es la lectura buena.
  if (rig && mask && input.pose && !surface) {
    const plain = build(null);
    if (plain && (!mannequin || silhouetteMatch(plain.pieces, mask) > silhouetteMatch(mannequin.pieces, mask) + 0.02)) mannequin = plain;
  }
  const framing = input.pose ? readFraming(input.pose, mask) : 'completo';
  const headTall = head ? head.r * 2 : 0;
  const measures = measuresOf(mannequin?.rig ?? rig, input.pose, headTall, mask);
  const whole = framing === 'completo' && !!canon && !canon.foreshortened && !!head;
  const crown: Pt | null = head ? [head.c[0], head.c[1] - head.r] : null;
  const floor = whole ? [POSE.ankleL, POSE.ankleR].filter(seen).reduce<Pt>((acc, i) => (pts[i][1] > acc[1] ? pts[i] : acc), [0, 0]) : null;
  return {
    ...BLANK,
    surface,
    shapes: surface ? surface.profiles.map(fitProfile) : fitsFromBlocks(mannequin?.blocks ?? [], mask, aspect),
    framing,
    measures,
    style: styleOf(measures, framing === 'completo' ? canon : undefined),
    ruler: whole && crown && floor ? { from: crown, to: [crown[0], floor[1]], count: Math.max(1, Math.round((floor[1] - crown[1]) / headTall)) } : null,
    id: input.id,
    label: input.label,
    source: 'esqueleto',
    mannequin,
    blocks: mannequin?.blocks ?? [],
    action,
    gesture: readGesture(action, aspect),
    sticks,
    joints,
    bones,
    head,
    outline: [],
    silhouette: mask ? maskContours(mask.data, mask.w, mask.h).sort((p, q) => q.length - p.length).slice(0, 3).map((l) => l.map(([x, y]): Pt => [x / mask.w, y / mask.h])) : [],
    cylinders: cylindersFor(bones, head, aspect, input.depth),
    circles: [],
    links: [],
    primitive: null,
    turn,
    chest: mannequin ? mannequin.chest : chestTurn(pts, vis, aspect, head, input.depth),
    shoulders: [pts[POSE.shoulderL], pts[POSE.shoulderR]],
    hips: [pts[POSE.hipL], pts[POSE.hipR]],
    canon: framing === 'completo' ? canon : undefined,
    // Pasado 60° la línea ya no es una inclinación: de perfil un hombro queda detrás del otro.
    tilt: { shoulders: sa, hips: ha, contrapposto: Math.abs(sa) > 3 && Math.abs(ha) > 3 && Math.abs(sa) < 60 && Math.abs(ha) < 60 && Math.sign(sa) !== Math.sign(ha), edgeOn: Math.abs(sa) >= 60 || Math.abs(ha) >= 60 },
  };
}

/** Una mano o un pie por sí solos: no hay cuerpo que construir, y nada se le inventa. */
function fromHand(input: FigureInput): FigureModel | null {
  if (!input.hand) return null;
  const foot = input.kind === 'foot';
  const built = buildHand({ marks: input.hand, aspect: input.aspect, mask: input.mask, id: input.id, foot });
  return {
    ...BLANK,
    id: input.id,
    label: input.label,
    source: 'esqueleto',
    framing: foot ? 'pie' : 'mano',
    arrows: built.arrows,
    mannequin: built.mannequin,
    blocks: built.mannequin.blocks,
    cylinders: [],
    circles: [],
    links: [],
    primitive: null,
    turn: null,
    chest: null,
    action: built.action,
    gesture: readGesture(built.action, input.aspect),
    sticks: built.sticks,
    joints: built.joints,
    bones: [],
    head: null,
    outline: [],
  };
}

function fromAnimal(input: FigureInput): FigureModel | null {
  if (!input.animal) return null;
  const built = buildAnimal({ marks: input.animal, aspect: input.aspect, mask: input.mask, depth: input.depth, label: input.label });
  return {
    ...BLANK,
    id: input.id,
    label: input.label,
    source: 'esqueleto',
    framing: 'animal',
    mannequin: built.mannequin,
    shapes: fitsFromBlocks(built.mannequin.blocks, input.mask, input.aspect),
    blocks: built.mannequin.blocks,
    cylinders: [],
    circles: [],
    links: [],
    primitive: null,
    turn: input.turn ?? null,
    chest: null,
    action: built.action,
    gesture: readGesture(built.action, input.aspect),
    sticks: built.sticks,
    joints: built.joints,
    bones: [],
    head: null,
    outline: [],
    measures: [{ name: tx('figure.largo'), heads: Math.round(built.length * 10) / 10, canon: built.length }],
  };
}

/** Solo una cabeza: toda la construcción sale de su cara. */
function fromHead(input: FigureInput): FigureModel | null {
  if (!input.marks) return null;
  const mannequin = buildHeadOnly(input.marks, input.aspect, input.turn, input.luma);
  if (!mannequin?.head) return null;
  const { head } = mannequin;
  const action = catmullRom([[head.c[0], head.c[1] - head.r], ...mannequin.spine], 10);
  return {
    ...BLANK,
    id: input.id,
    label: input.label,
    source: 'esqueleto',
    framing: 'cabeza',
    mannequin,
    blocks: mannequin.blocks,
    cylinders: [],
    circles: [],
    links: [],
    primitive: null,
    turn: input.turn ?? null,
    chest: null,
    action,
    gesture: readGesture(action, input.aspect),
    sticks: [[head.c, head.chin]],
    joints: [head.c, head.chin],
    bones: [],
    head: { c: head.c, r: head.r },
    outline: [],
  };
}

/** Largo que tendría cada hueso sin escorzo, en altos de cabeza. */
const BONE_HEADS: Partial<Record<BonePart, number>> = { brazo: 1.45, pierna: 1.95, tronco: 1.15, pelvis: 0.6 };

function cylindersFor(bones: Bone[], head: { r: number } | null, aspect: number, depth?: (p: Pt) => number): Cylinder[] {
  const headH = (head?.r ?? 0.05) * 2;
  const length = (b: Bone) => dist(b.a, b.b, aspect);
  const longest = new Map<BonePart, number>();
  for (const b of bones) longest.set(b.part, Math.max(longest.get(b.part) ?? 0, length(b)));
  return bones
    .filter((b) => b.part !== 'cabeza')
    .map((b) => {
      const expected = Math.max((BONE_HEADS[b.part] ?? 0) * headH, longest.get(b.part) ?? 0, 1e-6);
      const ratio = Math.min(1, length(b) / expected);
      const open = Math.max(0.16, Math.sqrt(1 - ratio * ratio));
      const near: 'a' | 'b' = depth && depth(b.a) > depth(b.b) ? 'a' : 'b';
      return { a: b.a, b: b.b, ra: b.ra, rb: b.rb, open, near, part: b.part };
    });
}

/** Giro del pecho: el ancho de hombros se acorta al girar, y la profundidad da el sentido. */
function chestTurn(pts: Pt[], vis: number[], aspect: number, head: { r: number } | null, depth?: (p: Pt) => number): number | null {
  if (!head || vis[POSE.shoulderL] < 0.3 || vis[POSE.shoulderR] < 0.3) return null;
  const left = pts[POSE.shoulderL];
  const right = pts[POSE.shoulderR];
  const width = dist(left, right, aspect);
  const full = head.r * 2 * 2.1;
  const amount = (Math.acos(Math.min(1, width / full)) * 180) / Math.PI;
  // El hombro izquierdo de la figura a la derecha de la imagen: está de frente.
  const facing = left[0] > right[0];
  const [screenL, screenR] = left[0] < right[0] ? [left, right] : [right, left];
  let sign = 0;
  if (depth) sign = depth(screenL) > depth(screenR) + 0.015 ? 1 : depth(screenR) > depth(screenL) + 0.015 ? -1 : 0;
  if (!sign) sign = pts[POSE.nose][0] >= (left[0] + right[0]) / 2 ? 1 : -1;
  if (!facing) sign = -sign;
  return Math.round(amount) * sign;
}

function fromMask(input: FigureInput): FigureModel | null {
  const { mask, aspect } = input;
  if (!mask) return null;
  const spine = maskSpine(mask.data, mask.w, mask.h, input.head);
  if (!spine) return null;
  const sk = maskSkeleton(mask.data, mask.w, mask.h, input.head);
  if (!sk) return null;
  const action = catmullRom(spine.line, 10);
  const radius = (p: Pt) => {
    const x = Math.min(mask.w - 1, Math.max(0, Math.floor(p[0] * mask.w)));
    const y = Math.min(mask.h - 1, Math.max(0, Math.floor(p[1] * mask.h)));
    return sk.distance[y * mask.w + x] / 3 / mask.h;
  };
  let head: FigureModel['head'] = null;
  const bones: Bone[] = [];
  if (input.head) {
    const r = Math.max(radius(input.head), 0.012);
    head = { c: input.head, r };
    bones.push({ a: input.head, b: input.head, ra: r, rb: r, part: 'cabeza' });
  }
  // Las grandes masas van como círculos; lo delgado no cabe en uno y va como línea.
  const mass = massCircles(mask.data, mask.w, mask.h);
  const largest = mass[0]?.r ?? 0;
  const circles = mass
    .filter((c) => c.r >= largest * 0.33)
    .filter((c) => !head || Math.hypot((c.c[0] - head.c[0]) * aspect, c.c[1] - head.c[1]) > head.r * 1.05)
    .slice(0, 6);
  const links = linkCircles(circles, aspect);
  const covers = (p: Pt) =>
    circles.some((c) => Math.hypot((p[0] - c.c[0]) * aspect, p[1] - c.c[1]) < c.r * 0.92) ||
    (!!head && Math.hypot((p[0] - head.c[0]) * aspect, p[1] - head.c[1]) < head.r * 0.92);
  const sticks: [Pt, Pt][] = [];
  const joints: Pt[] = [];
  const limbs: Pt[][] = [];
  for (const path of sk.paths) {
    let run: Pt[] = [];
    for (const p of path) {
      if (covers(p)) {
        if (run.length >= 2) limbs.push(run);
        run = [p];
      } else {
        run.push(p);
      }
    }
    if (run.length >= 2) limbs.push(run);
  }
  const blocks: Block[] = [];
  if (head) blocks.push({ id: 'cabeza', name: tx('common.cabeza'), order: 1, a: head.c, b: head.c, ra: head.r, rb: head.r });
  circles.forEach((c, i) => blocks.push({ id: `masa${i}`, name: tx('figure.masa'), order: 2 + i, a: c.c, b: c.c, ra: c.r, rb: c.r }));
  const limbCylinders: Cylinder[] = [];
  const nearOf = (a: Pt, b: Pt): 'a' | 'b' => (input.depth && input.depth(a) > input.depth(b) ? 'a' : 'b');
  limbs.forEach((limb, index) => {
    for (let i = 0; i < limb.length - 1; i += 2) {
      const a = limb[i];
      const b = limb[Math.min(limb.length - 1, i + 2)];
      if (Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]) < 0.006) continue;
      sticks.push([a, b]);
      joints.push(a, b);
      const ra = Math.max(0.004, radius(a) * 0.9);
      const rb = Math.max(0.004, radius(b) * 0.9);
      bones.push({ a, b, ra, rb, part: 'forma' });
      limbCylinders.push({ a, b, ra, rb, open: 0.28, near: nearOf(a, b), part: 'forma' });
      blocks.push({ id: `rama${index}`, name: tx('figure.extremidad'), order: 20 + index, a, b, ra: Math.max(ra, 0.012), rb: Math.max(rb, 0.012) });
    }
  });
  const isObject = input.kind === 'object' || !input.kind;
  const primitive = isObject ? fitPrimitive(mask.data, mask.w, mask.h, input.label) : null;
  let cuboid: Cuboid | null = null;
  if (primitive?.kind === 'caja' && input.scene) {
    const edge = maskContours(mask.data, mask.w, mask.h).sort((a, b) => b.length - a.length)[0] ?? [];
    const step = Math.max(1, Math.floor(edge.length / 200));
    const outline = edge.filter((_, i) => i % step === 0).map(([x, y]): Pt => [(x / mask.w) * aspect, y / mask.h]);
    const box = boxFromVanishing(outline, input.scene.x, input.scene.y, input.scene.z, input.scene.horizon);
    cuboid = box && box.fit > 0.45 ? box : null;
  }
  const cylinders: Cylinder[] = [
    ...limbCylinders,
    ...links.map(([p, q]): Cylinder => {
      const [a, b] = [circles[p], circles[q]];
      return { a: a.c, b: b.c, ra: a.r * 0.82, rb: b.r * 0.82, open: 0.3, near: nearOf(a.c, b.c), part: 'forma' };
    }),
  ];
  return {
    ...BLANK,
    cuboid,
    framing: isObject ? 'objeto' : input.kind === 'animal' ? 'animal' : 'forma',
    id: input.id,
    label: input.label,
    source: 'forma',
    mannequin: null,
    blocks,
    action,
    gesture: readGesture(action, aspect),
    sticks,
    joints,
    bones,
    head,
    outline: [],
    cylinders,
    circles,
    links,
    primitive,
    turn: input.turn ?? null,
    chest: null,
  };
}

function outlineOf(mask: FigureInput['mask']): Pt[][] {
  if (!mask) return [];
  const area = mask.w * mask.h;
  const eps = Math.hypot(mask.w, mask.h) * 0.0035;
  return maskContours(mask.data, mask.w, mask.h)
    .filter((l) => polygonArea(l) > area * 0.0008)
    .map((l) => smoothLoop(simplifyLoop(l, eps)).map(([x, y]): Pt => [x / mask.w, y / mask.h]));
}

/** La misma silueta en pocas rectas: es como se encaja antes de dibujar la curva. */
function angularOf(mask: FigureInput['mask']): Pt[][] {
  if (!mask) return [];
  const area = mask.w * mask.h;
  const eps = Math.hypot(mask.w, mask.h) * 0.016;
  return maskContours(mask.data, mask.w, mask.h)
    .filter((l) => polygonArea(l) > area * 0.002)
    .map((l) => simplifyLoop(l, eps).map(([x, y]): Pt => [x / mask.w, y / mask.h]));
}

/** Chaikin: redondea las esquinas de un contorno para que parezca trazado a mano. */
function smoothLoop(loop: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

/** Modelo de construcción: del esqueleto si es confiable, si no de su silueta. */
export function buildFigure(input: FigureInput): FigureModel | null {
  const person = input.kind === 'person' || input.kind === 'anime-person' || !input.kind;
  const lone = input.kind === 'human-face' || input.kind === 'anime-face' || input.kind === 'head';
  let model: FigureModel | null = null;
  if (input.kind === 'hand' || input.kind === 'foot') model = fromHand(input);
  else if (input.kind === 'animal' && animalIsUsable(input.animal, input.label)) model = fromAnimal(input);
  else if (lone) model = fromHead(input);
  else if (person && input.pose && input.marks) {
    // Con la cara bien leída y un cuerpo que no se sostiene, se construye lo que sí se ve.
    const shoulders = Math.max(input.pose.vis[POSE.shoulderL], input.pose.vis[POSE.shoulderR]);
    const onlyHead = readFraming(input.pose, input.mask) === 'cabeza' || shoulders < 0.22 || !shouldersBelowHead(input.pose, input.marks.chin, input.marks.glabella, input.aspect);
    if (onlyHead) model = fromHead(input);
  }
  if (!model && person && (input.body || poseIsUsable(input))) model = fromPose(input);
  model ??= fromMask(input);
  if (model) {
    model.outline = outlineOf(input.mask);
    model.angular = angularOf(input.mask);
  }
  return model;
}

/** Cápsula entre dos círculos: la forma básica de un maniquí. En píxeles. */
export function capsulePath(a: Pt, b: Pt, ra: number, rb: number): string {
  const f = (v: number) => v.toFixed(1);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1e-3 || d <= Math.abs(ra - rb)) {
    const r = Math.max(ra, rb);
    return `M${f(a[0] - r)} ${f(a[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  const base = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const off = Math.acos((ra - rb) / d);
  const p = (c: Pt, r: number, t: number) => `${f(c[0] + r * Math.cos(t))} ${f(c[1] + r * Math.sin(t))}`;
  return `M${p(a, ra, base + off)}L${p(b, rb, base + off)}A${f(rb)} ${f(rb)} 0 ${rb > ra ? 1 : 0} 0 ${p(b, rb, base - off)}L${p(a, ra, base - off)}A${f(ra)} ${f(ra)} 0 ${ra > rb ? 1 : 0} 0 ${p(a, ra, base + off)}Z`;
}
