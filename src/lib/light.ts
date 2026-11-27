import { rgbToLab } from './color';
import { maskContours, simplifyLine } from './edges';
import { distanceToEdge } from './gesture';
import type { Pt } from './types';

import { t as tx } from '../i18n';
/**
 * Lectura de la luz de una imagen: de dónde viene cada luz, qué es sombra propia, qué es
 * sombra arrojada, dónde quedan los acentos y los brillos.
 *
 * El método sigue a López-Moreno y otros (2013): el contorno de la figura dice cuántas luces
 * hay y por dónde entran, y el interior dice qué tan de frente vienen. Aquí el contorno y el
 * interior se ajustan juntos: a cada punto de la figura se le da una normal (de la malla 3D si
 * existe; si no, inflando la silueta como hace un dibujante con cilindros y esferas) y se busca
 * el menor número de luces que explique su claridad.
 *
 * Ejes: x a la derecha, y hacia abajo, z hacia quien mira. Una dirección apunta HACIA la luz.
 */

export type V3 = [number, number, number];
export type LightRole = 'principal' | 'relleno' | 'contraluz' | 'rebote';

export interface LightSource {
  dir: V3;
  /** Fuerza relativa a la luz principal, 0 a 1. */
  strength: number;
  role: LightRole;
  /** Grados en el plano de la imagen: 0 a la derecha, 90 arriba. */
  azimuth: number;
  /** Grados hacia quien mira: 90 de frente, 0 de lado, negativo desde atrás. */
  elevation: number;
  /** Confianza, 0 a 1. */
  sure: number;
}

export interface LightInput {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  /** La figura que se lee; sin ella se lee toda la imagen con su profundidad. */
  mask: Uint8Array | null;
  /** Normales de una malla 3D, w × h × 3; ceros donde no hay. */
  normals?: Float32Array | null;
  /** Profundidad relativa, mayor es más cerca. */
  depth?: Float32Array | null;
  /** Donde la forma es más fiable para leer la luz: la cabeza. */
  emphasis?: Uint8Array | null;
}

export const ZONE = { fuera: 0, luz: 1, medio: 2, propia: 3, arrojada: 4, oclusion: 5, brillo: 6, oscuro: 7 } as const;

export interface LightRead {
  w: number;
  h: number;
  lights: LightSource[];
  /** No hay sombreado que leer: color plano o luz pareja. */
  flat: boolean;
  /** Cuánto de la claridad explican las luces, 0 a 1. */
  fit: number;
  ambient: number;
  /** Parte de la figura que está en sombra. */
  shadowShare: number;
  /** Parte de la figura que es de un material casi negro: no se mide su sombra. */
  darkShare: number;
  /** Cuántas veces más clara es la luz que la sombra. */
  ratio: number | null;
  /** Ancho del paso de luz a sombra, relativo al grosor de la figura: bajo es luz dura. */
  hardness: number | null;
  /** Calidez (b* de Lab) en luz y en sombra. */
  temperature: { light: number; shadow: number } | null;
  /** La sombra se aclara lejos del terminador: hay luz reflejada. */
  reflected: boolean;
  zones: Uint8Array;
  /** Donde la forma se voltea y deja de recibir luz. */
  terminator: Pt[][];
  /** Manchas de sombra propia y arrojada sobre la figura. */
  form: Pt[][];
  cast: Pt[][];
  /** Sombra que la figura arroja fuera de sí. */
  ground: Pt[][];
  /** Hacia dónde cae esa sombra, en el plano de la imagen. */
  groundDir: Pt | null;
  occlusion: Pt[][];
  highlights: { c: Pt; r: number }[];
  /** Tramos del contorno encendidos por una luz de atrás. */
  rim: Pt[][];
  /** Centro y radio de lo leído, normalizados al encuadre. */
  center: Pt;
  radius: number;
  normals: Float32Array;
  shade: Float32Array;
  scene: boolean;
  /** La cara dice que la luz viene del lado contrario: no se afirma dirección. */
  faceConflict?: boolean;
  /** El cuerpo no dio dirección y se tomó el lado de la cara. */
  fromFace?: boolean;
}

/** Luminancia lineal bajo la cual un material cuenta como casi negro (unos 55 de 255). */
const BLACK = 0.045;
/** Ancho máximo del paso de luz a sombra (relativo al grosor de la parte) para llamarla arrojada. */
const CAST_EDGE = 0.1;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

/** Luminancia lineal: la que se suma como se suma la luz. */
export function linearLuma(rgba: Uint8ClampedArray, n: number): Float32Array {
  const Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = 0.2126 * LINEAR[rgba[i * 4]] + 0.7152 * LINEAR[rgba[i * 4 + 1]] + 0.0722 * LINEAR[rgba[i * 4 + 2]];
  return Y;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      let n = 0;
      for (let x = -r; x < w; x++) {
        const add = x + r;
        if (add < w) {
          sum += a[y * w + add];
          n++;
        }
        const drop = x - r - 1;
        if (drop >= 0) {
          sum -= a[y * w + drop];
          n--;
        }
        if (x >= 0) tmp[y * w + x] = sum / n;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let y = -r; y < h; y++) {
        const add = y + r;
        if (add < h) {
          sum += tmp[add * w + x];
          n++;
        }
        const drop = y - r - 1;
        if (drop >= 0) {
          sum -= tmp[drop * w + x];
          n--;
        }
        if (y >= 0) out[y * w + x] = sum / n;
      }
    }
    a = out;
  }
  return a;
}

function percentile(values: Float32Array | number[], q: number): number {
  const v = Float32Array.from(values).sort();
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}

/** Componentes conectados de una máscara: etiqueta por píxel (0 fuera) y área de cada una. */
function components(mask: Uint8Array, w: number, h: number): { label: Int32Array; area: number[] } {
  const label = new Int32Array(w * h);
  const area: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    const id = area.length;
    let count = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) (label[p - 1] = id), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) (label[p + 1] = id), stack.push(p + 1);
      if (p >= w && mask[p - w] && !label[p - w]) (label[p - w] = id), stack.push(p - w);
      if (p < mask.length - w && mask[p + w] && !label[p + w]) (label[p + w] = id), stack.push(p + w);
    }
    area.push(count);
  }
  return { label, area };
}

/** Quita motas de una máscara y tapa sus agujeros chicos. */
function tidy(mask: Uint8Array, inside: Uint8Array, w: number, h: number, min: number): Uint8Array {
  const out = mask.slice();
  const a = components(out, w, h);
  for (let i = 0; i < out.length; i++) if (out[i] && a.area[a.label[i]] < min) out[i] = 0;
  const holes = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) holes[i] = inside[i] && !out[i] ? 1 : 0;
  const b = components(holes, w, h);
  for (let i = 0; i < out.length; i++) if (holes[i] && b.area[b.label[i]] < min) out[i] = 1;
  return out;
}

/**
 * Materiales: zonas del mismo color local. Una sombra es el mismo material más oscuro, así
 * que dos zonas vecinas del mismo tinte y no demasiado distintas en claridad se cuentan como
 * una. El pelo negro junto a la piel no pasa esa prueba, y por eso no se lee como sombra.
 */
