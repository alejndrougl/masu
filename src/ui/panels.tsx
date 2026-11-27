import { useEffect, useMemo, useRef } from 'react';
import { PRESETS, buildGrid, cellName, convertUnit, cropLoss, exactCells, formatNumber, orient } from '../lib/canvas';
import { faceLight, lightDirection, readCell } from '../lib/cell';
import { labToRgb, paletteFrom, sampleLab } from '../lib/color';
import { regionHistogram, valueReading, waveform, zoneOf, zoneShares } from '../lib/tones';
import type { Rect, Subject, Swatch, Unit } from '../lib/types';
import { currentRect, removeFigure, setBase, setCanvas, setCrop, setSimplify, setStyle } from '../state/engine';
import { set, useStore, type Base, type Style } from '../state/store';
import { HueStrip, Histogram, Palette, Spectrogram, ZoneBar, ZoneLegend } from './charts';
import { Button, NumberField, Section, Segmented, Slider, Toggle } from './controls';
import { featuresInCell } from './features';
import { cellOf, encajeStart, encajeSteps, focusCrossings, namedSubjects, toFrame, visibleSubjects } from './overlays';
import { regionOf, type Region } from '../lib/parts';

import { t as tx, tr } from '../i18n';
const unitLabel = (u: Unit) => (u === 'cm' ? 'cm' : 'in');

/** Sujetos a los que el encuadre les corta un pedazo importante. */
function cutSubjects(subjects: Subject[], rect: Rect | null, image: { w: number; h: number } | null): string[] {
  if (!rect || !image) return [];
  const x0 = rect.x / image.w;
  const y0 = rect.y / image.h;
  const x1 = x0 + rect.w / image.w;
  const y1 = y0 + rect.h / image.h;
  const out = new Set<string>();
  for (const s of subjects) {
    if (s.kind === 'object') continue;
    const b = s.box;
    const w = Math.max(0, Math.min(x1, b.x + b.w) - Math.max(x0, b.x));
    const h = Math.max(0, Math.min(y1, b.y + b.h) - Math.max(y0, b.y));
    const shown = (w * h) / (b.w * b.h || 1);
    if (shown > 0.05 && shown < 0.86) out.add(s.label);
  }
  return [...out].slice(0, 3);
}

