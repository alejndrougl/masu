import { rgbToLab } from './color';
import { blur, canny, linkEdges, simplifyLine } from './edges';
import { distanceToEdge } from './gesture';
import type { Pt } from './types';

import { t as tx } from '../i18n';
/**
 * Pliegues de la ropa. Una tela cuelga de donde el cuerpo la sostiene (puntos de tensión) y la
 * gravedad hace el resto; cada pliegue se nombra por cómo nace: de un punto del que tira, de
 * una articulación que lo aprieta, de la vuelta que da a un brazo o de su propio peso.
 *
 * Aquí no se inventan pliegues: se buscan los que la imagen ya tiene (líneas dentro de la
 * ropa, del mismo material a los dos lados) y se clasifican con el esqueleto.
 */

export type FoldKind = 'tension' | 'tubo' | 'acordeon' | 'llave' | 'espiral' | 'panal' | 'caida' | 'inerte';

export const FOLD_NAME: Record<FoldKind, string> = {
  get tension() { return tx('folds.de_tension'); },
  get tubo() { return tx('folds.de_tubo'); },
  get acordeon() { return tx('folds.en_zigzag'); },
  get llave() { return tx('folds.media_llave'); },
  get espiral() { return tx('folds.en_espiral'); },
  get panal() { return tx('folds.de_panal'); },
  get caida() { return tx('folds.de_caida'); },
  get inerte() { return tx('folds.inerte'); },
};

export const FOLD_TEXT: Record<FoldKind, string> = {
  get tension() { return tx('folds.salen_en_abanico_de'); },
  get tubo() { return tx('folds.la_tela_cuelga_libre'); },
  get acordeon() { return tx('folds.la_tela_se_junta'); },
  get llave() { return tx('folds.un_solo_quiebre_donde'); },
  get espiral() { return tx('folds.la_tela_da_la'); },
  get panal() { return tx('folds.la_tela_se_cuelga'); },
  get caida() { return tx('folds.cuelga_de_un_solo'); },
  get inerte() { return tx('folds.tela_que_descansa_sin'); },
};

export interface Fold {
  /** Normalizado al encuadre. */
  pts: Pt[];
  kind: FoldKind;
  /** Punto de tensión del que nace, si lo tiene. */
  anchor?: number;
}

export interface Tension {
  at: Pt;
  name: string;
  /** Pliegues que salen de aquí. */
  count: number;
}

export interface FoldRead {
  folds: Fold[];
  tension: Tension[];
  /** Borde de abajo de la tela suelta: la onda donde terminan los tubos. */
  hems: Pt[][];
  /** De cada cresta de esa onda al punto del que cuelga. */
  links: [Pt, Pt][];
  counts: Partial<Record<FoldKind, number>>;
  /** Hay tela que cuelga lejos del cuerpo: capa, falda, manga ancha. */
  loose: boolean;
}

export type JointName = 'neck' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'wristL' | 'wristR' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR';

export interface FoldInput {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  /** La figura completa, con su ropa. */
  mask: Uint8Array;
  /** Dónde está el cuerpo debajo de la ropa; lo que queda fuera es tela suelta. */
  body?: Uint8Array | null;
  /** Dónde NO buscar: cabeza, manos, piel. */
  skip?: Uint8Array | null;
  /** Articulaciones en píxeles de esta rejilla. */
  joints: Partial<Record<JointName, Pt>>;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

function segmentDistance(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t])), t };
}

