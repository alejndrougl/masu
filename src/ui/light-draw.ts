import { alignment, selfDisagreement, vertexNormals } from '../lib/body';
import { clay, exposure, faceSides, lightFrom, lightWords, rasterNormals, readLighting, ZONE, type LightInput, type LightRead, type LightSource } from '../lib/light';
import { maskContours, simplifyLine, toPath } from '../lib/edges';
import type { Pt } from '../lib/types';
import { figureInFrame } from '../state/engine';
import type { State } from '../state/store';
import { figureModels, isScene, mainFigures, type Prim, type View } from './overlays';
import { AMARILLO, DARK, LIGHT, ROJO } from './palette';

import { t as tx } from '../i18n';
/** Azul de dato, el mismo de Comparar: aquí marca lo que una forma le tapa a otra. */
export const AZUL = '#2C609E';

const LONG = 300;

let cache: { key: unknown[]; value: LightRead | null } | null = null;

/** Normales de las mallas de las figuras, llevadas al encuadre. */
function meshNormals(s: State, ids: Set<string>, w: number, h: number): Float32Array | null {
  const { frame, image, bodyFaces } = s;
  if (!frame || !image || !bodyFaces) return null;
  let out: Float32Array | null = null;
  const aspect = image.w / image.h;
  for (const sub of s.subjects) {
    if (!sub.body || !ids.has(sub.id)) continue;
    const V = sub.body.vertices;
    const n = V.length / 3;
    const { k, ox, oy } = alignment(sub.body.joints, sub.body.screen, aspect, selfDisagreement(sub.body.joints, sub.body.screen, aspect, false) > 0.06);
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pz = new Float32Array(n);
    const vn = vertexNormals(V, bodyFaces);
    // La orientación de las caras se decide con quién mira hacia afuera del cuerpo.
    let flip = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      mx += V[i * 3];
      my += V[i * 3 + 1];
      mz += V[i * 3 + 2];
    }
    mx /= n;
    my /= n;
    mz /= n;
    for (let i = 0; i < n; i += 7) flip += vn[i * 3] * (V[i * 3] - mx) + vn[i * 3 + 1] * (V[i * 3 + 1] - my) + vn[i * 3 + 2] * (V[i * 3 + 2] - mz);
    const sign = flip >= 0 ? 1 : -1;
    const view = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      px[i] = ((((V[i * 3] * k + ox) / aspect) * image.w - frame.rect.x) / frame.rect.w) * w;
      py[i] = (((V[i * 3 + 1] * k + oy) * image.h - frame.rect.y) / frame.rect.h) * h;
      pz[i] = V[i * 3 + 2];
      view[i * 3] = vn[i * 3] * sign;
      view[i * 3 + 1] = vn[i * 3 + 1] * sign;
      // En la malla z se aleja de la cámara; aquí z mira a quien ve.
      view[i * 3 + 2] = -vn[i * 3 + 2] * sign;
    }
    const map = rasterNormals(px, py, pz, view, bodyFaces, w, h);
    if (!out) out = map;
    else for (let i = 0; i < map.length; i++) if (map[i] !== 0) out[i] = map[i];
  }
  return out;
}

/** Lo que se le da al lector de luz: la imagen reducida, la figura, sus normales o la profundidad. */
export function lightInput(s: State): LightInput | null {
  const { frame, image } = s;
  if (!frame || !image) return null;
  const k = LONG / Math.max(frame.w, frame.h);
  const w = Math.max(8, Math.round(frame.w * k));
  const h = Math.max(8, Math.round(frame.h * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const src = new OffscreenCanvas(frame.w, frame.h);
  src.getContext('2d')!.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h), 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  {
    const scene = isScene(s);
    const main = mainFigures(figureModels(s).list, s);
    const ids = new Set(main.map((m) => m.id));
    let mask: Uint8Array | null = null;
    if (!scene) {
      mask = new Uint8Array(w * h);
      for (const f of s.figures) {
        if (!ids.has(f.id)) continue;
        const m = figureInFrame(f, frame.rect, w, h);
        for (let i = 0; i < m.length; i++) if (m[i]) mask[i] = 1;
      }
      if (!mask.some((v) => v)) mask = null;
    }
    let depth: Float32Array | null = null;
    if (!mask && s.depth) {
      depth = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(s.depth.h - 1, Math.max(0, Math.floor(((frame.rect.y + ((y + 0.5) / h) * frame.rect.h) / image.h) * s.depth.h)));
        for (let x = 0; x < w; x++) {
          const sx = Math.min(s.depth.w - 1, Math.max(0, Math.floor(((frame.rect.x + ((x + 0.5) / w) * frame.rect.w) / image.w) * s.depth.w)));
          depth[y * w + x] = s.depth.data[sy * s.depth.w + sx];
        }
      }
    }
    let emphasis: Uint8Array | null = null;
    if (mask) {
      for (const m of main) {
        if (!m.head || m.head.r <= 0) continue;
        emphasis ??= new Uint8Array(w * h);
        const cx = m.head.c[0] * w;
        const cy = m.head.c[1] * h;
        const r = m.head.r * h;
        for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
          for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && mask[y * w + x]) emphasis[y * w + x] = 1;
          }
        }
      }
    }
    return { rgba, w, h, mask, normals: mask ? meshNormals(s, ids, w, h) : null, depth, emphasis };
  }
}

