import { eyeFeature, eyeFromPixels, mouthFeature, noseFeature, type EyeShape, type Feature, type NoseShape } from './features';
import type { DrawnFace, Pt } from './types';
import type { OrthoFit, V3 } from './volumes';

import { t as tx } from '../i18n';
/**
 * Los rasgos que de verdad están en la imagen. La malla de 478 puntos, los 68 de la pose
 * o los ojos de un dibujo terminan en esta misma forma, y todo lo demás se dibuja de aquí:
 * un rasgo solo cae sobre la cara si sale de la cara.
 */
export interface FaceMarks {
  source: 'malla' | 'pose' | 'dibujo';
  /** De sien a sien pasando por el mentón. */
  contour: Pt[];
  browL: Pt[];
  browR: Pt[];
  /** Cerrados. "L" es el de la izquierda de la imagen. */
  eyeL: Pt[];
  eyeR: Pt[];
  irisL: Pt | null;
  irisR: Pt | null;
  /** Del entrecejo a la punta. */
  bridge: Pt[];
  /** De ala a ala por debajo. */
  noseBase: Pt[];
  lips: Pt[];
  lipsInner: Pt[] | null;
  glabella: Pt;
  noseTip: Pt;
  mouth: Pt;
  chin: Pt;
  /** Ángulos de la quijada. */
  jawL: Pt;
  jawR: Pt;
  /** Los nueve puntos con que se mide el giro, en numeración iBUG. */
  fit68: { pts: Pt[]; vis: number[] } | null;
  /** La malla completa, si la hubo: da el detalle fino de ojos, nariz y boca. */
  mesh?: Pt[];
}

const at = (pts: Pt[], list: number[]) => list.map((i) => pts[i]);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (list: Pt[]): Pt => {
  let x = 0;
  let y = 0;
  for (const p of list) {
    x += p[0];
    y += p[1];
  }
  return [x / (list.length || 1), y / (list.length || 1)];
};

const OVAL = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356];
const EYE_L = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const EYE_R = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const BROW_L = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
const BROW_R = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
/** Del índice de iBUG al de la malla: los puntos con que se ajusta el giro. */
const IBUG: [number, number][] = [[30, 1], [8, 152], [36, 33], [45, 263], [39, 133], [42, 362], [48, 61], [54, 291], [27, 168]];

/** Malla de MediaPipe: 478 puntos. */
export function marksFromMesh(pts: Pt[]): FaceMarks {
  const p68: Pt[] = Array.from({ length: 68 }, (): Pt => [0, 0]);
  const v68 = new Array<number>(68).fill(0);
  for (const [ibug, mesh] of IBUG) {
    p68[ibug] = pts[mesh];
    v68[ibug] = 1;
  }
  return {
    mesh: pts,
    fit68: { pts: p68, vis: v68 },
    source: 'malla',
    contour: at(pts, OVAL),
    browL: at(pts, BROW_L),
    browR: at(pts, BROW_R),
    eyeL: at(pts, EYE_L),
    eyeR: at(pts, EYE_R),
    irisL: pts[468] ?? null,
    irisR: pts[473] ?? null,
    bridge: at(pts, [168, 6, 197, 195, 5, 4, 1]),
    noseBase: at(pts, [129, 98, 97, 2, 326, 327, 358]),
    lips: at(pts, LIPS),
    lipsInner: at(pts, LIPS_IN),
    glabella: pts[168],
    noseTip: pts[1],
    mouth: mean(at(pts, [13, 14])),
    chin: pts[152],
    jawL: pts[172],
    jawR: pts[397],
  };
}

/** Los 68 puntos de la pose, ya ordenados como iBUG. */
export function marksFrom68(pts: Pt[], vis: number[]): FaceMarks | null {
  const need = [8, 30, 36, 45, 48, 54];
  if (!need.every((i) => vis[i] > 0.2)) return null;
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return {
    fit68: { pts, vis },
    source: 'pose',
    contour: at(pts, range(0, 16)),
    browL: at(pts, range(17, 21)),
    browR: at(pts, range(22, 26)),
    eyeL: at(pts, range(36, 41)),
    eyeR: at(pts, range(42, 47)),
    irisL: null,
    irisR: null,
    bridge: at(pts, range(27, 30)),
    noseBase: at(pts, range(31, 35)),
    lips: at(pts, range(48, 59)),
    lipsInner: at(pts, range(60, 67)),
    glabella: pts[27],
    noseTip: pts[30],
    mouth: mean(at(pts, [51, 57])),
    chin: pts[8],
    jawL: pts[4],
    jawR: pts[12],
  };
}

