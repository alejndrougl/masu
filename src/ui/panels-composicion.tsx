import { useMemo } from 'react';
import { convertUnit, formatNumber } from '../lib/canvas';
import { activeScheme, adviseCrop, fitOf, readSchemes, type Scheme } from '../lib/composition';
import { PHI, goldenCompanion } from '../lib/golden';
import type { Pt } from '../lib/types';
import { setCanvas, setCrop } from '../state/engine';
import { get, set, useStore } from '../state/store';
import { Button, Section, Segmented, Toggle } from './controls';
import { balanceOf, compositionOf, focalsOf, goldenReading } from './overlays';

import { t } from '../i18n';
const FIT_WORD = { get domina() { return t('composicion.domina'); }, get parcial() { return t('composicion.en_parte'); }, get no() { return t('composicion.no'); } } as const;

function direction(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) > 0.01) parts.push(dx > 0 ? t('common.la_derecha_2') : t('common.la_izquierda_2'));
  if (Math.abs(dy) > 0.01) parts.push(dy > 0 ? t('common.abajo') : t('common.arriba'));
  return parts.join(t('common.sep_y'));
}

function Reframe({ scheme, focal }: { scheme: Scheme; focal: Pt }) {
  const crop = useStore((s) => s.crop);
  const canvas = useStore((s) => s.canvas);
  const image = useStore((s) => s.image);
  if (!image || !scheme.target) return null;
  const aspect = canvas.w / canvas.h;
  const adv = adviseCrop(focal, scheme.target, image, aspect, crop);
  if (adv.moved < 0.008 && adv.crop.zoom === crop.zoom) return null;
  if (adv.residual > 0.04) return <p className="note">{t('composicion.no_hay_foto_de')}</p>;
  const cm = (v: number, side: number) => formatNumber(Math.abs(v) * side);
  return (
    <div className="row">
      <Button onClick={() => setCrop(adv.crop)}>{t('composicion.reencuadrar_para_este_esquema')}</Button>
      <p className="note">{t('composicion.el_encuadre_se_mueve')}{' '}{direction(adv.dx, adv.dy) || t('composicion.poco')} ({cm(adv.dx, canvas.w)} × {cm(adv.dy, canvas.h)} cm)
        {adv.crop.zoom > crop.zoom + 0.01 ? t('composicion.acerca', { v1: adv.crop.zoom.toFixed(2) }) : ''}.
      </p>
    </div>
  );
}

export function ComposicionPanel() {
  const state = useStore();
  const c = state.composition;
  const { canvas, frame, subjects, figures, scheme: chosen } = state;
  const schemes = useMemo(() => compositionOf(state), [frame, subjects, figures, canvas]); // eslint-disable-line
  const read = readSchemes(schemes);
  const active = activeScheme(schemes, chosen);
  const up = (patch: Partial<typeof c>) => set({ composition: { ...c, ...patch } });
  const focals = useMemo(() => focalsOf(state), [frame, subjects]); // eslint-disable-line
  const main = focals.length ? focals.reduce((a, b) => (b.weight > a.weight ? b : a)) : null;
  const reading = goldenReading(state);
  const golden = goldenCompanion(canvas.w, canvas.h);
  const u = canvas.unit === 'cm' ? 'cm' : 'in';
  const shown = (v: number) => formatNumber(convertUnit(v, 'cm', canvas.unit));
  const isGolden = reading.ratioOff < 0.02;
  const bal = frame ? balanceOf(frame) : null;
  return (
    <>
      <Section>
        <p className={`verdict ${read.clear && read.leading[0].score >= 62 ? 'v-si' : ''}`}>
          {read.headline}
          <small>{read.detail}</small>
        </p>
        {main && <p className="note">{t('composicion.el_foco_es')}{' '}{main.label}.</p>}
        {read.leading.length > 1 && <p className="note">{t('composicion.los_dos_explican_la')}{' '}{(active ?? read.leading[0]).name.toLowerCase()}{t('composicion.toca_el_otro_en')}</p>}
      </Section>
      <Section title={t('composicion.esquemas')}>
        <ul className="schemes">
          {schemes.map((x) => {
            const fit = fitOf(x.score);
            return (
              <li key={x.id}>
                <button type="button" aria-pressed={active?.id === x.id} onClick={() => set({ scheme: x.id })}>
                  <span className="scheme-name">{x.name}</span>
                  <span className="scheme-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${Math.max(0.02, x.score / 100)})` }} />
                  </span>
                  <small>{FIT_WORD[fit]}</small>
                </button>
              </li>
            );
          })}
        </ul>
        {active ? <p className="reading">{active.why}</p> : <p className="reading">{t('composicion.elige_un_esquema_si')}</p>}
        {active?.id === 'espiral' && (
          <Segmented
            label={t('composicion.giro_de_la_espiral')}
            value={c.turn === null ? 'auto' : String(c.turn)}
            options={[
              { value: 'auto', label: t('common.auto') },
              { value: '0', label: '◢' },
              { value: '1', label: '◣' },
              { value: '2', label: '◤' },
              { value: '3', label: '◥' },
            ]}
            onChange={(v) => up({ turn: v === 'auto' ? null : (Number(v) as 0 | 1 | 2 | 3) })}
          />
        )}
        {active && main && <Reframe scheme={active} focal={[main.x, main.y]} />}
      </Section>
      <Section title={t('composicion.guias_encima')}>
        <div className="stack">
          <Toggle label={t('common.tercios')} checked={c.thirds} onChange={(thirds) => up({ thirds })} />
          <Toggle label={t('composicion.rejilla_aurea')} checked={c.golden} onChange={(g) => up({ golden: g })} />
          <Toggle label={t('common.diagonales')} checked={c.diagonals} onChange={(diagonals) => up({ diagonals })} />
          <Toggle label={t('composicion.peso_visual')} checked={state.balance} onChange={(v) => set({ balance: v })} />
          <Toggle label={t('composicion.atencion')} checked={state.attention} onChange={(v) => set({ attention: v })} />
          <Toggle label={t('composicion.lineas_al_foco')} checked={state.leadLines} onChange={(v) => set({ leadLines: v })} />
        </div>
        {state.balance && bal && <p className="note">{bal.label}{t('composicion.el_rombo_marca_el')}</p>}
        {state.attention && <p className="note">{t('composicion.lo_mas_rojo_es')}</p>}
        {state.leadLines && <p className="note">{t('composicion.las_rectas_fuertes_que')}</p>}
      </Section>
      <Section title={t('composicion.tu_lienzo')}>
        <p className="reading">
          {isGolden ? t('composicion.mide_casi_aureo', { v1: reading.ratio.toFixed(2), v2: PHI.toFixed(3) }) : t('composicion.su_proporcion_es_la', { v1: reading.ratio.toFixed(2), v2: PHI.toFixed(3) })}
        </p>
        {!isGolden && (
          <Button
            onClick={() => {
              const next = get().canvas;
              setCanvas({ ...next, w: Math.round(golden.w * 10) / 10, h: Math.round(golden.h * 10) / 10 });
            }}
          >{t('composicion.hacerlo_aureo')}{' '}{shown(golden.w)} × {shown(golden.h)} {u}
          </Button>
        )}
      </Section>
    </>
  );
}
