import type { DominantLine, Pt } from './types';

/** Desenfoque casi gaussiano con tres pasadas de caja, O(n) para cualquier radio. */
export function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.4) return Float32Array.from(src);
  const r = Math.max(1, Math.round(((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)));
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  b = a;
  return b;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) sum += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = src[x] * (r + 1);
    for (let y = 1; y <= r; y++) sum += src[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
    }
  }
}

/** Canny con umbrales automáticos: devuelve bordes de un píxel de ancho. */
export function canny(gray: Float32Array, w: number, h: number, keep = 0.12): Uint8Array {
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      const a = (Math.atan2(gy, gx) * 180) / Math.PI;
      const d = (a + 180) % 180;
      dir[i] = d < 22.5 || d >= 157.5 ? 0 : d < 67.5 ? 1 : d < 112.5 ? 2 : 3;
    }
  }
  const thin = new Float32Array(w * h);
  const stepOf = [1, w + 1, w, w - 1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const s = stepOf[dir[i]];
      if (mag[i] >= mag[i + s] && mag[i] >= mag[i - s]) thin[i] = mag[i];
    }
  }
  const values: number[] = [];
  for (let i = 0; i < thin.length; i += 3) if (thin[i] > 1) values.push(thin[i]);
  if (!values.length) return new Uint8Array(w * h);
  values.sort((p, q) => p - q);
  const high = Math.max(6, values[Math.floor(values.length * (1 - keep))]);
  const low = high * 0.45;
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= high && !out[i]) {
      out[i] = 1;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        for (const o of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) {
          const q = p + o;
          if (q >= 0 && q < thin.length && !out[q] && thin[q] >= low) {
            out[q] = 1;
            stack.push(q);
          }
        }
      }
    }
  }
  return out;
}

/** Encadena píxeles de borde en trazos. */
export function linkEdges(edges: Uint8Array, w: number, h: number, minLength: number): Pt[][] {
  const seen = new Uint8Array(w * h);
  const offsets = [1, w + 1, w, w - 1, -1, -w - 1, -w, -w + 1];
  const degree = (i: number) => {
    let c = 0;
    for (const o of offsets) {
      const q = i + o;
      if (q >= 0 && q < edges.length && edges[q] && !seen[q]) c++;
    }
    return c;
  };
  const lines: Pt[][] = [];
  const walk = (start: number) => {
    const line: Pt[] = [];
    let cur = start;
    for (;;) {
      seen[cur] = 1;
      line.push([cur % w, Math.floor(cur / w)]);
      let next = -1;
      for (const o of offsets) {
        const q = cur + o;
        if (q >= 0 && q < edges.length && edges[q] && !seen[q]) {
          next = q;
          break;
        }
      }
      if (next < 0) break;
      cur = next;
    }
    if (line.length >= minLength) lines.push(line);
  };
  for (let i = 0; i < edges.length; i++) if (edges[i] && !seen[i] && degree(i) === 1) walk(i);
  for (let i = 0; i < edges.length; i++) if (edges[i] && !seen[i]) walk(i);
  return lines;
}

