/**
 * The Zotero engine, run against the fake `Sqlite.sys.mjs`, must give exactly what the
 * official Node engine of `spdf-format` gives: same canonical dump (every table, every
 * blob and vector hash), same validation, same search. That exercises every SQL
 * statement the core issues through the adapter's column naming and value conversion.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { openSpdf as openWithNode, validate as validateWithNode } from 'spdf-format';
import { openSpdf, validate, SpdfError } from 'spdf-format/core';
import { ColumnNamesError, bindParams, mozStorageEngine } from '../src/engine.js';
import { toLocalBytes } from '../src/bytes.js';
import { EN, ES, LEGACY_FILES, ROTO, nodeHost, tempDir } from './helpers/env.js';
import { basename } from 'node:path';

/** Any legacy (gzip-wrapped 4.x) file of the conformance suite. */
const LEGACY = LEGACY_FILES[0]!;

const dir = tempDir();
const host = nodeHost(dir);
const engine = mozStorageEngine(host);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const leftovers = () => readdirSync(dir).filter((f) => f.startsWith('spdf-'));

describe('same results as the Node engine', () => {
  for (const [name, path] of [
    ['English fixture', EN],
    ['Spanish fixture', ES],
    ...LEGACY_FILES.map((f) => [`legacy ${basename(f)} (gzip)`, f] as const),
  ]) {
    it(`${name}: canonical dump, units, fragments, citations`, async () => {
      const mine = await openSpdf(path, { engine });
      const ref = await openWithNode(path);
      try {
        expect(mine.version).toBe(ref.version);
        expect(mine.legacy).toBe(ref.legacy);
        expect(mine.gzipped).toBe(ref.gzipped);
        expect(mine.docref).toBe(ref.docref);
        expect(mine.document).toEqual(ref.document);
        expect(await mine.dump()).toEqual(await ref.dump());
        const [u1, u2] = [await mine.units(), await ref.units()];
        expect(u1).toEqual(u2);
        expect(await mine.fragments()).toEqual(await ref.fragments());
        for (const u of u1) {
          for (const locale of ['en', 'es']) expect(mine.cite(u.anchor, locale)).toBe(ref.cite(u.anchor, locale));
        }
      } finally {
        await mine.close();
        await ref.close();
      }
      expect(leftovers()).toEqual([]);
      expect(host.fake.openCount()).toBe(0);
    });
  }

  it('lexical search through FTS5', async () => {
    const mine = await openSpdf(EN, { engine });
    const ref = await openWithNode(EN);
    try {
      const a = await mine.searchLexical('anchor folio', { limit: 5 });
      const b = await ref.searchLexical('anchor folio', { limit: 5 });
      expect(a.length).toBeGreaterThan(0);
      expect(a).toEqual(b);
    } finally {
      await mine.close();
      await ref.close();
    }
  });

  it('full validation (with the FTS5 integrity check on a temporary copy)', async () => {
    for (const path of [EN, ES, ...LEGACY_FILES, ROTO]) {
      const a = await validate(path, { engine });
      const b = await validateWithNode(path);
      expect({ valid: a.valid, version: a.version, errors: a.errors.map((e) => e.code), warnings: a.warnings.map((w) => w.code) }).toEqual({
        valid: b.valid,
        version: b.version,
        errors: b.errors.map((e) => e.code),
        warnings: b.warnings.map((w) => w.code),
      });
    }
    expect(leftovers()).toEqual([]);
  });

  it('reads blobs as Uint8Array of this realm', async () => {
    const doc = await openSpdf(EN, { engine });
    try {
      const blobs = await doc.blobs();
      expect(blobs.length).toBeGreaterThan(0);
      const b = await doc.blob(blobs[0]!.key);
      expect(b!.data).toBeInstanceOf(Uint8Array);
      expect(b!.data.byteLength).toBe(blobs[0]!.bytes);
    } finally {
      await doc.close();
    }
  });
});

