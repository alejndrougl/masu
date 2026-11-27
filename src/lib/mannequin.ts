import { convexHull } from './composition';
import { COCO_TO_MHR, HAND_L, HAND_R, MHR, type Light } from './body';
import { eyeCenters, FACE_PLANES, featuresOf, fitDrawn, warpTo, type FaceMarks } from './face';
import type { Feature } from './features';
import { onFigure, relativeVis } from './framing';
import { ellipsoidFacets, kneeCap, organicLimb, pelvisMarks, trunkMarks, type LimbKind } from './forms';
import { headMethods, type HeadMethod } from './heads';
import { bodyOnly, findWaist, regionCenter, type HeadRead } from './parts';
import { POSE, catmullRom } from './gesture';
import { buildHand } from './hand';
import {
  add,
  ballPiece,
  clamp,
  cross,
  dot,
  ellipseRing,
  ellipsoidLines,
  ellipsoidOutline,
  limbPiece,
  measuredRadius,
  mix,
  mul,
  size,
  smoothClosed,
  sub,
  TAU,
  unit,
  visibleRuns,
  type Frame,
  type Mask,
  type Piece,
} from './pieces';
import { finishRig, poseRig, type Rig, type RigEdit } from './rig';
import { PART, type BodySurface } from './surface';
import type { HandMarks, Pt } from './types';
import { fitOrtho, turnOf, type OrthoFit, type Turn, type V3 } from './volumes';

import { t as tx } from '../i18n';
export type { Piece } from './pieces';

/** Cabeza por el método Loomis, cada etapa sobre la anterior. */
export interface HeadGuide {
  ball: Pt[];
  outline: Pt[];
  /** Eje central y línea de cejas. */
  axes: Pt[][];
  /** Plano lateral de la bola. */
  side: Pt[][];
  /** Mentón y quijada. */
  jaw: Pt[][];
  /** Trazos abiertos de los rasgos: cejas, nariz y oreja. */
  features: Pt[][];
  /** Línea de cejas, sobre el ecuador de la bola. */
  brow: Pt[][];
  /** Líneas de ojos, base de la nariz y boca: dan la vuelta a la forma. */
  guides: Pt[][];
  /** Formas cerradas de los rasgos: ojos, boca. */
  loops: Pt[][];
  /** Planos del rostro, con su valor leído de la imagen: 0 oscuro, 1 claro. */
  facets: { poly: Pt[]; tone: number }[];
  /** Pupilas, si se conocen. */
  irises: Pt[];
  /** De dónde salen los rasgos: sin valor son los de un rostro genérico. */
  source: FaceMarks['source'] | null;
  /** Ojos, nariz y boca para verlos de cerca, cada uno con su construcción. */
  details: Feature[];
  /** Maneras de construir esta cabeza: Loomis, anime, Reilly, Asaro y proporciones. */
  methods: HeadMethod[];
  /** Hacia dónde apunta la nariz, desde la cara. */
  gaze: [Pt, Pt] | null;
  c: Pt;
  r: number;
  chin: Pt;
}

export interface HandGuide {
  id: string;
  /** Lado en la imagen. */
  side: 'izquierda' | 'derecha';
  /** Hay dedos: vistos, o propuestos por el modelo 3D. */
  fingers: boolean;
  /** Los dedos no se ven: los propone el modelo. */
  estimated: boolean;
  box: { x: number; y: number; w: number; h: number };
}

export interface Mannequin {
  pieces: Piece[];
  spine: Pt[];
  /** Ejes de hombros y cadera: se inclinan en sentidos opuestos. */
  tilts: [Pt, Pt][];
  head: HeadGuide | null;
  hands: HandGuide[];
  /** Pasos en orden de trazo, sin repetir. */
  order: { step: number; name: string; note: string }[];
  /** Alto de una cabeza en altos de encuadre. */
  headHeight: number;
  /** Giro del pecho respecto a quien mira, en grados: positivo a la derecha. */
  chest: number;
  /** Partes del cuerpo, para repartir la silueta en bloques. */
  blocks: Block[];
  /** Sin esqueleto humano en manos, animales y cabezas sueltas. */
  rig: Rig | null;
  /** De dónde viene la luz, si se pudo leer sobre el cuerpo. */
  light: Light | null;
  /** La pieza más cercana a quien mira. */
  nearest: string | null;
}

/** Eje y radios de una parte: decide a cuál pertenece cada punto de la silueta. */
export interface Block {
  id: string;
  name: string;
  order: number;
  a: Pt;
  b: Pt;
  ra: number;
  rb: number;
}

export interface MannequinInput {
  pts: Pt[];
  vis: number[];
  aspect: number;
  mask?: Mask;
  /** Cercanía de un punto: 1 lo más cerca. */
  depth?: (p: Pt) => number;
  /** Giro ya conocido por la malla facial, si la hubo. */
  turn?: Turn | null;
  /** Esqueleto ya resuelto; sin él se levanta la pose plana. */
  rig?: Rig | null;
  edit?: RigEdit;
  /** Rasgos reales de la cara. */
  marks?: FaceMarks | null;
  /** Manos ya leídas de cerca: sus dedos valen más que los de la pose. */
  handMarks?: HandMarks[];
  /** Claridad de un punto, 0 a 1. */
  luma?: (p: Pt) => number;
  /** Qué es cada píxel, a la resolución de la máscara. */
  parts?: Uint8Array;
  /** Lo que se leyó de su cabeza: forma real y si la cara está cubierta. */
  headRead?: HeadRead | null;
  /** Con superficie, tórax, pelvis y miembros miden lo que mide el cuerpo real. */
  surface?: BodySurface | null;
}

/** Largos de un cuerpo realista, en cabezas. Un personaje caricaturizado los escala. */
const CANON = { upperArm: 1.45, foreArm: 1.15, thigh: 1.85, shin: 1.7, torso: 2.35, shoulders: 1.75, hips: 0.95, hand: 0.72 } as const;
/** Radios de cada segmento, en cabezas. */
const RADII = {
  upperArm: [0.27, 0.21],
  foreArm: [0.22, 0.14],
  thigh: [0.42, 0.27],
  shin: [0.28, 0.15],
  neck: [0.24, 0.27],
} as const;

/** Rostro en las mismas unidades que `FACE_MODEL`: y abajo, z hacia quien mira, origen en la nariz. */
const SKULL: { c: V3; r: number } = { c: [0, -250, -520], r: 430 };
/** Alto de la cabeza, de la coronilla al mentón, en unidades de `FACE_MODEL`. */
const HEAD_UNITS = 1010;
const SIDE_X = SKULL.r * 0.74;
const SIDE_R = Math.sqrt(SKULL.r ** 2 - SIDE_X ** 2);

/** Cabeza por encima de los puntos de la cara: mide la escala real sin importar el giro. */
function headFit(pts: Pt[], vis: number[], aspect: number, turn?: Turn | null) {
  const fit = fitOrtho(pts, vis, aspect);
  if (!fit) return null;
  const given = turn ?? turnOf(fit);
  return { ...fit, turn: given };
}

/** Mueve el ajuste para que el cráneo coincida con la cabeza que se ve. */
function alignToOutline<T extends OrthoFit>(fit: T, read: HeadRead, aspect: number): T {
  // Una capucha es más angosta que un cráneo, pero no más corta: cuentan ancho y alto.
  const s = Math.sqrt(((read.rx * aspect) / (SKULL.r * 1.04)) * ((read.ry * 2) / HEAD_UNITS));
  const top = read.c[1] - read.ry;
  const cx = read.c[0] * aspect;
  const cy = top + SKULL.r * s;
  const here: V3 = [dot(fit.a, SKULL.c) * s, dot(fit.b, SKULL.c) * s, 0];
  return { ...fit, s, t: [cx - here[0], cy - here[1]] };
}

