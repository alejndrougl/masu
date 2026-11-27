import { distanceToEdge } from './gesture';

/** Fondo liso: el borde de la imagen es casi de un solo color. */
export function flatBackground(rgba: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r.push(rgba[i]);
    g.push(rgba[i + 1]);
    b.push(rgba[i + 2]);
  };
  for (let x = 0; x < w; x += 2) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    take(0, y);
    take(w - 1, y);
  }
  const mid = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const c: [number, number, number] = [mid(r), mid(g), mid(b)];
  let near = 0;
  for (let i = 0; i < r.length; i++) if (Math.max(Math.abs(r[i] - c[0]), Math.abs(g[i] - c[1]), Math.abs(b[i] - c[2])) < 26) near++;
  // No todo el borde: la figura y su sombra pueden tocarlo.
  return near / r.length > 0.6 ? c : null;
}

function floodFromEdge(open: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (open[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  return out;
}

function middle(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Deja solo lo conectado a `seed` dentro de `allowed`. */
function growInside(seed: Uint8Array, allowed: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < seed.length; i++) {
    if (seed[i] && allowed[i]) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (q >= 0 && allowed[q] && !out[q]) {
        out[q] = 1;
        stack.push(q);
      }
    }
  }
  return out;
}

/**
 * Suma lo que encontró el recorte para ilustración: solo las piezas que tocan la figura,
 * para que otro objeto de la imagen no se le pegue.
 */
export function mergeMatte(mask: Uint8Array, w: number, h: number, matte: Uint8Array, mw: number, mh: number): Uint8Array {
  const scaled = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor(((y + 0.5) / h) * mh));
    for (let x = 0; x < w; x++) scaled[y * w + x] = matte[my * mw + Math.min(mw - 1, Math.floor(((x + 0.5) / w) * mw))];
  }
  const grown = growInside(mask, scaled, w, h);
  const out = Uint8Array.from(mask);
  for (let i = 0; i < out.length; i++) if (grown[i]) out[i] = 1;
  return out;
}

/** Píxeles de las piezas que no rebasan un grosor dado. */
function thinParts(flags: Uint8Array, w: number, h: number, limit: number): number[] {
  const field = distanceToEdge(flags, w, h);
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < flags.length; s++) {
    if (!flags[s] || seen[s]) continue;
    const part: number[] = [];
    let widest = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      part.push(i);
      widest = Math.max(widest, field[i] / 3);
      const x = i % w;
      const y = (i / w) | 0;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (q >= 0 && flags[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (widest <= limit) out.push(...part);
  }
  return out;
}

/**
 * Corrige un recorte con lo que ya se sabe de la imagen. Un fondo liso no puede ser
 * parte de la figura aunque el recorte lo haya incluido; y lo que salta en profundidad
 * junto a ella (la espada que sostiene) sí lo es, aunque se le haya escapado.
 */
export function refineMask(mask: Uint8Array, w: number, h: number, rgba: Uint8ClampedArray, depth: Float32Array | null): Uint8Array {
  // Un dibujo a lápiz es papel entre líneas: quitar el fondo se llevaría la figura.
  const color = flatBackground(rgba, w, h);
  if (color) {
    let inside = 0;
    let paper = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      inside++;
      const p = i * 4;
      if (Math.max(Math.abs(rgba[p] - color[0]), Math.abs(rgba[p + 1] - color[1]), Math.abs(rgba[p + 2] - color[2])) < 30) paper++;
    }
    if (paper > inside * 0.6) return mask;
  }
  return corrected(mask, w, h, rgba, depth, color);
}

