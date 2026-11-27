import { describe, expect, it } from 'vitest';
import { imageCircle } from './lens';
import { levelHorizon } from './perspective';
import { dropSpecks, keepConnected, overlapOf, reachOf, segmentFits, settleFigure, trimThin } from './refine';
import { buildScene, snapEdges } from './scene';
import { PART, unseenParts } from './surface';
import type { Pt } from './types';

const W = 100;
const H = 100;
const blank = () => new Uint8Array(W * H);
const fill = (m: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  return m;
};
const count = (m: Uint8Array) => m.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('el recorte de una figura', () => {
  it('quita lo delgado pegado a la cabeza y deja lo que sostiene una mano', () => {
    const body = fill(blank(), 30, 30, 70, 90);
    const letra = fill(Uint8Array.from(body), 45, 20, 48, 30);
    const limpia = trimThin(letra, W, H, 3);
    expect(limpia[24 * W + 46]).toBe(0);
    expect(limpia[60 * W + 50]).toBe(1);
    const mano = fill(blank(), 40, 10, 55, 25);
    const sostenida = trimThin(letra, W, H, 3, mano);
    expect(sostenida[24 * W + 46]).toBe(1);
  });

  it('lo largo y delgado se queda aunque no lo toque una mano: es una telaraña, no una letra', () => {
    const body = fill(blank(), 30, 30, 70, 90);
    const hilo = fill(Uint8Array.from(body), 70, 60, 99, 62);
    expect(trimThin(hilo, W, H, 1.5)[61 * W + 90]).toBe(1);
  });

  it('una mota suelta se va y el cuerpo se queda', () => {
    const m = fill(fill(blank(), 20, 20, 80, 80), 90, 5, 92, 7);
    const out = dropSpecks(m, W, H);
    expect(out[6 * W + 91]).toBe(0);
    expect(out[50 * W + 50]).toBe(1);
  });

  it('una pieza grande no se toca aunque sea angosta', () => {
    const body = fill(blank(), 30, 30, 70, 90);
    const brazo = fill(Uint8Array.from(body), 0, 50, 30, 53);
    const out = trimThin(brazo, W, H, 3);
    expect(count(out)).toBeLessThanOrEqual(count(brazo));
    expect(out[60 * W + 50]).toBe(1);
  });

  it('un recorte que cubre el cuerpo sirve aunque la cabeza mida más', () => {
    const mesh = fill(blank(), 40, 30, 60, 90);
    const dibujo = fill(Uint8Array.from(mesh), 25, 5, 75, 40);
    expect(overlapOf(dibujo, mesh)).toBeLessThan(0.5);
    expect(segmentFits(dibujo, mesh)).toBe(true);
  });

  it('un recorte que se quedó con el fondo no sirve', () => {
    const mesh = fill(blank(), 45, 40, 55, 70);
    const fondo = fill(blank(), 0, 0, 100, 100);
    for (let y = 40; y < 70; y++) for (let x = 45; x < 55; x++) fondo[y * W + x] = 0;
    expect(segmentFits(fondo, mesh)).toBe(false);
    expect(segmentFits(fill(blank(), 0, 0, 100, 100), mesh)).toBe(false);
  });

  it('la profundidad saca lo que quedó muy atrás de la figura', () => {
    const depth = new Float32Array(W * H).fill(0.1);
    const body = fill(blank(), 40, 20, 60, 90);
    for (let i = 0; i < body.length; i++) if (body[i]) depth[i] = 0.5;
    const ventana = fill(Uint8Array.from(body), 5, 5, 40, 30);
    const out = settleFigure(ventana, ventana, depth, W, H, undefined, body);
    expect(out[15 * W + 15]).toBe(0);
    expect(out[50 * W + 50]).toBe(1);
  });

  it('crece por lo que está a su distancia, pero no hasta el borde del cuadro', () => {
    const depth = new Float32Array(W * H).fill(0.5);
    const body = fill(blank(), 40, 40, 60, 60);
    const first = fill(fill(Uint8Array.from(body), 60, 45, 72, 55), 0, 70, 100, 100);
    fill(first, 45, 60, 55, 72);
    const out = settleFigure(body, first, depth, W, H);
    expect(out[50 * W + 68]).toBe(1);
    expect(out[95 * W + 50]).toBe(0);
  });

  it('el alcance es mayor desde la mano', () => {
    const zone = reachOf([{ x: 0.5, y: 0.5, size: 1 }, { x: 0.1, y: 0.1, size: 3 }], 0.05, W, H);
    expect(zone[50 * W + 50]).toBe(1);
    expect(zone[50 * W + 58]).toBe(0);
    expect(zone[10 * W + 23]).toBe(1);
  });

  it('una persona no se queda con su fondo si no lo toca', () => {
    const m = fill(fill(blank(), 10, 10, 30, 30), 60, 60, 90, 90);
    const out = keepConnected(m, W, H, [[0.2, 0.2]]);
    expect(out[20 * W + 20]).toBe(1);
    expect(out[75 * W + 75]).toBe(0);
  });
});