export function materials(rgba: Uint8ClampedArray, Y: Float32Array, mask: Uint8Array, w: number, h: number, k = 7, merge = true): { group: Int16Array; ref: number[] } {
  const n = w * h;
  const lab = new Float32Array(n * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const [L, a, b] = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    lab[i * 3] = L * 0.6;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
    idx.push(i);
  }
  const group = new Int16Array(n).fill(-1);
  if (idx.length < 40) return { group, ref: [] };
  const step = Math.max(1, Math.floor(idx.length / 6000));
  const sample: number[] = [];
  for (let i = 0; i < idx.length; i += step) sample.push(idx[i]);
  // Centros iniciales lo más separados posible: el resultado no depende del azar.
  const centers: number[][] = [];
  const first = sample[Math.floor(sample.length / 2)];
  centers.push([lab[first * 3], lab[first * 3 + 1], lab[first * 3 + 2]]);
  const far = new Float32Array(sample.length).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let best = 0;
    for (let s = 0; s < sample.length; s++) {
      const i = sample[s] * 3;
      const d = (lab[i] - c[0]) ** 2 + (lab[i + 1] - c[1]) ** 2 + (lab[i + 2] - c[2]) ** 2;
      if (d < far[s]) far[s] = d;
      if (far[s] > far[best]) best = s;
    }
    if (far[best] < 9) break;
    const i = sample[best] * 3;
    centers.push([lab[i], lab[i + 1], lab[i + 2]]);
  }
  const K = centers.length;
  const nearest = (i: number) => {
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < K; c++) {
      const d = (lab[i * 3] - centers[c][0]) ** 2 + (lab[i * 3 + 1] - centers[c][1]) ** 2 + (lab[i * 3 + 2] - centers[c][2]) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  for (let it = 0; it < 10; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = nearest(i);
      sum[c][0] += lab[i * 3];
      sum[c][1] += lab[i * 3 + 1];
      sum[c][2] += lab[i * 3 + 2];
      sum[c][3]++;
    }
    for (let c = 0; c < K; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const cluster = new Int16Array(n).fill(-1);
  const area = new Array(K).fill(0);
  const lum = new Array(K).fill(0);
  for (const i of idx) {
    const c = nearest(i);
    cluster[i] = c;
    area[c]++;
    lum[c] += Y[i];
  }
  for (let c = 0; c < K; c++) lum[c] /= area[c] || 1;
  // Frontera compartida entre cada par.
  const border = Array.from({ length: K }, () => new Array(K).fill(0));
  const edge = new Array(K).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = cluster[y * w + x];
      if (a < 0) continue;
      for (const q of [x + 1 < w ? y * w + x + 1 : -1, y + 1 < h ? (y + 1) * w + x : -1]) {
        if (q < 0) continue;
        const b = cluster[q];
        if (b < 0 || b === a) continue;
        border[a][b]++;
        border[b][a]++;
        edge[a]++;
        edge[b]++;
      }
    }
  }
  const parent = centers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < K; a++) {
    for (let b = a + 1; b < K; b++) {
      if (!merge || !area[a] || !area[b]) continue;
      const shared = border[a][b] / Math.max(1, Math.min(edge[a], edge[b]));
      if (shared < 0.2) continue;
      const light = lum[a] >= lum[b] ? a : b;
      const dark = light === a ? b : a;
      if (lum[dark] / Math.max(1e-4, lum[light]) < 0.3) continue;
      const ca = Math.hypot(centers[a][1], centers[a][2]);
      const cb = Math.hypot(centers[b][1], centers[b][2]);
      const La = centers[a][0] / 0.6 + 1;
      const Lb = centers[b][0] / 0.6 + 1;
      const neutralA = ca < 9 || ca / La < 0.14;
      const neutralB = cb < 9 || cb / Lb < 0.14;
      if (neutralA !== neutralB) {
        // La sombra de algo blanco toma el color del cielo o del suelo: el oscuro puede tener
        // color. Al revés no: un negro junto a un color es otro material (pelo, lomo, tinta).
        const darkIsNeutral = dark === a ? neutralA : neutralB;
        if (darkIsNeutral ? Math.max(ca, cb) > 12 : Math.max(ca, cb) > 42) continue;
      } else if (!neutralA) {
        let dh = Math.abs(Math.atan2(centers[a][2], centers[a][1]) - Math.atan2(centers[b][2], centers[b][1]));
        if (dh > Math.PI) dh = Math.PI * 2 - dh;
        // Las sombras corren el tinte, sobre todo en anime: se tolera hasta unos 32°.
        if (dh > 0.56) continue;
      }
      parent[find(a)] = find(b);
    }
  }
  const roots = [...new Set(centers.map((_, i) => find(i)))];
  const slot = new Map(roots.map((r, i) => [r, i]));
  const lists: number[][] = roots.map(() => []);
  for (const i of idx) {
    const g = slot.get(find(cluster[i]))!;
    group[i] = g;
    lists[g].push(Y[i]);
  }
  const ref = lists.map((v) => Math.max(1e-4, percentile(v, 0.9)));
  return { group, ref };
}

/**
 * Normales inflando la silueta: cada parte se toma como un cuerpo redondo cuyo radio es el
 * de su eje. Es la forma en que se sombrea un dibujo plano, y lo que supone quien construye
 * con cilindros.
 */
export function inflate(mask: Uint8Array, w: number, h: number): { normals: Float32Array; dist: Float32Array; radius: Float32Array; top: number } {
  const raw = distanceToEdge(mask, w, h);
  const n = w * h;
  const dist = new Float32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    dist[i] = raw[i] / 3;
    if (dist[i] > top) top = dist[i];
  }
  // Cada punto sube hasta la cresta más cercana: ese es el radio de su parte.
  const radius = new Float32Array(n);
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => mask[i])
    .sort((a, b) => dist[b] - dist[a]);
  for (const i of order) {
    const x = i % w;
    const y = (i - x) / w;
    let best = i;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (dist[q] > dist[best]) best = q;
      }
    }
    radius[i] = best === i ? dist[i] : radius[best];
  }
  const smooth = boxBlur(radius, w, h, Math.max(1, Math.round(top / 5)), 1);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const R = Math.max(dist[i], smooth[i], 1);
    const d = Math.min(dist[i], R);
    height[i] = Math.sqrt(Math.max(0, d * (2 * R - d)));
  }
  const soft = boxBlur(height, w, h, 1, 1);
  const normals = new Float32Array(n * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const l = x > 0 ? soft[i - 1] : 0;
      const r = x < w - 1 ? soft[i + 1] : 0;
      const u = y > 0 ? soft[i - w] : 0;
      const d = y < h - 1 ? soft[i + w] : 0;
      const gx = (r - l) / 2;
      const gy = (d - u) / 2;
      const len = Math.hypot(gx, gy, 1);
      normals[i * 3] = -gx / len;
      normals[i * 3 + 1] = -gy / len;
      normals[i * 3 + 2] = 1 / len;
    }
  }
  return { normals, dist, radius: smooth, top };
}

