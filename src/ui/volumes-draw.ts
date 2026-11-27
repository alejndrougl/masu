import { toPath } from '../lib/edges';
import type { Cylinder, FigureModel } from '../lib/figure';
import { loomis } from '../lib/loomis';
import type { Pt } from '../lib/types';
import { describeTurn, gazeTip, type Primitive, type Turn } from '../lib/volumes';
import type { Prim, View } from './overlays';
import { ROJO } from './palette';

const SKIN = 'var(--paper)';
const LINE = 'var(--ink)';

const add = (p: Pt, d: Pt, k: number): Pt => [p[0] + d[0] * k, p[1] + d[1] * k];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Arco de la elipse que se ve al cortar un cilindro. */
function arc(c: Pt, n: Pt, dir: Pt, r: number, open: number, from: number, to: number, steps = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    out.push([c[0] + n[0] * r * Math.cos(t) + dir[0] * r * open * Math.sin(t), c[1] + n[1] * r * Math.cos(t) + dir[1] * r * open * Math.sin(t)]);
  }
  return out;
}

/** Un cilindro como se dibuja a mano: tapa cercana entera, anillos que dan la vuelta. */
export function cylinderPrims(c: Cylinder, v: View): Prim[] {
  const { W, H } = v;
  const a: Pt = [c.a[0] * W, c.a[1] * H];
  const b: Pt = [c.b[0] * W, c.b[1] * H];
  const [near, far, rn, rf] = c.near === 'a' ? [a, b, c.ra * H, c.rb * H] : [b, a, c.rb * H, c.ra * H];
  const len = Math.hypot(far[0] - near[0], far[1] - near[1]);
  if (len < 1) return [];
  const dir: Pt = [(far[0] - near[0]) / len, (far[1] - near[1]) / len];
  const n: Pt = [-dir[1], dir[0]];
  const open = Math.min(0.92, c.open);
  const body = [
    ...arc(far, n, dir, rf, open, 0, Math.PI),
    ...arc(near, n, dir, rn, open, Math.PI, Math.PI * 2),
  ];
  const out: Prim[] = [{ t: 'path', d: toPath(body, true), fill: SKIN, stroke: LINE, w: 1.6, alpha: 0.94 }];
  for (const s of [0.34, 0.68]) {
    const ring = arc(lerp(near, far, s), n, dir, rn + (rf - rn) * s, open, 0, Math.PI);
    out.push({ t: 'path', d: toPath(ring, false), stroke: LINE, w: 0.9, alpha: 0.5 });
  }
  const cap = arc(near, n, dir, rn, open, 0, Math.PI * 2, 28);
  out.push({ t: 'path', d: toPath(cap, true), fill: SKIN, stroke: LINE, w: 1.3 });
  return out;
}

