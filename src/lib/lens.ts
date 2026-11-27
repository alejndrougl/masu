import { blur, canny, linkEdges } from './edges';
import { detectSegments } from './segments';
import type { Pt } from './types';

/**
 * Lente con el modelo de división (Fitzgibbon): p' = c + (p − c) / (1 + λ r²), con r en
 * medias diagonales. λ < 0 es barril u ojo de pez. Bajo este modelo una recta del mundo
 * se ve como un arco de círculo, y esa es toda la teoría de la perspectiva curva.
 */
export interface Lens {
  /** Curvatura: 0 lente recto. */
  k: number;
  /** Centro óptico, normalizado sobre el encuadre. */
  c: Pt;
  /** Qué tan clara es la evidencia, 0 a 1. */
  sure: number;
  /** Cuántas rectas del mundo la sostienen. */
  arcs: number;
  /** Curvatura que se midió sin llegar a afirmarla. */
  hint?: number;
}

export const STRAIGHT: Lens = { k: 0, c: [0.5, 0.5], sure: 0, arcs: 0 };

/** Lleva puntos entre la imagen (curva) y el plano recto. Todo en píxeles. */
export function lensMap(lens: Pick<Lens, 'k' | 'c'>, w: number, h: number) {
  const R = Math.hypot(w, h) / 2;
  const cx = lens.c[0] * w;
  const cy = lens.c[1] * h;
  const k = lens.k;
  /** Radio del círculo de imagen: lo que está en el infinito del plano recto. */
  const edge = k < 0 ? R / Math.sqrt(-k) : Infinity;
  const straighten = ([x, y]: Pt): Pt => {
    const dx = x - cx;
    const dy = y - cy;
    const d = 1 + (k * (dx * dx + dy * dy)) / (R * R);
    // Fuera del círculo de imagen no hay plano: se queda en el borde.
    const safe = d > 0.02 ? d : 0.02;
    return [cx + dx / safe, cy + dy / safe];
  };
  const curve = ([x, y]: Pt): Pt => {
    if (!k) return [x, y];
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy) / R;
    if (r < 1e-9) return [x, y];
    const q = 2 * k * r;
    const inside = 1 - 4 * k * r * r;
    if (inside < 0) return [x, y];
    const rd = (1 - Math.sqrt(inside)) / q;
    const s = (rd * R) / Math.hypot(dx, dy);
    return [cx + dx * s, cy + dy * s];
  };
  return { straighten, curve, edge, cx, cy, R };
}

interface Piece {
  a: Pt;
  b: Pt;
  length: number;
}

/**
 * Qué tan bien caen los segmentos sobre rectas comunes. Cada segmento vota por su recta
 * (ángulo y distancia al centro): si una recta del mundo se ve quebrada en muchos tramos,
 * con la curvatura correcta todos votan por la misma y la suma de cuadrados se dispara.
 */
function straightness(pieces: Piece[], map: ReturnType<typeof lensMap>, step: number): { score: number; lines: number } {
  const votes = new Map<number, number>();
  for (const { a, b, length } of pieces) {
    const [ax, ay] = map.straighten(a);
    const [bx, by] = map.straighten(b);
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);
    if (span < 1 || Math.hypot(ax - map.cx, ay - map.cy) > map.R * 6) continue;
    const nx = -dy / span;
    const ny = dx / span;
    let rho = (ax - map.cx) * nx + (ay - map.cy) * ny;
    let theta = Math.atan2(ny, nx);
    if (theta < 0) {
      theta += Math.PI;
      rho = -rho;
    }
    const key = Math.floor((theta / Math.PI) * 120) * 100000 + Math.floor(rho / step + 40000);
    votes.set(key, (votes.get(key) ?? 0) + length);
  }
  let score = 0;
  let lines = 0;
  for (const v of votes.values()) {
    score += v * v;
    if (v > map.R * 0.2) lines++;
  }
  return { score, lines };
}

/** Direcciones repartidas parejo sobre media esfera (espiral de Fibonacci). */
function hemisphere(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = (i + 0.5) / count;
    const r = Math.sqrt(1 - z * z);
    const t = i * golden;
    out[i * 3] = r * Math.cos(t);
    out[i * 3 + 1] = r * Math.sin(t);
    out[i * 3 + 2] = z;
  }
  return out;
}

