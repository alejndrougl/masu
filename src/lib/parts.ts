import type { Pt, Rect } from './types';

/**
 * Mapa de partes de una figura: cada píxel dice qué es. Las clases son las del modelo
 * (ATR): por eso un escudo o una capa no cuentan como cuerpo, y la frontera entre la
 * camisa y el pantalón es la cintura de verdad.
 */
export interface PartMap {
  /** Dónde cae el mapa, sobre la imagen completa. */
  box: Rect;
  w: number;
  h: number;
  data: Uint8Array;
}

export const BODY = { background: 0, hat: 1, hair: 2, glasses: 3, upper: 4, skirt: 5, pants: 6, dress: 7, belt: 8, shoeL: 9, shoeR: 10, face: 11, legL: 12, legR: 13, armL: 14, armR: 15, bag: 16, scarf: 17 } as const;
export const FACE = { background: 0, skin: 1, nose: 2, glasses: 3, eyeL: 4, eyeR: 5, browL: 6, browR: 7, earL: 8, earR: 9, mouth: 10, lipU: 11, lipL: 12, hair: 13, hat: 14, earring: 15, necklace: 16, neck: 17, cloth: 18 } as const;

export type Region = 'cabeza' | 'tronco' | 'piernas' | 'pies' | 'brazos' | 'otro' | 'fondo';

const REGION: Region[] = ['fondo', 'cabeza', 'cabeza', 'cabeza', 'tronco', 'piernas', 'piernas', 'tronco', 'tronco', 'pies', 'pies', 'cabeza', 'piernas', 'piernas', 'brazos', 'brazos', 'otro', 'tronco'];

export const regionOf = (label: number): Region => REGION[label] ?? 'fondo';

/** Lleva un mapa a la resolución de una máscara del encuadre. */
export function partsInFrame(map: PartMap, rect: Rect, image: { w: number; h: number }, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const iy = ((rect.y + ((y + 0.5) / h) * rect.h) / image.h - map.box.y) / map.box.h;
    if (iy < 0 || iy >= 1) continue;
    const my = Math.floor(iy * map.h);
    for (let x = 0; x < w; x++) {
      const ix = ((rect.x + ((x + 0.5) / w) * rect.w) / image.w - map.box.x) / map.box.w;
      if (ix < 0 || ix >= 1) continue;
      out[y * w + x] = map.data[my * map.w + Math.floor(ix * map.w)];
    }
  }
  return out;
}

/** Lo que es cuerpo: la silueta sin bolsas, armas ni capas que el modelo no reconoce. */
export function bodyOnly(labels: Uint8Array, silhouette: Uint8Array): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const r = regionOf(labels[i]);
    if (silhouette[i] && r !== 'fondo' && r !== 'otro') out[i] = 1;
  }
  return out;
}

export interface Waist {
  /** Punto medio de la frontera entre tronco y piernas, normalizado. */
  c: Pt;
  /** Ancho de esa frontera, en altos de encuadre. */
  width: number;
  /** Puntos de la frontera a cada lado. */
  a: Pt;
  b: Pt;
}

/**
 * La cintura se ve: es donde termina lo de arriba y empieza lo de abajo. Con eso la pelvis
 * deja de depender de dos puntos de cadera, que en un dibujo suelen caer corridos.
 */
export function findWaist(labels: Uint8Array, w: number, h: number, aspect: number): Waist | null {
  const edge: Pt[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (regionOf(labels[i]) !== 'piernas') continue;
      const around = [labels[i - 1], labels[i + 1], labels[i - w], labels[i + w]];
      if (around.some((l) => regionOf(l) === 'tronco')) edge.push([(x + 0.5) / w, (y + 0.5) / h]);
    }
  }
  if (edge.length < 6) return null;
  const cx = edge.reduce((a, p) => a + p[0], 0) / edge.length;
  const cy = edge.reduce((a, p) => a + p[1], 0) / edge.length;
  // Dirección principal de la frontera: va de un costado al otro de la cadera.
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const [x, y] of edge) {
    const dx = (x - cx) * aspect;
    const dy = y - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const t = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  const along = edge.map(([x, y]) => (x - cx) * aspect * ux + (y - cy) * uy).sort((p, q) => p - q);
  const lo = along[Math.floor(along.length * 0.04)];
  const hi = along[Math.ceil(along.length * 0.96) - 1];
  return { c: [cx, cy], width: hi - lo, a: [cx + (lo * ux) / aspect, cy + lo * uy], b: [cx + (hi * ux) / aspect, cy + hi * uy] };
}

