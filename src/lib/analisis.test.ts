import { describe, expect, it } from 'vitest';
import { activeScheme, adviseCrop, bestTriangle, convexHull, fitOf, readComposition, readSchemes, visualBalance, type CompositionInput } from './composition';
import { rgbToLab } from './color';
import { buildFigure, capsulePath, fitHead } from './figure';
import { readHarmony, hueName } from './harmony';
import { delaunay, edgeMap, inkLines, lowPoly, numberRegions, saturationMap, temperatureMap } from './maps';
import { TUBES, TUBE_SETS, findRecipe, mixColor } from './mixing';
import { depthVanishing, groundOfSky, readPerspective } from './perspective';
import { describeTurn, fitPrimitive, headTurn, linkCircles, massCircles } from './volumes';
import { buildPlan, paintNeeded, formatHours } from './plan';
import { buildGrid } from './canvas';
import { homography, project, rectify } from './warp';
import { loomis } from './loomis';
import type { Pt } from './types';

const base: CompositionInput = {
  aspect: 1,
  focals: [],
  mass: [],
  solid: true,
  attention: new Float32Array(64 * 64).fill(0.1),
  attentionSize: 64,
  tiny: new Uint8Array(32 * 32).fill(128),
  tinySize: 32,
  lines: [],
};
const focal = (x: number, y: number) => [{ x, y, weight: 3, label: 'el rostro' }];
const byId = (list: ReturnType<typeof readComposition>, id: string) => list.find((s) => s.id === id)!;

