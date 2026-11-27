import { useEffect, useMemo, useRef } from 'react';
import { lightFrom, lightWords, setupName, type LightRead, type LightSource } from '../lib/light';
import { set, useStore } from '../state/store';
import { Button, Section, Segmented, Slider, Toggle } from './controls';
import { ROLE_NAME, lightOf, shownLights } from './light-draw';
import { figuresPending } from './overlays';

import { t as tx, tr } from '../i18n';
const COUNT = ['Sin dirección clara', 'Una luz', 'Dos luces', 'Tres luces', 'Cuatro luces'];

/** La esfera que dibuja quien estudia la luz: así caerían estas luces sobre una bola. */
function Ball({ lights, ambient }: { lights: LightSource[]; ambient: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = c.width;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const R = size / 2 - 3;
    const front = lights.filter((l) => l.role !== 'contraluz');
    const back = lights.filter((l) => l.role === 'contraluz');
    const base = Math.max(0.1, Math.min(0.3, ambient));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - size / 2 + 0.5) / R;
        const dy = (y - size / 2 + 0.5) / R;
        const r2 = dx * dx + dy * dy;
        const p = (y * size + x) * 4;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        let e = base;
        for (const l of front) e += Math.max(0, dx * l.dir[0] + dy * l.dir[1] + nz * l.dir[2]) * l.strength * (1 - base);
        for (const l of back) {
          const v = dx * l.dir[0] + dy * l.dir[1] + nz * l.dir[2];
          if (v > 0.2 && nz < 0.55) e = Math.max(e, 0.6 + v * 0.4);
        }
        // Pocos valores, como se pinta: se ve dónde corta la sombra.
        const t = Math.round(Math.min(1, e) * 6) / 6;
        const edge = Math.min(1, (1 - Math.sqrt(r2)) * R);
        img.data[p] = 18 + t * 228;
        img.data[p + 1] = 18 + t * 224;
        img.data[p + 2] = 18 + t * 215;
        img.data[p + 3] = 255 * edge;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [lights, ambient]);
  return <canvas ref={ref} className="light-ball" width={132} height={132} aria-label={tx('luz.como_caen_estas_luces')} />;
}

function shareWords(p: number): string {
  if (p < 0.15) return tx('luz.una_parte_chica');
  if (p < 0.35) return tx('luz.cerca_de_un_tercio');
  if (p < 0.6) return tx('luz.cerca_de_la_mitad');
  return tx('luz.mas_de_la_mitad');
}

/** La dureza del borde es una medida aproximada: solo se afirma en los extremos claros. */
function hardnessWords(h: number): string | null {
  if (h < 0.08) return tx('luz.borde_duro_luz_directa');
  if (h > 0.4) return tx('luz.borde_suave_luz_grande');
  return null;
}

function temperatureWords(t: NonNullable<LightRead['temperature']>): string | null {
  const gap = t.light - t.shadow;
  if (Math.abs(gap) < 2.5) return tx('luz.luz_sombra_tienen_casi');
  return gap > 0 ? tx('luz.luz_calida_sombras_mas') : tx('luz.luz_fria_sombras_mas');
}

function sureWords(read: LightRead): string {
  if (read.scene) return tx('luz.lectura_aproximada_de_un');
  if (read.fit > 0.5 && read.lights.length <= 2) return tx('luz.lectura_bastante_firme');
  if (read.fit > 0.2) return tx('luz.lectura_razonable_las_luces');
  return tx('luz.lectura_debil_confirmala_con');
}

