import { NEUTRAL_CHROMA, rgbToLab } from './color';
import type { ToneStats } from './types';

import { t as tx, tr } from '../i18n';
/** Nombres en español: sirven de identificador; se traducen con tr() al mostrarlos. */
export const ZONE_NAMES = ['Oscuros', 'Sombras', 'Medios', 'Luces'] as const;

export function histogram(L: Uint8Array): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < L.length; i++) hist[L[i]]++;
  return hist;
}

/**
 * Otsu con cuatro clases: encuentra los tres cortes que mejor separan
 * los grupos de valor de ESTA imagen, en vez de usar cortes fijos.
 */
export function multiOtsu(hist: number[]): [number, number, number] {
  const BINS = 64;
  const scale = 256 / BINS;
  const P = new Float64Array(BINS + 1);
  const S = new Float64Array(BINS + 1);
  for (let b = 0; b < BINS; b++) {
    let count = 0;
    for (let i = b * scale; i < (b + 1) * scale; i++) count += hist[i] ?? 0;
    P[b + 1] = P[b] + count;
    S[b + 1] = S[b] + count * (b + 0.5);
  }
  const term = (a: number, b: number) => {
    const n = P[b] - P[a];
    if (n <= 0) return 0;
    const s = S[b] - S[a];
    return (s * s) / n;
  };
  let best = -1;
  let cut: [number, number, number] = [16, 32, 48];
  for (let t1 = 1; t1 < BINS - 2; t1++) {
    const a = term(0, t1);
    for (let t2 = t1 + 1; t2 < BINS - 1; t2++) {
      const b = a + term(t1, t2);
      for (let t3 = t2 + 1; t3 < BINS; t3++) {
        const v = b + term(t2, t3) + term(t3, BINS);
        if (v > best) {
          best = v;
          cut = [t1, t2, t3];
        }
      }
    }
  }
  return [cut[0] * scale, cut[1] * scale, cut[2] * scale];
}

/** Rango real de valores, sin el 2% de cada extremo. Mide contraste sin depender de los cortes. */
export function valueRange(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.02) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * 0.02) {
      hi = i;
      break;
    }
  }
  return (hi - lo) / 255;
}

export function zoneOf(v: number, t: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  if (v < t[0]) return 0;
  if (v < t[1]) return 1;
  if (v < t[2]) return 2;
  return 3;
}

export function zoneShares(hist: number[], t: readonly [number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < 256; i++) {
    out[zoneOf(i, t)] += hist[i];
    total += hist[i];
  }
  const d = total || 1;
  return [out[0] / d, out[1] / d, out[2] / d, out[3] / d];
}

/**
 * Espectrograma tonal: cada columna es una franja vertical de la imagen y
 * cada fila un valor. Muestra DÓNDE están las luces y las sombras de izquierda a derecha.
 */
export function waveform(L: Uint8Array, w: number, h: number, bw = 160, bh = 64, rgba?: Uint8ClampedArray): ToneStats['wave'] {
  const acc = new Uint32Array(bw * bh);
  const sum = rgba ? new Float64Array(bw * bh * 3) : null;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      const v = (L[i] * bh) >> 8;
      const c = Math.floor((x * bw) / w);
      const cell = (bh - 1 - v) * bw + c;
      acc[cell]++;
      if (sum && rgba) {
        sum[cell * 3] += rgba[i * 4];
        sum[cell * 3 + 1] += rgba[i * 4 + 1];
        sum[cell * 3 + 2] += rgba[i * 4 + 2];
      }
    }
  }
  let peak = 1;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  const data = new Uint8Array(bw * bh);
  const denom = Math.log1p(peak);
  for (let i = 0; i < acc.length; i++) data[i] = Math.round((255 * Math.log1p(acc[i])) / denom);
  if (!sum) return { w: bw, h: bh, data };
  const color = new Uint8Array(bw * bh * 3);
  for (let i = 0; i < acc.length; i++) {
    if (!acc[i]) continue;
    for (let k = 0; k < 3; k++) color[i * 3 + k] = sum[i * 3 + k] / acc[i];
  }
  return { w: bw, h: bh, data, color };
}

/** Color promedio de cada valor, cuántos píxeles hay por canal y qué tan cromática es la imagen. */
export function colorByValue(rgba: Uint8ClampedArray, L: Uint8Array): Pick<ToneStats, 'tint' | 'rgb' | 'chroma'> {
  const sum = new Float64Array(256 * 3);
  const count = new Uint32Array(256);
  const rgb: [number[], number[], number[]] = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
  let spread = 0;
  for (let i = 0; i < L.length; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const v = L[i];
    count[v]++;
    sum[v * 3] += r;
    sum[v * 3 + 1] += g;
    sum[v * 3 + 2] += b;
    rgb[0][r]++;
    rgb[1][g]++;
    rgb[2][b]++;
    spread += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const tint = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    for (let k = 0; k < 3; k++) tint[v * 3 + k] = count[v] ? sum[v * 3 + k] / count[v] : v;
  }
  return { tint, rgb, chroma: spread / (L.length || 1) / 255 };
}

