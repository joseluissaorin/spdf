/**
 * Anchors (contract §3): checking them and turning them into anchor URIs and back.
 *
 * `spdf:<docref>#<params>`, where `<docref>` is `sha256-<hex>` (portable) or the
 * document id, and the params go in a fixed order:
 * `p f t s para sl sh rows v ref c xywh fe`.
 */

import type { Anchor, AnchorType, Region } from './types.js';
import { ANCHOR_TYPES } from './types.js';
import { roundTo, shortNumber } from './canonical.js';

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export interface AnchorProblem {
  code: 'E040' | 'E041' | 'E042';
  message: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Checks a parsed anchor (contract §3 required members). `textLength` (code points of the NFC unit text) enables the `chars` check. */
export function checkAnchor(a: unknown, textLength?: number): AnchorProblem | null {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { code: 'E040', message: 'anchor is not an object' };
  const o = a as Record<string, unknown>;
  if (!isStr(o.type)) return { code: 'E040', message: 'anchor without type' };
  if (!(ANCHOR_TYPES as readonly string[]).includes(o.type)) return { code: 'E041', message: `unknown anchor type ${JSON.stringify(o.type)}` };
  let ok: boolean;
  switch (o.type as AnchorType) {
    case 'page':
      ok = isInt(o.physical) && (o.physical as number) >= 1 && 'printed' in o && (o.printed === null || isStr(o.printed));
      break;
    case 'time':
      ok = isNum(o.t0) && isNum(o.t1) && 0 <= (o.t0 as number) && (o.t0 as number) <= (o.t1 as number);
      break;
    case 'section':
      ok = Array.isArray(o.path) && o.path.every(isStr);
      break;
    case 'slide':
      ok = isInt(o.n) && (o.n as number) >= 1;
      break;
    case 'sheet':
      ok = isStr(o.sheet) && isInt(o.row_from) && isInt(o.row_to);
      break;
    case 'web':
      ok = isStr(o.url);
      break;
    case 'verse':
      ok = isInt(o.line_from);
      break;
    case 'canonical':
      ok = isStr(o.scheme) && isStr(o.ref);
      break;
    default:
      ok = true;
  }
  if (!ok) return { code: 'E040', message: `${o.type} anchor misses or mistypes a required member` };
  if ('region' in o) {
    const r = o.region as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r) || !['x', 'y', 'w', 'h'].every((k) => isNum(r[k]))) return { code: 'E040', message: 'bad region' };
  }
  if ('chars' in o) {
    const c = o.chars;
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || !isInt(c[1])) return { code: 'E040', message: 'bad chars' };
    const [s, e] = c as [number, number];
    if (textLength !== undefined && !(0 <= s && s <= e && e <= textLength)) {
      return { code: 'E042', message: `chars [${s}, ${e}] out of range (unit text has ${textLength} code points)` };
    }
  }
  return null;
}

/** Length of a string in Unicode code points. */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}


// ---------------------------------------------------------------------------
// Anchor URIs (contract §3)
// ---------------------------------------------------------------------------

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const encoder = new TextEncoder();

