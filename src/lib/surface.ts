import { HAND_L, HAND_R, MHR, vertexNormals, type Body3D } from './body';
import { maskContours, simplifyLoop } from './edges';
import { POSE } from './gesture';
import { measureProfile, refineWithMask, type PartProfile, type ShapeKind } from './shapes';
import type { Facet } from './pieces';
import type { Rig, V3 } from './rig';
import type { Pt } from './types';

/**
 * La superficie real del cuerpo. La red ya entrega una malla de 18 mil vértices en la pose de
 * la imagen, y calza mejor que cualquier forma inventada en 2D: por eso los contornos, las
 * cintas y los planos se leen de ella. Lo que se dibuja cae donde debe porque es geometría.
 */
export const PART = {
  cabeza: 0,
  cuello: 1,
  pecho: 2,
  vientre: 3,
  pelvis: 4,
  brazoL: 5,
  brazoR: 6,
  antebrazoL: 7,
  antebrazoR: 8,
  manoL: 9,
  manoR: 10,
  musloL: 11,
  musloR: 12,
  piernaL: 13,
  piernaR: 14,
  pieL: 15,
  pieR: 16,
} as const;

const COUNT = 17;

/** Grosor de cada parte respecto al ancho de hombros: solo sirve para repartir los vértices. */
const REACH = [0.42, 0.2, 0.62, 0.5, 0.45, 0.17, 0.17, 0.14, 0.14, 0.13, 0.13, 0.26, 0.26, 0.18, 0.18, 0.14, 0.14];

/** Qué partes comparten articulación: ahí se reparte el peso de la piel. */
const NEXT: number[][] = [[1], [0, 2], [1, 3, 5, 6], [2, 4], [3, 11, 12], [2, 7], [2, 8], [5, 9], [6, 10], [7], [8], [4, 13], [4, 14], [11, 15], [12, 16], [13], [14]];

/** Cintas por parte: las masas grandes llevan más, porque ahí se lee mejor el volumen. */
const BANDS = [0, 1, 6, 3, 2, 3, 3, 3, 3, 0, 0, 4, 4, 4, 4, 1, 1];

/** Planos a lo largo y alrededor de cada parte. */
const CELLS: [number, number][] = [[3, 8], [1, 6], [4, 8], [2, 8], [2, 8], [3, 6], [3, 6], [3, 6], [3, 6], [2, 4], [2, 4], [4, 6], [4, 6], [4, 6], [4, 6], [3, 5], [3, 5]];

type Bone = { a: V3; b: V3 };

const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const mul = (p: V3, k: number): V3 => [p[0] * k, p[1] * k, p[2] * k];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const size = (p: V3) => Math.hypot(p[0], p[1], p[2]);
const unit = (p: V3): V3 => {
  const n = size(p) || 1;
  return [p[0] / n, p[1] / n, p[2] / n];
};
const mix = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/** Los huesos de cada parte, a partir de las articulaciones. */
function bonesOf(J: V3[]): Bone[] {
  const pelvis = mix(J[MHR.hipL], J[MHR.hipR], 0.5);
  const neck = J[MHR.neck];
  const belly = mix(pelvis, neck, 0.45);
  const ears = mix(J[MHR.earL], J[MHR.earR], 0.5);
  const top = mix(neck, ears, 0.5);
  const crown = add(ears, mul(sub(ears, neck), 0.55));
  const bone = (a: V3, b: V3): Bone => ({ a, b });
  return [
    bone(top, crown),
    bone(neck, top),
    bone(neck, belly),
    bone(belly, pelvis),
    bone(J[MHR.hipL], J[MHR.hipR]),
    bone(J[MHR.shoulderL], J[MHR.elbowL]),
    bone(J[MHR.shoulderR], J[MHR.elbowR]),
    bone(J[MHR.elbowL], J[MHR.wristL]),
    bone(J[MHR.elbowR], J[MHR.wristR]),
    bone(J[MHR.wristL], J[HAND_L[2][0]]),
    bone(J[MHR.wristR], J[HAND_R[2][0]]),
    bone(J[MHR.hipL], J[MHR.kneeL]),
    bone(J[MHR.hipR], J[MHR.kneeR]),
    bone(J[MHR.kneeL], J[MHR.ankleL]),
    bone(J[MHR.kneeR], J[MHR.ankleR]),
    bone(J[MHR.ankleL], J[MHR.toeL]),
    bone(J[MHR.ankleR], J[MHR.toeR]),
  ];
}

function distanceToBone(x: number, y: number, z: number, b: Bone): number {
  const ax = b.b[0] - b.a[0];
  const ay = b.b[1] - b.a[1];
  const az = b.b[2] - b.a[2];
  const px = x - b.a[0];
  const py = y - b.a[1];
  const pz = z - b.a[2];
  const len = ax * ax + ay * ay + az * az || 1e-9;
  const t = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / len));
  return Math.hypot(px - ax * t, py - ay * t, pz - az * t);
}

export interface Skin {
  /** Parte principal de cada vértice. */
  part: Uint8Array;
  /** Segunda parte y cuánto pesa. */
  other: Uint8Array;
  weight: Float32Array;
}

/** Reparte los vértices entre las partes y suaviza la frontera con las vecinas. */
/**
 * Lo que la pose casi no vio: la red entrega un cuerpo entero aunque las piernas estén detrás de
 * una mesa, y esa propuesta no se puede afirmar ni usar para guiar el recorte.
 */
export function unseenParts(rel: number[]): number[] {
  const out: number[] = [];
  if (rel[POSE.wristL] < 0.35) out.push(PART.antebrazoL, PART.manoL);
  if (rel[POSE.wristR] < 0.35) out.push(PART.antebrazoR, PART.manoR);
  if (rel[POSE.elbowL] < 0.3) out.push(PART.brazoL);
  if (rel[POSE.elbowR] < 0.3) out.push(PART.brazoR);
  const legs = [
    [POSE.hipL, POSE.kneeL, POSE.ankleL, PART.musloL, PART.piernaL, PART.pieL],
    [POSE.hipR, POSE.kneeR, POSE.ankleR, PART.musloR, PART.piernaR, PART.pieR],
  ] as const;
  for (const [hip, knee, ankle, thigh, shin, foot] of legs) {
    if (rel[ankle] < 0.35) out.push(foot);
    if (rel[knee] < 0.35) out.push(shin, foot);
    if (rel[knee] < 0.35 && rel[hip] < 0.45) out.push(thigh);
  }
  if (rel[POSE.hipL] < 0.45 && rel[POSE.hipR] < 0.45) out.push(PART.pelvis);
  return [...new Set(out)];
}

