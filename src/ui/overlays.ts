import { buildGrid, cellName, locate } from '../lib/canvas';
import { toPath } from '../lib/edges';
import { activeScheme, convexHull, readComposition, visualBalance, type Scheme } from '../lib/composition';
import { buildFigure, type Cylinder, type FigureInput, type FigureModel } from '../lib/figure';
import { softLine } from '../lib/edges';
import { fewSides } from '../lib/encaje';
import { catmullRom } from '../lib/gesture';
import { shapedPieces, shapeForm, type ShapeFit } from '../lib/shapes';
import { buildScene, snapEdges, type SceneMass, type SceneModel } from '../lib/scene';
import { brushPath, POSE } from '../lib/gesture';
import { GOLD_MAJOR, GOLD_MINOR, goldenSpiral, readGolden, type Focal, type GoldenReading, type SpiralTurn } from '../lib/golden';
import { loomis } from '../lib/loomis';
import { focusPeaks, type FocusPeak } from '../lib/saliency';
import { depthFlow, depthVanishing, groundOfSky, levelHorizon, withDepth, type Perspective, type VanishingPoint } from '../lib/perspective';
import { buildPlan, type Plan } from '../lib/plan';
import type { Figure, Pt, Rect, Stroke, Subject } from '../lib/types';
import { figureInFrame } from '../state/engine';
import type { Level, State } from '../state/store';
import { chestPrims, cylinderPrims, flatPrims, headPrims, solidPrims } from './volumes-draw';
import { featurePrims, formPrims, topPrims, ghostPrims, mannequinPrims, planePrims } from './mannequin-draw';
import { surfaceForms, surfacePlanes } from './surface-draw';
import { marksFrom68, marksFromDrawn, marksFromMesh, type FaceMarks } from '../lib/face';
import { gridCrossings, leadingLines, plumbLines, valueTurn } from '../lib/extras';
import type { HeadMethod } from '../lib/heads';
import { partsInFrame, readHead } from '../lib/parts';
import type { Cuboid, Direction } from '../lib/solid';
import { AMARILLO, DARK, LIGHT, ROJO } from './palette';
import { describeTurn } from '../lib/volumes';
import { curvedFan, curvedLine, lensMap, type Lens } from '../lib/lens';
import { HANDLES, SKELETON, type Rig } from '../lib/rig';
import { lightPrims } from './light-draw';
import { artistMannequinPrims, artistSkeletonPrims } from './artist-draw';
import { foldPrims } from './folds-draw';
import { organicPrims, principalLight } from './organic-draw';


import { t as tx } from '../i18n';
export type Prim =
  | { t: 'path'; d: string; stroke?: string; fill?: string; w?: number; dash?: number[]; alpha?: number; cap?: 'round'; draw?: boolean; key?: string; even?: boolean; fillAlpha?: number; clip?: boolean }
  | { t: 'text'; x: number; y: number; s: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; halo?: boolean; weight?: number };

export interface View {
  W: number;
  H: number;
  /** Unidades de la vista por píxel de pantalla. */
  unit: number;
}

/** Dónde cruza el contorno de las figuras los lados de un cuadro. */
export function focusCrossings(s: State, cell: Rect) {
  return gridCrossings(figureModels(s).list.flatMap((m) => m.outline), cell);
}

/** Una línea legible sobre cualquier fondo: tinta con halo claro. */
function cased(d: string, w: number, alpha: number, dash?: number[]): Prim[] {
  return [
    { t: 'path', d, stroke: LIGHT, w: w + 1, alpha: alpha * 0.55, dash },
    { t: 'path', d, stroke: DARK, w, alpha, dash },
  ];
}

export function toFrame(rect: Rect, image: { w: number; h: number }, [x, y]: Pt): Pt {
  return [(x * image.w - rect.x) / rect.w, (y * image.h - rect.y) / rect.h];
}

