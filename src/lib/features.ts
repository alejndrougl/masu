import type { Pt, Rect } from './types';

import { t as tx } from '../i18n';
/**
 * Construcción de un rasgo de cerca. Cada etapa agrega algo sobre la anterior, como se
 * dibuja de verdad: primero la forma que lo sostiene y al final el detalle.
 * Todo llega en coordenadas de encuadre (0 a 1).
 */
export interface FeatureStage {
  name: string;
  text: string;
  /** Trazos de esta etapa. */
  lines: Pt[][];
  /** Formas cerradas. */
  loops: Pt[][];
  /** Guías en rojo: ejes y direcciones. */
  accent: Pt[][];
  /** Puntos que importa ubicar. */
  dots: Pt[];
  /** Manchas de valor: alpha sobre tinta. */
  shade: { poly: Pt[]; alpha: number }[];
  /** Brillos: papel sobre la forma. */
  light: Pt[][];
}

export interface Feature {
  id: string;
  name: string;
  /** Lo que se acerca al elegirlo. */
  box: Rect;
  stages: FeatureStage[];
}

/** Lo que se sabe de un ojo. "outer" va hacia la sien e "inner" hacia la nariz. */
export interface EyeShape {
  outer: Pt;
  inner: Pt;
  /** De afuera hacia adentro. */
  upper: Pt[];
  lower: Pt[];
  iris: Pt | null;
  irisR: number | null;
  /** Pliegue sobre el párpado. */
  crease: Pt[] | null;
  /** Línea bajo el párpado inferior. */
  under: Pt[] | null;
  brow: Pt[] | null;
}

export interface NoseShape {
  top: Pt;
  bridgeL: Pt;
  bridgeR: Pt;
  tip: Pt;
  wingL: Pt;
  wingR: Pt;
  base: Pt;
  nostrilL: Pt;
  nostrilR: Pt;
  /** Contorno real de las alas, de lado a lado por debajo. */
  edge: Pt[] | null;
}

export interface MouthShape {
  cornerL: Pt;
  cornerR: Pt;
  top: Pt;
  bottom: Pt;
  /** Contorno de labios, si se conoce. */
  outer: Pt[] | null;
  /** Línea donde se juntan los labios. */
  seam: Pt[] | null;
}

/** Redondea un trazo sin mover sus extremos. */
function smooth(line: Pt[], passes = 2): Pt[] {
  let cur = line;
  for (let k = 0; k < passes && cur.length > 2; k++) {
    const next: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) next.push(mix(cur[i], cur[i + 1], 0.25), mix(cur[i], cur[i + 1], 0.75));
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

const blank = (name: string, text: string): FeatureStage => ({ name, text, lines: [], loops: [], accent: [], dots: [], shade: [], light: [] });
const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const TAU = Math.PI * 2;

/** Elipse en coordenadas cuadradas. */
function ellipse(c: Pt, along: Pt, major: number, minor: number, count = 40): Pt[] {
  const n = Math.hypot(along[0], along[1]) || 1;
  const ux = along[0] / n;
  const uy = along[1] / n;
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU;
    const a = major * Math.cos(t);
    const b = minor * Math.sin(t);
    out.push([c[0] + a * ux - b * uy, c[1] + a * uy + b * ux]);
  }
  return out;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Recorta un polígono contra una forma convexa: el iris solo se ve entre los párpados. */
export function clipConvex(subject: Pt[], hull: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    area += ax * by - bx * ay;
  }
  const clip = area >= 0 ? hull : [...hull].reverse();
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const next: Pt[] = [];
    for (let k = 0; k < out.length; k++) {
      const p = out[k];
      const q = out[(k + 1) % out.length];
      const ip = cross(a, b, p) >= 0;
      const iq = cross(a, b, q) >= 0;
      if (ip) next.push(p);
      if (ip !== iq) {
        const dp = cross(a, b, p);
        const dq = cross(a, b, q);
        next.push(mix(p, q, dp / (dp - dq)));
      }
    }
    out = next;
  }
  return out;
}

