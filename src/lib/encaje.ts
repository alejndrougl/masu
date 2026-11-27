import { convexHull } from './composition';
import { blur, canny, linkEdges, maskContours, massContours, polygonArea, simplifyLine } from './edges';
import type { Block } from './mannequin';
import type { Pt, Stroke, StrokeStage } from './types';
import { tr } from '../i18n';

export interface EncajeFigure {
  mask: Uint8Array;
  blocks: Block[];
}

export interface EncajeInput {
  L: Uint8Array;
  w: number;
  h: number;
  figures: EncajeFigure[];
  /** Cercanía por píxel, a la misma resolución. Sus saltos son los traslapes. */
  depth?: Float32Array | null;
  /** Línea artística a la misma resolución: 0 tinta, 255 papel. */
  art?: Uint8Array | null;
}

/** Deja un polígono en pocos lados quitando el vértice que menos cambia el área. */
export function fewSides(poly: Pt[], sides: number): Pt[] {
  const p = [...poly];
  const cost = (i: number) => {
    const a = p[(i - 1 + p.length) % p.length];
    const b = p[i];
    const c = p[(i + 1) % p.length];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  };
  while (p.length > sides) {
    let best = 0;
    let low = Infinity;
    for (let i = 0; i < p.length; i++) {
      const v = cost(i);
      if (v < low) {
        low = v;
        best = i;
      }
    }
    p.splice(best, 1);
  }
  return p;
}

/**
 * Recorre un contorno cerrado con el menor número de rectas que no se alejen de él más
 * de `eps`. Busca el camino más corto en vez de partir por el punto más lejano, por eso
 * las rectas salen largas y los quiebres caen en las esquinas de verdad, como a mano.
 */
export function angularLoop(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 12) return loop;
  const step = Math.max(1, Math.floor(loop.length / 700));
  let raw = loop.filter((_, i) => i % step === 0);
  // Quita la escalera de píxeles.
  raw = raw.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let d = -2; d <= 2; d++) {
      const q = raw[(i + d + raw.length) % raw.length];
      x += q[0];
      y += q[1];
    }
    return [x / 5, y / 5];
  });
  const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length;
  const cy = raw.reduce((s, p) => s + p[1], 0) / raw.length;
  let start = 0;
  let far = -1;
  raw.forEach(([x, y], i) => {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d > far) {
      far = d;
      start = i;
    }
  });
  const n = raw.length;
  const pts = Array.from({ length: n + 1 }, (_, i) => raw[(start + i) % n]);
  const cost = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  cost[0] = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(cost[i])) continue;
    // Cuña de direcciones que pasan a menos de eps de todos los puntos vistos.
    let lo = -Infinity;
    let hi = Infinity;
    let base = 0;
    let based = false;
    for (let j = i + 1; j <= n; j++) {
      const dx = pts[j][0] - pts[i][0];
      const dy = pts[j][1] - pts[i][1];
      const d = Math.hypot(dx, dy);
      if (d < eps) continue;
      let t = Math.atan2(dy, dx);
      if (!based) {
        base = t;
        based = true;
      }
      t -= base;
      while (t > Math.PI) t -= 2 * Math.PI;
      while (t < -Math.PI) t += 2 * Math.PI;
      const open = Math.asin(Math.min(1, eps / d));
      if (t >= lo && t <= hi) {
        const c = cost[i] + 1;
        if (c < cost[j]) {
          cost[j] = c;
          from[j] = i;
        }
      }
      lo = Math.max(lo, t - open);
      hi = Math.min(hi, t + open);
      if (lo > hi) break;
    }
    if (!Number.isFinite(cost[i + 1])) {
      cost[i + 1] = cost[i] + 1;
      from[i + 1] = i;
    }
  }
  const out: Pt[] = [];
  for (let at = n; at > 0; at = from[at]) out.push(pts[at]);
  return out.reverse();
}

/**
 * Un contorno en pocas rectas: sube la tolerancia hasta que no pase de `max` vértices. Un encaje
 * a mano son decenas de trazos como mucho; más que eso ya es calcar la orilla.
 */
