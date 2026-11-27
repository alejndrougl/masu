import type { FaceMarks } from './face';
import type { FeatureStage } from './features';
import type { Pt } from './types';
import type { V3 } from './volumes';

import { t as tx } from '../i18n';
/** Una forma de construir la cabeza: cada método es una lista de pasos. */
export interface HeadMethod {
  id: string;
  name: string;
  /** Para qué sirve, en una línea. */
  about: string;
  stages: FeatureStage[];
}

export interface HeadContext {
  /** Del modelo del rostro al encuadre, ya corregido hacia los rasgos reales. */
  at: (p: V3) => Pt;
  /** Si esa cara de la cabeza mira a quien observa. */
  facing: (n: V3) => boolean;
  ball: Pt[];
  c: Pt;
  aspect: number;
  skull: { c: V3; r: number };
  sideX: number;
  sideR: number;
  marks: FaceMarks | null;
  /** Rasgos reales ya listos para dibujar. */
  features: Pt[][];
  loops: Pt[][];
  jaw: Pt[][];
  facets: { poly: Pt[]; tone: number }[];
  /** Lentes de una máscara, si la cara está cubierta. */
  covered: boolean;
}

const stage = (name: string, text: string, part: Partial<FeatureStage> = {}): FeatureStage => ({ name, text, lines: [], loops: [], accent: [], dots: [], shade: [], light: [], ...part });

const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Corta una lista en los tramos visibles. */
function runs(items: V3[], show: (p: V3) => boolean, at: (p: V3) => Pt): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of items) {
    if (show(p)) cur.push(at(p));
    else if (cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Línea que da la vuelta a la cabeza a una altura: es la que se curva al girarla. */
function around(ctx: HeadContext, y: number, half = 1): Pt[][] {
  const { c, r } = ctx.skull;
  const rr = Math.sqrt(Math.max(0, r * r - (y - c[1]) ** 2));
  const list: V3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = -Math.PI * half + (i / 48) * Math.PI * 2 * half;
    list.push([rr * Math.sin(t), y, c[2] + rr * Math.cos(t)]);
  }
  return runs(list, (p) => ctx.facing([p[0] - c[0], p[1] - c[1], p[2] - c[2]]), ctx.at);
}

/** Línea sobre el plano de la cara, recorriendo de un lado a otro. */
function across(ctx: HeadContext, y: number, half: number): Pt[][] {
  const list: V3[] = [];
  for (let i = 0; i <= 20; i++) {
    const x = -half + (i / 20) * half * 2;
    list.push([x, y, -92 - (x * x) / 640]);
  }
  return runs(list, (p) => ctx.facing([p[0] / 320, 0, 1]), ctx.at);
}

function centerLine(ctx: HeadContext): Pt[][] {
  const { c, r } = ctx.skull;
  const top: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const q = -Math.PI * 0.58 + (i / 24) * Math.PI * 0.62;
    top.push([0, c[1] + r * Math.sin(q), c[2] + r * Math.cos(q)]);
  }
  const face: V3[] = [[0, -180, -110], [0, -80, -60], [0, 8, 0], [0, 52, -60], [0, 150, -95], [0, 345, -70]];
  return [...runs(top, (p) => ctx.facing([p[0], p[1] - c[1], p[2] - c[2]]), ctx.at), ...runs(face, () => ctx.facing([0, 0, 1]), ctx.at)];
}

function sidePlanes(ctx: HeadContext): Pt[][] {
  const { c } = ctx.skull;
  const out: Pt[][] = [];
  for (const sign of [-1, 1]) {
    if (!ctx.facing([sign, 0, 0])) continue;
    const circle: Pt[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      circle.push(ctx.at([sign * ctx.sideX, c[1] + ctx.sideR * Math.sin(t), c[2] + ctx.sideR * Math.cos(t)]));
    }
    out.push(circle);
  }
  return out;
}

function ear(ctx: HeadContext): Pt[][] {
  const out: Pt[][] = [];
  for (const sign of [-1, 1]) {
    if (!ctx.facing([sign, 0, 0.2])) continue;
    const loop: Pt[] = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      loop.push(ctx.at([sign * (ctx.sideX + 8), -60 + 116 * Math.sin(t), ctx.skull.c[2] - 36 + 62 * Math.cos(t)]));
    }
    out.push(loop);
  }
  return out;
}