/** Reparto del color por tono y qué fracción de la imagen tiene color visible. */
export function hueSpectrumAndShare(rgba: Uint8ClampedArray): { hue: number[]; colored: number } {
  const bins = new Array<number>(72).fill(0);
  const n = rgba.length >> 2;
  const step = Math.max(1, Math.floor(n / 200000));
  let seen = 0;
  let colored = 0;
  for (let i = 0; i < n; i += step) {
    const p = i * 4;
    seen++;
    const [, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    const c = Math.hypot(a, b);
    if (c < NEUTRAL_CHROMA) continue;
    colored++;
    const deg = (Math.atan2(b, a) * 180) / Math.PI;
    // Cuenta presencia, no intensidad: un azul oscuro que ocupa media figura pesa lo que ocupa, no lo poco saturado que es.
    bins[Math.floor((((deg + 360) % 360) / 360) * 72) % 72] += c >= 10 ? 1 : 0.4;
  }
  const peak = Math.max(...bins) || 1;
  return { hue: bins.map((v) => v / peak), colored: colored / (seen || 1) };
}

export function hueSpectrum(rgba: Uint8ClampedArray): number[] {
  return hueSpectrumAndShare(rgba).hue;
}

export function toneStats(rgba: Uint8ClampedArray, L: Uint8Array, w: number, h: number): ToneStats {
  const hist = histogram(L);
  const thresholds = multiOtsu(hist);
  const { hue, colored } = hueSpectrumAndShare(rgba);
  let sum = 0;
  for (let i = 0; i < L.length; i++) sum += L[i];
  return {
    hist,
    thresholds,
    shares: zoneShares(hist, thresholds),
    mean: sum / (L.length || 1),
    wave: waveform(L, w, h, 160, 64, rgba),
    hue,
    colored,
    ...colorByValue(rgba, L),
  };
}

/** Estadística tonal de un rectángulo del encuadre, en píxeles. */
export function regionHistogram(L: Uint8Array, w: number, x0: number, y0: number, rw: number, rh: number): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) hist[L[y * w + x]]++;
  }
  return hist;
}

/** Valor absoluto (0 a 255) bajo el que una masa se llama oscura y sobre el que se llama clara. */
const DARK_BELOW = 85;
const LIGHT_ABOVE = 170;

export interface ValueReading {
  key: 'baja' | 'media' | 'alta';
  /** Fracción de oscuros, medios y claros en valor absoluto. */
  thirds: [number, number, number];
  flat: boolean;
  /** Frase de la clave, la misma en Valores y en Lectura. */
  text: string;
  /** Aclara el nombre del grupo más grande cuando sus cortes (relativos a la imagen) engañan. */
  zoneNote: string | null;
}

/**
 * La clave sale del reparto real de valores, no de un promedio: dice qué tercio de la escala
 * concentra la imagen y, si el grupo más grande del histograma tiene un nombre que engaña
 * (unas "sombras" que en realidad son grises medios), lo aclara.
 */
export function valueReading(hist: number[], t: readonly [number, number, number]): ValueReading {
  const total = hist.reduce((a, c) => a + c, 0) || 1;
  const thirds: [number, number, number] = [0, 0, 0];
  let sum = 0;
  hist.forEach((c, v) => {
    thirds[v < DARK_BELOW ? 0 : v < LIGHT_ABOVE ? 1 : 2] += c / total;
    sum += v * c;
  });
  const mean = sum / total;
  // Mediana: resiste un fondo plano grande que mueve el promedio.
  let acc = 0;
  let median = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total / 2) {
      median = v;
      break;
    }
  }
  const mid = (median + mean) / 2;
  const key: ValueReading['key'] = mid < 95 ? 'baja' : mid > 150 ? 'alta' : 'media';
  const range = valueRange(hist);
  const contrast = range > 0.72 ? tx('tones.contraste_fuerte') : range < 0.42 ? tx('tones.contraste_suave') : tx('tones.contraste_moderado');
  const pct = (x: number) => Math.round(x * 100);
  const what =
    key === 'baja'
      ? tx('tones.en_oscuros', { v1: pct(thirds[0]), v2: thirds[2] < 0.05 ? tx('tones.casi_sin_luces') : '' })
      : key === 'alta'
        ? tx('tones.en_claros', { v1: pct(thirds[2]), v2: thirds[0] < 0.05 ? tx('tones.casi_sin_oscuros') : '' })
        : tx('tones.en_valores_medios', { v1: pct(thirds[1]) });
  const spread = key === 'media' && thirds[1] < 0.45;
  // Se mide sobre la escala completa (del negro al blanco), no sobre los cortes de las zonas, que
  // se reparten dentro de cada imagen: por eso se dice, o las dos cifras parecen contradecirse.
  const text = spread ? tx('tones.clave_media_repartida_en', { v1: pct(thirds[0]), v2: pct(thirds[1]), v3: pct(thirds[2]), contrast }) : tx('tones.clave_en_la_escala', { key: tr(key), what, contrast });
  // Nombre del grupo mayor frente a su valor real.
  const shares = zoneShares(hist, t);
  const names = ZONE_NAMES.map((n) => tr(n));
  let top = 0;
  shares.forEach((s, i) => {
    if (s > shares[top]) top = i;
  });
  let zsum = 0;
  let zn = 0;
  hist.forEach((c, v) => {
    if (zoneOf(v, t) === top) {
      zsum += v * c;
      zn += c;
    }
  });
  const zmean = zn ? zsum / zn : 0;
  const real = zmean < DARK_BELOW ? 'oscuros' : zmean >= LIGHT_ABOVE ? 'claros' : 'medios';
  const claimed = top <= 1 ? 'oscuros' : top === 3 ? 'claros' : 'medios';
  const zoneNote =
    shares[top] >= 0.4 && real !== claimed && !(top === 2 && real === 'medios')
      ? tx('tones.el_grupo_mas_grande', { v1: names[top], v2: pct(shares[top]), real: tr(real) })
      : null;
  return { key, thirds, flat: range < 0.42, text, zoneNote };
}
