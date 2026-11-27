import { heldDrawings } from '../lib/honest';
import { buildGrid, canvasFromImage, cellName, frameRect, suggestCell } from '../lib/canvas';
import { lightness } from '../lib/color';
import { fitHead } from '../lib/figure';
import { TUBES, type Recipe } from '../lib/mixing';
import type { Perspective } from '../lib/perspective';
import { cellRect } from '../lib/plan';
import { faceBoxes, type SimplifyParams } from '../lib/simplify';
import type { CanvasSize, Crop, DominantLine, Figure, Pt, Rect, Stroke, Subject, Swatch, ToneStats } from '../lib/types';
import { rectify } from '../lib/warp';
import type { AnalysisRequest } from '../workers/analysis.worker';
import type { VisionRequest } from '../workers/vision.worker';
import { loadProject, saveProject, type SavedProject } from './persist';
import { get, initialState, set, useStore, type Base, type Frame, type Level, type MapKind, type Mode, type State } from './store';
import { grabFromPrior, keepConnected, mergeMatte, outsidePoints, overlapOf, dropSpecks, reachOf, refineMask, segmentFits, settleFigure, trimThin } from '../lib/refine';
import { buildHand } from '../lib/hand';
import { MHR, meshMask, meshPrompts, type Body3D } from '../lib/body';
import { POSE } from '../lib/gesture';
import { PART, partsOfMesh, unseenParts } from '../lib/surface';
import { relativeVis } from '../lib/framing';
import { figureModels, isScene, mainFigures } from '../ui/overlays';

import { getLocale, t as tx } from '../i18n';
const FRAME_LONG = 1600;
const SMALL_LONG = 900;
const VISION_LONG = 1920;

interface Rpc {
  worker: Worker;
  next: number;
  pending: Map<number, { resolve: (v: never) => void; reject: (e: Error) => void; progress?: (s: string) => void }>;
}

function rpc(worker: Worker): Rpc {
  const r: Rpc = { worker, next: 1, pending: new Map() };
  worker.onmessage = (e) => {
    const m = e.data;
    const p = r.pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') {
      p.progress?.(m.step);
      return;
    }
    r.pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message));
    else p.resolve(m as never);
  };
  worker.onerror = (e) => {
    for (const p of r.pending.values()) p.reject(new Error(e.message));
    r.pending.clear();
  };
  return r;
}

function call<T>(r: Rpc, msg: object, transfer: Transferable[] = [], progress?: (s: string) => void): Promise<T> {
  const id = r.next++;
  return new Promise<T>((resolve, reject) => {
    r.pending.set(id, { resolve: resolve as (v: never) => void, reject, progress });
    r.worker.postMessage({ ...msg, id }, transfer);
  });
}

