// Web Worker side of the browser tests: remote reading over HTTP Range requests with
// byte counts, OPFS (opfs-sahpool) storage, lazy Blob reading and legacy gzip by URL.
import sqlite3InitModule from '/js/node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';
import { configureBrowserEngine, openRemote, openBlob, openSpdf, wasmEngine, SpdfWriter, validate } from '/js/dist/entry/browser.js';

// The message handler is registered before any await: a module worker that is still
// evaluating would drop the message otherwise.
let sqlite3;
async function init() {
  globalThis.sqlite3ApiConfig = { disable: { vfs: { opfs: true, kvvfs: true, 'opfs-wl': true } }, warn: () => {}, log: () => {}, error: () => {} };
  sqlite3 = await sqlite3InitModule();
  configureBrowserEngine({ sqlite3 });
}

function delta(a, b) {
  return { requests: b.requests - a.requests, bytes: b.bytesFetched - a.bytesFetched };
}

// Each operation on a freshly opened document, so the bytes include opening it: what a
// reader pays to answer that one request from a cold cache.
async function measure(url) {
  const results = {};
  let size = 0;
  const fresh = async (name, fn) => {
    const t = performance.now();
    const doc = await openRemote(url);
    size = doc.source.size;
    const opened = doc.source.stats();
    const value = await fn(doc);
    const s = doc.source.stats();
    results[name] = { requests: s.requests, bytes: s.bytesFetched, open_bytes: opened.bytesFetched, ms: Math.round(performance.now() - t) };
    await doc.close();
    return value;
  };
  await fresh('open only', async () => null);
  const hits = await fresh('lexical: Rocinante', (d) => d.searchLexical('Rocinante', { limit: 10 }));
  await fresh('lexical: molinos de viento', (d) => d.searchLexical('molinos de viento', { limit: 10 }));
  await fresh('lexical: "Dulcinea del Toboso" (phrase)', (d) => d.searchLexical('"Dulcinea del Toboso"', { limit: 10 }));
  await fresh('lexical: hidalgo de la Mancha', (d) => d.searchLexical('hidalgo de la Mancha', { limit: 10 }));
  await fresh('lexical twice (second one cached)', async (d) => {
    await d.searchLexical('Sancho Panza', { limit: 10 });
    const a = d.source.stats();
    await d.searchLexical('Sancho Panza', { limit: 10 });
    const b = d.source.stats();
    return b.bytesFetched - a.bytesFetched;
  });
  await fresh('unit(700) + its fragments', async (d) => {
    const u = await d.unit(700);
    return d.fragments(u.id);
  });
  const spaceInfo = await fresh('spaces()', (d) => d.spaces());
  const space = spaceInfo[0];
  const query = Array.from({ length: space.dims }, (_, i) => Math.sin(i + 1));
  const vec = await fresh(`vector search (${space.dims} × ${space.dtype}, brute force)`, (d) => d.searchVector(space.id, query, { limit: 10 }));
  await fresh('hybrid search', (d) => d.searchHybrid('molinos de viento', query, space.id, { limit: 10 }));
  return { size, steps: results, firstHit: hits[0]?.fragment_id, vectorTop: vec[0]?.fragment_id };
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
  await init();
  for (const [k, fn] of [
    ['measure', () => measure(largeUrl)],
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