/** La lectura de luz del encuadre: de sus figuras principales o, sin ellas, del lugar. */
export function lightOf(s: State): LightRead | null {
  const { frame, image } = s;
  if (!frame || !image || !s.figuresReady) return null;
  const key = [frame, s.figures, s.subjects, s.depth, s.bodyFaces, s.figurePick];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.value;
  let value: LightRead | null = null;
  try {
    const input = lightInput(s);
    if (input) value = readLighting(input);
    if (value) value = checkWithFace(value, s);
  } catch (err) {
    console.error(tx('lightDraw.luz_sin_leer'), err);
  }
  cache = { key, value };
  return value;
}

/**
 * En un retrato la prueba más directa de dónde viene la luz es la cara: qué mejilla está más
 * clara. Si el cuerpo no da dirección y una cara grande la muestra clara, se toma de la cara. Si
 * la cara dice lo contrario que el cuerpo, no se afirma ninguna: mejor callar que mentir.
 */
function checkWithFace(read: LightRead, s: State): LightRead {
  const { frame, image } = s;
  if (!frame || !image || read.scene) return read;
  const faces = s.subjects
    .filter((q) => q.kind === 'human-face' || q.kind === 'anime-face')
    .map((q) => ({ x: (q.box.x * image.w - frame.rect.x) / frame.rect.w, y: (q.box.y * image.h - frame.rect.y) / frame.rect.h, w: (q.box.w * image.w) / frame.rect.w, h: (q.box.h * image.h) / frame.rect.h }))
    .filter((b) => b.w * b.h > 0.015 && b.x > -0.05 && b.y > -0.05 && b.x + b.w < 1.05 && b.y + b.h < 1.05)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  if (!faces.length) return read;
  const sides = faceSides(frame.rgba, frame.w, frame.h, faces[0]);
  if (!sides.sure) return read;
  const main = read.lights.find((l) => l.role === 'principal');
  if (main && Math.abs(main.dir[0]) > 0.25 && Math.sign(main.dir[0]) !== Math.sign(sides.side)) {
    return { ...read, lights: [], flat: true, faceConflict: true, terminator: [], cast: [], ground: [], groundDir: null };
  }
  if (!main && read.flat && Math.abs(sides.side) > 0.15) {
    // Solo el lado: qué tan alta o de frente viene no se puede medir en una mejilla.
    const fromFace = lightFrom(sides.side > 0 ? 35 : 145, 35, 'principal', 1);
    return { ...read, lights: [{ ...fromFace, sure: 0.35 }], fromFace: true };
  }
  return read;
}

/** Las luces que se dibujan: las leídas, con la principal cambiada si el pintor la movió. */
export function shownLights(s: Pick<State, 'lightEdit'>, read: LightRead): LightSource[] {
  if (!s.lightEdit) return read.lights;
  const mine = lightFrom(s.lightEdit.azimuth, s.lightEdit.elevation);
  return [mine, ...read.lights.filter((l) => l.role !== 'principal')];
}

export const ROLE_NAME: Record<LightSource['role'], string> = { get principal() { return tx('lightDraw.luz_principal'); }, get relleno() { return tx('lightDraw.luz_de_relleno'); }, get contraluz() { return tx('common.contraluz'); }, get rebote() { return tx('lightDraw.luz_de_rebote'); } };

