/**
 * WebAssembly adapter: the official SQLite build (`@sqlite.org/sqlite-wasm`, with FTS5).
 * Works in browsers, Web Workers, Node, Deno, Bun and Cloudflare Workers (there, pass
 * an already initialized `sqlite3`, since workerd cannot compile WebAssembly at run time).
 *
 * - In memory by default; with `storage: 'opfs'` (or `'auto'` inside a Worker that has
 *   OPFS) databases live in the Origin Private File System through the `opfs-sahpool`
 *   VFS, so a large file does not have to fit in the WebAssembly heap.
 * - A read-only VFS (`spdf-ro`) reads any {@link RandomAccessSource}: HTTP Range
 *   requests, a `Blob` through `FileReaderSync`, an OPFS sync access handle.
 */

import type { EngineOpenOptions, RandomAccessSource, SqlConnection, SqlEngine, SqlRow, SqlValue } from '../port.js';
import { gunzipWeb } from '../bytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sqlite3 = any;
type OoDb = any;
type OoStmt = any;

export interface WasmEngineOptions {
  /** An initialized sqlite3 module (`await sqlite3InitModule()`); required in Cloudflare Workers. */
  sqlite3?: unknown;
  /** URL of `sqlite3.wasm`, when a bundler moves it (esbuild, Vite without the plugin…). */
  wasmUrl?: string;
  /** The bytes of `sqlite3.wasm`. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** A compiled `sqlite3.wasm` module. */
  wasmModule?: WebAssembly.Module;
  /** Where writable and imported databases live. Default `'memory'`. */
  storage?: 'memory' | 'opfs' | 'auto';
  /** OPFS directory for the `opfs-sahpool` VFS. Default `.spdf-format`. */
  opfsDirectory?: string;
  /** Engine messages; default: silent (failures also surface as exceptions). */
  log?: (level: 'info' | 'error', ...args: unknown[]) => void;
}

const READ_ONLY_VFS = 'spdf-ro';

let modulePromise: Promise<Sqlite3> | null = null;

async function loadSqlite3(o: WasmEngineOptions): Promise<Sqlite3> {
  if (o.sqlite3) return o.sqlite3 as Sqlite3;
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const mod = (await import('@sqlite.org/sqlite-wasm')) as unknown as { default: (m?: Record<string, unknown>) => Promise<Sqlite3> };
    // Silent by default: every failure also surfaces as an exception.
    const log = o.log ?? (() => undefined);
    const m: Record<string, unknown> = {
      print: (...a: unknown[]) => log('info', ...a),
      printErr: (...a: unknown[]) => log('error', ...a),
    };
    if (o.wasmModule) {
      const compiled = o.wasmModule;
      m.instantiateWasm = (imports: WebAssembly.Imports, ok: (i: WebAssembly.Instance, mm: WebAssembly.Module) => void) => {
        void WebAssembly.instantiate(compiled, imports).then((inst) => ok(inst, compiled));
        return {};
      };
    } else if (o.wasmBinary) {
      m.wasmBinary = o.wasmBinary instanceof Uint8Array ? o.wasmBinary : new Uint8Array(o.wasmBinary);
    } else if (o.wasmUrl) {
      const url = o.wasmUrl;
      m.locateFile = (path: string) => (path.endsWith('.wasm') ? url : path);
    }
    const g = globalThis as { sqlite3ApiConfig?: unknown };
    const previous = g.sqlite3ApiConfig;
    // The COOP/COEP 'opfs' VFS and kvvfs are not used; opfs-sahpool stays available.
    g.sqlite3ApiConfig = {
      ...(previous as object | undefined),
      disable: { vfs: { kvvfs: true, opfs: true, 'opfs-wl': true } },
      log: (...a: unknown[]) => log('info', ...a),
      debug: (...a: unknown[]) => log('info', ...a),
      warn: (...a: unknown[]) => log('info', ...a),
      error: (...a: unknown[]) => log('error', ...a),
    };
    try {
      return await mod.default(m);
    } finally {
      if (previous === undefined) delete g.sqlite3ApiConfig;
      else g.sqlite3ApiConfig = previous;
    }
  })().catch((e: unknown) => {
    modulePromise = null;
    throw e;
  });
  return modulePromise;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function normalizeValue(v: unknown): SqlValue {
  if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  if (v === undefined) return null;
  return v as SqlValue;
}

function bindValue(v: SqlValue | undefined): unknown {
  if (v === undefined) return null;
  return v;
}

class WasmConnection implements SqlConnection {
  private readonly cache = new Map<string, OoStmt>();
  private closed = false;