/** Normales de un lugar a partir de su profundidad. */
export function depthNormals(depth: Float32Array, w: number, h: number): Float32Array {
  const soft = boxBlur(depth, w, h, Math.max(1, Math.round(Math.max(w, h) / 90)), 2);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of soft) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // La profundidad es relativa: se supone que la escena es tan honda como ancha.
  const k = Math.max(w, h) / Math.max(1e-6, hi - lo);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = ((x < w - 1 ? soft[i + 1] : soft[i]) - (x > 0 ? soft[i - 1] : soft[i])) * 0.5 * k;
      const gy = ((y < h - 1 ? soft[i + w] : soft[i]) - (y > 0 ? soft[i - w] : soft[i])) * 0.5 * k;
      const len = Math.hypot(gx, gy, 1);
      out[i * 3] = -gx / len;
      out[i * 3 + 1] = -gy / len;
      out[i * 3 + 2] = 1 / len;
    }
  }
  return out;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-9) return null;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const SPHERE: V3[] = (() => {
  const out: V3[] = [];
  const N = 320;
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - z * z);
    // De muy atrás una luz no toca nada de lo que se ve.
    if (z < -0.6) continue;
    out.push([Math.cos(g * i) * r, Math.sin(g * i) * r, z]);
  }
  return out;
})();

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const angle = (a: V3, b: V3) => (Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * 180) / Math.PI;

export interface Fit {
  lights: { dir: V3; w: number }[];
  ambient: number;
  r2: number;
}

/**
 * El menor número de luces que explica la claridad: s ≈ ambiente + Σ fuerza · max(0, n·l).
 * Se agrega una luz solo si mejora de verdad el ajuste y viene de otro lado.
 */
export function fitLights(N: Float32Array, S: Float32Array, opts: { max?: number; weights?: Float32Array; minZ?: number; maxY?: number; gain?: number } = {}): Fit {
  const m = S.length;
  const max = opts.max ?? 3;
  const Wt = opts.weights ?? new Float32Array(m).fill(1);
  const minZ = opts.minZ ?? -0.6;
  const maxY = opts.maxY ?? 1;
  const need = opts.gain ?? 0.03;
  let mean = 0;
  let wsum = 0;
  for (let i = 0; i < m; i++) {
    mean += S[i] * Wt[i];
    wsum += Wt[i];
  }
  mean /= wsum || 1;
  let total = 0;
  for (let i = 0; i < m; i++) total += Wt[i] * (S[i] - mean) ** 2;
  if (m < 12 || total < 1e-9) return { lights: [], ambient: mean, r2: 0 };
  const column = (l: V3) => {
    const c = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const v = N[i * 3] * l[0] + N[i * 3 + 1] * l[1] + N[i * 3 + 2] * l[2];
      c[i] = v > 0 ? v : 0;
    }
    return c;
  };
  const ones = new Float32Array(m).fill(1);
  const dot = (a: Float32Array, b: Float32Array) => {
    let s = 0;
    for (let i = 0; i < m; i++) s += Wt[i] * a[i] * b[i];
    return s;
  };
  let ss = 0;
  for (let i = 0; i < m; i++) ss += Wt[i] * S[i] * S[i];
  const tryWith = (cols: Float32Array[]): { coef: number[]; sse: number } | null => {
    const all = [ones, ...cols];
    const A = all.map((a) => all.map((b) => dot(a, b)));
    const rhs = all.map((a) => dot(a, S));
    const coef = solve(A, rhs);
    if (!coef || coef.slice(1).some((c) => c <= 0)) return null;
    let explained = 0;
    for (let i = 0; i < coef.length; i++) explained += coef[i] * rhs[i];
    return { coef, sse: ss - explained };
  };
  const chosen: { dir: V3; col: Float32Array }[] = [];
  let best = { coef: [mean], sse: total };
  const allowed = (d: V3) => d[2] >= minZ && d[1] <= maxY;
  for (let round = 0; round < max; round++) {
    let pick: { dir: V3; col: Float32Array; res: { coef: number[]; sse: number } } | null = null;
    for (const dir of SPHERE) {
      if (!allowed(dir) || chosen.some((c) => angle(c.dir, dir) < 60)) continue;
      const col = column(dir);
      const res = tryWith([...chosen.map((c) => c.col), col]);
      if (res && (!pick || res.sse < pick.res.sse)) pick = { dir, col, res };
    }
    if (!pick) break;
    const gain = (best.sse - pick.res.sse) / total;
    const strongest = Math.max(...pick.res.coef.slice(1));
    const mine = pick.res.coef[pick.res.coef.length - 1];
    // Una segunda luz desde abajo es rara: se pide el doble de mejora para creerla.
    if (round > 0 && (gain < need || mine < strongest * 0.3 || (pick.dir[1] > 0.5 && gain < need * 2))) break;
    if (round === 0 && gain < 0.01) break;
    chosen.push({ dir: pick.dir, col: pick.col });
    best = pick.res;
    // Afinar cada dirección alrededor de donde quedó.
    for (const stepDeg of [7, 3.5, 1.7]) {
      const t = (stepDeg * Math.PI) / 180;
      for (let c = 0; c < chosen.length; c++) {
        let moved = true;
        let guard = 0;
        while (moved && guard++ < 6) {
          moved = false;
          const d = chosen[c].dir;
          const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
          const u = unit([d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]]);
          const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const next = unit([d[0] + (u[0] * a + v[0] * b) * t, d[1] + (u[1] * a + v[1] * b) * t, d[2] + (u[2] * a + v[2] * b) * t]);
            if (!allowed(next) || chosen.some((q, j) => j !== c && angle(q.dir, next) < 60)) continue;
            const col = column(next);
            const res = tryWith(chosen.map((q, j) => (j === c ? col : q.col)));
            if (res && res.sse < best.sse - total * 1e-5) {
              chosen[c] = { dir: next, col };
              best = res;
              moved = true;
              break;
            }
          }
        }
      }
    }
  }
  return { lights: chosen.map((c, i) => ({ dir: c.dir, w: best.coef[i + 1] })), ambient: best.coef[0], r2: clamp(1 - best.sse / total, 0, 1) };
}

function otsu(values: number[]): { cut: number; split: number } {
  const bins = 32;
  const hist = new Array(bins).fill(0);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const n = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let w0 = 0;
  let sum0 = 0;
  let best = 0;
  let cut = bins / 2;
  for (let i = 0; i < bins - 1; i++) {
    w0 += hist[i];
    sum0 += i * hist[i];
    const w1 = n - w0;
    if (!w0 || !w1) continue;
    const between = w0 * w1 * (sum0 / w0 - (sumAll - sum0) / w1) ** 2;
    if (between > best) {
      best = between;
      cut = i + 1;
    }
  }
  const mean = sumAll / (n || 1);
  let total = 0;
  for (let i = 0; i < bins; i++) total += hist[i] * (i - mean) ** 2;
  return { cut: cut / bins, split: total ? best / n / total : 0 };
}

function loops(mask: Uint8Array, w: number, h: number, eps: number, min: number): Pt[][] {
  return maskContours(mask, w, h)
    .filter((l) => l.length >= min)
    .map((l) => simplifyLine([...l, l[0]], eps).map(([x, y]) => [x / w, y / h] as Pt));
}

const describe = (dir: V3): { azimuth: number; elevation: number } => ({
  azimuth: ((Math.atan2(-dir[1], dir[0]) * 180) / Math.PI + 360) % 360,
  elevation: (Math.asin(clamp(dir[2], -1, 1)) * 180) / Math.PI,
});