function real(ctx: HeadContext): Partial<FeatureStage> {
  return { lines: ctx.features, loops: ctx.loops };
}

/** Loomis: una bola, sus cortes y tres distancias iguales de la frente al mentón. */
function loomis(ctx: HeadContext): HeadMethod {
  const brow = -200;
  const unit = 248;
  const axes = [...around(ctx, brow), ...centerLine(ctx)];
  return {
    id: 'loomis',
    name: tx('heads.loomis'),
    about: tx('heads.para_cualquier_angulo_todo'),
    stages: [
      stage(tx('heads.bola'), tx('heads.el_craneo_es_una'), { loops: [ctx.ball] }),
      stage(tx('heads.cortes_laterales'), tx('heads.se_rebana_un_circulo'), { loops: sidePlanes(ctx) }),
      stage(tx('heads.eje_cejas'), tx('heads.la_linea_central_la'), { accent: axes }),
      stage(tx('heads.tres_distancias'), tx('heads.nacimiento_del_pelo_cejas'), { accent: [...around(ctx, brow - unit, 0.3), ...across(ctx, brow + unit, 170), ...across(ctx, 345, 110)] }),
      stage(tx('heads.mandibula'), tx('heads.baja_desde_el_corte'), { lines: ctx.jaw }),
      stage(tx('heads.rasgos'), tx('heads.los_rasgos_se_apoyan'), { ...real(ctx), loops: [...ctx.loops, ...ear(ctx)] }),
    ],
  };
}

/** Anime: círculo, quijada en V y una banda ancha para los ojos. */
function anime(ctx: HeadContext): HeadMethod {
  const chin = ctx.at([0, 345, -70]);
  const eyeY = -150;
  const left = ctx.at([-ctx.skull.r * 0.98, eyeY, ctx.skull.c[2]]);
  const right = ctx.at([ctx.skull.r * 0.98, eyeY, ctx.skull.c[2]]);
  const cheekL = ctx.at([-300, 130, -320]);
  const cheekR = ctx.at([300, 130, -320]);
  const band = [...across(ctx, eyeY - 66, 300), ...across(ctx, eyeY + 66, 300)];
  const hair = ctx.ball.map((p): Pt => mix(ctx.c, p, 1.12));
  return {
    id: 'anime',
    name: tx('common.anime'),
    about: tx('heads.cabeza_simple_ojos_grandes'),
    stages: [
      stage(tx('common.circulo'), tx('heads.un_circulo_para_el'), { loops: [ctx.ball] }),
      stage(tx('heads.cruz'), tx('heads.eje_central_linea_de'), { accent: [...centerLine(ctx), ...around(ctx, eyeY)] }),
      stage(tx('heads.quijada'), tx('heads.desde_los_lados_del'), { lines: [[left, cheekL, chin, cheekR, right]], dots: [chin] }),
      stage(tx('heads.banda_de_ojos'), tx('heads.dos_paralelas_guardan_el'), { accent: band, loops: ctx.loops.slice(0, 2) }),
      stage(tx('heads.nariz_boca'), tx('heads.apenas_una_marca_muy'), { lines: ctx.features.slice(2), loops: ctx.loops.slice(2) }),
      stage(tx('heads.masa_del_pelo'), tx('heads.el_pelo_es_otra'), { lines: [hair.slice(30), hair.slice(0, 16)] }),
    ],
  };
}

const RHYTHM_BROW: V3[] = [[0, -420, -210], [110, -330, -180], [225, -220, -215], [278, -60, -250], [230, 70, -210], [150, 150, -160]];
const RHYTHM_NOSE: V3[] = [[70, -225, -115], [58, -120, -92], [86, 40, -70], [150, 150, -125], [112, 322, -100], [0, 345, -70]];
const SOCKET: V3[] = [[70, -225, -115], [232, -230, -200], [245, -110, -205], [150, -60, -150], [80, -130, -130], [70, -225, -115]];

