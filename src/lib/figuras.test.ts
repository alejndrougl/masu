import { describe, expect, it } from 'vitest';
import type { Piece } from './pieces';
import { fitProfile, fitsFromBlocks, measureProfile, pickedRank, profileFromMask, refineWithMask, SHAPES, shapedPieces, shapeForm, shapePercent, type PartProfile, type ShapeDef, type ShapeKind } from './shapes';

const KINDS = Object.keys(SHAPES) as ShapeKind[];
const N = 17;

const widthAt = (p: [number, number][], t: number) => {
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [a, va] = p[i - 1];
      const [b, vb] = p[i];
      return va + ((vb - va) * (t - a)) / (b - a || 1);
    }
  }
  return p[p.length - 1][1];
};

/** El ancho que tendría una parte hecha exactamente con esa figura. */
const made = (def: ShapeDef, kind: ShapeKind, size = 0.05): PartProfile => ({
  key: 'prueba',
  kind,
  origin: [0.5, 0.2],
  axis: [0, 0.4],
  across: [1, 0],
  left: Array.from({ length: N }, (_, i) => widthAt(def.left, i / (N - 1)) * size),
  right: Array.from({ length: N }, (_, i) => widthAt(def.right, i / (N - 1)) * size),
  z: 0,
  aspect: 1,
});

describe('la biblioteca de figuras', () => {
  it('cada parte del cuerpo tiene al menos 20 figuras', () => {
    for (const kind of KINDS) expect(SHAPES[kind].length, kind).toBeGreaterThanOrEqual(20);
  });

  it('no repite identificadores dentro de una parte', () => {
    for (const kind of KINDS) expect(new Set(SHAPES[kind].map((d) => d.id)).size, kind).toBe(SHAPES[kind].length);
  });

  it('el tórax puede ser rombo, romboide o trapecio, no solo óvalo', () => {
    const ids = SHAPES.torax.map((d) => d.id);
    for (const id of ['ovalo', 'rombo', 'romboide-a', 'romboide-b', 'trapecio-inv', 'hexagono']) expect(ids).toContain(id);
  });

  it('hay extremidades que empiezan grandes y otras que empiezan chicas', () => {
    const first = (d: ShapeDef) => widthAt(d.left, 0.1);
    const last = (d: ShapeDef) => widthAt(d.left, 0.9);
    expect(SHAPES.brazo.some((d) => first(d) > last(d) * 1.4)).toBe(true);
    expect(SHAPES.brazo.some((d) => last(d) > first(d) * 1.4)).toBe(true);
  });
});

describe('elegir la que mejor calza', () => {
  it('una parte hecha con una figura la reconoce entre las mejores', () => {
    for (const kind of KINDS) {
      for (const def of SHAPES[kind]) {
        const fit = fitProfile(made(def, kind));
        expect(fit.ranking.slice(0, 3).map((r) => r.id), `${kind}/${def.id}`).toContain(def.id);
      }
    }
  });

  it('un tórax en rombo no se confunde con un óvalo', () => {
    const def = SHAPES.torax.find((d) => d.id === 'rombo')!;
    const fit = fitProfile(made(def, 'torax'));
    expect(fit.ranking[0].id).toMatch(/rombo/);
    expect(shapePercent(fit.ranking[0])).toBeGreaterThan(90);
  });

  it('la escala sigue el grosor real', () => {
    const def = SHAPES.brazo.find((d) => d.id === 'caja')!;
    const thin = fitProfile(made(def, 'brazo', 0.03));
    const wide = fitProfile(made(def, 'brazo', 0.09));
    expect(pickedRank(wide, { id: 'caja' }).size / pickedRank(thin, { id: 'caja' }).size).toBeCloseTo(3, 1);
  });

  it('lo elegido por el pintor manda sobre lo automático', () => {
    const fit = fitProfile(made(SHAPES.muslo[0], 'muslo'));
    expect(pickedRank(fit, { id: 'rombo' }).id).toBe('rombo');
    expect(pickedRank(fit).id).toBe(fit.ranking[0].id);
  });
});

describe('dibujar la figura', () => {
  const fit = fitProfile(made(SHAPES.brazo.find((d) => d.id === 'caja')!, 'brazo'));
  const wide = (points: [number, number][], y: number) => {
    const near = points.filter((p) => Math.abs(p[1] - y) < 0.05).map((p) => p[0]);
    return Math.max(...near) - Math.min(...near);
  };

  it('el grosor cambia el ancho', () => {
    const a = shapeForm(fit, { id: 'caja' }).outline;
    const b = shapeForm(fit, { id: 'caja', thick: 1.5 }).outline;
    expect(wide(b, 0.4)).toBeCloseTo(wide(a, 0.4) * 1.5, 2);
  });

  it('puede empezar más ancha o más delgada', () => {
    const big = shapeForm(fit, { id: 'caja', taper: 0.4 }).outline;
    expect(wide(big, 0.2)).toBeGreaterThan(wide(big, 0.6));
    const small = shapeForm(fit, { id: 'caja', taper: -0.4 }).outline;
    expect(wide(small, 0.2)).toBeLessThan(wide(small, 0.6));
  });

  it('el ancho se mide a lo largo de los hombros: si se inclinan, la figura se inclina', () => {
    const tilted = fitProfile({ ...made(SHAPES.torax.find((d) => d.id === 'rectangulo')!, 'torax'), across: [Math.cos(0.3), Math.sin(0.3)] });
    const box = shapeForm(tilted).outline;
    const top = box.filter((p) => p[1] < 0.3);
    expect(Math.abs(top[0][1] - top[top.length - 1][1])).toBeGreaterThan(0.01);
  });
});