function buildHead(given: OrthoFit & { turn: Turn }, aspect: number, zShift: number, marks?: FaceMarks | null, luma?: (p: Pt) => number, read?: HeadRead | null): { guide: HeadGuide; world: (p: V3) => V3; piece: Piece; base: V3 } {
  // Una cara cubierta no da rasgos, pero su contorno sí da el tamaño y el lugar de la cabeza.
  const { a, b, c, s, t } = given;
  const world = (p: V3): V3 => [t[0] + s * dot(a, p), t[1] + s * dot(b, p), s * dot(c, p) + zShift];
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const model = (p: V3): Pt => {
    const w = world(p);
    return [w[0], w[1]];
  };
  const facing = (n: V3) => dot(c, n) >= -0.02;
  // Las guías nacen del modelo y se corrigen para pasar por los rasgos que sí se ven.
  const anchors: { from: Pt; to: Pt }[] = [];
  // Una máscara no tiene puntos que seguir: las guías quedan como el modelo las proyecta.
  if (marks && !read?.covered) {
    const real = (p: Pt): Pt => [p[0] * aspect, p[1]];
    const [eyeA, eyeB] = eyeCenters(marks).map(real);
    const flip = a[0] < 0 ? -1 : 1;
    const pairs: [V3, Pt][] = [
      [[-150 * flip, -170, -135], eyeA],
      [[150 * flip, -170, -135], eyeB],
      [[0, -180, -110], real(marks.glabella)],
      [[0, 8, 0], real(marks.noseTip)],
      [[0, 150, -105], real(marks.mouth)],
      [[0, 345, -70], real(marks.chin)],
      [[-300 * flip, 175, -430], real(marks.jawL)],
      [[300 * flip, 175, -430], real(marks.jawR)],
    ];
    for (const [from, to] of pairs) anchors.push({ from: model(from), to });
  }
  const warp = anchors.length ? warpTo(anchors, SKULL.r * s) : null;
  const at = (p: V3): Pt => {
    const w = world(p);
    const moved = warp ? warp([w[0], w[1]]) : ([w[0], w[1]] as Pt);
    return [moved[0] / aspect, moved[1]];
  };

  // La bola: su contorno es un círculo sin importar el giro.
  const center = world(SKULL.c);
  const R = SKULL.r * s;
  const ball: Pt[] = [];
  for (let i = 0; i < 64; i++) {
    const q = (i / 64) * TAU;
    ball.push([(center[0] + R * Math.cos(q)) / aspect, center[1] + R * Math.sin(q)]);
  }

  const jawAngle: V3[] = [[-300, 175, -430], [300, 175, -430]];
  const chinSide: V3[] = [[-105, 325, -95], [105, 325, -95]];
  const chin: V3 = [0, 345, -70];
  const solid = convexHull([
    ...ball.map(([x, y]): Pt => [x * aspect, y]),
    ...[...jawAngle, ...chinSide, chin].map((p) => {
      const q = at(p);
      return [q[0] * aspect, q[1]] as Pt;
    }),
  ]);
  const outline = smoothClosed(solid.map(([x, y]): Pt => [x / aspect, y]), 2);

  const onSphere = (p: V3) => sub(p, SKULL.c);
  const brow = ellipseRing([0, -250, SKULL.c[2]], [1, 0, 0], [0, 0, 1], SKULL.r, SKULL.r, 72);
  const meridian: V3[] = [];
  for (let i = 0; i <= 48; i++) {
    const q = -Math.PI * 0.58 + (i / 48) * Math.PI * 1.08;
    meridian.push([0, SKULL.c[1] + SKULL.r * Math.sin(q), SKULL.c[2] + SKULL.r * Math.cos(q)]);
  }
  const meridianRuns = visibleRuns(meridian, (p) => facing(onSphere(p)), at);
  // Del ecuador de la bola el eje baja por el plano de la cara hasta el mentón.
  const faceAxis: V3[] = [];
  for (const y of [-120, 40, 150, 250, 345]) faceAxis.push([0, y, y < 200 ? -92 + y * 0.03 : -86]);

  const faceSurface = (x: number, y: number): V3 => {
    const front = y < -100 ? -95 : y < 100 ? -85 : y < 250 ? -105 : -95;
    return [x, y, front - (x * x) / 640];
  };
  const faceRule = (y: number, half: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i <= 20; i++) out.push(faceSurface(-half + (i / 20) * half * 2, y));
    return out;
  };
  const showRule = (y: number, half: number) => visibleRuns(faceRule(y, half), (p) => facing([p[0] / 320, 0, 1]), at);

  const sideSign = c[0] >= 0 ? -1 : 1;
  const side: Pt[][] = [];
  for (const sign of [sideSign, -sideSign]) {
    const n: V3 = [sign, 0, 0];
    if (dot(c, n) < 0.05) continue;
    const circle = ellipseRing([sign * SIDE_X, SKULL.c[1], SKULL.c[2]], [0, 1, 0], [0, 0, 1], SIDE_R, SIDE_R, 56);
    side.push(circle.map(at));
    // Cruz del plano lateral: la vertical cae sobre la oreja, la horizontal es la ceja.
    side.push([[sign * SIDE_X, SKULL.c[1] - SIDE_R, SKULL.c[2]], [sign * SIDE_X, SKULL.c[1] + SIDE_R, SKULL.c[2]]].map((p) => at(p as V3)));
    side.push([[sign * SIDE_X, SKULL.c[1], SKULL.c[2] - SIDE_R], [sign * SIDE_X, SKULL.c[1], SKULL.c[2] + SIDE_R]].map((p) => at(p as V3)));
  }

  const jaw: Pt[][] = [];
  for (const sign of [-1, 1]) {
    const ear: V3 = [sign * SIDE_X, SKULL.c[1] + SIDE_R * 0.55, SKULL.c[2]];
    const angle: V3 = [sign * 300, 175, -430];
    const corner: V3 = [sign * 105, 325, -95];
    const n: V3 = [sign, 0.1, 0.35];
    if (dot(c, n) > -0.25) jaw.push([ear, angle, corner, chin].map(at));
  }
  jaw.push(...showRule(345, 105));

  const guides = [...showRule(-170, 260), ...showRule(45, 150), ...showRule(150, 190)];
  const features: Pt[][] = [];
  const loops: Pt[][] = [];
  const irises: Pt[] = [];
  if (marks) {
    // Los rasgos son los de esta cara, no los de un rostro promedio.
    loops.push(...[marks.eyeL, marks.eyeR, marks.lips].filter((l) => l.length > 1));
    if (marks.lipsInner) loops.push(marks.lipsInner);
    features.push(...[marks.browL, marks.browR, marks.bridge, marks.noseBase].filter((l) => l.length > 1));
    if (marks.irisL) irises.push(marks.irisL);
    if (marks.irisR) irises.push(marks.irisR);
  }
  for (const sign of [-1, 1]) {
    if (dot(c, [sign, 0, 0]) < 0.2) continue;
    const ear = ellipseRing([sign * (SIDE_X + 8), -120, SKULL.c[2] - 36], [0, 1, 0], [0, 0, 1], 118, 62, 30);
    features.push(ear.map(at));
  }

  // La dirección de la cabeza va afuera de la bola: encima de la cara solo estorba.
  const lean = Math.hypot(c[0], c[1]);
  const pointing = (reach: number): Pt => [(center[0] + (c[0] / (lean || 1)) * R * reach) / aspect, center[1] + (c[1] / (lean || 1)) * R * reach];
  // Los planos se tallan sobre el modelo y siguen a la cara con la misma corrección.
  const drawn = marks?.source === 'dibujo';
  const raw = FACE_PLANES.map((plane) => {
    const u = sub(plane[1], plane[0]);
    const v = sub(plane[plane.length - 1], plane[0]);
    const inModel = unit(cross(u, v));
    // Los vértices no siguen un solo sentido: la normal siempre apunta hacia afuera del cráneo.
    const out = dot(inModel, sub(plane[0], SKULL.c)) < 0 ? mul(inModel, -1) : inModel;
    const world3: V3 = [dot(a, out), dot(b, out), dot(c, out)];
    return { plane, world3 };
  }).filter((f) => f.world3[2] > 0.04);
  const shade = (n: V3) => clamp(0.5 + dot(n, unit([-0.5, -0.62, 0.6])) * 0.5, 0, 1);
  const seenTone = raw.map(({ plane }) => {
    const pts = plane.map(at);
    const mid = pts.reduce<Pt>((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]);
    return luma ? luma(mid) : 0.6;
  });
  // En una foto el valor se lee; en un dibujo la línea engaña y manda la forma.
  const lo = Math.min(...seenTone);
  const hi = Math.max(...seenTone);
  const facets = raw.map(({ plane, world3 }, i) => ({
    poly: plane.map(at),
    tone: drawn || !luma || hi - lo < 0.05 ? shade(world3) : (seenTone[i] - lo) / (hi - lo),
  }));
  if (read?.covered && !marks) {
    // Lo único que hay que ubicar en una máscara son sus lentes.
    loops.push(...read.lenses);
  }
  const guide: HeadGuide = {
    ball,
    outline,
    axes: [...meridianRuns, ...visibleRuns([...faceAxis], (p) => facing([0, 0, 1]) && dot(c, [0, 0, 1]) > -0.1 && !!p, at)],
    brow: visibleRuns(brow, (p) => facing(onSphere(p)), at),
    guides,
    side,
    jaw,
    features,
    loops,
    facets,
    irises,
    source: marks?.source ?? null,
    details: marks && !read?.covered ? featuresOf(marks, at, aspect, luma) : [],
    methods: headMethods({ at, facing, ball, c: flat(center), aspect, skull: SKULL, sideX: SIDE_X, sideR: SIDE_R, marks: marks ?? null, features, loops, jaw, facets, covered: !!read?.covered }),
    gaze: lean > 0.16 ? [pointing(1.06), pointing(1.42)] : null,
    c: flat(center),
    r: R,
    chin: at(chin),
  };
  const piece: Piece = {
    id: 'cabeza',
    name: tx('common.cabeza'),
    step: 1,
    z: center[2],
    outline,
    caps: [],
    rings: [],
    axes: [],
    mass: true,
  };
  return { guide, world, piece, base: world([0, 110, -600]) };
}