describe('composición', () => {
  it('reconoce la regla de tercios', () => {
    const r = readComposition({ ...base, focals: focal(1 / 3, 1 / 3) });
    expect(byId(r, 'tercios').score).toBeGreaterThan(90);
    expect(fitOf(byId(r, 'tercios').score)).toBe('domina');
  });
  it('un foco centrado es central, no tercios', () => {
    const r = readComposition({ ...base, focals: focal(0.5, 0.5) });
    expect(byId(r, 'central').score).toBeGreaterThan(80);
    expect(byId(r, 'tercios').score).toBeLessThan(40);
  });
  it('reconoce un triángulo estable y uno invertido', () => {
    const tri: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      tri.push([0.2 + 0.6 * t, 0.85], [0.2 + 0.3 * t, 0.85 - 0.7 * t], [0.8 - 0.3 * t, 0.85 - 0.7 * t]);
    }
    const up = byId(readComposition({ ...base, mass: tri }), 'triangulo');
    expect(up.score).toBeGreaterThan(70);
    expect(up.why).toMatch(/estabilidad/);
    const inverted = tri.map(([x, y]): Pt => [x, 1 - y]);
    expect(byId(readComposition({ ...base, mass: inverted }), 'triangulo').why).toMatch(/invertido/);
  });
  it('una masa cuadrada no es triángulo', () => {
    const box: Pt[] = [];
    for (let i = 0; i <= 30; i++) {
      for (let j = 0; j <= 30; j++) box.push([0.3 + (0.4 * i) / 30, 0.3 + (0.4 * j) / 30]);
    }
    expect(byId(readComposition({ ...base, mass: box }), 'triangulo').score).toBeLessThan(40);
  });
  it('reconoce una masa en diagonal', () => {
    const band: Pt[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      band.push([t, 1 - t], [Math.min(1, t + 0.04), 1 - t]);
    }
    const d = byId(readComposition({ ...base, mass: band }), 'diagonal');
    expect(d.score).toBeGreaterThan(70);
    expect(d.axis![0][0]).toBeCloseTo(0, 1);
    expect(d.axis![0][1]).toBeCloseTo(1, 1);
    expect(d.axis![1][0]).toBeCloseTo(1, 1);
    expect(d.axis![1][1]).toBeCloseTo(0, 1);
  });
  it('la diagonal que se dibuja es la de la masa, no la esquina del marco', () => {
    const band: Pt[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      band.push([0.1 + 0.4 * t, 0.9 - 0.4 * t], [0.12 + 0.4 * t, 0.9 - 0.4 * t]);
    }
    const d = byId(readComposition({ ...base, mass: band }), 'diagonal');
    expect(d.score).toBeGreaterThan(38);
    // Pasa por el centro de la masa (0.31, 0.7), que no está en la esquina del cuadro.
    const [[x0, y0], [x1, y1]] = d.axis!;
    const t = (0.31 - x0) / (x1 - x0);
    expect(y0 + (y1 - y0) * t).toBeCloseTo(0.7, 1);
  });
  it('un triángulo hecho con las esquinas del marco no cuenta', () => {
    const wide: Pt[] = [];
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) if (i / 40 + j / 40 <= 1) wide.push([i / 40, j / 40]);
    const t = byId(readComposition({ ...base, mass: wide }), 'triangulo');
    expect(t.score).toBe(0);
  });
  it('una curva que en realidad es una recta no se afirma', () => {
    const line: Pt[] = Array.from({ length: 12 }, (_, i): Pt => [0.2 + i * 0.05, 0.2 + i * 0.05]);
    const r = readComposition({ ...base, focals: focal(0.5, 0.5), gesture: { shape: 'C', lean: 0, bend: 0.2 }, curve: line });
    expect(byId(r, 'curva').score).toBeLessThan(38);
  });
  it('sin un esquema claro lo dice y no elige uno', () => {
    const r = readSchemes([{ id: 'tercios', name: 'Regla de tercios', score: 20, why: '' }, { id: 'central', name: 'Centrada', score: 10, why: '' }]);
    expect(r.clear).toBe(false);
    expect(r.headline).toBe('Sin un esquema claro');
    expect(activeScheme([{ id: 'tercios', name: 'Regla de tercios', score: 20, why: '' }], null)).toBeUndefined();
  });
  it('con dos esquemas parejos nombra los dos', () => {
    const r = readSchemes([{ id: 'tercios', name: 'Regla de tercios', score: 70, why: '' }, { id: 'aurea', name: 'Proporción áurea', score: 66, why: '' }, { id: 'central', name: 'Centrada', score: 40, why: '' }]);
    expect(r.leading.map((x) => x.id)).toEqual(['tercios', 'aurea']);
    expect(r.headline).toBe('Regla de tercios o Proporción áurea');
  });
  it('la frase de Centrada coincide con su puntaje', () => {
    for (const x of [0.5, 0.56, 0.7]) {
      const c = byId(readComposition({ ...base, focals: focal(x, 0.5) }), 'central');
      if (fitOf(c.score) === 'no') expect(c.why).toMatch(/no está centrado/);
      else expect(c.why).not.toMatch(/no está centrado/);
    }
  });
  it('las líneas que convergen fuera del cuadro cuentan, sin inventar un punto dentro', () => {
    const r = readComposition({ ...base, focals: focal(0.5, 0.5), vanishing: { point: [4, 1], reach: 2.6, rays: [], inside: false, segments: [[[0, 0.9], [0.5, 0.95]]] } });
    const rad = byId(r, 'radial');
    expect(rad.score).toBeGreaterThan(62);
    expect(rad.point).toBeUndefined();
    expect(rad.segments).toHaveLength(1);
  });
  it('detecta simetría y su ausencia', () => {
    const n = 32;
    const sym = new Uint8Array(n * n);
    const rnd = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n / 2; x++) {
        const v = (x * 37 + y * 91) % 255;
        sym[y * n + x] = v;
        sym[y * n + n - 1 - x] = v;
        rnd[y * n + x] = 250;
        rnd[y * n + n - 1 - x] = 5;
      }
    }
    expect(byId(readComposition({ ...base, tiny: sym }), 'simetria').score).toBeGreaterThan(90);
    expect(byId(readComposition({ ...base, tiny: rnd }), 'simetria').score).toBeLessThan(10);
  });
  it('la lista sale ordenada y sin foco no inventa tercios', () => {
    const r = readComposition(base);
    expect(r.find((s) => s.id === 'tercios')).toBeUndefined();
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });
  it('el casco convexo y el mejor triángulo', () => {
    const hull = convexHull([[0, 0], [1, 0], [0.5, 0.2], [0.5, 1], [0.5, 0.4]]);
    expect(hull).toHaveLength(3);
    expect(bestTriangle(hull)!.fill).toBeCloseTo(1);
  });
  it('reencuadra llevando el foco al objetivo', () => {
    const image = { w: 2000, h: 1000 };
    const adv = adviseCrop([0.5, 0.5], [1 / 3, 1 / 3], image, 1, { cx: 0.5, cy: 0.5, zoom: 1 }, 1.6);
    expect(adv.residual).toBeLessThan(0.02);
    expect(adv.crop.zoom).toBeGreaterThan(1);
  });
  it('el peso visual se va hacia donde está la atención', () => {
    const n = 16;
    const map = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 12; x < 16; x++) map[y * n + x] = 1;
    const b = visualBalance(map, n, new Uint8Array(16 * 16).fill(100), 16);
    expect(b.center[0]).toBeGreaterThan(0.8);
    expect(b.label).toBe('Carga a la derecha');
  });
});

