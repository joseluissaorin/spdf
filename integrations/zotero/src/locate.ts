/**
 * From what the user types ("145", "[21]", "p=12", an anchor URI) to a unit of the
 * document, and from that unit to the short citation and its anchor URI.
 *
 * Honest citation (SPEC preface, §4.2, §18): the citation is always computed from the
 * anchor stored in the file, never from what was typed. Typing "3" for a folio the
 * producer inferred gives `p. [3]`; typing a folio the document does not have gives
 * "not found", never a made-up page.
 */

import { anchorToLocator, cite, parseAnchorUri, type Anchor, type AnchorLocator, type SpdfDocument, type Unit } from 'spdf-format/core';

export type Query =
  /** A printed folio, or a range of printed folios ("145-146"), as typed. */
  | { kind: 'printed'; value: string }
  /** A physical page (1-based position in the original), or a range. */
  | { kind: 'physical'; from: number; to: number | null }
  /** A full anchor URI. */
  | { kind: 'uri'; uri: string; docref: string; locator: AnchorLocator };

/** Label prefixes people type before a folio: "p. 145", "pp. 3-4", "pág. 12", "fol. 1r". */
const PREFIX = /^(?:pp?|págs?|pags?|fols?|ff?)\.\s*|^(?:pp?|págs?|pags?|fols?)\s+(?=\S)/i;

/**
 * Parses the user's input. Returns null when it is empty or a malformed anchor URI.
 *
 * - `spdf:…` is an anchor URI;
 * - `p=12`, `#12` (or `p=12-13`, `#12-13`) is a physical page;
 * - `f=xiv` is a printed folio, written explicitly;
 * - anything else is a printed folio, with an optional label (`p. 145`) and with the
 *   brackets of an inferred folio removed (`[21]` → `21`).
 */
export function parseQuery(input: string): Query | null {
  const s = input.trim();
  if (!s) return null;
  if (/^spdf:/i.test(s)) {
    try {
      const { docref, locator } = parseAnchorUri(s);
      return { kind: 'uri', uri: s, docref, locator };
    } catch {
      return null;
    }
  }
  const physical = /^(?:p\s*=\s*|#\s*)(\d+)(?:\s*[-–]\s*(\d+))?$/i.exec(s);
  if (physical) {
    const from = Number(physical[1]);
    const to = physical[2] === undefined ? null : Number(physical[2]);
    if (from < 1 || (to !== null && to < from)) return null;
    return { kind: 'physical', from, to: to === from ? null : to };
  }
  let value = s.replace(/^f\s*=\s*/i, '');
  if (value === s) value = s.replace(PREFIX, '');
  value = value.trim();
  if (/^\[[^\]]+\]$/.test(value)) value = value.slice(1, -1).trim();
  if (!value) return null;
  return { kind: 'printed', value };
}

/** One way the query can be read: the anchor to cite, its end anchor, and the units. */
export interface Match {
  anchor: Anchor;
  anchorEnd: Anchor | null;
  unit: Unit | null;
}

export type Resolution =
  | { ok: true; matches: Match[] }
  | { ok: false; reason: 'not-found' | 'other-document' | 'unsupported'; detail: string };

/** True if the URI's document reference names this document (SPEC §5.4). */
export function sameDocument(doc: SpdfDocument, docref: string): boolean {
  const ref = docref.trim();
  if (ref === doc.document.id) return true;
  const m = /^sha256-([0-9a-fA-F]{64})$/.exec(ref);
  return !!m && (m[1] as string).toLowerCase() === doc.document.source_sha256.trim().toLowerCase();
}

const clone = <T>(a: T): T => JSON.parse(JSON.stringify(a)) as T;
const isPage = (u: Unit): boolean => (u.anchor as { type?: string }).type === 'page';

/** Units whose printed folio is `value` (exact; case-insensitive as a fallback: `XIV` = `xiv`). */
async function byPrinted(doc: SpdfDocument, value: string): Promise<Unit[]> {
  const exact = await doc.unitByPrinted(value);
  if (exact.length) return exact;
  const lower = value.toLowerCase();
  return (await doc.units()).filter((u) => u.printed !== null && u.printed.toLowerCase() === lower);
}

async function byPhysical(doc: SpdfDocument, physical: number): Promise<Unit | null> {
  return (await doc.units()).find((u) => isPage(u) && (u.anchor as { physical?: number }).physical === physical) ?? null;
}

/** Splits "145-146" (or with an en dash) into the two folios, if it has exactly one dash. */
function splitRange(value: string): [string, string] | null {
  const parts = value.split(/\s*[-–]\s*/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const strip = (p: string) => (/^\[[^\]]+\]$/.test(p) ? p.slice(1, -1) : p);
  return [strip(parts[0]), strip(parts[1])];
}

const single = (unit: Unit, end: Unit | null = null): Match => ({
  anchor: clone(unit.anchor),
  anchorEnd: end && end.id !== unit.id ? clone(end.anchor) : null,
  unit,
});

async function resolvePrinted(doc: SpdfDocument, value: string, endValue: string | null): Promise<Resolution> {
  const starts = await byPrinted(doc, value);
  if (endValue === null) {
    if (starts.length) return { ok: true, matches: starts.map((u) => single(u)) };
    const range = splitRange(value);
    if (range) return resolvePrinted(doc, range[0], range[1]);
    return { ok: false, reason: 'not-found', detail: value };
  }
  if (!starts.length) return { ok: false, reason: 'not-found', detail: value };
  const ends = await byPrinted(doc, endValue);
  if (!ends.length) return { ok: false, reason: 'not-found', detail: endValue };
  // Pair every start with the first end that does not precede it.
  const matches: Match[] = [];
  for (const s of starts) {
    const e = ends.find((x) => x.ord >= s.ord);
    if (e) matches.push(single(s, e));
  }
  if (!matches.length) return { ok: false, reason: 'not-found', detail: `${value}-${endValue}` };
  return { ok: true, matches };
}

