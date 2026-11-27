import { describe, expect, it } from 'vitest';
import { animalIsUsable, buildAnimal } from './animal';
import { MHR } from './body';
import { gridCrossings, leadingLines, plumbLines, valueTurn, warmthOfValues } from './extras';
import { eyeCenters, FACE_PLANES, fitDrawn, marksFrom68, marksFromDrawn, marksFromLenses, marksFromMesh, warpTo } from './face';
import { organicLimb, trunkMarks } from './forms';
import { BODY, bodyOnly, FACE, findNeck, findWaist, headInMask, lensesByContrast, readHead } from './parts';
import { clipConvex, eyeFeature, eyeFromPixels, mouthFeature, noseFeature, type EyeShape } from './features';
import { bodyIsFalse, poseIsFalse, readFraming, relativeVis, shouldersBelowHead } from './framing';
import { POSE } from './gesture';
import { buildHand, FINGERS, looksLikeFoot } from './hand';
import { buildHeadOnly } from './mannequin';
import { boxFacets, silhouetteMatch, type Piece } from './pieces';
import { depthAgreement, depthFlow } from './perspective';
import { boxFromVanishing } from './solid';
import { buildSurface, PART, skinOf } from './surface';
import type { AnimalMarks, HandMarks, Pt } from './types';

/** Mano abierta y derecha: muñeca abajo, dedos hacia arriba. */
function openHand(reach = 1): HandMarks {
  const pts: Pt[] = [[0.5, 0.8]];
  const bases: Pt[] = [[0.38, 0.72], [0.42, 0.55], [0.5, 0.52], [0.57, 0.54], [0.63, 0.58]];
  bases.forEach(([x, y], i) => {
    const lean = (i - 2) * 0.02;
    for (let k = 0; k < 4; k++) pts.push([x + lean * k, y - k * 0.08 * reach]);
  });
  return { pts, vis: pts.map(() => 1), score: 0.9, source: 'caja' };
}

function fist(): HandMarks {
  const h = openHand();
  // Dedos doblados: las puntas regresan hacia la palma.
  for (const f of FINGERS.slice(1)) {
    const base = h.pts[f[0]];
    h.pts[f[1]] = [base[0], base[1] - 0.06];
    h.pts[f[2]] = [base[0] + 0.02, base[1] - 0.02];
    h.pts[f[3]] = [base[0] + 0.02, base[1] + 0.05];
  }
  return h;
}

function fullPose(): { pts: Pt[]; vis: number[] } {
  const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5] as Pt);
  const vis = new Array<number>(133).fill(0.05);
  const set = (i: number, p: Pt, v = 0.9) => {
    pts[i] = p;
    vis[i] = v;
  };
  set(POSE.nose, [0.5, 0.1]);
  set(POSE.shoulderL, [0.42, 0.25]);
  set(POSE.shoulderR, [0.58, 0.25]);
  set(POSE.hipL, [0.45, 0.5]);
  set(POSE.hipR, [0.55, 0.5]);
  set(POSE.kneeL, [0.45, 0.7]);
  set(POSE.kneeR, [0.55, 0.7]);
  set(POSE.ankleL, [0.45, 0.9]);
  set(POSE.ankleR, [0.55, 0.9]);
  return { pts, vis };
}

describe('encuadre', () => {
  it('sabe hasta dónde llega el cuerpo', () => {
    const p = fullPose();
    expect(readFraming(p)).toBe('completo');
    p.vis[POSE.ankleL] = p.vis[POSE.ankleR] = 0.05;
    expect(readFraming(p)).toBe('tres-cuartos');
    p.vis[POSE.kneeL] = p.vis[POSE.kneeR] = 0.05;
    expect(readFraming(p)).toBe('medio');
    p.vis[POSE.hipL] = p.vis[POSE.hipR] = 0.05;
    expect(readFraming(p)).toBe('busto');
    p.vis[POSE.shoulderL] = p.vis[POSE.shoulderR] = 0.05;
    expect(readFraming(p)).toBe('cabeza');
  });

  it('lo que cae fuera del cuadro no cuenta', () => {
    const p = fullPose();
    p.pts[POSE.ankleL] = [0.45, 1.2];
    p.pts[POSE.ankleR] = [0.55, 1.3];
    expect(readFraming(p)).toBe('tres-cuartos');
  });

  it('un punto seguro pero fuera de la figura tampoco se ve', () => {
    const p = fullPose();
    const data = new Uint8Array(100 * 100);
    // La figura llega hasta la cintura.
    for (let y = 0; y < 58; y++) for (let x = 30; x < 70; x++) data[y * 100 + x] = 1;
    expect(readFraming(p, { data, w: 100, h: 100 })).toBe('medio');
    expect(readFraming(p)).toBe('completo');
  });

  it('mide la confianza contra su propia imagen', () => {
    const p = fullPose();
    p.vis = p.vis.map((v) => v * 0.4);
    expect(Math.max(...relativeVis(p).slice(0, 17))).toBeGreaterThan(0.9);
  });

  it('no le cree a un cuerpo que es una mano', () => {
    const p = fullPose();
    expect(poseIsFalse(p, 0)).toBe(false);
    p.vis = p.vis.map((v) => v * 0.6);
    expect(poseIsFalse(p, 0.3)).toBe(true);
    expect(poseIsFalse(undefined, 0)).toBe(true);
  });

  it('un dibujo con pose débil sigue siendo personaje, salvo que sea una mano', () => {
    const p = fullPose();
    p.vis = p.vis.map(() => 0.1);
    expect(bodyIsFalse('anime-person', p, 0)).toBe(false);
    expect(bodyIsFalse('person', p, 0)).toBe(true);
    expect(bodyIsFalse('anime-person', p, 0.3)).toBe(true);
    expect(bodyIsFalse('person', fullPose(), 0)).toBe(false);
  });

  it('un cuerpo sin tronco ni cabeza no se cree', () => {
    const p = fullPose();
    p.vis = p.vis.map(() => 0.1);
    expect(poseIsFalse(p, 0)).toBe(true);
  });
});

