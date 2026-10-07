/**
 * La capa de texto de una unidad: lo que el lector de pantalla lee de un libro
 * escaneado. Cada párrafo es un pasaje citable (su fragmento), con su manícula
 * para copiar la cita; los términos buscados y los subrayados van marcados; y
 * una selección del usuario se traduce a `chars` exactos del ancla.
 */
import { Fragment, memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Fragmento, Unidad } from '../nucleo/tipos';
import { bloques, cpAUtf16, localizar, marcasDeTerminos, patronTerminos, trocear, type Marca } from '../util/texto';
import type { Anotacion } from '../util/anotaciones';
import { Manicula } from '../componentes/Iconos';
import { useIdioma } from '../i18n';

export interface PropsHoja {
  unidad: Unidad;
  fragmentos: Fragmento[];
  anotaciones: Anotacion[];
  consulta?: string;
  destacado?: string | null;
  lengua?: string | null;
  alCitarPasaje: (f: Fragmento) => void;
  alClicAnotacion?: (a: Anotacion) => void;
}

export const Hoja = memo(function Hoja({ unidad, fragmentos, anotaciones, consulta, destacado, lengua, alCitarPasaje, alClicAnotacion }: PropsHoja) {
  const { t } = useIdioma();
  const texto = unidad.text ?? '';
  const ref = useRef<HTMLElement>(null);

  const bl = useMemo(() => bloques(texto), [texto]);

  // Dónde cae cada fragmento en el texto (UTF-16).
  const rangos = useMemo(() => fragmentos.map((f) => {
    const ch = f.unit === unidad.id ? f.anchor?.chars : undefined;
    if (ch) return { f, a: cpAUtf16(texto, ch[0]), b: cpAUtf16(texto, ch[1]) };
    const l = localizar(texto, f.text);
    return { f, a: l?.[0] ?? -1, b: l?.[1] ?? -1 };
  }).filter((r) => r.a >= 0), [fragmentos, texto, unidad.id]);

  const marcas = useMemo<Marca[]>(() => {
    const m = marcasDeTerminos(texto, patronTerminos(consulta ?? ''));
    for (const a of anotaciones) {
      if (a.unidad !== unidad.id || a.desde < 0) continue;
      m.push({ desde: cpAUtf16(texto, a.desde), hasta: cpAUtf16(texto, a.hasta), clase: 'subrayado', id: a.id, titulo: a.nota });
    }
    return m;
  }, [texto, consulta, anotaciones, unidad.id]);

  // Cada bloque pertenece al fragmento que lo contiene (o al primero que lo pisa).
  const fragDe = (a: number, b: number) =>
    rangos.find((r) => r.a <= a && r.b > a)?.f ?? rangos.find((r) => r.a < b && r.b > a)?.f ?? null;

  useEffect(() => {
    if (!destacado) return;
    const el = ref.current?.querySelector(`[data-fragmento="${CSS.escape(destacado)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [destacado, unidad.id]);

  const pintar = (a: number, b: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const p of trocear(a, b, marcas)) {
      // Los saltos de línea simples se conservan (en verso importan).
      const partes = texto.slice(p.desde, p.hasta).split('\n');
      let o = p.desde;
      partes.forEach((s, i) => {
        if (i > 0) out.push(<br key={`br${o}`} />);
        if (s) {
          let nodo: ReactNode = <span data-o={o}>{s}</span>;
          for (const m of p.marcas) {
            nodo = m.clase === 'subrayado'
              ? <mark className="subrayado" data-anotacion={m.id} data-nota={m.titulo ? '' : undefined} title={m.titulo}
                  onClick={alClicAnotacion ? () => { const an = anotaciones.find((x) => x.id === m.id); if (an) alClicAnotacion(an); } : undefined}>{nodo}</mark>
              : <mark>{nodo}</mark>;
          }
          out.push(<Fragment key={`t${o}`}>{nodo}</Fragment>);
        }
        o += s.length + 1;
      });
    }
    return out;
  };

  const pintarBloque = (bq: (typeof bl)[number]) => {
    const hijos = bq.tramos.map((tr) => {
      const c = pintar(tr.desde, tr.hasta);
      return tr.strong ? <strong key={tr.desde}>{c}</strong> : tr.em ? <em key={tr.desde}>{c}</em> : <Fragment key={tr.desde}>{c}</Fragment>;
    });
    if (bq.tipo === 'h') return bq.nivel && bq.nivel <= 2 ? <h2>{hijos}</h2> : <h3>{hijos}</h3>;
    if (bq.tipo === 'cita') return <blockquote>{hijos}</blockquote>;
    return <p>{hijos}</p>;
  };

  if (!texto.trim()) return <p className="apagado" style={{ fontStyle: 'italic' }}>{t('sinTexto')}</p>;

  return (
    <article ref={ref} lang={lengua ?? undefined} data-unidad={unidad.id}>
      {bl.map((bq) => {
        const f = fragDe(bq.desde, bq.hasta);
        return (
          <div key={bq.desde} className={`pasaje${f && f.id === destacado ? ' destacado' : ''}`} data-fragmento={f?.id}>
            {f && (
              <button className="citar-pasaje" onClick={() => alCitarPasaje(f)} aria-label={t('citarPasaje')} title={t('citarPasaje')}>
                <Manicula />
              </button>
            )}
            {pintarBloque(bq)}
          </div>
        );
      })}
    </article>
  );
});