/** Reilly: curvas que recorren la cabeza y enlazan las formas, sin bloques. */
function reilly(ctx: HeadContext): HeadMethod {
  const flip = (list: V3[]) => list.map(([x, y, z]): V3 => [-x, y, z]);
  const trace = (list: V3[]) => runs(list, (p) => ctx.facing([p[0] / 320, 0, 1]), ctx.at);
  return {
    id: 'reilly',
    name: tx('heads.reilly'),
    about: tx('heads.curvas_que_recorren_la'),
    stages: [
      stage(tx('heads.bola_eje'), tx('heads.empieza_como_loomis_pero'), { loops: [ctx.ball], accent: centerLine(ctx) }),
      stage(tx('heads.ritmo_de_la_frente'), tx('heads.de_la_coronilla_baja'), { accent: [...trace(RHYTHM_BROW), ...trace(flip(RHYTHM_BROW))] }),
      stage(tx('heads.ritmo_de_la_nariz'), tx('heads.de_la_ceja_baja'), { accent: [...trace(RHYTHM_NOSE), ...trace(flip(RHYTHM_NOSE))] }),
      stage(tx('heads.cuencas'), tx('heads.las_cuencas_son_dos'), { lines: [...trace(SOCKET), ...trace(flip(SOCKET))] }),
      stage(tx('heads.mandibula'), tx('heads.sale_del_ultimo_ritmo'), { lines: ctx.jaw }),
      stage(tx('heads.rasgos'), tx('heads.cada_rasgo_se_acomoda'), real(ctx)),
    ],
  };
}

/** Asaro: la cabeza como bloque tallado en planos. */
function asaro(ctx: HeadContext): HeadMethod {
  const third = Math.ceil(ctx.facets.length / 3);
  const edge = (list: { poly: Pt[] }[]) => list.map((f) => f.poly);
  return {
    id: 'asaro',
    name: tx('heads.asaro'),
    about: tx('heads.planos_ayuda_ver_donde'),
    stages: [
      stage(tx('heads.bola'), tx('heads.se_parte_del_mismo'), { loops: [ctx.ball] }),
      stage(tx('heads.frente_cuencas'), tx('heads.cada_plano_es_una'), { loops: edge(ctx.facets.slice(0, third)) }),
      stage(tx('heads.nariz_pomulos'), tx('heads.estos_planos_giran_rapido'), { loops: edge(ctx.facets.slice(third, third * 2)) }),
      stage(tx('heads.hocico_mandibula'), tx('heads.la_boca_sigue_el'), { loops: edge(ctx.facets.slice(third * 2)) }),
      stage(tx('common.valores'), tx('heads.con_una_sola_luz'), { shade: ctx.facets.filter((f) => f.tone <= 0.62).map((f) => ({ poly: f.poly, alpha: f.tone > 0.34 ? 0.16 : 0.36 })) }),
    ],
  };
}

/** Lo que mide esta cara, comparado con la regla de los tercios. */
function measured(m: FaceMarks | null, aspect: number) {
  if (!m || !m.browL.length || !m.browR.length) return null;
  const d = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
  const base = m.noseBase[Math.floor(m.noseBase.length / 2)] ?? m.noseTip;
  const browY: Pt = [(m.browL[0][0] + m.browR[0][0]) / 2, (m.browL[0][1] + m.browR[0][1]) / 2];
  const middle = d(browY, base);
  const lower = d(base, m.chin);
  const eye = (loop: Pt[]) => {
    const xs = loop.map((p) => p[0] * aspect);
    return Math.max(...xs) - Math.min(...xs);
  };
  const eyeWide = (eye(m.eyeL) + eye(m.eyeR)) / 2;
  const a = m.irisL ?? m.eyeL[0];
  const b = m.irisR ?? m.eyeR[0];
  const gap = Math.max(0, d(a, b) - eyeWide);
  return { thirds: lower / (middle || 1), apart: gap / (eyeWide || 1) };
}

