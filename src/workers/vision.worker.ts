/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver, HandLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
import { AutoProcessor, RawImage, SamModel, Tensor, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
import type { AnimalMarks, DrawnFace, HandMarks, Pt, Rect, Subject } from '../lib/types';
import { cocoLabel, isAnimal } from '../lib/labels';
import { honestSubjects } from '../lib/honest';
import { MHR_COUNT, cropAffine, jointAgreement, readLight, selfDisagreement, silhouetteOverlap, type Body3D, type Crop, type Evidence } from '../lib/body';
import { looksLikeFoot } from '../lib/hand';
import { bodyIsFalse } from '../lib/framing';

import { setLocale, t as tx, type Locale } from '../i18n';
export type VisionRequest =
  | { id: number; type: 'detect'; bitmap: ImageBitmap }
  | { id: number; type: 'embed'; bitmap: ImageBitmap }
  | { id: number; type: 'segment'; box?: Rect; points?: { x: number; y: number; on: boolean }[]; prior?: Uint8Array }
  | { id: number; type: 'pose'; bitmap: ImageBitmap; boxes: { id: string; box: Rect }[] }
  | { id: number; type: 'animal'; bitmap: ImageBitmap; box: Rect }
  | { id: number; type: 'partes'; bitmap: ImageBitmap; box: Rect; of: 'cuerpo' | 'cara' }
  | { id: number; type: 'depth'; bitmap: ImageBitmap }
  | { id: number; type: 'body'; bitmap: ImageBitmap; box: Rect; evidence: Evidence; quick: boolean }
  | { id: number; type: 'matte'; bitmap: ImageBitmap }
  | { id: number; type: 'line'; bitmap: ImageBitmap };

const reply = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const progress = (id: number, step: string) => reply({ id, type: 'progress', step });

const BASE = new URL('/', self.location.href).href;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${BASE}models/`;
env.useBrowserCache = false;
const threads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  ? Math.min(6, Math.max(2, (navigator.hardwareConcurrency || 4) - 2))
  : 1;
ort.env.wasm.wasmPaths = `${BASE}wasm/ort/`;
ort.env.wasm.numThreads = threads;
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = `${BASE}wasm/ort/`;
  env.backends.onnx.wasm.numThreads = threads;
}

// MediaPipe borra su fábrica WASM tras cada tarea y un módulo ES no se vuelve a
// ejecutar al importarlo, así que el segundo modelo no la encontraría. La conservamos.
let moduleFactory: unknown;
Object.defineProperty(self, 'ModuleFactory', {
  configurable: true,
  get: () => moduleFactory,
  set: (v) => {
    if (v) moduleFactory = v;
  },
});

let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let faces: FaceLandmarker | null = null;
let poses: ort.InferenceSession | null = null;
let objects: ObjectDetector | null = null;
let animeFace: ort.InferenceSession | null = null;
let animePerson: ort.InferenceSession | null = null;
let realFace: ort.InferenceSession | null = null;
let animeReal: ort.InferenceSession | null = null;

async function vision() {
  if (!fileset) fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm/mediapipe`, true);
  return fileset;
}

const model = (name: string) => `${BASE}models/${name}`;

async function loadFaces() {
  faces ??= await FaceLandmarker.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: model('face_landmarker.task'), delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 12,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    outputFacialTransformationMatrixes: true,
  });
  return faces;
}

async function loadObjects() {
  objects ??= await ObjectDetector.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: model('efficientdet_lite2.tflite'), delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: 0.35,
    maxResults: 24,
  });
  return objects;
}

let handMesh: HandLandmarker | null = null;

async function loadHands() {
  handMesh ??= await HandLandmarker.createFromOptions(await vision(), {
    baseOptions: { modelAssetPath: model('hand_landmarker.task'), delegate: 'CPU' },
    runningMode: 'IMAGE',
    numHands: 6,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
  });
  return handMesh;
}

const DRAWN_SURE = 0.72;

async function session(file: string) {
  return ort.InferenceSession.create(model(file), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

/** Qué fracción de `a` queda dentro de `b`. */
function inside(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / (a.w * a.h || 1);
}

function boxOf(pts: Pt[]): Rect {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(1, x1) - Math.max(0, x0), h: Math.min(1, y1) - Math.max(0, y0) };
}

function eulerFromMatrix(data: number[] | Float32Array): Subject['turn'] {
  // Matriz 4×4 por columnas: de ella salen los giros de la cabeza.
  const r = (row: number, col: number) => data[col * 4 + row];
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r(1, 2))));
  const yaw = Math.atan2(r(0, 2), r(2, 2));
  const roll = Math.atan2(r(1, 0), r(1, 1));
  const deg = (v: number) => Math.round((v * 180) / Math.PI);
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) };
}

function crop(bitmap: ImageBitmap, r: Rect): OffscreenCanvas {
  const w = Math.max(1, Math.round(r.w * bitmap.width));
  const h = Math.max(1, Math.round(r.h * bitmap.height));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bitmap, r.x * bitmap.width, r.y * bitmap.height, w, h, 0, 0, w, h);
  return c;
}

async function yolo(s: ort.InferenceSession, bitmap: ImageBitmap, threshold: number, max = 640): Promise<{ box: Rect; score: number }[]> {
  const scale = max / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(32, Math.round((bitmap.width * scale) / 32) * 32);
  const h = Math.max(32, Math.round((bitmap.height * scale) / 32) * 32);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const input = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    input[i] = px[i * 4] / 255;
    input[w * h + i] = px[i * 4 + 1] / 255;
    input[2 * w * h + i] = px[i * 4 + 2] / 255;
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
  const t = out[s.outputNames[0]];
  const data = t.data as Float32Array;
  const [, channels, count] = t.dims as number[];
  const boxes: { box: Rect; score: number }[] = [];
  for (let i = 0; i < count; i++) {
    let score = 0;
    for (let c = 4; c < channels; c++) score = Math.max(score, data[c * count + i]);
    if (score < threshold) continue;
    const cx = data[i];
    const cy = data[count + i];
    const bw = data[2 * count + i];
    const bh = data[3 * count + i];
    boxes.push({ box: { x: (cx - bw / 2) / w, y: (cy - bh / 2) / h, w: bw / w, h: bh / h }, score });
  }
  boxes.sort((a, b) => b.score - a.score);
  const kept: typeof boxes = [];
  for (const b of boxes) if (!kept.some((k) => iou(k.box, b.box) > 0.5)) kept.push(b);
  return kept;
}

