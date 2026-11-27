import type { PartProfile, ShapeKind } from './shapes';
import type { Pt } from './types';

import { t as tx } from '../i18n';
/**
 * Geometría del dibujo orgánico, sin DOM. Aquí se decide qué forma tiene cada parte y por dónde
 * pasan sus líneas; organic-draw.ts las vuelve trazos a mano. Todo va en las unidades del esqueleto:
 * x e y en altos de encuadre (x_pantalla = x · alto de la vista), z crece hacia quien mira.
 * Cada regla cita la investigación: cuerpo.md (cuerpo) y cabeza-manos-pintura.md (cabeza, manos, luz).
 */

export type V3 = [number, number, number];
export type DrawStyle = 'realista' | 'anime' | 'cartoon' | 'caricatura' | 'concept' | 'pintura';

export const DRAW_STYLES: DrawStyle[] = ['realista', 'anime', 'cartoon', 'caricatura', 'concept', 'pintura'];
/** Exageración con que arranca cada estilo. */
export const STYLE_EXAGGERATION: Record<DrawStyle, number> = { realista: 0, anime: 0.25, cartoon: 0.6, caricatura: 0.5, concept: 0.3, pintura: 0 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};
const unit2 = (a: Pt): Pt => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* ───────────────────────────── estilos ───────────────────────────── */

export interface StyleParams {
  style: DrawStyle;
  /** Grado del polinomio de Bernstein que suaviza cada costado (cuerpo.md, forma de dibujante). */
  degree: number;
  /** Multiplica el ancho de los miembros: el anime los afina. */
  slim: number;
  /** Cuánto se adelgazan muñecas y tobillos (1 = nada). */
  distal: number;
  /** Cartoon: tubo de manguera, mismo ancho de punta a punta. */
  uniform: boolean;
  /** Cartoon: flecha del arco del eje, en fracción del largo. */
  bow: number;
  /** Contornos transversales por segmento, ya con la simplificación. */
  cross: number;
  /** Caricatura: cuánto se aleja el ancho del canon. */
  caricature: number;
  exaggeration: number;
  simplification: number;
}

const BASE_DEGREE: Record<DrawStyle, number> = { realista: 4, anime: 3, cartoon: 2, caricatura: 3, concept: 3, pintura: 4 };
const BASE_CROSS: Record<DrawStyle, number> = { realista: 2, anime: 1, cartoon: 0, caricatura: 1, concept: 0, pintura: 2 };

export function styleParams(style: DrawStyle, exaggeration: number, simplification: number): StyleParams {
  const e = clamp(exaggeration, 0, 1);
  const s = clamp(simplification, 0, 1);
  return {
    style,
    degree: Math.max(1, BASE_DEGREE[style] - Math.round(2 * s)),
    slim: style === 'anime' ? 0.8 : 1,
    distal: style === 'anime' ? 0.72 : 1,
    uniform: style === 'cartoon',
    bow: style === 'cartoon' ? 0.12 * e : 0,
    cross: Math.round(BASE_CROSS[style] * (1 - s)),
    caricature: style === 'caricatura' ? e : 0,
    exaggeration: e,
    simplification: s,
  };
}

/* ───────────────────────── suavizado de anchos ───────────────────────── */

/** Resuelve un sistema pequeño por eliminación gaussiana con pivote. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / d;
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / (M[i][i] || 1e-12);
  }
  return x;
}

const binom = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/**
 * Ajusta por mínimos cuadrados un polinomio de Bernstein de grado p a valores muestreados parejo
 * de 0 a 1 y lo evalúa en las mismas estaciones: una sola panza o un adelgazamiento limpio, sin el
 * ruido de la malla (cuerpo.md: curvas largas, no polígonos).
 */
export function bernsteinFit(values: number[], degree: number): number[] {
  const n = values.length;
  if (n < 3) return [...values];
  const p = Math.max(1, Math.min(degree, n - 1));
  const basis = (t: number) => Array.from({ length: p + 1 }, (_, k) => binom(p, k) * t ** k * (1 - t) ** (p - k));
  const rows = values.map((_, i) => basis(i / (n - 1)));
  const A: number[][] = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0));
  const b = new Array<number>(p + 1).fill(0);
  rows.forEach((row, i) => {
    for (let a = 0; a <= p; a++) {
      b[a] += row[a] * values[i];
      for (let c = 0; c <= p; c++) A[a][c] += row[a] * row[c];
    }
  });
  const coef = solve(A, b);
  return rows.map((row) => row.reduce((acc, v, k) => acc + v * coef[k], 0));
}

/**
 * Suaviza cada costado por separado: se conserva la asimetría (el bíceps no es el tríceps). Ancho
 * mínimo 0.25 × mediana; máximo 1.6 × mediana (o el tope dado): una capa no vuelve un muslo una vela.
 */
export function smoothWidths(left: number[], right: number[], degree: number, cap?: number): { left: number[]; right: number[] } {
  const med = median([...left, ...right].filter((v) => v > 0)) || 1e-4;
  const lo = 0.25 * med;
  const hi = cap ?? 1.6 * med;
  const fix = (v: number[]) => bernsteinFit(v, degree).map((x) => clamp(x, lo, Math.max(lo, hi)));
  return { left: fix(left), right: fix(right) };
}

/* ───────────────────────── forma de una parte ───────────────────────── */

export interface BoneRef {
  a: V3;
  b: V3;
}

export interface PartOpts {
  /** Alto de una cabeza, para el canon de la caricatura. */
  H?: number;
  /** El eje se alarga 10 % más allá de la articulación para que se monten (cuerpo.md, solape). */
  extendStart?: boolean;
  extendEnd?: boolean;
  /** Hacia qué lado del eje se curva el arco del cartoon: +1 hacia across, -1 al contrario. */
  bowSide?: number;
  /** Tope de ancho (por ejemplo 1.6 × el de la malla sin silueta). */
  cap?: number;
  /** Mínimo de profundidad de las tapas, en fracción del semiancho. */
  capFloor?: number;
}

export interface OrganicShape {
  key: string;
  kind: ShapeKind;
  /** Costados estación por estación, con las estaciones de solape al principio y al final. */
  left: Pt[];
  right: Pt[];
  capStart?: Pt[];
  capEnd?: Pt[];
  /** Línea central, estación por estación. */
  axis: Pt[];
  /** Parámetro a lo largo del eje de cada estación: fuera de [0, 1] son las de solape. */
  ts: number[];
  half: number[];
  z: number;
  /** |d_z| / |d| del hueso: 0 de lado, 1 de frente. */
  open: number;
  /** Componente z del hueso unitario, con signo. */
  dz: number;
  across: Pt;
  dir: Pt;
}

