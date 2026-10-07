import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  BytesSource,
  SpdfWriter,
  canonicalJson,
  convertLegacy,
  dump,
  generateSigningKey,
  nodeEngine,
  openRaw,
  openSpdf,
  SpdfDocument,
  validate,
  type SqlEngine,
} from '../src/entry/node.js';
import { wasmEngine } from '../src/adapters/wasm.js';
import { buildLegacy, buildQuijote50, mutate, SHA } from './fixtures.js';

const engines: Array<[string, SqlEngine]> = [
  ['node:sqlite', nodeEngine()],
  ['sqlite-wasm', wasmEngine()],
];

const codes = (r: { errors: Array<{ code: string }> }) => [...new Set(r.errors.map((e) => e.code))].sort();
const wcodes = (r: { warnings: Array<{ code: string }> }) => [...new Set(r.warnings.map((e) => e.code))].sort();

describe.each(engines)('SPDF 5.0 with %s', (_name, engine) => {
  it('writes a valid file and reads it back', async () => {
    const bytes = await buildQuijote50({ engine, contentHash: true });
    const r = await validate(bytes, { engine });
    expect(r).toEqual({ valid: true, version: '5.0', profile: ['core', 'semantic'], errors: [], warnings: [] });
    const doc = await openSpdf(bytes, { engine });
    expect(doc.version).toBe('5.0');
    expect(doc.legacy).toBe(false);
    expect(doc.document.metadata.title).toBe('El ingenioso hidalgo don Quijote de la Mancha');
    expect(doc.document.authors).toBe('Cervantes Saavedra');
    expect(doc.document.year).toBe(1605);
    expect((await doc.units()).map((u) => u.ord)).toEqual([1, 2, 3, 4]);
    expect((await doc.unit(2))?.printed).toBe('1');
    expect((await doc.unitByPrinted('3')).map((u) => u.id)).toEqual(['u4']);
    expect((await doc.fragments('u3')).map((f) => f.id)).toEqual(['f3']);
    const blob = await doc.blob('blob:original');
    expect(new TextDecoder().decode(blob?.data)).toBe('%PDF-1.4 test');
    expect((await doc.spaces()).map((s) => s.id)).toEqual(['toy@4', 'toy@4:i8']);
    const i8 = await doc.vectors('toy@4:i8', 'fragment');
    expect(i8[1]?.vector[0]).toBeCloseTo(76 / 127, 6);
    expect((await doc.verifyIntegrity()).hash_ok).toBe(true);
    await doc.close();
  });

  it('searches lexically (with the modernized layer), by vector and hybrid', async () => {
    const doc = await openSpdf(await buildQuijote50({ engine }), { engine });
    const lex = await doc.searchLexical('hidalgo');
    expect(lex.map((h) => h.fragment_id)).toEqual(['f3', 'f1']); // BM25 favours the shorter fragment
    expect(lex[1]?.anchor_uri).toBe(`spdf:sha256-${SHA}#p=1&char=0,177`);
    expect((await doc.searchLexical('MISMO')).map((h) => h.fragment_id)).toEqual(['f4']);
    expect((await doc.searchLexical('aristoteles')).map((h) => h.fragment_id)).toEqual(['f4']);
    expect((await doc.searchLexical('«lanza en astillero» hidalgo')).map((h) => h.fragment_id)).toEqual(['f1']);
    expect(await doc.searchLexical('   ')).toEqual([]);
    const vec = await doc.searchVector('toy@4', [0, 0, 1, 0], { limit: 2 });
    expect(vec.map((h) => [h.fragment_id, Number(h.score.toFixed(6))])).toEqual([
      ['f3', 1],
      ['f4', 0.8],
    ]);
    const hyb = await doc.searchHybrid('hidalgo', [0, 0, 1, 0], 'toy@4', { limit: 3 });
    expect(hyb.map((h) => [h.fragment_id, h.via])).toEqual([
      ['f3', ['lexical', 'vector']],
      ['f1', ['lexical', 'vector']],
      ['f4', ['vector']],
    ]);
    expect(hyb[0]?.score).toBeCloseTo(1 / 11 + 1 / 11, 12);
    await doc.close();
  });

  it('dumps canonically and identically from bytes and after a round trip', async () => {
    const bytes = await buildQuijote50({ engine });
    const d1 = await dump(bytes, { engine });
    expect(d1.spdf_version).toBe('5.0');
    expect(d1.fts).toEqual({ tokenizer: 'unicode61 remove_diacritics 2', trigram: false });
    expect(d1.vectors).toHaveProperty(['toy@4', 'count'], 4);
    expect((d1.units as unknown[]).length).toBe(4);
    expect(d1.provenance).toEqual([{ at: '2026-10-07T00:00:00Z', detail: { pages: 4 }, model: 'pdf-text-layer', ms: 12, provider: 'local', stage: 'read' }]);
    const doc = await openSpdf(bytes, { engine });
    const copy = await (await SpdfWriter.fromSpdf(doc)).finish();
    await doc.close();
    const d2 = await dump(copy, { engine });
    const strip = (d: Record<string, unknown>) => ({ ...d, meta: { ...(d.meta as object), generator: null } });
    expect(canonicalJson(strip(d2))).toBe(canonicalJson(strip(d1)));
  });

  it('signs and detects tampering (E081) and forged signers (E082)', async () => {
    const { privateKey, signer } = await generateSigningKey();
    const bytes = await buildQuijote50({ engine, signWith: privateKey });
    const doc = await openSpdf(bytes, { engine });
    expect(doc.meta.signer).toBe(signer);
    expect(await doc.verifyIntegrity(signer)).toMatchObject({ hash_ok: true, signature_ok: true, trusted_key: true });
    await doc.close();
    expect((await validate(bytes, { engine })).valid).toBe(true);
    const tampered = mutate(bytes, "UPDATE units SET text = text || ' (sic)' WHERE id = 'u2'");
    expect(codes(await validate(tampered, { engine }))).toEqual(['E081']); // E082 is only checked when the hash matches
    const other = await generateSigningKey();
    const forged = mutate(bytes, `UPDATE spdf_meta SET value = '${other.signer}' WHERE key = 'signer'`);
    expect(codes(await validate(forged, { engine }))).toEqual(['E082']);
  });

  it('reads through the random-access VFS when the engine supports it', async () => {
    if (!engine.openSource) return;
    const bytes = await buildQuijote50({ engine });
    const source = new BytesSource(bytes);
    const doc = await SpdfDocument.fromRaw(await openRaw({ source }, { engine }), { engine });
    expect((await doc.searchLexical('Mancha')).map((h) => h.fragment_id)).toEqual(['f1']);
    expect(source.stats().requests).toBeGreaterThan(0);
    await doc.close();
  });
});

