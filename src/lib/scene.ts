import { maskContours, polygonArea, simplifyLoop } from './edges';
import { distanceToEdge } from './gesture';
import type { Pt } from './types';

/**
 * Una escena también se construye por pasos. Un paisaje no tiene huesos, pero sí tiene lo que
 * un pintor busca primero: unas pocas masas grandes de valor y color, y cómo se acomodan. Se
 * agrupan los colores que de verdad hay y se reparten en formas, de lo simple a lo detallado.
 */
export interface SceneMass {
  /** Color medio de la masa. */
  color: [number, number, number];
  /** Valor de 0 a 1: el orden en que un pintor la bloquearía. */
  value: number;
  /** Fracción del cuadro. */
  area: number;
  /** Elipse que la resume: el paso más simple. */
  ellipse: { c: Pt; rx: number; ry: number; angle: number };
  /** La masa en un bloque de muy pocos lados: lo primero que se traza. */
  block: Pt[];
  /** Pocas rectas. */
  poly: Pt[];
  /** Más rectas: la forma ya casi completa, sin dejar de ser rectas. */
  fine: Pt[];
  /** Su forma real. */
  loop: Pt[];
  /** Lo que abarca con sus huecos incluidos: decide quién se pinta antes. */
  reach: number;
}

export interface SceneModel {
  masses: SceneMass[];
  /** Es un dibujo a línea sobre papel: no tiene masas de valor que bloquear. */
  line: boolean;
}

const SIDE = 240;

function shrink(rgba: Uint8ClampedArray, w: number, h: number) {
  const k = Math.min(1, SIDE / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * k));
  const sh = Math.max(8, Math.round(h * k));
  const out = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y / sh) * h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) / sh) * h));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x / sw) * w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) / sw) * w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      }
      const o = (y * sw + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { data: out, w: sw, h: sh };
}

/** Grupos de color, repartidos desde el oscuro hasta el claro. */
function groups(data: Float32Array, count: number): Uint8Array {
  const n = data.length / 3;
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => data[p * 3] + data[p * 3 + 1] + data[p * 3 + 2] - data[q * 3] - data[q * 3 + 1] - data[q * 3 + 2]);
  const centers: number[][] = [];
  for (let k = 0; k < count; k++) {
    const i = order[Math.floor(((k + 0.5) / count) * n)];
    centers.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
  }
  const label = new Uint8Array(n);
  for (let round = 0; round < 10; round++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let least = Infinity;
      for (let k = 0; k < count; k++) {
        const c = centers[k];
        const d = (data[i * 3] - c[0]) ** 2 + (data[i * 3 + 1] - c[1]) ** 2 + (data[i * 3 + 2] - c[2]) ** 2;
        if (d < least) {
          least = d;
          best = k;
        }
      }
      label[i] = best;
      const s = sum[best];
      s[0] += data[i * 3];
      s[1] += data[i * 3 + 1];
      s[2] += data[i * 3 + 2];
      s[3]++;
    }
    sum.forEach((s, k) => {
      if (s[3]) centers[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  return label;
}

/** Quita motas: cada punto toma el grupo que más hay a su alrededor. */
function calm(label: Uint8Array, w: number, h: number, count: number, reach: number): Uint8Array {
  let cur = label;
  for (let round = 0; round < 3; round++) {
    const next = new Uint8Array(cur.length);
    const votes = new Uint16Array(count);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        votes.fill(0);
        for (let dy = -reach; dy <= reach; dy++) {
          const qy = y + dy;
          if (qy < 0 || qy >= h) continue;
          for (let dx = -reach; dx <= reach; dx++) {
            const qx = x + dx;
            if (qx >= 0 && qx < w) votes[cur[qy * w + qx]]++;
          }
        }
        let best = cur[y * w + x];
        for (let k = 0; k < count; k++) if (votes[k] > votes[best]) best = k;
        next[y * w + x] = best;
      }
    }
    cur = next;
  }
  return cur;
}

