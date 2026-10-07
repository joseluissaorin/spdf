/**
 * Validation (contract §12), in the contract's order. `validate()` never throws on a bad
 * file: problems become errors (`valid: false`) or warnings.
 */

import type { RandomAccessSource, SqlValue } from './port.js';
import { SpdfError } from './errors.js';
import { sha256Hex } from './bytes.js';
import { openRaw, openSpdf, type OpenOptions, type RawOpen, type SpdfInput } from './document.js';
import { View, q, parseJson } from './view.js';
import { COLUMNS, DTYPE_SIZE, LEGACY_COLUMNS, LEGACY_TABLES, REQUIRED_META, TABLES, type TableName } from './schema.js';
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

/** Legacy 4.0 columns (4.1 added `palabras` and `texto_busqueda`, which are optional). */
const LEGACY_OPTIONAL = new Set(['units.words', 'fragments.search_text']);

/** Validates a file (bytes, Blob, path, or `{source}` for random-access reading). */
export async function validate(input: SpdfInput | { source: RandomAccessSource; head?: Uint8Array }, options: ValidateOptions = {}): Promise<ValidationReport> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const report = (version: string | null, profile: string[] = []): ValidationReport => ({ valid: errors.length === 0, version, profile, errors, warnings });
  const err = (code: string, message: string, where: string | null = null) => errors.push({ code, message, where });
  const warn = (code: string, message: string, where: string | null = null) => warnings.push({ code, message, where });

  let raw: RawOpen;
  try {
    raw = await openRaw(input, options);
  } catch (e) {
    if (e instanceof SpdfError) err(e.code, e.message.replace(/^E\d+: /, ''), e.where ?? null);
    else err('E001', `cannot open: ${(e as Error).message}`);
    return report(null);
  }
  const { conn, info } = raw;
  try {
    // gzip
    if (raw.gzipped && !info.legacy && info.version) warn('E003', 'SPDF 5.0 files must not be gzip-wrapped');
    // application_id / user_version
    if (!info.version || info.version === '3.0') {
      err('E002', info.version === '3.0' ? 'SPDF 3.0 (Scholaris v1–v3) is not a 5.0 or 4.x file' : `unknown application_id ${info.applicationId} / user_version ${info.userVersion}`);
      return report(info.version);
    }
    if (!info.legacy && info.version !== '5.0') warn('W105', `newer minor version ${info.version}`);
    if (info.legacy) warn('W110', `legacy SPDF ${info.version} file`);
    // triggers / views
    for (const f of info.forbidden) err('E020', `${f.type} ${f.name} present`, f.name);

    const view = new View(conn, info);
    // required tables
    const present = new Set<TableName>();
    for (const t of TABLES) {
      if (info.legacy && t === 'extensions') continue;
      const name = info.legacy ? (LEGACY_TABLES[t] as string) : t;
      if (info.tables.has(name.toLowerCase())) present.add(t);
      else err('E010', `missing required table ${name}`, name);
    }
    const ftsName = info.legacy ? 'fragmentos_fts' : 'fragments_fts';
    if (!info.tables.has(ftsName)) err('E010', `missing required table ${ftsName}`, ftsName);
    // required columns
    for (const t of present) {
      const physical = view.tableName(t) as string;
      const cols = await view.columnsOf(physical);
      for (const c of COLUMNS[t]) {
        let name: string | null = c;
        if (info.legacy) {
          const m = LEGACY_COLUMNS[t];
          name = c in m ? (m[c] as string | null) : c;
          if (name === null || LEGACY_OPTIONAL.has(`${t}.${c}`)) continue;
        }
        if (!cols.has(name)) err('E011', `missing column ${physical}.${name}`, `${physical}.${name}`);
      }
    }
    // spdf_meta keys
    const meta: Record<string, string> = {};
    if (present.has('spdf_meta')) {
      try {
        for (const r of await view.rows('spdf_meta')) meta[String(r.key)] = String(r.value);
      } catch {
        /* reported as E011 */
      }
      if (!info.legacy) for (const k of REQUIRED_META) if (meta[k] === undefined) err('E012', `missing spdf_meta key ${k}`, `spdf_meta.${k}`);
    }
    const version = info.legacy ? info.version : (meta.spdf_version ?? info.version);
    const profile = (meta.profile ?? '').split(/\s+/).filter(Boolean);
    if (!present.has('documents')) return report(version, profile);

    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        err('E011', `cannot read: ${(e as Error).message}`);
        return fallback;
      }
    };

    // exactly one document
    const docs = await safe(() => view.rows('documents', { raw: true, orderBy: 'id' }), []);
    if (docs.length !== 1) err('E013', `documents holds ${docs.length} rows`, 'documents');
    // metadata / rights
    for (const d of docs) {
      const where = `documents/${String(d.id)}`;
      let m: unknown;
      try {
        m = JSON.parse(String(d.metadata));
      } catch {
        err('E050', 'metadata is not valid JSON', `${where}/metadata`);
        continue;
      }
      if (!info.legacy) {
        const o = m as Record<string, unknown> | null;
        if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.type !== 'string' || typeof o.title !== 'string') {
          err('E051', 'metadata has no string "type" and "title"', `${where}/metadata`);
        }
        if (d.rights !== null && d.rights !== undefined) {
          try {
            const r = JSON.parse(String(d.rights));
            if (r !== null && (typeof r !== 'object' || Array.isArray(r))) err('E050', 'rights is not a JSON object', `${where}/rights`);
          } catch {
            err('E050', 'rights is not valid JSON', `${where}/rights`);
          }
        }
      } else if (!m || typeof m !== 'object' || typeof (m as Record<string, unknown>).titulo !== 'string') {
        err('E051', 'legacy metadata has no "titulo"', `${where}/metadata`);
      }
    }
    // extensions
    if (!info.legacy && present.has('extensions')) {
      const req = await safe(() => conn.all('SELECT name FROM extensions WHERE required <> 0 ORDER BY name'), []);
      for (const r of req) err('E060', `unknown required extension ${String(r.name)}`, `extensions/${String(r.name)}`);
    }
    // units.ord
    const units = present.has('units') ? await safe(() => view.rows('units', { orderBy: 'ord, id', columns: ['id', 'ord', 'anchor', 'text'] }), []) : [];
    if (!info.legacy) {
      let expected = 1;
      for (const u of units) {
        if (Number(u.ord) !== expected) {
          err('E090', `units.ord is not contiguous from 1 (found ${String(u.ord)} where ${expected} was expected)`, `units/${String(u.id)}`);
          break;
        }
        expected++;
      }
    }
    // anchors
    const textLength = new Map<string, number>();
    let hasTime = false;
    for (const u of units) {
      const len = codePointLength(String(u.text ?? ''));
      textLength.set(String(u.id), len);
      const p = checkAnchor(u.anchor, len);
      if (p) err(p.code, p.message, `units/${String(u.id)}/anchor`);
      if (u.anchor && typeof u.anchor === 'object' && (u.anchor as { type?: unknown }).type === 'time') hasTime = true;
    }
    if (present.has('fragments')) {
      const frags = await safe(() => view.rows('fragments', { orderBy: 'n', columns: ['n', 'id', 'unit', 'anchor', 'anchor_end'] }), []);
      for (const f of frags) {
        const p = checkAnchor(f.anchor, textLength.get(String(f.unit)));
        if (p) err(p.code, p.message, `fragments/${String(f.id)}/anchor`);
        if (f.anchor_end !== null && f.anchor_end !== undefined) {
          const pe = checkAnchor(f.anchor_end);
          if (pe) err(pe.code, pe.message, `fragments/${String(f.id)}/anchor_end`);
        }
      }
    }
    if (present.has('figures')) {
      const figs = await safe(() => view.rows('figures', { orderBy: 'id', columns: ['id', 'unit', 'anchor'] }), []);
      for (const f of figs) {
        const p = checkAnchor(f.anchor, textLength.get(String(f.unit)));
        if (p) err(p.code, p.message, `figures/${String(f.id)}/anchor`);
      }
    }
    // spaces / vectors
    let vectorCount = 0;
    if (present.has('spaces') && present.has('vectors')) {
      const spaces = await safe(() => view.rows('spaces', { orderBy: 'id', columns: ['id', 'dims', 'dtype'] }), []);
      const byId = new Map<string, { dims: number; dtype: string }>();
      for (const s of spaces) {
        const dtype = String(s.dtype ?? 'f32');
        if (!(dtype in DTYPE_SIZE)) err('E032', `space ${String(s.id)} has unknown dtype ${dtype}`, `spaces/${String(s.id)}`);
        byId.set(String(s.id), { dims: Number(s.dims), dtype });
      }
      const vt = view.tableName('vectors') as string;
      const rows = await safe(
        () =>
          view.expr('vectors', 'data').then(async (data) =>
            conn.all(
              `SELECT ${await view.expr('vectors', 'target')} AS target, ${await view.expr('vectors', 'id')} AS id, ${await view.expr('vectors', 'space')} AS space, length(${data}) AS len FROM ${q(vt)} ORDER BY 1, 2, 3`,
            ),
          ),
        [],
      );
      vectorCount = rows.length;
      const unknown = new Set<string>();
      for (const r of rows) {
        const sid = String(r.space);
        const s = byId.get(sid);
        const where = `vectors/${String(r.target)}/${String(r.id)}/${sid}`;
        if (!s) {
          if (!unknown.has(sid)) err('E031', `vector space ${sid} is not in spaces`, where);
          unknown.add(sid);
          continue;
        }
        const size = DTYPE_SIZE[s.dtype];
        if (size && Number(r.len) !== s.dims * size) err('E030', `vector length ${String(r.len)} ≠ ${s.dims} × ${size}`, where);
      }
    }
    // FTS integrity on an in-memory copy
    if (options.ftsCheck !== false && info.tables.has(ftsName)) {
      try {
        const bytes = await conn.serialize();
        const copy = await raw.engine.openBytes(bytes, { readOnly: false });
        try {
          await copy.exec('PRAGMA trusted_schema = OFF;');
          await copy.run(`INSERT INTO ${q(ftsName)}(${q(ftsName)}, rank) VALUES ('integrity-check', 1)`);
          if (info.trigram && !info.legacy) await copy.run("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)");
        } finally {
          await copy.close();
        }
      } catch (e) {
        err('E070', `FTS index out of sync: ${(e as Error).message}`, ftsName);
      }
    }
    // blobs
    if (!info.legacy && present.has('blobs') && options.blobCheck !== false) {
      const keys = await safe(() => conn.all('SELECT key, sha256 FROM blobs ORDER BY key'), []);
      for (const k of keys) {
        const [d] = await conn.all('SELECT data FROM blobs WHERE key = ?', [k.key as SqlValue]);
        const data = d?.data instanceof Uint8Array ? d.data : new TextEncoder().encode(String(d?.data ?? ''));
        const h = await sha256Hex(data);
        if (String(k.sha256 ?? '').toLowerCase() !== h) err('E080', `blob ${String(k.key)} sha256 mismatch`, `blobs/${String(k.key)}`);
      }
    }
    // integrity
    if (!info.legacy && (meta.content_sha256 !== undefined || meta.signature !== undefined) && docs.length >= 1 && errors.every((e) => e.code !== 'E020')) {
      try {
        const doc = await openSpdf(await conn.serialize(), { ...(options.engine ? { engine: options.engine } : { engine: raw.engine }) });
        try {
          const hash = await contentSha256OfDump(await dumpDocument(doc));
          if (meta.content_sha256 !== undefined && meta.content_sha256 !== hash) err('E081', 'content_sha256 does not match the content', 'spdf_meta.content_sha256');
          if (meta.signature !== undefined) {
            const ok = meta.signer ? await verifyContentHash(meta.content_sha256 ?? hash, meta.signature, meta.signer) : false;
            if (!ok) err('E082', meta.signer ? 'signature does not verify' : 'signature without signer', 'spdf_meta.signature');
          }
        } finally {
          await doc.close();
        }
      } catch (e) {
        if (e instanceof SpdfError) {
          /* already reported */
        } else err('E081', `cannot compute content_sha256: ${(e as Error).message}`, 'spdf_meta.content_sha256');
      }
    }
    // profile warnings
    if (profile.includes('semantic') && vectorCount === 0) warn('W100', 'profile semantic without vectors');
    if (profile.includes('media') && !hasTime) warn('W101', 'profile media without time anchors');
    for (const d of docs) {
      const uc = Number(info.legacy ? d.unit_count : d.unit_count);
      if (Number.isFinite(uc) && uc !== units.length) warn('W102', `unit_count ${uc} ≠ ${units.length} units`, `documents/${String(d.id)}`);
    }
    return report(version, profile);
  } finally {
    await conn.close();
  }
}

export { parseJson };
