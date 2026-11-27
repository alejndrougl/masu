import { describe, expect, it } from 'vitest';
import { COCO_TO_MHR, HAND_L, MHR, MHR_COUNT, PARENT, TOPOLOGICAL, cropAffine, describeLight, jointAgreement, measureBody, silhouetteOverlap, type Body3D } from './body';
import { estimateLens, lensMap, curvedLine } from './lens';
import { readPerspective } from './perspective';
import { mergeMatte } from './refine';
import { bodyRig, finishRig, cocoFromRig, dragJoint, poseRig } from './rig';
import { colorByValue, waveform } from './tones';
import type { Pt } from './types';

/** Muñeco de prueba: articulaciones en metros, y una malla que envuelve cada hueso. */
function doll(): Body3D {
  const joints = new Float32Array(MHR_COUNT * 3);
  const put = (i: number, x: number, y: number, z = 0) => joints.set([x, y, z], i * 3);
  put(MHR.neck, 0, -0.5);
  put(MHR.nose, 0, -0.68, -0.08);
  put(MHR.eyeL, 0.03, -0.71, -0.07);
  put(MHR.eyeR, -0.03, -0.71, -0.07);
  put(MHR.earL, 0.07, -0.69);
  put(MHR.earR, -0.07, -0.69);
  put(MHR.shoulderL, 0.18, -0.46);
  put(MHR.shoulderR, -0.18, -0.46);
  put(MHR.elbowL, 0.24, -0.18);
  put(MHR.elbowR, -0.24, -0.18);
  put(MHR.wristL, 0.26, 0.06);
  put(MHR.wristR, -0.26, 0.06);
  put(MHR.hipL, 0.09, 0);
  put(MHR.hipR, -0.09, 0);
  put(MHR.kneeL, 0.1, 0.42);
  put(MHR.kneeR, -0.1, 0.42);
  put(MHR.ankleL, 0.1, 0.82);
  put(MHR.ankleR, -0.1, 0.82);
  const verts: number[] = [];
  const bone = (a: number, b: number, r: number) => {
    for (let t = 0; t <= 8; t++) {
      for (let q = 0; q < 8; q++) {
        const k = t / 8;
        const x = joints[a * 3] + (joints[b * 3] - joints[a * 3]) * k;
        const y = joints[a * 3 + 1] + (joints[b * 3 + 1] - joints[a * 3 + 1]) * k;
        verts.push(x + r * Math.cos((q / 8) * 6.283), y, r * Math.sin((q / 8) * 6.283));
      }
    }
  };
  bone(MHR.shoulderL, MHR.elbowL, 0.05);
  bone(MHR.shoulderR, MHR.elbowR, 0.05);
  bone(MHR.elbowL, MHR.wristL, 0.04);
  bone(MHR.elbowR, MHR.wristR, 0.04);
  bone(MHR.hipL, MHR.kneeL, 0.08);
  bone(MHR.hipR, MHR.kneeR, 0.08);
  bone(MHR.kneeL, MHR.ankleL, 0.05);
  bone(MHR.kneeR, MHR.ankleR, 0.05);
  const screen = new Float32Array(MHR_COUNT * 2);
  for (let i = 0; i < MHR_COUNT; i++) {
    screen[i * 2] = 0.5 + joints[i * 3] * 0.45;
    screen[i * 2 + 1] = 0.5 + joints[i * 3 + 1] * 0.45;
  }
  return { joints, screen, vertices: Float32Array.from(verts), distance: 3, overlap: 0.5, agree: 0.9, turn: 0, light: null };
}

