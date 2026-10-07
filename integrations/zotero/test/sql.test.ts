import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { namePlaceholders, resultColumns, splitStatements, tokenize } from '../src/sql.js';

/** The names SQLite itself gives (node:sqlite exposes them), to check the inference against. */
function sqliteNames(sql: string, setup = ''): string[] {
  const db = new DatabaseSync(':memory:');
  if (setup) db.exec(setup);
  try {
    return db.prepare(sql).columns().map((c) => c.name);
  } finally {
    db.close();
  }
}

const SETUP = `CREATE TABLE t (id TEXT, "key" TEXT, data BLOB, ord INTEGER);
CREATE TABLE "documentos" ("id" TEXT, "metadatos" TEXT, orden INTEGER);`;

describe('resultColumns', () => {
  const cases = [
    'SELECT id AS "id", NULL AS "notes", "key" AS k FROM t',
    'SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN (\'table\', \'view\', \'trigger\')',
    'SELECT count(*) AS n FROM "t"',
    'SELECT count(*) FROM t',
    'SELECT length("data") AS n FROM "t" WHERE "key" = ?',
    'SELECT DISTINCT "key" AS s FROM "t" ORDER BY s',
    'SELECT t.id, t.ord FROM t',
    'SELECT id x, ord + 1 y, \'a\' z FROM t',
    'SELECT 1 + 2, upper(id) FROM t',
    'SELECT CAST(ord AS TEXT) FROM t',
    'SELECT id COLLATE NOCASE FROM t',
    'SELECT CASE WHEN ord > 1 THEN \'a\' ELSE \'b\' END AS c, CASE ord WHEN 1 THEN 2 END FROM t',
    'SELECT "id" AS "id", "metadatos" AS "metadata" FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY "id" ORDER BY "orden", "id") AS "__ord" FROM "documentos") ORDER BY "__ord"',
    'WITH a(x) AS (SELECT 1), b AS MATERIALIZED (SELECT 2 AS y) SELECT x, (SELECT y FROM b) AS yy FROM a',
    'VALUES (1, 2, 3)',
    "SELECT id FROM t UNION SELECT 'x' FROM t",
    'SELECT ROW_NUMBER() OVER (ORDER BY ord) AS rn FROM t',
    'SELECT rowid AS n, ord FROM t WHERE id MATCH ? ORDER BY n LIMIT ?',
  ];
  for (const sql of cases) {
    it(sql.slice(0, 70), () => {
      expect(resultColumns(sql)).toEqual(sqliteNames(sql, SETUP));
    });
  }

  it('names PRAGMA results as SQLite does', () => {
    for (const sql of ['PRAGMA application_id', 'PRAGMA user_version', 'PRAGMA main.user_version', 'PRAGMA table_info("t")', 'PRAGMA quick_check', 'PRAGMA index_list(t)', 'PRAGMA table_xinfo(t)']) {
      expect(resultColumns(sql), sql).toEqual(sqliteNames(sql, SETUP));
    }
  });

  it('gives no names for statements without rows, and null for SELECT *', () => {
    expect(resultColumns('PRAGMA query_only = 1')).toEqual(['query_only']);
    expect(resultColumns("INSERT INTO t (id) VALUES ('x')")).toEqual([]);
    expect(resultColumns('CREATE TABLE z (a)')).toEqual([]);
    expect(resultColumns('SELECT * FROM t')).toBeNull();
    expect(resultColumns('SELECT t.* FROM t')).toBeNull();
    expect(resultColumns("INSERT INTO t (id) VALUES ('x') RETURNING id, ord AS o")).toEqual(['id', 'o']);
  });
});

describe('splitStatements', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitStatements('PRAGMA query_only = 1; PRAGMA trusted_schema = OFF;')).toEqual(['PRAGMA query_only = 1', 'PRAGMA trusted_schema = OFF']);
    expect(splitStatements("INSERT INTO t VALUES ('a;b'); -- c;\nSELECT \"x;\" /* ; */ FROM t;;")).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT "x;" /* ; */ FROM t']);
  });

  it('keeps trigger bodies whole', () => {
    const script = 'CREATE TABLE a(x); CREATE TRIGGER tr AFTER INSERT ON a BEGIN INSERT INTO a VALUES (CASE WHEN 1 THEN 2 END); DELETE FROM a; END; SELECT 1';
    const parts = splitStatements(script);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toMatch(/^CREATE TRIGGER tr .* END$/);
    const db = new DatabaseSync(':memory:');
    for (const p of parts) db.exec(p);
    db.close();
  });
});

describe('namePlaceholders', () => {
  it('renames ? outside strings and comments', () => {
    expect(namePlaceholders("SELECT '?' AS q, ? AS a /* ? */ FROM t WHERE id = ?")).toEqual({
      sql: "SELECT '?' AS q, :p1 AS a /* ? */ FROM t WHERE id = :p2",
      names: ['p1', 'p2'],
    });
    expect(namePlaceholders('SELECT :x, ?')).toBeNull();
  });

  it('tokenizes blob literals, numbers and quoted identifiers', () => {
    const toks = tokenize("SELECT X'0102', 1.5e3, [a b], `c`, \"d\"\"e\" FROM t");
    expect(toks.map((t) => t.type)).toEqual(['word', 'string', 'op', 'number', 'op', 'ident', 'op', 'ident', 'op', 'ident', 'word', 'word']);
    expect(toks.filter((t) => t.type === 'ident').map((t) => t.value)).toEqual(['a b', 'c', 'd"e']);
  });
});
