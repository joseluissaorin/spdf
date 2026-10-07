/**
 * La referencia completa en APA 7 o Chicago autor-fecha, con citeproc-js y los
 * estilos oficiales de CSL (public/csl/). Se carga solo cuando se pide: pesa
 * unos cientos de KB y la mayoría de las veces basta con la cita corta.
 */
import type { MetadatosCsl } from '../nucleo/tipos';

const base = import.meta.env.BASE_URL ?? './';
const cache = new Map<string, Promise<string>>();
const xml = (f: string) => {
  let p = cache.get(f);
  if (!p) { p = fetch(`${base}csl/${f}`).then((r) => { if (!r.ok) throw new Error(f); return r.text(); }); cache.set(f, p); }
  return p;
};

export type Estilo = 'apa' | 'chicago-author-date';

export async function referenciaFormateada(item: MetadatosCsl & { id?: string }, estilo: Estilo, lengua: 'es' | 'en'): Promise<{ html: string; texto: string }> {
  const [{ default: CSL }, estiloXml, loc] = await Promise.all([
    import('citeproc') as Promise<{ default: any }>,
    xml(`${estilo}.csl`),
    xml(lengua === 'es' ? 'locales-es-ES.xml' : 'locales-en-US.xml'),
  ]);
  const id = item.id ?? 'doc';
  const limpio: Record<string, unknown> = { ...item, id };
  delete limpio.spdf;
  const sys = {
    retrieveLocale: () => loc,
    retrieveItem: () => limpio,
  };
  const motor = new CSL.Engine(sys, estiloXml, lengua === 'es' ? 'es-ES' : 'en-US', true);
  motor.updateItems([id]);
  const [, html] = motor.makeBibliography() as [unknown, string[]];
  motor.setOutputFormat('text');
  motor.updateItems([id]);
  const [, texto] = motor.makeBibliography() as [unknown, string[]];
  return { html: (html[0] ?? '').trim(), texto: (texto[0] ?? '').trim() };
}