/** La parte del cuerpo de cada vértice, con la malla tal como la entrega la red. */
export function partsOfMesh(body: Pick<Body3D, 'vertices' | 'joints'>, faces: Int32Array): Uint8Array {
  const V = body.vertices;
  const n = V.length / 3;
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = V[i * 3];
    Y[i] = V[i * 3 + 1];
    Z[i] = V[i * 3 + 2];
  }
  const J: V3[] = [];
  for (let i = 0; i < body.joints.length / 3; i++) J.push([body.joints[i * 3], body.joints[i * 3 + 1], body.joints[i * 3 + 2]]);
  const width = size(sub(J[MHR.shoulderL], J[MHR.shoulderR])) || 1;
  return skinOf(X, Y, Z, faces, bonesOf(J), width).part;
}

export function skinOf(X: Float32Array, Y: Float32Array, Z: Float32Array, faces: Int32Array, bones: Bone[], width: number): Skin {
  const n = X.length;
  const part = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let least = Infinity;
    for (let b = 0; b < COUNT; b++) {
      const d = distanceToBone(X[i], Y[i], Z[i], bones[b]) / (REACH[b] * width);
      if (d < least) {
        least = d;
        best = b;
      }
    }
    part[i] = best;
  }
  // El antebrazo entra un poco bajo la palma, o quedaría un hueco entre el brazo y la mano.
  for (const [hand, arm] of [[PART.manoL, PART.antebrazoL], [PART.manoR, PART.antebrazoR]] as const) {
    const bone = bones[hand];
    const dir = sub(bone.b, bone.a);
    const span = dot(dir, dir) || 1e-9;
    for (let i = 0; i < n; i++) {
      if (part[i] !== hand) continue;
      if (((X[i] - bone.a[0]) * dir[0] + (Y[i] - bone.a[1]) * dir[1] + (Z[i] - bone.a[2]) * dir[2]) / span < 0.3) part[i] = arm;
    }
  }
  // Dos pasadas de mayoría: un dedo que roza el muslo no debe volverse muslo.
  for (let round = 0; round < 2; round++) {
    const votes = new Uint16Array(n * COUNT);
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t];
      const b = faces[t + 1];
      const c = faces[t + 2];
      votes[a * COUNT + part[b]]++;
      votes[a * COUNT + part[c]]++;
      votes[b * COUNT + part[a]]++;
      votes[b * COUNT + part[c]]++;
      votes[c * COUNT + part[a]]++;
      votes[c * COUNT + part[b]]++;
    }
    for (let i = 0; i < n; i++) {
      let best = part[i];
      let most = votes[i * COUNT + best];
      for (let b = 0; b < COUNT; b++) {
        if (votes[i * COUNT + b] > most) {
          most = votes[i * COUNT + b];
          best = b;
        }
      }
      part[i] = best;
    }
  }
  const other = new Uint8Array(n);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const own = part[i];
    const mine = distanceToBone(X[i], Y[i], Z[i], bones[own]) / (REACH[own] * width);
    let least = Infinity;
    let pick = own;
    for (const b of NEXT[own]) {
      const d = distanceToBone(X[i], Y[i], Z[i], bones[b]) / (REACH[b] * width);
      if (d < least) {
        least = d;
        pick = b;
      }
    }
    other[i] = pick;
    weight[i] = pick === own ? 0 : Math.max(0, Math.min(0.5, 0.5 - (least - mine) * 1.6));
  }
  return { part, other, weight };
}

interface Move {
  a0: V3;
  a1: V3;
  u: V3;
  /** Rotación como matriz por filas. */
  r: number[];
  stretch: number;
}

/** Del hueso original al de la imagen: giro, largo y lugar. */
function moveOf(from: Bone, to: Bone): Move {
  const d0 = sub(from.b, from.a);
  const d1 = sub(to.b, to.a);
  const u0 = unit(d0);
  const u1 = unit(d1);
  const c = dot(u0, u1);
  const v = cross(u0, u1);
  const s = 1 / (1 + c || 1e-6);
  const r = c < -0.9999
    ? [-1, 0, 0, 0, -1, 0, 0, 0, 1]
    : [
        1 - s * (v[1] * v[1] + v[2] * v[2]), s * v[0] * v[1] - v[2], s * v[0] * v[2] + v[1],
        s * v[0] * v[1] + v[2], 1 - s * (v[0] * v[0] + v[2] * v[2]), s * v[1] * v[2] - v[0],
        s * v[0] * v[2] - v[1], s * v[1] * v[2] + v[0], 1 - s * (v[0] * v[0] + v[1] * v[1]),
      ];
  return { a0: from.a, a1: to.a, u: u0, r, stretch: size(d1) / (size(d0) || 1e-6) };
}

function apply(m: Move, x: number, y: number, z: number, out: Float32Array, thick = 1) {
  let px = x - m.a0[0];
  let py = y - m.a0[1];
  let pz = z - m.a0[2];
  const along = px * m.u[0] + py * m.u[1] + pz * m.u[2];
  // Lo largo sigue al hueso; lo ancho, al personaje.
  px = m.u[0] * along * m.stretch + (px - m.u[0] * along) * thick;
  py = m.u[1] * along * m.stretch + (py - m.u[1] * along) * thick;
  pz = m.u[2] * along * m.stretch + (pz - m.u[2] * along) * thick;
  out[0] = m.a1[0] + m.r[0] * px + m.r[1] * py + m.r[2] * pz;
  out[1] = m.a1[1] + m.r[3] * px + m.r[4] * py + m.r[5] * pz;
  out[2] = m.a1[2] + m.r[6] * px + m.r[7] * py + m.r[8] * pz;
}

/** Línea de la superficie, ya en fracciones del encuadre. */
export interface SurfaceLine {
  pts: Pt[];
  part: number;
  /** Cerca de 1, más cerca de quien mira. */
  near: number;
  /** Una forma tapa a otra: ahí va el peso de línea. */
  overlap: boolean;
}

