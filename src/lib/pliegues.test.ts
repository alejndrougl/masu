import { describe, expect, it } from 'vitest';
import { readFolds } from './folds';
import type { Pt } from './types';

const W = 240;
const H = 320;

/** Una prenda de un color, con líneas del mismo color más oscuro donde se pidan. */
function cloth(inside: (x: number, y: number) => boolean, lines: [Pt, Pt][]) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      rgba[i * 4 + 3] = 255;
      if (!inside(x, y)) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 235;
        continue;
      }
      mask[i] = 1;
      rgba[i * 4] = 70;
      rgba[i * 4 + 1] = 110;
      rgba[i * 4 + 2] = 190;
    }
  }
  for (const [a, b] of lines) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * s) / steps);
      const y = Math.round(a[1] + ((b[1] - a[1]) * s) / steps);
      for (let dx = -1; dx <= 1; dx++) {
        const i = y * W + x + dx;
        if (!mask[i]) continue;
        rgba[i * 4] = 35;
        rgba[i * 4 + 1] = 55;
        rgba[i * 4 + 2] = 95;
      }
    }
  }
  return { rgba, mask };
}

describe('pliegues', () => {
  it('la tela que cuelga libre da tubos y un borde de abajo', () => {
    // Tronco arriba y falda abajo; el cuerpo solo ocupa el tronco.
    const inside = (x: number, y: number) => (y >= 40 && y < 150 && x >= 80 && x < 160) || (y >= 150 && y < 290 && x >= 50 && x < 190);
    const lines: [Pt, Pt][] = [70, 95, 120, 145, 170].map((x) => [[x, 170], [x, 270]] as [Pt, Pt]);
    const { rgba, mask } = cloth(inside, lines);
    const body = new Uint8Array(W * H);
    for (let y = 40; y < 150; y++) for (let x = 80; x < 160; x++) body[y * W + x] = 1;
    const r = readFolds({ rgba, w: W, h: H, mask, body, joints: { shoulderL: [85, 45], shoulderR: [155, 45], hipL: [95, 148], hipR: [145, 148] } });
    expect(r.loose).toBe(true);
    expect(r.counts.tubo ?? 0).toBeGreaterThanOrEqual(3);
    expect(r.hems.length).toBeGreaterThan(0);
  });

  it('las líneas que salen de un hombro son de tensión y lo señalan', () => {
    const inside = (x: number, y: number) => y >= 30 && y < 290 && x >= 40 && x < 200;
    const shoulder: Pt = [60, 50];
    const lines: [Pt, Pt][] = [[[78, 62], [150, 110]], [[72, 72], [120, 160]], [[82, 58], [170, 80]]];
    const { rgba, mask } = cloth(inside, lines);
    const body = mask.slice();
    const r = readFolds({ rgba, w: W, h: H, mask, body, joints: { shoulderL: shoulder, shoulderR: [180, 50], hipL: [70, 280], hipR: [170, 280] } });
    expect(r.counts.tension ?? 0).toBeGreaterThanOrEqual(2);
    const top = [...r.tension].sort((a, b) => b.count - a.count)[0];
    expect(top.name).toBe('hombro');
    expect(top.count).toBeGreaterThanOrEqual(2);
  });

  it('un cambio de color no es un pliegue', () => {
    const inside = (x: number, y: number) => y >= 30 && y < 290 && x >= 40 && x < 200;
    const { rgba, mask } = cloth(inside, []);
    // Media prenda de otro color: la frontera es otra tela, no un doblez.
    for (let y = 30; y < 290; y++) {
      for (let x = 120; x < 200; x++) {
        const i = y * W + x;
        rgba[i * 4] = 200;
        rgba[i * 4 + 1] = 60;
        rgba[i * 4 + 2] = 50;
      }
    }
    const r = readFolds({ rgba, w: W, h: H, mask, body: mask.slice(), joints: {} });
    expect(r.folds.length).toBe(0);
  });

  it('lo que la figura sostiene no es tela suelta', () => {
    // Un tronco y, pegada por una esquina, una espada larga con una raya a lo largo.
    const inside = (x: number, y: number) => (y >= 60 && y < 280 && x >= 40 && x < 120) || (y >= 100 && y < 112 && x >= 120 && x < 230);
    const { rgba, mask } = cloth(inside, [[[130, 106], [222, 106]]]);
    const body = new Uint8Array(W * H);
    for (let y = 60; y < 280; y++) for (let x = 40; x < 120; x++) body[y * W + x] = 1;
    const r = readFolds({ rgba, w: W, h: H, mask, body, joints: {} });
    expect(r.loose).toBe(false);
    expect(r.folds.length).toBe(0);
    expect(r.hems.length).toBe(0);
  });

  it('una prenda lisa no tiene pliegues', () => {
    const inside = (x: number, y: number) => y >= 30 && y < 290 && x >= 40 && x < 200;
    const { rgba, mask } = cloth(inside, []);
    expect(readFolds({ rgba, w: W, h: H, mask, body: mask.slice(), joints: {} }).folds.length).toBe(0);
  });
});