  constructor(
    private readonly sqlite3: Sqlite3,
    readonly db: OoDb,
    private readonly cleanup?: () => void | Promise<void>,
  ) {}

  private statement(sql: string): OoStmt {
    let st = this.cache.get(sql);
    if (st) {
      this.cache.delete(sql);
      this.cache.set(sql, st);
      return st;
    }
    st = this.db.prepare(sql);
    this.cache.set(sql, st);
    if (this.cache.size > 64) {
      const [k, old] = this.cache.entries().next().value as [string, OoStmt];
      this.cache.delete(k);
      try {
        old.finalize();
      } catch {
        /* already finalized */
      }
    }
    return st;
  }

  private step(sql: string, params: readonly SqlValue[], collect: boolean): SqlRow[] {
    const st = this.statement(sql);
    try {
      if (params.length) st.bind(params.map(bindValue));
      const rows: SqlRow[] = [];
      while (st.step()) {
        if (!collect) continue;
        const raw = st.get({}) as Record<string, unknown>;
        const row: SqlRow = {};
        for (const k of Object.keys(raw)) row[k] = normalizeValue(raw[k]);
        rows.push(row);
      }
      return rows;
    } finally {
      try {
        st.reset(true);
      } catch {
        /* finalized */
      }
    }
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    return this.step(sql, params, true);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.step(sql, params, false);
  }

  async exec(script: string): Promise<void> {
    this.db.exec(script);
  }

  private finalizeAll(): void {
    for (const st of this.cache.values()) {
      try {
        st.finalize();
      } catch {
        /* already finalized */
      }
    }
    this.cache.clear();
  }

  async serialize(): Promise<Uint8Array> {
    this.finalizeAll();
    return this.sqlite3.capi.sqlite3_js_db_export(this.db) as Uint8Array;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.finalizeAll();
    this.db.close();
    if (this.cleanup) await this.cleanup();
  }
}

function harden(sqlite3: Sqlite3, db: OoDb): void {
  const capi = sqlite3.capi;
  try {
    capi.sqlite3_db_config(db.pointer, capi.SQLITE_DBCONFIG_DEFENSIVE, 1, 0);
  } catch {
    /* older builds */
  }
  try {
    capi.sqlite3_db_config(db.pointer, capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, 0);
  } catch {
    /* PRAGMA trusted_schema is set by the core anyway */
  }
}

// ---------------------------------------------------------------------------
// Read-only VFS over random-access sources
// ---------------------------------------------------------------------------

interface VfsState {
  sources: Map<string, RandomAccessSource>;
  files: Map<number, RandomAccessSource>;
  lastError: Error | null;
}

const vfsStates = new WeakMap<object, VfsState>();
let sourceCounter = 0;