const analysis = rpc(new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' }));
const vision = rpc(new Worker(new URL('../workers/vision.worker.ts', import.meta.url), { type: 'module' }));

// Los workers arman textos (recetas, nombres): hay que decirles en qué idioma.
const sendLocale = () => {
  for (const w of [analysis.worker, vision.worker]) w.postMessage({ type: 'locale', locale: getLocale() });
};
sendLocale();
useStore.subscribe((now, before) => {
  if (now.locale !== before.locale) sendLocale();
});

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
type AnalysisMsg = NoId<AnalysisRequest>;
type VisionMsg = NoId<VisionRequest>;

function scaled(r: Rect, long: number): { w: number; h: number } {
  const k = Math.min(1, long / Math.max(r.w, r.h));
  return { w: Math.max(1, Math.round(r.w * k)), h: Math.max(1, Math.round(r.h * k)) };
}

function rasterize(bitmap: ImageBitmap, r: Rect, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export function currentRect(): Rect | null {
  const { image, canvas, crop } = get();
  if (!image) return null;
  return frameRect(image.w, image.h, canvas.w / canvas.h, crop);
}

let frameJob = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;

/** Reanaliza el encuadre; espera a que la persona deje de moverlo. */
export function refreshFrame(delay = 140) {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(runFrame, delay);
}

interface FrameReply {
  L: Uint8Array;
  stats: ToneStats;
  palette: Swatch[];
  peaks: Frame['peaks'];
  lines: DominantLine[];
  perspective: Perspective;
  attention: Float32Array;
  tiny: Uint8Array;
  temperature: number[];
}

async function runFrame() {
  const { image } = get();
  const rect = currentRect();
  if (!image || !rect) return;
  const job = ++frameJob;
  const { w, h } = scaled(rect, FRAME_LONG);
  const { w: sw, h: sh } = scaled(rect, SMALL_LONG);
  const rgba = rasterize(image.bitmap, rect, w, h);
  const small = rasterize(image.bitmap, rect, sw, sh);
  const send = new Uint8ClampedArray(rgba);
  // El centro óptico es el de la foto completa, aunque el encuadre la recorte.
  const principal: Pt = [(image.w / 2 - rect.x) / rect.w, (image.h / 2 - rect.y) / rect.h];
  const msg: AnalysisMsg = { type: 'frame', rgba: send, w, h, sw, sh, small, principal };
  const res = await call<FrameReply>(analysis, msg, [send.buffer, small.buffer]);
  if (job !== frameJob) return;
  set({
    lensRead: null,
    frame: { w, h, rgba, L: res.L, stats: res.stats, palette: res.palette, peaks: res.peaks, lines: res.lines, perspective: res.perspective, attention: res.attention, tiny: res.tiny, temperature: res.temperature, rect },
    thresholds: res.stats.thresholds,
    simplified: null,
    strokes: [],
    formStrokes: [],
    maps: {},
    ink: null,
    vpEdit: null,
    vpHidden: [],
  });
  refreshDerived();
  if (get().compareSource) void buildCompare();
  // El lente cuesta un segundo: la imagen ya se puede usar mientras se confirma.
  lastPrincipal = principal;
  const scene = await call<{ perspective: Perspective }>(analysis, { type: 'escena', principal, depth: depthInFrame(rect, sw, sh) });
  if (job !== frameJob) return;
  set((s) => (s.frame ? { frame: { ...s.frame, perspective: scene.perspective } } : {}));
  void sceneFromLines(job, principal);
}

let lastPrincipal: Pt = [0.5, 0.5];

/** La profundidad llega después: con ella se descartan las fugas que eran coincidencia. */
async function sceneWithDepth() {
  const { frame } = get();
  if (!frame) return;
  const job = frameJob;
  const { w, h } = scaled(frame.rect, SMALL_LONG);
  const res = await call<{ perspective: Perspective }>(analysis, { type: 'escena', principal: lastPrincipal, depth: depthInFrame(frame.rect, w, h) });
  if (job !== frameJob) return;
  set((s) => (s.frame ? { frame: { ...s.frame, perspective: res.perspective } } : {}));
  void sceneFromLines(job, lastPrincipal);
}

/** Si las rectas no alcanzan, se leen sobre la línea artística: menos textura, más borde. */
async function sceneFromLines(job: number, principal: Pt) {
  const { frame, mode } = get();
  if (!frame || frame.perspective.kind >= 2 || mode !== 'perspectiva') return;
  const { w, h } = scaled(frame.rect, SMALL_LONG);
  const art = await lineFor(frame.rect, w, h);
  if (!art || job !== frameJob) return;
  const res = await call<{ perspective: Perspective }>(analysis, { type: 'escena', principal, art, depth: depthInFrame(frame.rect, w, h) });
  if (job !== frameJob) return;
  if (res.perspective.kind > (get().frame?.perspective.kind ?? 0)) set((s) => (s.frame ? { frame: { ...s.frame, perspective: res.perspective } } : {}));
}

/** Calcula lo que la vista actual necesita. */
export function refreshDerived() {
  const { mode, base, frame, simplified, strokes, mapKind, maps, ink, construction } = get();
  if (!frame) return;
  if ((mode === 'simplificar' || base === 'simple') && !simplified) void runSimplify();
  if (mode === 'encaje' && !strokes.length) void runEncaje();
  if (base === 'mapa' && !maps[mapKind]) void runMap(mapKind);
  if (mode === 'construccion' && construction === 10 && !ink) void runInk();
  // Una escena a línea se construye con esas líneas desde el principio.
  if (mode === 'construccion' && (construction >= 7 || (construction >= 3 && get().figuresReady && isScene(get()))) && !get().formStrokes.length) void runFormLines();
  if (['figuras', 'construccion', 'encaje', 'composicion', 'lectura', 'pintar', 'luz'].includes(mode)) void ensureFigures();
  if (['perspectiva', 'construccion', 'composicion', 'encaje', 'luz'].includes(mode)) void ensureDepth();
}

let simplifyJob = 0;

const PROCESS: Record<1 | 2 | 3 | 4, Pick<SimplifyParams, 'radius' | 'colors'>> = {
  1: { radius: 11, colors: 3 },
  2: { radius: 8, colors: 5 },
  3: { radius: 5, colors: 9 },
  4: { radius: 2, colors: 16 },
};

function canvasFrom(rgba: Uint8ClampedArray, w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c;
}

function publish(simplified: NonNullable<State['simplified']>) {
  set((s) => ({ simplified, simplifiedRun: s.simplifiedRun + 1 }));
}

async function runSimplify() {
  const job = ++simplifyJob;
  const { simplify: base, style, processStep, polyCount, theme, subjects, image: img, frame: fr } = get();
  // Los rostros no se simplifican: ahí viven los ojos y la boca.
  const simplify: SimplifyParams = { ...base, protect: faceBoxes(subjects, img, fr?.rect ?? null) };
  if (style === 'planos') {
    const res = await call<{ w: number; h: number; points: Pt[]; triangles: [number, number, number][]; colors: [number, number, number][] }>(analysis, { type: 'planos', count: polyCount });
    if (job !== simplifyJob) return;
    const c = new OffscreenCanvas(res.w * 2, res.h * 2);
    const ctx = c.getContext('2d')!;
    ctx.scale(2, 2);
    res.triangles.forEach(([a, b, d], i) => {
      const [r, g, bl] = res.colors[i];
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(res.points[a][0], res.points[a][1]);
      ctx.lineTo(res.points[b][0], res.points[b][1]);
      ctx.lineTo(res.points[d][0], res.points[d][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    publish({ canvas: c, swatches: get().frame?.palette ?? [] });
    return;
  }
  if (style === 'tinta') {
    const res = await call<{ ink: Uint8Array; w: number; h: number }>(analysis, { type: 'tinta', weight: Math.max(0.6, simplify.radius / 5) });
    if (job !== simplifyJob) return;
    publish({ canvas: inkCanvas(res.ink, res.w, res.h, theme), swatches: [] });
    return;
  }
  if (style === 'numeros') {
    const res = await call<{ w: number; h: number; lines: Uint8Array; labels: { x: number; y: number; n: number }[]; swatches: Swatch[] }>(analysis, { type: 'numeros', params: simplify });
    if (job !== simplifyJob) return;
    publish({ canvas: linesCanvas(res.lines, res.w, res.h, theme), swatches: res.swatches, numbers: res.labels });
    return;
  }
  const params = style === 'proceso' ? { ...simplify, ...PROCESS[processStep] } : simplify;
  const res = await call<{ rgba: Uint8ClampedArray; w: number; h: number; swatches: Swatch[] }>(analysis, { type: 'simplify', params });
  if (job !== simplifyJob) return;
  const { focusDetail, frame, image } = get();
  const peak = frame?.peaks[0];
  if (focusDetail && style === 'manchas' && frame && image && peak) {
    // Lo que importa conserva su detalle y lo demás se pierde en manchas, como en un cuadro.
    const source = rasterize(image.bitmap, frame.rect, res.w, res.h);
    const reach = 0.26;
    for (let y = 0, p = 0; y < res.h; y++) {
      for (let x = 0; x < res.w; x++, p += 4) {
        const d = Math.hypot(x / res.w - peak.x, y / res.h - peak.y) / reach;
        const k = Math.exp(-d * d);
        res.rgba[p] += (source[p] - res.rgba[p]) * k;
        res.rgba[p + 1] += (source[p + 1] - res.rgba[p + 1]) * k;
        res.rgba[p + 2] += (source[p + 2] - res.rgba[p + 2]) * k;
      }
    }
  }
  publish({ canvas: canvasFrom(res.rgba, res.w, res.h), swatches: res.swatches });
}

const PAPER = { papel: [242, 238, 229], tinta: [10, 10, 10] } as const;
const INK = { papel: [10, 10, 10], tinta: [242, 238, 229] } as const;

function inkCanvas(ink: Uint8Array, w: number, h: number, theme: 'papel' | 'tinta'): OffscreenCanvas {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const [pr, pg, pb] = PAPER[theme];
  const [ir, ig, ib] = INK[theme];
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    const k = ink[i] / 255;
    rgba[p] = pr + (ir - pr) * k;
    rgba[p + 1] = pg + (ig - pg) * k;
    rgba[p + 2] = pb + (ib - pb) * k;
    rgba[p + 3] = 255;
  }
  return canvasFrom(rgba, w, h);
}

function linesCanvas(lines: Uint8Array, w: number, h: number, theme: 'papel' | 'tinta'): OffscreenCanvas {
  const ink = new Uint8Array(lines.length);
  for (let i = 0; i < lines.length; i++) ink[i] = lines[i] ? 200 : 0;
  return inkCanvas(ink, w, h, theme);
}

let simplifyTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSimplify() {
  clearTimeout(simplifyTimer);
  simplifyTimer = setTimeout(() => void runSimplify(), 90);
}

export function setSimplify(patch: Partial<SimplifyParams>) {
  set({ simplify: { ...get().simplify, ...patch } });
  scheduleSimplify();
}

export function setStyle(patch: Partial<Pick<State, 'style' | 'processStep' | 'polyCount' | 'focusDetail'>>) {
  set(patch);
  scheduleSimplify();
}

const mapRuns = new Set<string>();

async function runMap(kind: MapKind) {
  if (mapRuns.has(kind)) return;
  mapRuns.add(kind);
  try {
    const res = await call<{ rgba: Uint8ClampedArray; w: number; h: number; shares: number[] }>(analysis, { type: 'map', kind });
    set((s) => ({ maps: { ...s.maps, [kind]: { canvas: canvasFrom(res.rgba, res.w, res.h), shares: res.shares } } }));
  } finally {
    mapRuns.delete(kind);
  }
}

async function runInk() {
  const res = await call<{ ink: Uint8Array; w: number; h: number }>(analysis, { type: 'tinta', weight: 1 });
  set({ ink: inkCanvas(res.ink, res.w, res.h, get().theme) });
}

// La tinta se guarda ya coloreada: al cambiar de tema hay que volver a pedirla.
useStore.subscribe((now, before) => {
  if (now.theme === before.theme || !now.ink) return;
  set({ ink: null });
  void runInk();
});

let lensJob = 0;

/** Vuelve a leer las fugas con la curvatura elegida; null regresa a lo detectado. */
export async function setLens(k: number | null) {
  const job = ++lensJob;
  if (k === null) {
    set({ lensRead: null, vpEdit: null, vpHidden: [] });
    return;
  }
  const { frame } = get();
  if (!frame) return;
  const c = frame.perspective.curve?.c ?? frame.perspective.lensCenter ?? [0.5, 0.5];
  // El deslizador responde al momento; las fugas exactas llegan cuando termina el cálculo.
  if (k && get().lensRead) set((s) => ({ lensRead: s.lensRead && { ...s.lensRead, curve: { k, c, sure: 1, arcs: 0 } } }));
  const res = await call<{ perspective: Perspective }>(analysis, { type: 'lente', lens: { k, c, sure: 1, arcs: 0 } });
  if (job !== lensJob) return;
  // k = 0 es la orden de leerla recta: el resultado no lleva curva.
  set({ lensRead: k ? { ...res.perspective, curve: { k, c, sure: 1, arcs: 0 } } : { ...res.perspective, curve: undefined }, vpEdit: null, vpHidden: [] });
}

/** Deja listo lo que necesita la tira de construcción. */
export async function stepsReady() {
  await ensureFigures();
  if (!get().ink) await runInk();
}

/** Deja listas las vistas del cuaderno de trabajo. */
export async function prepareWorkbook() {
  const { style } = get();
  if (style !== 'manchas') set({ style: 'manchas', simplified: null });
  if (!get().simplified) await runSimplify();
  if (!get().strokes.length) await runEncaje();
}

export async function recipesFor(colors: [number, number, number][]): Promise<(Recipe | null)[]> {
  const tubes = TUBES.filter((t) => get().tubes.includes(t.id));
  const res = await call<{ recipes: (Recipe | null)[] }>(analysis, { type: 'recipes', colors, tubes });
  return res.recipes;
}

let encajeJob = 0;

async function runEncaje() {
  const job = ++encajeJob;
  const { frame, figures } = get();
  if (!frame) return;
  const { w, h } = scaled(frame.rect, SMALL_LONG);
  const models = figureModels(get()).list;
  const list = figures.map((f) => ({ mask: figureInFrame(f, frame.rect, w, h), blocks: models.find((m) => m.id === f.id)?.blocks ?? [] }));
  const art = figures.length ? await lineFor(frame.rect, w, h) : null;
  if (job !== encajeJob) return;
  const msg: AnalysisMsg = { type: 'encaje', figures: list, depth: depthInFrame(frame.rect, w, h), art };
  const res = await call<{ strokes: Stroke[] }>(analysis, msg);
  if (job !== encajeJob) return;
  set((s) => ({ strokes: res.strokes, encajeRun: s.encajeRun + 1 }));
}

let formJob = 0;

/** El encaje de lo que se está construyendo, sin los personajes del fondo. */
async function runFormLines() {
  const job = ++formJob;
  const state = get();
  const { frame, figures, figuresReady } = state;
  if (!frame || !figuresReady) return;
  const { w, h } = scaled(frame.rect, SMALL_LONG);
  const models = mainFigures(figureModels(state).list, state);
  // En una escena las líneas salen de toda la imagen, no de una figura.
  const list = (isScene(state) ? [] : figures).filter((f) => models.some((m) => m.id === f.id)).map((f) => ({ mask: figureInFrame(f, frame.rect, w, h), blocks: models.find((m) => m.id === f.id)?.blocks ?? [] }));
  const art = await lineFor(frame.rect, w, h);
  if (job !== formJob) return;
  const msg: AnalysisMsg = { type: 'encaje', figures: list, depth: depthInFrame(frame.rect, w, h), art };
  const res = await call<{ strokes: Stroke[] }>(analysis, msg);
  if (job === formJob) set({ formStrokes: res.strokes });
}

let lineCache: { key: string; art: Uint8Array; w: number; h: number } | null = null;

/** Línea artística del encuadre. Tarda unos segundos, así que se guarda. */
async function lineFor(rect: Rect, w: number, h: number): Promise<Uint8Array | null> {
  const { image } = get();
  if (!image) return null;
  const key = `${image.name ?? ''}${rect.x},${rect.y},${rect.w},${rect.h}`;
  if (lineCache?.key !== key) {
    set({ visionStep: tx('engine.trazando_lineas') });
    try {
      const bitmap = await createImageBitmap(image.bitmap, rect.x, rect.y, rect.w, rect.h);
      const msg: VisionMsg = { type: 'line', bitmap };
      const res = await call<{ art: Uint8Array; w: number; h: number }>(vision, msg, [bitmap]);
      lineCache = { key, ...res };
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      set({ visionStep: null });
    }
  }
  const { art, w: aw, h: ah } = lineCache;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ay = Math.min(ah - 1, Math.floor(((y + 0.5) / h) * ah));
    for (let x = 0; x < w; x++) out[y * w + x] = art[ay * aw + Math.min(aw - 1, Math.floor(((x + 0.5) / w) * aw))];
  }
  return out;
}

/** Profundidad del encuadre a la resolución pedida. */
function depthInFrame(rect: Rect, w: number, h: number): Float32Array | null {
  const { depth, image } = get();
  if (!depth || !image) return null;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = Math.floor(((rect.x + ((x + 0.5) / w) * rect.w) / image.w) * depth.w);
      const py = Math.floor(((rect.y + ((y + 0.5) / h) * rect.h) / image.h) * depth.h);
      out[y * w + x] = depth.data[Math.min(depth.h - 1, Math.max(0, py)) * depth.w + Math.min(depth.w - 1, Math.max(0, px))];
    }
  }
  return out;
}

let polishedFor: object | null = null;

/** Con la profundidad lista, cada recorte se corrige una vez. */
function polishFigures() {
  const { image, figures, depth, figuresReady } = get();
  if (!image || !depth || !figuresReady || !figures.length || polishedFor === image) return;
  polishedFor = image;
  const next = figures.map((f) => {
    // La silueta de una mano ya salió de sus puntos: aquí su sombra pasaría por fondo.
    if (get().subjects.find((sub) => sub.id === f.id)?.hand) return f;
    const canvas = new OffscreenCanvas(f.w, f.h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image.bitmap, 0, 0, f.w, f.h);
    const rgba = ctx.getImageData(0, 0, f.w, f.h).data;
    const whole = depthInFrame({ x: 0, y: 0, w: image.w, h: image.h }, f.w, f.h);
    // Con varias figuras no se crece: dos personas que se tocan terminarían siendo una.
    const mask = refineMask(f.mask, f.w, f.h, rgba, figures.length === 1 ? whole : null);
    return { ...f, mask, box: boxOfMask(mask, f.w, f.h) };
  });
  set({ figures: next, strokes: [] });
  if (get().mode === 'encaje') void runEncaje();
  void settleFigures();
}

/** Un animal se guía con sus propias piezas: patas y lomo dicen dónde termina y empieza el suelo. */
async function settleAnimal(f: Figure, image: NonNullable<State['image']>): Promise<Figure> {
  const state = get();
  const model = figureModels(state).list.find((m) => m.id === f.id);
  const rect = state.frame?.rect;
  if (!model?.mannequin || !rect) return f;
  const prior = new Uint8Array(f.w * f.h);
  const toGrid = ([x, y]: Pt): Pt => [((rect.x + x * rect.w) / image.w) * f.w, ((rect.y + y * rect.h) / image.h) * f.h];
  for (const piece of model.mannequin.pieces) {
    const poly = piece.outline.map(toGrid);
    const ys = poly.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(f.h - 1, Math.ceil(Math.max(...ys))); y++) {
      const cuts: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y) cuts.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
      cuts.sort((p, q) => p - q);
      for (let c = 0; c + 1 < cuts.length; c += 2) {
        for (let x = Math.max(0, Math.ceil(cuts[c])); x <= Math.min(f.w - 1, Math.floor(cuts[c + 1])); x++) prior[y * f.w + x] = 1;
      }
    }
  }
  const box = boxOfMask(prior, f.w, f.h);
  const pad = 0.05;
  const on = model.joints.filter(([x, y]) => x >= 0 && y >= 0 && x <= 1 && y <= 1).map(([x, y]) => ({ x: (rect.x + x * rect.w) / image.w, y: (rect.y + y * rect.h) / image.h, on: true }));
  const off = outsidePoints(prior, f.mask, f.w, f.h).map(([x, y]) => ({ x, y, on: false }));
  const msg: VisionMsg = { type: 'segment', box: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: Math.min(1, box.w + pad * 2), h: Math.min(1, box.h + pad * 2) }, points: [...on, ...off], prior };
  const seg = await call<SegmentReply>(vision, msg);
  if (seg.w !== f.w || seg.h !== f.h || overlapOf(seg.mask, prior) < 0.3) return f;
  // Un lomo negro puede quedar fuera del recorte: si estaba en la figura y a su misma distancia,
  // sigue siendo el animal. El suelo llega al borde del cuadro y por eso no entra.
  const whole = depthInFrame({ x: 0, y: 0, w: image.w, h: image.h }, f.w, f.h);
  const mask = whole ? settleFigure(seg.mask, f.mask, whole, f.w, f.h, undefined, seg.mask) : seg.mask;
  return { ...f, mask, box: boxOfMask(mask, f.w, f.h) };
}