/** Cuánto recibe cada punto de un juego de luces, 0 a 1 respecto a la principal. */
export function exposure(normals: Float32Array, i: number, lights: Pick<LightSource, 'dir' | 'strength'>[]): number {
  let e = 0;
  for (const l of lights) {
    const v = normals[i * 3] * l.dir[0] + normals[i * 3 + 1] * l.dir[1] + normals[i * 3 + 2] * l.dir[2];
    if (v > 0) e += v * l.strength;
  }
  return e;
}

export function readLighting(input: LightInput): LightRead {
  const { rgba, w, h } = input;
  const n = w * h;
  const scene = !input.mask;
  const mask = input.mask ?? new Uint8Array(n).fill(1);
  const Y = linearLuma(rgba, n);
  let count = 0;
  let cx = 0;
  let cy = 0;
  let x0 = w;
  let x1 = 0;
  let y0 = h;
  let y1 = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    count++;
    cx += x;
    cy += y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  cx /= count || 1;
  cy /= count || 1;
  const empty: LightRead = {
    w, h, lights: [], flat: true, fit: 0, ambient: 0, shadowShare: 0, darkShare: 0, ratio: null, hardness: null, temperature: null, reflected: false,
    zones: new Uint8Array(n), terminator: [], form: [], cast: [], ground: [], groundDir: null, occlusion: [], highlights: [], rim: [],
    center: [cx / w, cy / h], radius: Math.max(x1 - x0, y1 - y0) / 2 / Math.max(w, h), normals: new Float32Array(n * 3), shade: new Float32Array(n), scene,
  };
  if (count < 200) return empty;

  // 1. Normales: la malla donde exista, la silueta inflada en lo demás; en un lugar, su profundidad.
  let normals: Float32Array;
  let dist: Float32Array;
  let radius: Float32Array;
  let top: number;
  if (scene) {
    normals = input.depth ? depthNormals(input.depth, w, h) : new Float32Array(n * 3);
    dist = new Float32Array(n).fill(Math.max(w, h));
    radius = dist;
    top = Math.max(w, h) / 4;
  } else {
    const inf = inflate(mask, w, h);
    normals = inf.normals;
    dist = inf.dist;
    radius = inf.radius;
    top = inf.top;
    if (input.normals) {
      for (let i = 0; i < n; i++) {
        if (!mask[i]) continue;
        const a = input.normals[i * 3];
        const b = input.normals[i * 3 + 1];
        const c = input.normals[i * 3 + 2];
        if (a === 0 && b === 0 && c === 0) continue;
        // Junto al borde manda la silueta: ahí la malla ya no coincide con la figura real.
        const t = clamp(dist[i] / Math.max(2, radius[i] * 0.35), 0, 1);
        const nx = normals[i * 3] * (1 - t) + a * t;
        const ny = normals[i * 3 + 1] * (1 - t) + b * t;
        const nz = normals[i * 3 + 2] * (1 - t) + c * t;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      }
    }
  }

  // 2. Sombreado: la claridad de cada punto contra la de su material.
  const mat = materials(rgba, Y, mask, w, h, scene ? 9 : 7, !scene);
  const soft = boxBlur(Y, w, h, 1, 1);
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i] && mat.group[i] >= 0) shade[i] = soft[i] / mat.ref[mat.group[i]];
  // Materiales casi negros (pelo, correas, tinta): su claridad no dice de dónde viene la luz, es
  // su valor local. Quedan fuera del ajuste y no marcan sombra; solo pueden dar brillos y contraluz.
  // Si toda la figura es oscura no hay otra cosa con qué leer, y se deja como estaba.
  const blackG = mat.ref.map((r) => r < BLACK);
  const lightArea = mat.ref.map(() => 0);
  for (let i = 0; i < n; i++) if (mask[i] && mat.group[i] >= 0 && !blackG[mat.group[i]]) lightArea[mat.group[i]]++;
  const lightTotal = lightArea.reduce((a, b) => a + b, 0);
  const useBlack = !scene && lightTotal > count * 0.25 && blackG.some(Boolean);
  const isBlack = (i: number) => useBlack && mat.group[i] >= 0 && blackG[mat.group[i]];
  // El sombreado en masas: un estampado o una textura no son sombra.
  const inMask = new Float32Array(n);
  const capped = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i] || mat.group[i] < 0 || isBlack(i)) continue;
    inMask[i] = 1;
    capped[i] = Math.min(1, shade[i]);
  }
  const massR = Math.max(1, Math.round(top / 12));
  const massA = boxBlur(capped, w, h, massR, 2);
  const massB = boxBlur(inMask, w, h, massR, 2);
  const mass = new Float32Array(n);
  for (let i = 0; i < n; i++) if (inMask[i]) mass[i] = massA[i] / Math.max(1e-3, massB[i]);

  // 3. Luces. Cada material se compara consigo mismo, y los puntos se juntan por hacia dónde
  // miran: así pesa la forma y no cuántos píxeles tiene una textura.
  const gMean = mat.ref.map(() => 0);
  const gCount = mat.ref.map(() => 0);
  for (let i = 0; i < n; i++) {
    if (!inMask[i]) continue;
    gMean[mat.group[i]] += mass[i];
    gCount[mat.group[i]]++;
  }
  let allMean = 0;
  for (let g = 0; g < gMean.length; g++) {
    allMean += gMean[g];
    gMean[g] /= gCount[g] || 1;
  }
  allMean /= Math.max(1, gCount.reduce((a, b) => a + b, 0));
  const G = 14;
  const bins = Array.from({ length: G * G }, () => [0, 0, 0, 0, 0]);
  let used = 0;
  let spread = 0;
  for (let i = 0; i < n; i++) {
    if (!inMask[i]) continue;
    // La orilla trae fondo mezclado y brillos de contraluz: no sirve para la luz principal.
    if (!scene && dist[i] < Math.max(1.5, radius[i] * 0.1)) continue;
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    if (nz <= 0.02) continue;
    const b = bins[Math.min(G - 1, Math.floor(((ny + 1) / 2) * G)) * G + Math.min(G - 1, Math.floor(((nx + 1) / 2) * G))];
    const v = mass[i] - gMean[mat.group[i]];
    // La cabeza es una forma redonda de un solo material: es donde mejor se lee la luz.
    const k = input.emphasis?.[i] ? 3 : 1;
    b[0] += nx * k;
    b[1] += ny * k;
    b[2] += nz * k;
    b[3] += v * k;
    b[4] += k;
    used += k;
    spread += v * v * k;
  }
  spread = Math.sqrt(spread / (used || 1));
  const NS: number[] = [];
  const SS: number[] = [];
  const WS: number[] = [];
  const few = Math.max(6, used * 0.0012);
  const full = bins.filter((b) => b[4] >= few);
  const typical = percentile(full.map((b) => b[4]), 0.5);
  for (const b of full) {
    const l = Math.hypot(b[0], b[1], b[2]) || 1;
    NS.push(b[0] / l, b[1] / l, b[2] / l);
    SS.push(b[3] / b[4]);
    WS.push(Math.min(b[4], typical * 3));
  }
  const fitWith = (maxY: number) => fitLights(Float32Array.from(NS), Float32Array.from(SS), { max: 2, weights: Float32Array.from(WS), minZ: -0.12, maxY, gain: 0.06 });
  let fit = fitWith(1);
  // La luz casi nunca viene de abajo, y un material oscuro arriba (pelo, lomo) la imita: solo se
  // acepta si ninguna luz de arriba o de lado explica casi lo mismo.
  if (fit.lights.length && fit.lights[0].dir[1] > 0.3) {
    const above = fitWith(0.15);
    if (above.lights.length && above.r2 > fit.r2 * 0.72) fit = above;
  }
  const strongest = Math.max(1e-6, ...fit.lights.map((l) => l.w));
  // Tinta sobre papel: los negros son línea y relleno, no sombra.
  let pale = 0;
  let chroma = 0;
  let sampled = 0;
  for (let i = 0; i < n; i += 5) {
    if (!inMask[i]) continue;
    const mx = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const mn = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    chroma += mx - mn;
    if (mn > 205) pale++;
    sampled++;
  }
  const lineArt = sampled > 0 && chroma / sampled < 9 && pale / sampled > 0.3;
  // Una luz que mueve menos de un valor de diez no se distingue de un color parejo.
  const flat = scene || lineArt || !fit.lights.length || spread < 0.035 || strongest < 0.09 || fit.r2 < 0.18;
  let lights: LightSource[] = flat
    ? []
    : fit.lights
        .map((l) => ({ dir: l.dir, strength: l.w / strongest, role: 'relleno' as LightRole, ...describe(l.dir), sure: clamp((fit.r2 - 0.15) * 1.5, 0.05, 1) }))
        .sort((a, b) => b.strength - a.strength);
  fit.ambient = clamp(allMean - strongest * 0.4, 0.05, 0.6);

  if (scene) {
    const sky = skySide(Y, input.depth ?? null, w, h);
    if (sky) lights = [{ dir: sky.dir, strength: 1, role: 'principal', ...describe(sky.dir), sure: sky.sure }];
  }

  // 4. Zonas: luz, medio tono y sombra por material.
  const zones = new Uint8Array(n);
  const zoneR = Math.max(1, Math.round(top / 22));
  const zoneA = boxBlur(capped, w, h, zoneR, 2);
  const zoneB = boxBlur(inMask, w, h, zoneR, 2);
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) if (inMask[i]) tone[i] = zoneA[i] / Math.max(1e-3, zoneB[i]);
  const byGroup: number[][] = mat.ref.map(() => []);
  for (let i = 0; i < n; i++) if (inMask[i]) byGroup[mat.group[i]].push(tone[i]);
  const cuts = byGroup.map((v) => {
    if (v.length < 30) return { cut: 0, half: 0 };
    let mean = 0;
    for (const s of v) mean += s;
    mean /= v.length;
    let dev = 0;
    for (const s of v) dev += (s - mean) ** 2;
    dev = Math.sqrt(dev / v.length);
    // Un material parejo no tiene sombra que marcar.
    if (dev < 0.07) return { cut: 0, half: 0 };
    const o = otsu(v);
    const cut = clamp(o.cut, 0.2, 0.8);
    return { cut, half: cut + (1 - cut) * 0.38 };
  });
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const g = mat.group[i];
    if (g < 0) continue;
    if (tone[i] < cuts[g].cut) dark[i] = 1;
  }
  const minArea = Math.max(8, Math.round(count * 0.004));
  const shadow = flat ? new Uint8Array(n) : tidy(dark, mask, w, h, minArea);
  const key = lights.filter((l) => l.dir[2] > -0.2);
  // Sombra propia: la forma le da la espalda a la luz. Arrojada: debería recibirla y no la recibe.
  const castRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!shadow[i]) continue;
    if (key.length && exposure(normals, i, key) > 0.55) castRaw[i] = 1;
  }
  const castSoft = tidy(boxBlurMask(castRaw, shadow, w, h, Math.max(1, Math.round(top / 6))), shadow, w, h, minArea * 2);
  // Una sombra arrojada tiene el borde nítido: la forma de otra cosa proyectada encima. Si el
  // paso a la luz es gradual, sigue el volumen y es sombra propia. Ante la duda, propia.
  const cast = new Uint8Array(n);
  {
    const sm = boxBlur(shade, w, h, 1, 2);
    const parts = components(castSoft, w, h);
    const widths: number[][] = parts.area.map(() => []);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const id = parts.label[i];
        if (!id) continue;
        const next = [i - 1, i + 1, i - w, i + w];
        if (!next.some((q) => mask[q] && !shadow[q] && mat.group[q] >= 0 && !isBlack(q))) continue;
        const gr = mat.group[i];
        const g = Math.hypot(sm[i + 1] - sm[i - 1], sm[i + w] - sm[i - w]) / 2;
        if (g > 1e-3 && gr >= 0 && cuts[gr].cut > 0) widths[id].push(Math.max(0.3, 1 - cuts[gr].cut) / g / Math.max(3, radius[i]));
      }
    }
    const hard = widths.map((v) => (v.length >= 8 ? percentile(v, 0.5) < CAST_EDGE : false));
    for (let i = 0; i < n; i++) if (castSoft[i] && hard[parts.label[i]]) cast[i] = 1;
  }
  let shadowCount = 0;
  let blackCount = 0;
  let litSum = 0;
  let litN = 0;
  let darkSum = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const g = mat.group[i];
    if (isBlack(i)) {
      zones[i] = ZONE.oscuro;
      blackCount++;
      continue;
    }
    if (shadow[i]) {
      zones[i] = cast[i] ? ZONE.arrojada : ZONE.propia;
      shadowCount++;
      darkSum += shade[i];
    } else {
      zones[i] = g >= 0 && cuts[g].cut > 0 && tone[i] < cuts[g].half ? ZONE.medio : ZONE.luz;
      litSum += shade[i];
      litN++;
    }
  }
  const shadowShare = shadowCount / Math.max(1, count - blackCount);

  // 5. Acentos y brillos.
  const inside: number[] = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) if (mask[i]) inside.push(Y[i]);
  const lowY = percentile(inside, 0.035);
  const highY = percentile(inside, 0.985);
  const occ = new Uint8Array(n);
  const hi = new Uint8Array(n);
  if (!flat) {
    for (let i = 0; i < n; i++) {
      if (!mask[i] || mat.group[i] < 0 || isBlack(i)) continue;
      if (shadow[i] && Y[i] <= lowY && shade[i] < 0.3) occ[i] = 1;
      if (!shadow[i] && Y[i] >= highY && Y[i] / mat.ref[mat.group[i]] > 1.1) hi[i] = 1;
    }
  }
  const occTidy = tidy(occ, mask, w, h, Math.max(4, Math.round(minArea / 2)));
  for (let i = 0; i < n; i++) if (occTidy[i]) zones[i] = ZONE.oclusion;
  const hiParts = components(hi, w, h);
  const hiBlobs = new Map<number, { x: number; y: number; n: number }>();
  for (let i = 0; i < n; i++) {
    const id = hiParts.label[i];
    if (!id || hiParts.area[id] < 3) continue;
    zones[i] = ZONE.brillo;
    const b = hiBlobs.get(id) ?? { x: 0, y: 0, n: 0 };
    b.x += i % w;
    b.y += Math.floor(i / w);
    b.n++;
    hiBlobs.set(id, b);
  }
  const highlights = [...hiBlobs.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 7)
    .map((b) => ({ c: [b.x / b.n / w, b.y / b.n / h] as Pt, r: Math.sqrt(b.n / Math.PI) / Math.max(w, h) }));

  // 6. Contraluz: una franja clara pegada al contorno, del lado que la luz principal no toca.
  const rimMask = new Uint8Array(n);
  let ring = 0;
  let rimN = 0;
  let rimGain = 0;
  const rimSides = new Array(8).fill(0);
  if (!scene && !flat) {
    for (let i = 0; i < n; i++) {
      if (!mask[i] || mat.group[i] < 0) continue;
      // Un borde claro sobre algo casi negro vale; un negro con una pizca de gris, no.
      if (isBlack(i) && Y[i] < 0.025) continue;
      const R = Math.max(3, radius[i]);
      if (dist[i] > Math.max(2, R * 0.14)) continue;
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const len = Math.hypot(nx, ny);
      if (len < 0.3) continue;
      ring++;
      const x = i % w;
      const y = (i - x) / w;
      const ix = Math.round(x - (nx / len) * R * 0.5);
      const iy = Math.round(y - (ny / len) * R * 0.5);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const q = iy * w + ix;
      if (!mask[q] || mat.group[q] !== mat.group[i]) continue;
      const gain = shade[i] - shade[q];
      if (gain > 0.2 && (!key.length || exposure(normals, i, key.slice(0, 1)) < 0.3)) {
        rimMask[i] = 1;
        rimN++;
        rimSides[Math.floor((((Math.atan2(ny, nx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 8) % 8] += gain;
        rimGain += gain;
      }
    }
  }
  const rimShare = ring ? rimN / ring : 0;
  if (rimShare > 0.07) {
    // Un borde encendido por los dos lados son dos luces de atrás, no una de en medio.
    const sides = rimSides.map((g, i) => ({ g, a: ((i + 0.5) / rimSides.length) * Math.PI * 2 })).sort((p, q) => q.g - p.g);
    const picked: { g: number; a: number }[] = [];
    for (const side of sides) {
      if (side.g < rimGain * 0.2 || picked.length >= 2) break;
      const apart = (b: { a: number }) => Math.abs(Math.atan2(Math.sin(side.a - b.a), Math.cos(side.a - b.a)));
      if (picked.some((b) => apart(b) < 1.2)) continue;
      picked.push(side);
    }
    for (const side of picked) {
      const dir = unit([Math.cos(side.a), Math.sin(side.a), -0.55]);
      const near = (l: LightSource) => {
        const flatL = Math.hypot(l.dir[0], l.dir[1]);
        if (flatL < 0.3) return false;
        const d = Math.atan2(l.dir[1], l.dir[0]) - side.a;
        return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.8;
      };
      // Una luz ya encontrada por ese lado y casi de canto es esta misma.
      const twin = lights.find((l, i) => i > 0 && l.role !== 'contraluz' && l.dir[2] < 0.3 && near(l)) ?? lights.find((l) => l.role !== 'contraluz' && l.dir[2] < 0.1 && near(l));
      if (twin) twin.role = 'contraluz';
      else lights.push({ dir, strength: clamp((rimGain / rimN) * (side.g / picked[0].g), 0.15, 0.9), role: 'contraluz', ...describe(dir), sure: clamp(rimShare * 4, 0.2, 0.9) });
    }
  }
  if (lights.length) {
    const front = lights.find((l) => l.role !== 'contraluz');
    if (front) front.role = 'principal';
    for (const l of lights) {
      if (l.role !== 'relleno') continue;
      if (l.dir[2] < -0.12) l.role = 'contraluz';
      else if (l.dir[1] > 0.45 && l.strength < 0.7) l.role = 'rebote';
    }
    lights = lights.sort((a, b) => (a.role === 'principal' ? -1 : b.role === 'principal' ? 1 : b.strength - a.strength));
  }

  // 7. Qué tan duro es el paso de luz a sombra, y si la sombra se aclara por dentro.
  const smooth = boxBlur(shade, w, h, 1, 2);
  const widths: number[] = [];
  let coreSum = 0;
  let coreN = 0;
  let deepSum = 0;
  let deepN = 0;
  const propia = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (zones[i] === ZONE.propia || zones[i] === ZONE.oclusion) propia[i] = 1;
  const intoShadow = distanceToEdge(propia, w, h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!propia[i]) continue;
      const d = intoShadow[i] / 3;
      const R = Math.max(3, radius[i]);
      if (d <= 1.5) {
        const lit = [i - 1, i + 1, i - w, i + w].some((q) => zones[q] === ZONE.luz || zones[q] === ZONE.medio);
        if (lit) {
          const g = Math.hypot(smooth[i + 1] - smooth[i - 1], smooth[i + w] - smooth[i - w]) / 2;
          const gr = mat.group[i];
          if (g > 1e-3 && gr >= 0) widths.push(Math.max(0.3, 1 - cuts[gr].cut) / g / R);
        }
      }
      if (d < R * 0.3) {
        coreSum += shade[i];
        coreN++;
      } else if (d > R * 0.45) {
        deepSum += shade[i];
        deepN++;
      }
    }
  }
  const hardness = widths.length > 12 ? percentile(widths, 0.5) : null;
  const reflected = coreN > 40 && deepN > 40 && deepSum / deepN > coreSum / coreN + 0.035;

  // 8. Temperatura de luz y sombra.
  let lb = 0;
  let ln = 0;
  let sb = 0;
  let sn = 0;
  for (let i = 0; i < n; i += 3) {
    if (!mask[i] || isBlack(i)) continue;
    const b = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])[2];
    if (shadow[i]) {
      sb += b;
      sn++;
    } else {
      lb += b;
      ln++;
    }
  }
  const temperature = ln > 30 && sn > 30 ? { light: lb / ln, shadow: sb / sn } : null;

  // 9. Sombra que la figura arroja fuera de sí.
  let ground: Pt[][] = [];
  let groundDir: Pt | null = null;
  if (!scene && !flat && y1 < h - 3) {
    const g = groundShadow(rgba, Y, mask, w, h, { x0, x1, y0, y1 });
    ground = g.loops;
    groundDir = g.dir;
  }

  // 10. Trazos.
  const eps = 0.9;
  const formMask = new Uint8Array(n);
  const castMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (zones[i] === ZONE.propia || zones[i] === ZONE.oclusion) formMask[i] = 1;
    if (zones[i] === ZONE.arrojada) castMask[i] = 1;
  }
  const isLit = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (zones[y * w + x] === ZONE.luz || zones[y * w + x] === ZONE.medio || zones[y * w + x] === ZONE.brillo);
  const isOut = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x];
  const terminator: Pt[][] = [];
  for (const loop of maskContours(formMask, w, h)) {
    if (loop.length < 8) continue;
    // Un vértice es terminador si toca luz y no toca el borde de la figura.
    const ok = loop.map(([x, y]) => {
      let lit = false;
      let out = false;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        if (isLit(x + dx, y + dy)) lit = true;
        if (isOut(x + dx, y + dy)) out = true;
      }
      return lit && !out;
    });
    const start = ok.indexOf(false);
    const N = loop.length;
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= Math.max(10, top * 0.9)) terminator.push(simplifyLine(run, 1.3).map(([x, y]) => [x / w, y / h] as Pt));
      run = [];
    };
    if (start < 0) {
      run = [...loop, loop[0]];
      flush();
    } else {
      for (let k = 1; k <= N; k++) {
        const j = (start + k) % N;
        if (ok[j]) run.push(loop[j]);
        else flush();
      }
      flush();
    }
  }
  const rim: Pt[][] = [];
  if (rimShare > 0.07) {
    for (const loop of maskContours(mask, w, h)) {
      let run: Pt[] = [];
      const flush = () => {
        if (run.length >= Math.max(8, top * 0.6)) rim.push(simplifyLine(run, eps).map(([x, y]) => [x / w, y / h] as Pt));
        run = [];
      };
      const near = (x: number, y: number) => {
        for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && rimMask[(y + dy) * w + x + dx]) return true;
        return false;
      };
      for (const p of loop) {
        if (near(p[0], p[1])) run.push(p);
        else flush();
      }
      flush();
    }
  }

  return {
    w, h, lights, flat, fit: fit.r2, ambient: fit.ambient, shadowShare, darkShare: blackCount / Math.max(1, count),
    ratio: litN && shadowCount ? litSum / litN / Math.max(0.02, darkSum / shadowCount) : null,
    hardness, temperature, reflected, zones,
    terminator,
    form: loops(formMask, w, h, eps, 10),
    cast: loops(castMask, w, h, eps, 10),
    ground, groundDir,
    occlusion: loops(occTidy, w, h, 0.6, 6).slice(0, 14),
    highlights, rim,
    center: [cx / w, cy / h], radius: Math.max(x1 - x0, y1 - y0) / 2 / Math.max(w, h),
    normals, shade, scene,
  };
}

