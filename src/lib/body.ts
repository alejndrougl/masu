import type { Pt } from './types';

import { t as tx } from '../i18n';
/**
 * Cuerpo 3D de InstantHMR. Las 70 articulaciones siguen el orden MHR70: x a la derecha,
 * y hacia abajo y z alejándose de la cámara, en metros y centradas en el cuerpo.
 */
export interface Body3D {
  joints: Float32Array;
  /** 70 × 2, normalizado sobre la imagen completa. */
  screen: Float32Array;
  vertices: Float32Array;
  /** Metros de la cámara al centro del cuerpo. */
  distance: number;
  /** Qué tan bien coincide la malla con la silueta, 0 a 1. */
  overlap: number;
  /** Qué tan bien coincide con los puntos 2D, 0 a 1. */
  agree: number;
  /** Giro de la mejor hipótesis, en grados. */
  turn: number;
  /** De dónde viene la luz sobre este cuerpo. */
  light: Light | null;
}

export const MHR = {
  nose: 0,
  eyeL: 1,
  eyeR: 2,
  earL: 3,
  earR: 4,
  shoulderL: 5,
  shoulderR: 6,
  elbowL: 7,
  elbowR: 8,
  hipL: 9,
  hipR: 10,
  kneeL: 11,
  kneeR: 12,
  ankleL: 13,
  ankleR: 14,
  toeL: 15,
  smallToeL: 16,
  heelL: 17,
  toeR: 18,
  smallToeR: 19,
  heelR: 20,
  wristR: 41,
  wristL: 62,
  neck: 69,
} as const;

export const MHR_COUNT = 70;

/** Cada dedo: de la punta a la base, para mano derecha e izquierda. */
const fingers = (start: number) => [0, 1, 2, 3, 4].map((f) => [0, 1, 2, 3].map((j) => start + f * 4 + j));
export const HAND_R = fingers(21);
export const HAND_L = fingers(42);

/** Pares (COCO-WholeBody, MHR70). */
export const COCO_TO_MHR: [number, number][] = (() => {
  const out: [number, number][] = [
    [0, MHR.nose], [1, MHR.eyeL], [2, MHR.eyeR], [3, MHR.earL], [4, MHR.earR],
    [5, MHR.shoulderL], [6, MHR.shoulderR], [7, MHR.elbowL], [8, MHR.elbowR],
    [9, MHR.wristL], [10, MHR.wristR], [11, MHR.hipL], [12, MHR.hipR],
    [13, MHR.kneeL], [14, MHR.kneeR], [15, MHR.ankleL], [16, MHR.ankleR],
    [17, MHR.toeL], [18, MHR.smallToeL], [19, MHR.heelL], [20, MHR.toeR], [21, MHR.smallToeR], [22, MHR.heelR],
  ];
  // COCO cuenta de la base a la punta, MHR de la punta a la base.
  const hand = (base: number, chains: number[][]) =>
    chains.forEach((chain, f) => chain.forEach((id, j) => out.push([base + 1 + f * 4 + (3 - j), id])));
  hand(91, HAND_L);
  hand(112, HAND_R);
  return out;
})();

/** Padre de cada articulación: la jerarquía de un esqueleto de animación. */
export const PARENT: number[] = (() => {
  const p = new Array<number>(MHR_COUNT).fill(-1);
  const link = (child: number, parent: number) => (p[child] = parent);
  link(MHR.nose, MHR.neck);
  link(MHR.eyeL, MHR.nose);
  link(MHR.eyeR, MHR.nose);
  link(MHR.earL, MHR.nose);
  link(MHR.earR, MHR.nose);
  link(MHR.shoulderL, MHR.neck);
  link(MHR.shoulderR, MHR.neck);
  link(MHR.elbowL, MHR.shoulderL);
  link(MHR.elbowR, MHR.shoulderR);
  link(MHR.wristL, MHR.elbowL);
  link(MHR.wristR, MHR.elbowR);
  link(MHR.kneeL, MHR.hipL);
  link(MHR.kneeR, MHR.hipR);
  link(MHR.ankleL, MHR.kneeL);
  link(MHR.ankleR, MHR.kneeR);
  for (const j of [MHR.toeL, MHR.smallToeL, MHR.heelL]) link(j, MHR.ankleL);
  for (const j of [MHR.toeR, MHR.smallToeR, MHR.heelR]) link(j, MHR.ankleR);
  const hand = (chains: number[][], wrist: number) => {
    for (const chain of chains) {
      link(chain[3], wrist);
      for (let j = 2; j >= 0; j--) link(chain[j], chain[j + 1]);
    }
  };
  hand(HAND_L, MHR.wristL);
  hand(HAND_R, MHR.wristR);
  link(63, MHR.elbowL);
  link(64, MHR.elbowR);
  link(65, MHR.elbowL);
  link(66, MHR.elbowR);
  link(67, MHR.shoulderL);
  link(68, MHR.shoulderR);
  return p;
})();

