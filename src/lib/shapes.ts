import type { Piece } from './pieces';
import type { Pt } from './types';

import { t as tx, tr } from '../i18n';
/**
 * Las figuras con las que se bloquea un cuerpo. Un dibujante no usa solo óvalos: un tórax puede
 * ser un rombo o un trapecio invertido, y un brazo puede empezar ancho y terminar en punta. Cada
 * figura se describe por su ancho a lo largo del eje, así que todas se comparan igual: se mide el
 * ancho real de la parte y gana la que mejor lo sigue.
 */
export type ShapeKind = 'torax' | 'abdomen' | 'pelvis' | 'cuello' | 'brazo' | 'antebrazo' | 'mano' | 'muslo' | 'pierna' | 'pie';

type Profile = [number, number][];

export interface ShapeDef {
  id: string;
  name: string;
  /** Ancho hacia cada lado del eje, de 0 (inicio) a 1 (final). */
  left: Profile;
  right: Profile;
  /** Sube un poco la complicación: entre dos iguales gana la más simple. */
  cost: number;
  /** Ya viene inclinada, como un romboide: su eje no se endereza al compararla. */
  sheared?: boolean;
}

const ell = (t: number) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
const ease = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const curve = (f: (t: number) => number, n = 24): Profile => Array.from({ length: n + 1 }, (_, i) => [i / n, f(i / n)]);
/** Punta redonda en los dos extremos, como la tapa de un cilindro vista de lado. */
const capped = (f: (t: number) => number, e = 0.1) => (t: number) => {
  const edge = t < e ? ell(t / (2 * e)) : t > 1 - e ? ell((1 - t) / (2 * e)) : 1;
  return f(t) * edge;
};
/** Una loma con su punto más alto en p. */
const bump = (p: number) => (t: number) => Math.sin(Math.PI * t ** (Math.log(0.5) / Math.log(p)));

const even = (id: string, name: string, profile: Profile, cost = 0): ShapeDef => ({ id, get name() { return tr(name); }, left: profile, right: profile, cost });
const bent = (id: string, name: string, width: (t: number) => number, shift: (t: number) => number, cost = 0.012): ShapeDef => ({
  id,
  get name() { return tr(name); },
  left: curve((t) => width(t) - shift(t)),
  right: curve((t) => width(t) + shift(t)),
  cost,
});

const line = (...points: Profile): Profile => points;

/** Sirven para cualquier hueso: cambian el grosor, dónde está la masa y cómo termina. */
const LIMBS: ShapeDef[] = [
  even('cilindro', 'Cilindro', curve(capped(() => 1, 0.08))),
  even('capsula', 'Cápsula', curve(capped(() => 1, 0.22))),
  even('ovalo', 'Óvalo', curve(ell)),
  even('cono', 'Cono', curve(capped((t) => 1 - 0.4 * t))),
  even('cono-fuerte', 'Cono marcado', curve(capped((t) => 1 - 0.66 * t))),
  even('cono-inv', 'Empieza delgado', curve(capped((t) => 0.6 + 0.4 * t))),
  even('cono-inv-fuerte', 'Empieza muy delgado', curve(capped((t) => 0.34 + 0.66 * t))),
  even('punta', 'Termina en punta', line([0, 1], [1, 0.06]), 0.006),
  even('punta-inv', 'Empieza en punta', line([0, 0.06], [1, 1]), 0.006),
  even('huso', 'Huso', curve((t) => 0.42 + 0.58 * Math.sin(Math.PI * t))),
  even('huso-alto', 'Masa al inicio', curve((t) => 0.38 + 0.62 * bump(0.3)(t))),
  even('huso-bajo', 'Masa al final', curve((t) => 0.38 + 0.62 * bump(0.7)(t))),
  even('botella', 'Botella', curve((t) => 1 - 0.62 * ease((t - 0.3) / 0.5)), 0.004),
  even('botella-inv', 'Botella invertida', curve((t) => 0.38 + 0.62 * ease((t - 0.2) / 0.5)), 0.004),
  even('reloj', 'Reloj de arena', curve((t) => 0.6 + 0.4 * (2 * t - 1) ** 2), 0.006),
  even('caja', 'Caja', line([0, 1], [1, 1])),
  even('trapecio', 'Trapecio', line([0, 1], [1, 0.7])),
  even('trapecio-fuerte', 'Trapecio marcado', line([0, 1], [1, 0.42])),
  even('trapecio-inv', 'Trapecio invertido', line([0, 0.7], [1, 1])),
  even('trapecio-inv-fuerte', 'Trapecio invertido marcado', line([0, 0.42], [1, 1])),
  even('rombo', 'Rombo', line([0, 0.06], [0.5, 1], [1, 0.06]), 0.006),
  even('cometa', 'Cometa', line([0, 0.06], [0.3, 1], [1, 0.06]), 0.006),
  even('cometa-inv', 'Cometa invertida', line([0, 0.06], [0.7, 1], [1, 0.06]), 0.006),
  even('hexagono', 'Hexágono', line([0, 0.5], [0.22, 1], [0.78, 1], [1, 0.5]), 0.004),
  even('octagono', 'Octágono', line([0, 0.6], [0.14, 0.9], [0.3, 1], [0.7, 1], [0.86, 0.9], [1, 0.6]), 0.006),
  even('gota', 'Gota', curve((t) => (t < 0.32 ? ell(t / 0.64) : 1 - ease((t - 0.32) / 0.68) * 0.92)), 0.004),
  even('gota-inv', 'Gota invertida', curve((t) => (t > 0.68 ? ell((1 - t) / 0.64) : 0.08 + ease(t / 0.68) * 0.92)), 0.004),
  bent('musculo-a', 'Músculo a un lado', (t) => 0.62 + 0.2 * bump(0.38)(t), (t) => 0.2 * bump(0.38)(t)),
  bent('musculo-b', 'Músculo al otro lado', (t) => 0.62 + 0.2 * bump(0.38)(t), (t) => -0.2 * bump(0.38)(t)),
  bent('arco-a', 'Arco', () => 0.72, (t) => 0.3 * Math.sin(Math.PI * t)),
  bent('arco-b', 'Arco contrario', () => 0.72, (t) => -0.3 * Math.sin(Math.PI * t)),
  bent('ese-a', 'Curva en S', () => 0.72, (t) => 0.28 * Math.sin(2 * Math.PI * t), 0.018),
  bent('ese-b', 'Curva en S contraria', () => 0.72, (t) => -0.28 * Math.sin(2 * Math.PI * t), 0.018),
];

