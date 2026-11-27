// Internacionalización: español (fuente) e inglés. Sin dependencias del store, para que la usen
// también las bibliotecas (src/lib) y los workers. El store guarda el idioma elegido y avisa aquí.
import { useSyncExternalStore } from 'react';
import { es } from './es';
import { en } from './en';

export type Locale = 'es' | 'en';
export type Dict = typeof es;
type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
export type Key = Paths<Dict>;
export type Vars = Record<string, string | number>;

export const LOCALES: readonly Locale[] = ['es', 'en'];
export const STORAGE_KEY = 'masu-idioma';

const isLocale = (v: unknown): v is Locale => v === 'es' || v === 'en';

/** Idioma guardado, si lo hay; si no, el del navegador: cualquier es-* es español, lo demás inglés. */
export function detectLocale(languages?: readonly string[]): Locale {
  if (!languages) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved)) return saved;
    } catch {
      /* sin almacenamiento: se sigue con el navegador */
    }
  }
  let list: readonly string[] = languages ?? [];
  if (!languages) {
    try {
      list = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
    } catch {
      list = [];
    }
  }
  // El idioma preferido manda: es-MX, es-AR... cuentan como es; lo que no tenga diccionario cae a inglés.
  const primary = (list[0] ?? '').toLowerCase().split('-')[0];
  return LOCALES.find((l) => l === primary) ?? 'en';
}

function flatten(d: object, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else flatten(v as object, prefix + k + '.', out);
  }
  return out;
}
const flat: Record<Locale, Record<string, string>> = { es: flatten(es), en: flatten(en) };

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  listeners.forEach((fn) => fn());
}

export const subscribeLocale = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** Categoría de plural de n en el idioma: 'one' o 'other' en español e inglés. */
export function pluralCategory(n: number, locale: Locale = current): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules.select(n);
}

/**
 * Sustituye {nombre} por su valor y {nombre|singular|plural} por la forma que pide ese número
 * en el idioma: "{n} {n|cuadro|cuadros}" da "1 cuadro" y "3 cuadros".
 */
export function format(s: string, vars?: Vars, locale: Locale = current): string {
  if (!vars) return s;
  return s
    .replace(/\{(\w+)\|([^{}|]*)\|([^{}|]*)\}/g, (m, k: string, one: string, other: string) => {
      if (!(k in vars)) return m;
      const n = Number(vars[k]);
      return Number.isFinite(n) && pluralCategory(n, locale) === 'one' ? one : other;
    })
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Texto de la clave en el idioma actual; si falta en inglés, cae al español. */
export function t(key: Key, vars?: Vars): string {
  return tDyn(key, vars);
}

/** Texto de una clave que se arma en tiempo de ejecución (por ejemplo, por id). */
export function tDyn(key: string, vars?: Vars, fallback?: string): string {
  const own = flat[current][key];
  // Si cae al español, el plural se elige con las reglas del español.
  return own !== undefined ? format(own, vars) : format(flat.es[key] ?? fallback ?? key, vars, 'es');
}

/** Hook: devuelve t y vuelve a dibujar el componente cuando cambia el idioma. */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLocale, getLocale);
  return t;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale);
}

const esToKey = new Map<string, string>();
for (const [k, v] of Object.entries(flat.es)) if (!esToKey.has(v)) esToKey.set(v, k);

/**
 * Traduce un texto que el código guarda en español como identificador (nombres de pigmentos,
 * de tubos, de piezas). Si no está en el diccionario, lo devuelve igual.
 */
export function tr(spanish: string): string {
  const k = esToKey.get(spanish);
  if (k) return tDyn(k);
  // Lista de nombres, como "Siena tostada, claro": se traduce cada parte.
  return spanish.includes(', ') ? spanish.split(', ').map((p) => esToKey.get(p) ? tDyn(esToKey.get(p)!) : p).join(', ') : spanish;
}