function boxEye(box: { x: number; y: number; w: number; h: number }, tilt: number, aspect: number): Pt[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = (box.w * aspect) / 2;
  const ry = box.h / 2;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const out: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const u = rx * Math.cos(t) * 0.94;
    const v = ry * Math.sin(t) * 0.86;
    out.push([cx + (u * c - v * s) / aspect, cy + u * s + v * c]);
  }
  return out;
}

/**
 * Una máscara no tiene rasgos, pero sus lentes dicen todo el giro: la recta entre ellos es
 * la inclinación, el lente más ancho es el más cercano, y de la coronilla a los ojos hay lo
 * mismo que de los ojos al mentón. Nariz y boca quedan como referencia, no como rasgos.
 */
export function marksFromLenses(lenses: Pt[][], outline: Pt[], aspect: number, head?: { c: Pt; rx: number; ry: number }): FaceMarks | null {
  if (lenses.length < 2) return null;
  const sq = (p: Pt): Pt => [p[0] * aspect, p[1]];
  const back = (p: Pt): Pt => [p[0] / aspect, p[1]];
  const [first, second] = [...lenses].sort((p, q) => mean(p)[0] - mean(q)[0]);
  const a = sq(mean(first));
  const b = sq(mean(second));
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (span < 1e-4) return null;
  const ux = (b[0] - a[0]) / span;
  const uy = (b[1] - a[1]) / span;
  // Hacia abajo de la cara, sin importar cómo esté inclinada.
  const vx = -uy;
  const vy = ux;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let crown = 0;
  // Solo arriba de los lentes: abajo el contorno se puede confundir con el cuerpo.
  for (const p of outline) {
    const q = sq(p);
    const dx = q[0] - mid[0];
    const dy = q[1] - mid[1];
    if (Math.abs(dx * ux + dy * uy) < span * 0.5) crown = Math.max(crown, -(dx * vx + dy * vy));
  }
  const tall = clamp(crown, span * 0.75, span * 1.5);
  const wide = (loop: Pt[]) => {
    const xs = loop.map((p) => sq(p)[0] * ux + sq(p)[1] * uy);
    return Math.max(...xs) - Math.min(...xs);
  };
  // Con la cabeza medida, el giro es dónde cae el par de lentes dentro de ella. Sin ella,
  // queda la perspectiva: el lente del lado cercano se ve más ancho.
  const lean = head ? clamp(((back(mid)[0] - head.c[0]) / head.rx) * 0.72, -0.6, 0.6) : (wide(first) - wide(second)) / (wide(first) + wide(second) || 1);
  const at = (along: number, down: number): Pt => back([mid[0] + ux * along * span + vx * down * tall, mid[1] + uy * along * span + vy * down * tall]);
  const nose = at(lean * 0.7, 0.42);
  return {
    source: 'dibujo',
    fit68: null,
    contour: [],
    browL: [],
    browR: [],
    eyeL: first,
    eyeR: second,
    irisL: null,
    irisR: null,
    bridge: [],
    noseBase: [nose],
    lips: [],
    lipsInner: null,
    glabella: at(0, -0.1),
    noseTip: nose,
    mouth: at(lean * 0.4, 0.72),
    chin: at(lean * 0.3, 1),
    jawL: at(-0.82, 0.62),
    jawR: at(0.82, 0.62),
  };
}