/**
 * En un lugar no hay una forma que modelar: lo que se puede afirmar es de qué lado está el sol,
 * por dónde el cielo es más claro. El cielo es lo lejano y claro de la parte de arriba.
 */
function skySide(Y: Float32Array, depth: Float32Array | null, w: number, h: number): { dir: V3; sure: number } | null {
  if (!depth) return null;
  let far = Infinity;
  let near = -Infinity;
  for (const v of depth) {
    if (v < far) far = v;
    if (v > near) near = v;
  }
  const cut = far + (near - far) * 0.08;
  const cols = 6;
  const sum = new Array(cols).fill(0);
  const cnt = new Array(cols).fill(0);
  let total = 0;
  let lowSum = 0;
  let lowN = 0;
  let highSum = 0;
  let highN = 0;
  let bottom = 0;
  for (let y = 0; y < Math.round(h * 0.6); y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (depth[i] > cut || Y[i] < 0.2) continue;
      const c = Math.min(cols - 1, Math.floor((x / w) * cols));
      sum[c] += Y[i];
      cnt[c]++;
      total++;
      if (y > bottom) bottom = y;
    }
  }
  if (total < w * h * 0.08) return null;
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (depth[i] > cut || Y[i] < 0.2) continue;
      if (y < bottom * 0.4) (highSum += Y[i]), highN++;
      else if (y > bottom * 0.6) (lowSum += Y[i]), lowN++;
    }
  }
  const have = cnt.map((c) => c > total * 0.04);
  if (!have[0] && !have[1]) return null;
  if (!have[cols - 1] && !have[cols - 2]) return null;
  const mean = (a: number, b: number) => (sum[a] + sum[b]) / Math.max(1, cnt[a] + cnt[b]);
  const left = mean(0, 1);
  const right = mean(cols - 2, cols - 1);
  const gap = (right - left) / Math.max(1e-3, Math.max(left, right));
  if (Math.abs(gap) < 0.1) return null;
  // Cielo más claro junto al horizonte: sol bajo. Más claro arriba: sol alto.
  const lowSun = lowN > 50 && highN > 50 && lowSum / lowN > (highSum / highN) * 1.12;
  const x = gap > 0 ? 0.75 : -0.75;
  const dir = unit([x, lowSun ? -0.25 : -0.6, -0.2]);
  return { dir, sure: clamp(Math.abs(gap) * 1.6, 0.15, 0.6) };
}

