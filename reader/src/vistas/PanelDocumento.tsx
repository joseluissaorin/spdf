/**
 * Todo lo que hay dentro del SPDF, a la vista: el índice, las figuras con su
 * descripción, las anotaciones del usuario (fuera del fichero) y la ficha
 * completa: metadatos CSL con la procedencia de cada campo, derechos, espacios
 * vectoriales, validación, cómo se hizo (procedencia) y el volcado canónico.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, reloj, tamano } from '../i18n';
import type { Figura, InformeValidacion, Procedencia, Region, Resumen, MetadatosCsl, PersonaCsl } from '../nucleo/tipos';
import { Cerrar, Importar, Exportar, Papelera, Vectores } from '../componentes/Iconos';
import { Progreso } from '../componentes/Dialogo';
import { Boceto } from '../dibujo/BocetoReact';
import type { Anotaciones } from './useAnotaciones';
import type { Panel } from './Lector';

type Pestana = 'indice' | 'figuras' | 'anotaciones' | 'ficha';

export function PanelDocumento({ id, resumen, pestana, alPestana, alCerrar, anotaciones, alIr, alRevectorizar }: {
  id: string; resumen: Resumen; pestana: Pestana; alPestana: (p: Panel) => void; alCerrar: () => void;
  anotaciones: Anotaciones; alIr: (ord: number, region?: Region) => void; alRevectorizar: () => void;
}) {
  const { t } = useIdioma();
  const pestanas: [Pestana, string][] = [['ficha', t('ficha')], ['indice', t('indice')], ['figuras', t('figuras')], ['anotaciones', t('anotaciones')]];
  return (
    <aside className="panel" aria-labelledby="titulo-doc" style={{ width: 'min(480px, 100vw)' }}>
      <div className="panel-cabeza">
        <h2 id="titulo-doc">{pestanas.find((p) => p[0] === pestana)?.[1]}</h2>
        <button className="icono" onClick={alCerrar} aria-label={t('cerrar')}><Cerrar /></button>
      </div>
      <div role="tablist" className="pestanas" aria-label={t('contenido')}>
        {pestanas.map(([k, n]) => (
          <button key={k} role="tab" aria-selected={pestana === k} onClick={() => alPestana(k)}>{n}
            {k === 'figuras' && resumen.figuras > 0 && <span className="cuenta"> {resumen.figuras}</span>}
            {k === 'anotaciones' && anotaciones.lista.length > 0 && <span className="cuenta"> {anotaciones.lista.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel-cuerpo" role="tabpanel">
        {pestana === 'indice' && <Indice resumen={resumen} alIr={alIr} />}
        {pestana === 'figuras' && <Figuras id={id} resumen={resumen} alIr={alIr} />}
        {pestana === 'anotaciones' && <ListaAnotaciones an={anotaciones} resumen={resumen} alIr={alIr} />}
        {pestana === 'ficha' && <FichaCompleta id={id} resumen={resumen} alRevectorizar={alRevectorizar} />}
      </div>
    </aside>
  );
}

function ordDe(resumen: Resumen, unidad: string): number {
  const i = resumen.ids.indexOf(unidad);
  return i >= 0 ? i + 1 : 1;
}

function Indice({ resumen, alIr }: { resumen: Resumen; alIr: (o: number) => void }) {
  const { t } = useIdioma();
  if (!resumen.sections.length) return <p className="apagado">{t('secciones')}: 0</p>;
  return (
    <ul className="indice">
      {resumen.sections.map((s) => {
        const o = ordDe(resumen, s.unit_from);
        const f = resumen.folios[o - 1];
        return (
          <li key={s.id} style={{ paddingLeft: (s.level - 1) * 14 }}>
            <button onClick={() => alIr(o)}>
              <span style={{ fontStyle: s.level === 1 ? 'normal' : 'italic' }}>{s.title}</span>
              <span className="folio">{f ? `p. ${f}` : `#${o}`}</span>
            </button>
            {s.summary && <p className="apagado" style={{ margin: '0 0 6px', fontSize: 13.5 }}>{s.summary}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Figuras({ id, resumen, alIr }: { id: string; resumen: Resumen; alIr: (o: number, r?: Region) => void }) {
  const { nucleo, lengua } = useApp();
  const { t } = useIdioma();
  const [figs, setFigs] = useState<Figura[] | null>(null);
  useEffect(() => { void nucleo.figuras(id).then(setFigs); }, [id, nucleo]);
  if (!figs) return <Progreso />;
  if (!figs.length) return (
    <div className="vacio">
      <Boceto carga={() => import('../dibujo/dibujos/margen').then((m) => m.margen)} caja={[300, 200]} lengua={lengua} />
      <p>{t('sinFiguras')}</p>
    </div>
  );
  return (
    <ol className="resultados">
      {figs.map((f, i) => {
        const o = ordDe(resumen, f.unit);
        return (
          <li key={f.id} style={{ padding: '12px 0' }}>
            <figure style={{ margin: 0 }}>
              <Recorte id={id} ref_={f.image} region={f.image === `blob:${f.unit}` ? undefined : f.anchor.region} alt={f.description ?? f.caption ?? `${t('figura')} ${i + 1}`} />
              <figcaption style={{ marginTop: 8 }}>
                <span className="etiqueta">{t('figura')} {i + 1} · {resumen.folios[o - 1] ? `p. ${resumen.folios[o - 1]}` : `#${o}`}</span>
                {f.caption && <p style={{ margin: '4px 0', fontStyle: 'italic' }}>{f.caption}</p>}
                {f.description && <p style={{ margin: '4px 0', fontSize: 14.5 }}><span className="oculto-visual">{t('descripcion')}: </span>{f.description}</p>}
                <button className="boton chico" onClick={() => alIr(o, f.anchor.region)}>{t('verEnPagina')}</button>
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ol>
  );
}

/** La figura recortada de su página (si el ancla trae región), o entera. */
function Recorte({ id, ref_, region, alt }: { id: string; ref_: string; region?: Region; alt: string }) {
  const { nucleo } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<[number, number] | null>(null);
  useEffect(() => { void nucleo.recurso(id, ref_).then(setUrl); }, [id, ref_, nucleo]);
  if (!url) return <div style={{ aspectRatio: '4/3', background: 'var(--papel-2)' }} />;
  if (!region || !nat) return <img src={url} alt={alt} style={{ maxWidth: '100%', border: '1px solid var(--filete)', display: region && !nat ? 'none' : 'block' }} onLoad={(e) => region && setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />;
  const ar = (region.w * nat[0]) / (region.h * nat[1]);
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: String(ar), overflow: 'hidden', border: '1px solid var(--filete)' }} role="img" aria-label={alt}>
      <img src={url} alt="" style={{ position: 'absolute', width: `${100 / region.w}%`, left: `${(-region.x / region.w) * 100}%`, top: `${(-region.y / region.h) * 100}%`, maxWidth: 'none' }} />
    </div>
  );
}