function corrected(mask: Uint8Array, w: number, h: number, rgba: Uint8ClampedArray, depth: Float32Array | null, color: [number, number, number] | null): Uint8Array {
  const out = Uint8Array.from(mask);
  const near: number[] = [];
  const far: number[] = [];
  if (depth) {
    for (let i = 0; i < out.length; i += 3) (out[i] ? near : far).push(depth[i]);
  }
  const front = middle(near);
  const back = middle(far);
  const clear = !!depth && front - back > 0.12;

  if (color) {
    const open = new Uint8Array(w * h);
    const [br, bg, bb] = color.map((v) => Math.max(v, 1));
    for (let i = 0; i < open.length; i++) {
      const p = i * 4;
      const same = Math.max(Math.abs(rgba[p] - br), Math.abs(rgba[p + 1] - bg), Math.abs(rgba[p + 2] - bb)) < 30;
      // Una sombra sobre el fondo es el mismo color, solo más oscuro: se va con él.
      const kr = rgba[p] / br;
      const kg = rgba[p + 1] / bg;
      const kb = rgba[p + 2] / bb;
      const shadow = kg > 0.42 && Math.abs(kr - kg) < 0.05 && Math.abs(kg - kb) < 0.05;
      open[i] = same || shadow ? 1 : 0;
    }
    const background = floodFromEdge(open, w, h);
    for (let i = 0; i < out.length; i++) if (background[i]) out[i] = 0;
    if (clear) {
      const cut = back + (front - back) * 0.4;
      const allowed = new Uint8Array(w * h);
      for (let i = 0; i < allowed.length; i++) allowed[i] = !background[i] && depth![i] > cut ? 1 : 0;
      const grown = growInside(out, allowed, w, h);
      let base = 0;
      const added = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) {
        base += out[i] ? 1 : 0;
        added[i] = grown[i] && !out[i] ? 1 : 0;
      }
      // Lo que sostiene una figura es delgado: una espada, un arco. El suelo no lo es.
      for (const i of thinParts(added, w, h, Math.sqrt(base) * 0.075)) out[i] = 1;
    }
    return out;
  }
  if (clear) {
    const cut = back + (front - back) * 0.3;
    for (let i = 0; i < out.length; i++) if (out[i] && depth![i] < cut) out[i] = 0;
  }
  return out;
}

/** Crece una máscara: cada pasada agrega un píxel alrededor. */
function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dist = new Int32Array(w * h).fill(-1);
  let front: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      dist[i] = 0;
      front.push(i);
    }
  }
  for (let r = 1; r <= radius && front.length; r++) {
    const next: number[] = [];
    for (const p of front) {
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= mask.length || dist[q] >= 0) continue;
        dist[q] = r;
        next.push(q);
      }
    }
    front = next;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (dist[i] >= 0) out[i] = 1;
  return out;
}

/**
 * Corte por color alrededor de una forma conocida, como una pasada de GrabCut: lo de
 * adentro enseña cómo se ve la figura y el anillo de afuera cómo se ve el fondo, y cada
 * píxel de la franja dudosa se queda con el que más se le parece. El color va en
 * cromaticidad, porque una mano cruzada por una sombra sigue siendo del mismo color.
 */
export function grabFromPrior(rgba: Uint8ClampedArray, w: number, h: number, prior: Uint8Array, band: number): Uint8Array {
  const n = w * h;
  const BINS = 14;
  const key = (i: number) => {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const sum = r + g + b + 1;
    const cr = Math.min(BINS - 1, Math.floor((r / sum) * BINS * 1.4));
    const cg = Math.min(BINS - 1, Math.floor((g / sum) * BINS * 1.4));
    const v = Math.min(3, Math.floor(sum / 192));
    return (cr * BINS + cg) * 4 + v;
  };
  const maybe = dilate(prior, w, h, band);
  const ring = dilate(maybe, w, h, band * 2);
  let inside = prior.slice();
  const size = BINS * BINS * 4;
  for (let round = 0; round < 3; round++) {
    const fg = new Float64Array(size).fill(0.5);
    const bg = new Float64Array(size).fill(0.5);
    let nf = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      if (inside[i]) {
        fg[key(i)]++;
        nf++;
      } else if (ring[i] && !maybe[i]) {
        bg[key(i)]++;
        nb++;
      }
    }
    const next = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!maybe[i]) continue;
      const k = key(i);
      const lean = prior[i] ? 3 : 1;
      next[i] = (fg[k] / (nf || 1)) * lean > bg[k] / (nb || 1) ? 1 : 0;
    }
    inside = next;
  }
  // Lo que quedó suelto no pertenece a la figura.
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (prior[i] && inside[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q >= 0 && q < n && inside[q] && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  for (let i = 0; i < n; i++) if (prior[i]) seen[i] = 1;
  return seen;
}

/**
 * Una persona es lo que está unido a sus articulaciones. Una red de recorte también se trae
 * letras y adornos, y eso infla la caja: la pose y el cuerpo 3D leen entonces a una figura más
 * chica y todo sale corrido. Se quitan las orillas para soltar lo que apenas se toca, se quedan
 * las piezas con alguna articulación, y se devuelve lo delgado que sale de ellas: dedos,
 * mechones, la punta de una espada.
 */
export function keepConnected(mask: Uint8Array, w: number, h: number, seeds: [number, number][]): Uint8Array {
  if (!seeds.length) return mask;
  const r = Math.max(1, Math.round(Math.min(w, h) / 320));
  const field = distanceToEdge(mask, w, h);
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (label[s] >= 0 || field[s] < r) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      if (x > 0 && label[i - 1] < 0 && field[i - 1] >= r) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && label[i + 1] < 0 && field[i + 1] >= r) { label[i + 1] = id; stack.push(i + 1); }
      if (i >= w && label[i - w] < 0 && field[i - w] >= r) { label[i - w] = id; stack.push(i - w); }
      if (i + w < label.length && label[i + w] < 0 && field[i + w] >= r) { label[i + w] = id; stack.push(i + w); }
    }
    sizes.push(size);
  }
  if (!sizes.length) return mask;
  const wanted = new Set<number>();
  const reach = r * 4;
  for (const [sx, sy] of seeds) {
    const cx = Math.round(sx * w);
    const cy = Math.round(sy * h);
    for (let dy = -reach; dy <= reach; dy += 2) {
      for (let dx = -reach; dx <= reach; dx += 2) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const id = label[y * w + x];
        if (id >= 0) wanted.add(id);
      }
    }
  }
  if (!wanted.size) return mask;
  const out = new Uint8Array(w * h);
  let frontier: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (label[i] >= 0 && wanted.has(label[i])) {
      out[i] = 1;
      frontier.push(i);
    }
  }
  // Lo delgado que sale del cuerpo vuelve, pero solo un tramo corto: un título pegado a la
  // cabeza no regresa entero.
  const grow = Math.round(Math.min(w, h) / 26);
  for (let step = 0; step < grow && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= out.length || out[j] || !mask[j]) continue;
        out[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  return out;
}

