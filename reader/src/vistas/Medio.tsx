/**
 * Audio y vídeo: el medio (si el SPDF lo trae, o una URL que el usuario decide
 * cargar) y su transcripción, con la palabra que suena resaltada y cada turno
 * con su hora, que salta al segundo. Clic en una palabra = ir a esa palabra.
 * Sin medio, la transcripción se lee y se cita igual.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, reloj } from '../i18n';
import type { Fragmento, Resumen, Unidad } from '../nucleo/tipos';
import { Reproducir, Pausa, Manicula } from '../componentes/Iconos';
import { patronTerminos } from '../util/texto';

interface Palabra { texto: string; t0: number; t1: number }

/** Las palabras de una unidad con sus tiempos (words: {v, t0, cs:[inicio, duración, …]} en centésimas desde t0). */
export function palabrasDe(u: Unidad): Palabra[] | null {
  if (!u.words?.cs?.length) return null;
  const toks = u.text.split(/\s+/).filter(Boolean);
  const base = u.words.t0 ?? u.t0 ?? 0;
  const cs = u.words.cs;
  const out: Palabra[] = [];
  for (let i = 0; i < toks.length; i++) {
    const s = cs[2 * i], d = cs[2 * i + 1];
    if (s == null || d == null) { out.push({ texto: toks[i], t0: NaN, t1: NaN }); continue; }
    out.push({ texto: toks[i], t0: base + s / 100, t1: base + (s + d) / 100 });
  }
  return out;
}

