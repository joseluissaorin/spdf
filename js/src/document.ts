/**
 * Opening an SPDF safely and reading it: `openSpdf` and the `SpdfDocument` class.
 */

import type { RandomAccessSource, SqlConnection, SqlEngine, SqlValue } from './port.js';
import { resolveEngine } from './port.js';
import { SpdfError } from './errors.js';
import { gunzipWeb, isGzip, isSqlite, sha256Hex, toBytes } from './bytes.js';
import { inspect, View, type Inspection, type ViewRow } from './view.js';
import { docrefOf, formatAnchorUri } from './anchors.js';
import { cite as citeAnchor } from './cite.js';
import { decodeVector } from './vectors.js';
import type {
  Anchor,
  BlobInfo,
  BlobRecord,
  CslItem,
  DocumentRecord,
  ExtensionRecord,
  Figure,
  Fragment,
  ProvenanceRecord,
  Section,
  Space,
  Unit,
  VectorRecord,
  VectorTarget,
} from './types.js';
import { mapLegacyAnchor } from './legacy.js';
import { searchHybrid, searchLexical, searchVector, type HybridOptions, type LexicalOptions, type SearchHit, type VectorHit, type VectorOptions } from './search.js';
import { dumpDocument, type CanonicalDump } from './dump.js';
import { validate, type ValidateOptions, type ValidationReport } from './validate.js';
import { contentSha256, verifyIntegrity, type IntegrityReport } from './integrity.js';

export const DEFAULT_MAX_BLOB_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

export interface OpenOptions {
  /** SQLite engine; default: the platform one registered by the entry point. */
  engine?: SqlEngine;
  /** Largest single TEXT or BLOB value read (default 512 MiB; `SQLITE_LIMIT_LENGTH` where the binding allows it). */
  maxBlobBytes?: number;
  /** Largest gzip output accepted (default 4 GiB). */
  maxDecompressedBytes?: number;
}

/** What can be opened: bytes, a Blob/File, or (Node, Bun) a file path. */
export type SpdfInput = Uint8Array | ArrayBuffer | ArrayBufferView | Blob | string;

/** A database opened read only, inspected but not yet checked. */
export interface RawOpen {
  conn: SqlConnection;
  info: Inspection;
  engine: SqlEngine;
  gzipped: boolean;
  /** Size of the SQLite image in bytes, when known. */
  size: number | null;
  /** The random-access source, when the file is read lazily (HTTP, Blob). */
  source?: RandomAccessSource;
}

async function gunzipWith(engine: SqlEngine, bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  return engine.gunzip ? engine.gunzip(bytes, limit) : gunzipWeb(bytes, limit);
}

/**
 * Opens a database read only with the safe settings of contract §1 and inspects it.
 * Throws E001 if it is not SQLite. Does not reject anything else (see `checkOpen`).
 */