const countOf = (mask: Uint8Array) => mask.reduce((n, v) => n + (v ? 1 : 0), 0);

export function overlapOf(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let any = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) any++;
  }
  return any ? both / any : 0;
}

/**
 * Hasta dónde puede llegar lo que una figura lleva: cerca del cuerpo, y lejos solo desde sus
 * manos. Una espada larga cabe; las sillas del fondo, aunque estén a la misma distancia, no.
 */
export function reachOf(joints: { x: number; y: number; size: number }[], unit: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const j of joints) {
    const r = unit * j.size * h;
    const cx = j.x * w;
    const cy = j.y * h;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * Quita lo delgado que sale de la figura lejos de sus manos: una letra pegada a la cabeza, un
 * cable. Una apertura deja el cuerpo; lo que se pierde solo se conserva si lo sostiene una mano.
 */
export function trimThin(mask: Uint8Array, w: number, h: number, radius: number, hands?: Uint8Array): Uint8Array {
  // La distancia viene en unidades de chaflán: tres por píxel.
  const inner = distanceToEdge(mask, w, h);
  const core = new Uint8Array(mask.length);
  let any = false;
  for (let i = 0; i < mask.length; i++) {
    if (inner[i] > radius * 3) {
      core[i] = 1;
      any = true;
    }
  }
  if (!any) return mask;
  const outer = distanceToEdge(core.map((v) => (v ? 0 : 1)), w, h);
  const out = Uint8Array.from(mask);
  const thin = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i] && outer[i] > (radius + 1) * 3) thin[i] = 1;
  // Lo que no es delgado se separa en partes: un tramo que une dos de ellas es un puente.
  const part = new Int32Array(mask.length).fill(-1);
  const pending: number[] = [];
  let parts = 0;
  for (let s = 0; s < mask.length; s++) {
    if (part[s] >= 0 || !mask[s] || thin[s]) continue;
    part[s] = parts;
    pending.push(s);
    while (pending.length) {
      const i = pending.pop()!;
      const x = i % w;
      const y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const j = qy * w + qx;
          if (part[j] < 0 && mask[j] && !thin[j]) {
            part[j] = parts;
            pending.push(j);
          }
        }
      }
    }
    parts++;
  }
  const seen = new Uint8Array(mask.length);
  const least = countOf(mask) * 0.015;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || !thin[s]) continue;
    const piece: number[] = [];
    const touching = new Set<number>();
    let held = false;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      if (hands?.[i]) held = true;
      const x = i % w;
      const y = Math.floor(i / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const j = qy * w + qx;
          if (part[j] >= 0) touching.add(part[j]);
          if (!seen[j] && thin[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    // Una telaraña o un bastón son largos; una letra pegada es corta. Y lo que une dos partes,
    // como la hoja de una espada, no se puede quitar.
    const long = Math.hypot(x1 - x0, y1 - y0) > radius * 14;
    if (!held && !long && touching.size < 2 && piece.length < least) for (const i of piece) out[i] = 0;
  }
  return out;
}

/** Quita motas sueltas: lo que queda lejos y es mínimo no es parte de nadie. */
export function dropSpecks(mask: Uint8Array, w: number, h: number, share = 0.0015): Uint8Array {
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(mask.length);
  const least = countOf(mask) * share;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || !mask[s]) continue;
    const piece: number[] = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      const y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const j = qy * w + qx;
          if (!seen[j] && mask[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (piece.length < least) for (const i of piece) out[i] = 0;
  }
  return out;
}

/** Puntos afuera del cuerpo: primero donde el recorte ya dijo que no hay figura. */
export function outsidePoints(body: Uint8Array, mask: Uint8Array, w: number, h: number): [number, number][] {
  const field = distanceToEdge(body.map((v) => (v ? 0 : 1)), w, h);
  const gap = Math.min(w, h) * 0.05;
  const out: [number, number][] = [];
  const side = 7;
  for (const free of [true, false]) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const x = Math.floor(((i + 0.5) / side) * w);
        const y = Math.floor(((j + 0.5) / side) * h);
        const at = y * w + x;
        if (field[at] < gap || (free && mask[at])) continue;
        if (!free && out.length >= 6) continue;
        out.push([(x + 0.5) / w, (y + 0.5) / h]);
      }
    }
    if (out.length >= 6) break;
  }
  return out.slice(0, 14);
}