/** Envolvente convexa, suficiente para la abertura del ojo. */
function hullOf(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.reverse())];
}

function boxAround(points: Pt[], pad: number, aspect: number): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0) * (1 + pad * 2);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // La vista se acerca a una caja del aspecto del lienzo, no a una deformada.
  const w = aspect >= 1 ? size / aspect : size;
  const h = aspect >= 1 ? size : size * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function gazeWord(dx: number, dy: number): string {
  const side = Math.abs(dx) < 0.16 ? '' : dx > 0 ? tx('common.la_derecha_2') : tx('common.la_izquierda_2');
  const level = Math.abs(dy) < 0.16 ? '' : dy > 0 ? tx('common.abajo') : tx('common.arriba');
  if (!side && !level) return tx('features.al_frente');
  return [level, side].filter(Boolean).join(tx('common.sep_y'));
}

/** Lo que se mide en cuadrado se entrega en el encuadre. */
function toFrame(stage: FeatureStage, aspect: number): FeatureStage {
  const f = (p: Pt): Pt => [p[0] / aspect, p[1]];
  const list = (l: Pt[][]) => l.map((q) => q.map(f));
  return {
    ...stage,
    lines: list(stage.lines),
    loops: list(stage.loops),
    accent: list(stage.accent),
    dots: stage.dots.map(f),
    shade: stage.shade.map((s) => ({ alpha: s.alpha, poly: s.poly.map(f) })),
    light: list(stage.light),
  };
}

/**
 * Ojo: una esfera en su cuenca, envuelta por los párpados. El iris no es un círculo sino
 * una elipse que se aplana hacia donde mira, y por eso la dirección de la mirada se dibuja
 * con dos ejes que dan la vuelta a la bola.
 */
