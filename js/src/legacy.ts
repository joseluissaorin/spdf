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
// Metadata (MetadatosDocumento → CSL), contract §7
// ---------------------------------------------------------------------------

interface LegacyName {
  nombre?: string;
  apellidos?: string;
  orcid?: string;
}

function names(list: unknown, orcid?: Record<string, string>): CslName[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const out: CslName[] = [];
  for (const raw of list as LegacyName[]) {
    if (!raw || typeof raw !== 'object') continue;
    const n: CslName = {};
    const family = typeof raw.apellidos === 'string' ? raw.apellidos.trim() : '';
    const given = typeof raw.nombre === 'string' ? raw.nombre.trim() : '';
    if (family) n.family = family;
    if (given) n.given = given;
    if (!family && !given) continue;
    out.push(n);
    if (orcid && typeof raw.orcid === 'string' && raw.orcid.trim()) {
      orcid[family && given ? `${family}, ${given}` : family || given] = raw.orcid.trim();
    }
  }
  return out.length ? out : undefined;
}

function yearOf(y: unknown): number | undefined {
  if (typeof y === 'number' && Number.isInteger(y)) return y;
  if (typeof y === 'string' && /^-?\d+$/.test(y.trim())) return Number(y.trim());
  return undefined;
}

function isoParts(s: unknown): number[] | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(s.trim());
  if (!m) return undefined;
  const parts: number[] = [Number(m[1])];
  if (m[2]) parts.push(Number(m[2]));
  if (m[3]) parts.push(Number(m[3]));
  return parts;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** CSL type when the legacy metadata has no `tipoCSL` (contract §7). `kind` is the legacy `tipo`. */
export function defaultCslType(legacyKind: string | undefined, hasJournal: boolean): string {
  switch (legacyKind) {
    case 'audio':
      return 'speech';
    case 'video':
      return 'motion_picture';
    case 'web':
      return 'webpage';
    case 'presentacion':
    case 'slides':
      return 'speech';
    case 'hoja':
    case 'sheet':
      return 'dataset';
    case 'imagen':
    case 'fotos':
    case 'image':
    case 'photos':
      return 'graphic';
    default:
      return hasJournal ? 'article-journal' : 'book';
  }
}

/** Legacy `metadatos` (parsed) → a CSL-JSON item with the `spdf` extension. `legacyKind` = `documentos.tipo`. */
export function mapLegacyMetadata(raw: unknown, legacyKind?: string): CslItem {
  const m = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const spdf: Record<string, unknown> = {};
  const orcid: Record<string, string> = {};
  const title = str(m.titulo) ?? '';
  const subtitle = str(m.subtitulo);
  const journal = str(m.revista);
  const item: CslItem = {
    type: str(m.tipoCSL) ?? defaultCslType(legacyKind, journal !== undefined),
    title: subtitle ? `${title}: ${subtitle}` : title,
  };
  if (subtitle) {
    if (title) item['title-short'] = title;
    spdf.subtitle = subtitle;
  }
  const set = (k: string, v: unknown) => {
    if (v !== undefined) item[k] = v;
  };
  set('original-title', str(m.tituloOriginal));
  set('author', names(m.autores, orcid));
  set('editor', names(m.editores));
  set('translator', names(m.traductores));
  set('interviewer', names(m.entrevistadores));
  const anio = yearOf(m.anio);
  const fecha = isoParts(m.fecha);
  if (fecha && (anio === undefined || fecha[0] === anio)) item.issued = { 'date-parts': [fecha] };
  else if (anio !== undefined) item.issued = { 'date-parts': [[anio]] };
  const original = yearOf(m.anioOriginal);
  if (original !== undefined) item['original-date'] = { 'date-parts': [[original]] };
  set('publisher', str(m.editorial));
  set('publisher-place', str(m.lugar));
  set('container-title', journal ?? str(m.contenedor));
  set('collection-title', str(m.coleccion));
  set('volume', str(m.volumen));
  set('issue', str(m.numero));
  set('page', str(m.paginas));
  set('edition', str(m.edicion));
  set('DOI', str(m.doi));
  set('ISBN', str(m.isbn));
  set('URL', str(m.url));
  set('language', str(m.idioma));
  set('abstract', str(m.resumen));
  const originalLanguage = str(m.idiomaOriginal);
  if (originalLanguage) spdf.original_language = originalLanguage;
  if (Object.keys(orcid).length) spdf.orcid = orcid;
  const sf = m.sinFecha as { desde?: unknown; hasta?: unknown; fundamento?: unknown } | undefined;
  if (sf && typeof sf === 'object') {
    const u: Record<string, unknown> = {};
    if (sf.desde !== undefined && sf.desde !== null) u.from = sf.desde;
    if (sf.hasta !== undefined && sf.hasta !== null) u.to = sf.hasta;
    if (sf.fundamento !== undefined && sf.fundamento !== null) u.basis = sf.fundamento;
    spdf.undated = u;
  }
  const proc = m.procedencia as Record<string, unknown> | undefined;
  if (proc && typeof proc === 'object' && !Array.isArray(proc)) {
    const p: Record<string, unknown> = {};
    for (const [field, v] of Object.entries(proc)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const e: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(o)) e[k === 'fuente' ? 'source' : k === 'confianza' ? 'confidence' : k] = x;
        p[field] = e;
      } else {
        p[field] = v;
      }
    }
    if (Object.keys(p).length) spdf.provenance = p;
  }
  if (Object.keys(spdf).length) item.spdf = spdf;
  return item;
}

/** Legacy `spdf` table keys → 5.0 `spdf_meta` keys. */
export function mapLegacyMetaKey(key: string): string {
  return key === 'creado' ? 'created' : key === 'generador' ? 'generator' : key;
}