describe('safe opening', () => {
  it('opens distributed files read only, and only temporary copies read-write', async () => {
    const before = host.fake.opens.length;
    const doc = await openSpdf(EN, { engine });
    await doc.close();
    const gz = await openSpdf(LEGACY, { engine });
    await gz.close();
    const opened = host.fake.opens.slice(before);
    expect(opened).toEqual([
      { path: EN, readOnly: true },
      { path: expect.stringMatching(/spdf-\d+\.sqlite$/), readOnly: true },
    ]);
    // the core set the safety pragmas on every connection
    expect(host.fake.statements).toContain('PRAGMA query_only = 1');
    expect(host.fake.statements).toContain('PRAGMA trusted_schema = OFF');
  });

  it('refuses the broken fixture (it contains a view): E020', async () => {
    await expect(openSpdf(ROTO, { engine })).rejects.toMatchObject({ code: 'E020' });
    await expect(openSpdf(ROTO, { engine })).rejects.toBeInstanceOf(SpdfError);
    expect(host.fake.openCount()).toBe(0);
  });

  it('refuses a file that is not SQLite: E001', async () => {
    const p = join(dir, 'not-sqlite.spdf');
    writeFileSync(p, 'hello, this is not a database at all');
    await expect(openSpdf(p, { engine })).rejects.toMatchObject({ code: 'E001' });
  });

  it('reads a gzip-wrapped copy of a 5.0 file, with the E003 warning', async () => {
    const p = join(dir, 'wrapped.spdf');
    writeFileSync(p, gzipSync(readFileSync(EN)));
    const doc = await openSpdf(p, { engine });
    try {
      expect(doc.gzipped).toBe(true);
      expect(doc.warnings.map((w) => w.code)).toContain('E003');
      expect(doc.cite((await doc.unit(2))!.anchor, 'en')).toBe('(Saorín Ferrer, 2026, p. 1)');
    } finally {
      await doc.close();
    }
    expect(leftovers()).toEqual([]);
  });

  it('enforces the decompression limit and reports bad gzip', async () => {
    const gz = new Uint8Array(readFileSync(LEGACY));
    await expect(engine.gunzip!(gz, 1000)).rejects.toThrow(/exceeds the limit/);
    const bad = gz.slice(0, 40);
    await expect(engine.gunzip!(bad, 1 << 30)).rejects.toThrow(/gzip/);
    const ok = await engine.gunzip!(gz, 1 << 30);
    expect(new TextDecoder().decode(ok.subarray(0, 15))).toBe('SQLite format 3');
  });

  it('explains when there is no DecompressionStream', async () => {
    const e = mozStorageEngine({ ...nodeHost(dir), decompressionStream: () => undefined });
    await expect(e.gunzip!(new Uint8Array([0x1f, 0x8b]), 10)).rejects.toThrow(/DecompressionStream/);
  });
});

describe('connection details', () => {
  it('writes, binds BLOBs first, splits scripts and serializes a temporary database', async () => {
    const c = await engine.create();
    await c.exec("CREATE TABLE t (a BLOB, b TEXT, c); INSERT INTO t VALUES (NULL, 'semi;colon', 1.5); -- trailing comment");
    await c.run('INSERT INTO t VALUES (?, ?, ?)', [new Uint8Array([1, 2, 3]), 'x', 7]);
    await c.run('INSERT INTO t VALUES (?, ?, ?)', [null, 'y', 9007199254740991n]);
    const rows = await c.all('SELECT a, b, c, length(a) AS n FROM t ORDER BY rowid');
    expect(rows).toEqual([
      { a: null, b: 'semi;colon', c: 1.5, n: null },
      { a: new Uint8Array([1, 2, 3]), b: 'x', c: 7, n: 3 },
      { a: null, b: 'y', c: 9007199254740991, n: null },
    ]);
    expect(rows[1]!.a).toBeInstanceOf(Uint8Array);
    const image = await c.serialize();
    expect(new TextDecoder().decode(image.subarray(0, 15))).toBe('SQLite format 3');
    await expect(c.all('SELECT * FROM t')).rejects.toBeInstanceOf(ColumnNamesError);
    await c.close();
    await c.close(); // idempotent
    expect(leftovers()).toEqual([]);
  });

  it('never sends Sqlite.sys.mjs an array that starts with an object', () => {
    expect(bindParams('SELECT ?, ?', [new Uint8Array([1]), 'x'])).toEqual({ sql: 'SELECT :p1, :p2', params: { p1: new Uint8Array([1]), p2: 'x' } });
    expect(bindParams('SELECT ?', ['x'])).toEqual({ sql: 'SELECT ?', params: ['x'] });
    expect(bindParams('SELECT 1')).toEqual({ sql: 'SELECT 1', params: null });
    expect(() => bindParams('SELECT ?1', [new Uint8Array([1])])).toThrow(/placeholders/);
  });

  it('copies bytes of any shape into a local Uint8Array', () => {
    expect(toLocalBytes([1, 2])).toEqual(new Uint8Array([1, 2]));
    expect(toLocalBytes(new Uint8Array([3]).buffer)).toEqual(new Uint8Array([3]));
    expect(toLocalBytes(Buffer.from([4]))).toEqual(new Uint8Array([4]));
    expect(toLocalBytes(null)).toEqual(new Uint8Array(0));
    expect(() => toLocalBytes({})).toThrow(TypeError);
  });

  it('a copy opened from bytes is deleted on close, also when opening fails', async () => {
    const bytes = new Uint8Array(readFileSync(EN));
    const c = await engine.openBytes(bytes, { readOnly: true });
    expect(leftovers()).toHaveLength(1);
    await c.close();
    expect(leftovers()).toEqual([]);
    const failing = mozStorageEngine({ ...nodeHost(dir), sqlite: () => ({ openConnection: () => Promise.reject(new Error('boom')) }) });
    await expect(failing.openBytes(bytes, { readOnly: true })).rejects.toThrow('boom');
    expect(leftovers()).toEqual([]);
  });
});
