import { warmthOfValues } from '../lib/extras';
import { useEffect, useMemo, useState } from 'react';
import { rgbToLab, hex, labToRgb, nearestPigment } from '../lib/color';
import { hueName, readHarmony } from '../lib/harmony';
import { TUBES, TUBE_SETS, type Recipe } from '../lib/mixing';
import { recipesFor, showMap } from '../state/engine';
import { set, useStore, type MapKind, type Sample } from '../state/store';
import { HueStrip } from './charts';
import { Section } from './controls';

import { t as tx, tr } from '../i18n';
/** Rueda de color con los tonos reales de la imagen. */
function Wheel({ hue, peaks, accent }: { hue: number[]; peaks: number[]; accent: number | null }) {
  const size = 148;
  const c = size / 2;
  const R = 66;
  const r = 44;
  const pos = (deg: number, radius: number) => [c + radius * Math.cos((deg * Math.PI) / 180), c - radius * Math.sin((deg * Math.PI) / 180)];
  const n = hue.length;
  return (
    <svg className="wheel" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={tx('color.rueda_con_los_colores')}>
      {hue.map((v, i) => {
        const a0 = (i * 360) / n;
        const a1 = ((i + 1) * 360) / n;
        const [x0, y0] = pos(a0, r);
        const [x1, y1] = pos(a0, R);
        const [x2, y2] = pos(a1, R);
        const [x3, y3] = pos(a1, r);
        const [cr, cg, cb] = labToRgb(62, 48 * Math.cos(((a0 + a1) * Math.PI) / 360), 48 * Math.sin(((a0 + a1) * Math.PI) / 360));
        return <path key={i} d={`M${x0} ${y0}L${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z`} fill={`rgb(${cr},${cg},${cb})`} opacity={0.12 + Math.min(1, v ** 0.6) * 0.88} />;
      })}
      {peaks.map((d) => {
        const [x, y] = pos(d, r - 6);
        return <line key={d} x1={c} y1={c} x2={x} y2={y} className="wheel-spoke" />;
      })}
      {accent !== null &&
        (() => {
          const [x, y] = pos(accent, r - 6);
          return <circle cx={x} cy={y} r={3.5} className="wheel-accent" />;
        })()}
    </svg>
  );
}

function RecipeLine({ recipe, target }: { recipe: Recipe | null | undefined; target: string }) {
  if (recipe === undefined) return <p className="recipe note">{tx('color.calculando')}</p>;
  if (recipe === null) return <p className="recipe note">{tx('color.elige_al_menos_un')}</p>;
  return (
    <div className="recipe">
      <span className="recipe-swatches" aria-hidden>
        <i style={{ background: target }} />
        <i style={{ background: hex(recipe.result) }} />
      </span>
      <span>{recipe.text}</span>
      {recipe.miss && (
        <small>{tx('color.con_estos_tubos_sale')}{' '}{tr(recipe.resultName).toLowerCase()}, {recipe.miss} {tx('color.diferencia', { n: Math.round(recipe.error) })}.
        </small>
      )}
    </div>
  );
}

function SampleRow({ sample, recipe }: { sample: Sample; recipe: Recipe | null | undefined }) {
  const [L, a, b] = rgbToLab(...sample.rgb);
  const warm = 0.75 * b + 0.45 * a;
  const chroma = Math.hypot(a, b);
  const temp = chroma < 6 ? 'neutro' : warm > 2 ? tx('common.calido') : tx('common.frio');
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return (
    <li className="sample">
      <header>
        <i style={{ background: sample.hex }} aria-hidden />
        <span>{chroma < 6 ? tr(nearestPigment(sample.rgb)) : `${hueName(deg)} ${temp}`}</span>
        <b>{tx('color.valor_n', { n: Math.max(1, Math.round((L / 100) * 8) + 1) })}</b>
        <button type="button" className="x" aria-label={tx('color.quitar_muestra')} onClick={() => set((s) => ({ samples: s.samples.filter((x) => x.id !== sample.id) }))}>
          ×
        </button>
      </header>
      <RecipeLine recipe={recipe} target={sample.hex} />
    </li>
  );
}

