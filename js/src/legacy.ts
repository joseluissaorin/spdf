/**
 * Legacy SPDF 4.0/4.1 (Scholaris, Spanish identifiers) → the SPDF 5.0 view (contract §7).
 */

import type { Anchor, CslItem, CslName } from './types.js';
import { LEGACY_KIND, LEGACY_TARGET } from './schema.js';

const ANCHOR_TYPE: Record<string, string> = {
  pagina: 'page',
  tiempo: 'time',
  seccion: 'section',
  diapositiva: 'slide',
  hoja: 'sheet',
  web: 'web',
  imagen: 'image',
};

const ANCHOR_KEY: Record<string, string> = {
  tipo: 'type',
  fisica: 'physical',
  impresa: 'printed',
  romana: 'roman',
  origen: 'source',
  confianza: 'confidence',
  hablante: 'speaker',
  ruta: 'path',
  parrafo: 'paragraph',
  hoja: 'sheet',
  filaDesde: 'row_from',
  filaHasta: 'row_to',
  consultada: 'accessed',
  region: 'region',
};

const ANCHOR_SOURCE: Record<string, string> = { leido: 'read', deducido: 'inferred', epub: 'epub', ninguno: 'none' };

/** A legacy anchor object (already parsed) in its 5.0 form. */
export function mapLegacyAnchor(a: unknown): Anchor {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return a as Anchor;
  const src = a as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = ANCHOR_KEY[k] ?? k;
    let value = v;
    if (k === 'tipo' && typeof v === 'string') value = ANCHOR_TYPE[v] ?? v;
    else if (k === 'origen' && typeof v === 'string') value = ANCHOR_SOURCE[v] ?? v;
    out[key] = value;
  }
  return out as unknown as Anchor;
}

export function mapLegacyKind(kind: string): string {
  return LEGACY_KIND[kind] ?? kind;
}

export function mapLegacyTarget(target: string): string {
  return LEGACY_TARGET[target] ?? target;
}

// ---------------------------------------------------------------------------
// Metadata (MetadatosDocumento → CSL), contract §7 (same rules as conformance/tools/spdfref.py)
// ---------------------------------------------------------------------------

interface LegacyName {
  nombre?: unknown;
  apellidos?: unknown;
  orcid?: unknown;
}

const truthy = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && v !== 0 && v !== false;

/** Spanish metadata field → CSL field (keys of `spdf.provenance`). */
const LEGACY_FIELD: Record<string, string> = {
  titulo: 'title', subtitulo: 'subtitle', tituloOriginal: 'original-title', autores: 'author', editores: 'editor',
  traductores: 'translator', entrevistadores: 'interviewer', anio: 'issued', anioOriginal: 'original-date',
  editorial: 'publisher', lugar: 'publisher-place', revista: 'container-title', contenedor: 'container-title',
  coleccion: 'collection-title', volumen: 'volume', numero: 'issue', paginas: 'page', edicion: 'edition', doi: 'DOI',
  isbn: 'ISBN', url: 'URL', idioma: 'language', tipoCSL: 'type', resumen: 'abstract', idiomaOriginal: 'original_language',
  fecha: 'issued', sinFecha: 'undated',
};

const LEGACY_PROVENANCE_SOURCE: Record<string, string> = { lectura: 'reading', usuario: 'user', colofon: 'colophon', impresores: 'printers' };

function legacyNames(people: unknown): CslName[] {
  const out: CslName[] = [];
  for (const a of Array.isArray(people) ? (people as LegacyName[]) : []) {
    if (!a || typeof a !== 'object') continue;
    const n: CslName = {};
    if (truthy(a.apellidos)) n.family = a.apellidos as string;
    if (truthy(a.nombre)) n.given = a.nombre as string;
    if (Object.keys(n).length) out.push(n);
  }
  return out;
}

function dateParts(iso: string): number[] | null {
  const m = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(iso.trim());
  if (!m) return null;
  return [m[1], m[2], m[3]].filter((g): g is string => g !== undefined).map(Number);
}

/** CSL type for a legacy document without `tipoCSL` (`kind` = legacy `documentos.tipo`). */
export function legacyDefaultType(kind: string | undefined, m: Record<string, unknown>): string {
  if (truthy(m.tipoCSL)) return m.tipoCSL as string;
  if (truthy(m.revista)) return 'article-journal';
  const map: Record<string, string> = { audio: 'speech', video: 'motion_picture', web: 'webpage', presentacion: 'speech', hoja: 'dataset', imagen: 'graphic', fotos: 'graphic' };
  return (kind !== undefined ? map[kind] : undefined) ?? 'book';
}

