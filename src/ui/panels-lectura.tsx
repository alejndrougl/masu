import { useMemo } from 'react';
import { readSchemes } from '../lib/composition';
import { readHarmony, temperatureSummary } from '../lib/harmony';
import { warmthOfValues } from '../lib/extras';
import { lensName } from '../lib/perspective';
import { formatHours } from '../lib/plan';
import { valueReading, zoneShares } from '../lib/tones';
import { setMode } from '../state/engine';
import { useStore, type Mode, type State } from '../state/store';
import { Button, Section } from './controls';
import { balanceOf, compositionOf, figureModels, focalsOf, namedSubjects, perspectiveOf, planOf } from './overlays';
import { lightOf } from './light-draw';
import { lightWords } from '../lib/light';

import { t, tr } from '../i18n';
interface Finding {
  mode: Mode;
  title: string;
  text: string;
}

function who(s: State): string {
  const list = namedSubjects(s);
  if (!list.length) return t('lectura.sin_personajes_ni_objetos');
  const faces = list.filter((x) => x.kind.endsWith('face')).length;
  const heads = list.filter((x) => x.kind === 'head').length;
  const others = list.filter((x) => !x.kind.endsWith('face') && x.kind !== 'head');
  const parts: string[] = [];
  if (faces) parts.push(faces === 1 ? list.find((x) => x.kind.endsWith('face'))!.label : t('common.rostros', { faces }));
  if (heads) parts.push(heads === 1 ? t('lectura.una_cabeza_con_el') : t('lectura.cabezas_con_el_rostro', { heads }));
  const names = [...new Set(others.map((x) => x.label.replace(/ \d+$/, '').toLowerCase()))].slice(0, 3);
  if (names.length) parts.push(names.join(', '));
  const text = parts.join('; ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function buildAdvice(s: State): string[] {
  const out: string[] = [];
  const { frame } = s;
  if (!frame) return out;
  const shares = zoneShares(frame.stats.hist, s.thresholds);
  const schemes = compositionOf(s);
  if (!readSchemes(schemes).clear) {
    out.push(t('lectura.ninguna_composicion_domina_pru'));
  }
  const focals = focalsOf(s);
  const bal = balanceOf(frame);
  if (focals[0]) {
    const f = focals.reduce((a, b) => (b.weight > a.weight ? b : a));
    const gap = Math.hypot(f.x - bal.contrast[0], f.y - bal.contrast[1]);
    if (gap > 0.32) out.push(t('lectura.el_mayor_contraste_esta', { v1: f.label.startsWith('el ') ? t('lectura.del', { v1: f.label.slice(3) }) : t('lectura.de_label', { v1: f.label }) }));
  }
  if (valueReading(frame.stats.hist, s.thresholds).flat) out.push(t('lectura.hay_pocos_extremos_refuerza'));
  const mid = Math.max(...shares);
  if (mid > 0.55) out.push(t('lectura.una_sola_zona_de'));
  // La temperatura de luz y sombra la manda la pestaña Luz; aquí solo se opina si Luz no la midió.
  if (!lightOf(s)?.temperature) {
    const w = warmthOfValues(frame.rgba, frame.L);
    if (w.lightWord === 'cálidas' && w.shadowWord === 'cálidas') out.push(t('lectura.casi_todo_es_calido'));
    if (w.lightWord === 'frías' && w.shadowWord === 'frías') out.push(t('lectura.casi_todo_es_frio'));
  }
  const model = figureModels(s).list[0];
  if (model?.gesture.shape === 'recta' && model.source === 'esqueleto') out.push(t('lectura.la_figura_esta_muy'));
  if (model?.tilt?.contrapposto) out.push(t('lectura.hombros_cadera_se_oponen'));
  if (model?.canon?.foreshortened) out.push(t('lectura.hay_escorzo_mide_cada'));
  if (model?.framing === 'busto' || model?.framing === 'cabeza') out.push(t('lectura.es_un_encuadre_cerrado'));
  if (model?.mannequin?.head && !model.mannequin.head.source) out.push(t('lectura.la_cara_esta_cubierta'));
  if (s.frame?.perspective.curve) out.push(t('lectura.la_imagen_dobla_las'));
  return out.slice(0, 5);
}

export function LecturaPanel() {
  const state = useStore();
  const { frame, visionStep } = state;
  const findings = useMemo<Finding[]>(() => {
    if (!frame) return [];
    const schemes = compositionOf(state);
    const read = readSchemes(schemes);
    const harmony = readHarmony(frame.stats.hue, frame.stats.colored);
    const model = figureModels(state).list[0];
    const plan = planOf(state);
    const list: Finding[] = [
      { mode: 'sujetos', title: t('lectura.que_hay'), text: who(state) },
      {
        mode: 'composicion',
        title: t('common.composicion'),
        text: read.clear ? `${read.headline}${read.leading.length > 1 ? ' (parejos)' : ''}. ${read.leading[0].why}` : t('lectura.ninguna_composicion_clasica_do'),
      },
      { mode: 'valores', title: t('common.valores'), text: valueReading(frame.stats.hist, state.thresholds).text },
      {
        mode: 'color',
        title: t('common.color'),
        text: harmony.kind === 'Casi acromática' ? `${tr(harmony.kind)}. ${harmony.note}` : `${tr(harmony.kind)}. ${temperatureSummary(frame.temperature, harmony)} ${warmthOfValues(frame.rgba, frame.L).text}`,
      },
    ];
    const persp = perspectiveOf(state);
    if (persp.points.length) {
      list.push({
        mode: 'perspectiva',
        title: t('common.perspectiva'),
        text: t('lectura.persp_de', { points: persp.points.length === 1 ? t('lectura.un_punto') : persp.points.length === 2 ? t('lectura.dos_puntos') : t('lectura.tres_puntos'), lens: persp.lens ? t('lectura.unos_mm', { v1: lensName(persp.lens), v2: Math.round(persp.lens) }) : '' }),
      });
    }
    if (model) {
      const shape = model.gesture.shape === 'recta' ? t('lectura.recta') : t('lectura.en_forma', { shape: model.gesture.shape });
      list.push({
        mode: 'construccion',
        title: t('lectura.figura'),
        text: t('lectura.linea_de_accion', { shape, v2: model.canon ? (model.canon.foreshortened ? t('lectura.con_escorzo') : t('lectura.unas_cabezas_de_alto', { count: model.canon.count, v2: model.canon.name.toLowerCase() })) : '' }),
      });
    }
    const light = lightOf(state);
    if (light?.lights.length) {
      const main = light.lights[0];
      const rest = light.lights.length - 1;
      list.push({ mode: 'luz', title: t('common.luz'), text: t('lectura.la_luz', { v1: main.role === 'contraluz' ? 'llega' : t('lectura.principal_viene'), v2: lightWords(main), v3: rest ? t('lectura.hay', { v1: rest === 1 ? t('lectura.otra_luz') : t('lectura.luces_mas', { rest }) }) : '', v4: light.scene ? t('lectura.por_el_cielo_aproximada') : '' }) });
    }
    list.push({ mode: 'composicion', title: t('lectura.equilibrio'), text: `${balanceOf(frame).label}.` });
    if (plan) {
      list.push({ mode: 'pintar', title: t('lectura.esfuerzo'), text: t('lectura.unas_de_pintura_lo', { v1: formatHours(plan.hours), v2: plan.hardest.join(', ') }) });
    }
    return list;
  }, [state.frame, state.subjects, state.figures, state.thresholds, state.canvas, state.grid, state.technique, state.depth, state.figuresReady, state.bodyFaces]); // eslint-disable-line
  const advice = useMemo(() => buildAdvice(state), [state.frame, state.subjects, state.figures, state.thresholds]); // eslint-disable-line
  if (!frame) return null;
  return (
    <>
      {visionStep && <p className="note" style={{ paddingTop: 8 }}>{t('common.un_momento')}{' '}{visionStep}…</p>}
      {advice.length > 0 && (
        <Section title={t('lectura.recomendaciones')}>
          <ul className="advice">
            {advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t('lectura.lo_que_encontre')}>
        <ul className="findings">
          {findings.map((f) => (
            <li key={f.title}>
              <button type="button" onClick={() => setMode(f.mode)}>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section>
        <div className="row">
          <Button variant="ink" onClick={() => setMode('cuadros')}>{t('lectura.ir_la_cuadricula')}</Button>
        </div>
      </Section>
    </>
  );
}