/** Sin cara visible: bola sola, con ejes si se conoce el giro. */
function plainHead(c: Pt, r: number, aspect: number, z: number): { guide: HeadGuide; piece: Piece } {
  const ball: Pt[] = [];
  for (let i = 0; i < 64; i++) {
    const q = (i / 64) * TAU;
    ball.push([c[0] + (r * Math.cos(q)) / aspect, c[1] + r * Math.sin(q)]);
  }
  const guide: HeadGuide = { ball, outline: ball, axes: [], brow: [], guides: [], side: [], jaw: [], features: [], loops: [], facets: [], irises: [], source: null, details: [], methods: [], gaze: null, c, r, chin: [c[0], c[1] + r] };
  return { guide, piece: { id: 'cabeza', name: tx('common.cabeza'), step: 1, z, outline: ball, caps: [], rings: [], axes: [], mass: true } };
}

function inPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nameSide(x: number): 'izquierda' | 'derecha' {
  return x < 0.5 ? 'izquierda' : 'derecha';
}

/** Mano: palma como bloque y cada dedo en sus tres falanges. */
function handPieces(id: string, step: number, name: string, rig: Rig, chains: number[][], wrist: V3, elbow: V3, H: number, k: number, aspect: number, visible: boolean, onBody?: (p: Pt) => boolean): { pieces: Piece[]; guide: HandGuide } {
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const P = (i: number): V3 => rig.pts[i];
  const expected = CANON.hand * H * k;
  const known = chains.flat().every((i) => rig.seen[i]);
  // El modelo 3D propone los dedos aunque no se vean; la pose plana solo si los vio.
  // Los dedos que propone el modelo 3D sin que nadie viera la mano solo valen si caen sobre la
  // figura: una mano que empuña algo o queda tapada no muestra dedos, y dibujarlos es inventar.
  const landOnBody = (share: number) => {
    if (!onBody) return true;
    const list = chains.flat();
    const hits = list.filter((i) => onBody([rig.pts[i][0] / aspect, rig.pts[i][1]])).length;
    return hits >= list.length * share;
  };
  // Aunque la pose diga que los vio, dedos que caen casi todos fuera de la figura están mal leídos.
  const estimated = known && !visible && !!rig.measures && landOnBody(0.7);
  const fingers = known && ((visible && landOnBody(0.5)) || estimated);
  const out: Piece[] = [];
  if (fingers) {
    const knuckles = chains.map((c) => c[3]);
    const hull = convexHull([wrist, ...knuckles.map(P)].map((p): Pt => [p[0], p[1]]));
    const palmZ = knuckles.reduce((acc, i) => acc + P(i)[2], wrist[2]) / (knuckles.length + 1);
    out.push({ id: `${id}-palma`, name, step, z: palmZ, outline: smoothClosed(hull.map(([x, y]): Pt => [x / aspect, y]), 1), caps: [], rings: [], axes: [knuckles.slice(1).map((i) => flat(P(i)))], stick: [flat(wrist), flat(P(knuckles[2]))] });
    const span = size(sub(P(knuckles[1]), P(knuckles[4]))) || H * 0.3;
    const r0 = clamp(span * 0.13, H * 0.018, H * 0.07) * clamp(Math.sqrt(rig.near[knuckles[2]] ?? 1), 0.85, 1.2);
    chains.forEach((chain, f) => {
      // De la base a la punta.
      const list = [...chain].reverse();
      for (let i = 0; i < list.length - 1; i++) {
        const phalanx = limbPiece(`${id}-d${f}-${i}`, name, step, P(list[i]), P(list[i + 1]), r0 * (1 - i * 0.14), r0 * (0.86 - i * 0.14), aspect, { rings: [] });
        out.push({ ...phalanx, caps: [], outline: smoothClosed(phalanx.outline, 2), thin: true });
      }
    });
  } else {
    // Mano escondida o poco clara: un bloque en la dirección del antebrazo.
    const dir = unit(sub(wrist, elbow));
    const tip = add(wrist, mul(dir, expected * 0.62));
    const piece = limbPiece(`${id}-bloque`, name, step, wrist, tip, H * 0.13 * k, H * 0.17 * k, aspect, { rings: [0.55] });
    out.push({ ...piece, caps: [], outline: smoothClosed(piece.outline, 2) });
  }
  const all = out.flatMap((p) => p.outline);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return {
    pieces: out,
    guide: { id, side: nameSide((x0 + Math.max(...xs)) / 2), fingers, estimated, box: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 } },
  };
}

/** Marco de la cabeza: oreja a oreja, y de ahí a la nariz. */
function headFrame(nose: V3, l: V3, r: V3): [V3, V3, V3] {
  const x = unit(sub(r, l));
  const toNose = sub(nose, mix(l, r, 0.5));
  const z = unit(sub(toNose, mul(x, dot(toNose, x))));
  return [x, cross(z, x), z];
}

