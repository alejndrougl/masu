import type { Figure, Pt, Rect, Subject } from '../lib/types';
import type { Frame, LoadedImage } from '../state/store';
import { boxToFrame, toFrame } from './overlays';

import { tr } from '../i18n';
/** Puntos faciales que representan cada rasgo. */
const FACE_PARTS: [string, number[]][] = [
  ['ojo', [33, 133, 159, 145]],
  ['ojo', [263, 362, 386, 374]],
  ['ceja', [70, 105, 107]],
  ['ceja', [300, 334, 336]],
  ['nariz', [1, 2, 98, 327]],
  ['boca', [61, 291, 13, 14]],
  ['mentón', [152, 148, 377]],
  ['frente', [10, 109, 338]],
  ['mejilla', [205, 50]],
  ['mejilla', [425, 280]],
];

const POSE_PARTS: [string, number][] = [
  ['hombro', 5],
  ['hombro', 6],
  ['codo', 7],
  ['codo', 8],
  ['muñeca', 9],
  ['muñeca', 10],
  ['cadera', 11],
  ['cadera', 12],
  ['rodilla', 13],
  ['rodilla', 14],
  ['tobillo', 15],
  ['tobillo', 16],
  ['pie', 17],
  ['pie', 20],
  ['talón', 19],
  ['talón', 22],
  ['mano', 100],
  ['mano', 121],
  ['ojo', 1],
  ['ojo', 2],
  ['nariz', 0],
  ['oreja', 3],
  ['oreja', 4],
];

const inRect = (r: Rect, [x, y]: Pt) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function overlapShare(cell: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(cell.x + cell.w, b.x + b.w) - Math.max(cell.x, b.x));
  const y = Math.max(0, Math.min(cell.y + cell.h, b.y + b.h) - Math.max(cell.y, b.y));
  return (x * y) / (cell.w * cell.h || 1);
}

interface Context {
  subjects: Subject[];
  frame: Frame;
  image: LoadedImage;
  figures: Figure[];
}

/** Qué aparece dentro de un cuadro. `cell` está normalizado sobre el encuadre. */
export function featuresInCell({ subjects, frame, image, figures }: Context, cell: Rect): string[] {
  const out = new Set<string>();
  const rect = frame.rect;
  for (const s of subjects) {
    const b = boxToFrame(rect, image, s.box);
    if (overlapShare(cell, b) <= 0) continue;
    if (s.face) {
      for (const [name, ids] of FACE_PARTS) {
        const c = ids.reduce<Pt>((acc, i) => [acc[0] + s.face![i][0] / ids.length, acc[1] + s.face![i][1] / ids.length], [0, 0]);
        if (inRect(cell, toFrame(rect, image, c))) out.add(tr(name));
      }
    }
    if (s.pose) {
      for (const [name, i] of POSE_PARTS) {
        if (s.pose.vis[i] > 0.35 && inRect(cell, toFrame(rect, image, s.pose.pts[i]))) out.add(tr(name));
      }
    }
    if (overlapShare(cell, b) > 0.12) {
      if (s.kind.endsWith('face') || s.kind === 'head') out.add(s.label.toLowerCase());
      else if (s.kind === 'object' || s.kind === 'animal') out.add(s.label.toLowerCase());
    }
  }
  for (const f of figures) {
    if (f.source === 'click' && overlapShare(cell, boxToFrame(rect, image, f.box)) > 0.2) out.add(f.label.toLowerCase());
  }
  return [...out];
}
