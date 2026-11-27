import type { Swatch } from './types';

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const fi = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export type Lab = [number, number, number];

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = LIN[r];
  const lg = LIN[g];
  const lb = LIN[b];
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const x = fi(fy + a / 500) * 0.95047;
  const y = fi(fy);
  const z = fi(fy - b / 200) * 1.08883;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const to8 = (c: number) => Math.round(255 * Math.min(1, Math.max(0, gamma(Math.max(0, c)))));
  return [to8(lr), to8(lg), to8(lb)];
}

export function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const L_TABLE = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) {
  const L = 116 * f(i / 4095) - 16;
  L_TABLE[i] = Math.round(L * 2.55);
}

/** Claridad percibida (L*) de cada píxel, escalada a 0–255. */
export function lightness(rgba: Uint8ClampedArray): Uint8Array {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = 0.2126729 * LIN[rgba[p]] + 0.7151522 * LIN[rgba[p + 1]] + 0.072175 * LIN[rgba[p + 2]];
    out[i] = L_TABLE[(y * 4095) | 0];
  }
  return out;
}

/** Pigmentos de uso común, con su color aproximado en masa. */
const PIGMENTS: [string, [number, number, number]][] = [
  ['Blanco de titanio', [244, 243, 238]],
  ['Blanco cálido', [236, 226, 208]],
  // Sin estos, un azul muy claro (cielo, nube a la sombra) caía en "Blanco cálido".
  ['Blanco azulado', [226, 234, 244]],
  ['Azul celeste claro', [176, 204, 232]],
  ['Gris de Payne', [66, 74, 84]],
  ['Gris neutro muy claro', [226, 225, 222]],
  ['Gris neutro claro', [190, 189, 186]],
  ['Gris neutro', [140, 139, 136]],
  ['Gris neutro oscuro', [92, 91, 89]],
  ['Gris neutro muy oscuro', [52, 51, 49]],
  ['Gris cálido', [150, 142, 130]],
  ['Negro marfil', [30, 29, 28]],
  ['Sombra tostada', [76, 52, 40]],
  ['Sombra natural', [102, 84, 62]],
  ['Siena tostada', [138, 74, 44]],
  ['Siena natural', [178, 124, 72]],
  ['Ocre amarillo', [200, 156, 76]],
  ['Ocre claro', [222, 192, 138]],
  ['Rojo óxido', [130, 56, 40]],
  ['Amarillo de Nápoles', [242, 220, 158]],
  ['Amarillo limón', [246, 228, 66]],
  ['Amarillo cadmio', [246, 190, 28]],
  ['Naranja cadmio', [232, 112, 28]],
  ['Rojo cadmio', [204, 42, 36]],
  ['Rojo carmín', [150, 24, 44]],
  ['Rosa magenta', [196, 40, 112]],
  ['Rosa cuarzo', [226, 174, 172]],
  ['Carne clara', [232, 196, 172]],
  ['Violeta dioxacina', [76, 38, 110]],
  ['Malva', [146, 112, 150]],
  ['Azul ultramar', [38, 54, 140]],
  ['Azul cobalto', [46, 88, 168]],
  ['Azul cerúleo', [66, 142, 188]],
  ['Azul de Prusia', [20, 46, 74]],
  ['Azul grisáceo', [132, 152, 168]],
  ['Turquesa', [40, 150, 150]],
  ['Verde ftalo', [18, 86, 72]],
  ['Verde esmeralda', [50, 138, 92]],
  ['Verde vejiga', [84, 104, 46]],
  ['Verde oliva', [110, 110, 52]],
  ['Verde tierra', [116, 128, 92]],
  ['Verde lima', [168, 196, 72]],
];

const NEUTRAL = new Set(['Blanco de titanio', 'Gris neutro muy claro', 'Gris neutro claro', 'Gris neutro', 'Gris neutro oscuro', 'Gris neutro muy oscuro', 'Negro marfil']);
const PIGMENTS_LAB = PIGMENTS.map(([name, rgb]) => ({ name, rgb, lab: rgbToLab(...rgb), neutral: NEUTRAL.has(name) }));

/** Bajo este croma el ojo no ve temperatura: es el mismo corte del mapa de temperatura. */
export const NEUTRAL_CHROMA = 6;

/**
 * Nombre de pigmento según el color mismo. Un gris sin croma se nombra por su valor
 * (nunca "cálido"), y un color con croma no se confunde con un gris.
 */
