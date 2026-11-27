import { useEffect, useState } from 'react';
import { setConstruction } from '../state/engine';
import { set, useStore } from '../state/store';
import { Button, Section } from './controls';

import { t } from '../i18n';
const TIMES: [number, string][] = [
  [30, '30 s'],
  [60, '1 min'],
  [120, '2 min'],
  [300, '5 min'],
  [600, '10 min'],
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Pose rápida: se dibuja contra reloj viendo solo la foto, y al terminar Masu enseña su línea
 * de acción para comparar. Con poco tiempo no cabe el detalle: queda postura, forma y gesto.
 */
export function QuickPose() {
  const quick = useStore((s) => s.quick);
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!quick) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((quick.until - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) {
        set({ quick: null, encajePhoto: 0.6 });
        setConstruction(1);
        setDone(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [quick]);
  const start = (seconds: number) => {
    setDone(false);
    set({ quick: { until: Date.now() + seconds * 1000, seconds } });
  };
  return (
    <Section title={t('quickPose.pose_rapida')}>
      {quick ? (
        <>
          <p className="verdict quick-clock" aria-live="off">
            {mmss(left)}
            <small>{quick.seconds <= 60 ? t('quickPose.solo_la_linea_de') : quick.seconds <= 120 ? t('quickPose.gesto_masas_hacia_donde') : t('quickPose.gesto_masas_volumenes_simples')}</small>
          </p>
          <div className="row">
            <Button onClick={() => set({ quick: { ...quick, until: Date.now() } })}>{t('quickPose.terminar_comparar')}</Button>
            <Button onClick={() => set({ quick: null })}>{t('common.cancelar')}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="note">{done ? t('quickPose.tiempo_compara_tu_dibujo') : t('quickPose.dibuja_la_pose_contra')}</p>
          <div className="row">
            {TIMES.map(([s, label]) => (
              <Button key={s} onClick={() => start(s)}>
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
