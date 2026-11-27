import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { buildGrid, formatNumber } from '../lib/canvas';
import { hex } from '../lib/color';
import { currentRect, segmentAt, setCrop } from '../state/engine';
import { get, set, useStore } from '../state/store';
import { baseKey, paintBase } from './layers';
import { buildPrims, cellOf, figureModels, namedSubjects, vanishingList, type Prim, type View } from './overlays';
import { ROJO } from './palette';
import { HANDLES, dragJoint } from '../lib/rig';
import { lightOf, shownLights, sunPlace } from './light-draw';

import { t as tx } from '../i18n';
const LONG = 1600;

function logical(aspect: number) {
  return aspect >= 1 ? { W: LONG, H: Math.round(LONG / aspect) } : { W: Math.round(LONG * aspect), H: LONG };
}

const PrimLayer = memo(function PrimLayer({ prims, zoom }: { prims: Prim[]; zoom: number }) {
  return (
    <>
      {prims.map((p, i) => {
        if (p.t === 'text') {
          return (
            <text key={i} x={p.x} y={p.y} fontSize={p.size} textAnchor={p.anchor ?? 'start'} fontWeight={p.weight} className={p.halo ? (p.fill === ROJO ? 'halo halo-rojo' : 'halo') : undefined} style={{ fill: p.fill }}>
              {p.s}
            </text>
          );
        }
        return (
          <path
            key={p.key ?? i}
            d={p.d}
            clipPath={p.clip ? 'url(#cuadro)' : undefined}
            fill={p.fill ?? 'none'}
            fillRule={p.even ? 'evenodd' : undefined}
            strokeWidth={p.w === undefined ? undefined : p.w / zoom}
            strokeOpacity={p.alpha}
            fillOpacity={p.fillAlpha ?? p.alpha}
            strokeDasharray={p.draw ? undefined : p.dash?.join(' ')}
            strokeLinecap={p.cap}
            strokeLinejoin="round"
            pathLength={p.draw ? 1 : undefined}
            vectorEffect={p.draw ? undefined : 'non-scaling-stroke'}
            className={p.draw ? 'draw' : undefined}
            style={{ stroke: p.stroke ?? 'none', ...(p.draw ? { strokeWidth: `calc(${p.w} * var(--unit))` } : null) }}
          />
        );
      })}
    </>
  );
});

interface Measure {
  a: [number, number];
  b: [number, number];
}