/** Dónde se dibuja el sol de una luz, en unidades de la vista. */
export function sunPlace(read: LightRead, l: LightSource, v: View, order: number): { at: Pt; u: Pt; flat: boolean } {
  const flat = Math.hypot(l.dir[0], l.dir[1]);
  const C: Pt = [read.center[0] * v.W, read.center[1] * v.H];
  const rho = read.radius * Math.max(v.W, v.H);
  if (flat < 0.3) return { at: [C[0] + (order - 0.5) * 60 * v.unit, C[1] - rho * 0.2], u: [0, 0], flat: true };
  const u: Pt = [l.dir[0] / flat, l.dir[1] / flat];
  const m = 34 * v.unit;
  let t = rho * 1.12 + 46 * v.unit;
  // El sol se queda dentro de la hoja, aunque la figura la llene.
  if (u[0] > 0) t = Math.min(t, (v.W - m - C[0]) / u[0]);
  if (u[0] < 0) t = Math.min(t, (m - C[0]) / u[0]);
  if (u[1] > 0) t = Math.min(t, (v.H - m - C[1]) / u[1]);
  if (u[1] < 0) t = Math.min(t, (m - C[1]) / u[1]);
  return { at: [C[0] + u[0] * t, C[1] + u[1] * t], u, flat: false };
}

function sunIcon(at: Pt, r: number, role: LightSource['role'], label: string, unit: number): Prim[] {
  const out: Prim[] = [];
  const main = role === 'principal';
  let spikes = '';
  const count = main ? 12 : 8;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    spikes += `M${at[0] + Math.cos(a) * r * 1.3} ${at[1] + Math.sin(a) * r * 1.3}L${at[0] + Math.cos(a) * r * 1.75} ${at[1] + Math.sin(a) * r * 1.75}`;
  }
  const ring = `M${at[0] - r} ${at[1]}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  out.push({ t: 'path', d: spikes, stroke: DARK, w: 4, alpha: 0.55, cap: 'round' }, { t: 'path', d: spikes, stroke: role === 'contraluz' ? LIGHT : AMARILLO, w: 2, cap: 'round' });
  out.push({ t: 'path', d: ring, fill: role === 'contraluz' ? DARK : main ? AMARILLO : LIGHT, stroke: role === 'contraluz' ? AMARILLO : DARK, w: 1.6, alpha: 1 });
  out.push({ t: 'text', x: at[0], y: at[1] + r * 0.42, s: label, size: 13 * unit, fill: role === 'contraluz' ? AMARILLO : DARK, anchor: 'middle', weight: 700 });
  return out;
}

function arrow(a: Pt, b: Pt, head: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const lx = b[0] - ux * head;
  const ly = b[1] - uy * head;
  return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}M${(lx - uy * head * 0.5).toFixed(1)} ${(ly + ux * head * 0.5).toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${(lx + uy * head * 0.5).toFixed(1)} ${(ly - ux * head * 0.5).toFixed(1)}`;
}

/** Rayos paralelos desde el sol hasta donde tocan la figura. */
function rays(read: LightRead, l: LightSource, v: View, place: { at: Pt; u: Pt }): string {
  const { W, H } = v;
  const kx = read.w / W;
  const ky = read.h / H;
  const rho = read.radius * Math.max(W, H);
  const perp: Pt = [-place.u[1], place.u[0]];
  const spread = l.role === 'principal' ? [-0.62, -0.31, 0, 0.31, 0.62] : l.role === 'rebote' ? [-0.25, 0.25] : [-0.4, 0, 0.4];
  let d = '';
  const step = 1 / Math.max(kx, ky);
  for (const o of spread) {
    const a: Pt = [place.at[0] + perp[0] * o * rho, place.at[1] + perp[1] * o * rho];
    let hit: Pt | null = null;
    let wasOut = false;
    for (let t = 24 * v.unit; t < rho * 3.2; t += step) {
      const x = a[0] - place.u[0] * t;
      const y = a[1] - place.u[1] * t;
      if (x < 0 || y < 0 || x >= W || y >= H) {
        if (wasOut) break;
        continue;
      }
      const inside = read.scene ? t > rho * 0.55 : read.zones[Math.min(read.h - 1, Math.floor(y * ky)) * read.w + Math.min(read.w - 1, Math.floor(x * kx))] > 0;
      if (!inside) wasOut = true;
      else if (wasOut || read.scene) {
        hit = [x + place.u[0] * 5 * v.unit, y + place.u[1] * 5 * v.unit];
        break;
      }
    }
    if (!hit) continue;
    const from: Pt = [a[0] - place.u[0] * 24 * v.unit, a[1] - place.u[1] * 24 * v.unit];
    if (Math.hypot(hit[0] - from[0], hit[1] - from[1]) < 18 * v.unit) continue;
    d += arrow(from, hit, 9 * v.unit);
  }
  return d;
}

