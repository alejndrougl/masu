import { estimateLens, lensMap, type Lens } from './lens';
import { detectSegments, type Segment } from './segments';
import type { Pt } from './types';

import { t as tx } from '../i18n';
export interface VanishingPoint {
  /** Normalizado sobre el encuadre; puede caer muy lejos de él. */
  point: Pt;
  /** Segmentos que apuntan aquí, normalizados. */
  lines: [Pt, Pt][];
  /** Largo total de esas líneas, en diagonales del encuadre. */
  reach: number;
  /** Las verticales del mundo: fugan arriba o abajo. */
  vertical: boolean;
  /** De dónde salió: rectas, lo más lejano, la mano del pintor o las otras dos fugas. */
  source: 'lineas' | 'profundidad' | 'mano' | 'calculada';
}

export interface Perspective {
  /** 0 si no hay evidencia. */
  kind: 0 | 1 | 2 | 3;
  points: VanishingPoint[];
  horizon: number | null;
  /** Inclinación del horizonte, en grados. */
  roll: number;
  /** Campo de visión horizontal estimado, si dos fugas lo permiten. */
  fov: number | null;
  /** Equivalente en lente de 35 mm. */
  lens: number | null;
  /** Todos los segmentos usados, para mostrarlos. */
  segments: [Pt, Pt][];
  /** Fracción del largo de los segmentos que se explica con estas fugas. */
  explained: number;
  /** Lente curvo: las rectas del mundo se ven como arcos. */
  curve?: Lens;
  /** Distancia focal sobre el plano recto, en anchos de encuadre. */
  focal?: number;
  /** Curvatura que se midió pero no alcanzó para afirmarla. */
  hint?: number;
  /** Centro óptico de esa sugerencia. */
  lensCenter?: Pt;
  /** Había rectas que apuntaban a un punto muy lejano: casi paralelas, sin fuga que medir. */
  parallel?: boolean;
}

type V3 = [number, number, number];

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

interface Line {
  mx: number;
  my: number;
  dx: number;
  dy: number;
  length: number;
  seg: Segment;
}

function toLines(segments: Segment[], cx: number, cy: number, straighten?: (p: Pt) => Pt): Line[] {
  return segments.map((s) => {
    const a = straighten ? straighten(s.a) : s.a;
    const b = straighten ? straighten(s.b) : s.b;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const mx = (a[0] + b[0]) / 2 - cx;
    const my = (a[1] + b[1]) / 2 - cy;
    return { mx, my, dx: (b[0] - a[0]) / span, dy: (b[1] - a[1]) / span, length: s.length, seg: s };
  });
}

/** Seno del ángulo entre el segmento y la recta que va de su centro a la fuga. */
function misfit(l: Line, v: V3, f: number): number {
  const tx = f * v[0] - l.mx * v[2];
  const ty = f * v[1] - l.my * v[2];
  const n = Math.hypot(tx, ty);
  if (n < 1e-9) return 1;
  return Math.abs(l.dx * ty - l.dy * tx) / n;
}

function plane(l: Line, f: number): V3 {
  const p: V3 = [l.mx, l.my, f];
  const q: V3 = [l.mx + l.dx * 100, l.my + l.dy * 100, f];
  return unit(cross(p, q));
}

interface Hypothesis {
  dirs: V3[];
  score: number;
  f: number;
}

const TOL = Math.sin((1.6 * Math.PI) / 180);

/** Una línea corta tiene dirección menos precisa: se le permite más error. */
const allowed = (l: Line) => TOL + 0.9 / l.length;

/** Puntúa tres direcciones perpendiculares: cada línea vota por la que mejor explica. */
function score(lines: Line[], dirs: V3[], f: number): number {
  const reach = [0, 0, 0];
  for (const l of lines) {
    let best = -1;
    const limit = allowed(l);
    let bestE = limit;
    for (let i = 0; i < 3; i++) {
      const e = misfit(l, dirs[i], f);
      if (e < bestE) {
        bestE = e;
        best = i;
      }
    }
    if (best >= 0) reach[best] += l.length * (1 - bestE / limit);
  }
  return reach[0] + reach[1] + reach[2];
}

/**
 * Busca el marco de tres direcciones perpendiculares que más líneas explica. Es el
 * mundo de "Manhattan": muros, piso y verticales forman ángulos rectos. Exigir eso
 * es lo que separa una fuga real de las coincidencias de una textura, y además
 * revela la distancia focal: solo con la focal correcta los tres ejes encajan.
 */
