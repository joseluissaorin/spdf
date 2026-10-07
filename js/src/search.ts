/**
 * Reference search (contract §6): lexical (FTS5 BM25, trigram or substring for CJK),
 * vector (brute force, f64) and hybrid (reciprocal rank fusion, k = 10).
 */

import type { SqlValue } from './port.js';
import type { Anchor, VectorTarget } from './types.js';
import { decodeVector } from './vectors.js';
import { legacyTarget, type FragmentWithUri, type SpdfDocument } from './document.js';
import { q } from './view.js';

export interface SearchHit {
  fragment_id: string;
  /** The fragment rowid. */
  n: number;
  score: number;
  via: Array<'lexical' | 'vector'>;
  anchor: Anchor;
  anchor_end: Anchor | null;
  anchor_uri: string;
  /** The fragment itself (text, context, section…). */
  fragment: FragmentWithUri;
}

export interface VectorHit {
  target: VectorTarget;
  id: string;
  score: number;
  /** Same as `id` for fragments (so vector hits look like the other results). */
  fragment_id?: string;
  n?: number;
  anchor?: Anchor;
  anchor_end?: Anchor | null;
  anchor_uri?: string;
  via: ['vector'];
}

// ---------------------------------------------------------------------------
// Query parsing (contract §6, steps 1–5)
// ---------------------------------------------------------------------------

const CLOSERS: Record<string, string[]> = {
  '"': ['"'],
  '“': ['”'],
  '«': ['»'],
  '„': ['“', '”'],
};

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export interface ParsedQuery {
  /** Terms to send to FTS5, as written (NFC). */
  terms: string[];
  /** The terms are phrases (all required) rather than words (any). */
  phrases: boolean;
}

function words(s: string): string[] {
  return s.match(WORD) ?? [];
}

/** Dedup key: lower(remove_Mn(NFD(term))). */
export function dedupKey(term: string): string {
  return term.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/** Splits a query into phrase or word terms (contract §6). */
export function parseQuery(query: string): ParsedQuery {
  const s = query.normalize('NFC');
  const phrases: string[] = [];
  const loose: string[] = [];
  const chars = Array.from(s);
  let buf = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    const closers = CLOSERS[c];
    if (closers) {
      let j = i + 1;
      while (j < chars.length && !closers.includes(chars[j] as string)) j++;
      if (j < chars.length) {
        loose.push(buf);
        buf = '';
        const phrase = words(chars.slice(i + 1, j).join('')).join(' ');
        if (phrase) phrases.push(phrase);
        i = j;
        continue;
      }
      // An opening mark with no closing mark is a separator.
      buf += ' ';
      continue;
    }
    buf += c;
  }
  loose.push(buf);
  const raw = phrases.length ? phrases : loose.flatMap(words);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of raw) {
    const k = dedupKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    terms.push(t);
  }
  return { terms, phrases: phrases.length > 0 };
}