const LIMB_KINDS = new Set<ShapeKind>(['brazo', 'antebrazo', 'muslo', 'pierna']);
/** Semiancho canon en cabezas, a lo que ya usa el maniquí de cajas (artist-draw). */
const CANON: Partial<Record<ShapeKind, number>> = { brazo: 0.2, antebrazo: 0.17, muslo: 0.3, pierna: 0.22, cuello: 0.16, mano: 0.14, pie: 0.14 };

export function openness(bone: BoneRef | null): { open: number; dz: number } {
  if (!bone) return { open: 0.3, dz: 0.3 };
  const d: V3 = [bone.b[0] - bone.a[0], bone.b[1] - bone.a[1], bone.b[2] - bone.a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { open: Math.min(1, Math.abs(d[2]) / l), dz: d[2] / l };
}

interface Core {
  key: string;
  kind: ShapeKind;
  O: Pt;
  A: Pt;
  X: Pt;
  ts: number[];
  left: number[];
  right: number[];
  z: number;
  open: number;
  dz: number;
  /** Profundidad de la tapa de cada punta, en fracción del semiancho; null deja la punta abierta (solape). */
  capStart: number | null;
  capEnd: number | null;
  bow?: { k: number; side: number };
}

function buildShape(c: Core): OrganicShape {
  const { O, A, X } = c;
  const len = Math.hypot(A[0], A[1]) || 1e-6;
  const dir: Pt = [A[0] / len, A[1] / len];
  const xl = Math.hypot(X[0], X[1]) || 1;
  const xu: Pt = [X[0] / xl, X[1] / xl];
  const at = (t: number, d: number): Pt => {
    let x = O[0] + A[0] * t + X[0] * d;
    let y = O[1] + A[1] * t + X[1] * d;
    if (c.bow && c.bow.k) {
      const f = Math.sin(Math.PI * clamp(t, 0, 1)) * c.bow.k * len * c.bow.side;
      x += xu[0] * f;
      y += xu[1] * f;
    }
    return [x, y];
  };
  const left = c.ts.map((t, i) => at(t, -c.left[i]));
  const right = c.ts.map((t, i) => at(t, c.right[i]));
  const axis = c.ts.map((t, i) => at(t, (c.right[i] - c.left[i]) / 2));
  const half = c.ts.map((_, i) => (c.left[i] + c.right[i]) / 2);
  const n = c.ts.length;
  const cap = (i: number, sign: 1 | -1, depthK: number): Pt[] => {
    const L = left[i];
    const R = right[i];
    const d = half[i] * depthK;
    const m = 9;
    const out: Pt[] = [];
    for (let k = 1; k < m; k++) {
      const s = k / m;
      // Media elipse: se abre del costado izquierdo al derecho (o al revés en la punta del inicio).
      const u = sign === 1 ? s : 1 - s;
      out.push([lerp(L[0], R[0], u) + dir[0] * sign * d * Math.sin(Math.PI * s), lerp(L[1], R[1], u) + dir[1] * sign * d * Math.sin(Math.PI * s)]);
    }
    return out;
  };
  const out: OrganicShape = { key: c.key, kind: c.kind, left, right, axis, ts: c.ts, half, z: c.z, open: c.open, dz: c.dz, across: xu, dir };
  if (c.capStart !== null) out.capStart = cap(0, -1, c.capStart);
  if (c.capEnd !== null) out.capEnd = cap(n - 1, 1, c.capEnd);
  return out;
}

/** El contorno cerrado de una forma, en orden: costado izquierdo, tapa del final, derecho de vuelta, tapa del inicio. */
export function shapePolygon(s: OrganicShape): Pt[] {
  return [...s.left, ...(s.capEnd ?? []), ...[...s.right].reverse(), ...(s.capStart ?? [])];
}

/**
 * La forma orgánica de una parte (miembros, cuello, manos, pies) a partir del ancho REAL medido:
 * suavizado con polinomio de grado del estilo, asimetría conservada, solape en la articulación,
 * tapa redonda en las puntas libres y los cambios de cada estilo.
 */
export function partShape(p: PartProfile, bone: BoneRef | null, st: StyleParams, opts: PartOpts = {}): OrganicShape {
  const { open, dz } = openness(bone);
  const H = opts.H ?? 0.12;
  let { left, right } = smoothWidths(p.left, p.right, st.degree, opts.cap);
  const n = left.length;
  const tt = (i: number) => i / (n - 1);
  const soft = LIMB_KINDS.has(p.kind) || p.kind === 'cuello';
  if (LIMB_KINDS.has(p.kind)) {
    left = left.map((v) => v * st.slim);
    right = right.map((v) => v * st.slim);
  }
  if (st.distal < 1 && (p.kind === 'antebrazo' || p.kind === 'pierna' || p.kind === 'mano' || p.kind === 'pie')) {
    const k = (i: number) => lerp(1, st.distal, ease((tt(i) - 0.45) / 0.55));
    left = left.map((v, i) => v * k(i));
    right = right.map((v, i) => v * k(i));
  }
  if (st.uniform && soft) {
    // Tubo de manguera: el ancho promedio de lo central, de punta a punta.
    const inner = [...left, ...right].slice(0);
    const avg = inner.reduce((a, b) => a + b, 0) / (inner.length || 1);
    left = left.map(() => avg);
    right = right.map(() => avg);
  }
  const canon = CANON[p.kind];
  if (st.caricature > 0 && canon) {
    const c = canon * H;
    const k = 1 + 1.5 * st.caricature;
    const push = (v: number) => Math.max(0.25 * c, c + (v - c) * k);
    left = left.map(push);
    right = right.map(push);
  }
  const ts = Array.from({ length: n }, (_, i) => tt(i));
  const ext = 0.1;
  if (opts.extendStart) {
    ts.unshift(-ext);
    left.unshift(left[0]);
    right.unshift(right[0]);
  }
  if (opts.extendEnd) {
    ts.push(1 + ext);
    left.push(left[left.length - 1]);
    right.push(right[right.length - 1]);
  }
  const depth = Math.max(opts.capFloor ?? 0.35, open);
  return buildShape({
    key: p.key,
    kind: p.kind,
    O: p.origin,
    A: p.axis,
    X: p.across,
    ts,
    left,
    right,
    z: bone ? (bone.a[2] + bone.b[2]) / 2 : p.z,
    open,
    dz,
    capStart: opts.extendStart ? null : depth,
    capEnd: opts.extendEnd ? null : depth,
    bow: st.bow > 0 ? { k: st.bow, side: opts.bowSide ?? 1 } : undefined,
  });
}

/* ───────────────────────── masas del tronco ───────────────────────── */

/** Ancho del huevo a lo largo de su alto: arriba 0.8, máximo al 60 % hacia abajo, abajo 0.85 (cuerpo.md, regla 9). */
export function eggWidth(s: number): number {
  return s <= 0.6 ? lerp(0.8, 1, ease(s / 0.6)) : lerp(1, 0.85, ease((s - 0.6) / 0.4));
}

/**
 * Caja torácica: un huevo cerrado alrededor del eje del perfil `torax`. Ancho máximo = semiancho
 * máximo suavizado; alto = 0.55 × largo del eje por cada lado del centro; se inclina con su propio eje.
 */
export function eggShape(p: PartProfile, bone: BoneRef | null, st: StyleParams): OrganicShape {
  const { open, dz } = openness(bone);
  const sm = smoothWidths(p.left, p.right, 3);
  const half = sm.left.map((v, i) => (v + sm.right[i]) / 2);
  const wmax = Math.max(...half.slice(2, -2));
  const offs = bernsteinFit(sm.right.map((v, i) => (v - sm.left[i]) / 2), 2);
  const n = 17;
  const ts: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    ts.push(0.5 - 0.55 + 1.1 * s);
    const w = wmax * eggWidth(s);
    const o = offs[Math.round(clamp(ts[i], 0, 1) * (offs.length - 1))];
    left.push(Math.max(0.2 * wmax, w - o));
    right.push(Math.max(0.2 * wmax, w + o));
  }
  void st;
  return buildShape({ key: 'huevo', kind: 'torax', O: p.origin, A: p.axis, X: p.across, ts, left, right, z: bone ? (bone.a[2] + bone.b[2]) / 2 : p.z, open, dz, capStart: 0.34, capEnd: 0.5 });
}

