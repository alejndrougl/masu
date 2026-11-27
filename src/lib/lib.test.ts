import { describe, expect, it } from 'vitest';
import { buildGrid, canvasFromImage, cellName, columnName, exactCells, frameRect, locate, orient, suggestCell } from './canvas';
import { faceLight, readCell, lightDirection } from './cell';
import { hex, kmeansLab, labToRgb, lightness, nameSwatches, nearestPigment, rgbToLab } from './color';
import { warmthOfValues } from './extras';
import { readHarmony } from './harmony';
import { TUBES, TUBE_SETS, findRecipe } from './mixing';
import { canny, dominantLines, linkEdges, maskContours, polygonArea, simplifyLine, simplifyLoop } from './edges';
import { angularLoop, buildEncaje, completeMask, fewSides } from './encaje';
import { GOLD_MAJOR, GOLD_MINOR, PHI, goldenCompanion, goldenSpiral, readGolden, spiralEye } from './golden';
import { brushPath, catmullRom, maskSkeleton, maskSpine, poseLine, readGesture } from './gesture';
import { saliencyPeaks, spectralSaliency } from './saliency';
import { kuwahara, simplifyImage } from './simplify';
import { histogram, multiOtsu, valueReading, waveform, zoneOf, zoneShares } from './tones';
import type { Pt } from './types';

const rgbaOf = (w: number, h: number, fn: (x: number, y: number) => number) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const v = fn(x, y);
      out[p] = out[p + 1] = out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
};

describe('lienzo y encuadre', () => {
  it('recorta por el lado que sobra', () => {
    const r = frameRect(2000, 1000, 1, { cx: 0.5, cy: 0.5, zoom: 1 });
    expect(r).toEqual({ x: 500, y: 0, w: 1000, h: 1000 });
  });
  it('el encuadre nunca se sale de la imagen', () => {
    const r = frameRect(2000, 1000, 1, { cx: 0, cy: 1, zoom: 2 });
    expect(r.x).toBe(0);
    expect(r.y + r.h).toBe(1000);
    expect(r.w).toBe(500);
  });
  it('orienta el preset como la foto', () => {
    expect(orient({ w: 30, h: 40 }, 1600, 900)).toEqual({ w: 40, h: 30 });
    expect(orient({ w: 30, h: 40 }, 900, 1600)).toEqual({ w: 30, h: 40 });
  });
});

describe('cuadrícula', () => {
  it('cierra exacto cuando el cuadro divide el lienzo', () => {
    const g = buildGrid({ w: 30, h: 40, unit: 'cm' }, { cell: 5, origin: 'corner' });
    expect(g.cols).toBe(6);
    expect(g.rows).toBe(8);
    expect(g.restX).toBe(0);
    expect(g.xs[g.xs.length - 1]).toBe(30);
  });
  it('deja el sobrante en el último cuadro', () => {
    const g = buildGrid({ w: 32, h: 40, unit: 'cm' }, { cell: 5, origin: 'corner' });
    expect(g.cols).toBe(7);
    expect(g.restX).toBeCloseTo(2);
    expect(g.xs.at(-1)).toBe(32);
    expect(g.xs.at(-2)).toBe(30);
  });
  it('centrada reparte el sobrante en ambos bordes', () => {
    const g = buildGrid({ w: 32, h: 40, unit: 'cm' }, { cell: 5, origin: 'center' });
    expect(g.xs[0]).toBe(0);
    expect(g.xs[1]).toBeCloseTo(1);
    expect(g.xs.at(-2)).toBeCloseTo(31);
    expect(g.cols).toBe(8);
  });
  it('el lienzo inicial cierra exacto y respeta la foto', () => {
    for (const [iw, ih] of [[1920, 1280], [1920, 2861], [700, 577], [1795, 2397], [1000, 1000]]) {
      const c = canvasFromImage(iw, ih);
      expect(Math.abs(c.w / c.h - iw / ih) / (iw / ih)).toBeLessThan(0.013);
      expect(exactCells(c.w, c.h).some((x) => Number.isInteger(x) && Math.max(c.w, c.h) / x >= 6 && Math.max(c.w, c.h) / x <= 12)).toBe(true);
    }
  });
  it('nombra columnas como una hoja de cálculo', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(cellName(2, 3)).toBe('C4');
  });
  it('ubica un punto en su cuadro', () => {
    expect(locate([0, 5, 10], 7)).toBe(1);
    expect(locate([0, 5, 10], 10)).toBe(1);
  });
  it('propone tamaños exactos para 30 × 40', () => {
    expect(exactCells(30, 40)).toEqual(expect.arrayContaining([1, 2, 2.5, 5, 10]));
    expect(exactCells(30, 40)).not.toContain(3);
    expect(suggestCell(30, 40)).toBe(5);
  });
  it('sin divisor exacto sugiere uno razonable', () => {
    expect(exactCells(21.6, 27.9)).toEqual([]);
    expect(suggestCell(21.6, 27.9)).toBe(3.5);
  });
});

