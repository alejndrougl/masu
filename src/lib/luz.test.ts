import { describe, expect, it } from 'vitest';
import { ZONE, fitLights, inflate, lightFrom, lightWords, materials, linearLuma, readLighting, setupName, type V3 } from './light';

const W = 200;
const H = 200;

/** Una esfera de un color, iluminada por las luces que se pidan, sobre fondo gris. */
function sphere(lights: { dir: V3; w: number }[], ambient = 0.12, albedo: [number, number, number] = [220, 150, 120], split = false) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  const R = 70;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = (x - 100) / R;
      const dy = (y - 100) / R;
      const r2 = dx * dx + dy * dy;
      rgba[i * 4 + 3] = 255;
      if (r2 >= 1) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 128;
        continue;
      }
      mask[i] = 1;
      const nz = Math.sqrt(1 - r2);
      let e = ambient;
      for (const l of lights) e += l.w * Math.max(0, dx * l.dir[0] + dy * l.dir[1] + nz * l.dir[2]);
      // Mitad de arriba de otro color, mucho más oscuro: como pelo sobre piel.
      const base = split && y < 80 ? [30, 26, 24] : albedo;
      const v = Math.min(1, e) ** (1 / 2.2);
      rgba[i * 4] = base[0] * v;
      rgba[i * 4 + 1] = base[1] * v;
      rgba[i * 4 + 2] = base[2] * v;
    }
  }
  return { rgba, mask };
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const between = (a: V3, b: V3) => (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI;

describe('luz', () => {
  it('infla una esfera con normales de esfera', () => {
    const { mask } = sphere([]);
    const { normals } = inflate(mask, W, H);
    const at = (x: number, y: number): V3 => [normals[(y * W + x) * 3], normals[(y * W + x) * 3 + 1], normals[(y * W + x) * 3 + 2]];
    expect(at(100, 100)[2]).toBeGreaterThan(0.95);
    expect(at(40, 100)[0]).toBeLessThan(-0.6);
    expect(at(100, 160)[1]).toBeGreaterThan(0.6);
  });

  it('encuentra una luz de arriba a la izquierda', () => {
    const dir = norm([-0.6, -0.6, 0.5]);
    const { rgba, mask } = sphere([{ dir, w: 0.85 }]);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.flat).toBe(false);
    expect(read.lights[0].role).toBe('principal');
    expect(between(read.lights[0].dir, dir)).toBeLessThan(18);
    expect(lightWords(read.lights[0])).toContain('desde arriba a la izquierda');
    expect(read.terminator.length).toBeGreaterThan(0);
    expect(read.shadowShare).toBeGreaterThan(0.1);
    expect(read.shadowShare).toBeLessThan(0.6);
  });

  it('separa dos luces de lados opuestos', () => {
    const a = norm([-0.8, -0.3, 0.5]);
    const b = norm([0.85, 0.2, 0.3]);
    const { rgba, mask } = sphere([
      { dir: a, w: 0.8 },
      { dir: b, w: 0.4 },
    ], 0.05);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.lights.length).toBeGreaterThanOrEqual(2);
    expect(between(read.lights[0].dir, a)).toBeLessThan(22);
    expect(Math.min(...read.lights.slice(1).map((l) => between(l.dir, b)))).toBeLessThan(30);
  });

  it('un color plano no tiene luz que leer', () => {
    const { rgba, mask } = sphere([], 0.6);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.flat).toBe(true);
    expect(read.lights.length).toBe(0);
    expect(read.terminator.length).toBe(0);
  });

  it('el pelo oscuro arriba no se lee como luz desde abajo', () => {
    const dir = norm([-0.7, -0.5, 0.5]);
    const { rgba, mask } = sphere([{ dir, w: 0.85 }], 0.12, [220, 150, 120], true);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.lights[0].dir[1]).toBeLessThan(0);
    expect(between(read.lights[0].dir, dir)).toBeLessThan(30);
  });

  it('una sombra es el mismo material; otro color no', () => {
    const { rgba, mask } = sphere([{ dir: norm([-0.7, -0.5, 0.5]), w: 0.85 }], 0.12, [220, 150, 120], true);
    const Y = linearLuma(rgba, W * H);
    const m = materials(rgba, Y, mask, W, H);
    // El "pelo" y la "piel" quedan en materiales distintos.
    expect(m.group[60 * W + 100]).not.toBe(m.group[130 * W + 70]);
    // La piel en luz y la piel en sombra, en el mismo.
    expect(m.group[110 * W + 60]).toBe(m.group[150 * W + 140]);
  });

  it('el ajuste recupera la dirección con normales exactas', () => {
    const N: number[] = [];
    const S: number[] = [];
    const dir = norm([0.3, -0.8, 0.5]);
    for (let i = 0; i < 4000; i++) {
      const z = Math.random();
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const n: V3 = [Math.cos(t) * r, Math.sin(t) * r, z];
      N.push(...n);
      S.push(0.1 + 0.8 * Math.max(0, n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]));
    }
    const fit = fitLights(Float32Array.from(N), Float32Array.from(S));
    expect(fit.lights.length).toBe(1);
    expect(between(fit.lights[0].dir, dir)).toBeLessThan(4);
    expect(fit.r2).toBeGreaterThan(0.97);
  });

  it('un casquete negro encima no cambia de dónde viene la luz ni se marca como sombra', () => {
    const dir = norm([-0.7, -0.2, 0.6]);
    const { rgba, mask } = sphere([{ dir, w: 0.85 }], 0.12, [220, 150, 120], true);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.flat).toBe(false);
    expect(between(read.lights[0].dir, dir)).toBeLessThan(25);
    expect(read.lights[0].dir[0]).toBeLessThan(-0.3);
    // El casquete (arriba de y = 80) es un material oscuro aparte, sin sombra ni terminador.
    expect(read.zones[50 * W + 100]).toBe(ZONE.oscuro);
    expect(read.darkShare).toBeGreaterThan(0.1);
    for (const t of read.terminator) for (const [, y] of t) expect(y * H).toBeGreaterThan(78);
  });

  it('un brillo claro sobre lo negro no cambia la luz principal', () => {
    const dir = norm([-0.7, -0.2, 0.6]);
    const { rgba, mask } = sphere([{ dir, w: 0.85 }], 0.12, [220, 150, 120], true);
    // Un brillo claro pequeño sobre el negro.
    for (let y = 56; y < 62; y++) for (let x = 90; x < 100; x++) (rgba[(y * W + x) * 4] = 250), (rgba[(y * W + x) * 4 + 1] = 250), (rgba[(y * W + x) * 4 + 2] = 250);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect([ZONE.brillo, ZONE.luz, ZONE.oscuro]).toContain(read.zones[58 * W + 95]);
    expect(read.zones[50 * W + 100]).toBe(ZONE.oscuro);
    expect(read.lights[0].dir[0]).toBeLessThan(-0.3);
  });

  it('una sombra de borde suave que sigue el volumen no es arrojada', () => {
    const dir = norm([-0.6, -0.6, 0.5]);
    const { rgba, mask } = sphere([{ dir, w: 0.85 }]);
    const read = readLighting({ rgba, w: W, h: H, mask });
    expect(read.cast.length).toBe(0);
    for (let i = 0; i < read.zones.length; i++) expect(read.zones[i]).not.toBe(ZONE.arrojada);
  });

  it('los textos no nombran esquemas de retrato', () => {
    for (const d of [norm([-0.8, -0.5, 0.3]), norm([0.6, -0.5, 0.6]), norm([0, -0.5, 0.85])]) expect(setupName({ dir: d })).not.toMatch(/Rembrandt|Mariposa|Partida/);
  });

  it('una luz a mano apunta a donde se le pide', () => {
    const l = lightFrom(135, 30);
    expect(l.dir[0]).toBeLessThan(0);
    expect(l.dir[1]).toBeLessThan(0);
    expect(l.dir[2]).toBeGreaterThan(0);
    expect(ZONE.propia).toBe(3);
  });
});