const body = (): { pts: Pt[]; vis: number[] } => {
  const pts = Array.from({ length: 133 }, (): Pt => [0.5, 0.05]);
  const vis = new Array(133).fill(0);
  const put = (i: number, p: Pt) => {
    pts[i] = p;
    vis[i] = 0.9;
  };
  put(0, [0.5, 0.1]); put(1, [0.49, 0.09]); put(2, [0.51, 0.09]); put(3, [0.47, 0.1]); put(4, [0.53, 0.1]);
  put(5, [0.42, 0.2]); put(6, [0.58, 0.2]); put(7, [0.38, 0.33]); put(8, [0.62, 0.33]); put(9, [0.36, 0.45]); put(10, [0.64, 0.45]);
  put(11, [0.45, 0.48]); put(12, [0.55, 0.48]); put(13, [0.45, 0.69]); put(14, [0.55, 0.69]); put(15, [0.45, 0.9]); put(16, [0.55, 0.9]);
  return { pts, vis };
};

describe('figura', () => {
  it('arma estructura, formas y canon desde la pose', () => {
    const m = buildFigure({ id: 'a', label: 'Persona', pose: body(), aspect: 1 })!;
    expect(m.source).toBe('esqueleto');
    expect(m.sticks.length).toBeGreaterThan(10);
    expect(m.bones.some((b) => b.part === 'cabeza')).toBe(true);
    expect(m.bones.filter((b) => b.part === 'pierna')).toHaveLength(4);
    expect(m.canon!.count).toBeGreaterThan(4);
    expect(m.canon!.count).toBeLessThan(10);
    expect(m.action.length).toBeGreaterThan(10);
  });
  it('sin pose construye desde la silueta', () => {
    const w = 120;
    const h = 90;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 40; y++) for (let x = 10; x < 110; x++) data[y * w + x] = 1;
    const m = buildFigure({ id: 'b', label: 'Perro', mask: { data, w, h }, aspect: 4 / 3, head: [0.1, 0.3] })!;
    expect(m.source).toBe('forma');
    expect(m.head).not.toBeNull();
    expect(m.circles.length).toBeGreaterThanOrEqual(1);
    expect(m.cylinders.length + m.circles.length).toBeGreaterThanOrEqual(2);
  });
  it('rechaza una pose que cae fuera de la figura', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    for (let y = 80; y < 98; y++) for (let x = 5; x < 95; x++) data[y * w + x] = 1;
    const m = buildFigure({ id: 'c', label: 'Figura', pose: body(), mask: { data, w, h }, aspect: 1 });
    expect(m?.source).toBe('forma');
  });
  it('ajusta la cabeza a la silueta aunque la pista esté corrida', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inHead = (x - 100) ** 2 + (y - 50) ** 2 < 30 ** 2;
        const inBody = x > 70 && x < 130 && y >= 70 && y < 180;
        if (inHead || inBody) data[y * w + x] = 1;
      }
    }
    const fit = fitHead({ data, w, h }, { c: [0.53, 0.3], r: 0.09 }, [0.5, 0.5]);
    expect(Math.abs(fit.c[0] - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(fit.c[1] - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(fit.r - 0.15)).toBeLessThan(0.025);
  });
  it('el contorno de la silueta sale cerrado y suave', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 80; y++) for (let x = 30; x < 70; x++) data[y * w + x] = 1;
    const m = buildFigure({ id: 'd', label: 'x', mask: { data, w, h }, aspect: 1 })!;
    expect(m.outline.length).toBe(1);
    expect(m.outline[0].length).toBeGreaterThan(4);
  });
  it('la cápsula es cerrada y maneja radios distintos', () => {
    expect(capsulePath([0, 0], [100, 0], 10, 20).endsWith('Z')).toBe(true);
    expect(capsulePath([0, 0], [0, 0], 10, 10).endsWith('Z')).toBe(true);
  });
  it('Loomis gira con la cabeza', () => {
    const front = loomis({ yaw: 0, pitch: 0, roll: 0 });
    const turned = loomis({ yaw: 40, pitch: 0, roll: 0 });
    expect(Math.abs(front.marks[1][0])).toBeLessThan(0.01);
    expect(turned.marks[1][0]).toBeGreaterThan(0.3);
    expect(front.marks[2][1]).toBeGreaterThan(front.marks[0][1]);
  });
});