/** Para las dos masas grandes: lo que cambia es cómo se reparten hombros, cintura y cadera. */
const MASSES: ShapeDef[] = [
  even('ovalo', 'Óvalo', curve(ell)),
  even('barril', 'Barril', curve((t) => 0.76 + 0.24 * Math.sin(Math.PI * t))),
  even('huevo', 'Huevo', curve((t) => bump(0.38)(t) ** 0.62)),
  even('huevo-inv', 'Huevo invertido', curve((t) => bump(0.62)(t) ** 0.62)),
  even('rombo', 'Rombo', line([0, 0.1], [0.5, 1], [1, 0.1])),
  even('rombo-alto', 'Rombo alto', line([0, 0.1], [0.3, 1], [1, 0.1])),
  even('rombo-bajo', 'Rombo bajo', line([0, 0.1], [0.7, 1], [1, 0.1])),
  { ...bent('romboide-a', 'Romboide', () => 0.78, (t) => 0.24 * (2 * t - 1), 0), sheared: true },
  { ...bent('romboide-b', 'Romboide contrario', () => 0.78, (t) => -0.24 * (2 * t - 1), 0), sheared: true },
  { ...bent('romboide-suave-a', 'Romboide suave', () => 0.86, (t) => 0.13 * (2 * t - 1), 0), sheared: true },
  { ...bent('romboide-suave-b', 'Romboide suave contrario', () => 0.86, (t) => -0.13 * (2 * t - 1), 0), sheared: true },
  even('rectangulo', 'Rectángulo', line([0, 1], [1, 1])),
  even('cuadro-suave', 'Rectángulo suave', curve(capped(() => 1, 0.14))),
  even('trapecio-inv', 'Trapecio invertido', line([0, 1], [1, 0.62])),
  even('trapecio-inv-fuerte', 'Trapecio invertido marcado', line([0, 1], [1, 0.4])),
  even('trapecio', 'Trapecio', line([0, 0.62], [1, 1])),
  even('trapecio-fuerte', 'Trapecio marcado', line([0, 0.4], [1, 1])),
  even('triangulo-inv', 'Triángulo invertido', line([0, 1], [1, 0.1]), 0.004),
  even('triangulo', 'Triángulo', line([0, 0.1], [1, 1]), 0.004),
  even('hexagono', 'Hexágono', line([0, 0.55], [0.25, 1], [0.75, 1], [1, 0.55])),
  even('hexagono-alto', 'Hexágono alto', line([0, 0.68], [0.28, 1], [1, 0.48])),
  even('hexagono-bajo', 'Hexágono bajo', line([0, 0.48], [0.72, 1], [1, 0.68])),
  even('octagono', 'Octágono', line([0, 0.62], [0.16, 0.92], [0.32, 1], [0.68, 1], [0.84, 0.92], [1, 0.62]), 0.004),
  even('pentagono', 'Pentágono', line([0, 0.82], [0.42, 1], [1, 0.32])),
  even('pentagono-inv', 'Pentágono invertido', line([0, 0.32], [0.58, 1], [1, 0.82])),
  even('escudo', 'Escudo', line([0, 0.9], [0.14, 1], [0.56, 0.84], [1, 0.1]), 0.004),
  even('escudo-inv', 'Escudo invertido', line([0, 0.1], [0.44, 0.84], [0.86, 1], [1, 0.9]), 0.004),
  even('cintura', 'Con cintura', line([0, 1], [0.62, 0.56], [1, 0.76]), 0.006),
  even('cintura-inv', 'Con cintura invertida', line([0, 0.76], [0.38, 0.56], [1, 1]), 0.006),
  bent('frijol-a', 'Frijol', (t) => 0.84 * capped(() => 1, 0.2)(t), (t) => 0.16 * Math.sin(Math.PI * t)),
  bent('frijol-b', 'Frijol contrario', (t) => 0.84 * capped(() => 1, 0.2)(t), (t) => -0.16 * Math.sin(Math.PI * t)),
];

