/**
 * Opening an SPDF safely and reading it: `openSpdf` and the `SpdfDocument` class.
 */

import type { RandomAccessSource, SqlConnection, SqlEngine, SqlValue } from './port.js';
import { resolveEngine } from './port.js';
import { SpdfError } from './errors.js';
import { gunzipWeb, isGzip, isSqlite, sha256Hex, toBytes } from './bytes.js';
import { inspect, View, type Inspection, type ViewRow } from './view.js';
import { docrefOf, formatAnchorUri, parseAnchorUri, type AnchorLocator } from './anchors.js';
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
import { canonicalJson } from './canonical.js';
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

/** What an anchor URI designates in a file (SPEC §5.4). */
export interface Location {
  /** The reference is for this document. */
  document: boolean;
  /** Matching unit ids, in reading order. */
  units: string[];
  /** Matching fragment ids, in `n` order (narrowed by `char` when present). */
  fragments: string[];
  char: [number, number] | null;
  xywh: [number, number, number, number] | null;
}

/** The first unit of a {@link Location}. */
export interface Resolution {
  unit: string;
  ord: number;
  fragments: string[];
  chars: [number, number] | null;
  xywh: [number, number, number, number] | null;
}

/** An anchor without `chars` and `region`, serialized canonically (anchor identity, SPEC §4.4). */
function identity(a: unknown): string {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return canonicalJson(a ?? null);
  const { chars: _c, region: _r, ...rest } = a as Record<string, unknown>;
  return canonicalJson(rest);
}

/**
 * The unit where a crossing fragment ends (SPEC §4.4): the first unit after its start unit,
 * in `ord` order, whose anchor equals `anchor_end` ignoring `chars` and `region`.
 */
export function endUnit<U extends { id: string; anchor: unknown }>(units: readonly U[], startId: string, anchorEnd: unknown): U | null {
  if (!anchorEnd || typeof anchorEnd !== 'object') return null;
  const want = identity(anchorEnd);
  let after = false;
  for (const u of units) {
    if (u.id === startId) {
      after = true;
      continue;
    }
    if (after && identity(u.anchor) === want) return u;
  }
  return null;
}

export interface PassageCitation {
  /** The short citation (§18). */
  text: string;
  /** The anchor URI of the cited anchor or range. */
  uri: string;
  anchor: Anchor;
  anchor_end: Anchor | null;
}

const codePoints = (s: string): string[] => Array.from(s);

