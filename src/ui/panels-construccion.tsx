import { useEffect, useMemo, useState } from 'react';
import type { FigureModel } from '../lib/figure';
import type { Mannequin } from '../lib/mannequin';
import type { Rect } from '../lib/types';
import { describeLight } from '../lib/body';
import { PlieguesSection } from './panels-pliegues';
import { QuickPose } from './QuickPose';
import { FRAMING_NAME } from '../lib/framing';
import { KIND_NAME, pickedRank, shapeForm, shapeOf, shapePercent, type ShapeFit, type ShapeKind, type ShapePick } from '../lib/shapes';
import { describeTurn } from '../lib/volumes';
import { setConstruction } from '../state/engine';
import { set, useStore } from '../state/store';
import { Button, Section, Segmented, Slider, Toggle } from './controls';
import { BodyView } from './BodyView';
import { downloadSteps } from './exporter';
import { chosenMethod, figureModels, mainFigures, figuresPending, isScene } from './overlays';
import { principalLight, trunkLanguage } from './organic-draw';
import { DRAW_STYLES, STYLE_EXAGGERATION, type DrawStyle } from '../lib/organic';

import { t as tx, tr } from '../i18n';
const STEPS = [
  { n: 1, get name() { return tx('construccion.gesto'); }, get text() { return tx('construccion.la_linea_de_accion'); } },
  { n: 2, get name() { return tx('construccion.esqueleto'); }, get text() { return tx('construccion.los_huesos_sus_largos'); } },
  { n: 3, get name() { return tx('common.masas'); }, get text() { return tx('construccion.cabeza_caja_toracica_pelvis'); } },
  { n: 4, get name() { return tx('construccion.volumenes_solapes'); }, get text() { return tx('construccion.cada_parte_con_su'); } },
  { n: 5, get name() { return tx('common.formas'); }, get text() { return tx('construccion.del_cilindro_al_musculo'); } },
  { n: 6, get name() { return tx('common.planos'); }, get text() { return tx('construccion.las_curvas_se_tallan'); } },
  { n: 7, get name() { return tx('construccion.encaje_en_rectas'); }, get text() { return tx('construccion.sobre_las_formas_la'); } },
  { n: 8, get name() { return tx('construccion.contorno_lineas'); }, get text() { return tx('construccion.las_rectas_se_vuelven'); } },
  { n: 9, get name() { return tx('construccion.dos_valores'); }, get text() { return tx('construccion.toda_la_figura_en'); } },
  { n: 10, get name() { return tx('construccion.dibujo_final'); }, get text() { return tx('construccion.medios_tonos_linea_final'); } },
] as const;

/** Los mismos diez pasos cuando lo que se construye es un lugar. */
const SCENE_STEPS: Record<number, { name: string; text: string }> = {
  1: { get name() { return tx('construccion.direccion'); }, get text() { return tx('construccion.las_rectas_que_mandan'); } },
  2: { get name() { return tx('construccion.estructura'); }, get text() { return tx('construccion.fugas_horizonte_el_esqueleto'); } },
  3: { get name() { return tx('construccion.grandes_masas'); }, get text() { return tx('construccion.cada_zona_como_una'); } },
  4: { get name() { return tx('construccion.masas_en_valor'); }, get text() { return tx('construccion.pocas_rectas_un_solo'); } },
  5: { get name() { return tx('common.formas'); }, get text() { return tx('construccion.las_zonas_toman_su'); } },
  6: { get name() { return tx('construccion.bloques_de_color'); }, get text() { return tx('construccion.el_primer_manchado_cada'); } },
  7: { get name() { return tx('construccion.encaje_en_rectas'); }, get text() { return tx('construccion.sobre_las_masas_lo'); } },
  8: { get name() { return tx('construccion.contorno_lineas'); }, get text() { return tx('construccion.las_rectas_se_vuelven'); } },
  9: { get name() { return tx('common.manchas_de_color'); }, get text() { return tx('construccion.pocos_colores_sin_detalle'); } },
  10: { get name() { return tx('construccion.dibujo_final'); }, get text() { return tx('construccion.mas_colores_la_linea'); } },
};