/** Las que solo tienen sentido en una parte concreta. */
const PELVIS_ONLY: ShapeDef[] = [
  even('cuenco', 'Cuenco', curve((t) => ell(0.5 + t / 2))),
  even('cuenco-inv', 'Cuenco invertido', curve((t) => ell(t / 2))),
  even('cubeta', 'Cubeta', line([0, 1], [0.78, 0.86], [1, 0.54])),
  even('mariposa', 'Mariposa', line([0, 0.72], [0.42, 1], [1, 0.18]), 0.004),
  even('calzon', 'Calzón', line([0, 1], [0.5, 0.84], [1, 0.22]), 0.004),
];
const CHEST_ONLY: ShapeDef[] = [
  even('pectoral', 'Pectoral', line([0, 0.72], [0.12, 1], [0.42, 0.96], [0.72, 0.72], [1, 0.54]), 0.004),
  even('caja-toracica', 'Caja torácica', curve((t) => (t < 0.25 ? 0.72 + ease(t / 0.25) * 0.28 : 1 - ease((t - 0.25) / 0.75) * 0.3)), 0.004),
];

const EXTRA: Partial<Record<ShapeKind, ShapeDef[]>> = {
  brazo: [
    even('deltoides', 'Deltoides', curve((t) => 1 - 0.46 * ease(t / 0.42)), 0.004),
    bent('biceps', 'Bíceps', (t) => 0.66 + 0.16 * bump(0.5)(t), (t) => 0.18 * bump(0.5)(t)),
  ],
  antebrazo: [
    even('antebrazo', 'Masa junto al codo', curve((t) => 1 - 0.58 * ease((t - 0.2) / 0.7)), 0.004),
    even('muneca', 'Muñeca angosta', line([0, 0.86], [0.24, 1], [1, 0.4]), 0.004),
  ],
  muslo: [
    even('cuadriceps', 'Cuádriceps', curve((t) => 0.54 + 0.46 * bump(0.34)(t)), 0.004),
    even('cadera-alta', 'Sale ancho de la cadera', line([0, 1], [0.32, 0.92], [1, 0.5]), 0.004),
  ],
  pierna: [
    bent('gemelo-a', 'Gemelo', (t) => 0.58 + 0.2 * bump(0.3)(t), (t) => 0.2 * bump(0.3)(t)),
    bent('gemelo-b', 'Gemelo contrario', (t) => 0.58 + 0.2 * bump(0.3)(t), (t) => -0.2 * bump(0.3)(t)),
    even('espinilla', 'Espinilla recta', line([0, 0.82], [0.3, 1], [0.86, 0.46], [1, 0.52]), 0.004),
  ],
  cuello: [
    even('cuello-base', 'Base ancha', line([0, 1], [0.5, 0.66], [1, 0.62]), 0.004),
    even('cuello-trapecio', 'Con trapecios', curve((t) => 0.6 + 0.4 * (1 - ease(t / 0.55))), 0.004),
  ],
  mano: [
    even('miton', 'Mitón', line([0, 0.62], [0.32, 1], [0.8, 0.86], [1, 0.42]), 0.004),
    even('pala', 'Pala', line([0, 0.5], [0.4, 1], [1, 0.76]), 0.004),
    even('puno', 'Puño', curve(capped(() => 1, 0.3))),
    even('cuna-mano', 'Cuña', line([0, 1], [1, 0.3])),
  ],
  pie: [
    even('zapato', 'Zapato', line([0, 0.74], [0.28, 1], [0.8, 0.72], [1, 0.3]), 0.004),
    even('cuna-pie', 'Cuña', line([0, 1], [1, 0.28])),
    even('almendra', 'Almendra', curve((t) => bump(0.36)(t))),
    bent('empeine', 'Empeine', (t) => 0.66 - 0.3 * t, (t) => 0.3 * (1 - t)),
  ],
};

