/**
 * Short author-date citation (contract §10): `(names, year[, locator])`, locales `es`
 * and `en` (any other locale falls back to `en`). Same rules as the reference oracle.
 */

import type { Anchor, CslItem, CslName, DocumentRecord } from './types.js';

const VOWELS = new Set('aeiouáéíóúü');

const isEs = (locale: string | undefined): boolean => (locale ?? '').split('-')[0]?.toLowerCase() === 'es';
const has = (v: unknown): boolean => v !== undefined && v !== null;
const truthy = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && v !== 0 && v !== false;

/** Name as cited: `literal`, or [non-dropping particle + space] + family, or given. */
export function citedName(n: CslName): string {
  if (truthy(n.literal)) return n.literal as string;
  if (truthy(n.family)) {
    const ndp = n['non-dropping-particle'];
    return (truthy(ndp) ? `${ndp} ` : '') + (n.family as string);
  }
  return n.given ?? '';
}

/** Short title: `title-short`, or the title up to the first colon (trimmed). */
export function shortTitle(m: CslItem): string {
  if (truthy(m['title-short'])) return String(m['title-short']);
  const t = truthy(m.title) ? String(m.title) : '';
  return (t.split(':')[0] ?? '').trim();
}

/** Spanish «y» becomes «e» before the sound /i/: i-, í-, hi-, hí- not followed by a vowel. */
export function startsWithISound(s: string): boolean {
  const low = s.toLowerCase();
  const chars = Array.from(low);
  let rest: string[];
  const two = chars.slice(0, 2).join('');
  if (two === 'hi' || two === 'hí') rest = chars.slice(2);
  else if (chars[0] === 'i' || chars[0] === 'í') rest = chars.slice(1);
  else return false;
  return !(rest.length > 0 && VOWELS.has(rest[0] as string));
}

export function namesPart(m: CslItem, locale: string = 'es'): string {
  const es = isEs(locale);
  const names = (Array.isArray(m.author) ? m.author : []).map(citedName).filter((n) => n !== '');
  if (names.length === 0) return shortTitle(m);
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) {
    const conj = es ? (startsWithISound(names[1] as string) ? ' e ' : ' y ') : ' and ';
    return `${names[0]}${conj}${names[1]}`;
  }
  return `${names[0]} et al.`;
}

export function yearPart(m: CslItem, locale: string = 'es'): string {
  const es = isEs(locale);
  const issued = m.issued;
  const dp = issued && typeof issued === 'object' ? issued['date-parts'] : undefined;
  const first = Array.isArray(dp) && Array.isArray(dp[0]) && dp[0].length ? dp[0][0] : undefined;
  if (first !== undefined && first !== null && `${first}`.trim() !== '' && Number.isFinite(Number(first))) {
    const y = Math.trunc(Number(first));
    return y > 0 ? String(y) : es ? `${-y} a. C.` : `${-y} BC`;
  }
  return es ? 's. f.' : 'n.d.';
}

/** `h:mm:ss` from one hour, else `m:ss`; seconds floored. */
export function formatTime(t: number): string {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

type Loose = Record<string, unknown>;

function pageLocator(anchor: Loose, end: Loose | null, es: boolean, single: string, plural: string): string {
  const lab = (a: Loose): string | null => {
    if (!has(a.printed)) return null;
    return a.source === 'inferred' ? `[${String(a.printed)}]` : String(a.printed);
  };
  const a = lab(anchor);
  if (a === null) return es ? 's. p.' : 'n. pag.';
  if (end && end.type === anchor.type) {
    const b = lab(end);
    if (b !== null && end.printed !== anchor.printed) return `${plural} ${a}-${b}`;
  }
  return `${single} ${a}`;
}

/** The locator of a citation (`p. 145`, `1:09:20`, `diap. 3`…), or null if there is none. */
export function locator(anchor: Anchor, locale: string = 'es', anchorEnd?: Anchor | null): string | null {
  const es = isEs(locale);
  const a = anchor as unknown as Loose;
  const end = (anchorEnd ?? null) as unknown as Loose | null;
  switch (a.type) {
    case 'page': {
      const fol = (a.foliation ?? 'page') as string;
      const single = ({ page: 'p.', leaf: 'fol.', column: 'col.' } as Record<string, string>)[fol] ?? 'p.';
      const plural = ({ page: 'pp.', leaf: 'fols.', column: 'cols.' } as Record<string, string>)[fol] ?? 'pp.';
      return pageLocator(a, end, es, single, plural);
    }
    case 'time': {
      let s = formatTime(a.t0 as number);
      if (end && end.type === 'time') s += `-${formatTime(end.t1 as number)}`;
      return s;
    }
    case 'section':
    case 'web': {
      if (has(a.printed)) return pageLocator(a, end, es, 'p.', 'pp.');
      const parts: string[] = [];
      const path = a.path as string[] | undefined;
      if (Array.isArray(path) && path.length) parts.push(`§ ${path[path.length - 1]}`);
      if (has(a.paragraph)) parts.push(`${es ? 'párr.' : 'para.'} ${String(a.paragraph)}`);
      return parts.length ? parts.join(', ') : null;
    }
    case 'slide':
      return `${es ? 'diap.' : 'slide'} ${String(a.n)}`;
    case 'sheet': {
      const from = a.row_from;
      const to = a.row_to;
      if (from === to) return `${String(a.sheet)}, ${es ? 'fila' : 'row'} ${String(from)}`;
      return `${String(a.sheet)}, ${es ? 'filas' : 'rows'} ${String(from)}-${String(to)}`;
    }
    case 'verse': {
      const b = a.line_to;
      return !has(b) || b === a.line_from ? `v. ${String(a.line_from)}` : `vv. ${String(a.line_from)}-${String(b)}`;
    }
    case 'canonical':
      return String(a.ref);
    default:
      return null;
  }
}

/**
 * `(Family, Year, locator)` for an anchor of a document. `document` may be the document
 * row or its CSL metadata.
 */
export function cite(anchor: Anchor, document: DocumentRecord | CslItem, locale: string = 'es', anchorEnd?: Anchor | null): string {
  const isRow = 'source_sha256' in document && typeof (document as DocumentRecord).metadata === 'object' && (document as DocumentRecord).metadata !== null;
  const m: CslItem = isRow ? (document as DocumentRecord).metadata : (document as CslItem);
  const parts = [namesPart(m, locale), yearPart(m, locale)];
  const loc = locator(anchor, locale, anchorEnd);
  if (loc) parts.push(loc);
  return `(${parts.join(', ')})`;
}