/**
 * Pelvis: un cuenco. Borde de arriba abierto (ahí va la elipse de la cresta ilíaca), costados que
 * bajan y se cierran en una U redondeada.
 */
export function bowlShape(p: PartProfile, bone: BoneRef | null, st: StyleParams): OrganicShape {
  const { open, dz } = openness(bone);
  const sm = smoothWidths(p.left, p.right, Math.min(3, st.degree));
  const n = sm.left.length;
  // El cuenco no baja con los muslos: llega a 70 % del eje y ahí se cierra en U.
  const m = Math.round((n - 1) * 0.7) + 1;
  const ts = Array.from({ length: m }, (_, i) => i / (n - 1));
  // Más ancho arriba (crestas) y estrechándose hacia la U.
  const k = (t: number) => lerp(1, 0.7, ease((t - 0.2) / 0.5));
  const left = sm.left.slice(0, m).map((v, i) => v * k(ts[i]));
  const right = sm.right.slice(0, m).map((v, i) => v * k(ts[i]));
  return buildShape({ key: 'cuenco', kind: 'pelvis', O: p.origin, A: p.axis, X: p.across, ts, left, right, z: bone ? (bone.a[2] + bone.b[2]) / 2 : p.z, open, dz, capStart: null, capEnd: 0.7 });
}

/* ───────────────────── anillos transversales (cross-contour) ───────────────────── */

export interface RingOpts {
  /** Hacia dónde va +u en la imagen; sin valor, la perpendicular del hueso. */
  across?: Pt;
  /** Radio hacia el lado -u y +u, para seguir un contorno asimétrico. */
  rLeft?: number;
  rRight?: number;
  steps?: number;
}

/**
 * Anillo de un segmento: C + r(cos θ·u + sen θ·w), con u perpendicular al hueso en el plano de la
 * imagen y w = d × u. Solo se devuelve el medio anillo visible (normal con z > 0); si el hueso apunta
 * casi de frente (|d_z| > 0.9) sale la elipse completa: es la boca del tubo (cuerpo.md, reglas 22 y 24).
 */
export function ringArc(center: V3, dir: V3, radius: number, opts: RingOpts = {}): { pts: Pt[]; closed: boolean } {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const flat = Math.hypot(d[0], d[1]);
  let u: Pt;
  if (opts.across) u = unit2(opts.across);
  else u = flat > 1e-6 ? [-d[1] / flat, d[0] / flat] : [1, 0];
  const u3: V3 = [u[0], u[1], 0];
  let w: V3 = [d[1] * u3[2] - d[2] * u3[1], d[2] * u3[0] - d[0] * u3[2], d[0] * u3[1] - d[1] * u3[0]];
  const wl = Math.hypot(w[0], w[1], w[2]) || 1;
  w = [w[0] / wl, w[1] / wl, w[2] / wl];
  // La normal debe asomar hacia quien mira para el lado sen θ > 0.
  if (w[2] < 0) w = [-w[0], -w[1], -w[2]];
  const full = Math.abs(d[2]) > 0.9;
  const steps = opts.steps ?? (full ? 28 : 14);
  const rl = opts.rLeft ?? radius;
  const rr = opts.rRight ?? radius;
  const pts: Pt[] = [];
  const last = full ? steps - 1 : steps;
  for (let i = 0; i <= last; i++) {
    const th = (full ? (i / steps) * Math.PI * 2 : (i / steps) * Math.PI);
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const ru = c >= 0 ? rr : rl;
    pts.push([center[0] + u[0] * c * ru + w[0] * sn * radius, center[1] + u[1] * c * ru + w[1] * sn * radius]);
  }
  return { pts, closed: full };
}

/** Qué estaciones de un segmento llevan contorno: la más ancha y, si está escorzado, otra lejos de ella. */
export function crossStations(s: OrganicShape, count: number): number[] {
  if (count <= 0) return [];
  const inner = s.ts.map((t, i) => ({ t, i })).filter((q) => q.t >= 0.12 && q.t <= 0.88);
  if (!inner.length) return [];
  const widest = inner.reduce((a, b) => (s.half[b.i] > s.half[a.i] ? b : a));
  const out = [widest.i];
  const foreshortened = s.open > 0.35;
  if (count >= 2 && foreshortened) {
    const far = widest.t > 0.5 ? 0.25 : 0.75;
    const other = inner.reduce((a, b) => (Math.abs(b.t - far) < Math.abs(a.t - far) ? b : a));
    if (other.i !== widest.i) out.push(other.i);
  }
  return out;
}

/** Los contornos transversales de un segmento (un anillo por estación elegida). */
export function crossContours(s: OrganicShape, count: number): { pts: Pt[]; closed: boolean }[] {
  const flat = Math.sqrt(Math.max(0, 1 - s.dz * s.dz));
  return crossStations(s, count).map((i) => {
    const c = s.axis[i];
    const L = s.left[i];
    const R = s.right[i];
    const half = s.half[i];
    // El radio de profundidad es el promedio; el de cada lado sigue el contorno.
    const rl = Math.hypot(c[0] - L[0], c[1] - L[1]);
    const rr = Math.hypot(c[0] - R[0], c[1] - R[1]);
    return ringArc([c[0], c[1], 0], [s.dir[0] * flat, s.dir[1] * flat, s.dz], half, { across: s.across, rLeft: rl, rRight: rr });
  });
}