/** Padres antes que hijos. */
export const TOPOLOGICAL: number[] = (() => {
  const seen = new Set<number>();
  const out: number[] = [];
  const visit = (i: number) => {
    if (seen.has(i)) return;
    if (PARENT[i] >= 0) visit(PARENT[i]);
    seen.add(i);
    out.push(i);
  };
  for (let i = 0; i < MHR_COUNT; i++) visit(i);
  return out;
})();

/** Recorte cuadrado girado: lleva píxeles del recorte a la imagen. */
export interface Crop {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function cropAffine(cx: number, cy: number, size: number, degrees: number, input: number): Crop {
  const rad = (degrees * Math.PI) / 180;
  const k = (size * 1.2) / input;
  const a = k * Math.cos(rad);
  const b = -k * Math.sin(rad);
  const d = k * Math.sin(rad);
  const e = k * Math.cos(rad);
  const half = input / 2;
  return { a, b, c: cx - a * half - b * half, d, e, f: cy - d * half - e * half };
}

export interface Evidence {
  /** Puntos COCO-WholeBody normalizados sobre la imagen, si hay. */
  pose?: { pts: Pt[]; vis: number[] };
  mask?: { data: Uint8Array; w: number; h: number };
}

/** Qué tanto caen las articulaciones sobre lo que ya se sabe: pose 2D y silueta. */
export function jointAgreement(screen: Float32Array, ev: Evidence): number {
  let span = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 21; i++) {
    x0 = Math.min(x0, screen[i * 2]);
    x1 = Math.max(x1, screen[i * 2]);
    y0 = Math.min(y0, screen[i * 2 + 1]);
    y1 = Math.max(y1, screen[i * 2 + 1]);
  }
  span = Math.max(x1 - x0, y1 - y0, 1e-3);
  let err = 0;
  let weight = 0;
  if (ev.pose) {
    for (const [coco, mhr] of COCO_TO_MHR.slice(0, 17)) {
      const v = ev.pose.vis[coco];
      if (v < 0.3) continue;
      const [x, y] = ev.pose.pts[coco];
      err += v * Math.min(1, Math.hypot(x - screen[mhr * 2], y - screen[mhr * 2 + 1]) / (0.25 * span));
      weight += v;
    }
  }
  let inside = 1;
  if (ev.mask) {
    const { data, w, h } = ev.mask;
    let hits = 0;
    const list = [MHR.shoulderL, MHR.shoulderR, MHR.elbowL, MHR.elbowR, MHR.wristL, MHR.wristR, MHR.hipL, MHR.hipR, MHR.kneeL, MHR.kneeR, MHR.ankleL, MHR.ankleR];
    for (const i of list) {
      const x = Math.floor(screen[i * 2] * w);
      const y = Math.floor(screen[i * 2 + 1] * h);
      if (x >= 0 && y >= 0 && x < w && y < h && data[y * w + x]) hits++;
    }
    inside = hits / list.length;
  }
  const close = weight ? 1 - err / weight : 0.5;
  return close * 0.6 + inside * 0.4;
}

/** Alinea las articulaciones 3D con su proyección: una escala y un traslado. */
/**
 * Escala y desplazamiento que llevan el cuerpo 3D a la pantalla. Con `inFrameOnly` solo pesa lo
 * que cae dentro del cuadro: en un busto la red inventa piernas que se alejan casi un metro, y si
 * contaran igual arrastrarían el tronco lejos de donde está. Se usa para armar el esqueleto; para
 * comparar hipótesis y recortar se queda el ajuste con todo el cuerpo, que es con el que se
 * eligieron y probaron.
 */
