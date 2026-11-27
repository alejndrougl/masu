import { nearestPigment, rgbToLab } from './color';

import { t as tx } from '../i18n';
type Rgb = [number, number, number];

export interface Tube {
  id: string;
  name: string;
  rgb: Rgb;
  /** Poder de tinte aproximado: un poco de ftalo tiñe mucho, el ocre poco; el blanco cubre muchísimo. */
  strength: number;
}

export const TUBES: Tube[] = [
  { id: 'blanco', get name() { return tx('common.blanco_de_titanio'); }, rgb: [246, 245, 240], strength: 9 },
  { id: 'limon', get name() { return tx('common.amarillo_limon'); }, rgb: [247, 226, 54], strength: 1 },
  { id: 'amarillo', get name() { return tx('common.amarillo_cadmio'); }, rgb: [247, 186, 20], strength: 1.2 },
  { id: 'ocre', get name() { return tx('common.ocre_amarillo'); }, rgb: [196, 148, 66], strength: 0.8 },
  { id: 'naranja', get name() { return tx('common.naranja_cadmio'); }, rgb: [232, 104, 22], strength: 1.2 },
  { id: 'rojo', get name() { return tx('common.rojo_cadmio'); }, rgb: [200, 34, 30], strength: 1.3 },
  { id: 'carmin', get name() { return tx('mixing.carmin'); }, rgb: [140, 16, 40], strength: 1.5 },
  { id: 'siena', get name() { return tx('common.siena_tostada'); }, rgb: [128, 66, 38], strength: 0.9 },
  { id: 'sombra', get name() { return tx('common.sombra_tostada'); }, rgb: [70, 46, 34], strength: 1 },
  { id: 'ultramar', get name() { return tx('common.azul_ultramar'); }, rgb: [32, 44, 132], strength: 1.3 },
  { id: 'cobalto', get name() { return tx('common.azul_cobalto'); }, rgb: [40, 82, 164], strength: 1 },
  { id: 'prusia', get name() { return tx('common.azul_de_prusia'); }, rgb: [14, 38, 66], strength: 2.2 },
  { id: 'ftalo', get name() { return tx('common.verde_ftalo'); }, rgb: [10, 78, 66], strength: 2.4 },
  { id: 'vejiga', get name() { return tx('common.verde_vejiga'); }, rgb: [78, 98, 40], strength: 1 },
  { id: 'violeta', get name() { return tx('common.violeta_dioxacina'); }, rgb: [66, 28, 104], strength: 1.8 },
  { id: 'negro', get name() { return tx('common.negro_marfil'); }, rgb: [28, 27, 26], strength: 1.4 },
];

export const TUBE_SETS: { id: string; name: string; tubes: string[] }[] = [
  { id: 'zorn', get name() { return tx('mixing.zorn'); }, tubes: ['blanco', 'ocre', 'rojo', 'negro'] },
  { id: 'primarios', get name() { return tx('mixing.primarios'); }, tubes: ['blanco', 'limon', 'rojo', 'carmin', 'ultramar', 'negro'] },
  { id: 'basica', get name() { return tx('mixing.basica'); }, tubes: ['blanco', 'amarillo', 'ocre', 'rojo', 'carmin', 'siena', 'sombra', 'ultramar', 'cobalto', 'vejiga', 'negro'] },
  { id: 'todas', get name() { return tx('common.todas'); }, tubes: TUBES.map((t) => t.id) },
];

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Kubelka-Munk de una constante por canal: mezcla como pigmento, no como luz. */
const toKS = (r: number) => {
  const R = Math.min(0.995, Math.max(0.02, r));
  return ((1 - R) * (1 - R)) / (2 * R);
};
const fromKS = (ks: number) => 1 + ks - Math.sqrt(ks * ks + 2 * ks);

function ksOf(rgb: Rgb): Rgb {
  return [toKS(linear(rgb[0])), toKS(linear(rgb[1])), toKS(linear(rgb[2]))];
}

export function mixColor(parts: { rgb: Rgb; amount: number; strength: number }[]): Rgb {
  let total = 0;
  const ks: Rgb = [0, 0, 0];
  for (const p of parts) {
    const w = p.amount * p.strength;
    total += w;
    const k = ksOf(p.rgb);
    ks[0] += k[0] * w;
    ks[1] += k[1] * w;
    ks[2] += k[2] * w;
  }
  return ks.map((v) => Math.round(255 * Math.min(1, Math.max(0, gamma(fromKS(v / (total || 1)))))) ) as Rgb;
}

export interface Recipe {
  parts: { name: string; amount: number }[];
  result: Rgb;
  /** Diferencia con el color buscado (distancia en Lab): bajo 5 casi no se distingue. */
  error: number;
  text: string;
  /** Nombre del color que sale de verdad al mezclar, no del que se buscaba. */
  resultName: string;
  /** Cómo se aleja lo que sale de lo buscado, si la diferencia es grande. */
  miss: string | null;
}

/** Diferencia en Lab a partir de la cual la mezcla se aleja lo bastante como para avisarlo. */
export const RECIPE_MISS = 9;