/**
 * Anillo de una masa grande (tórax, pelvis): una rebanada que va de L a R en la imagen y se abre
 * hacia donde mira el frente, enrollada como si la forma fuera transparente. Solo el medio anillo visible.
 */
export function slabRing(L: Pt, R: Pt, front: V3, across: V3, depthRatio: number, bulge = 1.6): Pt[] {
  const c: Pt = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2];
  const hw = Math.hypot(R[0] - L[0], R[1] - L[1]) / 2 || 1e-6;
  const u: Pt = [(R[0] - L[0]) / (2 * hw), (R[1] - L[1]) / (2 * hw)];
  const dd = hw * depthRatio;
  const pts: Pt[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const nz = (cs * across[2]) / hw + (sn * front[2]) / dd;
    if (nz <= 0) {
      pts.push([NaN, NaN]);
      continue;
    }
    pts.push([c[0] + u[0] * hw * cs + front[0] * bulge * dd * sn, c[1] + u[1] * hw * cs + front[1] * bulge * dd * sn]);
  }
  // Se queda con la corrida visible más larga.
  let best: Pt[] = [];
  let run: Pt[] = [];
  for (const p of [...pts, [NaN, NaN] as Pt]) {
    if (Number.isNaN(p[0])) {
      if (run.length > best.length) best = run;
      run = [];
    } else run.push(p);
  }
  return best;
}

/* ───────────────────────── recorte por solape ───────────────────────── */

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function boxOf(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export const boxesTouch = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Remuestrea una polilínea cada `step` como máximo, conservando sus vértices. */
export function resampleEvery(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    const k = Math.max(1, Math.ceil(l / step));
    for (let j = 0; j < k; j++) out.push([lerp(ax, bx, j / k), lerp(ay, by, j / k)]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

const pathLength = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/**
 * Los tramos de un trazo que caen FUERA de un polígono: la forma de adelante tapa a la de atrás y la
 * línea de atrás termina en T (cuerpo.md, regla 26). Se remuestrea cada ~2 px; tramos < 3 px se tiran.
 */
export function clipOutside(stroke: Pt[], poly: Pt[], step = 2, minLen = 3): Pt[][] {
  if (stroke.length < 2 || poly.length < 3) return stroke.length > 1 ? [stroke] : [];
  const sb = boxOf(stroke);
  const pb = boxOf(poly);
  if (!boxesTouch(sb, pb)) return [stroke];
  const dense = resampleEvery(stroke, step);
  const out: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length > 1 && pathLength(run) >= minLen) out.push(run);
    run = [];
  };
  for (const p of dense) {
    if (pointInPoly(p[0], p[1], poly)) flush();
    else run.push(p);
  }
  flush();
  return out;
}

export interface Form {
  id: string;
  poly: Pt[];
  /** Mayor es más cerca de quien mira. */
  z: number;
  box: [number, number, number, number];
}

/**
 * Quita de un trazo lo que tapan las formas más cercanas cuyo rectángulo lo toca. Si las
 * profundidades son parecidas (|Δz| < eps) no se recorta ninguno: se cruzan como en un boceto.
 */
export function clipByCloser(stroke: Pt[], self: Form | null, forms: Form[], eps: number): Pt[][] {
  const sb = boxOf(stroke);
  const closer = forms.filter((g) => !(self && g.id === self.id) && !(self && g.z <= self.z + eps) && boxesTouch(sb, g.box));
  if (!closer.length) return stroke.length > 1 ? [stroke] : [];
  // Una sola pasada: cada muestra se prueba contra todas las formas de adelante.
  const dense = resampleEvery(stroke, 2);
  const out: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length > 1 && pathLength(run) >= 3) out.push(run);
    run = [];
  };
  for (const p of dense) {
    let hidden = false;
    for (const g of closer) {
      if (p[0] >= g.box[0] && p[0] <= g.box[2] && p[1] >= g.box[1] && p[1] <= g.box[3] && pointInPoly(p[0], p[1], g.poly)) {
        hidden = true;
        break;
      }
    }
    if (hidden) flush();
    else run.push(p);
  }
  flush();
  return out;
}

/* ───────────────────────────── frijol ───────────────────────────── */

export interface BeanStation {
  left: Pt;
  right: Pt;
}

export interface Bean {
  left: Pt[];
  right: Pt[];
  wrinkles: { side: 'left' | 'right'; pts: Pt[] }[];
  waist: { index: number; left: number; right: number };
  /** Cuánto se aprieta: 0 sin doblez. */
  k: number;
}

/**
 * El frijol que une caja torácica y pelvis: se aprieta de un lado y se estira del otro (cuerpo.md,
 * reglas 14-16). `bend` es el ángulo con signo entre el eje del tórax y el de la pelvis: negativo,
 * el tronco se dobla a la izquierda de la imagen (lado cóncavo = izquierdo). Lado cóncavo: la cintura
 * se mete (1 − 0.25k) y salen 1-3 arrugas; lado convexo: una sola C larga y limpia. Sin doblez (< 5°)
 * los dos lados son simétricos y no hay arrugas.
 */