export function alignment(joints: Float32Array, screen: Float32Array, aspect = 1, inFrameOnly = false) {
  const n = 21;
  const inFrame = (i: number) => screen[i * 2] > -0.02 && screen[i * 2] < 1.02 && screen[i * 2 + 1] > -0.02 && screen[i * 2 + 1] < 1.02;
  let count = 0;
  for (let i = 0; i < n; i++) if (inFrame(i)) count++;
  const weight = (i: number) => (!inFrameOnly || count < 5 || inFrame(i) ? 1 : 0.04);
  let mx = 0;
  let my = 0;
  let tx = 0;
  let ty = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = weight(i);
    mx += joints[i * 3] * w;
    my += joints[i * 3 + 1] * w;
    tx += screen[i * 2] * aspect * w;
    ty += screen[i * 2 + 1] * w;
    total += w;
  }
  mx /= total;
  my /= total;
  tx /= total;
  ty /= total;
  let up = 0;
  let down = 0;
  for (let i = 0; i < n; i++) {
    const w = weight(i);
    const a = joints[i * 3] - mx;
    const b = joints[i * 3 + 1] - my;
    up += w * (a * (screen[i * 2] * aspect - tx) + b * (screen[i * 2 + 1] - ty));
    down += w * (a * a + b * b);
  }
  const k = up / (down || 1);
  return { k, ox: tx - k * mx, oy: ty - k * my };
}

/** Qué tan lejos queda el cuerpo 3D de sus propios puntos en pantalla dentro del cuadro, en altos de imagen. */
export function selfDisagreement(joints: Float32Array, screen: Float32Array, aspect = 1, inFrameOnly = true): number {
  const { k, ox, oy } = alignment(joints, screen, aspect, inFrameOnly);
  let e = 0;
  let c = 0;
  for (let i = 0; i < 21; i++) {
    const x = screen[i * 2];
    const y = screen[i * 2 + 1];
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) continue;
    e += Math.hypot(joints[i * 3] * k + ox - x * aspect, joints[i * 3 + 1] * k + oy - y);
    c++;
  }
  return c ? e / c : 0;
}

/** Rellena un triángulo sobre una rejilla: basta para comparar siluetas. */
function fillTriangle(grid: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-6) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
      const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
      if (w0 >= -0.05 && w1 >= -0.05 && w0 + w1 <= 1.05) grid[y * w + x] = 1;
    }
  }
}

/** Intersección sobre unión entre la malla proyectada y la silueta. */
export function silhouetteOverlap(body: Pick<Body3D, 'joints' | 'screen' | 'vertices'>, faces: Int32Array, mask: { data: Uint8Array; w: number; h: number }, aspect: number): number {
  const G = 96;
  const gw = aspect >= 1 ? G : Math.max(8, Math.round(G * aspect));
  const gh = aspect >= 1 ? Math.max(8, Math.round(G / aspect)) : G;
  const { k, ox, oy } = alignment(body.joints, body.screen, aspect);
  const n = body.vertices.length / 3;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = ((body.vertices[i * 3] * k + ox) / aspect) * gw;
    py[i] = (body.vertices[i * 3 + 1] * k + oy) * gh;
  }
  const grid = new Uint8Array(gw * gh);
  for (let t = 0; t < faces.length; t += 9) {
    const a = faces[t];
    const b = faces[t + 1];
    const c = faces[t + 2];
    fillTriangle(grid, gw, gh, px[a], py[a], px[b], py[b], px[c], py[c]);
  }
  let both = 0;
  let any = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const m = mask.data[Math.floor(((y + 0.5) / gh) * mask.h) * mask.w + Math.floor(((x + 0.5) / gw) * mask.w)] ? 1 : 0;
      const b = grid[y * gw + x];
      both += m & b;
      any += m | b;
    }
  }
  return any ? both / any : 0;
}

