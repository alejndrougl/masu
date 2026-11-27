import { MHR } from '../lib/body';
import type { FigureModel } from '../lib/figure';
import {
  handGeometry, beanSides, bowlShape, boxOf, clipByCloser, classifyTrunk, crossContours, eggShape, hashSeed, morphToShape, partShape, pushAction, resampleEvery, rhythmCurve, shapePolygon, shapeTerminator,
  clipInside, dilateMask, eggDeform, ellipsoidRing, ellipsoidSilhouette, smoothCurve, smoothWidths, splitClosed, styleParams, tiltedOval, tremor, TRUNK_SHAPE_NOTE, pointInPoly,
  type Bean, type BoneRef, type DrawStyle, type Form, type OrganicShape, type StyleParams, type TrunkShape, type V3,
} from '../lib/organic';
import type { LightSource } from '../lib/light';
import { PART } from '../lib/surface';
import type { PartProfile } from '../lib/shapes';
import type { Pt } from '../lib/types';
import type { State } from '../state/store';
import { ctxOf, trunkOf, type Ctx } from './artist-draw';
import { lightOf, shownLights } from './light-draw';
import type { Prim, View } from './overlays';
import { ROJO } from './palette';

/**
 * Construcción orgánica: lo que dibuja un dibujante, no un programa. El paso 1 es gesto (la línea de
 * acción y los ritmos), el 2 el esqueleto, el 3 las masas (cabeza, caja torácica, pelvis, el frijol
 * del tronco) y el 4 las formas reales de cada parte con solapes y contornos transversales. Cada
 * línea es un trazo con presión: tenue la construcción, firme la forma, con peso el contorno.
 */

const INK = 'var(--ink)';
const COLD = '#4F6FA8';

export type Role = 'gesto' | 'ritmo' | 'construccion' | 'forma' | 'contorno' | 'acento';

interface Stroke {
  id: string;
  role: Role;
  /** En píxeles de la vista. */
  pts: Pt[];
  closed?: boolean;
  /** Forma a la que pertenece: de ella sale su profundidad y no se recorta contra sí misma. */
  form?: Form | null;
  /** Se recorta contra lo que tiene más cerca (solo forma y contorno). */
  clip?: boolean;
  fade?: number;
  thin?: number;
  /** Cuánto pesa el contorno en cada punto, de 0 a 1. */
  weigh?: (p: Pt, u: number) => number;
  /** El contorno de la cabeza no se recorta contra la máscara: siempre cerrado. */
  noMask?: boolean;
  /** Región a la que se limita el trazo (guías de la cabeza). */
  bound?: (x: number, y: number) => boolean;
  /** Los óvalos dan 1.06 vueltas. */
  turns?: boolean;
  /** Cuántos trazos son un contorno cerrado. */
  split?: number;
}

export interface OrganicOpts {
  style: DrawStyle;
  exaggeration: number;
  simplification: number;
  theme: State['theme'];
  light: LightSource | null;
  /** Máscara de la figura en el encuadre: lo que se sale de ella (dilatada) se corta. */
  mask?: { data: Uint8Array; w: number; h: number } | null;
}

/* ───────────────────────── datos de la figura ───────────────────────── */

interface Part {
  key: string;
  shape: OrganicShape;
  poly: Pt[];
  form: Form;
  bone: BoneRef | null;
}

interface FigData {
  k: number;
  rigH: number;
  eps: number;
  parts: Map<string, Part>;
  tubes: Map<string, Part>;
  egg: Part | null;
  bowl: Part | null;
  bean: { bean: Bean; poly: Pt[]; form: Form; stations: number } | null;
  trunkZ: number;
  forms: Form[];
  ymin: number;
  ymax: number;
  trunk: ReturnType<typeof trunkOf>;
  bowlRim: Pt[] | null;
  headCache: Map<string, Stroke[]>;
  ctx: Ctx;
  shape: { shape: TrunkShape; ratio: number; text: string } | null;
}

const KEY_PART: Record<string, number> = {
  torax: PART.pecho, abdomen: PART.vientre, pelvis: PART.pelvis, cuello: PART.cuello,
  brazoL: PART.brazoL, brazoR: PART.brazoR, antebrazoL: PART.antebrazoL, antebrazoR: PART.antebrazoR, manoL: PART.manoL, manoR: PART.manoR,
  musloL: PART.musloL, musloR: PART.musloR, piernaL: PART.piernaL, piernaR: PART.piernaR, pieL: PART.pieL, pieR: PART.pieR,
};

const mid3 = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

function boneOf(c: Ctx, key: string): BoneRef | null {
  const { rig } = c;
  const side = key.endsWith('L') ? 'L' : 'R';
  const J = (name: string) => MHR[(name + side) as keyof typeof MHR];
  const P = (i: number) => rig.pts[i];
  const ok = (...ids: number[]) => ids.every((i) => !!rig.pts[i] && c.seen(i));
  if (key.startsWith('antebrazo')) return ok(J('elbow'), J('wrist')) ? { a: P(J('elbow')), b: P(J('wrist')) } : null;
  if (key.startsWith('brazo')) return ok(J('shoulder'), J('elbow')) ? { a: P(J('shoulder')), b: P(J('elbow')) } : null;
  if (key.startsWith('mano')) {
    if (!ok(J('elbow'), J('wrist'))) return null;
    const a = P(J('wrist'));
    const e = P(J('elbow'));
    return { a, b: [a[0] + (a[0] - e[0]) * 0.4, a[1] + (a[1] - e[1]) * 0.4, a[2] + (a[2] - e[2]) * 0.4] };
  }
  if (key.startsWith('muslo')) return ok(J('hip'), J('knee')) ? { a: P(J('hip')), b: P(J('knee')) } : null;
  if (key.startsWith('pierna')) return ok(J('knee'), J('ankle')) ? { a: P(J('knee')), b: P(J('ankle')) } : null;
  if (key.startsWith('pie')) return ok(J('ankle')) && rig.pts[J('toe')] ? { a: P(J('ankle')), b: P(J('toe')) } : null;
  if (key === 'cuello') return ok(MHR.neck) && rig.pts[MHR.earL] && rig.pts[MHR.earR] ? { a: P(MHR.neck), b: mid3(P(MHR.earL), P(MHR.earR)) } : null;
  if (ok(MHR.shoulderL, MHR.shoulderR, MHR.hipL, MHR.hipR)) return { a: mid3(P(MHR.shoulderL), P(MHR.shoulderR)), b: mid3(P(MHR.hipL), P(MHR.hipR)) };
  return null;
}

const scaleShape = (s: OrganicShape, k: number): OrganicShape => {
  const m = (a: Pt[] | undefined) => a?.map((p): Pt => [p[0] * k, p[1] * k]);
  return { ...s, left: m(s.left)!, right: m(s.right)!, axis: m(s.axis)!, capStart: m(s.capStart), capEnd: m(s.capEnd), half: s.half.map((h) => h * k) };
};

const formOf = (id: string, poly: Pt[], z: number): Form => ({ id, poly, z, box: boxOf(poly) });

const inFrameHalf = (p: PartProfile, W: number, H: number): boolean => {
  const aspect = W / H;
  let n = 0;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = (p.origin[0] + p.axis[0] * t) / aspect;
    const y = p.origin[1] + p.axis[1] * t;
    if (x > -0.02 && x < 1.02 && y > -0.02 && y < 1.02) n++;
  }
  return n >= 3;
};

const dataCache = new WeakMap<FigureModel, Map<string, FigData | null>>();

function figureData(model: FigureModel, v: View, st: StyleParams): FigData | null {
  const key = `${st.style}|${st.exaggeration.toFixed(2)}|${st.simplification.toFixed(2)}|${v.W}x${v.H}`;
  let held = dataCache.get(model);
  if (!held) dataCache.set(model, (held = new Map()));
  if (held.has(key)) return held.get(key)!;
  const out = buildData(model, v, st);
  held.set(key, out);
  return out;
}