export async function openRaw(input: SpdfInput | { source: RandomAccessSource; head?: Uint8Array }, options: OpenOptions = {}): Promise<RawOpen> {
  const engine = await resolveEngine(options.engine);
  const limit = options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;
  const ro = { readOnly: true, maxValueBytes: options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES };
  let conn: SqlConnection;
  let gzipped = false;
  let size: number | null = null;
  let lazy: RandomAccessSource | undefined;
  if (typeof input === 'object' && input !== null && 'source' in input && typeof (input as { source: unknown }).source === 'object') {
    const { source } = input as { source: RandomAccessSource; head?: Uint8Array };
    const head = (input as { head?: Uint8Array }).head ?? source.read(0, 100);
    if (isGzip(head)) {
      gzipped = true;
      const all = source.read(0, source.size);
      const bytes = await gunzipWith(engine, all, limit);
      if (!isSqlite(bytes)) throw new SpdfError('E001', 'gzip content is not a SQLite database');
      size = bytes.byteLength;
      conn = await engine.openBytes(bytes, ro);
    } else {
      if (!isSqlite(head)) throw new SpdfError('E001', 'not a SQLite database');
      if (!engine.openSource) throw new Error(`The ${engine.name} engine cannot read random-access sources.`);
      size = source.size;
      lazy = source;
      conn = await engine.openSource(source, ro);
    }
  } else if (typeof input === 'string') {
    if (!engine.readFileHead || !engine.readFile) throw new Error(`The ${engine.name} engine cannot open file paths; pass the bytes.`);
    const head = await engine.readFileHead(input, 100);
    if (isGzip(head)) {
      gzipped = true;
      const bytes = await gunzipWith(engine, await engine.readFile(input), limit);
      if (!isSqlite(bytes)) throw new SpdfError('E001', 'gzip content is not a SQLite database');
      size = bytes.byteLength;
      conn = await engine.openBytes(bytes, ro);
    } else {
      if (!isSqlite(head)) throw new SpdfError('E001', 'not a SQLite database');
      conn = engine.openPath ? await engine.openPath(input, ro) : await engine.openBytes(await engine.readFile(input), ro);
    }
  } else {
    let bytes = typeof Blob !== 'undefined' && input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : toBytes(input as Uint8Array | ArrayBuffer | ArrayBufferView);
    if (isGzip(bytes)) {
      gzipped = true;
      bytes = await gunzipWith(engine, bytes, limit);
    }
    if (!isSqlite(bytes)) throw new SpdfError('E001', gzipped ? 'gzip content is not a SQLite database' : 'not a SQLite database');
    size = bytes.byteLength;
    conn = await engine.openBytes(bytes, ro);
  }
  try {
    await conn.exec('PRAGMA query_only = 1; PRAGMA trusted_schema = OFF; PRAGMA mmap_size = 0; PRAGMA cell_size_check = ON;');
    const info = await inspect(conn);
    return lazy ? { conn, info, engine, gzipped, size, source: lazy } : { conn, info, engine, gzipped, size };
  } catch (e) {
    await conn.close();
    if (e instanceof SpdfError) throw e;
    throw new SpdfError('E001', `not a readable SQLite database (${(e as Error).message})`);
  }
}

/** Rejects what a reader must refuse (E002, E020, E060, E010 for the core tables). */
async function checkOpen(raw: RawOpen): Promise<void> {
  const { info, conn } = raw;
  if (info.version === '3.0') throw new SpdfError('E002', 'SPDF 3.0 (Scholaris v1–v3) is not supported by this reader; convert it with Scholaris first');
  if (!info.version) {
    throw new SpdfError(
      'E002',
      info.applicationId === 0x53504446 ? `unsupported SPDF version (user_version ${info.userVersion})` : 'not an SPDF file (unknown application_id and schema)',
    );
  }
  if (info.forbidden.length) {
    throw new SpdfError('E020', `the file contains ${info.forbidden.map((f) => `${f.type} ${f.name}`).join(', ')}`);
  }
  const docTable = info.legacy ? 'documentos' : 'documents';
  if (!info.tables.has(docTable)) throw new SpdfError('E010', `missing required table ${docTable}`);
  if (!info.legacy && info.tables.has('extensions')) {
    const req = await conn.all('SELECT name FROM extensions WHERE required <> 0 ORDER BY name');
    if (req.length) throw new SpdfError('E060', `unknown required extension ${req.map((r) => String(r.name)).join(', ')}`);
  }
}

/** Opens an SPDF (5.0, or legacy 4.x, gzip-wrapped or not) read only. */
export async function openSpdf(input: SpdfInput, options: OpenOptions = {}): Promise<SpdfDocument> {
  const raw = await openRaw(input, options);
  return SpdfDocument.fromRaw(raw, options);
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const objOrNull = <T>(v: unknown): T | null => (v && typeof v === 'object' ? (v as T) : null);

export function toDocument(r: ViewRow): DocumentRecord {
  const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as CslItem) : ({ type: 'document', title: str(r.title) } as CslItem);
  return {
    id: str(r.id),
    kind: str(r.kind),
    metadata: meta,
    source_sha256: str(r.source_sha256),
    source_ref: strOrNull(r.source_ref),
    mime: str(r.mime),
    bytes: num(r.bytes),
    unit_count: num(r.unit_count),
    duration: numOrNull(r.duration),
    created: str(r.created),
    updated: str(r.updated),
    title: strOrNull(r.title),
    authors: strOrNull(r.authors),
    year: numOrNull(r.year),
    language: strOrNull(r.language),
    rights: objOrNull(r.rights),
  };
}