export function LienzoPanel() {
  const subjects = useStore((s) => s.subjects);
  const canvas = useStore((s) => s.canvas);
  const crop = useStore((s) => s.crop);
  const image = useStore((s) => s.image);
  if (!image) return null;
  const { unit } = canvas;
  const shown = (v: number) => Number(formatNumber(convertUnit(v, 'cm', unit)));
  const inCm = (v: number) => convertUnit(v, unit, 'cm');
  const w = shown(canvas.w);
  const h = shown(canvas.h);
  const aspect = canvas.w / canvas.h;
  const loss = cropLoss(image.w, image.h, aspect, crop);
  const cut = cutSubjects(subjects, currentRect(), image);
  const photoLike = () => {
    const long = Math.max(canvas.w, canvas.h);
    const short = Math.round((long * Math.min(image.w, image.h)) / Math.max(image.w, image.h));
    const next = image.w >= image.h ? { w: long, h: short } : { w: short, h: long };
    setCanvas({ ...canvas, ...next });
    setCrop({ cx: 0.5, cy: 0.5, zoom: 1 });
  };
  return (
    <>
      <Section>
        <div className="dims">
          <NumberField label={tx('panels.ancho')} value={w} onCommit={(v) => setCanvas({ ...canvas, w: inCm(v) })} />
          <span className="dims-x">×</span>
          <NumberField label={tx('panels.alto')} value={h} onCommit={(v) => setCanvas({ ...canvas, h: inCm(v) })} />
          <Segmented
            label={tx('panels.unidad')}
            value={unit}
            options={[
              { value: 'cm', label: 'cm' },
              { value: 'in', label: tx('panels.pul') },
            ]}
            onChange={(u) => set({ canvas: { ...canvas, unit: u } })}
          />
        </div>
        <div className="row">
          <Button onClick={() => setCanvas({ ...canvas, w: canvas.h, h: canvas.w })}>{tx('panels.girar')}</Button>
          <Button onClick={photoLike}>{tx('panels.como_la_foto')}</Button>
        </div>
      </Section>
      <Section title={tx('panels.medidas')}>
        <div className="presets">
          {PRESETS.map((p) => {
            const o = orient(p, image.w, image.h);
            const active = Math.abs(o.w - canvas.w) < 0.05 && Math.abs(o.h - canvas.h) < 0.05;
            // Con raíz los tamaños se comparan a ojo sin que el mayor aplaste al resto.
            const long = Math.max(p.w, p.h);
            const scale = (46 * (long / 120) ** 0.45) / long;
            return (
              <button key={p.id} type="button" className="preset" aria-pressed={active} onClick={() => setCanvas({ ...canvas, ...o })}>
                <span className="preset-shape" style={{ width: o.w * scale, height: o.h * scale }} aria-hidden />
                <span>{p.group === 'papel' ? p.label : `${o.w} × ${o.h}`}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title={tx('common.encuadre')}>
        <Slider
          label={tx('panels.acercar')}
          value={crop.zoom}
          min={1}
          max={4}
          step={0.01}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(zoom) => setCrop({ ...crop, zoom })}
        />
        <p className="note">
          {loss < 0.01 ? tx('panels.la_foto_entra_completa') : tx('panels.queda_fuera_de_la', { v1: Math.round(loss * 100) })}{' '}{tx('panels.arrastra_la_imagen_para')}</p>
        {cut.length > 0 && <p className="note warn">{tx('panels.este_encuadre_corta')}{' '}{cut.join(', ').toLowerCase()}{tx('panels.si_no_es_proposito')}</p>}
      </Section>
    </>
  );
}

const BASE_OPTIONS: { value: Base; label: string }[] = [
  { value: 'foto', get label() { return tx('common.foto'); } },
  { value: 'valores', get label() { return tx('common.valores'); } },
  { value: 'simple', get label() { return tx('panels.simple'); } },
];

/** Dónde entra y sale el contorno: se marcan esos puntos y luego se unen. */
function CellCrossings({ col, row }: { col: number; row: number }) {
  const state = useStore();
  const g = buildGrid(state.canvas, state.grid);
  const { w: cw, h: ch, unit } = state.canvas;
  const cell = { x: g.xs[col] / cw, y: g.ys[row] / ch, w: (g.xs[col + 1] - g.xs[col]) / cw, h: (g.ys[row + 1] - g.ys[row]) / ch };
  const list = focusCrossings(state, cell);
  if (!list.length) return null;
  const size = (side: string) => (side === 'arriba' || side === 'abajo' ? g.xs[col + 1] - g.xs[col] : g.ys[row + 1] - g.ys[row]);
  const sides = (['arriba', 'abajo', 'izquierda', 'derecha'] as const)
    .map((side) => ({ side, marks: list.filter((c) => c.side === side).sort((p, q) => p.at - q.at).slice(0, 5).map((c) => formatNumber(c.at * size(side))) }))
    .filter((q) => q.marks.length);
  return (
    <Section title={tx('panels.por_donde_pasa_el')}>
      {sides.map((q) => (
        <p key={q.side} className="here">
          <span>{tx(SIDE_KEY[q.side])}</span> {q.marks.join(' · ')} {unitLabel(unit)}
        </p>
      ))}
      <p className="note">{tx('panels.marca_esos_puntos_en')}</p>
    </Section>
  );
}

export function CuadrosPanel() {
  const canvas = useStore((s) => s.canvas);
  const grid = useStore((s) => s.grid);
  const base = useStore((s) => s.base);
  const focus = useStore((s) => s.focus);
  const done = useStore((s) => s.done);
  const g = buildGrid(canvas, grid);
  const exact = exactCells(canvas.w, canvas.h).filter((c) => {
    const cols = Math.max(canvas.w, canvas.h) / c;
    return cols >= 3 && cols <= 24;
  });
  const u = unitLabel(canvas.unit);
  const shown = (v: number) => formatNumber(convertUnit(v, 'cm', canvas.unit));
  const setCell = (cell: number) => set({ grid: { ...grid, cell: Math.max(0.5, cell) }, done: [], focus: null });
  const total = g.cols * g.rows;
  return (
    <>
      {focus && <CellDetail col={focus.col} row={focus.row} />}
      {focus && <CellCrossings col={focus.col} row={focus.row} />}
      <Section>
        <div className="big">
          <button type="button" className="step" aria-label={tx('panels.cuadro_mas_chico')} onClick={() => setCell(grid.cell - (grid.cell > 5 ? 1 : 0.5))}>
            −
          </button>
          <div className="big-value">
            <strong>{shown(grid.cell)}</strong>
            <small>{u}{' '}{tx('panels.por_cuadro')}</small>
          </div>
          <button type="button" className="step" aria-label={tx('panels.cuadro_mas_grande')} onClick={() => setCell(grid.cell + (grid.cell >= 5 ? 1 : 0.5))}>
            +
          </button>
        </div>
        <p className="note">
          {g.cols} × {g.rows} · {total}{' '}{tx('panels.cuadros_en')}{' '}{shown(canvas.w)} × {shown(canvas.h)} {u}
        </p>
        {exact.length > 0 && (
          <div className="chips" role="group" aria-label={tx('panels.medidas_que_cierran_exacto')}>
            {exact.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={c === grid.cell} onClick={() => setCell(c)}>
                {shown(c)}
              </button>
            ))}
            <span className="chips-note">{tx('panels.cierran_exacto')}</span>
          </div>
        )}
        <Slider
          label={tx('panels.por_numero_de_cuadros')}
          value={Math.round(canvas.w / grid.cell)}
          min={2}
          max={30}
          format={(v) => tx('panels.de_ancho', { v })}
          onChange={(n) => setCell(Math.round((canvas.w / n) * 100) / 100)}
        />
        {(g.restX > 0 || g.restY > 0) && (
          <p className="note warn">
            {grid.origin === 'center' ? tx('panels.tiras_repartidas_en_los') : tx('panels.sobra_una_tira_en')}: {shown(g.restX)} × {shown(g.restY)} {u}.
          </p>
        )}
      </Section>
      <Section title={tx('panels.rejilla')}>
        <div className="stack">
          <Toggle label={tx('panels.mostrar')} checked={grid.visible} onChange={(visible) => set({ grid: { ...grid, visible } })} />
          <Toggle label={tx('panels.nombres')} checked={grid.labels} onChange={(labels) => set({ grid: { ...grid, labels } })} />
          <Toggle label={tx('panels.mitades')} checked={grid.half} onChange={(half) => set({ grid: { ...grid, half } })} />
          <Toggle label={tx('common.diagonales')} checked={grid.diagonals} onChange={(diagonals) => set({ grid: { ...grid, diagonals } })} />
          <Toggle
            label={tx('panels.centrar')}
            checked={grid.origin === 'center'}
            onChange={(c) => set({ grid: { ...grid, origin: c ? 'center' : 'corner' }, done: [], focus: null })}
          />
          <Toggle label={tx('panels.rombos')} checked={grid.rhombus} onChange={(rhombus) => set({ grid: { ...grid, rhombus } })} />
        </div>
        <Slider label={tx('panels.fuerza')} value={grid.opacity} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ grid: { ...grid, opacity } })} />
      </Section>
      <Section title={tx('common.debajo')}>
        <Segmented label={tx('panels.capa_debajo_de_la')} value={base} options={BASE_OPTIONS} onChange={setBase} />
      </Section>
      {!focus && (
        <Section>
          <p className="note">{tx('panels.toca_un_cuadro_para')}</p>
          {done.length > 0 && <p className="note">{tx('panels.n_de_m_pintados', { done: done.length, total })}</p>}
        </Section>
      )}
    </>
  );
}