/** Lo que una persona puede traer en la mano. Una silla o un coche no se cargan. */
const HOLDABLE = /Paraguas|Bolso|Maleta|Bate|Raqueta|Botella|Copa|Taza|Tenedor|Cuchillo|Cuchara|Libro|Celular|Control|Tijeras|Guante|Pelota|Disco|Papalote/;

/** Un paraguas recortado aparte sigue siendo de quien lo sostiene: se dibuja con su figura. */
function absorbHeld(list: Figure[], holders: { id: string; zone: Uint8Array }[]): Figure[] {
  const out = [...list];
  for (const holder of holders) {
    const at = out.findIndex((f) => f.id === holder.id);
    if (at < 0) continue;
    for (const object of [...out]) {
      const person = out[at];
      if (object === person || !HOLDABLE.test(object.label) || object.w !== person.w || object.h !== person.h) continue;
      let touching = 0;
      let all = 0;
      for (let i = 0; i < object.mask.length; i++) {
        if (!object.mask[i]) continue;
        all++;
        if (holder.zone[i]) touching++;
      }
      if (!all || touching < all * 0.03) continue;
      const mask = Uint8Array.from(person.mask);
      for (let i = 0; i < mask.length; i++) if (object.mask[i]) mask[i] = 1;
      out[at] = { ...person, mask, box: boxOfMask(mask, person.w, person.h) };
      out.splice(out.indexOf(object), 1);
    }
  }
  return out;
}

