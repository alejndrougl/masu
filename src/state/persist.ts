import type { CanvasSize, Crop, GridOptions } from '../lib/types';

import { t as tt } from '../i18n';
export interface SavedProject {
  id: string;
  blob: Blob;
  name: string;
  canvas: CanvasSize;
  crop: Crop;
  grid: GridOptions;
  done: string[];
  seconds: number;
  thumb: string;
  updated: number;
}

export type ProjectCard = Pick<SavedProject, 'id' | 'name' | 'thumb' | 'updated' | 'done' | 'canvas'>;

const DB = 'masu';
const STORE = 'proyectos';
const KEEP = 12;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains('proyecto')) db.deleteObjectStore('proyecto');
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(p: SavedProject) {
  try {
    await tx('readwrite', (s) => s.put(p));
    const all = await tx<SavedProject[]>('readonly', (s) => s.getAll());
    const extra = all.sort((a, b) => b.updated - a.updated).slice(KEEP);
    for (const old of extra) await tx('readwrite', (s) => s.delete(old.id));
  } catch (err) {
    console.warn(tt('persist.no_se_pudo_guardar'), err);
  }
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  try {
    return (await tx<SavedProject | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<ProjectCard[]> {
  try {
    const all = await tx<SavedProject[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.updated - a.updated).slice(0, 6);
  } catch {
    return [];
  }
}

export async function deleteProject(id: string) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* sin almacenamiento no hay nada que borrar */
  }
}