export function beanSides(stations: BeanStation[], bend: number, exaggeration: number): Bean {
  const n = stations.length;
  const centers = stations.map((s): Pt => [(s.left[0] + s.right[0]) / 2, (s.left[1] + s.right[1]) / 2]);
  const sl = stations.map((s, i): Pt => [s.left[0] - centers[i][0], s.left[1] - centers[i][1]]);
  const sr = stations.map((s, i): Pt => [s.right[0] - centers[i][0], s.right[1] - centers[i][1]]);
  const hl = sl.map((v) => Math.hypot(v[0], v[1]));
  const hr = sr.map((v) => Math.hypot(v[0], v[1]));
  // La cintura: el estrechamiento de la parte media.
  const lo = Math.floor((n - 1) * 0.3);
  const hi = Math.max(lo, Math.ceil((n - 1) * 0.8));
  let iw = lo;
  for (let i = lo; i <= hi; i++) if (hl[i] + hr[i] < hl[iw] + hr[iw] - 1e-9) iw = i;
  const place = (i: number, v: Pt, h: number): Pt => {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [centers[i][0] + (v[0] / l) * h, centers[i][1] + (v[1] / l) * h];
  };
  const small = Math.abs(bend) < 5;
  if (small) {
    const avg = hl.map((v, i) => (v + hr[i]) / 2);
    const L = stations.map((_, i) => place(i, sl[i], avg[i]));
    const R = stations.map((_, i) => place(i, sr[i], avg[i]));
    return { left: L, right: R, wrinkles: [], waist: { index: iw, left: avg[iw], right: avg[iw] }, k: 0 };
  }
  const k = Math.min(1, Math.abs(bend) / 30) * (1 + clamp(exaggeration, 0, 1));
  const concave: 'left' | 'right' = bend < 0 ? 'left' : 'right';
  const sigma = Math.max(1, 0.22 * (n - 1));
  const pinch = (i: number) => Math.max(0.55, 1 - 0.25 * k * Math.exp(-(((i - iw) / sigma) ** 2)));
  const stretchFit = (h: number[]) => bernsteinFit(h, 2);
  const hlN = concave === 'left' ? hl.map((v, i) => v * pinch(i)) : stretchFit(hl);
  const hrN = concave === 'right' ? hr.map((v, i) => v * pinch(i)) : stretchFit(hr);
  // Un pase suave en el lado apretado: la cintura se mete sin quiebre.
  const soften = (h: number[]) => h.map((v, i) => (i === 0 || i === n - 1 ? v : (h[i - 1] + 2 * v + h[i + 1]) / 4));
  const hlS = concave === 'left' ? soften(hlN) : hlN;
  const hrS = concave === 'right' ? soften(hrN) : hrN;
  const L = stations.map((_, i) => place(i, sl[i], hlS[i]));
  const R = stations.map((_, i) => place(i, sr[i], hrS[i]));
  const wrinkles: Bean['wrinkles'] = [];
  const count = clamp(Math.round(1 + 1.2 * k), 1, 3);
  const side = concave === 'left' ? L : R;
  const sv = concave === 'left' ? sl : sr;
  for (let j = 0; j < count; j++) {
    const i = clamp(Math.round(iw + (j - (count - 1) / 2) * 1.3), 1, n - 2);
    const P = side[i];
    const h = (concave === 'left' ? hlS : hrS)[i];
    const inward: Pt = unit2([-sv[i][0], -sv[i][1]]);
    const along = unit2([centers[Math.min(n - 1, i + 1)][0] - centers[Math.max(0, i - 1)][0], centers[Math.min(n - 1, i + 1)][1] - centers[Math.max(0, i - 1)][1]]);
    const flip = j % 2 ? -1 : 1;
    const arc: Pt[] = [0, 0.33, 0.66, 1].map((s) => [P[0] + inward[0] * 0.2 * h * s + along[0] * Math.sin(Math.PI * s) * 0.07 * h * flip, P[1] + inward[1] * 0.2 * h * s + along[1] * Math.sin(Math.PI * s) * 0.07 * h * flip]);
    wrinkles.push({ side: concave, pts: arc });
  }
  return { left: L, right: R, wrinkles, waist: { index: iw, left: hlS[iw], right: hrS[iw] }, k };
}

/* ───────────────────────────── temblor ───────────────────────────── */

/** Semilla de un trazo: hash de la figura y del trazo (FNV-1a). */
export function hashSeed(...parts: string[]): number {
  let h = 2166136261;
  for (const ch of parts.join('\u0001')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Temblor determinista: ruido suave de 2-3 ondas por trazo, perpendicular al camino. La amplitud
 * máxima es `amp`. Mismo trazo, mismo camino en cada render (sin parpadeo).
 */
export function tremor(pts: Pt[], seed: number, amp: number): Pt[] {
  const n = pts.length;
  if (n < 2 || amp <= 0) return pts;
  const r = rng(seed);
  const waves = [1, 2, 3].map((f, i) => ({ f, ph: r() * Math.PI * 2, a: [0.5, 0.3, 0.2][i] * (0.6 + 0.8 * r()) }));
  const norm = waves.reduce((a, w) => a + w.a, 0);
  return pts.map((p, i) => {
    const q = pts[Math.min(n - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const t = unit2([q[0] - o[0], q[1] - o[1]]);
    const u = i / (n - 1);
    const d = (waves.reduce((a, w) => a + w.a * Math.sin(Math.PI * 2 * w.f * u + w.ph), 0) / norm) * amp;
    return [p[0] - t[1] * d, p[1] + t[0] * d];
  });
}

/* ───────────────────────── curvas y trazos ───────────────────────── */

/** Catmull-Rom con puntos repetidos en los extremos: pasa por todos los puntos. */
export function smoothCurve(pts: Pt[], per = 8, closed = false): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Pt[] = [];
  const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Curvatura (ángulo girado) en cada punto de una polilínea, para partir contornos largos. */
export function turnAt(pts: Pt[], i: number, span = 3): number {
  const a = pts[Math.max(0, i - span)];
  const b = pts[i];
  const c = pts[Math.min(pts.length - 1, i + span)];
  const v1: Pt = [b[0] - a[0], b[1] - a[1]];
  const v2: Pt = [c[0] - b[0], c[1] - b[1]];
  return Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]));
}

/**
 * Parte un contorno cerrado en `parts` trazos en sus puntos de mayor curvatura, con 1-2 % de
 * traslape (como quien levanta el lápiz).
 */
export function splitClosed(pts: Pt[], parts: number): Pt[][] {
  const n = pts.length;
  if (parts <= 1 || n < 12) return [[...pts, pts[0]]];
  const score = pts.map((_, i) => turnAt(pts, i, Math.max(2, Math.round(n / 40))));
  const cuts: number[] = [];
  const minGap = Math.floor(n / (parts * 1.8));
  const order = score.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  for (const { i } of order) {
    if (cuts.length >= parts) break;
    if (cuts.every((c) => Math.min(Math.abs(c - i), n - Math.abs(c - i)) >= minGap)) cuts.push(i);
  }
  cuts.sort((a, b) => a - b);
  if (cuts.length < 2) return [[...pts, pts[0]]];
  const over = Math.max(1, Math.round(n * 0.015));
  return cuts.map((c, k) => {
    const e = cuts[(k + 1) % cuts.length];
    const len = ((e - c + n) % n) + over;
    return Array.from({ length: len + 1 }, (_, j) => pts[(c + j) % n]);
  });
}

/* ───────────────────────────── gesto (paso 1) ───────────────────────────── */

export interface GestureStroke {
  id: string;
  kind: 'accion' | 'ritmo' | 'hombros' | 'caderas' | 'cabeza';
  pts: Pt[];
  closed?: boolean;
}

/** Empuja la línea de acción lejos de su cuerda por 1 + 1.2·e: aleja los puntos medios y conserva los extremos. */
export function pushAction(action: Pt[], exaggeration: number): Pt[] {
  const n = action.length;
  if (n < 3) return action;
  const k = 1 + 1.2 * clamp(exaggeration, 0, 1);
  const a = action[0];
  const b = action[n - 1];
  return action.map((p, i): Pt => {
    const t = i / (n - 1);
    const base: Pt = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    return [base[0] + (p[0] - base[0]) * k, base[1] + (p[1] - base[1]) * k];
  });
}

/**
 * Un ritmo de miembro: un arco largo que ROZA las articulaciones por su lado convexo en vez de pasar
 * recto por ellas. `away` dice hacia dónde se aleja el cuerpo si el miembro va recto.
 */
export function rhythmCurve(chain: Pt[], away: Pt, exaggeration: number): Pt[] {
  if (chain.length < 3) return chain;
  const n = chain.length;
  const pts = chain.map((p, i): Pt => {
    if (i === 0 || i === n - 1) return p;
    const a = chain[i - 1];
    const b = chain[i + 1];
    const t = unit2([b[0] - a[0], b[1] - a[1]]);
    let nrm: Pt = [-t[1], t[0]];
    // Lado convexo: el contrario al que dobla el miembro; si va recto, el que se aleja del tronco.
    const turn = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
    const bone = (Math.hypot(p[0] - a[0], p[1] - a[1]) + Math.hypot(b[0] - p[0], b[1] - p[1])) / 2;
    const bendy = Math.abs(turn) / (bone * bone + 1e-9);
    if (bendy > 0.02) nrm = turn > 0 ? [t[1], -t[0]] : [-t[1], t[0]];
    else if (nrm[0] * away[0] + nrm[1] * away[1] < 0) nrm = [-nrm[0], -nrm[1]];
    const d = bone * (0.1 + 0.12 * clamp(exaggeration, 0, 1));
    return [p[0] + nrm[0] * d, p[1] + nrm[1] * d];
  });
  return smoothCurve(pts, 10);
}

/** Óvalo inclinado de la cabeza, como polilínea cerrada. */
export function tiltedOval(c: Pt, rx: number, ry: number, angle: number, n = 40): Pt[] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return Array.from({ length: n }, (_, i): Pt => {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    return [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca];
  });
}

