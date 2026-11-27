import { toPath } from '../lib/edges';
import type { Feature } from '../lib/features';
import type { HeadGuide, Mannequin, Piece } from '../lib/mannequin';
import type { Pt } from '../lib/types';
import type { V3 } from '../lib/volumes';
import type { Prim, View } from './overlays';
import { ROJO } from './palette';

const PAPER = 'var(--paper)';
const INK = 'var(--ink)';
/** Dirección de la luz si no se pudo leer: viene de arriba a la izquierda. */
const LIGHT: Pt = [0.6, 0.8];

export interface MannequinView {
  /** 2: círculos y líneas. 3: sólidos. */
  level: 2 | 3;
  /** Muestra hasta esta pieza, la última resaltada. Sin valor: todas. */
  upto?: number | null;
  /** Qué tan opacas son las piezas: al subir la foto se puede calcar encima. */
  solid?: number;
}

/** Cada etapa de la cabeza se dibuja sobre la anterior. */
export function headGuidePrims(g: HeadGuide, stage: number, v: View, fill = true, solid = 1): Prim[] {
  const { W, H, unit } = v;
  const line = (p: Pt[], closed = false) => toPath(p, closed, W, H);
  const out: Prim[] = [];
  const shape = stage >= 3 ? g.outline : g.ball;
  out.push({ t: 'path', d: line(shape, true), fill: fill ? PAPER : undefined, stroke: INK, w: 1.8, alpha: 1, fillAlpha: solid });
  if (stage >= 6 && g.facets.length) {
    for (const f of g.facets) {
      // Tres valores, como en un estudio de planos: más que eso ya es un degradado.
      const value = f.tone > 0.62 ? 0 : f.tone > 0.34 ? 0.16 : 0.36;
      out.push({ t: 'path', d: line(f.poly, true), fill: stage >= 7 ? INK : undefined, alpha: 0.8, fillAlpha: stage >= 7 ? value : undefined, stroke: INK, w: 0.8 });
    }
    return out;
  }
  if (stage >= 3) out.push({ t: 'path', d: line(g.ball, true), stroke: INK, w: 0.9, alpha: 0.4 });
  for (const l of g.axes) out.push({ t: 'path', d: line(l), stroke: ROJO, w: 1.3 });
  if (stage >= 2) {
    for (const l of g.brow) out.push({ t: 'path', d: line(l), stroke: ROJO, w: 1.1 });
    for (const l of g.side) out.push({ t: 'path', d: line(l), stroke: INK, w: 1, alpha: 0.7 });
  }
  if (stage >= 3) for (const l of g.jaw) out.push({ t: 'path', d: line(l), stroke: INK, w: 1.3 });
  if (stage >= 4) for (const l of g.guides) out.push({ t: 'path', d: line(l), stroke: ROJO, w: 1, alpha: 0.85 });
  if (stage >= 5) {
    for (const l of g.features) out.push({ t: 'path', d: line(l), stroke: INK, w: 1.2 });
    for (const l of g.loops) out.push({ t: 'path', d: line(l, true), stroke: INK, w: 1.2 });
    const r = 2.4 * unit;
    for (const [x, y] of g.irises) {
      const px = x * W;
      const py = y * H;
      out.push({ t: 'path', d: `M${px - r} ${py}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, fill: INK });
    }
  }
  return out;
}

/**
 * Las formas: cada parte con su contorno anatómico, tapando a la de atrás. Las marcas
 * (esternón, rótula, crestas de la cadera) son lo que distingue un cuerpo de un maniquí.
 */
export function formPrims(m: Mannequin, v: View, solid: number, headStage = 5): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  const sorted = [...m.pieces].filter((p) => !p.joint).sort((a, b) => a.z - b.z);
  const zs = sorted.map((p) => p.z);
  const near = Math.max(...zs);
  const far = Math.min(...zs);
  const read = m.light ? Math.hypot(m.light.dir[0], m.light.dir[1]) : 0;
  const light: Pt = m.light && read > 0.2 ? [-m.light.dir[0] / read, -m.light.dir[1] / read] : LIGHT;
  for (const p of sorted) {
    if (p.id === 'cabeza' && m.head) {
      out.push(...headGuidePrims(m.head, headStage, v, true, solid));
      continue;
    }
    const shape = p.form ?? p.outline;
    const w = p.thin ? 0.9 : pieceWeight(p, near, far);
    out.push({ t: 'path', d: toPath(shape, true, W, H), fill: PAPER, stroke: INK, w, alpha: 1, fillAlpha: p.id === 'cuello' ? solid ** 3 : solid });
    if (!p.thin) {
      const shade = crescent(shape, W, H, spanOf(shape, W, H) * 0.26, light);
      if (shade) out.push({ t: 'path', d: shade, fill: INK, alpha: 0.08 * solid, even: true });
    }
    for (const r of p.formRings ?? []) out.push({ t: 'path', d: toPath(r, false, W, H), stroke: INK, w: 0.7, alpha: 0.4 });
    for (const c of p.caps) if (p.mass) out.push({ t: 'path', d: toPath(c, true, W, H), stroke: INK, w: 1, alpha: 0.8 });
    for (const l of p.marks ?? []) out.push({ t: 'path', d: toPath(l, false, W, H), stroke: INK, w: 1, alpha: 0.85 });
  }
  return out;
}

/** Lo ya construido, tenue: el dibujo nuevo crece encima de eso. */
export function ghostPrims(m: Mannequin, v: View, alpha: number): Prim[] {
  const { W, H } = v;
  return m.pieces.filter((p) => !p.joint && !p.thin).map((p): Prim => ({ t: 'path', d: toPath(p.form ?? p.outline, true, W, H), stroke: ROJO, w: 0.8, alpha }));
}

/** Un rasgo de cerca: lo anterior queda tenue y la etapa actual se ve fuerte. */
export function featurePrims(f: Pick<Feature, 'stages'>, stage: number, v: View): Prim[] {
  const { W, H, unit } = v;
  const out: Prim[] = [];
  const line = (p: Pt[], closed = false) => toPath(p, closed, W, H);
  f.stages.slice(0, stage).forEach((s, i) => {
    const now = i === stage - 1;
    const a = now ? 1 : 0.55;
    const w = now ? 1.6 : 1;
    for (const p of s.shade) out.push({ t: 'path', d: line(p.poly, true), fill: INK, alpha: p.alpha * (now ? 1 : 0.8) });
    for (const l of s.lines) out.push({ t: 'path', d: line(l), stroke: INK, w, alpha: a });
    for (const l of s.loops) out.push({ t: 'path', d: line(l, true), stroke: INK, w, alpha: a });
    for (const l of s.accent) out.push({ t: 'path', d: line(l), stroke: ROJO, w: now ? 1.4 : 0.9, alpha: now ? 1 : 0.6 });
    for (const l of s.light) out.push({ t: 'path', d: line(l, true), fill: PAPER, alpha: 0.7 });
    const r = 3.4 * unit;
    for (const [x, y] of s.dots) out.push({ t: 'path', d: `M${x * W - r} ${y * H}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, fill: now ? ROJO : INK, alpha: a });
  });
  return out;
}