describe.each(engines)('legacy 4.x with %s', (_name, engine) => {
  it.each(['4.0', '4.1'] as const)('opens a gzip-wrapped %s file through the 5.0 view', async (v) => {
    const doc = await openSpdf(buildLegacy(v), { engine });
    expect(doc.version).toBe(v);
    expect(doc.legacy).toBe(true);
    expect(doc.gzipped).toBe(true);
    expect(doc.meta).toMatchObject({ spdf_version: v, created: '2025-11-02T10:00:00.000Z', generator: 'scholaris-nube/spdf 0.2' });
    expect(doc.document.kind).toBe('scanned_pdf');
    expect(doc.document.source_ref).toBe('original.pdf');
    expect(doc.document.metadata).toMatchObject({ type: 'book', title: 'El ingenioso hidalgo don Quijote de la Mancha: Primera parte', 'title-short': 'El ingenioso hidalgo don Quijote de la Mancha' });
    const units = await doc.units();
    expect(units.map((u) => [u.ord, u.image, u.thumbnail])).toEqual([
      [1, 'blob:pagina-1.webp', null],
      [2, 'r2://imagenes/x.webp', null],
      [3, 'r2://imagenes/x.webp', null],
    ]);
    expect(units[2]?.anchor).toEqual({ type: 'page', physical: 3, printed: '2', roman: false, source: 'inferred', confidence: 0.9 });
    expect((await doc.figures())[0]?.image).toBe('blob:pagina-1.webp');
    // Legacy blobs (clave, mime, datos) through the 5.0 view: keys, sizes and computed hashes.
    expect(await doc.blobs()).toEqual([{ key: 'pagina-1.webp', mime: 'image/webp', bytes: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect((await doc.blob(units[0]!.image as string))?.data).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect((await doc.spaces())[0]).toMatchObject({ id: 'toy@2', dtype: 'f32', modalities: ['text'] });
    expect((await doc.vectors('toy@2')).map((x) => x.target)).toEqual(['fragment', 'fragment']);
    expect((await doc.searchLexical('caballerías')).map((h) => h.fragment_id)).toEqual(['fr2']);
    expect((await doc.searchHybrid('hidalgo', [0, 1], 'toy@2')).map((h) => h.fragment_id)).toEqual(['fr0', 'fr1', 'fr2']);
    expect(doc.cite(units[0]!.anchor)).toBe('(Cervantes Saavedra, 1605, s. p.)');
    expect(doc.cite(units[2]!.anchor)).toBe('(Cervantes Saavedra, 1605, p. [2])');
    const d = await doc.dump();
    expect(d.legacy).toBe(true);
    expect(d.spdf_version).toBe(v);
    expect((d.blobs as Array<{ sha256: string }>)[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.provenance).toEqual([{ at: '2025-11-02T10:00:00.000Z', detail: { paginas: 3 }, model: null, ms: 1500, provider: 'gemini', stage: 'lectura' }]);
    await doc.close();
    const r = await validate(buildLegacy(v), { engine });
    expect(r.valid).toBe(true);
    expect(wcodes(r)).toEqual(['W110']);
  });

  it('converts legacy to a valid 5.0 file', async () => {
    const out = await convertLegacy(buildLegacy('4.1'), { engine, contentHash: true });
    const r = await validate(out, { engine });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    const doc = await openSpdf(out, { engine });
    expect(doc.version).toBe('5.0');
    expect(doc.meta.created).toBe('2025-11-02T10:00:00.000Z');
    expect((await doc.units()).map((u) => u.ord)).toEqual([1, 2, 3]);
    expect((await doc.searchLexical('caballerías')).map((h) => h.fragment_id)).toEqual(['fr2']);
    expect((await doc.blob('pagina-1.webp'))?.mime).toBe('image/webp');
    await doc.close();
  });
});

describe('invalid files', () => {
  const engine = nodeEngine();
  it('E001 not SQLite, E002 unknown schema', async () => {
    expect(codes(await validate(new TextEncoder().encode('hello world, not a database at all'), { engine }))).toEqual(['E001']);
    expect(codes(await validate(new Uint8Array(gzipSync(new TextEncoder().encode('x'))), { engine }))).toEqual(['E001']);
    const bytes = await buildQuijote50({ engine });
    expect(codes(await validate(mutate(bytes, 'PRAGMA application_id = 0'), { engine }))).toEqual(['E002']);
    expect(codes(await validate(mutate(bytes, 'PRAGMA user_version = 600'), { engine }))).toEqual(['E002']);
    const newer = await validate(mutate(bytes, 'PRAGMA user_version = 510'), { engine });
    expect(wcodes(newer)).toEqual(['W105']);
    await expect(openSpdf(mutate(bytes, 'PRAGMA application_id = 0'), { engine })).rejects.toThrow(/E002/);
  });
  it('E003 is a warning for gzip-wrapped 5.0', async () => {
    const r = await validate(new Uint8Array(gzipSync(await buildQuijote50({ engine }))), { engine });
    expect(r.valid).toBe(true);
    expect(wcodes(r)).toEqual(['E003']);
  });
  it('E020 triggers and views are refused', async () => {
    const bytes = mutate(await buildQuijote50({ engine }), "CREATE VIEW v AS SELECT 1; CREATE TRIGGER t AFTER INSERT ON units BEGIN SELECT 1; END;");
    expect(codes(await validate(bytes, { engine }))).toEqual(['E020']);
    await expect(openSpdf(bytes, { engine })).rejects.toThrow(/E020/);
    const legacy = buildLegacy('4.1', { extraSql: 'CREATE TRIGGER evil AFTER INSERT ON documentos BEGIN SELECT 1; END;' });
    expect(codes(await validate(legacy, { engine }))).toEqual(['E020']);
  });
  it('E010, E011, E012, E013', async () => {
    const bytes = await buildQuijote50({ engine });
    expect(codes(await validate(mutate(bytes, 'DROP TABLE figures'), { engine }))).toEqual(['E010']);
    expect(codes(await validate(mutate(bytes, 'ALTER TABLE units DROP COLUMN words'), { engine }))).toEqual(['E011']);
    expect(codes(await validate(mutate(bytes, "DELETE FROM spdf_meta WHERE key = 'profile'"), { engine }))).toEqual(['E012']);
    expect(codes(await validate(mutate(bytes, "INSERT INTO documents SELECT 'otro', kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights FROM documents"), { engine }))).toEqual(['E013']);
  });
  it('E050, E051, E060, E090', async () => {
    const bytes = await buildQuijote50({ engine });
    expect(codes(await validate(mutate(bytes, "UPDATE documents SET metadata = '{not json'"), { engine }))).toEqual(['E050']);
    expect(codes(await validate(mutate(bytes, "UPDATE documents SET metadata = '{\"title\":\"x\"}'"), { engine }))).toEqual(['E051']);
    expect(codes(await validate(mutate(bytes, "INSERT INTO extensions VALUES ('x_acme_magic', '1', 1)"), { engine }))).toEqual(['E060']);
    expect(codes(await validate(mutate(bytes, "UPDATE units SET ord = 7 WHERE id = 'u3'"), { engine }))).toEqual(['E090']);
  });
  it('E040, E041, E042 anchors', async () => {
    const bytes = await buildQuijote50({ engine });
    expect(codes(await validate(mutate(bytes, "UPDATE units SET anchor = 'nope' WHERE id = 'u1'"), { engine }))).toEqual(['E040']);
    expect(codes(await validate(mutate(bytes, `UPDATE units SET anchor = '{"type":"page","printed":"1"}' WHERE id = 'u1'`), { engine }))).toEqual(['E040']);
    expect(codes(await validate(mutate(bytes, `UPDATE figures SET anchor = '{"type":"hologram"}'`), { engine }))).toEqual([]);
    expect(codes(await validate(mutate(bytes, `UPDATE fragments SET anchor = '{"type":"hologram"}' WHERE id = 'f1'`), { engine }))).toEqual(['E041']);
    expect(codes(await validate(mutate(bytes, `UPDATE fragments SET anchor = '{"type":"page","physical":1,"printed":null,"chars":[0,9999]}' WHERE id = 'f1'`), { engine }))).toEqual(['E042']);
  });
  it('E030, E031, E032 vectors; E070 FTS; E080 blobs; W100, W102', async () => {
    const bytes = await buildQuijote50({ engine });
    expect(codes(await validate(mutate(bytes, "UPDATE vectors SET data = x'00' WHERE id = 'f1' AND space = 'toy@4'"), { engine }))).toEqual(['E030']);
    expect(codes(await validate(mutate(bytes, "PRAGMA foreign_keys = OFF; UPDATE vectors SET space = 'ghost' WHERE id = 'f1' AND space = 'toy@4'"), { engine }))).toEqual(['E031']);
    expect(codes(await validate(mutate(bytes, "UPDATE spaces SET dtype = 'bf16' WHERE id = 'toy@4'"), { engine }))).toEqual(['E032']);
    expect(codes(await validate(mutate(bytes, "UPDATE fragments SET text = 'otra cosa' WHERE id = 'f1'"), { engine }))).toEqual(['E070']);
    expect(codes(await validate(mutate(bytes, "UPDATE blobs SET sha256 = '00'"), { engine }))).toEqual(['E080']);
    const w = await validate(mutate(bytes, "DELETE FROM vectors; UPDATE documents SET unit_count = 9"), { engine });
    expect(codes(w)).toEqual([]);
    expect(wcodes(w)).toEqual(['W100', 'W102']);
  });
});