const SHAPE = { get recta() { return tx('construccion.recta'); }, get C() { return tx('construccion.en_c'); }, get S() { return tx('construccion.en_s'); } } as const;
const SHAPE_NOTE = {
  get recta() { return tx('construccion.firme_estable_con_poca'); },
  get C() { return tx('construccion.una_curva_continua_da'); },
  get S() { return tx('construccion.dos_curvas_opuestas_da'); },
} as const;

const PRIMITIVE_WORD = { get esfera() { return tx('construccion.una_esfera'); }, get cilindro() { return tx('construccion.un_cilindro'); }, get caja() { return tx('construccion.una_caja'); }, get cono() { return tx('construccion.un_cono'); } } as const;

/** El lado sale de qué hombro está más cerca: antes de saberlo solo se dice cuánto gira. */
function chestWord(deg: number, sideKnown: boolean): string {
  const a = Math.abs(deg);
  const side = deg > 0 ? tx('common.derecha') : tx('common.izquierda');
  if (a < 18) return tx('common.de_frente');
  if (a > 62) return sideKnown ? tx('construccion.de_perfil_hacia_la', { side }) : tx('construccion.de_perfil');
  return sideKnown ? tx('construccion.girado_la', { a, side }) : tx('construccion.girado', { a });
}

function leanText(lean: number): string {
  const a = Math.abs(Math.round(lean));
  if (a > 62) return tx('construccion.casi_horizontal_el_maximo');
  if (a < 7) return tx('construccion.casi_vertical');
  return tx('construccion.se_inclina_la', { a, v2: lean > 0 ? tx('common.derecha') : tx('common.izquierda') });
}

function Reading({ model }: { model: FigureModel }) {
  const t = model.tilt;
  // Mientras el análisis sigue, un esqueleto más fino puede cambiar el resultado.
  const sideKnown = useStore((s) => !!s.depth && !s.visionStep);
  return (
    <div className="gesture">
      <p className="verdict">
        {SHAPE[model.gesture.shape]}
        <small>{model.label}{' '}{tx('construccion.leida_de')}{' '}{model.framing === 'mano' || model.framing === 'pie' ? tx('construccion.sus_puntos') : (model.source === 'esqueleto' ? tx('construccion.su_esqueleto') : tx('construccion.su_forma'))}</small>
      </p>
      {model.primitive ? (
        <p className="reading">{tx('construccion.se_resume_en')}{' '}{PRIMITIVE_WORD[model.primitive.kind]}{tx('construccion.empieza_por_ese_solido')}</p>
      ) : (
        <p className="reading">
          {SHAPE_NOTE[model.gesture.shape]} {leanText(model.gesture.lean)}
        </p>
      )}
      <p className="here"><span>{tx('common.encuadre')}</span> {FRAMING_NAME[model.framing].toLowerCase()}</p>
      {model.turn && <p className="here"><span>{tx('common.cabeza')}</span> {describeTurn(model.turn).toLowerCase()}</p>}
      {model.chest !== null && <p className="here"><span>{tx('construccion.pecho')}</span> {chestWord(model.chest, sideKnown)}</p>}
      {model.mannequin?.nearest && <p className="here"><span>{tx('construccion.lo_mas_cercano')}</span> {model.mannequin.nearest.toLowerCase()}</p>}
      {model.mannequin?.light && model.mannequin.light.fit > 0.08 && <p className="here"><span>{tx('common.luz')}</span> {describeLight(model.mannequin.light)}</p>}
      {(model.canon || t || model.measures.length > 0) && (
        <div className="facts">
          {model.canon && (
            <p>
              <span>{tx('construccion.canon')}</span>
              <b>{model.canon.foreshortened ? tx('construccion.visibles', { count: model.canon.count }) : tx('construccion.cabezas', { count: model.canon.count, v2: model.canon.name.toLowerCase() })}</b>
            </p>
          )}
          {t && (
            <p>
              <span>{tx('construccion.hombros_cadera')}</span>
              <b>
                {Math.abs(t.shoulders) >= 60 ? tx('construccion.de_perfil') : `${Math.round(t.shoulders)}°`} / {Math.abs(t.hips) >= 60 ? tx('construccion.de_perfil') : `${Math.round(t.hips)}°`}
              </b>
            </p>
          )}
          {model.framing !== 'animal' && model.measures.map((m) => (
            <p key={m.name}>
              <span>{tr(m.name)}</span>
              <b>{tx('construccion.n_cabezas', { n: m.heads })}</b>
            </p>
          ))}
          {model.canon?.foreshortened && <p className="note">{tx('construccion.la_pose_acorta_los')}</p>}
          {t?.contrapposto && <p className="note">{tx('construccion.hombros_cadera_se_oponen')}</p>}
          {model.style && <p className="note">{model.style}</p>}
        </div>
      )}
    </div>
  );
}