function searchManhattan(lines: Line[], D: number): Hypothesis | null {
  const pool = lines.slice(0, 160);
  if (pool.length < 6) return null;
  let seed = 4242;
  const rand = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * n);
  };
  let best: Hypothesis | null = null;
  for (const k of [0.42, 0.52, 0.62, 0.75, 0.9, 1.1, 1.4, 1.8, 2.5, 3.5]) {
    const f = k * D;
    const planes = pool.map((l) => plane(l, f));
    for (let it = 0; it < 1400; it++) {
      const a = rand(pool.length);
      const b = rand(pool.length);
      if (a === b) continue;
      const v1 = cross(planes[a], planes[b]);
      if (Math.hypot(v1[0], v1[1], v1[2]) < 0.02) continue;
      const d1 = unit(v1);
      const c = rand(pool.length);
      const v2 = cross(planes[c], d1);
      if (Math.hypot(v2[0], v2[1], v2[2]) < 0.02) continue;
      const d2 = unit(v2);
      const d3 = unit(cross(d1, d2));
      const dirs = [d1, d2, d3];
      const s = score(pool, dirs, f);
      if (!best || s > best.score * 1.0005) best = { dirs, score: s, f };
    }
  }
  return best;
}

/** Cuántos abanicos de 6° ocupan las líneas: una fuga real abre muchos. */
function fanBins(members: Line[]): number {
  const bins = new Set<number>();
  for (const l of members) bins.add(Math.floor((((Math.atan2(l.dy, l.dx) * 180) / Math.PI + 180) % 180) / 6));
  return bins.size;
}

/** Busca el abanico de líneas más amplio entre las que quedan. */
function strongestFan(rest: Line[], f: number): V3 | null {
  const pool = rest.slice(0, 140);
  const planes = pool.map((l) => plane(l, f));
  let best: V3 | null = null;
  let bestScore = 0;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const c = cross(planes[i], planes[j]);
      if (Math.hypot(c[0], c[1], c[2]) < 0.015) continue;
      const v = unit(c);
      const members: Line[] = [];
      let reach = 0;
      for (const l of pool) {
        if (misfit(l, v, f) < allowed(l)) {
          members.push(l);
          reach += l.length;
        }
      }
      if (members.length < 5) continue;
      const score = reach * fanBins(members) ** 1.4;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
  }
  return best;
}

/** Punto más cercano a todas sus líneas, pesado por largo. */
function refine(members: Line[], start: V3, f: number): V3 {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  for (const l of members) {
    const nx = -l.dy;
    const ny = l.dx;
    const k = nx * l.mx + ny * l.my;
    a += l.length * nx * nx;
    b += l.length * nx * ny;
    c += l.length * ny * ny;
    d += l.length * nx * k;
    e += l.length * ny * k;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-6 * (a * c + 1)) return start;
  return unit([(c * d - b * e) / det, (a * e - b * d) / det, f]);
}

function angleSpread(members: Line[]): number {
  const deg = members.map((l) => (((Math.atan2(l.dy, l.dx) * 180) / Math.PI) % 180 + 180) % 180).sort((p, q) => p - q);
  let largest = deg[0] + 180 - deg[deg.length - 1];
  for (let i = 1; i < deg.length; i++) largest = Math.max(largest, deg[i] - deg[i - 1]);
  return 180 - largest;
}

export interface ReadOptions {
  /** Centro óptico en fracciones del encuadre; distinto del centro si la foto se recortó. */
  principal?: Pt;
  /** Lente con que se endereza todo antes de buscar fugas. */
  lens?: Lens;
  /** Profundidad del encuadre, del tamaño de la imagen: mayor es más cerca. */
  depth?: Float32Array | null;
}

/** Una fuga de verdad deja a más de esta parte de sus líneas alejándose hacia ella. */
const DEPTH_AGREES = 0.62;

/**
 * Al avanzar por una recta hacia su fuga la escena siempre se aleja: es geometría, no un
 * parecido. Por eso la profundidad es un juez independiente de las rectas y descubre las
 * coincidencias, donde las líneas se cruzan en un punto sin que nada se aleje hacia él.
 * Devuelve qué parte de las líneas lo confirma; null si casi no hay relieve para decidir.
 */
