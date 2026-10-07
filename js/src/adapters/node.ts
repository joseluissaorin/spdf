/**
 * Node adapter: the built-in `node:sqlite` (Node ≥ 22.5; unflagged from 22.13) and
 * `node:zlib` for gzip. No native add-ons, no downloads.
 */

import type { EngineOpenOptions, SqlConnection, SqlEngine, SqlRow, SqlValue } from '../port.js';

type NodeSqlite = typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;
type StatementSync = import('node:sqlite').StatementSync;

const MAX_CACHE = 64;

class NodeConnection implements SqlConnection {
  private readonly cache = new Map<string, StatementSync>();
  private closed = false;

  constructor(
    readonly db: DatabaseSync,
    private readonly cleanup?: () => Promise<void>,
  ) {}

  private statement(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (st) {
      this.cache.delete(sql);
      this.cache.set(sql, st);
      return st;
    }
    st = this.db.prepare(sql);
    this.cache.set(sql, st);
    if (this.cache.size > MAX_CACHE) {
      const first = this.cache.keys().next().value as string;
      this.cache.delete(first);
    }
    return st;
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    return this.statement(sql).all(...(params as never[])) as unknown as SqlRow[];
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.statement(sql).run(...(params as never[]));
  }

  async exec(script: string): Promise<void> {
    this.db.exec(script);
  }

  async serialize(): Promise<Uint8Array> {
    const db = this.db as DatabaseSync & { serialize?: () => Uint8Array };
    if (typeof db.serialize === 'function') return db.serialize();
    throw new Error('This Node version cannot serialize a database (node:sqlite serialize() needs a newer Node).');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    this.db.close();
    if (this.cleanup) await this.cleanup();
  }
}

async function loadSqlite(): Promise<NodeSqlite> {
  try {
    return await import('node:sqlite');
  } catch (e) {
    throw new Error(
      `node:sqlite is not available (${(e as Error).message}). Use Node ≥ 22.13, or Node 22.5–22.12 with --experimental-sqlite.`,
    );
  }
}

function harden(db: DatabaseSync): void {
  const d = db as DatabaseSync & { enableDefensive?: (on: boolean) => void; enableLoadExtension?: (on: boolean) => void };
  if (typeof d.enableDefensive === 'function') d.enableDefensive(true);
}

export interface NodeEngineOptions {
  /** Directory for temporary files (used only when this Node cannot deserialize in memory). */
  tmpDir?: string;
}

/** The `node:sqlite` engine. */
export function nodeEngine(options: NodeEngineOptions = {}): SqlEngine {
  let sqlitePromise: Promise<NodeSqlite> | null = null;
  const sqlite = () => (sqlitePromise ??= loadSqlite());

  const openFile = async (path: string, ro: EngineOpenOptions, cleanup?: () => Promise<void>): Promise<SqlConnection> => {
    const { DatabaseSync } = await sqlite();
    const db = new DatabaseSync(path, { readOnly: ro.readOnly, allowExtension: false } as never);
    if (ro.readOnly) harden(db);
    return new NodeConnection(db, cleanup);
  };

  return {
    name: 'node:sqlite',

    async openBytes(bytes, opts) {
      const { DatabaseSync } = await sqlite();
      const db = new DatabaseSync(':memory:', { allowExtension: false } as never);
      const d = db as DatabaseSync & { deserialize?: (b: Uint8Array) => void };
      if (typeof d.deserialize === 'function') {
        d.deserialize(bytes);
        if (opts.readOnly) harden(db);
        return new NodeConnection(db);
      }
      db.close();
      // Older Node: go through a temporary file.
      const [{ mkdtemp, writeFile, rm }, { tmpdir }, { join }] = await Promise.all([
        import('node:fs/promises'),
        import('node:os'),
        import('node:path'),
      ]);
      const dir = await mkdtemp(join(options.tmpDir ?? tmpdir(), 'spdf-'));
      const file = join(dir, 'db.sqlite');
      await writeFile(file, bytes);
      return openFile(file, opts, () => rm(dir, { recursive: true, force: true }));
    },

    async openPath(path, opts) {
      return openFile(path, opts);
    },

    async create() {
      const { DatabaseSync } = await sqlite();
      return new NodeConnection(new DatabaseSync(':memory:', { allowExtension: false } as never));
    },

    async gunzip(bytes, limit) {
      const [{ gunzip }, { constants }] = await Promise.all([import('node:zlib'), import('node:buffer')]);
      const max = Math.min(limit, constants.MAX_LENGTH);
      return new Promise<Uint8Array>((resolve, reject) =>
        gunzip(bytes, { maxOutputLength: max }, (err, out) =>
          err ? reject(new Error(`gzip: ${err.message}`)) : resolve(new Uint8Array(out.buffer, out.byteOffset, out.byteLength)),
        ),
      );
    },

    async readFile(path) {
      const { readFile } = await import('node:fs/promises');
      const b = await readFile(path);
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    },

    async readFileHead(path, length) {
      const { open } = await import('node:fs/promises');
      const fh = await open(path, 'r');
      try {
        const buf = new Uint8Array(length);
        const { bytesRead } = await fh.read(buf, 0, length, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
  };
}
