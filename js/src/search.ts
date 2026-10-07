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

/** Raw lexical ranking: `[{n, score}]` in rank order. */
export async function lexicalRanking(doc: SpdfDocument, query: string, limit: number): Promise<Array<{ n: number; score: number }>> {
  const parsed = parseQuery(query);
  if (!parsed.terms.length || limit <= 0) return [];
  const conn = doc.view.conn;
  const info = doc.view.info;
  const match = matchExpression(parsed);
  if (isCjk(query.normalize('NFC'))) {
    if (info.trigram && parsed.terms.every((t) => cpLength(t) >= 3)) {
      const rows = await conn.all(
        'SELECT rowid AS n, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?',
        [match, limit],
      );
      return rows.map((r) => ({ n: Number(r.n), score: -Number(r.r) }));
    }
    // Substring fallback on fragments.text.
    const table = doc.view.tableName('fragments');
    if (!table) return [];
    const textCol = await doc.view.expr('fragments', 'text');
    const nCol = await doc.view.expr('fragments', 'n');
    const hitsExpr = parsed.terms.map(() => `(instr(${textCol}, ?) > 0)`).join(' + ');
    const params: SqlValue[] = [...parsed.terms];
    let where = `hits > 0`;
    if (parsed.phrases) where = `hits = ${parsed.terms.length}`;
    const rows = await conn.all(
      `SELECT n, hits FROM (SELECT ${nCol} AS n, (${hitsExpr}) AS hits FROM ${q(table)}) WHERE ${where} ORDER BY hits DESC, n LIMIT ?`,
      [...params, limit],
    );
    return rows.map((r) => ({ n: Number(r.n), score: Number(r.hits) }));
  }
  if (!info.fts) return [];
  const fts = q(info.fts.table);
  const weights = [1.0, 0.5, 0.5, 1.0].slice(0, Math.max(1, info.fts.columns.length || 4));
  const rows = await conn.all(
    `SELECT rowid AS n, bm25(${fts}, ${weights.join(', ')}) AS r FROM ${fts} WHERE ${fts} MATCH ? ORDER BY r, rowid LIMIT ?`,
    [match, limit],
  );
  return rows.map((r) => ({ n: Number(r.n), score: -Number(r.r) }));
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
  return hydrate(doc, ranking.map((r) => ({ ...r, via: ['lexical'] })));
}

// ---------------------------------------------------------------------------
// Vector
// ---------------------------------------------------------------------------

export interface VectorOptions {
  target?: VectorTarget;
  limit?: number;
}

/** Raw vector ranking over one space and target. */
export async function vectorRanking(
  doc: SpdfDocument,
  spaceId: string,
  query: ArrayLike<number>,
  target: VectorTarget,
  limit: number,
): Promise<Array<{ id: string; score: number; tie: number | string }>> {
  const space = await doc.space(spaceId);
  if (!space) throw new Error(`Unknown vector space «${spaceId}».`);
  const view = doc.view;
  const vt = view.tableName('vectors');
  if (!vt || limit <= 0) return [];
  const conn = view.conn;
  const rows = await conn.all(
    `SELECT ${await view.expr('vectors', 'id')} AS id, ${await view.expr('vectors', 'data')} AS data FROM ${q(vt)} WHERE ${await view.expr('vectors', 'space')} = ? AND ${await view.expr('vectors', 'target')} = ?`,
    [spaceId, doc.legacy ? legacyTarget(target) : target],
  );
  // Tie-breakers: fragment n, unit ord, figure id.
  const tieOf = new Map<string, number | string>();
  if (target === 'fragment') {
    const ft = view.tableName('fragments');
    if (ft) for (const r of await conn.all(`SELECT ${await view.expr('fragments', 'id')} AS id, ${await view.expr('fragments', 'n')} AS n FROM ${q(ft)}`)) tieOf.set(String(r.id), Number(r.n));
  } else if (target === 'unit') {
    for (const u of await view.rows('units', { columns: ['id', 'ord'] })) tieOf.set(String(u.id), Number(u.ord));
  }
  const qv = Float64Array.from(query as ArrayLike<number>);
  let qn = 0;
  for (let i = 0; i < qv.length; i++) qn += (qv[i] as number) * (qv[i] as number);
  qn = Math.sqrt(qn);
  const scored: Array<{ id: string; score: number; tie: number | string }> = [];
  for (const r of rows) {
    const v = decodeVector(r.data as Uint8Array, space.dtype);
    let dot = 0;
    let vn = 0;
    const n = Math.min(v.length, qv.length);
    for (let i = 0; i < n; i++) {
      const x = v[i] as number;
      dot += x * (qv[i] as number);
      vn += x * x;
    }
    let score = dot;
    if (!space.normalized) {
      const d = Math.sqrt(vn) * qn;
      score = d === 0 ? 0 : dot / d;
    }
    const id = String(r.id);
    const tie = target === 'figure' ? id : (tieOf.get(id) ?? Number.MAX_SAFE_INTEGER);
    scored.push({ id, score, tie });
  }
  scored.sort((a, b) => b.score - a.score || (typeof a.tie === 'number' && typeof b.tie === 'number' ? a.tie - b.tie : String(a.tie) < String(b.tie) ? -1 : String(a.tie) > String(b.tie) ? 1 : 0));
  return scored.slice(0, limit);
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
  const lexical = await lexicalRanking(doc, query, depth);
  const vec = vector && spaceId ? await vectorRanking(doc, spaceId, vector, 'fragment', depth) : [];
  const fused = new Map<number, { n: number; score: number; via: Array<'lexical' | 'vector'> }>();
  lexical.forEach((r, i) => {
    fused.set(r.n, { n: r.n, score: 1 / (k + i + 1), via: ['lexical'] });
  });
  vec.forEach((r, i) => {
    const n = Number(r.tie);
    if (!Number.isFinite(n) || n === Number.MAX_SAFE_INTEGER) return;
    const e = fused.get(n);
    if (e) {
      e.score += 1 / (k + i + 1);
      e.via.push('vector');
    } else fused.set(n, { n, score: 1 / (k + i + 1), via: ['vector'] });
  });
  const ranked = [...fused.values()].sort((a, b) => b.score - a.score || a.n - b.n).slice(0, limit);
  return hydrate(doc, ranked);
}