export const SHAPES: Record<ShapeKind, ShapeDef[]> = {
  torax: [...CHEST_ONLY, ...MASSES],
  abdomen: [...MASSES],
  pelvis: [...PELVIS_ONLY, ...MASSES],
  cuello: [...(EXTRA.cuello ?? []), ...LIMBS],
  brazo: [...(EXTRA.brazo ?? []), ...LIMBS],
  antebrazo: [...(EXTRA.antebrazo ?? []), ...LIMBS],
  mano: [...(EXTRA.mano ?? []), ...LIMBS],
  muslo: [...(EXTRA.muslo ?? []), ...LIMBS],
  pierna: [...(EXTRA.pierna ?? []), ...LIMBS],
  pie: [...(EXTRA.pie ?? []), ...LIMBS],
};

export const KIND_NAME: Record<ShapeKind, string> = {
  get torax() { return tx('shapes.torax'); },
  get abdomen() { return tx('shapes.abdomen'); },
  get pelvis() { return tx('common.pelvis'); },
  get cuello() { return tx('shapes.cuello'); },
  get brazo() { return tx('common.brazo'); },
  get antebrazo() { return tx('shapes.antebrazo'); },
  get mano() { return tx('common.mano'); },
  get muslo() { return tx('shapes.muslo'); },
  get pierna() { return tx('common.pierna'); },
  get pie() { return tx('common.pie'); },
};

const STATIONS = 17;
/** Las puntas de una parte se meten en la vecina: cuentan menos que su centro. */
const WEIGHT = Array.from({ length: STATIONS }, (_, i) => {
  const t = i / (STATIONS - 1);
  return 0.3 + 0.7 * Math.min(1, Math.min(t, 1 - t) / 0.16);
});

/** El ancho real de una parte, medido a lo largo de su eje. */
export interface PartProfile {
  key: string;
  kind: ShapeKind;
  /** Inicio del eje, con x en proporción de alto. */
  origin: Pt;
  /** Del inicio al final del eje. */
  axis: Pt;
  /** Hacia dónde se mide el ancho. Un tórax lo mide a lo largo de los hombros, y por eso se inclina. */
  across: Pt;
  left: number[];
  right: number[];
  z: number;
  aspect: number;
}

export interface ShapeRank {
  id: string;
  /** Qué tanto se sale la figura del ancho real: 0 calza perfecto. */
  error: number;
  /** Escala que mejor le queda. */
  size: number;
  /** Dónde queda su eje: una parte no siempre está centrada en su hueso. */
  shift: number;
  /** Cuánto se inclina ese eje para seguirla. */
  slope: number;
}

export interface ShapeFit extends PartProfile {
  /** De la que mejor calza a la que menos. */
  ranking: ShapeRank[];
}

export interface ShapePick {
  id?: string;
  /** Multiplica el ancho. */
  thick?: number;
  /** Positivo, más ancha al inicio; negativo, más ancha al final. */
  taper?: number;
}

const widthAt = (p: Profile, t: number): number => {
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [a, va] = p[i - 1];
      const [b, vb] = p[i];
      return va + ((vb - va) * (t - a)) / (b - a || 1);
    }
  }
  return p[p.length - 1][1];
};