/**
 * El último paso del recorte: con el cuerpo 3D y la profundidad listos se sabe qué es la figura.
 * Antes de esto una red de recorte puede quedarse con el fondo entero, y nadie lo notaba.
 */
async function settleFigures() {
  if (!get().figures.some((f) => {
    const sub = get().subjects.find((q) => q.id === f.id);
    return sub?.body || sub?.animal || sub?.hand;
  })) return;
  set({ visionStep: tx('engine.ajustando_la_silueta') });
  await ensureFaces();
  const { image, figures, bodyFaces, subjects } = get();
  if (!image || !bodyFaces) {
    set({ visionStep: null });
    return;
  }
  const aspect = image.w / image.h;
  try {
    const next: Figure[] = [];
    const holders: { id: string; zone: Uint8Array }[] = [];
    for (const f of figures) {
      const sub = get().subjects.find((q) => q.id === f.id) ?? subjects.find((q) => q.id === f.id);
      if (sub?.animal) {
        next.push(await settleAnimal(f, image));
        continue;
      }
      if (sub?.hand) {
        // El borde de una mano sale con pelusa de lo que tiene detrás: los dedos son mucho más
        // gruesos que eso, así que una apertura los deja enteros.
        const clean = dropSpecks(trimThin(f.mask, f.w, f.h, Math.max(2, f.box.h * f.h * 0.012)), f.w, f.h, 0.01);
        next.push({ ...f, mask: clean, box: boxOfMask(clean, f.w, f.h) });
        continue;
      }
      if (!sub?.body) {
        next.push(f);
        continue;
      }
      // La estatura se mide con el cuerpo entero; la guía, solo con lo que la pose alcanzó a ver.
      // Si no, un brazo supuesto lleva el recorte hasta la silla de atrás.
      const full = meshMask(sub.body, bodyFaces, f.w, f.h, aspect);
      const seen = sub.pose ? relativeVis(sub.pose) : [];
      const hiddenParts = new Set(sub.pose ? unseenParts(seen) : []);
      const parts = hiddenParts.size ? partsOfMesh(sub.body, bodyFaces) : null;
      const mesh = parts ? meshMask(sub.body, bodyFaces, f.w, f.h, aspect, parts.map((p) => (hiddenParts.has(p) ? 1 : 0))) : full;
      const box = boxOfMask(mesh, f.w, f.h);
      const pad = 0.04;
      const gone = new Set<number>();
      for (const [part, joint] of [
        [PART.brazoL, MHR.elbowL], [PART.brazoR, MHR.elbowR], [PART.antebrazoL, MHR.wristL], [PART.antebrazoR, MHR.wristR],
        [PART.piernaL, MHR.ankleL], [PART.piernaR, MHR.ankleR], [PART.musloL, MHR.kneeL], [PART.musloR, MHR.kneeR],
      ] as const) if (hiddenParts.has(part)) gone.add(joint);
      if (hiddenParts.has(PART.pelvis)) gone.add(MHR.hipL).add(MHR.hipR);
      const on = meshPrompts(sub.body, aspect, gone).filter(([x, y]) => x >= 0 && y >= 0 && x <= 1 && y <= 1);
      const off = outsidePoints(mesh, f.mask, f.w, f.h);
      const msg: VisionMsg = {
        type: 'segment',
        box: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: Math.min(1, box.w + pad * 2), h: Math.min(1, box.h + pad * 2) },
        points: [...on.map(([x, y]) => ({ x, y, on: true })), ...off.map(([x, y]) => ({ x, y, on: false }))],
        prior: mesh,
      };
      const seg = await call<SegmentReply>(vision, msg);
      if (get().image !== image) return;
      if (seg.w !== f.w || seg.h !== f.h) {
        next.push(f);
        continue;
      }
      const body = segmentFits(seg.mask, mesh) ? seg.mask : mesh;
      const whole = depthInFrame({ x: 0, y: 0, w: image.w, h: image.h }, f.w, f.h);
      // Con un alto de cabeza por unidad: el cuerpo mide unas siete.
      const unit = boxOfMask(full, f.w, f.h).h / 6.5;
      // Una mano llega lejos: una espada mide varias cabezas. Una falda cuelga de las piernas.
      // Un codo sin muñeca visible no prueba nada: en un dibujo puede estar detrás de algo.
      const size = (k: number) => (k === 9 || k === 10 ? 5.6 : k >= 11 ? 2.4 : 1.15);
      const counted = (k: number) => seen[k] >= 0.5 && !(k === 7 && seen[9] < 0.5) && !(k === 8 && seen[10] < 0.5);
      const reach = sub.pose ? reachOf(sub.pose.pts.slice(0, 17).flatMap(([x, y], k) => (counted(k) ? [{ x, y, size: size(k) }] : [])), unit, f.w, f.h) : undefined;
      const grown = whole ? settleFigure(body, f.mask, whole, f.w, f.h, reach, mesh) : body;
      const hands = sub.pose ? reachOf([POSE.wristL, POSE.wristR].flatMap((k) => (seen[k] >= 0.3 ? [{ x: sub.pose!.pts[k][0], y: sub.pose!.pts[k][1], size: 1.5 }] : [])), unit, f.w, f.h) : undefined;
      const mask = dropSpecks(trimThin(grown, f.w, f.h, Math.max(2, unit * f.h * 0.09), hands), f.w, f.h);
      if (import.meta.env.DEV) (window as unknown as { recorte: unknown[] }).recorte = [...((window as unknown as { recorte?: unknown[] }).recorte ?? []), { w: f.w, h: f.h, first: f.mask, seg: seg.mask, mesh, body, reach, mask, whole, unit, pts: sub.pose?.pts, seen }];
      next.push({ ...f, mask, box: boxOfMask(mask, f.w, f.h) });
      if (sub.pose) holders.push({ id: f.id, zone: reachOf([POSE.wristL, POSE.wristR].flatMap((k) => (seen[k] >= 0.3 ? [{ x: sub.pose!.pts[k][0], y: sub.pose!.pts[k][1], size: 2.6 }] : [])), unit, f.w, f.h) });
    }
    set({ figures: absorbHeld(next, holders), strokes: [], formStrokes: [] });
  } catch (err) {
    console.error(err);
  } finally {
    set({ visionStep: null });
    refreshDerived();
  }
}

