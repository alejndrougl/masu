import { describe, expect, it } from 'vitest';
import { POSE } from './gesture';
import { buildMannequin } from './mannequin';
import { refineMask } from './refine';
import type { Pt } from './types';

/** Figura de frente, de pie, con hombros a la altura `y` y el pecho sin girar. */
function standing(): { pts: Pt[]; vis: number[] } {
  const pts: Pt[] = Array.from({ length: 133 }, () => [0.5, 0.5]);
  const vis = new Array<number>(133).fill(0);
  const put = (i: number, x: number, y: number, v = 0.9) => {
    pts[i] = [x, y];
    vis[i] = v;
  };
  put(POSE.nose, 0.5, 0.1);
  put(POSE.earL, 0.54, 0.1);
  put(POSE.earR, 0.46, 0.1);
  // El izquierdo de la figura queda a la derecha de la imagen: mira a quien la ve.
  put(POSE.shoulderL, 0.6, 0.2);
  put(POSE.shoulderR, 0.4, 0.2);
  put(POSE.elbowL, 0.62, 0.33);
  put(POSE.elbowR, 0.38, 0.33);
  put(POSE.wristL, 0.63, 0.45);
  put(POSE.wristR, 0.37, 0.45);
  put(POSE.hipL, 0.56, 0.48);
  put(POSE.hipR, 0.44, 0.48);
  put(POSE.kneeL, 0.57, 0.7);
  put(POSE.kneeR, 0.43, 0.7);
  put(POSE.ankleL, 0.57, 0.9);
  put(POSE.ankleR, 0.43, 0.9);
  return { pts, vis };
}

