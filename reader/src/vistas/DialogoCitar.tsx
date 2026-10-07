/**
 * Citar: la cita corta con folio de la página en la que estás y la referencia
 * completa en el formato que pidas (APA y Chicago por citeproc; CSL-JSON y
 * BibTeX tal como los exporta la biblioteca SPDF). Cada cosa se copia con un clic.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma } from '../i18n';
import type { Resumen, Unidad } from '../nucleo/tipos';
import { Dialogo } from '../componentes/Dialogo';
import { Copiar, Hecho } from '../componentes/Iconos';
import { copiar } from '../util/portapapeles';
import { sanear } from '../util/sanear';

type Formato = 'apa' | 'chicago-author-date' | 'csl' | 'bibtex';

export function DialogoCitar({ id, resumen, unidad, alCerrar }: { id: string; resumen: Resumen; unidad: Unidad | null; alCerrar: () => void }) {
  const { nucleo, lengua } = useApp();
  const { t } = useIdioma();
  const [cita, setCita] = useState('');
  const [uri, setUri] = useState('');
  const [formato, setFormato] = useState<Formato>(() => (localStorage.getItem('spdf-lector:formato') as Formato) || 'apa');
  const [salida, setSalida] = useState<{ texto: string; html?: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    if (!unidad) return;
    void nucleo.citar(id, unidad.anchor, lengua).then(setCita);
    void nucleo.uriAncla(id, unidad.anchor).then(setUri);
  }, [id, unidad, nucleo, lengua]);

  useEffect(() => {
    let vivo = true;
    setSalida(null);
    localStorage.setItem('spdf-lector:formato', formato);
    (async () => {
      if (formato === 'csl' || formato === 'bibtex') return { texto: await nucleo.referencia(id, formato) };
      const { referenciaFormateada } = await import('../util/citeproc');
      return referenciaFormateada({ ...resumen.document.metadata, id: resumen.document.id }, formato, lengua);
    })().then((s) => vivo && setSalida(s)).catch((e) => vivo && setSalida({ texto: String(e) }));
    return () => { vivo = false; };
  }, [formato, id, nucleo, resumen, lengua]);

  const hacerCopia = async (k: string, texto: string, html?: string) => {
    if (await copiar(texto, html)) { setCopiado(k); setTimeout(() => setCopiado(null), 1600); }
  };
  const B = ({ k, texto, html }: { k: string; texto: string; html?: string }) => (
    <button className="boton chico" onClick={() => hacerCopia(k, texto, html)} aria-label={`${t('copiar')}: ${k}`}>
      {copiado === k ? <><Hecho />{t('copiado')}</> : <><Copiar />{t('copiar')}</>}
    </button>
  );

  return (
    <Dialogo titulo={t('citar')} abierto alCerrar={alCerrar} ancho={640}>
      <section>
        <div className="etiqueta" style={{ marginBottom: 6 }}>{t('citaCorta')}</div>
        <p className="cita-grande" aria-live="polite">{cita || '…'}</p>
        <div style={{ marginTop: 8 }}><B k={t('citaCorta')} texto={cita} /></div>
      </section>
      <section>
        <div className="etiqueta" style={{ marginBottom: 6 }}>{t('referencia')}</div>
        <div className="segmentado" role="group" aria-label={t('estilo')} style={{ marginBottom: 10 }}>
          {([['apa', t('apa')], ['chicago-author-date', t('chicago')], ['csl', t('cslJson')], ['bibtex', t('bibtex')]] as [Formato, string][]).map(([k, n]) => (
            <button key={k} aria-pressed={formato === k} onClick={() => setFormato(k)}>{n}</button>
          ))}
        </div>
        <div className="salida-cita">
          {salida?.html
            ? <div className="codigo" style={{ fontFamily: 'var(--serif)', fontSize: 16, padding: 12, background: 'var(--papel-2)', border: '1px solid var(--filete)' }} dangerouslySetInnerHTML={{ __html: sanear(salida.html) }} />
            : <pre className="codigo">{salida?.texto ?? '…'}</pre>}
        </div>
        {salida && <div style={{ marginTop: 8 }}><B k={t('referencia')} texto={salida.texto} html={salida.html} /></div>}
      </section>
      <section>
        <div className="etiqueta" style={{ marginBottom: 6 }}>{t('uriAncla')}</div>
        <pre className="codigo" style={{ maxHeight: 80 }}>{uri}</pre>
        <div style={{ marginTop: 8 }}><B k="URI" texto={uri} /></div>
      </section>
    </Dialogo>
  );
}