/** Suaviza una máscara dentro de otra y la vuelve a cortar a la mitad. */
function boxBlurMask(mask: Uint8Array, inside: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const f = new Float32Array(mask.length);
  const g = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    f[i] = mask[i];
    g[i] = inside[i];
  }
  const a = boxBlur(f, w, h, r, 1);
  const b = boxBlur(g, w, h, r, 1);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (inside[i] && a[i] > b[i] * 0.5) out[i] = 1;
  return out;
}

/**
 * Sombra arrojada sobre el suelo o la pared: pegada a la figura, del color del fondo que la
 * rodea pero más oscura.
 */
function groundShadow(rgba: Uint8ClampedArray, Y: Float32Array, mask: Uint8Array, w: number, h: number, box: { x0: number; x1: number; y0: number; y1: number }): { loops: Pt[][]; dir: Pt | null } {
  const n = w * h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] ? 0 : 1;
  const away = distanceToEdge(out, w, h);
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const reach = size * 0.55;
  const ringY: number[] = [];
  const ringA: number[] = [];
  const ringB: number[] = [];
  const ring: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue;
    const d = away[i] / 3;
    if (d > reach) continue;
    ring.push(i);
    if (ring.length % 3) continue;
    const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    ringY.push(Y[i]);
    ringA.push(lab[1]);
    ringB.push(lab[2]);
  }
  if (ringY.length < 80) return { loops: [], dir: null };
  // El fondo de referencia es lo claro del anillo: la sombra misma no debe bajarlo.
  const refY = percentile(ringY, 0.7);
  const refA = percentile(ringA, 0.5);
  const refB = percentile(ringB, 0.5);
  const cand = new Uint8Array(n);
  let total = 0;
  for (const i of ring) {
    const ratio = Y[i] / Math.max(1e-4, refY);
    if (ratio > 0.74 || ratio < 0.05) continue;
    const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (Math.hypot(lab[1] - refA, lab[2] - refB) > 16) continue;
    cand[i] = 1;
    total++;
  }
  // Si medio fondo es "sombra", el fondo simplemente es variado: no hay nada que afirmar.
  if (total > ring.length * 0.42) return { loops: [], dir: null };
  const parts = components(cand, w, h);
  let figureArea = 0;
  for (let i = 0; i < n; i++) if (mask[i]) figureArea++;
  const touch = new Set<number>();
  const base = box.y0 + (box.y1 - box.y0) * 0.72;
  for (const i of ring) if (cand[i] && away[i] / 3 <= 2.5 && Math.floor(i / w) >= base) touch.add(parts.label[i]);
  const keep = new Uint8Array(n);
  let sx = 0;
  let sy = 0;
  let sn = 0;
  const good = [...touch].filter((id) => parts.area[id] >= figureArea * 0.012 && parts.area[id] <= figureArea * 0.9).sort((a, b) => parts.area[b] - parts.area[a]);
  // Muchas manchas pegadas a la figura son pasto o textura, no una sombra.
  if (good.length > 4) return { loops: [], dir: null };
  const chosen = new Set(good.slice(0, 2));
  for (const i of ring) {
    const id = parts.label[i];
    if (!id || !chosen.has(id)) continue;
    const a = parts.area[id];
    if (a < figureArea * 0.012 || a > figureArea * 0.9) continue;
    keep[i] = 1;
    sx += i % w;
    sy += Math.floor(i / w);
    sn++;
  }
  if (!sn) return { loops: [], dir: null };
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const dx = sx / sn - cx;
  const dy = sy / sn - cy;
  const len = Math.hypot(dx, dy);
  return { loops: loops(keep, w, h, 1, 12), dir: len > size * 0.12 ? [dx / len, dy / len] : null };
}