export function depthAgreement(segments: { a: Pt; b: Pt; length: number }[], vp: Pt, depth: Float32Array, w: number, h: number): number | null {
  const sample = ([x, y]: Pt) => {
    const px = Math.max(1, Math.min(w - 2, Math.round(x)));
    const py = Math.max(1, Math.min(h - 2, Math.round(y)));
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += depth[(py + dy) * w + px + dx];
    return sum / 9;
  };
  let good = 0;
  let bad = 0;
  let total = 0;
  for (const s of segments) {
    total += s.length;
    const nearA = Math.hypot(s.a[0] - vp[0], s.a[1] - vp[1]) < Math.hypot(s.b[0] - vp[0], s.b[1] - vp[1]);
    const gap = sample(nearA ? s.b : s.a) - sample(nearA ? s.a : s.b);
    if (Math.abs(gap) < 0.004) continue;
    if (gap > 0) good += s.length;
    else bad += s.length;
  }
  return good + bad < total * 0.25 ? null : good / (good + bad);
}

function enlarge<T extends Uint8Array | Float32Array>(src: T, w: number, h: number, k: number): { data: T; w: number; h: number } {
  const W = w * k;
  const H = h * k;
  const out = (src instanceof Uint8Array ? new Uint8Array(W * H) : new Float32Array(W * H)) as T;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1.001, (y + 0.5) / k - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const ty = Math.max(0, fy - y0);
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1.001, (x + 0.5) / k - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const tx = Math.max(0, fx - x0);
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x0 + 1] * tx;
      const b = src[(y0 + 1) * w + x0] * (1 - tx) + src[(y0 + 1) * w + x0 + 1] * tx;
      out[y * W + x] = a * (1 - ty) + b * ty;
    }
  }
  return { data: out, w: W, h: H };
}

/**
 * Prueba la imagen como lente recto y como lente curvo. El estimador de arcos propone;
 * solo se acepta la curva si con ella las líneas se explican mejor.
 */
export function readScene(L0: Uint8Array, w0: number, h0: number, principal: Pt = [0.5, 0.5], depth0?: Float32Array | null): Perspective {
  // Una imagen muy chica casi no deja ver sus líneas: se lee ampliada. El resultado va en
  // fracciones del encuadre, así que no cambia nada más.
  const grow = Math.max(w0, h0) < 560 ? Math.ceil(760 / Math.max(w0, h0)) : 1;
  const { data: L, w, h } = grow > 1 ? enlarge(L0, w0, h0, grow) : { data: L0, w: w0, h: h0 };
  const depth = depth0 && grow > 1 ? enlarge(depth0, w0, h0, grow).data : depth0;
  const flat = readPerspective(L, w, h, { principal, depth });
  const lens = estimateLens(L, w, h, principal);
  if (!lens.k) return { ...flat, hint: lens.hint, lensCenter: lens.c };
  const bent = readPerspective(L, w, h, { principal, lens, depth });
  // En una esfera dibujada las tres direcciones se conocen: el centro, el lado y el cenit.
  if (lens.sure >= 0.9 && !lens.arcs) {
    const edge = Math.hypot(w, h) / 2 / Math.sqrt(-lens.k);
    const at = (dx: number, dy: number): Pt => [lens.c[0] + (dx * edge) / w, lens.c[1] + (dy * edge) / h];
    const made = (point: Pt, vertical: boolean, source: VanishingPoint['source']): VanishingPoint => ({ point, lines: [], reach: 0, vertical, source });
    return { ...bent, kind: 3, curve: lens, focal: bent.focal, points: [made(at(0, 0), false, 'calculada'), made(at(0.97, 0), false, 'calculada'), made(at(0, -0.97), true, 'calculada')], horizon: lens.c[1] };
  }
  // La lectura del lente ya se confirmó con tres pruebas: si da fugas, esas son las buenas.
  return bent.kind > 0 ? bent : { ...flat, hint: lens.k };
}