/** Probabilidad de que un recorte sea dibujo y no fotografía. */
async function drawnScore(source: OffscreenCanvas | ImageBitmap): Promise<number> {
  animeReal ??= await session('anime_real.onnx');
  const size = 384;
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = px[i * 4] / 127.5 - 1;
    input[n + i] = px[i * 4 + 1] / 127.5 - 1;
    input[2 * n + i] = px[i * 4 + 2] / 127.5 - 1;
  }
  const out = await animeReal.run({ [animeReal.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const logits = out[animeReal.outputNames[0]].data as Float32Array;
  const peak = Math.max(logits[0], logits[1]);
  const anime = Math.exp(logits[0] - peak);
  const real = Math.exp(logits[1] - peak);
  return anime / (anime + real);
}

function padded(box: Rect, pad: number): Rect {
  const x = Math.max(0, box.x - box.w * pad);
  const y = Math.max(0, box.y - box.h * pad);
  return { x, y, w: Math.min(1 - x, box.w * (1 + 2 * pad)), h: Math.min(1 - y, box.h * (1 + 2 * pad)) };
}

/** Pone los puntos faciales sobre un rostro ya localizado, viéndolo de cerca. */
async function landmarksFor(bitmap: ImageBitmap, box: Rect): Promise<Pick<Subject, 'face' | 'turn'>> {
  const fl = await loadFaces();
  const tile = padded(box, 0.45);
  const result = fl.detect(crop(bitmap, tile) as unknown as ImageBitmap);
  let best: Pick<Subject, 'face' | 'turn'> = {};
  let bestOverlap = 0.25;
  result.faceLandmarks.forEach((lm, i) => {
    const pts = lm.map((p): Pt => [tile.x + p.x * tile.w, tile.y + p.y * tile.h]);
    const overlap = iou(boxOf(pts), box);
    if (overlap <= bestOverlap) return;
    bestOverlap = overlap;
    const m = result.facialTransformationMatrixes?.[i]?.data;
    best = { face: pts, turn: m ? eulerFromMatrix(m) : undefined };
  });
  return best;
}

async function detect(id: number, bitmap: ImageBitmap): Promise<Subject[]> {
  progress(id, tx('visionWorker.buscando_animales_objetos'));
  const od = await loadObjects();
  const coco = od.detect(bitmap).detections.map((d) => {
    const b = d.boundingBox!;
    const name = d.categories[0].categoryName;
    return {
      name,
      score: d.categories[0].score,
      box: { x: b.originX / bitmap.width, y: b.originY / bitmap.height, w: b.width / bitmap.width, h: b.height / bitmap.height },
    };
  });
  const area = (r: Rect) => r.w * r.h;
  const animals = coco.filter((c) => isAnimal(c.name) && c.score > 0.5);
  const people = coco.filter((c) => c.name === 'person');

  progress(id, tx('visionWorker.buscando_rostros'));
  realFace ??= await session('real_face.onnx');
  animeFace ??= await session('anime_face.onnx');
  const real = await yolo(realFace, bitmap, 0.3, 1024);
  const anime = await yolo(animeFace, bitmap, 0.4);
  const wholeDrawn = await drawnScore(bitmap);

  // Los dos detectores proponen; el contexto y el clasificador deciden qué es cada rostro.
  const candidates = real.map((r) => ({ ...r, box: clampBox(r.box) }));
  for (const a of anime) if (!candidates.some((c) => iou(c.box, a.box) > 0.3)) candidates.push({ ...a, box: clampBox(a.box) });

  const out: Subject[] = [];
  for (const c of candidates) {
    const animal = animals.filter((a) => inside(c.box, a.box) > 0.7).sort((p, q) => area(p.box) - area(q.box))[0];
    const person = people.filter((a) => inside(c.box, a.box) > 0.7).sort((p, q) => area(p.box) - area(q.box))[0];
    if (animal && (!person || area(animal.box) < area(person.box))) {
      // La malla humana no sirve en un animal, pero su orientación general sí da pista.
      const { turn } = await landmarksFor(bitmap, c.box);
      out.push({ id: '', kind: 'animal-face', label: tx('visionWorker.cara_de', { v1: cocoLabel(animal.name).toLowerCase() }), score: c.score, box: c.box, turn });
      continue;
    }
    const drawn = ((await drawnScore(crop(bitmap, padded(c.box, 0.25)))) + wholeDrawn) / 2;
    // Una pintura realista cae a medias: si los puntos faciales encajan, es un rostro humano.
    const marks = drawn < DRAWN_SURE ? await landmarksFor(bitmap, c.box) : {};
    if (drawn >= DRAWN_SURE || (drawn > 0.5 && !marks.face)) {
      out.push({ id: '', kind: 'anime-face', label: tx('visionWorker.rostro_anime'), score: c.score, box: c.box, drawn: await drawnFace(bitmap, c.box) });
    } else {
      out.push({ id: '', kind: 'human-face', label: tx('visionWorker.rostro_humano'), score: c.score, box: c.box, ...marks });
    }
  }

  const isDrawn = out.some((s) => s.kind === 'anime-face') || wholeDrawn > 0.7;
  if (isDrawn) {
    progress(id, tx('visionWorker.buscando_personajes'));
    animePerson ??= await session('anime_person.onnx');
    for (const p of await yolo(animePerson, bitmap, 0.4)) {
      out.push({ id: '', kind: 'anime-person', label: tx('visionWorker.personaje'), score: p.score, box: clampBox(p.box) });
    }
  }

  for (const c of coco) {
    if (c.name === 'person') {
      if (out.some((s) => s.kind === 'anime-person' && iou(s.box, c.box) > 0.4)) continue;
      out.push({ id: '', kind: 'person', label: tx('common.persona'), score: c.score, box: clampBox(c.box) });
    } else {
      if (isAnimal(c.name) && c.score < (isDrawn ? 0.6 : 0.4)) continue;
      if (c.box.w * c.box.h > 0.7 && c.score < 0.6) continue;
      // Un objeto que envuelve a una persona casi siempre es un error del detector.
      if (!isAnimal(c.name) && c.score < 0.75 && people.some((q) => inside(q.box, c.box) > 0.8 && c.box.w * c.box.h > (q.box.w * q.box.h) * 0.8)) continue;
      out.push({
        id: '',
        kind: isAnimal(c.name) ? 'animal' : 'object',
        label: cocoLabel(c.name),
        score: c.score,
        box: clampBox(c.box),
      });
    }
  }

  const hands = await findHands(id, bitmap);
  const hasHead = (box: Rect) => out.some((s) => s.kind.endsWith('face') && inside(s.box, box) > 0.6);
  const named = out.map((s, i) => ({ ...s, id: `s${i}` }));
  const bodies = named.filter((s) => s.kind === 'person' || s.kind === 'anime-person').slice(0, 8);
  progress(id, tx('visionWorker.leyendo_poses'));
  for (const body of bodies) {
    const pose = await dwpose(bitmap, body.box);
    if (pose) body.pose = pose;
  }
  // Una mano en primer plano parece persona a más de un modelo: si no hay cabeza ni un
  // cuerpo que se sostenga, ese "cuerpo" se descarta antes de inventarle un maniquí.
  for (const body of [...bodies]) {
    if (hasHead(body.box)) continue;
    const handShare = hands.reduce((acc, h) => Math.max(acc, inside(h.box, body.box) * (h.box.w * h.box.h) / (body.box.w * body.box.h || 1)), 0);
    if (bodyIsFalse(body.kind, body.pose, handShare)) {
      named.splice(named.indexOf(body), 1);
      bodies.splice(bodies.indexOf(body), 1);
    }
  }
  for (const a of named.filter((s) => s.kind === 'animal')) a.animal = await animalPose(bitmap, a.box).catch(() => undefined);
  // Sin persona detectada aún puede haber una figura: el modelo de pose decide.
  // Manos chicas no estorban (un boceto las tiene); una mano grande ya es el sujeto.
  const bigHand = hands.some((h) => h.box.w * h.box.h > 0.05);
  if (!bodies.length && !bigHand && !named.some((s) => s.kind === 'animal')) {
    const pose = await dwpose(bitmap, { x: 0, y: 0, w: 1, h: 1 });
    if (pose && bodyConfidence(pose) > 0.45) {
      named.push({ id: `s${named.length}`, kind: isDrawn ? 'anime-person' : 'person', label: isDrawn ? tx('visionWorker.personaje') : tx('common.persona'), score: bodyConfidence(pose), box: boxOf(pose.pts.filter((_, i) => i < 23 && pose.vis[i] > 0.3)), pose });
    }
  }
  // Cabezas sin rostro detectable: máscaras, cascos, personajes de espaldas.
  for (const body of named.filter((s) => s.pose)) {
    const head = headBox(body.pose!);
    if (!head) continue;
    const taken = named.some((s) => s.kind.endsWith('face') && (iou(s.box, head) > 0.15 || inside(s.box, head) > 0.5));
    if (taken) continue;
    named.push({ id: `s${named.length}`, kind: 'head', label: tx('visionWorker.cabeza_con_rostro_cubierto'), score: bodyConfidence(body.pose!), box: head, face: undefined });
  }
  // Una foto sin nada reconocible aún puede ser una mano que ningún detector vio.
  const alone = !named.some((s) => s.pose || s.kind === 'animal' || s.kind.endsWith('face'));
  if (alone && !hands.length) {
    const hand = await handInBox(bitmap, bitmap.width / 2, bitmap.height / 2, Math.max(bitmap.width, bitmap.height) * 1.1);
    if (hand.score > 0.46) hands.push({ box: clampBox(padded(boxOf(hand.pts), 0.1)), hand });
  }
  for (const { box, hand } of hands) {
    const foot = looksLikeFoot(hand, named.map((s) => s.pose));
    const owner = named.find((s) => s.pose && inside(box, s.box) > 0.5);
    // Un pie sobre un cuerpo ya lo resuelve el cuerpo.
    if (foot && owner) continue;
    named.push({ id: `s${named.length}`, kind: foot ? 'foot' : 'hand', label: foot ? tx('common.pie') : tx('common.mano'), score: hand.score, box, hand });
  }
  // Un detector de objetos ve cosas raras en una mano: lo que cae sobre ella no es objeto.
  const kept = named.filter((s) => s.kind !== 'object' || s.score > 0.8 || !hands.some((h) => inside(s.box, h.box) > 0.45));
  return honestSubjects(kept);
}

let handNet: ort.InferenceSession | null = null;
let handBoxes: ort.InferenceSession | null = null;
let eyeBoxes: ort.InferenceSession | null = null;
let animeMarks: ort.InferenceSession | null = null;
let animalNet: ort.InferenceSession | null = null;

/** Recorte cuadrado y girado: lo que entra a los modelos de puntos. */
function turnedCrop(bitmap: ImageBitmap, cx: number, cy: number, size: number, turn: number, S: number): { px: Uint8ClampedArray; back: (u: number, v: number) => Pt } {
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const rad = (turn * Math.PI) / 180;
  const k = size / S;
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-rad);
  ctx.scale(1 / k, 1 / k);
  ctx.translate(-cx, -cy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const back = (u: number, v: number): Pt => {
    const x = (u - S / 2) * k;
    const y = (v - S / 2) * k;
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  };
  return { px: ctx.getImageData(0, 0, S, S).data, back };
}

/** Puntos de la mano a partir de una caja: no necesita su detector y entiende el dibujo. */
async function handInBox(bitmap: ImageBitmap, cx: number, cy: number, size: number): Promise<HandMarks> {
  handNet ??= await session('rtmpose-hand.onnx');
  const S = 256;
  const mean = [123.675, 116.28, 103.53];
  const std = [58.395, 57.12, 57.375];
  let best: HandMarks | null = null;
  // La red espera la mano más o menos derecha: se prueba girándola y gana la más segura.
  for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) {
    const { px, back } = turnedCrop(bitmap, cx, cy, size, turn, S);
    const n = S * S;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] - mean[k]) / std[k];
    const out = await handNet.run({ [handNet.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
    const xs = out[handNet.outputNames[0]];
    const ys = out[handNet.outputNames[1]];
    const K = xs.dims[1];
    const LX = xs.dims[2];
    const LY = ys.dims[2];
    const dx = xs.data as Float32Array;
    const dy = ys.data as Float32Array;
    const pts: Pt[] = [];
    const vis: number[] = [];
    for (let k = 0; k < K; k++) {
      let bx = 0;
      let vx = -Infinity;
      for (let i = 0; i < LX; i++) if (dx[k * LX + i] > vx) ((vx = dx[k * LX + i]), (bx = i));
      let by = 0;
      let vy = -Infinity;
      for (let i = 0; i < LY; i++) if (dy[k * LY + i] > vy) ((vy = dy[k * LY + i]), (by = i));
      const [x, y] = back(bx / 2, by / 2);
      pts.push([x / bitmap.width, y / bitmap.height]);
      vis.push(Math.min(vx, vy));
    }
    const top = [...vis].sort((p, q) => q - p).slice(0, 12);
    const score = top.reduce((p, q) => p + q, 0) / top.length;
    if (!best || score > best.score) best = { pts, vis, score, source: 'caja' };
  }
  return best!;
}

/** Dos proponen las manos: la malla es exacta en foto y el detector también ve dibujo. */
async function findHands(id: number, bitmap: ImageBitmap): Promise<{ box: Rect; hand: HandMarks }[]> {
  progress(id, tx('visionWorker.buscando_manos'));
  const found: { box: Rect; hand: HandMarks }[] = [];
  // En una instalación sin estos modelos la imagen se lee igual, solo que sin manos.
  try {
    await collectHands(bitmap, found);
  } catch (err) {
    console.warn(tx('visionWorker.manos_sin_leer'), err);
  }
  return found;
}

async function collectHands(bitmap: ImageBitmap, found: { box: Rect; hand: HandMarks }[]) {
  const mesh = (await loadHands()).detect(bitmap);
  mesh.landmarks.forEach((lm, i) => {
    const pts = lm.map((p): Pt => [p.x, p.y]);
    const world = mesh.worldLandmarks[i]?.map((p): [number, number, number] => [p.x, p.y, -p.z]);
    found.push({ box: clampBox(padded(boxOf(pts), 0.12)), hand: { pts, vis: lm.map(() => 1), world, score: mesh.handedness[i]?.[0]?.score ?? 0.8, source: 'malla' } });
  });
  handBoxes ??= await session('anime_hand.onnx');
  for (const b of (await yolo(handBoxes, bitmap, 0.3)).slice(0, 6)) {
    if (found.some((f) => iou(f.box, b.box) > 0.25 || inside(b.box, f.box) > 0.6)) continue;
    const cx = (b.box.x + b.box.w / 2) * bitmap.width;
    const cy = (b.box.y + b.box.h / 2) * bitmap.height;
    const size = Math.max(b.box.w * bitmap.width, b.box.h * bitmap.height) * 1.5;
    const hand = await handInBox(bitmap, cx, cy, size);
    if (hand.score > 0.28) found.push({ box: clampBox(b.box), hand });
  }
}

/** Ojos de un dibujo, buscados de cerca: los puntos de la pose no entienden ojos grandes. */
async function drawnEyes(bitmap: ImageBitmap, box: Rect): Promise<Rect[]> {
  eyeBoxes ??= await session('anime_eye.onnx');
  const tile = padded(box, 0.15);
  const small = await createImageBitmap(crop(bitmap, tile));
  const near = (await yolo(eyeBoxes, small, 0.2)).map((e) => ({ score: e.score, box: { x: tile.x + e.box.x * tile.w, y: tile.y + e.box.y * tile.h, w: e.box.w * tile.w, h: e.box.h * tile.h } }));
  small.close();
  // Una cara ya grande se lee mejor en la imagen entera que ampliada: se usan las dos.
  const far = (await yolo(eyeBoxes, bitmap, 0.2)).filter((e) => inside(e.box, tile) > 0.6);
  const all = [...near, ...far].sort((p, q) => q.score - p.score);
  const kept: Rect[] = [];
  for (const e of all) if (!kept.some((k) => iou(k, e.box) > 0.2 || inside(e.box, k) > 0.5) && kept.length < 2) kept.push(e.box);
  return kept;
}

/**
 * Rasgos de un rostro dibujado (CFA, 24 puntos). Ve bien solo caras derechas: se endereza
 * con los ojos y se aceptan los puntos únicamente si sus ojos caen sobre los ojos hallados.
 */
async function drawnMarks(bitmap: ImageBitmap, box: Rect, eyes: Rect[]): Promise<DrawnFace['marks']> {
  if (eyes.length < 2) return undefined;
  animeMarks ??= await session('anime_marks.onnx');
  const W = bitmap.width;
  const H = bitmap.height;
  const [a, b] = [...eyes].sort((p, q) => p.x - q.x);
  const ax = (a.x + a.w / 2) * W;
  const ay = (a.y + a.h / 2) * H;
  const bx = (b.x + b.w / 2) * W;
  const by = (b.y + b.h / 2) * H;
  const turn = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const span = Math.hypot(bx - ax, by - ay);
  const size = Math.max(span * 2.6, Math.max(box.w * W, box.h * H) * 1.08);
  // Los ojos quedan algo arriba del centro de la cara.
  const nx = -Math.sin((turn * Math.PI) / 180);
  const ny = Math.cos((turn * Math.PI) / 180);
  const cx = (ax + bx) / 2 + nx * size * 0.13;
  const cy = (ay + by) / 2 + ny * size * 0.13;
  const S = 128;
  const { px, back } = turnedCrop(bitmap, cx, cy, size, turn, S);
  const input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let k = 0; k < 3; k++) input[k * S * S + i] = (px[i * 4 + k] / 255 - 0.5) / 0.5;
  const out = await animeMarks.run({ [animeMarks.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const t = out[animeMarks.outputNames[0]];
  const [, K, HH, WW] = t.dims as number[];
  const data = t.data as Float32Array;
  const pts: Pt[] = [];
  const vis: number[] = [];
  for (let k = 0; k < Math.min(24, K); k++) {
    let bestV = -Infinity;
    let at = 0;
    for (let i = 0; i < WW * HH; i++) {
      const v = data[k * WW * HH + i];
      if (v > bestV) ((bestV = v), (at = i));
    }
    const [x, y] = back((((at % WW) + 0.5) / WW) * S, ((Math.floor(at / WW) + 0.5) / HH) * S);
    pts.push([x / W, y / H]);
    vis.push(bestV);
  }
  // Pupilas del modelo contra ojos hallados: si no coinciden, sus puntos no sirven.
  const near = (p: Pt, e: Rect) => Math.abs(p[0] - (e.x + e.w / 2)) < e.w * 0.75 && Math.abs(p[1] - (e.y + e.h / 2)) < e.h * 0.75;
  const fits = (near(pts[14], a) && near(pts[19], b)) || (near(pts[14], b) && near(pts[19], a));
  const mean = vis.reduce((p, q) => p + q, 0) / vis.length;
  return fits && mean > 0.3 ? { pts, vis } : undefined;
}

/** Los puntos de anime no vienen con la instalación normal: sin ellos quedan los ojos. */
async function drawnFace(bitmap: ImageBitmap, box: Rect): Promise<DrawnFace | undefined> {
  try {
    const eyes = await drawnEyes(bitmap, box);
    const marks = await drawnMarks(bitmap, box, eyes).catch(() => undefined);
    return { eyes, marks };
  } catch (err) {
    console.warn(tx('visionWorker.rasgos_sin_leer'), err);
    return undefined;
  }
}

/** Pose de un animal (ViTPose++, APT-36K): cara, patas, lomo y cola. */
async function animalPose(bitmap: ImageBitmap, box: Rect): Promise<AnimalMarks> {
  animalNet ??= await session('vitpose-animal.onnx');
  const W = 192;
  const H = 256;
  const cx = (box.x + box.w / 2) * bitmap.width;
  const cy = (box.y + box.h / 2) * bitmap.height;
  let bw = box.w * bitmap.width * 1.25;
  let bh = box.h * bitmap.height * 1.25;
  if (bw / bh > W / H) bh = (bw * H) / W;
  else bw = (bh * W) / H;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);
  ctx.scale(W / bw, H / bh);
  ctx.translate(bw / 2 - cx, bh / 2 - cy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  const out = await animalNet.run({ [animalNet.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  const t = out[animalNet.outputNames[0]];
  const [, K, HH, WW] = t.dims as number[];
  const data = t.data as Float32Array;
  const pts: Pt[] = [];
  const vis: number[] = [];
  for (let k = 0; k < K; k++) {
    let bestV = -Infinity;
    let at = 0;
    for (let i = 0; i < WW * HH; i++) {
      const v = data[k * WW * HH + i];
      if (v > bestV) ((bestV = v), (at = i));
    }
    const u = (at % WW) / WW - 0.5;
    const v = Math.floor(at / WW) / HH - 0.5;
    pts.push([(cx + u * bw) / bitmap.width, (cy + v * bh) / bitmap.height]);
    vis.push(bestV);
  }
  return { pts, vis };
}

function clampBox(b: Rect): Rect {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return { x, y, w: Math.min(1, b.x + b.w) - x, h: Math.min(1, b.y + b.h) - y };
}

function bodyConfidence(pose: NonNullable<Subject['pose']>): number {
  const core = [5, 6, 11, 12, 13, 14];
  return core.reduce((a, i) => a + Math.min(1, pose.vis[i]), 0) / core.length;
}

/** Caja de la cabeza con los puntos faciales de la pose, sin dejarse llevar por los sueltos. */
function headBox(pose: NonNullable<Subject['pose']>): Rect | null {
  const ids = [0, 1, 2, 3, 4];
  for (let i = 23; i < 91; i++) ids.push(i);
  const pts = ids.filter((i) => pose.vis[i] > 0.3).map((i) => pose.pts[i]);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
  const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
  const at = (v: number[], q: number) => v[Math.floor((v.length - 1) * q)];
  const x0 = at(xs, 0.12);
  const x1 = at(xs, 0.88);
  const y0 = at(ys, 0.12);
  const y1 = at(ys, 0.88);
  const size = Math.max(x1 - x0, y1 - y0, 0.01);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return clampBox({ x: cx - size * 0.8, y: cy - size * 0.95, w: size * 1.6, h: size * 1.75 });
}

/**
 * DWPose: 133 puntos de cuerpo, pies, cara y manos. Se eligió sobre MediaPipe porque
 * también entiende dibujo, bocetos y personajes con traje o máscara.
 */
async function dwpose(bitmap: ImageBitmap, box: Rect, turn = 0): Promise<Subject['pose'] | undefined> {
  poses ??= await session('dw-ll_ucoco_384.onnx');
  const W = 288;
  const H = 384;
  const ix = box.x * bitmap.width;
  const iy = box.y * bitmap.height;
  const iw = box.w * bitmap.width;
  const ih = box.h * bitmap.height;
  const cx = ix + iw / 2;
  const cy = iy + ih / 2;
  let bw = iw * 1.25;
  let bh = ih * 1.25;
  if (bw / bh > W / H) bh = (bw * H) / W;
  else bw = (bh * W) / H;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);
  const rad = (turn * Math.PI) / 180;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-rad);
  ctx.scale(W / bw, H / bh);
  ctx.translate(-cx, -cy);
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const input = new Float32Array(3 * n);
  const mean = [123.675, 116.28, 103.53];
  const std = [58.395, 57.12, 57.375];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] - mean[k]) / std[k];
  }
  const out = await poses.run({ [poses.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  const xs = out.simcc_x ?? out[poses.outputNames[0]];
  const ys = out.simcc_y ?? out[poses.outputNames[1]];
  const K = xs.dims[1];
  const LX = xs.dims[2];
  const LY = ys.dims[2];
  const dx = xs.data as Float32Array;
  const dy = ys.data as Float32Array;
  const pts: Pt[] = [];
  const vis: number[] = [];
  for (let k = 0; k < K; k++) {
    let bx = 0;
    let vx = -Infinity;
    let by = 0;
    let vy = -Infinity;
    for (let i = 0; i < LX; i++) {
      const v = dx[k * LX + i];
      if (v > vx) {
        vx = v;
        bx = i;
      }
    }
    for (let i = 0; i < LY; i++) {
      const v = dy[k * LY + i];
      if (v > vy) {
        vy = v;
        by = i;
      }
    }
    const u = (bx / 2 / W - 0.5) * bw;
    const v = (by / 2 / H - 0.5) * bh;
    const x = cx + u * Math.cos(rad) - v * Math.sin(rad);
    const y = cy + u * Math.sin(rad) + v * Math.cos(rad);
    pts.push([x / bitmap.width, y / bitmap.height]);
    vis.push(Math.min(vx, vy));
  }
  return { pts, vis };
}

/** Qué tan segura es una lectura: los doce puntos del cuerpo más claros. */
function poseScore(pose: Subject['pose'] | undefined): number {
  if (!pose) return 0;
  const body = pose.vis.slice(0, 17).sort((a, b) => b - a).slice(0, 12);
  return body.reduce((a, b) => a + b, 0) / body.length;
}

/** Con la imagen inclinada la pose también se confunde: se prueba girándola. */
async function bestPose(id: number, bitmap: ImageBitmap, box: Rect): Promise<Subject['pose'] | undefined> {
  let best = await dwpose(bitmap, box);
  let score = poseScore(best);
  if (score > 0.62) return best;
  for (const turn of [25, -25, 50, -50, 75, -75, 105, -105, 180]) {
    progress(id, tx('visionWorker.leyendo_la_pose_girada', { turn }));
    const pose = await dwpose(bitmap, box, turn);
    const value = poseScore(pose);
    if (value > score) {
      best = pose;
      score = value;
    }
  }
  return best;
}

let bodyNet: ort.InferenceSession | null = null;
let bodyMesh: ort.InferenceSession | null = null;
let meshFaces: Int32Array | null = null;
let matteNet: ort.InferenceSession | null = null;
let lineNet: ort.InferenceSession | null = null;

const BODY_SIZE = 288;
const TURNS = [0, 25, -25, 50, -50, 75, -75, 105, -105, 135, -135, 180];

function bodyCrop(bitmap: ImageBitmap, crop: Crop): Float32Array {
  const S = BODY_SIZE;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const det = crop.a * crop.e - crop.b * crop.d;
  ctx.setTransform(crop.e / det, -crop.d / det, -crop.b / det, crop.a / det, (crop.b * crop.f - crop.e * crop.c) / det, (crop.d * crop.c - crop.a * crop.f) / det);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, S, S).data;
  const n = S * S;
  const input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  }
  return input;
}

function grayFor(bitmap: ImageBitmap, long: number): { L: Uint8Array; w: number; h: number } {
  const k = Math.min(1, long / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(8, Math.round(bitmap.width * k));
  const h = Math.max(8, Math.round(bitmap.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const L = new Uint8Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  return { L, w, h };
}

/**
 * Cuerpo 3D por hipótesis. La red solo conoce gente derecha y bien encuadrada, y una
 * ilustración no lo está: se le pregunta con la imagen girada y con varios recortes, y
 * gana la respuesta que mejor explica la pose 2D y la silueta. Es el aumento en prueba
 * de las competencias, con un juez hecho a la medida del problema.
 */
async function body3d(id: number, bitmap: ImageBitmap, box: Rect, ev: Evidence, quick: boolean): Promise<Body3D | null> {
  bodyNet ??= await session('instanthmr-medium.onnx');
  bodyMesh ??= await session('mhr-body.onnx');
  if (!meshFaces) meshFaces = new Int32Array(await (await fetch(model('mhr-faces.bin'))).arrayBuffer());
  const W = bitmap.width;
  const H = bitmap.height;
  const aspect = W / H;
  const focal = 1.05 * Math.hypot(W, H);
  const frames: [number, number, number][] = [[(box.x + box.w / 2) * W, (box.y + box.h / 2) * H, Math.max(box.w * W, box.h * H)]];
  if (ev.pose && !quick) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    ev.pose.pts.forEach(([x, y], i) => {
      if (ev.pose!.vis[i] < 0.3) return;
      x0 = Math.min(x0, x * W);
      x1 = Math.max(x1, x * W);
      y0 = Math.min(y0, y * H);
      y1 = Math.max(y1, y * H);
    });
    if (x1 > x0) frames.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 1.15]);
  }
  if (!quick) frames.push([W / 2, H / 2, Math.max(W, H) * 0.95]);
  const turns = quick ? [0, 25, -25] : TURNS;
  const total = frames.length * turns.length;
  interface Guess {
    mhr: Float32Array;
    shape: Float32Array;
    cam: Float32Array;
    screen: Float32Array;
    agree: number;
    turn: number;
  }
  const guesses: Guess[] = [];
  let count = 0;
  for (const [cx, cy, size] of frames) {
    for (const turn of turns) {
      count++;
      if (count % 4 === 1) progress(id, tx('visionWorker.probando_poses_de', { count, total }));
      const crop = cropAffine(cx, cy, size, turn, BODY_SIZE);
      const rad = (turn * Math.PI) / 180;
      const dx = cx - W / 2;
      const dy = cy - H / 2;
      const rx = dx * Math.cos(rad) + dy * Math.sin(rad);
      const ry = -dx * Math.sin(rad) + dy * Math.cos(rad);
      const out = await bodyNet.run({
        image: new ort.Tensor('float32', bodyCrop(bitmap, crop), [1, 3, BODY_SIZE, BODY_SIZE]),
        cliff_cond: new ort.Tensor('float32', new Float32Array([Math.atan(rx / focal), Math.atan(ry / focal), size / focal]), [1, 3]),
      });
      const j2 = out.joints_2d.data as Float32Array;
      const screen = new Float32Array(MHR_COUNT * 2);
      for (let i = 0; i < MHR_COUNT; i++) {
        const u = (j2[i * 2] + 1) * 0.5 * BODY_SIZE;
        const v = (j2[i * 2 + 1] + 1) * 0.5 * BODY_SIZE;
        screen[i * 2] = (crop.a * u + crop.b * v + crop.c) / W;
        screen[i * 2 + 1] = (crop.d * u + crop.e * v + crop.f) / H;
      }
      guesses.push({
        mhr: out.mhr_params.data as Float32Array,
        shape: out.shape_params.data as Float32Array,
        cam: out.cam_trans.data as Float32Array,
        screen,
        agree: jointAgreement(screen, ev),
        turn,
      });
    }
  }
  guesses.sort((a, b) => b.agree - a.agree);
  progress(id, tx('visionWorker.comparando_con_la_silueta'));
  let best: (Guess & { joints: Float32Array; vertices: Float32Array; overlap: number; total: number }) | null = null;
  for (const g of guesses.slice(0, quick ? 2 : 5)) {
    const out = await bodyMesh.run({
      mhr_params: new ort.Tensor('float32', g.mhr, [1, 204]),
      shape_params: new ort.Tensor('float32', g.shape, [1, 45]),
    });
    const joints = Float32Array.from(out.joints_3d.data as Float32Array);
    const vertices = Float32Array.from(out.vertices.data as Float32Array);
    // Lo predicho está en el marco girado: se regresa al de la imagen.
    const rad = (g.turn * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    for (const list of [joints, vertices]) {
      for (let i = 0; i < list.length; i += 3) {
        const x = list[i];
        const y = list[i + 1];
        list[i] = c * x - s * y;
        list[i + 1] = s * x + c * y;
      }
    }
    const overlap = ev.mask ? silhouetteOverlap({ joints, screen: g.screen, vertices }, meshFaces, ev.mask, aspect) : 0.5;
    // Con la imagen girada la red a veces da puntos 2D buenos y un cuerpo 3D que no les
    // corresponde (el boceto de Mikasa). Sin giro eso no pasa, y ahí no se toca la elección.
    const loose = g.turn !== 0 ? selfDisagreement(joints, g.screen, aspect) : 0;
    const score = overlap + 0.8 * g.agree - 4 * Math.max(0, loose - 0.09);
    if (!best || score > best.total) best = { ...g, joints, vertices, overlap, total: score };
  }
  if (!best) return null;
  // Un cuerpo que no cae sobre la figura haría más daño que la pose plana.
  if (best.overlap < 0.12 && best.agree < 0.4) return null;
  const small = grayFor(bitmap, 420);
  const light = readLight({ joints: best.joints, screen: best.screen, vertices: best.vertices }, meshFaces, small.L, small.w, small.h);
  return { joints: best.joints, screen: best.screen, vertices: best.vertices, distance: Math.max(0.5, Math.abs(best.cam[2])), overlap: best.overlap, agree: best.agree, turn: best.turn, light };
}

let bodyParts: ort.InferenceSession | null = null;
let faceParts: ort.InferenceSession | null = null;

/** Qué es cada píxel: la red clasifica partes del cuerpo o de la cara en un recorte. */
async function parseParts(bitmap: ImageBitmap, box: Rect, of: 'cuerpo' | 'cara'): Promise<{ box: Rect; w: number; h: number; data: Uint8Array }> {
  const net = of === 'cuerpo' ? (bodyParts ??= await session('partes-cuerpo.onnx')) : (faceParts ??= await session('partes-cara.onnx'));
  const S = 512;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, box.x * bitmap.width, box.y * bitmap.height, box.w * bitmap.width, box.h * bitmap.height, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const n = S * S;
  const input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  const out = await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const t = out[net.outputNames[0]];
  const [, K, h, w] = t.dims as number[];
  const logits = t.data as Float32Array;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let best = 0;
    let top = -Infinity;
    for (let k = 0; k < K; k++) {
      const v = logits[k * w * h + i];
      if (v > top) ((top = v), (best = k));
    }
    data[i] = best;
  }
  return { box, w, h, data };
}

/** Recorte pensado para ilustración: separa personaje y fondo sin importar el estilo. */
async function matte(bitmap: ImageBitmap): Promise<{ mask: Uint8Array; w: number; h: number }> {
  matteNet ??= await session('isnet-anime_1024.onnx');
  const S = 1024;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const n = S * S;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = px[i * 4 + k] / 255;
  const res = await matteNet.run({ [matteNet.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const alpha = res[matteNet.outputNames[0]].data as Float32Array;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = alpha[i] > 0.25 ? 1 : 0;
  return { mask, w: S, h: S };
}

/** Línea artística: lo que un dibujante trazaría, no cada borde de la imagen. */
async function lineArt(bitmap: ImageBitmap): Promise<{ art: Uint8Array; w: number; h: number }> {
  lineNet ??= await session('line-art.onnx');
  const k = 640 / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(16, Math.round((bitmap.width * k) / 8) * 8);
  const h = Math.max(16, Math.round((bitmap.height * k) / 8) * 8);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) input[j * n + i] = px[i * 4 + j] / 255;
  const res = await lineNet.run({ [lineNet.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
  const data = res[lineNet.outputNames[0]].data as Float32Array;
  const art = new Uint8Array(n);
  for (let i = 0; i < n; i++) art[i] = Math.min(255, Math.max(0, data[i] * 255));
  return { art, w, h };
}

let depther: ort.InferenceSession | null = null;

/** Depth Anything v2: profundidad relativa de una foto, 1 lo más cercano. */
async function depthMap(bitmap: ImageBitmap) {
  depther ??= await session('onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx');
  // El modelo trabaja con parches de 14 px: cada lado debe ser múltiplo de 14.
  const k = 518 / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(14, Math.round((bitmap.width * k) / 14) * 14);
  const h = Math.max(14, Math.round((bitmap.height * k) / 14) * 14);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) input[j * n + i] = (px[i * 4 + j] / 255 - mean[j]) / std[j];
  }
  const res = await depther.run({ [depther.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
  const t = res[depther.outputNames[0]];
  const src = t.data as Float32Array;
  const dims = t.dims as number[];
  const dh = dims[dims.length - 2];
  const dw = dims[dims.length - 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of src) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Float32Array(src.length);
  const span = hi - lo || 1;
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - lo) / span;
  return { data: out, w: dw, h: dh };
}

const SAM_ID = 'Xenova/slimsam-77-uniform';
let sam: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null;
let samProcessor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let embedded: { inputs: Record<string, unknown>; embeddings: Record<string, unknown>; w: number; h: number } | null = null;

async function embed(id: number, bitmap: ImageBitmap) {
  progress(id, tx('visionWorker.preparando_figuras'));
  sam ??= await SamModel.from_pretrained(SAM_ID, { dtype: 'fp32', device: 'wasm' });
  samProcessor ??= await AutoProcessor.from_pretrained(SAM_ID);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const raw = new RawImage(new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data), w, h, 4).rgb();
  const inputs = await (samProcessor as unknown as (i: unknown) => Promise<Record<string, unknown>>)(raw);
  const embeddings = await (sam as unknown as { get_image_embeddings(i: unknown): Promise<Record<string, unknown>> }).get_image_embeddings(inputs);
  embedded = { inputs, embeddings, w, h };
}

async function segment(box?: Rect, points?: { x: number; y: number; on: boolean }[], prior?: Uint8Array) {
  if (!embedded || !sam || !samProcessor) throw new Error(tx('visionWorker.figuras_sin_preparar'));
  const { inputs, embeddings, w, h } = embedded;
  const reshaped = (inputs.reshaped_input_sizes as number[][])[0];
  const original = (inputs.original_sizes as number[][])[0];
  const sx = reshaped[1] / original[1];
  const sy = reshaped[0] / original[0];
  const prompts: { x: number; y: number; label: number }[] = [];
  if (box) {
    // SAM recibe la caja como dos puntos especiales: esquinas 2 y 3.
    prompts.push({ x: box.x * w, y: box.y * h, label: 2 }, { x: (box.x + box.w) * w, y: (box.y + box.h) * h, label: 3 });
  }
  for (const p of points ?? []) prompts.push({ x: p.x * w, y: p.y * h, label: p.on ? 1 : 0 });
  const n = prompts.length;
  const input_points = new Tensor('float32', new Float32Array(prompts.flatMap((p) => [p.x * sx, p.y * sy])), [1, 1, n, 2]);
  const input_labels = new Tensor('int64', BigInt64Array.from(prompts.map((p) => BigInt(p.label))), [1, 1, n]);
  const out = await (sam as unknown as (i: unknown) => Promise<{ pred_masks: unknown; iou_scores: { data: Float32Array } }>)({
    ...embeddings,
    input_points,
    input_labels,
  });
  const masks = await (samProcessor as unknown as { post_process_masks(...a: unknown[]): Promise<{ data: Uint8Array; dims: number[] }[]> }).post_process_masks(
    out.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes,
  );
  const scores = out.iou_scores.data;
  const t = masks[0];
  const [, count, mh, mw] = t.dims;
  let best = 0;
  let bestFit = -Infinity;
  for (let i = 0; i < count; i++) {
    const candidate = t.data.subarray(i * mw * mh, (i + 1) * mw * mh);
    // Con la malla a la mano ya no hay que adivinar: gana el candidato que más se le parece.
    const fit = prior && prior.length === candidate.length ? agreement(candidate, prior) : maskFit(candidate, mw, mh, box, points);
    if (fit + scores[i] * 0.05 > bestFit) {
      bestFit = fit + scores[i] * 0.05;
      best = i;
    }
  }
  const m = cleanMask(t.data.subarray(best * mw * mh, (best + 1) * mw * mh), mw, mh, points);
  return { mask: m, w: mw, h: mh, score: scores[best] };
}

function agreement(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let both = 0;
  let any = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) any++;
  }
  return any ? both / any : 0;
}

/** Quita motas sueltas: deja la mancha principal y cierra sus huecos chicos. */
function cleanMask(mask: ArrayLike<number>, w: number, h: number, points?: { x: number; y: number; on: boolean }[]): Uint8Array {
  const n = w * h;
  const labels = new Int32Array(n);
  const stack: number[] = [];
  const sizes: number[] = [0];
  const flood = (start: number, want: boolean, label: number) => {
    let size = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbors) {
        if (q < 0 || q >= n || labels[q]) continue;
        if (!!mask[q] === want) {
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    return size;
  };
  for (let i = 0; i < n; i++) {
    if (mask[i] && !labels[i]) sizes.push(flood(i, true, sizes.length));
  }
  const keep = new Set<number>();
  const biggest = Math.max(...sizes);
  sizes.forEach((size, label) => {
    if (label && size >= biggest * 0.08) keep.add(label);
  });
  // Lo marcado por la persona nunca se descarta.
  for (const p of points ?? []) {
    if (!p.on) continue;
    const at = Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w));
    if (labels[at]) keep.add(labels[at]);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = keep.has(labels[i]) ? 1 : 0;
  // Huecos: fondo que no toca el borde y es pequeño frente a la figura.
  const holeLimit = Math.max(40, biggest * 0.01);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (out[i] || seen[i]) continue;
    const pixels: number[] = [];
    let touchesEdge = false;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = Math.floor(p / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < n && !out[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!touchesEdge && pixels.length < holeLimit) for (const p of pixels) out[p] = 1;
  }
  return out;
}

/**
 * SAM da tres máscaras y a veces la de mayor puntaje es el fondo.
 * Se elige la que mejor llena la caja sin salirse, y que incluye los puntos marcados.
 */
function maskFit(mask: ArrayLike<number>, w: number, h: number, box?: Rect, points?: { x: number; y: number; on: boolean }[]): number {
  let total = 0;
  let inBox = 0;
  const x0 = box ? box.x * w : 0;
  const x1 = box ? (box.x + box.w) * w : w;
  const y0 = box ? box.y * h : 0;
  const y1 = box ? (box.y + box.h) * h : h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      total++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) inBox++;
    }
  }
  if (!total) return -1;
  let fit = 0;
  if (box) {
    const precision = inBox / total;
    const recall = inBox / Math.max(1, (x1 - x0) * (y1 - y0));
    fit += precision * 2 + Math.min(recall, 0.6);
  } else {
    fit += 1 - Math.min(1, total / (w * h)) * 0.6;
  }
  for (const p of points ?? []) {
    const on = mask[Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w))] ? 1 : 0;
    fit += p.on === (on === 1) ? 1 : -1;
  }
  return fit;
}