/** Dice en qué se aleja el resultado del objetivo: valor, intensidad o tono. */
export function describeMiss(target: Rgb, result: Rgb): string {
  const [tL, ta, tb] = rgbToLab(...target);
  const [rL, ra, rb] = rgbToLab(...result);
  const dL = rL - tL;
  const dC = Math.hypot(ra, rb) - Math.hypot(ta, tb);
  const dH = Math.hypot(ra - ta, rb - tb);
  const parts: string[] = [];
  if (Math.abs(dL) > 5) parts.push(dL > 0 ? tx('mixing.mas_claro') : tx('common.mas_oscuro'));
  if (Math.abs(dC) > 6) parts.push(dC > 0 ? tx('mixing.mas_intenso') : tx('mixing.mas_apagado'));
  if (!parts.length || (dH > 10 && Math.abs(dC) <= 6)) parts.push(tx('mixing.de_otro_tono'));
  return parts.join(tx('common.sep_y'));
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Busca la mezcla más simple que se acerca al color, con 1 a 3 tubos más blanco si hace falta. */
export function findRecipe(target: Rgb, tubes: Tube[]): Recipe | null {
  if (!tubes.length) return null;
  const [tL, ta, tb] = rgbToLab(...target);
  const data = tubes.map((t) => ({ t, ks: ksOf(t.rgb) }));
  const n = data.length;
  let bestCost = Infinity;
  let best: { ids: number[]; amounts: number[]; rgb: Rgb; error: number } | null = null;

  const test = (ids: number[], amounts: number[]) => {
    let total = 0;
    let k0 = 0;
    let k1 = 0;
    let k2 = 0;
    for (let i = 0; i < ids.length; i++) {
      const d = data[ids[i]];
      const w = amounts[i] * d.t.strength;
      total += w;
      k0 += d.ks[0] * w;
      k1 += d.ks[1] * w;
      k2 += d.ks[2] * w;
    }
    const rgb: Rgb = [
      Math.round(255 * Math.min(1, gamma(fromKS(k0 / total)))),
      Math.round(255 * Math.min(1, gamma(fromKS(k1 / total)))),
      Math.round(255 * Math.min(1, gamma(fromKS(k2 / total)))),
    ];
    const [L, a, b] = rgbToLab(...rgb);
    const error = Math.sqrt((L - tL) ** 2 + (a - ta) ** 2 + (b - tb) ** 2);
    // Cada tubo de más y cada parte de más cuestan: una mezcla de 30 partes no se hace a mano.
    const g = amounts.reduce(gcd);
    const parts = amounts.reduce((a, v) => a + v / g, 0);
    const cost = error + (ids.length - 1) * 2 + parts * 0.05;
    if (cost < bestCost) {
      bestCost = cost;
      best = { ids, amounts, rgb, error };
    }
  };

  // Los claros piden mucho blanco; los demás tubos se mueven en menos pasos.
  const range = (i: number) => (data[i].t.id === 'blanco' ? [1, 2, 3, 4, 6, 8, 12, 16, 24] : [1, 2, 3, 4, 6, 8]);
  for (let a = 0; a < n; a++) {
    test([a], [1]);
    for (let b = a + 1; b < n; b++) {
      for (const pa of range(a)) {
        for (const pb of range(b)) {
          if (pa > 1 && pb > 1 && gcd(pa, pb) > 1) continue;
          test([a, b], [pa, pb]);
        }
      }
      for (let c = b + 1; c < n; c++) {
        for (const pa of range(a)) {
          for (const pb of range(b)) {
            for (const pc of range(c)) test([a, b, c], [pa, pb, pc]);
          }
        }
      }
    }
  }
  if (!best) return null;
  // Afinado: los tonos claros piden mucho blanco, más de lo que la búsqueda gruesa prueba.
  const whiteId = data.findIndex((d) => d.t.id === 'blanco');
  for (let pass = 0; pass < 16; pass++) {
    const before = bestCost;
    const cur = best as unknown as { ids: number[]; amounts: number[] };
    cur.ids.forEach((_, i) => {
      for (const amount of [cur.amounts[i] + 1, cur.amounts[i] * 2, Math.max(1, cur.amounts[i] - 1)]) {
        if (amount > 32) continue;
        const next = [...cur.amounts];
        next[i] = amount;
        test(cur.ids, next);
      }
    });
    if (whiteId >= 0 && !cur.ids.includes(whiteId) && cur.ids.length < 4) {
      for (const amount of [1, 2, 4, 8]) test([...cur.ids, whiteId], [...cur.amounts, amount]);
    }
    if (bestCost >= before) break;
  }
  const { ids, amounts, rgb, error } = best as { ids: number[]; amounts: number[]; rgb: Rgb; error: number };
  const g = amounts.reduce(gcd);
  const parts = ids
    .map((id, i) => ({ name: data[id].t.name, amount: amounts[i] / g }))
    .sort((p, q) => q.amount - p.amount);
  const text = parts.map((p) => `${p.amount} ${p.name}`).join(' + ');
  const miss = error > RECIPE_MISS ? describeMiss(target, rgb) : null;
  return { parts, result: rgb, error, text, resultName: nearestPigment(rgb), miss };
}