/** Normales de la malla de un cuerpo sobre una rejilla, con la más cercana encima. */
export function rasterNormals(px: Float32Array, py: Float32Array, pz: Float32Array, vn: Float32Array, faces: Int32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  const zbuf = new Float32Array(w * h).fill(Infinity);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t];
    const b = faces[t + 1];
    const c = faces[t + 2];
    const area = (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
    if (Math.abs(area) < 1e-6) continue;
    const xa = Math.max(0, Math.floor(Math.min(px[a], px[b], px[c])));
    const xb = Math.min(w - 1, Math.ceil(Math.max(px[a], px[b], px[c])));
    const ya = Math.max(0, Math.floor(Math.min(py[a], py[b], py[c])));
    const yb = Math.min(h - 1, Math.ceil(Math.max(py[a], py[b], py[c])));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const w0 = ((px[b] - x) * (py[c] - y) - (py[b] - y) * (px[c] - x)) / area;
        const w1 = ((px[c] - x) * (py[a] - y) - (py[c] - y) * (px[a] - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const z = pz[a] * w0 + pz[b] * w1 + pz[c] * w2;
        const i = y * w + x;
        if (z >= zbuf[i]) continue;
        zbuf[i] = z;
        const nx = vn[a * 3] * w0 + vn[b * 3] * w1 + vn[c * 3] * w2;
        const ny = vn[a * 3 + 1] * w0 + vn[b * 3 + 1] * w1 + vn[c * 3 + 1] * w2;
        const nz = vn[a * 3 + 2] * w0 + vn[b * 3 + 2] * w1 + vn[c * 3 + 2] * w2;
        const len = Math.hypot(nx, ny, nz) || 1;
        out[i * 3] = nx / len;
        out[i * 3 + 1] = ny / len;
        out[i * 3 + 2] = nz / len;
      }
    }
  }
  return out;
}