/** Bola con su ecuador y eje girados, y una flecha que sale hacia donde mira la cara. */
export function headPrims(head: { c: Pt; r: number }, turn: Turn | null, v: View): Prim[] {
  const { W, H, unit } = v;
  const cx = head.c[0] * W;
  const cy = head.c[1] * H;
  const r = head.r * H;
  const f = (n: number) => n.toFixed(1);
  const ball = `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  const out: Prim[] = [{ t: 'path', d: ball, fill: SKIN, stroke: LINE, w: 1.8, alpha: 0.96 }];
  if (!turn) {
    out.push({ t: 'path', d: `M${cx - r} ${cy}Q${cx} ${cy + r * 0.34} ${cx + r} ${cy}M${cx} ${cy - r}Q${cx + r * 0.28} ${cy} ${cx} ${cy + r}`, stroke: LINE, w: 1, alpha: 0.7 });
    return out;
  }
  const g = loomis(turn);
  const map = ([x, y]: Pt): Pt => [cx + x * r, cy + y * r];
  for (const l of g.lines) out.push({ t: 'path', d: toPath(l.map(map), false), stroke: ROJO, w: 1.3 });
  out.push({ t: 'path', d: toPath(g.jaw.map(map), false), stroke: LINE, w: 1.2, alpha: 0.75 });
  const tip = gazeTip(turn);
  const reach = Math.hypot(tip[0], tip[1]);
  if (reach < 0.2) {
    // De frente: la flecha viene hacia quien mira, se dibuja como punta.
    const q = 5 * unit;
    out.push({ t: 'path', d: `M${cx - q} ${cy}a${q} ${q} 0 1 0 ${2 * q} 0a${q} ${q} 0 1 0 ${-2 * q} 0Z`, fill: ROJO });
  } else {
    const u: Pt = [tip[0] / reach, tip[1] / reach];
    const from: Pt = [cx + tip[0] * r, cy + tip[1] * r];
    const to = add(from, u, r * (0.5 + reach * 0.6));
    const size = 10 * unit;
    const side: Pt = [-u[1], u[0]];
    const headD = `M${to[0]} ${to[1]}L${to[0] - u[0] * size + side[0] * size * 0.5} ${to[1] - u[1] * size + side[1] * size * 0.5}L${to[0] - u[0] * size - side[0] * size * 0.5} ${to[1] - u[1] * size - side[1] * size * 0.5}Z`;
    out.push({ t: 'path', d: `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`, stroke: ROJO, w: 2.4 }, { t: 'path', d: headD, fill: ROJO });
  }
  out.push({ t: 'text', x: cx, y: cy - r - 8 * unit, s: describeTurn(turn), size: 12 * unit, fill: ROJO, anchor: 'middle', halo: true, weight: 500 });
  return out;
}

/** Línea central del pecho: se corre hacia donde gira el torso. */
export function chestPrims(model: FigureModel, v: View): Prim[] {
  if (model.chest === null || !model.shoulders || !model.hips) return [];
  const { W, H } = v;
  const mid = (p: [Pt, Pt]): Pt => [((p[0][0] + p[1][0]) / 2) * W, ((p[0][1] + p[1][1]) / 2) * H];
  const top = mid(model.shoulders);
  const low = mid(model.hips);
  const len = Math.hypot(low[0] - top[0], low[1] - top[1]) || 1;
  const n0: Pt = [-(low[1] - top[1]) / len, (low[0] - top[0]) / len];
  const n: Pt = n0[0] >= 0 ? n0 : [-n0[0], -n0[1]];
  const torso = model.cylinders.find((c) => c.part === 'tronco');
  const r = (torso?.ra ?? 0.05) * H;
  const push = Math.sin((model.chest * Math.PI) / 180) * r;
  const line: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const bulge = Math.sin(Math.PI * t);
    line.push(add(lerp(top, low, t), n, push * (0.55 + 0.45 * bulge)));
  }
  return [{ t: 'path', d: toPath(line, false), stroke: ROJO, w: 1.8 }];
}

function ellipsePath(c: Pt, a: number, b: number, angle: number, from = 0, to = Math.PI * 2): Pt[] {
  const out: Pt[] = [];
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let i = 0; i <= 40; i++) {
    const t = from + ((to - from) * i) / 40;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    out.push([c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
  }
  return out;
}

/** Forma plana del paso 2: la silueta reducida a una figura simple. */
export function flatPrims(p: Primitive, mw: number, v: View): Prim[] {
  const { W, H } = v;
  const k = W / mw;
  const c: Pt = [p.c[0] * W, p.c[1] * H];
  if (p.corners) {
    const pts = p.corners.map(([x, y]): Pt => [x * W, y * H]);
    return [{ t: 'path', d: toPath(pts, true), stroke: LINE, w: 2 }];
  }
  return [{ t: 'path', d: toPath(ellipsePath(c, p.major * k, p.minor * k, p.angle), true), stroke: LINE, w: 2 }];
}

/** El sólido del paso 3: esfera, cilindro, caja o cono. */
export function solidPrims(p: Primitive, mw: number, v: View, vanish: Pt | null): Prim[] {
  const { W, H } = v;
  const k = W / mw;
  const c: Pt = [p.c[0] * W, p.c[1] * H];
  const major = p.major * k;
  const minor = p.minor * k;
  if (p.kind === 'esfera') {
    const out: Prim[] = [{ t: 'path', d: toPath(ellipsePath(c, major, minor, p.angle), true), fill: SKIN, stroke: LINE, w: 1.8, alpha: 0.95 }];
    out.push({ t: 'path', d: toPath(ellipsePath(c, major, minor * 0.28, p.angle, 0, Math.PI), false), stroke: ROJO, w: 1.2 });
    out.push({ t: 'path', d: toPath(ellipsePath(c, major * 0.28, minor, p.angle, -Math.PI / 2, Math.PI / 2), false), stroke: LINE, w: 0.9, alpha: 0.6 });
    return out;
  }
  if (p.kind === 'cilindro') {
    const u: Pt = [Math.cos(p.angle), Math.sin(p.angle)];
    const a = add(c, u, -(major - minor * 0.2));
    const b = add(c, u, major - minor * 0.2);
    const [top, low] = a[1] < b[1] ? [a, b] : [b, a];
    return cylinderPrims({ a: [top[0] / W, top[1] / H], b: [low[0] / W, low[1] / H], ra: minor / H, rb: minor / H, open: 0.3, near: 'a', part: 'forma' }, v);
  }
  if (p.kind === 'cono' && p.corners) {
    const pts = p.corners.map(([x, y]): Pt => [x * W, y * H]);
    const apex = pts.reduce((t, q) => (q[1] < t[1] ? q : t), pts[0]);
    const base = pts.filter((q) => q !== apex);
    const mid = lerp(base[0], base[1], 0.5);
    const half = Math.hypot(base[1][0] - base[0][0], base[1][1] - base[0][1]) / 2;
    const angle = Math.atan2(base[1][1] - base[0][1], base[1][0] - base[0][0]);
    const out: Prim[] = [{ t: 'path', d: toPath([apex, base[0], ...ellipsePath(mid, half, half * 0.26, angle, Math.PI, 0), base[1]], true), fill: SKIN, stroke: LINE, w: 1.8, alpha: 0.95 }];
    return out;
  }
  if (p.corners) {
    const pts = p.corners.map(([x, y]): Pt => [x * W, y * H]);
    // La caja fuga hacia el punto de la escena; sin él se abre hacia arriba a la derecha.
    const depth = Math.min(major, minor) * 0.42;
    const center = pts.reduce<Pt>((acc, q) => [acc[0] + q[0] / 4, acc[1] + q[1] / 4], [0, 0]);
    const toward: Pt = vanish ? [vanish[0] * W - center[0], vanish[1] * H - center[1]] : [0.7, -0.7];
    const len = Math.hypot(toward[0], toward[1]) || 1;
    const back = pts.map((q) => add(q, [toward[0] / len, toward[1] / len], depth));
    const out: Prim[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      out.push({ t: 'path', d: toPath([pts[i], pts[j], back[j], back[i]], true), fill: SKIN, stroke: LINE, w: 1.3, alpha: 0.9 });
    }
    out.push({ t: 'path', d: toPath(pts, true), fill: SKIN, stroke: LINE, w: 1.8 });
    out.push({ t: 'path', d: `M${pts[0][0]} ${pts[0][1]}L${pts[2][0]} ${pts[2][1]}M${pts[1][0]} ${pts[1][1]}L${pts[3][0]} ${pts[3][1]}`, stroke: LINE, w: 0.7, alpha: 0.35 });
    return out;
  }
  return [];
}
