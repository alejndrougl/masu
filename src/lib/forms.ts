import type { Facet, Mask } from './pieces';
import type { Pt } from './types';
import type { V3 } from './volumes';

export type LimbKind = 'muslo' | 'pantorrilla' | 'brazo' | 'antebrazo';

const bell = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));

/**
 * Forma anatómica: cuánto se aparta el contorno del eje, en radios del hueso, a cada lado.
 * Son las reglas de Bridgman hechas números: el muslo es redondo y baja afilándose, la
 * pantorrilla carga su masa arriba y atrás, el brazo tiene hombro y bíceps, y el antebrazo
 * se ensancha cerca del codo. Un cilindro tiene los dos lados iguales; un cuerpo, nunca.
 */
function profile(kind: LimbKind, t: number): [number, number] {
  switch (kind) {
    case 'muslo': {
      const base = 1.02 - 0.34 * t;
      return [base + 0.08 * bell(t, 0.3, 0.25), base + 0.14 * bell(t, 0.22, 0.2)];
    }
    case 'pantorrilla': {
      const base = 0.94 - 0.5 * t;
      return [base + 0.32 * bell(t, 0.27, 0.17), base + 0.05 * bell(t, 0.5, 0.2)];
    }
    case 'brazo': {
      const base = 0.96 - 0.22 * t;
      return [base + 0.14 * bell(t, 0.12, 0.13) + 0.12 * bell(t, 0.52, 0.17), base + 0.06 * bell(t, 0.5, 0.2)];
    }
    case 'antebrazo': {
      const base = 0.9 - 0.42 * t;
      return [base + 0.2 * bell(t, 0.22, 0.17), base + 0.12 * bell(t, 0.3, 0.2)];
    }
  }
}

function rayLength(mask: Mask, x: number, y: number, dx: number, dy: number, aspect: number, limit: number): number | null {
  const step = 1 / mask.h;
  for (let d = 0; d < limit; d += step) {
    const px = Math.floor(((x + dx * d) / aspect) * mask.w);
    const py = Math.floor((y + dy * d) * mask.h);
    if (px < 0 || py < 0 || px >= mask.w || py >= mask.h) return d;
    if (!mask.data[py * mask.w + px]) return d;
  }
  return null;
}

function smooth(values: number[]): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const v = values[i + k];
      if (v === undefined) continue;
      const w = 3 - Math.abs(k);
      sum += v * w;
      n += w;
    }
    return sum / n;
  });
}