function CellDetail({ col, row }: { col: number; row: number }) {
  const canvas = useStore((s) => s.canvas);
  const grid = useStore((s) => s.grid);
  const frame = useStore((s) => s.frame);
  const thresholds = useStore((s) => s.thresholds);
  const subjects = useStore((s) => s.subjects);
  const image = useStore((s) => s.image);
  const figures = useStore((s) => s.figures);
  const done = useStore((s) => s.done);
  const base = useStore((s) => s.base);
  const ref = useRef<HTMLCanvasElement>(null);
  const g = useMemo(() => buildGrid(canvas, grid), [canvas, grid]);
  const name = cellName(col, row);
  const rect = useMemo(() => {
    if (!frame) return null;
    const kx = frame.w / canvas.w;
    const ky = frame.h / canvas.h;
    return { x: g.xs[col] * kx, y: g.ys[row] * ky, w: (g.xs[col + 1] - g.xs[col]) * kx, h: (g.ys[row + 1] - g.ys[row]) * ky };
  }, [frame, canvas, g, col, row]);
  const reading = useMemo(
    () => (frame && rect ? readCell(frame.rgba, frame.L, frame.w, frame.h, rect, thresholds) : null),
    [frame, rect, thresholds],
  );
  const features = useMemo(() => {
    if (!frame || !rect || !image) return [];
    return featuresInCell({ subjects, frame, image, figures }, { x: rect.x / frame.w, y: rect.y / frame.h, w: rect.w / frame.w, h: rect.h / frame.h });
  }, [frame, rect, image, subjects, figures]);

  useEffect(() => {
    const c = ref.current;
    const stage = document.querySelector<HTMLCanvasElement>('.sheet canvas.front');
    if (!c || !rect || !stage || !frame) return;
    const size = 560;
    c.width = size;
    c.height = Math.round((size * rect.h) / rect.w);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    if (base === 'foto' && image) {
      const k = frame.rect.w / frame.w;
      ctx.drawImage(image.bitmap, frame.rect.x + rect.x * k, frame.rect.y + rect.y * k, rect.w * k, rect.h * k, 0, 0, c.width, c.height);
    } else {
      const k = stage.width / frame.w;
      ctx.imageSmoothingEnabled = base !== 'simple';
      ctx.drawImage(stage, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, c.width, c.height);
    }
  });

  if (!reading) return null;
  const isDone = done.includes(name);
  const toggle = () => set({ done: isDone ? done.filter((d) => d !== name) : [...done, name] });
  return (
    <Section
      title={tx('panels.cuadro', { name })}
      aside={
        <span className="counter">
          {done.length}/{g.cols * g.rows}
        </span>
      }
    >
      <canvas ref={ref} className="cell-view" />
      <ZoneBar shares={reading.shares} />
      <ZoneLegend shares={reading.shares} />
      {features.length > 0 && (
        <p className="here">
          <span>{tx('panels.aqui_hay')}</span> {features.join(', ')}
        </p>
      )}
      <p className="reading">{reading.note}</p>
      <Palette swatches={reading.palette} detailed />
      <div className="row">
        <Button variant={isDone ? 'line' : 'ink'} onClick={toggle}>
          {isDone ? tx('common.quitar_marca') : tx('common.marcar_pintado')}
        </Button>
        <Button onClick={() => set({ focus: null })}>{tx('common.cerrar')}</Button>
      </div>
    </Section>
  );
}