export function boxToFrame(rect: Rect, image: { w: number; h: number }, b: Rect): Rect {
  const [x0, y0] = toFrame(rect, image, [b.x, b.y]);
  const [x1, y1] = toFrame(rect, image, [b.x + b.w, b.y + b.h]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function visibleSubjects(s: Pick<State, 'subjects' | 'frame' | 'image'>): (Subject & { fbox: Rect })[] {
  const { frame, image } = s;
  if (!frame || !image) return [];
  return s.subjects
    .map((sub) => ({ ...sub, fbox: boxToFrame(frame.rect, image, sub.box) }))
    .filter(({ fbox: b }) => {
      const x = Math.max(0, Math.min(1, b.x + b.w) - Math.max(0, b.x));
      const y = Math.max(0, Math.min(1, b.y + b.h) - Math.max(0, b.y));
      return (x * y) / (b.w * b.h || 1) > 0.35;
    });
}

const QUIET_GRID = new Set<State['mode']>(['lectura', 'sujetos', 'composicion', 'perspectiva', 'luz', 'construccion', 'figuras', 'color']);

function gridPrims(s: State, v: View): Prim[] {
  const { W, H, unit } = v;
  const g = buildGrid(s.canvas, s.grid);
  const kx = W / s.canvas.w;
  const ky = H / s.canvas.h;
  const out: Prim[] = [];
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  // En los modos de análisis la cuadrícula cede el paso a lo que se está leyendo.
  const a = s.grid.opacity * (QUIET_GRID.has(s.mode) ? 0.4 : 1);
  let d = '';
  for (const x of g.xs.slice(1, -1)) d += `M${f(x * kx)} 0V${f(H)}`;
  for (const y of g.ys.slice(1, -1)) d += `M0 ${f(y * ky)}H${f(W)}`;
  let fine = '';
  if (s.grid.half) {
    for (let i = 0; i < g.cols; i++) fine += `M${f(((g.xs[i] + g.xs[i + 1]) / 2) * kx)} 0V${f(H)}`;
    for (let i = 0; i < g.rows; i++) fine += `M0 ${f(((g.ys[i] + g.ys[i + 1]) / 2) * ky)}H${f(W)}`;
  }
  if (s.grid.diagonals) {
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const x0 = g.xs[c] * kx;
        const x1 = g.xs[c + 1] * kx;
        const y0 = g.ys[r] * ky;
        const y1 = g.ys[r + 1] * ky;
        fine += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}M${f(x1)} ${f(y0)}L${f(x0)} ${f(y1)}`;
      }
    }
  }
  if (s.grid.rhombus) {
    const size = g.cell * kx;
    const count = Math.ceil((W + H) / size);
    for (let i = -count; i <= count; i++) {
      const c = i * size;
      fine += `M${f(c)} 0L${f(c + H)} ${f(H)}M${f(c)} 0L${f(c - H)} ${f(H)}`;
    }
  }
  if (fine) out.push(...cased(fine, 0.5, a * 0.55));
  if (d) out.push(...cased(d, 0.75, a));

  for (const name of s.done) {
    const m = /^([A-Z]+)(\d+)$/.exec(name);
    if (!m) continue;
    const col = m[1].split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]) - 1;
    if (col >= g.cols || row >= g.rows) continue;
    const x = g.xs[col] * kx;
    const y = g.ys[row] * ky;
    out.push({ t: 'path', d: `M${f(x)} ${f(y)}H${f(g.xs[col + 1] * kx)}V${f(g.ys[row + 1] * ky)}H${f(x)}Z`, fill: LIGHT, alpha: 0.62 });
  }

  if (s.grid.labels) {
    const size = 10 * unit;
    const gap = 7 * unit;
    const cellW = (g.cell * kx) / unit;
    const every = cellW < 15 ? 3 : cellW < 22 ? 2 : 1;
    for (let c = 0; c < g.cols; c += every) {
      out.push({ t: 'text', x: ((g.xs[c] + g.xs[c + 1]) / 2) * kx, y: -gap, s: cellName(c, 0).replace(/\d+$/, ''), size, fill: 'var(--ink-2)', anchor: 'middle' });
    }
    for (let r = 0; r < g.rows; r += every) {
      out.push({ t: 'text', x: -gap, y: ((g.ys[r] + g.ys[r + 1]) / 2) * ky + size * 0.36, s: String(r + 1), size, fill: 'var(--ink-2)', anchor: 'end' });
    }
  }
  if (s.focus && (s.mode === 'cuadros' || s.mode === 'pintar')) {
    const x0 = g.xs[s.focus.col] * kx;
    const x1 = g.xs[s.focus.col + 1] * kx;
    const y0 = g.ys[s.focus.row] * ky;
    const y1 = g.ys[s.focus.row + 1] * ky;
    out.push({ t: 'path', d: `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`, stroke: ROJO, w: 2 });
    for (const c of focusCrossings(s, { x: x0 / v.W, y: y0 / v.H, w: (x1 - x0) / v.W, h: (y1 - y0) / v.H })) {
      out.push({ t: 'path', d: ringPath(c.point[0] * v.W, c.point[1] * v.H, 3.4 * unit), fill: AMARILLO, stroke: DARK, w: 1 });
    }
  }
  return out;
}

function focalName(sub: Subject): string {
  switch (sub.kind) {
    case 'human-face':
    case 'anime-face':
      return tx('overlays.el_rostro');
    case 'head':
      return tx('overlays.la_cabeza');
    case 'animal-face':
      return tx('overlays.la_label', { label: sub.label.toLowerCase() });
    case 'person':
      return tx('overlays.la_persona');
    case 'anime-person':
      return tx('overlays.el_personaje');
    default:
      return sub.label.toLowerCase();
  }
}

let focusCache: { frame: State['frame']; value: FocusPeak[] } | null = null;

/** Lo que más atrae por valor, borde y color, calculado una vez por encuadre. */
function focusOf(frame: NonNullable<State['frame']>): FocusPeak[] {
  if (focusCache?.frame === frame) return focusCache.value;
  const value = focusPeaks(frame.rgba, frame.L, frame.w, frame.h);
  focusCache = { frame, value };
  return value;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function peakName(p: FocusPeak): string {
  if (p.because === 'borde') return tx('overlays.el_borde_mas_nitido');
  if (p.because === 'color') return tx('overlays.la_mancha_mas_saturada');
  return p.lighter ? tx('overlays.la_zona_clara_de') : tx('overlays.la_zona_oscura_de');
}

/**
 * El foco es lo que más atrae: el mayor salto de valor, el borde más nítido y el color más
 * saturado compiten con los rostros, y un rostro solo gana si tiene un tamaño que se vea.
 * Un rostro de 2 % del cuadro no manda aunque exista.
 */
export function focalsOf(s: Pick<State, 'subjects' | 'frame' | 'image'> & Partial<State>): Focal[] {
  const { frame, image } = s;
  if (!frame || !image) return [];
  const list = visibleSubjects(s);
  const out: Focal[] = [];
  for (const sub of list) {
    const b = sub.fbox;
    const size = Math.sqrt(Math.max(0, b.w * b.h));
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue;
    if (sub.kind === 'human-face' || sub.kind === 'anime-face' || sub.kind === 'animal-face' || sub.kind === 'head') {
      out.push({ x: cx, y: b.y + b.h * 0.42, weight: 0.25 + 0.9 * clamp01((size - 0.03) / 0.09), label: focalName(sub) });
    } else if (sub.kind === 'person' || sub.kind === 'anime-person' || sub.kind === 'animal') {
      const covered = list.some((o) => (o.kind.endsWith('face') || o.kind === 'head') && o.fbox.x >= b.x && o.fbox.y >= b.y && o.fbox.x + o.fbox.w <= b.x + b.w);
      if (covered) continue;
      // Sin rostro visible, la cabeza del esqueleto es mejor foco que el centro del cuerpo.
      const nose = sub.pose && sub.pose.vis[0] > 0.3 ? toFrame(frame.rect, image, sub.pose.pts[0]) : null;
      out.push({ x: nose?.[0] ?? cx, y: nose?.[1] ?? cy, weight: 0.3 + 0.5 * clamp01(size / 0.5), label: focalName(sub) });
    } else if (sub.kind === 'hand') {
      out.push({ x: cx, y: cy, weight: 0.2 + 0.9 * clamp01((size - 0.05) / 0.3), label: tx('overlays.la_mano') });
    }
  }
  // Hacia donde convergen las rectas el ojo es llevado: una fuga firme dentro del cuadro es foco.
  const lead = perspectiveOf(s as Parameters<typeof perspectiveOf>[0]).points.find((p) => (p.source === 'profundidad' || (p.source === 'lineas' && p.reach >= 1.5)) && p.point[0] > 0.05 && p.point[0] < 0.95 && p.point[1] > 0.05 && p.point[1] < 0.95);
  if (lead) out.push({ x: lead.point[0], y: lead.point[1], weight: 1.05, label: tx('overlays.el_punto_de_fuga') });
  // Lo que atrae sin ser un sujeto reconocido; si cae sobre uno, ese sujeto ya lo cubre.
  for (const p of focusOf(frame)) {
    if (out.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < 0.14)) continue;
    out.push({ x: p.x, y: p.y, weight: p.strength, label: peakName(p) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export function goldenReading(s: Pick<State, 'subjects' | 'frame' | 'image' | 'canvas'>): GoldenReading {
  return readGolden(focalsOf(s), s.canvas.w / s.canvas.h);
}

let compositionCache: { key: unknown[]; value: Scheme[] } | null = null;

/** Puntos de masa del sujeto: el recorte si existe, si no lo que más atrae la vista. */
function massOf(s: State): { mass: Pt[]; solid: boolean } {
  const { frame } = s;
  if (!frame) return { mass: [], solid: false };
  const w = 96;
  const h = Math.max(1, Math.round((w * frame.h) / frame.w));
  const mass: Pt[] = [];
  const main = s.figures.filter((f) => f.source === 'auto');
  if (main.length) {
    const union = new Uint8Array(w * h);
    for (const f of main) {
      const m = figureInFrame(f, frame.rect, w, h);
      for (let i = 0; i < m.length; i++) if (m[i]) union[i] = 1;
    }
    for (let i = 0; i < union.length; i++) if (union[i]) mass.push([((i % w) + 0.5) / w, (Math.floor(i / w) + 0.5) / h]);
    if (mass.length > 12) return { mass, solid: true };
    mass.length = 0;
  }
  const n = 64;
  for (let i = 0; i < n * n; i++) if (frame.attention[i] > 0.42) mass.push([((i % n) + 0.5) / n, (Math.floor(i / n) + 0.5) / n]);
  return { mass, solid: false };
}

export function compositionOf(s: State): Scheme[] {
  const key = [s.frame, s.subjects, s.figures, s.canvas.w, s.canvas.h, s.depth];
  if (compositionCache && compositionCache.key.every((k, i) => k === key[i])) return compositionCache.value;
  const { frame } = s;
  if (!frame) return [];
  const aspect = s.canvas.w / s.canvas.h;
  const main = figureModels(s).list[0];
  const { mass, solid } = massOf(s);
  // La fuga de la composición es la misma que lee Perspectiva: la más fuerte entre las de rectas
  // (o la del fondo), esté dentro del cuadro o fuera. Una calculada no es evidencia.
  const real = perspectiveOf(s).points.filter((p) => p.source === 'lineas' || p.source === 'profundidad');
  const lead = real.sort((a, b) => (b.source === 'profundidad' ? 2.5 : b.reach) - (a.source === 'profundidad' ? 2.5 : a.reach))[0];
  const inside = !!lead && lead.point[0] > -0.1 && lead.point[0] < 1.1 && lead.point[1] > -0.1 && lead.point[1] < 1.1;
  const far = (a: Pt, b: Pt, p: Pt) => (Math.hypot(a[0] - p[0], a[1] - p[1]) > Math.hypot(b[0] - p[0], b[1] - p[1]) ? a : b);
  const value = readComposition({
    aspect,
    focals: focalsOf(s),
    mass,
    solid,
    attention: frame.attention,
    attentionSize: 64,
    tiny: frame.tiny,
    tinySize: 48,
    lines: frame.lines,
    gesture: main?.gesture,
    curve: main?.action,
    vanishing: lead
      ? {
          point: lead.point,
          reach: lead.source === 'profundidad' ? 2.5 : lead.reach,
          inside,
          rays: lead.lines.slice(0, 8).map(([a, b]) => far(a, b, lead.point)),
          segments: lead.lines.slice(0, 8),
        }
      : null,
  });
  compositionCache = { key, value };
  return value;
}

function ringPath(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

function schemePrims(scheme: Scheme, v: View, portrait: boolean, turnOverride: SpiralTurn | null): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  const line = (a: Pt, b: Pt) => `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`;
  const strong = (d: string, key?: string): Prim[] => [
    { t: 'path', d, stroke: LIGHT, w: 3.5, alpha: 0.6, key: key ? `${key}b` : undefined },
    { t: 'path', d, stroke: ROJO, w: 1.75, draw: true, key },
  ];
  switch (scheme.id) {
    case 'tercios': {
      const d = [1 / 3, 2 / 3].map((t) => line([t, 0], [t, 1]) + line([0, t], [1, t])).join('');
      out.push(...strong(d, 'tercios'));
      break;
    }
    case 'aurea': {
      const d = [GOLD_MINOR, GOLD_MAJOR].map((t) => line([t, 0], [t, 1]) + line([0, t], [1, t])).join('');
      out.push(...strong(d, 'aurea'));
      break;
    }
    case 'espiral': {
      const turn = turnOverride ?? scheme.turn ?? 0;
      const { spiral, cuts } = goldenSpiral(turn, portrait);
      out.push(...cased(cuts.map(([a, b]) => line(a, b)).join(''), 0.5, 0.45));
      out.push(...strong(toPath(spiral, false, W, H), `espiral${turn}`));
      break;
    }
    case 'diagonal':
      if (scheme.axis) out.push(...strong(line(scheme.axis[0], scheme.axis[1]), 'diagonal'));
      break;
    case 'triangulo':
      if (scheme.triangle) out.push(...strong(toPath(scheme.triangle, true, W, H), 'triangulo'));
      break;
    case 'central': {
      out.push(...strong(line([0.5, 0], [0.5, 1]) + line([0, 0.5], [1, 0.5]), 'central'));
      break;
    }
    case 'simetria':
      out.push(...strong(line([0.5, 0], [0.5, 1]), 'simetria'));
      break;
    case 'curva':
      if (scheme.curve) out.push(...strong(toPath(scheme.curve, false, W, H), 'curva'));
      break;
    case 'radial':
      for (const [a, b] of scheme.segments ?? []) out.push(...strong(line(a, b)));
      if (scheme.point) {
        const [px, py] = scheme.point;
        for (const r of scheme.rays ?? []) out.push(...strong(line([px, py], r)));
        out.push({ t: 'path', d: ringPath(px * W, py * H, 12 * v.unit), stroke: ROJO, w: 2.5 });
      }
      break;
    case 'horizonte':
      if (scheme.level !== undefined) out.push(...strong(line([0, scheme.level], [1, scheme.level]), 'horizonte'));
      break;
    default:
      break;
  }
  return out;
}

function compositionPrims(s: State, v: View): Prim[] {
  const { W, H, unit } = v;
  const c = s.composition;
  const out: Prim[] = [];
  const reading = goldenReading(s);
  const portrait = H > W;
  const line = (a: Pt, b: Pt) => `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`;
  const active = activeScheme(compositionOf(s), s.scheme);
  if (c.diagonals) {
    const d = line([0, 0], [1, 1]) + line([1, 0], [0, 1]);
    const t = (W * W) / (W * W + H * H);
    const rec = line([1, 0], [t, t]) + line([0, 1], [1 - t, 1 - t]) + line([0, 0], [1 - t, t]) + line([1, 1], [t, 1 - t]);
    out.push(...cased(d + rec, 0.75, 0.75));
  }
  if (c.thirds) {
    const d = [1 / 3, 2 / 3].map((t) => line([t, 0], [t, 1]) + line([0, t], [1, t])).join('');
    out.push(...cased(d, 0.75, 0.75, [4, 4]));
  }
  if (c.golden) {
    const d = [GOLD_MINOR, GOLD_MAJOR].map((t) => line([t, 0], [t, 1]) + line([0, t], [1, t])).join('');
    out.push(...cased(d, 1, 0.9));
  }
  if (active) out.push(...schemePrims(active, v, portrait, c.turn));
  if (s.balance && s.frame) {
    const { center, contrast } = balanceOf(s.frame);
    const x = center[0] * W;
    const y = center[1] * H;
    const q = 14 * unit;
    out.push(...cased(`M${W / 2} ${H / 2}L${x} ${y}`, 1, 0.9));
    out.push({ t: 'path', d: `M${x - q} ${y}L${x} ${y - q}L${x + q} ${y}L${x} ${y + q}Z`, fill: ROJO, alpha: 0.95 });
    out.push({ t: 'path', d: ringPath(contrast[0] * W, contrast[1] * H, 10 * unit), stroke: LIGHT, w: 2.5 });
    out.push({ t: 'text', x: contrast[0] * W + 13 * unit, y: contrast[1] * H + 4 * unit, s: tx('overlays.mayor_contraste'), size: 11 * unit, fill: DARK, halo: true });
  }
  if (s.leadLines && s.frame && reading.focal) {
    for (const l of leadingLines(s.frame.lines, [reading.focal.x, reading.focal.y], W / H)) {
      out.push({ t: 'path', d: line(l.a, l.b), stroke: LIGHT, w: 3.2, alpha: 0.6 }, { t: 'path', d: line(l.a, l.b), stroke: AMARILLO, w: 1.8 });
      out.push({ t: 'path', d: line(l.b, [reading.focal.x, reading.focal.y]), stroke: AMARILLO, w: 1, alpha: 0.7, dash: [5, 5] });
    }
  }
  if (reading.focal) {
    const { x, y } = reading.focal;
    const fx = x * W;
    const fy = y * H;
    const r = 7 * unit;
    out.push({ t: 'path', d: ringPath(fx, fy, r), stroke: LIGHT, w: 3, alpha: 0.7 }, { t: 'path', d: ringPath(fx, fy, r), stroke: DARK, w: 1.25 });
    if (active?.target) {
      const tx = active.target[0] * W;
      const ty = active.target[1] * H;
      out.push(...cased(`M${fx} ${fy}L${tx} ${ty}`, 0.75, 0.9, [2, 3]));
      const q = 5 * unit;
      out.push({ t: 'path', d: `M${tx - q} ${ty}H${tx + q}M${tx} ${ty - q}V${ty + q}`, stroke: ROJO, w: 1.5 });
    }
  }
  return out;
}

let figureCache: { key: unknown[]; value: { list: FigureModel[]; flat: string[] } } | null = null;

/** Cercanía de un punto del encuadre, promediando alrededor. */
function depthSampler(s: Pick<State, 'depth' | 'frame' | 'image'>): ((p: Pt) => number) | undefined {
  const { depth, frame, image } = s;
  if (!depth || !frame || !image) return undefined;
  return ([x, y]) => {
    const ix = (frame.rect.x + x * frame.rect.w) / image.w;
    const iy = (frame.rect.y + y * frame.rect.h) / image.h;
    const px = Math.round(ix * depth.w);
    const py = Math.round(iy * depth.h);
    let sum = 0;
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= depth.w || qy >= depth.h) continue;
        sum += depth.data[qy * depth.w + qx];
        n++;
      }
    }
    return n ? sum / n : 0;
  };
}

/** Claridad de un punto del encuadre, 0 a 1. */
function lumaSampler(frame: NonNullable<State['frame']>): (p: Pt) => number {
  const { L, w, h } = frame;
  return ([x, y]) => {
    const px = Math.max(1, Math.min(w - 2, Math.round(x * w)));
    const py = Math.max(1, Math.min(h - 2, Math.round(y * h)));
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += L[(py + dy) * w + px + dx];
    return sum / 9 / 255;
  };
}

/** Las fugas de la escena como direcciones, para construir objetos en su perspectiva. */
function sceneOf(s: Pick<State, 'frame' | 'depth' | 'image' | 'lensRead'>, aspect: number): FigureInput['scene'] {
  const read = perspectiveOf(s);
  if (read.curve) return null;
  const toAspect = (p: Pt): Direction => ({ point: [p[0] * aspect, p[1]] });
  const flat = read.points.filter((p) => !p.vertical);
  const up = read.points.find((p) => p.vertical);
  if (!flat.length && !up) return null;
  const x = flat[0] ? toAspect(flat[0].point) : { along: [1, 0] as Pt };
  const y = flat[1] ? toAspect(flat[1].point) : { along: flat[0] ? ([1, 0] as Pt) : ([0.8, 0.6] as Pt) };
  const z = up ? toAspect(up.point) : { along: [0, 1] as Pt };
  return { x, y, z, horizon: read.horizon };
}

/** Una figura que no se puede leer se omite: nunca debe tirar toda la pantalla. */
function safely(build: () => FigureModel | null): FigureModel | null {
  try {
    return build();
  } catch (err) {
    console.error(tx('overlays.figura_sin_construir'), err);
    return null;
  }
}

/** Un modelo de construcción por figura: pose confiable o, si no, su silueta. */
export function figureModels(s: State): { list: FigureModel[]; flat: string[] } {
  const { frame, image } = s;
  const key = [frame, s.subjects, s.figures, s.depth, s.rigEdits, s.lensRead, s.bodyFaces];
  if (figureCache && figureCache.key.every((k, i) => k === key[i])) return figureCache.value;
  const list: FigureModel[] = [];
  const flat: string[] = [];
  if (!frame || !image) return { list, flat };
  const aspect = s.canvas.w / s.canvas.h;
  const w = 360;
  const h = Math.max(1, Math.round(w / aspect));
  const visible = visibleSubjects(s);
  const headOf = (fig: Figure): Pt | null => {
    const own = visible.find((v) => v.id === fig.id);
    if (own?.pose && own.pose.vis[POSE.nose] > 0.3) return toFrame(frame.rect, image, own.pose.pts[POSE.nose]);
    const box = boxToFrame(frame.rect, image, fig.box);
    const face = visible
      .filter((v) => v.kind.endsWith('face') || v.kind === 'head')
      .map((v) => ({ x: v.fbox.x + v.fbox.w / 2, y: v.fbox.y + v.fbox.h / 2 }))
      .filter((c) => c.x >= box.x && c.x <= box.x + box.w && c.y >= box.y && c.y <= box.y + box.h)
      .sort((a, b) => a.y - b.y)[0];
    return face ? [face.x, face.y] : null;
  };
  const depth = depthSampler(s);
  // Con un paraguas en la mano la caja de una figura alcanza a otras personas: su cara es la que
  // está junto a su nariz, no la primera que caiga adentro.
  const closestFace = <T extends { fbox: Rect }>(list: T[], own?: Subject): T | undefined => {
    const nose = own?.pose && own.pose.vis[POSE.nose] > 0.3 ? toFrame(frame.rect, image, own.pose.pts[POSE.nose]) : null;
    if (!nose) return list[0];
    const away = (v: T) => Math.hypot(v.fbox.x + v.fbox.w / 2 - nose[0], v.fbox.y + v.fbox.h / 2 - nose[1]);
    return [...list].sort((a, b) => away(a) - away(b))[0];
  };
  const turnOf = (box: Rect, own?: Subject): Subject['turn'] | null => {
    const faces = visible.filter((v) => v.turn && (v.kind.endsWith('face') || v.kind === 'head')).filter((v) => {
      const cx = v.fbox.x + v.fbox.w / 2;
      const cy = v.fbox.y + v.fbox.h / 2;
      return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
    });
    return closestFace(faces, own)?.turn ?? null;
  };
  const toFramePose = (sub: Subject) =>
    sub.pose ? { pts: sub.pose.pts.map((p) => toFrame(frame.rect, image, p)), vis: sub.pose.vis } : undefined;
  const toFrameBody = (sub?: Subject) => {
    if (!sub?.body) return null;
    const { body } = sub;
    const screen = new Float32Array(body.screen.length);
    for (let i = 0; i < screen.length; i += 2) {
      const [x, y] = toFrame(frame.rect, image, [body.screen[i], body.screen[i + 1]]);
      screen[i] = x;
      screen[i + 1] = y;
    }
    return { body, screen };
  };
  const frameBox = (b: Rect) => boxToFrame(frame.rect, image, b);
  const center = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
  const within = (p: Pt, b: Rect) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
  const framePts = (pts: Pt[]) => pts.map((p) => toFrame(frame.rect, image, p));
  const marksFor = (own: Subject | undefined, box: Rect): FaceMarks | null => {
    const face = own?.kind.endsWith('face') ? own : closestFace(visible.filter((v) => v.kind.endsWith('face') && within(center(v.fbox), box)), own);
    const pose = own?.pose;
    const p68 = pose ? { pts: framePts(pose.pts.slice(POSE.face, POSE.face + 68)), vis: pose.vis.slice(POSE.face, POSE.face + 68) } : null;
    if (face?.face) return marksFromMesh(framePts(face.face));
    // Si la pose está segura de la cara, sus 68 puntos valen más que un detector de anime.
    if (p68 && p68.vis.reduce((a, b) => a + b, 0) / 68 >= 0.8) return marksFrom68(p68.pts, p68.vis);
    if (face?.drawn) {
      const { eyes, marks } = face.drawn;
      return marksFromDrawn({ eyes: eyes.map(frameBox), marks: marks && { pts: framePts(marks.pts), vis: marks.vis } }, p68, aspect);
    }
    if (p68 && p68.vis.reduce((a, b) => a + b, 0) / 68 >= 0.55) return marksFrom68(p68.pts, p68.vis);
    return null;
  };
  const readHeadInFrame = (sub?: Subject) => {
    const read = sub?.headParts ? readHead(sub.headParts) : null;
    if (!read) return null;
    const c = toFrame(frame.rect, image, read.c);
    return {
      ...read,
      c,
      rx: (read.rx * image.w) / frame.rect.w,
      ry: (read.ry * image.h) / frame.rect.h,
      outline: read.outline ? framePts(read.outline) : null,
      lenses: read.lenses.map(framePts),
    };
  };
  const handsIn = (box: Rect) => visible.filter((v) => v.kind === 'hand' && v.hand && within(center(v.fbox), box)).map((v) => ({ ...v.hand!, pts: framePts(v.hand!.pts) }));
  const luma = lumaSampler(frame);
  const scene = sceneOf(s, aspect);
  const used = new Set<string>();
  for (const fig of s.figures) {
    const sub = visible.find((v) => v.id === fig.id);
    used.add(fig.id);
    const mask = figureInFrame(fig, frame.rect, w, h);
    const box = boxToFrame(frame.rect, image, fig.box);
    const model = safely(() => buildFigure({
      id: fig.id,
      label: fig.label.replace(/ \d+$/, ''),
      pose: sub && toFramePose(sub),
      mask: { data: mask, w, h },
      aspect,
      head: headOf(fig),
      depth,
      turn: turnOf(box, sub),
      kind: sub?.kind,
      body: toFrameBody(sub),
      edit: s.rigEdits[fig.id],
      marks: marksFor(sub, box),
      hands: handsIn(box),
      hand: sub?.hand ? { ...sub.hand, pts: framePts(sub.hand.pts) } : undefined,
      animal: sub?.animal ? { ...sub.animal, pts: framePts(sub.animal.pts) } : undefined,
      luma,
      scene,
      parts: sub?.parts ? partsInFrame(sub.parts, frame.rect, image, w, h) : undefined,
      headRead: readHeadInFrame(sub),
      faces: s.bodyFaces,
    }));
    if (model) list.push({ ...model, label: fig.label });
  }
  // Mientras se recortan las figuras, la pose ya da una primera lectura.
  for (const sub of visible) {
    if (used.has(sub.id) || !sub.pose) continue;
    const model = safely(() => buildFigure({ id: sub.id, label: sub.label, pose: toFramePose(sub), aspect, depth, turn: turnOf(sub.fbox), kind: sub.kind, body: toFrameBody(sub), edit: s.rigEdits[sub.id], marks: marksFor(sub, sub.fbox), hands: handsIn(sub.fbox), luma }));
    if (model) list.push(model);
  }
  const value = { list, flat };
  if (s.figuresReady) figureCache = { key, value };
  return value;
}

function arrowLabel(model: FigureModel, v: View): Prim[] {
  const { W, H, unit } = v;
  const pts = model.action;
  if (pts.length < 6) return [];
  const m = pts[Math.floor(pts.length * 0.55)];
  const n = pts[Math.floor(pts.length * 0.62)];
  const mx = m[0] * W;
  const my = m[1] * H;
  const dx = (n[0] - m[0]) * W;
  const dy = (n[1] - m[1]) * H;
  const len = Math.hypot(dx, dy) || 1;
  // La flecha nace hacia el lado con más espacio.
  const sides = [1, -1].map((side) => {
    const nx = (-dy / len) * side;
    const ny = (dx / len) * side;
    return { nx, ny, room: Math.min(nx > 0 ? W - mx : nx < 0 ? mx : 1e9, ny > 0 ? H - my : ny < 0 ? my : 1e9) };
  });
  const { nx, ny } = sides[0].room >= sides[1].room ? sides[0] : sides[1];
  const reach = Math.min(Math.hypot(W, H) * 0.14, 170 * unit);
  const ex = Math.min(W - 70 * unit, Math.max(70 * unit, mx + nx * reach));
  const ey = Math.min(H - 16 * unit, Math.max(22 * unit, my + ny * reach));
  const tipX = mx + nx * 9 * unit;
  const tipY = my + ny * 9 * unit;
  const cx = (ex + tipX) / 2 + (ny * reach) / 5;
  const cy = (ey + tipY) / 2 - (nx * reach) / 5;
  const ang = Math.atan2(tipY - cy, tipX - cx);
  const head = 11 * unit;
  const a1 = ang + 2.6;
  const a2 = ang - 2.6;
  const headD = `M${tipX} ${tipY}L${tipX + head * Math.cos(a1)} ${tipY + head * Math.sin(a1)}L${tipX + head * Math.cos(a2)} ${tipY + head * Math.sin(a2)}Z`;
  return [
    { t: 'path', d: `M${ex} ${ey}Q${cx} ${cy} ${tipX} ${tipY}`, stroke: LIGHT, w: 4, alpha: 0.7 },
    { t: 'path', d: `M${ex} ${ey}Q${cx} ${cy} ${tipX} ${tipY}`, stroke: ROJO, w: 2 },
    { t: 'path', d: headD, fill: ROJO },
    { t: 'text', x: ex, y: ey + (ey > tipY ? 15 : -7) * unit, s: tx('overlays.linea_de_accion'), size: 14 * unit, fill: ROJO, anchor: 'middle', halo: true, weight: 500 },
  ];
}

/** El esqueleto y sus puntos de agarre, como en un programa de animación. */
function rigPrims(rig: Rig, v: View): Prim[] {
  const { W, H, unit } = v;
  const aspect = W / H;
  const at = (i: number): Pt => [(rig.pts[i][0] / aspect) * W, rig.pts[i][1] * H];
  const out: Prim[] = [];
  let d = '';
  for (const [a, b] of SKELETON) {
    if (!rig.seen[a] || !rig.seen[b]) continue;
    const [ax, ay] = at(a);
    const [bx, by] = at(b);
    d += `M${ax} ${ay}L${bx} ${by}`;
  }
  out.push({ t: 'path', d, stroke: LIGHT, w: 4, alpha: 0.6 }, { t: 'path', d, stroke: ROJO, w: 2 });
  for (const h of HANDLES) {
    if (!rig.seen[h.id]) continue;
    const [x, y] = at(h.id);
    out.push({ t: 'path', d: ringPath(x, y, 7 * unit), fill: AMARILLO, stroke: DARK, w: 1.4 });
  }
  return out;
}

/** Punta de flecha al final de un trazo. */
function arrowHead(a: Pt, b: Pt, v: View, color: string): Prim {
  const { W, H, unit } = v;
  const x = b[0] * W;
  const y = b[1] * H;
  const q = Math.atan2(y - a[1] * H, x - a[0] * W);
  const size = 8 * unit;
  const wing = (t: number) => `${x + size * Math.cos(q + t)} ${y + size * Math.sin(q + t)}`;
  return { t: 'path', d: `M${x} ${y}L${wing(2.6)}L${wing(-2.6)}Z`, fill: color };
}

/** Los huesos solos, con sus articulaciones y la regla de cabezas si es un cuerpo entero. */
function skeletonPrims(model: FigureModel, v: View): Prim[] {
  const { W, H, unit } = v;
  const diag = Math.hypot(W, H);
  const out: Prim[] = [];
  const d = model.sticks.map(([a, b]) => `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`).join('');
  if (d) out.push({ t: 'path', d, stroke: LIGHT, w: 4, alpha: 0.6 }, { t: 'path', d, stroke: ROJO, w: 2, cap: 'round' });
  for (const [a, b] of model.arrows) out.push(arrowHead(a, b, v, ROJO));
  const r = Math.max(2.6 * unit, diag * 0.0034);
  const seen = new Set<string>();
  for (const j of model.joints) {
    const key = `${Math.round(j[0] * 300)},${Math.round(j[1] * 300)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t: 'path', d: ringPath(j[0] * W, j[1] * H, r), fill: AMARILLO, stroke: DARK, w: 1.1 });
  }
  // La cabeza es una sola: la misma del paso siguiente, o cambiaría de tamaño entre niveles.
  const ball = model.mannequin?.head?.ball ?? model.mannequin?.pieces.find((p) => p.id === 'cabeza')?.outline;
  if (ball) out.push({ t: 'path', d: toPath(ball, true, W, H), stroke: ROJO, w: 1.8 });
  else if (model.head && model.head.r > 0) out.push({ t: 'path', d: ringPath(model.head.c[0] * W, model.head.c[1] * H, model.head.r * H), stroke: ROJO, w: 1.8 });
  out.push(...rulerPrims(model, v));
  return out;
}