export function eyeFeature(id: string, name: string, given: EyeShape, aspect: number, drawn = false): Feature {
  const sq = (p: Pt): Pt => [p[0] * aspect, p[1]];
  // En una cara diminuta pueden faltar puntos de un párpado: se usa el centro del ojo.
  const center: Pt = [(given.outer[0] + given.inner[0]) / 2, (given.outer[1] + given.inner[1]) / 2];
  const eye: EyeShape = { ...given, upper: given.upper.length ? given.upper : [center], lower: given.lower.length ? given.lower : [center] };
  const outer = sq(eye.outer);
  const inner = sq(eye.inner);
  const upper = eye.upper.map(sq);
  const lower = eye.lower.map(sq);
  const width = dist(outer, inner) || 1e-4;
  const u: Pt = [(inner[0] - outer[0]) / width, (inner[1] - outer[1]) / width];
  const v: Pt = u[0] >= 0 ? [-u[1], u[0]] : [u[1], -u[0]];
  const mid = mix(outer, inner, 0.5);
  const R = width * 0.46;
  const ball: Pt = [mid[0] + v[0] * R * 0.08, mid[1] + v[1] * R * 0.08];
  const iris = eye.iris ? sq(eye.iris) : ball;
  const irisR = eye.irisR ? eye.irisR * Math.sqrt((aspect * aspect + 1) / 2) : width * 0.21;
  const gx = (iris[0] - ball[0]) / R;
  const gy = (iris[1] - ball[1]) / R;
  const lean = Math.min(0.92, Math.hypot(gx, gy));
  const squash = Math.sqrt(1 - lean * lean);
  const irisShape = lean > 0.04 ? ellipse(iris, [-gy, gx], irisR, irisR * squash) : ellipse(iris, [1, 0], irisR, irisR);
  const opening = hullOf([...upper, ...lower, outer, inner]);
  const seen = clipConvex(irisShape, opening);
  const pupil = ellipse(iris, lean > 0.04 ? [-gy, gx] : [1, 0], irisR * 0.42, irisR * 0.42 * squash, 24);
  const span = width * 1.5;

  const tilt = (Math.atan2(inner[1] - outer[1], Math.abs(inner[0] - outer[0])) * 180) / Math.PI;
  const rise = Math.round(Math.abs(tilt));
  const riseWord = rise < 3 ? tx('features.las_dos_comisuras_quedan') : tilt > 0 ? tx('features.la_comisura_de_afuera', { rise }) : tx('features.la_comisura_de_afuera_2', { rise });

  // Dónde está el punto más alto del párpado: casi nunca a la mitad.
  const heightOf = (p: Pt) => (p[0] - ball[0]) * v[0] + (p[1] - ball[1]) * v[1];
  const along = (p: Pt) => ((p[0] - outer[0]) * u[0] + (p[1] - outer[1]) * u[1]) / width;
  const peak = upper.reduce((best, p) => (heightOf(p) < heightOf(best) ? p : best), upper[0]);
  const sag = lower.reduce((best, p) => (heightOf(p) > heightOf(best) ? p : best), lower[0]);
  const peakWord = along(peak) > 0.56 ? tx('features.hacia_la_nariz') : along(peak) < 0.44 ? tx('features.hacia_la_sien') : tx('features.casi_al_centro');
  const sagWord = along(sag) > 0.56 ? tx('features.hacia_la_nariz') : along(sag) < 0.44 ? tx('features.hacia_la_sien') : tx('features.casi_al_centro');

  const axisH: Pt[] = [];
  const axisV: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI - Math.PI / 2;
    // Dos círculos máximos que pasan por el iris: bajo la mirada se ven curvos.
    axisH.push([ball[0] + R * Math.sin(t) * u[0] + (gy * R * Math.cos(t)) * v[0], ball[1] + R * Math.sin(t) * u[1] + (gy * R * Math.cos(t)) * v[1]]);
    axisV.push([ball[0] + R * Math.sin(t) * v[0] + (gx * R * Math.cos(t)) * u[0] * Math.sign(u[0] || 1), ball[1] + R * Math.sin(t) * v[1] + (gx * R * Math.cos(t)) * u[1] * Math.sign(u[0] || 1)]);
  }

  const s1 = blank(tx('features.bola_del_ojo'), tx('features.una_esfera_metida_en'));
  s1.loops.push(ellipse(ball, [1, 0], R, R, 48));
  s1.accent.push([mix(outer, inner, -0.25), mix(outer, inner, 1.25)]);

  const s2 = blank(tx('features.comisuras'), riseWord);
  s2.dots.push(outer, inner);
  s2.lines.push([outer, inner]);

  const s3 = blank(tx('features.parpados'), tx('features.el_punto_mas_alto', { peakWord, sagWord }));
  s3.lines.push(smooth(upper), smooth(lower));
  s3.dots.push(peak, sag);

  // Un ojo cerrado no tiene iris que dibujar: lo que se lee es el párpado sobre la bola.
  // Se mide tramo por tramo: cerrado, los dos párpados bajan juntos por la misma curva.
  const gap = Math.max(...upper.map((p, i) => heightOf(lower[Math.round((i / (upper.length - 1 || 1)) * (lower.length - 1))]) - heightOf(p)));
  const closed = gap / width < 0.13;
  const s4 = closed
    ? blank(tx('features.parpado_cerrado'), tx('features.el_ojo_esta_cerrado'))
    : blank(tx('features.iris'), tx('features.mira_es_una_elipse', { v1: gazeWord(gx, gy), v2: lean > 0.2 ? tx('features.aplanada_hacia_ese_lado') : '' }));
  if (closed) s4.accent.push(axisV);
  else s4.loops.push(seen);
  if (!closed) s4.accent.push(axisH, axisV);

  const s5 = closed ? blank(tx('features.pestanas'), tx('features.salen_del_borde_siguen')) : blank(tx('features.pupila_brillo'), tx('features.la_pupila_sigue_el'));
  // En un dibujo la pupila ya está hecha: se marca su lugar sin taparla.
  if (closed) s5.lines.push(smooth(lower));
  else if (drawn) s5.loops.push(clipConvex(pupil, opening));
  else s5.shade.push({ poly: clipConvex(pupil, opening), alpha: 0.9 });
  const top = [...upper].map((p): Pt => [p[0] + v[0] * irisR * 0.5, p[1] + v[1] * irisR * 0.5]);
  if (!closed) s5.shade.push({ poly: clipConvex([...upper, ...top.reverse()], clipConvex(irisShape, opening)), alpha: 0.32 });
  if (!drawn && !closed) s5.light.push(ellipse([iris[0] - irisR * 0.34, iris[1] - irisR * 0.34], [1, 0], irisR * 0.17, irisR * 0.17, 16));

  const s6 = blank(tx('features.pliegue_lagrimal'), tx('features.el_pliegue_repite_la'));
  if (eye.crease) s6.lines.push(eye.crease.map(sq));
  if (eye.under) s6.lines.push(eye.under.map(sq));
  const duct = mix(inner, mid, 0.08);
  s6.loops.push(ellipse(duct, [u[0], u[1]], width * 0.055, width * 0.03, 16));

  const s7 = blank(tx('features.ceja_valor'), tx('features.la_ceja_cierra_la'));
  if (eye.brow) {
    const brow = eye.brow.map(sq);
    // Con pocos puntos solo se conoce su recorrido, no su forma.
    if (brow.length < 6) s7.lines.push(smooth(brow));
    else s7.loops.push(brow);
    if (eye.crease) s7.shade.push({ poly: [...brow.slice(0, Math.ceil(brow.length / 2)), ...eye.crease.map(sq).reverse()], alpha: 0.14 });
  }
  const corner = (c: Pt) => ellipse(c, [u[0], u[1]], width * 0.2, width * 0.13, 18);
  s7.shade.push({ poly: clipConvex(corner(outer), opening), alpha: 0.2 }, { poly: clipConvex(corner(inner), opening), alpha: 0.14 });

  const all = [outer, inner, ...upper, ...lower, ...(eye.brow?.map(sq) ?? []), [ball[0], ball[1] - span * 0.5] as Pt];
  return { id, name, box: boxAround(all.map((p): Pt => [p[0] / aspect, p[1]]), 0.08, aspect), stages: [s1, s2, s3, s4, s5, s6, s7].map((s) => toFrame(s, aspect)) };
}