export function LuzPanel() {
  const state = useStore();
  const { luz, lightEdit, frame, figures, subjects, depth, figuresReady, figurePick, bodyFaces } = state;
  const read = useMemo(() => lightOf(state), [frame, figures, subjects, depth, figuresReady, figurePick, bodyFaces]); // eslint-disable-line
  const pending = figuresPending(state) || !figuresReady;
  if (!read) {
    return (
      <Section>
        <p className="verdict">{tx('common.luz')}</p>
        <p className="note">{pending ? tx('luz.leyendo_las_figuras_para') : tx('luz.no_hay_imagen_que')}</p>
      </Section>
    );
  }
  const lights = shownLights(state, read);
  const main = lights.find((l) => l.role === 'principal') ?? lights[0];
  const show = (patch: Partial<typeof luz>) => set({ luz: { ...luz, ...patch } });
  const edit = lightEdit ?? (main ? { azimuth: Math.round(main.azimuth), elevation: Math.round(main.elevation) } : { azimuth: 135, elevation: 40 });
  const tips: string[] = [];
  if (!read.flat) {
    tips.push(read.terminator.length ? tx('luz.primero_dos_valores_todo') : tx('luz.primero_dos_valores_junta'));
    if (read.reflected) tips.push(tx('luz.la_sombra_se_aclara'));
    if (read.cast.length || read.ground.length) tips.push(tx('luz.la_sombra_arrojada_azul'));
    if (read.occlusion.length) tips.push(tx('luz.los_acentos_negro_son'));
    if (read.darkShare > 0.08) tips.push(tx('luz.el_pelo_las_correas'));
    if (read.highlights.length) tips.push(tx('luz.el_brillo_anillo_amarillo'));
    if (read.rim.length) tips.push(tx('luz.el_borde_encendido_amarillo'));
  }
  return (
    <>
      <Section>
        <p className="verdict">
          {lightEdit ? tx('luz.luz_de_prueba') : tr(COUNT[Math.min(4, lights.length)])}
          <small>
            {lightEdit
              ? tx('luz.la_moviste_tu_el')
              : read.scene
                ? lights.length
                  ? tx('luz.por_el_lado_mas')
                  : tx('luz.en_un_lugar_sin')
                : read.faceConflict
                  ? tx('luz.el_cuerpo_la_cara')
                  : read.fromFace
                    ? tx('luz.leida_en_la_cara')
                    : read.flat
                      ? tx('luz.color_plano_luz_pareja')
                      : sureWords(read)}
          </small>
        </p>
        {(lights.length > 0 || lightEdit) && (
          <div className="light-head">
            <Ball lights={lights} ambient={read.ambient} />
            <ul className="lights">
              {lights.map((l, i) => (
                <li key={i}>
                  <i className={`sun sun-${l.role}`}>{i + 1}</i>
                  <span>
                    {ROLE_NAME[l.role]}
                    <small>
                      {lightWords(l)}
                      {l.role !== 'principal' && `, ${l.strength > 0.75 ? tx('luz.casi_tan_fuerte_como') : l.strength > 0.4 ? tx('luz.mas_debil_que_la') : tx('luz.mucho_mas_debil_que')}`}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {main && !read.flat && state.subjects.some((q) => q.kind === 'human-face' || q.kind === 'anime-face') && <p className="reading">{setupName(main)}.</p>}
        {read.scene && !lightEdit && <p className="reading">{tx('luz.para_un_lugar_las')}</p>}
        {read.flat && !read.scene && !read.fromFace && !lightEdit && <p className="reading">{tx('luz.aqui_la_forma_no')}</p>}
      </Section>
      {!read.flat && (
        <Section title={tx('common.sombras')}>
          <p className="here">
            <span>{tx('luz.en_sombra')}</span> {shareWords(read.shadowShare)}{' '}{tx('luz.de_la_figura')}</p>
          {read.ratio !== null && (
            <p className="here">
              <span>{tx('luz.contraste')}</span> {read.ratio > 3.5 ? tx('words.fuerte') : read.ratio > 2 ? tx('words.medio') : tx('words.suave')}{tx('luz.la_luz_es')}{' '}{read.ratio > 3.5 ? tx('words.mucho') : read.ratio > 2 ? tx('words.bastante') : tx('words.algo')}{' '}{tx('luz.mas_clara_que_la')}</p>
          )}
          {read.hardness !== null && hardnessWords(read.hardness) && <p className="reading">{hardnessWords(read.hardness)}</p>}
          {read.temperature && <p className="reading">{temperatureWords(read.temperature)}</p>}
          {read.groundDir && (!main || Math.hypot(main.dir[0], main.dir[1]) < 0.3 || -(read.groundDir[0] * main.dir[0] + read.groundDir[1] * main.dir[1]) / Math.hypot(main.dir[0], main.dir[1]) > 0.5) && (
            <p className="reading">{tx('luz.la_sombra_arrojada_cae')}{' '}{read.groundDir[0] > 0.3 ? tx('common.la_derecha') : read.groundDir[0] < -0.3 ? tx('common.la_izquierda') : read.groundDir[1] > 0 ? tx('common.hacia_abajo') : tx('common.hacia_arriba')}{tx('luz.la_luz_viene_del')}</p>
          )}
        </Section>
      )}
      {tips.length > 0 && (
        <Section title={tx('luz.como_pintarla')}>
          <ol className="steps-list">
            {tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </Section>
      )}
      <Section title={tx('common.ver')}>
        <Segmented
          label={tx('luz.sobre_que')}
          value={luz.view}
          options={[
            { value: 'foto', label: tx('common.foto') },
            { value: 'zonas', label: tx('common.zonas') },
            { value: 'yeso', label: tx('luz.yeso') },
          ]}
          onChange={(view) => show({ view })}
        />
        <p className="note">
          {luz.view === 'foto' && tx('luz.la_imagen_con_las')}
          {luz.view === 'zonas' && tx('luz.lo_medido_en_la')}
          {luz.view === 'yeso' && tx('luz.la_figura_como_si')}
        </p>
        <div className="stack">
          <Toggle label={tx('luz.rayos')} checked={luz.rays} onChange={(rays) => show({ rays })} />
          <Toggle label={tx('luz.terminador')} checked={luz.terminator} onChange={(terminator) => show({ terminator })} />
          <Toggle label={tx('luz.sombra_propia')} checked={luz.shadows} onChange={(shadows) => show({ shadows })} />
          <Toggle label={tx('luz.sombra_arrojada')} checked={luz.cast} onChange={(cast) => show({ cast })} />
          <Toggle label={tx('luz.acentos_brillos')} checked={luz.accents} onChange={(accents) => show({ accents })} />
          <Toggle label={tx('common.contraluz')} checked={luz.rim} onChange={(rim) => show({ rim })} />
        </div>
      </Section>
      <Section title={tx('luz.probar_otra_luz')}>
        <Slider label={tx('luz.giro')} value={edit.azimuth} min={0} max={359} step={1} format={(v) => lightWords(lightFrom(v, 20)).replace(/,.*/, '')} onChange={(azimuth) => set({ lightEdit: { ...edit, azimuth } })} />
        <Slider label={tx('luz.de_lado_de_frente')} value={edit.elevation} min={-30} max={85} step={1} format={(v) => (v < -8 ? tx('luz.por_detras') : v < 25 ? tx('luz.de_lado') : v < 60 ? tx('luz.tres_cuartos') : tx('common.de_frente'))} onChange={(elevation) => set({ lightEdit: { ...edit, elevation } })} />
        <p className="note">{lights.length > 0 && luz.rays ? tx('luz.tambien_puedes_arrastrar_el') : ''}{tx('luz.con_yeso_ves_el')}</p>
        {lightEdit && (
          <div className="row">
            <Button onClick={() => set({ lightEdit: null })}>{tx('luz.volver_la_luz_leida')}</Button>
          </div>
        )}
      </Section>
    </>
  );
}