/** Legacy `metadatos` (parsed) → a CSL-JSON item with the `spdf` extension. `legacyKind` = `documentos.tipo`. */
export function mapLegacyMetadata(raw: unknown, legacyKind?: string): CslItem {
  const m = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const has = (k: string): boolean => {
    const v = m[k];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  };
  const item: Record<string, unknown> = { type: legacyDefaultType(legacyKind, m) };
  const spdf: Record<string, unknown> = {};
  const title = truthy(m.titulo) ? m.titulo : '';
  if (has('subtitulo')) {
    item.title = `${String(title)}: ${String(m.subtitulo)}`;
    item['title-short'] = title;
    spdf.subtitle = m.subtitulo;
  } else {
    item.title = title;
  }
  if (has('tituloOriginal')) item['original-title'] = m.tituloOriginal;
  const orcid: Record<string, unknown> = {};
  for (const [src, dst] of [['autores', 'author'], ['editores', 'editor'], ['traductores', 'translator'], ['entrevistadores', 'interviewer']] as const) {
    const names = legacyNames(m[src]);
    if (names.length) item[dst] = names;
    for (const a of Array.isArray(m[src]) ? (m[src] as LegacyName[]) : []) {
      if (a && typeof a === 'object' && truthy(a.orcid)) {
        const key = String(a.apellidos ?? '') + (truthy(a.nombre) ? `, ${String(a.nombre)}` : '');
        orcid[key] = a.orcid;
      }
    }
  }
  const fecha = has('fecha') && typeof m.fecha === 'string' ? dateParts(m.fecha) : null;
  if (fecha && (!has('anio') || fecha[0] === m.anio)) item.issued = { 'date-parts': [fecha] };
  else if (has('anio')) item.issued = { 'date-parts': [[m.anio]] };
  if (has('anioOriginal')) item['original-date'] = { 'date-parts': [[m.anioOriginal]] };
  const simple: Array<[string, string]> = [
    ['editorial', 'publisher'], ['lugar', 'publisher-place'], ['coleccion', 'collection-title'], ['volumen', 'volume'],
    ['numero', 'issue'], ['paginas', 'page'], ['edicion', 'edition'], ['doi', 'DOI'], ['isbn', 'ISBN'], ['url', 'URL'],
    ['idioma', 'language'], ['resumen', 'abstract'],
  ];
  for (const [src, dst] of simple) if (has(src)) item[dst] = m[src];
  if (has('revista')) item['container-title'] = m.revista;
  else if (has('contenedor')) item['container-title'] = m.contenedor;
  if (has('idiomaOriginal')) spdf.original_language = m.idiomaOriginal;
  if (has('sinFecha')) {
    const sf = (m.sinFecha && typeof m.sinFecha === 'object' ? m.sinFecha : {}) as Record<string, unknown>;
    const u: Record<string, unknown> = {};
    if (sf.desde !== undefined && sf.desde !== null) u.from = sf.desde;
    if (sf.hasta !== undefined && sf.hasta !== null) u.to = sf.hasta;
    if (truthy(sf.fundamento)) u.basis = sf.fundamento;
    spdf.undated = u;
  }
  if (has('procedencia') && m.procedencia && typeof m.procedencia === 'object') {
    const prov: Record<string, unknown> = {};
    for (const [campo, v] of Object.entries(m.procedencia as Record<string, unknown>)) {
      const key = LEGACY_FIELD[campo] ?? campo;
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const fuente = o.fuente;
      prov[key] = {
        source: typeof fuente === 'string' ? (LEGACY_PROVENANCE_SOURCE[fuente] ?? fuente) : (fuente ?? null),
        confidence: o.confianza ?? null,
      };
    }
    spdf.provenance = prov;
  }
  if (Object.keys(orcid).length) spdf.orcid = orcid;
  if (Object.keys(spdf).length) item.spdf = spdf;
  return item as CslItem;
}

/** Legacy modality names → 5.0 (`texto` → `text`…). */
export function mapLegacyModalities(m: unknown): unknown {
  const map: Record<string, string> = { texto: 'text', imagen: 'image', audio: 'audio', video: 'video', pdf: 'pdf' };
  return Array.isArray(m) ? m.map((x) => (typeof x === 'string' ? (map[x] ?? x) : x)) : m;
}

/** Legacy `spdf` table keys → 5.0 `spdf_meta` keys. */
export function mapLegacyMetaKey(key: string): string {
  return key === 'creado' ? 'created' : key === 'generador' ? 'generator' : key;
}