export function toUnit(r: ViewRow): Unit {
  return {
    id: str(r.id),
    document: str(r.document),
    ord: num(r.ord),
    anchor: r.anchor as Anchor,
    text: str(r.text),
    notes: Array.isArray(r.notes) ? (r.notes as string[]) : null,
    header: strOrNull(r.header),
    footer: strOrNull(r.footer),
    image: strOrNull(r.image),
    thumbnail: strOrNull(r.thumbnail),
    reader: str(r.reader),
    confidence: num(r.confidence ?? 1),
    printed: strOrNull(r.printed),
    t0: numOrNull(r.t0),
    t1: numOrNull(r.t1),
    words: objOrNull(r.words),
  };
}

export function toFragment(r: ViewRow): Fragment {
  return {
    n: num(r.n),
    id: str(r.id),
    document: str(r.document),
    unit: str(r.unit),
    ord: num(r.ord),
    text: str(r.text),
    context: str(r.context),
    section: Array.isArray(r.section) ? (r.section as string[]) : null,
    anchor: r.anchor as Anchor,
    anchor_end: objOrNull<Anchor>(r.anchor_end),
    search_text: strOrNull(r.search_text),
  };
}

export function toSection(r: ViewRow): Section {
  return {
    id: str(r.id),
    document: str(r.document),
    parent: strOrNull(r.parent),
    level: num(r.level),
    title: str(r.title),
    unit_from: str(r.unit_from),
    unit_to: strOrNull(r.unit_to),
    summary: strOrNull(r.summary),
  };
}

export function toFigure(r: ViewRow): Figure {
  return {
    id: str(r.id),
    document: str(r.document),
    unit: str(r.unit),
    image: str(r.image),
    caption: strOrNull(r.caption),
    description: strOrNull(r.description),
    anchor: r.anchor as Anchor,
  };
}

export function toSpace(r: ViewRow): Space {
  return {
    id: str(r.id),
    provider: str(r.provider),
    model: str(r.model),
    version: strOrNull(r.version),
    dims: num(r.dims),
    dtype: (str(r.dtype) || 'f32') as Space['dtype'],
    normalized: num(r.normalized ?? 1) !== 0,
    truncated_from: numOrNull(r.truncated_from),
    modalities: Array.isArray(r.modalities) ? (r.modalities as string[]) : [],
    task_prefixes: objOrNull(r.task_prefixes),
    created: strOrNull(r.created),
  };
}

// ---------------------------------------------------------------------------
// SpdfDocument
// ---------------------------------------------------------------------------

export interface FragmentWithUri extends Fragment {
  anchor_uri: string;
}

/** An open SPDF file (5.0, or legacy 4.x seen through the 5.0 view). */
export class SpdfDocument {
  /** '5.0' (or a later 5.x), '4.0' or '4.1'. */
  readonly version: string;
  readonly legacy: boolean;
  /** The file came gzip-wrapped. */
  readonly gzipped: boolean;
  /** `spdf_meta` as key → value (legacy keys mapped). */
  readonly meta: Readonly<Record<string, string>>;
  /** The document row (metadata as CSL-JSON). */
  readonly document: DocumentRecord;
  /** `sha256-<hex>` (or the id when the source hash is not a SHA-256). */
  readonly docref: string;
  /** Warnings found while opening (E003 gzip-wrapped 5.0, W105 newer minor, W110 legacy). */
  readonly warnings: ReadonlyArray<{ code: string; message: string }>;
  readonly maxBlobBytes: number;

  private constructor(
    readonly view: View,
    readonly engine: SqlEngine,
    init: {
      version: string;
      gzipped: boolean;
      meta: Record<string, string>;
      document: DocumentRecord;
      warnings: Array<{ code: string; message: string }>;
      maxBlobBytes: number;
      size: number | null;
      source: RandomAccessSource | null;
    },
  ) {
    this.version = init.version;
    this.legacy = view.legacy;
    this.gzipped = init.gzipped;
    this.meta = Object.freeze({ ...init.meta });
    this.document = init.document;
    this.docref = docrefOf(init.document);
    this.warnings = init.warnings;
    this.maxBlobBytes = init.maxBlobBytes;
    this.size = init.size;
    this.source = init.source;
  }