/** Lleva los 68 de la pose a donde están los ojos: la pose acierta el conjunto, no el ojo. */
function correctPose(pts: Pt[], eyes: { x: number; y: number; w: number; h: number }[], aspect: number): Pt[] {
  const [a, b] = [...eyes].sort((p, q) => p.x - q.x);
  const seenL = mean(at(pts, [36, 37, 38, 39, 40, 41]));
  const seenR = mean(at(pts, [42, 43, 44, 45, 46, 47]));
  const wantL: Pt = [(a.x + a.w / 2) * aspect, a.y + a.h / 2];
  const wantR: Pt = [(b.x + b.w / 2) * aspect, b.y + b.h / 2];
  const fromX = (seenR[0] - seenL[0]) * aspect;
  const fromY = seenR[1] - seenL[1];
  const toX = wantR[0] - wantL[0];
  const toY = wantR[1] - wantL[1];
  const norm = fromX * fromX + fromY * fromY || 1;
  const k = Math.min(1.5, Math.max(0.6, Math.sqrt((toX * toX + toY * toY) / norm)));
  const angle = Math.atan2(toY, toX) - Math.atan2(fromY, fromX);
  const c = Math.cos(angle) * k;
  const s = Math.sin(angle) * k;
  return pts.map(([x, y]) => {
    const px = (x - seenL[0]) * aspect;
    const py = y - seenL[1];
    return [(wantL[0] + c * px - s * py) / aspect, wantL[1] + s * px + c * py];
  });
}

/**
 * Rostro dibujado: lo seguro son los ojos hallados. Boca, nariz y cejas salen de los 24
 * puntos si coincidieron; si no, de la pose, corregida para caer sobre esos ojos.
 */
export function marksFromDrawn(drawn: DrawnFace, pose68: { pts: Pt[]; vis: number[] } | null, aspect: number): FaceMarks | null {
  const { eyes, marks } = drawn;
  if (!pose68 && eyes.length < 2) return null;
  const fixed = pose68 && eyes.length === 2 ? { pts: correctPose(pose68.pts, eyes, aspect), vis: pose68.vis } : pose68;
  const base = fixed ? marksFrom68(fixed.pts, fixed.vis) : null;
  if (eyes.length < 2) return base;
  const [a, b] = [...eyes].sort((p, q) => p.x - q.x);
  const dx = (b.x + b.w / 2 - a.x - a.w / 2) * aspect;
  const dy = b.y + b.h / 2 - a.y - a.h / 2;
  const tilt = Math.atan2(dy, dx);
  const eyeL = boxEye(a, tilt, aspect);
  const eyeR = boxEye(b, tilt, aspect);
  const irisL = mean(eyeL);
  const irisR = mean(eyeR);
  if (marks) {
    const m = marks.pts;
    const swap = Math.abs(m[14][0] - irisL[0]) > Math.abs(m[19][0] - irisL[0]);
    const lips = at(m, [20, 21, 22, 23]);
    const middle = mean([irisL, irisR]);
    return {
      fit68: fixed,
      source: 'dibujo',
      contour: base?.contour ?? at(m, [0, 1, 2]),
      browL: at(m, swap ? [6, 7, 8] : [3, 4, 5]),
      browR: at(m, swap ? [3, 4, 5] : [6, 7, 8]),
      eyeL,
      eyeR,
      irisL,
      irisR,
      // De un dibujo solo se sabe la punta: se marca poco, como la marcaría el dibujante.
      bridge: [[m[9][0] + (middle[0] - m[9][0]) * 0.3, m[9][1] + (middle[1] - m[9][1]) * 0.3], m[9]],
      noseBase: [m[9]],
      lips,
      lipsInner: null,
      glabella: mean([irisL, irisR]),
      noseTip: m[9],
      mouth: mean(lips),
      chin: m[1],
      jawL: m[0],
      jawR: m[2],
    };
  }
  if (!base) return null;
  return { ...base, fit68: fixed, source: 'dibujo', eyeL, eyeR, irisL, irisR };
}

/** Centros de los ojos, de izquierda a derecha en la imagen. */
export function eyeCenters(m: FaceMarks): [Pt, Pt] {
  const a = m.irisL ?? mean(m.eyeL);
  const b = m.irisR ?? mean(m.eyeR);
  return a[0] <= b[0] ? [a, b] : [b, a];
}

/**
 * Corrige un dibujo hecho con el modelo para que pase por los puntos reales: cada punto
 * se mueve lo que se movieron sus anclas cercanas. Por eso cejas, boca y quijada llegan a
 * su sitio aunque la cara tenga otras proporciones que la del modelo.
 */
