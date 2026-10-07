/**
 * A stand-in for Firefox's `Sqlite.sys.mjs` built on `node:sqlite`, faithful to the
 * parts that shape the adapter:
 *
 * - rows behave like `mozIStorageRow`: values by index, `getTypeOfIndex`, and
 *   `getResultByName` for a name you already know; they do NOT expose column names;
 * - BLOBs come back as plain arrays of octets (what XPConnect makes of an nsIVariant
 *   octet array), never as typed arrays;
 * - one statement per call (mozStorage prepares a single statement);
 * - parameters are bound the way `Sqlite.sys.mjs` binds them: an array whose first
 *   element is an object is a list of binding sets (rejected here, since the adapter
 *   must never send one by accident), any other array is positional, an object is named.
 */

import { DatabaseSync } from 'node:sqlite';
import type { MozConnection, MozRow, SqliteModule } from '../../src/engine.js';

export interface FakeSqlite extends SqliteModule {
  readonly opens: Array<{ path: string; readOnly: boolean }>;
  /** Connections currently open. */
  readonly openCount: () => number;
  readonly statements: string[];
}

class FakeRow implements MozRow {
  readonly #values: unknown[];
  readonly #names: string[];

  constructor(values: unknown[], names: string[]) {
    this.#values = values;
    this.#names = names;
  }

  get numEntries(): number {
    return this.#values.length;
  }

  #check(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.#values.length) throw new Error('NS_ERROR_ILLEGAL_VALUE');
  }

  getTypeOfIndex(i: number): number {
    this.#check(i);
    const v = this.#values[i];
    if (v === null || v === undefined) return 0;
    if (v instanceof Uint8Array) return 4;
    if (typeof v === 'string') return 3;
    if (typeof v === 'bigint') return 1;
    return Number.isInteger(v) ? 1 : 2;
  }

  getResultByIndex(i: number): unknown {
    this.#check(i);
    const v = this.#values[i];
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return Number(v);
    return v ?? null;
  }

  getResultByName(name: string): unknown {
    const i = this.#names.indexOf(name);
    if (i < 0) throw new Error('NS_ERROR_NOT_AVAILABLE');
    return this.getResultByIndex(i);
  }
}

/** An independent, deliberately crude check for "more than one statement". */
function hasSeveralStatements(sql: string): boolean {
  if (/^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(sql)) return false;
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]')
    .trim()
    .replace(/;\s*$/, '');
  return stripped.includes(';');
}

export function fakeSqlite(): FakeSqlite {
  const opens: Array<{ path: string; readOnly: boolean }> = [];
  const statements: string[] = [];
  let open = 0;
  return {
    opens,
    statements,
    openCount: () => open,
    async openConnection(options) {
      if (!options.path) throw new Error('path not specified in connection options.');
      const readOnly = !!options.readOnly;
      const db = new DatabaseSync(options.path, { readOnly, allowExtension: false } as never);
      opens.push({ path: options.path, readOnly });
      open++;
      let closed = false;
      const conn: MozConnection = {
        async execute(sql, params) {
          if (closed) throw new Error('Connection is not open.');
          if (hasSeveralStatements(sql)) throw new Error(`fake mozStorage: one statement at a time: ${sql}`);
          statements.push(sql);
          const st = db.prepare(sql);
          st.setReturnArrays(true);
          const names = st.columns().map((c) => c.name);
          let rows: unknown[];
          if (params === null || params === undefined) rows = st.all();
          else if (Array.isArray(params)) {
            if (params.length && typeof params[0] === 'object' && params[0] !== null) {
              throw new Error('fake mozStorage: an array whose first element is an object is a list of binding sets');
            }
            rows = st.all(...(params as never[]));
          } else rows = st.all(params as never);
          return (rows as unknown[][]).map((r) => new FakeRow(r, names));
        },
        async close() {
          if (closed) return;
          closed = true;
          open--;
          db.close();
        },
      };
      return conn;
    },
  };
}
