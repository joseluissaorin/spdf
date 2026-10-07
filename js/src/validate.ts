/**
 * Validation (contract §12), in the contract's order and with the same rules as the
 * reference oracle (`conformance/tools/spdfref.py`). `validate()` never throws on a bad
 * file: problems become errors (`valid: false`) or warnings.
 */

import type { RandomAccessSource, SqlConnection, SqlValue } from './port.js';
import { SpdfError } from './errors.js';
import { sha256Hex } from './bytes.js';
import { openRaw, openSpdf, type OpenOptions, type RawOpen, type SpdfInput } from './document.js';
import { q, parseJson } from './view.js';
import { COLUMNS, DTYPE_SIZE, LEGACY_TRIGGERS, REQUIRED_META } from './schema.js';
import { checkAnchor, codePointLength } from './anchors.js';
import { contentSha256OfDump, verifyContentHash } from './integrity.js';
import { dumpDocument } from './dump.js';

export interface ValidationIssue {
  code: string;
  message: string;
  where: string | null;
}

export interface ValidationReport {
  valid: boolean;
  version: string | null;
  profile: string[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidateOptions extends OpenOptions {
  /** Run the FTS5 integrity check on an in-memory copy (default true). */
  ftsCheck?: boolean;
  /** Check blob hashes (default true). */
  blobCheck?: boolean;
}

const REQUIRED_TABLES: Record<string, readonly string[]> = { ...COLUMNS, fragments_fts: [] };

function jsonOk(s: SqlValue | undefined): boolean {
  if (typeof s !== 'string') return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Validates a file (bytes, Blob, path, or `{source}` for random-access reading). */
export async function validate(input: SpdfInput | { source: RandomAccessSource; head?: Uint8Array }, options: ValidateOptions = {}): Promise<ValidationReport> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let version: string | null = null;
  let profile: string[] = [];
  const result = (): ValidationReport => ({ valid: errors.length === 0, version, profile, errors, warnings });
  const errHard = (code: string, message: string, where: string | null = null) => errors.push({ code, message, where });
  let err = errHard;
  const warn = (code: string, message: string, where: string | null = null) => warnings.push({ code, message, where });

  let raw: RawOpen;
  try {
    raw = await openRaw(input, options);
  } catch (e) {
    err('E001', e instanceof SpdfError ? e.message.replace(/^E\d+: /, '') : `cannot open: ${(e as Error).message}`);
    return result();
  }
  const { conn, info } = raw;
  try {
    if (!info.version || info.version === '3.0') {
      err('E002', 'unknown application_id or user_version');
      return result();
    }
    version = info.version;
    if (info.legacy) {
      warn('W110', `legacy SPDF ${info.version} file`);
      for (const t of ['spdf', 'documentos', 'unidades', 'fragmentos', 'fragmentos_fts']) if (!info.tables.has(t)) err('E010', `missing legacy table ${t}`, t);
      for (const r of await conn.all("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')")) {
        if (!(r.type === 'trigger' && (LEGACY_TRIGGERS as readonly string[]).includes(String(r.name)))) err('E020', `${String(r.type)} ${String(r.name)} present`, String(r.name));
      }
      return result();
    }
    if (raw.gzipped) warn('E003', 'SPDF 5.0 should not be gzip-wrapped');
    if (version !== '5.0') {
      warn('W105', `newer minor version ${version}`);
      // Forward compatibility (SPEC §22.1 step 4, §23): a later minor may define new anchor
      // types and dtypes, so for such a file E041 and E032 are warnings.
      err = (code: string, message: string, where: string | null = null) => (code === 'E041' || code === 'E032' ? warn : errHard)(code, message, where);
    }
    for (const r of await conn.all("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')")) err('E020', `${String(r.type)} ${String(r.name)} present`, String(r.name));
    for (const f of info.forbidden) if (f.type === 'virtual table') err('E020', `virtual table ${f.name} present`, f.name);

    const present = new Map<string, Set<string>>();
    for (const [t, cols] of Object.entries(REQUIRED_TABLES)) {
      if (!info.tables.has(t)) {
        err('E010', `missing table ${t}`, t);
        continue;
      }
      const have = new Set((await conn.all(`PRAGMA table_info(${q(t)})`)).map((r) => String(r.name)));
      present.set(t, have);
      for (const c of cols) if (!have.has(c)) err('E011', `missing column ${t}.${c}`, `${t}.${c}`);
    }
    const ok = (t: string, ...cols: string[]): boolean => {
      const have = present.get(t);
      return !!have && cols.every((c) => have.has(c));
    };

    const meta: Record<string, string> = {};
    if (ok('spdf_meta', 'key', 'value')) {
      for (const r of await conn.all('SELECT key, value FROM spdf_meta')) meta[String(r.key)] = String(r.value);
      for (const k of REQUIRED_META) if (!(k in meta)) err('E012', `missing spdf_meta key ${k}`, k);
      profile = (meta.profile ?? '').split(/\s+/).filter(Boolean);
    }

    let docs: Array<{ id: SqlValue; metadata: SqlValue; rights: SqlValue; unit_count: SqlValue }> = [];
    if (ok('documents', 'id', 'metadata')) {
      docs = ok('documents', 'rights', 'unit_count')
        ? ((await conn.all('SELECT id, metadata, rights, unit_count FROM documents')) as typeof docs)
        : (await conn.all('SELECT id, metadata FROM documents')).map((r) => ({ id: r.id ?? null, metadata: r.metadata ?? null, rights: null, unit_count: null }));
      if (docs.length !== 1) err('E013', `documents has ${docs.length} rows`, 'documents');
      for (const d of docs) {
        const did = String(d.id);
        try {
          if (typeof d.metadata !== 'string') throw new Error('not text');
          const o = JSON.parse(d.metadata) as Record<string, unknown> | null;
          if (!(o && typeof o === 'object' && !Array.isArray(o) && typeof o.type === 'string' && typeof o.title === 'string')) {
            err('E051', 'metadata needs a string type and title', did);
          }
        } catch {
          err('E050', 'metadata is not valid JSON', did);
        }
        if (d.rights !== null && d.rights !== undefined && !jsonOk(d.rights)) err('E050', 'rights is not valid JSON', did);
      }
    }

    if (ok('extensions', 'name', 'required')) {
      for (const r of await conn.all('SELECT name, required FROM extensions ORDER BY name')) {
        if (Number(r.required)) err('E060', `unknown required extension ${String(r.name)}`, String(r.name));
      }
    }

    const texts = new Map<string, string>();
    if (ok('units', 'id', 'ord', 'anchor', 'text')) {
      const units = await conn.all('SELECT id, ord, anchor, text FROM units ORDER BY ord, id');
      if (!units.every((u, i) => typeof u.ord === 'number' && u.ord === i + 1)) err('E090', 'units.ord is not 1..N', 'units');
      const d0 = docs[0];
      if (docs.length === 1 && d0 && d0.unit_count !== null && d0.unit_count !== undefined && Number(d0.unit_count) !== units.length) {
        warn('W102', `unit_count ${String(d0.unit_count)} but ${units.length} units`, 'documents.unit_count');
      }
      for (const u of units) {
        const text = typeof u.text === 'string' ? u.text : String(u.text ?? '');
        texts.set(String(u.id), text);
        anchorError(err, u.anchor, text, `units/${String(u.id)}`);
      }
    }
    if (ok('fragments', 'id', 'unit', 'anchor')) {
      const hasEnd = present.get('fragments')?.has('anchor_end') ?? false;
      for (const f of await conn.all(`SELECT id, unit, anchor, ${hasEnd ? 'anchor_end' : 'NULL'} AS anchor_end FROM fragments ORDER BY n`)) {
        anchorError(err, f.anchor, texts.get(String(f.unit)), `fragments/${String(f.id)}`);
        if (f.anchor_end !== null && f.anchor_end !== undefined) anchorError(err, f.anchor_end, undefined, `fragments/${String(f.id)}/anchor_end`);
      }
    }
    if (ok('figures', 'id', 'unit', 'anchor')) {
      for (const g of await conn.all('SELECT id, unit, anchor FROM figures ORDER BY id')) anchorError(err, g.anchor, texts.get(String(g.unit)), `figures/${String(g.id)}`);
    }

    const spaces = new Map<string, { dims: number; dtype: string }>();
    if (ok('spaces', 'id', 'dims', 'dtype')) {
      for (const s of await conn.all('SELECT id, dims, dtype FROM spaces ORDER BY id')) {
        const dtype = String(s.dtype);
        spaces.set(String(s.id), { dims: Number(s.dims), dtype });
        if (!(dtype in DTYPE_SIZE)) err('E032', `unknown dtype ${JSON.stringify(dtype)}`, String(s.id));
      }
    }
    let nvec = 0;
    if (ok('vectors', 'target', 'id', 'space', 'data')) {
      for (const v of await conn.all('SELECT target, id, space, typeof(data) AS t, length(data) AS len FROM vectors ORDER BY space, target, id')) {
        nvec++;
        const where = `vectors/${String(v.space)}/${String(v.target)}/${String(v.id)}`;
        const sp = spaces.get(String(v.space));
        if (!sp) {
          err('E031', `unknown space ${String(v.space)}`, where);
          continue;
        }
        const size = DTYPE_SIZE[sp.dtype];
        if (!size) continue;
        if (v.t !== 'blob' || Number(v.len) !== sp.dims * size) err('E030', `vector length ${v.t === 'blob' ? String(v.len) : '?'} != ${sp.dims} x ${size}`, where);
      }
    }

    if (info.tables.has('fragments_fts') && options.ftsCheck !== false) {
      let copy: SqlConnection | null = null;
      try {
        copy = await raw.engine.openBytes(await conn.serialize(), { readOnly: false });
        await copy.run("INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)");
        if (info.tables.has('fragments_fts_trigram')) await copy.run("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)");
      } catch (e) {
        err('E070', `FTS index out of sync: ${(e as Error).message}`, 'fragments_fts');
      } finally {
        await copy?.close();
      }
    }

    if (ok('blobs', 'key', 'sha256', 'data') && options.blobCheck !== false) {
      for (const k of await conn.all('SELECT key, sha256 FROM blobs ORDER BY key')) {
        const [d] = await conn.all('SELECT data FROM blobs WHERE key = ?', [k.key ?? null]);
        const data = d?.data instanceof Uint8Array ? d.data : new TextEncoder().encode(String(d?.data ?? ''));
        if ((await sha256Hex(data)) !== k.sha256) err('E080', 'blob sha256 mismatch', String(k.key));
      }
    }

    if ('content_sha256' in meta && errors.length === 0) {
      let actual: string;
      try {
        const doc = await openSpdf(await conn.serialize(), { engine: raw.engine });
        try {
          actual = await contentSha256OfDump(await dumpDocument(doc));
        } finally {
          await doc.close();
        }
      } catch (e) {
        actual = `unavailable (${(e as Error).message})`;
      }
      if (actual !== meta.content_sha256) err('E081', 'content_sha256 does not match the canonical dump', 'spdf_meta.content_sha256');
      else if ('signature' in meta) {
        const signer = meta.signer ?? '';
        const okSig = signer.startsWith('ed25519:') && (await verifyContentHash(meta.content_sha256 as string, meta.signature as string, signer));
        if (!okSig) err('E082', 'signature does not verify', 'spdf_meta.signature');
      }
    }

    if (profile.includes('semantic') && nvec === 0) warn('W100', 'profile semantic without vectors');
    if (profile.includes('media') && ok('units', 'anchor')) {
      let hasTime = false;
      for (const r of await conn.all('SELECT anchor FROM units')) {
        if (!jsonOk(r.anchor)) continue;
        const a = JSON.parse(r.anchor as string) as { type?: unknown } | null;
        if (a && typeof a === 'object' && a.type === 'time') hasTime = true;
      }
      if (!hasTime) warn('W101', 'profile media without time anchors');
    }
    return result();
  } catch (e) {
    err('E001', `unreadable database: ${(e as Error).message}`);
    return result();
  } finally {
    await conn.close();
  }
}

function anchorError(err: (code: string, message: string, where: string | null) => void, raw: SqlValue | undefined, text: string | undefined, where: string): void {
  let a: unknown;
  try {
    if (typeof raw !== 'string') throw new Error('not text');
    a = JSON.parse(raw);
  } catch {
    err('E040', 'anchor is not valid JSON', where);
    return;
  }
  const p = checkAnchor(a, text === undefined ? undefined : codePointLength(text.normalize('NFC')));
  if (p) err(p.code, p.message, where);
}

export { parseJson };
