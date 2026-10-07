// Bun: the shared conformance suite with bun:sqlite, plus a write → read round trip.
// Run with `bun test/bun/smoke.ts` (no build needed: Bun runs the TypeScript sources).
import { SpdfWriter, bunEngine, openSpdf, validate } from '../../src/entry/bun.ts';
import { runConformance } from '../../src/conformance.ts';

const engine = bunEngine();
const dir = new URL('../../../conformance/', import.meta.url).pathname;
const report = await runConformance(dir, { engine });
console.log(`bun ${Bun.version}: ${report.passed.length} passed, ${report.failed.length} failed`);
for (const f of report.failed) console.log(`  ${f.id}: ${f.reason}`);
if (process.env.SPDF_CONFORMANCE_OUT) await Bun.write(process.env.SPDF_CONFORMANCE_OUT, JSON.stringify({ ...report, engine: 'bun:sqlite' }, null, 2));

const w = await SpdfWriter.create({ engine });
await w.setDocument({ id: 'd', kind: 'document', metadata: { type: 'book', title: 'Rimas', author: [{ family: 'Bécquer' }], issued: { 'date-parts': [[1871]] } }, source_sha256: '0'.repeat(64), mime: 'text/plain', bytes: 1 });
await w.addUnits([{ id: 'u1', anchor: { type: 'verse', line_from: 1, line_to: 4 }, text: '¿Qué es poesía?, dices mientras clavas', reader: 'test' }]);
await w.addFragments([{ id: 'f1', unit: 'u1', text: '¿Qué es poesía?, dices mientras clavas', anchor: { type: 'verse', line_from: 1, line_to: 4 } }]);
const bytes = await w.finish({ contentHash: true });
const r = await validate(bytes, { engine });
const doc = await openSpdf(bytes, { engine });
const hits = await doc.searchLexical('poesia');
console.log(`round trip: valid=${r.valid}, hits=${hits.map((h) => h.fragment_id).join(',')}, cite=${doc.cite(hits[0]!.anchor)}`);
await doc.close();
if (report.failed.length || !r.valid || hits.length !== 1) process.exit(1);
