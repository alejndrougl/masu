import type { CanvasSize, Crop, GridOptions, Rect, Unit } from './types';

import { t } from '../i18n';
export interface Preset {
  id: string;
  w: number;
  h: number;
  label: string;
  group: 'lienzo' | 'papel';
}

/** Medidas comunes en México, siempre en cm y en vertical. */
export const PRESETS: Preset[] = [
  { id: 'c20x25', w: 20, h: 25, label: '20 × 25', group: 'lienzo' },
  { id: 'c30x30', w: 30, h: 30, label: '30 × 30', group: 'lienzo' },
  { id: 'c30x40', w: 30, h: 40, label: '30 × 40', group: 'lienzo' },
  { id: 'c40x50', w: 40, h: 50, label: '40 × 50', group: 'lienzo' },
  { id: 'c40x60', w: 40, h: 60, label: '40 × 60', group: 'lienzo' },
  { id: 'c50x70', w: 50, h: 70, label: '50 × 70', group: 'lienzo' },
  { id: 'c60x80', w: 60, h: 80, label: '60 × 80', group: 'lienzo' },
  { id: 'c80x100', w: 80, h: 100, label: '80 × 100', group: 'lienzo' },
  { id: 'c90x120', w: 90, h: 120, label: '90 × 120', group: 'lienzo' },
  { id: 'carta', w: 21.6, h: 27.9, get label() { return t('canvas.carta'); }, group: 'papel' },
  { id: 'a4', w: 21, h: 29.7, label: 'A4', group: 'papel' },
  { id: 'a3', w: 29.7, h: 42, label: 'A3', group: 'papel' },
];

export const IN_PER_CM = 1 / 2.54;

export function convertUnit(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  return from === 'cm' ? value * IN_PER_CM : value / IN_PER_CM;
}

export function formatNumber(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Lienzo inicial cercano a 50 cm con la proporción de la foto, buscando medidas
 * que dividan exacto: una cuadrícula con tiras sobrantes es más difícil de trasladar.
 */
export function canvasFromImage(iw: number, ih: number): CanvasSize {
  const ratio = Math.min(iw, ih) / Math.max(iw, ih);
  let long = 50;
  let short = Math.round(50 * ratio);
  let best = Infinity;
  for (let l = 30; l <= 70; l++) {
    const s = Math.round(l * ratio);
    const off = Math.abs(s / l - ratio) / ratio;
    if (off > 0.012) continue;
    const g = gcd(l, s);
    const fits = [g, g / 2, g / 3, g / 4].some((c) => Number.isInteger(c) && l / c >= 6 && l / c <= 12);
    if (!fits) continue;
    const score = Math.abs(l - 50) / 50 + off * 12;
    if (score < best) {
      best = score;
      long = l;
      short = s;
    }
  }
  return iw >= ih ? { w: long, h: short, unit: 'cm' } : { w: short, h: long, unit: 'cm' };
}

/** Pone un preset en la orientación de la imagen. */
export function orient(p: { w: number; h: number }, iw: number, ih: number): { w: number; h: number } {
  const landscape = iw > ih;
  const long = Math.max(p.w, p.h);
  const short = Math.min(p.w, p.h);
  return landscape ? { w: long, h: short } : { w: short, h: long };
}

/** Rectángulo de la imagen (en píxeles) que entra en el lienzo con ese encuadre. */
export function frameRect(iw: number, ih: number, aspect: number, crop: Crop): Rect {
  const zoom = Math.max(1, crop.zoom);
  let w: number;
  let h: number;
  if (iw / ih > aspect) {
    h = ih;
    w = ih * aspect;
  } else {
    w = iw;
    h = iw / aspect;
  }
  w /= zoom;
  h /= zoom;
  const x = Math.min(iw - w, Math.max(0, crop.cx * iw - w / 2));
  const y = Math.min(ih - h, Math.max(0, crop.cy * ih - h / 2));
  return { x, y, w, h };
}

/** Porcentaje de la foto que el lienzo deja fuera. */
export function cropLoss(iw: number, ih: number, aspect: number, crop: Crop): number {
  const r = frameRect(iw, ih, aspect, crop);
  return 1 - (r.w * r.h) / (iw * ih);
}

export interface Grid {
  /** Divisiones en unidades del lienzo. */
  xs: number[];
  ys: number[];
  cols: number;
  rows: number;
  /** Lo que sobra respecto a un múltiplo exacto. */
  restX: number;
  restY: number;
  cell: number;
}

const EPS = 1e-6;

function divisions(length: number, cell: number, centered: boolean): { lines: number[]; rest: number } {
  const whole = Math.floor(length / cell + EPS);
  const rest = Math.max(0, length - whole * cell);
  const offset = centered ? rest / 2 : 0;
  const lines: number[] = [];
  if (offset > EPS) lines.push(0);
  for (let i = 0; i <= whole; i++) lines.push(offset + i * cell);
  if (lines[lines.length - 1] < length - EPS) lines.push(length);
  return { lines, rest: rest < EPS ? 0 : rest };
}

export function buildGrid(canvas: CanvasSize, opts: Pick<GridOptions, 'cell' | 'origin'>): Grid {
  const cell = Math.max(0.1, opts.cell);
  const centered = opts.origin === 'center';
  const x = divisions(canvas.w, cell, centered);
  const y = divisions(canvas.h, cell, centered);
  return {
    xs: x.lines,
    ys: y.lines,
    cols: x.lines.length - 1,
    rows: y.lines.length - 1,
    restX: x.rest,
    restY: y.rest,
    cell,
  };
}

/** A, B … Z, AA, AB … como en una hoja de cálculo. */
export function columnName(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function cellName(col: number, row: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function locate(lines: number[], v: number): number {
  for (let i = 0; i < lines.length - 1; i++) {
    if (v >= lines[i] && v < lines[i + 1]) return i;
  }
  return v >= lines[lines.length - 1] ? lines.length - 2 : 0;
}

/**
 * Tamaños de cuadro que dividen exacto ambos lados del lienzo.
 * Son los buenos: la cuadrícula cierra sin tiras sobrantes en el borde.
 */
export function exactCells(w: number, h: number): number[] {
  const out: number[] = [];
  const shortest = Math.min(w, h);
  for (let tenths = 5; tenths <= shortest * 5; tenths += 5) {
    const c = tenths / 10;
    const cols = w / c;
    const rows = h / c;
    const isWhole = (v: number) => Math.abs(v - Math.round(v)) < 1e-3;
    if (isWhole(cols) && isWhole(rows) && Math.max(cols, rows) <= 40 && Math.min(cols, rows) >= 2) out.push(c);
  }
  return out;
}

/** Cuadro inicial: cerca de 8 divisiones en el lado largo, exacto si se puede. */
export function suggestCell(w: number, h: number): number {
  const long = Math.max(w, h);
  const ideal = long / 8;
  const exact = exactCells(w, h);
  if (exact.length) {
    return exact.reduce((best, c) => (Math.abs(c - ideal) < Math.abs(best - ideal) ? c : best), exact[0]);
  }
  return Math.max(0.5, Math.round(ideal * 2) / 2);
}
