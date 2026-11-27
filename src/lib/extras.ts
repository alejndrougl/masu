import { NEUTRAL_CHROMA, rgbToLab } from './color';
import type { DominantLine, Pt, Rect } from './types';

import { t as tx, tr } from '../i18n';
/** Dónde cruza el contorno cada lado de un cuadro: se marca eso y se une, como en la cuadrícula a mano. */
export interface Crossing {
  side: 'arriba' | 'abajo' | 'izquierda' | 'derecha';
  /** Normalizado sobre el encuadre. */
  point: Pt;
  /** De 0 a 1 a lo largo de ese lado. */
  at: number;
}

export function gridCrossings(loops: Pt[][], cell: Rect): Crossing[] {
  const out: Crossing[] = [];
  const x1 = cell.x + cell.w;
  const y1 = cell.y + cell.h;
  const edge = (a: Pt, b: Pt) => {
    const check = (value: number, axis: 0 | 1, side: Crossing['side']) => {
      const da = a[axis] - value;
      const db = b[axis] - value;
      if (da * db > 0 || da === db) return;
      const t = da / (da - db);
      const other = a[1 - axis] + (b[1 - axis] - a[1 - axis]) * t;
      const lo = axis === 0 ? cell.y : cell.x;
      const size = axis === 0 ? cell.h : cell.w;
      if (other < lo || other > lo + size) return;
      out.push({ side, at: (other - lo) / size, point: axis === 0 ? [value, other] : [other, value] });
    };
    check(cell.y, 1, 'arriba');
    check(y1, 1, 'abajo');
    check(cell.x, 0, 'izquierda');
    check(x1, 0, 'derecha');
  };
  for (const loop of loops) for (let i = 0; i < loop.length; i++) edge(loop[i], loop[(i + 1) % loop.length]);
  return out;
}

/** Luz y sombra en temperatura: la idea de Zorn, medida en la imagen. */
export interface Warmth {
  /** Temperatura media de las luces y de las sombras (positivo cálido), en la misma escala del mapa de temperatura. */
  lights: number;
  shadows: number;
  /** 'cálidas', 'frías' o 'neutras' (casi sin color) para cada lado. */
  lightWord: string;
  shadowWord: string;
  text: string;
}

const RANK: Record<string, number> = { cálidas: 2, mezcladas: 1, neutras: 1, frías: 0 };

/**
 * Temperatura de las luces y de las sombras con la misma definición del mapa de temperatura
 * (croma de Lab bajo 6 = neutro). Una zona casi gris es "neutra"; no se le inventa calidez.
 */
export function warmthOfValues(rgba: Uint8ClampedArray, L: Uint8Array): Warmth {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < L.length; i += 3) hist[L[i]]++;
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const quantile = (q: number) => {
    let sum = 0;
    for (let v = 0; v < 256; v++) {
      sum += hist[v];
      if (sum >= total * q) return v;
    }
    return 255;
  };
  const low = quantile(0.3);
  const high = quantile(0.7);
  const side = [
    { t: 0, colored: 0, n: 0 },
    { t: 0, colored: 0, n: 0 },
  ];
  for (let i = 0; i < L.length; i += 3) {
    const k = L[i] >= high ? 0 : L[i] <= low ? 1 : -1;
    if (k < 0) continue;
    const p = i * 4;
    const [, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    side[k].n++;
    if (Math.hypot(a, b) < NEUTRAL_CHROMA) continue;
    side[k].colored++;
    side[k].t += 0.75 * b + 0.45 * a;
  }
  const mean = (s: (typeof side)[number]) => (s.colored ? s.t / s.colored : 0);
  const word = (s: (typeof side)[number]) => {
    if (s.colored < s.n * 0.4) return 'neutras';
    const t = mean(s);
    return t > 3 ? 'cálidas' : t < -3 ? 'frías' : 'mezcladas';
  };
  const lightWord = word(side[0]);
  const shadowWord = word(side[1]);
  const lights = mean(side[0]);
  const shadows = mean(side[1]);
  let text: string;
  if (lightWord === 'neutras' && shadowWord === 'neutras') {
    text = tx('extras.luces_sombras_casi_sin');
  } else if (lightWord === shadowWord) {
    const hint = lightWord === 'cálidas' ? tx('extras.enfriar_un_poco_las') : lightWord === 'frías' ? tx('extras.calentar_un_poco_las') : '';
    text = Math.abs(lights - shadows) < 6 ? tx('extras.luces_sombras_casi_no', { lightWord: tr(lightWord), hint }) : tx('extras.luces_sombras_con', { lightWord: tr(lightWord), v2: lights > shadows ? tx('extras.las_luces_mas_calidas') : tx('extras.las_sombras_mas_calidas') });
  } else if (lightWord === 'neutras') {
    text = tx('extras.las_luces_son_casi', { shadowWord: tr(shadowWord) });
  } else if (shadowWord === 'neutras') {
    text = tx('extras.luces_sombras_casi_grises', { lightWord: tr(lightWord) });
  } else {
    const colder = RANK[lightWord] > RANK[shadowWord];
    text = tx('extras.luces_sombras', { lightWord: tr(lightWord), shadowWord: tr(shadowWord), v3: colder ? tx('extras.las_sombras_van_hacia') : tx('extras.las_sombras_son_mas') });
  }
  return { lights, shadows, lightWord, shadowWord, text };
}

/** Rectas fuertes que, al prolongarse, llegan al foco: son las que guían la mirada. */
export function leadingLines(lines: DominantLine[], focal: Pt, aspect: number, reach = 0.09): DominantLine[] {
  return lines.filter((l) => {
    const ax = l.a[0] * aspect;
    const ay = l.a[1];
    const dx = (l.b[0] - l.a[0]) * aspect;
    const dy = l.b[1] - l.a[1];
    const n = Math.hypot(dx, dy) || 1;
    const fx = focal[0] * aspect - ax;
    const fy = focal[1] - ay;
    return Math.abs(fx * dy - fy * dx) / n < reach;
  });
}

/** Plomadas: verticales y horizontales que unen puntos lejanos de una figura. */
export interface Plumb {
  vertical: boolean;
  at: number;
  /** Tramo que ocupa, sobre el otro eje. */
  from: number;
  to: number;
}

export function plumbLines(points: Pt[], tolerance = 0.012): Plumb[] {
  const groups = (axis: 0 | 1) => {
    const other = (1 - axis) as 0 | 1;
    const sorted = [...points].sort((p, q) => p[axis] - q[axis]);
    const out: Plumb[] = [];
    let run: Pt[] = [];
    const close = () => {
      if (run.length >= 2) {
        const span = run.map((p) => p[other]);
        const from = Math.min(...span);
        const to = Math.max(...span);
        if (to - from > 0.14) out.push({ vertical: axis === 0, at: run.reduce((a, p) => a + p[axis], 0) / run.length, from, to });
      }
      run = [];
    };
    for (const p of sorted) {
      if (run.length && p[axis] - run[0][axis] > tolerance) close();
      run.push(p);
    }
    close();
    return out;
  };
  return [...groups(0), ...groups(1)].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 7);
}

/** Etapa de un cuadro al pintar por valores: oscuros, medios y luces. */
export function valueTurn(mean: number, low: number, high: number): 1 | 2 | 3 {
  return mean < low ? 1 : mean < high ? 2 : 3;
}