export function readPerspective(L: Uint8Array, w: number, h: number, options: ReadOptions = {}): Perspective {
  const D = Math.max(w, h);
  const diag = Math.hypot(w, h);
  const curve = options.lens && options.lens.k ? options.lens : undefined;
  const map = curve ? lensMap(curve, w, h) : null;
  // Un arco se parte en segmentos cortos: con lente curvo se aceptan más chicos.
  const segments = detectSegments(L, w, h, Math.max(curve ? 10 : 14, diag * (curve ? 0.014 : 0.022)));
  const [px, py] = curve ? curve.c : (options.principal ?? [0.5, 0.5]);
  const cx = px * w;
  const cy = py * h;
  const lines = toLines(segments, cx, cy, map?.straighten);
  const empty: Perspective = {
    kind: 0,
    points: [],
    horizon: null,
    roll: 0,
    fov: null,
    lens: null,
    segments: segments.slice(0, 200).map((s) => [[s.a[0] / w, s.a[1] / h], [s.b[0] / w, s.b[1] / h]]),
    explained: 0,
  };
  const total = lines.reduce((n, l) => n + l.length, 0);
  if (lines.length < 8 || total < diag * 1.2) return empty;
  const hyp = searchManhattan(lines, D);
  if (!hyp) return empty;

  interface Found {
    v: V3;
    members: Line[];
    finite: boolean;
    px: Pt;
  }
  const found: Found[] = [];
  let sawParallel = false;
  const claimed = new Set<Line>();
  const refused = new Set<Line>();
  const pixel = (v: V3): Pt => (v[2] ? [(hyp.f * v[0]) / v[2] + cx, (hyp.f * v[1]) / v[2] + cy] : [Infinity, Infinity]);
  // Una recta no puede converger a un punto que está en medio de ella misma.
  const through = (l: Line, v: V3) => {
    const [x, y] = pixel(v);
    if (!Number.isFinite(x)) return false;
    const t = (x - cx - l.mx) * l.dx + (y - cy - l.my) * l.dy;
    return Math.abs(t) < l.length * 0.42;
  };
  const admit = (raw: V3, needFan: boolean) => {
    let v = raw;
    const near = (d: V3, k: number) => lines.filter((l) => !claimed.has(l) && !refused.has(l) && misfit(l, d, hyp.f) < allowed(l) * k && !through(l, d));
    let members = near(v, 1.3);
    if (members.length < 2) return;
    if (members.length >= 3) {
      for (let round = 0; round < 2; round++) {
        v = refine(members, v, hyp.f);
        members = near(v, 1.3);
      }
    }
    const reach = members.reduce((n, l) => n + l.length, 0) / diag;
    const spread = members.length > 1 ? angleSpread(members) : 0;
    const dist = Math.abs(v[2]) < 1e-6 ? Infinity : (Math.hypot(v[0], v[1]) / Math.abs(v[2])) * hyp.f;
    if (reach < 1 || members.length < 6) return;
    if (needFan && fanBins(members) < 5) return;
    if (options.depth && !curve) {
      const said = depthAgreement(members.map((l) => l.seg), pixel(v), options.depth, w, h);
      if (said !== null && said < DEPTH_AGREES) {
        // Lo que parecía una fuga era coincidencia: esas líneas quedan libres de esta idea.
        members.forEach((l) => refused.add(l));
        return false;
      }
    }
    members.forEach((l) => claimed.add(l));
    const x = v[2] ? (hyp.f * v[0]) / v[2] + cx : Infinity;
    const y = v[2] ? (hyp.f * v[1]) / v[2] + cy : Infinity;
    // Sin abanico no hay fuga: son paralelas al cuadro, como verticales rectas.
    // Con ojo de pez toda recta fuga: dentro del círculo cabe hasta el infinito del plano.
    // Una fuga lejana de rectas casi paralelas no es una fuga: no se puede medir. Solo se cree
    // si junta muchísimas líneas, como las verticales de una torre vistas desde la calle.
    const tooFar = !curve && dist > D * 2 && reach < 2.2;
    if (tooFar && dist < D * 40) sawParallel = true;
    found.push({ v, members, finite: (curve ? dist < D * 40 : dist < D * 3.6) && spread >= (curve ? 3 : 6) && !tooFar, px: [x / w, y / h] });
  };
  const fanFirst = strongestFan(
    lines.filter((l) => {
      const deg = (Math.abs(Math.atan2(l.dy, l.dx)) * 180) / Math.PI;
      return Math.min(deg, 180 - deg, Math.abs(deg - 90)) > 4;
    }),
    hyp.f,
  );
  if (fanFirst) admit(fanFirst, true);
  for (const raw of hyp.dirs) admit(raw, false);
  // Segunda pasada: las verticales ya no estorban y aparecen las fugas más discretas.
  for (let round = 0; round < 4; round++) {
    const rest = lines.filter((l) => {
      if (claimed.has(l) || refused.has(l)) return false;
      const deg = (Math.abs(Math.atan2(l.dy, l.dx)) * 180) / Math.PI;
      const tilt = Math.min(deg, 180 - deg, Math.abs(deg - 90));
      return tilt > 4;
    });
    if (rest.length < 5) break;
    const v = strongestFan(rest, hyp.f);
    if (!v) break;
    const before = found.length;
    // Una idea descartada no acaba la búsqueda: la siguiente puede ser la buena.
    if (admit(v, true) === false) continue;
    if (found.length === before) break;
  }

  const finite = found.filter((p) => p.finite);
  const explained = finite.reduce((n, p) => n + p.members.reduce((m, l) => m + l.length, 0), 0) / total;
  if (!finite.length) return { ...empty, explained, parallel: sawParallel };

  const isVertical = (p: Found) => {
    const vx = Math.abs(p.px[0] * w - cx);
    const vy = Math.abs(p.px[1] * h - cy);
    return vy > vx * 1.6 && vy > h * 0.56;
  };
  // Una fuga vale por el abanico que abre, no por cuántas líneas junta: cien horizontales
  // casi paralelas dicen menos que veinte que de verdad convergen en un punto del cuadro.
  const strength = (p: Found) => {
    const reach = p.members.reduce((n, l) => n + l.length, 0) / diag;
    const inside = p.px[0] > -0.4 && p.px[0] < 1.4 && p.px[1] > -0.4 && p.px[1] < 1.4 ? 1.7 : 1;
    return reach * fanBins(p.members) ** 1.3 * inside;
  };
  const ranked = [...finite].sort((p, q) => strength(q) - strength(p));
  const kept: Found[] = [];
  for (const p of ranked) {
    // Dos fugas casi juntas son la misma mal partida.
    if (kept.some((q) => Math.hypot(q.px[0] - p.px[0], q.px[1] - p.px[1]) < 0.22)) continue;
    kept.push(p);
  }
  // En un mundo de ángulos rectos las direcciones son perpendiculares: la que no lo es con
  // la más sólida suele ser una coincidencia del piso o de una textura.
  const square = (p: Found, q: Found) => Math.abs(p.v[0] * q.v[0] + p.v[1] * q.v[1] + p.v[2] * q.v[2]) < 0.38;
  const lead = kept[0];
  const coherent = lead ? kept.filter((p) => p === lead || square(p, lead)) : kept;
  const verticals = coherent.filter(isVertical).slice(0, 1);
  const flat = coherent.filter((p) => !isVertical(p)).slice(0, 2);
  const shown = (q: Pt): Pt => {
    if (!map) return q;
    const [x, y] = map.curve([q[0] * w, q[1] * h]);
    return [x / w, y / h];
  };
  const points: VanishingPoint[] = [...flat, ...verticals].map((p) => ({
    point: shown(p.px),
    lines: p.members.slice(0, 40).map((l) => [[l.seg.a[0] / w, l.seg.a[1] / h], [l.seg.b[0] / w, l.seg.b[1] / h]]),
    reach: p.members.reduce((m, l) => m + l.length, 0) / diag,
    vertical: isVertical(p),
    source: 'lineas',
  }));
  // En un gran angular las tres direcciones del espacio siempre están a la vista: si solo
  // una junta suficientes líneas, las otras dos salen de la mejor terna ortogonal.
  if (curve && points.length === 1) {
    const a = [...flat, ...verticals][0];
    const along = (d: V3) => Math.abs(d[0] * a.v[0] + d[1] * a.v[1] + d[2] * a.v[2]);
    const side = [...hyp.dirs].sort((p, q) => along(p) - along(q))[0];
    const k = side[0] * a.v[0] + side[1] * a.v[1] + side[2] * a.v[2];
    const u = unit([side[0] - a.v[0] * k, side[1] - a.v[1] * k, side[2] - a.v[2] * k]);
    for (const d of [u, unit(cross(a.v, u))]) {
      if (Math.abs(d[2]) < 1e-4) continue;
      const q: Pt = [((hyp.f * d[0]) / d[2] + cx) / w, ((hyp.f * d[1]) / d[2] + cy) / h];
      points.push({ point: shown(q), lines: [], reach: 0, vertical: false, source: 'calculada' });
    }
  }
  // Con dos direcciones perpendiculares la tercera se calcula, aunque casi no haya rectas.
  if (curve && points.length === 2) {
    const [a, b] = [...flat, ...verticals];
    const third = unit(cross(a.v, b.v));
    if (Math.abs(third[2]) > 1e-4) {
      const q: Pt = [((hyp.f * third[0]) / third[2] + cx) / w, ((hyp.f * third[1]) / third[2] + cy) / h];
      const vy = Math.abs(q[1] * h - cy);
      const vx = Math.abs(q[0] * w - cx);
      points.push({ point: shown(q), lines: [], reach: 0, vertical: !verticals.length && vy > vx, source: 'calculada' });
    }
  }

  const level = points.filter((p) => !p.vertical);
  let horizon: number | null = null;
  let roll = 0;
  if (level.length >= 2) {
    const [a, b] = level;
    roll = (Math.atan2((b.point[1] - a.point[1]) * h, (b.point[0] - a.point[0]) * w) * 180) / Math.PI;
    if (roll > 90) roll -= 180;
    if (roll < -90) roll += 180;
    if (Math.abs(roll) > 7 && !curve) {
      // Un horizonte tan chueco delata una fuga falsa: se queda la más sólida.
      points.splice(points.indexOf(b), 1);
      roll = 0;
      horizon = a.point[1];
    } else {
      const t = (0.5 - a.point[0]) / ((b.point[0] - a.point[0]) || 1e-6);
      horizon = a.point[1] + (b.point[1] - a.point[1]) * t;
    }
  } else if (level.length === 1) {
    horizon = level[0].point[1];
  }
  if (horizon !== null && Math.abs(horizon - 0.5) > 1.6) horizon = null;

  // La focal solo se conoce si hay dos fugas finitas: su producto la fija.
  let fov: number | null = null;
  let lens: number | null = null;
  if (points.length >= 2 && !curve) {
    const [a, b] = points;
    const ax = a.point[0] * w - cx;
    const ay = a.point[1] * h - cy;
    const bx = b.point[0] * w - cx;
    const by = b.point[1] * h - cy;
    const sq = -(ax * bx + ay * by);
    if (sq > 0) {
      const f = Math.sqrt(sq);
      const mm = (36 * f) / D;
      // Fuera de esto no hay lente real: las dos fugas no son perpendiculares.
      if (mm >= 11 && mm <= 300) {
        fov = (2 * Math.atan(D / (2 * f)) * 180) / Math.PI;
        lens = mm;
      }
    }
  }
  const kind = Math.min(3, points.length) as 1 | 2 | 3;
  return { ...empty, kind, points, horizon, roll, fov, lens, explained, curve, focal: hyp.f / w };
}