describe('maniquí', () => {
  it('reconoce las piezas del cuerpo y las ordena de lo grande a lo chico', () => {
    const m = buildMannequin({ ...standing(), aspect: 1 })!;
    const ids = m.pieces.map((p) => p.id);
    expect(ids).toContain('torax');
    expect(ids).toContain('pelvis');
    expect(ids).toContain('abdomen');
    expect(m.order[0].name).toBe('Cabeza');
    expect(m.order[1].name).toBe('Caja torácica');
    expect(m.order.findIndex((o) => o.name === 'Pelvis')).toBeLessThan(m.order.findIndex((o) => o.name.startsWith('Brazo')));
  });

  it('de frente el pecho no gira', () => {
    const m = buildMannequin({ ...standing(), aspect: 1 })!;
    expect(Math.abs(m.chest)).toBeLessThan(25);
  });

  it('un hombro más cerca gira el pecho hacia el otro lado', () => {
    const { pts, vis } = standing();
    // Hombros juntos en pantalla: el torso está girado.
    pts[POSE.shoulderL] = [0.53, 0.2];
    pts[POSE.shoulderR] = [0.47, 0.2];
    const nearRight = (p: Pt) => (p[0] > 0.5 ? 0.9 : 0.3);
    const nearLeft = (p: Pt) => (p[0] < 0.5 ? 0.9 : 0.3);
    const a = buildMannequin({ pts, vis, aspect: 1, depth: nearRight })!;
    const b = buildMannequin({ pts, vis, aspect: 1, depth: nearLeft })!;
    expect(Math.abs(a.chest)).toBeGreaterThan(40);
    expect(Math.sign(a.chest)).toBe(-Math.sign(b.chest));
  });

  it('un miembro acortado en pantalla se va hacia quien mira', () => {
    const { pts, vis } = standing();
    pts[POSE.elbowL] = [0.61, 0.22];
    pts[POSE.wristL] = [0.61, 0.24];
    const m = buildMannequin({ pts, vis, aspect: 1, depth: (p) => (p[1] > 0.21 && p[1] < 0.26 && p[0] > 0.55 ? 0.95 : 0.4) })!;
    const arm = m.pieces.find((p) => p.id === 'L-brazoL')!;
    const body = m.pieces.find((p) => p.id === 'torax')!;
    expect(arm.z).toBeGreaterThan(body.z);
    expect(arm.caps.length).toBe(1);
  });

  it('lo más cercano se dibuja encima: la cabeza tapa su cuello', () => {
    const m = buildMannequin({ ...standing(), aspect: 1 })!;
    const head = m.pieces.find((p) => p.id === 'cabeza')!;
    const neck = m.pieces.find((p) => p.id === 'cuello');
    if (neck) expect(neck.z).toBeLessThan(head.z);
  });

  it('sin hombros no inventa un cuerpo', () => {
    const { pts, vis } = standing();
    vis[POSE.shoulderL] = 0;
    expect(buildMannequin({ pts, vis, aspect: 1 })).toBeNull();
  });

  it('sin cadera visible queda el busto, sin pelvis', () => {
    const { pts, vis } = standing();
    for (const i of [POSE.hipL, POSE.hipR, POSE.kneeL, POSE.kneeR, POSE.ankleL, POSE.ankleR]) vis[i] = 0;
    const m = buildMannequin({ pts, vis, aspect: 1 })!;
    expect(m.pieces.some((p) => p.id === 'torax')).toBe(true);
    expect(m.pieces.some((p) => p.id === 'pelvis')).toBe(false);
  });

  it('cada parte tiene un bloque para el encaje', () => {
    const m = buildMannequin({ ...standing(), aspect: 1 })!;
    const names = m.blocks.map((b) => b.name);
    expect(names).toContain('Tronco');
    expect(names.filter((n) => n.startsWith('Muslo'))).toHaveLength(2);
    expect(names.filter((n) => n.startsWith('Antebrazo'))).toHaveLength(2);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('recorte', () => {
  const W = 60;
  const H = 60;
  const paint = (fn: (x: number, y: number) => [number, number, number]) => {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = fn(x, y);
        const i = (y * W + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
    return rgba;
  };
  const inFigure = (x: number, y: number) => x >= 20 && x < 40 && y >= 20 && y < 40;

  it('quita el fondo liso que el recorte incluyó por error', () => {
    const rgba = paint((x, y) => (inFigure(x, y) ? [40, 90, 200] : [250, 250, 250]));
    const mask = new Uint8Array(W * H);
    for (let y = 5; y < 40; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 1;
    const out = refineMask(mask, W, H, rgba, null);
    expect(out[10 * W + 30]).toBe(0);
    expect(out[30 * W + 30]).toBe(1);
  });

  it('una sombra sobre el fondo no es parte de la figura', () => {
    const rgba = paint((x, y) => (inFigure(x, y) ? [40, 90, 200] : y > 45 ? [170, 170, 170] : [250, 250, 250]));
    const mask = new Uint8Array(W * H);
    for (let y = 20; y < 55; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 1;
    const out = refineMask(mask, W, H, rgba, null);
    expect(out[50 * W + 30]).toBe(0);
  });

  it('agrega lo que sostiene la figura si salta en profundidad', () => {
    const rgba = paint((x, y) => (inFigure(x, y) || (y === 30 && x >= 40 && x < 55) ? [40, 90, 200] : [250, 250, 250]));
    const mask = new Uint8Array(W * H);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 1;
    const depth = new Float32Array(W * H).fill(0.05);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 55; x++) depth[y * W + x] = 0.7;
    const out = refineMask(mask, W, H, rgba, depth);
    expect(out[30 * W + 50]).toBe(1);
  });

  it('no se desborda por un fondo con textura a la misma profundidad', () => {
    // Pasto: casi todo el borde parece liso, pero su textura no se puede quitar y está cerca.
    const rgba = paint((x, y) => (inFigure(x, y) ? [240, 220, 180] : (x + y) % 3 === 0 ? [40, 140, 60] : [90, 150, 70]));
    const mask = new Uint8Array(W * H);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 1;
    const depth = new Float32Array(W * H).fill(0.6);
    for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) depth[y * W + x] = 0.02;
    const out = refineMask(mask, W, H, rgba, depth);
    let area = 0;
    for (let i = 0; i < out.length; i++) area += out[i];
    expect(area).toBeLessThan(600);
  });
  it('un dibujo a lápiz conserva su recorte', () => {
    const rgba = paint(() => [235, 235, 235]);
    const mask = new Uint8Array(W * H);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) mask[y * W + x] = 1;
    expect(refineMask(mask, W, H, rgba, null)).toBe(mask);
  });
});
