import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, format, setLocale, t, tr } from './index';
import { en } from './en';
import { es } from './es';

/** Todas las claves de un diccionario, con su ruta completa: "area.clave". */
function leaves(d: object, prefix = ''): [string, unknown][] {
  return Object.entries(d).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? leaves(v, prefix + k + '.') : [[prefix + k, v] as [string, unknown]]));
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('diccionarios', () => {
  const esLeaves = leaves(es);
  const enLeaves = leaves(en);

  it('es y en tienen exactamente las mismas claves', () => {
    expect(enLeaves.map(([k]) => k).sort()).toEqual(esLeaves.map(([k]) => k).sort());
  });

  it('ninguna cadena está vacía (salvo las que son separadores o espacios)', () => {
    for (const [k, v] of [...esLeaves, ...enLeaves]) {
      expect(typeof v, k).toBe('string');
      expect((v as string).length, k).toBeGreaterThan(0);
    }
  });

  it('cada clave usa las mismas {variables} en los dos idiomas', () => {
    const inEn = new Map(enLeaves as [string, string][]);
    for (const [k, v] of esLeaves as [string, string][]) expect(vars(inEn.get(k)!), k).toEqual(vars(v));
  });

  it('cada {variable|singular|plural} usa una variable que la misma cadena muestra', () => {
    for (const [k, v] of [...esLeaves, ...enLeaves] as [string, string][]) {
      for (const m of v.matchAll(/\{(\w+)\|/g)) expect(vars(v), k).toContain(m[1]);
    }
  });
});

describe('detectLocale', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cualquier es-* es español', () => {
    expect(detectLocale(['es-MX'])).toBe('es');
    expect(detectLocale(['es'])).toBe('es');
    expect(detectLocale(['es-AR', 'en-US'])).toBe('es');
  });

  it('todo lo demás es inglés', () => {
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale(['pt-BR', 'es-MX'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('sin lista usa la preferencia guardada y, si no hay, navigator.languages', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR', languages: ['fr-FR'] });
    vi.stubGlobal('localStorage', { getItem: () => 'es' });
    expect(detectLocale()).toBe('es');
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(detectLocale()).toBe('en');
    vi.stubGlobal('navigator', { language: 'es-MX', languages: ['es-MX'] });
    expect(detectLocale()).toBe('es');
    // Un almacenamiento que lanza error no rompe la detección.
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado'); } });
    expect(detectLocale()).toBe('es');
  });
});

describe('t y variables', () => {
  afterEach(() => setLocale('es'));

  it('sustituye {variables}', () => {
    expect(format('Hola {name}, tienes {n}', { name: 'Ana', n: 3 })).toBe('Hola Ana, tienes 3');
    expect(format('sin {faltante}', {})).toBe('sin {faltante}');
    setLocale('es');
    expect(t('app.quitar', { name: 'foto.png' })).toBe('Quitar foto.png');
    setLocale('en');
    expect(t('app.quitar', { name: 'foto.png' })).toBe('Remove foto.png');
  });

  it('cambia de idioma y traduce nombres guardados en español', () => {
    setLocale('en');
    expect(t('store.lienzo')).toBe('Canvas');
    expect(tr('Siena tostada')).toBe('Burnt sienna');
    expect(tr('Siena tostada, claro')).toBe('Burnt sienna, light');
    setLocale('es');
    expect(t('store.lienzo')).toBe('Lienzo');
    expect(tr('Siena tostada')).toBe('Siena tostada');
  });
});

describe('plurales', () => {
  afterEach(() => setLocale('es'));

  it('{variable|singular|plural} elige la forma según el número', () => {
    const s = '{n} {n|cuadro|cuadros}';
    expect(format(s, { n: 1 }, 'es')).toBe('1 cuadro');
    expect(format(s, { n: 0 }, 'es')).toBe('0 cuadros');
    expect(format(s, { n: 2 }, 'es')).toBe('2 cuadros');
    expect(format(s, { n: 1.5 }, 'es')).toBe('1.5 cuadros');
    expect(format('{n} {n|square|squares}', { n: 1 }, 'en')).toBe('1 square');
    expect(format('{n} {n|square|squares}', { n: 0 }, 'en')).toBe('0 squares');
    // Sin la variable, el texto queda igual.
    expect(format('{n|a|b}', {}, 'en')).toBe('{n|a|b}');
  });

  it('ya no dice "1 squares" ni "1 heads"', () => {
    setLocale('en');
    expect(t('app.cuadros', { length: 1 })).toBe('1 square');
    expect(t('app.cuadros', { length: 4 })).toBe('4 squares');
    expect(t('pintar.n_de_m_cuadros', { done: 0, total: 1 })).toBe('0 of 1 square');
    expect(t('pintar.n_de_m_cuadros', { done: 1, total: 12 })).toBe('1 of 12 squares');
    expect(t('construccion.n_cabezas', { n: 1 })).toBe('1 head');
    expect(t('construccion.n_cabezas', { n: 2.5 })).toBe('2.5 heads');
    setLocale('es');
    expect(t('app.cuadros', { length: 1 })).toBe('1 cuadro');
    expect(t('app.cuadros', { length: 4 })).toBe('4 cuadros');
    expect(t('pintar.n_de_m_cuadros', { done: 1, total: 1 })).toBe('1 de 1 cuadro');
    expect(t('construccion.n_cabezas', { n: 1 })).toBe('1 cabeza');
    expect(t('panels.n_de_m_pintados', { done: 1, total: 1 })).toBe('1 de 1 pintado.');
    expect(t('panels.n_de_m_pintados', { done: 2, total: 9 })).toBe('2 de 9 pintados.');
  });
});
