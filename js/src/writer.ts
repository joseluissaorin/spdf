/**
 * Writing SPDF 5.0: `SpdfWriter` builds a valid file (schema, FTS index kept in sync,
 * no triggers, `VACUUM`ed), and `convertLegacy` turns a 4.x file into a 5.0 one.
 */

import type { SqlConnection, SqlEngine, SqlValue } from './port.js';
import { resolveEngine } from './port.js';
import { APPLICATION_ID, SCHEMA_50, SCHEMA_50_TRIGRAM, SPDF_VERSION, USER_VERSION } from './schema.js';
import { sha256Hex, toBytes, fromBase64 } from './bytes.js';
import { encodeVector, dtypeSize } from './vectors.js';
import { openSpdf, type OpenOptions, type SpdfDocument, type SpdfInput } from './document.js';
import { contentSha256OfDump, importPrivateKey, signContentHash, signerOf } from './integrity.js';
import { dumpDocument } from './dump.js';
import type { Anchor, CslItem, Dtype, Rights, VectorTarget, WordTimings } from './types.js';
import { VERSION } from './version.js';

export interface WriterOptions {
  engine?: SqlEngine;
  /** `generator` meta key; default `spdf-format/<version>`. */
  generator?: string;
  /** Also build the optional CJK `fragments_fts_trigram` index. */
  trigram?: boolean;
}

export interface DocumentInput {
  id: string;
  kind: string;
  metadata: CslItem;
  source_sha256: string;
  source_ref?: string | null;
  mime: string;
  bytes: number;
  /** Default: the number of units at `finish()`. */
  unit_count?: number;
  duration?: number | null;
  created?: string;
  updated?: string;
  /** Denormalized columns; derived from `metadata` when absent. */
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  language?: string | null;
  rights?: Rights | null;
}

export interface UnitInput {
  id: string;
  /** Default: position + 1. */
  ord?: number;
  anchor: Anchor;
  text?: string;
  notes?: string[] | null;
  header?: string | null;
  footer?: string | null;
  image?: string | null;
  thumbnail?: string | null;
  reader: string;
  confidence?: number;
  /** Denormalized from the anchor when absent. */
  printed?: string | null;
  t0?: number | null;
  t1?: number | null;
  words?: WordTimings | null;
}

export interface SectionInput {
  id: string;
  parent?: string | null;
  level: number;
  title: string;
  unit_from: string;
  unit_to?: string | null;
  summary?: string | null;
}

export interface FragmentInput {
  /** Rowid; default: next free. */
  n?: number;
  id: string;
  unit: string;
  /** Reading order; default: position. */
  ord?: number;
  text: string;
  context?: string;
  section?: string[] | null;
  anchor: Anchor;
  anchor_end?: Anchor | null;
  search_text?: string | null;
}

export interface FigureInput {
  id: string;
  unit: string;
  image: string;
  caption?: string | null;
  description?: string | null;
  anchor: Anchor;
}

export interface SpaceInput {
  /** Default `<model>@<dims>` (f32) or `<model>@<dims>:<dtype>`. */
  id?: string;
  provider: string;
  model: string;
  version?: string | null;
  dims: number;
  dtype?: Dtype;
  normalized?: boolean | number;
  truncated_from?: number | null;
  modalities: string[];
  task_prefixes?: Record<string, unknown> | null;
  created?: string | null;
}

export interface VectorInput {
  target: VectorTarget;
  id: string;
  /** Values (quantized to the space dtype) or the already encoded little-endian bytes. */
  vector?: ArrayLike<number>;
  data?: Uint8Array;
}

export interface ProvenanceInput {
  stage: string;
  provider?: string | null;
  model?: string | null;
  /** A JSON object (or null); other JSON values are kept as they are for legacy fidelity. */
  detail?: unknown;
  ms?: number | null;
  at?: string;
}

export interface FinishOptions {
  /** Store `content_sha256` (default false). */
  contentHash?: boolean;
  /** Sign with this Ed25519 private key (CryptoKey, 32-byte seed or PKCS#8); implies `contentHash`. */
  signWith?: CryptoKey | Uint8Array;
}

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** 'Family; Family' from CSL authors. */
export function authorsColumn(m: CslItem): string | null {
  const names = (m.author ?? []).map((a) => a.family ?? a.literal ?? a.given ?? '').filter(Boolean);
  return names.length ? names.join('; ') : null;
}

function yearOfMetadata(m: CslItem): number | null {
  const y = m.issued?.['date-parts']?.[0]?.[0];
  const n = typeof y === 'number' ? y : typeof y === 'string' && /^-?\d+$/.test(y) ? Number(y) : NaN;
  return Number.isFinite(n) ? n : null;
}

