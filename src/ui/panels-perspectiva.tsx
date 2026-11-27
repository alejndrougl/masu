import { useMemo } from 'react';
import { buildGrid, cellName, formatNumber, locate } from '../lib/canvas';
import { lensName, type VanishingPoint } from '../lib/perspective';
import { set, useStore } from '../state/store';
import { setLens } from '../state/engine';
import { Button, Section, Segmented, Slider, Toggle } from './controls';
import { VP_COLORS, VP_INKS, horizonOf, perspectiveOf, vanishingList } from './overlays';

import { t as tx, tr } from '../i18n';
const KIND = ['Sin fuga clara', 'Perspectiva de un punto', 'Perspectiva de dos puntos', 'Perspectiva de tres puntos'];
const SOURCE = { get lineas() { return tx('perspectiva.por_sus_lineas'); }, get profundidad() { return tx('perspectiva.por_lo_mas_lejano'); }, get mano() { return tx('perspectiva.mano'); }, get calculada() { return tx('perspectiva.calculada_con_las_otras'); } } as const;

function where(p: VanishingPoint, canvas: { w: number; h: number }, grid: ReturnType<typeof buildGrid>): string {
  const [x, y] = p.point;
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return tx('perspectiva.dentro_en', { v1: cellName(locate(grid.xs, x * canvas.w), locate(grid.ys, y * canvas.h)) });
  const parts: string[] = [];
  if (x < 0) parts.push(tx('perspectiva.cm_la_izquierda', { v1: formatNumber(-x * canvas.w) }));
  if (x > 1) parts.push(tx('perspectiva.cm_la_derecha', { v1: formatNumber((x - 1) * canvas.w) }));
  if (y < 0) parts.push(tx('perspectiva.cm_arriba', { v1: formatNumber(-y * canvas.h) }));
  if (y > 1) parts.push(tx('perspectiva.cm_abajo', { v1: formatNumber((y - 1) * canvas.h) }));
  return tx('perspectiva.fuera', { v1: parts.join(', ') });
}