  /** Size of the SQLite image in bytes, when known. */
  readonly size: number | null;
  /** The random-access source when the file is read lazily (see `openRemote`), with its `stats()`. */
  readonly source: RandomAccessSource | null;

  /** @internal */
  static async fromRaw(raw: RawOpen, options: OpenOptions = {}): Promise<SpdfDocument> {
    try {
      await checkOpen(raw);
      const view = new View(raw.conn, raw.info);
      const warnings: Array<{ code: string; message: string }> = [];
      if (raw.gzipped && !raw.info.legacy) warnings.push({ code: 'E003', message: 'SPDF 5.0 files should not be gzip-wrapped' });
      if (!raw.info.legacy && raw.info.version !== '5.0') warnings.push({ code: 'W105', message: `newer minor version ${raw.info.version}` });
      if (raw.info.legacy) warnings.push({ code: 'W110', message: `legacy SPDF ${raw.info.version} file` });
      const meta: Record<string, string> = {};
      for (const r of await view.rows('spdf_meta', { orderBy: 'key' })) meta[String(r.key)] = String(r.value);
      const docId = meta.document_id;
      let rows = docId ? await view.rows('documents', { where: `${await view.expr('documents', 'id')} = ?`, params: [docId] }) : [];
      if (!rows.length) rows = await view.rows('documents', { orderBy: 'id', limit: 1 });
      const first = rows[0];
      if (!first) throw new SpdfError('E013', 'the file holds no document');
      const version = raw.info.legacy ? (raw.info.version as string) : (meta.spdf_version ?? raw.info.version ?? '5.0');
      return new SpdfDocument(view, raw.engine, {
        version,
        gzipped: raw.gzipped,
        meta,
        document: toDocument(first),
        warnings,
        maxBlobBytes: options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES,
        size: raw.size,
        source: raw.source ?? null,
      });
    } catch (e) {
      await raw.conn.close();
      throw e;
    }
  }

  /** The underlying connection (read only). */
  get connection(): SqlConnection {
    return this.view.conn;
  }

  /** Profiles declared in `spdf_meta.profile`. */
  get profile(): string[] {
    return (this.meta.profile ?? '').split(/\s+/).filter(Boolean);
  }

  private async col(t: Parameters<View['expr']>[0], c: string): Promise<string> {
    return this.view.expr(t, c);
  }

  /** Anchor URI of an anchor of this document. */
  anchorUri(anchor: Anchor, anchorEnd?: Anchor | null): string {
    return formatAnchorUri(this.docref, anchor, anchorEnd);
  }

  /** Short citation `(Family, Year, locator)`. */
  cite(anchor: Anchor, locale: string = 'es', anchorEnd?: Anchor | null): string {
    return citeAnchor(anchor, this.document, locale, anchorEnd);
  }

  // --- units --------------------------------------------------------------

  /** Units in reading order (`ord` from 1), optionally a range of ords. */
  async units(range: { from?: number; to?: number } = {}): Promise<Unit[]> {
    const ord = await this.col('units', 'ord');
    // `document = ?` lets SQLite use the units_doc (document, ord) index: a remote reader
    // then fetches a few pages instead of scanning the table.
    const where: string[] = [`${await this.col('units', 'document')} = ?`];
    const params: SqlValue[] = [this.document.id];
    if (range.from !== undefined) {
      where.push(`${ord} >= ?`);
      params.push(range.from);
    }
    if (range.to !== undefined) {
      where.push(`${ord} <= ?`);
      params.push(range.to);
    }
    const rows = await this.view.rows('units', { where: where.join(' AND '), params, orderBy: 'ord, id' });
    return rows.map(toUnit);
  }

  async unit(ord: number): Promise<Unit | null> {
    return (await this.units({ from: ord, to: ord }))[0] ?? null;
  }

  async unitById(id: string): Promise<Unit | null> {
    const rows = await this.view.rows('units', { where: `${await this.col('units', 'id')} = ?`, params: [id] });
    return rows[0] ? toUnit(rows[0]) : null;
  }

  /** Units whose printed folio is `printed` ("go to page 145"). */
  async unitByPrinted(printed: string): Promise<Unit[]> {
    const rows = await this.view.rows('units', {
      where: `${await this.col('units', 'document')} = ? AND ${await this.col('units', 'printed')} = ?`,
      params: [this.document.id, printed],
      orderBy: 'ord, id',
    });
    return rows.map(toUnit);
  }