describe('color', () => {
  it('Lab ida y vuelta conserva el color', () => {
    for (const c of [[10, 20, 30], [200, 40, 90], [255, 255, 255], [0, 0, 0]] as [number, number, number][]) {
      const back = labToRgb(...rgbToLab(...c));
      back.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThanOrEqual(1));
    }
  });
  it('la claridad va de 0 a 255', () => {
    const L = lightness(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]));
    expect(L[0]).toBe(0);
    expect(L[1]).toBe(255);
  });
  it('reconoce pigmentos', () => {
    expect(nearestPigment([246, 190, 30])).toBe('Amarillo cadmio');
    expect(nearestPigment([30, 30, 28])).toBe('Negro marfil');
  });
  it('k-means separa dos grupos claros', () => {
    const s = new Float32Array([10, 0, 0, 11, 0, 0, 90, 0, 0, 91, 0, 0]);
    const { counts } = kmeansLab(s, 2);
    expect(counts.sort()).toEqual([2, 2]);
  });
  it('hex', () => expect(hex([255, 0, 16])).toBe('#ff0010'));
});

describe('valores', () => {
  it('Otsu encuentra los grupos tonales de la imagen', () => {
    const hist = new Array(256).fill(0);
    for (const c of [20, 90, 160, 230]) hist[c] = 1000;
    const t = multiOtsu(hist);
    expect(t[0]).toBeGreaterThan(20);
    expect(t[0]).toBeLessThanOrEqual(90);
    expect(t[1]).toBeGreaterThan(90);
    expect(t[1]).toBeLessThanOrEqual(160);
    expect(t[2]).toBeGreaterThan(160);
    expect(t[2]).toBeLessThanOrEqual(230);
    expect(zoneShares(hist, t)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
  it('clasifica por zona', () => {
    const t = [50, 100, 200] as const;
    expect([zoneOf(10, t), zoneOf(50, t), zoneOf(150, t), zoneOf(250, t)]).toEqual([0, 1, 2, 3]);
  });
  it('el espectrograma ubica las luces a la derecha', () => {
    const L = new Uint8Array(100 * 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) L[y * 100 + x] = x < 50 ? 10 : 245;
    const wave = waveform(L, 100, 100, 10, 8);
    const topRow = wave.data.subarray(0, 10);
    expect(topRow[9]).toBeGreaterThan(0);
    expect(topRow[0]).toBe(0);
    expect(wave.data[7 * 10 + 0]).toBeGreaterThan(0);
  });
  it('histograma cuenta todo', () => {
    expect(histogram(new Uint8Array([0, 0, 5])).reduce((a, b) => a + b)).toBe(3);
  });
});

describe('proporción áurea', () => {
  it('la espiral converge a su ojo', () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const { spiral } = goldenSpiral(turn, false, 12);
      const end = spiral[spiral.length - 1];
      const eye = spiralEye(turn);
      expect(Math.hypot(end[0] - eye[0], end[1] - eye[1])).toBeLessThan(0.02);
    }
  });
  it('la espiral no se sale del encuadre', () => {
    const { spiral } = goldenSpiral(2, true);
    for (const [x, y] of spiral) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(1 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it('reconoce un foco sobre el cruce áureo', () => {
    const r = readGolden([{ x: GOLD_MAJOR, y: GOLD_MINOR, weight: 1, label: 'x' }], PHI);
    expect(r.verdict).toBe('si');
    expect(r.distance).toBeLessThan(0.001);
    expect(r.ratioOff).toBeCloseTo(0);
  });
  it('no ve áurea en un foco centrado', () => {
    const r = readGolden([{ x: 0.5, y: 0.5, weight: 1, label: 'x' }], 1);
    expect(r.verdict).toBe('no');
    expect(r.chance).toBeGreaterThan(0.1);
  });
  it('sin foco no inventa nada', () => {
    expect(readGolden([], 1.5).verdict).toBe('sin-foco');
  });
  it('calcula el lado áureo', () => {
    expect(goldenCompanion(30, 40).h).toBeCloseTo(48.54, 1);
    expect(goldenCompanion(40, 30).w).toBeCloseTo(48.54, 1);
  });
});

describe('líneas', () => {
  const square = () => {
    const w = 80;
    const h = 60;
    const mask = new Uint8Array(w * h);
    for (let y = 20; y < 40; y++) for (let x = 30; x < 50; x++) mask[y * w + x] = 1;
    return { mask, w, h };
  };
  it('saca el contorno de una máscara', () => {
    const { mask, w, h } = square();
    const loops = maskContours(mask, w, h);
    expect(loops).toHaveLength(1);
    expect(polygonArea(loops[0])).toBe(400);
    expect(simplifyLoop(loops[0], 0.5)).toHaveLength(4);
  });
  it('un hueco es otro contorno', () => {
    const { mask, w, h } = square();
    mask[30 * w + 40] = 0;
    expect(maskContours(mask, w, h)).toHaveLength(2);
  });
  it('RDP deja recta una línea recta', () => {
    const pts: Pt[] = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
    expect(simplifyLine(pts, 0.5)).toHaveLength(2);
  });
  it('Canny encuentra un escalón y lo encadena', () => {
    const w = 64;
    const h = 64;
    const gray = Float32Array.from({ length: w * h }, (_, i) => (i % w < 32 ? 20 : 220));
    const edges = canny(gray, w, h);
    const lines = linkEdges(edges, w, h, 20);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const xs = lines[0].map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(2);
  });
  it('encuentra una línea dominante diagonal', () => {
    const w = 200;
    const h = 200;
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = x > y ? 230 : 25;
    const lines = dominantLines(L, w, h);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(Math.abs(lines[0].angle) - 135) < 8 || Math.abs(Math.abs(lines[0].angle) - 45) < 8).toBe(true);
    expect(lines[0].strength).toBeGreaterThan(0.5);
  });
  it('el encaje va de lo general a lo particular', () => {
    const w = 200;
    const h = 150;
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inCircle = (x - 100) ** 2 + (y - 75) ** 2 < 50 ** 2;
        L[y * w + x] = inCircle ? 40 + (x % 7) : 210;
      }
    }
    const strokes = buildEncaje({ L, w, h, figures: [] });
    const stages = new Set(strokes.map((s) => s.stage));
    expect(stages.has(1)).toBe(true);
    expect(stages.has(2)).toBe(true);
    const silhouette = strokes.find((s) => s.stage === 1)!;
    expect(silhouette.closed).toBe(true);
    expect(silhouette.pts.length).toBeLessThan(40);
  });
  it('el encaje lee una figura de lo general a lo particular', () => {
    const w = 80;
    const h = 80;
    const L = new Uint8Array(w * h).fill(200);
    const fig = new Uint8Array(w * h);
    for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) fig[y * w + x] = 1;
    const strokes = buildEncaje({ L, w, h, figures: [{ mask: fig, blocks: [] }] });
    expect(strokes.filter((s) => s.stage === 1).length).toBeLessThanOrEqual(8);
    expect(strokes.filter((s) => s.stage === 2 && s.name)).toHaveLength(1);
    expect(strokes.some((s) => s.stage === 3 && s.closed)).toBe(true);
  });
  it('cada parte es un bloque y lo que sobra es un objeto', () => {
    const w = 120;
    const h = 120;
    const L = new Uint8Array(w * h).fill(200);
    const fig = new Uint8Array(w * h);
    for (let y = 20; y < 100; y++) for (let x = 50; x < 70; x++) fig[y * w + x] = 1;
    for (let y = 40; y < 80; y++) for (let x = 85; x < 110; x++) fig[y * w + x] = 1;
    for (let y = 58; y < 62; y++) for (let x = 70; x < 85; x++) fig[y * w + x] = 1;
    const strokes = buildEncaje({ L, w, h, figures: [{ mask: fig, blocks: [{ id: 't', name: 'Tronco', order: 2, a: [0.5, 0.2], b: [0.5, 0.8], ra: 0.09, rb: 0.09 }] }] });
    const names = strokes.filter((s) => s.stage === 2).map((s) => s.name);
    expect(names).toContain('Tronco');
    expect(names).toContain('Objeto');
  });
  it('un recorte incompleto recupera la parte que le falta', () => {
    const w = 60;
    const h = 60;
    const mask = new Uint8Array(w * h);
    for (let y = 10; y < 30; y++) for (let x = 25; x < 35; x++) mask[y * w + x] = 1;
    const out = completeMask(mask, w, h, [{ id: 'p', name: 'Muslo der.', order: 5, a: [0.5, 0.6], b: [0.5, 0.9], ra: 0.05, rb: 0.05 }]);
    expect(out[45 * w + 30]).toBe(1);
    expect(mask[45 * w + 30]).toBe(0);
  });
  it('el contorno anguloso usa pocas rectas sin alejarse de la forma', () => {
    const loop: Pt[] = [];
    for (let i = 0; i < 200; i++) loop.push([i, 0]);
    for (let i = 0; i < 200; i++) loop.push([200, i]);
    for (let i = 0; i < 200; i++) loop.push([200 - i, 200]);
    for (let i = 0; i < 200; i++) loop.push([0, 200 - i]);
    expect(angularLoop(loop, 3).length).toBeLessThanOrEqual(8);
  });
  it('reduce un polígono sin perder sus esquinas grandes', () => {
    const poly: Pt[] = [[0, 0], [50, -1], [100, 0], [100, 100], [50, 101], [0, 100]];
    const out = fewSides(poly, 4);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual([0, 0]);
    expect(out).toContainEqual([100, 100]);
  });
});