export function PerspectivaPanel() {
  const state = useStore();
  const { canvas, grid, pv, vpHidden, vpAdd, vpFit, frame, depth, visionStep } = state;
  const list = useMemo(() => vanishingList(state), [frame, depth, state.vpEdit, state.lensRead]); // eslint-disable-line
  const read = perspectiveOf(state);
  const curve = read.curve;
  const bend = curve ? -curve.k : 0;
  const detected = frame?.perspective;
  const lineMode = !state.lensRead ? 'auto' : curve ? 'curvas' : 'rectas';
  const horizon = horizonOf(list) ?? read.horizon;
  const g = buildGrid(canvas, grid);
  const base = frame?.perspective;
  const edited = !!state.vpEdit;
  const kind = Math.min(3, list.length);
  // Solo se afirma la inclinación de la cámara si las verticales salieron de rectas reales.
  const up = list.find((p) => p.vertical && p.source !== 'calculada' && p.point[1] < 0.5);
  const down = list.find((p) => p.vertical && p.source !== 'calculada' && p.point[1] > 0.5);
  const camera = up ? tx('perspectiva.la_camara_mira_hacia') : down ? tx('perspectiva.la_camara_mira_hacia_2') : null;
  const edit = (next: VanishingPoint[]) => set({ vpEdit: next });
  return (
    <>
      <Section>
        <p className="verdict">
          {curve ? tx('perspectiva.perspectiva_curva') : tr(KIND[kind])}
          {curve && <small>{tx('perspectiva.lente_de_ojo_de')}{' '}{list.length === 1 ? tx('perspectiva.una_fuga') : tx('perspectiva.fugas', { length: list.length })}</small>}
          {!edited && !curve && base?.lens && base.fov && (
            <small>
              {lensName(base.lens)}{tx('perspectiva.como_un')}{' '}{Math.round(base.lens)} mm ({Math.round(base.fov)}{tx('perspectiva.de_vision')}</small>
          )}
        </p>
        {!depth && visionStep === null && <p className="note">{tx('perspectiva.midiendo_la_profundidad_de')}</p>}
        {camera && <p className="reading">{camera}</p>}
        {curve && <p className="reading">{tx('perspectiva.las_rectas_del_mundo')}</p>}
        {horizon !== null && !curve && (
          <p className="reading">{tx('perspectiva.horizonte')}{' '}{formatNumber((1 - horizon) * canvas.h)}{' '}{tx('perspectiva.cm_de_la_base')}{list.length ? '.' : tx('perspectiva.sale_de_la_linea')}
          </p>
        )}
        {!list.length && read.parallel && <p className="reading">{tx('perspectiva.las_rectas_que_hay')}</p>}
        {!list.length && !read.parallel && <p className="reading">{tx('perspectiva.no_encontre_rectas_que')}{' '}{horizon === null ? tx('perspectiva.tampoco_hay_un_horizonte') : ''}{tx('perspectiva.si_tu_las_ves')}</p>}
      </Section>
      {list.length > 0 && (
        <Section title={tx('perspectiva.puntos_de_fuga')}>
          <ul className="vps">
            {list.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="vp-eye"
                  aria-pressed={!vpHidden.includes(i)}
                  aria-label={tx('perspectiva.mostrar_el_punto', { v1: i + 1 })}
                  style={{ ['--vp' as string]: VP_COLORS[i % VP_COLORS.length], ['--vp-ink' as string]: VP_INKS[i % VP_INKS.length] }}
                  onClick={() => set({ vpHidden: vpHidden.includes(i) ? vpHidden.filter((n) => n !== i) : [...vpHidden, i] })}
                >
                  {i + 1}
                </button>
                <span>
                  {where(p, canvas, g)}
                  <small>
                    {p.vertical ? tx('words.verticales') : tx('words.horizontales')}, {SOURCE[p.source]}
                  </small>
                </span>
                <button type="button" className="x" aria-label={tx('perspectiva.quitar_el_punto', { v1: i + 1 })} onClick={() => edit(list.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="note">{tx('perspectiva.arrastra_cada_punto_en')}</p>
        </Section>
      )}
      <Section title={tx('perspectiva.lineas')}>
        <Segmented
          label={tx('perspectiva.como_leer_las_lineas')}
          value={lineMode}
          options={[
            { value: 'auto', label: tx('perspectiva.automatico') },
            { value: 'rectas', label: tx('perspectiva.rectas') },
            { value: 'curvas', label: tx('perspectiva.curvas') },
          ]}
          onChange={(v) => void setLens(v === 'auto' ? null : v === 'rectas' ? 0 : (detected?.curve?.k ?? detected?.hint ?? -0.5))}
        />
        {curve && <Slider label={tx('perspectiva.curvatura')} value={bend} min={0} max={1.6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => void setLens(-v)} />}
        <p className="note">
          {lineMode === 'auto' && curve && tx('perspectiva.las_rectas_del_mundo_2')}
          {lineMode === 'auto' && !curve && !detected?.hint && tx('perspectiva.las_rectas_de_la')}
          {lineMode === 'auto' && !curve && !!detected?.hint && tx('perspectiva.las_leo_rectas_aunque')}
          {lineMode === 'rectas' && tx('perspectiva.forzadas_rectas_sin_importar')}
          {lineMode === 'curvas' && tx('perspectiva.mueve_la_curvatura_hasta')}
        </p>
      </Section>
      <Section title={tx('common.ver')}>
        <div className="stack">
          <Toggle label={tx('perspectiva.lineas')} checked={pv.lines} onChange={(lines) => set({ pv: { ...pv, lines } })} />
          <Toggle label={tx('perspectiva.abanico')} checked={pv.fan} onChange={(fan) => set({ pv: { ...pv, fan } })} />
          <Toggle label={tx('common.horizonte')} checked={pv.horizon} onChange={(h) => set({ pv: { ...pv, horizon: h } })} />
          <Toggle label={tx('perspectiva.ver_afuera')} checked={vpFit} onChange={(v) => set({ vpFit: v })} />
          {curve && <Toggle label={tx('common.circulo')} checked={pv.circle} onChange={(circle) => set({ pv: { ...pv, circle } })} />}
        </div>
        <div className="row">
          <Button variant={vpAdd ? 'ink' : 'line'} onClick={() => set({ vpAdd: !vpAdd })}>
            {vpAdd ? tx('perspectiva.toca_la_imagen') : tx('perspectiva.agregar_punto')}
          </Button>
          {edited && <Button onClick={() => set({ vpEdit: null, vpHidden: [] })}>{tx('common.volver_lo_detectado')}</Button>}
        </div>
      </Section>
    </>
  );
}
