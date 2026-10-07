/**
 * Bun adapter: `bun:sqlite` (deserialize in memory, read-only open by path) and the
 * platform's gzip (`Bun.gunzipSync`). Bun's binding has no switch for
 * `SQLITE_DBCONFIG_DEFENSIVE`; read-only mode, `query_only` and `trusted_schema=OFF`
 * still apply, and extensions are never loaded.
 */

import { Database } from 'bun:sqlite';
import type { SqlConnection, SqlEngine, SqlRow, SqlValue } from '../port.js';

type BunStatement = ReturnType<Database['prepare']>;

class BunConnection implements SqlConnection {
  private readonly cache = new Map<string, BunStatement>();
  private closed = false;

  constructor(readonly db: Database) {}

  private statement(sql: string): BunStatement {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
      if (this.cache.size > 64) {
        const [k, old] = this.cache.entries().next().value as [string, BunStatement];
        this.cache.delete(k);
        old.finalize();
      }
    }
    return st;
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    return this.statement(sql).all(...params) as SqlRow[];
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.statement(sql).run(...params);
  }

  async exec(script: string): Promise<void> {
    this.db.exec(script);
  }

  async serialize(): Promise<Uint8Array> {
    return this.db.serialize();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const st of this.cache.values()) st.finalize();
    this.cache.clear();
    this.db.close();
  }
}

interface BunGlobal {
  gunzipSync(data: Uint8Array): Uint8Array;
  file(path: string): { arrayBuffer(): Promise<ArrayBuffer>; slice(a: number, b: number): { arrayBuffer(): Promise<ArrayBuffer> } };
}

const bun = (): BunGlobal => (globalThis as unknown as { Bun: BunGlobal }).Bun;

/** The `bun:sqlite` engine. */
export function bunEngine(): SqlEngine {
  return {
    name: 'bun:sqlite',
    async openBytes(bytes, opts) {
      return new BunConnection(Database.deserialize(bytes, { readonly: opts.readOnly }));
    },
    async openPath(path, opts) {
      return new BunConnection(new Database(path, opts.readOnly ? { readonly: true } : { create: false, readwrite: true }));
    },
    async create() {
      return new BunConnection(new Database(':memory:'));
    },
    async gunzip(bytes, limit) {
      const out = bun().gunzipSync(bytes);
      if (out.byteLength > limit) throw new Error(`Decompressed size exceeds the limit of ${limit} bytes.`);
      return out;
    },
    async readFile(path) {
      return new Uint8Array(await bun().file(path).arrayBuffer());
    },
    async readFileHead(path, length) {
      return new Uint8Array(await bun().file(path).slice(0, length).arrayBuffer());
    },
  };
}