const DIRECTIONS = hemisphere(900);
const DIRECTION_COUNT = DIRECTIONS.length / 3;
/** Un grado y pico: lo que se aleja de un círculo máximo sin dejar de pasar por él. */
const ON_CIRCLE = 0.024;

type V = [number, number, number];

/**
 * Qué parte de las líneas explica un lente. Cada tramito define un círculo máximo sobre
 * la esfera de vistas, y todas las rectas paralelas del mundo se cruzan en el mismo punto
 * de esa esfera. Con el lente correcto, casi todo pasa por tres direcciones ortogonales;
 * con uno equivocado se dispersan. A diferencia de pedir rectas largas, esto funciona con
 * pedazos: azulejos, marcos y puertas, aunque la imagen traiga otras líneas encima.
 */
function sphereScore(pieces: Piece[], lens: Pick<Lens, 'k' | 'c'>, focal: number, w: number, h: number): number {
  const map = lensMap(lens, w, h);
  const f = focal * map.R;
  const n = pieces.length;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const weight = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const { a, b, length } = pieces[i];
    const [ax, ay] = map.straighten(a);
    const [bx, by] = map.straighten(b);
    const ux = ax - map.cx;
    const uy = ay - map.cy;
    const vx = bx - map.cx;
    const vy = by - map.cy;
    const cx = uy * f - f * vy;
    const cy = f * vx - ux * f;
    const cz = ux * vy - uy * vx;
    const size = Math.hypot(cx, cy, cz) || 1;
    nx[i] = cx / size;
    ny[i] = cy / size;
    nz[i] = cz / size;
    const near = Math.min(1, map.edge === Infinity ? 1 : Math.max(0, 1.05 - Math.hypot(a[0] - map.cx, a[1] - map.cy) / map.edge) * 8);
    weight[i] = length * near;
    total += weight[i];
  }
  if (!total) return 0;
  const votes = new Float32Array(DIRECTION_COUNT);
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const dx = DIRECTIONS[d * 3];
    const dy = DIRECTIONS[d * 3 + 1];
    const dz = DIRECTIONS[d * 3 + 2];
    let sum = 0;
    for (let i = 0; i < n; i++) if (Math.abs(nx[i] * dx + ny[i] * dy + nz[i] * dz) < ON_CIRCLE) sum += weight[i];
    votes[d] = sum;
  }
  const order = Array.from({ length: DIRECTION_COUNT }, (_, i) => i).sort((p, q) => votes[q] - votes[p]);
  const top = order.slice(0, 40);
  const dir = (i: number): V => [DIRECTIONS[i * 3], DIRECTIONS[i * 3 + 1], DIRECTIONS[i * 3 + 2]];
  const explained = (list: V[]) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (const [dx, dy, dz] of list) {
        if (Math.abs(nx[i] * dx + ny[i] * dy + nz[i] * dz) < ON_CIRCLE) {
          sum += weight[i];
          break;
        }
      }
    }
    return sum;
  };
  let best = votes[top[0]];
  for (let p = 0; p < 12; p++) {
    const a = dir(top[p]);
    for (const q of order.slice(0, 160)) {
      const b = dir(q);
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (Math.abs(dot) > 0.12) continue;
      // Se endereza b para que sea ortogonal a a, y la tercera sale sola.
      const e: V = [b[0] - a[0] * dot, b[1] - a[1] * dot, b[2] - a[2] * dot];
      const es = Math.hypot(e[0], e[1], e[2]) || 1;
      const u: V = [e[0] / es, e[1] / es, e[2] / es];
      const c: V = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
      const sum = explained([a, u, c]);
      if (sum > best) best = sum;
      if (best > total * 0.97) return best / total;
    }
  }
  return best / total;
}

const FOCALS = [0.55, 0.8, 1.15, 1.7];

/** El mejor lente con esta curvatura: el centro y la focal no se conocen. */
function bestFor(pieces: Piece[], k: number, c: Pt, w: number, h: number): { score: number; focal: number } {
  let best = { score: 0, focal: FOCALS[1] };
  for (const focal of FOCALS) {
    const score = sphereScore(pieces, { k, c }, focal, w, h);
    if (score > best.score) best = { score, focal };
  }
  return best;
}

