/// <reference lib="webworker" />
import { paletteFrom, sampleLab } from '../lib/color';
import { dominantLines } from '../lib/edges';
import { buildEncaje, type EncajeFigure } from '../lib/encaje';
import type { Lens } from '../lib/lens';
import { readPerspective, readScene } from '../lib/perspective';
import { saliencyPeaks, spectralSaliency } from '../lib/saliency';
import { simplifyImage, type SimplifyParams } from '../lib/simplify';
import { toneStats } from '../lib/tones';
import { lightness } from '../lib/color';
import { edgeMap, inkLines, lowPoly, numberRegions, saturationMap, temperatureMap } from '../lib/maps';
import { findRecipe, type Tube } from '../lib/mixing';

import { setLocale, t, type Locale } from '../i18n';
export type MapKind = 'temperatura' | 'saturacion' | 'bordes';
export type StyleKind = 'planos' | 'tinta' | 'numeros';

export type AnalysisRequest =
  | { id: number; type: 'frame'; rgba: Uint8ClampedArray; w: number; h: number; sw: number; sh: number; small: Uint8ClampedArray; principal: [number, number] }
  | { id: number; type: 'simplify'; params: SimplifyParams }
  | { id: number; type: 'encaje'; figures: EncajeFigure[]; depth: Float32Array | null; art: Uint8Array | null }
  | { id: number; type: 'lente'; lens: Lens }
  | { id: number; type: 'escena'; principal: [number, number]; art?: Uint8Array | null; depth?: Float32Array | null }
  | { id: number; type: 'map'; kind: MapKind }
  | { id: number; type: 'planos'; count: number }
  | { id: number; type: 'tinta'; weight: number }
  | { id: number; type: 'numeros'; params: SimplifyParams }
  | { id: number; type: 'recipes'; colors: [number, number, number][]; tubes: Tube[] };

let small: { rgba: Uint8ClampedArray; L: Uint8Array; w: number; h: number } | null = null;

const reply = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

function downscaleL(L: Uint8Array, w: number, h: number, n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor((x * w) / n);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / n));
      const y0 = Math.floor((y * h) / n);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / n));
      let sum = 0;
      let c = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          sum += L[yy * w + xx];
          c++;
        }
      }
      out[y * n + x] = sum / (c || 1);
    }
  }
  return out;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const m = e.data;
  if ((m as { type: string }).type === 'locale') return setLocale((m as unknown as { locale: Locale }).locale);
  try {
    if (m.type === 'frame') {
      const L = lightness(m.rgba);
      const stats = toneStats(m.rgba, L, m.w, m.h);
      const palette = paletteFrom(sampleLab(m.rgba, m.w, 0, 0, m.w, m.h, 16000), 7);
      const smallL = lightness(m.small);
      small = { rgba: m.small, L: smallL, w: m.sw, h: m.sh };
      const n = 64;
      const attention = spectralSaliency(smallL, m.sw, m.sh, n);
      const peaks = saliencyPeaks(attention, n, 3);
      const lines = dominantLines(smallL, m.sw, m.sh, 14);
      // Lo inmediato; el lente tarda más y llega después con su propio mensaje.
      const perspective = readPerspective(smallL, m.sw, m.sh, { principal: m.principal });
      const tiny = downscaleL(smallL, m.sw, m.sh, 48);
      const temperature = temperatureMap(m.small).shares;
      reply({ id: m.id, type: 'frame', L, stats, palette, peaks, lines, perspective, attention, tiny, temperature }, [L.buffer]);
    } else if (m.type === 'simplify') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      const res = simplifyImage(small.rgba, small.w, small.h, m.params);
      reply({ id: m.id, type: 'simplify', rgba: res.rgba, w: small.w, h: small.h, swatches: res.swatches }, [res.rgba.buffer]);
    } else if (m.type === 'encaje') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      const strokes = buildEncaje({ L: small.L, w: small.w, h: small.h, figures: m.figures, depth: m.depth, art: m.art });
      reply({ id: m.id, type: 'encaje', strokes });
    } else if (m.type === 'escena') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      // Con la línea artística, la textura de una piedra deja de esconder sus bordes.
      reply({ id: m.id, type: 'escena', perspective: readScene(m.art ?? small.L, small.w, small.h, m.principal, m.depth) });
    } else if (m.type === 'lente') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      reply({ id: m.id, type: 'lente', perspective: readPerspective(small.L, small.w, small.h, { lens: m.lens }) });
    } else if (m.type === 'map') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      const res = m.kind === 'temperatura' ? temperatureMap(small.rgba) : m.kind === 'saturacion' ? saturationMap(small.rgba) : edgeMap(small.L, small.w, small.h);
      reply({ id: m.id, type: 'map', rgba: res.rgba, w: small.w, h: small.h, shares: res.shares }, [res.rgba.buffer]);
    } else if (m.type === 'planos') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      reply({ id: m.id, type: 'planos', w: small.w, h: small.h, ...lowPoly(small.rgba, small.L, small.w, small.h, m.count) });
    } else if (m.type === 'tinta') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      const ink = inkLines(small.L, small.w, small.h, m.weight);
      reply({ id: m.id, type: 'tinta', ink, w: small.w, h: small.h }, [ink.buffer]);
    } else if (m.type === 'numeros') {
      if (!small) throw new Error(t('analysisWorker.sin_encuadre'));
      const res = simplifyImage(small.rgba, small.w, small.h, m.params);
      const num = numberRegions(res.labels, small.w, small.h, Math.round(small.w * small.h * 0.0006));
      reply({ id: m.id, type: 'numeros', w: small.w, h: small.h, lines: num.lines, labels: num.labels, swatches: res.swatches, flat: res.rgba }, [num.lines.buffer, res.rgba.buffer]);
    } else if (m.type === 'recipes') {
      reply({ id: m.id, type: 'recipes', recipes: m.colors.map((c) => findRecipe(c, m.tubes)) });
    }
  } catch (err) {
    reply({ id: m.id, type: 'error', message: String(err) });
  }
};