/** Mide una parte a partir de sus puntos. Si el hueso apunta a quien mira, usa la forma que se ve. */
export function measureProfile(key: string, kind: ShapeKind, X: Float32Array, Y: Float32Array, Z: Float32Array, ids: number[], from: Pt, to: Pt, aspect: number, across?: Pt, floor?: number): PartProfile | null {
  if (ids.length < 12) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const i of ids) {
    mx += X[i];
    my += Y[i];
    mz += Z[i];
  }
  mx /= ids.length;
  my /= ids.length;
  mz /= ids.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const i of ids) {
    xx += (X[i] - mx) ** 2;
    yy += (Y[i] - my) ** 2;
    xy += (X[i] - mx) * (Y[i] - my);
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let ex = to[0] - from[0];
  let ey = to[1] - from[1];
  const bone = Math.hypot(ex, ey);
  const spread = Math.sqrt((xx + yy) / ids.length) * 2;
  if (bone < spread * 0.42) {
    // De frente el hueso no dice nada: manda el eje largo de lo que se ve, con el mismo sentido.
    const sign = Math.cos(angle) * ex + Math.sin(angle) * ey >= 0 ? 1 : -1;
    ex = Math.cos(angle) * sign;
    ey = Math.sin(angle) * sign;
  } else {
    ex /= bone;
    ey /= bone;
  }
  let cx = across ? across[0] : -ey;
  let cy = across ? across[1] : ex;
  let det = ex * cy - ey * cx;
  if (Math.abs(det) < 0.4) {
    cx = -ey;
    cy = ex;
    det = 1;
  }
  const along = new Float32Array(ids.length);
  const off = new Float32Array(ids.length);
  ids.forEach((v, n) => {
    const px = X[v] - from[0];
    const py = Y[v] - from[1];
    along[n] = (px * cy - py * cx) / det;
    off[n] = (ex * py - ey * px) / det;
  });
  const sorted = Float32Array.from(along).sort();
  // La pelvis de la malla sigue por el inicio de los muslos: de ella se mide lo central.
  const trim = kind === 'pelvis' ? 0.05 : 0.01;
  // Con un tope, la parte no sube más allá del inicio de su hueso, medido en su propio largo.
  const low = Math.max(sorted[Math.floor(sorted.length * trim)], floor === undefined ? -Infinity : floor * bone);
  const high = sorted[Math.floor(sorted.length * (1 - trim))];
  const span = high - low;
  if (span <= 1e-5) return null;
  if (kind === 'pelvis') {
    const wide = Float32Array.from(off, Math.abs).sort()[Math.floor(off.length * 0.86)];
    for (let n = 0; n < off.length; n++) off[n] = Math.max(-wide, Math.min(wide, off[n]));
  }
  const left = new Array<number>(STATIONS).fill(-Infinity);
  const right = new Array<number>(STATIONS).fill(-Infinity);
  for (let n = 0; n < ids.length; n++) {
    const s = Math.max(0, Math.min(STATIONS - 1, Math.round(((along[n] - low) / span) * (STATIONS - 1))));
    if (off[n] > right[s]) right[s] = off[n];
    if (-off[n] > left[s]) left[s] = -off[n];
  }
  for (const list of [left, right]) {
    for (let i = 0; i < STATIONS; i++) {
      if (Number.isFinite(list[i])) continue;
      let a = i - 1;
      while (a >= 0 && !Number.isFinite(list[a])) a--;
      let b = i + 1;
      while (b < STATIONS && !Number.isFinite(list[b])) b++;
      list[i] = a >= 0 && b < STATIONS ? list[a] + ((list[b] - list[a]) * (i - a)) / (b - a) : a >= 0 ? list[a] : b < STATIONS ? list[b] : 0;
    }
  }
  const soft = (list: number[]) => list.map((v, i) => (list[Math.max(0, i - 1)] + v * 2 + list[Math.min(STATIONS - 1, i + 1)]) / 4);
  return { key, kind, origin: [from[0] + ex * low, from[1] + ey * low], axis: [ex * span, ey * span], across: [cx, cy], left: soft(left), right: soft(right), z: mz, aspect };
}

/** Lo mismo con una silueta: para los animales y para lo que no tiene malla. */
export function profileFromMask(key: string, kind: ShapeKind, a: Pt, b: Pt, radius: number, mask: { data: Uint8Array; w: number; h: number }, aspect: number, z: number): PartProfile | null {
  const from: Pt = [a[0] * aspect, a[1]];
  const to: Pt = [b[0] * aspect, b[1]];
  const ex = to[0] - from[0];
  const ey = to[1] - from[1];
  const size = Math.hypot(ex, ey);
  if (size < 1e-4) return null;
  const cx = -ey / size;
  const cy = ex / size;
  // Un tórax de animal se mide corto: más abajo el rayo seguiría por una pata hasta el suelo.
  const limit = radius * (kind === 'torax' || kind === 'pelvis' ? 1.08 : 1.7);
  const inside = (x: number, y: number) => {
    const px = Math.floor((x / aspect) * mask.w);
    const py = Math.floor(y * mask.h);
    return px >= 0 && py >= 0 && px < mask.w && py < mask.h && !!mask.data[py * mask.w + px];
  };
  const reach = (x: number, y: number, sign: number) => {
    for (let d = 0; d <= limit; d += 1 / mask.h) if (!inside(x + cx * d * sign, y + cy * d * sign)) return d;
    return limit;
  };
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < STATIONS; i++) {
    const t = i / (STATIONS - 1);
    const x = from[0] + ex * t;
    const y = from[1] + ey * t;
    left.push(reach(x, y, -1));
    right.push(reach(x, y, 1));
  }
  return { key, kind, origin: from, axis: [ex, ey], across: [cx, cy], left, right, z, aspect };
}

/**
 * El ancho de la malla es el de un cuerpo promedio; el del personaje está en su silueta. Cada
 * perfil se corrige midiendo en la silueta, con tres resguardos: cada píxel pertenece a la parte
 * más cercana (el rayo del tórax no sigue por el brazo pegado al costado); si la silueta da mucho
 * menos o mucho más que la malla (algo tapa la parte, o la ropa cuelga lejos), manda la malla; y
 * donde el eje cae fuera de la figura no se mide.
 */