function installReadOnlyVfs(sqlite3: Sqlite3): VfsState {
  const existing = vfsStates.get(sqlite3);
  if (existing) return existing;
  const { capi, wasm } = sqlite3;
  const state: VfsState = { sources: new Map(), files: new Map(), lastError: null };
  const SECTOR = 4096;
  const fail = (e: unknown, rc: number): number => {
    state.lastError = e instanceof Error ? e : new Error(String(e));
    return rc;
  };

  const io = new capi.sqlite3_io_methods();
  io.$iVersion = 1;
  const ioMethods = {
    xClose(pFile: number) {
      state.files.delete(Number(pFile));
      return 0;
    },
    xRead(pFile: number, pDest: number, n: number, offset64: number | bigint) {
      const src = state.files.get(Number(pFile));
      if (!src) return capi.SQLITE_IOERR_READ;
      try {
        const data = src.read(Number(offset64), n);
        const heap = wasm.heap8u() as Uint8Array;
        const dest = Number(pDest);
        heap.set(data.subarray(0, Math.min(n, data.byteLength)), dest);
        if (data.byteLength < n) {
          heap.fill(0, dest + data.byteLength, dest + n);
          return capi.SQLITE_IOERR_SHORT_READ;
        }
        return 0;
      } catch (e) {
        return fail(e, capi.SQLITE_IOERR_READ);
      }
    },
    xWrite() {
      return capi.SQLITE_READONLY;
    },
    xTruncate() {
      return capi.SQLITE_READONLY;
    },
    xSync() {
      return 0;
    },
    xFileSize(pFile: number, pSz64: number) {
      const src = state.files.get(Number(pFile));
      if (!src) return capi.SQLITE_IOERR_FSTAT;
      wasm.poke64(pSz64, BigInt(src.size));
      return 0;
    },
    xLock() {
      return 0;
    },
    xUnlock() {
      return 0;
    },
    xCheckReservedLock(_pFile: number, pOut: number) {
      wasm.poke32(pOut, 0);
      return 0;
    },
    xFileControl() {
      return capi.SQLITE_NOTFOUND;
    },
    xSectorSize() {
      return SECTOR;
    },
    xDeviceCharacteristics() {
      return capi.SQLITE_IOCAP_IMMUTABLE;
    },
  };
  sqlite3.vfs.installVfs({ io: { struct: io, methods: ioMethods } });

  const vfs = new capi.sqlite3_vfs();
  const pDefault = capi.sqlite3_vfs_find(null);
  const dflt = pDefault ? new capi.sqlite3_vfs(pDefault) : null;
  vfs.$iVersion = 2;
  vfs.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
  vfs.$mxPathname = 1024;
  vfs.addOnDispose((vfs.$zName = wasm.allocCString(READ_ONLY_VFS)));
  if (dflt) {
    vfs.$xRandomness = dflt.$xRandomness;
    vfs.$xSleep = dflt.$xSleep;
    dflt.dispose();
  }
  const vfsMethods: Record<string, (...args: any[]) => number> = {
    xOpen(_pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number) {
      const name = zName ? (wasm.cstrToJs(zName) as string) : '';
      const src = state.sources.get(name);
      if (!src || flags & capi.SQLITE_OPEN_READWRITE || flags & capi.SQLITE_OPEN_CREATE) {
        return src ? capi.SQLITE_READONLY : capi.SQLITE_CANTOPEN;
      }
      state.files.set(Number(pFile), src);
      const f = new capi.sqlite3_file(pFile);
      f.$pMethods = io.pointer;
      f.dispose();
      wasm.poke32(pOutFlags, capi.SQLITE_OPEN_READONLY);
      return 0;
    },
    xDelete() {
      return capi.SQLITE_IOERR_DELETE;
    },
    xAccess(_pVfs: number, zName: number, _flags: number, pOut: number) {
      const name = wasm.cstrToJs(zName) as string;
      wasm.poke32(pOut, state.sources.has(name) ? 1 : 0);
      return 0;
    },
    xFullPathname(_pVfs: number, zName: number, nOut: number, pOut: number) {
      return wasm.cstrncpy(pOut, zName, nOut) < nOut ? 0 : capi.SQLITE_CANTOPEN;
    },
    xCurrentTime(_pVfs: number, pOut: number) {
      wasm.poke(pOut, 2440587.5 + Date.now() / 864e5, 'double');
      return 0;
    },
    xCurrentTimeInt64(_pVfs: number, pOut: number) {
      wasm.poke(pOut, 0xbfc83e532200 + Date.now(), 'i64');
      return 0;
    },
    xGetLastError(_pVfs: number, nOut: number, pOut: number) {
      const e = state.lastError;
      state.lastError = null;
      if (e && nOut > 0) {
        const bytes = new TextEncoder().encode(e.message.slice(0, Math.max(0, nOut - 1)));
        const heap = wasm.heap8u() as Uint8Array;
        heap.set(bytes.subarray(0, nOut - 1), Number(pOut));
        heap[Number(pOut) + Math.min(bytes.length, nOut - 1)] = 0;
      }
      return e ? capi.SQLITE_IOERR : 0;
    },
  };
  if (!vfs.$xRandomness) {
    vfsMethods.xRandomness = (_p: number, nOut: number, pOut: number) => {
      const heap = wasm.heap8u() as Uint8Array;
      for (let i = 0; i < nOut; i++) heap[Number(pOut) + i] = (Math.random() * 256) & 255;
      return nOut;
    };
  }
  if (!vfs.$xSleep) vfsMethods.xSleep = () => 0;
  sqlite3.vfs.installVfs({ vfs: { struct: vfs, methods: vfsMethods } });
  vfsStates.set(sqlite3, state);
  return state;
}

// ---------------------------------------------------------------------------
// OPFS (opfs-sahpool)
// ---------------------------------------------------------------------------

const pools = new WeakMap<object, Promise<any | null>>();

function opfsUsable(): boolean {
  const g = globalThis as { navigator?: { storage?: { getDirectory?: unknown } }; FileSystemFileHandle?: { prototype?: object }; WorkerGlobalScope?: unknown };
  return (
    typeof g.WorkerGlobalScope !== 'undefined' &&
    typeof g.navigator?.storage?.getDirectory === 'function' &&
    !!g.FileSystemFileHandle?.prototype &&
    'createSyncAccessHandle' in (g.FileSystemFileHandle.prototype as object)
  );
}

