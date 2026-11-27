import { describe, expect, it } from 'vitest';
import { handGeometry, pointInPoly, bernsteinFit, beanSides, clipInside, clipOutside, dilateMask, ellipsoidRing, ellipsoidSilhouette, hashSeed, partShape, ringArc, smoothWidths, styleParams, tremor } from './organic';
import type { PartProfile } from './shapes';
import type { Pt } from './types';

const N = 17;

/** Una parte vertical de prueba: eje hacia abajo, ancho dado a cada lado. */
function part(left: number[], right: number[], kind: PartProfile['kind'] = 'brazo'): PartProfile {
  return { key: `${kind}L`, kind, origin: [0, 0], axis: [0, 0.4], across: [-1, 0], left, right, z: 0, aspect: 1 };
}
const flat = (v: number) => Array.from({ length: N }, () => v);
const belly = (peak: number, base: number) => Array.from({ length: N }, (_, i) => base + (peak - base) * Math.sin((Math.PI * i) / (N - 1)));
const extremes = (list: number[]) => {
  let count = 0;
  for (let i = 1; i < list.length - 1; i++) {
    const a = list[i] - list[i - 1];
    const b = list[i + 1] - list[i];
    if (Math.abs(a) < 1e-9 || Math.abs(b) < 1e-9) continue;
    if (a * b < 0) count++;
  }
  return count;
};
const widthOf = (s: { left: Pt[]; right: Pt[] }, i: number) => Math.hypot(s.left[i][0] - s.right[i][0], s.left[i][1] - s.right[i][1]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('organic: suavizado de anchos', () => {
  it('anchos constantes quedan constantes', () => {
    const out = bernsteinFit(flat(0.05), 4);
    for (const v of out) expect(v).toBeCloseTo(0.05, 6);
    const s = smoothWidths(flat(0.05), flat(0.05), 4);
    for (const v of [...s.left, ...s.right]) expect(v).toBeCloseTo(0.05, 4);
  });

  it('ruido sobre una panza da una panza (Â±10 %)', () => {
    const clean = belly(0.08, 0.04);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const noisy = clean.map((v) => v + rnd() * 0.004);
    const out = bernsteinFit(noisy, 4);
    out.forEach((v, i) => {
      if (i === 0 || i === N - 1) return;
      expect(Math.abs(v - clean[i]) / clean[i]).toBeLessThan(0.1);
    });
    expect(extremes(out)).toBeLessThanOrEqual(1);
  });

  it('grado 2 no tiene mÃ¡s de un extremo interior', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const wavy = Array.from({ length: N }, (_, i) => 0.05 + 0.02 * Math.sin(i * 0.9) + rnd() * 0.01);
    expect(extremes(bernsteinFit(wavy, 2))).toBeLessThanOrEqual(1);
  });

  it('conserva la asimetrÃ­a: lo ancho de un lado sigue siendo ancho', () => {
    const s = smoothWidths(belly(0.09, 0.05), belly(0.05, 0.04), 4);
    const mid = Math.floor(N / 2);
    expect(s.left[mid]).toBeGreaterThan(s.right[mid] * 1.4);
  });
});

describe('organic: anillo transversal', () => {
  it('hueso en el plano de la imagen: medio anillo casi recto de largo 2r', () => {
    const r = 0.1;
    const ring = ringArc([0, 0, 0], [1, 0, 0], r);
    expect(ring.closed).toBe(false);
    const xs = ring.pts.map((p) => p[0]);
    const ys = ring.pts.map((p) => p[1]);
    const length = ring.pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - ring.pts[i - 1][0], p[1] - ring.pts[i - 1][1]) : 0), 0);
    expect(length).toBeGreaterThan(1.95 * r);
    expect(length).toBeLessThan(2.05 * r);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1.95 * r);
  });

  it('hueso hacia quien mira: elipse completa', () => {
    const r = 0.1;
    const ring = ringArc([0, 0, 0], [0, 0, 1], r);
    expect(ring.closed).toBe(true);
    for (const [x, y] of ring.pts) expect(Math.hypot(x, y)).toBeCloseTo(r, 4);
    expect(ring.pts.length).toBeGreaterThan(16);
  });

  it('con escorzo intermedio el arco se abre (razÃ³n menor/mayor = |sen Î±|)', () => {
    const r = 0.1;
    const d: [number, number, number] = [Math.cos(0.6), 0, Math.sin(0.6)];
    const ring = ringArc([0, 0, 0], d, r);
    const xs = ring.pts.map((p) => p[0]);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeGreaterThan(0.01);
    expect(spread).toBeLessThan(r * 1.05);
  });
});