/** Proporciones: una retícula para medir, con los números de esta cara. */
function proportions(ctx: HeadContext): HeadMethod {
  const size = measured(ctx.marks, ctx.aspect);
  const wide = 215;
  const crown = -680;
  const box = ([[-wide * 2.1, crown], [wide * 2.1, crown], [wide * 2.1, 345], [-wide * 2.1, 345]] as [number, number][]).map(([x, y]) => ctx.at([x, y, -300]));
  const half = (crown + 345) / 2;
  const fifths: Pt[][] = [];
  for (const x of [-225, -75, 75, 225, -375, 375]) fifths.push([ctx.at([x, -260, -160]), ctx.at([x, -80, -160])]);
  const third = size ? tx('heads.aqui_nariz_menton_mide', { v1: size.thirds.toFixed(2) }) : tx('heads.cejas_nariz_nariz_menton');
  const fifth = size ? tx('heads.aqui_la_distancia_entre', { v1: size.apart.toFixed(2) }) : tx('heads.la_cara_mide_cinco');
  return {
    id: 'proporciones',
    name: tx('heads.proporciones'),
    about: tx('heads.mide_esta_cara_contra'),
    stages: [
      stage(tx('common.caja'), tx('heads.de_frente_la_cabeza'), { lines: [[...box, box[0]]] }),
      stage(tx('heads.mitad'), tx('heads.los_ojos_van_media'), { accent: across(ctx, half, 400) }),
      stage(tx('common.tercios'), third, { accent: [...across(ctx, -200, 300), ...across(ctx, 52, 300), ...across(ctx, 345, 300)] }),
      stage(tx('heads.quintos'), fifth, { lines: fifths }),
      stage(tx('heads.orejas_boca'), tx('heads.la_oreja_cabe_entre'), { loops: ear(ctx), accent: across(ctx, 150, 170) }),
      stage(tx('heads.rasgos'), tx('heads.lo_que_se_aparte'), real(ctx)),
    ],
  };
}

/** Un lado y su espejo, solo donde esa parte de la cara se ve. */
function both(ctx: HeadContext, list: V3[], closed = false): Pt[][] {
  const out: Pt[][] = [];
  for (const sign of [1, -1]) {
    const side = list.map(([x, y, z]): V3 => [x * sign, y, z]);
    const lines = runs(closed ? [...side, side[0]] : side, (p) => ctx.facing([p[0] / 320, 0, 1]), ctx.at);
    out.push(...lines);
  }
  return out;
}

const ORBIT: V3[] = [[62, -212, -108], [150, -238, -128], [232, -214, -186], [250, -128, -206], [196, -62, -168], [104, -64, -124], [58, -128, -112]];
const ZYGOMA: V3[] = [[104, -64, -124], [196, -30, -166], [262, -52, -214], [300, -70, -300], [318, -82, -372]];
const NASAL: V3[] = [[0, -128, -70], [34, -84, -78], [50, 6, -84], [26, 44, -78], [0, 52, -74]];
const TEETH_TOP: V3[] = [[0, 78, -62], [70, 82, -78], [128, 92, -118], [158, 104, -168]];
const TEETH_LOW: V3[] = [[0, 214, -66], [66, 212, -82], [122, 206, -122], [150, 196, -170]];
const TEMPLE: V3[] = [[232, -214, -186], [262, -330, -214], [240, -452, -262], [176, -540, -330]];
const CHIN_BLOCK: V3[] = [[0, 258, -62], [74, 268, -78], [86, 330, -92], [0, 345, -70]];

/** Cráneo: lo duro de la cabeza. Es lo que no cambia con el gesto, y de donde cuelga lo demás. */
function skull(ctx: HeadContext): HeadMethod {
  return {
    id: 'craneo',
    name: tx('heads.craneo'),
    about: tx('heads.el_hueso_bajo_la'),
    stages: [
      stage(tx('heads.caja_craneal'), tx('heads.la_bola_es_hueso'), { loops: [ctx.ball], accent: centerLine(ctx) }),
      stage(tx('heads.cuencas'), tx('heads.dos_huecos_casi_cuadrados'), { lines: both(ctx, ORBIT, true) }),
      stage(tx('heads.pomulo_arco'), tx('heads.del_borde_de_la'), { lines: both(ctx, ZYGOMA), accent: both(ctx, TEMPLE) }),
      stage(tx('heads.nariz_dientes'), tx('heads.el_hueso_de_la'), { lines: [...both(ctx, NASAL), ...both(ctx, TEETH_TOP), ...both(ctx, TEETH_LOW)] }),
      stage(tx('heads.mandibula'), tx('heads.el_unico_hueso_que'), { lines: [...ctx.jaw, ...both(ctx, CHIN_BLOCK)] }),
      stage(tx('heads.lo_blando_encima'), tx('heads.punta_de_la_nariz'), { ...real(ctx), dots: [ctx.at([0, -330, -150]), ctx.at([0, -128, -70]), ctx.at([0, 330, -72]), ...[1, -1].filter((sg) => ctx.facing([sg / 2, 0, 1])).flatMap((sg) => [ctx.at([sg * 250, -60, -206]), ctx.at([sg * 285, 190, -330])])] }),
    ],
  };
}