/** Radios de un hueso en sus dos extremos, en metros. */
export type Radii = [number, number];

export interface Measures {
  bones: Record<string, Radii>;
  /** Semiejes del tórax y la pelvis, en metros, sobre sus propios ejes. */
  chest: [number, number, number];
  pelvis: [number, number, number];
  /** Punto medio de la columna, en las coordenadas de las articulaciones. */
  spine: [number, number, number];
  /** Medio alto de cabeza, en metros. */
  head: number;
}

const BONES: [string, number, number][] = [
  ['brazoL', MHR.shoulderL, MHR.elbowL],
  ['brazoR', MHR.shoulderR, MHR.elbowR],
  ['antebrazoL', MHR.elbowL, MHR.wristL],
  ['antebrazoR', MHR.elbowR, MHR.wristR],
  ['musloL', MHR.hipL, MHR.kneeL],
  ['musloR', MHR.hipR, MHR.kneeR],
  ['piernaL', MHR.kneeL, MHR.ankleL],
  ['piernaR', MHR.kneeR, MHR.ankleR],
];

const percentile = (v: number[], p: number) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

/** Mide el cuerpo en la malla: cada vértice aporta al hueso más cercano. */
export function measureBody(joints: Float32Array, vertices: Float32Array): Measures {
  const J = (i: number): [number, number, number] => [joints[i * 3], joints[i * 3 + 1], joints[i * 3 + 2]];
  const hipL = J(MHR.hipL);
  const hipR = J(MHR.hipR);
  const shL = J(MHR.shoulderL);
  const shR = J(MHR.shoulderR);
  const neck = J(MHR.neck);
  const headC = J(MHR.nose);
  const pelvis: [number, number, number] = [(hipL[0] + hipR[0]) / 2, (hipL[1] + hipR[1]) / 2, (hipL[2] + hipR[2]) / 2];
  const chest: [number, number, number] = [(shL[0] + shR[0]) / 2, (shL[1] + shR[1]) / 2, (shL[2] + shR[2]) / 2];
  const ax = chest[0] - pelvis[0];
  const ay = chest[1] - pelvis[1];
  const az = chest[2] - pelvis[2];
  const trunk = Math.hypot(ax, ay, az) || 1;
  const up: [number, number, number] = [ax / trunk, ay / trunk, az / trunk];
  const buckets = new Map<string, number[][]>();
  for (const [name] of BONES) buckets.set(name, [[], []]);
  const n = vertices.length / 3;
  const shoulderWidth = Math.hypot(shL[0] - shR[0], shL[1] - shR[1], shL[2] - shR[2]) || 0.35;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sc = 0;
  const ribs: [number, number, number][] = [];
  const hips: [number, number, number][] = [];
  for (let i = 0; i < n; i += 2) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    let best = '';
    let low = Infinity;
    let at = 0;
    for (const [name, p, q] of BONES) {
      const a = J(p);
      const b = J(q);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2));
      const d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t, z - a[2] - dz * t);
      if (d < low) {
        low = d;
        best = name;
        at = t;
      }
    }
    // Distancia al eje del tronco: si es menor, el vértice es del cuerpo, no del miembro.
    const rx = x - pelvis[0];
    const ry = y - pelvis[1];
    const rz = z - pelvis[2];
    const along = rx * up[0] + ry * up[1] + rz * up[2];
    const off = Math.hypot(rx - up[0] * along, ry - up[1] * along, rz - up[2] * along);
    const inTrunk = along > -trunk * 0.3 && along < trunk * 1.1 && off < shoulderWidth * 0.72;
    if (inTrunk && off < low * 1.6) {
      const t = along / trunk;
      if (t > 0.42 && t < 0.58) {
        sx += x;
        sy += y;
        sz += z;
        sc++;
      }
      if (t > 0.34) ribs.push([rx, ry, rz]);
      else hips.push([rx, ry, rz]);
      continue;
    }
    const slot = buckets.get(best);
    if (slot && at > 0.15 && at < 0.85) slot[at < 0.5 ? 0 : 1].push(low);
  }
  const bones: Record<string, Radii> = {};
  for (const [name, list] of buckets) bones[name] = [percentile(list[0], 0.6), percentile(list[1], 0.6)];
  const axis = (pts: [number, number, number][], v: [number, number, number]) => percentile(pts.map((p) => Math.abs(p[0] * v[0] + p[1] * v[1] + p[2] * v[2])), 0.95);
  // Ejes del tronco: x entre hombros, y a lo largo, z saliendo del pecho.
  const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const side: [number, number, number] = [shR[0] - shL[0], shR[1] - shL[1], shR[2] - shL[2]];
  const flat = dot(side, up);
  const sx0: [number, number, number] = [side[0] - up[0] * flat, side[1] - up[1] * flat, side[2] - up[2] * flat];
  const sn = Math.hypot(sx0[0], sx0[1], sx0[2]) || 1;
  const across: [number, number, number] = [sx0[0] / sn, sx0[1] / sn, sx0[2] / sn];
  const front: [number, number, number] = [across[1] * up[2] - across[2] * up[1], across[2] * up[0] - across[0] * up[2], across[0] * up[1] - across[1] * up[0]];
  const spine: [number, number, number] = sc ? [sx / sc, sy / sc, sz / sc] : [pelvis[0] + ax * 0.5, pelvis[1] + ay * 0.5, pelvis[2] + az * 0.5];
  return {
    bones,
    chest: [axis(ribs, across), trunk * 0.46, axis(ribs, front)],
    pelvis: [axis(hips, across), trunk * 0.26, axis(hips, front)],
    spine,
    // La nariz y la base del cuello no cambian de distancia aunque la cabeza gire.
    head: Math.hypot(headC[0] - neck[0], headC[1] - neck[1], headC[2] - neck[2]) * 0.6,
  };
}