/** Pieza por pieza, en el orden en que se traza. */
function PieceOrder({ model }: { model: Mannequin }) {
  const piece = useStore((s) => s.pieceStep);
  const { order } = model;
  const index = piece === null ? -1 : order.findIndex((o) => o.step === piece);
  const go = (i: number) => set({ pieceStep: i >= order.length ? null : order[Math.max(0, i)].step });
  const current = index >= 0 ? order[index] : null;
  return (
    <Section title={tx('construccion.que_va_primero')} aside={<span className="counter">{piece === null ? tx('common.todas') : tx('common.n_de_m', { n: index + 1, m: order.length })}</span>}>
      <ol className="pieces">
        {order.map((o, i) => (
          <li key={o.step}>
            <button type="button" aria-pressed={o.step === piece} data-done={index >= 0 && i < index} onClick={() => set({ pieceStep: o.step === piece ? null : o.step })}>
              <b>{i + 1}</b>
              {o.name}
            </button>
          </li>
        ))}
      </ol>
      {current && <p className="note">{current.note}</p>}
      <div className="row">
        <Button onClick={() => go(index - 1)} disabled={index <= 0}>{tx('common.anterior')}</Button>
        <Button variant="ink" onClick={() => go(index + 1)}>
          {index < 0 ? tx('common.empezar') : index === order.length - 1 ? tx('construccion.ver_todas') : tx('common.siguiente')}
        </Button>
      </div>
    </Section>
  );
}

function grow(b: Rect, k: number): Rect {
  return { x: b.x - (b.w * (k - 1)) / 2, y: b.y - (b.h * (k - 1)) / 2, w: b.w * k, h: b.h * k };
}

/** Acerca la vista a la parte difícil; soltarla deja todo como estaba. */
function CloseUps({ model, aspect }: { model: Mannequin; aspect: number }) {
  const close = useStore((s) => s.closeUp);
  useEffect(() => () => set({ closeUp: null }), []);
  const parts: { id: string; name: string; box: Rect }[] = [];
  if (model.head) {
    const { c, r, chin } = model.head;
    const rx = (r * 1.25) / aspect;
    const top = c[1] - r * 1.25;
    parts.push({ id: 'cabeza', name: tx('common.cabeza'), box: { x: c[0] - rx, y: top, w: rx * 2, h: Math.max(chin[1] + r * 0.3, c[1] + r * 1.25) - top } });
  }
  for (const h of model.hands) parts.push({ id: h.id, name: tx('common.mano_2', { v1: h.side === 'izquierda' ? tx('common.izq') : tx('common.der') }), box: grow(h.box, 1.5) });
  if (!parts.length) return null;
  const on = (box: Rect) => close?.x === box.x && close?.y === box.y;
  return (
    <Section title={tx('construccion.de_cerca')}>
      <div className="chips">
        {parts.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={on(p.box)} onClick={() => set({ closeUp: on(p.box) ? null : p.box })}>
            {p.name}
          </button>
        ))}
      </div>
      {model.hands.some((h) => h.estimated) && <p className="note">{tx('construccion.hay_una_mano_oculta')}</p>}
    </Section>
  );
}