/** Lleva una máscara de la imagen completa al encuadre actual. */
export function figureInFrame(fig: Figure, rect: Rect, w: number, h: number): Uint8Array {
  const { image } = get();
  const out = new Uint8Array(w * h);
  if (!image) return out;
  const kx = fig.w / image.w;
  const ky = fig.h / image.h;
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((rect.y + (y / h) * rect.h) * ky);
    if (sy < 0 || sy >= fig.h) continue;
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((rect.x + (x / w) * rect.w) * kx);
      if (sx >= 0 && sx < fig.w && fig.mask[sy * fig.w + sx]) out[y * w + x] = 1;
    }
  }
  return out;
}

let visionJob = 0;

async function runVision() {
  const { image } = get();
  if (!image) return;
  const job = ++visionJob;
  const k = Math.min(1, VISION_LONG / Math.max(image.w, image.h));
  const bitmap = await createImageBitmap(image.bitmap, {
    resizeWidth: Math.round(image.w * k),
    resizeHeight: Math.round(image.h * k),
    resizeQuality: 'high',
  });
  set({ visionStep: tx('engine.leyendo_la_imagen'), visionError: null });
  try {
    const msg: VisionMsg = { type: 'detect', bitmap };
    const res = await call<{ subjects: Subject[] }>(vision, msg, [bitmap], (step) => {
      if (job === visionJob) set({ visionStep: step });
    });
    if (job !== visionJob) return;
    // Los rostros protegen sus ojos al simplificar: con rostros nuevos hay que simplificar otra vez.
    set({ subjects: res.subjects, visionStep: null, simplified: null });
    refreshDerived();
  } catch (err) {
    if (job !== visionJob) return;
    console.error(err);
    set({ visionStep: null, visionError: err instanceof Error ? err.message : String(err) });
  }
}

let embedding: Promise<void> | null = null;

function embedImage(): Promise<void> {
  embedding ??= (async () => {
    const { image } = get();
    if (!image) return;
    const bitmap = await createImageBitmap(image.bitmap);
    const msg: VisionMsg = { type: 'embed', bitmap };
    await call(vision, msg, [bitmap], (step) => set({ visionStep: step }));
    set({ visionStep: null });
  })();
  return embedding;
}

interface SegmentReply {
  mask: Uint8Array;
  w: number;
  h: number;
  score: number;
}

function boxOfMask(mask: Uint8Array, w: number, h: number): Rect {
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

const area = (r: Rect) => r.w * r.h;

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.min(area(a), area(b) || 1);
}

function maskOverlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    na += a[i];
    nb += b[i];
    both += a[i] & b[i];
  }
  return both / (Math.min(na, nb) || 1);
}

/** Ajusta la caja de una cabeza cubierta al contorno de su figura. */
function snapHead(head: Subject, subjects: Subject[], figures: Figure[], image: { w: number; h: number }): Rect {
  const owner = subjects.find((s) => s.pose && overlap(head.box, s.box) > 0.5);
  const fig = figures.find((f) => f.id === owner?.id);
  if (!owner?.pose || !fig) return head.box;
  const { pts, vis } = owner.pose;
  if (vis[5] < 0.3 || vis[6] < 0.3) return head.box;
  const neck: Pt = [(pts[5][0] + pts[6][0]) / 2, (pts[5][1] + pts[6][1]) / 2];
  const aspect = image.w / image.h;
  const r0 = Math.max(head.box.w * aspect, head.box.h) / 2;
  const fit = fitHead({ data: fig.mask, w: fig.w, h: fig.h }, { c: [head.box.x + head.box.w / 2, head.box.y + head.box.h / 2], r: r0 }, neck);
  const rx = fit.r / aspect;
  return { x: Math.max(0, fit.c[0] - rx), y: Math.max(0, fit.c[1] - fit.r), w: rx * 2, h: fit.r * 2 };
}

/** Puntos seguros dentro de un sujeto: torso y, si la tiene, su cara. */
function anchorsFor(s: Subject, all: Subject[]): { x: number; y: number; on: boolean }[] {
  const pts: { x: number; y: number; on: boolean }[] = [];
  // De una mano se sabe dónde está cada dedo: eso separa mejor que una caja.
  if (s.hand) return [0, 5, 9, 13, 17, 8, 12, 16].map((i) => ({ x: s.hand!.pts[i][0], y: s.hand!.pts[i][1], on: true }));
  if (s.animal) {
    const best = Math.max(...s.animal.vis) || 1;
    return [3, 4, 5, 8, 11, 14].filter((i) => s.animal!.vis[i] / best > 0.5).map((i) => ({ x: s.animal!.pts[i][0], y: s.animal!.pts[i][1], on: true }));
  }
  if (s.pose) {
    const { pts: p, vis } = s.pose;
    if (vis[5] > 0.3 && vis[6] > 0.3 && vis[11] > 0.3 && vis[12] > 0.3) {
      pts.push({ x: (p[5][0] + p[6][0] + p[11][0] + p[12][0]) / 4, y: (p[5][1] + p[6][1] + p[11][1] + p[12][1]) / 4, on: true });
    }
    // Rodillas y tobillos marcan hasta dónde llega la figura.
    for (const i of [13, 14, 15, 16]) if (vis[i] > 0.45) pts.push({ x: p[i][0], y: p[i][1], on: true });
  }
  if (!pts.length) pts.push({ x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h * 0.55, on: true });
  const face = all
    .filter((f) => (f.kind === 'human-face' || f.kind === 'anime-face' || f.kind === 'animal-face' || f.kind === 'head') && overlap(f.box, s.box) > 0.8)
    .sort((a, b) => a.box.y - b.box.y)[0];
  if (face) pts.push({ x: face.box.x + face.box.w / 2, y: face.box.y + face.box.h / 2, on: true });
  return pts;
}