/** Normales por vértice, promediadas de sus caras. */
export function vertexNormals(vertices: Float32Array, faces: Int32Array): Float32Array {
  const n = new Float32Array(vertices.length);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t] * 3;
    const b = faces[t + 1] * 3;
    const c = faces[t + 2] * 3;
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a];
    const vy = vertices[c + 1] - vertices[a + 1];
    const vz = vertices[c + 2] - vertices[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

export interface Light {
  /** Hacia dónde está la luz, vista desde la figura: x derecha, y abajo, z hacia quien mira. */
  dir: [number, number, number];
  /** Cuánto de la imagen explica esta luz, 0 a 1. */
  fit: number;
}

function solve4(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-9) return null;
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 5; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[4] / r[i]);
}

/**
 * De dónde viene la luz: el valor de cada punto visible se explica por su normal. Es
 * sombreado inverso de Lambert: con una malla, la dirección sale por mínimos cuadrados.
 */
export function readLight(body: Pick<Body3D, 'joints' | 'screen' | 'vertices'>, faces: Int32Array, L: Uint8Array, w: number, h: number): Light | null {
  const aspect = w / h;
  const { k, ox, oy } = alignment(body.joints, body.screen, aspect);
  const normals = vertexNormals(body.vertices, faces);
  const n = body.vertices.length / 3;
  // La orientación de las caras no se conoce de antemano: se decide con quién mira a cámara.
  let flip = 0;
  for (let i = 0; i < n; i += 11) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    flip += nx * body.vertices[i * 3] + ny * body.vertices[i * 3 + 1] + nz * body.vertices[i * 3 + 2];
  }
  const sign = flip >= 0 ? 1 : -1;
  const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  const samples: [number, number, number, number][] = [];
  for (let i = 0; i < n; i += 5) {
    const nx = normals[i * 3] * sign;
    const ny = normals[i * 3 + 1] * sign;
    const nz = -normals[i * 3 + 2] * sign;
    if (nz < 0.25) continue;
    const x = Math.floor(((body.vertices[i * 3] * k + ox) / aspect) * w);
    const y = Math.floor((body.vertices[i * 3 + 1] * k + oy) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    samples.push([nx, ny, nz, L[y * w + x] / 255]);
  }
  if (samples.length < 300) return null;
  for (const [nx, ny, nz, v] of samples) {
    const row = [nx, ny, nz, 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
      b[r] += row[r] * v;
    }
  }
  const x = solve4(A, b);
  if (!x) return null;
  const size = Math.hypot(x[0], x[1], x[2]) || 1;
  let mean = 0;
  for (const s of samples) mean += s[3];
  mean /= samples.length;
  let total = 0;
  let left = 0;
  for (const [nx, ny, nz, v] of samples) {
    const p = nx * x[0] + ny * x[1] + nz * x[2] + x[3];
    total += (v - mean) ** 2;
    left += (v - p) ** 2;
  }
  return { dir: [x[0] / size, x[1] / size, x[2] / size], fit: total ? Math.max(0, 1 - left / total) : 0 };
}