function printedOf(a: Anchor): string | null {
  if (a.type === 'page' || a.type === 'section' || a.type === 'verse') return a.printed ?? null;
  return null;
}

/** Builds an SPDF 5.0 file. Call the `add…` methods, then `finish()`. */
export class SpdfWriter {
  private meta = new Map<string, string>();
  private documentId: string | null = null;
  private documentHasUnitCount = false;
  private nextN = 1;
  private fragmentCount = 0;
  private unitCount = 0;
  private spaces = new Map<string, { dims: number; dtype: Dtype }>();
  private finished = false;
  private hasTimeAnchor = false;
  private hasVectors = false;

  private constructor(
    private readonly conn: SqlConnection,
    private readonly engine: SqlEngine,
    private readonly options: WriterOptions,
  ) {}

  /** An empty SPDF 5.0. */
  static async create(options: WriterOptions = {}): Promise<SpdfWriter> {
    const engine = await resolveEngine(options.engine);
    const conn = await engine.create();
    await conn.exec(`PRAGMA page_size = 4096; PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${USER_VERSION};`);
    await conn.exec(SCHEMA_50);
    if (options.trigram) await conn.exec(SCHEMA_50_TRIGRAM);
    const w = new SpdfWriter(conn, engine, options);
    await w.setMeta('spdf_version', SPDF_VERSION);
    return w;
  }

  /**
   * A writer holding a full copy of an open document in its 5.0 form (a legacy 4.x file
   * is converted). Integrity fields (`content_sha256`, `signature`, `signer`) are dropped.
   */
  static async fromSpdf(doc: SpdfDocument, options: WriterOptions = {}): Promise<SpdfWriter> {
    const w = await SpdfWriter.create({ ...options, engine: options.engine ?? doc.engine, trigram: options.trigram ?? doc.view.info.trigram });
    const skip = new Set(['content_sha256', 'signature', 'signer', 'spdf_version', 'generator']);
    if (doc.legacy) {
      for (const k of ['created', 'profile', 'license_note']) if (doc.meta[k] !== undefined) await w.setMeta(k, doc.meta[k] as string);
    } else {
      for (const [k, v] of Object.entries(doc.meta)) if (!skip.has(k)) await w.setMeta(k, v);
    }
    const d = doc.document;
    await w.setDocument({ ...d, unit_count: d.unit_count });
    await w.addUnits((await doc.units()).map(({ document: _d, ...u }) => u));
    await w.addSections((await doc.sections()).map(({ document: _d, ...s }) => s));
    await w.addFragments((await doc.fragments()).map(({ document: _d, anchor_uri: _u, ...f }) => f));
    await w.addFigures((await doc.figures()).map(({ document: _d, ...f }) => f));
    for (const s of await doc.spaces()) {
      await w.addSpace(s);
      const vt = doc.view.tableName('vectors');
      if (!vt) continue;
      const rows = await doc.view.rows('vectors', { where: `${await doc.view.expr('vectors', 'space')} = ?`, params: [s.id], orderBy: 'target, id' });
      await w.addVectors(
        s.id,
        rows.map((r) => ({ target: String(r.target) as VectorTarget, id: String(r.id), data: r.data as Uint8Array })),
      );
    }
    for (const b of await doc.blobs()) {
      const full = await doc.blob(b.key);
      if (full) await w.addBlob(full.key, full.mime, full.data);
    }
    for (const p of await doc.provenance()) {
      await w.addProvenance(p);
    }
    for (const e of await doc.extensions()) await w.addExtension(e.name, e.version, e.required);
    return w;
  }

  /** The underlying (writable) connection, for extension tables (`x_<vendor>_<name>`). */
  get connection(): SqlConnection {
    return this.conn;
  }

  private check(): void {
    if (this.finished) throw new Error('This SpdfWriter is finished.');
  }