function rankedFigures(subjects: Subject[]): Subject[] {
  const owners = subjects.filter((s) => s.kind === 'person' || s.kind === 'anime-person' || s.kind === 'animal');
  const free = (s: Subject) => !owners.some((o) => overlap(s.box, o.box) > 0.6);
  // Una cara o una mano sin cuerpo que las reclame son el sujeto de la imagen.
  const alone = subjects.filter((s) => ((s.kind === 'human-face' || s.kind === 'anime-face') && free(s)) || ((s.kind === 'hand' || s.kind === 'foot') && free(s)));
  const bodies = [
    ...alone,
    ...subjects.filter((s) => s.kind === 'person' || s.kind === 'anime-person' || s.kind === 'animal' || (s.kind === 'object' && s.score >= 0.5 && area(s.box) > 0.012)),
  ];
  const out: Subject[] = [];
  // Personas y animales primero: un objeto dudoso no debe quedarse con su recorte.
  const rank = (s: Subject) => (s.kind === 'object' ? 1 : 0);
  for (const s of [...bodies].sort((a, b) => rank(a) - rank(b) || area(b.box) - area(a.box))) {
    if (out.some((o) => overlap(o.box, s.box) > 0.9 && o.kind === s.kind && Math.abs(area(o.box) - area(s.box)) < area(o.box) * 0.3)) continue;
    out.push(s);
  }
  return out.slice(0, 8);
}

/**
 * Silueta de una mano. SAM suele quedarse con la franja iluminada; los puntos dicen dónde
 * va cada dedo, y con eso se corta por color lo que le faltó.
 */
function handSilhouette(s: Subject, seg: SegmentReply, bitmap: ImageBitmap): Uint8Array {
  if (!s.hand) return seg.mask;
  const { w, h } = seg;
  const built = buildHand({ marks: s.hand, aspect: bitmap.width / bitmap.height, id: 'silueta', foot: s.kind === 'foot' });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  for (const p of built.mannequin.pieces) {
    ctx.beginPath();
    p.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.closePath();
    ctx.fill();
  }
  const px = ctx.getImageData(0, 0, w, h).data;
  const prior = new Uint8Array(w * h);
  let both = 0;
  let any = 0;
  let total = 0;
  for (let i = 0; i < prior.length; i++) {
    prior[i] = px[i * 4 + 3] > 128 ? 1 : 0;
    total += prior[i];
    both += prior[i] & seg.mask[i];
    any += prior[i] | seg.mask[i];
  }
  if (both / (any || 1) > 0.72) return seg.mask;
  const paint = new OffscreenCanvas(w, h);
  const pctx = paint.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(bitmap, 0, 0, w, h);
  return grabFromPrior(pctx.getImageData(0, 0, w, h).data, w, h, prior, Math.max(3, Math.round(Math.sqrt(total) * 0.09)));
}

let figuresRunning = false;

/** Caja de la cabeza de una figura: su rostro, o lo que digan los puntos de la pose. */
function headOf(s: Subject, all: Subject[]): Rect | null {
  const face = all.filter((f) => (f.kind.endsWith('face') || f.kind === 'head') && overlap(f.box, s.box) > 0.7).sort((a, b) => area(b.box) - area(a.box))[0];
  if (face) return { x: face.box.x - face.box.w * 0.15, y: face.box.y - face.box.h * 0.3, w: face.box.w * 1.3, h: face.box.h * 1.5 };
  const pose = s.pose;
  if (!pose) return null;
  const ids = [0, 1, 2, 3, 4].filter((i) => pose.vis[i] > 0.25);
  if (ids.length < 2) return null;
  const xs = ids.map((i) => pose.pts[i][0]);
  const ys = ids.map((i) => pose.pts[i][1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.4, 0.03);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x: cx - span * 1.2, y: cy - span * 1.4, w: span * 2.4, h: span * 2.6 };
}

/** La silueta chica: el juez de las hipótesis no necesita más detalle. */
function shrinkMask(f: Figure): { data: Uint8Array; w: number; h: number } {
  const w = 240;
  const h = Math.max(8, Math.round((w * f.h) / f.w));
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = Math.min(f.h - 1, Math.floor(((y + 0.5) / h) * f.h));
    for (let x = 0; x < w; x++) data[y * w + x] = f.mask[my * f.w + Math.min(f.w - 1, Math.floor(((x + 0.5) / w) * f.w))];
  }
  return { data, w, h };
}

