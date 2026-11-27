import { useMemo } from 'react';
import { FOLD_NAME, FOLD_TEXT, type FoldKind } from '../lib/folds';
import { set, useStore } from '../state/store';
import { Section, Toggle } from './controls';
import { FOLD_STYLE, foldsOf } from './folds-draw';

import { t as tx } from '../i18n';
const ORDER: FoldKind[] = ['tension', 'tubo', 'caida', 'acordeon', 'llave', 'espiral', 'panal', 'inerte'];

/** Pliegues de la ropa: los que la imagen ya tiene, nombrados por lo que los causa. */
export function PlieguesSection() {
  const state = useStore();
  const { folds, frame, figures, subjects, figuresReady, figurePick, rigEdits } = state;
  const reads = useMemo(() => (folds ? foldsOf(state) : []), [folds, frame, figures, subjects, figuresReady, figurePick, rigEdits]); // eslint-disable-line
  const counts = new Map<FoldKind, number>();
  for (const r of reads) for (const [k, n] of Object.entries(r.counts)) counts.set(k as FoldKind, (counts.get(k as FoldKind) ?? 0) + (n ?? 0));
  const points = reads.flatMap((r) => r.tension.filter((t) => t.count >= 2));
  const loose = reads.some((r) => r.loose && r.hems.length > 0);
  const found = ORDER.filter((k) => counts.get(k));
  return (
    <Section title={tx('pliegues.ropa')}>
      <Toggle label={tx('pliegues.pliegues_de_la_ropa')} checked={folds} onChange={(v) => set({ folds: v })} />
      {folds && !reads.length && <p className="note">{tx('pliegues.los_pliegues_se_leen')}</p>}
      {folds && reads.length > 0 && !found.length && <p className="note">{tx('pliegues.no_encontre_pliegues_marcados')}</p>}
      {folds && found.length > 0 && (
        <>
          <p className="reading">
            {points.length > 0
              ? tx('pliegues.la_tela_tira_de', { v1: [...new Set(points.map((p) => p.name))].join(', ') })
              : tx('pliegues.busca_primero_de_donde')}
          </p>
          {loose && <p className="reading">{tx('pliegues.hay_tela_que_cuelga')}</p>}
          <ul className="folds">
            {found.map((k) => (
              <li key={k}>
                <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden>
                  <path d="M2 6H28" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" opacity="0.25" />
                  <path d="M2 6H28" stroke={FOLD_STYLE[k].color} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={FOLD_STYLE[k].dash?.map((n) => n * 0.6).join(' ')} />
                </svg>
                <span>
                  {FOLD_NAME[k]} <small>{counts.get(k)}</small>
                  <em>{FOLD_TEXT[k]}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="note">{tx('pliegues.son_los_pliegues_que')}</p>
        </>
      )}
    </Section>
  );
}
