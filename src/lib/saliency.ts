function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean) {
  const rowR = new Float64Array(n);
  const rowI = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rowR.set(re.subarray(y * n, y * n + n));
    rowI.set(im.subarray(y * n, y * n + n));
    fft(rowR, rowI, inverse);
    re.set(rowR, y * n);
    im.set(rowI, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowR[y] = re[y * n + x];
      rowI[y] = im[y * n + x];
    }
    fft(rowR, rowI, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowR[y];
      im[y * n + x] = rowI[y];
    }
  }
}

function boxBlur(src: Float64Array, n: number, r: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
          sum += src[yy * n + xx];
          count++;
        }
      }
      out[y * n + x] = sum / count;
    }
  }
  return out;
}

/**
 * Atención visual por residuo espectral (Hou & Zhang, 2007): lo que se sale
 * del espectro "normal" de la imagen es lo que el ojo busca primero.
 */
export function spectralSaliency(L: Uint8Array, w: number, h: number, n = 64): Float32Array {
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const y0 = Math.floor((y * h) / n);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / n));
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor((x * w) / n);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / n));
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          sum += L[yy * w + xx];
          count++;
        }
      }
      re[y * n + x] = sum / (count || 1) / 255;
    }
  }
  fft2(re, im, n, false);
  const mag = new Float64Array(n * n);
  const phase = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    mag[i] = Math.log(Math.hypot(re[i], im[i]) + 1e-9);
    phase[i] = Math.atan2(im[i], re[i]);
  }
  const avg = boxBlur(mag, n, 1);
  for (let i = 0; i < n * n; i++) {
    const res = Math.exp(mag[i] - avg[i]);
    re[i] = res * Math.cos(phase[i]);
    im[i] = res * Math.sin(phase[i]);
  }
  fft2(re, im, n, true);
  const sq = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) sq[i] = re[i] * re[i] + im[i] * im[i];
  const smooth = boxBlur(boxBlur(sq, n, 2), n, 2);
  let peak = 0;
  for (let i = 0; i < n * n; i++) if (smooth[i] > peak) peak = smooth[i];
  const out = new Float32Array(n * n);
  if (peak > 0) for (let i = 0; i < n * n; i++) out[i] = smooth[i] / peak;
  return out;
}

/** Máximos locales del mapa de atención, normalizados al encuadre. */
export function saliencyPeaks(map: Float32Array, n: number, count = 3): { x: number; y: number; weight: number }[] {
  const work = Float32Array.from(map);
  const out: { x: number; y: number; weight: number }[] = [];
  for (let c = 0; c < count; c++) {
    let bi = 0;
    for (let i = 0; i < n * n; i++) if (work[i] > work[bi]) bi = i;
    const v = work[bi];
    if (v < 0.25) break;
    const bx = bi % n;
    const by = Math.floor(bi / n);
    out.push({ x: (bx + 0.5) / n, y: (by + 0.5) / n, weight: v });
    const r = Math.ceil(n / 6);
    for (let y = Math.max(0, by - r); y <= Math.min(n - 1, by + r); y++) {
      for (let x = Math.max(0, bx - r); x <= Math.min(n - 1, bx + r); x++) work[y * n + x] = 0;
    }
  }
  return out;
}

export interface FocusPeak {
  x: number;
  y: number;
  /** 0 a 1: qué tanto atrae frente al resto de la imagen. */
  strength: number;
  /** Qué lo hace destacar: el salto de valor, el borde nítido o el color. */
  because: 'contraste' | 'borde' | 'color';
  /** Es más claro (true) o más oscuro que lo que lo rodea. */
  lighter: boolean;
}

/**
 * Lo que más atrae al ojo de un pintor: el mayor salto de valor contra su entorno, el borde más
 * nítido y el color más saturado. Cada señal se mide por celda y se normaliza con su propio máximo,
 * para que ninguna domine por su escala. Devuelve los mejores puntos, de más a menos fuertes.
 */