/** Regla de cabezas junto a la figura. */
function rulerPrims(model: FigureModel, v: View): Prim[] {
  const { W, H, unit } = v;
  const out: Prim[] = [];
  if (model.ruler) {
    const { from, to, count } = model.ruler;
    const xs = model.joints.map((p) => p[0]);
    const x = Math.max(0.03, Math.min(...xs) - 0.05) * W;
    const y0 = from[1] * H;
    const y1 = to[1] * H;
    const step = (y1 - y0) / count;
    out.push({ t: 'path', d: `M${x} ${y0}V${y1}`, stroke: DARK, w: 1.2 });
    for (let i = 0; i <= count; i++) {
      out.push({ t: 'path', d: `M${x - 5 * unit} ${y0 + i * step}H${x + 5 * unit}`, stroke: DARK, w: 1.2 });
      if (i < count) out.push({ t: 'text', x: x - 8 * unit, y: y0 + (i + 0.5) * step + 4 * unit, s: String(i + 1), size: 11 * unit, fill: DARK, anchor: 'end', halo: true });
    }
  }
  return out;
}

/** Caja en perspectiva: 3 solo su silueta, 4 con aristas, 5 con planos y mitades. */
function cuboidPrims(c: Cuboid, level: 3 | 4 | 5, v: View, solid: number): Prim[] {
  const { W, H } = v;
  const aspect = W / H;
  const at = ([x, y]: Pt): Pt => [(x / aspect) * W, y * H];
  const path = (poly: Pt[], closed: boolean) => `M${poly.map((p) => at(p).map((n) => n.toFixed(1)).join(' ')).join('L')}${closed ? 'Z' : ''}`;
  const out: Prim[] = [];
  const edges = (list: [Pt, Pt][]) => list.map(([a, b]) => path([a, b], false)).join('');
  if (level === 5) {
    // La cara de arriba recibe la luz; las de los lados, cada una su valor.
    const tones = { z: 0, x: 0.14, y: 0.34 } as const;
    for (const f of c.faces) {
      const d = path(f.poly, true);
      out.push({ t: 'path', d, fill: 'var(--paper)', stroke: 'var(--ink)', w: 1.6, alpha: 1, fillAlpha: solid });
      if (tones[f.edge]) out.push({ t: 'path', d, fill: 'var(--ink)', alpha: tones[f.edge] * Math.max(0.4, solid) });
    }
    out.push({ t: 'path', d: edges(c.centers), stroke: ROJO, w: 1 });
    return out;
  }
  out.push({ t: 'path', d: path(c.silhouette, true), fill: 'var(--paper)', stroke: 'var(--ink)', w: 2, alpha: 1, fillAlpha: solid * 0.7 });
  if (level === 4) {
    out.push({ t: 'path', d: edges(c.hidden), stroke: 'var(--ink)', w: 1, alpha: 0.5, dash: [5, 5] });
    out.push({ t: 'path', d: edges(c.edges), stroke: 'var(--ink)', w: 1.8 });
  }
  return out;
}