async function handle(e: MessageEvent<VisionRequest>) {
  const m = e.data;
  try {
    if (m.type === 'detect') {
      const subjects = await detect(m.id, m.bitmap);
      reply({ id: m.id, type: 'detect', subjects });
    } else if (m.type === 'embed') {
      await embed(m.id, m.bitmap);
      reply({ id: m.id, type: 'embed' });
    } else if (m.type === 'segment') {
      const r = await segment(m.box, m.points, m.prior);
      reply({ id: m.id, type: 'segment', ...r }, [r.mask.buffer]);
    } else if (m.type === 'depth') {
      progress(m.id, tx('visionWorker.midiendo_profundidad'));
      const r = await depthMap(m.bitmap);
      reply({ id: m.id, type: 'depth', ...r }, [r.data.buffer]);
    } else if (m.type === 'body') {
      const body = await body3d(m.id, m.bitmap, m.box, m.evidence, m.quick);
      reply({ id: m.id, type: 'body', body }, body ? [body.joints.buffer, body.screen.buffer, body.vertices.buffer] : []);
    } else if (m.type === 'matte') {
      const r = await matte(m.bitmap);
      reply({ id: m.id, type: 'matte', ...r }, [r.mask.buffer]);
    } else if (m.type === 'line') {
      const r = await lineArt(m.bitmap);
      reply({ id: m.id, type: 'line', ...r }, [r.art.buffer]);
    } else if (m.type === 'partes') {
      const r = await parseParts(m.bitmap, m.box, m.of);
      reply({ id: m.id, type: 'partes', ...r }, [r.data.buffer]);
    } else if (m.type === 'animal') {
      reply({ id: m.id, type: 'animal', animal: await animalPose(m.bitmap, m.box) });
    } else if (m.type === 'pose') {
      const results: { id: string; pose: Subject['pose'] }[] = [];
      for (const b of m.boxes) results.push({ id: b.id, pose: await bestPose(m.id, m.bitmap, b.box) });
      reply({ id: m.id, type: 'pose', results });
    }
  } catch (err) {
    console.error(err);
    reply({ id: m.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// Un trabajo a la vez: los modelos comparten hilos y no conviene encimarlos.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<VisionRequest>) => {
  if ((e.data as { type: string }).type === 'locale') return setLocale((e.data as unknown as { locale: Locale }).locale);
  queue = queue.then(() => handle(e));
};
