import { frameRect } from './canvas';
import { GOLD_MAJOR, GOLD_MINOR, goldenSpiral, spiralEye, type Focal, type SpiralTurn } from './golden';
import type { Gesture } from './gesture';
import type { Crop, DominantLine, Pt } from './types';

import { t as tx } from '../i18n';
export type SchemeId = 'tercios' | 'aurea' | 'espiral' | 'diagonal' | 'triangulo' | 'central' | 'simetria' | 'curva' | 'radial' | 'horizonte';

export interface Scheme {
  id: SchemeId;
  name: string;
  /** 0 a 100: qué tanto describe esta imagen. */
  score: number;
  why: string;
  /** Dónde debería caer el foco en este esquema. */
  target?: Pt;
  triangle?: [Pt, Pt, Pt];
  axis?: [Pt, Pt];
  turn?: SpiralTurn;
  point?: Pt;
  level?: number;
  curve?: Pt[];
  rays?: Pt[];
  /** Rectas de la imagen en que se apoya, cuando el punto cae fuera del cuadro. */
  segments?: [Pt, Pt][];
}

/** Desde este puntaje un esquema se afirma; por debajo, la imagen no lo apoya. */
export const CLEAR = 38;

export interface CompositionInput {
  aspect: number;
  focals: Focal[];
  /** Nube de masa del sujeto, normalizada. */
  mass: Pt[];
  /** Si la masa viene de un recorte real o solo del mapa de atención. */
  solid: boolean;
  attention: Float32Array;
  attentionSize: number;
  tiny: Uint8Array;
  tinySize: number;
  lines: DominantLine[];
  gesture?: Gesture;
  curve?: Pt[];
  /** La fuga que dan las rectas (no la calculada ni la supuesta), dentro o fuera del cuadro. */
  vanishing?: { point: Pt; reach: number; rays: Pt[]; inside: boolean; segments: [Pt, Pt][] } | null;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const bell = (d: number, width: number) => Math.exp(-((d / width) ** 2));

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

/** Triángulo más grande que cabe en el contorno de la masa. */
export function bestTriangle(hull: Pt[]): { tri: [Pt, Pt, Pt]; fill: number } | null {
  if (hull.length < 3) return null;
  const step = Math.max(1, Math.floor(hull.length / 36));
  const h = hull.filter((_, i) => i % step === 0);
  let best = 0;
  let tri: [Pt, Pt, Pt] = [h[0], h[1], h[2]];
  for (let i = 0; i < h.length; i++) {
    for (let j = i + 1; j < h.length; j++) {
      for (let k = j + 1; k < h.length; k++) {
        const a = polyArea([h[i], h[j], h[k]]);
        if (a > best) {
          best = a;
          tri = [h[i], h[j], h[k]];
        }
      }
    }
  }
  const total = polyArea(hull);
  return total > 0 ? { tri, fill: best / total } : null;
}

function nearest(aspect: number, p: Pt, targets: Pt[]): { d: number; t: Pt } {
  const diag = Math.hypot(aspect, 1);
  let d = Infinity;
  let t = targets[0];
  for (const c of targets) {
    const v = Math.hypot((p[0] - c[0]) * aspect, p[1] - c[1]) / diag;
    if (v < d) {
      d = v;
      t = c;
    }
  }
  return { d, t };
}

function principalAxis(mass: Pt[], aspect: number) {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of mass) {
    sx += x * aspect;
    sy += y;
  }
  const mx = sx / mass.length;
  const my = sy / mass.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const [x, y] of mass) {
    const dx = x * aspect - mx;
    const dy = y - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const gap = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const major = (xx + yy + gap) / 2;
  const minor = Math.max(1e-9, (xx + yy - gap) / 2);
  return { cx: mx / aspect, cy: my, angle: 0.5 * Math.atan2(2 * xy, xx - yy), elongation: Math.sqrt(major / minor) };
}