/** Recorta a los personajes detectados. Solo corre una vez por imagen. */
export async function ensureFigures() {
  const { figuresReady, visionStep, subjects } = get();
  if (figuresReady || figuresRunning || visionStep) return;
  figuresRunning = true;
  const image = get().image;
  try {
    await embedImage();
    const found: Figure[] = [];
    const list = rankedFigures(subjects);
    const bitmapForPose = get().image?.bitmap;
    const tightened: { id: string; box: Rect }[] = [];
    // Un dibujo se recorta mejor con una red hecha para eso, y solo si hay una figura.
    const people = list.filter((s) => s.kind === 'person' || s.kind === 'anime-person');
    let matte: { mask: Uint8Array; w: number; h: number } | null = null;
    if (people.length === 1 && people[0].kind === 'anime-person' && bitmapForPose) {
      set({ visionStep: tx('engine.separando_la_figura') });
      const bitmap = await createImageBitmap(bitmapForPose);
      const msg: VisionMsg = { type: 'matte', bitmap };
      matte = await call<{ mask: Uint8Array; w: number; h: number }>(vision, msg, [bitmap]);
    }
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      set({ visionStep: tx('engine.recortando_de', { v1: i + 1, length: list.length }) });
      const msg: VisionMsg = { type: 'segment', box: s.box, points: anchorsFor(s, subjects) };
      const seg = await call<SegmentReply>(vision, msg);
      if (get().image !== image) return;
      // Dos detectores pueden señalar a la misma figura: una sola máscara por personaje.
      if (found.some((f) => maskOverlap(f.mask, seg.mask) > 0.7)) continue;
      const person = s.kind === 'person' || s.kind === 'anime-person';
      const raw = s.hand && bitmapForPose ? handSilhouette(s, seg, bitmapForPose) : matte && person ? mergeMatte(seg.mask, seg.w, seg.h, matte.mask, matte.w, matte.h) : seg.mask;
      const joints = person && s.pose ? s.pose.pts.slice(0, 23).filter((_, k) => s.pose!.vis[k] > 0.25) : [];
      const mask = keepConnected(raw, seg.w, seg.h, joints);
      const box = boxOfMask(mask, seg.w, seg.h);
      found.push({ id: s.id, label: s.label, w: seg.w, h: seg.h, mask, source: 'auto', box });
      if (s.kind === 'person' || s.kind === 'anime-person') tightened.push({ id: s.id, box });
      // Con la silueta real el animal queda bien encuadrado para leer sus patas.
      if (s.kind === 'animal' && bitmapForPose) {
        const bitmap = await createImageBitmap(bitmapForPose);
        const animalMsg: VisionMsg = { type: 'animal', bitmap, box };
        const res = await call<{ animal: Subject['animal'] }>(vision, animalMsg, [bitmap]);
        set((st) => ({ subjects: st.subjects.map((sub) => (sub.id === s.id ? { ...sub, animal: res.animal, box } : sub)) }));
      }
    }
    // Con la silueta real la pose se lee mucho mejor y la caja queda ajustada.
    if (tightened.length && bitmapForPose) {
      set({ visionStep: tx('engine.afinando_poses') });
      const bitmap = await createImageBitmap(bitmapForPose);
      const msg: VisionMsg = { type: 'pose', bitmap, boxes: tightened };
      const res = await call<{ results: { id: string; pose: Subject['pose'] }[] }>(vision, msg, [bitmap], (step) => set({ visionStep: step }));
      set((st) => {
        const subjects = st.subjects.map((sub) => {
          const hit = res.results.find((r) => r.id === sub.id);
          const box = tightened.find((t) => t.id === sub.id)?.box;
          return hit ? { ...sub, pose: hit.pose ?? sub.pose, box: box ?? sub.box } : sub;
        });
        return { subjects: subjects.map((sub) => (sub.kind === 'head' ? { ...sub, box: snapHead(sub, subjects, found, image!) } : sub)) };
      });
      // El cuerpo 3D: en grupos se prueban menos hipótesis para no tardar por persona.
      // Un personaje diminuto al fondo no justifica medio minuto de reconstrucción.
      const largest = Math.max(...tightened.map((t) => area(t.box)));
      const worth = tightened.filter((t) => area(t.box) >= largest * 0.12);
      // Partes del cuerpo y de la cabeza: dicen qué es cada cosa, no solo dónde está.
      for (const t of worth.slice(0, 4)) {
        set({ visionStep: tx('engine.separando_sus_partes') });
        const pad = (b: Rect, k: number): Rect => {
          const x = Math.max(0, b.x - b.w * k);
          const y = Math.max(0, b.y - b.h * k);
          return { x, y, w: Math.min(1 - x, b.w * (1 + 2 * k)), h: Math.min(1 - y, b.h * (1 + 2 * k)) };
        };
        try {
          const bitmap = await createImageBitmap(bitmapForPose);
          const msg: VisionMsg = { type: 'partes', bitmap, box: pad(t.box, 0.06), of: 'cuerpo' };
          const parts = await call<NonNullable<Subject['parts']>>(vision, msg, [bitmap]);
          const owner = get().subjects.find((sub) => sub.id === t.id);
          const headBox = owner ? headOf(owner, get().subjects) : null;
          let headParts: Subject['headParts'];
          if (headBox) {
            const again = await createImageBitmap(bitmapForPose);
            const face: VisionMsg = { type: 'partes', bitmap: again, box: pad(headBox, 0.2), of: 'cara' };
            headParts = await call<NonNullable<Subject['headParts']>>(vision, face, [again]);
          }
          if (get().image !== image) return;
          set((st) => ({ subjects: st.subjects.map((sub) => (sub.id === t.id ? { ...sub, parts: { box: parts.box, w: parts.w, h: parts.h, data: parts.data }, headParts: headParts && { box: headParts.box, w: headParts.w, h: headParts.h, data: headParts.data } } : sub)) }));
        } catch (err) {
          // Sin estos modelos la figura se construye igual, con menos información.
          console.warn(tx('engine.partes_sin_leer'), err);
        }
      }
      // Mejor tardar que dejar a alguien sin cuerpo: cada persona prueba todas las hipótesis.
      const quick = false;
      for (let i = 0; i < Math.min(8, worth.length); i++) {
        const t = worth[i];
        const fig = found.find((f) => f.id === t.id)!;
        set({ visionStep: worth.length > 1 ? tx('engine.reconstruyendo_cuerpo_de', { v1: i + 1, length: worth.length }) : tx('engine.reconstruyendo_el_cuerpo') });
        const bitmap = await createImageBitmap(bitmapForPose);
        const pose = get().subjects.find((sub) => sub.id === t.id)?.pose;
        const msg: VisionMsg = { type: 'body', bitmap, box: t.box, quick, evidence: { pose, mask: shrinkMask(fig) } };
        const res = await call<{ body: Body3D | null }>(vision, msg, [bitmap], (step) => set({ visionStep: step }));
        if (get().image !== image) return;
        if (res.body) set((st) => ({ subjects: st.subjects.map((sub) => (sub.id === t.id ? { ...sub, body: res.body! } : sub)) }));
      }
    }
    const totals = new Map<string, number>();
    for (const f of found) totals.set(f.label, (totals.get(f.label) ?? 0) + 1);
    const turn = new Map<string, number>();
    const named = found.map((f) => {
      if ((totals.get(f.label) ?? 0) < 2) return f;
      const n = (turn.get(f.label) ?? 0) + 1;
      turn.set(f.label, n);
      return { ...f, label: `${f.label} ${n}` };
    });
    set({ figures: named, figuresReady: true, visionStep: null, selectedFigure: named[0]?.id ?? null, strokes: [] });
    dropHeldDrawings();
    if (get().mode === 'encaje') void runEncaje();
    polishFigures();
  } catch (err) {
    console.error(err);
    set({ visionStep: null, visionError: err instanceof Error ? err.message : String(err) });
  } finally {
    figuresRunning = false;
  }
}

let depthRunning = false;

/** Los triángulos de la malla no cambian: se traen una vez. */
async function ensureFaces() {
  if (get().bodyFaces) return;
  try {
    const res = await fetch('/models/mhr-faces.bin');
    if (res.ok) set({ bodyFaces: new Int32Array(await res.arrayBuffer()) });
  } catch (err) {
    console.error(err);
  }
}

/** La profundidad cuesta unos segundos: se pide solo cuando algo la necesita. */
/** Con la profundidad lista se quitan los dibujos que alguien sostiene (ver heldDrawings). */
function dropHeldDrawings() {
  const { subjects, depth, figures } = get();
  if (!depth || !subjects.length) return;
  const at = (x: number, y: number) => depth.data[Math.min(depth.h - 1, Math.max(0, Math.floor(y * depth.h))) * depth.w + Math.min(depth.w - 1, Math.max(0, Math.floor(x * depth.w)))];
  const gone = heldDrawings(subjects, at);
  if (!gone.size) return;
  set({ subjects: subjects.filter((s) => !gone.has(s.id)), figures: figures.filter((f) => !gone.has(f.id)) });
}

