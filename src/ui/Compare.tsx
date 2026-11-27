import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Pt } from '../lib/types';
import { buildCompare } from '../state/engine';
import { Button } from './controls';

import { t } from '../i18n';
/** Marca las cuatro esquinas del lienzo en la foto para enderezarla. */
export function Compare({ blob, onClose }: { blob: Blob; onClose: () => void }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  const [corners, setCorners] = useState<Pt[]>([[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]]);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const move = (e: RPointerEvent<HTMLElement>) => {
    const i = drag.current;
    if (i === null) return;
    const r = box.current!.getBoundingClientRect();
    const p: Pt = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    setCorners((c) => c.map((q, j) => (j === i ? p : q)));
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('compare.alinear_la_foto_de')}>
      <div className="overlay-card">
        <header>
          <h2>{t('compare.marca_las_esquinas_de')}</h2>
          <p className="note">{t('compare.arrastra_los_cuatro_puntos')}</p>
        </header>
        <div ref={box} className="corners" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
          <img src={url} alt="" draggable={false} />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
            <polygon points={corners.map((c) => c.join(',')).join(' ')} />
          </svg>
          {corners.map(([x, y], i) => (
            <button
              key={i}
              type="button"
              className="corner"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
              aria-label={t('compare.esquina', { v1: i + 1 })}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = i;
              }}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <footer className="row">
          <Button
            variant="ink"
            onClick={() => {
              void buildCompare(blob, corners);
              onClose();
            }}
          >{t('compare.comparar')}</Button>
          <Button onClick={onClose}>{t('common.cancelar')}</Button>
        </footer>
      </div>
    </div>
  );
}