const pathOf = (list: Pt[][], v: View, closed: boolean) => list.map((l) => toPath(l, closed, v.W, v.H)).join('');

/** Rayas diagonales dentro de unas manchas, para marcar sombra sin tapar la foto. */
function hatchOf(read: LightRead, zone: number[], v: View, gap: number): string {
  const { w, h, zones } = read;
  let d = '';
  const sx = v.W / w;
  const sy = v.H / h;
  for (let c = -h; c < w; c += gap) {
    let start: Pt | null = null;
    for (let y = 0; y < h; y++) {
      const x = c + y;
      const inside = x >= 0 && x < w && zone.includes(zones[y * w + x]);
      if (inside && !start) start = [x, y];
      if (!inside && start) {
        if (y - start[1] >= 2) d += `M${(start[0] * sx).toFixed(1)} ${(start[1] * sy).toFixed(1)}L${(x * sx).toFixed(1)} ${(y * sy).toFixed(1)}`;
        start = null;
      }
    }
    if (start) d += `M${(start[0] * sx).toFixed(1)} ${(start[1] * sy).toFixed(1)}L${((c + h) * sx).toFixed(1)} ${(h * sy).toFixed(1)}`;
  }
  return d;
}

/** Dónde quedaría el terminador con otra luz: donde la forma deja de mirarla. */
function predictedTerminator(read: LightRead, lights: LightSource[]): Pt[][] {
  const { w, h } = read;
  const front = lights.filter((l) => l.role !== 'contraluz');
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) if (read.zones[i] && exposure(read.normals, i, front) < 0.06) dark[i] = 1;
  const out: Pt[][] = [];
  const isOut = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || !read.zones[y * w + x];
  for (const loop of maskContours(dark, w, h)) {
    if (loop.length < 10) continue;
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= 8) out.push(simplifyLine(run, 0.9).map(([x, y]) => [x / w, y / h] as Pt));
      run = [];
    };
    for (const p of loop) {
      const edge = isOut(p[0] - 1, p[1] - 1) || isOut(p[0], p[1] - 1) || isOut(p[0] - 1, p[1]) || isOut(p[0], p[1]);
      if (edge) flush();
      else run.push(p);
    }
    flush();
  }
  return out;
}

let predicted: { read: LightRead; key: string; value: Pt[][] } | null = null;

