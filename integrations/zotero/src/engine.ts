/**
 * A `spdf-format` SQL engine over Zotero's own SQLite: `Sqlite.sys.mjs`
 * (`resource://gre/modules/Sqlite.sys.mjs`), the asynchronous mozStorage wrapper that
 * Zotero 7 (Firefox 115) and Zotero 8 (Firefox 140) ship.
 *
 * With it the whole `SpdfDocument` API (units, fragments, cite, anchor URIs, validate,
 * dump) runs inside Zotero without bundling a second SQLite. Only the thin
 * {@link EngineHost} touches Mozilla APIs; everything here is plain code that the
 * tests run in Node with `node:sqlite` standing in for `Sqlite.sys.mjs`.
 *
 * Safety (SPEC §2.4): files are opened with `readOnly: true` (`SQLITE_OPEN_READONLY`),
 * mozStorage keeps extension loading off and runs in defensive mode, and the core then
 * sets `PRAGMA query_only = 1` and `PRAGMA trusted_schema = OFF`. Bytes (a decompressed
 * legacy file, a copy for validation) go to a temporary file in Zotero's temp
 * directory, which is deleted when the connection closes.
 */

import type { EngineOpenOptions, SqlConnection, SqlEngine, SqlRow, SqlValue } from 'spdf-format/core';
import { gunzip, toLocalBytes, type DecompressionStreamCtor } from './bytes.js';
import { namePlaceholders, resultColumns, splitStatements } from './sql.js';

/** The part of `mozIStorageRow` the adapter uses (`mozIStorageValueArray` + row). */
export interface MozRow {
  readonly numEntries: number;
  getTypeOfIndex(index: number): number;
  getResultByIndex(index: number): unknown;
  getResultByName(name: string): unknown;
}

/** The part of `Sqlite.sys.mjs`'s `OpenedConnection` the adapter uses. */
export interface MozConnection {
  execute(sql: string, params?: unknown[] | Record<string, unknown> | null): Promise<Iterable<MozRow> | ArrayLike<MozRow>>;
  close(): Promise<unknown>;
}

/** The part of the `Sqlite` namespace of `Sqlite.sys.mjs` the adapter uses. */
export interface SqliteModule {
  openConnection(options: { path: string; readOnly?: boolean; sharedMemoryCache?: boolean }): Promise<MozConnection>;
}

/** Platform services: Mozilla APIs in Zotero, `node:fs` and friends in the tests. */
export interface EngineHost {
  /** The `Sqlite` namespace (loaded lazily the first time a file is opened). */
  sqlite(): SqliteModule | Promise<SqliteModule>;
  readFile(path: string): Promise<unknown>;
  readFileHead(path: string, length: number): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  /** Removes a file; a missing file is not an error. */
  remove(path: string): Promise<unknown>;
  /** A fresh, unused file path in the temporary directory. */
  tempPath(prefix: string): string | Promise<string>;
  /** The `DecompressionStream` constructor, for gzip-wrapped (legacy 4.x) files. */
  decompressionStream(): DecompressionStreamCtor | undefined;
}

// mozIStorageValueArray.VALUE_TYPE_*
const VALUE_TYPE_NULL = 0;
const VALUE_TYPE_BLOB = 4;

/** Thrown when the result columns of a statement cannot be named (see `sql.ts`). */
export class ColumnNamesError extends Error {}

function bindable(v: SqlValue | undefined): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  return v;
}

/**
 * Parameters in the shape `Sqlite.sys.mjs` expects. It reads an array whose first
 * element is an object as a list of binding sets, so as soon as a BLOB (an object) is
 * bound the `?` placeholders are renamed `:p1`, `:p2`… and an object is passed instead.
 */
export function bindParams(sql: string, params: readonly SqlValue[] = []): { sql: string; params: unknown[] | Record<string, unknown> | null } {
  if (!params.length) return { sql, params: null };
  const values = params.map(bindable);
  if (!values.some((v) => typeof v === 'object' && v !== null)) return { sql, params: values };
  const named = namePlaceholders(sql);
  if (!named || named.names.length !== values.length) {
    throw new Error('Binding a BLOB needs anonymous "?" placeholders, one per parameter.');
  }
  const obj: Record<string, unknown> = {};
  named.names.forEach((name, i) => {
    obj[name] = values[i];
  });
  return { sql: named.sql, params: obj };
}