export function ValoresPanel() {
  const frame = useStore((s) => s.frame);
  const thresholds = useStore((s) => s.thresholds);
  const zones = useStore((s) => s.zones);
  const valueView = useStore((s) => s.valueView);
  const valueSteps = useStore((s) => s.valueSteps);
  const squint = useStore((s) => s.squint);
  if (!frame) return null;
  const shares = zoneShares(frame.stats.hist, thresholds);
  const reading = valueReading(frame.stats.hist, thresholds);
  const names = [tx('common.oscuros'), tx('common.sombras'), tx('common.medios'), tx('common.luces')];
  const zoneGray = [0, 1, 2, 3].map((z) => {
    let sum = 0;
    let count = 0;
    frame.stats.hist.forEach((c, i) => {
      if (zoneOf(i, thresholds) === z) {
        sum += i * c;
        count += c;
      }
    });
    const [v] = labToRgb((count ? sum / count : (z + 0.5) * 64) / 2.55, 0, 0);
    return `rgb(${v},${v},${v})`;
  });
  return (
    <>
      <Section>
        <Segmented
          label={tx('common.vista')}
          value={valueView}
          options={[
            { value: 'zonas', label: tx('common.zonas') },
            { value: 'escala', label: tx('panels.escala') },
            { value: 'notan', label: tx('panels.notan') },
          ]}
          onChange={(v) => set({ valueView: v })}
        />
        {valueView === 'escala' && (
          <>
            <Slider label={tx('common.valores')} value={valueSteps} min={3} max={11} step={2} onChange={(v) => set({ valueSteps: v })} />
            <div className="scale" aria-hidden>
              {Array.from({ length: valueSteps }, (_, i) => {
                const [v] = labToRgb((i / (valueSteps - 1)) * 100, 0, 0);
                return (
                  <span key={i} style={{ background: `rgb(${v},${v},${v})` }}>
                    <b style={{ color: i / (valueSteps - 1) > 0.55 ? '#1b1a18' : '#f2eee5' }}>{i + 1}</b>
                  </span>
                );
              })}
            </div>
            <p className="note">{tx('panels.compara_cada_mancha_contra')}</p>
          </>
        )}
        {valueView === 'notan' && <p className="note">{tx('panels.dos_valores_si_la')}</p>}
        <div className="chips">
          <button type="button" className="chip" aria-pressed={valueView === 'notan'} onClick={() => set({ valueView: 'notan' })}>{tx('panels.dos_valores')}</button>
          <button type="button" className="chip" aria-pressed={valueView === 'escala' && valueSteps === 3} onClick={() => set({ valueView: 'escala', valueSteps: 3 })}>{tx('panels.tres')}</button>
          <button type="button" className="chip" aria-pressed={valueView === 'escala' && valueSteps === 5} onClick={() => set({ valueView: 'escala', valueSteps: 5 })}>{tx('panels.cinco')}</button>
        </div>
        <p className="note">{tx('panels.el_plan_de_valores')}</p>
        <Slider label={tx('panels.entrecerrar_los_ojos')} value={squint} min={0} max={1} step={0.02} format={(v) => (v ? `${Math.round(v * 100)}%` : tx('words.no'))} onChange={(v) => set({ squint: v })} />
      </Section>
      <Section title={tx('panels.histograma')} aside={<Button variant="quiet" onClick={() => set({ thresholds: frame.stats.thresholds })}>{tx('common.auto')}</Button>}>
        <Histogram hist={frame.stats.hist} thresholds={thresholds} tint={frame.stats.tint} rgb={frame.stats.rgb} onChange={(t) => set({ thresholds: t })} />
        <p className="note">{tx('panels.arrastra_las_lineas_para')}</p>
      </Section>
      <Section title={tx('panels.resaltar')}>
        <div className="zones" role="group" aria-label={tx('panels.zonas_de_valor')}>
          {names.map((name, i) => (
            <button
              key={name}
              type="button"
              className="zone"
              aria-pressed={zones[i]}
              onClick={() => set({ valueView: 'zonas', zones: zones.map((z, j) => (j === i ? !z : z)) as typeof zones })}
            >
              <i className="zone-chip" style={{ background: zoneGray[i] }} aria-hidden />
              <span>{name}</span>
              <b>{Math.round(shares[i] * 100)}%</b>
            </button>
          ))}
        </div>
        <p className="reading">{reading.text}</p>
        {reading.zoneNote && <p className="note">{reading.zoneNote}</p>}
      </Section>
      <Section title={tx('panels.espectrograma')}>
        <Spectrogram wave={frame.stats.wave} chroma={frame.stats.chroma} />
        <HueStrip hue={frame.stats.hue} />
        <p className="note">{tx('panels.arriba_las_luces_abajo')}</p>
      </Section>
      <Section title={tx('panels.colores')}>
        <Palette swatches={frame.palette} detailed />
      </Section>
    </>
  );
}

const SIDE_KEY = { arriba: 'panels.lado_arriba', abajo: 'panels.lado_abajo', izquierda: 'panels.lado_izquierda', derecha: 'panels.lado_derecha' } as const;