export function warpTo(anchors: { from: Pt; to: Pt }[], radius: number): (p: Pt) => Pt {
  const eps = radius * radius * 0.012;
  return ([x, y]) => {
    let wx = 0;
    let wy = 0;
    let total = 0;
    for (const { from, to } of anchors) {
      const d = (x - from[0]) ** 2 + (y - from[1]) ** 2 + eps;
      const w = 1 / (d * d);
      wx += w * (to[0] - from[0]);
      wy += w * (to[1] - from[1]);
      total += w;
    }
    return total ? [x + wx / total, y + wy / total] : [x, y];
  };
}

/**
 * Giro y escala de un rostro dibujado, sin suponer un rostro realista: los ojos dan la
 * inclinación, la nariz corrida respecto a ellos el giro, y su separación junto con el
 * largo hasta el mentón la escala. En anime esas dos miden distinto que en una persona,
 * y la media entre ambas da el tamaño real de la cabeza.
 */
export function fitDrawn(m: FaceMarks, aspect: number): OrthoFit | null {
  const real = (p: Pt): Pt => [p[0] * aspect, p[1]];
  const [l, r] = eyeCenters(m).map(real);
  const ex = r[0] - l[0];
  const ey = r[1] - l[1];
  const span = Math.hypot(ex, ey);
  if (span < 1e-5) return null;
  const ux = ex / span;
  const uy = ey / span;
  const midX = (l[0] + r[0]) / 2;
  const midY = (l[1] + r[1]) / 2;
  const nose = real(m.noseTip);
  const chin = real(m.chin);
  const tall = Math.max(span * 0.5, (chin[0] - midX) * -uy + (chin[1] - midY) * ux);
  const shift = (nose[0] - midX) * ux + (nose[1] - midY) * uy;
  const sinYaw = Math.max(-0.85, Math.min(0.85, shift / (tall * 0.42)));
  const cosYaw = Math.sqrt(1 - sinYaw * sinYaw);
  const s = Math.sqrt((tall / 515) * (span / (300 * Math.max(0.5, cosYaw))));
  const a: V3 = [ux * cosYaw, -uy, ux * sinYaw];
  const b: V3 = [uy * cosYaw, ux, uy * sinYaw];
  const c: V3 = [-sinYaw, 0, cosYaw];
  return { a, b, c, s, t: nose };
}

type Side = 1 | -1;
/** Vértices de los planos, en unidades del rostro: y abajo, z hacia quien mira. */
const V = {
  top: (): V3 => [0, -520, -300],
  glabella: (): V3 => [0, -200, -110],
  crown: (s: Side): V3 => [s * 205, -500, -330],
  browIn: (s: Side): V3 => [s * 70, -225, -115],
  browOut: (s: Side): V3 => [s * 232, -230, -200],
  temple: (s: Side): V3 => [s * 335, -250, -420],
  socketOut: (s: Side): V3 => [s * 240, -120, -205],
  socketIn: (s: Side): V3 => [s * 80, -130, -130],
  cheekHigh: (s: Side): V3 => [s * 272, -20, -230],
  cheek: (s: Side): V3 => [s * 142, 30, -115],
  noseTop: (s: Side): V3 => [s * 44, -140, -88],
  tip: (): V3 => [0, 0, 0],
  wing: (s: Side): V3 => [s * 86, 40, -70],
  underNose: (): V3 => [0, 50, -60],
  mouthCorner: (s: Side): V3 => [s * 150, 150, -125],
  lipTop: (): V3 => [0, 72, -68],
  lipLow: (): V3 => [0, 205, -86],
  chin: (): V3 => [0, 345, -70],
  chinSide: (s: Side): V3 => [s * 112, 322, -100],
  jaw: (s: Side): V3 => [s * 300, 175, -430],
  jawMid: (s: Side): V3 => [s * 222, 292, -262],
  ear: (s: Side): V3 => [s * 332, -20, -450],
};

const both = (make: (s: Side) => V3[]): V3[][] => [make(1), make(-1)];