export function lightPrims(s: State, v: View): Prim[] {
  const read = lightOf(s);
  const out: Prim[] = [];
  if (!read) return out;
  const { luz } = s;
  const lights = shownLights(s, read);
  const photo = luz.view === 'foto';
  const edited = !!s.lightEdit;
  if (!read.flat || edited) {
    if (luz.shadows && photo && !edited) {
      const hatch = hatchOf(read, [ZONE.propia, ZONE.oclusion], v, 5);
      if (hatch) out.push({ t: 'path', d: hatch, stroke: LIGHT, w: 2.2, alpha: 0.35 }, { t: 'path', d: hatch, stroke: DARK, w: 1, alpha: 0.8 });
    }
    if (luz.cast && !edited && luz.view !== 'yeso') {
      const all = [...read.cast, ...read.ground];
      if (all.length) {
        const d = pathOf(all, v, true);
        if (photo) out.push({ t: 'path', d, fill: AZUL, alpha: 0.34, even: true });
        out.push({ t: 'path', d, stroke: LIGHT, w: 3, alpha: 0.6 }, { t: 'path', d, stroke: AZUL, w: 1.6, dash: [7, 4] });
      }
    }
    if (luz.terminator) {
      if (edited) {
        const key = `${s.lightEdit!.azimuth}|${s.lightEdit!.elevation}`;
        if (!predicted || predicted.read !== read || predicted.key !== key) predicted = { read, key, value: predictedTerminator(read, lights) };
        const d = pathOf(predicted.value, v, false);
        if (d) out.push({ t: 'path', d, stroke: LIGHT, w: 4.5, alpha: 0.6, cap: 'round' }, { t: 'path', d, stroke: ROJO, w: 2.2, cap: 'round', dash: [10, 5] });
      } else if (read.terminator.length && luz.view !== 'yeso') {
        const d = pathOf(read.terminator, v, false);
        out.push({ t: 'path', d, stroke: LIGHT, w: 4.5, alpha: 0.6, cap: 'round' }, { t: 'path', d, stroke: ROJO, w: 2.2, cap: 'round' });
      }
    }
    if (luz.rim && read.rim.length && !edited && luz.view !== 'yeso') {
      const d = pathOf(read.rim, v, false);
      out.push({ t: 'path', d, stroke: DARK, w: 6, alpha: 0.5, cap: 'round' }, { t: 'path', d, stroke: AMARILLO, w: 3, cap: 'round' });
    }
    if (luz.accents && !edited && luz.view !== 'yeso') {
      if (read.occlusion.length) {
        const d = pathOf(read.occlusion, v, true);
        out.push({ t: 'path', d, fill: DARK, alpha: 0.9, stroke: LIGHT, w: 1.2 });
      }
      for (const hl of read.highlights) {
        const x = hl.c[0] * v.W;
        const y = hl.c[1] * v.H;
        const r = Math.max(7 * v.unit, hl.r * Math.max(v.W, v.H) * 1.5);
        const d = `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0ZM${x - r * 1.7} ${y}H${x - r * 1.15}M${x + r * 1.15} ${y}H${x + r * 1.7}M${x} ${y - r * 1.7}V${y - r * 1.15}M${x} ${y + r * 1.15}V${y + r * 1.7}`;
        out.push({ t: 'path', d, stroke: DARK, w: 3.4, alpha: 0.6 }, { t: 'path', d, stroke: AMARILLO, w: 1.7 });
      }
    }
  }
  if (luz.rays) {
    lights.forEach((l, i) => {
      const place = sunPlace(read, l, v, i);
      const r = (l.role === 'principal' ? 13 : 10.5) * v.unit;
      if (place.flat) {
        // De frente o de atrás no hay rayo que cruce la hoja: se marca sobre la figura.
        const q = r * 2.1;
        const mark = l.dir[2] > 0 ? `M${place.at[0] - q} ${place.at[1]}a${q} ${q} 0 1 0 ${q * 2} 0a${q} ${q} 0 1 0 ${-q * 2} 0Z` : `M${place.at[0] - q} ${place.at[1] - q}L${place.at[0] + q} ${place.at[1] + q}M${place.at[0] + q} ${place.at[1] - q}L${place.at[0] - q} ${place.at[1] + q}`;
        out.push({ t: 'path', d: mark, stroke: DARK, w: 4, alpha: 0.5 }, { t: 'path', d: mark, stroke: AMARILLO, w: 2, dash: l.dir[2] > 0 ? undefined : [6, 4] });
      } else {
        const d = rays(read, l, v, place);
        const dash = l.role === 'principal' ? undefined : l.role === 'contraluz' ? [3, 5] : [9, 6];
        if (d) out.push({ t: 'path', d, stroke: DARK, w: l.role === 'principal' ? 4.6 : 3.6, alpha: 0.5, cap: 'round', dash }, { t: 'path', d, stroke: l.role === 'contraluz' ? LIGHT : AMARILLO, w: l.role === 'principal' ? 2.3 : 1.6, cap: 'round', dash });
      }
      out.push(...sunIcon(place.at, r, l.role, String(i + 1), v.unit));
      const below = place.at[1] < v.H * 0.12;
      const anchor = place.at[0] < v.W * 0.2 ? 'start' : place.at[0] > v.W * 0.8 ? 'end' : 'middle';
      const label = `${ROLE_NAME[l.role]} · ${lightWords(l)}`;
      const size = 12.5 * v.unit;
      const tx = place.at[0] + (anchor === 'start' ? -r : anchor === 'end' ? r : 0);
      const ty = place.at[1] + (below ? r * 2.6 + 12 * v.unit : -r * 2.2);
      // Los rayos son paralelos y cruzan el letrero: una placa clara detrás lo deja leer.
      const tw = label.length * size * 0.56;
      const x0 = anchor === 'start' ? tx : anchor === 'end' ? tx - tw : tx - tw / 2;
      const pad = 4 * v.unit;
      out.push({ t: 'path', d: `M${x0 - pad} ${ty - size * 0.98}H${x0 + tw + pad}V${ty + size * 0.36}H${x0 - pad}Z`, fill: LIGHT, alpha: 0.88 });
      out.push({ t: 'text', x: tx, y: ty, s: label, size, fill: DARK, anchor, weight: 600 });
    });
    const lead = lights.find((l) => l.role === 'principal');
    const flatLead = lead ? Math.hypot(lead.dir[0], lead.dir[1]) : 0;
    // La sombra en el suelo solo se señala si cae del lado contrario a la luz que se lee.
    const agrees = !lead || flatLead < 0.3 || (read.groundDir ? -(read.groundDir[0] * lead.dir[0] + read.groundDir[1] * lead.dir[1]) / flatLead > 0.5 : false);
    if (read.groundDir && !edited && agrees) {
      const C: Pt = [read.center[0] * v.W, read.center[1] * v.H];
      const rho = read.radius * Math.max(v.W, v.H);
      const a: Pt = [C[0] + read.groundDir[0] * rho * 0.55, C[1] + read.groundDir[1] * rho * 0.55];
      const b: Pt = [C[0] + read.groundDir[0] * rho * 1.05, C[1] + read.groundDir[1] * rho * 1.05];
      const d = arrow(a, b, 9 * v.unit);
      out.push({ t: 'path', d, stroke: LIGHT, w: 4.4, alpha: 0.6, cap: 'round' }, { t: 'path', d, stroke: AZUL, w: 2.2, cap: 'round' });
    }
  }
  return out;
}