const TO_LIGHT: V3 = [-0.5, -0.62, 0.6];

/** Valor de un plano según cuánto mira a la luz: tres tonos, como una pintura de planos. */
export function facetAlpha(n: V3, light: V3): number {
  const k = n[0] * light[0] + n[1] * light[1] + n[2] * light[2];
  return k > 0.5 ? 0 : k > 0.12 ? 0.16 : 0.38;
}

/** El color de la imagen dentro de un plano: su mediana, para que un borde no lo ensucie. */
export function polyColor(poly: Pt[], frame: { rgba: Uint8ClampedArray; w: number; h: number; mask?: Uint8Array }): [number, number, number] | null {
  if (poly.length < 3) return null;
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const list: number[][] = [];
  const stray: number[][] = [];
  for (const [x, y] of poly) {
    for (const t of [0, 0.35, 0.7]) {
      const px = Math.floor((cx + (x - cx) * t) * frame.w);
      const py = Math.floor((cy + (y - cy) * t) * frame.h);
      if (px < 0 || py < 0 || px >= frame.w || py >= frame.h) continue;
      const i = (py * frame.w + px) * 4;
      // Lo que cae en el fondo no cuenta: una punta de dedo no se pinta del color del coche.
      (frame.mask && !frame.mask[py * frame.w + px] ? stray : list).push([frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2]]);
    }
  }
  const use = list.length ? list : stray;
  if (!use.length) return null;
  const middle = (c: number) => use.map((q) => q[c]).sort((p, q) => p - q)[use.length >> 1];
  return [middle(0), middle(1), middle(2)];
}

/** Hacia dónde está la luz, en el espacio de la figura. */
export function lightOf(m: Mannequin): V3 {
  const size = m.light ? Math.hypot(m.light.dir[0], m.light.dir[1], m.light.dir[2]) : 0;
  return m.light && size > 0.2 ? [m.light.dir[0] / size, m.light.dir[1] / size, m.light.dir[2] / size] : TO_LIGHT;
}