export interface BodySurface {
  /** Silueta completa del cuerpo. */
  fill: Pt[][];
  /** La sombra propia de la forma, y su contrario para dibujar sobre fondo oscuro. */
  shade: Pt[][];
  lit: Pt[][];
  lines: SurfaceLine[];
  /** Cintas que rodean cada masa. */
  bands: Pt[][];
  /** Línea central del tronco. */
  center: Pt[][];
  planes: Facet[];
  /** Medidas reales de cada parte, en altos de encuadre. */
  radii: [number, number][];
  /** La cabeza vista: su centro y sus radios en fracciones del encuadre. */
  head: { c: Pt; rx: number; ry: number } | null;
  /** Partes que no se dibujan aquí: la cabeza y las manos van aparte. */
  hidden: number[];
  /** Miembros que la red propuso pero la imagen no muestra. */
  absent: number[];
  /** Qué parte de la malla cae dentro de la figura: dice si la lectura es buena. */
  inside: number;
  /** Veces que la figura es mayor que el cuerpo: ropa suelta u objetos. */
  extra: number;
  /** Tórax y pelvis medidos: centro y medio ancho, medio alto y media profundidad. */
  chest: { c: V3; a: number; b: number; d: number } | null;
  hips: { c: V3; a: number; b: number; d: number } | null;
  /** El ancho real de cada parte a lo largo de su hueso. */
  profiles: PartProfile[];
}

export interface SurfaceInput {
  body: Pick<Body3D, 'vertices'>;
  faces: Int32Array;
  rig: Rig;
  aspect: number;
  /** La figura real, sin lo que carga: de ahí sale el grosor de este personaje. */
  mask?: { data: Uint8Array; w: number; h: number };
  /** Partes que se dibujan aparte: la cabeza, y las manos si se detectaron. */
  skip?: number[];
  /** Se está moviendo el esqueleto: grosor y reparto ya se conocen, no se vuelven a medir. */
  moving?: boolean;
  /** Partes que la pose no alcanzó a ver: la red las propone, pero no hay con qué afirmarlas. */
  unseen?: number[];
}

/** Lo que no cambia al mover una articulación. Repartir la malla es lo más caro de todo. */
interface Bound {
  sign: string;
  BX: Float32Array;
  BY: Float32Array;
  BZ: Float32Array;
  skin: Skin;
  thick: Float32Array | null;
  /** Partes que la red propuso pero la imagen no muestra. */
  absent: number[];
}

const bound = new WeakMap<Float32Array, Bound>();

const GRID = 760;

const skip_has = (list: number[] | undefined, part: number) => !!list?.includes(part);

/** Cruces de un valor por cero en la malla, encadenados en líneas continuas. */
function isoLines(faces: Int32Array, tris: number[], f: Float32Array, X: Float32Array, Y: Float32Array, Z: Float32Array, keep: (x: number, y: number, z: number, tri: number) => boolean): V3[][] {
  const n = X.length;
  const spot = new Map<number, V3>();
  const links = new Map<number, number[]>();
  const pairs: [number, number][] = [];
  const crossing = (a: number, b: number): number | null => {
    if (f[a] > 0 === f[b] > 0) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * n + hi;
    if (!spot.has(key)) {
      const t = f[lo] / (f[lo] - f[hi]);
      spot.set(key, [X[lo] + (X[hi] - X[lo]) * t, Y[lo] + (Y[hi] - Y[lo]) * t, Z[lo] + (Z[hi] - Z[lo]) * t]);
    }
    return key;
  };
  for (const t of tris) {
    const a = faces[t];
    const b = faces[t + 1];
    const c = faces[t + 2];
    const hits = [crossing(a, b), crossing(b, c), crossing(c, a)].filter((k): k is number => k !== null);
    if (hits.length !== 2) continue;
    const p = spot.get(hits[0])!;
    const q = spot.get(hits[1])!;
    if (!keep((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, t)) continue;
    const id = pairs.length;
    pairs.push([hits[0], hits[1]]);
    for (const k of hits) {
      const list = links.get(k);
      if (list) list.push(id);
      else links.set(k, [id]);
    }
  }
  const used = new Uint8Array(pairs.length);
  const out: V3[][] = [];
  const walk = (from: number, start: number): V3[] => {
    const line: V3[] = [];
    let key = from;
    let seg = start;
    for (;;) {
      used[seg] = 1;
      const [p, q] = pairs[seg];
      key = p === key ? q : p;
      line.push(spot.get(key)!);
      const next = (links.get(key) ?? []).find((s) => !used[s]);
      if (next === undefined) return line;
      seg = next;
    }
  };
  for (let i = 0; i < pairs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [p, q] = pairs[i];
    const forward = walk(q, i === -1 ? 0 : (links.get(q) ?? []).find((s) => !used[s]) ?? i);
    const back = walk(p, (links.get(p) ?? []).find((s) => !used[s]) ?? i);
    out.push([...back.reverse(), spot.get(p)!, spot.get(q)!, ...forward]);
  }
  return out;
}

/** Lleva la malla al encuadre y la reparte entre los huesos, una sola vez por lectura. */
function bind(input: SurfaceInput): Bound {
  const { body, faces, rig, aspect } = input;
  const V = body.vertices;
  const n = V.length / 3;
  const { k, ox, oy, rootZ } = rig.place!;
  const sign = [k, ox, oy, rootZ, aspect].join();
  const known = bound.get(V);
  if (known && known.sign === sign) return known;
  const BX = new Float32Array(n);
  const BY = new Float32Array(n);
  const BZ = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    BX[i] = V[i * 3] * k + ox;
    BY[i] = V[i * 3 + 1] * k + oy;
    BZ[i] = -(V[i * 3 + 2] - rootZ) * k;
  }
  const width = size(sub(rig.base![MHR.shoulderL], rig.base![MHR.shoulderR])) || rig.H;
  const held: Bound = { sign, BX, BY, BZ, skin: skinOf(BX, BY, BZ, faces, bonesOf(rig.base!), width), thick: null, absent: [] };
  bound.set(V, held);
  return held;
}

/**
 * Acomoda el tronco contra la silueta, probando y comparando: es dibujar y mirar. Un personaje
 * estilizado no tiene los hombros de un adulto promedio, y eso no se corrige con una regla.
 * Devuelve cuánto mover cada articulación del tronco; las manos y los pies no se tocan.
 */