export function lensName(mm: number): string {
  if (mm < 20) return tx('perspective.ultra_gran_angular');
  if (mm < 35) return tx('perspective.gran_angular');
  if (mm < 70) return 'normal';
  return 'teleobjetivo';
}

/**
 * En pasillos, caminos y bosques la fuga es el punto más lejano de la escena, aunque
 * casi no haya rectas. Se confirma viendo que la profundidad cae hacia él desde todos
 * lados: en un retrato o un paisaje con cielo el fondo es ancho y toca los bordes.
 */
export function depthVanishing(depth: Float32Array, w: number, h: number): { point: Pt; coherence: number } | null {
  const diag = Math.hypot(w, h);
  const radius = Math.max(4, Math.round(diag * 0.05));
  const margin = Math.round(diag * 0.04);
  const step = Math.max(2, Math.round(diag / 90));
  // Candidatos: fondos de cuenca dentro del cuadro. Un cielo no tiene fondo: llega al borde.
  const basins: [number, number][] = [];
  for (let y = margin; y < h - margin; y += 2) {
    for (let x = margin; x < w - margin; x += 2) {
      const v = depth[y * w + x];
      let lowest = true;
      for (let dy = -radius; dy <= radius && lowest; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          if (depth[qy * w + qx] < v - 1e-5) {
            lowest = false;
            break;
          }
        }
      }
      if (!lowest) continue;
      // Una cuenca tiene paredes: alrededor todo está más cerca. Un cielo es plano.
      let higher = 0;
      const rim = radius * 1.6;
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * 2 * Math.PI;
        const qx = Math.round(x + Math.cos(t) * rim);
        const qy = Math.round(y + Math.sin(t) * rim);
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        if (depth[qy * w + qx] > v + 0.025) higher++;
      }
      if (higher >= 6) basins.push([x, y]);
    }
  }
  // Del fondo más hondo al menos hondo, sin repetir la misma cuenca.
  basins.sort((p, q) => depth[p[1] * w + p[0]] - depth[q[1] * w + q[0]]);
  const distinct: [number, number][] = [];
  for (const b of basins) {
    if (distinct.length >= 24) break;
    if (distinct.some((d) => Math.hypot(d[0] - b[0], d[1] - b[1]) < radius * 1.5)) continue;
    distinct.push(b);
  }
  let best: { point: Pt; coherence: number } | null = null;
  for (const [bx, by] of distinct) {
    let sum = 0;
    let weight = 0;
    let around = 0;
    const sectors = new Uint8Array(8);
    for (let y = step; y < h - step; y += step) {
      for (let x = step; x < w - step; x += step) {
        const rx = x - bx;
        const ry = y - by;
        const r = Math.hypot(rx, ry);
        if (r < diag * 0.06 || r > diag * 0.55) continue;
        const i = y * w + x;
        const gx = depth[i + step] - depth[i - step];
        const gy = depth[i + step * w] - depth[i - step * w];
        const g = Math.hypot(gx, gy);
        if (g < 1e-4) continue;
        // La profundidad se acerca al alejarse del punto. Los saltos de una columna al
        // fondo son enormes y en ambos sentidos: se limitan para que no ahoguen la señal.
        const along = (gx * rx + gy * ry) / r;
        const capped = Math.min(g, 0.03);
        sum += (along / g) * capped;
        weight += capped;
        if (along > g * 0.5) {
          around++;
          sectors[Math.floor(((Math.atan2(ry, rx) + Math.PI) / (2 * Math.PI)) * 8) % 8] = 1;
        }
      }
    }
    const coherence = weight ? sum / weight : 0;
    const spread = sectors.reduce((a, b) => a + b, 0);
    // Debe rodearlo: una pared que se aleja hacia un lado no es una fuga.
    if (around > 20 && spread >= 6 && (!best || coherence > best.coherence)) best = { point: [bx / w, by / h], coherence };
  }
  if (!best || best.coherence <= 0.42) return null;
  return { point: groundOfSky(depth, w, h, best.point), coherence: best.coherence };
}

