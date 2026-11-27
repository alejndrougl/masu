import type { Rect, Subject } from './types';

/** Qué parte de `a` cae dentro de `b`. */
function inside(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h || 1);
}

/**
 * Lo que no se puede afirmar no se nombra. Un objeto poco seguro llevaba nombres falsos (un
 * "coche" en el tablero, una "mochila" que era el escudo, una "tabla de surf" que era una
 * sábana), y una "mano" dentro de un perro es su pata. Las caritas dibujadas en un cuaderno se
 * quitan después, con la profundidad (heldDrawings): por su caja no se distinguen de alguien al
 * fondo.
 */
export function honestSubjects(list: Subject[]): Subject[] {
  const people = list.filter((s) => s.kind === 'person' || s.kind === 'anime-person');
  const animals = list.filter((s) => s.kind === 'animal');
  return list.filter((s) => {
    if (s.kind === 'object' && s.score < 0.5) return false;
    if (s.kind === 'hand' && animals.some((a) => inside(s.box, a.box) > 0.6) && !people.some((p) => inside(s.box, p.box) > 0.6)) return false;
    return true;
  });
}

/**
 * Una cabeza que se ve mucho más chica que la principal, si es de verdad, está más lejos. Si la
 * profundidad dice que está igual de cerca o más, es un dibujo sobre algo que se sostiene (las
 * caritas de un cuaderno), no alguien en la escena. Mayor profundidad es más cerca.
 */
export function heldDrawings(list: Subject[], depthAt: (x: number, y: number) => number): Set<string> {
  const out = new Set<string>();
  const faces = list.filter((s) => s.kind === 'anime-face' || s.kind === 'human-face');
  if (faces.length < 2) return out;
  const main = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const mainArea = main.box.w * main.box.h;
  const mainDepth = depthAt(main.box.x + main.box.w / 2, main.box.y + main.box.h / 2);
  const small = (s: Subject, k: number) => s.box.w * s.box.h < mainArea * k;
  const nearAsMain = (s: Subject) => {
    // La mediana de unos puntos de la caja: un borde de fondo no decide.
    const v: number[] = [];
    for (const fx of [0.3, 0.5, 0.7]) for (const fy of [0.3, 0.5, 0.7]) v.push(depthAt(s.box.x + s.box.w * fx, s.box.y + s.box.h * fy));
    v.sort((a, b) => a - b);
    return v[4] >= mainDepth - 0.03;
  };
  for (const f of faces) if (f !== main && small(f, 0.25) && nearAsMain(f)) out.add(f.id);
  // Un cuerpo chico cuyo único rostro es un dibujo también lo es.
  for (const b of list) {
    if (b.kind !== 'anime-person' && b.kind !== 'person') continue;
    const own = faces.filter((f) => inside(f.box, b.box) > 0.6);
    if (own.length && own.every((f) => out.has(f.id))) out.add(b.id);
    else if (!own.length && small(b, 2) && nearAsMain(b) && b.box.y > main.box.y + main.box.h) out.add(b.id);
  }
  return out;
}
