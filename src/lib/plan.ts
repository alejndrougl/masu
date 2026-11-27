import { cellName, type Grid } from './canvas';
import type { Recipe } from './mixing';
import type { CanvasSize, Rect, Swatch } from './types';

import { t as tx } from '../i18n';
export type Technique = 'oleo' | 'acrilico' | 'acuarela' | 'grafito';

export const TECHNIQUES: { value: Technique; label: string }[] = [
  { value: 'oleo', get label() { return tx('plan.oleo'); } },
  { value: 'acrilico', get label() { return tx('plan.acrilico'); } },
  { value: 'acuarela', get label() { return tx('plan.acuarela'); } },
  { value: 'grafito', get label() { return tx('plan.grafito'); } },
];

export const TECHNIQUE_NOTE: Record<Technique, string> = {
  get oleo() { return tx('plan.del_oscuro_al_claro'); },
  get acrilico() { return tx('plan.seca_rapido_trabaja_por'); },
  get acuarela() { return tx('plan.al_reves_que_el'); },
  get grafito() { return tx('plan.empieza_por_el_tono'); },
};

export interface CellPlan {
  col: number;
  row: number;
  name: string;
  /** 0 a 1, relativo a esta imagen. */
  difficulty: number;
  minutes: number;
  /** Fracción del cuadro que pertenece a la figura principal. */
  subject: number;
  mean: number;
  order: number;
}

export interface Plan {
  cells: CellPlan[];
  hours: number;
  hardest: string[];
}

interface PlanInput {
  L: Uint8Array;
  w: number;
  h: number;
  grid: Grid;
  canvas: CanvasSize;
  technique: Technique;
  /** Máscara del sujeto, a resolución del encuadre. */
  subject: Uint8Array | null;
  pace: number;
}

export function cellRect(grid: Grid, canvas: CanvasSize, w: number, h: number, col: number, row: number): Rect {
  const kx = w / canvas.w;
  const ky = h / canvas.h;
  return { x: grid.xs[col] * kx, y: grid.ys[row] * ky, w: (grid.xs[col + 1] - grid.xs[col]) * kx, h: (grid.ys[row + 1] - grid.ys[row]) * ky };
}

/**
 * Plan de pintura: cuánto cuesta cada cuadro y en qué orden conviene atacarlo.
 * Primero el fondo y las masas fáciles, al final lo que tiene más detalle.
 */
export function buildPlan({ L, w, h, grid, canvas, technique, subject, pace }: PlanInput): Plan {
  const raw: Omit<CellPlan, 'order' | 'difficulty' | 'minutes'>[] = [];
  const complexity: number[] = [];
  const areas: number[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const r = cellRect(grid, canvas, w, h, col, row);
      const x0 = Math.floor(r.x);
      const y0 = Math.floor(r.y);
      const x1 = Math.min(w - 1, Math.ceil(r.x + r.w));
      const y1 = Math.min(h - 1, Math.ceil(r.y + r.h));
      let edges = 0;
      let sum = 0;
      let sq = 0;
      let n = 0;
      let inside = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = y * w + x;
          const v = L[i];
          sum += v;
          sq += v * v;
          n++;
          if (x + 1 < w && y + 1 < h) edges += Math.abs(v - L[i + 1]) + Math.abs(v - L[i + w]);
          if (subject?.[i]) inside++;
        }
      }
      const mean = sum / (n || 1);
      const std = Math.sqrt(Math.max(0, sq / (n || 1) - mean * mean));
      complexity.push(edges / (n || 1) + std * 0.35);
      areas.push(((grid.xs[col + 1] - grid.xs[col]) * (grid.ys[row + 1] - grid.ys[row])));
      raw.push({ col, row, name: cellName(col, row), subject: inside / (n || 1), mean });
    }
  }
  const sorted = [...complexity].sort((a, b) => a - b);
  const rank = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo / Math.max(1, sorted.length - 1);
  };
  const cells: CellPlan[] = raw.map((c, i) => {
    const difficulty = rank(complexity[i]);
    return { ...c, difficulty, minutes: areas[i] * pace * (0.5 + 1.8 * difficulty), order: 0 };
  });
  const lightFirst = technique === 'acuarela';
  const key = (c: CellPlan) => {
    const stage = c.subject > 0.5 ? 2 : c.subject > 0.1 ? 1 : 0;
    const value = (lightFirst ? 255 - c.mean : c.mean) / 255;
    return stage * 3 + c.difficulty * 2 + value;
  };
  [...cells].sort((a, b) => key(a) - key(b)).forEach((c, i) => (c.order = i + 1));
  const hours = cells.reduce((a, c) => a + c.minutes, 0) / 60;
  const hardest = [...cells].sort((a, b) => b.difficulty - a.difficulty).slice(0, 3).map((c) => c.name);
  return { cells, hours, hardest };
}

/** Pintura aproximada por color, según el área que ocupa. Dos capas. */
export function paintNeeded(swatches: Swatch[], canvas: CanvasSize, technique: Technique): { name: string; hex: string; ml: number }[] {
  const area = canvas.w * canvas.h;
  const coverage = technique === 'oleo' ? 45 : technique === 'acrilico' ? 40 : technique === 'acuarela' ? 400 : Infinity;
  return swatches.map((s) => ({ name: s.pigment, hex: s.hex, ml: (s.share * area) / coverage }));
}

export interface TubeNeed {
  name: string;
  hex: string;
  ml: number;
}

/**
 * Pintura por tubo, sumando lo que pide cada mezcla de la pestaña Color: así el blanco de una camisa
 * y el que aclara todos los tonos claros se cuentan juntos, y cada tubo sale una sola vez.
 * Una mezcla que no se pudo calcular cuenta como su propio color.
 */
export function paintByTube(
  swatches: Swatch[],
  recipes: (Recipe | null | undefined)[],
  tubes: { name: string; rgb: [number, number, number] }[],
  canvas: CanvasSize,
  technique: Technique,
): TubeNeed[] {
  const area = canvas.w * canvas.h;
  const coverage = technique === 'oleo' ? 45 : technique === 'acrilico' ? 40 : technique === 'acuarela' ? 400 : Infinity;
  const total = new Map<string, TubeNeed>();
  const add = (name: string, hex: string, ml: number) => {
    const cur = total.get(name);
    if (cur) cur.ml += ml;
    else total.set(name, { name, hex, ml });
  };
  const hexOf = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  swatches.forEach((sw, i) => {
    const ml = (sw.share * area) / coverage;
    const r = recipes[i];
    if (!r) return add(sw.pigment, sw.hex, ml);
    const parts = r.parts.reduce((a, p) => a + p.amount, 0) || 1;
    for (const p of r.parts) {
      const tube = tubes.find((t) => t.name === p.name);
      add(p.name, tube ? hexOf(tube.rgb) : sw.hex, (ml * p.amount) / parts);
    }
  });
  return [...total.values()].sort((a, b) => b.ml - a.ml);
}

export function formatHours(h: number): string {
  if (h < 1) return tx('plan.min', { v1: Math.max(5, Math.round((h * 60) / 5) * 5) });
  if (h < 10) return `${(Math.round(h * 2) / 2).toString()} h`;
  return `${Math.round(h)} h`;
}