export function nearestPigment(rgb: [number, number, number]): string {
  const [L, a, b] = rgbToLab(...rgb);
  const neutral = Math.hypot(a, b) < NEUTRAL_CHROMA;
  let best = PIGMENTS_LAB[0];
  let bestD = Infinity;
  for (const p of PIGMENTS_LAB) {
    if (neutral !== p.neutral) continue;
    const d = (p.lab[0] - L) ** 2 + (p.lab[1] - a) ** 2 + (p.lab[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best.name;
}

/** Croma de Lab de un color. */
export function chromaOf(rgb: [number, number, number]): number {
  const [, a, b] = rgbToLab(...rgb);
  return Math.hypot(a, b);
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-means en Lab con arranque k-means++. Determinista para una misma imagen. */
export function kmeansLab(samples: Float32Array, k: number, iterations = 12): { centers: Float32Array; counts: number[] } {
  const n = samples.length / 3;
  const K = Math.min(k, n);
  const rand = mulberry(7);
  const centers = new Float32Array(K * 3);
  const dist = new Float32Array(n).fill(Infinity);
  let pick = Math.floor(rand() * n);
  for (let c = 0; c < K; c++) {
    centers.set(samples.subarray(pick * 3, pick * 3 + 3), c * 3);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const dL = samples[i * 3] - centers[c * 3];
      const da = samples[i * 3 + 1] - centers[c * 3 + 1];
      const db = samples[i * 3 + 2] - centers[c * 3 + 2];
      const d = dL * dL + da * da + db * db;
      if (d < dist[i]) dist[i] = d;
      total += dist[i];
    }
    if (total === 0) break;
    let target = rand() * total;
    for (let i = 0; i < n; i++) {
      target -= dist[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
  }
  const assign = new Int32Array(n);
  const counts = new Array<number>(K).fill(0);
  for (let it = 0; it < iterations; it++) {
    const sum = new Float64Array(K * 3);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < K; c++) {
        const dL = samples[i * 3] - centers[c * 3];
        const da = samples[i * 3 + 1] - centers[c * 3 + 1];
        const db = samples[i * 3 + 2] - centers[c * 3 + 2];
        const d = dL * dL + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
      counts[best]++;
      sum[best * 3] += samples[i * 3];
      sum[best * 3 + 1] += samples[i * 3 + 1];
      sum[best * 3 + 2] += samples[i * 3 + 2];
    }
    for (let c = 0; c < K; c++) {
      if (!counts[c]) continue;
      centers[c * 3] = sum[c * 3] / counts[c];
      centers[c * 3 + 1] = sum[c * 3 + 1] / counts[c];
      centers[c * 3 + 2] = sum[c * 3 + 2] / counts[c];
    }
  }
  return { centers, counts };
}

/**
 * Si dos tonos caen en el mismo pigmento, los distingue por su claridad real frente al pigmento
 * (más claro o más oscuro que él); solo si siguen iguales usa el orden de claro a oscuro.
 */
export function nameSwatches(list: Swatch[]): Swatch[] {
  // Los repetidos se ordenan por su claridad real (la lista ya viene de claro a oscuro, pero no se asume).
  const groups = new Map<string, number[]>();
  list.forEach((s, i) => groups.set(s.pigment, [...(groups.get(s.pigment) ?? []), i]));
  const out = list.map((s) => ({ ...s }));
  const tone = /(claro|oscuro)$/;
  for (const [name, idx] of groups) {
    if (idx.length < 2) continue;
    idx.sort((p, q) => rgbToLab(...list[q].rgb)[0] - rgbToLab(...list[p].rgb)[0]);
    const words = tone.test(name)
      ? ['', 'más oscuro', 'aún más oscuro', 'mucho más oscuro']
      : idx.length === 2
        ? ['claro', 'oscuro']
        : ['claro', 'medio', 'oscuro', 'muy oscuro'];
    idx.forEach((at, r) => {
      const w = words[Math.min(r, words.length - 1)];
      out[at].pigment = w ? `${name}, ${w}` : name;
    });
  }
  return out;
}

/** Toma muestras Lab de un rectángulo, opcionalmente limitadas por máscara. */
export function sampleLab(
  rgba: Uint8ClampedArray,
  w: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  max = 12000,
  keep?: (x: number, y: number) => boolean,
): Float32Array {
  const step = Math.max(1, Math.floor(Math.sqrt((rw * rh) / max)));
  const out: number[] = [];
  for (let y = ry; y < ry + rh; y += step) {
    for (let x = rx; x < rx + rw; x += step) {
      if (keep && !keep(x, y)) continue;
      const p = (y * w + x) * 4;
      const [L, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      out.push(L, a, b);
    }
  }
  return new Float32Array(out);
}

const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/**
 * Colores que el promedio por masas se come: un color chico y distinto (una flor roja,
 * la luz más clara) no debe faltar en la paleta. Devuelve centros nuevos si faltan.
 */
function missingColors(samples: Float32Array, centers: Lab[], minShare: number): Lab[] {
  const n = samples.length / 3;
  const far: number[] = [];
  let lightest = 0;
  const Ls = new Float32Array(n);
  for (let i = 0; i < n; i++) Ls[i] = samples[i * 3];
  const sorted = [...Ls].sort((p, q) => p - q);
  lightest = sorted[Math.floor(n * 0.97)];
  for (let i = 0; i < n; i++) {
    const s: Lab = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
    let d = Infinity;
    for (const c of centers) d = Math.min(d, dist2(s, c));
    if (d > 22 * 22) far.push(i);
  }
  const out: Lab[] = [];
  if (far.length >= n * minShare) {
    const sub = new Float32Array(far.length * 3);
    far.forEach((i, j) => sub.set(samples.subarray(i * 3, i * 3 + 3), j * 3));
    const { centers: c2, counts } = kmeansLab(sub, 3, 8);
    for (let c = 0; c < counts.length; c++) {
      if (counts[c] >= n * minShare) out.push([c2[c * 3], c2[c * 3 + 1], c2[c * 3 + 2]]);
    }
  }
  // La luz más clara: si ningún centro llega a ella, el blanco del cuadro se vuelve gris.
  const top = Math.max(...centers.map((c) => c[0]), ...out.map((c) => c[0]));
  if (lightest - top > 6) {
    let sum = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (Ls[i] >= lightest) {
        sum = [sum[0] + samples[i * 3], sum[1] + samples[i * 3 + 1], sum[2] + samples[i * 3 + 2]];
        k++;
      }
    }
    if (k) out.push([sum[0] / k, sum[1] / k, sum[2] / k]);
  }
  return out;
}

/** Paleta ordenada de claro a oscuro; une tonos que el ojo no separa. */
export function paletteFrom(samples: Float32Array, k: number): Swatch[] {
  if (samples.length < 3) return [];
  const { centers, counts } = kmeansLab(samples, k);
  const merged: { lab: Lab; n: number }[] = [];
  for (let c = 0; c < counts.length; c++) {
    if (!counts[c]) continue;
    const lab: Lab = [centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]];
    const twin = merged.find((m) => dist2(m.lab, lab) < 64);
    if (twin) {
      const n = twin.n + counts[c];
      twin.lab = twin.lab.map((v, i) => (v * twin.n + lab[i] * counts[c]) / n) as Lab;
      twin.n = n;
    } else {
      merged.push({ lab, n: counts[c] });
    }
  }
  const labs = merged.map((m) => m.lab);
  for (const extra of missingColors(samples, labs, 0.012)) labs.push(extra);
  // El reparto se recalcula con todos los centros: cada muestra va al más cercano.
  const share = new Array<number>(labs.length).fill(0);
  const total = samples.length / 3;
  for (let i = 0; i < total; i++) {
    const s: Lab = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
    let best = 0;
    let bd = Infinity;
    labs.forEach((c, j) => {
      const d = dist2(s, c);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    share[best]++;
  }
  return nameSwatches(
    labs
      .map((lab, j) => ({ lab, n: share[j] }))
      .filter((m) => m.n > 0)
      .sort((p, q) => q.lab[0] - p.lab[0])
      .map(({ lab, n }) => {
        const rgb = labToRgb(...lab);
        return { rgb, hex: hex(rgb), share: n / total, pigment: nearestPigment(rgb) };
      }),
  );
}

/**
 * Suma a una paleta los colores de las zonas que importan (rostros, manos): son chicas en el
 * cuadro y el promedio por masas las pierde, pero el pintor las tiene que mezclar.
 */
export function withKeyColors(palette: Swatch[], regions: Float32Array[], areaShare: number[]): Swatch[] {
  const out = palette.map((s) => ({ ...s }));
  regions.forEach((samples, r) => {
    if (samples.length < 9 || areaShare[r] <= 0) return;
    const { centers, counts } = kmeansLab(samples, 2, 8);
    const sum = counts.reduce((a, c) => a + c, 0) || 1;
    for (let c = 0; c < counts.length; c++) {
      if (!counts[c]) continue;
      const lab: Lab = [centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]];
      const share = (counts[c] / sum) * areaShare[r];
      const rgb = labToRgb(...lab);
      const near = out.reduce((best, s) => {
        const d = dist2(rgbToLab(...s.rgb), lab);
        return d < best.d ? { s, d } : best;
      }, { s: out[0], d: Infinity });
      if (near.s && near.d < 14 * 14) near.s.share += share;
      else out.push({ rgb, hex: hex(rgb), share, pigment: nearestPigment(rgb) });
    }
  });
  const total = out.reduce((a, s) => a + s.share, 0) || 1;
  return nameSwatches(out.map((s) => ({ ...s, share: s.share / total })).sort((p, q) => rgbToLab(...q.rgb)[0] - rgbToLab(...p.rgb)[0]).map((s) => ({ ...s, pigment: nearestPigment(s.rgb) })));
}
