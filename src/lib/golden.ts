import type { Pt } from './types';

export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLD_MINOR = 1 / (PHI * PHI); // 0.382
export const GOLD_MAJOR = 1 / PHI; // 0.618
const EYE = (PHI * PHI) / (PHI * PHI + 1); // 0.7236

export type SpiralTurn = 0 | 1 | 2 | 3;

const flip = (turn: SpiralTurn): { fx: boolean; fy: boolean } => ({ fx: turn === 1 || turn === 2, fy: turn >= 2 });

/** Ojo de la espiral en fracciones del encuadre. */
export function spiralEye(turn: SpiralTurn): Pt {
  const { fx, fy } = flip(turn);
  return [fx ? 1 - EYE : EYE, fy ? 1 - EYE : EYE];
}

/**
 * Espiral áurea y sus cortes, normalizados al encuadre [0,1]².
 * Si el encuadre no es áureo la figura se estira para llenarlo, igual que en
 * cualquier editor; por eso se informa aparte qué tan áureo es el lienzo.
 */
export function goldenSpiral(turn: SpiralTurn, portrait: boolean, depth = 9): { spiral: Pt[]; cuts: [Pt, Pt][] } {
  let x0 = 0;
  let x1 = PHI;
  let y0 = 0;
  let y1 = 1;
  const raw: Pt[] = [];
  const cuts: [Pt, Pt][] = [];
  const arc = (cx: number, cy: number, r: number, from: number) => {
    for (let i = 0; i <= 24; i++) {
      const t = from + (i / 24) * (Math.PI / 2);
      raw.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  };
  for (let i = 0; i < depth; i++) {
    const side = Math.min(x1 - x0, y1 - y0);
    switch (i % 4) {
      case 0:
        arc(x0 + side, y1, side, Math.PI);
        x0 += side;
        cuts.push([[x0, y0], [x0, y1]]);
        break;
      case 1:
        arc(x0, y0 + side, side, -Math.PI / 2);
        y0 += side;
        cuts.push([[x0, y0], [x1, y0]]);
        break;
      case 2:
        arc(x1 - side, y0, side, 0);
        x1 -= side;
        cuts.push([[x1, y0], [x1, y1]]);
        break;
      default:
        arc(x1, y1 - side, side, Math.PI / 2);
        y1 -= side;
        cuts.push([[x0, y1], [x1, y1]]);
    }
  }
  const { fx, fy } = flip(turn);
  const map = ([x, y]: Pt): Pt => {
    let u = x / PHI;
    let v = y;
    if (portrait) [u, v] = [v, u];
    return [fx ? 1 - u : u, fy ? 1 - v : v];
  };
  return { spiral: raw.map(map), cuts: cuts.map(([a, b]) => [map(a), map(b)]) };
}

export interface Focal {
  x: number;
  y: number;
  weight: number;
  label: string;
}

export interface GoldenTarget {
  x: number;
  y: number;
  kind: 'cruce' | 'ojo';
  turn?: SpiralTurn;
}

export function goldenTargets(): GoldenTarget[] {
  const out: GoldenTarget[] = [];
  for (const x of [GOLD_MINOR, GOLD_MAJOR]) for (const y of [GOLD_MINOR, GOLD_MAJOR]) out.push({ x, y, kind: 'cruce' });
  for (const turn of [0, 1, 2, 3] as SpiralTurn[]) {
    const [x, y] = spiralEye(turn);
    out.push({ x, y, kind: 'ojo', turn });
  }
  return out;
}

export interface GoldenReading {
  verdict: 'si' | 'cerca' | 'no' | 'sin-foco';
  focal?: Focal;
  target?: GoldenTarget;
  /** Distancia foco–objetivo como fracción de la diagonal. */
  distance?: number;
  /** Probabilidad de que un punto al azar quede igual de cerca. */
  chance?: number;
  turn: SpiralTurn;
  thirds?: number;
  /** Proporción larga/corta del lienzo y distancia relativa a φ. */
  ratio: number;
  ratioOff: number;
}

/** Decide si el foco principal cae de verdad en un punto áureo. */
export function readGolden(focals: Focal[], aspect: number): GoldenReading {
  const ratio = aspect >= 1 ? aspect : 1 / aspect;
  const ratioOff = Math.abs(ratio - PHI) / PHI;
  const diag = Math.hypot(aspect, 1);
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * aspect, ay - by) / diag;
  const main = [...focals].sort((a, b) => b.weight - a.weight)[0];
  if (!main) return { verdict: 'sin-foco', turn: 0, ratio, ratioOff };

  const targets = goldenTargets();
  let target = targets[0];
  let distance = Infinity;
  for (const t of targets) {
    const d = dist(main.x, main.y, t.x, t.y);
    if (d < distance) {
      distance = d;
      target = t;
    }
  }
  let bestTurn: SpiralTurn = 0;
  let eyeD = Infinity;
  for (const turn of [0, 1, 2, 3] as SpiralTurn[]) {
    const [ex, ey] = spiralEye(turn);
    const d = dist(main.x, main.y, ex, ey);
    if (d < eyeD) {
      eyeD = d;
      bestTurn = turn;
    }
  }
  let thirds = Infinity;
  for (const x of [1 / 3, 2 / 3]) for (const y of [1 / 3, 2 / 3]) thirds = Math.min(thirds, dist(main.x, main.y, x, y));

  const area = aspect; // el encuadre mide aspect × 1
  const chance = Math.min(1, (targets.length * Math.PI * (distance * diag) ** 2) / area);
  const verdict = distance < 0.03 ? 'si' : distance < 0.06 ? 'cerca' : 'no';
  return { verdict, focal: main, target, distance, chance, turn: bestTurn, thirds, ratio, ratioOff };
}

/** Lado que tendría un lienzo áureo conservando el otro. */
export function goldenCompanion(w: number, h: number): { w: number; h: number } {
  return w >= h ? { w: h * PHI, h } : { w, h: w * PHI };
}