/** Percent-encodes every UTF-8 byte except RFC 3986 unreserved characters (uppercase hex). */
export function pctEncode(s: string): string {
  let out = '';
  for (const ch of s) {
    if (UNRESERVED.test(ch)) {
      out += ch;
      continue;
    }
    for (const b of encoder.encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Strict percent-decoding: a `%` not followed by two hex digits, or bytes that are not UTF-8, throw. */
export function pctDecode(s: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(s)) throw new Error('bad percent-encoding');
  const bytes: number[] = [];
  for (let i = 0; i < s.length; ) {
    if (s[i] === '%') {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const cp = s.codePointAt(i) as number;
      const ch = String.fromCodePoint(cp);
      for (const b of encoder.encode(ch)) bytes.push(b);
      i += ch.length;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new Error('percent-encoding is not UTF-8');
  }
}

/** The parsed form of an anchor URI fragment (contract §3). */
export interface AnchorLocator {
  p?: number;
  pe?: number;
  f?: string;
  fe?: string;
  t?: [number] | [number, number];
  s?: string[];
  para?: number;
  sl?: number;
  sh?: string;
  rows?: [number, number];
  v?: [number] | [number, number];
  ref?: { scheme: string; ref: string };
  char?: [number, number];
  xywh?: [number, number, number, number];
}

export interface ParsedAnchorUri {
  docref: string;
  locator: AnchorLocator;
}

const SHA_REF = /^sha256-[0-9a-f]{64}$/;

/** The `docref` of a document: `sha256-<hex>` from its source hash, or its id. */
export function docrefOf(doc: { source_sha256?: string | null; id: string }): string {
  const h = doc.source_sha256?.trim().toLowerCase();
  return h && /^[0-9a-f]{64}$/.test(h) ? `sha256-${h}` : doc.id;
}

const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** The locator of an anchor (and its optional end anchor), as in the reference. */
export function anchorToLocator(anchor: Anchor, anchorEnd?: Anchor | null): AnchorLocator {
  const L: AnchorLocator = {};
  const a = anchor as Anchor & Record<string, unknown>;
  const end = (anchorEnd ?? null) as (Anchor & Record<string, unknown>) | null;
  switch (anchor.type) {
    case 'page':
      L.p = anchor.physical;
      if (present(anchor.printed)) L.f = anchor.printed;
      if (end && end.type === 'page') {
        if (present(end.physical) && end.physical !== anchor.physical) L.pe = end.physical;
        if (present(end.printed) && end.printed !== anchor.printed) L.fe = end.printed;
      }
      break;
    case 'time': {
      const t1 = end && end.type === 'time' ? (end.t1 as number | null | undefined) : anchor.t1;
      L.t = present(t1) ? [anchor.t0, t1] : [anchor.t0];
      break;
    }
    case 'section':
    case 'web': {
      const path = a.path as string[] | undefined;
      if (Array.isArray(path) && path.length) L.s = [...path];
      if (present(a.paragraph)) L.para = a.paragraph as number;
      if (present(a.printed)) {
        L.f = a.printed as string;
        if (end && present(end.printed) && end.printed !== a.printed) L.fe = end.printed as string;
      }
      break;
    }
    case 'slide':
      L.sl = anchor.n;
      break;
    case 'sheet':
      L.sh = anchor.sheet;
      L.rows = [anchor.row_from, anchor.row_to];
      break;
    case 'verse': {
      const b = anchor.line_to;
      L.v = !present(b) || b === anchor.line_from ? [anchor.line_from] : [anchor.line_from, b];
      if (present(anchor.printed)) L.f = anchor.printed;
      break;
    }
    case 'canonical':
      L.ref = { scheme: anchor.scheme, ref: anchor.ref };
      break;
    default:
      break;
  }
  if (present(a.chars)) L.char = [...(a.chars as [number, number])] as [number, number];
  if (present(a.region)) {
    const r = a.region as Region;
    L.xywh = [r.x, r.y, r.w, r.h];
  }
  return L;
}

const PARAM_ORDER = ['p', 'pe', 'f', 'fe', 't', 's', 'para', 'sl', 'sh', 'rows', 'v', 'ref', 'char', 'xywh'] as const;

/** `spdf:<docref>#<params>` from a docref and a locator, in canonical order. */
export function formatLocator(docref: string, L: AnchorLocator): string {
  const ref = SHA_REF.test(docref) ? docref : pctEncode(docref);
  const parts: string[] = [];
  for (const k of PARAM_ORDER) {
    const v = L[k];
    if (!present(v)) continue;
    let s: string;
    switch (k) {
      case 'p':
      case 'pe':
      case 'para':
      case 'sl':
        s = String(v);
        break;
      case 'f':
      case 'fe':
      case 'sh':
        s = pctEncode(v as string);
        break;
      case 't':
        s = (v as number[]).map((x) => shortNumber(roundTo(x, 6))).join(',');
        break;
      case 's':
        s = (v as string[]).map(pctEncode).join('/');
        break;
      case 'rows':
        s = `${(v as number[])[0]}-${(v as number[])[1]}`;
        break;
      case 'v':
        s = (v as number[]).join('-');
        break;
      case 'ref':
        s = `${pctEncode((v as { scheme: string }).scheme)}:${pctEncode((v as { ref: string }).ref)}`;
        break;
      case 'char':
        s = `${(v as number[])[0]},${(v as number[])[1]}`;
        break;
      case 'xywh':
        s = `percent:${(v as number[]).map((x) => shortNumber(roundTo(roundTo(x * 100, 4), 6))).join(',')}`;
        break;
    }
    parts.push(`${k}=${s}`);
  }
  return `spdf:${ref}${parts.length ? `#${parts.join('&')}` : ''}`;
}

/**
 * The anchor URI of an anchor. `docref` is a string or a document (its source hash is
 * preferred); a locator can be passed instead of an anchor.
 */
export function formatAnchorUri(
  docref: string | { source_sha256?: string | null; id: string },
  anchor: Anchor | AnchorLocator,
  anchorEnd?: Anchor | null,
): string {
  const ref = typeof docref === 'string' ? docref : docrefOf(docref);
  const isAnchor = typeof (anchor as { type?: unknown }).type === 'string';
  return formatLocator(ref, isAnchor ? anchorToLocator(anchor as Anchor, anchorEnd) : (anchor as AnchorLocator));
}

const INT = /^(0|[1-9][0-9]*)$/;
const DEC = /^[0-9]+(\.[0-9]+)?$/;
const CLOCK = /^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$/;

function int(s: string): number {
  if (!INT.test(s)) throw new Error(`not an integer: ${JSON.stringify(s)}`);
  return Number(s);
}

function npt(s: string): number {
  if (DEC.test(s)) return Number(s);
  const m = CLOCK.exec(s);
  if (!m) throw new Error(`bad time: ${JSON.stringify(s)}`);
  return roundTo(Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), 6);
}

/** Parses an anchor URI (strictly: malformed values throw; unknown parameters are ignored). */
export function parseAnchorUri(uri: string): ParsedAnchorUri {
  if (!uri.startsWith('spdf:')) throw new Error('not an spdf: URI');
  const rest = uri.slice(5);
  const hash = rest.indexOf('#');
  const docrefRaw = hash < 0 ? rest : rest.slice(0, hash);
  const frag = hash < 0 ? '' : rest.slice(hash + 1);
  if (!docrefRaw) throw new Error('empty document reference');
  const docref = pctDecode(docrefRaw);
  const L: AnchorLocator = {};
  const seen = new Set<string>();
  for (const part of frag ? frag.split('&') : []) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`parameter without value: ${JSON.stringify(part)}`);
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (seen.has(k)) throw new Error(`duplicate parameter ${k}`);
    seen.add(k);
    switch (k) {
      case 'p':
      case 'pe':
      case 'para':
      case 'sl': {
        const n = int(v);
        if (k !== 'para' && n < 1) throw new Error(`${k} starts at 1`);
        L[k] = n;
        break;
      }
      case 'f':
      case 'fe':
      case 'sh':
        L[k] = pctDecode(v);
        break;
      case 't': {
        const body = v.startsWith('npt:') ? v.slice(4) : v;
        const xs = body.split(',').map(npt);
        if (xs.length > 2 || (xs.length === 2 && (xs[1] as number) < (xs[0] as number))) throw new Error('bad t');
        L.t = xs as [number] | [number, number];
        break;
      }
      case 's':
        L.s = v.split('/').map(pctDecode);
        break;
      case 'rows': {
        const dash = v.indexOf('-');
        if (dash < 0) throw new Error('rows needs a-b');
        L.rows = [int(v.slice(0, dash)), int(v.slice(dash + 1))];
        break;
      }
      case 'v': {
        const xs = v.split('-').map(int);
        if (xs.length > 2) throw new Error('bad v');
        L.v = xs as [number] | [number, number];
        break;
      }
      case 'ref': {
        const colon = v.indexOf(':');
        if (colon <= 0) throw new Error('ref needs scheme:ref');
        L.ref = { scheme: pctDecode(v.slice(0, colon)), ref: pctDecode(v.slice(colon + 1)) };
        break;
      }
      case 'char': {
        const xs = v.split(',');
        if (xs.length !== 2) throw new Error('char needs start,end');
        const a = int(xs[0] as string);
        const b = int(xs[1] as string);
        if (b < a) throw new Error('char end before start');
        L.char = [a, b];
        break;
      }
      case 'xywh': {
        if (!v.startsWith('percent:')) throw new Error('xywh must use percent:');
        const xs = v.slice(8).split(',');
        if (xs.length !== 4 || !xs.every((x) => DEC.test(x))) throw new Error('bad xywh');
        L.xywh = xs.map((x) => roundTo(Number(x) / 100, 6)) as [number, number, number, number];
        break;
      }
      default:
        break; // unknown keys are ignored
    }
  }
  return { docref, locator: L };
}