const FACE_SOURCE = {
  get malla() { return tx('construccion.rasgos_leidos_de_478'); },
  get dibujo() { return tx('construccion.ojos_hallados_en_el'); },
  get pose() { return tx('construccion.rasgos_leidos_de_la'); },
} as const;

/** La cabeza por pasos: cada método la arma distinto, y elegir un paso acerca la vista. */
function FaceSteps({ figure, aspect }: { figure: FigureModel; aspect: number }) {
  const stage = useStore((s) => s.faceStage);
  const choice = useStore((s) => s.headMethod);
  const head = figure.mannequin?.head;
  const method = chosenMethod(figure, { headMethod: choice });
  if (!head || !method) return null;
  const { c, r, chin } = head;
  const rx = (r * 1.3) / aspect;
  const top = c[1] - r * 1.3;
  const box = { x: c[0] - rx, y: top, w: rx * 2, h: Math.max(chin[1] + r * 0.35, c[1] + r * 1.3) - top };
  const chosen = stage !== null ? method.stages[stage - 1] : null;
  return (
    <Section title={tx('construccion.la_cabeza')} aside={<span className="counter">{stage !== null ? tx('common.n_de_m', { n: stage, m: method.stages.length }) : tx('common.todas')}</span>}>
      <div className="chips">
        {head.methods.map((m) => (
          <button key={m.id} type="button" className="chip" aria-pressed={m.id === method.id} onClick={() => set({ headMethod: m.id, faceStage: 1, closeUp: box, detail: null })}>
            {m.name}
          </button>
        ))}
      </div>
      <p className="note">{method.about}</p>
      <ol className="pieces">
        {method.stages.map((f, i) => (
          <li key={f.name}>
            <button type="button" aria-pressed={i + 1 === stage} data-done={stage !== null && i + 1 < stage} onClick={() => set(i + 1 === stage ? { faceStage: null, closeUp: null } : { faceStage: i + 1, closeUp: box, detail: null })}>
              <b>{i + 1}</b>
              {f.name}
            </button>
          </li>
        ))}
      </ol>
      {chosen && <p className="note">{chosen.text}</p>}
      <p className="note">{head.source ? FACE_SOURCE[head.source] : tx('construccion.la_cara_esta_cubierta')}</p>
    </Section>
  );
}

/** Ojos, nariz y boca de cerca: cada uno con su propia construcción. */
function FeatureSteps({ model }: { model: Mannequin }) {
  const detail = useStore((s) => s.detail);
  const details = model.head?.details ?? [];
  if (!details.length) return null;
  const chosen = details.find((d) => d.id === detail?.id) ?? null;
  const stage = chosen?.stages[(detail?.stage ?? 1) - 1];
  const go = (n: number) => chosen && set({ detail: { id: chosen.id, stage: n } });
  return (
    <Section title={tx('construccion.ojos_nariz_boca')} aside={chosen && <span className="counter">{tx('common.n_de_m', { n: detail?.stage ?? 0, m: chosen.stages.length })}</span>}>
      <div className="chips">
        {details.map((d) => (
          <button key={d.id} type="button" className="chip" aria-pressed={d.id === detail?.id} onClick={() => set(d.id === detail?.id ? { detail: null, closeUp: null, encajePhoto: 0.4 } : { detail: { id: d.id, stage: 1 }, closeUp: d.box, faceStage: null, encajePhoto: 0.75 })}>
            {d.name}
          </button>
        ))}
      </div>
      {chosen && stage && (
        <>
          <ol className="pieces">
            {chosen.stages.map((s, i) => (
              <li key={s.name}>
                <button type="button" aria-pressed={i + 1 === detail?.stage} data-done={i + 1 < (detail?.stage ?? 1)} onClick={() => go(i + 1)}>
                  <b>{i + 1}</b>
                  {s.name}
                </button>
              </li>
            ))}
          </ol>
          <p className="note">{stage.text}</p>
          <div className="row">
            <Button onClick={() => go((detail?.stage ?? 1) - 1)} disabled={(detail?.stage ?? 1) <= 1}>{tx('common.anterior')}</Button>
            <Button variant="ink" onClick={() => go((detail?.stage ?? 1) + 1)} disabled={(detail?.stage ?? 1) >= chosen.stages.length}>{tx('common.siguiente')}</Button>
          </div>
        </>
      )}
    </Section>
  );
}

