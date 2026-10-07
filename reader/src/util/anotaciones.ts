/**
 * Subrayados y notas del usuario, en el fichero hermano `.spdfa.json` (contrato
 * §9): una AnnotationCollection de W3C Web Annotation. Cada anotación apunta al
 * documento por su ancla (`SpdfAnchorSelector`, con `char=` exacto) y lleva
 * además un `TextQuoteSelector` por si el texto cambiara. Nunca se escribe
 * dentro del SPDF.
 */
export interface Anotacion {
  id: string;
  tipo: 'subrayado' | 'nota';
  unidad: string;          // units.id
  ord: number;             // units.ord (para ir rápido; se recalcula al cargar)
  desde: number;           // puntos de código en units.text (NFC)
  hasta: number;
  exacto: string;
  prefijo: string;
  sufijo: string;
  nota?: string;
  uri: string;             // URI de ancla con char=
  cita: string;            // cita corta en el momento de anotar
  creada: string;
}

export function aW3C(anots: Anotacion[], o: { titulo: string; docref: string; lengua: string; generador: string }): string {
  const items = anots.map((a) => ({
    id: `urn:uuid:${a.id}`,
    type: 'Annotation',
    motivation: a.tipo === 'nota' ? 'commenting' : 'highlighting',
    created: a.creada,
    ...(a.nota ? { body: { type: 'TextualBody', value: a.nota, format: 'text/plain', language: o.lengua } } : {}),
    target: {
      source: `spdf:${o.docref}`,
      selector: [
        { type: 'SpdfAnchorSelector', value: a.uri },
        { type: 'TextQuoteSelector', exact: a.exacto, prefix: a.prefijo, suffix: a.sufijo },
      ],
    },
    'spdf:unit': a.unidad,
    'spdf:citation': a.cita,
  }));
  return JSON.stringify({
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'AnnotationCollection',
    spdf_annotations: '1.0',
    label: o.titulo,
    generator: o.generador,
    total: items.length,
    first: { type: 'AnnotationPage', items },
  }, null, 2) + '\n';
}

interface Selector { type: string; value?: string; exact?: string; prefix?: string; suffix?: string }
interface ItemW3C {
  id?: string; motivation?: string; created?: string;
  body?: { value?: string } | { value?: string }[];
  target?: { selector?: Selector[] | Selector };
  'spdf:unit'?: string; 'spdf:citation'?: string;
}

/** Lee una colección (o una lista suelta de anotaciones). Las que no se pueden situar se devuelven aparte. */
export function deW3C(json: string): Anotacion[] {
  const d = JSON.parse(json) as { first?: { items?: ItemW3C[] }; items?: ItemW3C[] } | ItemW3C[];
  const items: ItemW3C[] = Array.isArray(d) ? d : d.first?.items ?? d.items ?? [];
  const out: Anotacion[] = [];
  for (const it of items) {
    const sels = Array.isArray(it.target?.selector) ? it.target!.selector : it.target?.selector ? [it.target.selector] : [];
    const anc = sels.find((s) => s.type === 'SpdfAnchorSelector');
    const quote = sels.find((s) => s.type === 'TextQuoteSelector');
    const ch = /[#&]char=(\d+),(\d+)/.exec(anc?.value ?? '');
    const body = Array.isArray(it.body) ? it.body[0] : it.body;
    out.push({
      id: (it.id ?? crypto.randomUUID()).replace(/^urn:uuid:/, ''),
      tipo: body?.value ? 'nota' : 'subrayado',
      unidad: it['spdf:unit'] ?? '',
      ord: 0,
      desde: ch ? Number(ch[1]) : -1,
      hasta: ch ? Number(ch[2]) : -1,
      exacto: quote?.exact ?? '',
      prefijo: quote?.prefix ?? '',
      sufijo: quote?.suffix ?? '',
      nota: body?.value,
      uri: anc?.value ?? '',
      cita: it['spdf:citation'] ?? '',
      creada: it.created ?? new Date().toISOString(),
    });
  }
  return out;
}

/** Parámetros de una URI de ancla que el lector necesita para situar algo (p, t, sl, char). */
export function paramsUri(uri: string): Record<string, string> {
  const frag = uri.split('#')[1] ?? '';
  const o: Record<string, string> = {};
  for (const p of frag.split('&')) { const [k, v = ''] = p.split('='); if (k) o[k] = decodeURIComponent(v); }
  return o;
}