/** The anchor a locator describes, as far as a URI can tell. */
export function locatorToAnchor(loc: AnchorLocator): { anchor: Anchor; anchor_end: Anchor | null } {
  let anchor: Record<string, unknown>;
  let end: Record<string, unknown> | null = null;
  if (present(loc.p)) {
    anchor = { type: 'page', physical: loc.p, printed: loc.f ?? null };
    if (present(loc.pe) || present(loc.fe)) end = { type: 'page', physical: loc.pe ?? loc.p, printed: loc.fe ?? null };
  } else if (present(loc.t)) {
    anchor = { type: 'time', t0: loc.t[0], t1: loc.t[1] ?? loc.t[0] };
  } else if (present(loc.sl)) {
    anchor = { type: 'slide', n: loc.sl };
  } else if (present(loc.sh)) {
    anchor = { type: 'sheet', sheet: loc.sh, row_from: loc.rows?.[0] ?? 1, row_to: loc.rows?.[1] ?? loc.rows?.[0] ?? 1 };
  } else if (present(loc.v)) {
    anchor = { type: 'verse', line_from: loc.v[0] };
    if (loc.v.length === 2) anchor.line_to = loc.v[1];
    if (present(loc.f)) anchor.printed = loc.f;
  } else if (present(loc.ref)) {
    anchor = { type: 'canonical', scheme: loc.ref.scheme, ref: loc.ref.ref };
  } else if (present(loc.s) || present(loc.para) || present(loc.f)) {
    anchor = { type: 'section', path: loc.s ?? [] };
    if (present(loc.para)) anchor.paragraph = loc.para;
    if (present(loc.f)) anchor.printed = loc.f;
    if (present(loc.fe)) end = { type: 'section', path: loc.s ?? [], printed: loc.fe };
  } else {
    anchor = { type: 'image' };
  }
  if (present(loc.char)) anchor.chars = [...loc.char];
  if (present(loc.xywh)) anchor.region = { x: loc.xywh[0], y: loc.xywh[1], w: loc.xywh[2], h: loc.xywh[3] };
  return { anchor: anchor as unknown as Anchor, anchor_end: end as unknown as Anchor | null };
}