describe('perspectiva', () => {
  const w = 320;
  const h = 240;
  /** Franjas que irradian de un punto: como las juntas de un piso en perspectiva. */
  const radial = (vx: number, vy: number) => {
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = Math.atan2(y - vy * h, x - vx * w);
        L[y * w + x] = Math.floor((t + Math.PI) / (Math.PI / 16)) % 2 ? 210 : 50;
      }
    }
    return L;
  };
  it('encuentra el punto de fuga y el horizonte', () => {
    const p = readPerspective(radial(0.55, 0.42), w, h);
    expect(p.points.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(p.points[0].point[0] - 0.55)).toBeLessThan(0.03);
    expect(Math.abs(p.horizon! - 0.42)).toBeLessThan(0.03);
    expect(p.points[0].lines.length).toBeGreaterThanOrEqual(5);
  });
  it('una textura al azar no es una fuga', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const coarse = Array.from({ length: 40 * 30 }, () => rand() * 255);
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = coarse[Math.floor(y / 8) * 40 + Math.floor(x / 8)];
    expect(readPerspective(L, w, h).points).toHaveLength(0);
  });
  it('rectas casi paralelas, con la fuga a varios anchos de distancia, no dan fuga', () => {
    // Un poco de textura con franjas que irradian de un punto a 3 anchos: a la vista, casi paralelas.
    const L = new Uint8Array(w * h).fill(128);
    for (let y = 0; y < h; y++) {
      for (let x = 100; x < 220; x++) L[y * w + x] = Math.floor(Math.atan2(y - 0.5 * h, 3 * w - x) / (Math.PI / 80)) % 2 ? 210 : 50;
    }
    const p = readPerspective(L, w, h);
    expect(p.points).toHaveLength(0);
    expect(p.parallel).toBe(true);
  });
  it('líneas paralelas no fugan dentro del cuadro', () => {
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = Math.floor((x + y * 0.8) / 24) % 2 ? 210 : 50;
    expect(readPerspective(L, w, h).points).toHaveLength(0);
  });
});