function buildData(model: FigureModel, v: View, st: StyleParams): FigData | null {
  const c = ctxOf(model, v);
  const surf = model.surface;
  if (!c || !surf || !surf.profiles.length) return null;
  const k = v.H;
  const { rig } = c;
  const H = rig.H;
  const eps = 0.01 * H;
  const absent = new Set(surf.absent);
  const profs = new Map<string, PartProfile>();
  for (const p of surf.profiles) {
    const part = KEY_PART[p.key];
    if (part === undefined || absent.has(part) || !inFrameHalf(p, v.W, v.H)) continue;
    profs.set(p.key, p);
  }
  if ((globalThis as { __organicLog?: boolean }).__organicLog) console.log('organico', model.id, 'perfiles', surf.profiles.map((p) => p.key).join(','), 'dibuja', [...profs.keys()].join(','), 'ausentes', [...absent].join(','));
  const trunk = trunkOf(c, model);
  if (!profs.has('cuello')) {
    const neck = fallbackNeck(model, c, v);
    if (neck) profs.set('cuello', neck);
  }
  const trunkCenter = ok3(rig.pts[MHR.shoulderL], rig.pts[MHR.shoulderR], rig.pts[MHR.hipL], rig.pts[MHR.hipR]) ? [(rig.pts[MHR.shoulderL][0] + rig.pts[MHR.shoulderR][0] + rig.pts[MHR.hipL][0] + rig.pts[MHR.hipR][0]) / 4, (rig.pts[MHR.shoulderL][1] + rig.pts[MHR.shoulderR][1] + rig.pts[MHR.hipL][1] + rig.pts[MHR.hipR][1]) / 4] as Pt : ([0, 0] as Pt);
  const trunkZ = trunk ? (rig.pts[MHR.shoulderL][2] + rig.pts[MHR.shoulderR][2] + rig.pts[MHR.hipL][2] + rig.pts[MHR.hipR][2]) / 4 : 0;
  const tubeStyle: StyleParams = { ...st, degree: Math.min(2, st.degree), uniform: false, slim: 1, distal: 1, bow: 0, caricature: 0 };
  const forms: Form[] = [];
  // Un segmento que va por delante de su vecino se cierra con la curva de su extremo; el de atrás se monta.
  const zOf = new Map<string, number>();
  for (const [pk, p] of profs) {
    const b = boneOf(c, pk);
    zOf.set(pk, b ? (b.a[2] + b.b[2]) / 2 : p.z);
  }
  const extensions = (pk: string): [boolean, boolean] => {
    if (st.uniform) return [false, false];
    const side = pk.slice(-1);
    const near: { start?: string; end?: string } = pk.startsWith('antebrazo') ? { start: `brazo${side}`, end: `mano${side}` } : pk.startsWith('brazo') ? { end: `antebrazo${side}` } : pk.startsWith('mano') ? { start: `antebrazo${side}` } : pk.startsWith('muslo') ? { end: `pierna${side}` } : pk.startsWith('pierna') ? { start: `muslo${side}`, end: `pie${side}` } : pk.startsWith('pie') ? { start: `pierna${side}` } : {};
    if (pk === 'cuello') return [true, true];
    const z = zOf.get(pk) ?? 0;
    const behind = (other: string | undefined, fallbackZ: number | null) => {
      const oz = other && profs.has(other) ? zOf.get(other)! : fallbackZ;
      return oz === null || oz === undefined ? true : !(z > oz + eps);
    };
    const trunkAttached = pk.startsWith('brazo') || pk.startsWith('muslo');
    return [trunkAttached ? behind(undefined, trunk ? trunkZ : null) : behind(near.start, null), near.end ? behind(near.end, null) : false];
  };
  const mk = (map: Map<string, Part>, style: StyleParams, register: boolean) => {
    for (const [pk, p] of profs) {
      if (pk === 'torax' || pk === 'abdomen' || pk === 'pelvis') continue;
      const bone = boneOf(c, pk);
      const mid = bone ? mid3(bone.a, bone.b) : null;
      const away: Pt = mid ? [mid[0] - trunkCenter[0], mid[1] - trunkCenter[1]] : [0, 0];
      const bowSide = away[0] * p.across[0] + away[1] * p.across[1] >= 0 ? 1 : -1;
      const [extendStart, extendEnd] = extensions(pk);
      const shape = scaleShape(partShape(p, bone, style, { H, extendStart, extendEnd, bowSide }), k);
      const poly = shapePolygon(shape);
      const form = formOf(`${register ? '' : 't-'}${pk}`, poly, shape.z);
      map.set(pk, { key: pk, shape, poly, form, bone });
      if (register) forms.push(form);
    }
  };
  const parts = new Map<string, Part>();
  const tubes = new Map<string, Part>();
  mk(parts, st, true);
  mk(tubes, tubeStyle, false);
  // Tórax y pelvis.
  let egg: Part | null = null;
  let bowl: Part | null = null;
  const torax = profs.get('torax');
  const pelvis = profs.get('pelvis');
  const tb = trunk ? boneOf(c, 'torax') : null;
  const mul = (a: V3, x: number): V3 => [a[0] * x, a[1] * x, a[2] * x];
  let bowlRim: Pt[] | null = null;
  const lang = trunkLanguage(model);
  if (torax) {
    const shape = scaleShape(eggShape(torax, tb, st), k);
    let poly = shapePolygon(shape);
    if (trunk) {
      // Elipsoide 3D del tórax en proyección ortográfica, deformado a huevo a lo largo de su eje.
      const ch = trunk.chest;
      const sil = ellipsoidSilhouette(ch.c, [mul(trunk.across, ch.a), mul(trunk.up, ch.b), mul(trunk.front, ch.d)], 56);
      poly = eggDeform(sil, [ch.c[0], ch.c[1]], [trunk.up[0], trunk.up[1]]).map((q): Pt => [q[0] * k, q[1] * k]);
    }
    // Cartoon y concept: la masa del tronco se lleva hacia el triángulo, el cuadrado o el círculo.
    if ((st.style === 'cartoon' || st.style === 'concept') && lang) poly = morphToShape(poly, lang.shape, 0.3 + 0.7 * st.exaggeration);
    const form = formOf('huevo', poly, trunkZ);
    egg = { key: 'huevo', shape, poly, form, bone: tb };
    forms.push(form);
  }
  if (pelvis) {
    const shape = scaleShape(bowlShape(pelvis, tb, st), k);
    let poly = shapePolygon(shape);
    if (trunk) {
      // Mitad de abajo de la silueta de su elipsoide y, cerrándola, el borde de arriba como elipse exacta.
      const hp = trunk.hips;
      const sil = ellipsoidSilhouette(hp.c, [mul(hp.across, hp.a), mul(hp.up, hp.b), mul(hp.front, hp.d)], 72);
      const proj = (q: Pt) => (q[0] - hp.c[0]) * hp.up[0] + (q[1] - hp.c[1]) * hp.up[1];
      const low = sil.map((q) => proj(q) <= 0.05 * hp.b);
      let start = low.findIndex((f, i) => f && !low[(i + sil.length - 1) % sil.length]);
      if (start < 0) start = 0;
      const run: Pt[] = [];
      for (let i = 0; i < sil.length; i++) {
        const j = (start + i) % sil.length;
        if (!low[j]) break;
        run.push(sil[j]);
      }
      const top: V3 = [hp.c[0] + hp.up[0] * hp.b * 0.15, hp.c[1] + hp.up[1] * hp.b * 0.15, 0];
      const rim = Array.from({ length: 48 }, (_, i): Pt => {
        const th = (i / 48) * Math.PI * 2;
        return [top[0] + hp.a * Math.cos(th) * hp.across[0] + hp.d * Math.sin(th) * hp.front[0], top[1] + hp.a * Math.cos(th) * hp.across[1] + hp.d * Math.sin(th) * hp.front[1]];
      });
      bowlRim = rim.map((q): Pt => [q[0] * k, q[1] * k]);
      const a2: Pt = [hp.across[0], hp.across[1]];
      const dot = (q: Pt) => q[0] * a2[0] + q[1] * a2[1];
      const upper = rim.filter((q) => (q[0] - top[0]) * hp.up[0] + (q[1] - top[1]) * hp.up[1] >= 0);
      const endsUp = run.length > 1 && dot(run[run.length - 1]) > dot(run[0]);
      upper.sort((x, y) => (endsUp ? dot(y) - dot(x) : dot(x) - dot(y)));
      if (run.length > 6) poly = [...run, ...upper].map((q): Pt => [q[0] * k, q[1] * k]);
    }
    const form = formOf('cuenco', poly, trunkZ);
    bowl = { key: 'cuenco', shape, poly, form, bone: tb };
    forms.push(form);
  }
  // El frijol que une las dos masas.
  let bean: FigData['bean'] = null;
  const abdomen = profs.get('abdomen');
  if (torax) {
    const stations = beanStations(torax, abdomen ?? null, pelvis ?? null, v.W / v.H);
    if (stations.length >= 5) {
      const pAxis = (abdomen ?? pelvis ?? torax).axis;
      const bend = (Math.atan2(pAxis[0] * torax.axis[1] - pAxis[1] * torax.axis[0], pAxis[0] * torax.axis[0] + pAxis[1] * torax.axis[1]) * 180) / Math.PI;
      const b = beanSides(stations, bend, st.exaggeration);
      const scaled: Bean = {
        ...b,
        left: b.left.map((p): Pt => [p[0] * k, p[1] * k]),
        right: b.right.map((p): Pt => [p[0] * k, p[1] * k]),
        wrinkles: b.wrinkles.map((w) => ({ side: w.side, pts: w.pts.map((p): Pt => [p[0] * k, p[1] * k]) })),
      };
      const poly = [...scaled.left, ...[...scaled.right].reverse()];
      const form = formOf('frijol', poly, trunkZ);
      bean = { bean: scaled, poly, form, stations: stations.length };
      forms.push(form);
    }
  }
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const f of forms) {
    ymin = Math.min(ymin, f.box[1]);
    ymax = Math.max(ymax, f.box[3]);
  }
  const head = model.mannequin?.head;
  if (head?.outline?.length) {
    const xf = headXf(model, v, st);
    const poly = head.outline.map((p): Pt => xf([p[0] * v.W, p[1] * v.H]));
    // La cabeza va un poco más cerca que el cuello: lo tapa donde se montan.
    forms.push(formOf('cabeza', poly, Math.max(trunkZ, rig.pts[MHR.nose]?.[2] ?? trunkZ) + 0.03 * H));
  }
  return { k, rigH: H, eps, parts, tubes, egg, bowl, bean, trunkZ, forms, ymin, ymax, trunk, bowlRim, headCache: new Map(), ctx: c, shape: trunkLanguage(model) };
}

/** Cartoon: la cabeza crece 1.15 + 0.3·e alrededor de la base del cuello. */
function headXf(model: FigureModel, v: View, st: StyleParams): (p: Pt) => Pt {
  const rig = model.mannequin?.rig;
  if (st.style !== 'cartoon' || !rig) return (p) => p;
  const b = rig.pts[MHR.neck] ?? (rig.pts[MHR.shoulderL] && rig.pts[MHR.shoulderR] ? mid3(rig.pts[MHR.shoulderL], rig.pts[MHR.shoulderR]) : null);
  if (!b) return (p) => p;
  const bx = b[0] * v.H;
  const by = b[1] * v.H;
  const K = 1.15 + 0.3 * st.exaggeration;
  return (p) => [bx + (p[0] - bx) * K, by + (p[1] - by) * K];
}