export function ColorPanel() {
  const frame = useStore((s) => s.frame);
  const base = useStore((s) => s.base);
  const mapKind = useStore((s) => s.mapKind);
  const maps = useStore((s) => s.maps);
  const tubes = useStore((s) => s.tubes);
  const samples = useStore((s) => s.samples);
  const [recipes, setRecipes] = useState<(Recipe | null)[] | null>(null);
  const [sampleRecipes, setSampleRecipes] = useState<Record<number, Recipe | null>>({});
  const palette = frame?.palette;
  const warmth = useMemo(() => (frame ? warmthOfValues(frame.rgba, frame.L) : null), [frame]);

  useEffect(() => {
    set({ tool: 'gotero' });
    return () => set({ tool: 'ninguna' });
  }, []);

  useEffect(() => {
    if (!palette) return;
    let alive = true;
    setRecipes(null);
    void recipesFor(palette.map((s) => s.rgb)).then((r) => alive && setRecipes(r));
    return () => {
      alive = false;
    };
  }, [palette, tubes]);

  useEffect(() => {
    let alive = true;
    if (!samples.length) return;
    void recipesFor(samples.map((s) => s.rgb)).then((r) => {
      if (alive) setSampleRecipes(Object.fromEntries(samples.map((s, i) => [s.id, r[i]])));
    });
    return () => {
      alive = false;
    };
  }, [samples, tubes]);

  const harmony = useMemo(() => (frame ? readHarmony(frame.stats.hue, frame.stats.colored) : null), [frame]);
  if (!frame || !harmony) return null;
  const [warm, neutral, cool] = frame.temperature;
  const gray = harmony.kind === 'Casi acromática';
  const view: 'foto' | MapKind = base === 'mapa' ? mapKind : 'foto';
  const toggleTube = (id: string) => set((s) => ({ tubes: s.tubes.includes(id) ? s.tubes.filter((t) => t !== id) : [...s.tubes, id] }));
  const shares = base === 'mapa' ? maps[mapKind]?.shares : undefined;
  return (
    <>
      <Section>
        <div className="chips" role="group" aria-label={tx('common.vista')}>
          {(
            [
              ['foto', tx('common.foto')],
              ['temperatura', tx('color.temperatura')],
              ['saturacion', tx('color.saturacion')],
              ['bordes', tx('color.bordes')],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" className="chip" aria-pressed={view === v} onClick={() => showMap(v === 'foto' ? null : v)}>
              {label}
            </button>
          ))}
        </div>
        {view === 'temperatura' && <p className="note">{tx('color.rojo_es_calido_azul')}</p>}
        {view === 'saturacion' && shares && <p className="note">{Math.round(shares[0] * 100)}{tx('color.muy_saturado')}{' '}{Math.round(shares[1] * 100)}{tx('color.casi_gris_reserva_lo')}</p>}
        {view === 'bordes' && <p className="note">{tx('color.negro_son_bordes_duros')}</p>}
      </Section>
      {warmth && (
        <Section title={tx('color.temperatura')}>
          <p className="reading">{warmth.text}</p>
        </Section>
      )}
      <Section title={tx('color.armonia')}>
        <div className="harmony">
          {!gray && <Wheel hue={frame.stats.hue} peaks={harmony.peaks} accent={harmony.accent?.deg ?? null} />}
          <div>
            <p className="verdict">{tr(harmony.kind)}</p>
            <div className="facts">
              <p>
                <span>{tx('color.calido')}</span> <b>{Math.round(warm * 100)}%</b>
              </p>
              <p>
                <span>{tx('color.frio')}</span> <b>{Math.round(cool * 100)}%</b>
              </p>
              <p>
                <span>{tx('color.neutro')}</span> <b>{Math.round(neutral * 100)}%</b>
              </p>
            </div>
          </div>
        </div>
        <p className="reading">{harmony.note}</p>
        {!gray && <HueStrip hue={frame.stats.hue} />}
      </Section>
      <Section title={tx('color.mis_tubos')}>
        <div className="chips" role="group" aria-label={tx('color.paletas')}>
          {TUBE_SETS.map((t) => {
            const on = t.tubes.length === tubes.length && t.tubes.every((x) => tubes.includes(x));
            return (
              <button key={t.id} type="button" className="chip" aria-pressed={on} onClick={() => set({ tubes: t.tubes })}>
                {t.name}
              </button>
            );
          })}
        </div>
        <div className="tubes">
          {TUBES.map((t) => (
            <button key={t.id} type="button" className="tube" aria-pressed={tubes.includes(t.id)} title={t.name} aria-label={t.name} onClick={() => toggleTube(t.id)}>
              <i style={{ background: hex(t.rgb) }} />
            </button>
          ))}
        </div>
      </Section>
      <Section title={tx('color.muestras')}>
        {samples.length === 0 && <p className="note">{tx('color.toca_la_imagen_para')}</p>}
        {samples.length > 0 && (
          <ul className="samples">
            {samples.map((s) => (
              <SampleRow key={s.id} sample={s} recipe={sampleRecipes[s.id]} />
            ))}
          </ul>
        )}
      </Section>
      <Section title={tx('color.mezclas_de_la_paleta')}>
        <ul className="samples">
          {frame.palette.map((s, i) => (
            <li key={s.hex} className="sample">
              <header>
                <i style={{ background: s.hex }} aria-hidden />
                <span>{tr(s.pigment)}</span>
                <b>{Math.round(s.share * 100)}%</b>
              </header>
              <RecipeLine recipe={recipes ? recipes[i] : undefined} target={s.hex} />
            </li>
          ))}
        </ul>
        <p className="note">{tx('color.proporciones_aproximadas_prueb')}</p>
      </Section>
    </>
  );
}