/**
 * Lo más lejano de una carretera entre árboles es el hueco de cielo, pero el cielo no fuga: la
 * fuga del suelo está donde el cielo toca la tierra. Si el punto cae en cielo (lo más lejano y
 * pegado al borde de arriba), baja por su columna hasta que empieza lo que no es cielo.
 */
export function groundOfSky(depth: Float32Array, w: number, h: number, [px, py]: Pt): Pt {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of depth) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const far = lo + (hi - lo) * 0.02;
  const sky = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    if (depth[x] <= far) {
      sky[x] = 1;
      stack.push(x);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (q < 0 || q >= w * h || sky[q] || depth[q] > far) continue;
      sky[q] = 1;
      stack.push(q);
    }
  }
  const x = Math.min(w - 1, Math.max(0, Math.round(px * w)));
  let y = Math.min(h - 1, Math.max(0, Math.round(py * h)));
  if (!sky[y * w + x]) return [px, py];
  // Se baja por una franja angosta para no perderse en una rendija de una sola columna.
  const band = Math.max(1, Math.round(w * 0.01));
  const isSky = (yy: number) => {
    let n = 0;
    let c = 0;
    for (let dx = -band; dx <= band; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      c++;
      if (sky[yy * w + xx]) n++;
    }
    return n * 2 > c;
  };
  while (y < h - 1 && isSky(y + 1)) y++;
  return [px, Math.min(1, (y + 1) / h)];
}

