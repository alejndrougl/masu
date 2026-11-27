import { useEffect, useMemo, useRef, useState } from 'react';
import { labToRgb } from '../lib/color';
import { ZONE_NAMES } from '../lib/tones';
import type { Swatch, ToneStats } from '../lib/types';

import { t as tx, tr } from '../i18n';
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Grises de las cuatro zonas, los mismos que ve el ojo en la imagen. */
export const ZONE_TONES = ['#26241f', '#6b675e', '#a8a397', '#e6e1d4'];

export function ZoneBar({ shares }: { shares: readonly number[] }) {
  return (
    <div className="zonebar" role="img" aria-label={shares.map((s, i) => `${ZONE_NAMES[i]} ${pct(s)}`).join(', ')}>
      {shares.map((s, i) =>
        s > 0.004 ? (
          <span key={i} style={{ flexGrow: s, background: ZONE_TONES[i] }} title={`${ZONE_NAMES[i]} ${pct(s)}`} />
        ) : null,
      )}
    </div>
  );
}

export function ZoneLegend({ shares }: { shares: readonly number[] }) {
  return (
    <ul className="zonelegend">
      {shares.map((s, i) => (
        <li key={i}>
          <i style={{ background: ZONE_TONES[i] }} aria-hidden />
          <span>{ZONE_NAMES[i]}</span>
          <b>{pct(s)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Histogram({
  hist,
  thresholds,
  onChange,
  height = 96,
  tint,
  rgb,
}: {
  hist: number[];
  thresholds: readonly [number, number, number];
  onChange?: (t: [number, number, number]) => void;
  height?: number;
  tint?: Uint8Array;
  rgb?: [number[], number[], number[]];
}) {
  const W = 280;
  const H = height;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<'color' | 'rgb'>('color');
  const total = useMemo(() => hist.reduce((a, b) => a + b, 0) || 1, [hist]);
  const { d, bars } = useMemo(() => {
    // Raíz cuadrada para que los picos no aplasten todo lo demás.
    const bins = 112;
    const v = new Array<number>(bins).fill(0);
    hist.forEach((c, i) => (v[Math.floor((i * bins) / 256)] += c));
    // Un fondo liso es un solo pico enorme: no debe aplastar el resto de la imagen.
    const ordered = [...v].sort((p, q) => q - p);
    const peak = Math.sqrt(ordered[3] * 1.6) || Math.sqrt(ordered[0]) || 1;
    const top = (c: number) => H - Math.min(1, Math.sqrt(c) / peak) * (H - 4);
    let path = `M0 ${H}`;
    v.forEach((c, i) => {
      path += `L${((i + 0.5) / bins) * W} ${top(c)}`;
    });
    const width = W / bins;
    const list = v.map((c, i) => {
      // Cada columna lleva el color que la imagen tiene en ese valor.
      const at = Math.min(255, Math.floor(((i + 0.5) * 256) / bins));
      const fill = tint ? `rgb(${tint[at * 3]},${tint[at * 3 + 1]},${tint[at * 3 + 2]})` : 'var(--ink)';
      const y = top(c);
      return { x: i * width, y, h: H - y, w: width + 0.4, fill };
    });
    return { d: `${path}L${W} ${H}Z`, bars: list };
  }, [hist, H, tint]);

  const channels = useMemo(() => {
    if (!rgb) return [];
    const peak = Math.sqrt(Math.max(...rgb.flatMap((c) => c.slice(2, 254)))) || 1;
    return rgb.map((c) => {
      let path = `M0 ${H}`;
      for (let i = 0; i < 256; i += 2) path += `L${(i / 255) * W} ${H - Math.min(1, Math.sqrt(c[i] + c[i + 1]) / (peak * 1.41)) * (H - 4)}`;
      return `${path}L${W} ${H}Z`;
    });
  }, [rgb, H]);

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(255, ((clientX - r.left) / r.width) * 255));
  };

  const shareAt = (v: number) => {
    let n = 0;
    for (let i = Math.max(0, v - 4); i <= Math.min(255, v + 4); i++) n += hist[i];
    return n / total;
  };

  return (
    <figure className="hist">
      {rgb && (
        <div className="minitabs" role="group" aria-label={tx('charts.como_ver_el_histograma')}>
          <button type="button" aria-pressed={view === 'color'} onClick={() => setView('color')}>{tx('common.color')}</button>
          <button type="button" aria-pressed={view === 'rgb'} onClick={() => setView('rgb')}>RGB</button>
        </div>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={tx('charts.histograma_de_valores_de')}
        onPointerMove={(e) => {
          const v = at(e.clientX);
          setHover(Math.round(v));
          if (drag === null || !onChange) return;
          const next = [...thresholds] as [number, number, number];
          const lo = drag === 0 ? 4 : thresholds[drag - 1] + 4;
          const hi = drag === 2 ? 251 : thresholds[drag + 1] - 4;
          next[drag] = Math.round(Math.max(lo, Math.min(hi, v)));
          onChange(next);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => setDrag(null)}
        onPointerDown={(e) => {
          if (!onChange) return;
          const v = at(e.clientX);
          let best = 0;
          thresholds.forEach((t, i) => {
            if (Math.abs(t - v) < Math.abs(thresholds[best] - v)) best = i;
          });
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(best);
        }}
      >
        {view === 'color' ? (
          <>
            {bars.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} />
            ))}
            <path d={d} className="hist-edge" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          channels.map((p, i) => <path key={i} d={p} className={`hist-ch hist-ch${i}`} />)
        )}
        {thresholds.map((t, i) => {
          const x = (t / 255) * W;
          return <line key={i} x1={x} x2={x} y1={0} y2={H} className={`hist-cut ${drag === i ? 'on' : ''}`} vectorEffect="non-scaling-stroke" />;
        })}
        {hover !== null && <line x1={(hover / 255) * W} x2={(hover / 255) * W} y1={0} y2={H} className="hist-hover" vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption>
        <span>{hover === null ? tx('color.oscuro') : tx('charts.valor', { v1: Math.round(hover / 2.55) })}</span>
        {view === 'rgb' && hover === null && (
          <span className="legend">
            <i className="hist-ch0" /> {tx('words.rojo')} <i className="hist-ch1" /> {tx('words.verde')} <i className="hist-ch2" /> {tx('words.azul')}
          </span>
        )}
        <span>{hover === null ? tx('color.claro') : tx('charts.de_la_imagen', { v1: (shareAt(hover) * 100).toFixed(1) })}</span>
      </figcaption>
    </figure>
  );
}

const HEAT: [number, number, number, number][] = [
  [0, 10, 10, 10],
  [0.3, 120, 16, 12],
  [0.6, 227, 35, 27],
  [0.85, 255, 230, 0],
  [1, 255, 250, 215],
];

/** De negro a rojo, amarillo y blanco: siempre sube la luz, así que se lee en gris. */
function heat(t: number): [number, number, number] {
  for (let i = 1; i < HEAT.length; i++) {
    const [p, r0, g0, b0] = HEAT[i - 1];
    const [q, r1, g1, b1] = HEAT[i];
    if (t <= q) {
      const k = (t - p) / (q - p || 1);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [255, 250, 215];
}

/**
 * Espectrograma tonal: posición horizontal contra valor. En "Real" cada celda lleva el
 * color que tiene la imagen ahí; en "Calor" el color dice cuánta imagen hay en ese valor.
 */
export function Spectrogram({ wave, height = 84, chroma = 0 }: { wave: ToneStats['wave']; height?: number; chroma?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hasColor = !!wave.color && chroma > 0.03;
  const [choice, setChoice] = useState<'real' | 'calor' | null>(null);
  const view = choice ?? (hasColor ? 'real' : 'calor');
  useEffect(() => {
    const c = ref.current!;
    c.width = wave.w;
    c.height = wave.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(wave.w, wave.h);
    for (let i = 0; i < wave.data.length; i++) {
      const v = wave.data[i] / 255;
      if (view === 'calor' || !wave.color) {
        const [r, g, b] = heat(v);
        img.data.set([r, g, b, 255], i * 4);
        continue;
      }
      const r = wave.color[i * 3];
      const g = wave.color[i * 3 + 1];
      const b = wave.color[i * 3 + 2];
      // Lo oscuro se aclara lo justo para distinguir su color sobre fondo negro.
      const lift = Math.max(1, 150 / (Math.max(r, g, b) || 1));
      img.data.set([r * lift, g * lift, b * lift, Math.round(v ** 0.7 * 255)], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }, [wave, view]);
  return (
    <figure className="spectro">
      {wave.color && (
        <div className="minitabs" role="group" aria-label={tx('charts.como_ver_el_espectrograma')}>
          <button type="button" aria-pressed={view === 'real'} onClick={() => setChoice('real')}>{tx('charts.color_real')}</button>
          <button type="button" aria-pressed={view === 'calor'} onClick={() => setChoice('calor')}>{tx('charts.calor')}</button>
        </div>
      )}
      <canvas ref={ref} style={{ height }} role="img" aria-label={tx('charts.espectrograma_en_que_parte')} />
      <figcaption>
        <span>{tx('common.izquierda')}</span>
        {view === 'calor' && (
          <span className="legend">
            {tx('words.poco')} <i className="heat-ramp" /> {tx('words.mucho')}
          </span>
        )}
        <span>{tx('common.derecha')}</span>
      </figcaption>
      {!hasColor && view === 'real' && <p className="note">{tx('charts.esta_imagen_casi_no')}</p>}
    </figure>
  );
}

/** Dónde se concentra el color en el círculo cromático. */
export function HueStrip({ hue }: { hue: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    c.width = hue.length;
    c.height = 1;
    const ctx = c.getContext('2d')!;
    hue.forEach((v, i) => {
      const a = ((i + 0.5) / hue.length) * 2 * Math.PI;
      const [r, g, b] = labToRgb(62, 48 * Math.cos(a), 48 * Math.sin(a));
      ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, v ** 0.6 + 0.02)})`;
      ctx.fillRect(i, 0, 1, 1);
    });
  }, [hue]);
  return <canvas ref={ref} className="huestrip" role="img" aria-label={tx('charts.espectro_de_color_de')} />;
}

export function Palette({ swatches, detailed }: { swatches: Swatch[]; detailed?: boolean }) {
  if (!detailed) {
    return (
      <div className="palette" role="list">
        {swatches.map((s) => (
          <span key={s.hex} role="listitem" style={{ flexGrow: Math.max(0.08, s.share), background: s.hex }} title={`${tr(s.pigment)} · ${s.hex}`} />
        ))}
      </div>
    );
  }
  return (
    <ul className="palette-list">
      {swatches.map((s) => (
        <li key={s.hex}>
          <i style={{ background: s.hex }} aria-hidden />
          <span>{tr(s.pigment)}</span>
          <b>{s.share >= 0.005 ? pct(s.share) : '<1%'}</b>
        </li>
      ))}
    </ul>
  );
}