  async setMeta(key: string, value: string): Promise<this> {
    this.check();
    this.meta.set(key, value);
    await this.conn.run('INSERT INTO spdf_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    return this;
  }

  async setDocument(d: DocumentInput): Promise<this> {
    this.check();
    const created = d.created ?? nowIso();
    const m = d.metadata;
    const row: SqlValue[] = [
      d.id,
      d.kind,
      JSON.stringify(m),
      d.source_sha256.toLowerCase(),
      d.source_ref ?? null,
      d.mime,
      d.bytes,
      d.unit_count ?? 0,
      d.duration ?? null,
      created,
      d.updated ?? created,
      'title' in d ? (d.title ?? null) : typeof m.title === 'string' ? m.title : null,
      'authors' in d ? (d.authors ?? null) : authorsColumn(m),
      'year' in d ? (d.year ?? null) : yearOfMetadata(m),
      'language' in d ? (d.language ?? null) : typeof m.language === 'string' ? m.language : null,
      json(d.rights ?? null),
    ];
    await this.conn.run('DELETE FROM documents', []);
    await this.conn.run(
      `INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row,
    );
    this.documentId = d.id;
    this.documentHasUnitCount = d.unit_count !== undefined;
    if (!this.meta.has('document_id') || this.meta.get('document_id') !== d.id) await this.setMeta('document_id', d.id);
    return this;
  }

  private doc(): string {
    if (!this.documentId) throw new Error('Call setDocument() first.');
    return this.documentId;
  }

  async addUnits(units: readonly UnitInput[]): Promise<this> {
    this.check();
    const doc = this.doc();
    for (const u of units) {
      this.unitCount++;
      const a = u.anchor;
      if (a && a.type === 'time') this.hasTimeAnchor = true;
      await this.conn.run(
        `INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          u.id,
          doc,
          u.ord ?? this.unitCount,
          JSON.stringify(a),
          (u.text ?? '').normalize('NFC'),
          json(u.notes ?? null),
          u.header ?? null,
          u.footer ?? null,
          u.image ?? null,
          u.thumbnail ?? null,
          u.reader,
          u.confidence ?? 1,
          'printed' in u ? (u.printed ?? null) : printedOf(a),
          't0' in u ? (u.t0 ?? null) : a.type === 'time' ? a.t0 : null,
          't1' in u ? (u.t1 ?? null) : a.type === 'time' ? (a.t1 ?? null) : null,
          json(u.words ?? null),
        ],
      );
    }
    return this;
  }

  async addSections(sections: readonly SectionInput[]): Promise<this> {
    this.check();
    const doc = this.doc();
    for (const s of sections) {
      await this.conn.run('INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        s.id,
        doc,
        s.parent ?? null,
        s.level,
        s.title,
        s.unit_from,
        s.unit_to ?? null,
        s.summary ?? null,
      ]);
    }
    return this;
  }

  async addFragments(fragments: readonly FragmentInput[]): Promise<this> {
    this.check();
    const doc = this.doc();
    for (const f of fragments) {
      const n = f.n ?? this.nextN;
      this.nextN = Math.max(this.nextN, n + 1);
      this.fragmentCount++;
      await this.conn.run(
        `INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n,
          f.id,
          doc,
          f.unit,
          f.ord ?? this.fragmentCount,
          f.text.normalize('NFC'),
          f.context ?? '',
          json(f.section ?? null),
          JSON.stringify(f.anchor),
          json(f.anchor_end ?? null),
          f.search_text ?? null,
        ],
      );
    }
    return this;
  }

  async addFigures(figures: readonly FigureInput[]): Promise<this> {
    this.check();
    const doc = this.doc();
    for (const f of figures) {
      await this.conn.run('INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        f.id,
        doc,
        f.unit,
        f.image,
        f.caption ?? null,
        f.description ?? null,
        JSON.stringify(f.anchor),
      ]);
    }
    return this;
  }

  /** Registers a vector space and returns its id. */
  async addSpace(s: SpaceInput): Promise<string> {
    this.check();
    const dtype: Dtype = s.dtype ?? 'f32';
    dtypeSize(dtype);
    const id = s.id ?? `${s.model}@${s.dims}${dtype === 'f32' ? '' : `:${dtype}`}`;
    const normalized = typeof s.normalized === 'number' ? s.normalized : s.normalized === false ? 0 : 1;
    await this.conn.run(
      `INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, s.provider, s.model, s.version ?? null, s.dims, dtype, normalized, s.truncated_from ?? null, JSON.stringify(s.modalities), json(s.task_prefixes ?? null), s.created === undefined ? nowIso() : s.created],
    );
    this.spaces.set(id, { dims: s.dims, dtype });
    return id;
  }

  /** Adds vectors to a space (values are quantized to its dtype). */
  async addVectors(spaceId: string, vectors: readonly VectorInput[]): Promise<this> {
    this.check();
    const doc = this.doc();
    const space = this.spaces.get(spaceId);
    if (!space) throw new Error(`Unknown space «${spaceId}»: call addSpace() first.`);
    const size = space.dims * dtypeSize(space.dtype);
    for (const v of vectors) {
      const data = v.data ?? (v.vector ? encodeVector(v.vector, space.dtype) : null);
      if (!data) throw new Error(`Vector ${v.target}/${v.id} has neither values nor data.`);
      if (data.byteLength !== size) throw new Error(`Vector ${v.target}/${v.id}: ${data.byteLength} bytes, expected ${size} (${space.dims} × ${space.dtype}).`);
      await this.conn.run('INSERT INTO vectors (target, id, space, document, data) VALUES (?, ?, ?, ?, ?)', [v.target, v.id, spaceId, doc, data]);
      this.hasVectors = true;
    }
    return this;
  }

  /** Embeds a blob; returns its reference (`blob:<key>`). */
  async addBlob(key: string, mime: string, data: Uint8Array | ArrayBuffer): Promise<string> {
    this.check();
    const bytes = toBytes(data);
    await this.conn.run('INSERT INTO blobs (key, mime, sha256, data) VALUES (?, ?, ?, ?)', [key, mime, await sha256Hex(bytes), bytes]);
    return `blob:${key}`;
  }

  async addProvenance(p: ProvenanceInput): Promise<this> {
    this.check();
    await this.conn.run('INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      this.doc(),
      p.stage,
      p.provider ?? null,
      p.model ?? null,
      json(p.detail ?? null),
      p.ms ?? null,
      p.at ?? nowIso(),
    ]);
    return this;
  }

  async addExtension(name: string, version: string, required = false): Promise<this> {
    this.check();
    await this.conn.run('INSERT INTO extensions (name, version, required) VALUES (?, ?, ?)', [name, version, required ? 1 : 0]);
    return this;
  }

  /** Rebuilds the FTS index(es), fills the required meta keys, VACUUMs and returns the file. */
  async finish(options: FinishOptions = {}): Promise<Uint8Array> {
    this.check();
    this.doc();
    if (!this.documentHasUnitCount) await this.conn.run('UPDATE documents SET unit_count = (SELECT count(*) FROM units)', []);
    if (!this.meta.has('profile')) {
      const p = ['core'];
      if (this.hasVectors) p.push('semantic');
      if (this.hasTimeAnchor) p.push('media');
      await this.setMeta('profile', p.join(' '));
    }
    if (!this.meta.has('created')) await this.setMeta('created', nowIso());
    if (!this.meta.has('generator')) await this.setMeta('generator', this.options.generator ?? `spdf-format/${VERSION}`);
    await this.conn.exec("INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild');");
    const [tri] = await this.conn.all("SELECT count(*) AS n FROM sqlite_master WHERE name = 'fragments_fts_trigram'");
    if (Number(tri?.n ?? 0) > 0) await this.conn.exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES('rebuild');");
    if (options.contentHash || options.signWith) {
      for (const k of ['content_sha256', 'signature', 'signer']) {
        await this.conn.run('DELETE FROM spdf_meta WHERE key = ?', [k]);
        this.meta.delete(k);
      }
      const snapshot = await this.conn.serialize();
      const copy = await openSpdf(snapshot, { engine: this.engine });
      let hash: string;
      try {
        hash = await contentSha256OfDump(await dumpDocument(copy));
      } finally {
        await copy.close();
      }
      await this.setMeta('content_sha256', hash);
      if (options.signWith) {
        const key = await importPrivateKey(options.signWith);
        await this.setMeta('signature', await signContentHash(hash, key));
        const pub = await publicKeyOf(key, options.signWith);
        if (pub) await this.setMeta('signer', pub);
      }
    }
    await this.conn.exec('VACUUM;');
    const bytes = await this.conn.serialize();
    this.finished = true;
    await this.conn.close();
    return bytes;
  }

  /** Discards the writer without producing a file. */
  async abort(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.conn.close();
  }
}

/** `ed25519:<base64>` of the public key matching a private key, when it can be derived. */
async function publicKeyOf(key: CryptoKey, original: CryptoKey | Uint8Array): Promise<string | null> {
  try {
    // An extractable private key exports as JWK with the public part in `x`.
    const jwk = (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;
    if (jwk.x) {
      const b64 = jwk.x.replace(/-/g, '+').replace(/_/g, '/');
      const raw = fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const pub = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'Ed25519' }, true, ['verify']);
      return signerOf(pub);
    }
  } catch {
    /* non-extractable key */
  }
  void original;
  return null;
}

/** Converts a legacy 4.x file (gzip or not) into SPDF 5.0 bytes. */
export async function convertLegacy(input: SpdfInput, options: OpenOptions & WriterOptions & FinishOptions = {}): Promise<Uint8Array> {
  const doc = await openSpdf(input, options);
  try {
    const w = await SpdfWriter.fromSpdf(doc, options);
    return await w.finish(options);
  } finally {
    await doc.close();
  }
}
