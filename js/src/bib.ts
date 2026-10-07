/**
 * Bibliography export (SPEC §19): CSL-JSON (Zotero, citeproc, Pandoc) and BibTeX.
 * Exports never invent data: fields absent from the file are absent from the export.
 *
 * - CSL-JSON: the metadata item without its `spdf` member, `id` = the BibTeX key;
 *   `cslCitationItem` adds the CSL `locator` and `label` of an anchor.
 * - BibTeX: entry type from the CSL type; key = first author's family name (or the first
 *   word of the title) folded to ASCII letters and lowercased, plus the year (or `nd`);
 *   collisions inside one export get `a`, `b`, `c`…
 */

import type { Anchor, CslItem, CslName, DocumentRecord } from './types.js';
import { formatTime } from './cite.js';

type Source = DocumentRecord | CslItem;

function metadataOf(d: Source): CslItem {
  return 'source_sha256' in d && d.metadata && typeof d.metadata === 'object' ? (d as DocumentRecord).metadata : (d as CslItem);
}

const BIBTEX_TYPES: Record<string, string> = {
  book: 'book',
  'article-journal': 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  chapter: 'incollection',
  'paper-conference': 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
};

const SIMPLE_FIELDS: Array<[string, string]> = [
  ['publisher', 'publisher'],
  ['publisher-place', 'address'],
  ['collection-title', 'series'],
  ['volume', 'volume'],
  ['issue', 'number'],
  ['page', 'pages'],
  ['edition', 'edition'],
  ['DOI', 'doi'],
  ['ISBN', 'isbn'],
  ['URL', 'url'],
  ['language', 'language'],
  ['note', 'note'],
];

function asciiLetters(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase();
}

function yearOf(m: CslItem): string | null {
  const y = m.issued?.['date-parts']?.[0]?.[0];
  if (typeof y === 'number' && Number.isInteger(y)) return String(y);
  if (typeof y === 'string' && /^-?\d+$/.test(y.trim())) return String(Number(y.trim()));
  return null;
}

/** The base BibTeX key of an item: `cervantessaavedra1605`, `lazarillo1554`, `hookend`. */
export function citationKey(d: Source): string {
  const m = metadataOf(d);
  let base = '';
  const a = Array.isArray(m.author) ? m.author[0] : undefined;
  if (a && typeof a === 'object') base = asciiLetters(String(a.family || a.literal || a.given || ''));
  if (!base) {
    const words = String(m.title ?? '').split(/\s+/).filter(Boolean);
    base = words.length ? asciiLetters(words[0] as string) : '';
  }
  return (base || 'spdf') + (yearOf(m) ?? 'nd');
}

