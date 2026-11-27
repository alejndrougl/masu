import type { Pt } from './types';

/** Resuelve la homografía que lleva cuatro puntos de origen a cuatro de destino. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(u, v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const d = A[i][i] || 1e-12;
    for (let c = i; c < n; c++) A[i][c] /= d;
    b[i] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return [...b, 1];
}

export function project(h: number[], [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Endereza la foto de una pintura: sus cuatro esquinas pasan a ser el encuadre. */
export function rectify(rgba: Uint8ClampedArray, sw: number, sh: number, corners: Pt[], w: number, h: number): Uint8ClampedArray {
  const dst: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const H = homography(dst, corners.map(([x, y]): Pt => [x * sw, y * sh]));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = project(H, [x + 0.5, y + 0.5]);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) continue;
      const p = (iy * sw + ix) * 4;
      const q = (y * w + x) * 4;
      out[q] = rgba[p];
      out[q + 1] = rgba[p + 1];
      out[q + 2] = rgba[p + 2];
      out[q + 3] = 255;
    }
  }
  return out;
}