/** Con varias figuras, se elige cuál construir: todas a la vez no se leen. */
function FigurePick({ list }: { list: FigureModel[] }) {
  const pick = useStore((s) => s.figurePick);
  if (list.length < 2) return null;
  return (
    <Section title={tx('construccion.que_figura')}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={!pick} onClick={() => set({ figurePick: null })}>{tx('construccion.principales')}</button>
        {list.map((m) => (
          <button key={m.id} type="button" className="chip" aria-pressed={pick === m.id} onClick={() => set({ figurePick: m.id, detail: null, closeUp: null })}>
            {m.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Una figura en miniatura, con la proporción real de esa parte. */
function ShapeThumb({ fit, id, pick }: { fit: ShapeFit; id: string; pick?: ShapePick }) {
  const form = shapeForm(fit, { ...pick, id });
  const xs = form.outline.map((p) => p[0] * fit.aspect);
  const ys = form.outline.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
  const ox = (1 - (Math.max(...xs) - x0) / span) / 2;
  const oy = (1 - (Math.max(...ys) - y0) / span) / 2;
  const d = form.outline.map((p, i) => `${i ? 'L' : 'M'}${(((p[0] * fit.aspect - x0) / span + ox) * 30 + 3).toFixed(1)} ${(((p[1] - y0) / span + oy) * 30 + 3).toFixed(1)}`).join('') + 'Z';
  return (
    <svg viewBox="0 0 36 36" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const SHAPE_ORDER: ShapeKind[] = ['torax', 'abdomen', 'pelvis', 'cuello', 'brazo', 'antebrazo', 'mano', 'muslo', 'pierna', 'pie'];

/**
 * Cada parte trae la figura que mejor calza, y debajo todas las demás en orden de parecido. Lo
 * chico se decide aquí mismo, sin ventanas: lo que se toca cambia en el dibujo al momento.
 */
function ShapePicker({ model }: { model: FigureModel }) {
  const part = useStore((s) => s.shapePart);
  const all = useStore((s) => s.shapePicks);
  const flow = useStore((s) => s.flowLines);
  const fits = model.shapes ?? [];
  const kinds = SHAPE_ORDER.filter((k) => fits.some((f) => f.kind === k));
  const [side, setSide] = useState<'ambos' | 'L' | 'R'>('ambos');
  if (!kinds.length) return null;
  const kind = (part && kinds.includes(part as ShapeKind) ? part : null) as ShapeKind | null;
  const group = kind ? fits.filter((f) => f.kind === kind) : [];
  const paired = group.length > 1;
  // Izquierda y derecha son las de la imagen, no las del personaje.
  const ordered = [...group].sort((a, b) => a.origin[0] - b.origin[0]);
  const chosen = paired && side !== 'ambos' ? [ordered[side === 'L' ? 0 : 1]] : group;
  const lead = chosen[0];
  const picks = all[model.id] ?? {};
  const pick: ShapePick | undefined = lead && picks[lead.key];
  const change = (patch: Partial<ShapePick> | null) => {
    const next = { ...picks };
    for (const f of chosen) {
      if (patch === null) delete next[f.key];
      else next[f.key] = { ...next[f.key], ...patch };
    }
    set({ shapePicks: { ...all, [model.id]: next } });
  };
  const rank = lead ? pickedRank(lead, pick) : null;
  const def = lead && rank ? shapeOf(lead.kind, rank.id) : null;
  const taper = Math.round((pick?.taper ?? 0) * 100);
  return (
    <Section title={tx('common.figuras')} aside={lead && <span className="counter">{lead.ranking.length}{' '}{tx('construccion.para_elegir')}</span>}>
      <div className="chips">
        {kinds.map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={k === kind} onClick={() => set({ shapePart: k === kind ? null : k })}>
            {KIND_NAME[k]}
          </button>
        ))}
      </div>
      {!kind && <p className="note">{tx('construccion.cada_parte_ya_tiene')}</p>}
      {lead && rank && def && (
        <>
          {paired && (
            <Segmented
              label={tx('construccion.que_lado')}
              value={side}
              options={[
                { value: 'ambos', label: tx('construccion.los_dos') },
                { value: 'L', label: tx('common.izquierda') },
                { value: 'R', label: tx('common.derecha') },
              ]}
              onChange={setSide}
            />
          )}
          <p className="note">
            <b className="shape-name">{def.name}</b>{tx('construccion.calza')}{' '}{shapePercent(rank)}%{pick?.id ? '' : tx('construccion.la_mejor')}
          </p>
          <div className="shape-grid" role="group" aria-label={tx('construccion.figuras_para', { v1: KIND_NAME[lead.kind].toLowerCase() })}>
            {lead.ranking.map((r, i) => {
              const name = shapeOf(lead.kind, r.id)!.name;
              return (
                <button key={r.id} type="button" className="shape-cell" aria-pressed={r.id === rank.id} aria-label={tx('construccion.calza_2', { name, v2: shapePercent(r) })} title={`${name}, ${shapePercent(r)}%`} data-best={i === 0} onClick={() => change({ id: r.id })}>
                  <ShapeThumb fit={lead} id={r.id} pick={pick} />
                </button>
              );
            })}
          </div>
          <Slider label={tx('construccion.grosor')} value={Math.round((pick?.thick ?? 1) * 100)} min={50} max={170} step={5} format={(v) => `${v}%`} onChange={(v) => change({ thick: v / 100 })} />
          <Slider label={tx('construccion.donde_es_mas_ancha')} value={taper} min={-60} max={60} step={5} format={(v) => (v === 0 ? tx('words.parejo') : v > 0 ? tx('construccion.al_inicio', { v }) : tx('construccion.al_final', { v1: -v }))} onChange={(v) => change({ taper: v / 100 })} />
          {chosen.some((f) => picks[f.key]) && (
            <div className="row">
              <Button onClick={() => change(null)}>{tx('construccion.volver_la_mejor')}</Button>
            </div>
          )}
        </>
      )}
      <Toggle label={tx('construccion.flujo_del_movimiento')} checked={flow} onChange={(flowLines) => set({ flowLines })} />
    </Section>
  );
}

/** Cuando el modelo se equivoca, el pintor manda: se arrastra como un hueso de Blender. */
function RigControls({ id }: { id: string }) {
  const on = useStore((s) => s.rigHandles);
  const edits = useStore((s) => s.rigEdits);
  const touched = !!edits[id] && Object.keys(edits[id]).length > 0;
  return (
    <Section title={tx('construccion.esqueleto')}>
      <Toggle label={tx('construccion.mover_articulaciones')} checked={on} onChange={(rigHandles) => set({ rigHandles })} />
      {on && <p className="note">{tx('construccion.arrastra_un_punto_amarillo')}</p>}
      {touched && (
        <div className="row">
          <Button onClick={() => set({ rigEdits: { ...edits, [id]: {} } })}>{tx('common.volver_lo_detectado')}</Button>
        </div>
      )}
    </Section>
  );
}


const STYLE_NAME: Record<DrawStyle, string> = { get realista() { return tx('common.realista'); }, get anime() { return tx('common.anime'); }, get cartoon() { return tx('construccion.cartoon'); }, get caricatura() { return tx('construccion.caricatura'); }, get concept() { return tx('construccion.concept'); }, get pintura() { return tx('construccion.pintura'); } };
const STYLE_NOTE: Record<DrawStyle, string> = {
  get realista() { return tx('construccion.formas_medidas_sobre_el'); },
  get anime() { return tx('construccion.miembros_mas_finos_munecas'); },
  get cartoon() { return tx('construccion.tubos_del_mismo_ancho'); },
  get caricatura() { return tx('construccion.cada_ancho_se_aleja'); },
  get concept() { return tx('construccion.siluetas_limpias_sin_lineas'); },
  get pintura() { return tx('construccion.como_el_realista_con'); },
};

/** Estilo del dibujo: cambia grosor de las formas, curvas, contornos y cuánto se exagera. */
function EstiloSection({ model }: { model: FigureModel | null }) {
  const state = useStore();
  const style = state.drawStyle;
  const lang = model && (style === 'cartoon' || style === 'concept') ? trunkLanguage(model) : null;
  const light = useMemo(() => (style === 'pintura' ? principalLight(state) : null), [style, state.frame, state.figures, state.subjects, state.depth, state.lightEdit, state.figuresReady]); // eslint-disable-line
  return (
    <Section title={tx('common.estilo')}>
      <div className="chips">
        {DRAW_STYLES.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={d === style} onClick={() => set({ drawStyle: d, exaggeration: STYLE_EXAGGERATION[d] })}>
            {STYLE_NAME[d]}
          </button>
        ))}
      </div>
      <p className="note">{STYLE_NOTE[style]}</p>
      <Slider label={tx('construccion.exageracion')} value={Math.round(state.exaggeration * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => set({ exaggeration: v / 100 })} />
      <Slider label={tx('construccion.simplificacion')} value={Math.round(state.simplification * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => set({ simplification: v / 100 })} />
      {lang && <p className="note">{tx('construccion.forma_base_del_tronco')}{' '}{lang.text}</p>}
      {style === 'pintura' && !light && <p className="note">{tx('construccion.no_hay_luz_que')}</p>}
    </Section>
  );
}

const BODY_METHODS = [
  { value: 'organico', get label() { return tx('construccion.organico'); } },
  { value: 'cajas', get label() { return tx('construccion.cajas_cilindros'); } },
  { value: 'figuras', get label() { return tx('common.figuras'); } },
  { value: 'maniqui', get label() { return tx('construccion.cilindros'); } },
  { value: 'frijol', get label() { return tx('common.frijol'); } },
] as const;

export function ConstruccionPanel() {
  const state = useStore();
  const { list: every, flat } = useMemo(() => figureModels(state), [state.frame, state.subjects, state.figures, state.canvas, state.depth, state.rigEdits]); // eslint-disable-line
  const list = mainFigures(every, state);
  const step = state.construction;
  const pending = figuresPending(state);
  const scene = !pending && isScene(state);
  const lead3 = list.find((m) => m.mannequin) ?? null;
  const lead = lead3?.mannequin ?? null;
  const body = lead3 ? state.subjects.find((sub) => sub.id === lead3.id)?.body : undefined;
  // Primero lo que se hace (los pasos), luego cómo se ve (estilo, método, foto debajo) y al final
  // lo que se leyó de la figura: el pintor viene a construir, la lectura es consulta.
  const reading = !pending && list.length > 0;
  return (
    <>
      {(pending || scene || (list.length === 0 && !pending) || flat.length > 0) && (
        <Section>
          {pending && <p className="note">{tx('common.un_momento')}{' '}{state.visionStep ?? tx('construccion.midiendo_la_escena')}{tx('construccion.muestro_la_figura_cuando')}</p>}
          {scene && <p className="reading">{tx('construccion.aqui_manda_el_lugar')}</p>}
          {list.length === 0 && !pending && !scene && <p className="reading">{tx('construccion.no_encontre_una_figura')}</p>}
          {flat.length > 0 && <p className="note">{flat.join(', ')}{tx('construccion.forma_compacta_sin_eje')}</p>}
        </Section>
      )}
      <FigurePick list={every} />
      <Section title={tx('construccion.paso_paso')} aside={<span className="counter">{tx('common.n_de_m', { n: step, m: 10 })}</span>}>
        <ol className="stages">
          {STEPS.map((s) => (
            <li key={s.n}>
              <button type="button" aria-pressed={step === s.n} onClick={() => setConstruction(s.n)}>
                <b>{s.n}</b>
                <span>
                  {scene ? SCENE_STEPS[s.n].name : s.name}
                  {/* Solo el paso activo explica qué se hace: la lista entera se lee de un vistazo. */}
                  {step === s.n && <small>{scene ? SCENE_STEPS[s.n].text : s.text}</small>}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="row">
          <Button onClick={() => void downloadSteps()} disabled={!list.length}>{tx('construccion.guardar_los_10_pasos')}</Button>
        </div>
      </Section>
      {!scene && list.length > 0 && step <= 4 && state.bodyMethod === 'organico' && <EstiloSection model={list.find((m) => m.mannequin?.rig) ?? null} />}
      {lead && (step === 3 || step === 4) && (
        <Section title={tx('construccion.metodo_del_cuerpo')}>
          {/* Cinco nombres no caben en una barra de 260 px: como fichas, cada uno con su ancho. */}
          <div className="chips" role="group" aria-label={tx('construccion.metodo_del_cuerpo')}>
            {BODY_METHODS.map((o) => (
              <button key={o.value} type="button" className="chip" aria-pressed={state.bodyMethod === o.value} onClick={() => set({ bodyMethod: o.value })}>
                {o.label}
              </button>
            ))}
          </div>
          {state.bodyMethod !== 'organico' && <p className="note">{tx('construccion.los_metodos_de_piezas')}</p>}
        </Section>
      )}
      {lead3 && (step === 3 || step === 4) && state.bodyMethod === 'figuras' && <ShapePicker model={lead3} />}
      {!scene && list.length > 0 && step === 7 && (
        <Section title={tx('common.encaje')}>
          <p className="note">{tx('construccion.la_envolvente_roja_son')}</p>
        </Section>
      )}
      {!scene && list.length > 0 && step === 9 && (
        <Section title={tx('construccion.dos_valores')}>
          <p className="note">{tx('construccion.solo_la_figura_el')}</p>
        </Section>
      )}
      {step === 10 && (
        <Section title={tx('construccion.fondo')}>
          {scene || list.length === 0 ? (
            <p className="note">{tx('construccion.se_pinta_todo_el')}</p>
          ) : (
            <>
              <p className="note">{state.keepBackground ? tx('construccion.el_fondo_se_conserva') : tx('construccion.solo_la_figura_el_2')}</p>
              <Toggle label={tx('construccion.conservar_el_fondo')} checked={state.keepBackground} onChange={(keepBackground) => set({ keepBackground })} />
            </>
          )}
        </Section>
      )}
      <Section title={tx('common.debajo')}>
        {step < 9 && <Slider label={tx('common.foto')} value={state.encajePhoto} min={0} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(encajePhoto) => set({ encajePhoto })} />}
        {step >= 4 && step <= 8 && <p className="note">{tx('construccion.subela_para_ver_el')}</p>}
        <Toggle label={tx('construccion.lineas_de_fuerza')} checked={state.forceLines} onChange={(forceLines) => set({ forceLines })} />
      </Section>
      {reading && (
        <Section title={tx('construccion.lo_que_lei_de')}>
          {list.slice(0, 2).map((m) => (
            <Reading key={m.id} model={m} />
          ))}
        </Section>
      )}
      {lead && step >= 3 && step <= 6 && <PieceOrder model={lead} />}
      {lead && step >= 3 && step <= 6 && <FaceSteps figure={lead3!} aspect={state.canvas.w / state.canvas.h} />}
      {lead && step >= 3 && step <= 6 && <FeatureSteps model={lead} />}
      {body && step >= 2 && (
        <Section title={tx('construccion.cuerpo_en_3d')}>
          <BodyView body={body} />
        </Section>
      )}
      {lead?.rig && lead3 && step >= 2 && step <= 5 && <RigControls id={lead3.id} />}
      {lead?.rig && step <= 8 && <PlieguesSection />}
      {list.length > 0 && <QuickPose />}
      {lead && step >= 4 && step <= 6 && <CloseUps model={lead} aspect={state.canvas.w / state.canvas.h} />}
    </>
  );
}