/** FTS5 string literal for a term. */
export function ftsString(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** The MATCH expression for a parsed query ('' if there are no terms). */
export function matchExpression(p: ParsedQuery): string {
  return p.terms.map(ftsString).join(p.phrases ? ' AND ' : ' OR ');
}

const CJK = /[⺀-⿟぀-ヿ㄀-ㄯ㄰-㆏ㆠ-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿ｦ-ﾟ\u{20000}-\u{3FFFF}]/u;

export function isCjk(s: string): boolean {
  return CJK.test(s);
}

const cpLength = (s: string): number => Array.from(s).length;

// ---------------------------------------------------------------------------
// Lexical
// ---------------------------------------------------------------------------

export interface LexicalOptions {
  limit?: number;
}

export type LexicalRoute = 'fts' | 'trigram' | 'substring';

export interface LexicalRanking {
  route: LexicalRoute;
  /** The FTS5 MATCH string (null for the substring route or an empty query). */
  match: string | null;
  results: Array<{ n: number; id: string; score: number }>;
}

/** Raw lexical ranking (contract §6): route, MATCH string and `[{n, id, score}]` in rank order. */
export async function lexicalRanking(doc: SpdfDocument, query: string, limit: number): Promise<LexicalRanking> {
  const parsed = parseQuery(query);
  if (!parsed.terms.length) return { route: 'fts', match: null, results: [] };
  const conn = doc.view.conn;
  const view = doc.view;
  const info = view.info;
  const match = matchExpression(parsed);
  const ft = view.tableName('fragments');
  if (!ft) return { route: 'fts', match, results: [] };
  const nCol = await view.expr('fragments', 'n');
  const idCol = await view.expr('fragments', 'id');
  const lim = Math.max(0, Math.floor(limit));
  const withIds = async (rows: Array<Record<string, unknown>>): Promise<LexicalRanking['results']> => {
    if (!rows.length) return [];
    const ns = rows.map((r) => Number(r.n));
    const ids = new Map<number, string>();
    for (const r of await conn.all(`SELECT ${nCol} AS n, ${idCol} AS id FROM ${q(ft)} WHERE ${nCol} IN (${ns.map(() => '?').join(',')})`, ns)) ids.set(Number(r.n), String(r.id));
    return rows.filter((r) => ids.has(Number(r.n))).map((r) => ({ n: Number(r.n), id: ids.get(Number(r.n)) as string, score: -Number(r.r) }));
  };
  if (isCjk(query.normalize('NFC'))) {
    if (info.trigram && parsed.terms.every((t) => cpLength(t) >= 3)) {
      const rows = await conn.all('SELECT rowid AS n, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?', [match, lim]);
      return { route: 'trigram', match, results: await withIds(rows) };
    }
    const textCol = await view.expr('fragments', 'text');
    const hitsSql = parsed.terms.map(() => `(instr(${textCol}, ?) > 0)`).join(' + ');
    const need = parsed.phrases ? parsed.terms.length : 1;
    const rows = await conn.all(
      `SELECT ${nCol} AS n, ${idCol} AS id, (${hitsSql}) AS hits FROM ${q(ft)} WHERE (${hitsSql}) >= ? ORDER BY hits DESC, n LIMIT ?`,
      [...parsed.terms, ...parsed.terms, need, lim],
    );
    return { route: 'substring', match: null, results: rows.map((r) => ({ n: Number(r.n), id: String(r.id), score: Number(r.hits) })) };
  }
  if (!info.fts) return { route: 'fts', match, results: [] };
  const fts = q(info.fts.table);
  const weights = [1.0, 0.5, 0.5, 1.0].slice(0, Math.max(1, Math.min(4, info.fts.columns.length || 4)));
  // Rank inside the FTS index alone (rowid = fragments.n) and look the ids up only for the
  // hits: joining every match with `fragments` would read a page per match, which matters
  // a lot when the file is read remotely.
  const rows = await conn.all(
    `SELECT rowid AS n, bm25(${fts}, ${weights.map((w) => w.toFixed(1)).join(', ')}) AS r FROM ${fts} WHERE ${fts} MATCH ? ORDER BY r, rowid LIMIT ?`,
    [match, lim],
  );
  return { route: 'fts', match, results: await withIds(rows) };
}

async function hydrate(doc: SpdfDocument, ranking: Array<{ n: number; score: number; via: Array<'lexical' | 'vector'> }>): Promise<SearchHit[]> {
  const frags = await doc.fragmentsByN(ranking.map((r) => r.n));
  const out: SearchHit[] = [];
  for (const r of ranking) {
    const f = frags.get(r.n);
    if (!f) continue;
    out.push({ fragment_id: f.id, n: f.n, score: r.score, via: r.via, anchor: f.anchor, anchor_end: f.anchor_end, anchor_uri: f.anchor_uri, fragment: f });
  }
  return out;
}

export async function searchLexical(doc: SpdfDocument, query: string, options: LexicalOptions = {}): Promise<SearchHit[]> {
  const ranking = await lexicalRanking(doc, query, options.limit ?? 10);
  return hydrate(doc, ranking.results.map((r) => ({ n: r.n, score: r.score, via: ['lexical'] })));
}

// ---------------------------------------------------------------------------
// Vector
// ---------------------------------------------------------------------------

export interface VectorOptions {
  target?: VectorTarget;
  limit?: number;
}

/** Raw vector ranking over one space and target (contract §6), scores in f64. */
export async function vectorRanking(
  doc: SpdfDocument,
  spaceId: string,
  query: ArrayLike<number>,
  target: VectorTarget,
  limit: number,
): Promise<Array<{ id: string; score: number; tie: number | string }>> {
  const space = await doc.space(spaceId);
  if (!space) throw new Error(`Unknown vector space «${spaceId}».`);
  if (query.length !== space.dims) throw new Error(`The query vector has ${query.length} dimensions; space «${spaceId}» has ${space.dims}.`);
  const view = doc.view;
  const vt = view.tableName('vectors');
  if (!vt) return [];
  const conn = view.conn;
  const rows = await conn.all(
    `SELECT ${await view.expr('vectors', 'id')} AS id, ${await view.expr('vectors', 'data')} AS data FROM ${q(vt)} WHERE ${await view.expr('vectors', 'space')} = ? AND ${await view.expr('vectors', 'target')} = ?`,
    [spaceId, doc.legacy ? legacyTarget(target) : target],
  );
  const tieOf = new Map<string, number>();
  if (target === 'fragment') {
    const ft = view.tableName('fragments');
    if (ft) for (const r of await conn.all(`SELECT ${await view.expr('fragments', 'n')} AS n, ${await view.expr('fragments', 'id')} AS id FROM ${q(ft)}`)) tieOf.set(String(r.id), Number(r.n));
  } else if (target === 'unit') {
    for (const u of await view.rows('units', { columns: ['id', 'ord'] })) tieOf.set(String(u.id), Number(u.ord));
  }
  const qv = Array.from(query, Number);
  let nq = 0;
  for (const x of qv) nq += x * x;
  nq = Math.sqrt(nq);
  const scored: Array<{ id: string; score: number; tie: number | string }> = [];
  for (const r of rows) {
    const v = decodeVector(r.data as Uint8Array, space.dtype);
    let score = 0;
    const n = Math.min(v.length, qv.length);
    for (let i = 0; i < n; i++) score += (qv[i] as number) * (v[i] as number);
    if (!space.normalized) {
      let nv = 0;
      for (let i = 0; i < v.length; i++) nv += (v[i] as number) * (v[i] as number);
      nv = Math.sqrt(nv);
      score = nq && nv ? score / (nq * nv) : 0;
    }
    const id = String(r.id);
    scored.push({ id, score, tie: target === 'figure' ? id : (tieOf.get(id) ?? Number.MAX_SAFE_INTEGER) });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (typeof a.tie === 'number' && typeof b.tie === 'number') return a.tie - b.tie;
    return String(a.tie) < String(b.tie) ? -1 : String(a.tie) > String(b.tie) ? 1 : 0;
  });
  return scored.slice(0, Math.max(0, limit));
}

