/**
 * Conformance runner (contract §11, `conformance/README.md`): executes every case of the
 * shared suite and reports `{impl, version, passed, failed, skipped}`.
 *
 * The runner is platform-agnostic: it reads the suite through a small I/O interface, so
 * the same code runs in Node (files) and in a browser (fetch). `runConformance(dir)` is
 * the Node version used by the CLI.
 */

import { VERSION } from './version.js';
import type { SqlEngine } from './port.js';
import { openSpdf } from './document.js';
import { dumpDocument } from './dump.js';
import { contentSha256OfDump } from './integrity.js';
import { validate } from './validate.js';
import { lexicalRanking, searchHybrid, searchVector } from './search.js';
import { formatAnchorUri, formatLocator, parseAnchorUri, type AnchorLocator } from './anchors.js';
import { cite } from './cite.js';
import { SpdfWriter, type SpdfSource } from './writer.js';
import { canonicalize } from './canonical.js';
import { encodeVector } from './vectors.js';
import { cslLocator, toBibtex, toCslJsonArray } from './bib.js';
import { pageSequence } from './structure.js';
import { toHex } from './bytes.js';
import type { Anchor, CslItem, VectorTarget } from './types.js';

export interface ConformanceIO {
  /** Case file names (`cases/*.json`, relative to the suite root), any order. */
  listCases(): Promise<string[]>;
  /** Bytes of a file relative to the suite root. */
  read(path: string): Promise<Uint8Array>;
}