describe('gesto', () => {
  it('Catmull-Rom pasa por los puntos', () => {
    const pts: Pt[] = [[0, 0], [1, 1], [2, 0], [3, 1]];
    const curve = catmullRom(pts, 8);
    expect(curve[0]).toEqual([0, 0]);
    expect(curve.at(-1)).toEqual([3, 1]);
    expect(curve[8][0]).toBeCloseTo(1);
    expect(curve[8][1]).toBeCloseTo(1);
  });
  it('distingue recta, C y S', () => {
    const line: Pt[] = Array.from({ length: 30 }, (_, i) => [0.5, i / 29]);
    const c: Pt[] = Array.from({ length: 30 }, (_, i) => [0.5 + 0.2 * Math.sin((Math.PI * i) / 29), i / 29]);
    const s: Pt[] = Array.from({ length: 30 }, (_, i) => [0.5 + 0.2 * Math.sin((2 * Math.PI * i) / 29), i / 29]);
    expect(readGesture(line, 1).shape).toBe('recta');
    expect(readGesture(c, 1).shape).toBe('C');
    expect(readGesture(s, 1).shape).toBe('S');
  });
  it('mide la inclinación hacia la derecha', () => {
    const lean: Pt[] = Array.from({ length: 10 }, (_, i) => [0.6 - i * 0.02, i / 9]);
    expect(readGesture(lean, 1).lean).toBeGreaterThan(5);
  });
  it('la línea de pose sigue la pierna que continúa el torso', () => {
    const pts = Array.from({ length: 133 }, (): Pt => [0.5, 0.5]);
    const vis = new Array(133).fill(1);
    pts[3] = [0.48, 0.1]; pts[4] = [0.52, 0.1];
    pts[5] = [0.45, 0.2]; pts[6] = [0.55, 0.2];
    pts[11] = [0.46, 0.5]; pts[12] = [0.54, 0.5];
    pts[13] = [0.3, 0.45]; pts[15] = [0.15, 0.4];
    pts[14] = [0.55, 0.7]; pts[16] = [0.55, 0.92];
    const line = poseLine(pts, vis)!;
    expect(line.at(-1)).toEqual([0.55, 0.92]);
    expect(line).toHaveLength(6);
  });
  it('una pierna muy doblada no le pone gancho a la línea', () => {
    const pts = Array.from({ length: 133 }, (): Pt => [0.5, 0.5]);
    const vis = new Array(133).fill(1);
    pts[3] = [0.48, 0.1]; pts[4] = [0.52, 0.1];
    pts[5] = [0.45, 0.2]; pts[6] = [0.55, 0.2];
    pts[11] = [0.46, 0.5]; pts[12] = [0.54, 0.5];
    pts[13] = [0.3, 0.75]; pts[15] = [0.55, 0.8];
    pts[14] = [0.3, 0.75]; pts[16] = [0.55, 0.8];
    expect(poseLine(pts, vis)!.at(-1)).toEqual([0.3, 0.75]);
  });
  it('sin torso visible no inventa línea', () => {
    const pts = Array.from({ length: 133 }, (): Pt => [0.5, 0.5]);
    expect(poseLine(pts, new Array(133).fill(0.1))).toBeNull();
  });
  it('el esqueleto de una forma con patas encuentra sus ramas', () => {
    const w = 160;
    const h = 120;
    const dog = new Uint8Array(w * h);
    for (let y = 30; y < 54; y++) for (let x = 20; x < 140; x++) dog[y * w + x] = 1;
    for (const x0 of [30, 60, 100, 126]) for (let y = 54; y < 110; y++) for (let x = x0; x < x0 + 8; x++) dog[y * w + x] = 1;
    const sk = maskSkeleton(dog, w, h, [0.14, 0.34])!;
    expect(sk.paths.length).toBeGreaterThanOrEqual(4);
  });
  it('el recorrido sigue una figura doblada de punta a punta', () => {
    const w = 120;
    const h = 120;
    const ele = new Uint8Array(w * h);
    for (let y = 10; y < 100; y++) for (let x = 20; x < 32; x++) ele[y * w + x] = 1;
    for (let y = 88; y < 100; y++) for (let x = 20; x < 110; x++) ele[y * w + x] = 1;
    const spine = maskSpine(ele, w, h)!;
    expect(spine.line[0][1]).toBeLessThan(0.15);
    expect(spine.line.at(-1)![0]).toBeGreaterThan(0.85);
    expect(readGesture(spine.line, 1).shape).toBe('C');
  });
  it('el recorrido nace en la cabeza indicada', () => {
    const w = 120;
    const h = 80;
    const body = new Uint8Array(w * h);
    for (let y = 30; y < 44; y++) for (let x = 10; x < 110; x++) body[y * w + x] = 1;
    const spine = maskSpine(body, w, h, [0.95, 0.45])!;
    const xs = [spine.line[0][0], spine.line.at(-1)![0]].sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(0.15);
    expect(xs[1]).toBeGreaterThan(0.85);
  });
  it('una forma alargada tiene eje; un disco no', () => {
    const w = 100;
    const h = 100;
    const bar = new Uint8Array(w * h);
    for (let y = 10; y < 90; y++) for (let x = 45; x < 55; x++) bar[y * w + x] = 1;
    expect(maskSpine(bar, w, h)!.elongation).toBeGreaterThan(4);
    const disc = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 50) ** 2 + (y - 50) ** 2 < 900) disc[y * w + x] = 1;
    expect(maskSpine(disc, w, h)!.elongation).toBeLessThan(1.1);
  });
  it('la pincelada es una forma cerrada', () => {
    expect(brushPath([[0, 0], [10, 0], [20, 5]], 4).endsWith('Z')).toBe(true);
  });
});