/** La dirección de la luz, como se la dirías a alguien. */
export function describeLight(l: Light): string {
  const [x, y, z] = l.dir;
  const parts: string[] = [];
  if (y < -0.3) parts.push(tx('common.arriba'));
  if (y > 0.3) parts.push(tx('common.abajo'));
  if (x < -0.3) parts.push(tx('common.la_izquierda'));
  if (x > 0.3) parts.push(tx('common.la_derecha'));
  if (!parts.length) return z > 0 ? tx('common.de_frente') : tx('common.de_atras');
  return tx('body.desde', { v1: parts.join(tx('common.sep_y')), v2: z < -0.2 ? tx('common.por_detras') : '' });
}

/** La malla proyectada sobre la imagen completa, en una rejilla de w × h. */
export function meshMask(body: Pick<Body3D, 'joints' | 'screen' | 'vertices'>, faces: Int32Array, w: number, h: number, aspect: number, hidden?: Uint8Array): Uint8Array {
  const { k, ox, oy } = alignment(body.joints, body.screen, aspect);
  const V = body.vertices;
  const n = V.length / 3;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = ((V[i * 3] * k + ox) / aspect) * w;
    py[i] = (V[i * 3 + 1] * k + oy) * h;
  }
  const out = new Uint8Array(w * h);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t];
    const b = faces[t + 1];
    const c = faces[t + 2];
    if (hidden && (hidden[a] || hidden[b] || hidden[c])) continue;
    const area = (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
    if (Math.abs(area) < 1e-6) continue;
    const x0 = Math.max(0, Math.floor(Math.min(px[a], px[b], px[c])));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(px[a], px[b], px[c])));
    const y0 = Math.max(0, Math.floor(Math.min(py[a], py[b], py[c])));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(py[a], py[b], py[c])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w0 = ((px[b] - x) * (py[c] - y) - (py[b] - y) * (px[c] - x)) / area;
        const w1 = ((px[c] - x) * (py[a] - y) - (py[c] - y) * (px[a] - x)) / area;
        if (w0 >= -0.02 && w1 >= -0.02 && w0 + w1 <= 1.02) out[y * w + x] = 1;
      }
    }
  }
  return out;
}

/** Dónde pedirle a un recortador la figura: adentro del cuerpo, en el centro de cada hueso. */
export function meshPrompts(body: Pick<Body3D, 'joints' | 'screen'>, aspect: number, gone: Set<number> = new Set()): [number, number][] {
  const J = (i: number): [number, number] => [body.screen[i * 2], body.screen[i * 2 + 1]];
  const mid = (a: number, b: number, t = 0.5): [number, number] => {
    const p = J(a);
    const q = J(b);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const pairs: [number, number][] = [
    [MHR.shoulderL, MHR.elbowL], [MHR.shoulderR, MHR.elbowR], [MHR.elbowL, MHR.wristL], [MHR.elbowR, MHR.wristR],
    [MHR.hipL, MHR.kneeL], [MHR.hipR, MHR.kneeR], [MHR.kneeL, MHR.ankleL], [MHR.kneeR, MHR.ankleR], [MHR.earL, MHR.earR],
  ];
  void aspect;
  const seen = pairs.filter(([a, b]) => !gone.has(a) && !gone.has(b)).map(([a, b]) => mid(a, b));
  // El tronco siempre está: sin caderas a la vista se apunta solo a su parte alta.
  for (const hip of [MHR.hipL, MHR.hipR]) seen.push(mid(MHR.neck, hip, gone.has(hip) ? 0.3 : 0.5));
  return seen;
}