export function focusPeaks(rgba: Uint8ClampedArray, L: Uint8Array, w: number, h: number, count = 3): FocusPeak[] {
  const gx = 40;
  const gy = Math.max(10, Math.round((gx * h) / w));
  const n = gx * gy;
  const mean = new Float32Array(n);
  const chroma = new Float32Array(n);
  const edge = new Float32Array(n);
  const seen = new Float32Array(n);
  const step = Math.max(1, Math.floor(Math.min(w / gx, h / gy) / 4));
  for (let y = 1; y < h - 1; y += step) {
    const cy = Math.min(gy - 1, Math.floor((y * gy) / h));
    for (let x = 1; x < w - 1; x += step) {
      const c = Math.min(gx - 1, Math.floor((x * gx) / w)) + cy * gx;
      const i = y * w + x;
      const g = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]) / 255;
      const p = i * 4;
      const hi = Math.max(rgba[p], rgba[p + 1], rgba[p + 2]);
      const lo = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]);
      mean[c] += L[i];
      chroma[c] += hi ? (hi - lo) / hi : 0;
      if (g > edge[c]) edge[c] = g;
      seen[c]++;
    }
  }
  for (let c = 0; c < n; c++) {
    if (seen[c]) {
      mean[c] /= seen[c];
      chroma[c] /= seen[c];
    }
  }
  // El salto de valor se mide contra el entorno cercano, contra uno más amplio y contra el tono
  // que domina toda la imagen: así una masa grande y clara (una sábana en la noche) también cuenta.
  const sorted = Float32Array.from(mean).sort();
  const median = sorted[Math.floor(n / 2)];
  const contrast = new Float32Array(n);
  const vivid = new Float32Array(n);
  const lighter = new Uint8Array(n);
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      const c = y * gx + x;
      let bestD = 0;
      for (const R of [4, 9]) {
        let sm = 0;
        let k = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
            sm += mean[yy * gx + xx];
            k++;
          }
        }
        const d = mean[c] - sm / (k || 1);
        if (Math.abs(d) > Math.abs(bestD)) bestD = d;
      }
      const g = mean[c] - median;
      if (Math.abs(g) * 0.8 > Math.abs(bestD)) bestD = g;
      contrast[c] = Math.abs(bestD) / 255;
      lighter[c] = bestD > 0 ? 1 : 0;
      let sc = 0;
      let k = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
          sc += chroma[yy * gx + xx];
          k++;
        }
      }
      vivid[c] = Math.max(0, chroma[c] - sc / (k || 1));
    }
  }
  const top = (a: Float32Array) => {
    const s = Float32Array.from(a).sort();
    return Math.max(1e-6, s[Math.floor(n * 0.985)]);
  };
  // Pisos mínimos: en un dibujo en blanco y negro el ruido del color no es una mancha saturada.
  const tc = Math.max(top(contrast), 0.08);
  const te = Math.max(top(edge), 0.12);
  const tv = Math.max(top(vivid), 0.15);
  const score = new Float32Array(n);
  const part = new Float32Array(n * 3);
  for (let c = 0; c < n; c++) {
    const a = Math.min(1, contrast[c] / tc);
    const b = Math.min(1, edge[c] / te);
    const v = Math.min(1, vivid[c] / tv);
    part[c * 3] = 0.5 * a;
    part[c * 3 + 1] = 0.3 * b;
    part[c * 3 + 2] = 0.2 * v;
    score[c] = 0.5 * a + 0.3 * b + 0.2 * v;
  }
  // Una celda suelta no es un foco: se promedia con su entorno inmediato.
  const smooth = new Float32Array(n);
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      let s = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
          s += score[yy * gx + xx];
          k++;
        }
      }
      smooth[y * gx + x] = s / k;
    }
  }
  let peak = 0;
  for (let c = 0; c < n; c++) if (smooth[c] > peak) peak = smooth[c];
  const out: FocusPeak[] = [];
  const work = Float32Array.from(smooth);
  for (let k = 0; k < count && peak > 0; k++) {
    let bi = 0;
    for (let c = 0; c < n; c++) if (work[c] > work[bi]) bi = c;
    if (work[bi] < peak * 0.55) break;
    const bx = bi % gx;
    const by = Math.floor(bi / gx);
    const p = [part[bi * 3], part[bi * 3 + 1], part[bi * 3 + 2]];
    const because = p[0] >= p[1] && p[0] >= p[2] ? 'contraste' : p[1] >= p[2] ? 'borde' : 'color';
    out.push({ x: (bx + 0.5) / gx, y: (by + 0.5) / gy, strength: work[bi] / peak, because, lighter: !!lighter[bi] });
    const r = Math.ceil(gx / 6);
    for (let y = Math.max(0, by - r); y <= Math.min(gy - 1, by + r); y++) {
      for (let x = Math.max(0, bx - r); x <= Math.min(gx - 1, bx + r); x++) work[y * gx + x] = 0;
    }
  }
  return out;
}