function summary(faces: number, others: number): string {
  if (!faces && !others) return tx('panels.no_encontre_rostros_animales');
  const f = faces === 1 ? tx('panels.un_rostro') : tx('common.rostros', { faces });
  if (!others) return `${f}.`;
  const o = others === 1 ? tx('panels.otro_elemento') : tx('panels.elementos_mas', { others });
  if (!faces) return others === 1 ? tx('panels.un_elemento_sin_rostros') : tx('panels.elementos_sin_rostros', { others });
  return `${f}${tx('common.sep_y')}${o}.`;
}

const CERTAINTY = (v: number) => (v >= 0.75 ? tx('words.seguro') : v >= 0.5 ? tx('words.probable') : tx('words.posible'));

/** Qué partes del cuerpo aparecen en su mapa. */
function partsRead(sub: Subject): string {
  if (!sub.parts) return '';
  const seen = new Map<Region, number>();
  for (const l of sub.parts.data) {
    const r = regionOf(l);
    seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  const least = sub.parts.data.length * 0.004;
  return (['cabeza', 'tronco', 'brazos', 'piernas', 'pies'] as const).filter((r) => (seen.get(r) ?? 0) > least).map((r) => tr(r)).join(', ');
}

export function SujetosPanel() {
  const subjects = useStore((s) => s.subjects);
  const frame = useStore((s) => s.frame);
  const image = useStore((s) => s.image);
  const selected = useStore((s) => s.selectedSubject);
  const step = useStore((s) => s.visionStep);
  const error = useStore((s) => s.visionError);
  const faceGuides = useStore((s) => s.faceGuides);
  const list = useMemo(() => namedSubjects({ subjects, frame, image }), [subjects, frame, image]);
  const order = { 'human-face': 0, 'anime-face': 0, 'animal-face': 0, head: 0, person: 1, 'anime-person': 1, animal: 1, hand: 1, foot: 1, object: 2 } as const;
  const sorted = [...list].sort((a, b) => order[a.kind] - order[b.kind]);
  const chosen = list.find((s) => s.id === selected);
  const faces = list.filter((s) => s.kind.endsWith('face') || s.kind === 'head').length;
  return (
    <>
      <Section>
        {step && <p className="note">{tx('common.un_momento')}{' '}{step}…</p>}
        {error && <p className="note warn">{tx('panels.algo_fallo_al_analizar')}{' '}{error}</p>}
        {!step && !error && (
          <p className="reading">
            {summary(faces, list.length - faces)}
          </p>
        )}
        {sorted.length > 0 && (
          <ul className="subjects">
            {sorted.map((s) => (
              <li key={s.id}>
                <button type="button" aria-pressed={s.id === selected} onClick={() => set({ selectedSubject: s.id === selected ? null : s.id })}>
                  <span>{s.label}</span>
                  <small>{CERTAINTY(s.score)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {chosen && frame && <SubjectCard key={chosen.id} id={chosen.id} label={chosen.label} guides={faceGuides} />}
    </>
  );
}

function SubjectCard({ id, label, guides }: { id: string; label: string; guides: boolean }) {
  const s = useStore.getState();
  const frame = s.frame!;
  const sub = visibleSubjects(s).find((x) => x.id === id)!;
  const thresholds = useStore((st) => st.thresholds);
  const loomis = useStore((st) => st.loomis);
  const data = useMemo(() => {
    const lightOf = () => {
      if (sub.face && s.image) {
        const to = (i: number): [number, number] => {
          const [fx, fy] = toFrame(frame.rect, s.image!, sub.face![i]);
          return [fx * frame.w, fy * frame.h];
        };
        // Mejillas 205 y 425, frente 151, mentón 199.
        return faceLight(frame.L, frame.w, frame.h, { left: to(205), right: to(425), top: to(151), bottom: to(199), radius: Math.max(2, (sub.fbox.w * frame.w) / 22) });
      }
      return lightDirection(frame.L, frame.w, frame.h, { x, y, w, h });
    };
    const x = Math.max(0, Math.floor(sub.fbox.x * frame.w));
    const y = Math.max(0, Math.floor(sub.fbox.y * frame.h));
    const w = Math.max(2, Math.min(frame.w - x, Math.ceil(sub.fbox.w * frame.w)));
    const h = Math.max(2, Math.min(frame.h - y, Math.ceil(sub.fbox.h * frame.h)));
    const hist = regionHistogram(frame.L, frame.w, x, y, w, h);
    const L = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) L.set(frame.L.subarray((y + r) * frame.w + x, (y + r) * frame.w + x + w), r * w);
    return {
      rect: { x, y, w, h },
      hist,
      wave: waveform(L, w, h, 120, 48),
      palette: paletteFrom(sampleLab(frame.rgba, frame.w, x, y, w, h, 4000), 5),
      light: lightOf(),
    };
  }, [frame, sub.fbox.x, sub.fbox.y, sub.fbox.w, sub.fbox.h]);
  const shares = zoneShares(data.hist, thresholds);
  const isFace = sub.kind.endsWith('face');
  const turn = sub.turn;
  const describeTurn = () => {
    if (!turn) return null;
    const parts: string[] = [];
    if (Math.abs(turn.yaw) > 8) parts.push(tx('panels.girada_la', { v1: Math.abs(turn.yaw), v2: turn.yaw > 0 ? 'derecha' : 'izquierda' }));
    // Cabeceo positivo: la frente adelante del mentón, medido en la profundidad de los puntos.
    if (Math.abs(turn.pitch) > 8) parts.push(turn.pitch > 0 ? tx('panels.mirando_abajo') : tx('panels.mirando_arriba'));
    if (Math.abs(turn.roll) > 5) parts.push(tx('panels.inclinada', { v1: Math.abs(turn.roll) }));
    return parts.length ? tx('panels.cabeza', { v1: parts.join(', ') }) : tx('panels.cabeza_de_frente');
  };
  return (
    <Section title={label} aside={<span className="counter">{Math.round(sub.score * 100)}%</span>}>
      <ZoneBar shares={shares} />
      <ZoneLegend shares={shares} />
      <Spectrogram wave={data.wave} height={60} />
      <Palette swatches={data.palette} detailed />
      {isFace && sub.kind !== 'anime-face' && <p className="reading">{data.light.label}.{turn ? ` ${describeTurn()}` : ''}</p>}
      {sub.kind === 'head' && <p className="reading">{tx('panels.el_rostro_esta_cubierto')}</p>}
      {sub.face && (
        <div className="stack">
          <Toggle label={tx('panels.guias')} checked={guides} onChange={(faceGuides) => set({ faceGuides })} />
          {sub.turn && <Toggle label={tx('panels.bola_de_loomis')} checked={loomis} onChange={(v) => set({ loomis: v })} />}
        </div>
      )}
      {sub.face && <FaceProportions face={sub.face} />}
      {partsRead(sub) && <p className="note">{tx('panels.partes_que_lei')}{' '}{partsRead(sub)}.</p>}
    </Section>
  );
}

/** Compara el rostro con el canon: tres tercios de alto y cinco ojos de ancho. */
function FaceProportions({ face }: { face: [number, number][] }) {
  const dist = (a: number, b: number) => Math.hypot(face[a][0] - face[b][0], face[a][1] - face[b][1]);
  const hair = dist(10, 9);
  const nose = dist(9, 2);
  const chin = dist(2, 152);
  const total = hair + nose + chin || 1;
  const eye = (dist(33, 133) + dist(263, 362)) / 2 || 1;
  const widthInEyes = dist(234, 454) / eye;
  const between = dist(133, 362) / eye;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <div className="facts">
      <p>
        <span>{tx('panels.tercios_del_rostro')}</span> <b>{pct(hair)} · {pct(nose)} · {pct(chin)}</b>
      </p>
      <p>
        <span>{tx('panels.ancho_en_ojos')}</span> <b>{widthInEyes.toFixed(1)}</b>
      </p>
      <p>
        <span>{tx('panels.entre_ojos')}</span> <b>{tx('panels.n_ojos', { n: between.toFixed(1) })}</b>
      </p>
    </div>
  );
}

export function FigurasPanel() {
  const figures = useStore((s) => s.figures);
  const selected = useStore((s) => s.selectedFigure);
  const silhouette = useStore((s) => s.silhouette);
  const showParts = useStore((s) => s.showParts);
  const hasParts = useStore((s) => s.subjects.some((q) => q.parts));
  const ready = useStore((s) => s.figuresReady);
  const step = useStore((s) => s.visionStep);
  const error = useStore((s) => s.visionError);
  return (
    <>
      <Section>
        {step && <p className="note">{tx('common.un_momento')}{' '}{step}…</p>}
        {error && <p className="note warn">{tx('panels.algo_fallo_al_recortar')}{' '}{error}</p>}
        {ready && !figures.length && !step && <p className="reading">{tx('panels.no_encontre_personajes_toca')}</p>}
        {figures.length > 0 && (
          <ul className="subjects">
            {figures.map((f) => (
              <li key={f.id} className="with-x">
                <button type="button" aria-pressed={f.id === selected} onClick={() => set({ selectedFigure: f.id === selected ? null : f.id })}>
                  <span>{f.label}</span>
                  <small>{Math.round(f.mask.reduce((a, b) => a + b, 0) / (f.w * f.h) * 100)}{tx('panels.de_la_foto')}</small>
                </button>
                <button type="button" className="x" aria-label={tx('panels.quitar', { label: f.label })} onClick={() => removeFigure(f.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="note">{tx('panels.toca_algo_en_la')}</p>
      </Section>
      <Section title={tx('common.ver')}>
        <Toggle label={tx('panels.solo_silueta')} checked={silhouette} onChange={(v) => set({ silhouette: v })} />
        <p className="note">{tx('panels.la_silueta_sola_es')}</p>
        {hasParts && <Toggle label={tx('panels.ver_sus_partes')} checked={showParts} onChange={(v) => set({ showParts: v })} />}
        {hasParts && showParts && <p className="note">{tx('panels.rojo_la_cabeza_amarillo')}</p>}
      </Section>
    </>
  );
}

const STAGES = [
  { n: 1, get name() { return tx('common.envolvente'); }, get text() { return tx('panels.pocas_rectas_largas_que'); } },
  { n: 2, get name() { return tx('panels.bloques'); }, get text() { return tx('panels.cada_parte_como_una'); } },
  { n: 3, get name() { return tx('common.contorno'); }, get text() { return tx('panels.la_silueta_real_todavia'); } },
  { n: 4, get name() { return tx('panels.interior'); }, get text() { return tx('panels.que_tapa_que_las'); } },
] as const;

export function EncajePanel() {
  const plumb = useStore((s) => s.plumb);
  const stage = useStore((s) => s.encajeStage);
  const photo = useStore((s) => s.encajePhoto);
  const strokes = useStore((s) => s.strokes);
  const canvas = useStore((s) => s.canvas);
  const grid = useStore((s) => s.grid);
  const step = useStore((s) => s.visionStep);
  const piece = useStore((s) => s.encajePiece);
  const start = encajeStart(strokes, stage);
  const startCell = start ? cellOf({ canvas, grid }, start[0], start[1]) : null;
  const blocks = encajeSteps(strokes, 2);
  // Solo hay figura si el encaje tiene envolvente: sin ella son las masas del cuadro y no hay medida que dar.
  const figureLess = strokes.length > 0 && !strokes.some((s) => s.name === 'Envolvente');
  const outer = strokes.filter((s) => s.stage === 1 && s.name === 'Envolvente').flatMap((s) => s.pts);
  const count = strokes.filter((s) => s.stage === stage).length;
  const size = outer.length
    ? {
        w: (Math.max(...outer.map((p) => p[0])) - Math.min(...outer.map((p) => p[0]))) * canvas.w,
        h: (Math.max(...outer.map((p) => p[1])) - Math.min(...outer.map((p) => p[1]))) * canvas.h,
      }
    : null;
  const pick = (encajeStage: 1 | 2 | 3 | 4) => set((st) => ({ encajeStage, encajePiece: null, encajeRun: st.encajeRun + 1 }));
  const go = (i: number) => set((st) => ({ encajePiece: i >= blocks.length ? null : Math.max(0, i), encajeRun: st.encajeRun + 1 }));
  return (
    <>
      <Section>
        {!strokes.length && <p className="note">{tx('common.un_momento')}{' '}{step ?? tx('words.trazando')}…</p>}
        {startCell && stage <= 2 && (
          <p className="verdict">{tx('panels.empieza_en')}{' '}{cellName(startCell.col, startCell.row)}
            <small>{stage === 1 ? tx('panels.donde_esta_el_la') : tx('panels.donde_esta_el_el')}</small>
          </p>
        )}
        {figureLess && <p className="note">{tx('panels.no_hay_una_figura')}</p>}
        {size && (
          <div className="facts">
            <p>
              <span>{tx('panels.la_figura_ocupa')}</span>
              <b>
                {formatNumber(size.w)} × {formatNumber(size.h)} {canvas.unit === 'cm' ? 'cm' : 'in'}
              </b>
            </p>
          </div>
        )}
      </Section>
      <Section title={tx('common.orden')}>
        <ol className="stages">
          {STAGES.map((s) => (
            <li key={s.n}>
              <button type="button" aria-pressed={stage === s.n} onClick={() => pick(s.n)}>
                <b>{s.n}</b>
                <span>
                  {s.name}
                  <small>{s.text}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="note">{count} {count === 1 ? tx('words.trazo') : tx('words.trazos')}{' '}{tx('panels.en_esta_etapa')}</p>
      </Section>
      {stage === 2 && blocks.length > 1 && (
        <Section title={tx('panels.bloque_por_bloque')} aside={<span className="counter">{piece === null ? tx('panels.todos') : tx('common.n_de_m', { n: piece + 1, m: blocks.length })}</span>}>
          <ol className="pieces">
            {blocks.map((b, i) => (
              <li key={i}>
                <button type="button" aria-pressed={piece === i} data-done={piece !== null && i < piece} onClick={() => go(piece === i ? blocks.length : i)}>
                  <b>{i + 1}</b>
                  {b.name}
                </button>
              </li>
            ))}
          </ol>
          <div className="row">
            <Button onClick={() => go((piece ?? 1) - 1)} disabled={piece === null || piece === 0}>{tx('common.anterior')}</Button>
            <Button variant="ink" onClick={() => go(piece === null ? 0 : piece + 1)}>
              {piece === null ? tx('common.empezar') : piece === blocks.length - 1 ? tx('panels.ver_todos') : tx('common.siguiente')}
            </Button>
          </div>
        </Section>
      )}
      <Section title={tx('common.debajo')}>
        <Slider label={tx('common.foto')} value={photo} min={0} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(encajePhoto) => set({ encajePhoto })} />
        <Toggle label={tx('panels.plomadas')} checked={plumb} onChange={(v) => set({ plumb: v })} />
        {plumb && <p className="note">{tx('panels.rectas_que_unen_puntos')}</p>}
      </Section>
    </>
  );
}

const STYLES: { value: Style; label: string; note: string }[] = [
  { value: 'manchas', get label() { return tx('panels.manchas'); }, get note() { return tx('panels.formas_planas_de_color'); } },
  { value: 'planos', get label() { return tx('common.planos'); }, get note() { return tx('panels.facetas_las_caras_de'); } },
  { value: 'tinta', get label() { return tx('panels.tinta'); }, get note() { return tx('panels.solo_linea_sirve_de'); } },
  { value: 'numeros', get label() { return tx('panels.numeros'); }, get note() { return tx('panels.regiones_numeradas_cada_numero'); } },
  { value: 'proceso', get label() { return tx('panels.proceso'); }, get note() { return tx('panels.como_avanza_el_cuadro'); } },
];

const PROCESS_STEPS = [
  { n: 1, get name() { return tx('panels.bloqueo'); }, get text() { return tx('panels.tres_valores_grandes'); } },
  { n: 2, get name() { return tx('common.masas'); }, get text() { return tx('panels.separa_luz_sombra_de'); } },
  { n: 3, get name() { return tx('common.color'); }, get text() { return tx('panels.aparecen_las_diferencias_de'); } },
  { n: 4, get name() { return tx('panels.acabado'); }, get text() { return tx('panels.bordes_detalle_solo_donde'); } },
] as const;

export function SimplificarPanel() {
  const p = useStore((s) => s.simplify);
  const simplified = useStore((s) => s.simplified);
  const style = useStore((s) => s.style);
  const processStep = useStore((s) => s.processStep);
  const polyCount = useStore((s) => s.polyCount);
  const current = STYLES.find((x) => x.value === style)!;
  const hasPalette = style === 'manchas' || style === 'numeros' || style === 'proceso';
  const focusDetail = useStore((s) => s.focusDetail);
  return (
    <>
      <Section>
        <div className="chips" role="radiogroup" aria-label={tx('common.estilo')}>
          {STYLES.map((o) => (
            <button key={o.value} type="button" className="chip" role="radio" aria-checked={o.value === style} aria-pressed={o.value === style} onClick={() => setStyle({ style: o.value })}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="note">{current.note}</p>
        {style === 'manchas' && <Toggle label={tx('panels.detalle_solo_en_el')} checked={focusDetail} onChange={(v) => setStyle({ focusDetail: v })} />}
        {style === 'proceso' ? (
          <ol className="stages">
            {PROCESS_STEPS.map((x) => (
              <li key={x.n}>
                <button type="button" aria-pressed={processStep === x.n} onClick={() => setStyle({ processStep: x.n })}>
                  <b>{x.n}</b>
                  <span>
                    {x.name}
                    <small>{x.text}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <>
            {(style === 'manchas' || style === 'numeros') && (
              <Segmented
                label={tx('panels.modo')}
                value={p.mode}
                options={[
                  { value: 'color', label: tx('common.color') },
                  { value: 'valor', label: tx('common.valor') },
                ]}
                onChange={(mode) => setSimplify({ mode })}
              />
            )}
            {style === 'planos' ? (
              <Slider label={tx('panels.facetas')} value={polyCount} min={150} max={3000} step={50} onChange={(v) => setStyle({ polyCount: v })} />
            ) : (
              <Slider label={style === 'tinta' ? tx('panels.grosor_de_linea') : tx('common.formas')} value={p.radius} min={style === 'tinta' ? 2 : 0} max={12} format={(v) => (v < 3 ? tx('words.finas') : v < 8 ? tx('words.medias') : tx('words.anchas'))} onChange={(radius) => setSimplify({ radius })} />
            )}
            {(style === 'manchas' || style === 'numeros') && <Slider label={p.mode === 'color' ? tx('panels.colores') : tx('panels.tonos')} value={p.colors} min={2} max={12} onChange={(colors) => setSimplify({ colors })} />}
          </>
        )}
      </Section>
      {hasPalette && (
        <Section title={tx('panels.paleta')}>
          {simplified ? <NumberedPalette swatches={simplified.swatches} numbered={style === 'numeros'} /> : <p className="note">{tx('panels.un_momento')}</p>}
          {simplified && (style === 'manchas' || style === 'numeros') && simplified.swatches.length > p.colors && (
            <p className="note">{tx('panels.pediste')}{' '}{p.colors}{tx('panels.hay')}{' '}{simplified.swatches.length - p.colors}{' '}{tx('panels.mas_porque_los_rostros')}</p>
          )}
          <p className="note">{tx('panels.nombres_de_pigmento_aproximado')}</p>
        </Section>
      )}
    </>
  );
}

function NumberedPalette({ swatches, numbered }: { swatches: Swatch[]; numbered: boolean }) {
  if (!numbered) return <Palette swatches={swatches} detailed />;
  return (
    <ul className="palette-list">
      {swatches.map((s, i) => (
        <li key={s.hex}>
          <i style={{ background: s.hex }} aria-hidden />
          <span>
            <b className="num">{i + 1}</b> {tr(s.pigment)}
          </span>
          <b>{Math.round(s.share * 100)}%</b>
        </li>
      ))}
    </ul>
  );
}