export function refineWithMask(profiles: PartProfile[], mask: { data: Uint8Array; w: number; h: number }, aspect: number, skip: (p: PartProfile) => boolean = () => false): PartProfile[] {
  const { w, h, data } = mask;
  const list = profiles.filter((p) => !skip(p));
  if (!list.length) return profiles;
  const mean = list.map((p) => Math.max(1e-3, (p.left.reduce((a, c) => a + c, 0) + p.right.reduce((a, c) => a + c, 0)) / (2 * STATIONS)));
  const owner = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      const px = ((x + 0.5) / w) * aspect;
      const py = (y + 0.5) / h;
      let best = -1;
      let bestD = Infinity;
      list.forEach((p, k) => {
        const l2 = p.axis[0] ** 2 + p.axis[1] ** 2 || 1e-9;
        const t = Math.max(0, Math.min(1, ((px - p.origin[0]) * p.axis[0] + (py - p.origin[1]) * p.axis[1]) / l2));
        const d = Math.hypot(px - p.origin[0] - p.axis[0] * t, py - p.origin[1] - p.axis[1] * t) / mean[k];
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      owner[y * w + x] = best;
    }
  }
  const cell = (x: number, y: number) => {
    const px = Math.floor((x / aspect) * w);
    const py = Math.floor(y * h);
    return px >= 0 && py >= 0 && px < w && py < h ? py * w + px : -1;
  };
  return profiles.map((p) => {
    const k = list.indexOf(p);
    if (k < 0) return p;
    const across = Math.hypot(p.across[0], p.across[1]) || 1;
    const cx = p.across[0] / across;
    const cy = p.across[1] / across;
    const left = [...p.left];
    const right = [...p.right];
    for (let i = 0; i < STATIONS; i++) {
      const t = i / (STATIONS - 1);
      const x0 = p.origin[0] + p.axis[0] * t;
      const y0 = p.origin[1] + p.axis[1] * t;
      const c0 = cell(x0, y0);
      if (c0 < 0 || !data[c0]) continue;
      for (const [list2, sign] of [[left, -1], [right, 1]] as const) {
        const meshW = list2[i];
        const limit = Math.max(meshW, 1 / h) * 1.7;
        let d = 0;
        for (; d <= limit; d += 1 / h) {
          const c = cell(x0 + cx * d * sign * across, y0 + cy * d * sign * across);
          if (c < 0 || !data[c] || (owner[c] !== k && owner[c] !== -1)) break;
        }
        if (d >= meshW * 0.55 && d <= limit) list2[i] = d * 0.75 + meshW * 0.25;
      }
    }
    const soft = (v: number[]) => v.map((x, i) => (v[Math.max(0, i - 1)] + x * 2 + v[Math.min(STATIONS - 1, i + 1)]) / 4);
    return trimToFigure({ ...p, left: soft(left), right: soft(right) }, (x, y) => {
      const c = cell(x, y);
      return c >= 0 && !!data[c];
    });
  });
}

/**
 * Lo que una mesa o el borde del cuadro tapan no se construye como si se viera: un abdomen que
 * sigue de largo bajo la mesa se vuelve una mancha sin forma. Si un extremo del eje sale de la
 * figura, la parte se corta donde deja de verse, con un margen corto.
 */
function trimToFigure(p: PartProfile, on: (x: number, y: number) => boolean): PartProfile {
  const inside = Array.from({ length: STATIONS }, (_, i) => on(p.origin[0] + (p.axis[0] * i) / (STATIONS - 1), p.origin[1] + (p.axis[1] * i) / (STATIONS - 1)));
  let first = inside.indexOf(true);
  let last = inside.lastIndexOf(true);
  if (first < 0) return p;
  const margin = 1;
  first = Math.max(0, first - margin);
  last = Math.min(STATIONS - 1, last + margin);
  if (last - first + 1 >= STATIONS - 1 || last - first + 1 < STATIONS * 0.4) return p;
  const t0 = first / (STATIONS - 1);
  const t1 = last / (STATIONS - 1);
  const pick = (list: number[]) => Array.from({ length: STATIONS }, (_, i) => {
    const f = first + ((last - first) * i) / (STATIONS - 1);
    const a = Math.floor(f);
    const b = Math.min(STATIONS - 1, a + 1);
    return list[a] + (list[b] - list[a]) * (f - a);
  });
  return {
    ...p,
    origin: [p.origin[0] + p.axis[0] * t0, p.origin[1] + p.axis[1] * t0],
    axis: [p.axis[0] * (t1 - t0), p.axis[1] * (t1 - t0)],
    left: pick(p.left),
    right: pick(p.right),
  };
}