/** Lo que se dibuja encima de la superficie: la cabeza con su método y las manos. */
export function topPrims(m: Mannequin, v: View, solid: number, headStage: number): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  for (const p of [...m.pieces].sort((a, b) => a.z - b.z)) {
    if (p.id.includes('palma') || p.thin) {
      out.push({ t: 'path', d: toPath(p.outline, true, W, H), fill: PAPER, stroke: INK, w: 0.9, alpha: 1, fillAlpha: solid });
    }
  }
  if (m.head) out.push(...headGuidePrims(m.head, headStage, v, true, solid));
  return out;
}

/** El maniquí reducido a planos: cada forma curva se talla en caras rectas. */
export function planePrims(m: Mannequin, v: View, solid: number, headStage = 6, frame?: { rgba: Uint8ClampedArray; w: number; h: number; mask?: Uint8Array } | null): Prim[] {
  const { W, H } = v;
  const light = lightOf(m);
  const out: Prim[] = [];
  for (const p of [...m.pieces].sort((a, b) => a.z - b.z)) {
    if (p.joint) continue;
    if (p.id === 'cabeza' && m.head) {
      out.push(...headGuidePrims(m.head, headStage, v, true, solid));
      continue;
    }
    // Los planos se tallan sobre la forma del paso anterior, no la reemplazan: su contorno
    // sigue siendo el mismo y encima se ve dónde gira la superficie.
    const shape = p.form ?? p.outline;
    out.push({ t: 'path', d: toPath(shape, true, W, H), fill: PAPER, fillAlpha: solid, alpha: 1 });
    // Pies y palmas siguen siendo forma: si se saltaran, las manos quedarían flotando.
    const list = [...(p.planes ?? [])].sort((a, b) => a.n[2] - b.n[2]);
    // Cada forma conserva su lado claro aunque toda quede de espaldas a la luz.
    const lightest = Math.min(...list.map((f) => facetAlpha(f.n, light)), 1);
    for (const f of list) {
      const d = toPath(f.poly, true, W, H);
      const a = facetAlpha(f.n, light) - lightest;
      const real = frame ? polyColor(f.poly, frame) : null;
      if (real) {
        const k = 1 - a * 1.1;
        out.push({ t: 'path', d, fill: `rgb(${Math.round(real[0] * k)},${Math.round(real[1] * k)},${Math.round(real[2] * k)})`, alpha: Math.max(0.6, solid) });
      } else if (a) out.push({ t: 'path', d, fill: INK, alpha: a * Math.max(0.35, solid) });
      out.push({ t: 'path', d, stroke: INK, w: p.thin ? 0.5 : 0.65, alpha: 0.5 });
    }
    out.push({ t: 'path', d: toPath(shape, true, W, H), stroke: INK, w: p.thin ? 0.8 : 1.3, alpha: 1 });
  }
  return out;
}

/**
 * Sombra propia: una media luna del lado contrario a la luz. Cada punto del contorno
 * entra hacia la forma según cuánto le da la espalda a la luz, y en el borde vale cero.
 */