describe('mano', () => {
  it('construye palma y cinco dedos, sin inventar cuerpo', () => {
    const { mannequin, arrows, sticks } = buildHand({ marks: openHand(), aspect: 1 });
    expect(mannequin.rig).toBeNull();
    expect(mannequin.head).toBeNull();
    expect(mannequin.order.map((o) => o.name)).toEqual(['Palma', 'Pulgar', 'Índice', 'Medio', 'Anular', 'Meñique']);
    expect(arrows).toHaveLength(5);
    expect(sticks.length).toBeGreaterThan(20);
    expect(mannequin.pieces.filter((p) => p.step === 3).length).toBe(3);
  });

  it('dibuja elipses en cada articulación', () => {
    const { mannequin } = buildHand({ marks: openHand(), aspect: 1 });
    const first = mannequin.pieces.find((p) => p.id === 'mano-d1-0')!;
    expect(first.caps.length).toBe(2);
    expect(first.planes?.length).toBeGreaterThan(0);
  });

  it('usa la profundidad del modelo cuando existe', () => {
    const marks = openHand();
    marks.world = marks.pts.map(([x, y], i) => [x / 5, y / 5, i >= 9 && i <= 12 ? 0.05 : 0]);
    const { mannequin } = buildHand({ marks, aspect: 1 });
    const mid = mannequin.pieces.find((p) => p.id === 'mano-d2-1')!;
    const ring = mannequin.pieces.find((p) => p.id === 'mano-d3-1')!;
    expect(mid.z).toBeGreaterThan(ring.z);
  });

  it('distingue un pie de una mano, y de un puño', () => {
    expect(looksLikeFoot(openHand(), [])).toBe(false);
    expect(looksLikeFoot(openHand(0.32), [])).toBe(true);
    expect(looksLikeFoot(fist(), [])).toBe(false);
  });

  it('cerca del tobillo de un cuerpo es un pie', () => {
    const pose = fullPose();
    const h = openHand();
    h.pts = h.pts.map(([x, y]) => [x - 0.05, y + 0.1]);
    pose.pts[POSE.wristL] = [0.1, 0.4];
    pose.vis[POSE.wristL] = 0.9;
    expect(looksLikeFoot(h, [pose])).toBe(true);
  });
});

describe('animal', () => {
  const dog = (): AnimalMarks => {
    const pts: Pt[] = [[0.17, 0.25], [0.2, 0.25], [0.12, 0.3], [0.28, 0.32], [0.78, 0.3], [0.3, 0.45], [0.3, 0.62], [0.3, 0.8], [0.34, 0.45], [0.34, 0.62], [0.34, 0.8], [0.72, 0.42], [0.72, 0.6], [0.72, 0.8], [0.76, 0.42], [0.76, 0.6], [0.76, 0.8]];
    return { pts, vis: pts.map(() => 0.9) };
  };

  it('arma tres masas, lomo y cuatro patas', () => {
    const { mannequin, sticks } = buildAnimal({ marks: dog(), aspect: 1.4, label: 'Perro' });
    const names = mannequin.order.map((o) => o.name);
    expect(names.slice(0, 4)).toEqual(['Cabeza', 'Caja torácica', 'Cadera', 'Lomo y cuello']);
    expect(names).toContain('Patas de adelante');
    expect(names).toContain('Patas de atrás');
    expect(mannequin.pieces.filter((p) => p.id.startsWith('pata') && p.id.endsWith('-a'))).toHaveLength(4);
    expect(sticks.length).toBeGreaterThanOrEqual(11);
  });

  it('un ave no se fuerza a cuadrúpedo', () => {
    expect(animalIsUsable(dog(), 'Perro')).toBe(true);
    expect(animalIsUsable(dog(), 'Ave')).toBe(false);
  });

  it('sin tronco claro no se usa', () => {
    const d = dog();
    d.vis = d.vis.map((v, i) => (i < 3 ? v : 0.1));
    expect(animalIsUsable(d, 'Perro')).toBe(false);
  });
});