/** Compara el ancho real con cada figura de su tipo. */
export function fitProfile(p: PartProfile): ShapeFit {
  const n = STATIONS;
  const half = p.left.map((l, i) => (l + p.right[i]) / 2);
  const center = p.left.map((l, i) => (p.right[i] - l) / 2);
  // El eje se endereza primero: una parte inclinada no es una parte curva.
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  for (let i = 0; i < n; i++) {
    const u = (2 * i) / (n - 1) - 1;
    c0 += center[i];
    c1 += center[i] * u;
    c2 += u * u;
  }
  const shift = c0 / n;
  const tilt = c1 / (c2 || 1);
  const mean = half.reduce((a, b) => a + Math.abs(b), 0) / n || 1e-6;
  const ranking = SHAPES[p.kind].map((def): ShapeRank => {
    const w: number[] = [];
    const raw: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const l = widthAt(def.left, t);
      const r = widthAt(def.right, t);
      w.push((l + r) / 2);
      raw.push((r - l) / 2);
    }
    // El centro propio de la figura se compara sin su recta, igual que el medido.
    let b0 = 0;
    let b1 = 0;
    raw.forEach((v, i) => {
      b0 += v;
      b1 += v * ((2 * i) / (n - 1) - 1);
    });
    b0 /= n;
    b1 /= c2 || 1;
    // Un romboide es un rectángulo inclinado: si no se le deja su inclinación, nunca ganaría.
    const lean = def.sheared ? 0 : tilt;
    const own = raw.map((v, i) => v - b0 - (def.sheared ? 0 : b1 * ((2 * i) / (n - 1) - 1)));
    const rest = center.map((v, i) => v - shift - lean * ((2 * i) / (n - 1) - 1));
    let top = 0;
    let bottom = 0;
    let weight = 0;
    for (let i = 0; i < n; i++) {
      top += WEIGHT[i] * (half[i] * w[i] + rest[i] * own[i]);
      bottom += WEIGHT[i] * (w[i] * w[i] + own[i] * own[i]);
      weight += WEIGHT[i];
    }
    const size = top / (bottom || 1);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += WEIGHT[i] * ((half[i] - size * w[i]) ** 2 + (rest[i] - size * own[i]) ** 2);
    // Inclinar a mano una figura recta es menos fiel que usar la que ya viene inclinada.
    const leaning = Math.min(0.05, (Math.abs(lean) / mean) * 0.25);
    return { id: def.id, error: Math.sqrt(sum / weight) / mean + def.cost + leaning, size, shift: shift - size * b0, slope: def.sheared ? 0 : tilt - size * b1 };
  });
  ranking.sort((x, y) => x.error - y.error);
  return { ...p, ranking };
}

export const shapeOf = (kind: ShapeKind, id: string | undefined): ShapeDef | undefined => SHAPES[kind].find((d) => d.id === id);

export function pickedRank(fit: ShapeFit, pick?: ShapePick): ShapeRank {
  return fit.ranking.find((r) => r.id === pick?.id) ?? fit.ranking[0];
}

export interface ShapeForm {
  outline: Pt[];
  rings: Pt[][];
  axis: Pt[];
}

/** Dibuja la figura elegida sobre el eje de su parte. */
export function shapeForm(fit: ShapeFit, pick?: ShapePick): ShapeForm {
  const rank = pickedRank(fit, pick);
  const def = shapeOf(fit.kind, rank.id)!;
  const thick = pick?.thick ?? 1;
  const taper = pick?.taper ?? 0;
  const place = (t: number, d: number): Pt => {
    const x = fit.origin[0] + fit.axis[0] * t + fit.across[0] * d;
    const y = fit.origin[1] + fit.axis[1] * t + fit.across[1] * d;
    return [x / fit.aspect, y];
  };
  const middle = (t: number) => rank.shift + rank.slope * (2 * t - 1);
  const scale = (t: number) => rank.size * thick * (1 + taper * (1 - 2 * t));
  const times = [...new Set([...def.left, ...def.right].map(([t]) => t))].sort((a, b) => a - b);
  const right = times.map((t) => place(t, middle(t) + scale(t) * widthAt(def.right, t)));
  const left = times.map((t) => place(t, middle(t) - scale(t) * widthAt(def.left, t)));
  const massive = fit.kind === 'torax' || fit.kind === 'pelvis' || fit.kind === 'abdomen';
  const rings = (massive ? [0.5] : [0.34, 0.66]).map((t) => {
    const a = middle(t) - scale(t) * widthAt(def.left, t);
    const b = middle(t) + scale(t) * widthAt(def.right, t);
    // Un aro apenas curvo: basta para que la figura se lea como volumen y no como recorte.
    const bow = (0.1 * (b - a)) / Math.hypot(fit.axis[0], fit.axis[1]);
    return Array.from({ length: 9 }, (_, i) => {
      const u = i / 8;
      return place(t + bow * (1 - (2 * u - 1) ** 2), a + (b - a) * u);
    });
  });
  return { outline: [...right, ...left.reverse()], rings, axis: [0, 0.5, 1].map((t) => place(t, middle(t))) };
}

export const shapePercent = (rank: ShapeRank) => Math.max(0, Math.min(100, Math.round((1 - rank.error) * 100)));

/** La parte de cada pieza del maniquí, en personas y en animales. */
function keyOf(id: string): string {
  const limb = /^[LR]-([a-zA-Z]+)$/.exec(id);
  return limb ? limb[1] : id;
}

