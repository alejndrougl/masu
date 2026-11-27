import { Fragment, useEffect, useRef, useState } from 'react';
import { buildGrid, cellName, convertUnit, formatNumber } from './lib/canvas';
import { closeImage, openImage, resumeProject, setMode } from './state/engine';
import { deleteProject, listProjects, type ProjectCard } from './state/persist';
import { MODES, get, set, useStore, type Mode } from './state/store';
import { Button } from './ui/controls';
import { downloadSheet, printRealSize, printView, printWorkbook } from './ui/exporter';
import { Focus } from './ui/Focus';
import { Mark } from './ui/marks';
import { CuadrosPanel, EncajePanel, FigurasPanel, LienzoPanel, SimplificarPanel, SujetosPanel, ValoresPanel } from './ui/panels';
import { ColorPanel } from './ui/panels-color';
import { ComposicionPanel } from './ui/panels-composicion';
import { ConstruccionPanel } from './ui/panels-construccion';
import { LecturaPanel } from './ui/panels-lectura';
import { PerspectivaPanel } from './ui/panels-perspectiva';
import { LuzPanel } from './ui/panels-luz';
import { PintarPanel } from './ui/panels-pintar';
import { Stage } from './ui/Stage';

import { LOCALES, t as tx } from './i18n';
const PANELS: Record<Mode, () => React.JSX.Element | null> = {
  lectura: LecturaPanel,
  lienzo: LienzoPanel,
  cuadros: CuadrosPanel,
  valores: ValoresPanel,
  color: ColorPanel,
  sujetos: SujetosPanel,
  composicion: ComposicionPanel,
  perspectiva: PerspectivaPanel,
  luz: LuzPanel,
  construccion: ConstruccionPanel,
  figuras: FigurasPanel,
  encaje: EncajePanel,
  simplificar: SimplificarPanel,
  pintar: PintarPanel,
};

const keys = (): [string, string][] => [
  ['1 … 0, -, =, P, L', tx('app.cambiar_de_modo')],
  ['G', tx('app.mostrar_ocultar_la_cuadricula')],
  [tx('app.mantener'), tx('app.ver_la_foto_original')],
  ['M', tx('app.espejo_detecta_errores_de')],
  ['I', tx('app.de_cabeza_ves_formas')],
  ['R', tx('app.regla_mide_en_cm')],
  ['F', tx('app.pantalla_para_pintar_el')],
  ['← ↑ → ↓', tx('app.pasar_de_cuadro')],
  [tx('app.espacio'), tx('app.marcar_el_cuadro_como')],
  [tx('app.esc'), tx('common.cerrar')],
  ['?', tx('app.esta_ayuda')],
];

function ThemeToggle({ className }: { className: string }) {
  const theme = useStore((s) => s.theme);
  const dark = theme === 'tinta';
  return (
    <button type="button" className={className} aria-pressed={dark} title={dark ? tx('app.cambiar_fondo_claro') : tx('app.cambiar_fondo_negro')} onClick={() => set({ theme: dark ? 'papel' : 'tinta' })}>
      <Mark name="tema" />
      <span>{dark ? tx('app.claro') : tx('app.negro')}</span>
    </button>
  );
}

/** Cambia de idioma. Muestra el idioma al que se pasa (EN estando en español, ES estando en inglés). */
function LangToggle({ className }: { className: string }) {
  const locale = useStore((s) => s.locale);
  // Pasa al siguiente idioma de la lista (con dos, alterna).
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];
  return (
    <button type="button" className={className} lang={next} title="Language / Idioma" aria-label={tx('app.cambiar_idioma', { lang: next.toUpperCase() })} onClick={() => set({ locale: next })}>
      <span>{next.toUpperCase()}</span>
    </button>
  );
}

function Rail() {
  const mode = useStore((s) => s.mode);
  const index = MODES.findIndex((m) => m.id === mode);
  return (
    <nav className="rail" aria-label={tx('app.herramientas')}>
      <button type="button" className="home" title={tx('app.volver_al_inicio')} onClick={closeImage}>
        <span className="seal" aria-hidden>
          升
        </span>
        <span>{tx('app.inicio')}</span>
      </button>
      <ul style={{ ['--i' as string]: index, ['--n' as string]: MODES.length }}>
        {MODES.map((m) => (
          <li key={m.id}>
            <button type="button" aria-current={m.id === mode} onClick={() => setMode(m.id)} title={tx('app.tecla', { name: m.name, key: m.key })}>
              <Mark name={m.id} />
              <span>{m.name}</span>
            </button>
          </li>
        ))}
        <span className="rail-mark" aria-hidden />
      </ul>
      <ThemeToggle className="theme" />
      <LangToggle className="theme lang" />
    </nav>
  );
}