/** Piezas conectadas de cada grupo; las chicas se funden con su vecina más grande. */
function pieces(label: Uint8Array, w: number, h: number, least: number): { id: Int32Array; sizes: number[] } {
  const id = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < id.length; s++) {
    if (id[s] >= 0) continue;
    const mine = sizes.length;
    let size = 0;
    id[s] = mine;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < id.length && id[j] < 0 && label[j] === label[s]) {
          id[j] = mine;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  // De la más chica a la más grande: cada una entrega sus puntos a quien más la rodea.
  const order = sizes.map((_, i) => i).sort((p, q) => sizes[p] - sizes[q]);
  const into = sizes.map((_, i) => i);
  const root = (i: number): number => (into[i] === i ? i : (into[i] = root(into[i])));
  for (const small of order) {
    if (sizes[root(small)] >= least) continue;
    const touching = new Map<number, number>();
    for (let i = 0; i < id.length; i++) {
      if (root(id[i]) !== small) continue;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= id.length) continue;
        const other = root(id[j]);
        if (other !== small) touching.set(other, (touching.get(other) ?? 0) + 1);
      }
    }
    let best = -1;
    let most = 0;
    for (const [other, n] of touching) {
      if (n > most) {
        most = n;
        best = other;
      }
    }
    if (best >= 0) {
      into[small] = best;
      sizes[best] += sizes[small];
    }
  }
  for (let i = 0; i < id.length; i++) id[i] = root(id[i]);
  return { id, sizes };
}

/** Quita de una máscara los brazos delgados: son los que acaban en picos al simplificar. */
function openMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const inner = distanceToEdge(mask, w, h);
  const core = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (inner[i] > radius * 3) core[i] = 1;
  const outer = distanceToEdge(core.map((v) => (v ? 0 : 1)), w, h);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i] && outer[i] <= (radius + 1) * 3) out[i] = 1;
  return out;
}

/** Un trazo de encaje: recto y sin púas. Un ángulo muy cerrado casi siempre es un resto. */
function blockLoop(outline: Pt[], tolerance: number, area: number): Pt[] {
  let poly = simplifyLoop(outline, tolerance);
  for (let round = 0; round < 12 && poly.length > 4; round++) {
    let worst = -1;
    let least = 0.85;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i - 1 + poly.length) % poly.length];
      const b = poly[i];
      const c = poly[(i + 1) % poly.length];
      const u: Pt = [a[0] - b[0], a[1] - b[1]];
      const v: Pt = [c[0] - b[0], c[1] - b[1]];
      const k = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1);
      const angle = Math.acos(Math.max(-1, Math.min(1, k)));
      // Un pico grande es forma real, como la punta de un edificio; solo se quitan los restos.
      const size = Math.abs(u[0] * v[1] - u[1] * v[0]) / 2;
      if (angle < least && size < area * 0.02) {
        least = angle;
        worst = i;
      }
    }
    if (worst < 0) break;
    poly = poly.filter((_, i) => i !== worst);
  }
  return poly;
}

/**
 * Endereza las orillas de un polígono hacia las fugas: en un edificio el borde de una masa no es
 * cualquier línea, corre hacia su punto. Solo se tocan las que ya casi iban para allá.
 */
export function snapEdges(poly: Pt[], points: Pt[], aspect: number, limit = 0.2): Pt[] {
  if (!points.length || poly.length < 3) return poly;
  const n = poly.length;
  const P = poly.map(([x, y]): Pt => [x * aspect, y]);
  const lines = P.map((a, i) => {
    const b = P[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    let dir: Pt = [dx / len, dy / len];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (len > 0.04) {
      let best = limit;
      for (const [vx, vy] of points) {
        const ux = vx * aspect - mid[0];
        const uy = vy - mid[1];
        const m = Math.hypot(ux, uy) || 1;
        const off = Math.acos(Math.min(1, Math.abs((ux * dx + uy * dy) / (m * len))));
        if (off < best) {
          best = off;
          dir = [ux / m, uy / m];
        }
      }
    }
    return { mid, dir };
  });
  return P.map((p, i): Pt => {
    const a = lines[(i - 1 + n) % n];
    const b = lines[i];
    const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(cross) < 0.08) return poly[i];
    const t = ((b.mid[0] - a.mid[0]) * b.dir[1] - (b.mid[1] - a.mid[1]) * b.dir[0]) / cross;
    const x = a.mid[0] + a.dir[0] * t;
    const y = a.mid[1] + a.dir[1] * t;
    // Si el cruce se va lejos se deja la esquina donde estaba.
    if (Math.hypot(x - p[0], y - p[1]) > 0.05) return poly[i];
    return [x / aspect, y];
  });
}