/** Dirección principal de una línea y qué tan recta es. */
function shapeOf(pts: Pt[]) {
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += len(sub(pts[i], pts[i - 1]));
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = len(sub(b, a));
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= pts.length;
  my /= pts.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of pts) {
    xx += (p[0] - mx) ** 2;
    xy += (p[0] - mx) * (p[1] - my);
    yy += (p[1] - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { length, chord, straight: chord / (length || 1), dir: [Math.cos(ang), Math.sin(ang)] as Pt, mid: [mx, my] as Pt, a, b };
}

/**
 * Los dos lados de una línea son la misma tela si tienen el mismo tinte. La sombra baja la
 * claridad y con ella la saturación, así que el croma se compara en proporción a la claridad.
 */
function sameCloth(a: [number, number, number], b: [number, number, number]): boolean {
  const ca = Math.hypot(a[1], a[2]);
  const cb = Math.hypot(b[1], b[2]);
  if (ca < 10 && cb < 10) return true;
  const ra = ca / (a[0] + 12);
  const rb = cb / (b[0] + 12);
  if (Math.max(ra, rb) > Math.min(ra, rb) * 2.4 + 0.12) return false;
  if (Math.min(ca, cb) < 6) return Math.max(ca, cb) < 20;
  let dh = Math.abs(Math.atan2(a[2], a[1]) - Math.atan2(b[2], b[1]));
  if (dh > Math.PI) dh = Math.PI * 2 - dh;
  return dh < 0.6;
}

const LIMBS: { a: JointName; b: JointName; joint?: JointName; other?: JointName; name: string }[] = [
  { a: 'shoulderL', b: 'elbowL', name: 'brazo' },
  { a: 'shoulderR', b: 'elbowR', name: 'brazo' },
  { a: 'elbowL', b: 'wristL', name: 'antebrazo' },
  { a: 'elbowR', b: 'wristR', name: 'antebrazo' },
  { a: 'hipL', b: 'kneeL', name: 'muslo' },
  { a: 'hipR', b: 'kneeR', name: 'muslo' },
  { a: 'kneeL', b: 'ankleL', name: 'pierna' },
  { a: 'kneeR', b: 'ankleR', name: 'pierna' },
];

const BENDS: { joint: JointName; from: JointName; to: JointName; name: string }[] = [
  { joint: 'elbowL', from: 'shoulderL', to: 'wristL', name: 'codo' },
  { joint: 'elbowR', from: 'shoulderR', to: 'wristR', name: 'codo' },
  { joint: 'kneeL', from: 'hipL', to: 'ankleL', name: 'rodilla' },
  { joint: 'kneeR', from: 'hipR', to: 'ankleR', name: 'rodilla' },
];

export function readFolds(input: FoldInput): FoldRead {
  const { rgba, w, h, mask, joints: J } = input;
  const n = w * h;
  const empty: FoldRead = { folds: [], tension: [], hems: [], links: [], counts: {}, loose: false };
  let area = 0;
  let top = h;
  let bottom = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    area++;
    const y = Math.floor(i / w);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (area < 400) return empty;
  const tall = Math.max(20, bottom - top);
  const inner = distanceToEdge(mask, w, h);

  // Líneas dentro de la figura.
  const gray = new Float32Array(n);
  let meanGray = 0;
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    if (mask[i]) meanGray += gray[i];
  }
  meanGray /= area;
  // El contorno contra el fondo es el borde más fuerte de la imagen y taparía a los pliegues,
  // que son suaves: el fondo se iguala al tono medio de la figura antes de buscar líneas.
  for (let i = 0; i < n; i++) if (!mask[i]) gray[i] = meanGray;
  const soft = blur(gray, w, h, Math.max(1, tall / 150));
  const edges = canny(soft, w, h, 0.22);
  const margin = Math.max(2.5, tall * 0.012);
  for (let i = 0; i < n; i++) if (edges[i] && (!mask[i] || inner[i] / 3 < margin || input.skip?.[i])) edges[i] = 0;
  const lab = (x: number, y: number) => {
    const i = (Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))) * 4;
    return rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]);
  };
  const minLength = Math.max(7, tall * 0.035);
  const lines: Pt[][] = [];
  for (const raw of linkEdges(edges, w, h, Math.round(minLength))) {
    // Un pliegue separa luz y sombra del mismo material; un cambio de color es otra prenda o un estampado.
    let cross = 0;
    let checked = 0;
    const off = Math.max(2, tall * 0.012);
    for (let i = 2; i < raw.length - 2; i += 3) {
      const t = norm(sub(raw[i + 2], raw[i - 2]));
      const a = lab(raw[i][0] - t[1] * off, raw[i][1] + t[0] * off);
      const b = lab(raw[i][0] + t[1] * off, raw[i][1] - t[0] * off);
      checked++;
      if (!sameCloth(a, b)) cross++;
    }
    if (checked && cross / checked > 0.4) continue;
    // Los pliegues que nacen del mismo punto se tocan ahí y salen encadenados: se separan en
    // cada quiebre para leer cada uno por su cuenta.
    const simple = simplifyLine(raw, 1.1);
    let piece: Pt[] = [simple[0]];
    for (let i = 1; i < simple.length; i++) {
      piece.push(simple[i]);
      const next = simple[i + 1];
      if (!next) break;
      const u = norm(sub(simple[i], simple[i - 1]));
      const v = norm(sub(next, simple[i]));
      if (dot(u, v) < 0.58) {
        lines.push(piece);
        piece = [simple[i]];
      }
    }
    lines.push(piece);
  }
  // Puntos de tensión que da el esqueleto.
  const tension: Tension[] = [];
  const addT = (name: string, at?: Pt | null) => {
    if (at && at[0] >= 0 && at[1] >= 0 && at[0] < w && at[1] < h) tension.push({ at, name, count: 0 });
  };
  addT('hombro', J.shoulderL);
  addT('hombro', J.shoulderR);
  const armpit = (s?: Pt, hip?: Pt, e?: Pt) => (s && hip ? ([s[0] + (hip[0] - s[0]) * 0.22 + (e ? (e[0] - s[0]) * 0.08 : 0), s[1] + (hip[1] - s[1]) * 0.22] as Pt) : null);
  addT('axila', armpit(J.shoulderL, J.hipL, J.elbowL));
  addT('axila', armpit(J.shoulderR, J.hipR, J.elbowR));
  addT('codo', J.elbowL);
  addT('codo', J.elbowR);
  addT('cadera', J.hipL);
  addT('cadera', J.hipR);
  if (J.hipL && J.hipR) addT('entrepierna', [(J.hipL[0] + J.hipR[0]) / 2, (J.hipL[1] + J.hipR[1]) / 2 + len(sub(J.hipL, J.hipR)) * 0.45]);
  addT('rodilla', J.kneeL);
  addT('rodilla', J.kneeR);
  if (J.shoulderL && J.shoulderR && J.hipL && J.hipR) {
    const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    addT('pecho', mix(mix(J.shoulderL, J.shoulderR, 0.28), mix(J.hipL, J.hipR, 0.28), 0.3));
    addT('pecho', mix(mix(J.shoulderL, J.shoulderR, 0.72), mix(J.hipL, J.hipR, 0.72), 0.3));
  }

  const bends = BENDS.map((b) => {
    const j = J[b.joint];
    const a = J[b.from];
    const c = J[b.to];
    if (!j || !a || !c) return null;
    const u = norm(sub(a, j));
    const v = norm(sub(c, j));
    const flex = 180 - (Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180) / Math.PI;
    // El lado de adentro del doblez: hacia donde se cierran los dos huesos.
    const inside = norm([u[0] + v[0], u[1] + v[1]]);
    return { at: j, flex, inside, reach: Math.min(len(sub(a, j)), len(sub(c, j))), name: b.name };
  }).filter((b): b is NonNullable<typeof b> => !!b);

  // Lo que sobresale del cuerpo es tela suelta solo si está cosido a él a lo largo de un tramo.
  // Lo que apenas lo toca, o solo toca una mano, es algo que la figura sostiene: una espada.
  const free = new Uint8Array(n);
  const held = new Uint8Array(n);
  let looseArea = 0;
  if (input.body) {
    for (let i = 0; i < n; i++) if (mask[i] && !input.body[i] && !input.skip?.[i]) free[i] = 1;
    const label = new Int32Array(n);
    const stack: number[] = [];
    let next = 0;
    for (let start = 0; start < n; start++) {
      if (!free[start] || label[start]) continue;
      const id = ++next;
      const members: number[] = [];
      let sewn = 0;
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const q = stack.pop()!;
        members.push(q);
        const x = q % w;
        let touches = false;
        for (const o of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (o < 0 || o >= n) continue;
          if (free[o] && !label[o]) {
            label[o] = id;
            stack.push(o);
          } else if (input.body[o] && !input.skip?.[o]) touches = true;
        }
        if (touches) sewn++;
      }
      const small = members.length < area * 0.035;
      // Una falda va cosida a lo ancho; una espada toca al cuerpo en un punto de su largo.
      let bx0 = w;
      let bx1 = 0;
      let by0 = h;
      let by1 = 0;
      for (const q of members) {
        const x = q % w;
        const y = (q - x) / w;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      const long = Math.max(bx1 - bx0, by1 - by0) + 1;
      if (small || sewn < Math.max(8, long * 0.15)) {
        for (const q of members) {
          free[q] = 0;
          held[q] = 1;
        }
      } else looseArea += members.length;
    }
  }
  const at = (p: Pt) => Math.max(0, Math.min(h - 1, Math.round(p[1]))) * w + Math.max(0, Math.min(w - 1, Math.round(p[0])));
  const looseAt = (p: Pt) => !!free[at(p)];

  const folds: (Fold & { px: Pt[] })[] = [];
  const nearBend = new Map<number, number[]>();
  for (const pts of lines) {
    const s = shapeOf(pts);
    if (s.length < minLength) continue;
    let off = 0;
    for (const q of pts) if (held[at(q)]) off++;
    if (off / pts.length > 0.5) continue;
    const g = Math.abs(s.dir[1]);
    let loose = 0;
    for (const p of pts) if (looseAt(p)) loose++;
    const isLoose = loose / pts.length > 0.55;
    let kind: FoldKind | null = null;
    let anchor: number | undefined;

    // 1. Junto a una articulación doblada.
    let bend = -1;
    bends.forEach((b, i) => {
      if (b.flex < 38) return;
      if (len(sub(s.mid, b.at)) < b.reach * 0.42) bend = i;
    });
    if (bend >= 0 && !isLoose) {
      const b = bends[bend];
      const side = dot(norm(sub(s.mid, b.at)), b.inside);
      if (side > -0.2) {
        kind = 'llave';
        nearBend.set(bend, [...(nearBend.get(bend) ?? []), folds.length]);
      }
    }

    // 2. Tela suelta: manda la gravedad.
    if (!kind && isLoose) {
      const sag = s.straight < 0.93 && Math.abs(s.dir[0]) > 0.75;
      if (sag) {
        let low = -Infinity;
        for (const p of pts) if (p[1] > low) low = p[1];
        if (low - Math.max(s.a[1], s.b[1]) > s.chord * 0.1) kind = 'panal';
      }
      if (!kind) kind = g > 0.8 ? 'tubo' : s.mid[1] > bottom - tall * 0.1 ? 'inerte' : g > 0.5 ? 'caida' : 'inerte';
    }

    // 3. Sobre un brazo o una pierna.
    if (!kind) {
      let best: { axis: Pt; d: number; long: number } | null = null;
      for (const l of LIMBS) {
        const a = J[l.a];
        const b = J[l.b];
        if (!a || !b) continue;
        const long = len(sub(b, a));
        if (long < tall * 0.05) continue;
        const { d, t } = segmentDistance(s.mid, a, b);
        if (t <= 0.04 || t >= 0.96 || d > long * 0.3) continue;
        if (!best || d < best.d) best = { axis: norm(sub(b, a)), d, long };
      }
      if (best && s.length < best.long * 1.2) {
        const along = Math.abs(dot(s.dir, best.axis));
        if (along < 0.4) kind = 'acordeon';
        else if (along < 0.86) kind = 'espiral';
        else kind = Math.abs(best.axis[1]) > 0.8 ? 'tubo' : 'tension';
      }
    }

    // 4. U entre dos apoyos, sobre el cuerpo.
    if (!kind && s.straight < 0.9 && Math.abs(s.dir[0]) > 0.8) {
      let low = -Infinity;
      for (const p of pts) if (p[1] > low) low = p[1];
      if (low - Math.max(s.a[1], s.b[1]) > s.chord * 0.14) kind = 'panal';
    }

    // 5. Sale de un punto de tensión: su recta pasa por él y se aleja.
    if (!kind || kind === 'tension') {
      let bestD = tall * 0.07;
      tension.forEach((t, i) => {
        const da = len(sub(s.a, t.at));
        const db = len(sub(s.b, t.at));
        const nearEnd = da < db ? s.a : s.b;
        const farEnd = da < db ? s.b : s.a;
        if (Math.min(da, db) > tall * 0.3) return;
        const away = norm(sub(farEnd, nearEnd));
        const to = sub(t.at, nearEnd);
        // El punto queda detrás del pliegue, sobre su prolongación.
        if (dot(to, away) > tall * 0.02) return;
        const perp = Math.abs(to[0] * away[1] - to[1] * away[0]);
        if (perp < bestD && s.straight > 0.86) {
          bestD = perp;
          anchor = i;
        }
      });
      if (anchor !== undefined) kind = 'tension';
    }
    if (!kind) kind = s.straight > 0.92 ? 'tension' : 'inerte';
    folds.push({ pts: pts.map(([x, y]) => [x / w, y / h] as Pt), px: pts, kind, anchor });
  }
  // Varios quiebres juntos en la misma articulación son un zigzag.
  for (const list of nearBend.values()) if (list.length >= 2) for (const i of list) folds[i].kind = 'acordeon';
  for (const f of folds) if (f.anchor !== undefined) tension[f.anchor].count++;

  // Tela suelta: su borde de abajo y de dónde cuelga cada cresta.
  const hems: Pt[][] = [];
  const links: [Pt, Pt][] = [];
  if (input.body) {
    if (looseArea > area * 0.06) {
      // Por columnas: el punto más bajo de la tela suelta, si de verdad cuelga bajo el cuerpo.
      const hem: Pt[] = [];
      const flush = () => {
        if (hem.length >= Math.max(10, tall * 0.12)) {
          const smooth = hem.map((p, i) => {
            let sum = 0;
            let c = 0;
            for (let k = -2; k <= 2; k++) {
              const q = hem[i + k];
              if (q) {
                sum += q[1];
                c++;
              }
            }
            return [p[0], sum / c] as Pt;
          });
          hems.push(simplifyLine(smooth, 0.8).map(([x, y]) => [x / w, y / h] as Pt));
          // Crestas: lo más bajo de cada onda.
          const hang = [J.shoulderL, J.shoulderR, J.hipL, J.hipR, J.neck].filter((p): p is Pt => !!p);
          const span = Math.max(3, Math.round(tall * 0.03));
          for (let i = span; i < smooth.length - span; i++) {
            let peak = true;
            for (let k = -span; k <= span; k++) if (smooth[i + k][1] > smooth[i][1]) peak = false;
            if (!peak || smooth[i][1] - Math.min(smooth[i - span][1], smooth[i + span][1]) < tall * 0.008) continue;
            const from = hang.filter((p) => p[1] < smooth[i][1] - tall * 0.1).sort((a, b) => Math.abs(a[0] - smooth[i][0]) - Math.abs(b[0] - smooth[i][0]))[0];
            if (from) links.push([[from[0] / w, from[1] / h], [smooth[i][0] / w, smooth[i][1] / h]]);
            i += span;
          }
        }
        hem.length = 0;
      };
      for (let x = 0; x < w; x++) {
        let low = -1;
        for (let y = h - 1; y >= 0; y--) {
          if (mask[y * w + x]) {
            low = free[y * w + x] ? y : -1;
            break;
          }
        }
        if (low < 0 || (hem.length && Math.abs(low - hem[hem.length - 1][1]) > tall * 0.08)) flush();
        if (low >= 0) hem.push([x, low]);
      }
      flush();
    }
  }

  const counts: Partial<Record<FoldKind, number>> = {};
  for (const f of folds) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return {
    folds: folds.map(({ pts, kind, anchor }) => ({ pts, kind, anchor })),
    tension: tension.map((t) => ({ ...t, at: [t.at[0] / w, t.at[1] / h] as Pt })),
    hems,
    links: links.slice(0, 14),
    counts,
    loose: looseArea > area * 0.06,
  };
}
