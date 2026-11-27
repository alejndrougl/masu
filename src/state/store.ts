import type { ShapePick } from '../lib/shapes';
import type { DrawStyle } from '../lib/organic';
import { create } from 'zustand';
import type { SimplifyParams } from '../lib/simplify';
import type { Perspective, VanishingPoint } from '../lib/perspective';
import type { Technique } from '../lib/plan';
import type { CanvasSize, Crop, DominantLine, Figure, GridOptions, Rect, Stroke, Subject, Swatch, ToneStats } from '../lib/types';
import type { RigEdit } from '../lib/rig';

import { t, getLocale, setLocale, STORAGE_KEY, type Locale } from '../i18n';
function savedTheme(): Theme {
  try {
    return localStorage.getItem('masu-tema') === 'tinta' ? 'tinta' : 'papel';
  } catch {
    return 'papel';
  }
}

export const MODES = [
  { id: 'lectura', get name() { return t('store.lectura'); }, key: '1' },
  { id: 'lienzo', get name() { return t('store.lienzo'); }, key: '2' },
  { id: 'cuadros', get name() { return t('store.cuadros'); }, key: '3' },
  { id: 'valores', get name() { return t('common.valores'); }, key: '4' },
  { id: 'color', get name() { return t('common.color'); }, key: '5' },
  { id: 'sujetos', get name() { return t('store.sujetos'); }, key: '6' },
  { id: 'composicion', get name() { return t('common.composicion'); }, key: '7' },
  { id: 'perspectiva', get name() { return t('common.perspectiva'); }, key: 'p' },
  { id: 'luz', get name() { return t('common.luz'); }, key: 'l' },
  { id: 'construccion', get name() { return t('store.construccion'); }, key: '8' },
  { id: 'figuras', get name() { return t('common.figuras'); }, key: '9' },
  { id: 'encaje', get name() { return t('common.encaje'); }, key: '0' },
  { id: 'simplificar', get name() { return t('store.simplificar'); }, key: '-' },
  { id: 'pintar', get name() { return t('store.pintar'); }, key: '=' },
] as const;

export type Mode = (typeof MODES)[number]['id'];
export type Base = 'foto' | 'valores' | 'simple' | 'mapa';
export type Theme = 'papel' | 'tinta';
export type MapKind = 'temperatura' | 'saturacion' | 'bordes';
export type ValueView = 'zonas' | 'escala' | 'notan';
export type Style = 'manchas' | 'planos' | 'tinta' | 'numeros' | 'proceso';
export type Tool = 'ninguna' | 'medir' | 'gotero';

export interface Frame {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  L: Uint8Array;
  stats: ToneStats;
  palette: Swatch[];
  peaks: { x: number; y: number; weight: number }[];
  lines: DominantLine[];
  perspective: Perspective;
  /** Mapa de atención, 64 × 64. */
  attention: Float32Array;
  /** Miniatura de claridad, 48 × 48. */
  tiny: Uint8Array;
  /** Cálido, neutro y frío. */
  temperature: number[];
  /** Rectángulo de la imagen del que salió, en píxeles. */
  rect: Rect;
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  blob: Blob;
  name: string;
  w: number;
  h: number;
}

export interface CompositionLayers {
  spiral: boolean;
  golden: boolean;
  thirds: boolean;
  diagonals: boolean;
  /** null: la que mejor encaje. */
  turn: 0 | 1 | 2 | 3 | null;
}

export interface Sample {
  id: number;
  rgb: [number, number, number];
  hex: string;
  value: number;
}

export interface Compare {
  canvas: OffscreenCanvas;
  /** Diferencia de valor por cuadro: negativo, tu pintura está más oscura. */
  cells: { name: string; diff: number }[];
}