/** Qué tanto ayuda curvar, buscando curvatura y centro por pasos. */
export function sphereSearch(pieces: Piece[], principal: Pt, w: number, h: number): { k: number; c: Pt; score: number; flat: number } {
  const flat = bestFor(pieces, 0, principal, w, h).score;
  let best = { k: 0, c: principal, score: flat };
  for (let k = -0.2; k >= -1.41; k -= 0.15) {
    const r = bestFor(pieces, k, principal, w, h);
    if (r.score > best.score) best = { k, c: principal, score: r.score };
  }
  // Una viñeta o un recorte mueven el centro: se busca alrededor, dos veces.
  for (const k of best.k ? [best.k] : [-0.35, -0.65]) {
    for (const step of [0.11, 0.055]) {
      const around = best.c;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const c: Pt = [around[0] + ox * step, around[1] + oy * step];
          const r = bestFor(pieces, k, c, w, h);
          if (r.score > best.score) best = { k, c, score: r.score };
        }
      }
    }
  }
  if (best.k) {
    for (const k of [best.k - 0.08, best.k + 0.08]) {
      if (k > -0.12) continue;
      const r = bestFor(pieces, k, best.c, w, h);
      if (r.score > best.score) best = { ...best, k, score: r.score };
    }
  }
  return { ...best, flat };
}

/** Tramos de borde casi rectos: lo que un lente puede doblar, sin esquinas ni rizos. */
export function archTiles(L: Uint8Array, w: number, h: number): Pt[][] {
  const diag = Math.hypot(w, h);
  const edges = canny(blur(Float32Array.from(L), w, h, Math.max(1, diag * 0.0014)), w, h, 0.12);
  const chains = linkEdges(edges, w, h, diag * 0.04);
  const span = Math.round(diag * 0.11);
  const out: Pt[][] = [];
  for (const chain of chains) {
    for (let start = 0; start + span <= chain.length; start += Math.round(span / 2)) {
      const part = chain.slice(start, start + span);
      const first = part[0];
      const last = part[part.length - 1];
      const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
      if (chord < span * 0.9) continue;
      const tile: Pt[] = [];
      for (let i = 0; i <= 6; i++) tile.push(part[Math.round((i / 6) * (part.length - 1))]);
      out.push(tile);
      if (out.length > 900) return out;
    }
  }
  return out;
}

function bow(tile: Pt[], map: ReturnType<typeof lensMap> | null): number {
  const pts = map ? tile.map(map.straighten) : tile;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let sum = 0;
  for (let i = 1; i < pts.length - 1; i++) sum += Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len;
  return sum / (pts.length - 2) / len;
}

/**
 * Plomada sobre arcos: un lente real aplana a la vez casi todos los bordes; en una mano o
 * un árbol unos se aplanan y otros se doblan más, porque ahí no hay rectas que enderezar.
 * Devuelve qué fracción de los tramos curvos queda más recta y cuántos se doblan.
 */
export function flattenShare(tiles: Pt[][], lens: Pick<Lens, 'k' | 'c'>, w: number, h: number): { flatter: number; worse: number; curved: number } {
  const map = lensMap(lens, w, h);
  let flatter = 0;
  let worse = 0;
  let curved = 0;
  for (const tile of tiles) {
    const before = bow(tile, null);
    if (before > 0.09) continue;
    const after = bow(tile, map);
    if (before > 0.0035) {
      curved++;
      if (after < before * 0.62) flatter++;
    }
    if (after > before * 1.7 && after > 0.0045) worse++;
  }
  return { flatter: flatter / (curved || 1), worse: worse / (tiles.length || 1), curved: curved / (tiles.length || 1) };
}

/** Una escena construida: hay líneas de sobra, y casi todas se enderezan juntas. */
function holdsUp(tiles: Pt[][], pieces: number, lens: Pick<Lens, 'k' | 'c'>, w: number, h: number): boolean {
  if (tiles.length < 18) return false;
  const { flatter, worse, curved } = flattenShare(tiles, lens, w, h);
  // Con pocas líneas hace falta que casi todas se enderecen: una rejilla sí, un retrato no.
  const enough = pieces >= 150 ? flatter >= 0.3 : flatter >= 0.6;
  return curved >= 0.6 && enough && worse <= 0.12;
}