/** Los rasgos de la foto acompañan a la cabeza cuando se mueve: giro en el plano y traslado. */
function carryMarks(marks: FaceMarks, rig: Rig, edit: RigEdit, aspect: number): FaceMarks {
  const d = edit[MHR.nose] ?? [0, 0, 0];
  const n1 = rig.pts[MHR.nose];
  const n0: V3 = [n1[0] - d[0], n1[1] - d[1], n1[2] - d[2]];
  const neck = rig.pts[MHR.neck];
  const nd = edit[MHR.neck] ?? [0, 0, 0];
  const neck0: V3 = [neck[0] - nd[0], neck[1] - nd[1], neck[2] - nd[2]];
  const q = Math.atan2(n1[1] - neck[1], n1[0] - neck[0]) - Math.atan2(n0[1] - neck0[1], n0[0] - neck0[0]);
  const cos = Math.cos(q);
  const sin = Math.sin(q);
  const move = ([x, y]: Pt): Pt => {
    const dx = x * aspect - n0[0];
    const dy = y - n0[1];
    return [(n1[0] + dx * cos - dy * sin) / aspect, n1[1] + dx * sin + dy * cos];
  };
  const walk = (v: unknown, key?: string): unknown => {
    if (key === 'vis') return v;
    if (Array.isArray(v)) return v.length === 2 && typeof v[0] === 'number' ? move(v as Pt) : v.map((x) => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(marks) as FaceMarks;
}

/** Lleva el ajuste de la cabeza a donde el pintor la dejó. */
function followHead(fit: OrthoFit, rig: Rig, edit: RigEdit): OrthoFit {
  const back = (i: number): V3 => {
    const d = edit[i] ?? [0, 0, 0];
    const p = rig.pts[i];
    return [p[0] - d[0], p[1] - d[1], p[2] - d[2]];
  };
  const before = headFrame(back(MHR.nose), back(MHR.earL), back(MHR.earR));
  const after = headFrame(rig.pts[MHR.nose], rig.pts[MHR.earL], rig.pts[MHR.earR]);
  // R = después · (antes)ᵀ
  const row = (i: number): V3 => [0, 1, 2].map((j) => after[0][i] * before[0][j] + after[1][i] * before[1][j] + after[2][i] * before[2][j]) as V3;
  const R = [row(0), row(1), row(2)];
  const turnRow = (r: V3): V3 => [
    r[0] * fit.a[0] + r[1] * fit.b[0] + r[2] * fit.c[0],
    r[0] * fit.a[1] + r[1] * fit.b[1] + r[2] * fit.c[1],
    r[0] * fit.a[2] + r[1] * fit.b[2] + r[2] * fit.c[2],
  ];
  const n0 = back(MHR.nose);
  const n1 = rig.pts[MHR.nose];
  const dx = fit.t[0] - n0[0];
  const dy = fit.t[1] - n0[1];
  return { ...fit, a: turnRow(R[0]), b: turnRow(R[1]), c: turnRow(R[2]), t: [n1[0] + R[0][0] * dx + R[0][1] * dy, n1[1] + R[1][0] * dx + R[1][1] * dy] };
}

/** Giro de la cabeza leído del esqueleto: sirve aunque la cara no tenga puntos fiables. */
function headFromRig(rig: Rig, s: number): OrthoFit | null {
  const need = [MHR.nose, MHR.earL, MHR.earR];
  if (!need.every((i) => rig.seen[i])) return null;
  const nose = rig.pts[MHR.nose];
  const earL = rig.pts[MHR.earL];
  const earR = rig.pts[MHR.earR];
  const mid = mix(earL, earR, 0.5);
  const ez = unit(sub(nose, mid));
  const side = sub(earL, earR);
  const ex = unit(sub(side, mul(ez, dot(side, ez))));
  const ey = cross(ez, ex);
  return { a: [ex[0], ey[0], ez[0]], b: [ex[1], ey[1], ez[1]], c: [ex[2], ey[2], ez[2]], s, t: [nose[0], nose[1]] };
}

function onCanvas(p: Piece): boolean {
  return p.outline.some(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
}

/** Solo una cabeza en la imagen: la misma construcción, sin cuerpo que inventar. */
export function buildHeadOnly(marks: FaceMarks, aspect: number, turn?: Turn | null, luma?: (p: Pt) => number): Mannequin | null {
  const drawn = marks.source === 'dibujo' ? fitDrawn(marks, aspect) : null;
  const fit = drawn ? { ...drawn, turn: turn ?? turnOf(drawn) } : marks.fit68 ? headFit(marks.fit68.pts, marks.fit68.vis, aspect, turn) : null;
  if (!fit) return null;
  const built = buildHead({ ...fit, turn: turn ?? turnOf(fit) }, aspect, 0, marks, luma);
  const { guide } = built;
  return {
    pieces: [built.piece],
    spine: [guide.c, marks.noseTip, marks.chin],
    tilts: [],
    head: guide,
    hands: [],
    order: [
      { step: 1, name: tx('common.cabeza'), note: tx('mannequin.la_bola_del_craneo') },
      { step: 10, name: tx('mannequin.cara'), note: tx('mannequin.cejas_nariz_boca_van') },
    ],
    headHeight: fit.s * HEAD_UNITS,
    chest: 0,
    blocks: [{ id: 'cabeza', name: tx('common.cabeza'), order: 1, a: guide.c, b: guide.chin, ra: guide.r * 1.08, rb: guide.r * 0.5 }],
    rig: null,
    light: null,
    nearest: null,
  };
}

/**
 * Maniquí en 3D: todas las piezas salen de un solo esqueleto, como en un programa de
 * animación. Cada hueso cuelga de su padre, así que tórax, pelvis, manos y pies no pueden
 * contradecirse. Aros, escorzos y traslapes se calculan de la geometría, no se dibujan a ojo.
 */
export function buildMannequin(input: MannequinInput): Mannequin | null {
  const { pts, vis, aspect, mask, depth, turn } = input;
  // Con partes se mide solo lo que es cuerpo: sin escudo, sin capa y sin lo que cuelgue.
  const bodyMask = input.parts && mask ? { data: bodyOnly(input.parts, mask.data), w: mask.w, h: mask.h } : mask;
  const waist = input.parts && mask ? findWaist(input.parts, mask.w, mask.h, aspect) : null;
  const seen2 = (i: number) => vis[i] > 0.2 && pts[i][0] > -0.05 && pts[i][0] < 1.05 && pts[i][1] > -0.05 && pts[i][1] < 1.05;
  const P2 = (i: number): V3 => [pts[i][0] * aspect, pts[i][1], 0];
  const len2 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const faceConf = vis.slice(POSE.face, POSE.face + 68).reduce((a, b) => a + b, 0) / 68;
  const earsH = seen2(POSE.earL) && seen2(POSE.earR) ? len2(P2(POSE.earL), P2(POSE.earR)) * 1.5 : 0;
  const given = input.marks?.fit68;
  const handDrawn = input.marks?.source === 'dibujo' ? fitDrawn(input.marks, aspect) : null;
  const firstFit = handDrawn ? { ...handDrawn, turn: turn ?? turnOf(handDrawn) } : given ? headFit(given.pts, given.vis, aspect, turn) : headFit(pts.slice(POSE.face, POSE.face + 68), vis.slice(POSE.face, POSE.face + 68), aspect, turn);
  // Una máscara o un dibujo esconden los rasgos: las orejas corrigen la escala.
  const faceFit = firstFit && !handDrawn && faceConf < 0.6 && earsH > firstFit.s * HEAD_UNITS * 1.12 ? { ...firstFit, s: earsH / HEAD_UNITS } : firstFit;
  const bodyH = seen2(POSE.shoulderL) && seen2(POSE.shoulderR) ? len2(P2(POSE.shoulderL), P2(POSE.shoulderR)) * 0.5 : 0;
  const planeH = (faceFit ? faceFit.s * HEAD_UNITS : 0) || earsH || bodyH;
  const rig0 = input.rig ?? poseRig({ pose: { pts, vis }, aspect, depth }, planeH, faceFit ? (faceFit.c[0] >= 0 ? 1 : -1) : 0);
  if (!rig0) return null;
  const rig = input.rig ?? finishRig(rig0, { pose: { pts, vis }, aspect, parts: input.parts, w: mask?.w, h: mask?.h, edit: input.edit });
  const R = (i: number): V3 => rig.pts[i];
  const known = (i: number) => rig.seen[i];
  if (!known(MHR.shoulderL) || !known(MHR.shoulderR)) return null;
  const fromWorld = (p: V3): Pt => [p[0] / aspect, p[1]];

  // Cabeza: los puntos de la cara si son fiables; si no, el giro del esqueleto.
  const rigFit = rig.measures ? headFromRig(rig, Math.max(rig.H, earsH) / HEAD_UNITS) : null;
  const trustFace = !!faceFit && (!rigFit || !!handDrawn || input.marks?.source === 'malla' || (faceConf >= 0.6 && dot(faceFit.c, rigFit.c) > 0.2));
  const covered = !!input.headRead?.covered;
  const fit0 = covered && rigFit ? rigFit : trustFace ? faceFit : rigFit;
  // Una cara cubierta da el giro, pero el tamaño y el lugar los da la cabeza que se ve.
  const fit1 = fit0 && input.headRead?.covered ? alignToOutline(fit0, input.headRead, aspect) : fit0;
  // Si se movió la cabeza, el giro la acompaña; los rasgos de la foto ya no aplican.
  const headEdit = input.edit?.[MHR.nose];
  const fit = fit1 && headEdit ? followHead(fit1, rig, input.edit!) : fit1;
  const H = fit ? fit.s * HEAD_UNITS : rig.H || planeH;
  if (H <= 0) return null;

  // Medidas del cuerpo: de la malla si existe; si no, las del canon con su proporción.
  const shoulders = { l: R(MHR.shoulderL), r: R(MHR.shoulderR) };
  // Lo que no tiene evidencia no se dibuja: el modelo 3D siempre propone un cuerpo entero,
  // aunque las piernas estén detrás de una libreta.
  const seenRel = relativeVis({ pts, vis });
  const cocoOf = new Map(COCO_TO_MHR.map(([coco, mhr]) => [mhr, coco]));
  const clear = (i: number) => {
    const c = cocoOf.get(i);
    return c !== undefined && seenRel[c] > 0.4 && pts[c][0] > 0 && pts[c][0] < 1 && pts[c][1] > 0 && pts[c][1] < 1 && onFigure(mask, pts[c]);
  };
  const backed = (a: number, b: number) => {
    // Lo que el pintor movió ya no tiene por qué caer sobre la figura de la foto.
    if (!mask || input.edit?.[a] || input.edit?.[b] || (clear(a) && clear(b))) return true;
    let hits = 0;
    for (let i = 1; i <= 8; i++) {
      const p = mix(R(a), R(b), i / 9);
      const x = Math.floor((p[0] / aspect) * mask.w);
      const y = Math.floor(p[1] * mask.h);
      if (x >= 0 && y >= 0 && x < mask.w && y < mask.h && mask.data[y * mask.w + x]) hits++;
    }
    return hits >= 4;
  };
  const hasHips = known(MHR.hipL) && known(MHR.hipR);
  const rawHips = hasHips ? { l: R(MHR.hipL), r: R(MHR.hipR) } : null;
  const hips = rawHips && backed(MHR.hipL, MHR.hipR) ? rawHips : null;
  const neck = R(MHR.neck);
  const k = rig.proportion;
  const thick = Math.min(k, 1.05);
  // Sin caderas a la vista, el tronco sale de los hombros y de dónde queda la cabeza.
  const shoulderUp = (): V3 => {
    const line = sub(shoulders.r, shoulders.l);
    const n = unit([-line[1], line[0], 0]);
    const toHead = known(MHR.nose) ? sub(R(MHR.nose), neck) : ([0, -1, 0] as V3);
    return dot(n, toHead) < 0 ? mul(n, -1) : n;
  };
  const pelvis: V3 = hips ? mix(hips.l, hips.r, 0.5) : sub(neck, mul(shoulderUp(), CANON.torso * H * k));
  const up = unit(sub(neck, pelvis));
  const frameOf = (right: V3, upward: V3): Frame => {
    const x = unit(right);
    const y = unit(sub(upward, mul(x, dot(upward, x))));
    return { x, y, z: cross(x, y) };
  };
  // El eje x apunta al hombro derecho de la figura; `y` sube; `z` sale del pecho.
  const chestFrame = frameOf(sub(shoulders.r, shoulders.l), up);
  const hipFrame = hips ? frameOf(sub(hips.r, hips.l), up) : chestFrame;
  const torsoLength = rawHips ? Math.max(size(sub(neck, pelvis)), size(sub(neck, mix(rawHips.l, rawHips.r, 0.5))) * 0.6) : size(sub(neck, pelvis));
  const trunkK = clamp(torsoLength / (CANON.torso * H), 0.7, 1.12);
  const span = size(sub(shoulders.l, shoulders.r));
  // El grosor nunca sale de la escala del modelo 3D: es un adulto promedio y, ajustado a un
  // personaje en escorzo, crece de más. Sale de los huesos de esta figura, y manda la silueta.
  const bodyUnit = Math.min(H, Math.max(torsoLength / 2, H * 0.55));
  const widthAcross = (center: V3, axis: V3, length: number, limit: number) =>
    measuredRadius(bodyMask, fromWorld(sub(center, mul(axis, length * 0.5))), fromWorld(add(center, mul(axis, length * 0.5))), aspect, limit);
  const ribA0 = Math.max(span * 0.46, bodyUnit * 0.62);
  const chestMesh = input.surface?.chest ?? null;
  const ribB = chestMesh ? chestMesh.b * 0.9 : Math.min(torsoLength * 0.46, ribA0 * 1.3) * Math.min(trunkK, 1);
  const ribD0 = ribA0 * 0.74;
  const ribTop = sub(neck, mul(chestFrame.y, ribB * 0.92));
  // El tórax se centra en el tronco que se ve: es lo que define su contorno.
  const across: V3 = (() => {
    const n = Math.hypot(up[0], up[1]) || 1;
    return [-up[1] / n, up[0] / n, 0];
  })();
  const trunkSeen = input.parts && mask ? regionCenter(input.parts, mask.w, mask.h, 'tronco', (x, y) => Math.abs(dot(sub([x * aspect, y, ribTop[2]], ribTop), up)) <= ribB) : null;
  const ribShift = trunkSeen ? clamp(dot(sub([trunkSeen[0] * aspect, trunkSeen[1], ribTop[2]], ribTop), across), -ribA0 * 0.6, ribA0 * 0.6) : 0;
  // Las costillas empiezan en el cuello. La malla reparte vértices hasta el hombro, y sin este
  // tope la caja subiría hasta la barbilla.
  const ribCenter = chestMesh
    ? (dot(sub(neck, chestMesh.c), up) < ribB * 0.95 ? sub(neck, mul(up, ribB * 0.95)) : chestMesh.c)
    : add(ribTop, mul(across, ribShift));
  const screenWide = (f: Frame, a: number, b: number, d: number) => {
    const n = Math.hypot(up[0], up[1]) || 1;
    const u: V3 = [-up[1] / n, up[0] / n, 0];
    return Math.sqrt(dot(f.x, u) ** 2 * a * a + dot(f.y, u) ** 2 * b * b + dot(f.z, u) ** 2 * d * d);
  };
  const ribSeen = widthAcross(ribCenter, up, ribB, ribA0 * 2.6);
  const ribFit = ribSeen === null ? 1 : clamp(ribSeen / screenWide(chestFrame, ribA0, ribB, ribD0), 0.72, 1.08);
  const chestSeen = input.surface?.chest;
  const ribA = chestSeen ? chestSeen.a : ribA0 * ribFit;
  const ribD = chestSeen ? chestSeen.d : ribD0 * ribFit;
  // La cintura vista en la imagen fija dónde empieza la pelvis; las caderas, dónde termina.
  const seenWaist: V3 | null = (() => {
    if (!waist || !hips) return null;
    const p: V3 = [waist.c[0] * aspect, waist.c[1], pelvis[2]];
    const gap = dot(sub(p, pelvis), up);
    return gap > -H * 0.2 && gap < torsoLength * 0.55 ? p : null;
  })();
  const pelTop = seenWaist ?? add(pelvis, mul(hipFrame.y, Math.min(bodyUnit * 0.5, torsoLength * 0.26)));
  const pelA0 = Math.min(ribA * 1.04, Math.max(hips ? size(sub(hips.l, hips.r)) * 0.8 : 0, waist ? waist.width * 0.5 : 0, bodyUnit * 0.5));
  const pelB = Math.min(Math.max(dot(sub(pelTop, pelvis), up) + bodyUnit * 0.3, pelA0 * 0.6) * 0.5, ribB * 0.72);
  const pelD0 = Math.min(pelA0 * 0.78, ribD);
  const pelCenter = mix(pelTop, sub(pelvis, mul(hipFrame.y, bodyUnit * 0.3)), 0.5);
  const pelSeen = widthAcross(pelCenter, up, pelB, pelA0 * 2.6);
  const pelFit = pelSeen === null ? 1 : clamp(pelSeen / screenWide(hipFrame, pelA0, pelB, pelD0), 0.8, 1.08);
  const hipSeen = input.surface?.hips;
  const pelA = hipSeen ? hipSeen.a : Math.min(pelA0 * pelFit, ribA * 1.08);
  const pelD = hipSeen ? hipSeen.d : pelD0 * pelFit;

  const pieces: Piece[] = [];
  const spinePts: V3[] = [];
  const blocks: Block[] = [];
  let torsoRadii: [number, number] = [ribA, ribA * 0.8];

  // Cabeza
  let head: HeadGuide | null = null;
  let neckTop: V3 | null = null;
  if (fit) {
    const noseZ = known(MHR.nose) ? R(MHR.nose)[2] : neck[2] + H * 0.55;
    const built = buildHead({ ...fit, turn: headEdit ? turnOf(fit) : (turn ?? turnOf(fit)) }, aspect, noseZ, headEdit && input.marks ? carryMarks(input.marks, rig, input.edit!, aspect) : input.marks, input.luma, input.headRead);
    head = built.guide;
    pieces.push(built.piece);
    neckTop = built.base;
  } else {
    const anchors = [MHR.nose, MHR.eyeL, MHR.eyeR, MHR.earL, MHR.earR].filter(known);
    if (anchors.length) {
      const c = anchors.reduce<V3>((acc, i) => add(acc, mul(R(i), 1 / anchors.length)), [0, 0, 0]);
      const r = H * 0.46;
      const built = plainHead(fromWorld(c), r, aspect, neck[2] + H * 0.4);
      head = built.guide;
      pieces.push(built.piece);
      neckTop = [c[0], c[1] + r * 0.55, neck[2] + H * 0.3];
    }
  }
  if (neckTop) {
    const headZ = pieces[0]?.z ?? neck[2];
    const piece = limbPiece('cuello', tx('mannequin.columna_abdomen'), 4, neck, neckTop, bodyUnit * RADII.neck[1] * thick, bodyUnit * RADII.neck[0] * thick, aspect, { rings: [0.5] });
    // La cabeza siempre tapa su cuello.
    pieces.push({ ...piece, caps: [], z: Math.min(piece.z, headZ - H * 0.05) });
  }

  // Grandes masas: tórax y pelvis, cada una con sus propios ejes.
  const ribLines = ellipsoidLines(ribCenter, chestFrame, ribA, ribB, ribD, aspect, [-0.62, -0.28, 0.08, 0.44]);
  pieces.push({
    id: 'torax',
    name: tx('common.caja_toracica'),
    step: 2,
    z: ribCenter[2],
    outline: ellipsoidOutline(ribCenter, chestFrame, ribA, ribB, ribD, aspect),
    caps: [],
    rings: ribLines.rings,
    axes: ribLines.axes,
    mass: true,
    planes: ellipsoidFacets(ribCenter, chestFrame, ribA, ribB, ribD, aspect, 5, 10),
    marks: trunkMarks(ribCenter, chestFrame, ribA, ribB, ribD, aspect),
  });
  if (hips) {
    // Una cubeta, no un huevo: la tapa de arriba enseña cuánto se inclina la cadera, y es lo
    // que hay que encontrar primero. Va adelante: las piernas salen de sus costados.
    const rimCenter = add(pelCenter, mul(hipFrame.y, pelB));
    const rim = ellipseRing(rimCenter, hipFrame.x, hipFrame.z, pelA, pelD, 40).map((p): Pt => [p[0], p[1]]);
    const seat = ellipseRing(sub(pelCenter, mul(hipFrame.y, pelB)), hipFrame.x, hipFrame.z, pelA * 0.56, pelD * 0.62, 28).map((p): Pt => [p[0], p[1]]);
    const shell = convexHull([...rim, ...seat]).map(([x, y]): Pt => [x / aspect, y]);
    const opensUp = hipFrame.y[2];
    pieces.push({
      id: 'pelvis',
      name: tx('common.pelvis'),
      step: 3,
      z: Math.max(hips.l[2], hips.r[2]) + H * 0.12,
      outline: smoothClosed(shell, 2),
      caps: opensUp > 0.04 ? [rim.map(([x, y]): Pt => [x / aspect, y])] : [],
      rings: [],
      axes: [[fromWorld(rimCenter), fromWorld(sub(pelCenter, mul(hipFrame.y, pelB)))]],
      mass: true,
      planes: ellipsoidFacets(pelCenter, hipFrame, pelA, pelB * 1.15, pelD, aspect, 3, 8),
      marks: pelvisMarks(rimCenter, hipFrame, pelA, pelD, aspect),
    });
    // Abdomen: une las dos masas y es lo único del tronco que se dobla.
    const waistTop = sub(ribCenter, mul(chestFrame.y, ribB * 0.55));
    const waistLow = add(pelCenter, mul(hipFrame.y, pelB * 0.3));
    const across = unit(cross(sub(waistTop, waistLow), [0, 0, 1]));
    const spread = (f: Frame, a: number, b: number, d: number) => Math.sqrt(dot(f.x, across) ** 2 * a * a + dot(f.y, across) ** 2 * b * b + dot(f.z, across) ** 2 * d * d);
    const belly = limbPiece('abdomen', tx('mannequin.columna_abdomen'), 4, waistLow, waistTop, spread(hipFrame, pelA, pelB, pelD) * 0.74, spread(chestFrame, ribA, ribB, ribD) * 0.74, aspect, { rings: [0.5] });
    // Va detrás de las dos masas: sus esquinas quedan escondidas dentro de ellas.
    pieces.push({ ...belly, caps: [], z: Math.min(ribCenter[2], pelCenter[2]) - H * 0.05 });
    torsoRadii = [spread(chestFrame, ribA, ribB, ribD), spread(hipFrame, pelA, pelB, pelD)];
    spinePts.push(sub(pelvis, mul(hipFrame.y, pelB * 0.4)), rig.spine);
  }
  spinePts.push(ribCenter);
  spinePts.push(neckTop ? mix(add(ribCenter, mul(chestFrame.y, ribB * 0.8)), neckTop, 0.45) : neck);
  if (neckTop) spinePts.push(neckTop);

  const limb = (
    side: 'L' | 'R',
    root: number,
    mid: number,
    end: number,
    bones: [string, string],
    radii: [readonly [number, number], readonly [number, number]],
    label: string,
    blockNames: [string, string],
    step: number,
  ) => {
    const parts: { a: V3; b: V3 }[] = [];
    const missing = (name: string) => !!input.surface?.absent.includes(PART[name as keyof typeof PART]);
    if (!known(root) || !known(mid) || !backed(root, mid) || missing(bones[0])) return parts;
    parts.push({ a: R(root), b: R(mid) });
    if (known(end) && backed(mid, end) && !missing(bones[1])) parts.push({ a: R(mid), b: R(end) });
    // Lo que está cerca se ve más grueso, pero poco: el ancho final lo dicta la silueta.
    const nominal = (fallback: readonly [number, number], joint: number): [number, number] => {
      const near = clamp(Math.sqrt(rig.near[joint] ?? 1), 0.9, 1.12);
      return [bodyUnit * fallback[0] * thick * near, bodyUnit * fallback[1] * thick * near];
    };
    const fitted = (from: V3, to: V3, wanted: number) => {
      const seen = measuredRadius(mask, fromWorld(from), fromWorld(to), aspect, wanted * 3);
      // La silueta adelgaza pero casi no engorda: trae capa, escudo y lo que cuelgue.
      return seen === null ? wanted : clamp(seen, wanted * 0.65, wanted * 1.1);
    };
    const n0 = nominal(radii[0], root);
    // Con superficie cada hueso mide lo que mide de verdad, en sus dos extremos.
    const real = (name: string): [number, number] | null => {
      const list = input.surface?.radii[PART[name as keyof typeof PART]];
      return list && list[0] > 0 && list[1] > 0 ? list : null;
    };
    const upperReal = real(bones[0]);
    const ra = upperReal ? upperReal[0] : fitted(parts[0].a, parts[0].b, n0[0]);
    const rb = upperReal ? upperReal[1] : ra * clamp(n0[1] / (n0[0] || 1), 0.55, 1);
    const legs = bones[0].startsWith('muslo');
    // Se dobla hacia donde queda el otro extremo: ahí carga la masa del músculo.
    const bend = (p: V3, q: V3, other: V3): 1 | -1 => ((q[0] - p[0]) * (other[1] - p[1]) - (q[1] - p[1]) * (other[0] - p[0]) >= 0 ? 1 : -1);
    const inner = parts[1] ? bend(parts[0].a, parts[0].b, parts[1].b) : 1;
    const shaped = (kind: LimbKind, from: V3, to: V3, r: number, side2: 1 | -1) => organicLimb(kind, from, to, r, side2, aspect, legs ? bodyMask : mask);
    const upper0 = limbPiece(`${side}-${bones[0]}`, label, step, parts[0].a, parts[0].b, ra * 0.92, rb, aspect);
    const upperForm = shaped(legs ? 'muslo' : 'brazo', parts[0].a, parts[0].b, ra, inner);
    const upper: Piece = { ...upper0, form: upperForm.outline, formRings: upperForm.rings, planes: upperForm.planes, marks: upperForm.marks };
    const lift = H * 0.01;
    blocks.push({ id: upper.id, name: blockNames[0], order: step, a: fromWorld(parts[0].a), b: fromWorld(parts[0].b), ra, rb });
    pieces.push(upper);
    // En la cadera no va una bola: el fémur entra al costado de la cubeta.
    if (!legs) pieces.push({ ...ballPiece(`${side}-${bones[0]}-raiz`, label, step, parts[0].a, ra * 0.82, aspect), z: upper.z + lift });
    if (parts[1]) {
      const n1 = nominal(radii[1], mid);
      const lowerReal = real(bones[1]);
      const la = lowerReal ? lowerReal[0] : Math.min(fitted(parts[1].a, parts[1].b, n1[0]), rb * 1.05);
      const lb = lowerReal ? lowerReal[1] : la * clamp(n1[1] / (n1[0] || 1), 0.45, 1);
      const lower0 = limbPiece(`${side}-${bones[1]}`, label, step, parts[1].a, parts[1].b, la, lb, aspect);
      const lowerForm = shaped(legs ? 'pantorrilla' : 'antebrazo', parts[1].a, parts[1].b, la, inner);
      const dir: Pt = [parts[1].a[0] - parts[0].a[0], parts[1].a[1] - parts[0].a[1]];
      const lower: Piece = { ...lower0, form: lowerForm.outline, formRings: lowerForm.rings, planes: lowerForm.planes, marks: [...lowerForm.marks, ...(legs ? [kneeCap(parts[1].a, dir, rb * 0.62, aspect)] : [])] };
      pieces.push(lower);
      blocks.push({ id: lower.id, name: blockNames[1], order: step + 0.5, a: fromWorld(parts[1].a), b: fromWorld(parts[1].b), ra: la, rb: lb });
      pieces.push({ ...ballPiece(`${side}-${bones[0]}-medio`, label, step, parts[0].b, rb * (legs ? 0.8 : 0.88), aspect), z: Math.max(upper.z, lower.z) + lift });
      pieces.push({ ...ballPiece(`${side}-${bones[1]}-fin`, label, step, parts[1].b, lb * 1.08, aspect), z: lower.z + lift });
    } else {
      pieces.push({ ...ballPiece(`${side}-${bones[0]}-medio`, label, step, parts[0].b, rb * 1.04, aspect), z: upper.z + lift });
    }
    return parts;
  };

  /** Los dos extremos se nombran comparándolos: una mano a la izquierda de la otra. */
  const sideOf = (end: number, other: number): 'izquierda' | 'derecha' => {
    if (known(end) && known(other) && Math.abs(R(end)[0] - R(other)[0]) > 0.01) return R(end)[0] < R(other)[0] ? 'izquierda' : 'derecha';
    const at = R(known(end) ? end : other);
    return nameSide(at[0] / aspect);
  };
  const short = (s: string) => (s === 'izquierda' ? tx('common.izq') : tx('common.der'));
  const ends = new Map<string, { a: V3; b: V3 }>();

  // Primero lo que queda delante: lo de atrás se esconde detrás de ello.
  const legs = hips
    ? ([['L', MHR.hipL, MHR.kneeL, MHR.ankleL, MHR.ankleR], ['R', MHR.hipR, MHR.kneeR, MHR.ankleR, MHR.ankleL]] as const)
    : [];
  [...legs].sort((a, b) => R(b[2])[2] - R(a[2])[2]).forEach(([side, root, mid, end, other], i) => {
    const at = sideOf(end, other);
    const parts = limb(side, root, mid, end, [`muslo${side}`, `pierna${side}`], [RADII.thigh, RADII.shin], tx('mannequin.pierna_de_la', { at }), [tx('mannequin.muslo', { v1: short(at) }), tx('mannequin.pantorrilla', { v1: short(at) })], 5 + i);
    if (parts.length === 2) ends.set(`pie${side}`, parts[1]);
  });
  const arms = [['L', MHR.shoulderL, MHR.elbowL, MHR.wristL, MHR.wristR], ['R', MHR.shoulderR, MHR.elbowR, MHR.wristR, MHR.wristL]] as const;
  [...arms].sort((a, b) => R(b[2])[2] - R(a[2])[2]).forEach(([side, root, mid, end, other], i) => {
    const at = sideOf(end, other);
    const parts = limb(side, root, mid, end, [`brazo${side}`, `antebrazo${side}`], [RADII.upperArm, RADII.foreArm], tx('mannequin.brazo_de_la', { at }), [tx('mannequin.brazo', { v1: short(at) }), tx('mannequin.antebrazo', { v1: short(at) })], 7 + i);
    if (parts.length === 2) ends.set(`mano${side}`, parts[1]);
  });

  // Manos
  const hands: HandGuide[] = [];
  for (const [side, base, chains, wrist, other] of [['L', POSE.handL, HAND_L, MHR.wristL, MHR.wristR], ['R', POSE.handR, HAND_R, MHR.wristR, MHR.wristL]] as const) {
    const arm = ends.get(`mano${side}`);
    if (!arm) continue;
    const ids = Array.from({ length: 21 }, (_, i) => base + i);
    const sure = ids.filter((i) => vis[i] > 0.35);
    const mean = ids.reduce((acc, i) => acc + vis[i], 0) / 21;
    const reach = sure.length ? Math.max(...sure.map((i) => len2(P2(i), arm.b))) : 0;
    const expected = CANON.hand * H * k;
    const visible = sure.length >= 14 && mean > 0.5 && reach > expected * 0.45 && reach < expected * 1.7;
    // Una mano leída de cerca que nace en esta muñeca reemplaza a los dedos de la pose.
    const near = (input.handMarks ?? [])
      .map((h) => ({ h, gap: Math.hypot(h.pts[0][0] * aspect - arm.b[0], h.pts[0][1] - arm.b[1]) }))
      .filter((c) => c.gap < H * 0.55)
      .sort((p, q) => p.gap - q.gap)[0]?.h;
    let close = near ? buildHand({ marks: near, aspect, mask, id: `mano${side}` }) : null;
    // Una mano leída de cerca cuyos dedos caen casi todos fuera de la figura está mal leída.
    if (close && mask) {
      const tips = [4, 8, 12, 16, 20, 5, 9, 13, 17].map((i) => close!.joints[i]);
      if (tips.filter((q) => onFigure(mask, q, 0.01)).length < tips.length * 0.5) close = null;
    }
    const built = close
      ? {
          pieces: close.mannequin.pieces.map((p) => ({ ...p, step: 9, name: tx('mannequin.manos_pies'), z: p.z + arm.b[2], thin: p.id.includes('-d'), mass: false, caps: [] })),
          guide: { id: `mano${side}`, side: 'izquierda' as const, fingers: true, estimated: false, box: close.box },
        }
      : handPieces(`mano${side}`, 9, tx('mannequin.manos_pies'), rig, chains, arm.b, arm.a, H, k, aspect, visible, mask ? (q) => onFigure(mask, q, 0.01) : undefined);
    pieces.push(...built.pieces);
    const at = sideOf(wrist, other);
    hands.push({ ...built.guide, side: at });
    blocks.push({ id: `mano${side}`, name: tx('common.mano_2', { v1: short(at) }), order: 9, a: fromWorld(arm.b), b: [built.guide.box.x + built.guide.box.w / 2, built.guide.box.y + built.guide.box.h / 2], ra: H * 0.16 * k, rb: H * 0.2 * k });
  }

  // Pies: cuña entre tobillo, talón y dedos.
  for (const [side, toe, small, heel, other] of [['L', MHR.toeL, MHR.smallToeL, MHR.heelL, MHR.ankleR], ['R', MHR.toeR, MHR.smallToeR, MHR.heelR, MHR.ankleL]] as const) {
    const leg = ends.get(`pie${side}`);
    if (!leg || !known(toe) || !known(heel)) continue;
    let tip = mix(R(toe), known(small) ? R(small) : R(toe), 0.5);
    let back = R(heel);
    let r = H * 0.13 * k;
    // El pie que propone el modelo puede apuntar al aire. Si la punta cae fuera de la figura, se
    // busca desde el tobillo, cerca de esa dirección, hacia dónde sigue de verdad la silueta.
    if (mask) {
      const on = (q: V3) => onFigure(mask, [q[0] / aspect, q[1]], 0.004);
      if (!on(tip)) {
        const ankle = leg.b;
        const length = Math.hypot(tip[0] - ankle[0], tip[1] - ankle[1]) || H * 0.3;
        const base = Math.atan2(tip[1] - ankle[1], tip[0] - ankle[0]);
        const shin = Math.atan2(leg.a[1] - ankle[1], leg.a[0] - ankle[0]);
        let best = { run: 0, angle: base };
        for (let d = -100; d <= 100; d += 10) {
          const angle = base + (d * Math.PI) / 180;
          // No se vuelve por la pantorrilla.
          if (Math.abs(Math.atan2(Math.sin(angle - shin), Math.cos(angle - shin))) < 0.6) continue;
          let run = 0;
          for (let t = 0.1; t <= 1.4; t += 0.05) {
            if (!on([ankle[0] + Math.cos(angle) * length * t, ankle[1] + Math.sin(angle) * length * t, ankle[2]])) break;
            run = t;
          }
          // A igual alcance gana la que menos se aparta de la propuesta.
          if (run > best.run + 0.05 || (Math.abs(run - best.run) <= 0.05 && Math.abs(angle - base) < Math.abs(best.angle - base))) best = { run, angle };
        }
        if (best.run >= 0.5) {
          const reach = Math.min(1.2, best.run) * length * 0.92;
          tip = [ankle[0] + Math.cos(best.angle) * reach, ankle[1] + Math.sin(best.angle) * reach, tip[2]];
          back = [ankle[0] - Math.cos(best.angle) * reach * 0.22, ankle[1] - Math.sin(best.angle) * reach * 0.22, back[2]];
        }
      }
      // El grosor del pie sale del tobillo medido, no de un número fijo.
      const shinEnd = input.surface?.radii[PART[`pierna${side}` as keyof typeof PART]]?.[1];
      if (shinEnd && shinEnd > 0) r = clamp(shinEnd * 1.05, H * 0.07 * k, H * 0.16 * k);
    }
    const hull = convexHull(
      ([[leg.b, r * 0.9], [back, r * 0.9], [tip, r * 0.62]] as [V3, number][]).flatMap(([c, rad]) => {
        const out: Pt[] = [];
        for (let i = 0; i < 18; i++) {
          const q = (i / 18) * TAU;
          out.push([c[0] + rad * Math.cos(q), c[1] + rad * Math.sin(q)]);
        }
        return out;
      }),
    );
    pieces.push({
      id: `pie${side}`,
      name: tx('mannequin.manos_pies'),
      step: 9,
      z: (leg.b[2] + tip[2]) / 2,
      outline: hull.map(([x, y]): Pt => [x / aspect, y]),
      caps: [],
      rings: [],
      axes: [[fromWorld(leg.b), fromWorld(tip)]],
      stick: [fromWorld(leg.b), fromWorld(tip)],
    });
    const foot = side === 'L' ? MHR.ankleL : MHR.ankleR;
    blocks.push({ id: `pie${side}`, name: tx('mannequin.pie', { v1: short(sideOf(foot, other)) }), order: 9.5, a: fromWorld(back), b: fromWorld(tip), ra: r, rb: r * 0.7 });
  }

  const shoulderBar: [Pt, Pt] = [fromWorld(add(shoulders.l, mul(unit(sub(shoulders.l, shoulders.r)), ribA * 0.25))), fromWorld(add(shoulders.r, mul(unit(sub(shoulders.r, shoulders.l)), ribA * 0.25)))];
  const tilts: [Pt, Pt][] = [shoulderBar];
  if (hips) tilts.push([fromWorld(add(hips.l, mul(unit(sub(hips.l, hips.r)), pelA * 0.5))), fromWorld(add(hips.r, mul(unit(sub(hips.r, hips.l)), pelA * 0.5)))]);

  const curve = catmullRom(spinePts.map(fromWorld), 10);
  const firstInside = head ? curve.findIndex((p, i) => i > curve.length * 0.4 && inPolygon(p, head.outline)) : -1;
  const spine2D = firstInside > 0 ? curve.slice(0, firstInside) : curve;

  const trunkZ = ribCenter[2];
  const crossing = (step: number) => {
    const list = pieces.filter((p) => p.step === step && !p.joint);
    if (!list.length) return '';
    const z = list.reduce((acc, p) => acc + p.z, 0) / list.length;
    if (z > trunkZ + H * 0.12) return tx('mannequin.pasa_por_delante_del');
    if (z < trunkZ - H * 0.12) return tx('mannequin.queda_detras_del_tronco');
    return tx('mannequin.va_la_altura_del');
  };
  const order = new Map<number, { step: number; name: string; note: string }>();
  const notes: Record<number, string> = {
    1: tx('mannequin.la_bola_del_craneo'),
    2: tx('mannequin.un_ovoide_da_el'),
    3: tx('mannequin.mas_chica_con_su'),
    4: tx('mannequin.la_columna_en_une'),
    9: tx('mannequin.al_final_sobre_la'),
  };
  for (const p of [...pieces].sort((a, b) => a.step - b.step)) {
    if (!order.has(p.step)) order.set(p.step, { step: p.step, name: p.name, note: notes[p.step] ?? crossing(p.step) });
  }
  if (head?.features.length || head?.loops.length) order.set(10, { step: 10, name: tx('mannequin.cara'), note: tx('mannequin.cejas_nariz_boca_van') });

  const screenAngle = (Math.atan2(chestFrame.z[0], chestFrame.z[2]) * 180) / Math.PI;
  if (head) blocks.push({ id: 'cabeza', name: tx('common.cabeza'), order: 1, a: head.c, b: head.chin, ra: head.r * 1.08, rb: head.r * 0.5 });
  blocks.push({ id: 'tronco', name: tx('mannequin.tronco'), order: 2, a: fromWorld(neck), b: fromWorld(pelvis), ra: torsoRadii[0], rb: torsoRadii[1] });

  // Lo que no cae en el encuadre no existe para quien dibuja: ni se lista ni se ordena.
  const framed = pieces.filter(onCanvas);
  const steps = new Set(framed.map((p) => p.step));
  if (head?.features.length || head?.loops.length) steps.add(10);
  // El que está más cerca, primero: es lo que un dibujante resuelve antes que el resto.
  const front = framed.filter((p) => !p.joint && !p.thin).sort((a, b) => b.z - a.z)[0];
  return {
    pieces: framed,
    spine: spine2D,
    tilts,
    head,
    hands,
    order: [...order.values()].filter((o) => steps.has(o.step)),
    headHeight: H,
    chest: Math.round(screenAngle),
    blocks,
    rig,
    light: rig.light,
    nearest: front?.name ?? null,
  };
}
