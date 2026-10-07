/**
 * Buscar: léxica siempre; semántica o híbrida si el SPDF trae vectores en un
 * espacio compatible con un modelo disponible (si no, se dice y se busca por
 * palabras). En un documento o en toda la biblioteca. La lista vive en el
 * estado de la aplicación: al abrir un resultado y volver, sigue en su sitio,
 * con el resultado abierto marcado; y se recorre con anterior y siguiente.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/estado';
import { useIdioma } from '../i18n';
import type { ModoBusqueda } from '../nucleo/tipos';
import { Cerrar, Lupa } from '../componentes/Iconos';
import { patronTerminos } from '../util/texto';
import { Boceto } from '../dibujo/BocetoReact';
import { Progreso } from '../componentes/Dialogo';

export function PanelBuscar({ ambitoFijo, documento, titulo, alCerrar }: { ambitoFijo: 'biblioteca' | null; documento?: string; titulo?: string; alCerrar: () => void }) {
  const { nucleo, busqueda, setBusqueda, ir, entradas, lengua } = useApp();
  const { t } = useIdioma();
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lastQ = useRef(busqueda.resultado ? busqueda.consulta : '');
  const scroll = useRef(busqueda.scroll);
  const ambito = ambitoFijo ?? (busqueda.ambito === 'biblioteca' ? 'biblioteca' : documento ?? 'biblioteca');

  // Al abrir el panel dentro de un documento, el ámbito es ese documento (salvo que venga de la biblioteca).
  useEffect(() => {
    if (!ambitoFijo && documento && busqueda.ambito !== 'biblioteca' && busqueda.ambito !== documento) setBusqueda({ ambito: documento, resultado: null, actual: -1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento]);

  useEffect(() => {
    if (!busqueda.resultado) campo.current?.focus();
    // La lista vuelve a donde estaba.
    if (lista.current) lista.current.scrollTop = busqueda.scroll;
    const sel = lista.current?.querySelector('[aria-current="true"]') as HTMLElement | null;
    if (sel && lista.current && (sel.offsetTop < lista.current.scrollTop || sel.offsetTop > lista.current.scrollTop + lista.current.clientHeight)) sel.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = async (q = busqueda.consulta, modo = busqueda.modo, am = ambito) => {
    if (!q.trim()) { setBusqueda({ resultado: null, actual: -1 }); return; }
    setBuscando(true); setError(null);
    try {
      const r = await nucleo.buscar({ ambito: am, consulta: q, modo, limite: 60, lengua });
      setBusqueda({ resultado: r, actual: -1, scroll: 0, consulta: q, modo, ambito: am });
      if (lista.current) lista.current.scrollTop = 0;
      scroll.current = 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBuscando(false); }
  };

  // Léxica: mientras se escribe. Semántica e híbrida: al pulsar Intro (pueden costar una llamada).
  useEffect(() => {
    if (busqueda.modo !== 'lexica') return;
    const q = busqueda.consulta;
    if (busqueda.resultado && q === lastQ.current) return;
    const tm = setTimeout(() => { lastQ.current = q; void buscar(q); }, 280);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda.consulta, busqueda.modo, ambito]);

  // La posición de la lista se guarda al salir (no en cada píxel de desplazamiento).
  useEffect(() => () => setBusqueda({ scroll: scroll.current }), [setBusqueda]);

  const re = useMemo(() => (busqueda.resultado?.modo === 'semantica' ? null : patronTerminos(busqueda.consulta)), [busqueda.consulta, busqueda.resultado]);
  const r = busqueda.resultado;
  const tituloDe = (id: string) => entradas?.find((e) => e.id === id)?.titulo ?? '';

  const avisos = (r?.avisos ?? []).filter((a) => a.motivo);
  const aviso = !r || busqueda.modo === 'lexica' || !avisos.length ? null
    : ambito !== 'biblioteca' ? ({ 'sin-vectores': t('avisoSinVectores'), 'sin-modelo': t('avisoSinModelo'), incompatible: t('avisoIncompatible') } as Record<string, string>)[avisos[0].motivo] ?? avisos[0].motivo
      : t('avisoVarios', { n: avisos.length });

  return (
    <aside className="panel" aria-labelledby="titulo-buscar">
      <div className="panel-cabeza">
        <h2 id="titulo-buscar">{t('buscar')}</h2>
        <button className="icono" onClick={alCerrar} aria-label={t('cerrar')}><Cerrar /></button>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--filete)' }}>
        <form role="search" onSubmit={(e) => { e.preventDefault(); lastQ.current = busqueda.consulta; void buscar(); }} style={{ display: 'flex', gap: 6 }}>
          <label className="oculto-visual" htmlFor="q">{ambito === 'biblioteca' ? t('buscarBiblioteca') : t('buscarEn', { titulo: titulo ?? '' })}</label>
          <input id="q" ref={campo} className="campo grande" style={{ fontSize: 19 }} value={busqueda.consulta} placeholder={t('consulta')}
            onChange={(e) => setBusqueda({ consulta: e.target.value })} autoComplete="off" spellCheck={false} />
          <button className="icono" type="submit" aria-label={t('buscar')}><Lupa /></button>
        </form>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="segmentado" role="group" aria-label={t('vista')}>
            {(['lexica', 'semantica', 'hibrida'] as ModoBusqueda[]).map((m) => (
              <button key={m} aria-pressed={busqueda.modo === m} onClick={() => { setBusqueda({ modo: m }); if (busqueda.consulta.trim()) void buscar(busqueda.consulta, m); }}>{t(m)}</button>
            ))}
          </div>
          {!ambitoFijo && documento && (
            <div className="segmentado" role="group">
              <button aria-pressed={ambito !== 'biblioteca'} onClick={() => { setBusqueda({ ambito: documento }); void buscar(busqueda.consulta, busqueda.modo, documento); }}>{t('esteDocumento')}</button>
              <button aria-pressed={ambito === 'biblioteca'} onClick={() => { setBusqueda({ ambito: 'biblioteca' }); void buscar(busqueda.consulta, busqueda.modo, 'biblioteca'); }}>{t('todaBiblioteca')}</button>
            </div>
          )}
        </div>
      </div>
      {buscando && <Progreso />}
      <div className="panel-cuerpo" ref={lista} onScroll={(e) => { scroll.current = (e.target as HTMLElement).scrollTop; }} aria-busy={buscando}>
        {error && <p className="aviso-busqueda" role="alert">{error}</p>}
        {aviso && <p className="aviso-busqueda">{aviso}</p>}
        {r && (
          <p className="susurro" aria-live="polite" style={{ margin: '0 0 8px' }}>
            {t('resultados', { n: r.aciertos.length, ms: r.ms })}{r.modo !== busqueda.modo ? ` · ${t(r.modo)}` : ''}
          </p>
        )}
        {r && r.aciertos.length === 0 && (
          <div className="vacio">
            <Boceto carga={() => import('../dibujo/dibujos/lupa').then((m) => m.lupa)} caja={[340, 240]} lengua={lengua} />
            <p>{t('sinResultados', { q: busqueda.consulta })}</p>
          </div>
        )}
        {r && r.aciertos.length > 0 && (
          <ol className="resultados">
            {r.aciertos.map((a, i) => (
              <li key={`${a.documento}:${a.fragment_id}`}>
                <button className="resultado" aria-current={busqueda.actual === i}
                  onClick={() => {
                    setBusqueda({ actual: i, scroll: scroll.current });
                    ir({ vista: 'leer', id: a.documento, u: a.unidad_ord, f: a.fragment_id, ...(a.anchor.type === 'time' ? { t: a.anchor.t0 } : {}) });
                  }}>
                  <span className="cita">{a.cita}</span>
                  {ambito === 'biblioteca' && <span className="doc"> · {tituloDe(a.documento)}</span>}
                  <span className="via">{a.via.map((v) => <span key={v} className={`sello${v === 'vector' ? ' azul' : ''}`}>{v === 'vector' ? t('semantica') : t('lexica')}</span>)}</span>
                  <p className="fragmento">{resaltar(a.texto, re)}</p>
                  {a.contexto && <span className="contexto">{a.contexto}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function resaltar(texto: string, re: RegExp | null): ReactNode[] {
  const s = texto.replace(/\s+/g, ' ').replace(/^#+\s*/, '');
  if (!re) return [s];
  const out: ReactNode[] = [];
  let i = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m.index > i) out.push(s.slice(i, m.index));
    out.push(<mark key={m.index}>{m[0]}</mark>);
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}
