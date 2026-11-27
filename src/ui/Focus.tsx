import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, cellName } from '../lib/canvas';
import { readCell } from '../lib/cell';
import type { Recipe } from '../lib/mixing';
import { TECHNIQUE_NOTE, cellRect } from '../lib/plan';
import { recipesFor } from '../state/engine';
import { set, useStore } from '../state/store';
import { ZoneBar, ZoneLegend } from './charts';
import { Button } from './controls';
import { featuresInCell } from './features';
import { planOf } from './overlays';

import { t as tx, tr } from '../i18n';
/** Pantalla para pintar: solo el cuadro actual, grande, con lo que hace falta. */
export function Focus() {
  const state = useStore();
  const { focus, frame, image, canvas, grid, thresholds, done, subjects, figures, technique } = state;
  const ref = useRef<HTMLCanvasElement>(null);
  const [recipes, setRecipes] = useState<(Recipe | null)[] | null>(null);
  const g = useMemo(() => buildGrid(canvas, grid), [canvas, grid]);
  const rect = focus && frame ? cellRect(g, canvas, frame.w, frame.h, focus.col, focus.row) : null;
  const reading = useMemo(() => (frame && rect ? readCell(frame.rgba, frame.L, frame.w, frame.h, rect, thresholds) : null), [frame, focus, thresholds]); // eslint-disable-line
  const name = focus ? cellName(focus.col, focus.row) : '';

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) set((s) => ({ seconds: s.seconds + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!reading) return;
    let alive = true;
    setRecipes(null);
    void recipesFor(reading.palette.map((s) => s.rgb)).then((r) => alive && setRecipes(r));
    return () => {
      alive = false;
    };
  }, [reading]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !rect || !frame || !image) return;
    const host = c.parentElement!;
    const pad = 48;
    const k = Math.min((host.clientWidth - pad) / (rect.w * 3), (host.clientHeight - pad) / (rect.h * 3));
    c.width = Math.round(rect.w * 3 * k * devicePixelRatio);
    c.height = Math.round(rect.h * 3 * k * devicePixelRatio);
    c.style.width = `${rect.w * 3 * k}px`;
    c.style.height = `${rect.h * 3 * k}px`;
    const ctx = c.getContext('2d')!;
    const q = frame.rect.w / frame.w;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper');
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.bitmap, frame.rect.x + (rect.x - rect.w) * q, frame.rect.y + (rect.y - rect.h) * q, rect.w * 3 * q, rect.h * 3 * q, 0, 0, c.width, c.height);
    // Los vecinos se atenúan: dan contexto sin competir con el cuadro.
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper');
    ctx.globalAlpha = 0.72;
    const t = c.width / 3;
    const u = c.height / 3;
    ctx.fillRect(0, 0, c.width, u);
    ctx.fillRect(0, 2 * u, c.width, u);
    ctx.fillRect(0, u, t, u);
    ctx.fillRect(2 * t, u, t, u);
    ctx.globalAlpha = 1;
  });

  if (!focus || !frame || !image || !reading) return null;
  const isDone = done.includes(name);
  const features = featuresInCell({ subjects, frame, image, figures }, { x: rect!.x / frame.w, y: rect!.y / frame.h, w: rect!.w / frame.w, h: rect!.h / frame.h });
  const plan = planOf(state);
  const cell = plan?.cells.find((c) => c.name === name);
  const toggle = () => set({ done: isDone ? done.filter((d) => d !== name) : [...done, name] });
  const go = (dc: number, dr: number) => {
    const next = { col: Math.min(g.cols - 1, Math.max(0, focus.col + dc)), row: Math.min(g.rows - 1, Math.max(0, focus.row + dr)) };
    set({ focus: next });
  };
  const nextInRoute = () => {
    if (!plan) return;
    const rest = [...plan.cells].sort((a, b) => a.order - b.order).filter((c) => !done.includes(c.name) && c.name !== name);
    if (rest[0]) set({ focus: { col: rest[0].col, row: rest[0].row } });
  };
  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label={tx('focus.pintando_el_cuadro', { name })}>
      <div className="focus-stage">
        <canvas ref={ref} />
      </div>
      <aside className="focus-side">
        <header>
          <h2>{name}</h2>
          <span className="counter">{done.length}/{g.cols * g.rows}</span>
        </header>
        {features.length > 0 && <p className="here">{features.join(', ')}</p>}
        <ZoneBar shares={reading.shares} />
        <ZoneLegend shares={reading.shares} />
        <p className="reading">{reading.note}</p>
        {cell && <p className="note">{tx('focus.unos')}{' '}{Math.max(2, Math.round(cell.minutes))} min. {TECHNIQUE_NOTE[technique].split('.')[0]}.</p>}
        <ul className="samples">
          {reading.palette.map((s, i) => (
            <li key={s.hex} className="sample">
              <header>
                <i style={{ background: s.hex }} aria-hidden />
                <span>{recipes?.[i]?.text ?? tr(s.pigment)}</span>
              </header>
            </li>
          ))}
        </ul>
        <div className="focus-pad" role="group" aria-label={tx('focus.mover_de_cuadro')}>
          <button type="button" aria-label={tx('focus.arriba')} onClick={() => go(0, -1)}>↑</button>
          <button type="button" aria-label={tx('common.izquierda')} onClick={() => go(-1, 0)}>←</button>
          <button type="button" aria-label={tx('focus.abajo')} onClick={() => go(0, 1)}>↓</button>
          <button type="button" aria-label={tx('common.derecha')} onClick={() => go(1, 0)}>→</button>
        </div>
        <div className="row">
          <Button variant={isDone ? 'line' : 'ink'} onClick={toggle}>
            {isDone ? tx('common.quitar_marca') : tx('common.marcar_pintado')}
          </Button>
          <Button onClick={nextInRoute}>{tx('focus.siguiente_en_la_ruta')}</Button>
          <Button onClick={() => set({ focusMode: false })}>{tx('focus.salir')}</Button>
        </div>
      </aside>
    </div>
  );
}