function cellValue(row: MozRow, i: number): SqlValue {
  const type = row.getTypeOfIndex(i);
  if (type === VALUE_TYPE_NULL) return null;
  const v = row.getResultByIndex(i);
  if (type === VALUE_TYPE_BLOB) return toLocalBytes(v);
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  if (v === null || v === undefined) return null;
  return String(v);
}

class MozSqlConnection implements SqlConnection {
  private closed = false;
  /** Statements whose inferred column names were checked against a real row. */
  private readonly checked = new Set<string>();

  constructor(
    private readonly conn: MozConnection,
    private readonly host: EngineHost,
    private readonly path: string,
    private readonly temporary: boolean,
  ) {}

  private async execute(sql: string, params: readonly SqlValue[] = []): Promise<MozRow[]> {
    if (this.closed) throw new Error('The SPDF database is closed.');
    const b = bindParams(sql, params);
    const rows = await this.conn.execute(b.sql, b.params);
    return Array.from(rows as ArrayLike<MozRow>);
  }

  private names(sql: string, first: MozRow): string[] {
    const names = resultColumns(sql);
    const count = first.numEntries;
    if (!names || names.length !== count) {
      throw new ColumnNamesError(`Cannot name the ${count} result column(s) of: ${sql}`);
    }
    if (!this.checked.has(sql)) {
      for (const name of new Set(names)) {
        try {
          first.getResultByName(name);
        } catch {
          throw new ColumnNamesError(`Result column «${name}» not found in: ${sql}`);
        }
      }
      this.checked.add(sql);
    }
    return names;
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    const rows = await this.execute(sql, params);
    const first = rows[0];
    if (!first) return [];
    const names = this.names(sql, first);
    return rows.map((row) => {
      const o: SqlRow = {};
      for (let i = 0; i < names.length; i++) o[names[i] as string] = cellValue(row, i);
      return o;
    });
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.execute(sql, params);
  }

  async exec(script: string): Promise<void> {
    // The asynchronous mozStorage API prepares one statement at a time.
    for (const statement of splitStatements(script)) await this.execute(statement);
  }

  async serialize(): Promise<Uint8Array> {
    // A database opened from a file (rollback journal, never WAL for SPDF) is its file.
    return toLocalBytes(await this.host.readFile(this.path));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.conn.close();
    } finally {
      if (this.temporary) {
        for (const suffix of ['', '-journal', '-wal', '-shm']) await Promise.resolve(this.host.remove(this.path + suffix)).catch(() => undefined);
      }
    }
  }
}

/** The engine. `name` shows in errors; one engine serves any number of files. */
export function mozStorageEngine(host: EngineHost): SqlEngine {
  let module: Promise<SqliteModule> | null = null;
  const sqlite = () => (module ??= Promise.resolve(host.sqlite()));

  const open = async (path: string, readOnly: boolean, temporary: boolean): Promise<SqlConnection> => {
    const Sqlite = await sqlite();
    let conn: MozConnection;
    try {
      // sharedMemoryCache off: a foreign file has nothing to share with Zotero's databases.
      conn = await Sqlite.openConnection({ path, readOnly, sharedMemoryCache: false });
    } catch (e) {
      if (temporary) await Promise.resolve(host.remove(path)).catch(() => undefined);
      throw e;
    }
    return new MozSqlConnection(conn, host, path, temporary);
  };

  const openCopy = async (bytes: Uint8Array | null, readOnly: boolean): Promise<SqlConnection> => {
    const path = await host.tempPath('spdf-');
    if (bytes) await host.writeFile(path, bytes);
    return open(path, readOnly, true);
  };

  return {
    name: 'zotero-mozstorage',
    openPath: (path: string, options: EngineOpenOptions) => open(path, options.readOnly, false),
    openBytes: (bytes: Uint8Array, options: EngineOpenOptions) => openCopy(bytes, options.readOnly),
    create: () => openCopy(null, false),
    async gunzip(bytes: Uint8Array, limit: number) {
      const DS = host.decompressionStream();
      if (!DS) throw new Error('This Zotero has no DecompressionStream, so gzip-wrapped (legacy) SPDF files cannot be read.');
      return gunzip(bytes, limit, DS);
    },
    readFile: async (path: string) => toLocalBytes(await host.readFile(path)),
    readFileHead: async (path: string, length: number) => toLocalBytes(await host.readFileHead(path, length)),
  };
}