describe('esqueleto', () => {
  it('la jerarquía no tiene ciclos y cada padre va antes que sus hijos', () => {
    expect(TOPOLOGICAL).toHaveLength(MHR_COUNT);
    const at = new Map(TOPOLOGICAL.map((j, i) => [j, i]));
    for (let j = 0; j < MHR_COUNT; j++) if (PARENT[j] >= 0) expect(at.get(PARENT[j])!).toBeLessThan(at.get(j)!);
  });

  it('los dedos cuelgan de su muñeca', () => {
    for (const chain of HAND_L) {
      let j = chain[0];
      while (PARENT[j] >= 0 && j !== MHR.wristL) j = PARENT[j];
      expect(j).toBe(MHR.wristL);
    }
  });

  it('el mapeo de puntos no repite una articulación', () => {
    const ids = COCO_TO_MHR.map(([, m]) => m);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('un recorte girado regresa al mismo centro', () => {
    const c = cropAffine(300, 200, 100, 40, 288);
    expect(c.a * 144 + c.b * 144 + c.c).toBeCloseTo(300, 4);
    expect(c.d * 144 + c.e * 144 + c.f).toBeCloseTo(200, 4);
  });

  it('una pose que coincide puntúa mejor que una que no', () => {
    const b = doll();
    const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5]);
    const vis = new Array<number>(133).fill(0);
    for (const [coco, mhr] of COCO_TO_MHR.slice(0, 17)) {
      pts[coco] = [b.screen[mhr * 2], b.screen[mhr * 2 + 1]];
      vis[coco] = 0.9;
    }
    const wrong: Pt[] = pts.map(([x, y]) => [1 - x, 1 - y]);
    expect(jointAgreement(b.screen, { pose: { pts, vis } })).toBeGreaterThan(jointAgreement(b.screen, { pose: { pts: wrong, vis } }));
  });

  it('el dibujo manda en pantalla pero el modelo conserva la profundidad', () => {
    const b = doll();
    b.joints[MHR.elbowL * 3 + 2] = -0.2;
    const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5]);
    const vis = new Array<number>(133).fill(0);
    for (const [coco, mhr] of COCO_TO_MHR.slice(0, 17)) {
      pts[coco] = [b.screen[mhr * 2], b.screen[mhr * 2 + 1]];
      vis[coco] = 0.9;
    }
    // La muñeca del dibujo cae más afuera que la del modelo.
    pts[9] = [b.screen[MHR.wristL * 2] + 0.05, b.screen[MHR.wristL * 2 + 1]];
    const rig = bodyRig(b, b.screen, { pose: { pts, vis }, aspect: 1 });
    expect(rig.pts[MHR.wristL][0]).toBeGreaterThan(b.screen[MHR.wristL * 2] + 0.03);
    expect(rig.pts[MHR.elbowL][2]).toBeGreaterThan(rig.pts[MHR.shoulderL][2]);
  });

  it('una pose improbable y lejana no deforma el cuerpo', () => {
    const b = doll();
    const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5]);
    const vis = new Array<number>(133).fill(0.1);
    for (const i of [5, 6, 7, 8, 11, 12]) vis[i] = 0.9;
    for (const [coco, mhr] of COCO_TO_MHR.slice(5, 13)) pts[coco] = [b.screen[mhr * 2], b.screen[mhr * 2 + 1]];
    pts[9] = [0.02, 0.02];
    vis[9] = 0.2;
    const rig = bodyRig(b, b.screen, { pose: { pts, vis }, aspect: 1 });
    expect(rig.pts[MHR.wristL][0]).toBeCloseTo(b.screen[MHR.wristL * 2], 1);
  });

  const gap = (r: { pts: number[][] }, i: number, j: number) => Math.hypot(r.pts[i][0] - r.pts[j][0], r.pts[i][1] - r.pts[j][1], r.pts[i][2] - r.pts[j][2]);
  const moved = (rig: ReturnType<typeof bodyRig>, edit: Parameters<typeof dragJoint>[4]) => finishRig(rig, { aspect: 1, edit });

  it('mover un codo gira todo lo que cuelga de él, no lo traslada', () => {
    const b = doll();
    const rig = bodyRig(b, b.screen, { aspect: 1 });
    const edit = dragJoint(rig, MHR.elbowL, rig.pts[MHR.elbowL][0] + 0.02, rig.pts[MHR.elbowL][1] - 0.05, {});
    const next = moved(rig, edit);
    expect(gap(next, MHR.elbowL, MHR.shoulderL)).toBeCloseTo(gap(rig, MHR.elbowL, MHR.shoulderL), 3);
    expect(gap(next, MHR.wristL, MHR.elbowL)).toBeCloseTo(gap(rig, MHR.wristL, MHR.elbowL), 3);
    // Si solo se trasladara, el antebrazo seguiría apuntando igual.
    const dir = (r: typeof rig) => [r.pts[MHR.wristL][0] - r.pts[MHR.elbowL][0], r.pts[MHR.wristL][1] - r.pts[MHR.elbowL][1]];
    const [ax, ay] = dir(rig);
    const [bx, by] = dir(next);
    expect(Math.abs(ax * by - ay * bx)).toBeGreaterThan(1e-4);
  });

  it('mover la mano dobla el codo y deja el hombro en su lugar', () => {
    const b = doll();
    const rig = bodyRig(b, b.screen, { aspect: 1 });
    const target: [number, number] = [rig.pts[MHR.wristL][0] + 0.04, rig.pts[MHR.wristL][1] - 0.06];
    const next = moved(rig, dragJoint(rig, MHR.wristL, target[0], target[1], {}));
    expect(next.pts[MHR.shoulderL][0]).toBeCloseTo(rig.pts[MHR.shoulderL][0], 6);
    expect(gap(next, MHR.elbowL, MHR.shoulderL)).toBeCloseTo(gap(rig, MHR.elbowL, MHR.shoulderL), 3);
    expect(gap(next, MHR.wristL, MHR.elbowL)).toBeCloseTo(gap(rig, MHR.wristL, MHR.elbowL), 3);
    expect(next.pts[MHR.wristL][0]).toBeCloseTo(target[0], 2);
    expect(next.pts[MHR.wristL][1]).toBeCloseTo(target[1], 2);
  });

  it('mover la cadera deja los pies plantados', () => {
    const b = doll();
    const rig = bodyRig(b, b.screen, { aspect: 1 });
    const next = moved(rig, dragJoint(rig, MHR.hipL, rig.pts[MHR.hipL][0] + 0.02, rig.pts[MHR.hipL][1] + 0.03, {}));
    expect(next.pts[MHR.ankleL][1]).toBeCloseTo(rig.pts[MHR.ankleL][1], 6);
    expect(next.pts[MHR.ankleR][0]).toBeCloseTo(rig.pts[MHR.ankleR][0], 6);
    expect(next.pts[MHR.neck][1]).toBeCloseTo(rig.pts[MHR.neck][1] + 0.03, 6);
    expect(gap(next, MHR.kneeL, MHR.hipL)).toBeCloseTo(gap(rig, MHR.kneeL, MHR.hipL), 3);
    expect(gap(next, MHR.ankleL, MHR.kneeL)).toBeCloseTo(gap(rig, MHR.ankleL, MHR.kneeL), 3);
  });

  it('dos arrastres seguidos se suman sin saltos', () => {
    const b = doll();
    const rig = bodyRig(b, b.screen, { aspect: 1 });
    const one = dragJoint(rig, MHR.kneeL, rig.pts[MHR.kneeL][0] + 0.02, rig.pts[MHR.kneeL][1], {});
    const first = moved(rig, one);
    const two = dragJoint(first, MHR.kneeL, first.pts[MHR.kneeL][0] + 0.02, first.pts[MHR.kneeL][1], one);
    const second = moved(rig, two);
    expect(second.pts[MHR.kneeL][0]).toBeCloseTo(first.pts[MHR.kneeL][0] + 0.02, 2);
  });

  it('el resto de la lectura ve los puntos corregidos', () => {
    const b = doll();
    const rig = bodyRig(b, b.screen, { aspect: 1 });
    const { pts, vis } = cocoFromRig(rig, undefined, 1);
    expect(vis[5]).toBeGreaterThan(0.5);
    expect(pts[5][0]).toBeCloseTo(rig.pts[MHR.shoulderL][0], 5);
  });

  it('sin cuerpo 3D, la pose plana también da un esqueleto', () => {
    const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5]);
    const vis = new Array<number>(133).fill(0);
    const put = (i: number, x: number, y: number) => {
      pts[i] = [x, y];
      vis[i] = 0.9;
    };
    put(5, 0.6, 0.2);
    put(6, 0.4, 0.2);
    put(11, 0.56, 0.48);
    put(12, 0.44, 0.48);
    const rig = poseRig({ pose: { pts, vis }, aspect: 1 }, 0.13, 0)!;
    expect(rig.seen[MHR.shoulderL]).toBe(true);
    expect(rig.seen[MHR.elbowL]).toBe(false);
  });

  it('mide grosores distintos para muslo y brazo', () => {
    const b = doll();
    const m = measureBody(b.joints, b.vertices);
    expect(m.bones.musloL[0]).toBeGreaterThan(m.bones.brazoL[0]);
  });

  it('la malla sobre su silueta coincide más que sobre otra', () => {
    const b = doll();
    const faces = new Int32Array(Array.from({ length: b.vertices.length / 3 - 9 }, (_, i) => [i, i + 1, i + 8]).flat());
    const W = 96;
    const inside = new Uint8Array(W * W);
    for (let y = 8; y < 88; y++) for (let x = 20; x < 76; x++) inside[y * W + x] = 1;
    const outside = new Uint8Array(W * W);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) outside[y * W + x] = 1;
    expect(silhouetteOverlap(b, faces, { data: inside, w: W, h: W }, 1)).toBeGreaterThan(silhouetteOverlap(b, faces, { data: outside, w: W, h: W }, 1));
  });

  it('nombra la dirección de la luz', () => {
    expect(describeLight({ dir: [-0.6, -0.6, 0.5], fit: 0.5 })).toBe('desde arriba y la izquierda');
    expect(describeLight({ dir: [0.8, 0, -0.5], fit: 0.5 })).toBe('desde la derecha, por detrás');
  });
});