export function budgetLoop(loop: Pt[], max: number, eps: number): Pt[] {
  let e = eps;
  let out = angularLoop(loop, e);
  for (let i = 0; i < 12 && out.length > max; i++) {
    e *= 1.35;
    out = angularLoop(loop, e);
  }
  return out.length > max ? fewSides(out, max) : out;
}

/** Vértices permitidos al contorno principal y a cada contorno menor. */
export const SILHOUETTE_SIDES = { main: 36, minor: 10 };

function segmentDistance(px: number, py: number, b: Block, aspect: number): number {
  const ax = b.a[0] * aspect;
  const ay = b.a[1];
  const dx = b.b[0] * aspect - ax;
  const dy = b.b[1] - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const r = b.ra + (b.rb - b.ra) * t;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t) / Math.max(r, 1e-4);
}

/**
 * Un recorte puede dejar fuera un brazo entero, sobre todo en bocetos. Si el eje de una
 * parte cae casi todo fuera de la silueta, esa parte se agrega con su forma aproximada.
 */
export function completeMask(mask: Uint8Array, w: number, h: number, blocks: Block[]): Uint8Array {
  const aspect = w / h;
  const missing = blocks.filter((b) => {
    let inside = 0;
    for (let t = 0; t <= 8; t++) {
      const x = Math.floor((b.a[0] + (b.b[0] - b.a[0]) * (t / 8)) * w);
      const y = Math.floor((b.a[1] + (b.b[1] - b.a[1]) * (t / 8)) * h);
      if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) inside++;
    }
    return inside < 4;
  });
  if (!missing.length) return mask;
  const out = Uint8Array.from(mask);
  for (const b of missing) {
    const reach = Math.max(b.ra, b.rb);
    const x0 = Math.max(0, Math.floor((Math.min(b.a[0], b.b[0]) - reach / aspect) * w));
    const x1 = Math.min(w - 1, Math.ceil((Math.max(b.a[0], b.b[0]) + reach / aspect) * w));
    const y0 = Math.max(0, Math.floor((Math.min(b.a[1], b.b[1]) - reach) * h));
    const y1 = Math.min(h - 1, Math.ceil((Math.max(b.a[1], b.b[1]) + reach) * h));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (segmentDistance(((x + 0.5) / w) * aspect, (y + 0.5) / h, b, aspect) <= 0.95) out[y * w + x] = 1;
      }
    }
  }
  return out;
}

/** Reparte cada punto de la silueta en la parte más cercana: lo que sobra son objetos. */
function assign(mask: Uint8Array, w: number, h: number, blocks: Block[]): Int16Array {
  const aspect = w / h;
  const label = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const px = ((x + 0.5) / w) * aspect;
      const py = (y + 0.5) / h;
      let best = -1;
      let low = 1.75;
      for (let k = 0; k < blocks.length; k++) {
        const d = segmentDistance(px, py, blocks[k], aspect);
        if (d < low) {
          low = d;
          best = k;
        }
      }
      label[i] = best < 0 ? -2 : best;
    }
  }
  return label;
}

function components(flags: Uint8Array, w: number, h: number): { pts: Pt[]; size: number }[] {
  const seen = new Uint8Array(w * h);
  const out: { pts: Pt[]; size: number }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < flags.length; s++) {
    if (!flags[s] || seen[s]) continue;
    const pts: Pt[] = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      pts.push([x, y]);
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (q >= 0 && flags[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    out.push({ pts, size: pts.length });
  }
  return out.sort((a, b) => b.size - a.size);
}

const SIDES: Record<string, number> = { Cabeza: 8, Tronco: 7, Mano: 5, Pie: 5 };

/** Bloques por parte, cada uno un polígono convexo de pocos lados. */
function blocksOf(fig: EncajeFigure, w: number, h: number, area: number, push: (pts: Pt[], stage: StrokeStage, closed: boolean, name?: string) => void) {
  const label = assign(fig.mask, w, h, fig.blocks);
  const groups = new Map<number, Pt[]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = label[y * w + x];
      if (k < 0) continue;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push([x, y]);
    }
  }
  const ordered = [...groups.keys()].sort((a, b) => fig.blocks[a].order - fig.blocks[b].order);
  for (const k of ordered) {
    const pts = groups.get(k)!;
    if (pts.length < area * 0.004) continue;
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const b = fig.blocks[k];
    const word = b.name.split(' ')[0];
    push(fewSides(hull, Object.entries(SIDES).find(([k]) => k === word || tr(k) === word)?.[1] ?? 5), 2, true, b.name);
  }
  const rest = new Uint8Array(w * h);
  for (let i = 0; i < rest.length; i++) rest[i] = label[i] === -2 ? 1 : 0;
  for (const c of components(rest, w, h).slice(0, 6)) {
    if (c.size < area * 0.012) continue;
    const hull = convexHull(c.pts);
    if (hull.length >= 3) push(fewSides(hull, 6), 2, true, 'Objeto');
  }
}