/** La cabeza tallada en planos, como los modelos de Asaro: cada uno recibe una sola luz. */
export const FACE_PLANES: V3[][] = [
  [V.crown(-1), V.crown(1), V.browIn(1), V.glabella(), V.browIn(-1)],
  ...both((s) => [V.crown(s), V.temple(s), V.browOut(s), V.browIn(s)]),
  ...both((s) => [V.browIn(s), V.browOut(s), V.socketOut(s), V.socketIn(s), V.noseTop(s)]),
  ...both((s) => [V.browOut(s), V.temple(s), V.ear(s), V.cheekHigh(s), V.socketOut(s)]),
  [V.noseTop(-1), V.glabella(), V.noseTop(1), V.tip()],
  ...both((s) => [V.noseTop(s), V.tip(), V.wing(s), V.socketIn(s)]),
  [V.wing(-1), V.tip(), V.wing(1), V.underNose()],
  ...both((s) => [V.socketIn(s), V.socketOut(s), V.cheekHigh(s), V.cheek(s), V.wing(s)]),
  ...both((s) => [V.cheekHigh(s), V.ear(s), V.jaw(s), V.jawMid(s), V.mouthCorner(s), V.cheek(s)]),
  ...both((s) => [V.wing(s), V.cheek(s), V.mouthCorner(s), V.lipTop(), V.underNose()]),
  ...both((s) => [V.lipTop(), V.mouthCorner(s), V.lipLow()]),
  ...both((s) => [V.lipLow(), V.mouthCorner(s), V.chinSide(s), V.chin()]),
  ...both((s) => [V.mouthCorner(s), V.jawMid(s), V.chinSide(s)]),
];

/** Índices de la malla por lado de la imagen: el orden es de afuera hacia la nariz. */
const EYE_MESH = {
  a: { outer: 33, inner: 133, upper: [33, 246, 161, 160, 159, 158, 157, 173, 133], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133], crease: [130, 247, 30, 29, 27, 28, 56, 190, 243], under: [130, 25, 110, 24, 23, 22, 26, 112, 243], brow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46] },
  b: { outer: 263, inner: 362, upper: [263, 466, 388, 387, 386, 385, 384, 398, 362], lower: [263, 249, 390, 373, 374, 380, 381, 382, 362], crease: [359, 467, 260, 259, 257, 258, 286, 414, 463], under: [359, 255, 339, 254, 253, 252, 256, 341, 463], brow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276] },
};

/** Puntos de la nariz en el modelo del rostro, para cuando no hay malla. */
const NOSE_MODEL = { top: [0, -175, -108], bridgeL: [-42, -150, -92], bridgeR: [42, -150, -92], tip: [0, 8, 0], wingL: [-84, 42, -74], wingR: [84, 42, -74], base: [0, 52, -60], nostrilL: [-42, 50, -60], nostrilR: [42, 50, -60] } as const;

/**
 * Ojos, nariz y boca listos para verse de cerca. Con malla salen de sus 478 puntos; en un
 * dibujo, los ojos salen de sus píxeles y la nariz del modelo ya ajustado a esa cara.
 */