describe('lo que la pose no vio', () => {
  const rel = new Array(17).fill(1);
  it('un cuerpo a la vista no pierde nada', () => {
    expect(unseenParts(rel)).toEqual([]);
  });

  it('sin caderas ni rodillas se van las piernas y la pelvis', () => {
    const r = [...rel];
    for (const k of [11, 12, 13, 14, 15, 16]) r[k] = 0.2;
    const out = unseenParts(r);
    for (const p of [PART.musloL, PART.musloR, PART.piernaL, PART.piernaR, PART.pieL, PART.pieR, PART.pelvis]) expect(out).toContain(p);
    expect(out).not.toContain(PART.pecho);
  });

  it('sin muñeca se va el antebrazo, pero no el brazo', () => {
    const r = [...rel];
    r[9] = 0.2;
    const out = unseenParts(r);
    expect(out).toContain(PART.antebrazoL);
    expect(out).toContain(PART.manoL);
    expect(out).not.toContain(PART.brazoL);
  });
});

describe('las masas de una escena', () => {
  const scene = (paint: (x: number, y: number) => [number, number, number]) => {
    const w = 200;
    const h = 150;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = paint(x / w, y / h);
        const i = (y * w + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
    return buildScene(rgba, w, h);
  };

  it('un paisaje de dos colores da dos masas ordenadas por área', () => {
    const s = scene((_, y) => (y < 0.4 ? [120, 170, 230] : [60, 110, 50]));
    expect(s.masses.length).toBeGreaterThanOrEqual(2);
    expect(s.masses[0].area).toBeGreaterThanOrEqual(s.masses[1].area);
    expect(s.line).toBe(false);
  });

  it('un papel con pocas líneas se reconoce como dibujo a línea', () => {
    const s = scene((x, y) => (Math.abs(x - 0.5) < 0.004 || Math.abs(y - 0.5) < 0.005 ? [30, 30, 30] : [250, 250, 250]));
    expect(s.line).toBe(true);
  });

  it('una orilla casi hacia la fuga se endereza hacia ella', () => {
    const vp: Pt = [0.5, 0.5];
    const poly: Pt[] = [[0.1, 0.2], [0.42, 0.44], [0.42, 0.9], [0.1, 0.9]];
    const out = snapEdges(poly, [vp], 1);
    const edge = [out[1][0] - out[0][0], out[1][1] - out[0][1]];
    const to = [vp[0] - out[0][0], vp[1] - out[0][1]];
    const cross = Math.abs(edge[0] * to[1] - edge[1] * to[0]) / (Math.hypot(...edge) * Math.hypot(...to));
    expect(cross).toBeLessThan(0.03);
  });

  it('una orilla que no va a la fuga se queda donde está', () => {
    const poly: Pt[] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.2], [0.1, 0.2]];
    const out = snapEdges(poly, [[0.5, 3]], 1);
    expect(out[0][1]).toBeCloseTo(0.1, 2);
    expect(out[1][1]).toBeCloseTo(0.1, 2);
  });
});

describe('fugas de un dibujo', () => {
  it('un círculo a línea sobre papel limpio se reconoce', () => {
    const w = 300;
    const h = 300;
    const L = new Uint8Array(w * h).fill(245);
    for (let t = 0; t < 4000; t++) {
      const q = (t / 4000) * Math.PI * 2;
      const x = Math.round(150 + Math.cos(q) * 125);
      const y = Math.round(150 + Math.sin(q) * 125);
      L[y * w + x] = 20;
      L[y * w + x + 1] = 20;
    }
    const found = imageCircle(L, w, h);
    expect(found).not.toBeNull();
    expect(found!.r).toBeGreaterThan(0.3);
  });

  it('una foto sin círculo no da uno', () => {
    const w = 300;
    const h = 300;
    const L = new Uint8Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = (i * 7) % 255;
    expect(imageCircle(L, w, h)).toBeNull();
  });

  it('muchos tramos a nivel marcan el horizonte', () => {
    const seg: [Pt, Pt][] = [[[0, 0.4], [0.4, 0.4]], [[0.5, 0.405], [0.95, 0.405]], [[0.2, 0.8], [0.25, 0.7]]];
    expect(levelHorizon(seg, 1)).toBeCloseTo(0.4, 1);
    expect(levelHorizon([[[0, 0.4], [0.2, 0.4]]], 1)).toBeNull();
  });
});
