import { POSE } from './gesture';
import type { Pt } from './types';

import { t } from '../i18n';
/**
 * Qué parte de un sujeto hay realmente en la imagen. Todo lo demás depende de esto: una
 * proporción de cuerpo no se mide en un busto, y a una mano no se le construye un torso.
 */
export type Framing = 'completo' | 'tres-cuartos' | 'medio' | 'busto' | 'cabeza' | 'mano' | 'pie' | 'animal' | 'objeto' | 'forma';

export const FRAMING_NAME: Record<Framing, string> = {
  get completo() { return t('framing.cuerpo_completo'); },
  get 'tres-cuartos'() { return t('framing.tres_cuartos'); },
  get medio() { return t('framing.medio_cuerpo'); },
  get busto() { return t('framing.busto'); },
  get cabeza() { return t('framing.solo_cabeza'); },
  get mano() { return t('common.mano'); },
  get pie() { return t('common.pie'); },
  get animal() { return t('framing.animal'); },
  get objeto() { return t('common.objeto'); },
  get forma() { return t('framing.forma_libre'); },
};

type Pose = { pts: Pt[]; vis: number[] };
type Mask = { data: Uint8Array; w: number; h: number };

/** Un punto toca la figura, con un margen: la pose suele caer justo en el borde. */
export function onFigure(mask: Mask | undefined, [x, y]: Pt, margin = 0.025): boolean {
  if (!mask) return true;
  const reach = Math.ceil(margin * mask.h);
  const cx = Math.floor(x * mask.w);
  const cy = Math.floor(y * mask.h);
  for (let dy = -reach; dy <= reach; dy += Math.max(1, reach >> 1)) {
    for (let dx = -reach; dx <= reach; dx += Math.max(1, reach >> 1)) {
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && py >= 0 && px < mask.w && py < mask.h && mask.data[py * mask.w + px]) return true;
    }
  }
  return false;
}

/** Confianza contra lo mejor de su propia imagen: en un dibujo todas salen bajas. */
export function relativeVis(pose: Pose): number[] {
  const best = pose.vis.slice(0, 17).sort((a, b) => b - a).slice(0, 6);
  const peak = Math.max(0.3, best.reduce((a, b) => a + b, 0) / (best.length || 1));
  return pose.vis.map((v) => v / peak);
}

const inFrame = ([x, y]: Pt) => x > -0.01 && x < 1.01 && y > -0.01 && y < 1.01;

/** Hasta dónde llega el cuerpo dentro del encuadre. */
export function readFraming(pose: Pose, mask?: Mask): Framing {
  const v = relativeVis(pose);
  // El modelo siempre responde todos los puntos: lo que cae fuera de la figura no se ve.
  const seen = (i: number) => v[i] > 0.45 && inFrame(pose.pts[i]) && onFigure(mask, pose.pts[i]);
  const both = (a: number, b: number) => seen(a) || seen(b);
  if (both(POSE.ankleL, POSE.ankleR)) return 'completo';
  if (both(POSE.kneeL, POSE.kneeR)) return 'tres-cuartos';
  if (both(POSE.hipL, POSE.hipR)) return 'medio';
  if (both(POSE.shoulderL, POSE.shoulderR)) return 'busto';
  return 'cabeza';
}

/**
 * Una pose inventada: el modelo siempre responde 133 puntos, aunque le den un brazo o un
 * sillón. Sin cabeza a la vista, un cuerpo solo se cree si su tronco está claro; y si una
 * mano ocupa buena parte de la caja, lo que se ve es la mano.
 */
export function poseIsFalse(pose: Pose | undefined, handShare: number): boolean {
  if (!pose) return true;
  const core = [POSE.shoulderL, POSE.shoulderR, POSE.hipL, POSE.hipR];
  const trunk = core.reduce((a, i) => a + Math.min(1, pose.vis[i]), 0) / core.length;
  const head = Math.max(...[POSE.nose, POSE.eyeL, POSE.eyeR].map((i) => pose.vis[i]));
  if (handShare > 0.12 && trunk < 0.75) return true;
  return trunk < 0.45 && head < 0.5;
}

/** A un personaje dibujado se le perdona una pose débil, pero no que sea solo una mano. */
export function bodyIsFalse(kind: string, pose: Pose | undefined, handShare: number): boolean {
  return poseIsFalse(pose, handShare) && (kind !== 'anime-person' || handShare > 0.12);
}

/**
 * Una pose que contradice a la cabeza está mal aunque venga con confianza alta: los hombros
 * no pueden quedar arriba del mentón, se mida la inclinación que se mida.
 */
export function shouldersBelowHead(pose: Pose, chin: Pt, glabella: Pt, aspect: number): boolean {
  const mx = ((pose.pts[POSE.shoulderL][0] + pose.pts[POSE.shoulderR][0]) / 2 - chin[0]) * aspect;
  const my = (pose.pts[POSE.shoulderL][1] + pose.pts[POSE.shoulderR][1]) / 2 - chin[1];
  const dx = (chin[0] - glabella[0]) * aspect;
  const dy = chin[1] - glabella[1];
  const length = Math.hypot(dx, dy) || 1e-6;
  return (mx * dx + my * dy) / length > -length * 0.3;
}