/**
 * Una perspectiva esférica dibujada es un círculo sobre fondo liso. Ese círculo es el infinito
 * del plano, así que su radio dice la curvatura sin necesidad de seguir un solo arco: por eso
 * funciona aunque la imagen sea diminuta. Afuera debe estar vacío; si no, es un círculo más.
 */
export function imageCircle(L0: Uint8Array, w0: number, h0: number): { c: Pt; r: number } | null {
  // Se lee a tamaño chico: un círculo dibujado queda como una línea de un píxel.
  const k = Math.min(1, 300 / Math.max(w0, h0));
  const w = Math.max(16, Math.round(w0 * k));
  const h = Math.max(16, Math.round(h0 * k));
  const L = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y / h) * h0);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) / h) * h0));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x / w) * w0);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) / w) * w0));
      let sum = 0;
      let n = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          sum += L0[py * w0 + px];
          n++;
        }
      }
      L[y * w + x] = sum / n;
    }
  }
  const side = Math.round(Math.min(w, h) * 0.07);
  const patch = (x0: number, y0: number) => {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = y0; y < y0 + side; y++) {
      for (let x = x0; x < x0 + side; x++) {
        const v = L[y * w + x];
        sum += v;
        sq += v * v;
        n++;
      }
    }
    const mean = sum / n;
    return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  };
  const corners = [patch(0, 0), patch(w - side, 0), patch(0, h - side), patch(w - side, h - side)];
  // Una esquina puede traer una línea que se sale del dibujo: bastan tres lisas y parecidas.
  const clean = corners.filter((q) => q.spread <= 16).sort((p, q) => p.mean - q.mean);
  if (clean.length < 3 || clean[clean.length - 1].mean - clean[0].mean > 30) return null;
  const blank = clean[clean.length >> 1].mean;
  const least = Math.min(w, h);
  const ink = (x: number, y: number) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) return false;
    return Math.abs(L[py * w + px] - blank) > 26;
  };
  let best: { c: Pt; r: number } | null = null;
  let top = 0;
  const BINS = 72;
  const around = (cx: number, cy: number, r: number) => {
    let hits = 0;
    for (let b = 0; b < BINS; b++) {
      const t = (b / BINS) * Math.PI * 2;
      if (ink(cx + Math.cos(t) * r, cy + Math.sin(t) * r)) hits++;
    }
    return hits / BINS;
  };
  for (let ox = -12; ox <= 12; ox += 0.75) {
    for (let oy = -12; oy <= 12; oy += 0.75) {
      const cx = w / 2 + (ox / 100) * w;
      const cy = h / 2 + (oy / 100) * h;
      for (let r = least * 0.34; r < least * 0.56; r += 0.7) {
        const share = around(cx, cy, r);
        if (share < 0.5) continue;
        // Una línea, no el borde de una mancha: tanto afuera como adentro queda vacío.
        if (around(cx, cy, r + least * 0.03) > 0.08) continue;
        if (around(cx, cy, r - least * 0.03) > 0.4) continue;
        const score = share * r;
        if (score > top) {
          top = score;
          best = { c: [cx / w, cy / h], r: r / k };
        }
      }
    }
  }
  return best;
}

/**
 * Tres pruebas independientes. La esfera y la plomada proponen una curvatura: la primera
 * mide si todo apunta a tres direcciones y la segunda si los tramos se alinean. Después
 * los arcos largos confirman, porque un retrato o una mano también "mejoran" un poco por
 * casualidad. Lo que no se confirma queda como sugerencia: una imagen recta sigue recta.
 */