function ToolButton({ label, on, title, onClick }: { label: string; on?: boolean; title: string; onClick: () => void }) {
  return (
    <button type="button" className="tool" aria-pressed={on} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

function Status() {
  const canvas = useStore((s) => s.canvas);
  const grid = useStore((s) => s.grid);
  const step = useStore((s) => s.visionStep);
  const focus = useStore((s) => s.focus);
  const mirror = useStore((s) => s.mirror);
  const upside = useStore((s) => s.upside);
  const tool = useStore((s) => s.tool);
  const g = buildGrid(canvas, grid);
  const u = canvas.unit === 'cm' ? 'cm' : 'in';
  const shown = (v: number) => formatNumber(convertUnit(v, 'cm', canvas.unit));
  return (
    <footer className="status">
      <span>
        {shown(canvas.w)} × {shown(canvas.h)} {u}
      </span>
      <span>
        {g.cols} × {g.rows} · {shown(grid.cell)} {u}
      </span>
      {focus && <span className="status-cell">{cellName(focus.col, focus.row)}</span>}
      <span id="readout" className="readout" />
      {step && (
        <span className="status-step" role="status">
          <i aria-hidden />
          {step}
        </span>
      )}
      <span className="tools">
        <ToolButton label={tx('app.espejo')} on={mirror} title={tx('app.espejo_tecla')} onClick={() => set({ mirror: !mirror })} />
        <ToolButton label={tx('app.de_cabeza')} on={upside} title={tx('app.de_cabeza_tecla')} onClick={() => set({ upside: !upside })} />
        <ToolButton label={tx('app.medir')} on={tool === 'medir'} title={tx('app.regla_tecla')} onClick={() => set({ tool: tool === 'medir' ? 'ninguna' : 'medir' })} />
        <ToolButton label="?" title={tx('app.ayuda')} onClick={() => set({ help: true })} />
      </span>
    </footer>
  );
}

function PrintMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const run = (fn: () => Promise<void>) => {
    setOpen(false);
    void fn();
  };
  return (
    <div className="menu" ref={ref}>
      <Button variant="quiet" onClick={() => setOpen(!open)}>{tx('app.imprimir')}</Button>
      {open && (
        <div className="menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => run(printView)}>{tx('app.esta_vista')}</button>
          <button type="button" role="menuitem" onClick={() => run(() => printRealSize('carta'))}>{tx('app.tamano_real_en_hojas')}</button>
          <button type="button" role="menuitem" onClick={() => run(() => printRealSize('a4'))}>{tx('app.tamano_real_en_hojas_2')}</button>
          <button type="button" role="menuitem" onClick={() => run(printWorkbook)}>{tx('app.cuaderno_de_trabajo')}</button>
        </div>
      )}
    </div>
  );
}

function Panel() {
  const mode = useStore((s) => s.mode);
  const current = MODES.find((m) => m.id === mode)!;
  const Body = PANELS[mode];
  return (
    <aside className="panel">
      <header className="panel-head">
        <h2>{current.name}</h2>
      </header>
      <div className="panel-body" key={mode}>
        <Body />
      </div>
      <footer className="panel-foot">
        <Button variant="quiet" onClick={() => void downloadSheet()}>{tx('app.guardar_png')}</Button>
        <PrintMenu />
        <Button variant="quiet" onClick={() => document.getElementById('picker')?.click()}>{tx('app.otra_imagen')}</Button>
      </footer>
    </aside>
  );
}

function Empty({ onPick }: { onPick: () => void }) {
  const [saved, setSaved] = useState<ProjectCard[]>([]);
  useEffect(() => {
    void listProjects().then(setSaved);
  }, []);
  return (
    <main className="empty">
      <div className="empty-sheet" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <i key={`v${i}`} className="v" style={{ left: `${(i + 1) * (100 / 6)}%`, animationDelay: `${i * 45}ms` }} />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <i key={`h${i}`} className="h" style={{ top: `${(i + 1) * 12.5}%`, animationDelay: `${180 + i * 45}ms` }} />
        ))}
        <span className="empty-kanji">升</span>
      </div>
      <div className="empty-copy">
        <h1>{tx('app.masu')}</h1>
        <p>{tx('app.suelta_una_imagen_pintala')}</p>
        <div className="row">
          <Button variant="ink" onClick={onPick}>{tx('app.elegir_imagen')}</Button>
          <ThemeToggle className="btn btn-line with-mark" />
          <LangToggle className="btn btn-line" />
        </div>
        <p className="note">{tx('app.todo_se_analiza_en')}</p>
        {saved.length > 0 && (
          <div className="recents">
            <h3>{tx('common.seguir_con')}</h3>
            <ul>
              {saved.map((p) => (
                <li key={p.id}>
                  <button type="button" className="recent" title={p.name} onClick={() => void resumeProject(p.id)}>
                    <img src={p.thumb} alt="" />
                    <span>{p.name}</span>
                    <small>{p.done.length ? tx('app.cuadros', { length: p.done.length }) : `${p.canvas.w} × ${p.canvas.h}`}</small>
                  </button>
                  <button
                    type="button"
                    className="x"
                    aria-label={tx('app.quitar', { name: p.name })}
                    onClick={() => {
                      void deleteProject(p.id);
                      setSaved((list) => list.filter((q) => q.id !== p.id));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function Help() {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={tx('app.atajos_de_teclado')} onClick={() => set({ help: false })}>
      <div className="overlay-card help" onClick={(e) => e.stopPropagation()}>
        <h2>{tx('app.atajos')}</h2>
        <dl>
          {keys().map(([k, d]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <Button onClick={() => set({ help: false })}>{tx('common.cerrar')}</Button>
      </div>
    </div>
  );
}

function moveFocus(dc: number, dr: number) {
  const s = get();
  const g = buildGrid(s.canvas, s.grid);
  const f = s.focus ?? { col: 0, row: 0 };
  set({ focus: { col: Math.min(g.cols - 1, Math.max(0, f.col + dc)), row: Math.min(g.rows - 1, Math.max(0, f.row + dr)) } });
}

export default function App() {
  const hasImage = useStore((s) => !!s.image);
  const theme = useStore((s) => s.theme);
  const locale = useStore((s) => s.locale);
  const focusMode = useStore((s) => s.focusMode);
  const help = useStore((s) => s.help);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // La barra del navegador toma el color del fondo, también en el tema oscuro.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'tinta' ? '#0a0a0a' : '#f2eee5');
    try {
      localStorage.setItem('masu-tema', theme);
    } catch {
      // Sin almacenamiento solo se olvida el tema al recargar.
    }
  }, [theme]);

  useEffect(() => {
    const open = (file?: File | null) => {
      if (file && file.type.startsWith('image/')) void openImage(file, file.name);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (!get().image || e.metaKey || e.ctrlKey || e.altKey) return;
      document.documentElement.dataset.keyboard = '1';
      const s = get();
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (s.help) set({ help: false });
        else if (s.focusMode) set({ focusMode: false });
        else if (s.tool === 'medir') set({ tool: 'ninguna' });
        else set({ focus: null });
        return;
      }
      if (e.key === '?') {
        set({ help: !s.help });
        return;
      }
      if (s.help) return;
      const cellMode = s.focusMode || s.mode === 'cuadros' || s.mode === 'pintar';
      if (cellMode) {
        const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const move = moves[e.key];
        if (move) {
          e.preventDefault();
          moveFocus(...move);
          return;
        }
        if (e.key === ' ' && s.focus && t.tagName !== 'BUTTON') {
          e.preventDefault();
          const name = cellName(s.focus.col, s.focus.row);
          set({ done: s.done.includes(name) ? s.done.filter((d) => d !== name) : [...s.done, name] });
          return;
        }
      }
      const mode = MODES.find((m) => m.key === key);
      if (mode && !s.focusMode) {
        setMode(mode.id);
        return;
      }
      if (key === 'g') set({ grid: { ...s.grid, visible: !s.grid.visible } });
      if (key === 'm') set({ mirror: !s.mirror });
      if (key === 'i') set({ upside: !s.upside });
      if (key === 'r') set({ tool: s.tool === 'medir' ? 'ninguna' : 'medir' });
      if (key === 'o' && !e.repeat) set({ peek: true });
      if (key === 'f' && s.frame) set({ focusMode: !s.focusMode, focus: s.focus ?? { col: 0, row: 0 } });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'o') set({ peek: false });
    };
    const onPointer = () => delete document.documentElement.dataset.keyboard;
    const onPaste = (e: ClipboardEvent) => open(e.clipboardData?.files[0]);
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      open(e.dataTransfer?.files[0]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="app" data-dragging={dragging}>
      <input
        ref={input}
        id="picker"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openImage(f, f.name);
          e.target.value = '';
        }}
      />
      <Fragment key={locale}>
        {hasImage ? (
          <>
            <Rail />
            <main className="center">
              <Stage />
              <Status />
            </main>
            <Panel />
            {focusMode && <Focus />}
          </>
        ) : (
          <Empty onPick={() => input.current?.click()} />
        )}
        {help && <Help />}
      </Fragment>
      <div id="print-sheets" />
    </div>
  );
}