const THIRDS: Pt[] = [1 / 3, 2 / 3].flatMap((x) => [1 / 3, 2 / 3].map((y): Pt => [x, y]));
const GOLDEN: Pt[] = [GOLD_MINOR, GOLD_MAJOR].flatMap((x) => [GOLD_MINOR, GOLD_MAJOR].map((y): Pt => [x, y]));

/** Recta que pasa por (cx, cy) con la dirección dada, recortada al cuadro unitario. */
function clipThrough(cx: number, cy: number, dx: number, dy: number): [Pt, Pt] {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, d] of [[cx, dx], [cy, dy]] as [number, number][]) {
    if (Math.abs(d) < 1e-9) continue;
    const t0 = (0 - p) / d;
    const t1 = (1 - p) / d;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  return [[cx + dx * lo, cy + dy * lo], [cx + dx * hi, cy + dy * hi]];
}

function diagonalScheme(input: CompositionInput): Scheme {
  const { aspect, mass, lines, solid } = input;
  const out: Scheme = { id: 'diagonal', name: tx('composition.diagonal'), score: 0, why: tx('composition.la_masa_principal_no') };
  const frame = (Math.atan2(1, aspect) * 180) / Math.PI;
  const diff = (deg: number) => {
    const a = ((deg % 180) + 180) % 180;
    const up = Math.min(Math.abs(a - frame), Math.abs(a - frame - 180));
    const down = Math.min(Math.abs(a - (180 - frame)), Math.abs(a + frame));
    return { off: Math.min(up, down), rising: down < up };
  };
  if (mass.length > 20) {
    const axis = principalAxis(mass, aspect);
    const { off, rising } = diff((axis.angle * 180) / Math.PI);
    const align = clamp(1 - off / 30);
    // Una masa casi redonda no tiene eje: sin alargamiento no hay diagonal que afirmar.
    const long = clamp((axis.elongation - 1.5) / 1.0);
    const centered = bell(Math.hypot((axis.cx - 0.5) * aspect, axis.cy - 0.5) / Math.hypot(aspect, 1), 0.3);
    // Las masas deben estar de verdad sobre el eje: si cubren el cuadro, la "diagonal" es el marco.
    const diag = Math.hypot(aspect, 1);
    let near = 0;
    for (const [x, y] of mass) {
      const px = (x - axis.cx) * aspect;
      const py = y - axis.cy;
      if (Math.abs(-Math.sin(axis.angle) * px + Math.cos(axis.angle) * py) / diag < 0.12) near++;
    }
    const onAxis = clamp((near / mass.length - 0.55) / 0.3);
    const score = 100 * align * long * onAxis * (0.6 + 0.4 * centered) * (solid ? 1 : 0.8);
    out.score = score;
    // El eje que se dibuja es el de la masa, no la esquina del marco.
    out.axis = clipThrough(axis.cx, axis.cy, Math.cos(axis.angle) / aspect, Math.sin(axis.angle));
    if (score >= CLEAR) out.why = tx('composition.el_cuerpo_principal_corre', { v1: rising ? tx('composition.de_abajo_la_izquierda') : tx('composition.de_arriba_la_izquierda') });
  }
  for (const l of lines) {
    const len = Math.hypot((l.b[0] - l.a[0]) * aspect, l.b[1] - l.a[1]) / Math.hypot(aspect, 1);
    if (len < 0.4) continue;
    const deg = (Math.atan2(l.b[1] - l.a[1], (l.b[0] - l.a[0]) * aspect) * 180) / Math.PI;
    const { off, rising } = diff(deg);
    // Una línea sola, como una telaraña o un cable, es un indicio y no una composición.
    const score = Math.min(55, 100 * clamp(1 - off / 14) * clamp(l.strength / 0.42));
    if (score > out.score) {
      out.score = score;
      out.axis = [l.a, l.b];
      out.why = tx('composition.una_linea_cruza_el', { v1: rising ? tx('composition.ascendente') : tx('composition.descendente') });
    }
  }
  return out;
}