describe('profundidad y volúmenes', () => {
  const w = 120;
  const h = 90;
  it('el punto más lejano de un pasillo es su fuga', () => {
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = Math.min(1, Math.hypot(x - 70, y - 40) / 80);
    const far = depthVanishing(d, w, h)!;
    expect(far).not.toBeNull();
    expect(Math.abs(far.point[0] - 70 / w)).toBeLessThan(0.05);
    expect(Math.abs(far.point[1] - 40 / h)).toBeLessThan(0.05);
  });
  it('un cielo que toca el borde no es una fuga', () => {
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = y / h;
    expect(depthVanishing(d, w, h)).toBeNull();
  });
  it('un pasillo sigue siendo fuga aunque haya cielo más lejos', () => {
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) d[y * w + x] = x > 100 && y < 20 ? 0 : 0.1 + Math.min(0.9, Math.hypot(x - 50, y - 45) / 60);
    }
    const far = depthVanishing(d, w, h)!;
    expect(Math.abs(far.point[0] - 50 / w)).toBeLessThan(0.05);
  });
  it('la fuga en un hueco de cielo baja a donde empieza el suelo', () => {
    // Cielo lejano (0) arriba, que entra como rendija hasta la fila 50; abajo, suelo que se acerca.
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = y < 50 && Math.abs(x - 60) < 12 ? 0 : y < 50 ? 0.6 : 0.3 + ((y - 50) / 40) * 0.7;
    const [, gy] = groundOfSky(d, w, h, [60 / w, 20 / h]);
    expect(Math.abs(gy - 50 / h)).toBeLessThan(0.04);
    // Un punto que no está en el cielo no se mueve.
    expect(groundOfSky(d, w, h, [20 / w, 70 / h])).toEqual([20 / w, 70 / h]);
  });
  it('Loomis respeta cabeceo y ladeo', () => {
    const down = loomis({ yaw: 0, pitch: 30, roll: 0 });
    const flat = loomis({ yaw: 0, pitch: 0, roll: 0 });
    expect(down.marks[1][1]).toBeGreaterThan(flat.marks[1][1]);
    const tilted = loomis({ yaw: 0, pitch: 0, roll: 25 });
    expect(tilted.marks[2][0]).toBeGreaterThan(0.2);
  });
  it('recupera la dirección de una cara con sus puntos', () => {
    const model: [number, [number, number, number]][] = [
      [30, [0, 0, 0]], [8, [0, 330, -65]], [36, [-225, -170, -135]], [45, [225, -170, -135]],
      [39, [-75, -170, -160]], [42, [75, -170, -160]], [48, [-150, 150, -125]], [54, [150, 150, -125]], [27, [0, -180, -110]],
    ];
    const see = (yawDeg: number, pitchDeg: number) => {
      const yw = (yawDeg * Math.PI) / 180;
      const pt = (pitchDeg * Math.PI) / 180;
      const pts = Array.from({ length: 68 }, (): Pt => [0, 0]);
      const vis = new Array(68).fill(0);
      for (const [i, [x, y, z]] of model) {
        const y1 = y * Math.cos(pt) + z * Math.sin(pt);
        const z1 = -y * Math.sin(pt) + z * Math.cos(pt);
        pts[i] = [0.5 + (x * Math.cos(yw) + z1 * Math.sin(yw)) / 4000, 0.5 + y1 / 4000];
        vis[i] = 1;
      }
      return headTurn(pts, vis, 1)!;
    };
    const right = see(35, 0);
    expect(Math.abs(right.yaw - 35)).toBeLessThan(4);
    const down = see(0, 25);
    expect(Math.abs(down.pitch - 25)).toBeLessThan(4);
    expect(describeTurn(right)).toBe('Mira a la derecha');
    expect(describeTurn(see(0, 0))).toBe('Mira de frente');
  });
  it('descompone una silueta en círculos unidos', () => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - 40) ** 2 + (y - 45) ** 2 < 22 ** 2 || (x - 90) ** 2 + (y - 45) ** 2 < 12 ** 2 || (x > 40 && x < 90 && Math.abs(y - 45) < 5)) m[y * w + x] = 1;
      }
    }
    const c = massCircles(m, w, h);
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(c[0].c[0] - 40 / w)).toBeLessThan(0.04);
    expect(linkCircles(c, w / h)).toHaveLength(c.length - 1);
  });
  it('un animal lleva patas además de sus masas', () => {
    const W = 200;
    const H = 150;
    const dog = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x - 60) ** 2 + (y - 55) ** 2 < 32 ** 2 || (x - 135) ** 2 + (y - 55) ** 2 < 28 ** 2) dog[y * W + x] = 1;
        if (x > 60 && x < 135 && Math.abs(y - 55) < 18) dog[y * W + x] = 1;
      }
    }
    for (const x0 of [48, 70, 125, 145]) for (let y = 70; y < 140; y++) for (let x = x0; x < x0 + 7; x++) dog[y * W + x] = 1;
    const m = buildFigure({ id: 'p', label: 'Perro', kind: 'animal', mask: { data: dog, w: W, h: H }, aspect: W / H, head: [0.2, 0.3] })!;
    expect(m.primitive).toBeNull();
    expect(m.circles.length).toBeGreaterThanOrEqual(2);
    expect(m.sticks.length).toBeGreaterThanOrEqual(3);
  });
  it('reconoce esfera, caja y cilindro', () => {
    const disc = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 60) ** 2 + (y - 45) ** 2 < 30 ** 2) disc[y * w + x] = 1;
    expect(fitPrimitive(disc, w, h)!.kind).toBe('esfera');
    const box = new Uint8Array(w * h);
    for (let y = 25; y < 65; y++) for (let x = 30; x < 90; x++) box[y * w + x] = 1;
    expect(fitPrimitive(box, w, h)!.kind).toBe('caja');
    expect(fitPrimitive(box, w, h, 'Botella')!.kind).toBe('cilindro');
  });
  it('un brazo acortado abre la tapa del cilindro', () => {
    const pose = body();
    pose.pts[9] = [0.385, 0.34];
    const m = buildFigure({ id: 'a', label: 'Persona', pose, aspect: 1 })!;
    const arms = m.cylinders.filter((c) => c.part === 'brazo');
    expect(Math.max(...arms.map((c) => c.open))).toBeGreaterThan(Math.min(...arms.map((c) => c.open)));
    expect(m.cylinders.length).toBeGreaterThan(6);
  });
});

