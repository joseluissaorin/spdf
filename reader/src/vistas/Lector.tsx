/**
 * El lector: el facsímil y su texto lado a lado, con el folio impreso en el
 * margen. Una unidad cada vez (la página, la diapositiva…), o la transcripción
 * entera si es un audio o un vídeo. Todo lo demás (buscar, citar, la ficha,
 * preguntar) son paneles que no tapan el texto.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, reloj } from '../i18n';
import type { Fragmento, Resumen, Unidad, Ancla } from '../nucleo/tipos';
import { Atras, Izq, Der, Lupa, Comillas, Ficha, Pregunta, Vectores, Exportar, Facsimil as IconoFacsimil, Texto as IconoTexto, Ambos, Puntos as IconoMas } from '../componentes/Iconos';
import { Hoja } from './Hoja';
import { Facsimil } from './Facsimil';
import { copiar } from '../util/portapapeles';
import { useAnotaciones } from './useAnotaciones';
import { desplazamientoDe, utf16ACp } from '../util/texto';
import { Dialogo } from '../componentes/Dialogo';
import { Boceto } from '../dibujo/BocetoReact';
import { legible } from './importar';

const PanelBuscar = lazy(() => import('./PanelBuscar').then((m) => ({ default: m.PanelBuscar })));
const PanelDocumento = lazy(() => import('./PanelDocumento').then((m) => ({ default: m.PanelDocumento })));
const PanelPreguntar = lazy(() => import('./PanelPreguntar').then((m) => ({ default: m.PanelPreguntar })));
const DialogoCitar = lazy(() => import('./DialogoCitar').then((m) => ({ default: m.DialogoCitar })));
const DialogoRevectorizar = lazy(() => import('./DialogoRevectorizar').then((m) => ({ default: m.DialogoRevectorizar })));
const Medio = lazy(() => import('./Medio').then((m) => ({ default: m.Medio })));

export type Panel = null | 'buscar' | 'indice' | 'figuras' | 'anotaciones' | 'ficha' | 'preguntar';

const PAGINADOS = new Set(['pdf', 'scanned_pdf', 'photos', 'image', 'epub', 'document', 'slides', 'sheet', 'web']);

export function Lector() {
  const { ruta, nucleo, ir, prefs, cambiarPrefs, busqueda, setBusqueda, avisar, lengua, entradas, refrescar } = useApp();
  const { t } = useIdioma();
  const id = ruta.vista === 'leer' ? ruta.id : '';
  const ord = ruta.vista === 'leer' ? ruta.u ?? 0 : 0;
  const fragmentoRuta = ruta.vista === 'leer' ? ruta.f ?? null : null;
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unidad, setUnidad] = useState<Unidad | null>(null);
  const [fragmentos, setFragmentos] = useState<Fragmento[]>([]);
  const [panel, setPanel] = useState<Panel>(busqueda.resultado && busqueda.actual >= 0 ? 'buscar' : null);
  const [citar, setCitar] = useState(false);
  const [revectorizar, setRevectorizar] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [menu, setMenu] = useState(false);
  const [region, setRegion] = useState<Ancla['region'] | null>(null);
  const [folio, setFolio] = useState('');
  const [seleccion, setSeleccion] = useState<{ x: number; y: number; desde: number; hasta: number; texto: string } | null>(null);
  const [nota, setNota] = useState<{ desde: number; hasta: number; texto: string } | null>(null);
  const [textoNota, setTextoNota] = useState('');
  const cache = useRef(new Map<number, Unidad>());
  const inputFolio = useRef<HTMLInputElement>(null);
  const capa = useRef<HTMLDivElement>(null);
  const entrada = entradas?.find((e) => e.id === id);
  const an = useAnotaciones(id, resumen);

  // Abrir el documento (y medir cuánto tarda en estar el texto en pantalla).
  useEffect(() => {
    let vivo = true;
    performance.mark('spdf:abrir');
    setResumen(null); setError(null); cache.current.clear();
    nucleo.abrir(id).then((r) => { if (vivo) setResumen(r); }).catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)));
    return () => { vivo = false; };
  }, [id, nucleo]);

  const total = resumen ? resumen.folios.length || resumen.document.unit_count : 0;
  const esMedio = !!resumen && (resumen.document.kind === 'audio' || resumen.document.kind === 'video');
  const actual = Math.min(Math.max(1, ord || entrada?.ultimaUnidad || 1), Math.max(1, total));

  // La unidad actual (y sus vecinas, para pasar de página sin esperar).
  useEffect(() => {
    if (!resumen || esMedio) return;
    let vivo = true;
    const c = cache.current;
    const ya = c.get(actual);
    if (ya) setUnidad(ya);
    const desde = Math.max(1, actual - 2), hasta = Math.min(total, actual + 2);
    const faltan = [...Array(hasta - desde + 1)].map((_, i) => desde + i).some((o) => !c.has(o));
    if (faltan) {
      nucleo.unidades(id, desde, hasta).then((us) => {
        for (const u of us) c.set(u.ord, u);
        if (vivo) setUnidad(c.get(actual) ?? null);
      }).catch((e) => vivo && setError(String(e)));
    }
    return () => { vivo = false; };
  }, [resumen, actual, id, nucleo, total, esMedio]);

  useEffect(() => {
    if (!unidad) return;
    let vivo = true;
    nucleo.fragmentos(id, unidad.id).then((f) => { if (vivo) setFragmentos(f); }).catch(() => vivo && setFragmentos([]));
    setFolio(unidad.printed ?? '');
    const tm = setTimeout(() => void nucleo.recordarPosicion(id, unidad.ord), 600);
    return () => { vivo = false; clearTimeout(tm); };
  }, [unidad, id, nucleo]);

  // Medida: primera página con texto en pantalla.
  useEffect(() => {
    if (!unidad || performance.getEntriesByName('spdf:apertura').length) return;
    requestAnimationFrame(() => {
      performance.mark('spdf:abierto');
      try { performance.measure('spdf:apertura', 'spdf:abrir', 'spdf:abierto'); } catch { /* sin marca previa */ }
    });
  }, [unidad]);

  const actualRef = useRef(actual);
  // Solo cuando cambia la página de verdad: un render intermedio (con la ruta aún vieja) no debe pisarla.
  useEffect(() => { actualRef.current = actual; }, [actual]);
  const irA = useCallback((o: number, extra: { f?: string; reemplazar?: boolean } = {}) => {
    actualRef.current = Math.min(Math.max(1, o), Math.max(1, total));
    setSeleccion(null); setRegion(null);
    ir({ vista: 'leer', id, u: Math.min(Math.max(1, o), Math.max(1, total)), f: extra.f }, extra.reemplazar);
  }, [id, ir, total]);

  const irAFolio = async (f: string) => {
    const v = f.trim();
    if (!v) return;
    if (/^#\d+$/.test(v)) { irA(Number(v.slice(1))); return; }
    const ords = await nucleo.unidadesPorFolio(id, v);
    if (!ords.length) { avisar(t('folioNoEncontrado', { f: v }), { tipo: 'error' }); setFolio(unidad?.printed ?? ''); return; }
    if (ords.length > 1) avisar(t('folioVarias', { f: v, n: ords.length }));
    irA(ords[0]);
  };

  // Resultados de búsqueda: anterior y siguiente, aunque estén en otro documento.
  const aciertos = busqueda.resultado?.aciertos ?? [];
  const abrirResultado = useCallback((i: number) => {
    const a = aciertos[i];
    if (!a) return;
    setBusqueda({ actual: i });
    ir({ vista: 'leer', id: a.documento, u: a.unidad_ord, f: a.fragment_id, ...(a.anchor.type === 'time' ? { t: a.anchor.t0 } : {}) });
  }, [aciertos, ir, setBusqueda]);

  const citaPagina = useCallback(async () => {
    if (!unidad) return;
    const c = await nucleo.citar(id, unidad.anchor, lengua);
    if (await copiar(c)) avisar(t('citaCopiada', { cita: c }), { accion: { texto: t('referencia'), hacer: () => setCitar(true) } });
  }, [unidad, nucleo, id, lengua, avisar, t]);

  const citarPasaje = useCallback(async (f: Fragmento) => {
    const c = await nucleo.citar(id, f.anchor, lengua, f.anchor_end);
    const q = lengua === 'es' ? ['«', '»'] : ['“', '”'];
    const txt = `${q[0]}${f.text.replace(/\s+/g, ' ').trim()}${q[1]} ${c}`;
    if (await copiar(txt, `<blockquote>${escapar(f.text)}</blockquote><p>${escapar(c)}</p>`)) avisar(t('citaCopiada', { cita: c }));
  }, [nucleo, id, lengua, avisar, t]);

  // La selección del usuario → chars exactos en el texto de la unidad.
  const leerSeleccion = useCallback(() => {
    const s = getSelection();
    if (!s || s.isCollapsed || !unidad || !capa.current) { setSeleccion(null); return; }
    const r = s.getRangeAt(0);
    if (!capa.current.contains(r.commonAncestorContainer)) { setSeleccion(null); return; }
    const a = desplazamientoDe(r.startContainer, r.startOffset, false);
    const b = desplazamientoDe(r.endContainer, r.endOffset, true);
    if (a == null || b == null || b <= a) { setSeleccion(null); return; }
    const rect = r.getBoundingClientRect();
    setSeleccion({ x: rect.left + rect.width / 2, y: rect.top, desde: a, hasta: b, texto: unidad.text.slice(a, b) });
  }, [unidad]);

  const anclaSeleccion = (sel: { desde: number; hasta: number }): Ancla => ({
    ...(unidad!.anchor as Ancla), chars: [utf16ACp(unidad!.text, sel.desde), utf16ACp(unidad!.text, sel.hasta)],
  } as Ancla);

  const citarSeleccion = async () => {
    if (!seleccion || !unidad) return;
    const c = await nucleo.citar(id, anclaSeleccion(seleccion), lengua);
    const q = lengua === 'es' ? ['«', '»'] : ['“', '”'];
    if (await copiar(`${q[0]}${seleccion.texto.replace(/\s+/g, ' ').trim()}${q[1]} ${c}`)) avisar(t('citaCopiada', { cita: c }));
    setSeleccion(null);
  };

  const anotar = async (sel: { desde: number; hasta: number; texto: string }, texto?: string) => {
    if (!unidad) return;
    const ancla = anclaSeleccion(sel);
    const [uri, cita] = await Promise.all([nucleo.uriAncla(id, ancla), nucleo.citar(id, ancla, lengua)]);
    await an.anadir({
      tipo: texto ? 'nota' : 'subrayado', unidad: unidad.id, ord: unidad.ord,
      desde: ancla.chars![0], hasta: ancla.chars![1], exacto: sel.texto,
      prefijo: unidad.text.slice(Math.max(0, sel.desde - 32), sel.desde), sufijo: unidad.text.slice(sel.hasta, sel.hasta + 32),
      nota: texto, uri, cita,
    });
    getSelection()?.removeAllRanges();
    setSeleccion(null);
  };

  // Atajos de teclado.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable], dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (!esMedio && (k === 'ArrowRight' || k === 'PageDown' || k === 'j')) { e.preventDefault(); irA(actualRef.current + 1); }
      else if (!esMedio && (k === 'ArrowLeft' || k === 'PageUp' || k === 'k')) { e.preventDefault(); irA(actualRef.current - 1); }
      else if (k === 'g') { e.preventDefault(); inputFolio.current?.select(); }
      else if (k === '/') { e.preventDefault(); setPanel('buscar'); }
      else if (k === 'c') { e.preventDefault(); void citaPagina(); }
      else if (k === 'i') setPanel((p) => (p === 'indice' ? null : 'indice'));
      else if (k === 'f') setPanel((p) => (p === 'ficha' ? null : 'ficha'));
      else if (k === 'v') cambiarPrefs({ vista: prefs.vista === 'ambos' ? 'texto' : prefs.vista === 'texto' ? 'facsimil' : 'ambos' });
      else if (k === 'n' && aciertos.length) abrirResultado(Math.min(aciertos.length - 1, busqueda.actual + 1));
      else if (k === 'N' && aciertos.length) abrirResultado(Math.max(0, busqueda.actual - 1));
      else if (k === '?') setAyuda(true);
      else if (k === 'Escape') { setPanel(null); setSeleccion(null); setMenu(false); }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [actual, irA, citaPagina, cambiarPrefs, prefs.vista, aciertos.length, abrirResultado, busqueda.actual, esMedio]);

  const titulo = resumen?.document.metadata?.title ?? resumen?.document.title ?? entrada?.titulo ?? '';
  const vista = prefs.vista;
  const consultaResaltar = busqueda.resultado && busqueda.modo !== 'semantica' ? busqueda.consulta : '';

  if (error) {
    return (
      <>
        <header className="barra"><button className="icono" onClick={() => ir({ vista: 'biblioteca' })} aria-label={t('volver')}><Atras /></button></header>
        <main className="vacio" id="contenido">
          <Boceto carga={() => import('../dibujo/dibujos/borron').then((m) => m.borron)} caja={[340, 240]} lengua={lengua} />
          <h2>{t('error')}</h2><p>{legible(error, t as never)}</p>
          <button className="boton" onClick={() => ir({ vista: 'biblioteca' })}>{t('volver')}</button>
        </main>
      </>
    );
  }

  return (
    <div className="lector">
      <header className="barra">
        <button className="icono" onClick={() => ir({ vista: 'biblioteca' })} aria-label={t('volver')} title={t('volver')}><Atras /></button>
        <div className="titulo-doc" title={titulo}>{titulo}</div>

        {!esMedio && resumen && (
          <nav className="folio-nav" aria-label={t('irAPagina')}>
            <button className="icono" onClick={() => irA(actual - 1)} disabled={actual <= 1} aria-label={t('paginaAnterior')}><Izq /></button>
            <form onSubmit={(e) => { e.preventDefault(); void irAFolio(folio); }}>
              <label className="oculto-visual" htmlFor="folio">{t('irAPagina')}</label>
              <input id="folio" ref={inputFolio} value={folio} onChange={(e) => setFolio(e.target.value)} placeholder={unidad?.printed ? undefined : '—'}
                title={t('irAPagina')} inputMode="text" autoComplete="off" />
            </form>
            <button className="icono" onClick={() => irA(actual + 1)} disabled={actual >= total} aria-label={t('paginaSiguiente')}><Der /></button>
            <span className="total" aria-label={t('paginaFisica', { n: actual, total })}>{actual}/{total}</span>
          </nav>
        )}

        {aciertos.length > 0 && busqueda.actual >= 0 && (
          <div className="navegador-resultados ocultable" role="group" aria-label={t('resultado', { i: busqueda.actual + 1, n: aciertos.length })}>
            <button className="icono" style={{ width: 28, height: 28 }} onClick={() => abrirResultado(busqueda.actual - 1)} disabled={busqueda.actual <= 0} aria-label={t('anterior')}><Izq /></button>
            <span>{busqueda.actual + 1}/{aciertos.length}</span>
            <button className="icono" style={{ width: 28, height: 28 }} onClick={() => abrirResultado(busqueda.actual + 1)} disabled={busqueda.actual >= aciertos.length - 1} aria-label={t('siguiente')}><Der /></button>
          </div>
        )}

        {!esMedio && (
          <div className="segmentado ocultable" role="group" aria-label={t('vista')}>
            <button aria-pressed={vista === 'facsimil'} onClick={() => cambiarPrefs({ vista: 'facsimil' })} title={t('facsimil')} aria-label={t('facsimil')}><IconoFacsimil /></button>
            <button aria-pressed={vista === 'ambos'} onClick={() => cambiarPrefs({ vista: 'ambos' })} title={t('ambos')} aria-label={t('ambos')}><Ambos /></button>
            <button aria-pressed={vista === 'texto'} onClick={() => cambiarPrefs({ vista: 'texto' })} title={t('texto')} aria-label={t('texto')}><IconoTexto /></button>
          </div>
        )}
        <button className="icono" aria-pressed={panel === 'buscar'} onClick={() => setPanel(panel === 'buscar' ? null : 'buscar')} aria-label={t('buscar')} title={`${t('buscar')} (/)`}><Lupa /></button>
        <button className="boton minio chico" onClick={citaPagina} title={`${t('copiarCita')} (c)`}><Comillas />{t('citar')}</button>
        <button className="icono" aria-pressed={panel === 'preguntar'} onClick={() => setPanel(panel === 'preguntar' ? null : 'preguntar')} aria-label={t('preguntar')} title={t('preguntar')}><Pregunta /></button>
        <button className="icono" aria-pressed={!!panel && ['indice', 'figuras', 'anotaciones', 'ficha'].includes(panel)} onClick={() => setPanel(panel && ['indice', 'figuras', 'anotaciones', 'ficha'].includes(panel) ? null : 'ficha')} aria-label={t('ficha')} title={`${t('ficha')} (f)`}><Ficha /></button>
        <div style={{ position: 'relative' }}>
          <button className="icono" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)} aria-label={t('exportar')} title={t('exportar')}><IconoMas /></button>
          {menu && (
            <ul role="menu" className="menu-flotante" onClick={() => setMenu(false)}>
              <li role="none"><button role="menuitem" onClick={() => setCitar(true)}><Comillas />{t('referencia')}</button></li>
              <li role="none"><button role="menuitem" onClick={() => setRevectorizar(true)}><Vectores />{t('revectorizar')}</button></li>
              <li role="none"><button role="menuitem" onClick={() => void an.exportarMarkdown()}><Exportar />{t('exportarMarkdown')}</button></li>
              <li role="none"><button role="menuitem" onClick={() => void an.exportarW3C()}><Exportar />{t('exportarAnotaciones')}</button></li>
              <li role="none"><button role="menuitem" onClick={async () => { const r = await nucleo.referencia(id, 'csl'); await nucleo.guardarComo(`${(entrada?.nombre ?? 'documento').replace(/\.spdf$/i, '')}.csl.json`, r, 'application/json'); }}><Exportar />{t('cslJson')}</button></li>
              <li role="none"><button role="menuitem" onClick={async () => { const r = await nucleo.referencia(id, 'bibtex'); await nucleo.guardarComo(`${(entrada?.nombre ?? 'documento').replace(/\.spdf$/i, '')}.bib`, r, 'application/x-bibtex'); }}><Exportar />{t('bibtex')}</button></li>
              {'leerFichero' in nucleo && (
                <li role="none"><button role="menuitem" onClick={async () => { const b = await (nucleo as unknown as { leerFichero(id: string): Promise<Uint8Array | null> }).leerFichero(id); if (b) await nucleo.guardarComo(entrada?.nombre ?? 'documento.spdf', b, 'application/vnd.spdf'); }}><Exportar />{t('guardarCopia')}</button></li>
              )}
            </ul>
          )}
        </div>
      </header>

      <div className="cuerpo">
        <main id="contenido" className="lector" style={{ minWidth: 0 }}>
          {!resumen ? (
            <div className="vacio" role="status">{t('cargando')}</div>
          ) : esMedio ? (
            <Suspense fallback={<div className="vacio" role="status">{t('cargando')}</div>}>
              <Medio id={id} resumen={resumen} tInicial={ruta.vista === 'leer' ? ruta.t : undefined} destacado={fragmentoRuta} consulta={consultaResaltar} alCitar={citarPasaje} />
            </Suspense>
          ) : (
            <div className={`mesa${vista === 'texto' ? ' solo-texto' : vista === 'facsimil' ? ' solo-facsimil' : ''}`}>
              {vista !== 'texto' && <Facsimil id={id} unidad={unidad} region={region} />}
              {vista !== 'facsimil' && (
                <div className="capa-texto" ref={capa} onMouseUp={leerSeleccion} onKeyUp={(e) => { if (e.shiftKey) leerSeleccion(); }} onScroll={() => seleccion && setSeleccion(null)}>
                  {unidad && (
                    <div className="hoja" key={unidad.id}>
                      <div className="margen" aria-hidden="true">
                        <span className="folio">{unidad.printed ? `${unidad.anchor.type === 'page' && unidad.anchor.source === 'inferred' ? `[${unidad.printed}]` : unidad.printed}` : t('sinFolio')}</span>
                        <span className="fisica">{unidad.ord}/{total}</span>
                      </div>
                      <h2 className="oculto-visual">{t('paginaFisica', { n: unidad.ord, total })}{unidad.printed ? `, ${unidad.printed}` : ''}</h2>
                      {unidad.header && <div className="titulillo">{unidad.header}</div>}
                      <Hoja unidad={unidad} fragmentos={fragmentos} anotaciones={an.lista} consulta={consultaResaltar}
                        destacado={fragmentoRuta} lengua={resumen.document.language} alCitarPasaje={citarPasaje}
                        alClicAnotacion={() => setPanel('anotaciones')} />
                      {unidad.notes && unidad.notes.length > 0 && (
                        <aside className="notas-pie" aria-label={t('notas')}>
                          <span className="etiqueta">{t('notas')}</span>
                          <ol>{unidad.notes.map((n, i) => <li key={i}>{n}</li>)}</ol>
                        </aside>
                      )}
                      <div className="metadato-unidad">
                        <span className="sello">{t('leidoPor', { quien: unidad.reader })}</span>
                        {unidad.confidence < 0.995 && <span className="sello">{t('confianza', { p: Math.round(unidad.confidence * 100) })}</span>}
                        {unidad.anchor.type === 'page' && unidad.anchor.source === 'inferred' && <span className="sello oro">{t('inferido')}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        <Suspense fallback={null}>
          {panel === 'buscar' && <PanelBuscar ambitoFijo={null} documento={id} titulo={titulo} alCerrar={() => setPanel(null)} />}
          {panel && ['indice', 'figuras', 'anotaciones', 'ficha'].includes(panel) && resumen && (
            <PanelDocumento id={id} resumen={resumen} pestana={panel as 'indice' | 'figuras' | 'anotaciones' | 'ficha'} alPestana={setPanel}
              alCerrar={() => setPanel(null)} anotaciones={an} alIr={(o, r) => { irA(o); setRegion(r ?? null); }}
              alRevectorizar={() => setRevectorizar(true)} />
          )}
          {panel === 'preguntar' && resumen && <PanelPreguntar id={id} resumen={resumen} alCerrar={() => setPanel(null)} alIr={(o, f) => irA(o, { f })} />}
        </Suspense>
      </div>

      {seleccion && (
        <div className="burbuja-seleccion" style={{ left: Math.max(8, seleccion.x - 150), top: Math.max(8, seleccion.y - 48) }} role="toolbar" aria-label={t('citarSeleccion')}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={citarSeleccion}>{t('citarSeleccion')}</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void anotar(seleccion)}>{t('subrayar')}</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setNota(seleccion); setTextoNota(''); setSeleccion(null); }}>{t('nota')}</button>
        </div>
      )}

      <Dialogo titulo={t('nota')} abierto={!!nota} alCerrar={() => setNota(null)}
        pie={<><button className="boton" onClick={() => setNota(null)}>{t('cancelar')}</button><button className="boton tinta" onClick={async () => { if (nota) await anotar(nota, textoNota.trim() || undefined); setNota(null); }}>{t('guardar')}</button></>}>
        {nota && <blockquote style={{ margin: 0, fontStyle: 'italic', borderLeft: '2px solid var(--amarillo)', paddingLeft: 12 }}>{nota.texto}</blockquote>}
        <label className="oculto-visual" htmlFor="texto-nota">{t('escribirNota')}</label>
        <textarea id="texto-nota" className="campo" rows={4} autoFocus placeholder={t('escribirNota')} value={textoNota} onChange={(e) => setTextoNota(e.target.value)} />
      </Dialogo>

      <Suspense fallback={null}>
        {citar && resumen && <DialogoCitar id={id} resumen={resumen} unidad={unidad} alCerrar={() => setCitar(false)} />}
        {revectorizar && resumen && (
          <DialogoRevectorizar id={id} resumen={resumen} alCerrar={() => setRevectorizar(false)}
            alTerminar={async (e) => { setRevectorizar(false); await refrescar(); ir({ vista: 'leer', id: e.id, u: actual }); }} />
        )}
      </Suspense>

      <Dialogo titulo={t('atajos')} abierto={ayuda} alCerrar={() => setAyuda(false)}>
        <div className="atajos">
          <span><kbd>←</kbd> <kbd>→</kbd></span><span>{t('atajoPaginas')}</span>
          <span><kbd>g</kbd></span><span>{t('atajoIr')}</span>
          <span><kbd>/</kbd></span><span>{t('atajoBuscar')}</span>
          <span><kbd>c</kbd></span><span>{t('atajoCitar')}</span>
          <span><kbd>f</kbd> <kbd>i</kbd></span><span>{t('atajoFicha')}</span>
          <span><kbd>v</kbd></span><span>{t('atajoVista')}</span>
          <span><kbd>n</kbd> <kbd>⇧N</kbd></span><span>{t('atajoResultados')}</span>
          <span><kbd>Esc</kbd></span><span>{t('atajoCerrar')}</span>
          <span><kbd>?</kbd></span><span>{t('atajoAyuda')}</span>
        </div>
      </Dialogo>
    </div>
  );
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export { reloj };