/** Una luz elegida a mano, con la misma forma que una leída. */
export function lightFrom(azimuth: number, elevation: number, role: LightRole = 'principal', strength = 1): LightSource {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return { dir: [Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)], strength, role, azimuth, elevation, sure: 1 };
}

/**
 * La figura como si fuera de yeso bajo esas luces: cinco valores, de brillo a sombra. Sirve
 * para ver el volumen sin el color, y para probar otra luz.
 */
export function clay(read: Pick<LightRead, 'normals' | 'zones' | 'w' | 'h'>, lights: LightSource[], ambient = 0.16): Uint8Array {
  const n = read.w * read.h;
  const out = new Uint8Array(n);
  const front = lights.filter((l) => l.role !== 'contraluz');
  const back = lights.filter((l) => l.role === 'contraluz');
  for (let i = 0; i < n; i++) {
    if (!read.zones[i]) continue;
    let e = ambient + exposure(read.normals, i, front) * (1 - ambient);
    for (const l of back) {
      const v = read.normals[i * 3] * l.dir[0] + read.normals[i * 3 + 1] * l.dir[1] + read.normals[i * 3 + 2] * l.dir[2];
      if (v > 0.25 && read.normals[i * 3 + 2] < 0.5) e = Math.max(e, 0.55 + v * 0.4 * l.strength);
    }
    out[i] = Math.round(clamp(e, 0, 1) * 254) + 1;
  }
  return out;
}

/** La dirección de una luz, como se la dirías a alguien. */
export function lightWords(l: Pick<LightSource, 'dir'>): string {
  const [x, y, z] = l.dir;
  const flat = Math.hypot(x, y);
  if (flat < 0.3) return z > 0 ? tx('common.de_frente') : tx('common.de_atras');
  const parts: string[] = [];
  if (y < -0.35 * flat) parts.push(tx('common.arriba'));
  if (y > 0.35 * flat) parts.push(tx('common.abajo'));
  if (x < -0.35 * flat) parts.push(tx('common.la_izquierda'));
  if (x > 0.35 * flat) parts.push(tx('common.la_derecha'));
  const side = parts.join(tx('common.sep_a'));
  const depth = z < -0.2 ? tx('common.por_detras') : z > 0.75 ? tx('light.casi_de_frente') : z > 0.35 ? tx('light.algo_de_frente') : tx('light.de_lado');
  return tx('light.desde', { side, depth });
}

/**
 * La luz principal dicha como la diría un pintor, sin esquemas de retrato: un nombre como
 * "Rembrandt" o "mariposa" exige ver el triángulo o la sombra bajo la nariz, y eso aquí no se mide.
 */
export function setupName(l: Pick<LightSource, 'dir'>): string {
  const [x, y, z] = l.dir;
  const side = Math.abs(x);
  if (z < -0.2) return tx('light.contraluz_la_figura_se');
  if (y > 0.45 && z > 0) return tx('light.luz_desde_abajo_voltea');
  if (side < 0.25 && z > 0.6) return tx('light.luz_de_frente_aplana');
  if (side > 0.85) return tx('light.luz_de_lado_media');
  if (side > 0.55) return tx('light.luz_lateral_modela_el');
  return tx('light.luz_de_tres_cuartos');
}

/**
 * Qué mejilla está más clara. En un retrato es la prueba más directa de qué lado viene la luz,
 * más que el sombreado del cuerpo. Se mide en la franja de las mejillas y se descarta lo más
 * oscuro de la caja (pelo, cejas, ojos), que no es piel. `side` positivo: la derecha de la
 * imagen más clara; `sure` dice si la diferencia alcanza para afirmarlo.
 */
export function faceSides(rgba: Uint8ClampedArray, w: number, h: number, box: { x: number; y: number; w: number; h: number }): { left: number; right: number; side: number; sure: boolean } {
  const x0 = Math.max(0, Math.floor(box.x * w));
  const x1 = Math.min(w - 1, Math.ceil((box.x + box.w) * w));
  const y0 = Math.max(0, Math.floor((box.y + box.h * 0.35) * h));
  const y1 = Math.min(h - 1, Math.ceil((box.y + box.h * 0.8) * h));
  const all: number[] = [];
  const lum = (i: number) => 0.2126 * LINEAR[rgba[i * 4]] + 0.7152 * LINEAR[rgba[i * 4 + 1]] + 0.0722 * LINEAR[rgba[i * 4 + 2]];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) all.push(lum(y * w + x));
  if (all.length < 50) return { left: 0, right: 0, side: 0, sure: false };
  const floor = percentile(all, 0.35);
  const band = (a: number, b: number) => {
    const v: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = Math.floor(x0 + (x1 - x0) * a); x <= Math.ceil(x0 + (x1 - x0) * b); x++) {
        const l = lum(y * w + x);
        if (l >= floor) v.push(l);
      }
    }
    return v.length > 20 ? percentile(v, 0.5) : 0;
  };
  const left = band(0.1, 0.42);
  const right = band(0.58, 0.9);
  const top = Math.max(left, right, 1e-4);
  const side = (right - left) / top;
  return { left, right, side, sure: Math.abs(side) > 0.15 && Math.min(left, right) > 0 };
}