function triangleScheme(input: CompositionInput): Scheme {
  const { aspect, mass, solid } = input;
  const out: Scheme = { id: 'triangulo', name: tx('common.triangulo'), score: 0, why: tx('composition.la_masa_no_forma') };
  if (mass.length < 20) return out;
  const scaled = mass.map(([x, y]): Pt => [x * aspect, y]);
  const fit = bestTriangle(convexHull(scaled));
  if (!fit) return out;
  const tri = fit.tri.map(([x, y]): Pt => [x / aspect, y]) as [Pt, Pt, Pt];
  const edges: [Pt, Pt, Pt][] = [[fit.tri[0], fit.tri[1], fit.tri[2]], [fit.tri[1], fit.tri[2], fit.tri[0]], [fit.tri[2], fit.tri[0], fit.tri[1]]];
  let flat = 90;
  let apex = fit.tri[0];
  let baseY = 0;
  for (const [a, b, c] of edges) {
    const deg = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
    const tilt = Math.min(deg, 180 - deg);
    if (tilt < flat) {
      flat = tilt;
      apex = c;
      baseY = (a[1] + b[1]) / 2;
    }
  }
  const area = polyArea(tri.map(([x, y]): Pt => [x * aspect, y])) / aspect;
  const inverted = apex[1] > baseY;
  // Un rectángulo deja fuera la mitad de su masa; una figura triangular casi nada.
  const [a, b, c] = fit.tri;
  const sign = (p: Pt, q: Pt, r: Pt) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const isIn = (p: Pt) => {
    const d1 = sign(p, a, b);
    const d2 = sign(p, b, c);
    const d3 = sign(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const covered = scaled.filter(isIn).length / scaled.length;
  out.triangle = tri;
  // Si el triángulo es el del marco (dos esquinas del cuadro), no sale de la imagen.
  const corners = tri.filter(([x, y]) => (x < 0.06 || x > 0.94) && (y < 0.06 || y > 0.94)).length;
  if (corners >= 2) {
    out.why = tx('composition.el_triangulo_que_sale');
    return out;
  }
  out.score = 100 * clamp((covered - 0.54) / 0.28) * (0.55 + 0.45 * clamp(1 - flat / 40)) * clamp(area / 0.08) * (solid ? 1 : 0.7);
  // Si la base se apoya en el borde de abajo, el triángulo lo dicta el recorte y no la figura.
  const onEdge = tri.filter(([, y]) => y > 0.96).length >= 2 && !inverted;
  if (onEdge) out.score = Math.min(out.score, 55);
  if (out.score >= CLEAR) {
    out.why = inverted ? tx('composition.la_figura_forma_un') : tx('composition.la_figura_se_asienta');
    if (onEdge) out.why += tx('composition.la_base_toca_el');
  }
  return out;
}

function symmetryScheme(input: CompositionInput): Scheme {
  const n = input.tinySize;
  const t = input.tiny;
  let best = Infinity;
  for (let shift = -5; shift <= 5; shift++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n / 2; x++) {
        const m = n - 1 - x + shift;
        if (m < 0 || m >= n) continue;
        sum += Math.abs(t[y * n + x] - t[y * n + m]);
        count++;
      }
    }
    if (count) best = Math.min(best, sum / count);
  }
  const score = 100 * clamp(1 - best / 26) ** 1.4;
  return {
    id: 'simetria',
    name: tx('composition.simetria'),
    score,
    why: score >= CLEAR ? tx('composition.los_dos_lados_del') : tx('composition.los_dos_lados_son'),
  };
}

