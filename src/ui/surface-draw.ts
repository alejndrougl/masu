import { softLine, toPath } from '../lib/edges';
import { brushPath } from '../lib/gesture';
import type { V3 } from '../lib/rig';
import type { Facet } from '../lib/pieces';
import type { BodySurface } from '../lib/surface';
import type { Pt } from '../lib/types';
import type { Prim, View } from './overlays';
import { ROJO } from './palette';

const INK = 'var(--ink)';
const PAPER = 'var(--paper)';

/**
 * Las formas leídas de la superficie. Como en un dibujo: las cintas apenas se notan, la silueta
 * es fina y el peso de línea va solo donde una forma tapa a otra, con la punta afilada.
 */
export function surfaceForms(s: BodySurface, v: View, solid: number, dark: boolean): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  for (const loop of s.fill) out.push({ t: 'path', d: toPath(softLine(loop, true), true, W, H), fill: PAPER, fillAlpha: solid, alpha: 1 });
  // Sobre negro no se puede oscurecer: la forma se dibuja iluminando su lado claro.
  for (const loop of dark ? s.lit : s.shade) out.push({ t: 'path', d: toPath(softLine(loop, true), true, W, H), fill: INK, alpha: (dark ? 0.1 : 0.07) * Math.max(0.5, solid) });
  for (const band of s.bands) out.push({ t: 'path', d: toPath(band, false, W, H), stroke: INK, w: 0.7, alpha: 0.32, cap: 'round' });
  for (const line of s.center) out.push({ t: 'path', d: toPath(line, false, W, H), stroke: ROJO, w: 1, alpha: 0.7, cap: 'round' });
  const diag = Math.hypot(W, H);
  for (const line of [...s.lines].sort((p, q) => p.near - q.near)) {
    const pts = softLine(line.pts, false);
    if (line.overlap) {
      const curve = pts.map(([x, y]): Pt => [x * W, y * H]);
      // Un susurro: se nota sin que se vea como un marcador.
      out.push({ t: 'path', d: brushPath(curve, diag * (0.0015 + line.near * 0.0008)), fill: INK, alpha: 1 });
    } else {
      out.push({ t: 'path', d: toPath(pts, false, W, H), stroke: INK, w: 1.05, alpha: 1, cap: 'round' });
    }
  }
  return out;
}

/** La misma superficie tallada: cada celda es un plano, con el tono que le da la luz. */
/** El color de un plano: la mediana de la imagen en esa zona, para que un borde no lo ensucie. */
function colorOf(f: Facet, frame: { rgba: Uint8ClampedArray; w: number; h: number; mask?: Uint8Array }): [number, number, number] | null {
  const all: number[][] = [];
  const kept: number[][] = [];
  for (const [x, y] of f.samples ?? []) {
    const px = Math.max(0, Math.min(frame.w - 1, Math.floor(x * frame.w)));
    const py = Math.max(0, Math.min(frame.h - 1, Math.floor(y * frame.h)));
    const i = (py * frame.w + px) * 4;
    const color = [frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2]];
    all.push(color);
    if (!frame.mask || frame.mask[py * frame.w + px]) kept.push(color);
  }
  const list = kept.length ? kept : all;
  if (!list.length) return null;
  const middle = (c: number) => list.map((q) => q[c]).sort((p, q) => p - q)[list.length >> 1];
  return [middle(0), middle(1), middle(2)];
}

export function surfacePlanes(s: BodySurface, v: View, solid: number, dark: boolean, frame?: { rgba: Uint8ClampedArray; w: number; h: number; mask?: Uint8Array } | null): Prim[] {
  const { W, H } = v;
  const out: Prim[] = [];
  for (const loop of s.fill) out.push({ t: 'path', d: toPath(softLine(loop, true), true, W, H), fill: PAPER, fillAlpha: solid, alpha: 1 });
  // Luz de construcción: la misma para toda figura, para que se lea el volumen y no la foto.
  const light: V3 = [-0.5, -0.62, 0.6];
  for (const f of s.planes) {
    const k = (f.n[0] * light[0] + f.n[1] * light[1] + f.n[2] * light[2]) / 1;
    const d = toPath(f.poly, true, W, H);
    const shadow = k > 0.62 ? 0 : k > 0.34 ? 0.09 : k > 0.02 ? 0.2 : 0.34;
    const real = frame ? colorOf(f, frame) : null;
    if (real) {
      // Cada plano lleva el color que tiene en la imagen, oscurecido por su giro.
      const shade = 1 - shadow * 1.1;
      out.push({ t: 'path', d, fill: `rgb(${Math.round(real[0] * shade)},${Math.round(real[1] * shade)},${Math.round(real[2] * shade)})`, alpha: Math.max(0.55, solid) });
    } else {
      const tone = dark ? 0.34 - shadow : shadow;
      if (tone) out.push({ t: 'path', d, fill: INK, alpha: tone * Math.max(0.4, solid) });
    }
    out.push({ t: 'path', d, stroke: INK, w: 0.6, alpha: 0.42 });
  }
  for (const line of s.lines) out.push({ t: 'path', d: toPath(softLine(line.pts, false), false, W, H), stroke: INK, w: line.overlap ? 1.25 : 1, alpha: 1, cap: 'round' });
  return out;
}