/**
 * El cuello: donde la cara se encuentra con la ropa. Se prefiere la cara y no el pelo,
 * porque el pelo largo cae sobre el pecho y se llevaría la frontera con él.
 */
export function findNeck(labels: Uint8Array, w: number, h: number, near: Pt, reach: number, aspect: number): Pt | null {
  const close = (x: number, y: number) => Math.hypot((x - near[0]) * aspect, y - near[1]) <= reach;
  const collect = (isHead: (l: number) => boolean) => {
    const edge: Pt[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (regionOf(labels[i]) !== 'tronco') continue;
        const px = (x + 0.5) / w;
        const py = (y + 0.5) / h;
        // El pelo largo también toca la ropa, lejos del cuello: eso no cuenta.
        if (close(px, py) && [labels[i - 1], labels[i + 1], labels[i - w], labels[i + w]].some(isHead)) edge.push([px, py]);
      }
    }
    return edge;
  };
  const face = collect((l) => l === BODY.face);
  const all = collect((l) => regionOf(l) === 'cabeza');
  if (all.length < 5) return null;
  const edge = face.length >= 5 ? face : all;
  const middle = (axis: 0 | 1) => edge.map((p) => p[axis]).sort((p, q) => p - q)[edge.length >> 1];
  return [middle(0), middle(1)];
}

/** El punto de una región más cercano a otro: por ahí entra un brazo al tronco. */
export function nearestOf(labels: Uint8Array, w: number, h: number, region: Region, to: Pt, aspect: number, keep: (x: number, y: number) => boolean = () => true): Pt | null {
  let best = Infinity;
  let at: Pt | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (regionOf(labels[y * w + x]) !== region) continue;
      const px = (x + 0.5) / w;
      const py = (y + 0.5) / h;
      if (!keep(px, py)) continue;
      const d = ((px - to[0]) * aspect) ** 2 + (py - to[1]) ** 2;
      if (d < best) {
        best = d;
        at = [px, py];
      }
    }
  }
  return at;
}

/** Centro de lo que se ve de una región, dentro de la franja que se pida. */
export function regionCenter(labels: Uint8Array, w: number, h: number, region: Region, keep: (x: number, y: number) => boolean): Pt | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (regionOf(labels[y * w + x]) !== region) continue;
      const px = (x + 0.5) / w;
      const py = (y + 0.5) / h;
      if (!keep(px, py)) continue;
      sx += px;
      sy += py;
      n++;
    }
  }
  return n < 24 ? null : [sx / n, sy / n];
}

/**
 * La cabeza en la silueta. Sirve cuando la cara no dice nada: en un traje del mismo color,
 * el modelo de caras llama piel también al hombro y al pecho. Se sube desde la cara hasta la
 * coronilla y se baja midiendo cada fila; si un borde salta de golpe es que llegó el hombro,
 * y ese lado se queda donde estaba.
 */