/** Sin esqueleto ni sólido: la silueta tallada en planos, cada uno con su valor. */
function shapeFacets(model: FigureModel, v: View, s: State): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  for (const loop of model.angular) out.push({ t: 'path', d: toPath(loop, true, W, H), fill: 'var(--paper)', stroke: 'var(--ink)', w: 1.8, alpha: 1, fillAlpha: 1 - s.encajePhoto * 0.92 });
  for (const c of model.circles) {
    const [x, y] = [c.c[0] * W, c.c[1] * H];
    const r = c.r * H;
    out.push({ t: 'path', d: `M${x - r} ${y}L${x} ${y - r}L${x + r} ${y}L${x} ${y + r}Z`, stroke: 'var(--ink)', w: 1, alpha: 0.7 });
  }
  return out;
}

/** Método del frijol: el tronco es una sola forma que se dobla, y los miembros, salchichas. */
function beanPrims(model: FigureModel, v: View, solid: number): Prim[] {
  const m = model.mannequin!;
  const { W, H } = v;
  const out: Prim[] = [];
  const rib = m.pieces.find((p) => p.id === 'torax');
  const pel = m.pieces.find((p) => p.id === 'pelvis');
  const sorted = [...m.pieces].filter((p) => !p.joint && p.id !== 'torax' && p.id !== 'pelvis' && p.id !== 'abdomen').sort((a, b) => a.z - b.z);
  const stroke = 'var(--ink)';
  const bean = rib && pel ? convexHull([...rib.outline, ...pel.outline].map(([x, y]): Pt => [x * W, y * H])) : null;
  if (bean) out.push({ t: 'path', d: `M${bean.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join('L')}Z`, fill: 'var(--paper)', stroke, w: 2, alpha: 1, fillAlpha: solid });
  for (const p of sorted) {
    if (p.id === 'cabeza' && m.head) {
      out.push(...headLoop(m.head.ball, v, solid));
      continue;
    }
    out.push({ t: 'path', d: toPath(p.outline, true, W, H), fill: 'var(--paper)', stroke, w: p.thin ? 0.9 : 1.6, alpha: 1, fillAlpha: solid });
  }
  if (bean && m.spine.length) out.push({ t: 'path', d: toPath(m.spine, false, W, H), stroke: ROJO, w: 1.5 });
  return out;
}

function headLoop(ball: Pt[], v: View, solid: number): Prim[] {
  return [{ t: 'path', d: toPath(ball, true, v.W, v.H), fill: 'var(--paper)', stroke: 'var(--ink)', w: 2, alpha: 1, fillAlpha: solid }];
}

/** El método de cabeza elegido, o el que mejor le queda a esta cara. */
export function chosenMethod(model: FigureModel, s: Pick<State, 'headMethod'>): HeadMethod | null {
  const head = model.mannequin?.head;
  if (!head?.methods.length) return null;
  const auto = head.source === 'dibujo' ? 'anime' : 'loomis';
  return head.methods.find((m) => m.id === s.headMethod) ?? head.methods.find((m) => m.id === auto) ?? head.methods[0];
}

/** Las figuras que se construyen: la elegida, o las que importan por tamaño. */
export function mainFigures(list: FigureModel[], s: Pick<State, 'figures' | 'figurePick'>): FigureModel[] {
  if (s.figurePick) {
    const one = list.filter((m) => m.id === s.figurePick);
    if (one.length) return one;
  }
  const area = (m: FigureModel) => {
    const f = s.figures.find((q) => q.id === m.id);
    return f ? f.box.w * f.box.h : 0.1;
  };
  // Junto a una persona, un paraguas o una mesa no son la figura: serían un cilindro enorme.
  const people = list.filter((m) => m.surface);
  const pool = people.length ? list.filter((m) => m.surface || m.framing === 'mano' || m.framing === 'pie') : list;
  const big = Math.max(0, ...pool.map(area));
  // Una mano es chica por naturaleza: se mide con otra vara que un cuerpo.
  return pool.filter((m) => area(m) >= big * (m.framing === 'mano' || m.framing === 'pie' ? 0.03 : 0.16)).slice(0, 4);
}

/** No hay una figura que mande: lo que se construye es el lugar. */
export function isScene(s: State): boolean {
  const list = mainFigures(figureModels(s).list, s);
  if (!list.length) return true;
  const largest = Math.max(0, ...list.map((m) => {
    const f = s.figures.find((q) => q.id === m.id);
    return f ? f.box.w * f.box.h : 0;
  }));
  return largest < 0.13;
}

/** Las líneas más largas, sin las que miden menos de `min` de la diagonal. */
function longest(strokes: Stroke[], count: number, min: number): Stroke[] {
  const len = (st: Stroke) => st.pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - st.pts[i - 1][0], p[1] - st.pts[i - 1][1]) : 0), 0);
  return strokes
    .map((st) => ({ st, n: len(st) }))
    .filter((o) => o.n >= min)
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((o) => o.st);
}

/** La silueta de las figuras que se construyen, a la resolución del encuadre. */
const maskCache = new WeakMap<object, { key: string; mask: Uint8Array }>();
function leadMask(s: State): Uint8Array | null {
  const frame = s.frame;
  if (!frame) return null;
  const figs = mainFigures(figureModels(s).list, s);
  const key = figs.map((m) => m.id).join();
  const held = maskCache.get(frame);
  if (held && held.key === key) return held.mask;
  const mask = new Uint8Array(frame.w * frame.h);
  for (const m of figs) {
    const f = s.figures.find((q) => q.id === m.id);
    if (!f) continue;
    const q = figureInFrame(f, frame.rect, frame.w, frame.h);
    for (let i = 0; i < q.length; i++) if (q[i]) mask[i] = 1;
  }
  maskCache.set(frame, { key, mask });
  return mask;
}

/**
 * Líneas de adentro del paso 8: las que están dentro de la figura (no las del fondo ni las que
 * la cruzan por fuera), las más largas primero y sin trazos sueltos de unos pocos píxeles.
 */
function interiorLines(strokes: Stroke[], mask: Uint8Array | null, frame: State['frame']): Stroke[] {
  const lines = strokes.filter((st) => st.stage === 4 && st.name !== 'Valor');
  if (!mask || !frame) return longest(lines, 40, 0.03);
  const { w, h } = frame;
  const near = (x: number, y: number) => {
    const cx = Math.round(x * w);
    const cy = Math.round(y * h);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && py >= 0 && px < w && py < h && mask[py * w + px]) return true;
    }
    return false;
  };
  const kept = lines.filter((st) => st.pts.every((p) => near(p[0], p[1])));
  return longest(kept, 40, 0.03);
}

let sceneCache: { frame: object; model: SceneModel } | null = null;

function sceneOfFrame(s: State): SceneModel | null {
  if (!s.frame) return null;
  if (sceneCache?.frame !== s.frame) sceneCache = { frame: s.frame, model: buildScene(s.frame.rgba, s.frame.w, s.frame.h) };
  return sceneCache.model;
}

const rgbOf = (c: [number, number, number]) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/**
 * Los mismos diez pasos en un lugar: primero la dirección y la estructura, después las masas
 * grandes, y al final color y detalle. Cada paso se apoya en el anterior.
 */
function scenePrims(s: State, v: View): Prim[] {
  const { W, H } = v;
  const level = s.construction;
  const scene = sceneOfFrame(s);
  const out: Prim[] = [];
  if (!scene || !s.frame) return out;
  const read = perspectiveOf(s);
  // En un lugar construido las orillas corren hacia sus fugas: se enderezan hacia ellas.
  const fugas = read.curve ? [] : read.points.map((p) => p.point);
  const aspect = W / H;
  const built = fugas.length >= 2;
  const trued = (poly: Pt[]) => snapEdges(poly, fugas, aspect);
  const main = scene.masses.filter((m) => m.area > 0.012);
  const diag = Math.hypot(W, H);
  // Al subir la foto se calca encima: las masas dejan de tapar.
  const solid = 1 - s.encajePhoto * 0.92;
  if (level === 1) {
    // La dirección del cuadro: las rectas que más mandan, o hacia dónde corre la profundidad.
    const lead = read.points.find((p) => !p.vertical && p.point[0] > -0.2 && p.point[0] < 1.2 && p.point[1] > -0.2 && p.point[1] < 1.2);
    const long = (a: [Pt, Pt], b: [Pt, Pt]) => Math.hypot(b[0][0] - b[1][0], b[0][1] - b[1][1]) - Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
    // Una fuga sin rectas, como un camino, se dibuja como lo que es: dos líneas que se juntan.
    const toLead = (p: Pt): [Pt, Pt][] => [[[Math.max(0, p[0] - 0.42), 1], p], [[Math.min(1, p[0] + 0.42), 1], p]];
    const lines = lead ? (lead.lines.length ? [...lead.lines].sort(long).slice(0, 3) : toLead(lead.point)) : s.frame.lines.slice(0, 3).map((l): [Pt, Pt] => [l.a, l.b]);
    for (const [a, b] of lines) {
      // Lo que importa es hacia dónde lleva: llega a su fuga, o se prolonga si no hay ninguna.
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const n = Math.hypot(dx, dy) || 1;
      const far = lead && Math.hypot(a[0] - lead.point[0], a[1] - lead.point[1]) < Math.hypot(b[0] - lead.point[0], b[1] - lead.point[1]) ? b : a;
      const start: Pt = lead ? far : [a[0] - (dx / n) * 0.34, a[1] - (dy / n) * 0.34];
      const to: Pt = lead ? lead.point : [b[0] + (dx / n) * 0.34, b[1] + (dy / n) * 0.34];
      out.push({ t: 'path', d: brushPath([[start[0] * W, start[1] * H], [(start[0] + to[0]) * W * 0.5, (start[1] + to[1]) * H * 0.5], [to[0] * W, to[1] * H]], diag * 0.012), fill: ROJO, alpha: 0.9, clip: true } as Prim);
    }
    if (read.horizon !== null) out.push({ t: 'path', d: `M0 ${read.horizon * H}H${W}`, stroke: ROJO, w: 1.6, alpha: 0.9, clip: true });
    return out;
  }
  if (level === 2) return perspectivePrims({ ...s, pv: { ...s.pv, lines: false, fan: true, horizon: true } }, v);
  // Debajo de los polígonos va la forma real: así no quedan rendijas de papel entre masas.
  const under = (tone: (m: SceneMass) => string) => (solid < 1 ? [] : scene.masses.map((m): Prim => ({ t: 'path', d: toPath(m.loop, true, W, H), fill: tone(m), alpha: 1, clip: true })));
  const gray = (m: SceneMass) => {
    const tone = Math.round(m.value * 255);
    return `rgb(${tone},${tone},${tone})`;
  };
  const lines = s.formStrokes.filter((st) => st.stage >= 3 && st.name !== 'Valor');
  // Un dibujo a línea no tiene masas de valor: se construye con sus propias líneas, de las
  // más largas a las más cortas, sobre la estructura del espacio.
  if (scene.line && level >= 3 && level <= 8) {
    const share = [0, 0, 0, 0.02, 0.06, 0.16, 0.36, 0.68, 1][level];
    const room = perspectivePrims({ ...s, pv: { ...s.pv, lines: false, fan: true, horizon: true } }, v).map((p) => (p.t === 'path' ? { ...p, alpha: (p.alpha ?? 1) * (level === 3 ? 1 : 0.35) } : p));
    const sorted = [...lines].sort((a, b) => b.pts.length - a.pts.length);
    const shown = sorted.slice(0, Math.ceil(sorted.length * share));
    return [...room, ...shown.map((st): Prim => ({ t: 'path', d: toPath(softLine(st.pts, st.closed), st.closed, W, H), stroke: 'var(--ink)', w: 1.1, alpha: 0.95, cap: 'round', clip: true }))];
  }
  if (level === 3) {
    for (const m of main.slice(0, 10)) out.push({ t: 'path', d: toPath(trued(m.block), true, W, H), stroke: 'var(--ink)', w: 1.3, alpha: 0.9, clip: true });
    return out;
  }
  if (level === 4) {
    out.push(...under(gray));
    for (const m of scene.masses) out.push({ t: 'path', d: toPath(trued(m.poly), true, W, H), fill: gray(m), fillAlpha: solid, stroke: 'var(--ink)', w: 1, alpha: 1, clip: true });
    return out;
  }
  if (level === 5) {
    if (built) out.push(...under(gray));
    for (const m of scene.masses) {
      const tone = Math.round(m.value * 255);
      out.push({ t: 'path', d: toPath(built ? trued(m.fine) : softLine(m.loop, true), true, W, H), fill: `rgb(${tone},${tone},${tone})`, fillAlpha: solid, stroke: 'var(--ink)', w: 0.9, alpha: 1, clip: true });
    }
    return out;
  }
  if (level === 6) {
    out.push(...under((m) => rgbOf(m.color)));
    for (const m of scene.masses) out.push({ t: 'path', d: toPath(trued(m.poly), true, W, H), fill: rgbOf(m.color), fillAlpha: solid, stroke: 'var(--ink)', w: 0.5, alpha: 1, clip: true });
    return out;
  }
  if (level === 7) {
    // El encaje de un lugar son sus masas: primero las grandes, en rojo, y luego las demás.
    // Con pocos lados: más de diez en una masa ya no es un encaje.
    main.slice(0, 12).forEach((m, i) => {
      const d = toPath(fewSides(trued(m.block.length > 4 ? m.block : m.poly), 10), true, W, H);
      out.push({ t: 'path', d, stroke: LIGHT, w: (i < 3 ? 1.6 : 1) + 2, alpha: 0.35, cap: 'round', clip: true });
      out.push({ t: 'path', d, stroke: i < 3 ? ROJO : 'var(--ink)', w: i < 3 ? 1.6 : 1, alpha: 0.95, cap: 'round', clip: true });
    });
    return out;
  }
  if (level === 8) {
    // Solo las masas grandes y las líneas más largas: cada hoja o ventana es ruido, no contorno.
    for (const m of main) out.push({ t: 'path', d: toPath(softLine(m.loop, true), true, W, H), stroke: 'var(--ink)', w: 1.2, alpha: 0.9, cap: 'round', clip: true });
    longest(lines, 36, 0.045).forEach((st) => out.push({ t: 'path', d: toPath(softLine(st.pts, st.closed), st.closed, W, H), stroke: 'var(--ink)', w: 0.8, alpha: 0.7, cap: 'round', clip: true }));
    return out;
  }
  return out;
}