/** Niveles de construcción, de la línea de acción al dibujo final. */
export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface State {
  theme: Theme;
  /** Idioma de la interfaz; se guarda y se refleja en <html lang>. */
  locale: Locale;
  mode: Mode;
  base: Base;
  image: LoadedImage | null;
  canvas: CanvasSize;
  crop: Crop;
  grid: GridOptions;
  frame: Frame | null;
  thresholds: [number, number, number];
  zones: [boolean, boolean, boolean, boolean];
  subjects: Subject[];
  visionStep: string | null;
  visionError: string | null;
  figures: Figure[];
  figuresReady: boolean;
  /** Profundidad relativa de la imagen completa, 1 lo más cercano. */
  depth: { data: Float32Array; w: number; h: number } | null;
  /** Triángulos de la malla del cuerpo: son los mismos para toda figura. */
  bodyFaces: Int32Array | null;
  selectedSubject: string | null;
  selectedFigure: string | null;
  silhouette: boolean;
  faceGuides: boolean;
  focus: { col: number; row: number } | null;
  done: string[];
  composition: CompositionLayers;
  scheme: string | null;
  /** Puntos de fuga editados a mano; null usa los detectados. */
  vpEdit: VanishingPoint[] | null;
  vpHidden: number[];
  vpAdd: boolean;
  vpFit: boolean;
  pv: { lines: boolean; fan: boolean; horizon: boolean; circle: boolean };
  /** Qué se ve de la lectura de luz. */
  luz: { rays: boolean; terminator: boolean; shadows: boolean; cast: boolean; accents: boolean; rim: boolean; view: 'foto' | 'zonas' | 'yeso' };
  /** Luz principal movida a mano, en grados; null usa la leída. */
  lightEdit: { azimuth: number; elevation: number } | null;
  /** Pliegues de la ropa sobre la construcción. */
  folds: boolean;
  /** Práctica de pose rápida: cuándo termina (ms) y de cuántos segundos es. */
  quick: { until: number; seconds: number } | null;
  /** Lectura con la curvatura que eligió el pintor. */
  lensRead: Perspective | null;
  balance: boolean;
  attention: boolean;
  construction: Level;
  /** Etapa de la cara, si se está viendo una en particular. */
  faceStage: number | null;
  /** Rasgo que se está viendo de cerca, y hasta qué etapa. */
  detail: { id: string; stage: number } | null;
  /** Figura elegida para construir; sin valor, las principales. */
  figurePick: string | null;
  /** Rectas que llevan al foco. */
  leadLines: boolean;
  /** Plomadas sobre el encaje. */
  plumb: boolean;
  /** Ver las partes de cada figura. */
  showParts: boolean;
  /** Detalle solo alrededor del foco. */
  focusDetail: boolean;
  /** Encaje y líneas interiores de las figuras que se construyen. */
  formStrokes: Stroke[];
  /** Cómo se resuelve el cuerpo en los volúmenes. */
  bodyMethod: 'organico' | 'figuras' | 'maniqui' | 'frijol' | 'cajas';
  /** Cómo se dibuja el cuerpo: cambia grosor, curvas y cuántas líneas lleva. */
  drawStyle: DrawStyle;
  /** Cuánto se exagera la pose y las formas, de 0 a 1. */
  exaggeration: number;
  /** Cuánto se simplifica: menos líneas de forma y curvas más sencillas, de 0 a 1. */
  simplification: number;
  /** Lo que el pintor cambió de cada figura, por sujeto y parte. */
  shapePicks: Record<string, Record<string, ShapePick>>;
  /** La parte abierta en el selector de figuras. */
  shapePart: string | null;
  /** Flechas que siguen el movimiento por brazos y piernas. */
  flowLines: boolean;
  /** Método de cabeza; sin valor, el que le queda a esta cara. */
  headMethod: string | null;
  /** Correcciones del pintor al esqueleto, por figura. */
  rigEdits: Record<string, RigEdit>;
  /** Se muestran las articulaciones para moverlas. */
  rigHandles: boolean;
  /** Pieza del maniquí hasta la que se muestra: null, todas. */
  pieceStep: number | null;
  /** Parte que se ve de cerca, normalizada al encuadre. */
  closeUp: Rect | null;
  forceLines: boolean;
  loomis: boolean;
  simplify: SimplifyParams;
  style: Style;
  processStep: 1 | 2 | 3 | 4;
  polyCount: number;
  simplified: { canvas: OffscreenCanvas; swatches: Swatch[]; numbers?: { x: number; y: number; n: number }[] } | null;
  /** Sube con cada resultado: la capa solo se repinta si cambió. */
  simplifiedRun: number;
  maps: Partial<Record<MapKind, { canvas: OffscreenCanvas; shares: number[] }>>;
  mapKind: MapKind;
  valueView: ValueView;
  valueSteps: number;
  squint: number;
  ink: OffscreenCanvas | null;
  mirror: boolean;
  upside: boolean;
  peek: boolean;
  tool: Tool;
  samples: Sample[];
  tubes: string[];
  technique: Technique;
  pace: number;
  planView: 'ninguno' | 'dificultad' | 'ruta' | 'valores';
  focusMode: boolean;
  seconds: number;
  compare: Compare | null;
  compareSlider: number;
  compareSource: Blob | null;
  help: boolean;
  encajeStage: 1 | 2 | 3 | 4;
  encajePhoto: number;
  /** Paso 10: conservar el fondo de la imagen en vez de dejar solo la figura. */
  keepBackground: boolean;
  encajeRun: number;
  /** Bloque del encaje hasta el que se muestra: null, todos. */
  encajePiece: number | null;
  strokes: Stroke[];
  busy: string | null;
}

