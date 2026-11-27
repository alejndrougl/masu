import { useEffect, useMemo, useRef, useState } from 'react';
import { sampleLab, withKeyColors } from '../lib/color';
import { TUBES, type Recipe } from '../lib/mixing';
import { paintByTube, TECHNIQUE_NOTE, TECHNIQUES, formatHours } from '../lib/plan';
import { faceBoxes } from '../lib/simplify';
import { clearCompare, recipesFor } from '../state/engine';
import { set, useStore } from '../state/store';
import { Compare } from './Compare';
import { Button, Section, Segmented, Slider } from './controls';
import { planOf } from './overlays';

import { t, tr } from '../i18n';
const mmss = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? t('pintar.min', { h, m }) : t('pintar.min_2', { m });
};

export function PintarPanel() {
  const state = useStore();
  const { frame, technique, pace, planView, done, seconds, compare, canvas } = state;
  const plan = useMemo(() => planOf(state), [frame, state.grid, canvas, technique, pace, state.figures]); // eslint-disable-line
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const tubesOn = state.tubes;
  // La piel de los rostros pesa poco en el cuadro pero hay que mezclarla: se suma a la paleta.
  const palette = useMemo(() => {
    if (!frame) return [];
    const faces = faceBoxes(state.subjects, state.image, frame.rect);
    if (!faces.length) return frame.palette;
    const regions = faces.map((f) => sampleLab(frame.rgba, frame.w, Math.floor(f.x * frame.w), Math.floor(f.y * frame.h), Math.max(1, Math.floor(f.w * frame.w)), Math.max(1, Math.floor(f.h * frame.h)), 1500));
    return withKeyColors(frame.palette, regions, faces.map((f) => Math.min(0.5, f.w * f.h)));
  }, [frame, state.subjects, state.image]);
  // Las mismas recetas de la pestaña Color: una sola fuente para lo que se mezcla y lo que se compra.
  const [recipes, setRecipes] = useState<(Recipe | null)[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRecipes(null);
    if (palette.length) void recipesFor(palette.map((s) => s.rgb)).then((r) => alive && setRecipes(r));
    return () => {
      alive = false;
    };
  }, [palette, tubesOn]);
  if (!plan || !frame) return null;
  const total = plan.cells.length;
  const pct = total ? done.length / total : 0;
  const remaining = plan.cells.filter((c) => !done.includes(c.name)).reduce((a, c) => a + c.minutes, 0) / 60;
  const next = [...plan.cells].sort((a, b) => a.order - b.order).find((c) => !done.includes(c.name));
  const paint = recipes ? paintByTube(palette, recipes, TUBES, canvas, technique).filter((p) => p.ml >= 0.5 && Number.isFinite(p.ml)) : [];
  const worst = compare ? [...compare.cells].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).filter((c) => Math.abs(c.diff) >= 0.06).slice(0, 5) : [];
  return (
    <>
      <Section>
        <p className="verdict">
          {t('pintar.n_de_m_cuadros', { done: done.length, total })}
          <small>{t('pintar.pintando_faltan_unas', { time: mmss(seconds), left: formatHours(remaining) })}</small>
        </p>
        <div className="progress" aria-hidden>
          <i style={{ transform: `scaleX(${pct})` }} />
        </div>
        {next && (
          <div className="row">
            <Button
              variant="ink"
              onClick={() => {
                const c = plan.cells.find((x) => x.name === next.name)!;
                set({ focus: { col: c.col, row: c.row }, focusMode: true });
              }}
            >{t('common.seguir_con')}{' '}{next.name}
            </Button>
          </div>
        )}
        {next && <p className="note">{t('pintar.el_orden_va_del')}</p>}
      </Section>
      <Section title={t('pintar.tecnica')}>
        <Segmented label={t('pintar.tecnica')} value={technique} options={TECHNIQUES} onChange={(v) => set({ technique: v })} />
        <p className="note">{TECHNIQUE_NOTE[technique]}</p>
        <Slider label={t('pintar.tu_ritmo')} value={pace} min={0.15} max={1.2} step={0.05} format={(v) => (v < 0.35 ? t('pintar.rapido') : v < 0.7 ? t('words.medio') : t('words.lento'))} onChange={(v) => set({ pace: v })} />
      </Section>
      <Section title={t('pintar.mapa_de_trabajo')}>
        <Segmented
          label={t('pintar.mapa')}
          value={planView}
          options={[
            { value: 'ninguno', label: t('pintar.limpio') },
            { value: 'ruta', label: t('common.orden') },
            { value: 'dificultad', label: t('pintar.dificultad') },
            { value: 'valores', label: t('common.valores') },
          ]}
          onChange={(v) => set({ planView: v })}
        />
        {planView === 'ruta' && <p className="note">{t('pintar.numero_de_turno_de')}</p>}
        {planView === 'dificultad' && <p className="note">{t('pintar.lo_mas_rojo_es')}{' '}{plan.hardest.join(', ')}.</p>}
        {planView === 'valores' && <p className="note">{t('pintar.tres_pasadas_por_todo')}</p>}
      </Section>
      {(paint.length > 0 || recipes === null) && (
        <Section title={t('pintar.pintura_necesaria')}>
          {recipes === null && <p className="note">{t('pintar.calculando_las_mezclas')}</p>}
          <ul className="palette-list">
            {paint.map((p) => (
              <li key={p.hex}>
                <i style={{ background: p.hex }} aria-hidden />
                <span>{tr(p.name)}</span>
                <b>{p.ml < 1 ? '<1' : Math.round(p.ml)} ml</b>
              </li>
            ))}
          </ul>
          <p className="note">{t('pintar.por_tubo_sumando_las')}</p>
        </Section>
      )}
      <Section title={t('pintar.comparar_con_mi_pintura')}>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          aria-label={t('pintar.foto_de_tu_pintura')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPending(f);
            e.target.value = '';
          }}
        />
        {!compare && <p className="note">{t('pintar.tomale_una_foto_tu')}</p>}
        <div className="row">
          <Button onClick={() => input.current?.click()}>{compare ? t('pintar.otra_foto') : t('pintar.subir_foto')}</Button>
          {compare && <Button onClick={clearCompare}>{t('pintar.quitar')}</Button>}
        </div>
        {compare && (
          <>
            <Slider label={t('pintar.ver_mi_pintura')} value={state.compareSlider} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ compareSlider: v })} />
            {worst.length ? (
              <ul className="facts">
                {worst.map((c) => (
                  <li key={c.name}>
                    <span>{c.name}</span>
                    <b>{c.diff < 0 ? t('common.muy_oscuro') : t('pintar.muy_claro')} ({Math.round(Math.abs(c.diff) * 100)}%)</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="reading">{t('pintar.los_valores_van_muy')}</p>
            )}
            <p className="note">{t('pintar.azul_tu_cuadro_esta')}</p>
          </>
        )}
      </Section>
      {pending && <Compare blob={pending} onClose={() => setPending(null)} />}
    </>
  );
}