/** Una rejilla de rectas vista con un lente curvo. */
function warpedGrid(size: number, k: number): Uint8Array {
  const map = lensMap({ k, c: [0.5, 0.5] }, size, size);
  const L = new Uint8Array(size * size).fill(230);
  const step = size / 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [sx, sy] = map.straighten([x, y]);
      const near = (v: number) => Math.abs(((v % step) + step) % step - step / 2) < 1.6;
      if (near(sx) || near(sy)) L[y * size + x] = 20;
    }
  }
  return L;
}

describe('lente curvo', () => {
  it('enderezar y volver a curvar deja el punto donde estaba', () => {
    const m = lensMap({ k: -0.5, c: [0.5, 0.5] }, 400, 300);
    const p: Pt = [310, 90];
    const back = m.curve(m.straighten(p));
    expect(back[0]).toBeCloseTo(p[0], 3);
    expect(back[1]).toBeCloseTo(p[1], 3);
  });

  it('mide la curvatura de una rejilla doblada', () => {
    const size = 480;
    const r = estimateLens(warpedGrid(size, -0.45), size, size);
    expect(r.k).toBeLessThan(-0.2);
    expect(r.k).toBeGreaterThan(-0.8);
  });

  it('una rejilla recta no se confunde con ojo de pez', () => {
    const size = 480;
    expect(estimateLens(warpedGrid(size, 0), size, size).k).toBe(0);
  });

  it('una recta del mundo se dibuja curva y pasa por su punto', () => {
    const line = curvedLine([240, 100], [1, 0], { k: -0.6, c: [0.5, 0.5] }, 480, 480);
    const mid = line[line.length >> 1];
    const end = line[2];
    expect(line.length).toBeGreaterThan(20);
    expect(Math.abs(mid[1] - end[1])).toBeGreaterThan(10);
  });

  it('con el lente correcto se explican más líneas', () => {
    const size = 480;
    const L = warpedGrid(size, -0.45);
    const flat = readPerspective(L, size, size, {});
    const bent = readPerspective(L, size, size, { lens: { k: -0.45, c: [0.5, 0.5], sure: 1, arcs: 10 } });
    expect(bent.explained).toBeGreaterThanOrEqual(flat.explained * 0.9);
  });
});

