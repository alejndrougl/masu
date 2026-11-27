import { describe, expect, it } from 'vitest';
import { budgetLoop, buildEncaje, SILHOUETTE_SIDES } from './encaje';
import { notanMask } from './notan';
import { polygonArea } from './edges';
import type { Pt } from './types';

describe('paso 9: notan', () => {
  it('una figura con cinco tonos queda en solo dos valores, con la frontera donde cambia de luz a sombra', () => {
    const w = 120;
    const h = 100;
    const L = new Uint8Array(w * h).fill(250);
    const mask = new Uint8Array(w * h);
    // Cinco tonos en bandas verticales: los tres oscuros son sombra y los dos claros, luz.
    const tones = [30, 70, 110, 170, 220];
    for (let y = 10; y < 90; y++) {
      for (let x = 10; x < 110; x++) {
        mask[y * w + x] = 1;
        L[y * w + x] = tones[Math.min(4, Math.floor((x - 10) / 20))];
      }
    }
    const { dark } = notanMask(L, mask, w, h);
    const values = new Set<number>();
    for (let i = 0; i < w * h; i++) if (mask[i]) values.add(dark[i]);
    expect([...values].sort()).toEqual([0, 1]);
    // Fuera de la figura no hay valor: es papel.
    expect(dark[0]).toBe(0);
    // La frontera cae entre la tercera y la cuarta banda (x = 70), no en medio de una mancha.
    const row = 50;
    expect(dark[row * w + 40]).toBe(1);
    expect(dark[row * w + 60]).toBe(1);
    expect(dark[row * w + 80]).toBe(0);
    expect(dark[row * w + 100]).toBe(0);
  });
  it('limpia las motas: una pizca clara dentro de la sombra no abre otra mancha', () => {
    const w = 100;
    const h = 100;
    const L = new Uint8Array(w * h).fill(40);
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = 0; y < h; y++) for (let x = 50; x < w; x++) L[y * w + x] = 220;
    L[30 * w + 20] = 250;
    L[31 * w + 20] = 250;
    const { dark } = notanMask(L, mask, w, h);
    expect(dark[30 * w + 20]).toBe(1);
  });
});

describe('paso 7: encaje en rectas', () => {
  it('un contorno de cientos de puntos se queda en pocas rectas y sigue encerrando la forma', () => {
    const loop: Pt[] = [];
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      const r = 60 + 6 * Math.sin(a * 7) + (i % 3);
      loop.push([100 + Math.cos(a) * r, 100 + Math.sin(a) * r]);
    }
    const out = budgetLoop(loop, 20, 2);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(polygonArea(out) / polygonArea(loop)).toBeGreaterThan(0.85);
  });
  it('el encaje de una figura tiene envolvente de a lo más 8 rectas y una silueta cerrada y corta', () => {
    const w = 160;
    const h = 160;
    const L = new Uint8Array(w * h).fill(200);
    const fig = new Uint8Array(w * h);
    // Una figura irregular: tronco, dos brazos y dos piernas.
    const box = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fig[y * w + x] = 1;
    };
    box(65, 30, 95, 90);
    box(30, 35, 65, 48);
    box(95, 50, 135, 62);
    box(65, 90, 78, 150);
    box(82, 90, 95, 140);
    // El borde se hace rugoso a propósito.
    for (let y = 30; y < 150; y += 3) fig[y * w + 64] = 0;
    const strokes = buildEncaje({ L, w, h, figures: [{ mask: fig, blocks: [] }] });
    expect(strokes.filter((s) => s.stage === 1).length).toBeLessThanOrEqual(8);
    const sil = strokes.filter((s) => s.stage === 3);
    expect(sil.length).toBeGreaterThan(0);
    for (const s of sil) {
      expect(s.closed).toBe(true);
      expect(s.pts.length).toBeLessThanOrEqual(SILHOUETTE_SIDES.main);
    }
  });
});