export function fitTrunk(input: SurfaceInput): Record<number, V3> {
  const { rig, faces, aspect, mask } = input;
  if (!mask || !rig.base || !rig.place) return {};
  const { BX, BY, BZ, skin } = bind(input);
  const n = BX.length;
  const rest = bonesOf(rig.base);
  const gh = 190;
  const gw = Math.max(8, Math.round(aspect * gh));
  const figure = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const my = Math.min(mask.h - 1, Math.floor(((y + 0.5) / gh) * mask.h));
    for (let x = 0; x < gw; x++) figure[y * gw + x] = mask.data[my * mask.w + Math.min(mask.w - 1, Math.floor(((x + 0.5) / gw) * mask.w))] ? 1 : 0;
  }
  // La parte de la figura que le toca al tronco: alrededor de la columna, no la espada.
  const spine = bonesOf(rig.pts);
  const band = new Uint8Array(gw * gh);
  const near = rig.H * 1.15;
  // La cabeza y su pelo no son tronco: si contaran, al tronco le convendría subirse al pelo.
  const ears = [rig.pts[MHR.earL], rig.pts[MHR.earR], rig.pts[MHR.nose]];
  const head: V3 = [(ears[0][0] + ears[1][0] + ears[2][0]) / 3, (ears[0][1] + ears[1][1] + ears[2][1]) / 3, 0];
  const headR = rig.H * 0.78;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const px = (x + 0.5) / gh;
      const py = (y + 0.5) / gh;
      if (Math.hypot(px - head[0], py - head[1]) < headR) {
        // Ni se exige cubrirla ni se castiga entrar: lo decide el resto del cuerpo.
        figure[y * gw + x] = 2;
        continue;
      }
      for (const b of [PART.pecho, PART.vientre, PART.pelvis]) {
        if (distanceToBone(px, py, spine[b].a[2], spine[b]) < near) {
          band[y * gw + x] = 1;
          break;
        }
      }
    }
  }
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const hold = new Float32Array(3);
  const solid = new Uint8Array(gw * gh);
  const cost = (pts: V3[]) => {
    const now = bonesOf(pts);
    const moves = rest.map((b, i) => moveOf(b, now[i]));
    for (let i = 0; i < n; i++) {
      apply(moves[skin.part[i]], BX[i], BY[i], BZ[i], hold);
      X[i] = hold[0] * gh;
      Y[i] = hold[1] * gh;
    }
    solid.fill(0);
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t];
      const b = faces[t + 1];
      const c = faces[t + 2];
      const part = skin.part[a];
      // Lo que se dibuja aparte (cabeza, manos) y lo que la pose no vio no juzga al tronco: un
      // brazo escondido tras la espalda, inventado junto a la cara, subía el hombro hasta el pelo.
      if (part === PART.cabeza || part === PART.manoL || part === PART.manoR || skip_has(input.skip, part)) continue;
      const area = (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
      if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(X[a], X[b], X[c])));
      const x1 = Math.min(gw - 1, Math.ceil(Math.max(X[a], X[b], X[c])));
      const y0 = Math.max(0, Math.floor(Math.min(Y[a], Y[b], Y[c])));
      const y1 = Math.min(gh - 1, Math.ceil(Math.max(Y[a], Y[b], Y[c])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const w0 = ((X[b] - x) * (Y[c] - y) - (Y[b] - y) * (X[c] - x)) / area;
          const w1 = ((X[c] - x) * (Y[a] - y) - (Y[c] - y) * (X[a] - x)) / area;
          if (w0 >= -0.02 && w1 >= -0.02 && w0 + w1 <= 1.02) solid[y * gw + x] = 1;
        }
      }
    }
    let wrong = 0;
    for (let i = 0; i < solid.length; i++) {
      if (figure[i] === 2) continue;
      if (solid[i] && !figure[i]) wrong += 1;
      else if (!solid[i] && figure[i] && band[i]) wrong += 0.6;
    }
    return wrong;
  };
  const joints = [MHR.neck, MHR.shoulderL, MHR.shoulderR, MHR.hipL, MHR.hipR];
  const pts = rig.pts.map((p) => [...p] as V3);
  const shift: Record<number, V3> = Object.fromEntries(joints.map((j) => [j, [0, 0, 0] as V3]));
  const limit = rig.H * 0.7;
  const groups: { list: number[]; dir: (j: number) => V3 }[] = [];
  const along = (a: number, b: number, s: number): V3 => {
    const d = unit(sub(pts[b], pts[a]));
    return [d[0] * s, d[1] * s, 0];
  };
  for (const [ux, uy] of [[1, 0], [0, 1]]) {
    const dir = (): V3 => [ux, uy, 0];
    groups.push({ list: joints, dir }, { list: [MHR.neck, MHR.shoulderL, MHR.shoulderR], dir }, { list: [MHR.hipL, MHR.hipR], dir }, { list: [MHR.shoulderL], dir }, { list: [MHR.shoulderR], dir }, { list: [MHR.neck], dir });
  }
  // Abrir o cerrar los hombros: es lo que más cambia de un personaje a otro.
  groups.push({ list: [MHR.shoulderL, MHR.shoulderR], dir: (j) => (j === MHR.shoulderL ? along(MHR.shoulderL, MHR.shoulderR, 1) : along(MHR.shoulderR, MHR.shoulderL, 1)) });
  let best = cost(pts);
  let step = rig.H * 0.16;
  for (let round = 0; round < 3; round++) {
    for (const g of groups) {
      for (const sign of [1, -1]) {
        const moved = g.list.map((j): [number, V3] => {
          const d = g.dir(j);
          return [j, [pts[j][0] + d[0] * step * sign, pts[j][1] + d[1] * step * sign, pts[j][2]]];
        });
        if (moved.some(([j, p]) => Math.hypot(p[0] - rig.pts[j][0], p[1] - rig.pts[j][1]) > limit)) continue;
        // El cuello y los hombros no se meten en la cabeza: la red ya sabe cuánto mide el cuello.
        if (moved.some(([j, p]) => (j === MHR.neck || j === MHR.shoulderL || j === MHR.shoulderR) && Math.hypot(p[0] - head[0], p[1] - head[1]) < Math.hypot(rig.pts[j][0] - head[0], rig.pts[j][1] - head[1]) * 0.85)) continue;
        const keep = moved.map(([j]) => pts[j]);
        for (const [j, p] of moved) pts[j] = p;
        const now = cost(pts);
        if (now < best * 0.995) {
          best = now;
          break;
        }
        moved.forEach(([j], i) => (pts[j] = keep[i]));
      }
    }
    step /= 2;
  }
  for (const j of joints) shift[j] = sub(pts[j], rig.pts[j]);
  return shift;
}