/** Rostro derecho en numeración iBUG, con la nariz en (.5, .5). */
function face68(): { pts: Pt[]; vis: number[] } {
  const pts: Pt[] = Array.from({ length: 68 }, () => [0.5, 0.5] as Pt);
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI;
    pts[i] = [0.5 - 0.2 * Math.cos(t), 0.42 + 0.3 * Math.sin(t)];
  }
  for (let i = 0; i < 5; i++) {
    pts[17 + i] = [0.34 + i * 0.03, 0.38];
    pts[22 + i] = [0.54 + i * 0.03, 0.38];
  }
  for (let i = 0; i < 4; i++) pts[27 + i] = [0.5, 0.4 + i * 0.033];
  for (let i = 0; i < 5; i++) pts[31 + i] = [0.45 + i * 0.025, 0.54];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    pts[36 + i] = [0.4 - 0.04 * Math.cos(t), 0.42 + 0.012 * Math.sin(t)];
    pts[42 + i] = [0.6 - 0.04 * Math.cos(t), 0.42 + 0.012 * Math.sin(t)];
  }
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    pts[48 + i] = [0.5 - 0.09 * Math.cos(t), 0.62 + 0.03 * Math.sin(t)];
  }
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    pts[60 + i] = [0.5 - 0.06 * Math.cos(t), 0.62 + 0.01 * Math.sin(t)];
  }
  return { pts, vis: pts.map(() => 0.9) };
}

describe('rostro', () => {
  it('los rasgos salen de la cara, no de un rostro promedio', () => {
    const m = marksFrom68(face68().pts, face68().vis)!;
    const built = buildHeadOnly(m, 1)!;
    const [a, b] = eyeCenters(m);
    expect(built.head!.loops[0]).toBe(m.eyeL);
    expect(built.head!.source).toBe('pose');
    expect(a[0]).toBeCloseTo(0.4, 1);
    expect(b[0]).toBeCloseTo(0.6, 1);
  });

  it('las guías pasan por los ojos reales', () => {
    const near = (p: Pt, list: Pt[][]) => Math.min(...list.flat().map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    const f = face68();
    // Ojos subidos y anchos, como en una ilustración.
    for (let i = 36; i < 48; i++) f.pts[i] = [0.5 + (f.pts[i][0] - 0.5) * 1.15, f.pts[i][1] - 0.03];
    const m = marksFrom68(f.pts, f.vis)!;
    const head = buildHeadOnly(m, 1)!.head!;
    for (const eye of eyeCenters(m)) expect(near(eye, head.guides)).toBeLessThan(0.05);
  });

  it('solo una cabeza no inventa cuerpo', () => {
    const f = face68();
    const built = buildHeadOnly(marksFrom68(f.pts, f.vis)!, 1)!;
    expect(built.pieces).toHaveLength(1);
    expect(built.rig).toBeNull();
    expect(built.order.map((o) => o.step)).toEqual([1, 10]);
  });

  it('la malla da la forma completa de cada rasgo', () => {
    const pts: Pt[] = Array.from({ length: 478 }, (_, i) => [(i % 40) / 40, Math.floor(i / 40) / 12]);
    const m = marksFromMesh(pts);
    expect(m.source).toBe('malla');
    expect(m.eyeL.length).toBe(16);
    expect(m.irisL).toEqual(pts[468]);
    expect(m.fit68?.vis.filter(Boolean)).toHaveLength(9);
  });

  it('en un dibujo manda dónde están los ojos', () => {
    const f = face68();
    const eyes = [{ x: 0.3, y: 0.34, w: 0.16, h: 0.14 }, { x: 0.56, y: 0.34, w: 0.16, h: 0.14 }];
    const m = marksFromDrawn({ eyes }, f, 1)!;
    expect(m.source).toBe('dibujo');
    const [a, b] = eyeCenters(m);
    expect(a[0]).toBeCloseTo(0.38, 2);
    expect(b[0]).toBeCloseTo(0.64, 2);
    expect(a[1]).toBeCloseTo(0.41, 2);
  });

  it('el giro de un dibujo sale de la nariz corrida', () => {
    const f = face68();
    const eyes = [{ x: 0.3, y: 0.38, w: 0.16, h: 0.08 }, { x: 0.54, y: 0.38, w: 0.16, h: 0.08 }];
    const m = marksFromDrawn({ eyes }, f, 1)!;
    const front = fitDrawn({ ...m, noseTip: [0.5, 0.52] }, 1)!;
    const right = fitDrawn({ ...m, noseTip: [0.58, 0.52] }, 1)!;
    expect(Math.abs(front.c[0])).toBeLessThan(0.1);
    expect(right.c[0]).toBeLessThan(-0.2);
  });

  it('la corrección llega exacta a cada ancla y se apaga lejos', () => {
    const warp = warpTo([{ from: [0, 0], to: [0.1, 0] }, { from: [1, 0], to: [1, 0.1] }], 0.3);
    const [x, y] = warp([0, 0]);
    expect(x).toBeCloseTo(0.1, 2);
    expect(y).toBeCloseTo(0, 2);
    const [mx] = warp([0.5, 3]);
    expect(Math.abs(mx - 0.5)).toBeLessThan(0.1);
  });

  it('los planos cubren los dos lados de la cara', () => {
    expect(FACE_PLANES.length).toBeGreaterThanOrEqual(20);
    const xs = FACE_PLANES.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBe(-Math.max(...xs));
  });
});

describe('planos y cajas', () => {
  const id = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] };

  it('una caja de frente enseña solo una cara', () => {
    expect(boxFacets([0, 0, 0], id, 1, 1, 1, 1)).toHaveLength(1);
  });

  it('una caja girada enseña tres caras como máximo', () => {
    const c = Math.SQRT1_2;
    const k = 1 / Math.sqrt(3);
    const turned = { x: [c, 0, c], y: [-k, k * 1.4, k], z: [-0.41, -0.81, 0.41] } as typeof id;
    const list = boxFacets([0, 0, 0], turned, 1, 1, 1, 1);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(3);
  });

  it('el sólido de un objeto usa las fugas de su escena', () => {
    // Una caja proyectada a dos fugas y verticales paralelas.
    const left: Pt = [-1.5, 0.3];
    const right: Pt = [2.5, 0.3];
    const front: Pt = [0.5, 0.8];
    const toward = (p: Pt, v: Pt, t: number): Pt => [p[0] + (v[0] - p[0]) * t, p[1] + (v[1] - p[1]) * t];
    const a = toward(front, left, 0.16);
    const b = toward(front, right, 0.16);
    const top = (p: Pt): Pt => [p[0], p[1] - 0.3];
    const outline: Pt[] = [front, b, top(b), toward(top(b), left, 0.16), top(a), a];
    const box = boxFromVanishing(outline, { point: left }, { point: right }, { along: [0, 1] }, 0.3);
    expect(box).not.toBeNull();
    expect(box!.silhouette).toHaveLength(6);
    expect(box!.faces).toHaveLength(3);
    expect(box!.fit).toBeGreaterThan(0.8);
    // La esquina del frente es la que llega más abajo por dentro.
    expect(Math.hypot(box!.front[0] - front[0], box!.front[1] - (front[1] - 0.3))).toBeLessThan(0.08);
  });

  it('sin figura no hay caja', () => {
    expect(boxFromVanishing([[0, 0], [1, 1]], { along: [1, 0] }, { along: [0, 1] }, { along: [1, 1] }, null)).toBeNull();
  });
});

