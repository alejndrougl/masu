import { MHR } from '../lib/body';
import { toPath } from '../lib/edges';
import { readFolds, type FoldKind, type FoldRead, type JointName } from '../lib/folds';
import type { Pt } from '../lib/types';
import { figureInFrame } from '../state/engine';
import type { State } from '../state/store';
import { figureModels, mainFigures, type Prim, type View } from './overlays';
import { AMARILLO, DARK, LIGHT, ROJO } from './palette';

import { t as tx } from '../i18n';
const AZUL = '#2C609E';
const LONG = 380;

/** Cómo se dibuja cada pliegue: color por lo que lo causa, raya por su variante. */
export const FOLD_STYLE: Record<FoldKind, { color: string; dash?: number[] }> = {
  tension: { color: ROJO },
  tubo: { color: AMARILLO },
  caida: { color: AMARILLO, dash: [8, 5] },
  acordeon: { color: AZUL },
  llave: { color: AZUL, dash: [8, 5] },
  espiral: { color: LIGHT },
  panal: { color: LIGHT, dash: [8, 5] },
  inerte: { color: LIGHT, dash: [2, 5] },
};

const JOINTS: [JointName, number][] = [
  ['neck', MHR.neck],
  ['shoulderL', MHR.shoulderL],
  ['shoulderR', MHR.shoulderR],
  ['elbowL', MHR.elbowL],
  ['elbowR', MHR.elbowR],
  ['wristL', MHR.wristL],
  ['wristR', MHR.wristR],
  ['hipL', MHR.hipL],
  ['hipR', MHR.hipR],
  ['kneeL', MHR.kneeL],
  ['kneeR', MHR.kneeR],
  ['ankleL', MHR.ankleL],
  ['ankleR', MHR.ankleR],
];

let cache: { key: unknown[]; value: FoldRead[] } | null = null;

/** Rellena una cápsula entre dos puntos, con un radio en cada extremo. */
function capsule(out: Uint8Array, w: number, h: number, a: Pt, b: Pt, ra: number, rb: number) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0] - ra, b[0] - rb)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0] + ra, b[0] + rb)));
  const y0 = Math.max(0, Math.floor(Math.min(a[1] - ra, b[1] - rb)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1] + ra, b[1] + rb)));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      const r = ra + (rb - ra) * t;
      if ((x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2 <= r * r) out[y * w + x] = 1;
    }
  }
}

/** Los pliegues de cada figura principal que tenga esqueleto. */
export function foldsOf(s: State): FoldRead[] {
  const { frame, image } = s;
  if (!frame || !image || !s.figuresReady) return [];
  const key = [frame, s.figures, s.subjects, s.depth, s.bodyFaces, s.figurePick, s.rigEdits];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.value;
  const value: FoldRead[] = [];
  try {
    const k = LONG / Math.max(frame.w, frame.h);
    const w = Math.max(8, Math.round(frame.w * k));
    const h = Math.max(8, Math.round(frame.h * k));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const src = new OffscreenCanvas(frame.w, frame.h);
    src.getContext('2d')!.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h), 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const aspect = s.canvas.w / s.canvas.h;
    for (const m of mainFigures(figureModels(s).list, s)) {
      const rig = m.mannequin?.rig;
      const fig = s.figures.find((f) => f.id === m.id);
      if (!rig || !fig) continue;
      const mask = figureInFrame(fig, frame.rect, w, h);
      const joints: Partial<Record<JointName, Pt>> = {};
      for (const [name, id] of JOINTS) if (rig.seen[id] && rig.pts[id]) joints[name] = [(rig.pts[id][0] / aspect) * w, rig.pts[id][1] * h];
      // El cuerpo bajo la ropa, por sus huesos: lo que la silueta tiene de más es tela suelta.
      const body = new Uint8Array(w * h);
      const skip = new Uint8Array(w * h);
      for (const b of m.bones) {
        const a: Pt = [b.a[0] * w, b.a[1] * h];
        const e: Pt = [b.b[0] * w, b.b[1] * h];
        const grow = b.part === 'tronco' || b.part === 'pelvis' ? 1.3 : 1.55;
        capsule(body, w, h, a, e, b.ra * h * grow, b.rb * h * grow);
        if (b.part === 'cabeza' || b.part === 'mano' || b.part === 'pie' || b.part === 'cuello') capsule(skip, w, h, a, e, b.ra * h * 1.25, b.rb * h * 1.25);
      }
      if (m.head) capsule(skip, w, h, [m.head.c[0] * w, m.head.c[1] * h], [m.head.c[0] * w, m.head.c[1] * h], m.head.r * h * 1.35, m.head.r * h * 1.35);
      value.push(readFolds({ rgba, w, h, mask, body, skip, joints }));
    }
  } catch (err) {
    console.error(tx('foldsDraw.pliegues_sin_leer'), err);
  }
  cache = { key, value };
  return value;
}

export function foldPrims(s: State, v: View): Prim[] {
  const out: Prim[] = [];
  for (const read of foldsOf(s)) {
    // La onda de abajo y de dónde cuelga cada cresta: el ocho que une los extremos.
    if (read.links.length) {
      const d = read.links.map(([a, b]) => `M${(a[0] * v.W).toFixed(1)} ${(a[1] * v.H).toFixed(1)}L${(b[0] * v.W).toFixed(1)} ${(b[1] * v.H).toFixed(1)}`).join('');
      out.push({ t: 'path', d, stroke: DARK, w: 2.6, alpha: 0.4, clip: true }, { t: 'path', d, stroke: AMARILLO, w: 1.1, dash: [3, 6], clip: true });
    }
    if (read.hems.length) {
      const d = read.hems.map((l) => toPath(l, false, v.W, v.H)).join('');
      out.push({ t: 'path', d, stroke: DARK, w: 5.5, alpha: 0.5, cap: 'round', clip: true }, { t: 'path', d, stroke: AMARILLO, w: 2.8, cap: 'round', clip: true });
    }
    const byKind = new Map<FoldKind, string>();
    for (const f of read.folds) byKind.set(f.kind, (byKind.get(f.kind) ?? '') + toPath(f.pts, false, v.W, v.H));
    for (const [kind, d] of byKind) {
      const st = FOLD_STYLE[kind];
      out.push({ t: 'path', d, stroke: st.color === LIGHT ? DARK : LIGHT, w: 4.2, alpha: 0.55, cap: 'round', clip: true }, { t: 'path', d, stroke: st.color, w: 2, cap: 'round', dash: st.dash, clip: true });
    }
    // Puntos de tensión: de donde sale más de un pliegue.
    for (const t of read.tension) {
      if (t.count < 2) continue;
      const x = t.at[0] * v.W;
      const y = t.at[1] * v.H;
      const r = 9 * v.unit;
      const ring = `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
      const dot = `M${x - r * 0.3} ${y}a${r * 0.3} ${r * 0.3} 0 1 0 ${r * 0.6} 0a${r * 0.3} ${r * 0.3} 0 1 0 ${-r * 0.6} 0Z`;
      out.push({ t: 'path', d: ring, stroke: LIGHT, w: 4, alpha: 0.6 }, { t: 'path', d: ring, stroke: ROJO, w: 2 }, { t: 'path', d: dot, fill: ROJO, alpha: 1 });
      out.push({ t: 'text', x: x + r * 1.5, y: y + r * 0.4, s: t.name, size: 12 * v.unit, fill: ROJO, halo: true, weight: 600 });
    }
  }
  return out;
}
