import type { Pt } from './types';

interface Turn {
  yaw: number;
  pitch: number;
  roll: number;
}

type V3 = [number, number, number];

/**
 * Gira un punto de la cabeza. Convención de pantalla: x derecha, y abajo, z hacia quien
 * mira. Giro positivo a la derecha, cabeceo positivo hacia abajo, ladeo positivo antihorario.
 */
function rotator({ yaw, pitch, roll }: Turn) {
  const rad = Math.PI / 180;
  const cy = Math.cos(yaw * rad);
  const sy = Math.sin(yaw * rad);
  const cp = Math.cos(pitch * rad);
  const sp = Math.sin(pitch * rad);
  const cr = Math.cos(roll * rad);
  const sr = Math.sin(roll * rad);
  return ([x, y, z]: V3): V3 => {
    const y1 = y * cp + z * sp;
    const z1 = -y * sp + z * cp;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    return [x2 * cr + y1 * sr, -x2 * sr + y1 * cr, z2];
  };
}

function ring(r: (v: V3) => V3, at: (t: number) => V3): { front: Pt[][]; } {
  const front: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i <= 72; i++) {
    const p = r(at((i / 72) * 2 * Math.PI));
    if (p[2] >= -0.02) run.push([p[0], p[1]]);
    else if (run.length) {
      front.push(run);
      run = [];
    }
  }
  if (run.length) front.push(run);
  return { front };
}

export interface LoomisGuide {
  /** Contorno de la bola y líneas visibles, relativas al centro y al radio. */
  lines: Pt[][];
  /** Plano lateral recortado de la bola. */
  side: Pt[];
  /** Bajada de la mandíbula. */
  jaw: Pt[];
  /** Separaciones de cejas, nariz y mentón sobre el eje. */
  marks: Pt[];
}

/** Método Loomis: bola craneal con ecuador, eje central y plano lateral, girados como la cabeza. */
export function loomis(turn: Turn): LoomisGuide {
  const r = rotator(turn);
  const lines: Pt[][] = [];
  // Ecuador: la línea de las cejas.
  lines.push(...ring(r, (t) => [Math.cos(t), 0.12, Math.sin(t)]).front);
  // Meridiano central, por el centro de la cara.
  lines.push(...ring(r, (t) => [0, Math.sin(t), Math.cos(t)]).front);
  const side: Pt[] = [];
  const sign = Math.sin((turn.yaw * Math.PI) / 180) >= 0 ? -1 : 1;
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * 2 * Math.PI;
    const p = r([sign * 0.8, 0.6 * Math.sin(t), 0.6 * Math.cos(t)]);
    side.push([p[0], p[1]]);
  }
  const face = 1.86;
  const chin = r([0, face, 0.95]);
  const brow = r([0, 0.12, 1]);
  const nose = r([0, 0.86, 1.02]);
  const jawL = r([-0.72, 0.5, 0.5]);
  const jawR = r([0.72, 0.5, 0.5]);
  const earL = r([-0.82, 0.12, 0]);
  const earR = r([0.82, 0.12, 0]);
  const jaw: Pt[] = [
    [earL[0], earL[1]],
    [jawL[0], jawL[1]],
    [chin[0], chin[1]],
    [jawR[0], jawR[1]],
    [earR[0], earR[1]],
  ];
  return { lines, side, jaw, marks: [[brow[0], brow[1]], [nose[0], nose[1]], [chin[0], chin[1]]] };
}