describe('juez de silueta', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): Piece => ({ id: 'a', name: 'a', step: 1, z: 0, outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], caps: [], rings: [], axes: [] });
  const data = new Uint8Array(100 * 100);
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) data[y * 100 + x] = 1;
  const mask = { data, w: 100, h: 100 };

  it('premia lo que calza con la figura', () => {
    expect(silhouetteMatch([square(0.2, 0.2, 0.8, 0.8)], mask)).toBeGreaterThan(0.9);
  });

  it('castiga una lectura inflada o corrida', () => {
    const good = silhouetteMatch([square(0.22, 0.22, 0.78, 0.78)], mask);
    expect(silhouetteMatch([square(0.02, 0.02, 0.98, 0.98)], mask)).toBeLessThan(good * 0.6);
    expect(silhouetteMatch([square(0.6, 0.6, 1, 1)], mask)).toBeLessThan(good * 0.5);
  });
});

describe('hombros y cabeza', () => {
  it('rechaza hombros a la altura de la cara', () => {
    const p = fullPose();
    expect(shouldersBelowHead(p, [0.5, 0.18], [0.5, 0.08], 1)).toBe(true);
    p.pts[POSE.shoulderL] = [0.42, 0.06];
    p.pts[POSE.shoulderR] = [0.58, 0.06];
    expect(shouldersBelowHead(p, [0.5, 0.18], [0.5, 0.08], 1)).toBe(false);
  });
});