/** Sin perfil de cuello (bustos, ropa alta): un tubo corto de entre los hombros a la base del cráneo. */
function fallbackNeck(model: FigureModel, c: Ctx, v: View): PartProfile | null {
  const head = model.mannequin?.head;
  const { rig } = c;
  if (!head || head.r <= 0 || !rig.pts[MHR.shoulderL] || !rig.pts[MHR.shoulderR]) return null;
  const aspect = v.W / v.H;
  const base: Pt = [(rig.pts[MHR.shoulderL][0] + rig.pts[MHR.shoulderR][0]) / 2, (rig.pts[MHR.shoulderL][1] + rig.pts[MHR.shoulderR][1]) / 2];
  const hc: Pt = [head.c[0] * aspect, head.c[1]];
  const dx = hc[0] - base[0];
  const dy = hc[1] - base[1];
  const l = Math.hypot(dx, dy) || 1;
  // Hasta un poco dentro de la cabeza, para que se monten.
  const reach = Math.max(l * 0.4, l - head.r * 0.55);
  const axis: Pt = [(dx / l) * reach, (dy / l) * reach];
  const half = head.r * 0.4;
  const w = Array.from({ length: 17 }, (_, i) => half * (1.18 - 0.28 * (i / 16)));
  return { key: 'cuello', kind: 'cuello', origin: base, axis, across: [dy / l, -dx / l], left: w, right: w, z: rig.pts[MHR.neck]?.[2] ?? 0, aspect };
}

const ok3 = (...ps: (V3 | undefined)[]) => ps.every((p) => !!p);

/** Estaciones absolutas del tronco, de la axila a la cadera, encadenando tórax, abdomen y pelvis. */
function beanStations(torax: PartProfile, abdomen: PartProfile | null, pelvis: PartProfile | null, aspect: number): { left: Pt; right: Pt }[] {
  type St = { a: Pt; b: Pt; d: number };
  const dirTotal: Pt = (() => {
    const last = pelvis ?? abdomen ?? torax;
    const end: Pt = [last.origin[0] + last.axis[0], last.origin[1] + last.axis[1]];
    const dx = end[0] - torax.origin[0];
    const dy = end[1] - torax.origin[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  })();
  const take = (p: PartProfile, t0: number, t1: number, count: number): St[] => {
    const sm = smoothWidths(p.left, p.right, 3);
    const n = sm.left.length;
    const out: St[] = [];
    for (let i = 0; i < count; i++) {
      const t = t0 + ((t1 - t0) * i) / (count - 1);
      const f = t * (n - 1);
      const a = Math.floor(f);
      const b = Math.min(n - 1, a + 1);
      const wl = sm.left[a] + (sm.left[b] - sm.left[a]) * (f - a);
      const wr = sm.right[a] + (sm.right[b] - sm.right[a]) * (f - a);
      const cx = p.origin[0] + p.axis[0] * t;
      const cy = p.origin[1] + p.axis[1] * t;
      const A: Pt = [cx - p.across[0] * wl, cy - p.across[1] * wl];
      const B: Pt = [cx + p.across[0] * wr, cy + p.across[1] * wr];
      out.push({ a: A, b: B, d: ((A[0] + B[0]) / 2) * dirTotal[0] + ((A[1] + B[1]) / 2) * dirTotal[1] });
    }
    return out;
  };
  const chain: St[] = [];
  const push = (list: St[]) => {
    for (const s of list) if (!chain.length || s.d > chain[chain.length - 1].d + 0.012) chain.push(s);
  };
  push(take(torax, 0.28, 1, abdomen || pelvis ? 7 : 9));
  if (abdomen) push(take(abdomen, 0.08, 1, 5));
  if (pelvis) push(take(pelvis, 0.05, 0.6, 5));
  // Lo que cae fuera del cuadro no se dibuja: el frijol se corta donde termina lo visible.
  for (let i = chain.length - 1; i >= 0; i--) {
    const cy = (chain[i].a[1] + chain[i].b[1]) / 2;
    const cx = (chain[i].a[0] + chain[i].b[0]) / 2;
    if (cy > 1.0 || cy < -0.02 || cx < -0.02 * aspect || cx > 1.02 * aspect) chain.splice(i, 1);
  }
  if (chain.length < 4) return [];
  // Izquierda y derecha de la imagen, no las del personaje.
  const mx = (s: St) => (s.a[0] <= s.b[0] ? s : { ...s, a: s.b, b: s.a });
  const sides = chain.map(mx);
  const L = softChain(sides.map((s) => s.a));
  const R = softChain(sides.map((s) => s.b));
  const n = 11;
  const pick = (pts: Pt[]) => {
    const dense = smoothCurve(pts, 8);
    return Array.from({ length: n }, (_, i): Pt => dense[Math.round((i / (n - 1)) * (dense.length - 1))]);
  };
  const l = pick(L);
  const r = pick(R);
  return l.map((p, i) => ({ left: p, right: r[i] }));
}

function softChain(pts: Pt[]): Pt[] {
  let cur = pts;
  for (let pass = 0; pass < 2; pass++) {
    cur = cur.map((p, i): Pt => (i === 0 || i === cur.length - 1 ? p : [(cur[i - 1][0] + 2 * p[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * p[1] + cur[i + 1][1]) / 4]));
  }
  return cur;
}

/** La figura base del tronco: triángulo, cuadrado o círculo, y lo que comunica. */
export function trunkLanguage(model: FigureModel): { shape: TrunkShape; ratio: number; text: string } | null {
  const rig = model.mannequin?.rig;
  if (!rig) return null;
  const P = rig.pts;
  if (!P[MHR.shoulderL] || !P[MHR.shoulderR] || !P[MHR.hipL] || !P[MHR.hipR]) return null;
  const sw = Math.hypot(P[MHR.shoulderL][0] - P[MHR.shoulderR][0], P[MHR.shoulderL][1] - P[MHR.shoulderR][1]);
  const hw = Math.hypot(P[MHR.hipL][0] - P[MHR.hipR][0], P[MHR.hipL][1] - P[MHR.hipR][1]);
  const torso = Math.hypot((P[MHR.shoulderL][0] + P[MHR.shoulderR][0] - P[MHR.hipL][0] - P[MHR.hipR][0]) / 2, (P[MHR.shoulderL][1] + P[MHR.shoulderR][1] - P[MHR.hipL][1] - P[MHR.hipR][1]) / 2);
  const tall = torso > sw * 0.95 && Math.abs(model.tilt?.shoulders ?? 0) < 14;
  const r = classifyTrunk(sw, hw, tall);
  return { ...r, text: TRUNK_SHAPE_NOTE[r.shape] };
}

/** La luz principal que se lee de la imagen, con la que pueda haber movido el pintor; null si no hay. */
export function principalLight(s: State): LightSource | null {
  try {
    const read = lightOf(s);
    // La luz leída en la mejilla (fromFace) o la que movió el pintor también valen: una lectura
    // "pareja" del cuerpo no quiere decir que no haya luz.
    if (!read || (read.flat && !read.fromFace && !s.lightEdit)) return null;
    const list = shownLights(s, read);
    return list.find((l) => l.role === 'principal') ?? null;
  } catch {
    return null;
  }
}

/* ───────────────────────── trazos con presión ───────────────────────── */

const ROLES: Record<Role, { w0: number; w1: number; peak: number; alpha: number }> = {
  gesto: { w0: 1.2, w1: 3.5, peak: 0.35, alpha: 0.9 },
  ritmo: { w0: 0.9, w1: 2.2, peak: 0.45, alpha: 0.7 },
  construccion: { w0: 0.8, w1: 0.8, peak: 0.5, alpha: 0.4 },
  forma: { w0: 0.7, w1: 1.6, peak: 0.4, alpha: 0.85 },
  contorno: { w0: 1.0, w1: 3.2, peak: 0.45, alpha: 0.95 },
  acento: { w0: 1.8, w1: 1.8, peak: 0.5, alpha: 0.95 },
};

const pathLen = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Remuestrea parejo cada `step` px. */
function even(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    if (!l) continue;
    let d = step - carry;
    for (; d <= l; d += step) out.push([ax + ((bx - ax) * d) / l, ay + ((by - ay) * d) / l]);
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last);
  return out;
}

const taper = (u: number, k = 0.1) => {
  const e = Math.min(u, 1 - u) / k;
  return e >= 1 ? 1 : Math.max(0, e) ** 0.7;
};

const pressure = (u: number, peak: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ** (Math.log(0.5) / Math.log(peak))) ** 0.8;

interface Ink {
  v: View;
  seed: string;
  tremor: number;
  light: LightSource | null;
  ymin: number;
  ymax: number;
  inside?: (x: number, y: number) => boolean;
  style: DrawStyle;
  noAccent?: boolean;
}

/** Un trazo de pocas curvas largas, con peso que sube y baja y puntas que se afinan. */
function ribbon(s: Stroke, pts0: Pt[], ink: Ink, count: number): Prim | null {
  let pts = pts0;
  if (pts.length < 2) return null;
  const role = ROLES[s.role];
  const unit = ink.v.unit;
  if (s.turns && s.closed) {
    // Un óvalo da 1.06 vueltas y cierra con el radio 2 % mayor.
    const n = pts.length;
    const cx = pts.reduce((a, p) => a + p[0], 0) / n;
    const cy = pts.reduce((a, p) => a + p[1], 0) / n;
    const extra = Math.max(2, Math.round(n * 0.02));
    pts = [...pts, ...pts.slice(0, extra).map((p, i): Pt => [cx + (p[0] - cx) * (1 + 0.02 * ((i + 1) / extra)), cy + (p[1] - cy) * (1 + 0.02 * ((i + 1) / extra))])];
  } else if (s.role === 'construccion' && !s.closed && pts.length > 1) {
    // La construcción pasa un poco de cada punta: 2 % del largo y nunca más de 6 px.
    const a = pts[0];
    const b = pts[1];
    const y = pts[pts.length - 1];
    const x = pts[pts.length - 2];
    const L = pathLen(pts);
    const ov = Math.min(L * 0.02, 6);
    const da = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dy = Math.hypot(y[0] - x[0], y[1] - x[1]) || 1;
    pts = [[a[0] - ((b[0] - a[0]) / da) * ov, a[1] - ((b[1] - a[1]) / da) * ov], ...pts, [y[0] + ((y[0] - x[0]) / dy) * ov, y[1] + ((y[1] - x[1]) / dy) * ov]];
  }
  // Lo que ya viene denso no se vuelve a suavizar.
  if (pathLen(pts) / pts.length > 7) pts = smoothCurve(pts, 4);
  pts = even(pts, 3);
  if (pts.length < 3) return null;
  pts = tremor(pts, hashSeed(ink.seed, s.id, String(count)), ink.tremor);
  const n = pts.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const base = role.w0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    let w: number;
    if (s.role === 'contorno') {
      const weight = Math.min(1, Math.max(0, (s.weigh ? s.weigh(pts[i], u) : 0.4) * (0.55 + 0.6 * pressure(u, 0.45))));
      w = (role.w0 + (role.w1 - role.w0) * weight) * taper(u, 0.12);
    } else if (s.role === 'construccion' || s.role === 'acento') {
      w = base * taper(u, s.role === 'acento' ? 0.3 : 0.06);
    } else {
      w = (role.w0 + (role.w1 - role.w0) * pressure(u, role.peak)) * taper(u, 0.1);
    }
    w = Math.max(0.12, w * (s.thin ?? 1)) * unit * 0.5;
    left.push([pts[i][0] - (dy / l) * w, pts[i][1] + (dx / l) * w]);
    right.push([pts[i][0] + (dy / l) * w, pts[i][1] - (dx / l) * w]);
  }
  const fmt = ([x, y]: Pt) => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
  const d = `M${left.map(fmt).join('L')}L${right.reverse().map(fmt).join('L')}Z`;
  const red = s.role === 'gesto';
  return { t: 'path', d, fill: red ? ROJO : INK, alpha: role.alpha * (s.fade ?? 1) };
}