describe('mezclas', () => {
  const tube = (id: string) => TUBES.find((t) => t.id === id)!;
  it('un tubo solo se reproduce a sí mismo', () => {
    const r = findRecipe(tube('ocre').rgb, TUBES)!;
    expect(r.error).toBeLessThan(1.5);
    expect(r.parts).toHaveLength(1);
  });
  it('el blanco aclara', () => {
    const mix = mixColor([{ ...tube('rojo'), amount: 1 }, { ...tube('blanco'), amount: 4 }]);
    expect(rgbToLab(...mix)[0]).toBeGreaterThan(rgbToLab(...tube('rojo').rgb)[0]);
  });
  it('mezcla como pigmento: azul y amarillo no dan gris', () => {
    const mix = mixColor([{ ...tube('limon'), amount: 3 }, { ...tube('cobalto'), amount: 1 }]);
    expect(mix[1]).toBeGreaterThan(mix[2]);
  });
  it('con Zorn aproxima una piel', () => {
    const zorn = TUBE_SETS[0].tubes.map(tube);
    const r = findRecipe([222, 178, 150], zorn)!;
    expect(r.error).toBeLessThan(10);
    expect(r.parts.length).toBeLessThanOrEqual(3);
    expect(r.text).toMatch(/Blanco/);
  });
});

describe('armonía', () => {
  const hue = (peaks: number[]) => {
    const h = new Array(72).fill(0);
    for (const d of peaks) h[Math.floor(d / 5)] = 1;
    return h;
  };
  it('complementaria, triádica y análoga', () => {
    expect(readHarmony(hue([40, 220])).kind).toBe('Complementaria');
    expect(readHarmony(hue([30, 150, 270])).kind).toBe('Triádica');
    expect(readHarmony(hue([100])).kind).toBe('Monocromática');
  });
  it('sin color lo dice', () => {
    expect(readHarmony(new Array(72).fill(0)).kind).toBe('Casi acromática');
  });
  it('nombra tonos', () => {
    expect(hueName(40)).toBe('rojo');
    expect(hueName(250)).toBe('azul');
  });
});