export interface ConformanceReport {
  impl: string;
  version: string;
  engine: string;
  suite_version: string | null;
  passed: string[];
  failed: Array<{ id: string; reason: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

export interface ConformanceOptions {
  engine?: SqlEngine;
  /** Run only the case with this id (or ids starting with it). */
  only?: string;
  /** Kinds not claimed by this build (reported as skipped). */
  skipKinds?: string[];
}

interface Case {
  id: string;
  kind: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
}

const IMPL = 'spdf-format (TypeScript)';
const TOL = 1e-6;

class Mismatch extends Error {}

function fail(reason: string): never {
  throw new Mismatch(reason);
}

/** Structural JSON equality (numbers as doubles, key order irrelevant); returns the first difference. */
export function jsonDiff(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return a === b ? null : `${path || '/'}: ${a} ≠ ${b}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path || '/'}: ${JSON.stringify(a)?.slice(0, 120)} ≠ ${JSON.stringify(b)?.slice(0, 120)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path || '/'}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path || '/'}: length ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = jsonDiff(a[i], b[i], `${path}/${i}`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of [...keys].sort()) {
    if (!(k in ao)) return `${path}/${k}: missing`;
    if (!(k in bo)) return `${path}/${k}: unexpected`;
    const d = jsonDiff(ao[k], bo[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

const decoder = new TextDecoder();

async function readJson<T>(io: ConformanceIO, path: string): Promise<T> {
  return JSON.parse(decoder.decode(await io.read(path))) as T;
}

type Result = { fragment_id?: string; score: number; anchor_uri?: string; via?: string[] };

function compareResults(actual: Result[], expected: Result[], withVia: boolean): void {
  if (actual.length !== expected.length) {
    fail(`${actual.length} results, expected ${expected.length} (${actual.map((r) => r.fragment_id).join(',')} vs ${expected.map((r) => r.fragment_id).join(',')})`);
  }
  expected.forEach((e, i) => {
    const a = actual[i] as Result;
    if (a.fragment_id !== e.fragment_id) fail(`result ${i}: ${a.fragment_id} ≠ ${e.fragment_id}`);
    if (Math.abs(a.score - e.score) > TOL) fail(`result ${i} (${e.fragment_id}): score ${a.score} ≠ ${e.score}`);
    if (e.anchor_uri !== undefined && a.anchor_uri !== e.anchor_uri) fail(`result ${i}: anchor_uri ${a.anchor_uri} ≠ ${e.anchor_uri}`);
    if (withVia && e.via !== undefined && JSON.stringify(a.via) !== JSON.stringify(e.via)) fail(`result ${i}: via ${JSON.stringify(a.via)} ≠ ${JSON.stringify(e.via)}`);
  });
}

async function runCase(c: Case, io: ConformanceIO, engine: SqlEngine | undefined): Promise<void> {
  const opts = engine ? { engine } : {};
  const input = c.input;
  const expect = c.expect;
  switch (c.kind) {
    case 'dump':
    case 'legacy_dump': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const d = await dumpDocument(doc);
        const diff = jsonDiff(d, canonicalize(await readJson(io, String(expect.dump))));
        if (diff) fail(`dump differs at ${diff}`);
        const h = await contentSha256OfDump(d);
        if (h !== expect.content_sha256) fail(`content_sha256 ${h} ≠ ${String(expect.content_sha256)}`);
      } finally {
        await doc.close();
      }
      return;
    }
    case 'roundtrip': {
      const source = await readJson<SpdfSource>(io, String(input.source));
      const w = await SpdfWriter.fromSource(source, opts);
      const bytes = await w.finish();
      const doc = await openSpdf(bytes, opts);
      try {
        const diff = jsonDiff(await dumpDocument(doc), canonicalize(await readJson(io, String(expect.dump))));
        if (diff) fail(`round-trip dump differs at ${diff}`);
      } finally {
        await doc.close();
      }
      return;
    }
    case 'validate': {
      const r = await validate(await io.read(String(input.file)), opts);
      const set = (xs: Array<{ code: string }> | string[]) => [...new Set(xs.map((x) => (typeof x === 'string' ? x : x.code)))].sort().join(',');
      if (r.valid !== expect.valid) fail(`valid ${r.valid} ≠ ${String(expect.valid)} (errors ${set(r.errors)})`);
      if (r.version !== expect.version) fail(`version ${String(r.version)} ≠ ${String(expect.version)}`);
      if (set(r.errors) !== set(expect.errors as string[])) fail(`errors [${set(r.errors)}] ≠ [${set(expect.errors as string[])}]: ${r.errors.map((e) => e.message).join('; ')}`);
      if (set(r.warnings) !== set(expect.warnings as string[])) fail(`warnings [${set(r.warnings)}] ≠ [${set(expect.warnings as string[])}]`);
      return;
    }
    case 'search_lexical': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const ranking = await lexicalRanking(doc, String(input.query), Number(input.limit));
        if (expect.route !== undefined && ranking.route !== expect.route) fail(`route ${ranking.route} ≠ ${String(expect.route)}`);
        if (expect.match !== undefined && ranking.match !== expect.match) fail(`match ${String(ranking.match)} ≠ ${String(expect.match)}`);
        const frags = await doc.fragmentsByN(ranking.results.map((r) => r.n));
        const results = ranking.results.map((r) => ({ fragment_id: r.id, score: r.score, anchor_uri: frags.get(r.n)?.anchor_uri as string, via: ['lexical'] }));
        compareResults(results, expect.results as Result[], true);
      } finally {
        await doc.close();
      }
      return;
    }
    case 'search_vector': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const hits = await searchVector(doc, String(input.space), input.query_vector as number[], { target: input.target as VectorTarget, limit: Number(input.limit) });
        const key = (r: Result & { unit_id?: string; figure_id?: string }) => r.fragment_id ?? r.unit_id ?? r.figure_id;
        compareResults(
          hits.map((h) => ({ fragment_id: h.fragment_id ?? h.unit_id ?? h.figure_id ?? h.id, score: h.score, anchor_uri: h.anchor_uri as string })),
          (expect.results as Array<Result & { unit_id?: string; figure_id?: string }>).map((r) => ({ ...r, fragment_id: key(r) as string })),
          false,
        );
      } finally {
        await doc.close();
      }
      return;
    }
    case 'search_hybrid': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const hits = await searchHybrid(doc, String(input.query), input.query_vector as number[], String(input.space), { limit: Number(input.limit) });
        compareResults(
          hits.map((h) => ({ fragment_id: h.fragment_id, score: h.score, anchor_uri: h.anchor_uri, via: h.via })),
          expect.results as Result[],
          true,
        );
      } finally {
        await doc.close();
      }
      return;
    }
    case 'anchor_uri': {
      if ('error' in expect) {
        let parsed: unknown;
        try {
          parsed = parseAnchorUri(String(input.uri));
        } catch {
          return;
        }
        fail(`parse accepted an invalid URI: ${JSON.stringify(parsed)}`);
      }
      if ('anchor' in input) {
        const uri = formatAnchorUri(String(input.docref), input.anchor as Anchor, (input.anchor_end ?? null) as Anchor | null);
        if (uri !== expect.uri) fail(`format ${uri} ≠ ${String(expect.uri)}`);
        const p = parseAnchorUri(uri);
        const diff = jsonDiff(canonicalize(p), canonicalize({ docref: input.docref, locator: expect.locator }));
        if (diff) fail(`parse(${uri}) differs at ${diff}`);
        const again = formatLocator(p.docref, p.locator);
        if (again !== uri) fail(`format(parse(uri)) ${again} ≠ ${uri}`);
        return;
      }
      const p = parseAnchorUri(String(input.uri));
      const diff = jsonDiff(canonicalize(p), canonicalize({ docref: expect.docref, locator: expect.locator }));
      if (diff) fail(`parse differs at ${diff}`);
      const again = formatLocator(p.docref, p.locator as AnchorLocator);
      if (again !== expect.canonical) fail(`format(parse(uri)) ${again} ≠ ${String(expect.canonical)}`);
      return;
    }
    case 'cite': {
      const text = cite(input.anchor as Anchor, input.metadata as CslItem, String(input.locale), (input.anchor_end ?? null) as Anchor | null);
      if (text !== expect.text) fail(`${text} ≠ ${String(expect.text)}`);
      return;
    }
    case 'quantize': {
      let bytes: Uint8Array;
      try {
        bytes = encodeVector(input.values as number[], String(input.dtype));
      } catch (e) {
        if (expect.error === true) return;
        throw e;
      }
      if (expect.error === true) fail(`encoded ${toHex(bytes)} instead of failing`);
      if (toHex(bytes) !== expect.hex) fail(`${toHex(bytes)} ≠ ${String(expect.hex)}`);
      return;
    }
    case 'cite_passage': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const r = await doc.citePassage(String(input.fragment), String(input.quote), String(input.locale));
        if (r.text !== expect.text) fail(`text ${r.text} ≠ ${String(expect.text)}`);
        if (r.uri !== expect.uri) fail(`uri ${r.uri} ≠ ${String(expect.uri)}`);
      } finally {
        await doc.close();
      }
      return;
    }
    case 'locate': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        let got: unknown;
        try {
          got = await doc.locate(String(input.reference));
        } catch {
          got = { document: false, units: [], fragments: [], char: null, xywh: null };
        }
        const diff = jsonDiff(canonicalize(got), canonicalize(expect));
        if (diff) fail(`locate differs at ${diff}`);
      } finally {
        await doc.close();
      }
      return;
    }
    case 'export_csl':
    case 'export_bibtex': {
      const metas: CslItem[] = [];
      for (const f of input.files as string[]) {
        const doc = await openSpdf(await io.read(f), opts);
        metas.push(doc.document.metadata);
        await doc.close();
      }
      if (c.kind === 'export_bibtex') {
        const norm = (t: string) => t.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
        const got = norm(toBibtex(metas));
        const want = norm(String(expect.text));
        const i = got.findIndex((l, k) => l !== want[k]);
        if (got.length !== want.length || i >= 0) fail(`BibTeX differs at line ${i >= 0 ? i + 1 : Math.min(got.length, want.length) + 1}: ${JSON.stringify(got[i] ?? null)} ≠ ${JSON.stringify(want[i >= 0 ? i : got.length] ?? null)}`);
        return;
      }
      const items = toCslJsonArray(metas);
      if (input.anchor && items.length === 1) {
        const ll = cslLocator(input.anchor as Anchor, (input.anchor_end ?? null) as Anchor | null);
        if (ll) {
          (items[0] as CslItem).label = ll[0];
          (items[0] as CslItem).locator = ll[1];
        }
      }
      const diff = jsonDiff(canonicalize(items), canonicalize(expect.items));
      if (diff) fail(`CSL-JSON differs at ${diff}`);
      return;
    }
    case 'export_structure': {
      const doc = await openSpdf(await io.read(String(input.file)), opts);
      try {
        const pages = await pageSequence(doc, input.format as 'alto' | 'tei' | 'iiif');
        const diff = jsonDiff(canonicalize({ pages }), canonicalize(expect));
        if (diff) fail(`${String(input.format)} page sequence differs at ${diff}`);
      } finally {
        await doc.close();
      }
      return;
    }
    default:
      throw new Error(`unknown case kind ${c.kind}`);
  }
}

/** Runs the suite through any I/O. */
export async function runConformanceWith(io: ConformanceIO, options: ConformanceOptions = {}): Promise<ConformanceReport> {
  let suiteVersion: string | null = null;
  try {
    suiteVersion = (await readJson<{ suite_version?: string }>(io, 'manifest.json')).suite_version ?? null;
  } catch {
    /* no manifest */
  }
  const engineName = options.engine?.name ?? 'default';
  const report: ConformanceReport = { impl: IMPL, version: VERSION, engine: engineName, suite_version: suiteVersion, passed: [], failed: [], skipped: [] };
  const files = (await io.listCases()).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    let c: Case;
    try {
      c = await readJson<Case>(io, f);
    } catch (e) {
      report.failed.push({ id: f, reason: `unreadable case: ${(e as Error).message}` });
      continue;
    }
    if (options.only && !c.id.startsWith(options.only)) continue;
    if (options.skipKinds?.includes(c.kind)) {
      report.skipped.push({ id: c.id, reason: `kind ${c.kind} not claimed by this build` });
      continue;
    }
    try {
      await runCase(c, io, options.engine);
      report.passed.push(c.id);
    } catch (e) {
      report.failed.push({ id: c.id, reason: e instanceof Mismatch ? e.message : `threw: ${(e as Error).message}` });
    }
  }
  return report;
}

/** Runs the suite from a directory (Node, Bun). */
export async function runConformance(dir: string, options: ConformanceOptions = {}): Promise<ConformanceReport> {
  const [{ readdir, readFile }, { join }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  const io: ConformanceIO = {
    listCases: async () => (await readdir(join(dir, 'cases'))).map((f) => `cases/${f}`),
    read: async (p) => {
      const b = await readFile(join(dir, p));
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    },
  };
  return runConformanceWith(io, options);
}