export function headInMask(mask: { data: Uint8Array; w: number; h: number }, seed: Pt, width: number, chin: number): Pick<HeadRead, 'c' | 'rx' | 'ry' | 'outline'> | null {
  const { data, w, h } = mask;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] > 0;
  const span = width * h;
  const reach = Math.max(2, Math.round(span * 0.7));
  const rows: { y: number; l: number; r: number }[] = [];
  let cx = Math.round(seed[0] * w);
  for (let y = Math.round(seed[1] * h); y >= 0; y--) {
    let hit = -1;
    for (let d = 0; d <= reach && hit < 0; d++) {
      if (on(cx - d, y)) hit = cx - d;
      else if (on(cx + d, y)) hit = cx + d;
    }
    if (hit < 0) break;
    let l = hit;
    let r = hit;
    while (on(l - 1, y)) l--;
    while (on(r + 1, y)) r++;
    rows.push({ y, l, r });
    if (r - l < span * 1.2) cx = Math.round((l + r) / 2);
  }
  if (rows.length < 6) return null;
  rows.reverse();
  const crown = rows[0].y;
  const jump = Math.max(2, span * 0.04);
  let L = rows[0].l;
  let R = rows[0].r;
  const clean = rows.map(({ y, l, r }) => {
    // Cerca de la coronilla el ancho crece rápido sin que nada esté mal.
    if (R - L > span * 0.5) {
      if (L - l > jump) l = L;
      if (r - R > jump) r = R;
    }
    L = l;
    R = r;
    return { y, l, r };
  });
  const bottom = chin * h;
  const upper = clean.filter((q) => q.y - crown <= (bottom - crown) * 0.62);
  const list = upper.length ? upper : clean;
  const widest = Math.max(...list.map((q) => q.r - q.l));
  if (widest < 3) return null;
  const wide = list.filter((q) => q.r - q.l >= widest * 0.85);
  const middle = wide.reduce((a, q) => a + (q.l + q.r) / 2, 0) / wide.length;
  const step = Math.max(1, Math.round(clean.length / 24));
  const kept = clean.filter((_, i) => i % step === 0);
  const outline: Pt[] = [...kept.map((q): Pt => [q.l / w, q.y / h]), ...[...kept].reverse().map((q): Pt => [q.r / w, q.y / h])];
  return { c: [(middle + 0.5) / w, (crown + bottom) / 2 / h], rx: widest / 2 / w, ry: (bottom - crown) / 2 / h, outline };
}

export interface HeadRead {
  /** Sin nariz ni boca a la vista: una máscara, un casco, o de espaldas. */
  covered: boolean;
  /** Formas reales: contorno de la cabeza y lentes de una máscara. */
  outline: Pt[] | null;
  lenses: Pt[][];
  /** Centro y radios de la cabeza leída. */
  c: Pt;
  rx: number;
  ry: number;
}

/** Contorno de una región por rayos desde su centro: basta para una forma compacta. */
function radialOutline(on: (x: number, y: number) => boolean, w: number, h: number, cx: number, cy: number, count = 48): Pt[] {
  const out: Pt[] = [];
  const far = Math.hypot(w, h);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let last = 0;
    // Un hueco largo corta el rayo: lo que sigue detrás ya es otra cosa.
    for (let r = 0; r < far; r += 1) {
      const x = Math.round(cx + dx * r);
      const y = Math.round(cy + dy * r);
      if (x < 0 || y < 0 || x >= w || y >= h || r - last > 5) break;
      if (on(x, y)) last = r;
    }
    out.push([cx + dx * last, cy + dy * last]);
  }
  return out;
}

/**
 * Lentes de una máscara por contraste: lo que dentro de la cabeza se aparta mucho de su tono.
 * El modelo de caras los encuentra a medias, y dos manchas blancas sobre rojo no tienen duda.
 * Se piden dos, a la misma altura y en la franja de los ojos.
 */