describe('color en los gráficos', () => {
  const W = 4;
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const L = new Uint8Array([60, 60, 200, 200]);
  it('cada valor lleva el color que tiene en la imagen', () => {
    const { tint, chroma } = colorByValue(rgba, L);
    expect(tint[60 * 3]).toBe(255);
    expect(tint[200 * 3 + 2]).toBe(255);
    expect(chroma).toBeGreaterThan(0.9);
  });
  it('el espectrograma guarda el color de cada celda', () => {
    const wave = waveform(L, W, 1, 4, 8, rgba);
    expect(wave.color).toBeDefined();
    expect(Math.max(...wave.color!)).toBe(255);
  });
  it('una imagen gris no inventa color', () => {
    const gray = new Uint8ClampedArray([90, 90, 90, 255, 90, 90, 90, 255]);
    expect(colorByValue(gray, new Uint8Array([90, 90])).chroma).toBe(0);
  });
});

describe('recorte de ilustración', () => {
  it('solo suma lo que toca a la figura', () => {
    const w = 30;
    const mask = new Uint8Array(w * w);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) mask[y * w + x] = 1;
    const matte = new Uint8Array(w * w);
    // El brazo que el primer recorte perdió, y un objeto suelto.
    for (let y = 14; y < 16; y++) for (let x = 2; x < 12; x++) matte[y * w + x] = 1;
    for (let y = 24; y < 28; y++) for (let x = 24; x < 28; x++) matte[y * w + x] = 1;
    const out = mergeMatte(mask, w, w, matte, w, w);
    expect(out[15 * w + 4]).toBe(1);
    expect(out[26 * w + 26]).toBe(0);
  });
});