export function Medio({ id, resumen, tInicial, destacado, consulta, alCitar }: {
  id: string; resumen: Resumen; tInicial?: number; destacado: string | null; consulta: string; alCitar: (f: Fragmento) => void;
}) {
  const { nucleo } = useApp();
  const { t } = useIdioma();
  const [unidades, setUnidades] = useState<Unidad[] | null>(null);
  const [fragmentos, setFragmentos] = useState<Fragmento[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [permitir, setPermitir] = useState(false);
  const [ahora, setAhora] = useState(tInicial ?? 0);
  const [sonando, setSonando] = useState(false);
  const [seguir, setSeguir] = useState(true);
  const [duracion, setDuracion] = useState(resumen.document.duration ?? 0);
  const medio = useRef<HTMLMediaElement | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const ref = resumen.medio?.ref ?? null;
  const remoto = !!ref && /^https?:/i.test(ref);
  const video = resumen.document.kind === 'video';

  useEffect(() => {
    const total = resumen.folios.length || resumen.document.unit_count;
    void nucleo.unidades(id, 1, total).then(setUnidades);
    void nucleo.fragmentos(id).then(setFragmentos);
  }, [id, nucleo, resumen]);

  useEffect(() => {
    let vivo = true;
    if (!ref || (remoto && !permitir)) { setUrl(null); return; }
    void nucleo.recurso(id, ref).then((u) => vivo && setUrl(u));
    return () => { vivo = false; };
  }, [id, ref, remoto, permitir, nucleo]);

  // El reloj: con requestAnimationFrame mientras suena (timeupdate va a saltos de 250 ms).
  useEffect(() => {
    if (!sonando) return;
    let r = 0;
    const paso = () => { if (medio.current) setAhora(medio.current.currentTime); r = requestAnimationFrame(paso); };
    r = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(r);
  }, [sonando]);

  const ir = useCallback((s: number, tocar = false) => {
    setAhora(s);
    const m = medio.current;
    if (m) { m.currentTime = s; if (tocar) void m.play().catch(() => {}); }
  }, []);

  // El punto de partida: ?t= o el fragmento destacado.
  useEffect(() => {
    if (!unidades) return;
    let s = tInicial;
    if (s == null && destacado) {
      const f = fragmentos.find((x) => x.id === destacado);
      if (f?.anchor.type === 'time') s = f.anchor.t0;
    }
    if (s != null) ir(s);
  }, [unidades, tInicial, destacado, fragmentos, ir]);

  const activa = unidades?.findIndex((u) => u.t0 != null && u.t1 != null && ahora >= u.t0 && ahora < u.t1) ?? -1;
  const unidadDestacada = useMemo(() => fragmentos.find((f) => f.id === destacado)?.unit ?? null, [fragmentos, destacado]);

  useEffect(() => {
    if (!seguir || activa < 0 || !lista.current) return;
    const el = lista.current.querySelector<HTMLElement>(`[data-ord="${activa}"]`);
    if (!el) return;
    const c = lista.current.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < c.top + 40 || r.bottom > c.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activa, seguir]);

  useEffect(() => {
    if (!unidadDestacada || !lista.current) return;
    lista.current.querySelector(`[data-unidad="${CSS.escape(unidadDestacada)}"]`)?.scrollIntoView({ block: 'center' });
  }, [unidadDestacada, unidades]);

  const re = useMemo(() => patronTerminos(consulta), [consulta]);
  const host = remoto ? new URL(ref!).host : '';
  const fragDe = (u: Unidad) => fragmentos.find((f) => f.unit === u.id);

  const alternar = () => {
    const m = medio.current;
    if (!m) return;
    if (m.paused) void m.play().catch(() => {}); else m.pause();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <section className="medio" aria-label={video ? 'Vídeo' : 'Audio'}>
        {url && (video
          ? <video ref={(e) => { medio.current = e; }} src={url} playsInline preload="metadata" onClick={alternar}
              onPlay={() => setSonando(true)} onPause={() => setSonando(false)} onEnded={() => setSonando(false)}
              onLoadedMetadata={(e) => { setDuracion(e.currentTarget.duration || duracion); if (ahora) e.currentTarget.currentTime = ahora; }}
              onSeeked={(e) => setAhora(e.currentTarget.currentTime)} />
          : <audio ref={(e) => { medio.current = e; }} src={url} preload="metadata"
              onPlay={() => setSonando(true)} onPause={() => setSonando(false)} onEnded={() => setSonando(false)}
              onLoadedMetadata={(e) => { setDuracion(e.currentTarget.duration || duracion); if (ahora) e.currentTarget.currentTime = ahora; }}
              onSeeked={(e) => setAhora(e.currentTarget.currentTime)} />)}
        {!ref && <p className="apagado" style={{ margin: '0 0 8px' }}>{t('medioNoIncluido')}</p>}
        {remoto && !permitir && (
          <p style={{ margin: '0 0 8px' }}>{t('medioRemoto', { host })} <button className="boton chico" onClick={() => setPermitir(true)}>{t('cargarRemota', { host })}</button></p>
        )}
        <div className="controles">
          <button className="icono" onClick={alternar} disabled={!url} aria-label={sonando ? t('pausar') : t('reproducir')}>{sonando ? <Pausa /> : <Reproducir />}</button>
          <div className="pista">
            <i className="hecho" style={{ width: `${duracion ? (100 * ahora) / duracion : 0}%` }} />
            {unidades?.map((u) => u.t0 != null && duracion ? <span key={u.id} className="marca-unidad" style={{ left: `${(100 * u.t0) / duracion}%` }} /> : null)}
            <input type="range" min={0} max={duracion || 1} step={0.1} value={ahora} onChange={(e) => ir(Number(e.target.value))}
              aria-label={t('posicion', { t: reloj(ahora), total: reloj(duracion) })} aria-valuetext={reloj(ahora)} />
          </div>
          <span className="reloj">{reloj(ahora)} / {reloj(duracion)}</span>
          <label className="casilla ocultable" style={{ fontSize: 13 }}><input type="checkbox" checked={seguir} onChange={(e) => setSeguir(e.target.checked)} />{t('seguirLectura')}</label>
        </div>
      </section>
      <div className="transcripcion" ref={lista}>
        <div className="hoja">
          <h2 className="oculto-visual">{t('transcripcion')}</h2>
          <article lang={resumen.document.language ?? undefined}>
            {unidades?.map((u, i) => (
              <Turno key={u.id} u={u} i={i} activa={i === activa} ahora={i === activa ? ahora : -1} re={re}
                destacada={u.id === unidadDestacada} alIr={ir} frag={fragDe(u)} alCitar={alCitar} />
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}

const Turno = memo(function Turno({ u, i, activa, ahora, re, destacada, alIr, frag, alCitar }: {
  u: Unidad; i: number; activa: boolean; ahora: number; re: RegExp | null; destacada: boolean;
  alIr: (s: number, tocar?: boolean) => void; frag?: Fragmento; alCitar: (f: Fragmento) => void;
}) {
  const { t } = useIdioma();
  const pal = useMemo(() => palabrasDe(u), [u]);
  const hablante = u.anchor.type === 'time' ? u.anchor.speaker : undefined;
  const t0 = u.t0 ?? (u.anchor.type === 'time' ? u.anchor.t0 : 0);
  const coincide = (w: string) => { if (!re) return false; re.lastIndex = 0; return re.test(w); };
  return (
    <div className={`turno pasaje${activa ? ' activo' : ''}${destacada ? ' destacado' : ''}`} data-ord={i} data-unidad={u.id} data-fragmento={frag?.id}>
      <button className="tiempo" onClick={() => alIr(t0, true)} aria-label={t('irAlSegundo', { t: reloj(t0) })}>{reloj(t0)}</button>
      {hablante && <span className="hablante">{hablante}</span>}
      {frag && <button className="citar-pasaje" style={{ left: -54, top: 26 }} onClick={() => alCitar(frag)} aria-label={t('citarPasaje')} title={t('citarPasaje')}><Manicula /></button>}
      <p>
        {pal
          ? pal.map((w, k) => {
              const ya = ahora >= 0 && w.t0 <= ahora;
              const es = ahora >= 0 && w.t0 <= ahora && ahora < w.t1;
              const cls = `palabra${es ? ' ahora' : ya ? ' dicha' : ''}`;
              const n = coincide(w.texto) ? <mark>{w.texto}</mark> : w.texto;
              return <span key={k}><span className={cls} onClick={() => Number.isFinite(w.t0) && alIr(w.t0, true)}>{n}</span>{' '}</span>;
            })
          : u.text}
      </p>
    </div>
  );
});
