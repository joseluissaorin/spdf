// Builds a large SPDF 5.0 for the remote-reading measurement: the whole Don Quijote
// (Project Gutenberg #2000, public domain) laid out in pages of ~1800 characters and
// fragments of ~900, with a 768-dimension f32 space for fragments and units. Without
// network, it falls back to the public-domain texts of the conformance suite.
//
//   node test/browser/make-large.mjs <out.spdf> [text-file]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SpdfWriter } from '../../dist/entry/node.js';

const out = process.argv[2] ?? '/tmp/spdf-large.spdf';
let text = null;
let source = 'Project Gutenberg #2000 (Don Quijote, Miguel de Cervantes Saavedra)';
const local = process.argv[3];
if (local && existsSync(local)) text = await readFile(local, 'utf8');
if (!text) {
  try {
    const r = await fetch('https://www.gutenberg.org/cache/epub/2000/pg2000.txt');
    if (r.ok) text = await r.text();
  } catch {
    /* offline */
  }
}
if (!text) {
  source = 'conformance/sources texts, repeated';
  const dir = new URL('../../../conformance/sources/', import.meta.url);
  const parts = [];
  for (const f of await readdir(dir)) {
    const s = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
    for (const u of s.units ?? []) parts.push(u.text);
  }
  text = Array.from({ length: 120 }, (_, i) => parts.map((p) => `${p} [${i}]`).join('\n\n')).join('\n\n');
}
const start = text.indexOf('*** START');
const end = text.indexOf('*** END');
if (start >= 0 && end > start) text = text.slice(text.indexOf('\n', start) + 1, end);
text = text.replace(/\r\n/g, '\n').normalize('NFC');

// Pages of ~1800 characters cut at paragraph or sentence boundaries.
const pages = [];
let rest = text.trim();
while (rest.length) {
  let cut = rest.length <= 1800 ? rest.length : rest.lastIndexOf('\n\n', 1800);
  if (cut < 900) cut = rest.lastIndexOf('. ', 1800) + 1;
  if (cut < 900) cut = Math.min(1800, rest.length);
  pages.push(rest.slice(0, cut).trim());
  rest = rest.slice(cut).trim();
}

// Deterministic pseudo-embeddings (normalized, 768 dims): a hashed bag of words.
const DIMS = 768;
function embed(s) {
  const v = new Float32Array(DIMS);
  for (const w of s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}+/gu) ?? []) {
    const h = createHash('sha256').update(w).digest();
    v[h.readUInt16LE(0) % DIMS] += 1;
    v[h.readUInt16LE(2) % DIMS] -= 0.5;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

const w = await SpdfWriter.create();
await w.setMeta('created', '2026-10-07T00:00:00Z');
await w.setDocument({
  id: 'quijote-gutenberg',
  kind: 'document',
  metadata: {
    type: 'book',
    title: 'El ingenioso hidalgo don Quijote de la Mancha',
    author: [{ family: 'Cervantes Saavedra', given: 'Miguel de' }],
    issued: { 'date-parts': [[1605]] },
    language: 'es',
    note: `Test file for remote reading. Text: ${source}; pages and folios are synthetic.`,
  },
  source_sha256: createHash('sha256').update(text).digest('hex'),
  mime: 'text/plain',
  bytes: Buffer.byteLength(text),
  created: '2026-10-07T00:00:00Z',
  updated: '2026-10-07T00:00:00Z',
});
const units = pages.map((t, i) => ({ id: `p${i + 1}`, anchor: { type: 'page', physical: i + 1, printed: String(i + 1), source: 'read' }, text: t, reader: 'gutenberg-plain-text' }));
await w.addUnits(units);
const frags = [];
pages.forEach((t, i) => {
  const mid = t.length > 1000 ? Math.max(t.indexOf('. ', 800) + 1, 1) : t.length;
  const a = t.slice(0, mid).trim();
  const b = t.slice(mid).trim();
  const anchor = { type: 'page', physical: i + 1, printed: String(i + 1) };
  frags.push({ id: `f${i + 1}a`, unit: `p${i + 1}`, text: a, anchor: { ...anchor, chars: [0, Array.from(t.slice(0, mid)).length] } });
  if (b) frags.push({ id: `f${i + 1}b`, unit: `p${i + 1}`, text: b, anchor });
});
await w.addFragments(frags);
const space = await w.addSpace({ provider: 'test', model: 'hashed-bow', dims: DIMS, modalities: ['text'], created: '2026-10-07T00:00:00Z' });
await w.addVectors(space, frags.map((f) => ({ target: 'fragment', id: f.id, vector: embed(f.text) })));
await w.addVectors(space, units.map((u) => ({ target: 'unit', id: u.id, vector: embed(u.text) })));
const bytes = await w.finish();
await writeFile(out, bytes);
console.log(JSON.stringify({ out, bytes: bytes.byteLength, pages: pages.length, fragments: frags.length, source }));