  async unitCount(): Promise<number> {
    const t = this.view.tableName('units');
    if (!t) return 0;
    const [r] = await this.view.conn.all(`SELECT count(*) AS n FROM "${t}"`);
    return num(r?.n);
  }

  // --- sections, fragments, figures ---------------------------------------

  async sections(): Promise<Section[]> {
    return (await this.view.rows('sections', { orderBy: 'id' })).map(toSection);
  }

  /** Fragments in `n` order (all, or those of one unit), each with its anchor URI. */
  async fragments(unitId?: string): Promise<FragmentWithUri[]> {
    const rows = unitId
      ? await this.view.rows('fragments', { where: `${await this.col('fragments', 'unit')} = ?`, params: [unitId], orderBy: 'n' })
      : await this.view.rows('fragments', { orderBy: 'n' });
    return rows.map((r) => this.withUri(toFragment(r)));
  }

  async fragment(id: string): Promise<FragmentWithUri | null> {
    const rows = await this.view.rows('fragments', { where: `${await this.col('fragments', 'id')} = ?`, params: [id] });
    return rows[0] ? this.withUri(toFragment(rows[0])) : null;
  }

  /** Fragments by rowid `n` (search results). */
  async fragmentsByN(ns: readonly number[]): Promise<Map<number, FragmentWithUri>> {
    const out = new Map<number, FragmentWithUri>();
    if (!ns.length) return out;
    const n = await this.col('fragments', 'n');
    for (let i = 0; i < ns.length; i += 500) {
      const chunk = ns.slice(i, i + 500);
      const rows = await this.view.rows('fragments', { where: `${n} IN (${chunk.map(() => '?').join(',')})`, params: chunk });
      for (const r of rows) {
        const f = this.withUri(toFragment(r));
        out.set(f.n, f);
      }
    }
    return out;
  }

  private withUri(f: Fragment): FragmentWithUri {
    return { ...f, anchor_uri: this.anchorUri(f.anchor, f.anchor_end) };
  }

  async figures(): Promise<Figure[]> {
    return (await this.view.rows('figures', { orderBy: 'id' })).map(toFigure);
  }

  // --- vectors ------------------------------------------------------------

  async spaces(): Promise<Space[]> {
    return (await this.view.rows('spaces', { orderBy: 'id' })).map(toSpace);
  }

  async space(id: string): Promise<Space | null> {
    return (await this.spaces()).find((s) => s.id === id) ?? null;
  }

  /** Decoded vectors of a space (optionally one target), ordered by target and id. */
  async vectors(spaceId: string, target?: VectorTarget): Promise<VectorRecord[]> {
    const space = await this.space(spaceId);
    if (!space) throw new Error(`Unknown vector space «${spaceId}».`);
    const where = [`${await this.col('vectors', 'space')} = ?`];
    const params: SqlValue[] = [spaceId];
    if (target) {
      where.push(`${await this.col('vectors', 'target')} = ?`);
      params.push(this.legacy ? legacyTarget(target) : target);
    }
    const rows = await this.view.rows('vectors', { where: where.join(' AND '), params, orderBy: 'target, id' });
    return rows.map((r) => ({
      target: String(r.target) as VectorTarget,
      id: String(r.id),
      space: String(r.space),
      document: String(r.document),
      vector: decodeVector(r.data as Uint8Array, space.dtype),
    }));
  }

  // --- blobs, provenance, extensions -------------------------------------

  async blobs(): Promise<BlobInfo[]> {
    const t = this.view.tableName('blobs');
    if (!t) return [];
    const k = await this.col('blobs', 'key');
    const rows = await this.view.conn.all(`SELECT ${k} AS key, ${await this.col('blobs', 'mime')} AS mime, length(${await this.col('blobs', 'data')}) AS bytes, ${await this.col('blobs', 'sha256')} AS sha256 FROM "${t}" ORDER BY ${k}`);
    const out: BlobInfo[] = [];
    for (const r of rows) {
      let sha = r.sha256 === null || r.sha256 === undefined ? null : String(r.sha256);
      if (sha === null) sha = (await this.blob(String(r.key)))?.sha256 ?? '';
      out.push({ key: String(r.key), mime: String(r.mime), bytes: num(r.bytes), sha256: sha });
    }
    return out;
  }