function spiralScheme(input: CompositionInput, focal: Focal | undefined): Scheme {
  const { aspect, attention: map, attentionSize: n } = input;
  const portrait = aspect < 1;
  let best = -1;
  let turn: SpiralTurn = 0;
  const base = map.reduce((a, b) => a + b, 0) / map.length || 1e-6;
  for (const t of [0, 1, 2, 3] as SpiralTurn[]) {
    const { spiral } = goldenSpiral(t, portrait, 6);
    let sum = 0;
    for (const [x, y] of spiral) sum += map[Math.min(n - 1, Math.floor(y * n)) * n + Math.min(n - 1, Math.floor(x * n))] ?? 0;
    const lift = sum / spiral.length / base;
    const eye = spiralEye(t);
    const e = focal ? Math.hypot((focal.x - eye[0]) * aspect, focal.y - eye[1]) / Math.hypot(aspect, 1) : 0.3;
    const score = 100 * (0.65 * bell(e, 0.09) + 0.35 * clamp((lift - 1) / 1.6));
    if (score > best) {
      best = score;
      turn = t;
    }
  }
  return {
    id: 'espiral',
    name: tx('composition.espiral_aurea'),
    score: best,
    turn,
    target: spiralEye(turn),
    why: best >= CLEAR ? tx('composition.el_foco_cae_cerca') : tx('composition.el_foco_queda_lejos'),
  };
}

/** Evalúa cada esquema y los ordena de mejor a peor. */
export function readComposition(input: CompositionInput): Scheme[] {
  const { aspect, focals, gesture, curve, lines, vanishing } = input;
  const focal = [...focals].sort((a, b) => b.weight - a.weight)[0];
  const list: Scheme[] = [];
  const pct = (d: number) => `${(d * 100).toFixed(1)}%`;
  if (focal) {
    const p: Pt = [focal.x, focal.y];
    const third = nearest(aspect, p, THIRDS);
    list.push({
      id: 'tercios',
      name: tx('composition.regla_de_tercios'),
      score: 100 * bell(third.d, 0.065),
      target: third.t,
      why: third.d < 0.05 ? tx('composition.el_foco_cae_en', { v1: pct(third.d) }) : tx('composition.el_foco_esta_del', { v1: pct(third.d) }),
    });
    const gold = nearest(aspect, p, GOLDEN);
    list.push({
      id: 'aurea',
      name: tx('composition.proporcion_aurea'),
      score: 100 * bell(gold.d, 0.055),
      target: gold.t,
      why: gold.d < 0.04 ? tx('composition.el_foco_cae_en_2', { v1: pct(gold.d) }) : tx('composition.el_foco_esta_del_2', { v1: pct(gold.d) }),
    });
    // Una figura de pie centrada tiene el rostro arriba: cuenta el eje vertical, no la altura.
    const massC = input.mass.length ? principalAxis(input.mass, aspect) : null;
    const massX = massC ? Math.abs(massC.cx - 0.5) : Math.abs(focal.x - 0.5);
    const massY = massC ? Math.abs(massC.cy - 0.5) : Math.abs(focal.y - 0.5);
    const focalX = Math.abs(focal.x - 0.5);
    const centered = bell(massX, 0.12) * bell(focalX, 0.1) * bell(massY, 0.45);
    const score = 100 * centered;
    list.push({
      id: 'central',
      name: tx('composition.centrada'),
      score,
      target: [0.5, focal.y],
      point: [0.5, 0.5],
      why: score >= 62 ? tx('composition.el_sujeto_ocupa_el') : score >= CLEAR ? tx('composition.el_sujeto_queda_cerca') : tx('composition.el_sujeto_no_esta'),
    });
  }
  list.push(spiralScheme(input, focal));
  list.push(diagonalScheme(input));
  list.push(triangleScheme(input));
  list.push(symmetryScheme(input));
  if (gesture && curve && curve.length > 2) {
    let span = 0;
    for (let i = 1; i < curve.length; i++) span += Math.hypot((curve[i][0] - curve[i - 1][0]) * aspect, curve[i][1] - curve[i - 1][1]);
    span /= Math.hypot(aspect, 1);
    // Se mide también sobre el trazo mostrado: una recta no es una curva aunque el gesto la llame C.
    const a = curve[0];
    const b = curve[curve.length - 1];
    const chord = Math.hypot((b[0] - a[0]) * aspect, b[1] - a[1]) || 1e-6;
    let dev = 0;
    for (const q of curve) dev = Math.max(dev, Math.abs((b[0] - a[0]) * aspect * (a[1] - q[1]) - (a[0] - q[0]) * aspect * (b[1] - a[1])) / chord);
    const bend = Math.min(gesture.bend, dev / chord);
    const shape = gesture.shape === 'recta' ? 0 : 1;
    const score = 100 * shape * clamp((bend - 0.05) / 0.23) * clamp(span / 0.5);
    list.push({
      id: 'curva',
      name: gesture.shape === 'S' ? tx('common.curva_en') : tx('composition.curva_en'),
      score,
      curve,
      why: score >= CLEAR ? tx('composition.la_figura_dibuja_una', { shape: gesture.shape }) : bend < 0.08 ? tx('composition.el_eje_de_la') : tx('composition.no_hay_una_curva'),
    });
  }
  const vp = vanishing;
  let radialWhy = tx('composition.no_hay_lineas_que');
  if (vp) {
    const near = focal ? Math.hypot((vp.point[0] - focal.x) * aspect, vp.point[1] - focal.y) / Math.hypot(aspect, 1) < 0.2 : false;
    radialWhy = !vp.inside
      ? tx('composition.las_lineas_de_la')
      : near || !focal
        ? tx('composition.las_lineas_de_la_2')
        : tx('composition.las_lineas_de_la_3');
  }
  list.push({
    id: 'radial',
    name: tx('composition.lineas_que_convergen'),
    score: vp ? 45 + 50 * clamp((vp.reach - 1) / 2.5) : 0,
    point: vp?.inside ? vp.point : undefined,
    rays: vp?.inside ? vp.rays : undefined,
    segments: vp && !vp.inside ? vp.segments : undefined,
    why: radialWhy,
  });
  const horizontal = lines.filter((l) => Math.abs(l.a[1] - l.b[1]) < 0.04 && Math.abs(l.a[0] - l.b[0]) > 0.5).sort((a, b) => b.strength - a.strength)[0];
  if (horizontal) {
    const y = (horizontal.a[1] + horizontal.b[1]) / 2;
    const off = Math.min(Math.abs(y - 1 / 3), Math.abs(y - 2 / 3));
    list.push({
      id: 'horizonte',
      name: tx('composition.horizonte_en_tercio'),
      score: 100 * bell(off, 0.06),
      level: y,
      why: off < 0.05 ? tx('composition.una_linea_horizontal_fuerte') : tx('composition.hay_un_horizonte_pero'),
    });
  }
  return list.sort((a, b) => b.score - a.score);
}