/** Escapes `\`, `{` and `}` (the rest of UTF-8 stays as it is). */
export function bibEscape(value: string): string {
  return value.replace(/[\\{}]/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`));
}

/** Escapes and braces every word the source capitalizes, so styles cannot lowercase it. */
function protectTitle(title: string): string {
  return title
    .split(/(\s+)/)
    .map((token) => (/\p{Lu}/u.test(token) ? `{${bibEscape(token)}}` : bibEscape(token)))
    .join('');
}

function names(people: CslName[] | undefined): string | null {
  if (!Array.isArray(people)) return null;
  const out: string[] = [];
  for (const p of people) {
    if (!p || typeof p !== 'object') continue;
    if (p.literal) {
      out.push(`{${bibEscape(p.literal)}}`);
      continue;
    }
    let family = String(p.family ?? '');
    const particle = String(p['non-dropping-particle'] ?? '');
    if (particle && family) family = `${particle} ${family}`;
    const given = String(p.given ?? '');
    if (family && given) out.push(`${bibEscape(family)}, ${bibEscape(given)}`);
    else if (family || given) out.push(`{${bibEscape(family || given)}}`);
  }
  return out.length ? out.join(' and ') : null;
}

/** One CSL-JSON item as a BibTeX entry. */
export function cslToBibtex(item: CslItem, key?: string): string {
  const entry = BIBTEX_TYPES[String(item.type ?? '')] ?? 'misc';
  const fields: Array<[string, string]> = [];
  const authors = names(item.author);
  if (authors) fields.push(['author', authors]);
  const editors = names(item.editor);
  if (editors) fields.push(['editor', editors]);
  if (item.title) fields.push(['title', protectTitle(String(item.title))]);
  const year = yearOf(item);
  if (year) fields.push(['year', year]);
  const container = item['container-title'];
  if (container) fields.push([entry === 'article' ? 'journal' : 'booktitle', protectTitle(String(container))]);
  for (const [csl, bib] of SIMPLE_FIELDS) {
    const v = item[csl];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    fields.push([bib, bibEscape(String(v))]);
  }
  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
  return `@${entry}{${key ?? citationKey(item)},\n${body}\n}\n`;
}

function suffix(n: number): string {
  let letters = '';
  let x = n + 1;
  while (x) {
    const r = (x - 1) % 26;
    x = Math.floor((x - 1) / 26);
    letters = String.fromCharCode(97 + r) + letters;
  }
  return letters;
}

function keys(items: CslItem[]): string[] {
  const bases = items.map(citationKey);
  const counts = new Map<string, number>();
  for (const b of bases) counts.set(b, (counts.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  return bases.map((b) => {
    if (counts.get(b) === 1) return b;
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return b + suffix(n);
  });
}

function cslItem(d: Source): CslItem {
  const m = structuredClone(metadataOf(d)) as CslItem;
  delete m.spdf;
  return m;
}

export interface CslExportOptions {
  /** CSL `id`; default: the BibTeX key. */
  id?: string;
}

/** One document as a CSL-JSON item (`id` = BibTeX key, `spdf` member removed). */
export function toCslJson(d: Source, options: CslExportOptions = {}): CslItem {
  const item = cslItem(d);
  item.id = options.id ?? citationKey(item);
  return item;
}

/** Several documents as a CSL-JSON array (keys disambiguated with a, b, c…). */
export function toCslJsonArray(docs: readonly Source[]): CslItem[] {
  const items = docs.map(cslItem);
  const ks = keys(items);
  return items.map((it, i) => ({ ...it, id: ks[i] as string }));
}

/** BibTeX entries of one or several documents (keys disambiguated with a, b, c…). */
export function toBibtex(docs: Source | readonly Source[], options: { key?: string } = {}): string {
  const list = Array.isArray(docs) ? (docs as readonly Source[]) : [docs as Source];
  const items = list.map(cslItem);
  const ks = options.key && items.length === 1 ? [options.key] : keys(items);
  return items.map((it, i) => cslToBibtex(it, ks[i])).join('\n');
}

function folio(a: Record<string, unknown>): string | null {
  const p = a.printed;
  if (p === null || p === undefined) return null;
  return a.source === 'inferred' ? `[${String(p)}]` : String(p);
}

/** The CSL `[label, locator]` of an anchor (`['page', '145-146']`), or null. */
export function cslLocator(anchor: Anchor, end?: Anchor | null): [string, string] | null {
  const a = anchor as unknown as Record<string, unknown>;
  const e = (end ?? null) as unknown as Record<string, unknown> | null;
  const t = a.type;
  if (t === 'page' || ((t === 'section' || t === 'web') && a.printed !== null && a.printed !== undefined)) {
    const start = folio(a);
    if (start === null) return null;
    let label = 'page';
    if (t === 'page') label = ({ leaf: 'folio', column: 'column' } as Record<string, string>)[String(a.foliation ?? 'page')] ?? 'page';
    if (e && e.type === t && e.printed !== null && e.printed !== undefined && e.printed !== a.printed) return [label, `${start}-${folio(e)}`];
    return [label, start];
  }
  if (t === 'time' && typeof a.t0 === 'number') {
    let loc = formatTime(a.t0);
    if (e && e.type === 'time' && typeof e.t1 === 'number') loc += `-${formatTime(e.t1)}`;
    return ['timestamp', loc];
  }
  if (t === 'section' || t === 'web') {
    if (a.paragraph !== null && a.paragraph !== undefined) return ['paragraph', String(a.paragraph)];
    const path = a.path;
    if (Array.isArray(path) && path.length) return ['section', String(path[path.length - 1])];
    return null;
  }
  if (t === 'verse' && a.line_from !== null && a.line_from !== undefined) {
    const lf = a.line_from;
    const lt = a.line_to;
    return ['verse', lt === undefined || lt === null || lt === lf ? String(lf) : `${String(lf)}-${String(lt)}`];
  }
  if (t === 'canonical' && a.ref !== null && a.ref !== undefined) return ['section', String(a.ref)];
  if (t === 'sheet' && a.row_from !== null && a.row_from !== undefined) {
    const rf = a.row_from;
    const rt = a.row_to;
    return ['line', rt === undefined || rt === null || rt === rf ? String(rf) : `${String(rf)}-${String(rt)}`];
  }
  return null;
}

/** CSL-JSON item of the document plus `locator` and `label` for an anchor (for citeproc). */
export function cslCitationItem(d: Source, anchor?: Anchor | null, end?: Anchor | null): CslItem {
  const item = toCslJson(d);
  if (anchor) {
    const loc = cslLocator(anchor, end);
    if (loc) {
      item.label = loc[0];
      item.locator = loc[1];
    }
  }
  return item;
}