/**
 * Nariz: una cuña que baja de la frente y termina en tres bolas, la punta y las dos alas.
 * La base es un plano que mira abajo: casi siempre es lo más oscuro de la nariz.
 */
export function noseFeature(nose: NoseShape, aspect: number): Feature {
  const sq = (p: Pt): Pt => [p[0] * aspect, p[1]];
  const top = sq(nose.top);
  const bridgeL = sq(nose.bridgeL);
  const bridgeR = sq(nose.bridgeR);
  const tip = sq(nose.tip);
  const wingL = sq(nose.wingL);
  const wingR = sq(nose.wingR);
  const base = sq(nose.base);
  const nostL = sq(nose.nostrilL);
  const nostR = sq(nose.nostrilR);
  const width = dist(wingL, wingR) || 1e-4;
  const ballR = width * 0.26;
  const wingBall = width * 0.19;
  const tipBall = mix(tip, base, 0.25);
  const dir: Pt = [wingR[0] - wingL[0], wingR[1] - wingL[1]];

  const s1 = blank(tx('common.cuna'), tx('features.un_bloque_que_nace'));
  s1.lines.push([bridgeL, wingL], [bridgeR, wingR], [wingL, wingR], [bridgeL, bridgeR]);
  s1.accent.push([top, mix(top, tip, 0.5), tip, base]);

  const s2 = blank(tx('features.tres_bolas'), tx('features.la_punta_al_centro'));
  s2.loops.push(ellipse(tipBall, [1, 0], ballR, ballR, 32), ellipse(wingL, [1, 0], wingBall, wingBall, 24), ellipse(wingR, [1, 0], wingBall, wingBall, 24));

  const s3 = blank(tx('common.planos'), tx('features.lomo_arriba_dos_costados'));
  s3.lines.push([bridgeL, sq(mix(nose.tip, nose.wingL, 0.42))], [bridgeR, sq(mix(nose.tip, nose.wingR, 0.42))], [sq(mix(nose.tip, nose.wingL, 0.42)), base, sq(mix(nose.tip, nose.wingR, 0.42))]);

  const s4 = blank(tx('features.base_fosas'), tx('features.las_fosas_no_son'));
  const pull = (p: Pt): Pt => mix(p, base, 0.08);
  s4.loops.push(ellipse(pull(nostL), dir, width * 0.11, width * 0.055, 20), ellipse(pull(nostR), dir, width * 0.11, width * 0.055, 20));
  s4.dots.push(base);

  const s5 = blank(tx('common.contorno'), tx('features.del_entrecejo_la_punta'));
  s5.lines.push(smooth(nose.edge && nose.edge.length > 2 ? nose.edge.map(sq) : [wingL, mix(wingL, base, 0.5), base, mix(wingR, base, 0.5), wingR], 1));

  const s6 = blank(tx('features.luz_sombra'), tx('features.el_plano_de_abajo'));
  s6.shade.push({ poly: [wingL, tipBall, wingR, base], alpha: 0.34 });
  // El costado va delgado: es el paso entre el lomo y la mejilla, no una mancha.
  s6.shade.push({ poly: [mix(bridgeR, tip, 0.25), sq(mix(nose.tip, nose.wingR, 0.42)), wingR, mix(bridgeR, wingR, 0.55)], alpha: 0.12 });
  s6.light.push(ellipse(mix(tipBall, top, 0.16), [1, 0], ballR * 0.2, ballR * 0.14, 14));

  const pts = [top, wingL, wingR, base, tip].map((p): Pt => [p[0] / aspect, p[1]]);
  return { id: 'nariz', name: tx('features.nariz'), box: boxAround(pts, 0.12, aspect), stages: [s1, s2, s3, s4, s5, s6].map((s) => toFrame(s, aspect)) };
}