/** Emite los trazos: recorta lo tapado, parte los contornos cerrados y agrega los acentos de las T. */
function render(strokes: Stroke[], forms: Form[], ink: Ink, eps: number): Prim[] {
  const layers: Record<Role, Prim[]> = { construccion: [], gesto: [], ritmo: [], forma: [], contorno: [], acento: [] };
  const accents: Stroke[] = [];
  let count = 0;
  for (const s of strokes) {
    let pieces: Pt[][];
    if (s.closed && !s.turns) {
      const parts = s.split ?? (s.role === 'contorno' ? Math.max(2, Math.min(4, Math.round(pathLen(s.pts) / 220))) : 1);
      pieces = splitClosed(s.pts, parts);
    } else pieces = [s.pts];
    for (const pc of pieces) {
      let outs: Pt[][] = [pc];
      if (s.clip) {
        outs = clipByCloser(pc, s.form ?? null, forms, eps);
        for (const o of outs) {
          // Donde el trazo se corta, la forma de adelante marca la T (solo en tramos que se vean).
          if (pathLen(o) < 14) continue;
          const cutStart = Math.hypot(o[0][0] - pc[0][0], o[0][1] - pc[0][1]) > 1.5;
          const cutEnd = Math.hypot(o[o.length - 1][0] - pc[pc.length - 1][0], o[o.length - 1][1] - pc[pc.length - 1][1]) > 1.5;
          for (const end of [cutStart ? o[0] : null, cutEnd ? o[o.length - 1] : null]) {
            if (!end) continue;
            const acc = tAccent(end, o, s, forms, eps);
            if (acc && !ink.noAccent && accents.length < 12 && (!ink.inside || ink.inside(end[0], end[1]))) accents.push(acc);
          }
        }
      }
      if (s.role !== 'gesto' && !s.noMask) {
        // Nada se va al aire: lo que sale de la figura (dilatada) se corta; las guías, de su región.
        if (ink.inside) outs = outs.flatMap((o) => clipInside(o, ink.inside!, 6, 3, 0.5));
        if (s.bound) outs = outs.flatMap((o) => clipInside(o, s.bound!, 2, 3, 1));
      }
      for (const o of outs) {
        if (o.length < 2) continue;
        const prim = ribbon(s, o, ink, count++);
        if (prim) layers[s.role].push(prim);
      }
    }
  }
  for (const a of accents) {
    const prim = ribbon(a, a.pts, ink, count++);
    if (prim) layers.acento.push(prim);
  }
  for (const s of strokes) if (s.role === 'acento') {
    for (const o of [s.pts]) {
      const prim = ribbon(s, o, ink, count++);
      if (prim) layers.acento.push(prim);
    }
  }
  return [...layers.construccion, ...layers.gesto, ...layers.ritmo, ...layers.forma, ...layers.contorno, ...layers.acento];
}

