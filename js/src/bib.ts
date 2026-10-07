/**
 * Bibliography export (contract §10): CSL-JSON (Zotero, citeproc, Pandoc) and BibTeX.
 */

import type { CslItem, CslName, DocumentRecord } from './types.js';

function metadataOf(d: DocumentRecord | CslItem): CslItem {
  return 'source_sha256' in d && typeof (d as DocumentRecord).metadata === 'object' ? (d as DocumentRecord).metadata : (d as CslItem);
}

/** ASCII citation key: family name + year + first significant title word (`cervantes1605ingenioso`). */
export function citationKey(d: DocumentRecord | CslItem): string {
  const m = metadataOf(d);
  const fold = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9]+/g, '')
      .toLowerCase();
  const first = m.author?.[0];
  const who = first ? fold(first.family ?? first.literal ?? first.given ?? '') : '';
  const year = m.issued?.['date-parts']?.[0]?.[0];
  const words = (m.title ?? '').split(/\s+/).map(fold).filter((w) => w.length > 3);
  const key = `${who}${year ?? ''}${words[0] ?? fold((m.title ?? '').split(/\s+/)[0] ?? '')}`;
  return key || 'spdf';
}

export interface CslExportOptions {
  /** CSL `id`; default: the citation key. */
  id?: string;
  /** Keep the `spdf` extension object (default false: plain CSL-JSON). */
  includeSpdf?: boolean;
}

/** The document as one CSL-JSON item. */
export function toCslJson(d: DocumentRecord | CslItem, options: CslExportOptions = {}): CslItem {
  const m = metadataOf(d);
  const item: CslItem = { ...structuredClone(m), id: options.id ?? (typeof m.id === 'string' && m.id ? m.id : citationKey(d)) };
  if (!options.includeSpdf) delete item.spdf;
  return item;
}

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

const ENTRY: Record<string, string> = {
  book: 'book',
  chapter: 'incollection',
  'entry-encyclopedia': 'incollection',
  'entry-dictionary': 'incollection',
  'article-journal': 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  article: 'article',
  'paper-conference': 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
  manuscript: 'unpublished',
};

/** Escapes BibTeX special characters (UTF-8 is kept as is). */
export function bibEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}#$%&_])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\\textbackslash\\\{\\\}/g, '\\textbackslash{}')
    .replace(/\\textasciitilde\\\{\\\}/g, '\\textasciitilde{}')
    .replace(/\\textasciicircum\\\{\\\}/g, '\\textasciicircum{}');
}

function bibName(n: CslName): string {
  if (n.literal) return `{${bibEscape(n.literal)}}`;
  const family = [n['non-dropping-particle'], n.family].filter(Boolean).join(' ');
  const given = [n.given, n['dropping-particle']].filter(Boolean).join(' ');
  const fam = n.suffix ? `${family}, ${n.suffix}` : family;
  return given ? `${bibEscape(fam)}, ${bibEscape(given)}` : bibEscape(fam);
}

function names(list: CslName[] | undefined): string | undefined {
  return list && list.length ? list.map(bibName).join(' and ') : undefined;
}

/** The document as one BibTeX entry. */
export function toBibtex(d: DocumentRecord | CslItem, options: { key?: string } = {}): string {
  const m = metadataOf(d);
  const type = ENTRY[m.type] ?? 'misc';
  const fields: Array<[string, string | undefined]> = [];
  const add = (k: string, v: unknown, raw = false) => {
    if (v === undefined || v === null || v === '') return;
    const s = String(v);
    fields.push([k, raw ? s : bibEscape(s)]);
  };
  fields.push(['author', names(m.author)]);
  fields.push(['editor', names(m.editor)]);
  fields.push(['translator', names(m.translator)]);
  add('title', m.title);
  const container = m['container-title'];
  if (type === 'article') add('journal', container);
  else if (type === 'incollection' || type === 'inproceedings') add('booktitle', container);
  else if (container) add('howpublished', container);
  const dp = m.issued?.['date-parts']?.[0];
  if (dp?.[0] !== undefined) add('year', dp[0]);
  if (dp?.[1] !== undefined) add('month', dp[1]);
  add('edition', m.edition);
  add('series', m['collection-title']);
  add('volume', m.volume);
  add('number', m.issue);
  add('pages', typeof m.page === 'string' ? m.page.replace(/(\d)\s*[-–]\s*(\d)/g, '$1--$2') : m.page, true);
  if (type === 'phdthesis' || type === 'techreport') add(type === 'phdthesis' ? 'school' : 'institution', m.publisher);
  else add('publisher', m.publisher);
  add('address', m['publisher-place']);
  add('doi', m.DOI, true);
  add('isbn', m.ISBN);
  add('url', m.URL, true);
  add('language', m.language);
  const od = m['original-date']?.['date-parts']?.[0]?.[0];
  if (od !== undefined) add('origdate', od);
  add('origtitle', m['original-title']);
  const key = options.key ?? citationKey(d);
  const body = fields.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '').map(([k, v]) => `  ${k} = {${v}}`);
  return `@${type}{${key},\n${body.join(',\n')}\n}\n`;
}
