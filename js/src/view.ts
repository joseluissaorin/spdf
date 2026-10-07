/**
 * The 5.0 view of an open database: the same rows whether the file is SPDF 5.0 or a
 * legacy 4.x file (Spanish names, mapped on the fly as in contract §7).
 *
 * Rows come back with 5.0 column names, JSON-in-TEXT columns parsed (kept as the raw
 * string if they are not valid JSON) and legacy values mapped.
 */

import type { SqlConnection, SqlRow, SqlValue } from './port.js';
import { APPLICATION_ID, COLUMNS, LEGACY_COLUMNS, LEGACY_TABLES, LEGACY_TRIGGERS, type TableName } from './schema.js';
import { mapLegacyAnchor, mapLegacyKind, mapLegacyMetaKey, mapLegacyMetadata, mapLegacyModalities, mapLegacyTarget } from './legacy.js';

export interface Inspection {
  /** '5.0', '4.0', '4.1', '3.0' or null if unknown. */
  version: string | null;
  legacy: boolean;
  applicationId: number;
  userVersion: number;
  /** Lower-cased names of tables (and virtual tables) in sqlite_master. */
  tables: Set<string>;
  /** Triggers and views that are not tolerated. */
  forbidden: Array<{ type: string; name: string }>;
  /** The FTS table of this file ('fragments_fts' or 'fragmentos_fts') and its CREATE statement. */
  fts: { table: string; sql: string; columns: string[] } | null;
  trigram: boolean;
}

export const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;