const ringAt = (c: V3, rx: number, ry: number, tilt = 0): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push([c[0] + x, c[1] + y, c[2] - (x * tilt + (x * x) / 900)]);
  }
  return out;
};
const FRONTALIS: V3[][] = [[[60, -250, -112], [70, -420, -150]], [[130, -256, -124], [150, -420, -172]], [[196, -250, -160], [222, -400, -206]]];
const CORRUGATOR: V3[] = [[14, -206, -98], [58, -226, -106], [104, -238, -116]];
const ZYGO_MAJOR: V3[] = [[250, -52, -208], [200, 30, -176], [150, 104, -146], [112, 146, -122]];
const ZYGO_MINOR: V3[] = [[196, -50, -168], [150, 30, -138], [96, 96, -108]];
const LEVATOR: V3[] = [[70, -70, -110], [66, 0, -96], [60, 70, -92]];
const DEPRESSOR: V3[] = [[112, 150, -122], [128, 230, -130], [118, 300, -130]];
const MENTALIS: V3[] = [[28, 214, -72], [40, 280, -76], [22, 330, -80]];
const MASSETER: V3[] = [[240, -40, -230], [300, -60, -300], [292, 180, -332], [232, 200, -262], [240, -40, -230]];
const TEMPORALIS: V3[] = [[250, -128, -206], [272, -300, -230], [300, -330, -330], [318, -90, -372]];

/** Músculos: lo que mueve la cara. Cada gesto es un músculo jalando hacia su origen. */
function muscles(ctx: HeadContext): HeadMethod {
  const eye = (sign: number) => ringAt([sign * 150, -148, -150], 118, 104, sign * 0.36);
  const eyes = [1, -1].flatMap((sg) => runs(eye(sg), (p) => ctx.facing([p[0] / 320, 0, 1]), ctx.at));
  const mouth = runs(ringAt([0, 150, -92], 124, 74), (p) => ctx.facing([p[0] / 320, 0, 1]), ctx.at);
  return {
    id: 'musculos',
    name: tx('heads.musculos'),
    about: tx('heads.que_jala_que_en'),
    stages: [
      stage(tx('heads.sobre_el_craneo'), tx('heads.los_musculos_de_la'), { loops: [ctx.ball], accent: centerLine(ctx) }),
      stage(tx('heads.anillo_de_los_ojos'), tx('heads.un_anillo_rodea_cada'), { lines: eyes }),
      stage(tx('heads.frente_ceno'), tx('heads.el_frontal_sube_las'), { lines: FRONTALIS.flatMap((f) => both(ctx, f)), accent: both(ctx, CORRUGATOR) }),
      stage(tx('heads.sonrisa'), tx('heads.los_cigomaticos_bajan_del'), { accent: [...both(ctx, ZYGO_MAJOR), ...both(ctx, ZYGO_MINOR)], lines: both(ctx, LEVATOR) }),
      stage(tx('heads.boca_menton'), tx('heads.otro_anillo_cierra_frunce'), { lines: [...mouth, ...both(ctx, MENTALIS)], accent: both(ctx, DEPRESSOR) }),
      stage(tx('heads.masticar'), tx('heads.el_masetero_va_del'), { lines: [...both(ctx, MASSETER), ...both(ctx, TEMPORALIS)] }),
      stage(tx('heads.el_gesto_de_esta'), tx('heads.compara_los_rasgos_reales'), real(ctx)),
    ],
  };
}

export function headMethods(ctx: HeadContext): HeadMethod[] {
  const list = [loomis(ctx), anime(ctx), reilly(ctx), asaro(ctx), skull(ctx), muscles(ctx), proportions(ctx)];
  // Una cara cubierta no tiene rasgos que medir ni planos que leer.
  return ctx.covered ? list.filter((m) => m.id === 'loomis' || m.id === 'anime') : list;
}