/**
 * Pone la malla en la pose de la imagen y lee de ella todo lo dibujable. Mide en la misma
 * unidad que el esqueleto: x e y en altos de encuadre, y z es la cercanía a quien mira.
 */
export function buildSurface(input: SurfaceInput): BodySurface | null {
  const { body, faces, rig, aspect } = input;
  if (!rig.base || !rig.place) return null;
  const V = body.vertices;
  const n = V.length / 3;
  const rest = bonesOf(rig.base);
  const now = bonesOf(rig.pts);
  const held = bind(input);
  const { BX, BY, BZ, skin } = held;
  const moves = rest.map((b, i) => moveOf(b, now[i]));
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);
  const one = new Float32Array(3);
  const two = new Float32Array(3);
  const place = (thick: Float32Array) => {
    for (let i = 0; i < n; i++) {
      apply(moves[skin.part[i]], BX[i], BY[i], BZ[i], one, thick[skin.part[i]]);
      const w = skin.weight[i];
      if (w > 0) {
        apply(moves[skin.other[i]], BX[i], BY[i], BZ[i], two, thick[skin.other[i]]);
        X[i] = one[0] * (1 - w) + two[0] * w;
        Y[i] = one[1] * (1 - w) + two[1] * w;
        Z[i] = one[2] * (1 - w) + two[2] * w;
      } else {
        X[i] = one[0];
        Y[i] = one[1];
        Z[i] = one[2];
      }
    }
  };
  const gw = Math.max(8, Math.round(aspect * GRID));
  const gh = GRID;
  const depth = new Float32Array(gw * gh);
  const ids = new Int32Array(gw * gh);
  // Profundidad por píxel: decide qué se ve y qué queda detrás.
  const raster = () => {
    depth.fill(-Infinity);
    ids.fill(-1);
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t];
      const b = faces[t + 1];
      const c = faces[t + 2];
      const ax = X[a] * gh;
      const ay = Y[a] * gh;
      const bx = X[b] * gh;
      const by = Y[b] * gh;
      const cx2 = X[c] * gh;
      const cy2 = Y[c] * gh;
      const area = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
      if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx2)));
      const x1 = Math.min(gw - 1, Math.ceil(Math.max(ax, bx, cx2)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy2)));
      const y1 = Math.min(gh - 1, Math.ceil(Math.max(ay, by, cy2)));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const w0 = ((bx - x) * (cy2 - y) - (by - y) * (cx2 - x)) / area;
          const w1 = ((cx2 - x) * (ay - y) - (cy2 - y) * (ax - x)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
          const z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c];
          const i = y * gw + x;
          if (z > depth[i]) {
            depth[i] = z;
            ids[i] = t;
          }
        }
      }
    }
  };
  const known = input.moving ? held.thick : null;
  const thick = known ?? new Float32Array(COUNT).fill(1);
  place(thick);
  const { mask } = input;
  if (mask && !known) {
    raster();
    // El mismo rayo sobre la malla y sobre la figura: su razón es el grosor del personaje.
    const onMesh = (x: number, y: number) => {
      const px = Math.round(x * gh);
      const py = Math.round(y * gh);
      return px >= 0 && py >= 0 && px < gw && py < gh && ids[py * gw + px] >= 0;
    };
    const onFigure = (x: number, y: number) => {
      const px = Math.floor((x / aspect) * mask.w);
      const py = Math.floor(y * mask.h);
      return px >= 0 && py >= 0 && px < mask.w && py < mask.h && mask.data[py * mask.w + px] > 0;
    };
    const span = (on: (x: number, y: number) => boolean, x: number, y: number, nx: number, ny: number, limit: number) => {
      let total = 0;
      for (const sign of [1, -1]) {
        for (let d = 0; d < limit; d += 1 / gh) {
          if (!on(x + nx * d * sign, y + ny * d * sign)) break;
          total += 1 / gh;
        }
      }
      return total;
    };
    for (let b = 0; b < COUNT; b++) {
      if (skip_has(input.skip, b) || b === PART.cuello) continue;
      const { a, b: end } = now[b];
      const dx = end[0] - a[0];
      const dy = end[1] - a[1];
      const flat = Math.hypot(dx, dy);
      // De frente un hueso no tiene ancho que comparar.
      if (flat < rig.H * 0.5) continue;
      const ratios: number[] = [];
      for (const t of [0.3, 0.42, 0.54, 0.66]) {
        const x = a[0] + dx * t;
        const y = a[1] + dy * t;
        if (!onMesh(x, y) || !onFigure(x, y)) continue;
        const mine = span(onMesh, x, y, -dy / flat, dx / flat, rig.H * 2.4);
        if (mine > 0) ratios.push(span(onFigure, x, y, -dy / flat, dx / flat, rig.H * 2.4) / mine);
      }
      if (ratios.length < 2) continue;
      ratios.sort((p, q) => p - q);
      thick[b] = Math.max(0.74, Math.min(1.12, ratios[ratios.length >> 1]));
    }
    // Un personaje no tiene un brazo gordo y otro flaco.
    for (const [l, r] of [[PART.brazoL, PART.brazoR], [PART.antebrazoL, PART.antebrazoR], [PART.musloL, PART.musloR], [PART.piernaL, PART.piernaR]]) {
      const both = Math.min(thick[l], thick[r]);
      thick[l] = both;
      thick[r] = both;
    }
    place(thick);
    held.thick = thick;
  }

  // Normales hacia afuera, sea cual sea el orden de los triángulos.
  const packed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    packed[i * 3] = X[i];
    packed[i * 3 + 1] = Y[i];
    packed[i * 3 + 2] = Z[i];
  }
  const N = vertexNormals(packed, faces);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += X[i];
    cy += Y[i];
    cz += Z[i];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let outward = 0;
  for (let i = 0; i < n; i++) outward += N[i * 3] * (X[i] - cx) + N[i * 3 + 1] * (Y[i] - cy) + N[i * 3 + 2] * (Z[i] - cz);
  if (outward < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i];
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = N[i * 3 + 2];

  raster();
  const skip = new Set(input.skip ?? []);
  if (mask && !known) {
    // La red siempre propone un cuerpo entero: un brazo detrás de un cuaderno no se inventa.
    const seen = new Float32Array(COUNT);
    const all = new Float32Array(COUNT);
    for (let y = 0; y < gh; y += 2) {
      for (let x = 0; x < gw; x += 2) {
        const t = ids[y * gw + x];
        if (t < 0) continue;
        const p = skin.part[faces[t]];
        all[p]++;
        // Una tolerancia de unos píxeles: el borde de la silueta no decide.
        const mx = Math.floor((x / gw) * mask.w);
        const my = Math.floor((y / gh) * mask.h);
        const step = Math.max(1, Math.round(mask.h / 90));
        let on = false;
        for (let dy = -step; dy <= step && !on; dy += step) {
          for (let dx = -step; dx <= step && !on; dx += step) {
            const qx = mx + dx;
            const qy = my + dy;
            if (qx >= 0 && qy >= 0 && qx < mask.w && qy < mask.h && mask.data[qy * mask.w + qx]) on = true;
          }
        }
        if (on) seen[p]++;
      }
    }
    const absent = new Set<number>();
    const check = (list: number[]) => {
      let gone = false;
      for (const p of list) {
        // Lo que cuelga de algo ausente tampoco está.
        if (gone || (all[p] > 8 && seen[p] / all[p] < 0.5)) {
          gone = true;
          absent.add(p);
        }
      }
    };
    check([PART.brazoL, PART.antebrazoL, PART.manoL]);
    check([PART.brazoR, PART.antebrazoR, PART.manoR]);
    // Un tronco tapado por una mesa también se corta: el vientre no va encima de lo que lo cubre.
    check([PART.vientre, PART.pelvis]);
    check([PART.musloL, PART.piernaL, PART.pieL]);
    check([PART.musloR, PART.piernaR, PART.pieR]);
    held.absent = [...absent];
  }
  const missing = [...new Set([...held.absent, ...(input.moving ? [] : input.unseen ?? [])])];
  for (const p of missing) skip.add(p);
  const bias = rig.H * 0.09;
  // Una línea está tapada solo si TODO a su alrededor queda delante. En el borde de una forma
  // siempre hay un lado que se aleja: comparar con el más cercano borraría el contorno.
  const seenAt = (x: number, y: number, z: number) => {
    const px = Math.round(x * gh);
    const py = Math.round(y * gh);
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) return true;
        if (depth[qy * gw + qx] <= z + bias) return true;
      }
    }
    return false;
  };
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];

  const triPart = new Uint8Array(faces.length / 3);
  const trisOf: number[][] = Array.from({ length: COUNT }, () => []);
  const allTris: number[] = [];
  for (let t = 0; t < faces.length; t += 3) {
    const p = skin.part[faces[t]];
    triPart[t / 3] = p;
    trisOf[p].push(t);
    if (!skip.has(p)) allTris.push(t);
  }

  // Contornos: donde la superficie da la vuelta. Es la línea que un dibujante pondría.
  const body2 = (x: number, y: number) => {
    const px = Math.round(x * gh);
    const py = Math.round(y * gh);
    return px >= 0 && py >= 0 && px < gw && py < gh && ids[py * gw + px] >= 0;
  };
  const zs = Array.from(Z);
  const zLow = Math.min(...zs.filter((_, i) => i % 7 === 0));
  const zHigh = Math.max(...zs.filter((_, i) => i % 7 === 0));
  const lines: SurfaceLine[] = [];
  const contour = isoLines(faces, allTris, nz, X, Y, Z, (x, y, z) => seenAt(x, y, z));
  for (const line of contour) {
    if (line.length < 5) continue;
    // ¿Hay cuerpo a los dos lados? Entonces una forma está tapando a otra.
    let inside = 0;
    let z = 0;
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1];
      const q = line[i];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const s = Math.hypot(dx, dy) || 1e-9;
      const off = 4 / gh;
      if (body2(p[0] - (dy / s) * off, p[1] + (dx / s) * off) && body2(p[0] + (dy / s) * off, p[1] - (dx / s) * off)) inside++;
      z += q[2];
    }
    const mid = line[line.length >> 1];
    let part = 0;
    let best = Infinity;
    for (let b = 0; b < COUNT; b++) {
      const d = distanceToBone(mid[0], mid[1], mid[2], now[b]) / REACH[b];
      if (d < best) {
        best = d;
        part = b;
      }
    }
    const overlap = inside > line.length * 0.5;
    // Un cruce mínimo entre mallas no dice nada: en el papel se ve como una equis suelta.
    let span = 0;
    for (let i = 1; i < line.length; i++) span += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (overlap && span < rig.H * 0.32) continue;
    lines.push({ pts: line.map(flat), part, near: (z / line.length - zLow) / (zHigh - zLow || 1), overlap });
  }

  // Cintas: un corte de la malla a lo ancho de cada hueso. Rodean el volumen de verdad.
  const facing = (x: number, y: number, z: number, t: number) => (nz[faces[t]] + nz[faces[t + 1]] + nz[faces[t + 2]]) / 3 > 0.04 && seenAt(x, y, z);
  const slice = new Float32Array(n);
  const bands: Pt[][] = [];
  for (let b = 0; b < COUNT; b++) {
    if (!BANDS[b] || skip.has(b)) continue;
    const { a, b: end } = now[b];
    const u = unit(sub(end, a));
    for (let s = 1; s <= BANDS[b]; s++) {
      const at = mix(a, end, s / (BANDS[b] + 1));
      for (let i = 0; i < n; i++) slice[i] = (X[i] - at[0]) * u[0] + (Y[i] - at[1]) * u[1] + (Z[i] - at[2]) * u[2];
      for (const line of isoLines(faces, trisOf[b], slice, X, Y, Z, facing)) if (line.length > 3) bands.push(line.map(flat));
    }
  }

  // La línea central del tronco: un corte de arriba abajo, como el meridiano de la cabeza.
  const neck = rig.pts[MHR.neck];
  const pelvis = mix(rig.pts[MHR.hipL], rig.pts[MHR.hipR], 0.5);
  const spine = unit(sub(neck, pelvis));
  const shoulders = sub(rig.pts[MHR.shoulderR], rig.pts[MHR.shoulderL]);
  const across = unit(sub(shoulders, mul(spine, dot(shoulders, spine))));
  const middle = mix(neck, pelvis, 0.5);
  for (let i = 0; i < n; i++) slice[i] = (X[i] - middle[0]) * across[0] + (Y[i] - middle[1]) * across[1] + (Z[i] - middle[2]) * across[2];
  // Lo que no se afirma tampoco lleva línea central.
  const trunk = [PART.pecho, PART.vientre, PART.pelvis].filter((p) => !skip.has(p)).flatMap((p) => trisOf[p]);
  const center = isoLines(faces, trunk, slice, X, Y, Z, facing).filter((l) => l.length > 6).map((l) => l.map(flat));

  // Silueta y sombra propia, de la imagen de profundidad.
  // Luz de construcción, como la que elige quien dibuja: arriba a la izquierda y de frente.
  const light = unit([-0.5, -0.62, 0.6]);
  const solid = new Uint8Array(gw * gh);
  const dark = new Uint8Array(gw * gh);
  const bright = new Uint8Array(gw * gh);
  for (let i = 0; i < ids.length; i++) {
    const t = ids[i];
    if (t < 0) continue;
    const p = triPart[t / 3];
    if (skip.has(p)) continue;
    solid[i] = 1;
    const [a, b, c] = [faces[t], faces[t + 1], faces[t + 2]];
    const lit = (N[a * 3] + N[b * 3] + N[c * 3]) * light[0] + (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) * light[1] + (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]) * light[2];
    if (lit < 0.2) dark[i] = 1;
    else bright[i] = 1;
  }
  const loops = (mask: Uint8Array, least: number) => maskContours(mask, gw, gh).filter((l) => l.length >= least).map((l) => l.map(([x, y]): Pt => [x / gw, y / gh]));
  const fill = loops(solid, 24);
  const shade = loops(dark, 40);
  const lit = loops(bright, 40);

  // Planos: anillos y meridianos alrededor de cada hueso, como se talla un cuerpo. Se decide
  // por píxel y no por triángulo: así las fronteras son rectas y no siguen la malla.
  const axes = now.map((bone) => {
    const u = unit(sub(bone.b, bone.a));
    const seed: V3 = Math.abs(u[2]) < 0.8 ? [0, 0, 1] : [1, 0, 0];
    const e1 = unit(cross(u, seed));
    return { a: bone.a, u, e1, e2: cross(u, e1), len: size(sub(bone.b, bone.a)) || 1e-6 };
  });
  const regions = new Map<number, { x0: number; y0: number; x1: number; y1: number; list: number[]; n: V3 }>();
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const t = ids[i];
      if (t < 0) continue;
      const own = triPart[t / 3];
      if (skip.has(own)) continue;
      const px = x / gh;
      const py = y / gh;
      const pz = depth[i];
      // La frontera entre partes también se decide aquí, para que no quede dentada.
      let part = own;
      let least = distanceToBone(px, py, pz, now[own]) / REACH[own];
      for (const b of NEXT[own]) {
        if (skip.has(b)) continue;
        const d = distanceToBone(px, py, pz, now[b]) / REACH[b];
        if (d < least) {
          least = d;
          part = b;
        }
      }
      const ax = axes[part];
      const dx = px - ax.a[0];
      const dy = py - ax.a[1];
      const dz = pz - ax.a[2];
      const along = (dx * ax.u[0] + dy * ax.u[1] + dz * ax.u[2]) / ax.len;
      const q = Math.atan2(dx * ax.e2[0] + dy * ax.e2[1] + dz * ax.e2[2], dx * ax.e1[0] + dy * ax.e1[1] + dz * ax.e1[2]);
      const [rows, cols] = CELLS[part];
      const row = Math.max(0, Math.min(rows - 1, Math.floor(along * rows)));
      const col = Math.min(cols - 1, Math.floor(((q + Math.PI) / (Math.PI * 2)) * cols));
      const id = part * 10000 + row * 100 + col;
      let r = regions.get(id);
      if (!r) regions.set(id, (r = { x0: x, y0: y, x1: x, y1: y, list: [], n: [0, 0, 0] }));
      r.list.push(i);
      if (x < r.x0) r.x0 = x;
      if (x > r.x1) r.x1 = x;
      if (y < r.y0) r.y0 = y;
      if (y > r.y1) r.y1 = y;
      const [a, b, c] = [faces[t], faces[t + 1], faces[t + 2]];
      r.n[0] += N[a * 3] + N[b * 3] + N[c * 3];
      r.n[1] += N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
      r.n[2] += N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    }
  }
  const planes: Facet[] = [];
  for (const r of regions.values()) {
    if (r.list.length < 24) continue;
    const w = r.x1 - r.x0 + 3;
    const h = r.y1 - r.y0 + 3;
    const local = new Uint8Array(w * h);
    for (const i of r.list) local[(Math.floor(i / gw) - r.y0 + 1) * w + (i % gw) - r.x0 + 1] = 1;
    const largest = maskContours(local, w, h).sort((p, q) => q.length - p.length)[0];
    if (!largest || largest.length < 6) continue;
    const poly = simplifyLoop(largest, 2.4).map(([x, y]): Pt => [(x + r.x0 - 1) / gw, (y + r.y0 - 1) / gh]);
    const gap = Math.max(1, Math.floor(r.list.length / 40));
    const samples = r.list.filter((_, k) => k % gap === 0).map((i): Pt => [(i % gw) / gw, Math.floor(i / gw) / gh]);
    if (poly.length >= 3) planes.push({ n: unit(r.n), poly, samples });
  }

  // Medidas reales: el ancho de cada parte cerca de sus dos extremos.
  const radii: [number, number][] = now.map((bone, b) => {
    const u = unit(sub(bone.b, bone.a));
    const len = size(sub(bone.b, bone.a)) || 1e-6;
    const near: number[] = [];
    const far: number[] = [];
    for (let i = 0; i < n; i++) {
      if (skin.part[i] !== b) continue;
      const d: V3 = [X[i] - bone.a[0], Y[i] - bone.a[1], Z[i] - bone.a[2]];
      const t = dot(d, u) / len;
      const side = size(sub(d, mul(u, dot(d, u))));
      if (t > 0.1 && t < 0.4) near.push(side);
      else if (t > 0.6 && t < 0.9) far.push(side);
    }
    const middleOf = (list: number[]) => {
      if (!list.length) return 0;
      list.sort((p, q) => p - q);
      return list[Math.floor(list.length * 0.6)];
    };
    return [middleOf(near), middleOf(far)];
  });

  let hx0 = Infinity;
  let hx1 = -Infinity;
  let hy0 = Infinity;
  let hy1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (skin.part[i] !== PART.cabeza) continue;
    hx0 = Math.min(hx0, X[i]);
    hx1 = Math.max(hx1, X[i]);
    hy0 = Math.min(hy0, Y[i]);
    hy1 = Math.max(hy1, Y[i]);
  }
  const measure = (parts: number[], c: V3, x: V3, y: V3, z: V3) => {
    // A lo ancho se mide menos: lo último ya es hombro, no costillas.
    const axis = (u: V3, share: number) => {
      const list: number[] = [];
      for (let i = 0; i < n; i += 2) if (parts.includes(skin.part[i])) list.push(Math.abs((X[i] - c[0]) * u[0] + (Y[i] - c[1]) * u[1] + (Z[i] - c[2]) * u[2]));
      list.sort((p, q) => p - q);
      return list[Math.floor(list.length * share)] ?? 0;
    };
    return { c, a: axis(x, 0.8), b: axis(y, 0.9), d: axis(z, 0.92) };
  };
  const centerOf = (parts: number[]): V3 => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (!parts.includes(skin.part[i])) continue;
      sx += X[i];
      sy += Y[i];
      sz += Z[i];
      count++;
    }
    return [sx / (count || 1), sy / (count || 1), sz / (count || 1)];
  };
  const front = unit(cross(across, spine));
  const chest = measure([PART.pecho], centerOf([PART.pecho]), across, spine, front);
  const hipLine = sub(rig.pts[MHR.hipR], rig.pts[MHR.hipL]);
  const hipAcross = unit(sub(hipLine, mul(spine, dot(hipLine, spine))));
  const hips = measure([PART.pelvis], centerOf([PART.pelvis]), hipAcross, spine, unit(cross(hipAcross, spine)));
  // Cada parte se mide en su propio eje. Tórax y pelvis miden a lo largo de hombros y caderas:
  // así la figura se inclina con ellos, y un rectángulo se vuelve romboide cuando el cuerpo gira.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const list = members.get(skin.part[i]);
    if (list) list.push(i);
    else members.set(skin.part[i], [i]);
  }
  const screen = (v: V3): Pt => [v[0], v[1]];
  const level = (v: V3): Pt => {
    const size2 = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / size2, v[1] / size2];
  };
  const profiles: PartProfile[] = [];
  const read = (key: string, kind: ShapeKind, part: number, along?: Pt, axis?: [V3, V3], from?: number) => {
    if (missing.includes(part)) return;
    const [start, end] = axis ?? [now[part].a, now[part].b];
    const found = measureProfile(key, kind, X, Y, Z, members.get(part) ?? [], screen(start), screen(end), aspect, along, from);
    if (found) profiles.push(found);
  };
  // El tórax arranca en el cuello: la espalda de la malla sube detrás de él y lo llevaría a la cara.
  read('torax', 'torax', PART.pecho, level(shoulders), undefined, -0.04);
  read('abdomen', 'abdomen', PART.vientre, level(hipLine));
  // El hueso de la pelvis va de cadera a cadera: su eje es el de la columna.
  read('pelvis', 'pelvis', PART.pelvis, level(hipLine), [now[PART.vientre].a, now[PART.vientre].b]);
  read('cuello', 'cuello', PART.cuello);
  for (const [side, arm, fore, hand, thigh, shin, foot] of [
    ['L', PART.brazoL, PART.antebrazoL, PART.manoL, PART.musloL, PART.piernaL, PART.pieL],
    ['R', PART.brazoR, PART.antebrazoR, PART.manoR, PART.musloR, PART.piernaR, PART.pieR],
  ] as const) {
    read(`brazo${side}`, 'brazo', arm);
    read(`antebrazo${side}`, 'antebrazo', fore);
    read(`mano${side}`, 'mano', hand);
    read(`muslo${side}`, 'muslo', thigh);
    read(`pierna${side}`, 'pierna', shin);
    read(`pie${side}`, 'pie', foot);
  }
  // El ancho de cada parte se corrige con la silueta del personaje (ver refineWithMask).
  const fitted = mask ? refineWithMask(profiles, mask, aspect, (q) => q.kind === 'mano' || q.kind === 'pie') : profiles;
  let total = 0;
  let within = 0;
  if (mask) {
    for (let y = 0; y < gh; y += 2) {
      for (let x = 0; x < gw; x += 2) {
        if (!solid[y * gw + x]) continue;
        total++;
        const px = Math.floor((x / gw) * mask.w);
        const py = Math.floor((y / gh) * mask.h);
        if (mask.data[py * mask.w + px]) within++;
      }
    }
  }
  const inside = total ? within / total : 1;
  // Cuánta figura hay de más: ropa suelta, una capa, lo que lleva en las manos.
  let extra = 0;
  if (mask) {
    let figurePixels = 0;
    for (let i = 0; i < mask.data.length; i += 3) if (mask.data[i]) figurePixels++;
    extra = (figurePixels * 3) / (mask.w * mask.h) / (((total * 4) / (gw * gh)) || 1);
  }
  const head = Number.isFinite(hx0) ? { c: [((hx0 + hx1) / 2) / aspect, (hy0 + hy1) / 2] as Pt, rx: (hx1 - hx0) / 2 / aspect, ry: (hy1 - hy0) / 2 } : null;
  return { fill, shade, lit, lines, bands, center, planes, radii, head, hidden: [...skip], absent: missing, inside, extra, chest, hips, profiles: fitted };
}