export type Fit = 'domina' | 'parcial' | 'no';
export const fitOf = (score: number): Fit => (score >= 62 ? 'domina' : score >= 38 ? 'parcial' : 'no');

export interface CropAdvice {
  crop: Crop;
  /** Distancia que queda entre foco y objetivo, fracción de la diagonal. */
  residual: number;
  /** Cuánto se mueve el encuadre, fracción del lado. */
  moved: number;
  dx: number;
  dy: number;
}

/** Encuadre que lleva el foco a un punto objetivo, moviendo y acercando lo mínimo. */
export function adviseCrop(focal: Pt, target: Pt, image: { w: number; h: number }, aspect: number, crop: Crop, maxZoom = 1.5): CropAdvice {
  const rect = frameRect(image.w, image.h, aspect, crop);
  const fx = rect.x + focal[0] * rect.w;
  const fy = rect.y + focal[1] * rect.h;
  const [tx, ty] = target;
  const base = frameRect(image.w, image.h, aspect, { cx: 0.5, cy: 0.5, zoom: 1 });
  let zoom = crop.zoom;
  // Acercar da margen: el encuadre puede deslizarse aunque toque el borde de la foto.
  for (let z = crop.zoom; z <= maxZoom + 1e-6; z += 0.02) {
    const w = base.w / z;
    const h = base.h / z;
    const x = fx - tx * w;
    const y = fy - ty * h;
    zoom = z;
    if (x >= -0.5 && x + w <= image.w + 0.5 && y >= -0.5 && y + h <= image.h + 0.5) break;
  }
  const w = base.w / zoom;
  const h = base.h / zoom;
  const x = Math.min(image.w - w, Math.max(0, fx - tx * w));
  const y = Math.min(image.h - h, Math.max(0, fy - ty * h));
  const next: Crop = { cx: (x + w / 2) / image.w, cy: (y + h / 2) / image.h, zoom };
  const nx = (fx - x) / w;
  const ny = (fy - y) / h;
  const dx = (x + w / 2 - (rect.x + rect.w / 2)) / rect.w;
  const dy = (y + h / 2 - (rect.y + rect.h / 2)) / rect.h;
  return {
    crop: next,
    residual: Math.hypot((nx - tx) * aspect, ny - ty) / Math.hypot(aspect, 1),
    moved: Math.hypot(dx, dy),
    dx,
    dy,
  };
}