function rounded(pts: Pt[], passes = 2): Pt[] {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

export interface OrganicForm {
  outline: Pt[];
  /** Curvas que rodean la forma: dicen hacia dónde gira su superficie. */
  rings: Pt[][];
  /** La misma forma tallada en planos: lado, frente y lado. */
  planes: Facet[];
  /** Masas secundarias: dónde termina un músculo y empieza otro. */
  marks: Pt[][];
}

/** Curva que pasa por sus puntos. */
function spline(list: Pt[], steps = 6): Pt[] {
  if (list.length < 3) return list;
  const out: Pt[] = [];
  for (let i = 0; i < list.length - 1; i++) {
    const p0 = list[Math.max(0, i - 1)];
    const p1 = list[i];
    const p2 = list[i + 1];
    const p3 = list[Math.min(list.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(list[list.length - 1]);
  return out;
}

/**
 * Masas secundarias de cada miembro, en coordenadas de la forma: t a lo largo del hueso y s
 * de un lado a otro, con s = 1 en el lado que se dobla. Son las líneas que un dibujante pone
 * después de los cilindros: el deltoides que entra como cuña, el gemelo que termina antes
 * de llegar al tobillo, el braquiorradial que cruza el antebrazo.
 */
const MASSES: Record<LimbKind, [number, number][][]> = {
  muslo: [
    [[0.08, -0.3], [0.38, -0.46], [0.7, -0.36], [0.93, -0.12]],
    [[0.04, -0.08], [0.34, 0.24], [0.68, 0.5], [0.94, 0.56]],
    [[0.6, -0.78], [0.78, -0.74], [0.92, -0.46], [0.97, -0.18]],
  ],
  pantorrilla: [
    [[0.1, 0.16], [0.28, 0.02], [0.45, 0.2], [0.57, 0.68], [0.6, 0.96]],
    [[0.58, 0.72], [0.78, 0.42], [0.96, 0.3]],
    [[0.05, -0.7], [0.5, -0.68], [0.95, -0.52]],
  ],
  brazo: [
    [[0.02, 0.88], [0.22, 0.56], [0.42, 0.06], [0.22, -0.5], [0.02, -0.86]],
    [[0.42, -0.14], [0.68, -0.2], [0.95, -0.08]],
    [[0.6, 0.86], [0.78, 0.5], [0.92, 0.2]],
  ],
  antebrazo: [
    [[0.04, 0.72], [0.26, 0.36], [0.56, -0.1], [0.9, -0.46]],
    [[0.06, -0.58], [0.34, -0.76], [0.6, -0.56]],
  ],
};

const cross3 = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit3 = (p: V3): V3 => {
  const n = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / n, p[1] / n, p[2] / n];
};

/**
 * Contorno real de un miembro. En cada punto del hueso se propone su ancho anatómico y la
 * silueta lo corrige; lo que no se puede medir, porque otra parte lo tapa, conserva la
 * anatomía. Por eso sale un muslo y no un tubo, aunque el personaje traiga capa.
 * `inner` es el lado hacia donde se dobla la articulación: ahí va la masa del músculo.
 */
export function organicLimb(kind: LimbKind, a: V3, b: V3, radius: number, inner: 1 | -1, aspect: number, mask?: Mask): OrganicForm {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy * inner;
  const ny = ux * inner;
  const flat = ([x, y]: Pt): Pt => [x / aspect, y];
  const COUNT = 14;
  const left: number[] = [];
  const right: number[] = [];
  const stations: Pt[] = [];
  // La silueta da un solo factor para todo el miembro: seguirla punto por punto deja bultos.
  const ratios: number[] = [];
  for (let i = 0; i <= COUNT; i++) {
    const t = i / COUNT;
    const [p0, p1] = profile(kind, t);
    const w0 = radius * p0;
    const w1 = radius * p1;
    const x = a[0] + dx * t;
    const y = a[1] + dy * t;
    if (mask && i > 2 && i < COUNT - 2) {
      const seen0 = rayLength(mask, x, y, nx, ny, aspect, w0 * 2);
      const seen1 = rayLength(mask, x, y, -nx, -ny, aspect, w1 * 2);
      if (seen0 && seen1) ratios.push((seen0 + seen1) / (w0 + w1));
    }
    left.push(w0);
    right.push(w1);
    stations.push([x, y]);
  }
  ratios.sort((p, q) => p - q);
  const scale = ratios.length >= 3 ? Math.min(1.1, Math.max(0.65, ratios[ratios.length >> 1])) : 1;
  const l = smooth(left).map((v) => v * scale);
  const r = smooth(right).map((v) => v * scale);
  const sideA: Pt[] = stations.map(([x, y], i) => [x + nx * l[i], y + ny * l[i]]);
  const sideB: Pt[] = stations.map(([x, y], i) => [x - nx * r[i], y - ny * r[i]]);
  const cap = (c: Pt, from: Pt, to: Pt, out: Pt): Pt[] => [[(from[0] + to[0]) / 2 + (out[0] - c[0]) * 0.55 + (c[0] - (from[0] + to[0]) / 2), (from[1] + to[1]) / 2 + (out[1] - c[1]) * 0.55 + (c[1] - (from[1] + to[1]) / 2)]];
  const endOut: Pt = [stations[COUNT][0] + ux * r[COUNT] * 0.6, stations[COUNT][1] + uy * r[COUNT] * 0.6];
  const startOut: Pt = [stations[0][0] - ux * l[0] * 0.5, stations[0][1] - uy * l[0] * 0.5];
  const loop = [...sideA, ...cap(stations[COUNT], sideA[COUNT], sideB[COUNT], endOut), ...[...sideB].reverse(), ...cap(stations[0], sideB[0], sideA[0], startOut)];
  const rings: Pt[][] = [];
  const tilt = Math.min(1, Math.abs(b[2] - a[2]) / (length + 1e-6));
  const bulge = 0.25 + tilt * 0.5;
  for (const i of [3, 7, 11]) {
    const from = sideA[i];
    const to = sideB[i];
    const mx = (from[0] + to[0]) / 2 + ux * radius * bulge;
    const my = (from[1] + to[1]) / 2 + uy * radius * bulge;
    const ring: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const q = k / 10;
      const u = 1 - q;
      ring.push(flat([u * u * from[0] + 2 * u * q * mx + q * q * to[0], u * u * from[1] + 2 * u * q * my + q * q * to[1]]));
    }
    rings.push(ring);
  }
  // Del cilindro a los planos: cada tramo se talla en lado, frente y lado, sobre la misma
  // forma orgánica. El plano no cambia el contorno; solo dice dónde gira la superficie.
  const axis = unit3([dx, dy, b[2] - a[2]]);
  const side: V3 = [nx, ny, 0];
  const made = cross3(axis, side);
  const front: V3 = made[2] >= 0 ? made : [-made[0], -made[1], -made[2]];
  const across = (i: number, u: number): Pt => flat([sideA[i][0] + (sideB[i][0] - sideA[i][0]) * u, sideA[i][1] + (sideB[i][1] - sideA[i][1]) * u]);
  const CUTS = [0, 3, 7, 11, COUNT];
  const STRIPS: [number, number, number][] = [[0, 0.24, 1.08], [0.24, 0.76, 0], [0.76, 1, -1.08]];
  const planes: Facet[] = [];
  for (let k = 0; k + 1 < CUTS.length; k++) {
    const i = CUTS[k];
    const j = CUTS[k + 1];
    const reach = ((j - i) / COUNT) * length;
    const opens = (l[i] + r[i] - l[j] - r[j]) / 2 / (reach || 1);
    for (const [u0, u1, turn] of STRIPS) {
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const n = unit3([front[0] * cos + side[0] * sin + axis[0] * opens, front[1] * cos + side[1] * sin + axis[1] * opens, front[2] * cos + side[2] * sin + axis[2] * opens]);
      planes.push({ n, poly: [across(i, u0), across(j, u0), across(j, u1), across(i, u1)] });
    }
  }
  // Las masas no caben en un miembro que viene de frente: ahí solo se vería ruido.
  const spot = (t: number, s: number): Pt => {
    const f = Math.min(COUNT - 1e-6, Math.max(0, t * COUNT));
    const i = Math.floor(f);
    const q = f - i;
    const mid = (m: number[]) => m[i] + (m[i + 1] - m[i]) * q;
    const c: Pt = [stations[i][0] + (stations[i + 1][0] - stations[i][0]) * q, stations[i][1] + (stations[i + 1][1] - stations[i][1]) * q];
    const w = s >= 0 ? mid(l) * s : mid(r) * s;
    return flat([c[0] + nx * w, c[1] + ny * w]);
  };
  const marks = length > radius * 2.4 ? MASSES[kind].map((list) => spline(list.map(([t, s]) => spot(t, s)))) : [];
  return { outline: rounded(loop.map(flat), 1), rings, planes, marks };
}

/** Una masa redonda tallada en planos: filas de caras que siguen su giro. */
export function ellipsoidFacets(c: V3, f: { x: V3; y: V3; z: V3 }, a: number, b: number, d: number, aspect: number, bands: number, around: number): Facet[] {
  const at = (theta: number, phi: number): V3 => {
    const x = a * Math.sin(theta) * Math.cos(phi);
    const y = b * Math.cos(theta);
    const z = d * Math.sin(theta) * Math.sin(phi);
    return [c[0] + f.x[0] * x + f.y[0] * y + f.z[0] * z, c[1] + f.x[1] * x + f.y[1] * y + f.z[1] * z, c[2] + f.x[2] * x + f.y[2] * y + f.z[2] * z];
  };
  const out: Facet[] = [];
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  for (let i = 0; i < bands; i++) {
    const t0 = (i / bands) * Math.PI;
    const t1 = ((i + 1) / bands) * Math.PI;
    for (let k = 0; k < around; k++) {
      const p0 = ((k + 0.5) / around) * Math.PI * 2;
      const p1 = ((k + 1.5) / around) * Math.PI * 2;
      const tm = (t0 + t1) / 2;
      const pm = (p0 + p1) / 2;
      const nx = (Math.sin(tm) * Math.cos(pm)) / a;
      const ny = Math.cos(tm) / b;
      const nz = (Math.sin(tm) * Math.sin(pm)) / d;
      const n = unit3([f.x[0] * nx + f.y[0] * ny + f.z[0] * nz, f.x[1] * nx + f.y[1] * ny + f.z[1] * nz, f.x[2] * nx + f.y[2] * ny + f.z[2] * nz]);
      if (n[2] <= 0.02) continue;
      const poly = [at(t0, p0), at(t0, p1), at(t1, p1), at(t1, p0)].map(flat);
      out.push({ n, poly });
    }
  }
  return out;
}

/** Punto en la superficie de un elipsoide orientado: así las marcas siguen su giro. */
export function onEllipsoid(c: V3, f: { x: V3; y: V3; z: V3 }, a: number, b: number, d: number, u: number, v: number): V3 {
  const front = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  const px = u * a;
  const py = v * b;
  const pz = front * d;
  return [c[0] + f.x[0] * px + f.y[0] * py + f.z[0] * pz, c[1] + f.x[1] * px + f.y[1] * py + f.z[1] * pz, c[2] + f.x[2] * px + f.y[2] * py + f.z[2] * pz];
}

/**
 * Marcas de anatomía sobre el tronco, en proporción a la caja torácica: esternón, arco de
 * costillas y pectorales al frente; columna y omóplatos si la figura da la espalda.
 */
export function trunkMarks(c: V3, f: { x: V3; y: V3; z: V3 }, a: number, b: number, d: number, aspect: number): Pt[][] {
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const curve = (list: [number, number][]) => list.map(([u, v]) => flat(onEllipsoid(c, f, a, b, d, u, v)));
  const line = (make: (t: number) => [number, number], count = 14) => curve(Array.from({ length: count + 1 }, (_, i) => make(i / count)));
  if (f.z[2] < -0.1) {
    // De espaldas: lo que se dibuja es la columna y los dos omóplatos.
    const back = { x: f.x, y: f.y, z: [-f.z[0], -f.z[1], -f.z[2]] as V3 };
    const rear = (list: [number, number][]) => list.map(([u, v]) => flat(onEllipsoid(c, back, a, b, d, u, v)));
    return [
      rear([[0, 0.72], [0, 0.3], [0, -0.2], [0, -0.7]]),
      rear([[0.2, 0.62], [0.62, 0.5], [0.48, 0.02], [0.2, 0.62]]),
      rear([[-0.2, 0.62], [-0.62, 0.5], [-0.48, 0.02], [-0.2, 0.62]]),
    ];
  }
  const marks: Pt[][] = [];
  // Clavículas: salen de la horquilla del esternón y abren hacia cada hombro.
  for (const s of [-1, 1]) marks.push(line((t) => [s * (0.05 + t * 0.78), 0.8 + 0.1 * Math.sin(t * Math.PI) - 0.06 * t]));
  // Esternón.
  marks.push(line((t) => [0, 0.78 - t * 1.1]));
  // Arco de costillas: la V invertida donde termina la caja.
  marks.push(line((t) => [(t - 0.5) * 1.5, -0.74 + Math.abs(t - 0.5) * 0.62]));
  // Pectorales: la línea baja de cada uno.
  for (const s of [-1, 1]) marks.push(line((t) => [s * (0.05 + t * 0.72), 0.02 + 0.34 * t * t - 0.16 * Math.sin(t * Math.PI)]));
  return marks.filter((m) => m.length > 1);
}

/** Crestas de la pelvis: las dos puntas que dicen hacia dónde gira la cadera. */
export function pelvisMarks(top: V3, f: { x: V3; y: V3; z: V3 }, width: number, depth: number, aspect: number): Pt[][] {
  const flat = (p: V3): Pt => [p[0] / aspect, p[1]];
  const at = (x: number, y: number, z: number): V3 => [top[0] + f.x[0] * x + f.y[0] * y + f.z[0] * z, top[1] + f.x[1] * x + f.y[1] * y + f.z[1] * z, top[2] + f.x[2] * x + f.y[2] * y + f.z[2] * z];
  return [-1, 1].map((s) => [at(s * width * 0.96, 0, 0), at(s * width * 0.9, -width * 0.05, depth * 0.45), at(s * width * 0.5, -width * 0.42, depth * 0.72), at(0, -width * 0.72, depth * 0.78)].map(flat));
}

/** Rótula: el bloque cuadrado que corta la línea de la pierna. */
export function kneeCap(knee: V3, thighDir: Pt, r: number, aspect: number): Pt[] {
  const n = Math.hypot(thighDir[0], thighDir[1]) || 1;
  const ux = thighDir[0] / n;
  const uy = thighDir[1] / n;
  const corners: Pt[] = [[-0.62, -0.5], [0.62, -0.5], [0.78, 0.5], [-0.78, 0.5]];
  return corners.map(([s, t]): Pt => [(knee[0] + (-uy * s + ux * t) * r) / aspect, knee[1] + (ux * s + uy * t) * r]);
}