/** Boca: sigue la curva de los dientes, así que nunca es recta aunque esté cerrada. */
export function mouthFeature(mouth: MouthShape, aspect: number): Feature {
  const sq = (p: Pt): Pt => [p[0] * aspect, p[1]];
  const l = sq(mouth.cornerL);
  const r = sq(mouth.cornerR);
  const top = sq(mouth.top);
  const bottom = sq(mouth.bottom);
  const mid = mix(l, r, 0.5);
  const span = dist(l, r) || 1e-4;
  const up: Pt = [top[0] - mid[0], top[1] - mid[1]];

  const s1 = blank(tx('features.eje_comisuras'), tx('features.la_linea_de_las'));
  s1.accent.push([l, r], [mix(top, mid, -0.5), mix(bottom, mid, -0.5)]);
  s1.dots.push(l, r);

  const s2 = blank(tx('features.labio_de_arriba'), tx('features.tres_planos_dos_que'));
  const bowL = mix(top, l, 0.18);
  const bowR = mix(top, r, 0.18);
  s2.lines.push(smooth([l, mix(l, bowL, 0.55), [bowL[0] + up[0] * 0.14, bowL[1] + up[1] * 0.14], top, [bowR[0] + up[0] * 0.14, bowR[1] + up[1] * 0.14], mix(r, bowR, 0.55), r], 1));

  const s3 = blank(tx('features.labio_de_abajo'), tx('features.mas_lleno_mas_ancho'));
  s3.lines.push(smooth([l, mix(l, bottom, 0.45), mix(mix(l, bottom, 0.8), mid, -0.25), bottom, mix(mix(r, bottom, 0.8), mid, -0.25), mix(r, bottom, 0.45), r]));

  const s4 = blank(tx('features.linea_de_union'), tx('features.es_lo_mas_oscuro'));
  if (mouth.seam) s4.lines.push(smooth(mouth.seam.map(sq), 1));
  else s4.lines.push(smooth([l, mix(mid, top, 0.1), r]));

  const s5 = blank(tx('features.forma_real_valor'), tx('features.el_labio_de_arriba'));
  if (mouth.outer && mouth.outer.length > 6) s5.loops.push(mouth.outer.map(sq));
  s5.shade.push({ poly: smooth([l, mix(l, top, 0.6), top, mix(r, top, 0.6), r, mix(mid, top, 0.1), l], 1), alpha: 0.26 });
  s5.shade.push({ poly: ellipse(mix(mid, bottom, 1.42), [r[0] - l[0], r[1] - l[1]], span * 0.2, span * 0.045, 18), alpha: 0.16 });
  s5.light.push(ellipse(mix(mid, bottom, 0.62), [r[0] - l[0], r[1] - l[1]], span * 0.08, span * 0.022, 16));

  return { id: 'boca', name: tx('features.boca'), box: boxAround([l, r, top, bottom].map((p): Pt => [p[0] / aspect, p[1]]), 0.14, aspect), stages: [s1, s2, s3, s4, s5].map((s) => toFrame(s, aspect)) };
}

