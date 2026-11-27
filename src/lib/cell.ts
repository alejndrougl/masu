import { paletteFrom, sampleLab } from './color';
import { regionHistogram, zoneShares } from './tones';
import type { Rect, Swatch } from './types';

import { t, tr } from '../i18n';
export interface CellReading {
  shares: [number, number, number, number];
  palette: Swatch[];
  /** Rango de valores presentes, 0–1. */
  range: number;
  direction: EdgeDirection;
  edge: 'nada' | 'suave' | 'duro';
  darkest: string;
  brightest: string;
  note: string;
}

export type EdgeDirection = 'horizontal' | 'vertical' | 'diagonal-sube' | 'diagonal-baja' | 'ninguna';

const WHERE = ['arriba a la izquierda', 'arriba', 'arriba a la derecha', 'a la izquierda', 'al centro', 'a la derecha', 'abajo a la izquierda', 'abajo', 'abajo a la derecha'];

const DIRECTION_WORD: Record<EdgeDirection, string> = {
  horizontal: 'horizontal',
  vertical: 'vertical',
  get 'diagonal-sube'() { return t('cell.diagonal_que_sube_la'); },
  get 'diagonal-baja'() { return t('cell.diagonal_que_baja_la'); },
  ninguna: '',
};

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.ceil(r.w))), h: Math.max(1, Math.min(h - y, Math.ceil(r.h))) };
}

/** Lo que un pintor necesita saber de un cuadro antes de empezarlo. */
export function readCell(
  rgba: Uint8ClampedArray,
  L: Uint8Array,
  w: number,
  h: number,
  rect: Rect,
  thresholds: readonly [number, number, number],
): CellReading {
  const r = clampRect(rect, w, h);
  const hist = regionHistogram(L, w, r.x, r.y, r.w, r.h);
  const shares = zoneShares(hist, thresholds);
  const palette = paletteFrom(sampleLab(rgba, w, r.x, r.y, r.w, r.h, 2500), 4);

  let lo = 0;
  let hi = 255;
  const total = r.w * r.h;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.03) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * 0.03) {
      hi = i;
      break;
    }
  }
  const range = (hi - lo) / 255;

  // Tensor de estructura: orientación dominante de los bordes del cuadro.
  let jxx = 0;
  let jyy = 0;
  let jxy = 0;
  let peak = 0;
  for (let y = Math.max(1, r.y); y < Math.min(h - 1, r.y + r.h); y++) {
    for (let x = Math.max(1, r.x); x < Math.min(w - 1, r.x + r.w); x++) {
      const i = y * w + x;
      const gx = (L[i + 1] - L[i - 1]) / 2;
      const gy = (L[i + w] - L[i - w]) / 2;
      jxx += gx * gx;
      jyy += gy * gy;
      jxy += gx * gy;
      const m = gx * gx + gy * gy;
      if (m > peak) peak = m;
    }
  }
  const energy = jxx + jyy;
  const coherence = energy > 0 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / energy : 0;
  const edge: CellReading['edge'] = range < 0.08 ? 'nada' : Math.sqrt(peak) > 16 ? 'duro' : 'suave';
  let direction: EdgeDirection = 'ninguna';
  if (edge !== 'nada' && coherence > 0.28) {
    // El gradiente cruza el borde: el borde corre 90° respecto a él.
    const grad = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    const deg = ((((grad * 180) / Math.PI + 90) % 180) + 180) % 180;
    if (deg < 22.5 || deg >= 157.5) direction = 'horizontal';
    else if (deg < 67.5) direction = 'diagonal-baja';
    else if (deg < 112.5) direction = 'vertical';
    else direction = 'diagonal-sube';
  }

  const darkest = locateExtreme(L, w, r, lo + (hi - lo) * 0.2, true);
  const brightest = locateExtreme(L, w, r, hi - (hi - lo) * 0.2, false);
  return { shares, palette, range, direction, edge, darkest, brightest, note: describe(shares, range, edge, direction, darkest, brightest) };
}