export interface DepthFlow {
  point: Pt;
  coherence: number;
  /** Cuántos de los ocho sectores alrededor del punto confirman. */
  sectors: number;
  /** Qué parte de la imagen tiene relieve que opinar. */
  share: number;
}

/**
 * Sin rectas ni cuenca cerrada, como una columnata que se abre al cielo: la fuga es el punto
 * hacia donde corre toda la profundidad. Se prueba cada lugar del cuadro y se mide cuánto del
 * relieve apunta hacia allá. Un paisaje solo corre hacia arriba y un retrato corre hacia
 * afuera de la figura: por eso se exige que lo rodee por varios lados.
 */
export function depthFlow(depth: Float32Array, w: number, h: number): DepthFlow | null {
  const diag = Math.hypot(w, h);
  const step = Math.max(2, Math.round(diag / 70));
  const samples: { x: number; y: number; gx: number; gy: number; g: number }[] = [];
  let count = 0;
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      count++;
      const i = y * w + x;
      const gx = depth[i + step] - depth[i - step];
      const gy = depth[i + step * w] - depth[i - step * w];
      const g = Math.hypot(gx, gy);
      if (g >= 0.004) samples.push({ x, y, gx, gy, g: Math.min(g, 0.04) });
    }
  }
  if (samples.length < 40) return null;
  let best: DepthFlow | null = null;
  const gridX = 28;
  const gridY = 20;
  for (let j = 2; j < gridY - 2; j++) {
    for (let i = 2; i < gridX - 2; i++) {
      const cx = ((i + 0.5) / gridX) * w;
      const cy = ((j + 0.5) / gridY) * h;
      let sum = 0;
      let weight = 0;
      const sectors = new Uint8Array(8);
      const hits = new Uint16Array(8);
      for (const q of samples) {
        const rx = q.x - cx;
        const ry = q.y - cy;
        const r = Math.hypot(rx, ry);
        if (r < diag * 0.05) continue;
        // Mayor es más cerca: alejándose del punto la escena debe acercarse.
        const along = (q.gx * rx + q.gy * ry) / r / (Math.hypot(q.gx, q.gy) || 1);
        sum += along * q.g;
        weight += q.g;
        if (along > 0.6) hits[Math.floor(((Math.atan2(ry, rx) + Math.PI) / (2 * Math.PI)) * 8) % 8]++;
      }
      const need = samples.length * 0.012;
      for (let k = 0; k < 8; k++) sectors[k] = hits[k] > need ? 1 : 0;
      const around = sectors.reduce((p, v) => p + v, 0);
      const coherence = weight ? sum / weight : 0;
      if (around >= 5 && (!best || coherence * around > best.coherence * best.sectors)) best = { point: [cx / w, cy / h], coherence, sectors: around, share: samples.length / count };
    }
  }
  return best;
}