describe('mapas', () => {
  const rgba = (rows: number[][]) => new Uint8ClampedArray(rows.flat());
  it('separa cálido, frío y neutro', () => {
    const m = temperatureMap(rgba([[220, 60, 30, 255], [30, 60, 220, 255], [128, 128, 128, 255], [240, 150, 40, 255]]));
    expect(m.shares[0]).toBeCloseTo(0.5);
    expect(m.shares[1]).toBeCloseTo(0.25);
    expect(m.shares[2]).toBeCloseTo(0.25);
  });
  it('mide saturación', () => {
    const m = saturationMap(rgba([[255, 0, 0, 255], [128, 128, 128, 255]]));
    expect(m.shares[0]).toBeCloseTo(0.5);
    expect(m.shares[1]).toBeCloseTo(0.5);
    expect(m.rgba[0]).toBeLessThan(m.rgba[4]);
  });
  it('distingue borde duro de transición suave', () => {
    const w = 120;
    const h = 80;
    const hard = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) hard[i] = i % w < 60 ? 30 : 220;
    const smooth = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) smooth[i] = ((i % w) / w) * 255;
    expect(edgeMap(hard, w, h).shares[0]).toBeGreaterThan(edgeMap(smooth, w, h).shares[0]);
  });
  it('la tinta marca bordes y deja limpio lo plano', () => {
    const w = 80;
    const h = 80;
    const L = new Uint8Array(w * h).fill(200);
    for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) L[y * w + x] = 40;
    const ink = inkLines(L, w, h);
    expect(ink[5 * w + 5]).toBe(0);
    expect(Math.max(...ink)).toBeGreaterThan(100);
  });
  it('Delaunay cubre el cuadrado', () => {
    const pts: Pt[] = [[0, 0], [10, 0], [0, 10], [10, 10], [5, 5]];
    expect(delaunay(pts)).toHaveLength(4);
  });
  it('los planos dan facetas con color', () => {
    const w = 80;
    const h = 60;
    const data = new Uint8ClampedArray(w * h * 4).fill(200);
    const L = new Uint8Array(w * h).fill(180);
    const r = lowPoly(data, L, w, h, 100);
    expect(r.triangles.length).toBeGreaterThan(40);
    expect(r.colors).toHaveLength(r.triangles.length);
  });
  it('numera regiones y funde motas', () => {
    const w = 60;
    const h = 40;
    const labels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 30; x < w; x++) labels[y * w + x] = 1;
    labels[10 * w + 10] = 1;
    const r = numberRegions(labels, w, h, 20);
    expect(r.labels).toHaveLength(2);
    expect(r.labels.map((l) => l.n).sort()).toEqual([1, 2]);
  });
});

describe('plan de pintura', () => {
  const w = 120;
  const h = 120;
  const canvas = { w: 40, h: 40, unit: 'cm' as const };
  const grid = buildGrid(canvas, { cell: 10, origin: 'corner' });
  const L = new Uint8Array(w * h).fill(120);
  for (let y = 60; y < 90; y++) for (let x = 60; x < 90; x++) L[y * w + x] = (x * 13 + y * 7) % 2 ? 240 : 10;
  const subject = new Uint8Array(w * h);
  for (let y = 60; y < 90; y++) for (let x = 60; x < 90; x++) subject[y * w + x] = 1;
  it('lo difícil es lo detallado y va al final', () => {
    const p = buildPlan({ L, w, h, grid, canvas, technique: 'oleo', subject, pace: 0.4 });
    expect(p.cells).toHaveLength(16);
    expect(p.hardest).toContain('C3');
    const c3 = p.cells.find((c) => c.name === 'C3')!;
    const a1 = p.cells.find((c) => c.name === 'A1')!;
    expect(c3.order).toBeGreaterThan(a1.order);
    expect(p.hours).toBeGreaterThan(0);
  });
  it('la cantidad de pintura sale del área', () => {
    const ml = paintNeeded([{ rgb: [0, 0, 0], hex: '#000', share: 0.5, pigment: 'Negro' }], canvas, 'oleo');
    expect(ml[0].ml).toBeCloseTo(800 / 45);
  });
  it('escribe las horas', () => {
    expect(formatHours(0.4)).toBe('25 min');
    expect(formatHours(14.2)).toBe('14 h');
  });
});

describe('enderezar', () => {
  it('la homografía respeta las esquinas', () => {
    const src: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const dst: Pt[] = [[10, 12], [90, 5], [95, 88], [4, 92]];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const q = project(H, p);
      expect(q[0]).toBeCloseTo(dst[i][0]);
      expect(q[1]).toBeCloseTo(dst[i][1]);
    });
  });
  it('endereza una foto', () => {
    const sw = 40;
    const sh = 40;
    const src = new Uint8ClampedArray(sw * sh * 4);
    for (let i = 0; i < sw * sh; i++) {
      src[i * 4] = i % sw < 20 ? 255 : 0;
      src[i * 4 + 3] = 255;
    }
    const out = rectify(src, sw, sh, [[0, 0], [1, 0], [1, 1], [0, 1]], 20, 20);
    expect(out[0]).toBe(255);
    expect(out[(5 * 20 + 19) * 4]).toBe(0);
  });
});