function locateExtreme(L: Uint8Array, w: number, r: Rect, limit: number, below: boolean): string {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const v = L[y * w + x];
      if (below ? v <= limit : v >= limit) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (!n) return tr(WHERE[4]);
  const u = (sx / n - r.x) / r.w;
  const v = (sy / n - r.y) / r.h;
  const col = u < 0.36 ? 0 : u > 0.64 ? 2 : 1;
  const row = v < 0.36 ? 0 : v > 0.64 ? 2 : 1;
  return tr(WHERE[row * 3 + col]);
}

function describe(
  shares: CellReading['shares'],
  range: number,
  edge: CellReading['edge'],
  direction: EdgeDirection,
  darkest: string,
  brightest: string,
): string {
  const names = ['Oscuros', 'Sombras', 'Medios', 'Luces'].map((n) => tr(n).toLowerCase());
  const order = shares.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const parts: string[] = [];
  if (range < 0.08) {
    parts.push(t('cell.cuadro_casi_plano_un', { v1: names[order[0].i] }));
    parts.push(t('cell.cubrelo_de_una_vez'));
    return parts.join(' ');
  }
  parts.push(order[0].s > 0.75 ? t('cell.casi_todo', { v1: names[order[0].i] }) : t('cell.domina_con', { v1: names[order[0].i], v2: names[order[1].i] }));
  if (edge === 'duro') {
    parts.push(direction === 'ninguna' ? t('cell.hay_bordes_duros_en') : t('cell.un_borde_duro_lo', { v1: DIRECTION_WORD[direction] }));
  } else if (direction !== 'ninguna') {
    parts.push(t('cell.transicion_suave', { v1: DIRECTION_WORD[direction] }));
  } else {
    parts.push(t('cell.transiciones_suaves'));
  }
  parts.push(t('cell.empieza_por_la_mancha', { darkest, brightest }));
  return parts.join(' ');
}

function describeLight(dx: number, dy: number): { label: string; contrast: number } {
  const contrast = Math.hypot(dx, dy);
  if (contrast < 0.04) return { label: t('cell.luz_pareja_de_frente'), contrast };
  const side = Math.abs(dx) < 0.03 ? '' : dx < 0 ? t('common.izquierda') : t('common.derecha');
  const height = Math.abs(dy) < 0.03 ? '' : dy > 0 ? t('common.abajo') : t('common.arriba');
  if (height && side) return { label: t('cell.luz_desde_la', { height, side }), contrast };
  return { label: height ? t('cell.luz_desde', { height }) : t('cell.luz_desde_la_2', { side }), contrast };
}

function regionMean(L: Uint8Array, w: number, h: number, r: Rect): number {
  const c = clampRect(r, w, h);
  let sum = 0;
  let n = 0;
  for (let y = c.y; y < c.y + c.h; y++) {
    for (let x = c.x; x < c.x + c.w; x++) {
      sum += L[y * w + x];
      n++;
    }
  }
  return sum / (n || 1);
}

/** Dirección de la luz comparando las mitades de un rectángulo. */
export function lightDirection(L: Uint8Array, w: number, h: number, rect: Rect): { label: string; contrast: number } {
  const r = clampRect(rect, w, h);
  const hw = r.w >> 1;
  const hh = r.h >> 1;
  const left = regionMean(L, w, h, { x: r.x, y: r.y, w: hw, h: r.h });
  const right = regionMean(L, w, h, { x: r.x + hw, y: r.y, w: hw, h: r.h });
  const top = regionMean(L, w, h, { x: r.x, y: r.y, w: r.w, h: hh });
  const bottom = regionMean(L, w, h, { x: r.x, y: r.y + hh, w: r.w, h: hh });
  return describeLight((right - left) / 255, (bottom - top) / 255);
}

export interface FacePatches {
  left: [number, number];
  right: [number, number];
  top: [number, number];
  bottom: [number, number];
  /** Radio del parche, en píxeles. */
  radius: number;
}

/**
 * En un rostro las mitades engañan: entran pelo, cuencas y fondo. Se comparan solo
 * parches de piel: las dos mejillas, y la frente contra el mentón.
 */
export function faceLight(L: Uint8Array, w: number, h: number, p: FacePatches): { label: string; contrast: number } {
  const at = ([x, y]: [number, number]) => regionMean(L, w, h, { x: x - p.radius, y: y - p.radius, w: p.radius * 2, h: p.radius * 2 });
  return describeLight((at(p.right) - at(p.left)) / 255, (at(p.bottom) - at(p.top)) / 255);
}

