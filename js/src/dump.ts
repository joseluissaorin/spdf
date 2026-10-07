/**
 * The canonical JSON dump (contract §5): the conformance oracle and the input of
 * `content_sha256`.
 */

import { sha256Hex, concatBytes } from './bytes.js';
import { canonicalize, canonicalJson } from './canonical.js';
import { openSpdf, type OpenOptions, type SpdfDocument, type SpdfInput } from './document.js';
import { tokenizerOf, q, type ViewRow } from './view.js';

export type CanonicalDump = Record<string, unknown>;

const pick = (r: ViewRow, keys: readonly string[]): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  for (const k of keys) o[k] = r[k] === undefined ? null : r[k];
  return o;
};

const DOC_KEYS = ['id', 'kind', 'metadata', 'source_sha256', 'source_ref', 'mime', 'bytes', 'unit_count', 'duration', 'created', 'updated', 'title', 'authors', 'year', 'language', 'rights'] as const;
const UNIT_KEYS = ['id', 'ord', 'anchor', 'text', 'notes', 'header', 'footer', 'image', 'thumbnail', 'reader', 'confidence', 'printed', 't0', 't1', 'words'] as const;
const SECTION_KEYS = ['id', 'parent', 'level', 'title', 'unit_from', 'unit_to', 'summary'] as const;
const FRAGMENT_KEYS = ['n', 'id', 'unit', 'ord', 'text', 'context', 'section', 'anchor', 'anchor_end', 'search_text'] as const;
const FIGURE_KEYS = ['id', 'unit', 'image', 'caption', 'description', 'anchor'] as const;
const SPACE_KEYS = ['id', 'provider', 'model', 'version', 'dims', 'dtype', 'normalized', 'truncated_from', 'modalities', 'task_prefixes', 'created'] as const;
const PROVENANCE_KEYS = ['stage', 'provider', 'model', 'detail', 'ms', 'at'] as const;

/** Provenance entries ordered by the UTF-8 bytes of their JCS form (contract draft 1.1). */
export function sortProvenance(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const enc = new TextEncoder();
  const keyed = rows.map((r) => ({ r, k: enc.encode(canonicalJson(r)) }));
  keyed.sort((a, b) => {
    const n = Math.min(a.k.length, b.k.length);
    for (let i = 0; i < n; i++) if (a.k[i] !== b.k[i]) return (a.k[i] as number) - (b.k[i] as number);
    return a.k.length - b.k.length;
  });
  return keyed.map((x) => x.r);
}

/** The canonical dump of an open document (numbers rounded, keys sorted). */
export async function dumpDocument(doc: SpdfDocument): Promise<CanonicalDump> {
  const view = doc.view;
  const conn = view.conn;
  const out: CanonicalDump = {};
  out.spdf_version = doc.legacy ? doc.version : (doc.meta.spdf_version ?? doc.version);
  if (doc.legacy) out.legacy = true;
  out.meta = { ...doc.meta };
  out.fts = { tokenizer: view.info.fts ? tokenizerOf(view.info.fts.sql) : null, trigram: view.info.trigram };
  out.document = pick(
    (await view.rows('documents', { where: `${await view.expr('documents', 'id')} = ?`, params: [doc.document.id] }))[0] ?? {},
    DOC_KEYS,
  );
  out.units = (await view.rows('units', { orderBy: 'ord, id' })).map((r) => pick(r, UNIT_KEYS));
  out.sections = (await view.rows('sections', { orderBy: 'id' })).map((r) => pick(r, SECTION_KEYS));
  out.fragments = (await view.rows('fragments', { orderBy: 'n' })).map((r) => pick(r, FRAGMENT_KEYS));
  out.figures = (await view.rows('figures', { orderBy: 'id' })).map((r) => pick(r, FIGURE_KEYS));
  out.spaces = (await view.rows('spaces', { orderBy: 'id' })).map((r) => pick(r, SPACE_KEYS));

  const vectors: Record<string, { count: number; sha256: string }> = {};
  const vt = view.tableName('vectors');
  if (vt) {
    const spaceCol = await view.expr('vectors', 'space');
    const spaces = await conn.all(`SELECT DISTINCT ${spaceCol} AS s FROM ${q(vt)} ORDER BY s`);
    for (const s of spaces) {
      const id = String(s.s);
      const rows = await conn.all(
        `SELECT ${await view.expr('vectors', 'data')} AS data FROM ${q(vt)} WHERE ${spaceCol} = ? ORDER BY ${await view.expr('vectors', 'target')}, ${await view.expr('vectors', 'id')}`,
        [id],
      );
      const chunks = rows.map((r) => (r.data instanceof Uint8Array ? r.data : new Uint8Array(0)));
      vectors[id] = { count: rows.length, sha256: await sha256Hex(concatBytes(chunks)) };
    }
  }
  out.vectors = vectors;

  const blobs: Array<Record<string, unknown>> = [];
  const bt = view.tableName('blobs');
  if (bt) {
    const k = await view.expr('blobs', 'key');
    const keys = await conn.all(`SELECT ${k} AS key, ${await view.expr('blobs', 'mime')} AS mime FROM ${q(bt)} ORDER BY ${k}`);
    for (const r of keys) {
      const [d] = await conn.all(`SELECT ${await view.expr('blobs', 'data')} AS data FROM ${q(bt)} WHERE ${k} = ?`, [r.key ?? null]);
      const data = d?.data instanceof Uint8Array ? d.data : typeof d?.data === 'string' ? new TextEncoder().encode(d.data) : new Uint8Array(0);
      blobs.push({ key: r.key, mime: r.mime, bytes: data.byteLength, sha256: await sha256Hex(data) });
    }
  }
  out.blobs = blobs;
  out.provenance = sortProvenance((await view.rows('provenance')).map((r) => pick(r, PROVENANCE_KEYS)));
  out.extensions = doc.legacy ? [] : (await view.rows('extensions', { orderBy: 'name' })).map((r) => pick(r, ['name', 'version', 'required']));
  return canonicalize(out);
}

/** Opens and dumps a file. */
export async function dump(input: SpdfInput, options: OpenOptions = {}): Promise<CanonicalDump> {
  const doc = await openSpdf(input, options);
  try {
    return await dumpDocument(doc);
  } finally {
    await doc.close();
  }
}