function sahPool(sqlite3: Sqlite3, directory: string): Promise<any | null> {
  let p = pools.get(sqlite3);
  if (!p) {
    p = (typeof sqlite3.installOpfsSAHPoolVfs === 'function' && opfsUsable()
      ? (sqlite3.installOpfsSAHPoolVfs({ name: 'spdf-opfs', directory, initialCapacity: 4, clearOnInit: false }) as Promise<any>)
      : Promise.resolve(null)
    ).catch(() => null);
    pools.set(sqlite3, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface WasmEngine extends SqlEngine {
  /** The sqlite3 module (loaded on first use). */
  sqlite3(): Promise<unknown>;
  /** Whether databases go to OPFS (resolved on first use). */
  usesOpfs(): Promise<boolean>;
}

/** The `@sqlite.org/sqlite-wasm` engine. */
export function wasmEngine(options: WasmEngineOptions = {}): WasmEngine {
  const storage = options.storage ?? 'memory';
  const directory = options.opfsDirectory ?? '.spdf-format';
  const load = () => loadSqlite3(options);
  const pool = async (): Promise<any | null> => {
    if (storage === 'memory') return null;
    const p = await sahPool(await load(), directory);
    if (!p && storage === 'opfs') throw new Error('OPFS is not available here (it needs a dedicated Worker with FileSystemSyncAccessHandle).');
    return p;
  };
  let counter = 0;
  const tempName = () => `/spdf-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}.sqlite`;

  const engine: WasmEngine = {
    name: 'sqlite-wasm',
    sqlite3: load,
    async usesOpfs() {
      return (await pool()) !== null;
    },

    async openBytes(bytes: Uint8Array, opts: EngineOpenOptions): Promise<SqlConnection> {
      const sqlite3 = await load();
      let b = bytes;
      if (b[18] === 2 || b[19] === 2) {
        // WAL header: an image opened from bytes cannot use a WAL file.
        b = b.slice();
        b[18] = 1;
        b[19] = 1;
      }
      const p = await pool();
      if (p && b.byteLength % 512 === 0) {
        const name = tempName();
        p.importDb(name, b);
        const db = new p.OpfsSAHPoolDb({ filename: name, flags: opts.readOnly ? 'r' : 'w' });
        if (opts.readOnly) harden(sqlite3, db);
        return new WasmConnection(sqlite3, db, () => {
          p.unlink(name);
        });
      }
      const { capi, wasm } = sqlite3;
      const db = new sqlite3.oo1.DB(':memory:', 'c');
      const ptr = wasm.allocFromTypedArray(b);
      const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | (opts.readOnly ? capi.SQLITE_DESERIALIZE_READONLY : capi.SQLITE_DESERIALIZE_RESIZEABLE);
      const rc = capi.sqlite3_deserialize(db.pointer, 'main', ptr, b.byteLength, b.byteLength, flags);
      if (rc !== 0) {
        db.close();
        throw new Error(`sqlite3_deserialize failed (code ${rc}).`);
      }
      if (opts.readOnly) harden(sqlite3, db);
      return new WasmConnection(sqlite3, db);
    },

    async openSource(source: RandomAccessSource, opts: EngineOpenOptions): Promise<SqlConnection> {
      if (!opts.readOnly) throw new Error('Random-access sources are read only.');
      const sqlite3 = await load();
      const state = installReadOnlyVfs(sqlite3);
      const name = `/source-${++sourceCounter}.spdf`;
      state.sources.set(name, source);
      let db: OoDb;
      try {
        db = new sqlite3.oo1.DB({ filename: name, flags: 'r', vfs: READ_ONLY_VFS });
      } catch (e) {
        state.sources.delete(name);
        throw e;
      }
      harden(sqlite3, db);
      return new WasmConnection(sqlite3, db, () => {
        state.sources.delete(name);
        source.close?.();
      });
    },

    async create(): Promise<SqlConnection> {
      const sqlite3 = await load();
      const p = await pool();
      if (p) {
        const name = tempName();
        const db = new p.OpfsSAHPoolDb({ filename: name, flags: 'c' });
        return new WasmConnection(sqlite3, db, () => {
          p.unlink(name);
        });
      }
      return new WasmConnection(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
    },

    async gunzip(bytes: Uint8Array, limit: number) {
      return gunzipWeb(bytes, limit);
    },
  };
  return engine;
}
