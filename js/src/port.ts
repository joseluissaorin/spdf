/**
 * The minimal SQL port every platform adapter implements.
 *
 * The core of `spdf-format` only talks to this interface, so the same code runs on
 * Node (`node:sqlite`), Bun (`bun:sqlite`) and the browser (`@sqlite.org/sqlite-wasm`).
 * Everything is asynchronous so adapters for asynchronous back ends (D1, Durable
 * Objects, a worker thread) can implement it too.
 */

/** A value SQLite can store or return. Integers come back as `number` (or `bigint` if huge). */
export type SqlValue = null | number | bigint | string | Uint8Array;

/** A result row, keyed by column name. */
export type SqlRow = Record<string, SqlValue>;

/** An open SQLite database. */
export interface SqlConnection {
  /** Runs a query and returns every row as an object. */
  all(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  /** Runs a statement that returns no rows. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Runs a script with one or more statements and no parameters. */
  exec(script: string): Promise<void>;
  /** The database image (`main`) as bytes. */
  serialize(): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** How an adapter must open a database. */
export interface EngineOpenOptions {
  /**
   * Read only. Adapters MUST open with `SQLITE_OPEN_READONLY` (or the equivalent), enable
   * `SQLITE_DBCONFIG_DEFENSIVE` where the binding allows it, and never load extensions.
   * The core then sets `PRAGMA query_only = 1` and `PRAGMA trusted_schema = OFF`.
   */
  readOnly: boolean;
  /**
   * Largest TEXT or BLOB value SQLite may return (`SQLITE_LIMIT_LENGTH`), for read-only
   * opens of untrusted files. Adapters apply it where the binding allows it.
   */
  maxValueBytes?: number;
}

/**
 * A random-access, synchronous byte source (an HTTP resource read with Range requests,
 * a `Blob` read with `FileReaderSync`, an OPFS sync access handle…). Used by the
 * read-only virtual file system of the WebAssembly adapter.
 */
export interface RandomAccessSource {
  /** Total size in bytes. */
  readonly size: number;
  /** Reads exactly `length` bytes at `offset` (fewer only at the end of the source). */
  read(offset: number, length: number): Uint8Array;
  /** Optional statistics (bytes and requests), for measurement. */
  stats?(): SourceStats;
  close?(): void;
}

export interface SourceStats {
  requests: number;
  bytesFetched: number;
}

/** A SQLite engine for one platform. */
export interface SqlEngine {
  readonly name: string;
  /** Opens a SQLite image held in memory. The bytes are copied or treated as immutable. */
  openBytes(bytes: Uint8Array, options: EngineOpenOptions): Promise<SqlConnection>;
  /** Opens a database file by path (Node, Bun). */
  openPath?(path: string, options: EngineOpenOptions): Promise<SqlConnection>;
  /** Opens a database read only through a random-access source (WebAssembly adapter). */
  openSource?(source: RandomAccessSource, options: EngineOpenOptions): Promise<SqlConnection>;
  /** A new, empty, writable database. */
  create(): Promise<SqlConnection>;
  /** Gunzip, if the platform has a faster one than `DecompressionStream`. Fails past `limit` bytes. */
  gunzip?(bytes: Uint8Array, limit: number): Promise<Uint8Array>;
  /** File access (Node, Bun). */
  readFile?(path: string): Promise<Uint8Array>;
  readFileHead?(path: string, length: number): Promise<Uint8Array>;
}

let defaultEngine: SqlEngine | (() => Promise<SqlEngine>) | null = null;
let resolved: Promise<SqlEngine> | null = null;

/**
 * Sets the engine used when no `engine` option is given. The platform entry points
 * (`spdf-format/node`, `spdf-format/bun`, `spdf-format/browser`) call this on import.
 */
export function setDefaultEngine(engine: SqlEngine | (() => Promise<SqlEngine>) | null): void {
  defaultEngine = engine;
  resolved = null;
}

/** The engine to use: the one given, or the default one. */
export function resolveEngine(engine?: SqlEngine): Promise<SqlEngine> {
  if (engine) return Promise.resolve(engine);
  if (!defaultEngine) {
    return Promise.reject(
      new Error(
        "No SQLite engine: import 'spdf-format' (or 'spdf-format/node', '/bun', '/browser'), or pass { engine }.",
      ),
    );
  }
  if (typeof defaultEngine !== 'function') return Promise.resolve(defaultEngine);
  if (!resolved) {
    const factory = defaultEngine;
    resolved = factory().catch((e: unknown) => {
      resolved = null;
      throw e;
    });
  }
  return resolved;
}