describe('atención visual', () => {
  it('encuentra un objeto sobre fondo liso', () => {
    const w = 128;
    const h = 128;
    const L = new Uint8Array(w * h).fill(120);
    for (let y = 30; y < 44; y++) for (let x = 90; x < 104; x++) L[y * w + x] = 250;
    const map = spectralSaliency(L, w, h, 64);
    const [peak] = saliencyPeaks(map, 64, 1);
    expect(Math.abs(peak.x - 97 / 128)).toBeLessThan(0.1);
    expect(Math.abs(peak.y - 37 / 128)).toBeLessThan(0.1);
  });
});

describe('simplificar', () => {
  it('Kuwahara aplana el ruido y conserva el borde', () => {
    const w = 40;
    const h = 40;
    const rgba = rgbaOf(w, h, (x, y) => (x < 20 ? 40 : 200) + ((x * 7 + y * 13) % 11) - 5);
    const out = kuwahara(rgba, w, h, 3);
    const at = (x: number, y: number) => out[(y * w + x) * 4];
    expect(Math.abs(at(5, 20) - 40)).toBeLessThan(4);
    expect(Math.abs(at(35, 20) - 200)).toBeLessThan(4);
    expect(at(21, 20) - at(18, 20)).toBeGreaterThan(120);
  });
  it('deja exactamente los colores pedidos', () => {
    const w = 64;
    const h = 64;
    const rgba = rgbaOf(w, h, (x) => (x * 4) % 256);
    const res = simplifyImage(rgba, w, h, { radius: 0, colors: 3, mode: 'valor', clean: 0 });
    const seen = new Set<number>();
    for (let i = 0; i < res.rgba.length; i += 4) seen.add(res.rgba[i]);
    expect(seen.size).toBe(3);
    expect(res.swatches).toHaveLength(3);
    expect(res.swatches.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
  });
});

describe('lectura de cuadro', () => {
  const w = 60;
  const h = 60;
  it('un cuadro plano se dice plano', () => {
    const rgba = rgbaOf(w, h, () => 128);
    const L = lightness(rgba);
    const r = readCell(rgba, L, w, h, { x: 0, y: 0, w: 60, h: 60 }, [60, 120, 190]);
    expect(r.edge).toBe('nada');
    expect(r.note).toMatch(/plano/);
  });
  it('detecta un borde vertical duro y dónde está lo oscuro', () => {
    const rgba = rgbaOf(w, h, (x) => (x < 30 ? 15 : 240));
    const L = lightness(rgba);
    const r = readCell(rgba, L, w, h, { x: 0, y: 0, w: 60, h: 60 }, [60, 120, 190]);
    expect(r.edge).toBe('duro');
    expect(r.direction).toBe('vertical');
    expect(r.darkest).toMatch(/izquierda/);
    expect(r.brightest).toMatch(/derecha/);
  });
  it('detecta un borde horizontal', () => {
    const rgba = rgbaOf(w, h, (_, y) => (y < 30 ? 15 : 240));
    const r = readCell(rgba, lightness(rgba), w, h, { x: 0, y: 0, w: 60, h: 60 }, [60, 120, 190]);
    expect(r.direction).toBe('horizontal');
  });
  it('detecta las diagonales con el signo correcto', () => {
    const baja = rgbaOf(w, h, (x, y) => (x > y ? 240 : 15));
    expect(readCell(baja, lightness(baja), w, h, { x: 0, y: 0, w: 60, h: 60 }, [60, 120, 190]).direction).toBe('diagonal-baja');
    const sube = rgbaOf(w, h, (x, y) => (x + y > 60 ? 240 : 15));
    expect(readCell(sube, lightness(sube), w, h, { x: 0, y: 0, w: 60, h: 60 }, [60, 120, 190]).direction).toBe('diagonal-sube');
  });
  it('en un rostro compara piel, no las mitades', () => {
    // Mejilla izquierda y frente claras; pelo oscuro en la parte de arriba de la imagen.
    const rgba = rgbaOf(w, h, (x, y) => (y < 8 ? 10 : x < 30 ? 215 : 150) - (y > 40 ? 45 : 0));
    const L = lightness(rgba);
    const patches = { left: [15, 28] as [number, number], right: [45, 28] as [number, number], top: [30, 14] as [number, number], bottom: [30, 50] as [number, number], radius: 3 };
    expect(faceLight(L, w, h, patches).label).toBe('Luz desde arriba a la izquierda');
  });
  it('sabe de qué lado viene la luz', () => {
    const rgba = rgbaOf(w, h, (x) => (x < 30 ? 230 : 40));
    expect(lightDirection(lightness(rgba), w, h, { x: 0, y: 0, w: 60, h: 60 }).label).toMatch(/izquierda/);
    const fromAbove = rgbaOf(w, h, (_, y) => (y < 30 ? 230 : 40));
    expect(lightDirection(lightness(fromAbove), w, h, { x: 0, y: 0, w: 60, h: 60 }).label).toBe('Luz desde arriba');
    const fromBelow = rgbaOf(w, h, (_, y) => (y < 30 ? 40 : 230));
    expect(lightDirection(lightness(fromBelow), w, h, { x: 0, y: 0, w: 60, h: 60 }).label).toBe('Luz desde abajo');
    const flat = rgbaOf(w, h, () => 120);
    expect(lightDirection(lightness(flat), w, h, { x: 0, y: 0, w: 60, h: 60 }).label).toMatch(/pareja/);
  });
});

describe('clave de valor', () => {
  const histOf = (parts: [number, number][]) => {
    const h = new Array(256).fill(0);
    for (const [v, c] of parts) h[v] = c;
    return h;
  };
  it('una imagen de luces dice clave alta aunque no haya blancos puros', () => {
    const hist = histOf([[40, 100], [150, 150], [200, 650], [230, 100]]);
    const r = valueReading(hist, multiOtsu(hist));
    expect(r.key).toBe('alta');
    expect(r.text).toMatch(/Clave alta/);
  });
  it('una imagen de grises medios no es de sombras aunque Otsu la parta', () => {
    const hist = histOf([[20, 80], [100, 690], [130, 120], [200, 110]]);
    const t = multiOtsu(hist);
    const r = valueReading(hist, t);
    expect(r.key).toBe('media');
    // el grupo más grande tiene nombre de oscuro: debe aclarar que son valores medios
    const shares = zoneShares(hist, t);
    if (shares[0] + shares[1] > shares[3] + shares[2]) expect(r.zoneNote).toMatch(/medios/);
  });
  it('una imagen oscura sin luces lo dice', () => {
    const hist = histOf([[10, 500], [50, 400], [120, 100]]);
    const r = valueReading(hist, multiOtsu(hist));
    expect(r.key).toBe('baja');
    expect(r.text).toMatch(/casi sin luces/);
  });
  it('la clave concuerda con la mayoría de los píxeles', () => {
    for (const mix of [[0.1, 0.2, 0.7], [0.7, 0.2, 0.1], [0.1, 0.8, 0.1]]) {
      const hist = histOf([[40, mix[0] * 1000], [128, mix[1] * 1000], [215, mix[2] * 1000]]);
      const r = valueReading(hist, multiOtsu(hist));
      expect(r.key).toBe(mix[2] > 0.5 ? 'alta' : mix[0] > 0.5 ? 'baja' : 'media');
    }
  });
});

describe('armonía de una imagen casi gris', () => {
  const spectrum = (peaks: number[]) => {
    const h = new Array(72).fill(0);
    for (const d of peaks) h[Math.floor(d / 5)] = 1;
    return h;
  };
  it('no inventa armonía sin color: dice que es casi acromática', () => {
    const r = readHarmony(spectrum([270]), 0.01);
    expect(r.kind).toBe('Casi acromática');
    expect(r.accent).toBeNull();
    expect(r.note).not.toMatch(/gira alrededor|toque/);
  });
  it('rojo y azul con peso real no son monocromática', () => {
    const r = readHarmony(spectrum([35, 255]), 0.9);
    expect(r.kind).not.toBe('Monocromática');
    expect(r.kind).toMatch(/Complementaria|Dos tonos/);
  });
  it('un solo tono sí es monocromático y no sugiere un acento que ya existe', () => {
    const r = readHarmony(spectrum([100]), 0.8);
    expect(r.kind).toBe('Monocromática');
  });
  it('la temperatura de una imagen gris no se contradice', () => {
    const n = 300;
    const rgba = new Uint8ClampedArray(n * 4);
    const L = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = i % 2 ? 220 : 40;
      rgba.set([v, v, v, 255], i * 4);
      L[i] = v;
    }
    const w = warmthOfValues(rgba, L);
    expect(w.lightWord).toBe('neutras');
    expect(w.shadowWord).toBe('neutras');
    expect(w.text).not.toMatch(/más (frías|cálidas)/);
  });
  it('luces cálidas y sombras neutras no dice "más frías"', () => {
    const n = 300;
    const rgba = new Uint8ClampedArray(n * 4);
    const L = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const light = i % 2 === 1;
      rgba.set(light ? [240, 200, 150, 255] : [40, 40, 40, 255], i * 4);
      L[i] = light ? 210 : 40;
    }
    const w = warmthOfValues(rgba, L);
    expect(w.lightWord).toBe('cálidas');
    expect(w.shadowWord).toBe('neutras');
    expect(w.text).not.toMatch(/más frías/);
  });
});