function ListaAnotaciones({ an, resumen, alIr }: { an: Anotaciones; resumen: Resumen; alIr: (o: number) => void }) {
  const { t, lengua } = useIdioma();
  const entrada = useRef<HTMLInputElement>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const lista = useMemo(() => an.lista.map((a) => ({ ...a, ord: a.unidad ? ordDe(resumen, a.unidad) : a.ord })).sort((a, b) => a.ord - b.ord || a.desde - b.desde), [an.lista, resumen]);
  return (
    <div>
      <p className="susurro" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>{t('anotacionesFuera')}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
        <button className="boton chico" onClick={() => void an.exportarW3C()}><Exportar />{t('exportarAnotaciones')}</button>
        <button className="boton chico" onClick={() => void an.exportarMarkdown()}><Exportar />{t('exportarMarkdown')}</button>
        <button className="boton chico" onClick={() => entrada.current?.click()}><Importar />{t('importarAnotaciones')}</button>
        <input ref={entrada} type="file" accept=".json,.spdfa.json,application/ld+json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await an.importar(await f.text()); }} />
      </div>
      {lista.length === 0 ? (
        <div className="vacio">
          <Boceto carga={() => import('../dibujo/dibujos/margen').then((m) => m.margen)} caja={[300, 200]} lengua={lengua} />
          <p>{t('sinAnotaciones')}</p>
        </div>
      ) : (
        <ol className="resultados">
          {lista.map((a) => (
            <li key={a.id} className="afirmacion">
              <button className="resultado" style={{ padding: '4px 0 4px 10px' }} onClick={() => alIr(a.ord)}>
                <span className="cita">{a.cita}</span>
                <p className="fragmento" style={{ fontStyle: 'italic' }}>«{a.exacto}»</p>
              </button>
              {editando === a.id ? (
                <form onSubmit={async (e) => { e.preventDefault(); await an.editar(a.id, texto.trim()); setEditando(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea className="campo" rows={3} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} aria-label={t('escribirNota')} />
                  <div style={{ display: 'flex', gap: 6 }}><button className="boton tinta chico" type="submit">{t('guardar')}</button><button className="boton chico" type="button" onClick={() => setEditando(null)}>{t('cancelar')}</button></div>
                </form>
              ) : (
                <div className="pie-af">
                  {a.nota && <p style={{ margin: 0, flex: '1 1 100%' }}>{a.nota}</p>}
                  <button className="boton fantasma chico" onClick={() => { setEditando(a.id); setTexto(a.nota ?? ''); }}>{t('nota')}</button>
                  <button className="icono" aria-label={t('borrarAnotacion')} onClick={() => void an.borrar(a.id)}><Papelera /></button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const CAMPOS: [keyof MetadatosCsl, string, string][] = [
  ['title', 'Título', 'Title'], ['author', 'Autoría', 'Author'], ['editor', 'Edición', 'Editor'], ['translator', 'Traducción', 'Translator'],
  ['interviewer', 'Entrevista', 'Interviewer'], ['issued', 'Fecha', 'Date'], ['original-date', 'Fecha original', 'Original date'],
  ['publisher', 'Editorial', 'Publisher'], ['publisher-place', 'Lugar', 'Place'], ['container-title', 'Publicado en', 'Published in'],
  ['collection-title', 'Colección', 'Series'], ['volume', 'Volumen', 'Volume'], ['issue', 'Número', 'Issue'], ['page', 'Páginas', 'Pages'],
  ['edition', 'Edición', 'Edition'], ['DOI', 'DOI', 'DOI'], ['ISBN', 'ISBN', 'ISBN'], ['URL', 'URL', 'URL'], ['language', 'Lengua', 'Language'],
  ['type', 'Tipo CSL', 'CSL type'], ['abstract', 'Resumen', 'Abstract'],
];
// Claves de procedencia: las del CSL y las del legado (titulo, autores…).
const ALIAS: Record<string, string[]> = { title: ['titulo'], author: ['autores'], issued: ['anio', 'fecha'], 'original-date': ['anioOriginal'], publisher: ['editorial'], 'publisher-place': ['lugar'], edition: ['edicion'], language: ['idioma'], type: ['tipoCSL'], abstract: ['resumen'] };

const personas = (p?: PersonaCsl[]) => (p ?? []).map((x) => x.literal ?? [x.given, x.family].filter(Boolean).join(' ')).join('; ');
function valorCsl(m: MetadatosCsl, k: keyof MetadatosCsl): string {
  const v = m[k];
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return personas(v as PersonaCsl[]);
  if (typeof v === 'object' && v && 'date-parts' in (v as object)) return ((v as { 'date-parts': unknown[][] })['date-parts'][0] ?? []).join('-');
  if (typeof v === 'object') return (v as { literal?: string }).literal ?? JSON.stringify(v);
  return String(v);
}

function FichaCompleta({ id, resumen, alRevectorizar }: { id: string; resumen: Resumen; alRevectorizar: () => void }) {
  const { nucleo, lengua, entradas } = useApp();
  const { t } = useIdioma();
  const [informe, setInforme] = useState<InformeValidacion | null>(null);
  const [validando, setValidando] = useState(false);
  const [fases, setFases] = useState<Procedencia[] | null>(null);
  const [volcado, setVolcado] = useState<string | null>(null);
  const d = resumen.document;
  const m = d.metadata ?? ({ type: 'document' } as MetadatosCsl);
  const prov = m.spdf?.provenance ?? {};
  const entrada = entradas?.find((e) => e.id === id);

  useEffect(() => { void nucleo.procedencia(id).then(setFases).catch(() => setFases([])); }, [id, nucleo]);
  const validar = async () => { setValidando(true); try { setInforme(await nucleo.validar(id)); } finally { setValidando(false); } };
  useEffect(() => { void validar(); /* la validación es rápida: se hace al abrir la ficha */ }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fuenteDe = (k: string) => {
    const p = (prov as Record<string, { source?: string; fuente?: string; confidence?: number; confianza?: number }>)[k] ?? ALIAS[k]?.map((a) => (prov as Record<string, never>)[a]).find(Boolean) as { source?: string; fuente?: string; confidence?: number; confianza?: number } | undefined;
    if (!p) return null;
    const c = p.confidence ?? p.confianza;
    return `${p.source ?? p.fuente ?? ''}${c != null ? ` · ${Math.round(c * 100)} %` : ''}`;
  };

  return (
    <div>
      <section className="bloque">
        <h3>{t('metadatos')} <small>{t('procedenciaCampo')}</small></h3>
        <table className="tabla">
          <tbody>
            {CAMPOS.map(([k, es, en]) => {
              const v = valorCsl(m, k);
              if (!v) return null;
              const f = fuenteDe(k as string);
              return (
                <tr key={k as string}>
                  <th scope="row">{lengua === 'es' ? es : en}</th>
                  <td>{k === 'URL' || k === 'DOI' ? <a href={k === 'DOI' ? `https://doi.org/${v}` : v} target="_blank" rel="noreferrer noopener">{v}</a> : v}{f && <span className="fuente-campo">{f}</span>}</td>
                </tr>
              );
            })}
            {m.spdf?.undated && <tr><th scope="row">{t('sinFecha', { de: m.spdf.undated.from ?? '?', a: m.spdf.undated.to ?? '?' })}</th><td>{m.spdf.undated.basis}</td></tr>}
            {m.spdf?.original_language && <tr><th scope="row">{lengua === 'es' ? 'Lengua original' : 'Original language'}</th><td>{m.spdf.original_language}</td></tr>}
          </tbody>
        </table>
      </section>

      {d.rights && (
        <section className="bloque">
          <h3>{t('derechos')}</h3>
          <table className="tabla"><tbody>
            {Object.entries(d.rights).filter(([, v]) => v).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>)}
          </tbody></table>
        </section>
      )}

      <section className="bloque">
        <h3>{t('fichero')}</h3>
        <table className="tabla"><tbody>
          <tr><th scope="row">{t('version')}</th><td>SPDF {resumen.version}{resumen.legacy && <> · <span className="sello oro">{t('legado', { v: resumen.version })}</span></>}</td></tr>
          <tr><th scope="row">{t('perfil')}</th><td>{resumen.meta.profile ?? '—'}</td></tr>
          <tr><th scope="row">{t('tipo')}</th><td>{d.kind} · {d.mime}</td></tr>
          <tr><th scope="row">{t('unidades', { n: '' }).trim()}</th><td>{d.unit_count} · {resumen.fragmentos} fragmentos · {resumen.figuras} {t('figuras').toLowerCase()}</td></tr>
          {d.duration != null && <tr><th scope="row">{t('duracion')}</th><td>{reloj(d.duration)}</td></tr>}
          <tr><th scope="row">{t('generador')}</th><td className="mono">{resumen.meta.generator ?? resumen.meta.generador ?? '—'}</td></tr>
          <tr><th scope="row">{t('creado')}</th><td className="mono">{resumen.meta.created ?? d.created}</td></tr>
          <tr><th scope="row">{t('huella')}</th><td className="mono" style={{ fontSize: 11 }}>{d.source_sha256}</td></tr>
          {entrada && <tr><th scope="row">{t('bytes')}</th><td>{tamano(entrada.bytes, lengua)} · <span className="mono">{entrada.nombre}</span></td></tr>}
          {resumen.meta.license_note && <tr><th scope="row">{t('derechos')}</th><td>{resumen.meta.license_note}</td></tr>}
        </tbody></table>
      </section>

      <section className="bloque">
        <h3>{t('espacios')}</h3>
        {resumen.spaces.length === 0 ? <p className="apagado">{t('sinVectores')}</p> : (
          <table className="tabla"><tbody>
            {resumen.spaces.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="mono" style={{ color: 'var(--azul)' }}>{s.id}</th>
                <td>{s.provider} · {s.model}{s.version ? ` ${s.version}` : ''}<br />
                  <span className="apagado">{s.dims} {t('dimensiones')} · {s.dtype}{s.truncated_from ? ` · ${t('recortadoDe', { n: s.truncated_from })}` : ''}{s.normalized ? ` · ${t('normalizado')}` : ''} · {(s.modalities ?? []).join(', ')}</span></td>
              </tr>
            ))}
          </tbody></table>
        )}
        <button className="boton chico" style={{ marginTop: 10 }} onClick={alRevectorizar}><Vectores />{t('revectorizar')}</button>
      </section>

      <section className="bloque">
        <h3>{t('validacion')}</h3>
        {validando && <Progreso />}
        {informe && (
          <div>
            <p style={{ margin: '0 0 8px' }}><span className={`sello ${informe.valid ? 'azul' : 'rojo'}`}>{informe.valid ? t('valido') : t('invalido')}</span> <span className="mono apagado">{informe.version} · {informe.profile.join(' ')}</span></p>
            {[...informe.errors.map((e) => ({ ...e, g: 'e' })), ...informe.warnings.map((e) => ({ ...e, g: 'w' }))].map((e, i) => (
              <p key={i} style={{ margin: '4px 0', fontSize: 14 }}><span className={`sello ${e.g === 'e' ? 'rojo' : 'oro'}`}>{e.code}</span> {e.message}{e.where ? <span className="mono apagado"> · {e.where}</span> : null}</p>
            ))}
          </div>
        )}
        <button className="boton chico" onClick={validar} disabled={validando}>{t('validar')}</button>
      </section>

      {resumen.extensions.length > 0 && (
        <section className="bloque">
          <h3>{t('extensiones')}</h3>
          <ul>{resumen.extensions.map((x) => <li key={x.name} className="mono">{x.name} {x.version}{x.required ? ' (required)' : ''}</li>)}</ul>
        </section>
      )}

      <section className="bloque">
        <h3>{t('fases')}</h3>
        {!fases ? <Progreso /> : (
          <table className="tabla"><tbody>
            {fases.slice(0, 200).map((f, i) => (
              <tr key={i}><th scope="row">{f.stage}<span className="fuente-campo">{f.at}</span></th>
                <td>{[f.provider, f.model].filter(Boolean).join(' · ')}{f.ms != null && <span className="mono apagado"> · {(f.ms / 1000).toLocaleString(lengua, { maximumFractionDigits: 1 })} s</span>}</td></tr>
            ))}
          </tbody></table>
        )}
        {fases && fases.length > 200 && <p className="apagado">… {fases.length - 200}</p>}
      </section>

      <section className="bloque">
        <h3>{t('volcado')}</h3>
        {volcado ? <pre className="codigo">{volcado}</pre> : (
          <button className="boton chico" onClick={async () => {
            const v = await nucleo.volcado(id);
            const s = JSON.stringify(v, (k, x) => (k === 'text' && typeof x === 'string' && x.length > 240 ? `${x.slice(0, 240)}…` : x), 2);
            setVolcado(s.length > 400_000 ? `${s.slice(0, 400_000)}\n…` : s);
          }}>{t('verVolcado')}</button>
        )}
      </section>
    </div>
  );
}