/** Index (in code points) of `needle` inside `hay`, or -1. */
function cpIndexOf(hay: string[], needle: string[]): number {
  if (!needle.length) return 0;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** SPEC §18.2 on an open document. */
export async function citePassageIn(doc: SpdfDocument, fragmentId: string, quote: string, locale: string = 'es'): Promise<PassageCitation> {
  const units = await doc.units();
  const f = await doc.fragment(fragmentId);
  if (!f) throw new Error(`No fragment with id ${fragmentId}.`);
  const u1 = units.find((u) => u.id === f.unit);
  if (!u1) throw new Error(`The unit ${f.unit} of fragment ${fragmentId} does not exist.`);
  const q = codePoints(quote.normalize('NFC'));
  const strip = (a: Anchor): Anchor => {
    const { chars: _c, region: _r, ...rest } = a as Anchor & { chars?: unknown; region?: unknown };
    return rest as Anchor;
  };
  const charsOf = (a: unknown): [number, number] | null => {
    const c = a && typeof a === 'object' ? (a as { chars?: unknown }).chars : undefined;
    return Array.isArray(c) && c.length === 2 ? (c as [number, number]) : null;
  };
  const t1 = codePoints(u1.text);
  const c1 = charsOf(f.anchor) ?? [0, t1.length];
  const seg1 = t1.slice(c1[0], c1[1]);
  const u2 = endUnit(units, u1.id, f.anchor_end);
  let seg2: string[] = [];
  let c2: [number, number] = [0, 0];
  if (u2) {
    const t2 = codePoints(u2.text);
    c2 = charsOf(f.anchor_end) ?? [0, t2.length];
    seg2 = t2.slice(c2[0], c2[1]);
  }
  let anchor: Anchor;
  let end: Anchor | null = null;
  const i1 = cpIndexOf(seg1, q);
  const i2 = u2 ? cpIndexOf(seg2, q) : -1;
  if (i1 >= 0) {
    anchor = { ...strip(u1.anchor), chars: [i1 + c1[0], i1 + c1[0] + q.length] } as Anchor;
  } else if (u2 && i2 >= 0) {
    anchor = { ...strip(u2.anchor), chars: [i2 + c2[0], i2 + c2[0] + q.length] } as Anchor;
  } else if (u2 && cpIndexOf(codePoints(f.text), q) >= 0) {
    anchor = strip(u1.anchor);
    end = strip(u2.anchor);
  } else {
    throw new Error('The quotation is not in the fragment.');
  }
  return { text: doc.cite(anchor, locale, end), uri: formatAnchorUri(`sha256-${doc.document.source_sha256}`, anchor, end), anchor, anchor_end: end };
}

/** The `matter` of an anchor (`body` when absent or not a string). */
export function matterOf(a: unknown): string {
  const m = a && typeof a === 'object' ? (a as { matter?: unknown }).matter : undefined;
  return typeof m === 'string' ? m : 'body';
}

const RULE_ORDER = ['p', 'f', 't', 'sl', 'v', 'ref', 's', 'sh'] as const;
type Rule = (typeof RULE_ORDER)[number];

const isIntValue = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNumValue = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function anchorMatches(rule: Rule, L: AnchorLocator, anchor: unknown, printed?: string | null): boolean {
  if (!anchor || typeof anchor !== 'object') return false;
  const a = anchor as Record<string, unknown>;
  const t = a.type;
  switch (rule) {
    case 'p':
      return t === 'page' && isIntValue(a.physical) && (L.p as number) <= a.physical && a.physical <= (L.pe ?? (L.p as number));
    case 'f':
      return (printed !== undefined ? printed : a.printed) === L.f;
    case 't': {
      const x = (L.t as number[])[0] as number;
      return t === 'time' && isNumValue(a.t0) && isNumValue(a.t1) && a.t0 <= x && x < a.t1;
    }
    case 'sl':
      return t === 'slide' && a.n === L.sl;
    case 'v': {
      const x = (L.v as number[])[0] as number;
      const lf = a.line_from;
      const lt = a.line_to !== undefined && a.line_to !== null ? a.line_to : lf;
      return t === 'verse' && isIntValue(lf) && lf <= x && x <= (lt as number);
    }
    case 'ref':
      return t === 'canonical' && a.scheme === L.ref?.scheme && a.ref === L.ref?.ref;
    case 's': {
      const path = a.path;
      if ((t !== 'section' && t !== 'web') || !Array.isArray(path)) return false;
      const s = L.s ?? [];
      if (L.para !== undefined) return JSON.stringify(path) === JSON.stringify(s) && a.paragraph === L.para;
      return JSON.stringify(path.slice(0, s.length)) === JSON.stringify(s);
    }
    case 'sh': {
      if (t !== 'sheet' || a.sheet !== L.sh) return false;
      if (!L.rows) return true;
      const x = L.rows[0];
      return isIntValue(a.row_from) && isIntValue(a.row_to) && a.row_from <= x && x <= a.row_to;
    }
  }
}

/** SPEC §5.4 on an open document. */
export async function locateIn(doc: SpdfDocument, reference: string): Promise<Location> {
  const empty: Location = { document: false, units: [], fragments: [], char: null, xywh: null };
  let L: AnchorLocator;
  if (reference.startsWith('spdf:')) {
    const parsed = parseAnchorUri(reference);
    if (parsed.docref !== `sha256-${doc.document.source_sha256}` && parsed.docref !== doc.document.id) return empty;
    L = parsed.locator;
  } else {
    const hash = reference.indexOf('#');
    const frag = hash >= 0 ? reference.slice(hash + 1) : '';
    L = frag ? parseAnchorUri(`spdf:x#${frag}`).locator : {};
  }
  const out: Location = { document: true, units: [], fragments: [], char: L.char ?? null, xywh: L.xywh ?? null };
  const rule = RULE_ORDER.find((r) => L[r] !== undefined);
  if (!rule) return out;
  const units = await doc.units();
  let unitIds = units.filter((u) => anchorMatches(rule, L, u.anchor, rule === 'f' ? u.printed : undefined)).map((u) => u.id);
  if (rule === 't' && !unitIds.length) {
    const timed = units.filter((u) => (u.anchor as { type?: string }).type === 'time');
    const last = timed[timed.length - 1];
    const t1 = last ? (last.anchor as { t1?: unknown }).t1 : undefined;
    if (last && isNumValue(t1) && t1 === (L.t as number[])[0]) unitIds = [last.id];
  }
  // Fragments match by their start anchor or by their end anchor.
  const all = await doc.fragments();
  let frags = all.filter((f) => anchorMatches(rule, L, f.anchor) || (f.anchor_end !== null && anchorMatches(rule, L, f.anchor_end)));
  if (!unitIds.length && frags.length) {
    const order = new Map(units.map((u) => [u.id, u.ord]));
    unitIds = [...new Set(frags.map((f) => f.unit))].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  }
  if (L.char) {
    // `char` refers to the text of the first unit found.
    const [c, d] = L.char;
    const first = unitIds[0];
    const overlaps = (x: unknown): boolean => {
      const ch = x && typeof x === 'object' ? (x as { chars?: unknown }).chars : undefined;
      if (!Array.isArray(ch) || ch.length !== 2) return false;
      const [a, b] = ch as [number, number];
      return c < d ? a < d && c < b : a <= c && c < b;
    };
    frags = frags.filter((f) => {
      if (f.unit === first && overlaps(f.anchor)) return true;
      const eu = endUnit(units, f.unit, f.anchor_end);
      return eu !== null && eu.id === first && overlaps(f.anchor_end);
    });
  }
  out.units = unitIds;
  out.fragments = frags.map((f) => f.id);
  return out;
}

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

  /**
   * Locates an anchor URI, or the URL of this file with an anchor fragment
   * (`https://…/quijote.spdf#p=5&f=1r`), in this file (SPEC §5.4): the matching units and
   * fragments in reading order, and the `char` and `xywh` that narrow them. A URI for
   * another document gives `document: false` and empty lists.
   */
  async locate(reference: string): Promise<Location> {
    return locateIn(this, reference);
  }

  /**
   * Cites a quotation taken from a fragment (SPEC §18.2): by the unit the quotation lies in
   * (with `chars`), by the end unit of a crossing fragment, or by the range of both when it
   * spans them; never by the start anchor when the quotation is not in the start unit.
   */
  async citePassage(fragmentId: string, quote: string, locale: string = 'es'): Promise<PassageCitation> {
    return citePassageIn(this, fragmentId, quote, locale);
  }

  /** The first unit `locate` finds (null if none, or if the URI is for another document). */
  async resolve(reference: string): Promise<Resolution | null> {
    const l = await this.locate(reference);
    const first = l.units[0];
    if (!l.document || first === undefined) return null;
    const u = await this.unitById(first);
    return u ? { unit: u.id, ord: u.ord, fragments: l.fragments, chars: l.char, xywh: l.xywh } : null;
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