export function lensesByContrast(head: Pick<HeadRead, 'c' | 'rx' | 'ry'>, luma: (p: Pt) => number, size = 72): Pt[][] {
  const { c, rx, ry } = head;
  const cell = (x: number, y: number): Pt => [c[0] - rx + ((x + 0.5) / size) * rx * 2, c[1] - ry + ((y + 0.5) / size) * ry * 2];
  const inside = (x: number, y: number) => ((x + 0.5) / size - 0.5) ** 2 * 4 + ((y + 0.5) / size - 0.5) ** 2 * 4 <= 1;
  const values: number[] = [];
  const grid = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = luma(cell(x, y));
      grid[y * size + x] = v;
      if (inside(x, y)) values.push(v);
    }
  }
  if (values.length < 20) return [];
  values.sort((p, q) => p - q);
  const middle = values[values.length >> 1];
  const seen = new Uint8Array(size * size);
  const blobs: { pts: [number, number][]; x: number; y: number }[] = [];
  for (let start = 0; start < size * size; start++) {
    const sx = start % size;
    const sy = (start / size) | 0;
    if (seen[start] || !inside(sx, sy) || grid[start] - middle < 0.27) continue;
    const stack = [start];
    seen[start] = 1;
    const pts: [number, number][] = [];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % size;
      const y = (i / size) | 0;
      pts.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = x + dx;
        const v = y + dy;
        if (u < 0 || v < 0 || u >= size || v >= size) continue;
        const j = v * size + u;
        if (!seen[j] && inside(u, v) && grid[j] - middle >= 0.27) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (pts.length < size * size * 0.004) continue;
    blobs.push({ pts, x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length });
  }
  const band = blobs.filter((b) => b.y > size * 0.2 && b.y < size * 0.8).sort((p, q) => q.pts.length - p.pts.length);
  if (band.length < 2) return [];
  const [a, b] = band;
  if (Math.abs(a.y - b.y) > size * 0.2 || Math.abs(a.x - b.x) < size * 0.12) return [];
  // Contorno de cada mancha: su caja de filas basta para medir centro y ancho.
  return [a, b].map(({ pts }) => {
    const rows = new Map<number, [number, number]>();
    for (const [x, y] of pts) {
      const r = rows.get(y);
      rows.set(y, r ? [Math.min(r[0], x), Math.max(r[1], x)] : [x, x]);
    }
    const ys = [...rows.keys()].sort((p, q) => p - q);
    return [...ys.map((y) => cell(rows.get(y)![0], y)), ...[...ys].reverse().map((y) => cell(rows.get(y)![1], y))];
  });
}

/** Lee la cabeza en su mapa de partes: qué hay y cuál es su forma real. */
export function readHead(map: PartMap): HeadRead | null {
  const { data, w, h, box } = map;
  const count = new Array<number>(19).fill(0);
  let sx = 0;
  let sy = 0;
  let n = 0;
  const isHead = (l: number) => l === FACE.skin || l === FACE.nose || l === FACE.glasses || l === FACE.eyeL || l === FACE.eyeR || l === FACE.browL || l === FACE.browR || l === FACE.mouth || l === FACE.lipU || l === FACE.lipL || l === FACE.hair || l === FACE.hat || l === FACE.earL || l === FACE.earR;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = data[y * w + x];
      count[l]++;
      if (isHead(l)) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < w * h * 0.04) return null;
  const skin = count[FACE.skin];
  const hasNose = count[FACE.nose] > skin * 0.012;
  const hasMouth = count[FACE.mouth] + count[FACE.lipU] + count[FACE.lipL] > skin * 0.006;
  const toImage = ([x, y]: Pt): Pt => [box.x + (x / w) * box.w, box.y + (y / h) * box.h];
  const cx = sx / n;
  const cy = sy / n;
  const outline = radialOutline((x, y) => isHead(data[y * w + x]), w, h, cx, cy).map(toImage);
  const lenses: Pt[][] = [];
  // Dos lentes como los de una máscara: se separan por el lado de la cabeza en que caen.
  for (const side of [-1, 1]) {
    let lx = 0;
    let ly = 0;
    let m = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[y * w + x] === FACE.glasses && (x - cx) * side > 0) {
          lx += x;
          ly += y;
          m++;
        }
      }
    }
    if (m < w * h * 0.004) continue;
    const ox = lx / m;
    const oy = ly / m;
    lenses.push(radialOutline((x, y) => data[y * w + x] === FACE.glasses && (x - cx) * side > 0, w, h, ox, oy, 28).map(toImage));
  }
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const lensArea = count[FACE.glasses];
  return {
    // Unos lentes grandes sin boca a la vista no son lentes: es una máscara.
    covered: !hasMouth && (!hasNose || lensArea > skin * 0.08),
    outline,
    lenses,
    c: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
    rx: (Math.max(...xs) - Math.min(...xs)) / 2,
    ry: (Math.max(...ys) - Math.min(...ys)) / 2,
  };
}