export interface Balance {
  /** Centro de peso visual, normalizado. */
  center: Pt;
  label: string;
  /** Punto de mayor contraste local. */
  contrast: Pt;
}

/** Dónde carga la imagen: combina atención y contraste local. */
export function visualBalance(attention: Float32Array, n: number, tiny: Uint8Array, tn: number): Balance {
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = attention[y * n + x];
      sum += w;
      cx += w * (x + 0.5);
      cy += w * (y + 0.5);
    }
  }
  const center: Pt = sum > 0 ? [cx / sum / n, cy / sum / n] : [0.5, 0.5];
  let best = -1;
  let contrast: Pt = [0.5, 0.5];
  for (let y = 2; y < tn - 2; y++) {
    for (let x = 2; x < tn - 2; x++) {
      let lo = 255;
      let hi = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = tiny[(y + dy) * tn + x + dx];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi - lo > best) {
        best = hi - lo;
        contrast = [(x + 0.5) / tn, (y + 0.5) / tn];
      }
    }
  }
  const dx = center[0] - 0.5;
  const dy = center[1] - 0.5;
  const parts: string[] = [];
  if (Math.abs(dy) > 0.06) parts.push(dy < 0 ? tx('common.arriba') : tx('common.abajo'));
  if (Math.abs(dx) > 0.06) parts.push(dx < 0 ? tx('common.la_izquierda_2') : tx('common.la_derecha_2'));
  return { center, contrast, label: parts.length ? tx('composition.carga', { v1: parts.join(tx('common.sep_y')) }) : tx('composition.bien_equilibrada') };
}

export interface SchemeReading {
  /** Lo que se afirma de la imagen. */
  headline: string;
  detail: string;
  /** Esquemas que la imagen apoya, parejos entre sí si hay más de uno. */
  leading: Scheme[];
  /** Falso cuando ningún esquema se apoya en la imagen. */
  clear: boolean;
}

/**
 * Una sola lectura para todo: el título, la lista, el trazo y el resumen salen de aquí. Si dos
 * esquemas están parejos no se elige uno al azar, se dicen los dos; si ninguno alcanza, se dice.
 */
export function readSchemes(list: Scheme[]): SchemeReading {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top || top.score < CLEAR) {
    return { headline: tx('composition.sin_un_esquema_claro'), detail: tx('composition.ningun_esquema_se_apoya'), leading: [], clear: false };
  }
  const leading = sorted.filter((x) => x.score >= CLEAR && top.score - x.score <= 8).slice(0, 3);
  if (leading.length > 1) {
    return { headline: leading.map((x) => x.name).join(tx('common.sep_o')), detail: tx('composition.estan_parejos_la_imagen'), leading, clear: true };
  }
  return { headline: top.name, detail: tx('composition.es_lo_que_mejor'), leading, clear: true };
}

/** El esquema que se muestra: el que eligió quien pinta, o el que la imagen apoya. */
export function activeScheme(list: Scheme[], chosen: string | null | undefined): Scheme | undefined {
  const picked = chosen ? list.find((x) => x.id === chosen) : undefined;
  if (picked) return picked;
  return readSchemes(list).leading[0];
}