/**
 * La figura final. El cuerpo sale de un recorte guiado por la malla, y lo que carga se decide por
 * distancia: una espada o un escudo están donde está el cuerpo, y un fondo, un piso o una ventana
 * están detrás. Por eso se sostiene igual en una foto, un óleo o un personaje plano.
 * `depth` es la profundidad por píxel, mayor es más cerca.
 */
export function settleFigure(body: Uint8Array, first: Uint8Array, depth: Float32Array, w: number, h: number, reach?: Uint8Array, core?: Uint8Array): Uint8Array {
  const near: number[] = [];
  // La distancia de la figura se mide donde hay certeza: el cuerpo que la pose sí vio.
  for (let i = 0; i < body.length; i += 7) if (body[i] && (!core || core[i])) near.push(depth[i]);
  if (near.length < 20) return body;
  near.sort((p, q) => p - q);
  const low = near[Math.floor(near.length * 0.1)];
  const high = near[Math.floor(near.length * 0.9)];
  const margin = Math.max(0.04, (high - low) * 0.25);
  const out = Uint8Array.from(body);
  // Lo que el recorte tomó muy atrás de la figura no es figura: una ventana pegada al pelo.
  for (let i = 0; i < out.length; i++) if (out[i] && depth[i] < low - margin * 2) out[i] = 0;
  let frontier: number[] = [];
  for (let i = 0; i < out.length; i++) if (out[i]) frontier.push(i);
  // Se crece desde el cuerpo: solo por lo que ya estaba en el recorte y queda a su distancia.
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= out.length || out[j] || !first[j] || depth[j] < low - margin || (reach && !reach[j])) continue;
        out[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  // Una espada o un escudo son piezas sueltas de buen tamaño. Lo que llega al borde del cuadro
  // es piso o fondo, y lo diminuto son restos: una letra pegada a la cabeza.
  const seen = new Uint8Array(out.length);
  const least = countOf(body) * 0.012;
  const stack: number[] = [];
  for (let s = 0; s < out.length; s++) {
    if (seen[s] || !out[s] || body[s]) continue;
    const piece: number[] = [];
    let edge = false;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      const y = Math.floor(i / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < out.length && !seen[j] && out[j] && !body[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (edge || piece.length < least) for (const i of piece) out[i] = 0;
  }
  return closeGaps(out, depth, low - margin, w, h);
}

/** Un recorte sirve si cubre el cuerpo y no se traga el fondo. Un personaje de cabeza grande mide más. */
export function segmentFits(seg: Uint8Array, mesh: Uint8Array): boolean {
  let both = 0;
  let inSeg = 0;
  let inMesh = 0;
  for (let i = 0; i < seg.length; i++) {
    if (seg[i]) inSeg++;
    if (mesh[i]) inMesh++;
    if (seg[i] && mesh[i]) both++;
  }
  return inMesh > 0 && both / inMesh >= 0.5 && inSeg <= inMesh * 3.5;
}

/** Un hueco rodeado de figura y a su misma distancia es parte de ella: una túnica, una sombra. */
function closeGaps(mask: Uint8Array, depth: Float32Array, near: number, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const total = countOf(mask);
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || mask[s]) continue;
    const gap: number[] = [];
    let edge = false;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      gap.push(i);
      const x = i % w;
      const y = Math.floor(i / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && !seen[j] && !mask[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (edge || gap.length > total * 0.06) continue;
    let close = 0;
    for (const i of gap) if (depth[i] >= near) close++;
    if (close > gap.length * 0.7) for (const i of gap) mask[i] = 1;
  }
  return mask;
}