export function featuresOf(m: FaceMarks, model: (p: V3) => Pt, aspect: number, luma?: (p: Pt) => number): Feature[] {
  const out: Feature[] = [];
  const pick = (list: number[]) => list.map((i) => m.mesh![i]);
  const middle = (m.glabella[0] + m.noseTip[0]) / 2;
  const imageLeftName = tx('face.ojo_izquierdo');
  const imageRightName = tx('face.ojo_derecho');
  if (m.mesh) {
    const pts = m.mesh;
    const iris = (c: Pt) => {
      const pair = [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]].map((ring) => ring.map((i) => pts[i]));
      const hit = pair.reduce((best, ring) => (Math.hypot(ring[0][0] - c[0], ring[0][1] - c[1]) < Math.hypot(best[0][0] - c[0], best[0][1] - c[1]) ? ring : best));
      const r = hit.slice(1).reduce((sum, p) => sum + Math.hypot((p[0] - hit[0][0]) * aspect, p[1] - hit[0][1]), 0) / 4;
      return { center: hit[0], r };
    };
    for (const side of [EYE_MESH.a, EYE_MESH.b]) {
      const a = pts[side.outer];
      const b = pts[side.inner];
      const found = iris(mean([a, b]));
      const shape: EyeShape = { outer: a, inner: b, upper: pick(side.upper), lower: pick(side.lower), iris: found.center, irisR: found.r, crease: pick(side.crease), under: pick(side.under), brow: pick(side.brow) };
      const onLeft = (a[0] + b[0]) / 2 < middle;
      out.push(eyeFeature(onLeft ? 'ojoL' : 'ojoR', onLeft ? imageLeftName : imageRightName, shape, aspect));
    }
    const nose: NoseShape = {
      top: pts[168],
      bridgeL: pts[193],
      bridgeR: pts[417],
      tip: pts[1],
      wingL: pts[64],
      wingR: pts[294],
      base: pts[2],
      nostrilL: mean(at(pts, [75, 60, 20])),
      nostrilR: mean(at(pts, [305, 290, 250])),
      edge: at(pts, [129, 49, 64, 98, 97, 2, 326, 327, 294, 279, 358]),
    };
    if (nose.wingL[0] > nose.wingR[0]) {
      [nose.wingL, nose.wingR] = [nose.wingR, nose.wingL];
      [nose.bridgeL, nose.bridgeR] = [nose.bridgeR, nose.bridgeL];
      [nose.nostrilL, nose.nostrilR] = [nose.nostrilR, nose.nostrilL];
    }
    out.push(noseFeature(nose, aspect));
    out.push(mouthFeature({ cornerL: pts[61], cornerR: pts[291], top: pts[0], bottom: pts[17], outer: at(pts, LIPS), seam: at(pts, [61, 76, 62, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 292, 306, 291]) }, aspect));
  } else {
    const eyeOf = (loop: Pt[], iris: Pt | null, brow: Pt[], side: 'ojoL' | 'ojoR', name: string, box: boolean) => {
      const xs = loop.map((p) => p[0]);
      const ys = loop.map((p) => p[1]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const toward: 1 | -1 = rect.x + rect.w / 2 < middle ? 1 : -1;
      if (box && luma) {
        const read = eyeFromPixels(rect, luma, aspect, toward);
        out.push(eyeFeature(side, name, { ...read, brow: brow.length > 2 ? brow : null }, aspect, true));
        return;
      }
      const left = loop.reduce((b, p) => (p[0] < b[0] ? p : b));
      const right = loop.reduce((b, p) => (p[0] > b[0] ? p : b));
      const [outer, inner] = toward > 0 ? [left, right] : [right, left];
      const cy = rect.y + rect.h / 2;
      const order = (list: Pt[]) => [...list].sort((p, q) => (toward > 0 ? p[0] - q[0] : q[0] - p[0]));
      out.push(eyeFeature(side, name, { outer, inner, upper: order(loop.filter((p) => p[1] <= cy)), lower: order(loop.filter((p) => p[1] > cy)), iris, irisR: null, crease: null, under: null, brow: brow.length > 2 ? brow : null }, aspect));
    };
    const drawn = m.source === 'dibujo';
    const first = m.eyeL[0][0] <= m.eyeR[0][0];
    eyeOf(first ? m.eyeL : m.eyeR, first ? m.irisL : m.irisR, first ? m.browL : m.browR, 'ojoL', imageLeftName, drawn);
    eyeOf(first ? m.eyeR : m.eyeL, first ? m.irisR : m.irisL, first ? m.browR : m.browL, 'ojoR', imageRightName, drawn);
    const shape = Object.fromEntries(Object.entries(NOSE_MODEL).map(([k, p]) => [k, model(p as unknown as V3)])) as unknown as NoseShape;
    if (shape.wingL[0] > shape.wingR[0]) {
      [shape.wingL, shape.wingR] = [shape.wingR, shape.wingL];
      [shape.bridgeL, shape.bridgeR] = [shape.bridgeR, shape.bridgeL];
      [shape.nostrilL, shape.nostrilR] = [shape.nostrilR, shape.nostrilL];
    }
    out.push(noseFeature({ ...shape, edge: m.source === 'pose' ? m.noseBase : null }, aspect));
    if (m.lips.length >= 4) {
      const left = m.lips.reduce((b, p) => (p[0] < b[0] ? p : b));
      const right = m.lips.reduce((b, p) => (p[0] > b[0] ? p : b));
      const high = m.lips.reduce((b, p) => (p[1] < b[1] ? p : b));
      const low = m.lips.reduce((b, p) => (p[1] > b[1] ? p : b));
      out.push(mouthFeature({ cornerL: left, cornerR: right, top: high, bottom: low, outer: m.source === 'pose' ? m.lips : null, seam: m.lipsInner?.slice(0, 5) ?? null }, aspect));
    }
  }
  return out.sort((p, q) => p.id.localeCompare(q.id));
}