const layerCache = new WeakMap<LightRead, Map<string, OffscreenCanvas>>();

/** La figura en zonas medidas o como yeso bajo las luces, sobre la foto apagada. */
export function paintLight(ctx: CanvasRenderingContext2D, s: State, paper: [number, number, number]): boolean {
  const { frame } = s;
  const read = lightOf(s);
  if (!frame || !read || s.luz.view === 'foto') return false;
  const lights = shownLights(s, read);
  const key = `${s.luz.view}|${s.theme}|${s.lightEdit ? `${s.lightEdit.azimuth}|${s.lightEdit.elevation}` : ''}`;
  let byKey = layerCache.get(read);
  if (!byKey) layerCache.set(read, (byKey = new Map()));
  let layer = byKey.get(key);
  if (!layer) {
    const { w, h } = read;
    const data = new Uint8ClampedArray(w * h * 4);
    const ink = s.theme === 'papel' ? [20, 20, 20] : [12, 12, 12];
    const white = [246, 242, 233];
    const tone = (t: number) => [ink[0] + (white[0] - ink[0]) * t, ink[1] + (white[1] - ink[1]) * t, ink[2] + (white[2] - ink[2]) * t];
    const ZONES: Record<number, number[]> = {
      [ZONE.luz]: tone(0.86),
      [ZONE.medio]: tone(0.6),
      [ZONE.propia]: tone(0.27),
      [ZONE.arrojada]: [44 * 0.75 + ink[0] * 0.25, 96 * 0.75 + ink[1] * 0.25, 158 * 0.75 + ink[2] * 0.25],
      [ZONE.oclusion]: tone(0.03),
      [ZONE.brillo]: tone(1),
      [ZONE.oscuro]: tone(0.1),
    };
    const lit = s.luz.view === 'yeso' ? clay(read, lights.length ? lights : [lightFrom(135, 40)]) : null;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      data[p + 3] = 255;
      if (!read.zones[i]) {
        data[p + 3] = 0;
        continue;
      }
      let c: number[];
      if (lit) {
        // Yeso en pocos valores, como un estudio de planos.
        const e = Math.round(((lit[i] - 1) / 254) * 7) / 7;
        c = tone(0.08 + e * 0.9);
      } else c = ZONES[read.zones[i]] ?? tone(0.86);
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
    }
    layer = new OffscreenCanvas(w, h);
    layer.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
    byKey.set(key, layer);
  }
  // La foto queda apagada debajo, para que se lea el lugar sin competir.
  const n = frame.w * frame.h;
  const under = new Uint8ClampedArray(frame.rgba);
  const keep = read.scene ? 0.3 : 0.22;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    under[p] = paper[0] * (1 - keep) + under[p] * keep;
    under[p + 1] = paper[1] * (1 - keep) + under[p + 1] * keep;
    under[p + 2] = paper[2] * (1 - keep) + under[p + 2] * keep;
  }
  ctx.putImageData(new ImageData(under as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, 0, 0, ctx.canvas.width, ctx.canvas.height);
  return true;
}