export async function ensureDepth() {
  void ensureFaces();
  const { depth, image } = get();
  if (depth || depthRunning || !image) return;
  depthRunning = true;
  try {
    const k = Math.min(1, 1024 / Math.max(image.w, image.h));
    const bitmap = await createImageBitmap(image.bitmap, { resizeWidth: Math.round(image.w * k), resizeHeight: Math.round(image.h * k), resizeQuality: 'high' });
    const msg: VisionMsg = { type: 'depth', bitmap };
    const res = await call<{ data: Float32Array; w: number; h: number }>(vision, msg, [bitmap]);
    if (get().image !== image) return;
    set({ depth: res });
    dropHeldDrawings();
    polishFigures();
    refreshDerived();
    void sceneWithDepth();
  } catch (err) {
    console.error(err);
  } finally {
    depthRunning = false;
  }
}

let manualCount = 0;

/** Recorta lo que la persona tocó. El punto llega normalizado sobre la imagen. */
export async function segmentAt(x: number, y: number) {
  try {
    await embedImage();
    set({ visionStep: tx('words.recortando') });
    const msg: VisionMsg = { type: 'segment', points: [{ x, y, on: true }] };
    const seg = await call<SegmentReply>(vision, msg);
    manualCount++;
    const fig: Figure = {
      id: `m${manualCount}`,
      label: tx('engine.recorte', { manualCount }),
      w: seg.w,
      h: seg.h,
      mask: seg.mask,
      source: 'click',
      box: boxOfMask(seg.mask, seg.w, seg.h),
    };
    set((s) => ({ figures: [...s.figures, fig], selectedFigure: fig.id, visionStep: null, strokes: [] }));
  } catch (err) {
    set({ visionStep: null, visionError: err instanceof Error ? err.message : String(err) });
  }
}

export function removeFigure(id: string) {
  set((s) => {
    const figures = s.figures.filter((f) => f.id !== id);
    return { figures, selectedFigure: s.selectedFigure === id ? (figures[0]?.id ?? null) : s.selectedFigure, strokes: [] };
  });
}

const BASE_OF: Partial<Record<Mode, Base>> = {
  lectura: 'foto',
  lienzo: 'foto',
  valores: 'valores',
  sujetos: 'foto',
  composicion: 'foto',
  perspectiva: 'foto',
  luz: 'foto',
  construccion: 'foto',
  figuras: 'foto',
  encaje: 'foto',
  simplificar: 'simple',
  color: 'foto',
  pintar: 'foto',
};

export function setMode(mode: Mode) {
  const patch = BASE_OF[mode];
  set({ mode, base: patch ?? get().base, focus: mode === 'cuadros' || mode === 'pintar' ? get().focus : null, tool: 'ninguna' });
  if (mode === 'encaje') set((s) => ({ encajeRun: s.encajeRun + 1 }));
  refreshDerived();
}

export function setBase(base: Base) {
  set({ base });
  refreshDerived();
}

export function showMap(kind: MapKind | null) {
  if (!kind) {
    set({ base: 'foto' });
    return;
  }
  set({ base: 'mapa', mapKind: kind });
  refreshDerived();
}

export function setConstruction(step: Level) {
  set((s) => ({ construction: step, pieceStep: null, faceStage: null, detail: null, closeUp: null, encajeRun: s.encajeRun + 1 }));
  refreshDerived();
}

export function setCanvas(c: CanvasSize, cell?: number) {
  const g = get().grid;
  const nextCell = cell ?? suggestCell(c.w, c.h);
  set({ canvas: c, grid: { ...g, cell: nextCell }, done: [], focus: null });
  refreshFrame(60);
}

export function setCrop(c: Crop) {
  set({ crop: c });
  refreshFrame();
}

function resetFor(image: NonNullable<ReturnType<typeof get>['image']>, saved?: SavedProject) {
  embedding = null;
  manualCount = 0;
  const canvas = saved?.canvas ?? canvasFromImage(image.w, image.h);
  const s = get();
  set({
    ...initialState,
    theme: s.theme,
    image,
    canvas,
    crop: saved?.crop ?? initialState.crop,
    grid: saved?.grid ?? { ...initialState.grid, cell: suggestCell(canvas.w, canvas.h) },
    done: saved?.done ?? [],
    mode: 'lectura',
    tubes: s.tubes,
    technique: s.technique,
    pace: s.pace,
    seconds: saved?.seconds ?? 0,
  });
  currentId = saved?.id ?? `p${Date.now()}`;
}

export async function openImage(blob: Blob, name: string, saved?: SavedProject) {
  const full = await createImageBitmap(blob);
  const k = Math.min(1, 4096 / Math.max(full.width, full.height));
  const bitmap =
    k < 1
      ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
      : full;
  resetFor({ bitmap, blob, name, w: bitmap.width, h: bitmap.height }, saved);
  refreshFrame(0);
  void runVision();
}

export async function resumeProject(id: string) {
  const saved = await loadProject(id);
  if (saved) await openImage(saved.blob, saved.name, saved);
}

export function closeImage() {
  flushSave();
  const { theme, tubes, technique, pace } = get();
  set({ ...initialState, theme, tubes, technique, pace });
}

/** Compara la foto de tu pintura con la referencia, cuadro por cuadro. */
export async function buildCompare(source?: Blob, corners?: Pt[]) {
  const s = get();
  const { frame } = s;
  if (!frame) return;
  if (source) set({ compareSource: source });
  const blob = source ?? s.compareSource;
  if (!blob) return;
  if (corners) lastCorners = corners;
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const sw = Math.round(bitmap.width * k);
  const sh = Math.round(bitmap.height * k);
  const c = new OffscreenCanvas(sw, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, sw, sh);
  const w = Math.min(frame.w, 900);
  const h = Math.round((w * frame.h) / frame.w);
  const out = rectify(ctx.getImageData(0, 0, sw, sh).data, sw, sh, lastCorners, w, h);
  const L = lightness(out);
  const grid = buildGrid(s.canvas, s.grid);
  const cells: { name: string; diff: number }[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const r = cellRect(grid, s.canvas, frame.w, frame.h, col, row);
      const mine = cellRect(grid, s.canvas, w, h, col, row);
      const a = meanOf(L, w, mine);
      const b = meanOf(frame.L, frame.w, r);
      cells.push({ name: cellName(col, row), diff: (a - b) / 255 });
    }
  }
  set({ compare: { canvas: canvasFrom(out, w, h), cells } });
}

let lastCorners: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

function meanOf(L: Uint8Array, w: number, r: Rect): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(r.y); y < r.y + r.h; y += 2) {
    for (let x = Math.floor(r.x); x < r.x + r.w; x += 2) {
      sum += L[y * w + x];
      n++;
    }
  }
  return sum / (n || 1);
}

export function clearCompare() {
  set({ compare: null, compareSource: null });
}

// Guarda el avance solo: un cuadro pintado no se debe perder al cerrar.
let currentId = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = '';

function thumbnail(bitmap: ImageBitmap): string {
  const k = 160 / Math.max(bitmap.width, bitmap.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * k);
  c.height = Math.round(bitmap.height * k);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

function flushSave() {
  clearTimeout(saveTimer);
  const s = get();
  if (!s.image) return;
  const { blob, name, bitmap } = s.image;
  void saveProject({ id: currentId, blob, name, canvas: s.canvas, crop: s.crop, grid: s.grid, done: s.done, seconds: s.seconds, thumb: thumbnail(bitmap), updated: Date.now() });
}

useStore.subscribe((s) => {
  if (!s.image) return;
  const key = JSON.stringify([s.canvas, s.crop, s.grid, s.done, Math.floor(s.seconds / 30)]);
  if (key === lastSaved) return;
  lastSaved = key;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
});