function crescent(outline: Pt[], W: number, H: number, amount: number, light: Pt): string | null {
  const n = outline.length;
  if (n < 6) return null;
  const pts = outline.map(([x, y]): Pt => [x * W, y * H]);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    area += ax * by - bx * ay;
  }
  const sign = area >= 0 ? 1 : -1;
  const inner: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i - 1 + n) % n];
    const [bx, by] = pts[(i + 1) % n];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const nx = (sign * ey) / len;
    const ny = (-sign * ex) / len;
    const away = Math.max(0, nx * light[0] + ny * light[1]);
    inner.push([pts[i][0] - nx * amount * away, pts[i][1] - ny * amount * away]);
  }
  const f = (v: number) => v.toFixed(1);
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}ZM${inner.reverse().map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

function spanOf(outline: Pt[], W: number, H: number): number {
  const xs = outline.map((p) => p[0] * W);
  const ys = outline.map((p) => p[1] * H);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function pieceWeight(p: Piece, near: number, far: number): number {
  const t = near > far ? (p.z - far) / (near - far) : 0.5;
  return 1.1 + t * 1.1;
}

function solidPiece(p: Piece, near: number, far: number, v: View, color: string, solid: number, light: Pt): Prim[] {
  const { W, H } = v;
  const w = pieceWeight(p, near, far);
  if (p.thin) return [{ t: 'path', d: toPath(p.outline, true, W, H), fill: PAPER, stroke: color, w: 0.9, alpha: 1, fillAlpha: solid }];
  // El cuello entra en la cabeza: al transparentar no debe verse a través de la cara.
  const out: Prim[] = [{ t: 'path', d: toPath(p.outline, true, W, H), fill: PAPER, stroke: color, w, alpha: 1, fillAlpha: p.id === 'cuello' ? solid ** 3 : solid }];
  const shade = crescent(p.outline, W, H, spanOf(p.outline, W, H) * 0.3, light);
  if (shade) out.push({ t: 'path', d: shade, fill: INK, alpha: 0.09 * solid, even: true });
  for (const r of p.rings) out.push({ t: 'path', d: toPath(r, false, W, H), stroke: color, w: 0.85, alpha: 0.5 });
  for (const c of p.caps) out.push({ t: 'path', d: toPath(c, true, W, H), fill: PAPER, stroke: color, w: w * 0.8, alpha: 1, fillAlpha: solid });
  for (const a of p.axes) out.push({ t: 'path', d: toPath(a, false, W, H), stroke: ROJO, w: 1 });
  return out;
}

function flatPiece(p: Piece, v: View, color: string, solid: number): Prim[] {
  const { W, H } = v;
  if (p.mass) return [{ t: 'path', d: toPath(p.outline, true, W, H), fill: PAPER, stroke: color, w: 2, alpha: 1, fillAlpha: solid * 0.9 }];
  if (p.joint) return [];
  if (p.stick) return [{ t: 'path', d: toPath(p.stick, false, W, H), stroke: color, w: 2.2, cap: 'round' }];
  return [];
}

/** El maniquí, lo lejano primero: cada pieza tapa lo que tiene detrás. */
export function mannequinPrims(m: Mannequin, view: MannequinView, v: View, headStage = 5): Prim[] {
  const { W, H, unit } = v;
  const { upto, solid = 1 } = view;
  // La luz real de la imagen, si se leyó; si no, la de siempre.
  const read = m.light ? Math.hypot(m.light.dir[0], m.light.dir[1]) : 0;
  const light: Pt = m.light && read > 0.2 ? [-m.light.dir[0] / read, -m.light.dir[1] / read] : LIGHT;
  const shown = upto == null ? m.pieces : m.pieces.filter((p) => p.step <= upto);
  const sorted = [...shown].sort((a, b) => a.z - b.z);
  const zs = sorted.map((p) => p.z);
  const near = Math.max(...zs);
  const far = Math.min(...zs);
  const out: Prim[] = [];
  const headShown = shown.some((p) => p.id === 'cabeza');
  // En el paso 2 las masas van debajo y las líneas encima: es un esquema, no un sólido.
  const layers = view.level === 2 ? [...sorted].sort((a, b) => Number(!!b.mass) - Number(!!a.mass)) : sorted;
  for (const p of layers) {
    const color = upto != null && p.step === upto ? ROJO : INK;
    if (p.id === 'cabeza' && m.head) {
      const stage = upto == null ? headStage : upto >= 10 ? 5 : upto >= 2 ? 3 : 1;
      if (view.level === 3) out.push(...headGuidePrims(m.head, stage, v, true, solid));
      else out.push({ t: 'path', d: toPath(m.head.ball, true, W, H), fill: PAPER, stroke: color, w: 2, alpha: 1, fillAlpha: solid * 0.92 });
      continue;
    }
    out.push(...(view.level === 3 ? solidPiece(p, near, far, v, color, solid, light) : flatPiece(p, v, color, solid)));
  }
  if (view.level === 2) {
    const r = 3.2 * unit;
    for (const p of shown) {
      if (!p.joint) continue;
      const c = p.outline.reduce<Pt>((acc, q) => [acc[0] + q[0] / p.outline.length, acc[1] + q[1] / p.outline.length], [0, 0]);
      const x = c[0] * W;
      const y = c[1] * H;
      out.push({ t: 'path', d: `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, fill: PAPER, stroke: INK, w: 1.4 });
    }
  }
  if (upto == null || upto >= 4) {
    out.push({ t: 'path', d: toPath(m.spine, false, W, H), stroke: ROJO, w: view.level === 2 ? 1.8 : 1.4 });
    for (const [a, b] of m.tilts) out.push({ t: 'path', d: `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`, stroke: ROJO, w: 1.2, alpha: 0.8 });
  }
  if (headShown && m.head?.gaze && view.level === 3 && upto == null) {
    const [a, b] = m.head.gaze;
    const x0 = a[0] * W;
    const y0 = a[1] * H;
    const x1 = b[0] * W;
    const y1 = b[1] * H;
    const q = Math.atan2(y1 - y0, x1 - x0);
    const size = 9 * unit;
    const wing = (t: number) => `${x1 + size * Math.cos(q + t)} ${y1 + size * Math.sin(q + t)}`;
    out.push({ t: 'path', d: `M${x0} ${y0}L${x1} ${y1}`, stroke: ROJO, w: 1.1 });
    out.push({ t: 'path', d: `M${x1} ${y1}L${wing(2.65)}L${wing(-2.65)}Z`, fill: ROJO });
  }
  return out;
}