/** Reads what kind of SPDF (if any) an open database is. */
export async function inspect(conn: SqlConnection): Promise<Inspection> {
  const [app] = await conn.all('PRAGMA application_id');
  const [uv] = await conn.all('PRAGMA user_version');
  const applicationId = Number(Object.values(app ?? {})[0] ?? 0);
  const userVersion = Number(Object.values(uv ?? {})[0] ?? 0);
  const master = await conn.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'view', 'trigger')");
  const tables = new Set<string>();
  const triggers: Array<{ name: string; tbl: string }> = [];
  const views: string[] = [];
  const sqlOf = new Map<string, string>();
  for (const r of master) {
    const name = String(r.name);
    if (r.type === 'table') {
      tables.add(name.toLowerCase());
      sqlOf.set(name.toLowerCase(), String(r.sql ?? ''));
    } else if (r.type === 'view') views.push(name);
    else triggers.push({ name, tbl: String(r.tbl_name) });
  }
  let version: string | null = null;
  let legacy = false;
  if (applicationId === APPLICATION_ID) {
    if (userVersion >= 500 && userVersion <= 599) version = `${Math.floor(userVersion / 100)}.${Math.floor((userVersion % 100) / 10)}`;
  } else if (tables.has('spdf') && tables.has('documentos')) {
    legacy = true;
    let v: string | null = null;
    try {
      const [row] = await conn.all("SELECT valor FROM spdf WHERE clave = 'spdf_version'");
      if (row && typeof row.valor === 'string') v = row.valor;
    } catch {
      /* table without the expected columns */
    }
    if (!v && (userVersion === 400 || userVersion === 410)) v = userVersion === 400 ? '4.0' : '4.1';
    version = v && /^4\.\d+$/.test(v) ? v : v ? null : '4.0';
  } else if (tables.has('metadata') && tables.has('chunks')) {
    version = '3.0';
    legacy = true;
  }
  const tolerated = new Set<string>(legacy ? LEGACY_TRIGGERS : []);
  const allowedVtables = new Set(legacy ? ['fragmentos_fts'] : ['fragments_fts', 'fragments_fts_trigram']);
  const forbidden = [
    ...views.map((name) => ({ type: 'view', name })),
    ...triggers.filter((t) => !(tolerated.has(t.name) && t.tbl === 'fragmentos')).map((t) => ({ type: 'trigger', name: t.name })),
  ];
  for (const r of master) {
    const sql = String(r.sql ?? '');
    if (r.type !== 'table' || !/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) continue;
    if (!allowedVtables.has(String(r.name)) || !/USING\s+fts5\s*\(/i.test(sql)) forbidden.push({ type: 'virtual table', name: String(r.name) });
  }
  const ftsName = legacy ? 'fragmentos_fts' : 'fragments_fts';
  let fts: Inspection['fts'] = null;
  if (tables.has(ftsName)) {
    const sql = sqlOf.get(ftsName) ?? '';
    const inner = /\(([\s\S]*)\)\s*$/.exec(sql)?.[1] ?? '';
    const columns = splitTopLevel(inner)
      .map((s) => s.trim())
      .filter((s) => s && !s.includes('='))
      .map((s) => s.replace(/^["'`[]|["'`\]]$/g, ''));
    fts = { table: ftsName, sql, columns };
  }
  return { version, legacy, applicationId, userVersion, tables, forbidden, fts, trigram: tables.has('fragments_fts_trigram') };
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The `tokenize=` option of an FTS5 CREATE statement. */
export function tokenizerOf(sql: string): string {
  const m = /tokenize\s*=\s*(?:'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([^,\s)]+))/i.exec(sql);
  if (!m) return 'unicode61';
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/''/g, "'").replace(/""/g, '"');
}

export function parseJson(v: SqlValue | undefined): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const JSON_COLUMNS: Partial<Record<TableName, string[]>> = {
  documents: ['metadata', 'rights'],
  units: ['anchor', 'notes', 'words'],
  fragments: ['section', 'anchor', 'anchor_end'],
  figures: ['anchor'],
  spaces: ['modalities', 'task_prefixes'],
  provenance: ['detail'],
};

export type ViewRow = Record<string, unknown>;

export interface RowQuery {
  /** WHERE clause using `col('…')` expressions (5.0 names). */
  where?: string;
  params?: readonly SqlValue[];
  orderBy?: string;
  limit?: number;
  /** Columns to read (5.0 names); default all. */
  columns?: readonly string[];
  /** Keep JSON columns as text. */
  raw?: boolean;
}

/** Reads tables through the 5.0 names. */
export class View {
  private columnCache = new Map<string, Set<string>>();
  private blobKeys: Promise<Set<string>> | null = null;

  constructor(
    readonly conn: SqlConnection,
    readonly info: Inspection,
  ) {}

  get legacy(): boolean {
    return this.info.legacy;
  }

  /** Physical table name for a 5.0 table, or null if the file has none. */
  tableName(t: TableName): string | null {
    const name = this.info.legacy ? LEGACY_TABLES[t] : t;
    return name && this.info.tables.has(name.toLowerCase()) ? name : null;
  }

  async columnsOf(physical: string): Promise<Set<string>> {
    let c = this.columnCache.get(physical);
    if (!c) {
      const rows = await this.conn.all(`PRAGMA table_info(${q(physical)})`);
      c = new Set(rows.map((r) => String(r.name)));
      this.columnCache.set(physical, c);
    }
    return c;
  }

  /** SQL expression for a 5.0 column of a 5.0 table (NULL if the file lacks it). */
  async expr(t: TableName, col: string): Promise<string> {
    const physical = this.tableName(t);
    if (!physical) return 'NULL';
    if (this.info.legacy && t === 'units' && col === 'ord') return '"__ord"';
    let name: string | null = col;
    if (this.info.legacy) {
      const m = LEGACY_COLUMNS[t];
      name = col in m ? (m[col] as string | null) : col;
    }
    if (name === null) return 'NULL';
    const cols = await this.columnsOf(physical);
    return cols.has(name) ? q(name) : 'NULL';
  }

  /** FROM clause for a 5.0 table. */
  private from(t: TableName, physical: string): string {
    if (this.info.legacy && t === 'units') {
      return `(SELECT *, ROW_NUMBER() OVER (PARTITION BY "documento" ORDER BY "orden", "id") AS "__ord" FROM ${q(physical)})`;
    }
    return q(physical);
  }

  /** Builds `SELECT <expr> AS <col>, … FROM … WHERE … ORDER BY …`. */
  async select(t: TableName, query: RowQuery = {}): Promise<{ sql: string; params: readonly SqlValue[] } | null> {
    const physical = this.tableName(t);
    if (!physical) return null;
    const cols = query.columns ?? COLUMNS[t];
    const parts: string[] = [];
    for (const c of cols) parts.push(`${await this.expr(t, c)} AS ${q(c)}`);
    let sql = `SELECT ${parts.join(', ')} FROM ${this.from(t, physical)}`;
    if (query.where) sql += ` WHERE ${query.where}`;
    if (query.orderBy) sql += ` ORDER BY ${query.orderBy}`;
    if (query.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(query.limit))}`;
    return { sql, params: query.params ?? [] };
  }

  /** Rows of a 5.0 table in the 5.0 view. */
  async rows(t: TableName, query: RowQuery = {}): Promise<ViewRow[]> {
    const s = await this.select(t, query);
    if (!s) return [];
    const rows = await this.conn.all(s.sql, s.params);
    return Promise.all(rows.map((r) => this.mapRow(t, r, query.raw ?? false)));
  }

  private async keys(): Promise<Set<string>> {
    if (!this.blobKeys) {
      const t = this.tableName('blobs');
      this.blobKeys = t
        ? this.conn.all(`SELECT ${this.info.legacy ? '"clave"' : '"key"'} AS k FROM ${q(t)}`).then((rs) => new Set(rs.map((r) => String(r.k))))
        : Promise.resolve(new Set());
    }
    return this.blobKeys;
  }

  /** Legacy reference rule: '' → null (or '' for figures), blob key → 'blob:<key>'. */
  private async legacyRef(v: unknown, emptyStays = false): Promise<unknown> {
    if (v === null || v === undefined) return null;
    if (v === '') return emptyStays ? '' : null;
    if (typeof v === 'string' && (await this.keys()).has(v)) return `blob:${v}`;
    return v;
  }

  private async mapRow(t: TableName, r: SqlRow, raw: boolean): Promise<ViewRow> {
    const row: ViewRow = { ...r };
    if (!raw) for (const c of JSON_COLUMNS[t] ?? []) if (c in row) row[c] = parseJson(row[c] as SqlValue);
    if (!this.info.legacy) return row;
    switch (t) {
      case 'spdf_meta':
        if (typeof row.key === 'string') row.key = mapLegacyMetaKey(row.key);
        break;
      case 'documents': {
        const rawKind = typeof row.kind === 'string' ? row.kind : undefined;
        if (rawKind !== undefined) row.kind = mapLegacyKind(rawKind);
        if ('metadata' in row && !raw) {
          row.metadata = typeof row.metadata === 'object' && row.metadata !== null ? mapLegacyMetadata(row.metadata, rawKind) : row.metadata;
        }
        if ('source_ref' in row) row.source_ref = await this.legacyRef(row.source_ref);
        if ('rights' in row) row.rights = null;
        break;
      }
      case 'units':
        if ('anchor' in row && !raw) row.anchor = mapLegacyAnchor(row.anchor);
        if ('image' in row) row.image = await this.legacyRef(row.image);
        if ('thumbnail' in row) row.thumbnail = await this.legacyRef(row.thumbnail);
        break;
      case 'fragments':
        if ('anchor' in row && !raw) row.anchor = mapLegacyAnchor(row.anchor);
        if ('anchor_end' in row && !raw && row.anchor_end !== null) row.anchor_end = mapLegacyAnchor(row.anchor_end);
        break;
      case 'figures':
        if ('anchor' in row && !raw) row.anchor = mapLegacyAnchor(row.anchor);
        if ('image' in row) row.image = await this.legacyRef(row.image, true);
        break;
      case 'spaces':
        if ('dtype' in row) row.dtype = 'f32';
        if ('modalities' in row && !raw) row.modalities = mapLegacyModalities(row.modalities);
        break;
      case 'vectors':
        if (typeof row.target === 'string') row.target = mapLegacyTarget(row.target);
        break;
      default:
        break;
    }
    return row;
  }
}