describe('rasgos de cerca', () => {
  const eye = (iris: [number, number]): EyeShape => {
    const curve = (lift: number): Pt[] => Array.from({ length: 9 }, (_, i): Pt => [0.4 + i * 0.025, 0.5 + lift * Math.sin((i / 8) * Math.PI)]);
    return { outer: [0.4, 0.5], inner: [0.6, 0.5], upper: curve(-0.04), lower: curve(0.03), iris, irisR: 0.04, crease: curve(-0.07), under: curve(0.05), brow: Array.from({ length: 8 }, (_, i): Pt => [0.38 + i * 0.035, 0.4 + (i % 2) * 0.02]) };
  };

  it('el ojo se construye en siete etapas', () => {
    const f = eyeFeature('ojoL', 'Ojo izquierdo', eye([0.5, 0.5]), 1);
    expect(f.stages.map((s) => s.name)).toEqual(['Bola del ojo', 'Comisuras', 'Párpados', 'Iris', 'Pupila y brillo', 'Pliegue y lagrimal', 'Ceja y valor']);
    expect(f.stages[3].text).toContain('al frente');
  });

  it('a un ojo cerrado no le dibuja iris', () => {
    const shut = { ...eye([0.5, 0.5]), upper: eye([0.5, 0.5]).lower.map(([x, y]): Pt => [x, y - 0.002]), lower: eye([0.5, 0.5]).lower };
    const f = eyeFeature('a', 'a', shut, 1);
    expect(f.stages[3].name).toBe('Párpado cerrado');
    expect(f.stages[3].loops).toHaveLength(0);
    expect(f.stages[4].light).toHaveLength(0);
  });

  it('lee hacia dónde mira', () => {
    expect(eyeFeature('a', 'a', eye([0.56, 0.5]), 1).stages[3].text).toContain('a la derecha');
    expect(eyeFeature('a', 'a', eye([0.44, 0.47]), 1).stages[3].text).toContain('a la izquierda');
  });

  it('el iris se aplana hacia donde mira y lo cortan los párpados', () => {
    const wide = (x: number) => {
      const loop = eyeFeature('a', 'a', { ...eye([x, 0.5]), upper: [[0.4, 0.5], [0.5, 0.3], [0.6, 0.5]], lower: [[0.4, 0.5], [0.5, 0.7], [0.6, 0.5]] }, 1).stages[3].loops[0];
      const xs = loop.map((p) => p[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(wide(0.58)).toBeLessThan(wide(0.5));
  });

  it('un párpado sin pestañas no inventa pupila encima de un dibujo', () => {
    const drawn = eyeFeature('a', 'a', eye([0.5, 0.5]), 1, true);
    expect(drawn.stages[4].light).toHaveLength(0);
    expect(drawn.stages[4].loops.length).toBeGreaterThan(0);
  });

  it('el recorte deja solo lo que cae adentro', () => {
    const clipped = clipConvex([[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [3, 1], [3, 3], [1, 3]]);
    const xs = clipped.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(1);
    expect(Math.max(...xs)).toBeCloseTo(2);
  });

  it('la nariz parte de la cuña y termina en sus sombras', () => {
    const f = noseFeature({ top: [0.5, 0.3], bridgeL: [0.47, 0.33], bridgeR: [0.53, 0.33], tip: [0.5, 0.55], wingL: [0.43, 0.56], wingR: [0.57, 0.56], base: [0.5, 0.58], nostrilL: [0.46, 0.58], nostrilR: [0.54, 0.58], edge: null }, 1);
    expect(f.stages.map((s) => s.name)).toEqual(['Cuña', 'Tres bolas', 'Planos', 'Base y fosas', 'Contorno', 'Luz y sombra']);
    expect(f.stages[1].loops).toHaveLength(3);
    expect(f.stages[3].loops).toHaveLength(2);
  });

  it('la boca marca comisuras y el labio de arriba va en sombra', () => {
    const f = mouthFeature({ cornerL: [0.4, 0.7], cornerR: [0.6, 0.7], top: [0.5, 0.67], bottom: [0.5, 0.75], outer: null, seam: null }, 1);
    expect(f.stages[0].dots).toHaveLength(2);
    expect(f.stages[4].shade.length).toBeGreaterThan(0);
  });

  it('en un dibujo encuentra el iris por sus píxeles', () => {
    // Pestaña oscura arriba e iris oscuro a la derecha.
    const L = ([x, y]: Pt) => (y < 0.42 || Math.hypot(x - 0.56, y - 0.5) < 0.05 ? 0.05 : 0.95);
    const read = eyeFromPixels({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, L, 1, 1);
    expect(read.iris![0]).toBeGreaterThan(0.53);
    expect(read.iris![1]).toBeGreaterThan(0.46);
    expect(read.outer[0]).toBeLessThan(read.inner[0]);
  });
});

describe('partes', () => {
  const W = 40;
  const H = 40;
  const labels = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 10; x < 30; x++) labels[y * W + x] = y < 20 ? BODY.upper : BODY.pants;

  it('la cintura es la frontera entre tronco y piernas', () => {
    const w = findWaist(labels, W, H, 1)!;
    expect(w.c[1]).toBeCloseTo(0.51, 1);
    expect(w.width).toBeGreaterThan(0.35);
  });

  it('sin frontera no hay cintura', () => {
    expect(findWaist(new Uint8Array(W * H), W, H, 1)).toBeNull();
  });

  it('lo que no reconoce no cuenta como cuerpo', () => {
    const silhouette = new Uint8Array(W * H).fill(1);
    const body = bodyOnly(labels, silhouette);
    expect(body[0]).toBe(0);
    expect(body[20 * W + 20]).toBe(1);
  });

  it('nariz y boca dicen que la cara se ve; sin ellas, es una máscara', () => {
    const face = new Uint8Array(100 * 100);
    for (let y = 10; y < 90; y++) for (let x = 20; x < 80; x++) face[y * 100 + x] = FACE.skin;
    const bare = { box: { x: 0, y: 0, w: 1, h: 1 }, w: 100, h: 100, data: face.slice() };
    expect(readHead(bare)?.covered).toBe(true);
    for (let y = 60; y < 70; y++) for (let x = 40; x < 60; x++) face[y * 100 + x] = FACE.lipU;
    for (let y = 40; y < 55; y++) for (let x = 44; x < 56; x++) face[y * 100 + x] = FACE.nose;
    expect(readHead({ ...bare, data: face })?.covered).toBe(false);
  });

  it('unos lentes grandes sin boca son una máscara, aunque se vea algo de nariz', () => {
    const face = new Uint8Array(100 * 100);
    for (let y = 10; y < 90; y++) for (let x = 20; x < 80; x++) face[y * 100 + x] = FACE.skin;
    for (let y = 35; y < 50; y++) {
      for (let x = 24; x < 46; x++) face[y * 100 + x] = FACE.glasses;
      for (let x = 54; x < 76; x++) face[y * 100 + x] = FACE.glasses;
    }
    for (let y = 55; y < 60; y++) for (let x = 46; x < 54; x++) face[y * 100 + x] = FACE.nose;
    const read = readHead({ box: { x: 0, y: 0, w: 1, h: 1 }, w: 100, h: 100, data: face })!;
    expect(read.covered).toBe(true);
    expect(read.lenses).toHaveLength(2);
  });

  it('los lentes dan el giro de una máscara', () => {
    const lens = (cx: number, r: number) => Array.from({ length: 16 }, (_, i): Pt => [cx + r * Math.cos((i / 16) * 6.28), 0.5 + 0.03 * Math.sin((i / 16) * 6.28)]);
    const top: Pt[] = [[0.5, 0.2], [0.45, 0.22], [0.55, 0.22]];
    const front = marksFromLenses([lens(0.4, 0.05), lens(0.6, 0.05)], top, 1)!;
    const turned = marksFromLenses([lens(0.4, 0.07), lens(0.6, 0.03)], top, 1)!;
    expect(front.noseTip[0]).toBeCloseTo(0.5, 2);
    expect(turned.noseTip[0]).toBeGreaterThan(0.52);
    expect(front.chin[1]).toBeGreaterThan(0.7);
  });
});

describe('formas', () => {
  it('una pantorrilla no es un tubo: sus dos lados son distintos', () => {
    const form = organicLimb('pantorrilla', [0, 0, 0], [0, 1, 0], 0.1, 1, 1);
    const xs = form.outline.map((p) => p[0]);
    expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeGreaterThan(0.01);
    expect(form.rings.length).toBeGreaterThan(1);
  });

  it('se adelgaza con la silueta', () => {
    const data = new Uint8Array(100 * 100);
    for (let y = 0; y < 100; y++) for (let x = 47; x < 53; x++) data[y * 100 + x] = 1;
    const wide = organicLimb('muslo', [0.5, 0.2, 0], [0.5, 0.8, 0], 0.1, 1, 1);
    const thin = organicLimb('muslo', [0.5, 0.2, 0], [0.5, 0.8, 0], 0.1, 1, 1, { data, w: 100, h: 100 });
    const span = (f: typeof wide) => Math.max(...f.outline.map((p) => p[0])) - Math.min(...f.outline.map((p) => p[0]));
    expect(span(thin)).toBeLessThan(span(wide));
  });

  it('de espaldas marca columna y omóplatos, no esternón', () => {
    const f = { x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], z: [0, 0, 1] as [number, number, number] };
    const front = trunkMarks([0, 0, 0], f, 1, 1, 1, 1);
    const back = trunkMarks([0, 0, 0], { ...f, z: [0, 0, -1] as [number, number, number] }, 1, 1, 1, 1);
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    expect(back).not.toEqual(front);
  });
});

describe('métodos de cabeza', () => {
  it('una cara ofrece siete maneras de construirse', () => {
    const f = face68();
    const head = buildHeadOnly(marksFrom68(f.pts, f.vis)!, 1)!.head!;
    expect(head.methods.map((m) => m.id)).toEqual(['loomis', 'anime', 'reilly', 'asaro', 'craneo', 'musculos', 'proporciones']);
    for (const m of head.methods) expect(m.stages.length).toBeGreaterThanOrEqual(5);
  });

  it('el cráneo y los músculos dibujan algo en cada etapa', () => {
    const f = face68();
    const head = buildHeadOnly(marksFrom68(f.pts, f.vis)!, 1)!.head!;
    for (const id of ['craneo', 'musculos']) {
      const m = head.methods.find((q) => q.id === id)!;
      for (const s of m.stages) expect(s.lines.length + s.loops.length + s.accent.length).toBeGreaterThan(0);
    }
  });
});

describe('ayudas de las pestañas', () => {
  it('encuentra dónde cruza el contorno cada lado de un cuadro', () => {
    const list = gridCrossings([[[0.2, 0.5], [0.8, 0.5], [0.8, 0.9], [0.2, 0.9]]], { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
    expect(list.map((c) => c.side).sort()).toEqual(['derecha', 'izquierda']);
    expect(list[0].at).toBeCloseTo(0.5, 5);
  });

  it('dice si la sombra es más fría que la luz', () => {
    const n = 300;
    const rgba = new Uint8ClampedArray(n * 4);
    const L = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const dark = i % 2 === 0;
      rgba.set(dark ? [30, 40, 90, 255] : [240, 200, 150, 255], i * 4);
      L[i] = dark ? 45 : 205;
    }
    const read = warmthOfValues(rgba, L);
    expect(read.lights).toBeGreaterThan(0);
    expect(read.shadows).toBeLessThan(0);
    expect(read.text).toContain('frío');
    expect(read.text).not.toMatch(/neutras.*más (frías|cálidas)/);
  });

  it('solo cuenta las rectas que llegan al foco', () => {
    const line = (a: Pt, b: Pt) => ({ a, b, strength: 1, angle: 0 });
    expect(leadingLines([line([0, 0], [0.4, 0.4]), line([0, 0.9], [1, 0.9])], [0.5, 0.5], 1)).toHaveLength(1);
  });

  it('las plomadas unen puntos lejanos alineados', () => {
    const list = plumbLines([[0.5, 0.1], [0.505, 0.8], [0.2, 0.4], [0.8, 0.41]]);
    expect(list.some((p) => p.vertical && Math.abs(p.at - 0.5) < 0.01)).toBe(true);
    expect(list.some((p) => !p.vertical)).toBe(true);
  });

  it('reparte los cuadros en oscuros, medios y luces', () => {
    expect([valueTurn(20, 80, 170), valueTurn(120, 80, 170), valueTurn(220, 80, 170)]).toEqual([1, 2, 3]);
  });
});

describe('la profundidad juzga las fugas', () => {
  const W = 120;
  const H = 90;
  // Un pasillo: mayor es más cerca, y todo se aleja hacia un punto del cuadro.
  const corridor = (cx: number, cy: number) => {
    const depth = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) depth[y * W + x] = Math.min(1, Math.hypot(x - cx, y - cy) / 90);
    return depth;
  };

  it('confirma las líneas que se alejan hacia su fuga', () => {
    const line = { a: [10, 10] as Pt, b: [50, 40] as Pt, length: 50 };
    expect(depthAgreement([line], [60, 45], corridor(60, 45), W, H)).toBe(1);
  });

  it('descarta las líneas que se acercan hacia el punto propuesto', () => {
    const line = { a: [10, 10] as Pt, b: [50, 40] as Pt, length: 50 };
    expect(depthAgreement([line], [-40, -30], corridor(60, 45), W, H)).toBe(0);
  });

  it('no opina donde no hay relieve', () => {
    const line = { a: [10, 10] as Pt, b: [50, 40] as Pt, length: 50 };
    expect(depthAgreement([line], [60, 45], new Float32Array(W * H).fill(0.5), W, H)).toBeNull();
  });

  it('encuentra hacia dónde corre la profundidad', () => {
    const flow = depthFlow(corridor(70, 40), W, H)!;
    expect(Math.abs(flow.point[0] * W - 70)).toBeLessThan(8);
    expect(Math.abs(flow.point[1] * H - 40)).toBeLessThan(8);
    expect(flow.sectors).toBe(8);
  });

  it('un piso que solo sube no se confunde con una fuga', () => {
    const depth = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) depth[y * W + x] = y / H;
    const flow = depthFlow(depth, W, H);
    expect(!flow || flow.sectors < 7).toBe(true);
  });
});

describe('el tronco se corrige con lo que se ve', () => {
  it('encuentra el cuello y se queda cerca de los hombros', () => {
    const W = 60;
    const H = 60;
    const labels = new Uint8Array(W * H);
    for (let y = 0; y < 30; y++) for (let x = 22; x < 38; x++) labels[y * W + x] = BODY.face;
    for (let y = 30; y < 60; y++) for (let x = 15; x < 45; x++) labels[y * W + x] = BODY.upper;
    const neck = findNeck(labels, W, H, [0.5, 0.5], 0.3, 1)!;
    expect(neck[0]).toBeCloseTo(0.5, 1);
    expect(neck[1]).toBeCloseTo(0.5, 1);
  });

  it('una cabeza se mide sin tragarse el hombro', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 70; y++) for (let x = 40; x < 60; x++) data[y * w + x] = 1;
    // El hombro entra de golpe por la izquierda a media altura.
    for (let y = 50; y < 100; y++) for (let x = 10; x < 60; x++) data[y * w + x] = 1;
    const head = headInMask({ data, w, h }, [0.5, 0.6], 0.22, 0.7)!;
    expect(head.rx).toBeCloseTo(0.1, 1);
    expect(head.c[0]).toBeCloseTo(0.5, 1);
    expect(head.c[1] - head.ry).toBeCloseTo(0.2, 1);
  });

  it('el lente blanco de una máscara se ve por contraste', () => {
    const head = { c: [0.5, 0.5] as Pt, rx: 0.2, ry: 0.25 };
    const luma = ([x, y]: Pt) => (Math.abs(y - 0.48) < 0.05 && (Math.abs(x - 0.42) < 0.05 || Math.abs(x - 0.58) < 0.05) ? 0.95 : 0.3);
    const lenses = lensesByContrast(head, luma);
    expect(lenses).toHaveLength(2);
  });
});

