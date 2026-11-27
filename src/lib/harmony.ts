import { t as tx } from '../i18n';
/** Tono Lab a nombre de color, como se dice al pintar. */
export function hueName(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d < 20 || d >= 345) return tx('hue.rosa');
  if (d < 50) return tx('hue.rojo');
  if (d < 72) return tx('hue.naranja');
  if (d < 105) return tx('hue.amarillo');
  if (d < 140) return tx('harmony.verde_amarillo');
  if (d < 180) return tx('hue.verde');
  if (d < 225) return tx('hue.turquesa');
  // En Lab el azul puro cae cerca de 306°: el violeta empieza después.
  if (d < 305) return tx('hue.azul');
  if (d < 330) return tx('hue.violeta');
  return tx('hue.magenta');
}

export interface Harmony {
  kind: string;
  note: string;
  /** Tonos principales, en grados de Lab. */
  peaks: number[];
  /** Acento que completaría la armonía. */
  accent: { deg: number; name: string } | null;
}

function gap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Bajo esta fracción de píxeles con color, la imagen se trata como acromática. */
const ACHROMATIC = 0.15;

/**
 * Lee la relación entre los colores dominantes en el espectro de tonos.
 * `colored` es la fracción de píxeles con color visible: sin ella no se puede saber si una
 * imagen casi gris tiene armonía, así que una imagen casi gris no inventa ninguna.
 */
export function readHarmony(hue: number[], colored = 1): Harmony {
  const n = hue.length;
  const total = hue.reduce((a, b) => a + b, 0);
  const binDeg = 360 / n;
  // Masa de color alrededor de un tono (±30°): cuánto de todo el color de la imagen vive ahí.
  const massAt = (deg: number) => {
    let m = 0;
    for (let i = 0; i < n; i++) if (gap((i + 0.5) * binDeg, deg) <= 30) m += hue[i];
    return m / (total || 1);
  };
  const smooth = hue.map((_, i) => (hue[(i - 1 + n) % n] + 2 * hue[i] + hue[(i + 1) % n]) / 4);
  const top = Math.max(...smooth, 0);
  const peaks: { deg: number; v: number; mass: number }[] = [];
  smooth.forEach((v, i) => {
    if (v > 0 && v >= top * 0.03 && v >= smooth[(i - 1 + n) % n] && v > smooth[(i + 1) % n]) {
      const deg = (i + 0.5) * binDeg;
      peaks.push({ deg, v, mass: massAt(deg) });
    }
  });
  peaks.sort((p, q) => q.mass - p.mass);
  const kept: { deg: number; v: number; mass: number }[] = [];
  // Un color cuenta si lleva una parte real del color de la imagen, no solo un pico de ruido.
  for (const p of peaks) {
    if (kept.some((k) => gap(k.deg, p.deg) < 30)) continue;
    if (kept.length && p.mass < 0.04) continue;
    if (kept.some((k) => hueName(k.deg) === hueName(p.deg))) continue;
    kept.push(p);
  }
  const main = kept.slice(0, 3);
  const degs = main.map((p) => p.deg);
  const names = degs.map(hueName);

  if (total < 0.4 || !main.length || colored < ACHROMATIC) {
    const where = main.length && colored >= 0.03 ? tx('harmony.lo_poco_que_hay', { v1: names[0] }) : '';
    const pct = colored < 0.01 ? tx('harmony.casi_nada') : tx('harmony.solo', { v1: Math.max(1, Math.round(colored * 100)) });
    return { kind: 'Casi acromática', note: tx('harmony.es_casi_gris_de', { pct, where }), peaks: [], accent: null };
  }

  const opposite = (d: number) => (d + 180) % 360;
  const accentFor = (d: number) => ({ deg: opposite(d), name: hueName(opposite(d)) });
  const accentNote = (d: number) => {
    const acc = accentFor(d);
    // Solo se sugiere un acento que de verdad falte; si ya está, se dice que se use.
    return massAt(acc.deg) < 0.06 ? tx('harmony.un_toque_pequeno_de', { name: acc.name }) : tx('harmony.el_que_ya_hay', { name: acc.name });
  };

  // Un color que manda y otro lejano y pequeño: el segundo es un acento, no la mitad de la armonía.
  if (main.length === 2 && gap(degs[0], degs[1]) >= 70 && main[1].mass < main[0].mass * 0.25) {
    return {
      kind: 'Dominante con acento',
      note: tx('harmony.el_domina_el_es', { v1: names[0], v2: names[1], v3: Math.max(1, Math.round((main[1].mass / (main[0].mass + main[1].mass)) * 100)) }),
      peaks: degs,
      accent: null,
    };
  }
  if (main.length <= 1 || (main.length === 2 && gap(degs[0], degs[1]) < 48)) {
    const spread = hue.filter((v) => v > top * 0.15).length * binDeg;
    // Dos tonos distintos, aunque vecinos, ya no son un solo color: es una análoga.
    const kind = main.length === 1 && spread < 55 ? 'Monocromática' : 'Análoga';
    const around = main.length === 2 ? tx('harmony.vecinos', { v1: names[0], v2: names[1] }) : names[0];
    return {
      kind,
      note: tx('harmony.el_color_gira_alrededor', { around, v2: accentNote(degs[0]) }),
      peaks: degs,
      accent: accentFor(degs[0]),
    };
  }
  if (main.length === 2) {
    const g = gap(degs[0], degs[1]);
    if (g > 145) {
      return { kind: 'Complementaria', note: tx('harmony.contra_el_contraste_de', { v1: cap(names[0]), v2: names[1] }), peaks: degs, accent: null };
    }
    return { kind: 'Dos tonos', note: tx('harmony.llevan_la_imagen_neutraliza', { v1: cap(names[0]), v2: names[1] }), peaks: degs, accent: accentFor((degs[0] + degs[1]) / 2) };
  }
  const gaps = [gap(degs[0], degs[1]), gap(degs[1], degs[2]), gap(degs[0], degs[2])].sort((a, b) => a - b);
  if (gaps[0] > 85) return { kind: 'Triádica', note: tx('harmony.tres_polos_elige_uno', { v1: names.join(', ') }), peaks: degs, accent: null };
  if (gaps[2] > 140) return { kind: 'Complementaria dividida', note: tx('harmony.frente_contraste_rico_pero', { v1: cap(names[0]), v2: names[1], v3: names[2] }), peaks: degs, accent: null };
  return { kind: 'Análoga amplia', note: tx('harmony.son_vecinos_da_unidad', { v1: names.join(', ') }), peaks: degs, accent: accentFor(degs[0]) };
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Temperatura global en una frase corta, para Lectura: la misma cifra que la pestaña Color. */
export function temperatureSummary(temperature: number[], harmony: Harmony): string {
  const [warm, neutral, cool] = temperature;
  if (harmony.kind === 'Casi acromática') return tx('harmony.casi_sin_color_la');
  if (neutral > 0.7) return tx('harmony.mayormente_neutra_sin_temperat', { v1: Math.round(neutral * 100), v2: warm > cool ? tx('common.calido') : tx('common.frio') });
  const lead = warm > cool * 1.6 ? tx('harmony.predominan_los_calidos') : cool > warm * 1.6 ? tx('harmony.predominan_los_frios') : tx('harmony.calidos_frios_en_equilibrio');
  return tx('harmony.calido_frio', { lead, v2: Math.round(warm * 100), v3: Math.round(cool * 100) });
}