export const initialState: State = {
  theme: savedTheme(),
  locale: getLocale(),
  mode: 'lectura',
  base: 'foto',
  image: null,
  canvas: { w: 30, h: 40, unit: 'cm' },
  crop: { cx: 0.5, cy: 0.5, zoom: 1 },
  grid: { cell: 5, origin: 'corner', diagonals: false, half: false, labels: true, visible: true, opacity: 0.7, rhombus: false },
  frame: null,
  thresholds: [64, 128, 192],
  zones: [false, false, false, false],
  subjects: [],
  visionStep: null,
  visionError: null,
  figures: [],
  figuresReady: false,
  depth: null,
  bodyFaces: null,
  selectedSubject: null,
  selectedFigure: null,
  silhouette: false,
  faceGuides: true,
  focus: null,
  done: [],
  composition: { spiral: false, golden: false, thirds: false, diagonals: false, turn: null },
  scheme: null,
  vpEdit: null,
  vpHidden: [],
  vpAdd: false,
  vpFit: false,
  pv: { lines: true, fan: false, horizon: true, circle: true },
  luz: { rays: true, terminator: true, shadows: true, cast: true, accents: true, rim: true, view: 'foto' },
  lightEdit: null,
  folds: false,
  quick: null,
  lensRead: null,
  balance: false,
  attention: false,
  construction: 1,
  faceStage: null,
  detail: null,
  figurePick: null,
  leadLines: false,
  plumb: false,
  showParts: false,
  focusDetail: false,
  formStrokes: [],
  bodyMethod: 'organico',
  drawStyle: 'realista',
  exaggeration: 0,
  simplification: 0.3,
  shapePicks: {},
  shapePart: null,
  flowLines: true,
  headMethod: null,
  rigEdits: {},
  rigHandles: false,
  pieceStep: null,
  closeUp: null,
  forceLines: false,
  loomis: false,
  simplify: { radius: 5, colors: 6, mode: 'color', clean: 1 },
  style: 'manchas',
  processStep: 1,
  polyCount: 900,
  simplified: null,
  simplifiedRun: 0,
  maps: {},
  mapKind: 'temperatura',
  valueView: 'zonas',
  valueSteps: 5,
  squint: 0,
  ink: null,
  mirror: false,
  upside: false,
  peek: false,
  tool: 'ninguna',
  samples: [],
  tubes: ['blanco', 'amarillo', 'ocre', 'rojo', 'carmin', 'siena', 'sombra', 'ultramar', 'cobalto', 'vejiga', 'negro'],
  technique: 'oleo',
  pace: 0.45,
  planView: 'ninguno',
  focusMode: false,
  seconds: 0,
  compare: null,
  compareSlider: 0.5,
  compareSource: null,
  help: false,
  encajeStage: 1,
  encajePhoto: 0.12,
  keepBackground: false,
  encajeRun: 0,
  encajePiece: null,
  strokes: [],
  busy: null,
};

export const useStore = create<State>(() => initialState);

/** Al cambiar el idioma se avisa a t(), se guarda la preferencia y se pone <html lang>. */
function applyLocale(l: Locale) {
  setLocale(l);
  try {
    document.documentElement.lang = l;
  } catch {
    /* sin documento (pruebas, workers) */
  }
}
applyLocale(initialState.locale);
useStore.subscribe((s, prev) => {
  if (s.locale === prev.locale) return;
  applyLocale(s.locale);
  try {
    localStorage.setItem(STORAGE_KEY, s.locale);
  } catch {
    /* sin almacenamiento */
  }
});

export const get = useStore.getState;
export const set = useStore.setState;