export function Stage() {
  const state = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const mineRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<SVGRectElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [measure, setMeasure] = useState<Measure | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const { canvas, frame, image, mode, crop, tool, mirror, upside, squint, compare, compareSlider } = state;
  const aspect = canvas.w / canvas.h;
  const { W, H } = logical(aspect);

  useLayoutEffect(() => {
    const el = hostRef.current!;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setView({ k: 1, x: 0, y: 0 }), [image]);
  useEffect(() => setMeasure(null), [tool, mode]);

  const margin = 34;
  const fit = Math.min((box.w - margin * 2) / W, (box.h - margin * 2) / H);
  const shownW = Math.max(1, W * fit);
  const shownH = Math.max(1, H * fit);
  const unit = 1 / (fit * view.k || 1);
  const v: View = useMemo(() => ({ W, H, unit }), [W, H, unit]);

  // De cerca: se mueve la hoja, no se vuelve a analizar nada.
  const { closeUp } = state;
  const [gliding, setGliding] = useState(false);
  const firstClose = useRef(true);
  useEffect(() => {
    if (firstClose.current) {
      firstClose.current = false;
      return;
    }
    setGliding(true);
    const t = window.setTimeout(() => setGliding(false), 300);
    if (!closeUp) {
      setView({ k: 1, x: 0, y: 0 });
    } else {
      const k = Math.min(9, 0.86 * Math.min(box.w / (closeUp.w * shownW), box.h / (closeUp.h * shownH)));
      setView({ k, x: (0.5 - (closeUp.x + closeUp.w / 2)) * shownW * k, y: (0.5 - (closeUp.y + closeUp.h / 2)) * shownH * k });
    }
    return () => window.clearTimeout(t);
  }, [closeUp]); // eslint-disable-line

  const prims = useMemo(
    () => buildPrims(state, v),
    [
      state.frame, state.mode, state.grid, state.canvas, state.focus, state.done, state.composition, state.scheme, state.vpEdit, state.vpHidden, state.pv, state.lensRead, state.vpFit, state.depth, state.balance,
      state.subjects, state.selectedSubject, state.faceGuides, state.loomis, state.strokes, state.encajeStage, state.encajeRun, state.figures,
      state.construction, state.pieceStep, state.faceStage, state.detail, state.figurePick, state.formStrokes, state.bodyMethod, state.drawStyle, state.exaggeration, state.simplification, state.theme, state.shapePicks, state.shapePart, state.flowLines, state.headMethod, state.rigHandles, state.rigEdits, state.bodyFaces, state.encajePhoto, state.forceLines, state.simplified, state.style, state.planView, state.compare, state.technique, state.pace, state.peek, state.figuresReady, state.luz, state.lightEdit, state.folds, state.quick, state.locale, v,
    ],
  );

  // En Lienzo la imagen se dibuja directo para que moverla no tenga retraso.
  useEffect(() => {
    if (mode !== 'lienzo' || !image) return;
    const c = frontRef.current!;
    const rect = currentRect();
    if (!rect) return;
    const k = Math.min(1, LONG / Math.max(rect.w, rect.h));
    c.width = Math.max(1, Math.round(rect.w * k));
    c.height = Math.max(1, Math.round(rect.h * k));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  }, [mode, image, crop, canvas]);

  const key = baseKey(state);
  const lastMode = useRef<string>('');
  useEffect(() => {
    if (!frame || mode === 'lienzo') return;
    const c = frontRef.current!;
    const back = backRef.current!;
    const now = `${mode}${state.base}`;
    if (lastMode.current !== now && lastMode.current !== '') {
      // Copia lo que había para disolverlo sobre lo nuevo.
      back.width = c.width;
      back.height = c.height;
      back.getContext('2d')!.drawImage(c, 0, 0);
      back.style.transition = 'none';
      back.style.opacity = '1';
      void back.offsetWidth;
      back.style.transition = '';
      back.style.opacity = '0';
    }
    lastMode.current = now;
    if (c.width !== frame.w || c.height !== frame.h) {
      c.width = frame.w;
      c.height = frame.h;
    }
    paintBase(c.getContext('2d')!, state);
  }, [key, frame]);

  // Mapa de atención encima de la imagen.
  useEffect(() => {
    const c = heatRef.current;
    if (!c || !frame || !state.attention || mode !== 'composicion') return;
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      const a = frame.attention[i];
      img.data[i * 4] = 210;
      img.data[i * 4 + 1] = 69;
      img.data[i * 4 + 2] = 45;
      img.data[i * 4 + 3] = Math.min(235, a ** 1.2 * 255);
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, state.attention, mode]);

  // Foto de la pintura para comparar.
  useEffect(() => {
    const c = mineRef.current;
    if (!c || !compare) return;
    c.width = compare.canvas.width;
    c.height = compare.canvas.height;
    c.getContext('2d')!.drawImage(compare.canvas, 0, 0);
  }, [compare, mode]);

  useEffect(() => {
    const el = hostRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = get();
      if (!s.image) return;
      if (s.mode === 'lienzo') {
        const zoom = Math.min(4, Math.max(1, s.crop.zoom * Math.exp(-e.deltaY * 0.0012)));
        setCrop({ ...s.crop, zoom });
        return;
      }
      const r = sheetRef.current!.getBoundingClientRect();
      const cur = viewRef.current;
      const k = Math.min(10, Math.max(1, cur.k * Math.exp(-e.deltaY * 0.0014)));
      if (k === 1) {
        setView({ k: 1, x: 0, y: 0 });
        return;
      }
      const px = e.clientX - (r.left + r.width / 2);
      const py = e.clientY - (r.top + r.height / 2);
      const q = k / cur.k;
      setView({ k, x: cur.x - px * (q - 1), y: cur.y - py * (q - 1) });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const press = useRef<{ x: number; y: number; moved: boolean; crop: typeof crop; view: typeof view; start: [number, number]; vp: number; joint: { id: string; joint: number } | null; sun?: boolean } | null>(null);

  // Alejar la vista hasta que entren los puntos de fuga que caen fuera del lienzo.
  useEffect(() => {
    if (mode !== 'perspectiva') return;
    if (!state.vpFit) {
      setView({ k: 1, x: 0, y: 0 });
      return;
    }
    const list = vanishingList(state);
    if (!list.length) return;
    const xs = [0, 1, ...list.map((p) => p.point[0])];
    const ys = [0, 1, ...list.map((p) => p.point[1])];
    const minX = Math.max(-6, Math.min(...xs));
    const maxX = Math.min(7, Math.max(...xs));
    const minY = Math.max(-6, Math.min(...ys));
    const maxY = Math.min(7, Math.max(...ys));
    const k = Math.min(1, 0.92 / Math.max(maxX - minX, maxY - minY));
    const cx = (minX + maxX) / 2 - 0.5;
    const cy = (minY + maxY) / 2 - 0.5;
    setView({ k, x: -cx * shownW * k, y: -cy * shownH * k });
  }, [mode, state.vpFit, state.vpEdit, frame, state.depth, shownW, shownH]);

  /** Punto del encuadre bajo el cursor, deshaciendo espejo e inversión. */
  const norm = (e: RPointerEvent): [number, number] => {
    const r = sheetRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return [mirror !== upside ? 1 - x : x, upside ? 1 - y : y];
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = norm(e);
    let vp = -1;
    if (mode === 'perspectiva') {
      const r = sheetRef.current!.getBoundingClientRect();
      vanishingList(get()).forEach((p, i) => {
        if (Math.hypot((p.point[0] - start[0]) * r.width, (p.point[1] - start[1]) * r.height) < 20) vp = i;
      });
    }
    let joint: { id: string; joint: number } | null = null;
    if (mode === 'construccion' && state.rigHandles) {
      const r = sheetRef.current!.getBoundingClientRect();
      let best = 18;
      for (const m of figureModels(get()).list) {
        const rig = m.mannequin?.rig;
        if (!rig) continue;
        for (const h of HANDLES) {
          if (!rig.seen[h.id]) continue;
          const d = Math.hypot((rig.pts[h.id][0] / aspect - start[0]) * r.width, (rig.pts[h.id][1] - start[1]) * r.height);
          if (d < best) {
            best = d;
            joint = { id: m.id, joint: h.id };
          }
        }
      }
    }
    let sun = false;
    if (mode === 'luz' && state.luz.rays) {
      const read = lightOf(get());
      const main = read ? shownLights(get(), read)[0] : null;
      if (read && main) {
        const r = sheetRef.current!.getBoundingClientRect();
        const at = sunPlace(read, main, v, 0).at;
        sun = Math.hypot((at[0] / W - start[0]) * r.width, (at[1] / H - start[1]) * r.height) < 26;
      }
    }
    press.current = { x: e.clientX, y: e.clientY, moved: false, crop, view, start, vp, joint, sun };
    if (tool === 'medir') setMeasure({ a: start, b: start });
  };

  const readout = (x: number, y: number) => {
    const el = document.getElementById('readout');
    if (!el || !frame) return;
    if (x < 0 || y < 0 || x > 1 || y > 1) {
      el.textContent = '';
      return;
    }
    const px = Math.min(frame.w - 1, Math.floor(x * frame.w));
    const py = Math.min(frame.h - 1, Math.floor(y * frame.h));
    const value = Math.max(1, Math.round((frame.L[py * frame.w + px] / 255) * 8) + 1);
    const cm = (n: number, side: number) => formatNumber(n * side);
    el.textContent = tx('stage.cm_valor', { v1: cm(x, canvas.w), v2: cm(y, canvas.h), value });
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (tool === 'medir') {
        p.moved = true;
        setMeasure({ a: p.start, b: norm(e) });
        return;
      }
      if (p.joint) {
        p.moved = true;
        const here = norm(e);
        const { id, joint } = p.joint;
        const s = get();
        const rig = figureModels(s).list.find((m) => m.id === id)?.mannequin?.rig;
        if (rig) set({ rigEdits: { ...s.rigEdits, [id]: dragJoint(rig, joint, here[0] * aspect, here[1], s.rigEdits[id] ?? {}) } });
        return;
      }
      if (p.sun) {
        p.moved = true;
        const here = norm(e);
        const s = get();
        const read = lightOf(s);
        if (read) {
          const main = shownLights(s, read)[0];
          const dx2 = (here[0] - read.center[0]) * W;
          const dy2 = (here[1] - read.center[1]) * H;
          if (Math.hypot(dx2, dy2) > 12) set({ lightEdit: { azimuth: Math.round(((Math.atan2(-dy2, dx2) * 180) / Math.PI + 360) % 360), elevation: s.lightEdit?.elevation ?? Math.round(Math.max(20, Math.min(70, main?.elevation ?? 35))) } });
        }
        return;
      }
      if (p.vp >= 0) {
        p.moved = true;
        const here = norm(e);
        const list = vanishingList(get());
        set({ vpEdit: list.map((q, i) => (i === p.vp ? { ...q, point: here, source: 'mano', lines: [] } : q)) });
        return;
      }
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      if (mode === 'lienzo' && image) {
        const r = currentRect()!;
        const sw = sheetRef.current!.getBoundingClientRect();
        const cx = p.crop.cx - (dx / sw.width) * (r.w / image.w);
        const cy = p.crop.cy - (dy / sw.height) * (r.h / image.h);
        const halfW = r.w / image.w / 2;
        const halfH = r.h / image.h / 2;
        setCrop({ ...p.crop, cx: Math.min(1 - halfW, Math.max(halfW, cx)), cy: Math.min(1 - halfH, Math.max(halfH, cy)) });
      } else if (view.k > 1) {
        setView({ ...p.view, x: p.view.x + dx, y: p.view.y + dy });
      }
      return;
    }
    const [x, y] = norm(e);
    readout(x, y);
    if ((mode === 'cuadros' || mode === 'pintar') && hoverRef.current && frame) {
      const rect = hoverRef.current;
      if (x < 0 || y < 0 || x > 1 || y > 1) {
        rect.style.opacity = '0';
        return;
      }
      const s = get();
      const g = buildGrid(s.canvas, s.grid);
      const c = cellOf(s, x, y);
      const kx = W / s.canvas.w;
      const ky = H / s.canvas.h;
      rect.setAttribute('x', String(g.xs[c.col] * kx));
      rect.setAttribute('y', String(g.ys[c.row] * ky));
      rect.setAttribute('width', String((g.xs[c.col + 1] - g.xs[c.col]) * kx));
      rect.setAttribute('height', String((g.ys[c.row + 1] - g.ys[c.row]) * ky));
      rect.style.opacity = '1';
    }
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || p.moved) return;
    const [x, y] = norm(e);
    const s = get();
    if (s.mode === 'perspectiva' && s.vpAdd) {
      const list = vanishingList(s);
      set({ vpEdit: [...list, { point: [x, y], lines: [], reach: 0, vertical: false, source: 'mano' }], vpAdd: false });
      return;
    }
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    if (s.tool === 'gotero' && s.frame) {
      const px = Math.min(s.frame.w - 1, Math.floor(x * s.frame.w));
      const py = Math.min(s.frame.h - 1, Math.floor(y * s.frame.h));
      const i = (py * s.frame.w + px) * 4;
      const rgb: [number, number, number] = [s.frame.rgba[i], s.frame.rgba[i + 1], s.frame.rgba[i + 2]];
      set({ samples: [{ id: Date.now(), rgb, hex: hex(rgb), value: s.frame.L[py * s.frame.w + px] }, ...s.samples].slice(0, 6) });
      return;
    }
    if (s.mode === 'cuadros' || s.mode === 'pintar') {
      set({ focus: cellOf(s, x, y) });
    } else if (s.mode === 'sujetos') {
      const hit = namedSubjects(s)
        .filter(({ fbox: b }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
        .sort((a, b) => a.fbox.w * a.fbox.h - b.fbox.w * b.fbox.h)[0];
      set({ selectedSubject: hit?.id ?? null });
    } else if (s.mode === 'figuras' && s.frame && s.image) {
      const r = s.frame.rect;
      const ix = (r.x + x * r.w) / s.image.w;
      const iy = (r.y + y * r.h) / s.image.h;
      const inside = [...s.figures].reverse().find((f) => f.mask[Math.floor(iy * f.h) * f.w + Math.floor(ix * f.w)]);
      if (inside) set({ selectedFigure: inside.id });
      else void segmentAt(ix, iy);
    }
  };

  const photoAlpha = state.peek || state.quick ? 1 : mode === 'encaje' || (mode === 'construccion' && state.construction < 9) ? state.encajePhoto : 1;
  const flip = `${mirror ? 'scaleX(-1)' : ''} ${upside ? 'rotate(180deg)' : ''}`.trim();
  const blurPx = squint * Math.min(shownW, shownH) * 0.022;

  let ruler: React.ReactNode = null;
  if (measure) {
    const ax = measure.a[0] * W;
    const ay = measure.a[1] * H;
    const bx = measure.b[0] * W;
    const by = measure.b[1] * H;
    const cm = Math.hypot((measure.a[0] - measure.b[0]) * canvas.w, (measure.a[1] - measure.b[1]) * canvas.h);
    const model = figureModels(state).list[0];
    const headCm = model?.head ? model.head.r * 2 * canvas.h : 0;
    const label = `${formatNumber(cm)} cm${headCm ? tx('stage.cabezas', { v1: (cm / headCm).toFixed(1) }) : ''}`;
    ruler = (
      <g>
        <path d={`M${ax} ${ay}L${bx} ${by}`} className="ruler-case" vectorEffect="non-scaling-stroke" />
        <path d={`M${ax} ${ay}L${bx} ${by}`} className="ruler" vectorEffect="non-scaling-stroke" />
        <text x={(ax + bx) / 2} y={(ay + by) / 2 - 8 * unit} textAnchor="middle" fontSize={13 * unit} className="halo" style={{ fill: '#0a0a0a' }}>
          {label}
        </text>
      </g>
    );
  }

  return (
    <div
      ref={hostRef}
      className="stage"
      data-mode={mode}
      data-tool={state.vpAdd && mode === 'perspectiva' ? 'medir' : tool}
      data-zoomed={view.k > 1}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => {
        if (hoverRef.current) hoverRef.current.style.opacity = '0';
        const el = document.getElementById('readout');
        if (el) el.textContent = '';
      }}
      onDoubleClick={() => setView({ k: 1, x: 0, y: 0 })}
    >
      <div
        ref={sheetRef}
        className="sheet"
        data-gliding={gliding}
        style={{
          width: shownW,
          height: shownH,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          ['--unit' as string]: unit,
        }}
      >
        <div className="sheet-inner" style={{ transform: flip || undefined }}>
          <canvas ref={frontRef} className="front" style={{ opacity: photoAlpha, filter: blurPx ? `blur(${blurPx}px)` : undefined }} />
          <canvas ref={backRef} className="back" />
          {state.attention && mode === 'composicion' && <canvas ref={heatRef} className="heat" />}
          {compare && mode === 'pintar' && <canvas ref={mineRef} className="mine" style={{ clipPath: `inset(0 ${(1 - compareSlider) * 100}% 0 0)` }} />}
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
            <defs>
              <clipPath id="cuadro">
                <rect width={W} height={H} />
              </clipPath>
            </defs>
            <PrimLayer prims={prims} zoom={view.k} />
            <rect ref={hoverRef} className="hover" style={{ opacity: 0 }} vectorEffect="non-scaling-stroke" />
            {ruler}
          </svg>
        </div>
      </div>
    </div>
  );
}
