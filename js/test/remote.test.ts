import { describe, expect, it } from 'vitest';
import { RangeSource, SpdfDocument, SpdfWriter, openRaw } from '../src/entry/node.js';
import { wasmEngine } from '../src/adapters/wasm.js';
import { QUIJOTE } from './fixtures.js';

// The read-only VFS of the WebAssembly adapter over a range transport (in memory here; in
// the browser it is synchronous XHR with HTTP Range): a search must touch a small part of
// a large file.
describe('lazy reading through ranges', () => {
  it('opens and searches a ~10 MB file reading a small fraction of it', async () => {
    const engine = wasmEngine();
    const w = await SpdfWriter.create({ engine });
    await w.setDocument({ id: 'big', kind: 'document', metadata: { type: 'book', title: 'Big', author: [{ family: 'Cervantes' }] }, source_sha256: 'a'.repeat(64), mime: 'text/plain', bytes: 1 });
    const units = [];
    const frags = [];
    for (let i = 0; i < 3000; i++) {
      const text = `${QUIJOTE[i % 4]} [${i}] ${i % 997 === 0 ? 'Rocinante' : ''}`;
      units.push({ id: `u${i + 1}`, anchor: { type: 'page' as const, physical: i + 1, printed: String(i + 1) }, text: text.repeat(3), reader: 'test' });
      frags.push({ id: `f${i + 1}`, unit: `u${i + 1}`, text, anchor: { type: 'page' as const, physical: i + 1, printed: String(i + 1) } });
    }
    await w.addUnits(units);
    await w.addFragments(frags);
    const sp = await w.addSpace({ provider: 't', model: 'm', dims: 256, modalities: ['text'] });
    await w.addVectors(sp, frags.map((f, i) => ({ target: 'fragment' as const, id: f.id, vector: Array.from({ length: 256 }, (_, k) => Math.sin(i + k)) })));
    const file = await w.finish();
    expect(file.byteLength).toBeGreaterThan(5_000_000);

    const fetches: Array<[number, number]> = [];
    const source = new RangeSource(file.byteLength, (a, b) => {
      fetches.push([a, b]);
      return file.subarray(a, b + 1);
    });
    const doc = await SpdfDocument.fromRaw(await openRaw({ source }, { engine }), { engine });
    const opened = source.stats().bytesFetched;
    expect(opened).toBeLessThan(64 * 1024);
    const hits = await doc.searchLexical('Rocinante', { limit: 5 });
    expect(hits.map((h) => h.fragment_id).sort()).toEqual(['f1', 'f1995', 'f2992', 'f998']);
    const u = await doc.unit(1500);
    expect(u?.id).toBe('u1500');
    const used = source.stats();
    expect(used.bytesFetched).toBeLessThan(file.byteLength / 20);
    expect(fetches.every(([a, b]) => b >= a && b < file.byteLength)).toBe(true);
    await doc.close();
  });
});