async function resolvePhysical(doc: SpdfDocument, from: number, to: number | null): Promise<Resolution> {
  const start = await byPhysical(doc, from);
  if (!start) return { ok: false, reason: 'not-found', detail: String(from) };
  if (to === null) return { ok: true, matches: [single(start)] };
  const end = await byPhysical(doc, to);
  if (!end) return { ok: false, reason: 'not-found', detail: String(to) };
  return { ok: true, matches: [single(start, end)] };
}

function sameArray(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Resolves a locator against the units (SPEC §5.4: `p`, else `f`, else `t`, …). */
async function resolveLocator(doc: SpdfDocument, loc: AnchorLocator): Promise<Resolution> {
  // `p` wins over `f` (SPEC §5.4). The folio printed in the citation is still the one
  // the file stores for that page, so nothing typed in the URI is ever echoed back.
  if (loc.p !== undefined) return resolvePhysical(doc, loc.p, loc.pe ?? null);
  if (loc.f !== undefined) return resolvePrinted(doc, loc.f, loc.fe ?? null);
  const units = await doc.units();
  if (loc.t !== undefined) {
    const [t0, t1] = loc.t;
    const timed = units.filter((u) => (u.anchor as { type?: string }).type === 'time');
    const at = (t: number) => timed.find((u) => (u.anchor as { t0: number }).t0 <= t && t < (u.anchor as { t1: number }).t1) ?? timed.filter((u) => (u.anchor as { t0: number }).t0 <= t).pop() ?? null;
    const start = at(t0);
    if (!start) return { ok: false, reason: 'not-found', detail: `t=${t0}` };
    // Cite the time asked for, not the start of the unit.
    const anchor = { ...clone(start.anchor), t0, t1 } as Anchor;
    return { ok: true, matches: [{ anchor, anchorEnd: null, unit: start }] };
  }
  const found = units.filter((u) => {
    const l = anchorToLocator(u.anchor);
    if (loc.sl !== undefined) return l.sl === loc.sl;
    if (loc.sh !== undefined) {
      if (l.sh !== loc.sh) return false;
      if (!loc.rows || !l.rows) return true;
      return l.rows[0] <= loc.rows[0] && loc.rows[0] <= l.rows[1];
    }
    if (loc.v !== undefined) return !!l.v && l.v[0] <= loc.v[0] && loc.v[0] <= (l.v[1] ?? l.v[0]);
    if (loc.ref !== undefined) return !!l.ref && l.ref.scheme === loc.ref.scheme && l.ref.ref === loc.ref.ref;
    // Sections and web pages: the heading path (absent from the URI when empty) and
    // the paragraph number, whichever the URI gives.
    if (loc.s !== undefined || loc.para !== undefined) {
      return (loc.s === undefined || sameArray(l.s ?? [], loc.s)) && (loc.para === undefined || l.para === loc.para);
    }
    return false;
  });
  if (found.length) return { ok: true, matches: found.map((u) => single(u)) };
  const any = ['sl', 'sh', 'v', 'ref', 's', 'para'].some((k) => (loc as Record<string, unknown>)[k] !== undefined);
  if (any) return { ok: false, reason: 'not-found', detail: 'locator' };
  // `spdf:<docref>` with no unit-locating parameter designates the whole document.
  return { ok: true, matches: [{ anchor: { type: 'image' } as Anchor, anchorEnd: null, unit: null }] };
}

/** Finds the unit (or units, when a folio is printed twice) the query designates. */
export async function resolveQuery(doc: SpdfDocument, query: Query): Promise<Resolution> {
  switch (query.kind) {
    case 'printed':
      return resolvePrinted(doc, query.value, null);
    case 'physical':
      return resolvePhysical(doc, query.from, query.to);
    case 'uri': {
      if (!sameDocument(doc, query.docref)) return { ok: false, reason: 'other-document', detail: query.docref };
      const r = await resolveLocator(doc, query.locator);
      if (!r.ok) return r;
      // Keep the character range and region the URI points at.
      for (const m of r.matches) {
        const a = m.anchor as { chars?: [number, number]; region?: { x: number; y: number; w: number; h: number } };
        if (query.locator.char) a.chars = [query.locator.char[0], query.locator.char[1]];
        if (query.locator.xywh) {
          const [x, y, w, h] = query.locator.xywh;
          a.region = { x, y, w, h };
        }
      }
      return r;
    }
  }
}

/** The text copied to the clipboard: the citation, then the anchor URI on the next line. */
export interface Citation {
  citation: string;
  uri: string;
  text: string;
}

/** Short citation (in `locale`: es or en, anything else falls back to en) and anchor URI. */
export function citationFor(doc: SpdfDocument, match: Match, locale: string): Citation {
  const citation = cite(match.anchor, doc.document, locale, match.anchorEnd);
  const uri = match.unit === null ? `spdf:${doc.docref}` : doc.anchorUri(match.anchor, match.anchorEnd);
  return { citation, uri, text: `${citation}\n${uri}` };
}

/** A short label for a unit, to let the user choose between pages that share a folio. */
export function unitLabel(unit: Unit): { physical: number | null; printed: string | null } {
  const a = unit.anchor as { physical?: number };
  return { physical: typeof a.physical === 'number' ? a.physical : null, printed: unit.printed };
}