/* ───────────────────────── lenguaje de formas ───────────────────────── */

export type TrunkShape = 'triangulo' | 'cuadrado' | 'circulo';

/** Hombros / caderas decide la figura base del tronco (cuerpo.md, sección D). */
export function classifyTrunk(shoulderW: number, hipW: number, tallStraight: boolean): { shape: TrunkShape; ratio: number } {
  const r = shoulderW / Math.max(1e-6, hipW);
  if (r > 1.35) return { shape: 'triangulo', ratio: r };
  if (r >= 0.9 && tallStraight) return { shape: 'cuadrado', ratio: r };
  return { shape: 'circulo', ratio: r };
}

export const TRUNK_SHAPE_NOTE: Record<TrunkShape, string> = {
  get triangulo() { return tx('organic.triangulo_invertido_fuerza_pel'); },
  get cuadrado() { return tx('organic.cuadrado_estable_firme'); },
  get circulo() { return tx('organic.circulo_amable_cercano'); },
};

/**
 * Lleva un óvalo hacia una figura base con 64 puntos alineados por ángulo: el radio de cada punto
 * pasa de lo medido a lo de la figura, con t = 0.3 + 0.7·exageración.
 */
export function morphToShape(oval: Pt[], shape: TrunkShape, t: number): Pt[] {
  const n = 64;
  const [x0, y0, x1, y1] = boxOf(oval);
  const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  // Radio del óvalo medido en cada ángulo: el punto más lejano del rayo.
  const rayOval = (th: number) => {
    let best = 0;
    let bestD = Infinity;
    for (const p of oval) {
      const a = Math.atan2(p[1] - c[1], p[0] - c[0]);
      let d = Math.abs(a - th);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < bestD) {
        bestD = d;
        best = Math.hypot(p[0] - c[0], p[1] - c[1]);
      }
    }
    return best;
  };
  const target = (th: number): number => {
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    if (shape === 'circulo') return Math.sqrt(hw * hh) * 1.05;
    if (shape === 'cuadrado') {
      // Rectángulo redondeado: superelipse de grado 6.
      return 1 / (Math.abs(dx / hw) ** 6 + Math.abs(dy / hh) ** 6) ** (1 / 6);
    }
    // Triángulo invertido: arriba ancho, punta abajo; vértices suavizados con una superelipse del polígono.
    const tri: Pt[] = [[-hw * 1.02, -hh], [hw * 1.02, -hh], [0, hh * 1.05]];
    let rr = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const s = ((a[0]) * ey - (a[1]) * ex) / den;
      const u = ((a[0]) * dy - (a[1]) * dx) / den;
      if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) rr = Math.min(rr, s);
    }
    return Number.isFinite(rr) ? rr * 0.94 : hw;
  };
  return Array.from({ length: n }, (_, i): Pt => {
    const th = (i / n) * Math.PI * 2 - Math.PI;
    const r = lerp(rayOval(th), target(th), clamp(t, 0, 1));
    return [c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r];
  });
}

/* ───────────────────────────── pintura: terminador ───────────────────────────── */

/**
 * El terminador de un anillo transversal: el punto del lado visible donde n·L = 0. Con
 * n = cos θ·u + sen θ·w, cos θ = w·L y sen θ = −u·L (se toma el signo con sen θ > 0). Devuelve null
 * si la luz es paralela al plano del anillo. `dark` es el costado que queda en sombra (-1 izquierdo, +1 derecho).
 */
export function terminatorOnRing(center: V3, dir: V3, radius: number, L: V3, opts: RingOpts = {}): { pt: Pt; dark: -1 | 1 } | null {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const flat = Math.hypot(d[0], d[1]);
  const u: Pt = opts.across ? unit2(opts.across) : flat > 1e-6 ? [-d[1] / flat, d[0] / flat] : [1, 0];
  let w: V3 = [d[1] * 0 - d[2] * u[1], d[2] * u[0] - d[0] * 0, d[0] * u[1] - d[1] * u[0]];
  const wl = Math.hypot(w[0], w[1], w[2]) || 1;
  w = [w[0] / wl, w[1] / wl, w[2] / wl];
  if (w[2] < 0) w = [-w[0], -w[1], -w[2]];
  const uL = u[0] * L[0] + u[1] * L[1];
  const wL = w[0] * L[0] + w[1] * L[1] + w[2] * L[2];
  const m = Math.hypot(uL, wL);
  if (m < 1e-6) return null;
  const sn = Math.abs(uL) / m;
  const cs = (uL > 0 ? -wL : wL) / m;
  const sinT = Math.max(0, sn);
  if (sinT < 1e-4) return null;
  const rl = opts.rLeft ?? radius;
  const rr = opts.rRight ?? radius;
  const ru = cs >= 0 ? rr : rl;
  return { pt: [center[0] + u[0] * cs * ru + w[0] * sinT * radius, center[1] + u[1] * cs * ru + w[1] * sinT * radius], dark: uL > 0 ? -1 : 1 };
}