/** Falta algo por leer: pose, recorte, partes, cuerpo 3D o profundidad. */
export function figuresPending(s: Pick<State, 'visionStep' | 'figuresReady' | 'depth' | 'subjects' | 'visionError'>): boolean {
  if (s.visionError) return false;
  // Trazar líneas es del paso 7 en adelante: la figura ya está leída y no se debe esconder.
  return (!!s.visionStep && s.visionStep !== tx('engine.trazando_lineas')) || !s.figuresReady || !s.depth;
}

/** Debajo del cuerpo va lo que lo cubre: un vestido, una capa, una espada. También es forma. */
function clothed(model: FigureModel, v: View): Prim[] {
  if (!model.surface || model.surface.extra < 1.25) return [];
  return (model.silhouette ?? []).map((loop): Prim => ({ t: 'path', d: toPath(softLine(loop, true), true, v.W, v.H), fill: 'var(--ink)', fillAlpha: 0.05, stroke: 'var(--ink)', w: 0.8, alpha: 0.5 }));
}

/** La imagen del encuadre con la máscara de la figura: un plano no toma color del fondo. */
const framed = new WeakMap<Figure, { rect: Rect; mask: Uint8Array }>();
function imageOf(model: FigureModel, s: State): (NonNullable<State['frame']> & { mask?: Uint8Array }) | null {
  const frame = s.frame;
  if (!frame) return null;
  const fig = s.figures.find((f) => f.id === model.id);
  if (!fig) return frame;
  let held = framed.get(fig);
  if (!held || held.rect !== frame.rect) {
    held = { rect: frame.rect, mask: figureInFrame(fig, frame.rect, frame.w, frame.h) };
    framed.set(fig, held);
  }
  return { ...frame, mask: held.mask };
}

/**
 * El flujo del movimiento: una flecha corre por fuera de cada brazo y cada pierna, del tronco a la
 * punta. No es un adorno: dice hacia dónde va la fuerza de la pose y cómo se encadenan las formas.
 */
function flowPrims(fits: ShapeFit[], v: View): Prim[] {
  const out: Prim[] = [];
  const by = new Map(fits.map((f) => [f.key, f]));
  const torso = by.get('torax') ?? by.get('pelvis');
  for (const [upper, lower] of [['brazoL', 'antebrazoL'], ['brazoR', 'antebrazoR'], ['musloL', 'piernaL'], ['musloR', 'piernaR']]) {
    const a = by.get(upper);
    const b = by.get(lower);
    if (!a || !b) continue;
    const start: Pt = a.origin;
    const joint: Pt = [(a.origin[0] + a.axis[0] + b.origin[0]) / 2, (a.origin[1] + a.axis[1] + b.origin[1]) / 2];
    const end: Pt = [b.origin[0] + b.axis[0], b.origin[1] + b.axis[1]];
    const at = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const pts = [at(start, joint, 0.25), joint, at(joint, end, 0.8)];
    const turn = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[1][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[1][0]);
    // Rodea la articulación por fuera del doblez; si el miembro va recto, se aleja del tronco.
    const middle = torso ? [torso.origin[0] + torso.axis[0] / 2, torso.origin[1] + torso.axis[1] / 2] : joint;
    const chord: Pt = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]];
    const away = (joint[0] - middle[0]) * -chord[1] + (joint[1] - middle[1]) * chord[0] >= 0 ? 1 : -1;
    const side = Math.abs(turn) > 1e-4 ? (turn > 0 ? -1 : 1) : away;
    const wide = (f: ShapeFit) => Math.max(...f.left, ...f.right);
    const gap = Math.max(wide(a), wide(b)) * 0.8 + 0.012;
    const lifted = pts.map((p, i): Pt => {
      const q = pts[Math.min(2, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      const n = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
      const k = gap * (i === 1 ? 1.15 : 0.8);
      return [(p[0] - ((q[1] - r[1]) / n) * side * k) / a.aspect, p[1] + ((q[0] - r[0]) / n) * side * k];
    });
    const line = catmullRom(lifted, 12);
    out.push({ t: 'path', d: toPath(line, false, v.W, v.H), stroke: ROJO, w: 1.2, alpha: 0.75, cap: 'round' });
    out.push(arrowHead(line[line.length - 3], line[line.length - 1], v, ROJO));
  }
  return out;
}

const orgMasks = new WeakMap<Figure, { rect: Rect; w: number; mask: { data: Uint8Array; w: number; h: number } }>();
/** Máscara de la figura en el encuadre, a ~300 px de largo: se cachea por figura. */
function figureMask(model: FigureModel, s: State): { data: Uint8Array; w: number; h: number } | null {
  const frame = s.frame;
  const fig = s.figures.find((f) => f.id === model.id);
  if (!frame || !fig) return null;
  let held = orgMasks.get(fig);
  if (!held || held.rect !== frame.rect) {
    const k = 300 / Math.max(frame.w, frame.h);
    const w = Math.max(8, Math.round(frame.w * k));
    const h = Math.max(8, Math.round(frame.h * k));
    held = { rect: frame.rect, w, mask: { data: figureInFrame(fig, frame.rect, w, h), w, h } };
    orgMasks.set(fig, held);
  }
  return held.mask;
}