/** Un trazo corto y oscuro sobre el contorno de la forma de adelante, donde la de atrás termina. */
function tAccent(end: Pt, piece: Pt[], s: Stroke, forms: Form[], eps: number): Stroke | null {
  const i = piece[0] === end ? 0 : piece.length - 1;
  const nb = piece[i === 0 ? Math.min(piece.length - 1, 2) : Math.max(0, piece.length - 3)];
  const dx = end[0] - nb[0];
  const dy = end[1] - nb[1];
  const l = Math.hypot(dx, dy) || 1;
  const probe: Pt = [end[0] + (dx / l) * 3, end[1] + (dy / l) * 3];
  const selfZ = s.form?.z ?? -Infinity;
  for (const g of forms) {
    if (s.form && g.id === s.form.id) continue;
    if (g.z <= selfZ + eps) continue;
    if (!pointInPoly(probe[0], probe[1], g.poly)) continue;
    const dense = resampleEvery([...g.poly, g.poly[0]], 2);
    let best = 0;
    let bestD = Infinity;
    dense.forEach((p, j) => {
      const d = Math.hypot(p[0] - end[0], p[1] - end[1]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    if (bestD > 8) return null;
    const a = Math.max(0, best - 7);
    const b = Math.min(dense.length - 1, best + 7);
    return { id: `t-${s.id}`, role: 'acento', pts: dense.slice(a, b + 1), thin: 0.8 };
  }
  return null;
}

/* ───────────────────────── los pasos ───────────────────────── */

const fr = (v: View) => (p: Pt): Pt => [p[0] * v.W, p[1] * v.H];

/** Peso del contorno: más grueso del lado de la sombra y abajo (apoyo); más fino en la luz. */
function weigher(d: FigData, ink: Ink, closed: Pt[] | null): (p: Pt, u: number) => number {
  // Cartoon: contorno grueso y parejo. Anime: limpio, casi sin variación.
  if (ink.style === 'cartoon') return () => 0.85;
  if (ink.style === 'anime') return () => 0.5;
  const L = ink.light;
  let lx = 0;
  let ly = 0;
  if (L) {
    const m = Math.hypot(L.dir[0], L.dir[1]) || 1;
    lx = L.dir[0] / m;
    ly = L.dir[1] / m;
  }
  let sign = 1;
  if (closed) {
    let area = 0;
    for (let i = 0; i < closed.length; i++) {
      const a = closed[i];
      const b = closed[(i + 1) % closed.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    sign = area >= 0 ? 1 : -1;
  }
  const span = Math.max(1, d.ymax - d.ymin);
  const centroid: Pt = closed ? [closed.reduce((a, p) => a + p[0], 0) / closed.length, closed.reduce((a, p) => a + p[1], 0) / closed.length] : [0, 0];
  return (p) => {
    let w = 0.38 + 0.3 * Math.min(1, Math.max(0, (p[1] - d.ymin) / span));
    if (L && closed) {
      // La normal hacia afuera, desde el centro de la forma.
      const nx = p[0] - centroid[0];
      const ny = p[1] - centroid[1];
      const nl = Math.hypot(nx, ny) || 1;
      const lit = (nx / nl) * lx + (ny / nl) * ly;
      w += (lit < 0 ? 0.5 : -0.18) * Math.min(1, Math.abs(lit) * L.strength + 0.2);
    }
    void sign;
    return w;
  };
}

function figureSeed(model: FigureModel) {
  return model.id;
}

function gestureStrokes(model: FigureModel, v: View, d: FigData | null, st: StyleParams): Stroke[] {
  const f = fr(v);
  const out: Stroke[] = [];
  const action = pushAction(model.action, st.exaggeration).map(f);
  out.push({ id: 'accion', role: 'gesto', pts: action });
  const c = d?.ctx ?? ctxOf(model, v);
  if (!c) return out;
  const { rig } = c;
  const P = (i: number): Pt => [rig.pts[i][0] * v.H, rig.pts[i][1] * v.H];
  const have = (...ids: number[]) => ids.every((i) => rig.pts[i] && c.seen(i));
  const absent = c.absent;
  const centerIds = [MHR.shoulderL, MHR.shoulderR, MHR.hipL, MHR.hipR].filter((i) => rig.pts[i]);
  const cen: Pt = centerIds.length ? [centerIds.reduce((a, i) => a + P(i)[0], 0) / centerIds.length, centerIds.reduce((a, i) => a + P(i)[1], 0) / centerIds.length] : [v.W / 2, v.H / 2];
  const H = rig.H * v.H;
  const limb = (id: string, ids: number[], parts: number[], tip: (last: Pt, prev: Pt) => Pt) => {
    if (!have(ids[0], ids[1], ids[2]) || absent.has(parts[0])) return;
    // Los ritmos terminan en muñeca y tobillo: no corren por el piso.
    void tip;
    const chain = ids.map(P);
    const mid: Pt = [(chain[0][0] + chain[2][0]) / 2, (chain[0][1] + chain[2][1]) / 2];
    out.push({ id, role: 'ritmo', pts: rhythmCurve(chain, [mid[0] - cen[0], mid[1] - cen[1]], st.exaggeration) });
  };
  const extend = (k: number) => (last: Pt, prev: Pt): Pt => {
    const dx = last[0] - prev[0];
    const dy = last[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    return [last[0] + (dx / l) * H * k, last[1] + (dy / l) * H * k];
  };
  limb('brazoL', [MHR.shoulderL, MHR.elbowL, MHR.wristL], [PART.brazoL], extend(0.5));
  limb('brazoR', [MHR.shoulderR, MHR.elbowR, MHR.wristR], [PART.brazoR], extend(0.5));
  limb('piernaL', [MHR.hipL, MHR.kneeL, MHR.ankleL], [PART.musloL], extend(0.55));
  limb('piernaR', [MHR.hipR, MHR.kneeR, MHR.ankleR], [PART.musloR], extend(0.55));
  const line = (id: string, a: number, b: number, parts: number[]) => {
    if (!have(a, b)) return;
    if (parts.some((p) => absent.has(p))) return;
    const A = P(a);
    const B = P(b);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    out.push({ id, role: 'construccion', fade: 1.8, thin: 1.6, pts: [[A[0] - dx * 0.08, A[1] - dy * 0.08], [A[0] + dx * 0.5 + 0.0001, A[1] + dy * 0.5 + 0.0001], [B[0] + dx * 0.08, B[1] + dy * 0.08]] });
  };
  line('hombros', MHR.shoulderL, MHR.shoulderR, []);
  line('caderas', MHR.hipL, MHR.hipR, [PART.pelvis]);
  const head = model.mannequin?.head;
  if (head && head.r > 0) {
    const hc = f(head.c);
    const rr = head.r * v.H;
    let angle = 0;
    if (have(MHR.neck)) {
      const n = P(MHR.neck);
      angle = Math.atan2(-(hc[0] - n[0]), hc[1] - n[1]);
      if (Math.abs(angle) > 1.2) angle = 0;
    }
    out.push({ id: 'cabeza', role: 'ritmo', pts: tiltedOval(hc, rr * 0.82, rr * 1.04, angle), closed: true, turns: true });
  }
  return out;
}

/** Paso 2: el monigote articulado, entintado con los roles. */
function skeletonStrokes(model: FigureModel, v: View, d: FigData | null): Stroke[] {
  const c = d?.ctx ?? ctxOf(model, v);
  const out: Stroke[] = [];
  if (!c) return out;
  const { rig } = c;
  const P = (i: number): Pt => [rig.pts[i][0] * v.H, rig.pts[i][1] * v.H];
  const seen = (i: number) => c.seen(i);
  const hasShoulders = seen(MHR.shoulderL) && seen(MHR.shoulderR);
  const hasHips = seen(MHR.hipL) && seen(MHR.hipR);
  const bone = (id: string, a: number, b: number, part: number) => {
    if (c.absent.has(part) || !seen(a) || !seen(b)) return;
    out.push({ id, role: 'forma', pts: [P(a), P(b)], clip: false });
  };
  if (hasShoulders && hasHips) {
    const sh: Pt = [(P(MHR.shoulderL)[0] + P(MHR.shoulderR)[0]) / 2, (P(MHR.shoulderL)[1] + P(MHR.shoulderR)[1]) / 2];
    const hp: Pt = [(P(MHR.hipL)[0] + P(MHR.hipR)[0]) / 2, (P(MHR.hipL)[1] + P(MHR.hipR)[1]) / 2];
    const sp = rig.spine ? ([rig.spine[0] * v.H, rig.spine[1] * v.H] as Pt) : [(sh[0] + hp[0]) / 2, (sh[1] + hp[1]) / 2] as Pt;
    const m: Pt = [(sh[0] + hp[0]) / 2, (sh[1] + hp[1]) / 2];
    out.push({ id: 'columna', role: 'forma', pts: [sh, [m[0] + (sp[0] - m[0]) * 1.6, m[1] + (sp[1] - m[1]) * 1.6], hp] });
  }
  if (hasShoulders) out.push({ id: 'hombros', role: 'forma', pts: [P(MHR.shoulderL), P(MHR.shoulderR)] });
  if (hasHips) out.push({ id: 'caderas', role: 'forma', pts: [P(MHR.hipL), P(MHR.hipR)] });
  bone('brazoL', MHR.shoulderL, MHR.elbowL, PART.brazoL);
  bone('brazoR', MHR.shoulderR, MHR.elbowR, PART.brazoR);
  bone('antebrazoL', MHR.elbowL, MHR.wristL, PART.antebrazoL);
  bone('antebrazoR', MHR.elbowR, MHR.wristR, PART.antebrazoR);
  bone('musloL', MHR.hipL, MHR.kneeL, PART.musloL);
  bone('musloR', MHR.hipR, MHR.kneeR, PART.musloR);
  bone('piernaL', MHR.kneeL, MHR.ankleL, PART.piernaL);
  bone('piernaR', MHR.kneeR, MHR.ankleR, PART.piernaR);
  const r = rig.H * v.H * 0.075;
  const joints: [number, number, number, number][] = [
    [MHR.shoulderL, MHR.elbowL, MHR.shoulderL, PART.brazoL], [MHR.elbowL, MHR.wristL, MHR.elbowL, PART.brazoL], [MHR.wristL, MHR.elbowL, MHR.wristL, PART.antebrazoL],
    [MHR.shoulderR, MHR.elbowR, MHR.shoulderR, PART.brazoR], [MHR.elbowR, MHR.wristR, MHR.elbowR, PART.brazoR], [MHR.wristR, MHR.elbowR, MHR.wristR, PART.antebrazoR],
    [MHR.hipL, MHR.kneeL, MHR.hipL, PART.musloL], [MHR.kneeL, MHR.ankleL, MHR.kneeL, PART.musloL], [MHR.ankleL, MHR.kneeL, MHR.ankleL, PART.piernaL],
    [MHR.hipR, MHR.kneeR, MHR.hipR, PART.musloR], [MHR.kneeR, MHR.ankleR, MHR.kneeR, PART.musloR], [MHR.ankleR, MHR.kneeR, MHR.ankleR, PART.piernaR],
  ];
  for (const [j, toward, , part] of joints) {
    if (!seen(j) || !seen(toward) || c.absent.has(part)) continue;
    const at = P(j);
    const o = P(toward);
    const dx = o[0] - at[0];
    const dy = o[1] - at[1];
    const l = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dx, -dy);
    void l;
    out.push({ id: `j${j}`, role: 'construccion', pts: tiltedOval(at, r * 0.62, r, ang), closed: true, turns: true });
  }
  const head = model.mannequin?.head;
  if (head?.ball?.length) out.push({ id: 'bola', role: 'forma', pts: head.ball.map(fr(v)), closed: true, split: 1 });
  return out;
}

/** Los contornos de una forma: cerrado si las dos puntas son libres; abierto donde la parte se monta en la vecina. */
function outlinesOf(sh: OrganicShape): { pts: Pt[]; closed: boolean }[] {
  const { left, right, capStart, capEnd } = sh;
  const rev = (a: Pt[]) => [...a].reverse();
  if (capStart && capEnd) return [{ pts: [...left, ...capEnd, ...rev(right), ...capStart], closed: true }];
  if (capEnd) return [{ pts: [...left, ...capEnd, ...rev(right)], closed: false }];
  if (capStart) return [{ pts: [...rev(right), ...capStart, ...left], closed: false }];
  return [{ pts: left, closed: false }, { pts: right, closed: false }];
}

/** El contorno de la forma de una parte, con peso. */
function shapeContour(p: Part, role: Role, ink: Ink, d: FigData, fade = 1): Stroke[] {
  return outlinesOf(p.shape).map((o, i) => ({ id: `c-${p.key}-${i}`, role, pts: o.pts, closed: o.closed, form: p.form, clip: true, fade, thin: ink.style === 'anime' ? 0.85 : 1, weigh: role === 'contorno' ? weigher(d, ink, p.poly) : undefined }));
}

function headStrokes(model: FigureModel, v: View, st: StyleParams, level: number, d: FigData | null): Stroke[] {
  const cached = d?.headCache.get(String(level));
  if (cached) return cached;
  const made = headStrokesRaw(model, v, st, level, d);
  d?.headCache.set(String(level), made);
  return made;
}

function headStrokesRaw(model: FigureModel, v: View, st: StyleParams, level: number, d: FigData | null): Stroke[] {
  const head = model.mannequin?.head;
  if (!head?.ball?.length) return [];
  const f0 = fr(v);
  const xf = headXf(model, v, st);
  const f = (p: Pt): Pt => xf(f0(p));
  const out: Stroke[] = [];
  const form = d?.forms.find((q) => q.id === 'cabeza') ?? null;
  const ball = head.ball.map(f);
  const outline = (head.outline?.length ? head.outline : head.ball).map(f);
  // Las guías se recortan una vez contra el contorno de la cabeza (la bola con su quijada) y se memorizan.
  const bounded = (list: Stroke[]): Stroke[] => {
    const exempt = (q: Stroke) => q.id === 'cabeza-contorno' || q.id.startsWith('cabeza-bola');
    const inside = (x: number, y: number) => pointInPoly(x, y, outline);
    const out: Stroke[] = [];
    for (const q of list) {
      if (exempt(q)) {
        out.push({ ...q, noMask: true });
        continue;
      }
      const r = clipInside(q.pts, inside, 3, 3, 1);
      if (r.length === 1 && r[0] === q.pts) out.push(q);
      else r.forEach((pc, i) => out.push({ ...q, id: `${q.id}~${i}`, pts: pc, closed: false }));
    }
    return out;
  };
  if (level === 3) {
    out.push({ id: 'cabeza-bola', role: 'forma', pts: st.style === 'cartoon' ? outline : ball, closed: true, form, clip: true, split: 2 });
    if (st.style !== 'cartoon') {
      out.push({ id: 'cabeza-quijada', role: 'forma', pts: outline, closed: true, form, clip: true, split: 2 });
      for (const [i, a] of head.axes.entries()) if (a.length > 1) out.push({ id: `cabeza-eje-${i}`, role: 'construccion', pts: a.map(f) });
      for (const [i, a] of head.brow.entries()) if (a.length > 1) out.push({ id: `cabeza-ceja-${i}`, role: 'construccion', pts: a.map(f) });
    }
    return bounded(out);
  }
  // Paso 4: contorno firme y sus guías según el estilo.
  out.push({ id: 'cabeza-contorno', role: 'contorno', pts: outline, closed: true, form, clip: true, weigh: () => 0.5 });
  if (st.style === 'cartoon') return bounded(out);
  out.push({ id: 'cabeza-bola', role: 'construccion', pts: ball, closed: true, turns: true });
  if (st.style === 'anime') {
    const anime = head.methods.find((m) => m.id === 'anime');
    anime?.stages.forEach((s, si) => {
      s.lines.forEach((l, i) => l.length > 1 && out.push({ id: `an-${si}-${i}`, role: 'forma', pts: l.map(f) }));
      s.loops.forEach((l, i) => l.length > 2 && out.push({ id: `anl-${si}-${i}`, role: 'forma', pts: l.map(f), closed: true, split: 1 }));
      s.accent.forEach((l, i) => l.length > 1 && out.push({ id: `ana-${si}-${i}`, role: 'acento', pts: l.map(f), thin: 0.7 }));
    });
    return bounded(out);
  }
  for (const [i, a] of head.axes.entries()) if (a.length > 1) out.push({ id: `cabeza-eje-${i}`, role: 'construccion', pts: a.map(f) });
  for (const [i, a] of head.brow.entries()) if (a.length > 1) out.push({ id: `cabeza-ceja-${i}`, role: 'forma', pts: a.map(f) });
  for (const [i, a] of head.guides.entries()) if (a.length > 1) out.push({ id: `cabeza-guia-${i}`, role: 'forma', pts: a.map(f) });
  for (const [i, a] of head.side.entries()) if (a.length > 1) out.push({ id: `cabeza-lado-${i}`, role: 'construccion', pts: a.map(f) });
  for (const [i, a] of head.jaw.entries()) if (a.length > 1) out.push({ id: `cabeza-mand-${i}`, role: 'forma', pts: a.map(f) });
  for (const [i, a] of head.features.entries()) if (a.length > 1) out.push({ id: `cabeza-rasgo-${i}`, role: 'forma', pts: a.map(f), thin: 0.9 });
  for (const [i, a] of head.loops.entries()) if (a.length > 2) out.push({ id: `cabeza-ojo-${i}`, role: 'forma', pts: a.map(f), closed: true, split: 1, thin: 0.9 });
  return bounded(out);
}

/** Manos: palma, nudillos y dedos si se ven; si no, la forma de la mano. */
function handStrokes(model: FigureModel, v: View, d: FigData, st: StyleParams, ink: Ink, skip: Set<string> = new Set()): Stroke[] {
  const out: Stroke[] = [];
  const f = fr(v);
  const pieces = model.mannequin?.pieces ?? [];
  for (const side of ['L', 'R']) {
    const key = `mano${side}`;
    if (skip.has(side)) continue;
    const shape = d.parts.get(key);
    const mine = pieces.filter((p) => p.id.startsWith(`mano${side}-`));
    const palm = mine.find((p) => p.id.endsWith('-palma'));
    const fingers = mine.filter((p) => /-d\d-\d$/.test(p.id));
    if (palm && fingers.length) {
      const z = shape?.form.z ?? d.trunkZ;
      const poly = palm.outline.map(f);
      const form = formOf(`${key}-palma`, poly, z);
      out.push({ id: `${key}-palma`, role: 'contorno', pts: poly, closed: true, form, clip: true, split: 2, weigh: weigher(d, ink, poly) });
      const knuckles = palm.axes[0]?.map(f);
      if (knuckles && knuckles.length > 2) out.push({ id: `${key}-nudillos`, role: 'forma', pts: knuckles });
      fingers.forEach((fp) => out.push({ id: fp.id, role: 'forma', pts: fp.outline.map(f), closed: true, form, clip: false, split: 1, thin: 0.85 }));
    } else if (shape) {
      out.push(...shapeContour(shape, 'contorno', ink, d));
    } else if (mine.length) {
      const poly = mine[0].outline.map(f);
      out.push({ id: `${key}-bloque`, role: 'contorno', pts: poly, closed: true, split: 2, weigh: weigher(d, ink, poly) });
    }
  }
  void st;
  return out;
}


/* ───────────────────────── la mano orgánica ───────────────────────── */

interface HandData {
  id: string;
  /** Los 21 puntos en píxeles de la vista: muñeca, pulgar 1-4, índice 5-8 … meñique 17-20. */
  P: Pt[];
  estimated: boolean;
  side: string;
}

const isLooseHand = (model: FigureModel) => model.framing === 'mano' && !!model.mannequin && model.joints.length >= 21 && !model.mannequin.rig;
export const hasOrganicHand = (model: FigureModel) => isLooseHand(model) || !!model.mannequin?.rig;

/** Las manos con sus 21 puntos reales: la suelta, de sus puntos; las del cuerpo, de las cadenas del esqueleto. */
function handsOf(model: FigureModel, v: View): HandData[] {
  if (isLooseHand(model)) return [{ id: 'mano', P: model.joints.slice(0, 21).map(fr(v)), estimated: false, side: '' }];
  const rig = model.mannequin?.rig;
  if (!rig) return [];
  const out: HandData[] = [];
  const f = fr(v);
  for (const side of ['L', 'R'] as const) {
    const guide = model.mannequin!.hands.find((h) => h.id === `mano${side}`);
    if (!guide || !guide.fingers) continue;
    // Los 21 puntos salen de los huesos de las piezas de la mano (los mismos que arman sus dedos).
    const pieces = model.mannequin!.pieces.filter((p) => p.id.startsWith(`mano${side}-`));
    const palm = pieces.find((p) => p.id.endsWith('-palma'));
    if (!palm?.stick) continue;
    const P: (Pt | null)[] = new Array(21).fill(null);
    P[0] = f(palm.stick[0]);
    for (const p of pieces) {
      const m = /-d(\d)-(\d)$/.exec(p.id);
      if (!m || !p.stick) continue;
      const fi = Number(m[1]);
      const k = Number(m[2]);
      P[1 + 4 * fi + k] = f(p.stick[0]);
      if (k === 2) P[1 + 4 * fi + 3] = f(p.stick[1]);
    }
    if (P.some((q) => !q)) continue;
    out.push({ id: `mano${side}`, P: P as Pt[], estimated: guide.estimated, side });
  }
  return out;
}

/**
 * La mano en cuatro pasos: 1 gesto (de la palma al dedo medio y el abanico de dedos), 2 proporciones
 * (palma y largo de dedos), 3 masas (palma, mitón y cuña del pulgar), 4 volúmenes (dedos separados con
 * su solape en cada nudillo, pliegues y arco de nudillos). Un dedo estimado solo lleva su gesto en construcción.
 */
function handStrokes2(h: HandData, level: number, st: StyleParams, ink: Ink): { strokes: Stroke[]; forms: Form[] } {
  const P = h.P;
  const g = handGeometry(P);
  const out: Stroke[] = [];
  const forms: Form[] = [];
  const id = (s: string) => `${h.id}-${s}`;
  const cartoon = st.style === 'cartoon';
  const all = [...P];
  const fake = { ymin: Math.min(...all.map((p) => p[1])), ymax: Math.max(...all.map((p) => p[1])) } as FigData;
  const W = P[0];
  const fingerIds = [0, 1, 2, 3, 4];
  const chainOf = (f: number): Pt[] => [P[1 + 4 * f], P[2 + 4 * f], P[3 + 4 * f], P[4 + 4 * f]];
  if (level === 1) {
    out.push({ id: id('accion'), role: 'gesto', pts: [W, P[9], P[10], P[11], P[12]] });
    for (const f of fingerIds) out.push({ id: id(`ritmo${f}`), role: 'ritmo', pts: f === 0 ? [W, ...chainOf(f)] : chainOf(f) });
    return { strokes: out, forms };
  }
  if (level === 2) {
    const q = [g.planes[0][0], g.planes[0][1], g.planes[1][2], g.planes[1][3]];
    out.push({ id: id('palma'), role: 'forma', pts: q, closed: true, split: 1 });
    out.push({ id: id('largo'), role: 'construccion', pts: [W, P[12]] });
    for (const f of fingerIds) {
      out.push({ id: id(`hueso${f}`), role: 'forma', pts: f === 0 ? [W, ...chainOf(f)] : [P[1 + 4 * f], ...chainOf(f).slice(1)] });
      if (f > 0) out.push({ id: id(`base${f}`), role: 'construccion', pts: [W, P[1 + 4 * f]] });
      for (let k = 1; k < 4; k++) out.push({ id: id(`j${f}${k}`), role: 'construccion', pts: tiltedOval(chainOf(f)[k], g.base * 0.55, g.base * 0.4, Math.atan2(chainOf(f)[k][0] - chainOf(f)[k - 1][0], -(chainOf(f)[k][1] - chainOf(f)[k - 1][1]))), closed: true, turns: true });
    }
    return { strokes: out, forms };
  }
  const under = level === 4;
  const palmForm = formOf(id('palma'), g.palm, 0);
  const thumbForm = formOf(id('pulgar'), g.thumb.tube, 0.05);
  forms.push(palmForm, thumbForm);
  const fingerForms = g.fingers.map((f, i) => {
    const form = formOf(id(f.id), f.tube, 0.1);
    forms.push(form);
    return { f, form, i };
  });
  const role3: Role = under ? 'construccion' : 'forma';
  if (level === 3) {
    out.push({ id: id('palma'), role: 'forma', pts: g.palm, closed: true, form: palmForm, clip: true, split: 2, thin: 1.25 });
    out.push({ id: id('miton'), role: 'forma', pts: g.mitten, closed: true, form: fingerForms[0].form, clip: false, split: 2, thin: 1.25 });
    out.push({ id: id('pulgar'), role: 'forma', pts: g.thumb.tube, closed: true, form: thumbForm, clip: true, split: 2, thin: 1.25 });
    out.push({ id: id('arista'), role: 'construccion', pts: g.ridge, fade: 1.6, thin: 1.4 });
    out.push({ id: id('nudillos'), role: 'construccion', pts: g.knuckleArc, fade: 1.6, thin: 1.4 });
    for (const f of fingerIds) if (h.estimated) out.push({ id: id(`gesto${f}`), role: 'construccion', pts: chainOf(f), fade: 1.4 });
    return { strokes: out, forms };
  }
  // Paso 4. Las masas del 3 quedan debajo.
  out.push({ id: id('miton'), role: role3, pts: g.mitten, closed: true, turns: true, fade: 0.8 });
  out.push({ id: id('palma-masa'), role: role3, pts: g.palm, closed: true, turns: true, fade: 0.8 });
  const wt = weigher(fake, ink, g.palm);
  out.push({ id: id('palma'), role: 'contorno', pts: g.palm, closed: true, form: palmForm, clip: true, split: 2, weigh: wt });
  out.push({ id: id('arista'), role: 'forma', pts: g.ridge, form: palmForm, thin: 0.9 });
  out.push({ id: id('nudillos'), role: 'forma', pts: g.knuckleArc, form: palmForm, thin: 1.1 });
  out.push({ id: id('pulgar'), role: 'contorno', pts: g.thumb.open, closed: true, form: thumbForm, clip: true, split: 1, weigh: weigher(fake, ink, g.thumb.tube) });
  if (!cartoon) g.thumb.rings.forEach((r, i) => out.push({ id: id(`pulgar-pliegue${i}`), role: 'forma', pts: r, form: thumbForm, clip: true, thin: 0.8 }));
  for (const { f, form, i } of fingerForms) {
    if (h.estimated) {
      out.push({ id: id(`gesto${i + 1}`), role: 'construccion', pts: f.axis, fade: 1.4 });
      continue;
    }
    out.push({ id: id(f.id), role: 'contorno', pts: f.open, closed: false, form, clip: true, thin: 0.9, weigh: weigher(fake, ink, f.tube) });
    if (!cartoon) f.rings.forEach((r, k) => out.push({ id: id(`${f.id}-pliegue${k}`), role: 'forma', pts: r, form, clip: true, thin: 0.75 }));
  }
  return { strokes: out, forms };
}

function handPrimsFor(hands: HandData[], level: number, st: StyleParams, ink: Ink): Prim[] {
  const out: Prim[] = [];
  for (const h of hands) {
    const { strokes, forms } = handStrokes2(h, level, st, ink);
    out.push(...render(strokes, forms, { ...ink, noAccent: true }, 0.02));
  }
  return out;
}

/** Manos y pies sueltos de la figura que se construye: se arman de sus 21 puntos. */
function looseHandPrims(model: FigureModel, level: 1 | 2 | 3 | 4, v: View, st: StyleParams, opts: OrganicOpts): Prim[] {
  const ink: Ink = { v, seed: model.id, tremor: 0.0012 * v.H, light: opts.light, ymin: 0, ymax: v.H, style: st.style, inside: opts.mask ? insideOf(opts.mask, v) : undefined };
  return handPrimsFor(handsOf(model, v), level, st, ink);
}

function trunkStrokes(d: FigData, st: StyleParams, level: 3 | 4, ink: Ink): Stroke[] {
  const out: Stroke[] = [];
  const { egg, bowl, bean, trunk } = d;
  const under = level === 4;
  const role: Role = under ? 'construccion' : 'forma';
  const firm = under ? 1 : 1.25;
  // Las masas: firmes en el paso 3; en el 4 bajan a construcción.
  if (egg && under && st.style === 'cartoon') {
    // Cartoon: la figura base del tronco es el contorno del tronco, firme y parejo.
    out.push({ id: 'huevo', role: 'contorno', pts: egg.poly, closed: true, form: egg.form, clip: true, split: 2, weigh: weigher(d, ink, egg.poly) });
  } else if (egg) out.push({ id: 'huevo', role, pts: egg.poly, closed: true, form: egg.form, clip: !under, turns: under, split: 2, fade: under ? 0.8 : 1, thin: firm });
  if (bowl) {
    out.push({ id: 'cuenco', role, pts: bowl.poly, closed: true, form: bowl.form, clip: !under, turns: under, split: 2, fade: under ? 0.8 : 1, thin: firm });
    if (d.bowlRim && st.style !== 'cartoon') out.push({ id: 'cuenco-borde', role, pts: d.bowlRim, closed: true, turns: true, form: bowl.form, fade: under ? 0.8 : 1, thin: firm });
  }
  if (bean) {
    const b = bean.bean;
    // Una pasada por lado, de la axila a la cadera.
    const lateral: Role = level === 3 ? 'forma' : 'contorno';
    out.push({ id: 'frijol-L', role: lateral, pts: b.left, form: bean.form, clip: true, thin: level === 3 ? 1.25 : 1, weigh: weigher(d, ink, bean.poly) });
    out.push({ id: 'frijol-R', role: lateral, pts: b.right, form: bean.form, clip: true, thin: level === 3 ? 1.25 : 1, weigh: weigher(d, ink, bean.poly) });
    if (level === 4) b.wrinkles.forEach((w, i) => out.push({ id: `arruga-${i}`, role: 'acento', pts: w.pts, thin: 0.8 }));
  }
  if (trunk && st.style !== 'cartoon') {
    // La línea central dice si el tronco gira: con torsión sale en S.
    const t = trunk;
    const front = (p: V3, f: V3, k: number): Pt => [(p[0] + f[0] * k) * d.k, (p[1] + f[1] * k) * d.k];
    const chestTop: V3 = [t.chest.c[0] + t.up[0] * t.chest.b, t.chest.c[1] + t.up[1] * t.chest.b, t.chest.c[2] + t.up[2] * t.chest.b];
    const hipsLow: V3 = [t.hips.c[0] - t.hips.up[0] * t.hips.b, t.hips.c[1] - t.hips.up[1] * t.hips.b, t.hips.c[2] - t.hips.up[2] * t.hips.b];
    const waist: V3 = [(t.chest.c[0] - t.up[0] * t.chest.b + t.hips.c[0] + t.hips.up[0] * t.hips.b) / 2, (t.chest.c[1] - t.up[1] * t.chest.b + t.hips.c[1] + t.hips.up[1] * t.hips.b) / 2, (t.chest.c[2] + t.hips.c[2]) / 2];
    const wf: V3 = [(t.front[0] + t.hips.front[0]) / 2, (t.front[1] + t.hips.front[1]) / 2, (t.front[2] + t.hips.front[2]) / 2];
    const mid = smoothCurve([front(chestTop, t.front, t.chest.d * 0.92), front(t.chest.c, t.front, t.chest.d), front(waist, wf, (t.chest.d + t.hips.d) * 0.45), front(t.hips.c, t.hips.front, t.hips.d), front(hipsLow, t.hips.front, t.hips.d * 0.7)], 8);
    out.push({ id: 'centro', role: 'forma', pts: mid, clip: false, thin: 0.9 });
    if (level === 4) {
      // Contornos transversales con el marco 3D del tronco (cabeceo de ±10°): siempre se curvan.
      const rings = st.cross <= 0 ? 0 : st.cross >= 2 ? 3 : 2;
      const ring = (pts: Pt[], id: string, form: Form | null) => {
        if (pts.length > 3) out.push({ id, role: 'forma', pts: pts.map((q): Pt => [q[0] * d.k, q[1] * d.k]), form, clip: true, thin: 0.85 });
      };
      const ch = t.chest;
      const hp = t.hips;
      if (rings >= 1) ring(ellipsoidRing(ch.c, t.across, t.up, t.front, ch.a, ch.b, ch.d, -0.8), 'anillo-torax', egg?.form ?? null);
      if (rings >= 2 && bean) {
        const w = bean.bean.waist.index;
        const L = bean.bean.left[w];
        const R = bean.bean.right[w];
        const half = Math.hypot(R[0] - L[0], R[1] - L[1]) / 2 / d.k;
        const norm = (v: V3): V3 => {
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          return [v[0] / l, v[1] / l, v[2] / l];
        };
        const ac = norm([(t.across[0] + hp.across[0]) / 2, (t.across[1] + hp.across[1]) / 2, (t.across[2] + hp.across[2]) / 2]);
        ring(ellipsoidRing(waist, ac, norm([(t.up[0] + hp.up[0]) / 2, (t.up[1] + hp.up[1]) / 2, (t.up[2] + hp.up[2]) / 2]), norm(wf), half, ch.b * 0.5, half * 0.7, 0), 'anillo-cintura', bean.form);
      }
      if (rings >= 3) ring(ellipsoidRing(hp.c, hp.across, hp.up, hp.front, hp.a, hp.b, hp.d, 0.15), 'anillo-cresta', bowl?.form ?? null);
    }
  }
  return out;
}

/** Intervalos de x donde la horizontal y cae dentro del polígono. */
function spans(poly: Pt[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Relleno por renglones de 2 px: la sombra se queda sin lo que tapan las formas de adelante. */
function scanFill(poly: Pt[], closers: Form[], step = 2): string {
  const [, y0, , y1] = boxOf(poly);
  let d = '';
  for (let y = Math.ceil(y0 / step) * step + step / 2; y < y1; y += step) {
    let parts = spans(poly, y);
    for (const g of closers) {
      if (y < g.box[1] || y > g.box[3]) continue;
      const cut = spans(g.poly, y);
      if (!cut.length) continue;
      parts = parts.flatMap(([a, b]) => {
        let pieces: [number, number][] = [[a, b]];
        for (const [c0, c1] of cut) pieces = pieces.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1] as [number, number]] : [...(c0 > p0 ? [[p0, c0] as [number, number]] : []), ...(c1 < p1 ? [[c1, p1] as [number, number]] : [])]));
        return pieces;
      });
    }
    for (const [a, b] of parts) if (b - a > 1) d += `M${a.toFixed(1)} ${(y - step / 2).toFixed(1)}H${b.toFixed(1)}V${(y + step / 2).toFixed(1)}H${a.toFixed(1)}Z`;
  }
  return d;
}

/** Terminadores y sombra fría del estilo pintura, recortados contra las formas de adelante. */
function paintStrokes(d: FigData, light: LightSource, out: Prim[]) {
  const L: V3 = [light.dir[0], light.dir[1], light.dir[2]];
  const m = Math.hypot(L[0], L[1], L[2]) || 1;
  const dir: V3 = [L[0] / m, L[1] / m, L[2] / m];
  for (const p of d.parts.values()) {
    const t = shapeTerminator(unscale(p.shape, d.k), dir);
    if (!t) continue;
    const line = t.line.map((q): Pt => [q[0] * d.k, q[1] * d.k]);
    const shadow = t.shadow.map((q): Pt => [q[0] * d.k, q[1] * d.k]);
    const closers = d.forms.filter((g) => g.id !== p.form.id && g.z > p.form.z + d.eps && boxesTouchB(boxOf(shadow), g.box));
    const fill = scanFill(shadow, closers);
    if (fill) out.push({ t: 'path', d: fill, fill: COLD, fillAlpha: 0.24, alpha: 0.24 });
    for (const piece of clipByCloser(smoothCurve(line, 4), p.form, d.forms, d.eps)) {
      out.push({ t: 'path', d: `M${piece.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`, stroke: INK, w: 0.9, alpha: 0.7, dash: [3, 3] });
    }
  }
}

const boxesTouchB = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

const unscale = (s: OrganicShape, k: number): OrganicShape => scaleShape(s, 1 / k);

/* ───────────────────────── entrada ───────────────────────── */

const dilated = new WeakMap<Uint8Array, Uint8Array>();
/** La máscara de la figura dilatada 6 % del alto: lo que cae fuera de ella no se dibuja. */
function insideOf(mask: { data: Uint8Array; w: number; h: number }, v: View): (x: number, y: number) => boolean {
  let big = dilated.get(mask.data);
  if (!big) {
    big = dilateMask(mask.data, mask.w, mask.h, 0.06 * mask.h);
    dilated.set(mask.data, big);
  }
  const data = big;
  return (x, y) => {
    const mx = Math.floor((x / v.W) * mask.w);
    const my = Math.floor((y / v.H) * mask.h);
    return mx >= 0 && my >= 0 && mx < mask.w && my < mask.h && !!data[my * mask.w + mx];
  };
}

const prims = new WeakMap<FigureModel, Map<string, Prim[]>>();

/**
 * Los pasos 1 a 4 del método orgánico. Devuelve null si la figura no tiene malla (animales, objetos,
 * manos sueltas): ahí se usa lo de siempre.
 */
export function organicPrims(model: FigureModel, level: 1 | 2 | 3 | 4, v: View, opts: OrganicOpts): Prim[] | null {
  const loose = isLooseHand(model);
  if (!loose && (!model.mannequin?.rig || !model.surface?.profiles?.length)) return null;
  const st = styleParams(opts.style, opts.exaggeration, opts.simplification);
  const lk = opts.light ? `${opts.light.azimuth.toFixed(0)}:${opts.light.elevation.toFixed(0)}` : '-';
  const only0 = ((globalThis as { __organicOnly?: string[] }).__organicOnly ?? []).join(',');
  const key = `${only0}|${opts.mask ? 1 : 0}|${level}|${st.style}|${st.exaggeration.toFixed(2)}|${st.simplification.toFixed(2)}|${opts.theme}|${v.W}x${v.H}|${v.unit.toFixed(3)}|${lk}`;
  let held = prims.get(model);
  if (!held) prims.set(model, (held = new Map()));
  const known = held.get(key);
  if (known) return known;
  const t0 = performance.now();
  if (loose) {
    const o = looseHandPrims(model, level, v, st, opts);
    held.set(key, o);
    return o;
  }
  const d = figureData(model, v, st);
  const tData = performance.now();
  if (!d && level >= 3) return null;
  const ink: Ink = { v, seed: figureSeed(model), tremor: 0.0012 * v.H, light: opts.light, ymin: d?.ymin ?? 0, ymax: d?.ymax ?? v.H, style: st.style, inside: opts.mask ? insideOf(opts.mask, v) : undefined };
  const strokes: Stroke[] = [];
  const faint = (list: Stroke[], k: number) => list.map((s): Stroke => ({ ...s, fade: (s.fade ?? 1) * k, thin: (s.thin ?? 1) * (k < 1 ? 0.6 : 1) }));
  const gesture = gestureStrokes(model, v, d, st);
  if (level === 1) strokes.push(...gesture);
  else strokes.push(...faint(gesture.filter((s) => s.id === 'accion'), 0.3 / 0.9));
  if (level === 2) strokes.push(...skeletonStrokes(model, v, d));
  const forms = d?.forms ?? [];
  if (level === 3 && d) {
    strokes.push(...headStrokes(model, v, st, 3, d));
    strokes.push(...trunkStrokes(d, st, 3, ink));
    const bodyHands = handsOf(model, v);
    const handSides = new Set(bodyHands.map((q) => q.side));
    for (const [k, p] of d.tubes) {
      if (k.startsWith('mano') && handSides.has(k.slice(-1))) continue;
      for (const [i, o] of outlinesOf(p.shape).entries()) {
        const neck = k === 'cuello';
        strokes.push({ id: `tubo-${k}-${i}`, role: neck ? 'forma' : 'construccion', pts: o.pts, closed: o.closed, form: p.form, clip: neck, split: 1, thin: neck ? 1 : 1.6, fade: neck ? 0.85 : 1.8 });
      }
    }
  }
  if (level === 4 && d) {
    strokes.push(...trunkStrokes(d, st, 4, ink));
    // El cuello primero: la cabeza lo cubre donde se montan.
    for (const [k, p] of d.parts) {
      if (k.startsWith('mano')) continue;
      strokes.push(...shapeContour(p, 'contorno', ink, d));
      if (st.cross > 0) {
        for (const [i, r] of crossContours(unscale(p.shape, d.k), st.cross).entries()) {
          const pts = r.pts.map((q): Pt => [q[0] * d.k, q[1] * d.k]);
          if (pts.length > 2) strokes.push({ id: `cross-${k}-${i}`, role: 'forma', pts, closed: r.closed, form: p.form, clip: true, turns: false, split: 1, thin: 0.9 });
        }
      }
    }
    const bodyHands = handsOf(model, v);
    strokes.push(...handStrokes(model, v, d, st, ink, new Set(bodyHands.map((q) => q.side))));
    strokes.push(...headStrokes(model, v, st, 4, d));
  }
  const tStrokes = performance.now();
  const only = (globalThis as { __organicOnly?: string[] }).__organicOnly;
  const shown = only?.length ? strokes.filter((q) => only.some((o) => q.id.startsWith(o))) : strokes;
  const out = render(shown, forms, ink, d?.eps ?? 0);
  if ((level === 3 || level === 4) && d) out.push(...handPrimsFor(handsOf(model, v), level, st, ink));
  if (level === 4 && d && opts.style === 'pintura' && opts.light) {
    const extra: Prim[] = [];
    paintStrokes(d, opts.light, extra);
    out.unshift(...extra);
  }
  const dt = performance.now() - t0;
  const ms = (globalThis as { __organicMs?: Record<string, number> });
  ms.__organicMs = { ...ms.__organicMs, [`${model.id}:${level}`]: Math.round(dt * 10) / 10, [`${model.id}:${level}:datos`]: Math.round((tData - t0) * 10) / 10, [`${model.id}:${level}:trazos`]: Math.round((tStrokes - tData) * 10) / 10, [`${model.id}:${level}:cinta`]: Math.round((performance.now() - tStrokes) * 10) / 10 };
  held.set(key, out);
  return out;
}