/** Une lo que dicen las rectas con lo que dice la profundidad. */
/**
 * Un mar o una llanura no tienen fugas, pero sí horizonte: una recta casi plana que cruza el
 * cuadro. Es lo primero que hay que colocar en un paisaje.
 */
export function levelHorizon(segments: [Pt, Pt][], aspect: number): number | null {
  const rows = new Map<number, number>();
  for (const [a, b] of segments) {
    const dx = (b[0] - a[0]) * aspect;
    const dy = b[1] - a[1];
    if (Math.abs(dy) > Math.abs(dx) * 0.03) continue;
    const row = Math.round(((a[1] + b[1]) / 2) * 60);
    rows.set(row, (rows.get(row) ?? 0) + Math.abs(b[0] - a[0]));
  }
  let best: number | null = null;
  let most = 0.5;
  for (const [row, reach] of rows) {
    const near = reach + (rows.get(row - 1) ?? 0) + (rows.get(row + 1) ?? 0);
    if (near > most && row / 60 > 0.08 && row / 60 < 0.92) {
      most = near;
      best = row / 60;
    }
  }
  return best;
}

export function withDepth(p: Perspective, far: { point: Pt } | null): Perspective {
  if (!far) return p;
  const close = p.points.some((v) => Math.hypot(v.point[0] - far.point[0], v.point[1] - far.point[1]) < 0.12);
  if (close) return p;
  const level = p.points.filter((v) => !v.vertical);
  // Si las rectas ya explican la escena, lo lejano no agrega nada: no se inventa otra fuga.
  if (p.points.some((v) => v.reach > 2) || (level.length >= 2 && level.every((v) => v.reach > 1.5))) return p;
  const vertical = p.points.filter((v) => v.vertical);
  const points: VanishingPoint[] = [{ point: far.point, lines: [], reach: 0, vertical: false, source: 'profundidad' }, ...vertical];
  return { ...p, kind: Math.min(3, points.length) as 1 | 2 | 3, points, horizon: far.point[1], roll: 0, fov: null, lens: null };
}