describe('organic: recorte por solape', () => {
  const square: Pt[] = [[20, 20], [80, 20], [80, 80], [20, 80]];
  it('una recta que cruza un cuadrado deja dos tramos fuera', () => {
    const line: Pt[] = [[-10, 50], [110, 50]];
    const out = clipOutside(line, square);
    expect(out.length).toBe(2);
    expect(Math.max(...out[0].map((p) => p[0]))).toBeLessThan(21);
    expect(Math.min(...out[1].map((p) => p[0]))).toBeGreaterThan(79);
  });
  it('una recta dentro no deja ningÃºn tramo', () => {
    expect(clipOutside([[30, 50], [70, 50]], square).length).toBe(0);
  });
  it('un tramo menor a 3 px se tira', () => {
    // Sale solo 2 px del cuadrado.
    expect(clipOutside([[30, 50], [82, 50]], square).length).toBe(0);
  });
  it('una recta lejana queda entera', () => {
    const out = clipOutside([[-50, 200], [150, 200]], square);
    expect(out.length).toBe(1);
  });
});

describe('organic: frijol del tronco', () => {
  const stations = Array.from({ length: 9 }, (_, i) => ({ left: [-0.3, i / 8] as Pt, right: [0.3, i / 8] as Pt }));
  it('doblez a la izquierda: cintura izquierda mÃ¡s angosta y arrugas solo a la izquierda', () => {
    const b = beanSides(stations, -20, 0);
    expect(b.waist.left).toBeLessThan(b.waist.right);
    expect(b.wrinkles.length).toBeGreaterThan(0);
    for (const w of b.wrinkles) expect(w.side).toBe('left');
  });
  it('doblez a la derecha: al revÃ©s', () => {
    const b = beanSides(stations, 25, 0);
    expect(b.waist.right).toBeLessThan(b.waist.left);
    for (const w of b.wrinkles) expect(w.side).toBe('right');
  });
  it('la cintura se mete entre 15 y 30 % con doblez de 30Â° sin exageraciÃ³n', () => {
    const b = beanSides(stations, -30, 0);
    const drop = 1 - b.waist.left / 0.3;
    expect(drop).toBeGreaterThan(0.1);
    expect(drop).toBeLessThan(0.32);
  });
  it('sin doblez (< 5Â°): simÃ©trico y sin arrugas', () => {
    const b = beanSides(stations, 3, 0.5);
    expect(b.wrinkles.length).toBe(0);
    expect(b.waist.left).toBeCloseTo(b.waist.right, 6);
  });
});

describe('organic: estilos', () => {
  const profile = part(belly(0.09, 0.05), belly(0.07, 0.04));
  it('cartoon (uniform): todos los anchos iguales', () => {
    const st = styleParams('cartoon', 0, 0);
    const s = partShape(profile, null, st);
    const w = Array.from({ length: s.left.length }, (_, i) => widthOf(s, i)).slice(2, -2);
    const m = mean(w);
    for (const x of w) expect(Math.abs(x - m) / m).toBeLessThan(0.02);
  });
  it('anime mÃ¡s delgado que realista', () => {
    const real = partShape(profile, null, styleParams('realista', 0, 0));
    const anime = partShape(profile, null, styleParams('anime', 0, 0));
    const wr = mean(Array.from({ length: real.left.length }, (_, i) => widthOf(real, i)));
    const wa = mean(Array.from({ length: anime.left.length }, (_, i) => widthOf(anime, i)));
    expect(wa).toBeLessThan(wr * 0.95);
  });
  it('el grado baja con la simplificaciÃ³n y nunca menos de 1', () => {
    expect(styleParams('realista', 0, 0).degree).toBe(4);
    expect(styleParams('realista', 0, 1).degree).toBe(2);
    expect(styleParams('cartoon', 0, 1).degree).toBe(1);
    expect(styleParams('concept', 0, 0).cross).toBe(0);
  });
  it('una punta libre trae tapa redonda', () => {
    const s = partShape(profile, { a: [0, 0, 0], b: [0, 0.4, 0] }, styleParams('realista', 0, 0));
    expect(s.capEnd && s.capEnd.length).toBeGreaterThan(4);
    expect(s.capStart && s.capStart.length).toBeGreaterThan(4);
  });
});

describe('organic: temblor y semilla', () => {
  const base: Pt[] = Array.from({ length: 30 }, (_, i) => [i * 3, Math.sin(i / 5) * 10]);
  it('misma semilla, mismo camino', () => {
    const a = tremor(base, hashSeed('fig1', 'trazo-4'), 1.2);
    const b = tremor(base, hashSeed('fig1', 'trazo-4'), 1.2);
    expect(a).toEqual(b);
  });
  it('otra semilla, otro camino; la amplitud se respeta', () => {
    const a = tremor(base, hashSeed('fig1', 'trazo-4'), 1.2);
    const c = tremor(base, hashSeed('fig1', 'trazo-5'), 1.2);
    expect(a).not.toEqual(c);
    for (let i = 0; i < base.length; i++) expect(Math.hypot(a[i][0] - base[i][0], a[i][1] - base[i][1])).toBeLessThanOrEqual(1.2 * 1.01);
  });
});

