import type { Body3D } from './body';
import type { PartMap } from './parts';
export type Unit = 'cm' | 'in';
export type Pt = [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasSize {
  w: number;
  h: number;
  unit: Unit;
}

/** Encuadre: centro normalizado sobre la imagen y zoom sobre el recorte máximo. */
export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export type GridOrigin = 'corner' | 'center';

export interface GridOptions {
  cell: number;
  origin: GridOrigin;
  diagonals: boolean;
  half: boolean;
  labels: boolean;
  visible: boolean;
  opacity: number;
  rhombus: boolean;
}

/** Resultado del análisis tonal de un encuadre. */
export interface ToneStats {
  hist: number[];
  thresholds: [number, number, number];
  shares: [number, number, number, number];
  mean: number;
  /** Mapa posición-horizontal × valor (espectrograma tonal). */
  wave: { w: number; h: number; data: Uint8Array; color?: Uint8Array };
  /** Color promedio de cada valor: 256 × RGB. */
  tint: Uint8Array;
  /** Histograma por canal. */
  rgb: [number[], number[], number[]];
  /** 0 gris puro, cerca de 1 muy cromática. */
  chroma: number;
  /** Reparto del color por tono, 72 cubetas. */
  hue: number[];
  /** Fracción de píxeles con color visible (no grises). Casi 0 en una imagen acromática. */
  colored?: number;
}

export interface Swatch {
  rgb: [number, number, number];
  hex: string;
  share: number;
  pigment: string;
}

export type SubjectKind = 'human-face' | 'anime-face' | 'animal-face' | 'head' | 'animal' | 'person' | 'anime-person' | 'object' | 'hand' | 'foot';

/** 21 puntos de una mano: muñeca y cuatro por dedo, del pulgar al meñique. */
export interface HandMarks {
  pts: Pt[];
  vis: number[];
  /** Metros, con z hacia quien mira: solo cuando el modelo los da. */
  world?: [number, number, number][];
  score: number;
  source: 'malla' | 'caja';
}

/** Rasgos de un dibujo: ojos detectados y, si la cara viene derecha, sus 24 puntos. */
export interface DrawnFace {
  eyes: Rect[];
  marks?: { pts: Pt[]; vis: number[] };
}

/** 17 puntos de un animal, en el orden de AP-10K. */
export interface AnimalMarks {
  pts: Pt[];
  vis: number[];
}

export interface Subject {
  id: string;
  kind: SubjectKind;
  label: string;
  score: number;
  /** Normalizado sobre la imagen completa. */
  box: Rect;
  /** Rostro: 478 puntos. Cuerpo: 133 puntos (COCO-WholeBody). Normalizados sobre la imagen. */
  face?: Pt[];
  pose?: { pts: Pt[]; vis: number[] };
  /** Giro de cabeza en grados, si hay matriz facial. */
  turn?: { yaw: number; pitch: number; roll: number };
  /** Cuerpo 3D, normalizado sobre la imagen completa. */
  body?: Body3D;
  hand?: HandMarks;
  drawn?: DrawnFace;
  animal?: AnimalMarks;
  /** Qué es cada píxel de su cuerpo. */
  parts?: PartMap;
  /** Qué es cada píxel de su cabeza. */
  headParts?: PartMap;
}

export interface Figure {
  id: string;
  label: string;
  /** Máscara sobre la imagen completa. */
  w: number;
  h: number;
  mask: Uint8Array;
  source: 'auto' | 'click';
  box: Rect;
}

export type StrokeStage = 1 | 2 | 3 | 4;

export interface Stroke {
  /** Normalizado sobre el encuadre. */
  pts: Pt[];
  stage: StrokeStage;
  closed: boolean;
  /** Qué parte dibuja, si se sabe. */
  name?: string;
}

export interface DominantLine {
  a: Pt;
  b: Pt;
  strength: number;
  angle: number;
}
