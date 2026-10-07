/**
 * La biblioteca: un fichero de catálogo. Cada documento es una ficha (título en
 * Georgia, autor en cursiva, una monoespaciada que susurra año, páginas,
 * versión y espacios). A la izquierda, las colecciones (.spdfl.json). Arriba,
 * la búsqueda en toda la biblioteca. Si está vacía, la bienvenida.
 */
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, tamano } from '../i18n';
import type { Coleccion, EntradaBiblioteca } from '../nucleo/nucleo';
import { Ajustes as IconoAjustes, Importar, Lupa, Mas, Papelera, Exportar, Cerrar } from '../componentes/Iconos';
import { Dialogo } from '../componentes/Dialogo';
import { Boceto } from '../dibujo/BocetoReact';
import { useImportar } from './importar';
import { Emblema } from './Emblema';
import { manifiestoColeccion, leerManifiesto } from '../util/colecciones';

const PanelBuscar = lazy(() => import('./PanelBuscar').then((m) => ({ default: m.PanelBuscar })));

export function Biblioteca() {
  const { entradas, colecciones, ruta, ir, nucleo, refrescar, avisar, busqueda, setBusqueda } = useApp();
  const { t, lengua } = useIdioma();
  const importar = useImportar();
  const entrada = useRef<HTMLInputElement>(null);
  const entradaColeccion = useRef<HTMLInputElement>(null);
  const [filtro, setFiltro] = useState('');
  const [orden, setOrden] = useState<'reciente' | 'titulo' | 'autor' | 'anio'>('reciente');
  const [buscando, setBuscando] = useState(busqueda.ambito === 'biblioteca' && !!busqueda.resultado);
  const [nuevaColeccion, setNuevaColeccion] = useState(false);
  const [nombre, setNombre] = useState('');
  const [quitar, setQuitar] = useState<EntradaBiblioteca | null>(null);
  const coleccion = ruta.vista === 'biblioteca' && ruta.coleccion ? colecciones.find((c) => c.id === ruta.coleccion) ?? null : null;

  const elegir = async () => {
    const rutas = await nucleo.elegirFicheros();
    if (rutas) { if (rutas.length) void importar(rutas); }
    else entrada.current?.click();
  };

  const visibles = useMemo(() => {
    let l = entradas ?? [];
    if (coleccion) l = l.filter((e) => coleccion.items.includes(e.source_sha256));
    const f = filtro.trim().toLocaleLowerCase(lengua).normalize('NFD').replace(/\p{Mn}/gu, '');
    if (f) l = l.filter((e) => `${e.titulo} ${e.autores} ${e.anio ?? ''}`.toLocaleLowerCase(lengua).normalize('NFD').replace(/\p{Mn}/gu, '').includes(f));
    const cmp = new Intl.Collator(lengua).compare;
    return [...l].sort((a, b) =>
      orden === 'titulo' ? cmp(a.titulo, b.titulo)
        : orden === 'autor' ? cmp(a.autores, b.autores)
          : orden === 'anio' ? (a.anio ?? 1e9) - (b.anio ?? 1e9)
            : (b.abierto ?? b.anadido).localeCompare(a.abierto ?? a.anadido));
  }, [entradas, coleccion, filtro, orden, lengua]);

  const crearColeccion = async () => {
    const n = nombre.trim();
    if (!n) return;
    const c: Coleccion = { id: crypto.randomUUID().slice(0, 8), nombre: n, items: [] };
    await nucleo.guardarColeccion(c);
    await refrescar();
    setNuevaColeccion(false); setNombre('');
    ir({ vista: 'biblioteca', coleccion: c.id });
  };

  const exportarColeccion = async (c: Coleccion) => {
    const json = manifiestoColeccion(c, entradas ?? []);
    await nucleo.guardarComo(`${c.nombre}.spdfl.json`, json, 'application/json');
  };

  const importarColeccion = async (f: File) => {
    try {
      const c = leerManifiesto(await f.text());
      await nucleo.guardarColeccion(c);
      await refrescar();
      ir({ vista: 'biblioteca', coleccion: c.id });
    } catch (e) { avisar(String(e instanceof Error ? e.message : e), { tipo: 'error' }); }
  };

  const alternarEnColeccion = async (c: Coleccion, e: EntradaBiblioteca) => {
    const items = c.items.includes(e.source_sha256) ? c.items.filter((x) => x !== e.source_sha256) : [...c.items, e.source_sha256];
    await nucleo.guardarColeccion({ ...c, items });
    await refrescar();
  };

  const cabecera = (
    <header className="barra">
      <a className="marca-app" href="#/" aria-label={t('app')}>
        <span className="emblema"><Emblema /></span>
        <b>{t('app')}</b>
      </a>
      <span className="separa" />
      <button className="boton tinta" onClick={elegir} aria-label={t('importar')}><Importar /><span className="solo-escritorio">{t('importar')}</span></button>
      <button className="icono" aria-label={t('ajustes')} onClick={() => ir({ vista: 'ajustes' })}><IconoAjustes /></button>
      <input ref={entrada} type="file" accept=".spdf,.gz,application/vnd.spdf,application/x-sqlite3,application/gzip" multiple hidden
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void importar(fs); }} />
    </header>
  );

  if (entradas === null) return <>{cabecera}<div className="vacio" role="status">{t('cargando')}</div></>;
  if (entradas.length === 0) return <>{cabecera}<main id="contenido" className="estante" style={{ flex: 1 }}><Bienvenida alImportar={elegir} /></main></>;

  return (
    <>
      {cabecera}
      <div className="cuerpo">
        <div className="biblioteca" style={{ flex: 1 }}>
          <nav className="rail" aria-label={t('colecciones')}>
            <ul>
              <li><button aria-current={!coleccion} onClick={() => ir({ vista: 'biblioteca' })}>{t('todaBiblioteca')}<span className="cuenta">{entradas.length}</span></button></li>
            </ul>
            <div>
              <div className="etiqueta" style={{ marginBottom: 8 }}>{t('colecciones')}</div>
              <ul>
                {colecciones.map((c) => (
                  <li key={c.id}>
                    <button aria-current={coleccion?.id === c.id} onClick={() => ir({ vista: 'biblioteca', coleccion: c.id })}>
                      <span>{c.nombre}</span><span className="cuenta">{c.items.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                <button className="boton fantasma chico" onClick={() => setNuevaColeccion(true)}><Mas />{t('nuevaColeccion')}</button>
                <button className="boton fantasma chico" onClick={() => entradaColeccion.current?.click()}><Importar />{t('importarColeccion')}</button>
                <input ref={entradaColeccion} type="file" accept=".json,.spdfl.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importarColeccion(f); }} />
              </div>
            </div>
            <p className="susurro" style={{ marginTop: 'auto' }}>{t('privacidad')}</p>
          </nav>

          <main id="contenido" className="estante">
            <div className="estante-cabeza">
              <h1>{coleccion ? <em>{coleccion.nombre}</em> : t('biblioteca')}</h1>
              <div className="herramientas">
                {coleccion && (
                  <>
                    <button className="boton chico" onClick={() => exportarColeccion(coleccion)}><Exportar />{t('exportarColeccion')}</button>
                    <button className="icono" aria-label={t('borrarColeccion')} onClick={async () => { await nucleo.borrarColeccion(coleccion.id); await refrescar(); ir({ vista: 'biblioteca' }); }}><Papelera /></button>
                  </>
                )}
                <label className="oculto-visual" htmlFor="filtro">{t('filtrar')}</label>
                <input id="filtro" className="campo" style={{ width: 200 }} placeholder={t('filtrar')} value={filtro} onChange={(e) => setFiltro(e.target.value)} />
                <label className="oculto-visual" htmlFor="orden">{t('ordenar')}</label>
                <select id="orden" className="campo" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
                  <option value="reciente">{t('ordenReciente')}</option>
                  <option value="titulo">{t('ordenTitulo')}</option>
                  <option value="autor">{t('ordenAutor')}</option>
                  <option value="anio">{t('ordenAnio')}</option>
                </select>
              </div>
            </div>

            <form className="buscador-biblioteca" role="search" onSubmit={(e) => { e.preventDefault(); setBusqueda({ ambito: 'biblioteca' }); setBuscando(true); }}>
              <label className="oculto-visual" htmlFor="q-biblioteca">{t('buscarBiblioteca')}</label>
              <input id="q-biblioteca" className="campo grande" placeholder={t('buscarBiblioteca')} value={busqueda.ambito === 'biblioteca' ? busqueda.consulta : ''}
                onChange={(e) => setBusqueda({ consulta: e.target.value, ambito: 'biblioteca' })} />
              <button className="icono" type="submit" aria-label={t('buscar')}><Lupa /></button>
            </form>

            {visibles.length === 0 ? (
              <div className="vacio"><p>{coleccion ? t('coleccionVacia') : t('sinResultados', { q: filtro })}</p></div>
            ) : (
              <div className="fichas">
                {visibles.map((e, i) => (
                  <FichaLibro key={e.id} e={e} i={i} colecciones={colecciones}
                    alAbrir={() => ir({ vista: 'leer', id: e.id, u: e.ultimaUnidad })}
                    alQuitar={() => setQuitar(e)}
                    alColeccion={(c) => alternarEnColeccion(c, e)} tamano={tamano(e.bytes, lengua)} />
                ))}
              </div>
            )}
          </main>
        </div>
        {buscando && (
          <Suspense fallback={null}>
            <PanelBuscar ambitoFijo="biblioteca" alCerrar={() => setBuscando(false)} />
          </Suspense>
        )}
      </div>

      <Dialogo titulo={t('nuevaColeccion')} abierto={nuevaColeccion} alCerrar={() => setNuevaColeccion(false)}
        pie={<><button className="boton" onClick={() => setNuevaColeccion(false)}>{t('cancelar')}</button><button className="boton tinta" onClick={crearColeccion}>{t('guardar')}</button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void crearColeccion(); }}>
          <label className="etiqueta" htmlFor="nombre-col">{t('nombreColeccion')}</label>
          <input id="nombre-col" className="campo grande" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </form>
      </Dialogo>

      <Dialogo titulo={t('quitarDocumento')} abierto={!!quitar} alCerrar={() => setQuitar(null)}
        pie={<><button className="boton" onClick={() => setQuitar(null)}>{t('cancelar')}</button>
          <button className="boton minio" onClick={async () => { if (quitar) { await nucleo.quitar(quitar.id); await refrescar(); } setQuitar(null); }}>{t('quitarDocumento')}</button></>}>
        <p>{quitar && t('confirmarQuitar', { titulo: quitar.titulo })}</p>
      </Dialogo>
    </>
  );
}

function FichaLibro({ e, i, alAbrir, alQuitar, alColeccion, colecciones, tamano }: {
  e: EntradaBiblioteca; i: number; alAbrir: () => void; alQuitar: () => void; alColeccion: (c: Coleccion) => void; colecciones: Coleccion[]; tamano: string;
}) {
  const { t } = useIdioma();
  const [menu, setMenu] = useState(false);
  const paginado = ['pdf', 'scanned_pdf', 'photos', 'epub', 'document'].includes(e.tipo);
  return (
    <article className="ficha-libro" style={{ ['--i' as string]: Math.min(i, 12) }} onClick={alAbrir}
      onKeyDown={(k) => { if (k.key === 'Enter' && k.target === k.currentTarget) alAbrir(); }} tabIndex={0} aria-label={`${e.titulo}. ${e.autores}`}>
      <div>
        <h3 lang={undefined}>{e.titulo}</h3>
        <div className="autor">{e.autores || ' '}</div>
        <div className="datos">
          <span className="mono">{e.anio ?? 's. f.'}</span>
          <span className="mono">{paginado ? t('paginas', { n: e.unidades }) : t('unidades', { n: e.unidades })}</span>
          <span className="mono apagado">{tamano}</span>
        </div>
        <div className="datos" style={{ marginTop: 8 }}>
          {e.legacy ? <span className="sello oro">{t('legado', { v: e.version })}</span> : <span className="sello">SPDF {e.version}</span>}
          {e.espacios.length ? e.espacios.slice(0, 2).map((s) => <span key={s} className="sello azul">{s}</span>) : <span className="sello">{t('sinVectores')}</span>}
        </div>
      </div>
      {e.miniatura ? <img className="miniatura" src={e.miniatura} alt="" loading="lazy" /> : <div className="miniatura tipo">{e.tipo.replace('_', ' ')}</div>}
      <div className="acciones" onClick={(k) => k.stopPropagation()}>
        {colecciones.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button className="icono" aria-label={t('anadirAColeccion')} aria-expanded={menu} onClick={() => setMenu(!menu)}><Mas /></button>
            {menu && (
              <ul role="menu" className="panel" style={{ position: 'absolute', right: 0, bottom: 40, width: 220, padding: 6, listStyle: 'none', margin: 0, boxShadow: 'var(--sombra)', zIndex: 5, border: '1px solid var(--filete)' }}>
                {colecciones.map((c) => (
                  <li key={c.id} role="none">
                    <label className="casilla" style={{ padding: '4px 6px' }}>
                      <input type="checkbox" role="menuitemcheckbox" checked={c.items.includes(e.source_sha256)} onChange={() => alColeccion(c)} />
                      {c.nombre}
                    </label>
                  </li>
                ))}
                <li role="none"><button className="icono" aria-label={t('cerrar')} onClick={() => setMenu(false)}><Cerrar /></button></li>
              </ul>
            )}
          </div>
        )}
        <button className="icono" aria-label={t('quitarDocumento')} onClick={alQuitar}><Papelera /></button>
      </div>
    </article>
  );
}

function Bienvenida({ alImportar }: { alImportar: () => void }) {
  const { t, lengua } = useIdioma();
  return (
    <section className="bienvenida" aria-labelledby="bienvenida-titulo">
      <div className="disco" aria-hidden="true" />
      <div className="letra">
        <h1 id="bienvenida-titulo">{lengua === 'es' ? <>Lector<span>SPDF</span></> : <>SPDF<span>Reader</span></>}</h1>
        <p className="lema">{t('lema')}</p>
        <p className="texto-vacio">{matchMedia('(pointer: coarse)').matches ? t('bibliotecaVaciaTextoTactil') : t('bibliotecaVaciaTexto')}</p>
        <button className="boton tinta" onClick={alImportar}><Importar />{t('importar')}</button>
      </div>
      <div className="dibujo-mano">
        <Boceto carga={() => import('../dibujo/dibujos/bienvenida').then((m) => m.bienvenida)} caja={[560, 420]} lengua={lengua} espera={0.3} />
      </div>
      <p className="susurro">{t('privacidad')}</p>
      <span className="rotulo-borde" aria-hidden="true">SPDF 5.0 · {new Date().getFullYear()}</span>
    </section>
  );
}