/**
 * Las cuatro etapas de un encaje, de lo general a lo particular:
 * 1 envolvente · 2 bloques por parte · 3 contorno en rectas · 4 traslapes y valores.
 */
export function buildEncaje({ L, w, h, figures, depth, art }: EncajeInput): Stroke[] {
  const gray = Float32Array.from(L);
  const diag = Math.hypot(w, h);
  const area = w * h;
  const strokes: Stroke[] = [];
  const norm = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x / w, y / h]);
  const push = (pts: Pt[], stage: StrokeStage, closed: boolean, name?: string) => {
    if (pts.length >= 2) strokes.push({ pts: norm(pts), stage, closed, name });
  };
  const sorted = Float32Array.from(gray).sort();
  const q = (p: number) => sorted[Math.floor(sorted.length * p)];

  const useful = figures.map((f) => ({ ...f, mask: f.blocks.length ? completeMask(f.mask, w, h, f.blocks) : f.mask })).filter((f) => {
    let n = 0;
    for (let i = 0; i < f.mask.length; i++) n += f.mask[i] ? 1 : 0;
    return n > area * 0.004;
  });

  if (!useful.length) {
    for (const loop of massContours(gray, w, h, diag * 0.012, [q(0.5)], area * 0.015, diag * 0.012).slice(0, 5)) push(angularLoop(loop, diag * 0.012), 1, true);
    for (const loop of massContours(gray, w, h, diag * 0.006, [q(0.33), q(0.66)], area * 0.004, diag * 0.005).slice(0, 14)) push(angularLoop(loop, diag * 0.006), 2, true);
  }

  useful.forEach((fig, index) => {
    const loops = maskContours(fig.mask, w, h)
      .map((l) => ({ l, a: polygonArea(l) }))
      .filter((o) => o.a > area * 0.0015)
      .sort((p, r) => r.a - p.a);
    if (!loops.length) return;
    const size = Math.sqrt(loops[0].a);

    // Etapa 1: rectas largas que encierran todo. Se numeran de la más larga a la más corta.
    const edge: Pt[] = [];
    for (const { l } of loops) for (let i = 0; i < l.length; i += 2) edge.push(l[i]);
    const hull = fewSides(convexHull(edge), 8);
    const sides = hull
      .map((p, i) => ({ a: p, b: hull[(i + 1) % hull.length] }))
      .sort((p, r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) - Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
    for (const s of sides) strokes.push({ pts: norm([s.a, s.b]), stage: 1, closed: false, name: index === 0 ? 'Envolvente' : undefined });

    // Etapa 2: cada parte, un bloque.
    if (fig.blocks.length) blocksOf(fig, w, h, polygonArea(loops[0].l), push);
    else push(fewSides(convexHull(edge), 6), 2, true, 'Forma');

    // Etapa 3: la silueta real, en rectas.
    // Pocas rectas y cerrada: el contorno principal con a lo más 36 lados, los menores con 10.
    loops.forEach(({ l, a }, k) => {
      if (a > loops[0].a * 0.03 || k === 0) push(budgetLoop(l, k === 0 ? SILHOUETTE_SIDES.main : SILHOUETTE_SIDES.minor, Math.max(1.4, size * 0.016)), 3, true, k === 0 ? 'Silueta' : undefined);
    });
  });

  // Etapa 4: dentro de cada figura, los traslapes (saltos de profundidad) y las masas de valor.
  const inside = new Uint8Array(w * h);
  for (const f of useful) for (let i = 0; i < inside.length; i++) if (f.mask[i]) inside[i] = 1;
  const anyFigure = useful.length > 0;
  if (anyFigure) {
    const shrink = Math.max(2, Math.round(diag * 0.006));
    const core = erode(inside, w, h, shrink);
    if (depth) {
      const scaled = new Float32Array(w * h);
      for (let i = 0; i < scaled.length; i++) scaled[i] = depth[i] * 255;
      const jumps = canny(blur(scaled, w, h, diag * 0.0016), w, h, 0.1);
      for (let i = 0; i < jumps.length; i++) if (!core[i]) jumps[i] = 0;
      for (const line of linkEdges(jumps, w, h, diag * 0.022).sort((a, b) => lengthOf(b) - lengthOf(a)).slice(0, 40)) {
        push(simplifyLine(line, diag * 0.003), 4, false, 'Traslape');
      }
    }
    if (art) {
      const inked = new Uint8Array(w * h);
      for (let i = 0; i < inked.length; i++) inked[i] = core[i] && art[i] < 150 ? 1 : 0;
      const thin = thinned(inked, w, h);
      for (const line of linkEdges(thin, w, h, diag * 0.018).sort((a, b) => lengthOf(b) - lengthOf(a)).slice(0, 70)) {
        push(simplifyLine(line, diag * 0.0022), 4, false, 'Línea');
      }
    }
    const flat = Float32Array.from(gray);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < flat.length; i++) {
      if (core[i]) {
        sum += flat[i];
        n++;
      }
    }
    const mean = n ? sum / n : 128;
    const values: number[] = [];
    for (let i = 0; i < flat.length; i++) {
      if (core[i]) values.push(flat[i]);
      else flat[i] = mean;
    }
    values.sort((a, b) => a - b);
    const cut = values[Math.floor(values.length * 0.33)] ?? mean;
    for (const loop of massContours(flat, w, h, diag * 0.004, [cut], area * 0.001, diag * 0.004).slice(0, 18)) push(angularLoop(loop, diag * 0.004), 4, true, 'Valor');
  } else if (q(0.5) > 225) {
    // Papel y tinta: los bordes de un trazo grueso darían dos líneas donde hay una.
    const inked = new Uint8Array(w * h);
    const cut = q(0.5) * 0.74;
    for (let i = 0; i < inked.length; i++) inked[i] = gray[i] < cut ? 1 : 0;
    const center = thinned(inked, w, h);
    for (const line of linkEdges(center, w, h, diag * 0.012).sort((a, b) => lengthOf(b) - lengthOf(a)).slice(0, 260)) push(simplifyLine(line, diag * 0.0012), 3, false);
  } else {
    const shapes = canny(blur(gray, w, h, diag * 0.0028), w, h, 0.1);
    for (const line of linkEdges(shapes, w, h, diag * 0.03).sort((a, b) => lengthOf(b) - lengthOf(a)).slice(0, 80)) push(simplifyLine(line, diag * 0.0018), 3, false);
    const detail = canny(blur(gray, w, h, diag * 0.001), w, h, 0.14);
    for (const line of linkEdges(detail, w, h, diag * 0.012).sort((a, b) => lengthOf(b) - lengthOf(a)).slice(0, 220)) push(simplifyLine(line, diag * 0.0009), 4, false);
  }
  return strokes;
}

function lengthOf(p: Pt[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return n;
}

/** Adelgazamiento de Zhang y Suen: de una mancha de tinta queda su trazo de un píxel. */
function thinned(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(mask);
  let changed = true;
  let rounds = 0;
  while (changed && rounds++ < 12) {
    changed = false;
    for (const pass of [0, 1]) {
      const kill: number[] = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!out[i]) continue;
          const p = [out[i - w], out[i - w + 1], out[i + 1], out[i + w + 1], out[i + w], out[i + w - 1], out[i - 1], out[i - w - 1]];
          const b = p.reduce((a, v) => a + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          const first = pass ? p[0] * p[2] * p[6] : p[0] * p[2] * p[4];
          const second = pass ? p[0] * p[4] * p[6] : p[2] * p[4] * p[6];
          if (!first && !second) kill.push(i);
        }
      }
      for (const i of kill) out[i] = 0;
      if (kill.length) changed = true;
    }
  }
  return out;
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        next[i] = cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w] ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