export function buildScene(rgba: Uint8ClampedArray, w: number, h: number, count = 6): SceneModel {
  const small = shrink(rgba, w, h);
  const { data, w: sw, h: sh } = small;
  const label = calm(groups(data, count), sw, sh, count, 2);
  const area = sw * sh;
  const { id } = pieces(label, sw, sh, area * 0.008);
  const lists = new Map<number, number[]>();
  for (let i = 0; i < id.length; i++) {
    const list = lists.get(id[i]);
    if (list) list.push(i);
    else lists.set(id[i], [i]);
  }
  const aspect = sw / sh;
  const masses: SceneMass[] = [];
  for (const list of lists.values()) {
    if (list.length < area * 0.004) continue;
    let r = 0;
    let g = 0;
    let b = 0;
    let mx = 0;
    let my = 0;
    for (const i of list) {
      r += data[i * 3];
      g += data[i * 3 + 1];
      b += data[i * 3 + 2];
      mx += i % sw;
      my += Math.floor(i / sw);
    }
    const n = list.length;
    mx /= n;
    my /= n;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const i of list) {
      const dx = (i % sw) - mx;
      const dy = Math.floor(i / sw) - my;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
    xx /= n;
    yy /= n;
    xy /= n;
    const gap = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
    const major = Math.sqrt(Math.max(0, (xx + yy) / 2 + gap)) * 2;
    const minor = Math.sqrt(Math.max(0, (xx + yy) / 2 - gap)) * 2;
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const mask = new Uint8Array(area);
    for (const i of list) mask[i] = 1;
    const outline = maskContours(mask, sw, sh).sort((p, q) => q.length - p.length)[0];
    if (!outline || outline.length < 6) continue;
    const toFrame = ([x, y]: Pt): Pt => [x / sw, y / sh];
    // Los brazos delgados de una masa se quedan para el contorno fino, no para el bloque.
    const opened = openMask(mask, sw, sh, Math.max(1.5, Math.sqrt(n) * 0.05));
    const clean = maskContours(opened, sw, sh).sort((p, q) => q.length - p.length)[0];
    const base = clean && clean.length >= 6 ? clean : outline;
    const color: [number, number, number] = [r / n, g / n, b / n];
    masses.push({
      color,
      value: (color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11) / 255,
      area: n / area,
      ellipse: { c: [mx / sw, my / sh], rx: major / sw, ry: minor / sh, angle },
      block: blockLoop(base, Math.max(4, Math.sqrt(n) * 0.2), n).map(toFrame),
      poly: blockLoop(base, Math.max(2.5, Math.sqrt(n) * 0.08), n).map(toFrame),
      fine: blockLoop(outline, Math.max(1.4, Math.sqrt(n) * 0.03), n).map(toFrame),
      loop: simplifyLoop(outline, 0.7).map(toFrame),
      reach: Math.abs(polygonArea(outline)) / area,
    });
  }
  void aspect;
  // Papel casi vacío y líneas finas: la mayoría de los puntos valen lo mismo y son claros.
  const counts = new Uint32Array(26);
  for (let i = 0; i < sw * sh; i++) counts[Math.floor(((data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3 / 256) * 26)]++;
  const paper = counts[24] + counts[25];
  // De lo que abarca más a lo que abarca menos: lo que está dentro de otra masa se pinta después.
  return { masses: masses.sort((p, q) => q.reach - p.reach), line: paper / (sw * sh) > 0.5 };
}