describe('organic: silueta del elipsoide', () => {
  const radiusRange = (pts: Pt[]) => {
    const r = pts.map((p) => Math.hypot(p[0], p[1]));
    return [Math.min(...r), Math.max(...r)];
  };
  it('una esfera es un cÃ­rculo de radio r', () => {
    const [lo, hi] = radiusRange(ellipsoidSilhouette([0, 0, 0], [[0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3]]));
    expect(lo).toBeCloseTo(0.3, 6);
    expect(hi).toBeCloseTo(0.3, 6);
  });
  it('eje mayor hacia quien mira: cÃ­rculo del menor', () => {
    const [lo, hi] = radiusRange(ellipsoidSilhouette([0, 0, 0], [[0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.9]]));
    expect(lo).toBeCloseTo(0.2, 6);
    expect(hi).toBeCloseTo(0.2, 6);
  });
  it('un elipsoide de lado da su elipse', () => {
    const [lo, hi] = radiusRange(ellipsoidSilhouette([0, 0, 0], [[0.4, 0, 0], [0, 0.2, 0], [0, 0, 0.3]]));
    expect(hi).toBeCloseTo(0.4, 6);
    expect(lo).toBeCloseTo(0.2, 6);
  });
  it('el anillo con cabeceo se curva: no es una recta', () => {
    const p = 0.17;
    const pts = ellipsoidRing([0, 0, 0], [1, 0, 0], [0, -Math.cos(p), Math.sin(p)], [0, Math.sin(p), Math.cos(p)], 0.3, 0.4, 0.2, -0.8);
    expect(pts.length).toBeGreaterThan(8);
    const ys = pts.map((q) => q[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.005);
  });
});

describe('organic: recorte por mÃ¡scara', () => {
  const w = 40;
  const h = 40;
  const data = new Uint8Array(w * h);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) data[y * w + x] = 1;
  const at = (m: Uint8Array) => (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !!m[Math.floor(y) * w + Math.floor(x)];
  it('un trazo que sale un poco se corta en el borde', () => {
    const out = clipInside([[12, 20], [36, 20]], at(data));
    expect(out.length).toBe(1);
    expect(Math.max(...out[0].map((p) => p[0]))).toBeLessThan(30.5);
  });
  it('un trazo con mÃ¡s de la mitad fuera se tira', () => {
    expect(clipInside([[28, 20], [39, 20]], at(data)).length).toBe(0);
  });
  it('un trazo adentro queda entero', () => {
    expect(clipInside([[12, 20], [28, 20]], at(data)).length).toBe(1);
  });
  it('la dilataciÃ³n deja pasar lo que cae cerca', () => {
    const big = dilateMask(data, w, h, 4);
    expect(clipInside([[12, 20], [33, 20]], at(big))[0][1][0]).toBe(33);
    expect(big[20 * w + 33]).toBe(1);
    expect(data[20 * w + 33]).toBe(0);
  });
});


describe('organic: mano', () => {
  // Mano abierta de frente: muÃ±eca abajo, dedos hacia arriba (y crece hacia abajo).
  const P: Pt[] = [[50, 100], [34, 90], [26, 80], [20, 71], [15, 63]];
  const xs = [36, 50, 63, 75];
  const ys = [62, 58, 61, 67];
  xs.forEach((x, k) => {
    P.push([x, ys[k]], [x + (k - 1) * 0.5, ys[k] - 15], [x + (k - 1), ys[k] - 27], [x + (k - 1) * 1.5, ys[k] - 36]);
  });
  const g = handGeometry(P);
  const area = (q: Pt[]) => Math.abs(q.reduce((a, p, i) => a + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2;
  it('la palma es una caja de dos planos; la arista llega al nudillo del medio', () => {
    expect(area(g.planes[0])).toBeGreaterThan(50);
    expect(area(g.planes[1])).toBeGreaterThan(50);
    const [from, to] = g.ridge;
    expect(Math.hypot(from[0] - 50, from[1] - 100)).toBeLessThan(3);
    expect(Math.hypot(to[0] - P[9][0], to[1] - P[9][1])).toBeLessThan(g.base);
    expect(pointInPoly(P[9][0], P[9][1] + 3, g.palm)).toBe(true);
  });
  it('cada dedo es un tubo que se afina y se mete en la palma (solape en el nudillo)', () => {
    expect(g.fingers.length).toBe(4);
    for (const f of g.fingers) {
      expect(f.radii[3]).toBeLessThan(f.radii[0] * 0.7);
      expect(f.tube.some((p) => pointInPoly(p[0], p[1], g.palm))).toBe(true);
      expect(f.tube.some((p) => !pointInPoly(p[0], p[1], g.palm))).toBe(true);
      expect(f.rings.length).toBe(2);
    }
  });
  it('el pulgar es una cuÃ±a desde la muÃ±eca, mÃ¡s gruesa que un dedo', () => {
    expect(g.thumb.radii[0]).toBeGreaterThan(g.fingers[0].radii[0]);
    expect(Math.hypot(g.thumb.axis[0][0] - 50, g.thumb.axis[0][1] - 100)).toBeLessThan(g.palmLen * 0.5);
  });
  it('el arco de nudillos pasa por los cuatro y el mitÃ³n los encierra', () => {
    for (const i of [5, 9, 13, 17]) expect(g.knuckleArc.some((p) => Math.hypot(p[0] - P[i][0], p[1] - P[i][1]) < 1.5)).toBe(true);
    expect(pointInPoly(P[12][0], P[12][1], g.mitten)).toBe(true);
  });
});