export async function searchVector(doc: SpdfDocument, spaceId: string, query: ArrayLike<number>, options: VectorOptions = {}): Promise<VectorHit[]> {
  const target = options.target ?? 'fragment';
  const ranking = await vectorRanking(doc, spaceId, query, target, options.limit ?? 10);
  if (target !== 'fragment') return ranking.map((r) => ({ target, id: r.id, score: r.score, via: ['vector'] }));
  const frags = await doc.fragmentsByN(ranking.map((r) => Number(r.tie)).filter((n) => Number.isFinite(n)));
  return ranking.map((r) => {
    const f = frags.get(Number(r.tie));
    const hit: VectorHit = { target, id: r.id, score: r.score, via: ['vector'], fragment_id: r.id };
    if (f) {
      hit.n = f.n;
      hit.anchor = f.anchor;
      hit.anchor_end = f.anchor_end;
      hit.anchor_uri = f.anchor_uri;
    }
    return hit;
  });
}

// ---------------------------------------------------------------------------
// Hybrid
// ---------------------------------------------------------------------------

export interface HybridOptions {
  limit?: number;
  /** RRF constant; the reference algorithm uses 10. */
  k?: number;
  /** Depth of each list; default max(limit, 50). */
  depth?: number;
}

export async function searchHybrid(
  doc: SpdfDocument,
  query: string,
  vector: ArrayLike<number> | null,
  spaceId: string | null,
  options: HybridOptions = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 10;
  const k = options.k ?? 10;
  const depth = options.depth ?? Math.max(limit, 50);
  const lexical = (await lexicalRanking(doc, query, depth)).results.map((r) => r.id);
  const vec = vector && spaceId ? (await vectorRanking(doc, spaceId, vector, 'fragment', depth)).map((r) => r.id) : [];
  const scores = new Map<string, number>();
  const via = new Map<string, Array<'lexical' | 'vector'>>();
  for (const [name, list] of [['lexical', lexical], ['vector', vec]] as const) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
      const v = via.get(id) ?? [];
      v.push(name);
      via.set(id, v);
    });
  }
  const view = doc.view;
  const ft = view.tableName('fragments');
  const nOf = new Map<string, number>();
  if (ft) for (const r of await view.conn.all(`SELECT ${await view.expr('fragments', 'n')} AS n, ${await view.expr('fragments', 'id')} AS id FROM ${q(ft)}`)) nOf.set(String(r.id), Number(r.n));
  const ranked = [...scores.entries()]
    .filter(([id]) => nOf.has(id))
    .map(([id, score]) => ({ n: nOf.get(id) as number, score, via: via.get(id) as Array<'lexical' | 'vector'> }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, limit);
  return hydrate(doc, ranked);
}