/** Ramer–Douglas–Peucker: quita puntos hasta dejar el trazo que haría una mano. */
export function simplifyLine(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstD = eps;
    for (let i = a + 1; i < b; i++) {
      const d =
        len > 1e-9
          ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len
          : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Contornos cerrados de una máscara binaria, siguiendo las aristas entre píxeles. */
export function maskContours(mask: Uint8Array, w: number, h: number): Pt[][] {
  const stride = w + 1;
  const first = new Int32Array((w + 1) * (h + 1)).fill(-1);
  const second = new Int32Array((w + 1) * (h + 1)).fill(-1);
  const add = (from: number, to: number) => {
    if (first[from] < 0) first[from] = to;
    else second[from] = to;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const tl = y * stride + x;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      if (y === 0 || !mask[(y - 1) * w + x]) add(tl, tr);
      if (x === w - 1 || !mask[y * w + x + 1]) add(tr, br);
      if (y === h - 1 || !mask[(y + 1) * w + x]) add(br, bl);
      if (x === 0 || !mask[y * w + x - 1]) add(bl, tl);
    }
  }
  const loops: Pt[][] = [];
  for (let s = 0; s < first.length; s++) {
    while (first[s] >= 0) {
      const loop: Pt[] = [];
      let cur = s;
      do {
        loop.push([cur % stride, Math.floor(cur / stride)]);
        const next = first[cur];
        if (next < 0) break;
        first[cur] = second[cur];
        second[cur] = -1;
        cur = next;
      } while (cur !== s);
      if (loop.length > 3) loops.push(loop);
    }
  }
  return loops;
}

export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

/** Simplifica un contorno cerrado sin perder la forma de cierre. */
export function simplifyLoop(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 8) return loop;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyLine(loop.slice(0, far + 1), eps);
  const b = simplifyLine([...loop.slice(far), loop[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}


/** Fronteras entre masas de valor tras un desenfoque fuerte. */
export function massContours(gray: Float32Array, w: number, h: number, sigma: number, cuts: number[], minArea: number, eps: number): Pt[][] {
  const soft = blur(gray, w, h, sigma);
  const out: { pts: Pt[]; area: number }[] = [];
  for (const cut of cuts) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < soft.length; i++) mask[i] = soft[i] < cut ? 1 : 0;
    for (const loop of maskContours(mask, w, h)) {
      const area = polygonArea(loop);
      if (area < minArea) continue;
      out.push({ pts: simplifyLoop(loop, eps), area });
    }
  }
  return out.sort((a, b) => b.area - a.area).map((o) => o.pts);
}

export function dominantLines(L: Uint8Array, w: number, h: number, count = 5): DominantLine[] {
  const gray = blur(Float32Array.from(L), w, h, Math.hypot(w, h) * 0.003);
  const edges = canny(gray, w, h, 0.12);
  const diag = Math.ceil(Math.hypot(w, h));
  const steps = 90; // 2°
  const cos = Array.from({ length: steps }, (_, i) => Math.cos((i * 2 * Math.PI) / 180));
  const sin = Array.from({ length: steps }, (_, i) => Math.sin((i * 2 * Math.PI) / 180));
  const rhos = diag * 2 + 1;
  const acc = new Uint32Array(steps * rhos);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      for (let t = 0; t < steps; t++) {
        const r = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * rhos + r]++;
      }
    }
  }
  const peaks: { t: number; r: number; v: number }[] = [];
  const minVotes = diag * 0.1;
  for (let i = 0; i < acc.length; i++) {
    if (acc[i] >= minVotes) peaks.push({ t: Math.floor(i / rhos), r: (i % rhos) - diag, v: acc[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  const chosen: DominantLine[] = [];
  const used: { t: number; r: number }[] = [];
  for (const p of peaks.slice(0, 4000)) {
    if (chosen.length >= count) break;
    if (used.some((u) => Math.min(Math.abs(u.t - p.t), steps - Math.abs(u.t - p.t)) <= 2 && Math.abs(u.r - p.r) < diag * 0.035)) continue;
    used.push(p);
    const seg = longestRun(edges, w, h, p.t, p.r, cos[p.t], sin[p.t], diag);
    if (!seg) continue;
    const length = Math.hypot(seg.a[0] - seg.b[0], seg.a[1] - seg.b[1]);
    if (length < diag * 0.14) continue;
    chosen.push({
      a: [seg.a[0] / w, seg.a[1] / h],
      b: [seg.b[0] / w, seg.b[1] / h],
      strength: length / diag,
      angle: (Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]) * 180) / Math.PI,
    });
  }
  return chosen;
}

function longestRun(edges: Uint8Array, w: number, h: number, _t: number, r: number, c: number, s: number, diag: number): { a: Pt; b: Pt } | null {
  const gap = Math.max(6, diag * 0.012);
  let best: { a: Pt; b: Pt; n: number } | null = null;
  let start: Pt | null = null;
  let last: Pt | null = null;
  let lastAt = 0;
  let n = 0;
  for (let u = -diag; u <= diag; u++) {
    const x = Math.round(r * c - u * s);
    const y = Math.round(r * s + u * c);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    let hit = false;
    for (let oy = -1; oy <= 1 && !hit; oy++) {
      for (let ox = -1; ox <= 1 && !hit; ox++) hit = edges[(y + oy) * w + x + ox] === 1;
    }
    if (!hit) continue;
    if (!start || u - lastAt > gap) {
      if (start && last && (!best || n > best.n)) best = { a: start, b: last, n };
      start = [x, y];
      n = 0;
    }
    last = [x, y];
    lastAt = u;
    n++;
  }
  if (start && last && (!best || n > best.n)) best = { a: start, b: last, n };
  return best;
}

export function toPath(pts: Pt[], closed: boolean, sx = 1, sy = 1): string {
  if (!pts.length) return '';
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = `M${fmt(pts[0][0] * sx)} ${fmt(pts[0][1] * sy)}`;
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i][0] * sx)} ${fmt(pts[i][1] * sy)}`;
  return closed ? `${d}Z` : d;
}

const SOFT = new WeakMap<Pt[], Pt[]>();

/**
 * Quita el temblor de una línea sacada de una máscara sin derretir su forma. Se remuestrea
 * parejo y se filtra por distancia, no por vértice: en una recta larga un vértice lejano
 * pesaría igual que uno cercano y la espada acabaría hecha de cera.
 */
export function softLine(pts: Pt[], closed: boolean): Pt[] {
  const known = SOFT.get(pts);
  if (known) return known;
  const step = 0.0016;
  const list = closed ? [...pts, pts[0]] : pts;
  const even: Pt[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < list.length; i++) {
    const [ax, ay] = list[i];
    const [bx, by] = list[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    let d = carry;
    for (; d < len; d += step) even.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
    carry = d - len;
  }
  if (even.length < 8) {
    SOFT.set(pts, pts);
    return pts;
  }
  const n = even.length;
  const REACH = 4;
  const weight = Array.from({ length: REACH * 2 + 1 }, (_, k) => Math.exp(-(((k - REACH) / (REACH * 0.6)) ** 2) / 2));
  const total = weight.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 2) {
    let x = 0;
    let y = 0;
    for (let k = -REACH; k <= REACH; k++) {
      const q = even[closed ? (i + k + n) % n : Math.max(0, Math.min(n - 1, i + k))];
      x += q[0] * weight[k + REACH];
      y += q[1] * weight[k + REACH];
    }
    out.push([x / total, y / total]);
  }
  if (!closed) {
    out[0] = pts[0];
    out.push(pts[pts.length - 1]);
  }
  SOFT.set(pts, out);
  return out;
}