function figureStepPrims(model: FigureModel, level: Level, v: View, s: State, first = true): Prim[] {
  const solid = 1 - s.encajePhoto * 0.92;
  if (s.detail) {
    const f = model.mannequin?.head?.details.find((d) => d.id === s.detail!.id);
    return f ? featurePrims(f, s.detail.stage, v) : [];
  }
  const method = s.faceStage !== null ? chosenMethod(model, s) : null;
  if (method) return featurePrims(method, s.faceStage!, v);
  if (s.bodyMethod === 'organico' && level <= 4 && (model.mannequin?.rig || (model.framing === 'mano' && model.mannequin))) {
    // Construcción orgánica: gesto, esqueleto, masas y volúmenes con trazo a mano.
    const org = organicPrims(model, level as 1 | 2 | 3 | 4, v, { style: s.drawStyle, exaggeration: s.exaggeration, simplification: s.simplification, theme: s.theme, light: level >= 4 ? principalLight(s) : null, mask: figureMask(model, s) });
    if (org) {
      const out = [...org];
      if (level === 2) {
        if (model.mannequin.rig) out.push(...rulerPrims(model, v));
        if (s.rigHandles && model.mannequin.rig) out.push(...rigPrims(model.mannequin.rig, v));
      }
      if (level === 4 && s.rigHandles && model.mannequin.rig) out.push(...rigPrims(model.mannequin.rig, v));
      return out;
    }
  }
  // Sin malla (animales, objetos, manos sueltas) el método orgánico no aplica: va el de siempre.
  const organic = s.bodyMethod === 'organico';
  if (organic && level >= 3 && level <= 4) s = { ...s, bodyMethod: 'cajas' };
  if ((level === 5 || level === 6) && organic && model.mannequin?.rig && !s.detail) {
    // Las formas del paso 4 quedan debajo, muy tenues: lo nuevo crece sobre ellas.
    const under = organicPrims(model, 4, v, { style: s.drawStyle, exaggeration: s.exaggeration, simplification: s.simplification, theme: s.theme, light: null });
    if (under) {
      const faint = under.map((p): Prim => (p.t === 'path' ? { ...p, alpha: (p.alpha ?? 1) * 0.2 } : p));
      const rest = figureStepPrims(model, level, v, { ...s, bodyMethod: 'cajas' }, first);
      return [...faint, ...rest];
    }
  }
  if (level === 2) {
    // Como el monigote articulado de un curso de figura; sin esqueleto 3D, los palos de siempre.
    const art = artistSkeletonPrims(model, v);
    const out = art ? [...art, ...rulerPrims(model, v)] : skeletonPrims(model, v);
    if (s.rigHandles && model.mannequin?.rig) out.push(...rigPrims(model.mannequin.rig, v));
    return out;
  }
  if (level === 5) {
    if (model.surface && model.mannequin) return [...clothed(model, v), ...surfaceForms(model.surface, v, solid, s.theme === 'tinta'), ...topPrims(model.mannequin, v, solid, s.faceStage ?? 5)];
    if (model.mannequin) return formPrims(model.mannequin, v, solid, s.faceStage ?? 5);
    if (model.cuboid) return cuboidPrims(model.cuboid, 4, v, solid);
    if (model.primitive) return solidPrims(model.primitive, 360, v, null);
    return shapeFacets(model, v, s);
  }
  if (level === 6) {
    if (model.surface && model.mannequin) return [...clothed(model, v), ...surfacePlanes(model.surface, v, solid, s.theme === 'tinta', imageOf(model, s)), ...topPrims(model.mannequin, v, solid, s.faceStage ?? 6)];
    if (model.mannequin) return planePrims(model.mannequin, v, solid, s.faceStage ?? 6, imageOf(model, s));
    if (model.cuboid) return cuboidPrims(model.cuboid, 5, v, solid);
    if (model.primitive) return solidPrims(model.primitive, 360, v, null);
    return shapeFacets(model, v, s);
  }
  if (level === 7 || level === 8) {
    // Como en Bargue: primero rectas de lo grande a lo chico; después la curva y lo de adentro.
    const out: Prim[] = [];
    if (first) {
      // Las manchas de valor son del paso siguiente: aquí solo van las líneas.
      if (level === 7) {
        // Un encaje: la envolvente en pocas rectas largas (roja) y, dentro, la silueta también
        // en rectas que la cierra. Los bloques por parte quedan para la pestaña Encaje.
        s.formStrokes.filter((st) => st.stage === 1 || st.stage === 3).forEach((st, i) => {
          const d = toPath(st.pts, st.closed, v.W, v.H);
          // Un trazo claro debajo: el rojo y la tinta se leen sobre un fondo oscuro o rojo.
          out.push({ t: 'path', d, stroke: LIGHT, w: (st.stage === 1 ? 1.8 : 1.3) + 2, alpha: 0.35, cap: 'round' });
          out.push({ t: 'path', d, stroke: st.stage === 1 ? ROJO : 'var(--ink)', w: st.stage === 1 ? 1.8 : 1.3, alpha: 1, cap: 'round', draw: true, key: `f7-${i}` });
        });
      } else {
        // En el 8 las rectas ya se volvieron curvas: la silueta recta queda tenue debajo, sin la
        // envolvente ni los bloques, y entran solo las líneas que están dentro de la figura.
        const inside = leadMask(s);
        s.formStrokes.filter((st) => st.stage === 3).forEach((st) => out.push({ t: 'path', d: toPath(st.pts, st.closed, v.W, v.H), stroke: ROJO, w: 0.8, alpha: 0.28 }));
        interiorLines(s.formStrokes, inside, s.frame).forEach((st, i) => out.push({ t: 'path', d: toPath(softLine(st.pts, st.closed), st.closed, v.W, v.H), stroke: 'var(--ink)', w: st.stage === 4 ? 0.9 : 1.3, alpha: 0.85, cap: 'round', draw: true, key: `f8-${i}` }));
      }
    }
    // Lo construido queda debajo, tenue: el dibujo nuevo crece encima de esa forma.
    if (model.surface) for (const loop of model.surface.fill) out.unshift({ t: 'path', d: toPath(softLine(loop, true), true, v.W, v.H), stroke: ROJO, w: 0.8, alpha: level === 7 ? 0.42 : 0.2 });
    else if (model.mannequin) out.unshift(...ghostPrims(model.mannequin, v, level === 7 ? 0.42 : 0.2));
    if (level === 8) for (const loop of model.outline) out.push({ t: 'path', d: toPath(softLine(loop, true), true, v.W, v.H), stroke: 'var(--ink)', w: 1.6, alpha: 0.9, cap: 'round' });
    return out;
  }
  if (level === 9) {
    return model.outline.map((loop): Prim => ({ t: 'path', d: toPath(softLine(loop, true), true, v.W, v.H), stroke: 'var(--ink)', w: 1.3, alpha: 0.8 }));
  }
  if ((level === 3 || level === 4) && model.cuboid) return cuboidPrims(model.cuboid, level, v, solid);
  if ((level === 3 || level === 4) && model.mannequin && s.bodyMethod === 'cajas') {
    const art = artistMannequinPrims(model, v, level);
    if (art) return art;
    if (level === 4) return planePrims(model.mannequin, v, solid, s.faceStage ?? 5);
  }
  if (level === 4 && model.mannequin && s.bodyMethod === 'frijol') return beanPrims(model, v, solid);
  // De aquí en adelante, los pasos 1, 3, 4 y 10 con sus nombres de siempre.
  const step = level === 3 ? 2 : level === 4 ? 3 : level === 10 ? 4 : 1;
  const { W, H } = v;
  const diag = Math.hypot(W, H);
  const out: Prim[] = [];
  const px = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const gesture = () => {
    const curve = model.action.map(px);
    return { t: 'path', d: brushPath(curve, diag * 0.016), fill: ROJO, alpha: step === 1 ? 0.96 : 0.55, key: `g${model.id}` } satisfies Prim;
  };
  if (step === 1) {
    out.push(gesture());
    // Un solo letrero: con varias figuras se volvía ruido sobre la imagen.
    if (first) out.push(...arrowLabel(model, v));
    return out;
  }
  if ((step === 2 || step === 3) && model.mannequin) {
    if (step === 2) out.push(gesture());
    // Cada parte con su figura: la que mejor calza, o la que eligió el pintor.
    const fits = s.bodyMethod === 'figuras' ? (model.shapes ?? []) : [];
    const picks = s.shapePicks[model.id];
    const built = fits.length ? { ...model.mannequin, pieces: shapedPieces(model.mannequin.pieces, fits, picks) } : model.mannequin;
    out.push(...mannequinPrims(built, { level: step, upto: s.pieceStep, solid: 1 - s.encajePhoto * 0.92 }, v));
    if (step === 3 && s.flowLines) out.push(...flowPrims(fits, v));
    // La parte que se está eligiendo se marca: sin esto no se sabe cuál cambia.
    if (first && s.shapePart) {
      for (const f of fits) if (f.kind === s.shapePart) out.push({ t: 'path', d: toPath(shapeForm(f, picks?.[f.key]).outline, true, W, H), stroke: ROJO, w: 2.2, alpha: 1 });
    }
    if (step === 3) for (const [a, b] of model.arrows) out.push({ t: 'path', d: `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`, stroke: ROJO, w: 1 }, arrowHead(a, b, v, ROJO));
    const top = model.mannequin.head;
    if (step === 3 && top && model.turn && s.pieceStep === null) {
      out.push({ t: 'text', x: top.c[0] * W, y: (top.c[1] - top.r) * H - 8 * v.unit, s: describeTurn(model.turn), size: 12 * v.unit, fill: ROJO, anchor: 'middle', halo: true, weight: 500 });
    }
    if (s.rigHandles && model.mannequin.rig) out.push(...rigPrims(model.mannequin.rig, v));
    return out;
  }
  if (step === 2) {
    out.push(gesture());
    if (model.primitive) {
      out.push(...flatPrims(model.primitive, 360, v));
      return out;
    }
    if (model.source === 'forma') {
      const links = model.links.map(([p, q]) => `M${model.circles[p].c[0] * W} ${model.circles[p].c[1] * H}L${model.circles[q].c[0] * W} ${model.circles[q].c[1] * H}`).join('');
      if (links) out.push({ t: 'path', d: links, stroke: 'var(--ink)', w: 2.2, cap: 'round' });
      const limbs = model.sticks.map(([a, b]) => `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`).join('');
      if (limbs) out.push({ t: 'path', d: limbs, stroke: 'var(--ink)', w: 2.2, cap: 'round' });
      const dot = Math.max(3 * v.unit, diag * 0.004);
      for (const j of model.joints) {
        const [x, y] = px(j);
        out.push({ t: 'path', d: ringPath(x, y, dot), fill: 'var(--paper)', stroke: 'var(--ink)', w: 1.3 });
      }
      for (const c of model.circles) {
        const [x, y] = px(c.c);
        out.push({ t: 'path', d: ringPath(x, y, c.r * H), fill: 'var(--paper)', stroke: 'var(--ink)', w: 2, alpha: 0.9 });
      }
      if (model.head) {
        const [x, y] = px(model.head.c);
        out.push({ t: 'path', d: ringPath(x, y, model.head.r * H), fill: 'var(--paper)', stroke: 'var(--ink)', w: 2.2, alpha: 0.92 });
      }
      return out;
    }
    const d = model.sticks.map(([a, b]) => `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`).join('');
    out.push({ t: 'path', d, stroke: 'var(--ink)', w: 2.2, cap: 'round' });
    const r = Math.max(3 * v.unit, diag * 0.005);
    const seen = new Set<string>();
    for (const j of model.joints) {
      const key = `${Math.round(j[0] * 200)},${Math.round(j[1] * 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [x, y] = px(j);
      out.push({ t: 'path', d: ringPath(x, y, r), fill: 'var(--paper)', stroke: 'var(--ink)', w: 1.5 });
    }
    if (model.head) {
      const [x, y] = px(model.head.c);
      out.push({ t: 'path', d: ringPath(x, y, model.head.r * H), fill: 'var(--paper)', stroke: 'var(--ink)', w: 2.2, alpha: 0.92 });
    }
    return out;
  }
  if (step === 3) {
    if (model.primitive) {
      const fuga = perspectiveOf(s).points.find((p) => !p.vertical);
      out.push(...solidPrims(model.primitive, 360, v, fuga?.point ?? null));
      return out;
    }
    const order = { pierna: 0, pie: 1, forma: 1, brazo: 2, mano: 3, pelvis: 4, tronco: 5, cuello: 6, cabeza: 7 } as const;
    const near = (c: Cylinder) => (depthOf ? depthOf(c.a) + depthOf(c.b) : order[c.part]);
    const depthOf = depthSampler(s);
    const parts = [...model.cylinders].sort((a, b) => near(a) - near(b));
    for (const c of parts) out.push(...cylinderPrims(c, v));
    for (const c of model.circles) {
      const [x, y] = px(c.c);
      const r = c.r * H;
      out.push({ t: 'path', d: ringPath(x, y, r), fill: 'var(--paper)', stroke: 'var(--ink)', w: 1.6, alpha: 0.95 });
      out.push({ t: 'path', d: `M${x - r} ${y}Q${x} ${y + r * 0.42} ${x + r} ${y}`, stroke: 'var(--ink)', w: 0.9, alpha: 0.55 });
    }
    out.push(...chestPrims(model, v));
    if (model.shoulders && model.hips) {
      const sh = model.shoulders;
      const hi = model.hips;
      out.push({ t: 'path', d: `M${sh[0][0] * W} ${sh[0][1] * H}L${sh[1][0] * W} ${sh[1][1] * H}M${hi[0][0] * W} ${hi[0][1] * H}L${hi[1][0] * W} ${hi[1][1] * H}`, stroke: ROJO, w: 1.2, alpha: 0.7 });
    }
    if (model.head) out.push(...headPrims(model.head, model.turn, v));
    return out;
  }
  for (const loop of model.outline) out.push({ t: 'path', d: toPath(loop, true, W, H), stroke: 'var(--ink)', w: 1.8, draw: true, key: `o${model.id}${loop.length}` });
  return out;
}

function constructionPrims(s: State, v: View): Prim[] {
  const out: Prim[] = [];
  if (s.forceLines && s.frame) {
    for (const l of s.frame.lines.slice(0, 5)) {
      out.push(...cased(`M${l.a[0] * v.W} ${l.a[1] * v.H}L${l.b[0] * v.W} ${l.b[1] * v.H}`, 1, 0.85, [6, 5]));
    }
  }
  // Se lee todo y se muestra una vez: ver cómo cambia a medio camino solo confunde.
  if (figuresPending(s)) {
    out.push({ t: 'text', x: v.W / 2, y: v.H / 2, s: tx('overlays.leyendo_la_figura'), size: 15 * v.unit, fill: ROJO, anchor: 'middle', halo: true, weight: 500 });
    return out;
  }
  if (isScene(s)) {
    out.push(...scenePrims(s, v));
    return out;
  }
  mainFigures(figureModels(s).list, s).forEach((m, i) => out.push(...figureStepPrims(m, s.construction, v, s, i === 0)));
  return out;
}

function clipBox(b: Rect): Rect {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return { x, y, w: Math.min(1, b.x + b.w) - x, h: Math.min(1, b.y + b.h) - y };
}

function loomisPrims(pts: Pt[], turn: NonNullable<Subject['turn']>, W: number, H: number): Prim[] {
  const at = (i: number): Pt => [pts[i][0] * W, pts[i][1] * H];
  const brow = at(9);
  const chin = at(152);
  const left = at(234);
  const right = at(454);
  const r = Math.hypot(left[0] - right[0], left[1] - right[1]) * 0.52;
  // La bola se apoya en la línea de cejas: su centro queda un poco arriba.
  const cx = brow[0];
  const cy = brow[1] - r * 0.1;
  void chin;
  const g = loomis(turn);
  const map = ([x, y]: Pt): Pt => [cx + x * r, cy + y * r];
  const out: Prim[] = [];
  const f = (v: number) => v.toFixed(1);
  const ball = `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
  out.push(...cased(ball, 1.25, 0.95));
  out.push(...cased(g.lines.map((l) => toPath(l.map(map), false)).join(''), 1, 0.95));
  out.push({ t: 'path', d: toPath(g.side.map(map), true), stroke: ROJO, w: 1.5 });
  out.push({ t: 'path', d: toPath(g.jaw.map(map), false), stroke: ROJO, w: 1.5 });
  return out;
}

function corners(b: Rect, W: number, H: number, unit: number): string {
  const x0 = b.x * W;
  const y0 = b.y * H;
  const x1 = (b.x + b.w) * W;
  const y1 = (b.y + b.h) * H;
  const q = Math.min(14 * unit, Math.abs(x1 - x0) / 3, Math.abs(y1 - y0) / 3);
  return (
    `M${x0} ${y0 + q}V${y0}H${x0 + q}M${x1 - q} ${y0}H${x1}V${y0 + q}` +
    `M${x1} ${y1 - q}V${y1}H${x1 - q}M${x0 + q} ${y1}H${x0}V${y1 - q}`
  );
}

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function facePrims(pts: Pt[], W: number, H: number): Prim[] {
  const at = (i: number): Pt => [pts[i][0] * W, pts[i][1] * H];
  const oval = toPath(FACE_OVAL.map(at), true);
  const top = at(10);
  const chin = at(152);
  const dx = chin[0] - top[0];
  const dy = chin[1] - top[1];
  const len = Math.hypot(dx, dy) || 1;
  const across = (center: Pt, half: number) => {
    const nx = -dy / len;
    const ny = dx / len;
    return `M${center[0] - nx * half} ${center[1] - ny * half}L${center[0] + nx * half} ${center[1] + ny * half}`;
  };
  const eyes: Pt = [(at(33)[0] + at(263)[0]) / 2, (at(33)[1] + at(263)[1]) / 2];
  const half = Math.hypot(at(234)[0] - at(454)[0], at(234)[1] - at(454)[1]) * 0.56;
  const d = `M${top[0]} ${top[1]}L${chin[0]} ${chin[1]}` + across(eyes, half) + across(at(2), half * 0.6) + across(at(13), half * 0.72);
  return [...cased(oval, 1, 0.9), ...cased(d, 0.75, 0.9)];
}

/** Sin los cuerpos cuya cara ya se ve, y con número si hay varios iguales. */
export function namedSubjects(s: Pick<State, 'subjects' | 'frame' | 'image'>) {
  const all = visibleSubjects(s);
  const faces = all.filter((f) => f.kind.endsWith('face') || f.kind === 'head');
  const shown = all
    .filter((x) => {
      if (x.kind !== 'person' && x.kind !== 'anime-person') return true;
      const b = x.fbox;
      return !faces.some((f) => {
        const cx = f.fbox.x + f.fbox.w / 2;
        const cy = f.fbox.y + f.fbox.h / 2;
        return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
      });
    })
    .sort((a, b) => a.fbox.x - b.fbox.x);
  const totals = new Map<string, number>();
  for (const x of shown) totals.set(x.label, (totals.get(x.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return shown.map((x) => {
    const n = (seen.get(x.label) ?? 0) + 1;
    seen.set(x.label, n);
    return (totals.get(x.label) ?? 0) > 1 ? { ...x, label: `${x.label} ${n}` } : x;
  });
}

function subjectPrims(s: State, v: View): Prim[] {
  const { W, H, unit } = v;
  const out: Prim[] = [];
  const list = namedSubjects(s).sort((a, b) => b.fbox.w * b.fbox.h - a.fbox.w * a.fbox.h);
  for (const sub of list) {
    const on = sub.id === s.selectedSubject;
    const b = clipBox(sub.fbox);
    const d = corners(b, W, H, unit);
    out.push({ t: 'path', d, stroke: LIGHT, w: on ? 3.5 : 3, alpha: 0.6 }, { t: 'path', d, stroke: on ? ROJO : DARK, w: on ? 2 : 1.25 });
    out.push({
      t: 'text',
      x: b.x * W + 2 * unit,
      y: b.y * H < 16 * unit ? b.y * H + 15 * unit : b.y * H - 5 * unit,
      s: sub.label,
      size: 11 * unit,
      fill: DARK,
      halo: true,
      weight: 500,
    });
    if (on && s.faceGuides && sub.face && s.frame && s.image) {
      const rect = s.frame.rect;
      const img = s.image;
      out.push(...facePrims(sub.face.map((p) => toFrame(rect, img, p)), W, H));
    }
    if (on && s.loomis && sub.face && sub.turn && s.frame && s.image) {
      const rect = s.frame.rect;
      const img = s.image;
      out.push(...loomisPrims(sub.face.map((p) => toFrame(rect, img, p)), sub.turn, W, H));
    }
  }
  return out;
}

/** Los trazos de la etapa, en el orden en que se dibujan. */
export function encajeSteps(strokes: Stroke[], stage: number): Stroke[] {
  return strokes.filter((st) => st.stage === stage && st.name);
}

function centerOf(pts: Pt[]): Pt {
  return pts.reduce<Pt>((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]);
}

function encajePrims(s: State, v: View): Prim[] {
  const { W, H, unit } = v;
  const out: Prim[] = [];
  const widths = [0, 2, 1.6, 1.5, 1];
  const stage = s.encajeStage;
  const named = stage <= 2 ? encajeSteps(s.strokes, stage) : [];
  const limit = stage === 2 ? s.encajePiece : null;
  let index = 0;
  s.strokes.forEach((st, at) => {
    if (st.stage > stage) return;
    const fresh = st.stage === stage;
    if (limit !== null && st.stage === 2 && st.name) {
      if (index > limit) return;
      index++;
    }
    const last = limit !== null && st.stage === 2 && index - 1 === limit;
    out.push({
      t: 'path',
      d: toPath(st.pts, st.closed, W, H),
      stroke: fresh && (limit === null || last) ? ROJO : 'var(--ink)',
      w: fresh ? widths[st.stage] : 0.9,
      alpha: fresh ? 1 : 0.32,
      cap: 'round',
      draw: fresh,
      key: `e${s.encajeRun}-${at}`,
    });
  });
  if (s.plumb) {
    const points = mainFigures(figureModels(s).list, s).flatMap((m) => [...m.joints, ...(m.head ? [m.head.c] : [])]);
    for (const p of plumbLines(points)) {
      const d = p.vertical ? `M${p.at * W} ${p.from * H - 16 * unit}V${p.to * H + 16 * unit}` : `M${p.from * W - 16 * unit} ${p.at * H}H${p.to * W + 16 * unit}`;
      // El amarillo no se lee sobre el papel: la plomada va en rojo, sobre una línea clara.
      out.push({ t: 'path', d, stroke: LIGHT, w: 2.6, alpha: 0.7, clip: true }, { t: 'path', d, stroke: ROJO, w: 1.3, dash: [8, 5], clip: true });
    }
  }
  const r = 8.5 * unit;
  named.forEach((st, i) => {
    if (limit !== null && i > limit) return;
    const [x, y] = centerOf(st.pts);
    const px = x * W;
    const py = y * H;
    out.push({ t: 'path', d: `M${px - r} ${py}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`, fill: i === 0 ? ROJO : 'var(--paper)', stroke: i === 0 ? undefined : 'var(--ink)', w: 1 });
    out.push({ t: 'text', x: px, y: py + 3.8 * unit, s: String(i + 1), size: 10.5 * unit, fill: i === 0 ? '#FFFFFF' : 'var(--ink)', anchor: 'middle', weight: 500 });
  });
  return out;
}

/** Donde cae el círculo con el 1 de la etapa: el texto "Empieza en" lee ese mismo punto. */
export function encajeStart(strokes: Stroke[], stage = 1): Pt | null {
  const first = encajeSteps(strokes, stage <= 2 ? stage : 1)[0];
  return first ? centerOf(first.pts) : null;
}

export function cellOf(s: Pick<State, 'canvas' | 'grid'>, x: number, y: number): { col: number; row: number } {
  const g = buildGrid(s.canvas, s.grid);
  return { col: locate(g.xs, x * s.canvas.w), row: locate(g.ys, y * s.canvas.h) };
}

export const VP_COLORS = [ROJO, AMARILLO, DARK];
/** Número dentro del punto y línea de apoyo: cada color se lee sobre cualquier foto. */
export const VP_INKS = ['#FFFFFF', DARK, '#FFFFFF'];
const VP_CASES = [LIGHT, DARK, LIGHT];

let perspectiveCache: { key: unknown[]; value: Perspective } | null = null;

/** Lo que dicen las rectas, completado con lo que dice la profundidad. */
export function perspectiveOf(s: Pick<State, 'frame' | 'depth' | 'image' | 'lensRead'> & { figures?: State['figures'] }): Perspective {
  const { frame, depth, image, figures } = s;
  if (!frame) return { kind: 0, points: [], horizon: null, roll: 0, fov: null, lens: null, segments: [], explained: 0 };
  if (s.lensRead) return s.lensRead;
  const key = [frame, depth, figures];
  if (perspectiveCache && perspectiveCache.key.every((k, i) => k === key[i])) return perspectiveCache.value;
  let value = frame.perspective;
  if (depth && image) {
    const w = 220;
    const h = Math.max(1, Math.round((w * frame.h) / frame.w));
    const crop = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ix = (frame.rect.x + (x / w) * frame.rect.w) / image.w;
        const iy = (frame.rect.y + (y / h) * frame.rect.h) / image.h;
        crop[y * w + x] = depth.data[Math.min(depth.h - 1, Math.floor(iy * depth.h)) * depth.w + Math.min(depth.w - 1, Math.floor(ix * depth.w))];
      }
    }
    // Con una figura grande delante, el relieve es el de ella y no el de la escena.
    const figureLeads = (figures ?? []).some((f) => f.box.w * f.box.h > 0.2);
    const flow = figureLeads ? null : depthFlow(crop, w, h);
    const flowing = flow && flow.coherence >= 0.46 && flow.sectors >= 7 ? { ...flow, point: groundOfSky(crop, w, h, flow.point) } : null;
    value = withDepth(value, figureLeads ? null : (depthVanishing(crop, w, h) ?? flowing));
  }
  // Una fuga necesita un espacio: si casi todas sus rectas son del personaje (el filo de una
  // espada, un escudo), es parte de su dibujo y no de la escena.
  if (figures?.length && !value.curve && value.points.length) {
    const G = 96;
    const on = new Uint8Array(G * G);
    for (const f of figures) {
      const m = figureInFrame(f, frame.rect, G, G);
      for (let i = 0; i < m.length; i++) if (m[i]) on[i] = 1;
    }
    const kept = value.points.filter((p) => {
      if (!p.lines.length) return true;
      let inside = 0;
      let all = 0;
      for (const [a, b] of p.lines) {
        const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const x = Math.floor(((a[0] + b[0]) / 2) * G);
        const y = Math.floor(((a[1] + b[1]) / 2) * G);
        all += len;
        let hit = false;
        for (let dy = -2; dy <= 2 && !hit; dy += 2) {
          for (let dx = -2; dx <= 2 && !hit; dx += 2) {
            const qx = x + dx;
            const qy = y + dy;
            if (qx >= 0 && qy >= 0 && qx < G && qy < G && on[qy * G + qx]) hit = true;
          }
        }
        if (hit) inside += len;
      }
      // Con una figura que llena el cuadro casi no hay escena: una fuga débil es una sombra
      // o el borde de algo, no un espacio.
      const leading = figures.some((f) => f.box.w * f.box.h > 0.45);
      if (leading && p.reach < 1.5) return false;
      return !all || inside / all < 0.72;
    });
    if (kept.length !== value.points.length) value = { ...value, points: kept, kind: Math.min(3, kept.length) as 0 | 1 | 2 | 3, horizon: kept.length ? value.horizon : null, fov: null, lens: null };
  }
  if (!value.points.length && value.horizon === null) value = { ...value, horizon: levelHorizon(value.segments, frame.w / frame.h) };
  perspectiveCache = { key, value };
  return value;
}

export function vanishingList(s: State): VanishingPoint[] {
  return s.vpEdit ?? perspectiveOf(s).points;
}

export function horizonOf(list: VanishingPoint[]): number | null {
  const level = list.filter((p) => !p.vertical);
  if (level.length >= 2) {
    const [a, b] = level;
    const t = (0.5 - a.point[0]) / (b.point[0] - a.point[0] || 1e-6);
    return a.point[1] + (b.point[1] - a.point[1]) * t;
  }
  return level[0]?.point[1] ?? null;
}

/** La altura de los ojos en un lente curvo: la recta entre fugas o la polar de la vertical. */
function eyeLevel(list: VanishingPoint[], lens: Lens, focal: number | undefined, W: number, H: number): Pt[] | null {
  const m = lensMap(lens, W, H);
  const at = (p: VanishingPoint) => m.straighten([p.point[0] * W, p.point[1] * H]);
  const level = list.filter((p) => !p.vertical);
  if (level.length >= 2) {
    const a = at(level[0]);
    const b = at(level[1]);
    return curvedLine(a, [b[0] - a[0], b[1] - a[1]], lens, W, H, 64);
  }
  const up = list.find((p) => p.vertical);
  if (!up || !focal) return null;
  const [ux, uy] = at(up);
  const vx = ux - m.cx;
  const vy = uy - m.cy;
  const f = focal * W;
  const d = vx * vx + vy * vy || 1;
  return curvedLine([m.cx - (f * f * vx) / d, m.cy - (f * f * vy) / d], [-vy, vx], lens, W, H, 64);
}

/** Lo que solo existe con lente curvo: arcos por cada fuga, círculo y centro óptico. */
function curvePrims(s: State, list: VanishingPoint[], lens: Lens, focal: number | undefined, v: View): Prim[] {
  const { W, H, unit } = v;
  const out: Prim[] = [];
  const m = lensMap(lens, W, H);
  list.forEach((p, i) => {
    if (s.vpHidden.includes(i)) return;
    const color = VP_COLORS[i % VP_COLORS.length];
    const edge = VP_CASES[i % VP_CASES.length];
    const point: Pt = [p.point[0] * W, p.point[1] * H];
    const center = m.straighten(point);
    const arcs: Pt[][] = [];
    const fromCenter = Math.hypot(point[0] - m.cx, point[1] - m.cy);
    if (s.pv.fan && fromCenter > m.edge * 0.9) {
      // Sobre el círculo la fuga queda en el infinito: sus rectas no abren en abanico, son
      // paralelas, y en la esfera se ven como meridianos que van de un polo al otro.
      const ux = (point[0] - m.cx) / (fromCenter || 1);
      const uy = (point[1] - m.cy) / (fromCenter || 1);
      for (let k = -6; k <= 6; k++) {
        const q = Math.tan((k / 7) * 1.35) * m.edge * 0.6;
        arcs.push(curvedLine([m.cx - uy * q, m.cy + ux * q], [ux, uy], lens, W, H));
      }
    } else if (s.pv.fan) arcs.push(...curvedFan(point, lens, W, H, 16));
    if (s.pv.lines) {
      for (const [a, b] of [...p.lines].sort((q, r) => lengthOf(r) - lengthOf(q)).slice(0, 12)) {
        const mid = m.straighten([((a[0] + b[0]) / 2) * W, ((a[1] + b[1]) / 2) * H]);
        arcs.push(curvedLine(center, [mid[0] - center[0], mid[1] - center[1]], lens, W, H));
      }
    }
    const d = arcs.map((a) => toPath(a, false)).join('');
    if (d) {
      out.push({ t: 'path', d, stroke: edge, w: 1.9, alpha: 0.28 });
      out.push({ t: 'path', d, stroke: color, w: 1, alpha: color === AMARILLO ? 1 : 0.8 });
    }
  });
  if (s.pv.circle && Number.isFinite(m.edge)) {
    const ring = ringPath(m.cx, m.cy, m.edge);
    out.push({ t: 'path', d: ring, stroke: LIGHT, w: 2.4, alpha: 0.5 });
    out.push({ t: 'path', d: ring, stroke: DARK, w: 1, dash: [7, 6] });
    const q = 7 * unit;
    out.push({ t: 'path', d: `M${m.cx - q} ${m.cy}H${m.cx + q}M${m.cx} ${m.cy - q}V${m.cy + q}`, stroke: LIGHT, w: 3.4, alpha: 0.7 });
    out.push({ t: 'path', d: `M${m.cx - q} ${m.cy}H${m.cx + q}M${m.cx} ${m.cy - q}V${m.cy + q}`, stroke: ROJO, w: 1.6 });
    out.push({ t: 'text', x: m.cx + 10 * unit, y: m.cy - 8 * unit, s: tx('overlays.centro_del_lente'), size: 11 * unit, fill: DARK, halo: true, weight: 500 });
  }
  if (s.pv.horizon) {
    const eye = eyeLevel(list, lens, focal, W, H);
    if (eye) {
      const d = toPath(eye, false);
      out.push({ t: 'path', d, stroke: LIGHT, w: 3.4, alpha: 0.55 }, { t: 'path', d, stroke: DARK, w: 1.6 });
      const label = eye.find((q) => q[0] > 12 * unit && q[0] < W - 90 * unit && q[1] > 16 * unit && q[1] < H - 16 * unit);
      if (label) out.push({ t: 'text', x: label[0], y: label[1] - 7 * unit, s: tx('overlays.altura_de_los_ojos'), size: 12 * unit, fill: DARK, halo: true, weight: 500 });
    }
  }
  return out;
}

function lengthOf([a, b]: [Pt, Pt]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function perspectivePrims(s: State, v: View): Prim[] {
  const { W, H, unit } = v;
  const list = vanishingList(s);
  const scene = perspectiveOf(s);
  const lens = scene.curve;
  const out: Prim[] = lens ? curvePrims(s, list, lens, scene.focal, v) : [];
  list.forEach((p, i) => {
    if (s.vpHidden.includes(i)) return;
    const color = VP_COLORS[i % VP_COLORS.length];
    const edge = VP_CASES[i % VP_CASES.length];
    const x = p.point[0] * W;
    const y = p.point[1] * H;
    if (s.pv.fan && !lens) {
      const far = Math.hypot(W, H) * 3;
      let d = '';
      for (let k = 0; k < 28; k++) {
        const t = (k / 28) * Math.PI * 2;
        d += `M${x} ${y}L${x + Math.cos(t) * far} ${y + Math.sin(t) * far}`;
      }
      out.push({ t: 'path', d, stroke: color, w: 0.75, alpha: 0.55 });
    }
    if (s.pv.lines) {
      for (const [a, b] of p.lines) {
        const start = Math.hypot(a[0] - p.point[0], a[1] - p.point[1]) > Math.hypot(b[0] - p.point[0], b[1] - p.point[1]) ? a : b;
        if (!lens) {
          // El amarillo a media fuerza se ensucia sobre su línea de apoyo.
          const faint = color === AMARILLO ? 1 : 0.65;
          out.push({ t: 'path', d: `M${start[0] * W} ${start[1] * H}L${x} ${y}`, stroke: edge, w: 1.75, alpha: 0.3 });
          out.push({ t: 'path', d: `M${start[0] * W} ${start[1] * H}L${x} ${y}`, stroke: color, w: 0.9, alpha: faint, dash: [5, 4] });
        }
        out.push({ t: 'path', d: `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`, stroke: edge, w: 3.6, alpha: 0.5 });
        out.push({ t: 'path', d: `M${a[0] * W} ${a[1] * H}L${b[0] * W} ${b[1] * H}`, stroke: color, w: 2.4 });
      }
    }
    const r = 11 * unit;
    out.push({ t: 'path', d: ringPath(x, y, r + 2 * unit), fill: edge, alpha: 0.9 });
    out.push({ t: 'path', d: ringPath(x, y, r), fill: color });
    out.push({ t: 'text', x, y: y + 4 * unit, s: String(i + 1), size: 12 * unit, fill: VP_INKS[i % VP_INKS.length], anchor: 'middle', weight: 500 });
    // Si queda fuera del cuadro, una marca en el borde indica hacia dónde está.
    if (!s.vpFit && (p.point[0] < 0 || p.point[0] > 1 || p.point[1] < 0 || p.point[1] > 1)) {
      const cx = W / 2;
      const cy = H / 2;
      const dx = x - cx;
      const dy = y - cy;
      const k = Math.min(dx ? (dx > 0 ? W - cx : -cx) / dx : Infinity, dy ? (dy > 0 ? H - cy : -cy) / dy : Infinity) * 0.97;
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const size = 13 * unit;
      out.push({ t: 'path', d: `M${ex + ux * size} ${ey + uy * size}L${ex - uy * size * 0.6} ${ey + ux * size * 0.6}L${ex + uy * size * 0.6} ${ey - ux * size * 0.6}Z`, fill: color });
    }
  });
  const horizon = horizonOf(list) ?? perspectiveOf(s).horizon;
  if (s.pv.horizon && horizon !== null && !lens) {
    const level = list.filter((p) => !p.vertical);
    const slope = level.length >= 2 ? (level[1].point[1] - level[0].point[1]) / (level[1].point[0] - level[0].point[0] || 1e-6) : 0;
    const y0 = (horizon + slope * (-1 - 0.5)) * H;
    const y1 = (horizon + slope * (2 - 0.5)) * H;
    out.push({ t: 'path', d: `M${-W} ${y0}L${W * 2} ${y1}`, stroke: LIGHT, w: 3.5, alpha: 0.55 });
    out.push({ t: 'path', d: `M${-W} ${y0}L${W * 2} ${y1}`, stroke: DARK, w: 1.6 });
    out.push({ t: 'text', x: 10 * unit, y: horizon * H + (0.5 - 0) * 0 - slope * 0 - 7 * unit, s: tx('common.horizonte'), size: 12 * unit, fill: DARK, halo: true, weight: 500 });
  }
  return out;
}

function numberPrims(s: State, v: View): Prim[] {
  const list = s.simplified?.numbers;
  if (!list) return [];
  const size = Math.max(9 * v.unit, Math.min(v.W, v.H) * 0.012);
  return list.map((l) => ({ t: 'text' as const, x: l.x * v.W, y: l.y * v.H + size * 0.35, s: String(l.n), size, fill: 'var(--ink)', anchor: 'middle' as const }));
}

let planCache: { key: unknown[]; value: Plan } | null = null;

export function planOf(s: State): Plan | null {
  const { frame } = s;
  if (!frame) return null;
  const key = [frame, s.canvas, s.grid.cell, s.grid.origin, s.technique, s.pace, s.figures];
  if (planCache && planCache.key.every((k, i) => k === key[i])) return planCache.value;
  const grid = buildGrid(s.canvas, s.grid);
  let subject: Uint8Array | null = null;
  const auto = s.figures.filter((f) => f.source === 'auto');
  if (auto.length) {
    subject = new Uint8Array(frame.w * frame.h);
    for (const f of auto) {
      const m = figureInFrame(f, frame.rect, frame.w, frame.h);
      for (let i = 0; i < m.length; i++) if (m[i]) subject[i] = 1;
    }
  }
  const value = buildPlan({ L: frame.L, w: frame.w, h: frame.h, grid, canvas: s.canvas, technique: s.technique, subject, pace: s.pace });
  planCache = { key, value };
  return value;
}

function planPrims(s: State, v: View): Prim[] {
  const plan = planOf(s);
  if (!plan) return [];
  const out: Prim[] = [];
  const grid = buildGrid(s.canvas, s.grid);
  const kx = v.W / s.canvas.w;
  const ky = v.H / s.canvas.h;
  for (const c of plan.cells) {
    const x0 = grid.xs[c.col] * kx;
    const x1 = grid.xs[c.col + 1] * kx;
    const y0 = grid.ys[c.row] * ky;
    const y1 = grid.ys[c.row + 1] * ky;
    if (s.planView === 'dificultad') {
      out.push({ t: 'path', d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, fill: ROJO, alpha: 0.05 + c.difficulty ** 1.6 * 0.68 });
    } else if (s.planView === 'ruta') {
      const size = Math.min(13 * v.unit, (x1 - x0) * 0.32);
      out.push({ t: 'text', x: (x0 + x1) / 2, y: (y0 + y1) / 2 + size * 0.36, s: String(c.order), size, fill: DARK, anchor: 'middle', halo: true, weight: 500 });
    } else if (s.planView === 'valores' && s.frame) {
      const { L, w, h } = s.frame;
      let sum = 0;
      let n = 0;
      for (let y = Math.floor((y0 / v.H) * h); y < (y1 / v.H) * h; y += 3) {
        for (let x = Math.floor((x0 / v.W) * w); x < (x1 / v.W) * w; x += 3) {
          sum += L[y * w + x];
          n++;
        }
      }
      const turn = valueTurn(sum / (n || 1), s.thresholds[0], s.thresholds[2]);
      const size = Math.min(13 * v.unit, (x1 - x0) * 0.32);
      out.push({ t: 'text', x: (x0 + x1) / 2, y: (y0 + y1) / 2 + size * 0.36, s: String(turn), size, fill: turn === 1 ? ROJO : DARK, anchor: 'middle', halo: true, weight: 500 });
    }
  }
  return out;
}

function comparePrims(s: State, v: View): Prim[] {
  if (!s.compare) return [];
  const grid = buildGrid(s.canvas, s.grid);
  const kx = v.W / s.canvas.w;
  const ky = v.H / s.canvas.h;
  const out: Prim[] = [];
  s.compare.cells.forEach((c, i) => {
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    if (Math.abs(c.diff) < 0.06) return;
    const x0 = grid.xs[col] * kx;
    const x1 = grid.xs[col + 1] * kx;
    const y0 = grid.ys[row] * ky;
    const y1 = grid.ys[row + 1] * ky;
    out.push({ t: 'path', d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, fill: c.diff < 0 ? '#2C609E' : ROJO, alpha: Math.min(0.55, Math.abs(c.diff) * 1.8) });
  });
  return out;
}

export function buildPrims(s: State, v: View): Prim[] {
  const out: Prim[] = [];
  if (!s.frame || s.peek) return out;
  // Pose rápida: solo la foto y la cuadrícula, sin ayuda.
  if (s.quick && s.mode === 'construccion') return s.grid.visible ? gridPrims(s, v) : out;
  if (s.mode === 'composicion') out.push(...compositionPrims(s, v));
  if (s.mode === 'sujetos') out.push(...subjectPrims(s, v));
  // Lo que se construye vive dentro del cuadro: lo que sigue de largo no se ve.
  if (s.mode === 'construccion') out.push(...constructionPrims(s, v).map((p) => (p.t === 'path' ? { ...p, clip: true } : p)));
  if (s.mode === 'construccion' && s.folds && s.construction <= 8) out.push(...foldPrims(s, v));
  if (s.mode === 'perspectiva') out.push(...perspectivePrims(s, v));
  if (s.mode === 'luz') out.push(...lightPrims(s, v));
  if (s.mode === 'encaje') out.push(...encajePrims(s, v));
  if (s.mode === 'simplificar' && s.style === 'numeros') out.push(...numberPrims(s, v));
  if (s.mode === 'pintar') {
    if (s.compare) out.push(...comparePrims(s, v));
    else if (s.planView !== 'ninguno') out.push(...planPrims(s, v));
  }
  if (s.grid.visible) out.push(...gridPrims(s, v));
  return out;
}

export function balanceOf(frame: NonNullable<State['frame']>) {
  return visualBalance(frame.attention, 64, frame.tiny, 48);
}