describe('nombres de mezcla', () => {
  const zorn = TUBE_SETS[0].tubes.map((id) => TUBES.find((t) => t.id === id)!);
  it('un gris sin croma nunca se llama cálido', () => {
    for (const v of [30, 90, 140, 178, 216, 250]) {
      const name = nearestPigment([v, v, v]);
      expect(name).not.toMatch(/cálido|Payne|ocre/i);
    }
    expect(nearestPigment([250, 250, 250])).toBe('Blanco de titanio');
    expect(nearestPigment([178, 178, 178])).toMatch(/Gris neutro/);
  });
  it('dos tonos del mismo pigmento se distinguen por su valor real, no por el orden', () => {
    const out = nameSwatches([
      { rgb: [200, 200, 200], hex: '#c8c8c8', share: 0.5, pigment: 'Gris neutro' },
      { rgb: [60, 60, 60], hex: '#3c3c3c', share: 0.5, pigment: 'Gris neutro' },
    ]);
    expect(out[0].pigment).toMatch(/claro/);
    expect(out[1].pigment).toMatch(/oscuro/);
  });
  it('la receta de un gris es negro y blanco, no tierras compensadas', () => {
    const r = findRecipe([140, 140, 140], TUBES)!;
    expect(r.error).toBeLessThan(5);
    expect(r.parts.map((p) => p.name).sort()).toEqual(['Blanco de titanio', 'Negro marfil']);
  });
  it('el nombre de la receta sale del color que resulta y la diferencia se mide', () => {
    const r = findRecipe([30, 200, 30], zorn)!;
    expect(r.resultName).toBe(nearestPigment(r.result));
    expect(r.error).toBeGreaterThan(9);
    expect(r.miss).toBeTruthy();
    const ok = findRecipe([222, 178, 150], zorn)!;
    expect(ok.miss).toBeNull();
  });
  it('una receta clara no se pasa de partes ni se llama oscura', () => {
    const r = findRecipe([252, 252, 252], TUBES)!;
    expect(r.parts.reduce((a, p) => a + p.amount, 0)).toBeLessThanOrEqual(12);
    const dark = findRecipe([20, 20, 20], TUBES)!;
    expect(dark.parts.some((p) => p.name === 'Blanco de titanio' && p.amount > 3)).toBe(false);
  });
});

describe('simplificar protege los rostros', () => {
  it('conserva unos ojos chicos y la luz más clara sigue siendo la más clara', () => {
    const w = 80;
    const h = 80;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const eye = (Math.abs(x - 34) < 2 || Math.abs(x - 46) < 2) && Math.abs(y - 36) < 2;
        const v = eye ? 25 : x < 20 ? 250 : 170;
        rgba.set([v, v, v - 10, 255], p);
      }
    }
    const face = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
    const plain = simplifyImage(rgba, w, h, { radius: 6, colors: 3, mode: 'valor', clean: 4 });
    const kept = simplifyImage(rgba, w, h, { radius: 6, colors: 3, mode: 'valor', clean: 4, protect: [face] });
    const eyeAt = (img: { rgba: Uint8ClampedArray }) => img.rgba[(36 * w + 34) * 4];
    expect(eyeAt(kept)).toBeLessThan(80);
    expect(eyeAt(kept)).toBeLessThanOrEqual(eyeAt(plain));
    // el punto más claro de la imagen sigue siendo el más claro de la paleta
    const lightest = Math.max(...kept.swatches.map((s) => s.rgb[0]));
    expect(lightest).toBeGreaterThan(230);
  });
});