/**
 * Ojo de un dibujo a partir de sus píxeles: lo oscuro de arriba es el párpado, y la mancha
 * oscura de abajo de él es el iris. `L` da la claridad de un punto del encuadre, 0 a 1.
 */
export function eyeFromPixels(box: Rect, L: (p: Pt) => number, aspect: number, towardNose: 1 | -1): EyeShape {
  const COLS = 24;
  const ROWS = 18;
  const at = (c: number, r: number): Pt => [box.x + ((c + 0.5) / COLS) * box.w, box.y + ((r + 0.5) / ROWS) * box.h];
  let lo = 1;
  let hi = 0;
  const grid: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = L(at(c, r));
      grid.push(v);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const dark = lo + (hi - lo) * 0.42;
  const top = new Array<number | null>(COLS).fill(null);
  const bottom = new Array<number | null>(COLS).fill(null);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (grid[r * COLS + c] < dark) {
        top[c] ??= r;
        bottom[c] = r;
      }
    }
  }
  const used = top.map((t, c) => (t === null ? -1 : c)).filter((c) => c >= 0);
  const c0 = used[0] ?? 0;
  const c1 = used[used.length - 1] ?? COLS - 1;
  const left = at(c0, (top[c0] ?? ROWS / 2) + 1);
  const right = at(c1, (top[c1] ?? ROWS / 2) + 1);
  // La mediana quita los dientes que dejan pestañas y brillos sueltos.
  const steady = (list: (number | null)[], c: number) => {
    const near = [c - 2, c - 1, c, c + 1, c + 2].map((i) => list[i]).filter((v): v is number => v !== null && v !== undefined).sort((p, q) => p - q);
    return near[near.length >> 1];
  };
  const upperRaw = used.map((c) => at(c, steady(top, c)));
  const lowerRaw = used.map((c) => at(c, steady(bottom, c)));
  // Lo oscuro abajo de la pestaña: el iris.
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const lid = top[c] ?? 0;
      if (r > lid + 2 && grid[r * COLS + c] < dark) {
        sx += c;
        sy += r;
        n++;
      }
    }
  }
  const cx = n ? sx / n : COLS / 2;
  const cy = n ? sy / n : ROWS / 2;
  const iris = at(cx, cy);
  const irisR = Math.min(box.w * aspect * 0.42, Math.max(box.h * 0.2, Math.sqrt(n / Math.PI) * (box.h / ROWS)));
  const flip = towardNose > 0;
  const outer = flip ? left : right;
  const inner = flip ? right : left;
  const order = (list: Pt[]) => (flip ? list : [...list].reverse());
  return { outer, inner, upper: order(upperRaw), lower: order(lowerRaw), iris, irisR: irisR / Math.sqrt((aspect * aspect + 1) / 2), crease: null, under: null, brow: null };
}
