// Web Worker side of the browser tests: remote reading over HTTP Range requests with
// byte counts, OPFS (opfs-sahpool) storage, lazy Blob reading and legacy gzip by URL.
import sqlite3InitModule from '/js/node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';
import { configureBrowserEngine, openRemote, openBlob, openSpdf, wasmEngine, SpdfWriter, validate } from '/js/dist/entry/browser.js';

globalThis.sqlite3ApiConfig = { disable: { vfs: { opfs: true, kvvfs: true, 'opfs-wl': true } }, warn: () => {}, log: () => {}, error: () => {} };
const sqlite3 = await sqlite3InitModule();
configureBrowserEngine({ sqlite3 });

function delta(a, b) {
  return { requests: b.requests - a.requests, bytes: b.bytesFetched - a.bytesFetched };
}

async function measure(url) {
  const t0 = performance.now();
  const doc = await openRemote(url);
  const src = doc.source;
  const size = src.size;
  const s0 = src.stats();
  const steps = { open: { requests: s0.requests, bytes: s0.bytesFetched, ms: Math.round(performance.now() - t0) } };
  const run = async (name, fn) => {
    const a = src.stats();
    const t = performance.now();
    const value = await fn();
    steps[name] = { ...delta(a, src.stats()), ms: Math.round(performance.now() - t) };
    return value;
  };
  const hits = await run('lexical "molinos de viento"', () => doc.searchLexical('molinos de viento', { limit: 10 }));
  await run('lexical "Dulcinea del Toboso" (phrase)', () => doc.searchLexical('"Dulcinea del Toboso"', { limit: 10 }));
  await run('lexical, same query again (cached)', () => doc.searchLexical('molinos de viento', { limit: 10 }));
  await run('unit(700)', () => doc.unit(700));
  await run('cite + anchor of the first hit', async () => doc.cite(hits[0].anchor));
  const [space] = await run('spaces()', () => doc.spaces());
  const v = (await doc.vectors(space.id, 'fragment')).slice(0, 1)[0].vector;
  const vec = await run('vector search (fragments, 768 × f32, brute force)', () => doc.searchVector(space.id, v, { limit: 10 }));
  await run('hybrid search (after the vector pass)', () => doc.searchHybrid('molinos de viento', v, space.id, { limit: 10 }));
  const total = src.stats();
  await doc.close();
  return { size, steps, total: { requests: total.requests, bytes: total.bytesFetched }, firstHit: hits[0]?.fragment_id, vectorTop: vec[0]?.fragment_id };
}

async function freshSearchOnly(url) {
  // Open + one lexical search, nothing else: what a reader pays to answer one query.
  const doc = await openRemote(url);
  const hits = await doc.searchLexical('molinos de viento', { limit: 10 });
  const s = doc.source.stats();
  await doc.close();
  return { requests: s.requests, bytes: s.bytesFetched, hits: hits.length };
}

async function opfs(smallUrl) {
  const bytes = new Uint8Array(await (await fetch(smallUrl)).arrayBuffer());
  const engine = wasmEngine({ sqlite3, storage: 'opfs' });
  const usesOpfs = await engine.usesOpfs();
  const doc = await openSpdf(bytes, { engine });
  const hits = await doc.searchLexical('hidalgo');
  const copy = await (await SpdfWriter.fromSpdf(doc, { engine })).finish();
  await doc.close();
  const r = await validate(copy, { engine });
  return { usesOpfs, hits: hits.length, copyValid: r.valid, copyBytes: copy.byteLength };
}

async function blob(smallUrl) {
  const b = await (await fetch(smallUrl)).blob();
  const doc = await openBlob(b);
  const lazy = doc.source !== null;
  const hits = await doc.searchLexical('hidalgo');
  const stats = doc.source?.stats() ?? null;
  await doc.close();
  return { lazy, hits: hits.length, stats, size: b.size };
}

async function legacyRemote(url) {
  const doc = await openRemote(url);
  const r = { version: doc.version, legacy: doc.legacy, gzipped: doc.gzipped, units: (await doc.units()).length };
  await doc.close();
  return r;
}

self.onmessage = async (e) => {
  const { largeUrl, smallUrl, legacyUrl } = e.data;
  const out = {};
  for (const [k, fn] of [
    ['measure', () => measure(largeUrl)],
    ['searchOnly', () => freshSearchOnly(largeUrl)],
    ['opfs', () => opfs(smallUrl)],
    ['blob', () => blob(smallUrl)],
    ['legacyRemote', () => legacyRemote(legacyUrl)],
  ]) {
    try {
      out[k] = await fn();
    } catch (err) {
      out[k] = { error: String(err?.stack ?? err) };
    }
  }
  self.postMessage(out);
};
