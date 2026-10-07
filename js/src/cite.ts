/**
 * Short author-date citation (contract §10): `(names, year[, locator])`.
 */

import type { Anchor, CslItem, CslName, DocumentRecord } from './types.js';

type Lang = 'es' | 'en';

const T = {
  es: { and: 'y', nd: 's. f.', np: 's. p.', slide: 'diap.', rows: 'filas', para: 'párr.', bc: 'a. C.' },
  en: { and: 'and', nd: 'n.d.', np: 'n. pag.', slide: 'slide', rows: 'rows', para: 'para.', bc: 'BC' },
} as const;

function lang(locale: string | undefined): Lang {
  return (locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
}

/** Name as cited: `literal`, or [non-dropping particle + space] + family, or given. */
export function citedName(n: CslName): string {
  if (n.literal) return n.literal;
  if (n.family) return n['non-dropping-particle'] ? `${n['non-dropping-particle']} ${n.family}` : n.family;
  return n.given ?? '';
}

/** Short title: `title-short`, or the title up to the first colon (trimmed). */
export function shortTitle(m: CslItem): string {
  const ts = m['title-short'];
  if (typeof ts === 'string' && ts.trim()) return ts.trim();
  const t = typeof m.title === 'string' ? m.title : '';
  const i = t.indexOf(':');
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

/** Spanish «y» becomes «e» before the sound /i/ (i-, í-, hi-, hí- not followed by a vowel). */
function startsWithISound(word: string): boolean {
  const w = word.toLowerCase();
  const m = /^h?[ií](.?)/u.exec(w);
  if (!m) return false;
  return !/^[aeiouáéíóúü]$/u.test(m[1] ?? '');
}

export function namesPart(m: CslItem, locale: string = 'es'): string {
  const l = lang(locale);
  const names = (Array.isArray(m.author) ? m.author : []).map(citedName).filter((x) => x !== '');
  if (names.length === 0) return shortTitle(m);
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) {
    const b = names[1] as string;
    const and = l === 'es' && startsWithISound(b) ? 'e' : T[l].and;
    return `${names[0]} ${and} ${b}`;
  }
  return `${names[0]} et al.`;
}

export function yearPart(m: CslItem, locale: string = 'es'): string {
  const l = lang(locale);
  const y = m.issued?.['date-parts']?.[0]?.[0];
  const n = typeof y === 'number' ? y : typeof y === 'string' && /^-?\d+$/.test(y.trim()) ? Number(y) : null;
  if (n === null) return T[l].nd;
  return n < 0 ? `${-n} ${T[l].bc}` : String(n);
}

/** `h:mm:ss` from one hour, else `m:ss`; seconds floored. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

type PageLike = { printed?: string | null | undefined; source?: string | undefined; foliation?: string | undefined };

function folio(a: PageLike): string | null {
  if (a.printed === null || a.printed === undefined || a.printed === '') return null;
  return a.source === 'inferred' ? `[${a.printed}]` : a.printed;
}

function pageLocator(a: PageLike, end: PageLike | null, l: Lang): string {
  const first = folio(a);
  if (first === null) return T[l].np;
  const [one, many] = a.foliation === 'leaf' ? ['fol.', 'fols.'] : a.foliation === 'column' ? ['col.', 'cols.'] : ['p.', 'pp.'];
  if (end && end.printed !== null && end.printed !== undefined && end.printed !== '' && end.printed !== a.printed) {
    return `${many} ${first}-${folio(end)}`;
  }
  return `${one} ${first}`;
}

/** The locator of a citation (`p. 145`, `1:09:20`, `diap. 3`…), or '' if there is none. */
export function locator(anchor: Anchor, locale: string = 'es', anchorEnd?: Anchor | null): string {
  const l = lang(locale);
  const t = T[l];
  const end = anchorEnd ?? null;
  switch (anchor.type) {
    case 'page':
      return pageLocator(anchor, end && end.type === 'page' ? end : null, l);
    case 'time': {
      const a = formatTime(anchor.t0);
      if (end && end.type === 'time') return `${a}-${formatTime(end.t1 ?? end.t0)}`;
      return a;
    }
    case 'section':
    case 'web': {
      const printed = 'printed' in anchor ? (anchor as { printed?: string | null }).printed : null;
      if (printed !== null && printed !== undefined && printed !== '') {
        const endPrinted = end && 'printed' in end ? (end as { printed?: string | null }).printed : null;
        return pageLocator({ printed }, endPrinted ? { printed: endPrinted } : null, l);
      }
      const path = anchor.path ?? [];
      const last = path[path.length - 1];
      const para = anchor.paragraph !== undefined && anchor.paragraph !== null ? `${t.para} ${anchor.paragraph}` : '';
      if (last !== undefined) return para ? `§ ${last}, ${para}` : `§ ${last}`;
      return para;
    }
    case 'slide':
      return `${t.slide} ${anchor.n}`;
    case 'sheet':
      return `${anchor.sheet}, ${t.rows} ${anchor.row_from}-${anchor.row_to}`;
    case 'verse': {
      const to = anchor.line_to;
      return to !== undefined && to !== null && to !== anchor.line_from ? `vv. ${anchor.line_from}-${to}` : `v. ${anchor.line_from}`;
    }
    case 'canonical':
      return anchor.ref;
    case 'image':
      return '';
    default:
      return '';
  }
}

/**
 * `(Family, Year, locator)` for an anchor of a document. `document` may be the document
 * row or its CSL metadata. Locales other than `es` fall back to `en`.
 */
export function cite(anchor: Anchor, document: DocumentRecord | CslItem, locale: string = 'es', anchorEnd?: Anchor | null): string {
  const isRow = (d: DocumentRecord | CslItem): d is DocumentRecord =>
    'metadata' in d && typeof (d as DocumentRecord).metadata === 'object' && (d as DocumentRecord).metadata !== null && 'source_sha256' in d;
  const m: CslItem = isRow(document) ? document.metadata : document;
  const parts = [namesPart(m, locale), yearPart(m, locale)];
  const loc = locator(anchor, locale, anchorEnd);
  if (loc) parts.push(loc);
  return `(${parts.join(', ')})`;
}