  /** A blob by key (`blob:` prefix accepted). Fails above `maxBlobBytes`. */
  async blob(key: string): Promise<BlobRecord | null> {
    const t = this.view.tableName('blobs');
    if (!t) return null;
    const k = key.startsWith('blob:') ? key.slice(5) : key;
    const kc = await this.col('blobs', 'key');
    const dc = await this.col('blobs', 'data');
    const [size] = await this.view.conn.all(`SELECT length(${dc}) AS n FROM "${t}" WHERE ${kc} = ?`, [k]);
    if (!size) return null;
    if (num(size.n) > this.maxBlobBytes) throw new SpdfError('E000', `blob ${k} is ${num(size.n)} bytes, above the limit of ${this.maxBlobBytes}`);
    const rows = await this.view.rows('blobs', { where: `${kc} = ?`, params: [k] });
    const r = rows[0];
    if (!r) return null;
    const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(0);
    const sha = r.sha256 === null || r.sha256 === undefined ? await sha256Hex(data) : String(r.sha256);
    return { key: String(r.key), mime: String(r.mime), sha256: sha, data };
  }

  async provenance(): Promise<ProvenanceRecord[]> {
    const rows = await this.view.rows('provenance', { orderBy: 'at, stage, provider, model, detail, ms', raw: false });
    return rows.map((r) => ({
      document: str(r.document),
      stage: str(r.stage),
      provider: strOrNull(r.provider),
      model: strOrNull(r.model),
      detail: r.detail ?? null,
      ms: numOrNull(r.ms),
      at: str(r.at),
    }));
  }

  async extensions(): Promise<ExtensionRecord[]> {
    if (this.legacy) return [];
    return (await this.view.rows('extensions', { orderBy: 'name' })).map((r) => ({
      name: str(r.name),
      version: str(r.version),
      required: num(r.required) !== 0,
    }));
  }

  // --- search, dump, validation, integrity ---------------------------------

  /** Lexical search (FTS5 BM25; trigram or substring for CJK), contract §6. */
  searchLexical(query: string, options: LexicalOptions = {}): Promise<SearchHit[]> {
    return searchLexical(this, query, options);
  }

  /** Brute-force vector search in one space (default target: fragments). */
  searchVector(spaceId: string, vector: ArrayLike<number>, options: VectorOptions = {}): Promise<VectorHit[]> {
    return searchVector(this, spaceId, vector, options);
  }

  /** Hybrid search: reciprocal rank fusion of the lexical and vector lists (k = 10). */
  searchHybrid(query: string, vector: ArrayLike<number> | null, spaceId: string | null, options: HybridOptions = {}): Promise<SearchHit[]> {
    return searchHybrid(this, query, vector, spaceId, options);
  }

  /** The canonical dump (contract §5). */
  dump(): Promise<CanonicalDump> {
    return dumpDocument(this);
  }

  /** Validates this file (works on a serialized copy of the open database). */
  async validate(options: Omit<ValidateOptions, 'engine'> = {}): Promise<ValidationReport> {
    const r = await validate(await this.view.conn.serialize(), { ...options, engine: this.engine });
    if (this.gzipped && !this.legacy && !r.warnings.some((w) => w.code === 'E003')) {
      r.warnings.unshift({ code: 'E003', message: 'SPDF 5.0 files must not be gzip-wrapped', where: null });
    }
    return r;
  }

  /** `content_sha256` recomputed from the content (contract §8). */
  contentSha256(): Promise<string> {
    return contentSha256(this);
  }

  /** Checks `content_sha256` and the Ed25519 signature. */
  verifyIntegrity(publicKey?: CryptoKey | Uint8Array | string): Promise<IntegrityReport> {
    return verifyIntegrity(this, publicKey);
  }

  async close(): Promise<void> {
    await this.view.conn.close();
  }
}

export function legacyTarget(target: string): string {
  return target === 'fragment' ? 'fragmento' : target === 'unit' ? 'unidad' : target === 'figure' ? 'figura' : target;
}

export { mapLegacyAnchor };