describe('la superficie del cuerpo', () => {
  // Una esfera basta para probar lo geométrico: contorno, cintas y lo que se ve.
  const sphere = (cx: number, cy: number, r: number, rings = 22, sides = 32) => {
    const vertices: number[] = [];
    const faces: number[] = [];
    for (let j = 0; j <= rings; j++) {
      const t = (j / rings) * Math.PI;
      for (let i = 0; i < sides; i++) {
        const q = (i / sides) * Math.PI * 2;
        vertices.push(cx + r * Math.sin(t) * Math.cos(q), cy + r * Math.cos(t), r * Math.sin(t) * Math.sin(q));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sides; i++) {
        const a = j * sides + i;
        const b = j * sides + ((i + 1) % sides);
        const c = (j + 1) * sides + i;
        const d = (j + 1) * sides + ((i + 1) % sides);
        faces.push(a, b, c, b, d, c);
      }
    }
    return { vertices: Float32Array.from(vertices), faces: Int32Array.from(faces) };
  };
  const skeleton = () => {
    const base: [number, number, number][] = Array.from({ length: 70 }, () => [0.5, 0.5, 0]);
    const set = (i: number, x: number, y: number) => (base[i] = [x, y, 0]);
    set(MHR.neck, 0.5, 0.3);
    set(MHR.shoulderL, 0.42, 0.32);
    set(MHR.shoulderR, 0.58, 0.32);
    set(MHR.hipL, 0.45, 0.6);
    set(MHR.hipR, 0.55, 0.6);
    set(MHR.earL, 0.47, 0.2);
    set(MHR.earR, 0.53, 0.2);
    set(MHR.nose, 0.5, 0.22);
    return base;
  };
  const rigFor = (base: [number, number, number][]) => ({ pts: base.map((p) => [...p] as [number, number, number]), seen: base.map(() => true), near: base.map(() => 1), H: 0.15, scale: 1, proportion: 1, measures: null, sure: 1, spine: [0.5, 0.45, 0] as [number, number, number], light: null, base, place: { k: 1, ox: 0, oy: 0, rootZ: 0 } });

  it('el contorno de una esfera es un círculo completo', () => {
    const { vertices, faces } = sphere(0.5, 0.5, 0.2);
    const out = buildSurface({ body: { vertices }, faces, rig: rigFor(skeleton()), aspect: 1 })!;
    const pts = out.lines.flatMap((l) => l.pts);
    expect(pts.length).toBeGreaterThan(20);
    for (const [x, y] of pts) expect(Math.hypot(x - 0.5, y - 0.5)).toBeCloseTo(0.2, 1);
    const angles = new Set(pts.map(([x, y]) => Math.floor(((Math.atan2(y - 0.5, x - 0.5) + Math.PI) / (Math.PI * 2)) * 12) % 12));
    expect(angles.size).toBe(12);
  });

  it('una silueta completa dice que toda la malla cae adentro', () => {
    const { vertices, faces } = sphere(0.5, 0.5, 0.2);
    const data = new Uint8Array(100 * 100).fill(1);
    expect(buildSurface({ body: { vertices }, faces, rig: rigFor(skeleton()), aspect: 1, mask: { data, w: 100, h: 100 } })!.inside).toBe(1);
  });

  it('avisa cuando la malla se sale de la figura', () => {
    const { vertices, faces } = sphere(0.5, 0.5, 0.2);
    const data = new Uint8Array(100 * 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 50; x++) data[y * 100 + x] = 1;
    const out = buildSurface({ body: { vertices }, faces, rig: rigFor(skeleton()), aspect: 1, mask: { data, w: 100, h: 100 } })!;
    expect(out.inside).toBeLessThan(0.75);
  });

  it('reparte cada vértice en la parte que le queda más cerca', () => {
    const J = skeleton();
    J[MHR.kneeL] = [0.44, 0.8, 0];
    const x = Float32Array.from([0.44]);
    const y = Float32Array.from([0.7]);
    const z = Float32Array.from([0]);
    const bones = Array.from({ length: 17 }, (_, i) => (i === PART.musloL ? { a: J[MHR.hipL], b: J[MHR.kneeL] } : { a: [9, 9, 9] as [number, number, number], b: [9, 9, 9.1] as [number, number, number] }));
    expect(skinOf(x, y, z, new Int32Array(0), bones, 0.16).part[0]).toBe(PART.musloL);
  });
});