/**
 * Terminador de una forma: una curva que une el de cada anillo (también los no dibujados, cada 10 % del
 * eje) y la región entre ella y el contorno del lado en sombra.
 */
export function shapeTerminator(s: OrganicShape, L: V3): { line: Pt[]; shadow: Pt[]; dark: -1 | 1 } | null {
  const flat = Math.sqrt(Math.max(0, 1 - s.dz * s.dz));
  const idx = s.ts.map((t, i) => ({ t, i })).filter((q) => q.t >= 0 && q.t <= 1);
  const line: Pt[] = [];
  const edge: Pt[] = [];
  let dark: -1 | 1 = 1;
  for (let k = 0; k <= 10; k++) {
    const target = k / 10;
    const q = idx.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a));
    const c = s.axis[q.i];
    const rl = Math.hypot(c[0] - s.left[q.i][0], c[1] - s.left[q.i][1]);
    const rr = Math.hypot(c[0] - s.right[q.i][0], c[1] - s.right[q.i][1]);
    const tm = terminatorOnRing([c[0], c[1], 0], [s.dir[0] * flat, s.dir[1] * flat, s.dz], s.half[q.i], L, { across: s.across, rLeft: rl, rRight: rr });
    if (!tm) continue;
    dark = tm.dark;
    line.push(tm.pt);
    edge.push(dark < 0 ? s.left[q.i] : s.right[q.i]);
  }
  if (line.length < 3) return null;
  return { line, shadow: [...line, ...edge.reverse()], dark };
}

/* ───────────────────── elipsoide del tronco (proyección ortográfica) ───────────────────── */

/**
 * Silueta exacta de un elipsoide en proyección ortográfica. Con v_k los tres semiejes vectoriales,
 * S = Σ_k [v_kx v_ky]ᵀ[v_kx v_ky]; los semiejes 2D son √λ de S sobre sus vectores propios.
 */
export function ellipsoidSilhouette(center: V3, axes: [V3, V3, V3], n = 48): Pt[] {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const v of axes) {
    sxx += v[0] * v[0];
    sxy += v[0] * v[1];
    syy += v[1] * v[1];
  }
  const tr = (sxx + syy) / 2;
  const root = Math.sqrt(Math.max(0, tr * tr - (sxx * syy - sxy * sxy)));
  const l1 = Math.sqrt(Math.max(0, tr + root));
  const l2 = Math.sqrt(Math.max(0, tr - root));
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  return Array.from({ length: n }, (_, i): Pt => {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * l1;
    const y = Math.sin(t) * l2;
    return [center[0] + x * ca - y * sa, center[1] + x * sa + y * ca];
  });
}

/** Deformación de huevo a lo largo de `up`: más ancho a 2/3 desde arriba (cuerpo.md, regla 9). */
export function eggDeform(poly: Pt[], c: Pt, up: Pt): Pt[] {
  const u = unit2(up);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const h = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const span = hi - lo || 1;
  return poly.map((p): Pt => {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const h = dx * u[0] + dy * u[1];
    const s = (hi - h) / span;
    const g = 0.88 + 0.2 * Math.exp(-(((s - 0.62) / 0.3) ** 2));
    const px = dx - h * u[0];
    const py = dy - h * u[1];
    return [c[0] + h * u[0] + px * g, c[1] + h * u[1] + py * g];
  });
}

/**
 * Anillo horizontal de un elipsoide a la altura hFrac·b sobre su centro (−1 abajo, 1 arriba):
 * c + a·s·cos θ·across + d·s·sen θ·front, con s = √(1 − hFrac²). Solo el medio anillo visible
 * (normal con z > 0): con el cabeceo del tronco siempre se curva.
 */
export function ellipsoidRing(c: V3, across: V3, up: V3, front: V3, a: number, b: number, d: number, hFrac: number, steps = 40): Pt[] {
  const s = Math.sqrt(Math.max(0, 1 - hFrac * hFrac));
  const run: (Pt | null)[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    // Normal del elipsoide en ese punto, en el marco del tronco.
    const nl: V3 = [(s * cs) / a, hFrac / b, (s * sn) / d];
    const nz = across[2] * nl[0] + up[2] * nl[1] + front[2] * nl[2];
    if (nz <= 0) {
      run.push(null);
      continue;
    }
    run.push([
      c[0] + hFrac * b * up[0] + a * s * cs * across[0] + d * s * sn * front[0],
      c[1] + hFrac * b * up[1] + a * s * cs * across[1] + d * s * sn * front[1],
    ]);
  }
  let best: Pt[] = [];
  let cur: Pt[] = [];
  for (const p of [...run, null]) {
    if (!p) {
      if (cur.length > best.length) best = cur;
      cur = [];
    } else cur.push(p);
  }
  return best;
}

/**
 * Los tramos de un trazo que caen DENTRO de una región. Si más de `maxOut` del trazo cae fuera, se tira
 * entero; los tramos menores a `minLen` se tiran.
 */
export function clipInside(stroke: Pt[], inside: (x: number, y: number) => boolean, step = 2, minLen = 3, maxOut = 0.5): Pt[][] {
  if (stroke.length < 2) return [];
  const dense = resampleEvery(stroke, step);
  const flags = dense.map((p) => inside(p[0], p[1]));
  const out = flags.filter((f) => !f).length / flags.length;
  if (out > maxOut) return [];
  if (out === 0) return [stroke];
  const pieces: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length > 1 && pathLength(run) >= minLen) pieces.push(run);
    run = [];
  };
  dense.forEach((p, i) => (flags[i] ? run.push(p) : flush()));
  flush();
  return pieces;
}