describe('medir una parte', () => {
  it('lee el ancho de sus puntos', () => {
    const X = new Float32Array(400);
    const Y = new Float32Array(400);
    const Z = new Float32Array(400);
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const k = i * 20 + j;
        const t = i / 19;
        X[k] = 0.5 + (j / 19 - 0.5) * 0.2 * (1 - t * 0.6);
        Y[k] = 0.2 + t * 0.4;
        ids.push(k);
      }
    }
    const p = measureProfile('brazoL', 'brazo', X, Y, Z, ids, [0.5, 0.2], [0.5, 0.6], 1)!;
    expect(p.left[1] + p.right[1]).toBeGreaterThan(p.left[15] + p.right[15]);
    expect(fitProfile(p).ranking[0].error).toBeLessThan(0.2);
  });

  it('un hueso de frente toma el eje de lo que se ve', () => {
    const X = new Float32Array(100);
    const Y = new Float32Array(100);
    const Z = new Float32Array(100);
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) {
      X[i] = 0.3 + (i % 10) * 0.04;
      Y[i] = 0.5 + Math.floor(i / 10) * 0.004;
      ids.push(i);
    }
    const p = measureProfile('muslo', 'muslo', X, Y, Z, ids, [0.45, 0.5], [0.45, 0.502], 1)!;
    expect(Math.abs(p.axis[0])).toBeGreaterThan(Math.abs(p.axis[1]));
  });

  it('también mide sobre una silueta', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 80; y++) for (let x = 40; x < 60; x++) data[y * w + x] = 1;
    const p = profileFromMask('pata', 'pierna', [0.5, 0.2], [0.5, 0.79], 0.12, { data, w, h }, 1, 0)!;
    expect(p.left[8]).toBeCloseTo(0.1, 1);
    expect(p.right[8]).toBeCloseTo(0.1, 1);
  });
});

describe('poner las figuras en el maniquí', () => {
  const piece = (id: string, extra: Partial<Piece> = {}): Piece => ({ id, name: id, step: 1, z: 0, outline: [[0, 0], [1, 0], [1, 1]], caps: [], rings: [], axes: [], ...extra });
  const brazo = { ...fitProfile(made(SHAPES.brazo[0], 'brazo')), key: 'brazoL' };

  it('cambia la pieza de esa parte y deja las demás', () => {
    const out = shapedPieces([piece('L-brazoL'), piece('cabeza')], [brazo]);
    expect(out[0].outline.length).toBeGreaterThan(3);
    expect(out[1].outline.length).toBe(3);
  });

  it('una articulación no se vuelve figura', () => {
    const out = shapedPieces([piece('L-brazoL', { joint: true })], [brazo]);
    expect(out[0].outline.length).toBe(3);
  });

  it('la mano sigue dedo por dedo hasta que el pintor elige una figura', () => {
    const mano = { ...fitProfile(made(SHAPES.mano[0], 'mano')), key: 'manoL' };
    const dedos = [piece('manoL-palma'), piece('manoL-d1')];
    expect(shapedPieces(dedos, [mano]).length).toBe(2);
    expect(shapedPieces(dedos, [mano], { manoL: { id: 'miton' } }).length).toBe(1);
  });

  it('un animal mide sus partes en la silueta', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h);
    for (let y = 20; y < 60; y++) for (let x = 20; x < 80; x++) data[y * w + x] = 1;
    const fits = fitsFromBlocks([{ id: 'torax', a: [0.2, 0.4], b: [0.8, 0.4], ra: 0.2, rb: 0.2 }, { id: 'cola', a: [0, 0], b: [0.1, 0.1], ra: 0.01, rb: 0.01 }], { data, w, h }, 1);
    expect(fits.map((f) => f.kind)).toEqual(['torax']);
  });
});

describe('piezas ajustadas a la silueta', () => {
  const flat = (v: number) => new Array(17).fill(v);
  const base = (): PartProfile => ({ key: 'brazoL', kind: 'brazo', origin: [0.5, 0.2], axis: [0, 0.6], across: [1, 0], left: flat(0.05), right: flat(0.05), z: 0, aspect: 1 });

  it('un brazo más grueso que el de la malla se ensancha hacia la silueta', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x / w - 0.5) < 0.08 && y / h > 0.15 && y / h < 0.85) data[y * w + x] = 1;
    const [p] = refineWithMask([base()], { data, w, h }, 1);
    const mid = p.left[8];
    expect(mid).toBeGreaterThan(0.065);
    expect(mid).toBeLessThan(0.085);
  });

  it('lo que tapa una mesa no se construye: la parte se corta donde deja de verse', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8Array(w * h);
    // Solo se ve la mitad de arriba del brazo.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x / w - 0.5) < 0.05 && y / h > 0.15 && y / h < 0.5) data[y * w + x] = 1;
    const [p] = refineWithMask([base()], { data, w, h }, 1);
    expect(p.origin[1] + p.axis[1]).toBeLessThan(0.6);
    expect(p.axis[1]).toBeGreaterThan(0.2);
  });

  it('una silueta mucho más ancha que la malla (ropa que cuelga) no cambia la pieza', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x / w - 0.5) < 0.3 && y / h > 0.15 && y / h < 0.85) data[y * w + x] = 1;
    const [p] = refineWithMask([base()], { data, w, h }, 1);
    expect(p.left[8]).toBeCloseTo(0.05, 3);
  });
});