/** Cambia las piezas del maniquí por la figura de cada parte. El resto del dibujo no se entera. */
export function shapedPieces(pieces: Piece[], fits: ShapeFit[], picks?: Record<string, ShapePick>): Piece[] {
  const byKey = new Map(fits.map((f) => [f.key, f]));
  const out: Piece[] = [];
  const handDone = new Set<string>();
  for (const p of pieces) {
    // Una mano ya viene dedo por dedo. Solo se vuelve una figura si el pintor la elige.
    const hand = /^(mano[LR])/.exec(p.id);
    if (hand) {
      const fit = byKey.get(hand[1]);
      if (fit && picks?.[hand[1]]?.id) {
        if (handDone.has(hand[1])) continue;
        handDone.add(hand[1]);
        const form = shapeForm(fit, picks[hand[1]]);
        out.push({ ...p, outline: form.outline, caps: [], rings: form.rings, axes: [], thin: false, joint: false });
        continue;
      }
    }
    if (p.joint) {
      out.push(jointToFit(p, byKey));
      continue;
    }
    const fit = byKey.get(keyOf(p.id));
    if (!fit) {
      out.push(p);
      continue;
    }
    const form = shapeForm(fit, picks?.[fit.key]);
    out.push({ ...p, outline: form.outline, caps: [], rings: form.rings, axes: [form.axis] });
  }
  return out;
}

/**
 * Una articulación no puede ser más ancha que el miembro que une: un codo que sobresale de un
 * brazo delgado se lee como un bulto que no existe. La bola se ajusta al ancho medido de su parte
 * en ese extremo y se centra entre los dos bordes reales.
 */
function jointToFit(p: Piece, byKey: Map<string, ShapeFit>): Piece {
  const m = /^[LR]-([a-zA-Z]+[LR])-(raiz|medio|fin)$/.exec(p.id);
  if (!m) return p;
  const [, bone, where] = m;
  const next: Record<string, string> = { brazoL: 'antebrazoL', brazoR: 'antebrazoR', musloL: 'piernaL', musloR: 'piernaR' };
  const ends: [string, number][] = where === 'raiz' ? [[bone, 0]] : where === 'medio' ? [[bone, STATIONS - 1], [next[bone] ?? '', 0]] : [[bone, STATIONS - 1]];
  let half = Infinity;
  let center: Pt | null = null;
  for (const [key, i] of ends) {
    const f = byKey.get(key);
    if (!f) continue;
    const t = i / (STATIONS - 1);
    const l = f.left[i];
    const r = f.right[i];
    if (!(l > 0 && r > 0)) continue;
    if ((l + r) / 2 < half) {
      half = (l + r) / 2;
      const size = Math.hypot(f.across[0], f.across[1]) || 1;
      const shift = (r - l) / 2;
      center = [f.origin[0] + f.axis[0] * t + (f.across[0] / size) * shift, f.origin[1] + f.axis[1] * t + (f.across[1] / size) * shift];
    }
  }
  if (!center || !Number.isFinite(half)) return p;
  // El centro se queda en la articulación: es el punto anatómico. Solo el tamaño se ajusta.
  const xs = p.outline.map((q) => q[0]);
  const ys = p.outline.map((q) => q[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const r0 = (Math.max(...ys) - Math.min(...ys)) / 2;
  const r = Math.min(r0, half * 1.02);
  if (r >= r0) return p;
  const k = r / r0;
  return { ...p, outline: p.outline.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]) };
}

/** La misma lectura sin malla: cada bloque se mide en la silueta. */
export function fitsFromBlocks(blocks: { id: string; a: Pt; b: Pt; ra: number; rb: number }[], mask: { data: Uint8Array; w: number; h: number } | undefined, aspect: number): ShapeFit[] {
  if (!mask) return [];
  const kindOf = (id: string): ShapeKind | null => {
    const paw = /^pata(\d)-([ab])$/.exec(id);
    if (paw) return Number(paw[1]) < 2 ? (paw[2] === 'a' ? 'brazo' : 'antebrazo') : paw[2] === 'a' ? 'muslo' : 'pierna';
    if (id === 'torax') return 'torax';
    if (id === 'cadera' || id === 'pelvis') return 'pelvis';
    if (id === 'cuello') return 'cuello';
    const limb = /^[LR]-(antebrazo|brazo|muslo|pierna)/.exec(id);
    return limb ? (limb[1] as ShapeKind) : null;
  };
  const out: ShapeFit[] = [];
  for (const block of blocks) {
    const kind = kindOf(block.id);
    if (!kind) continue;
    const found = profileFromMask(keyOf(block.id), kind, block.a, block.b, Math.max(block.ra, block.rb), mask, aspect, 0);
    if (found) out.push(fitProfile(found));
  }
  return out;
}