export function estimateLens(L: Uint8Array, w: number, h: number, principal: Pt = [0.5, 0.5]): Lens {
  const diag = Math.hypot(w, h);
  const round = imageCircle(L, w, h);
  // El borde del círculo es donde la división del lente se anula: k = −(R / r)².
  if (round) return { k: -Math.min(9, (diag / 2 / round.r) ** 2), c: round.c, sure: 0.9, arcs: 0 };
  const found = detectSegments(L, w, h, Math.max(9, diag * 0.012));
  const pieces: Piece[] = found.slice(0, 700).map((f) => ({ a: f.a, b: f.b, length: f.length }));
  if (pieces.length < 16) return { ...STRAIGHT, c: principal };
  const step = diag * 0.006;
  const base = straightness(pieces, lensMap({ k: 0, c: principal }, w, h), step);
  let best = { score: base.score, k: 0, c: principal, lines: base.lines };
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const c: Pt = [principal[0] + ox * 0.06, principal[1] + oy * 0.06];
      for (let k = -0.1; k >= -1.5; k -= 0.05) {
        const r = straightness(pieces, lensMap({ k, c }, w, h), step);
        if (r.score > best.score) best = { score: r.score, k, c, lines: r.lines };
      }
    }
  }
  const gain = best.score / (base.score || 1);
  const sphere = sphereSearch(pieces.slice(0, 340), principal, w, h);
  const lift = sphere.score / (sphere.flat || 1e-6);
  const fromSphere = sphere.k <= -0.2 && lift >= 1.12;
  const fromPlumb = best.k <= -0.2 && gain >= 1.05;
  // Una ganancia así de grande no pasa por casualidad: ninguna imagen orgánica la alcanza.
  if (lift >= 1.7 && sphere.score - sphere.flat >= 0.2) return { k: sphere.k, c: sphere.c, sure: 1, arcs: best.lines };
  if (fromSphere || fromPlumb) {
    const tiles = archTiles(L, w, h);
    const agree = fromSphere && fromPlumb && Math.abs(sphere.k - best.k) < 0.4;
    const k = agree ? (sphere.k + best.k) / 2 : fromSphere ? sphere.k : best.k;
    const c = fromSphere ? sphere.c : best.c;
    // Las dos pruebas dan una curvatura aproximada: los arcos la afinan. Se queda la que más
    // arcos endereza; en una imagen recta ninguna pasa, así que esto no inventa curvas.
    let chosen: number | null = null;
    let top = -Infinity;
    // Una curvatura extrema que solo propone una prueba no se afina: ahí viven los retratos.
    const room = agree || k > -1 ? [0, 0.1, -0.1, 0.2, -0.2] : [0];
    for (const d of room) {
      const q = Math.max(-1.6, Math.min(-0.15, k + d));
      if (!holdsUp(tiles, found.length, { k: q, c }, w, h)) continue;
      const { flatter, worse } = flattenShare(tiles, { k: q, c }, w, h);
      if (flatter - worse > top) {
        top = flatter - worse;
        chosen = q;
      }
    }
    if (chosen !== null) return { k: chosen, c, sure: Math.min(1, 0.6 + Math.max(lift - 1.2, (gain - 1.1) * 0.8, 0)), arcs: best.lines };
  }
  // Sin afirmar nada: la mejor curvatura queda como propuesta para quien quiera probarla.
  const hint = fromSphere ? sphere.k : fromPlumb ? best.k : undefined;
  return { ...STRAIGHT, c: fromSphere ? sphere.c : fromPlumb ? best.c : principal, hint };
}

/** Curva por la que se ve una recta del plano: de borde a borde del círculo de imagen. */
export function curvedLine(through: Pt, dir: Pt, lens: Pick<Lens, 'k' | 'c'>, w: number, h: number, steps = 48): Pt[] {
  const m = lensMap(lens, w, h);
  const n = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / n;
  const uy = dir[1] / n;
  const out: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    // tan reparte los puntos parejo sobre la curva, aunque el plano sea infinito.
    const s = Math.tan(((i / steps) - 0.5) * Math.PI * 0.998) * m.R;
    const [x, y] = m.curve([through[0] + ux * s, through[1] + uy * s]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** Abanico de curvas que salen de una fuga, ya en píxeles de la imagen. */
export function curvedFan(point: Pt, lens: Pick<Lens, 'k' | 'c'>, w: number, h: number, count: number): Pt[][] {
  const m = lensMap(lens, w, h);
  const center = m.straighten(point);
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI;
    out.push(curvedLine(center, [Math.cos(t), Math.sin(t)], lens, w, h));
  }
  return out;
}