/** Dilata una máscara r píxeles (máximo separable). */
export function dilateMask(data: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const k = Math.max(0, Math.round(r));
  if (!k) return data;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -k; d <= k && !v; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w && data[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -k; d <= k && !v; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ mano â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export interface HandFinger {
  id: string;
  /** Base, articulaciones y punta. */
  axis: Pt[];
  radii: number[];
  /** Contorno cerrado (con el arranque dentro de la palma) y el mismo abierto en la base. */
  tube: Pt[];
  open: Pt[];
  /** Pliegues de las articulaciones (medio anillo visible). */
  rings: Pt[][];
}

export interface HandGeo {
  across: Pt;
  base: number;
  palmLen: number;
  palm: Pt[];
  /** Los dos planos del dorso: los parte la arista del metacarpiano del medio. */
  planes: [Pt[], Pt[]];
  ridge: [Pt, Pt];
  knuckleArc: Pt[];
  fingers: HandFinger[];
  thumb: HandFinger;
  /** Los cuatro dedos juntos, como un mitÃ³n. */
  mitten: Pt[];
}

const FINGER_WIDTH = [1.16, 1, 1.02, 0.96, 0.82];

/** Un tubo que se afina a lo largo de un eje, con punta redonda. La base queda abierta, metida en la palma. */
export function tubeAround(axis: Pt[], radii: number[], baseExt = 0): { tube: Pt[]; open: Pt[] } {
  let pts = axis;
  let rad = radii;
  if (baseExt > 0 && axis.length > 1) {
    const d = unit2([axis[0][0] - axis[1][0], axis[0][1] - axis[1][1]]);
    pts = [[axis[0][0] + d[0] * baseExt, axis[0][1] + d[1] * baseExt], ...axis];
    rad = [radii[0], ...radii];
  }
  const per = 4;
  const dense = smoothCurve(pts, per);
  const n = dense.length;
  const rAt = (i: number) => {
    const s = Math.min(rad.length - 2, Math.floor(i / per));
    const f = Math.min(1, (i - s * per) / per);
    return i >= (rad.length - 1) * per ? rad[rad.length - 1] : lerp(rad[s], rad[s + 1], f);
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = dense[Math.max(0, i - 1)];
    const b = dense[Math.min(n - 1, i + 1)];
    const t = unit2([b[0] - a[0], b[1] - a[1]]);
    const r = rAt(i);
    left.push([dense[i][0] - t[1] * r, dense[i][1] + t[0] * r]);
    right.push([dense[i][0] + t[1] * r, dense[i][1] - t[0] * r]);
  }
  const tip = dense[n - 1];
  const tt = unit2([tip[0] - dense[n - 2][0], tip[1] - dense[n - 2][1]]);
  const rt = rAt(n - 1);
  const cap: Pt[] = [];
  for (let k = 1; k < 9; k++) {
    const a = (k / 9) * Math.PI;
    // De la izquierda a la derecha por delante de la punta.
    cap.push([tip[0] - tt[1] * rt * Math.cos(a) + tt[0] * rt * Math.sin(a), tip[1] + tt[0] * rt * Math.cos(a) + tt[1] * rt * Math.sin(a)]);
  }
  const open = [...left, ...cap, ...right.reverse()];
  return { tube: open, open };
}

/** Casco convexo (cadena monÃ³tona). */
export function convexHullPts(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Mano de sus 21 puntos (muÃ±eca, pulgar 1-4, Ã­ndice 5-8 â€¦ meÃ±ique 17-20): palma estable como caja de dos
 * planos cuya arista sigue el metacarpiano del medio; pulgar en cuÃ±a desde la muÃ±eca; cada dedo un tubo
 * que se afina, con su base metida en la palma (solape en el nudillo) y pliegues paralelos en las
 * articulaciones; arco de nudillos del Ã­ndice al meÃ±ique (cabeza-manos-pintura.md, B.1).
 */
export function handGeometry(P: Pt[]): HandGeo {
  const W = P[0];
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const span = Math.max(dist(P[5], P[17]), dist(W, P[9]) * 0.68, 1e-6);
  const base = span / 8;
  const across = unit2([P[5][0] - P[17][0], P[5][1] - P[17][1]]);
  const toward = unit2([P[9][0] - W[0], P[9][1] - W[1]]);
  const half = span * 0.33;
  const at = (p: Pt, a: Pt, k: number): Pt => [p[0] + a[0] * k, p[1] + a[1] * k];
  const wristA = at(W, across, half);
  const wristB = at(W, across, -half);
  const edgeA = at(P[5], across, base * 0.9);
  const edgeB = at(P[17], across, -base * 0.9);
  const top = (i: number) => at(P[i], toward, base * 0.6);
  const bulge = at(at(wristA, [P[1][0] - wristA[0], P[1][1] - wristA[1]], 0.6), across, base * 0.5);
  const palm = smoothCurve([wristB, wristA, bulge, edgeA, top(5), top(9), top(13), top(17), edgeB], 4, true);
  const mid: Pt = [(wristA[0] + wristB[0]) / 2, (wristA[1] + wristB[1]) / 2];
  const kn: Pt = top(9);
  const planes: [Pt[], Pt[]] = [[wristA, edgeA, kn, mid], [mid, kn, edgeB, wristB]];
  const ext0 = at(P[5], unit2([P[5][0] - P[9][0], P[5][1] - P[9][1]]), base * 0.5);
  const ext1 = at(P[17], unit2([P[17][0] - P[13][0], P[17][1] - P[13][1]]), base * 0.5);
  const knuckleArc = smoothCurve([ext0, P[5], P[9], P[13], P[17], ext1], 8);
  const ringsOf = (axis: Pt[], radii: number[], k0: number): Pt[][] => {
    const out: Pt[][] = [];
    for (let k = k0; k <= 2; k++) {
      const d = unit2([axis[k + 1][0] - axis[k - 1][0], axis[k + 1][1] - axis[k - 1][1]]);
      // Los ejes de las articulaciones de un dedo son paralelos: todos los pliegues miran igual.
      const ring = ringArc([axis[k][0], axis[k][1], 0], [d[0] * 0.96, d[1] * 0.96, 0.28], radii[k] * 0.95, { across: [-d[1], d[0]] });
      if (ring.pts.length > 3) out.push(ring.pts);
    }
    return out;
  };
  const fingers: HandFinger[] = [1, 2, 3, 4].map((f) => {
    const b = 1 + 4 * f;
    const axis: Pt[] = [P[b], P[b + 1], P[b + 2], P[b + 3]];
    const r = base * FINGER_WIDTH[f];
    const radii = [r, r * 0.88, r * 0.76, r * 0.62];
    const { tube, open } = tubeAround(axis, radii, base * 0.9);
    return { id: `d${f}`, axis, radii, tube, open, rings: ringsOf(axis, radii, 1) };
  });
  const tAxis: Pt[] = [[W[0] + (P[1][0] - W[0]) * 0.4, W[1] + (P[1][1] - W[1]) * 0.4], P[2], P[3], P[4]];
  const tr = base * FINGER_WIDTH[0];
  const tRadii = [tr * 1.4, tr * 1.1, tr * 0.88, tr * 0.72];
  const tt = tubeAround(tAxis, tRadii, 0);
  const thumb: HandFinger = { id: 'd0', axis: tAxis, radii: tRadii, tube: tt.tube, open: tt.open, rings: ringsOf(tAxis, tRadii, 2) };
  return { across, base, palmLen: dist(W, P[9]), palm, planes, ridge: [mid, kn], knuckleArc, fingers, thumb, mitten: smoothCurve(convexHullPts(fingers.flatMap((f) => f.tube)), 4, true) };
}

