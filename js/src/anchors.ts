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
const optional = (v: unknown, test: (x: unknown) => boolean) => v === undefined || v === null || test(v);

/** Checks a parsed anchor. `textLength` (code points of the unit text) enables the `chars` check. */
export function checkAnchor(a: unknown, textLength?: number): AnchorProblem | null {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { code: 'E040', message: 'anchor is not a JSON object' };
  const o = a as Record<string, unknown>;
  if (!isStr(o.type)) return { code: 'E040', message: 'anchor without "type"' };
  if (!(ANCHOR_TYPES as readonly string[]).includes(o.type)) return { code: 'E041', message: `unknown anchor type "${o.type}"` };
  const bad = (m: string): AnchorProblem => ({ code: 'E040', message: `${o.type} anchor: ${m}` });
  switch (o.type as AnchorType) {
    case 'page':
      if (!isInt(o.physical) || (o.physical as number) < 1) return bad('"physical" must be an integer ≥ 1');
      if (!('printed' in o) || !optional(o.printed, isStr)) return bad('"printed" must be a string or null');
      break;
    case 'time':
      if (!isNum(o.t0)) return bad('"t0" must be a number');
      if (!isNum(o.t1)) return bad('"t1" must be a number');
      break;
    case 'section':
      if (!Array.isArray(o.path) || !o.path.every(isStr)) return bad('"path" must be an array of strings');
      if (!optional(o.paragraph, isInt)) return bad('"paragraph" must be an integer');
      break;
    case 'slide':
      if (!isInt(o.n)) return bad('"n" must be an integer');
      break;
    case 'sheet':
      if (!isStr(o.sheet)) return bad('"sheet" must be a string');
      if (!isInt(o.row_from) || !isInt(o.row_to)) return bad('"row_from" and "row_to" must be integers');
      break;
    case 'web':
      if (!isStr(o.url)) return bad('"url" must be a string');
      if (!optional(o.path, (p) => Array.isArray(p) && p.every(isStr))) return bad('"path" must be an array of strings');
      break;
    case 'verse':
      if (!isInt(o.line_from)) return bad('"line_from" must be an integer');
      if (!optional(o.line_to, isInt)) return bad('"line_to" must be an integer');
      break;
    case 'canonical':
      if (!isStr(o.scheme) || !isStr(o.ref)) return bad('"scheme" and "ref" must be strings');
      break;
    case 'image':
      break;
  }
  if (o.region !== undefined && o.region !== null) {
    const r = o.region as Record<string, unknown>;
    if (typeof r !== 'object' || !['x', 'y', 'w', 'h'].every((k) => isNum(r[k]))) return bad('"region" must be {x, y, w, h}');
  }
  if (o.chars !== undefined && o.chars !== null) {
    const c = o.chars;
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || !isInt(c[1])) return bad('"chars" must be [start, end]');
    const [s, e] = c as [number, number];
    if (s < 0 || e < s || (textLength !== undefined && e > textLength)) {
      return { code: 'E042', message: `chars [${s}, ${e}] out of range${textLength !== undefined ? ` (text has ${textLength} code points)` : ''}` };
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

/** Lenient percent-decoding: malformed escapes are kept as they are. */
export function pctDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

/** The parsed form of an anchor URI fragment (contract §3). */
export interface AnchorLocator {
  p?: number;
  pe?: number;
  f?: string;
  fe?: string;
  t?: [number, number];
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

/** The `docref` of a document: `sha256-<hex>` from its source hash, or its id. */
export function docrefOf(doc: { source_sha256?: string | null; id: string }): string {
  const h = doc.source_sha256?.trim().toLowerCase();
  return h && /^[0-9a-f]{64}$/.test(h) ? `sha256-${h}` : doc.id;
}

const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** The locator of an anchor (and its optional end anchor). */
export function anchorToLocator(anchor: Anchor, anchorEnd?: Anchor | null): AnchorLocator {
  const loc: AnchorLocator = {};
  const end = anchorEnd ?? null;
  switch (anchor.type) {
    case 'page': {
      loc.p = anchor.physical;
      if (end && end.type === 'page' && present(end.physical) && end.physical !== anchor.physical) loc.pe = end.physical;
      if (present(anchor.printed)) loc.f = anchor.printed;
      if (end && end.type === 'page' && present(end.printed) && end.printed !== anchor.printed) loc.fe = end.printed;
      break;
    }
    case 'time': {
      const t1 = end && end.type === 'time' && present(end.t1) ? end.t1 : (anchor.t1 ?? anchor.t0);
      loc.t = [anchor.t0, t1];
      break;
    }
    case 'section':
    case 'web':
      if (anchor.type === 'section' && present(anchor.printed)) loc.f = anchor.printed;
      if (anchor.path) loc.s = [...anchor.path];
      if (present(anchor.paragraph)) loc.para = anchor.paragraph;
      break;
    case 'verse':
      if (present(anchor.printed)) loc.f = anchor.printed;
      loc.v = present(anchor.line_to) && anchor.line_to !== anchor.line_from ? [anchor.line_from, anchor.line_to] : [anchor.line_from];
      break;
    case 'slide':
      loc.sl = anchor.n;
      break;
    case 'sheet':
      loc.sh = anchor.sheet;
      if (present(anchor.row_from)) loc.rows = [anchor.row_from, anchor.row_to ?? anchor.row_from];
      break;
    case 'canonical':
      loc.ref = { scheme: anchor.scheme, ref: anchor.ref };
      break;
    case 'image':
      break;
  }
  const a = anchor as { chars?: [number, number] | null; region?: Region | null };
  if (Array.isArray(a.chars) && a.chars.length === 2) loc.char = [a.chars[0], a.chars[1]];
  if (a.region && typeof a.region === 'object') loc.xywh = [a.region.x, a.region.y, a.region.w, a.region.h];
  return loc;
}

/** Serializes a locator in canonical order. */
export function formatLocator(loc: AnchorLocator): string {
  const parts: string[] = [];
  if (present(loc.p)) parts.push(`p=${loc.p}`);
  if (present(loc.pe)) parts.push(`pe=${loc.pe}`);
  if (present(loc.f)) parts.push(`f=${pctEncode(loc.f)}`);
  if (present(loc.fe)) parts.push(`fe=${pctEncode(loc.fe)}`);
  if (present(loc.t)) parts.push(`t=${loc.t.map((x) => shortNumber(roundTo(x, 6))).join(',')}`);
  if (present(loc.s)) parts.push(`s=${loc.s.map(pctEncode).join('/')}`);
  if (present(loc.para)) parts.push(`para=${loc.para}`);
  if (present(loc.sl)) parts.push(`sl=${loc.sl}`);
  if (present(loc.sh)) parts.push(`sh=${pctEncode(loc.sh)}`);
  if (present(loc.rows)) parts.push(`rows=${loc.rows[0]}-${loc.rows[1]}`);
  if (present(loc.v)) parts.push(`v=${loc.v.join('-')}`);
  if (present(loc.ref)) parts.push(`ref=${pctEncode(loc.ref.scheme)}:${pctEncode(loc.ref.ref)}`);
  if (present(loc.char)) parts.push(`char=${loc.char[0]},${loc.char[1]}`);
  if (present(loc.xywh)) parts.push(`xywh=percent:${loc.xywh.map((x) => shortNumber(roundTo(x * 100, 4))).join(',')}`);
  return parts.join('&');
}

/** `spdf:<docref>#<params>`. `docref` is a string or a document (its source hash is preferred). */
export function formatAnchorUri(
  docref: string | { source_sha256?: string | null; id: string },
  anchor: Anchor | AnchorLocator,
  anchorEnd?: Anchor | null,
): string {
  const ref = typeof docref === 'string' ? docref : docrefOf(docref);
  const loc = 'type' in anchor && typeof (anchor as { type?: unknown }).type === 'string' ? anchorToLocator(anchor as Anchor, anchorEnd) : (anchor as AnchorLocator);
  const frag = formatLocator(loc);
  return `spdf:${pctEncode(ref)}${frag ? `#${frag}` : ''}`;
}

const INT = /^-?\d+$/;

/** Parses an anchor URI into its docref and locator. Throws on a URI that is not `spdf:`. */
export function parseAnchorUri(uri: string): ParsedAnchorUri {
  const m = /^spdf:([^#]*)(?:#(.*))?$/s.exec(uri.trim());
  if (!m || !m[1]) throw new Error(`Not an SPDF anchor URI: ${uri}`);
  const docref = pctDecode(m[1]);
  const loc: AnchorLocator = {};
  const int = (v: string): number | undefined => (INT.test(v) ? Number(v) : undefined);
  const num = (v: string): number | undefined => {
    const x = Number(v);
    return v.trim() !== '' && Number.isFinite(x) ? x : undefined;
  };
  for (const pair of (m[2] ?? '').split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    switch (k) {
      case 'p':
      case 'pe':
      case 'para':
      case 'sl': {
        const n = int(pctDecode(raw));
        if (n !== undefined) loc[k] = n;
        break;
      }
      case 'f':
      case 'fe':
      case 'sh':
        loc[k] = pctDecode(raw);
        break;
      case 't': {
        const [a, b] = pctDecode(raw).replace(/^npt:/, '').split(',');
        const t0 = num(a ?? '');
        const t1 = b === undefined ? t0 : num(b);
        if (t0 !== undefined && t1 !== undefined) loc.t = [t0, t1];
        break;
      }
      case 's':
        loc.s = raw === '' ? [] : raw.split('/').map(pctDecode);
        break;
      case 'rows': {
        const mm = /^(\d+)-(\d+)$/.exec(pctDecode(raw));
        if (mm) loc.rows = [Number(mm[1]), Number(mm[2])];
        break;
      }
      case 'v': {
        const mm = /^(\d+)(?:-(\d+))?$/.exec(pctDecode(raw));
        if (mm) loc.v = mm[2] === undefined ? [Number(mm[1])] : [Number(mm[1]), Number(mm[2])];
        break;
      }
      case 'ref': {
        const i = raw.indexOf(':');
        const i2 = i >= 0 ? i : raw.indexOf('%3A');
        if (i >= 0) loc.ref = { scheme: pctDecode(raw.slice(0, i)), ref: pctDecode(raw.slice(i + 1)) };
        else if (i2 >= 0) loc.ref = { scheme: pctDecode(raw.slice(0, i2)), ref: pctDecode(raw.slice(i2 + 3)) };
        break;
      }
      case 'char': {
        const mm = /^(\d+),(\d+)$/.exec(pctDecode(raw));
        if (mm) loc.char = [Number(mm[1]), Number(mm[2])];
        break;
      }
      case 'xywh': {
        const v = pctDecode(raw);
        const pct = v.startsWith('percent:');
        const xs = v.replace(/^(percent|pixel):/, '').split(',').map((x) => num(x));
        if (xs.length === 4 && xs.every((x) => x !== undefined)) {
          const f = (x: number) => (pct ? roundTo(x / 100, 6) : x);
          loc.xywh = [f(xs[0] as number), f(xs[1] as number), f(xs[2] as number), f(xs[3] as number)];
        }
        break;
      }
      default:
        break; // unknown keys are ignored
    }
  }
  return { docref, locator: loc };
}

/** The anchor a locator describes, as far as a URI can tell. */
export function locatorToAnchor(loc: AnchorLocator): { anchor: Anchor; anchor_end: Anchor | null } {
  let anchor: Record<string, unknown>;
  let end: Record<string, unknown> | null = null;
  if (present(loc.p)) {
    anchor = { type: 'page', physical: loc.p, printed: loc.f ?? null };
    if (present(loc.pe) || present(loc.fe)) end = { type: 'page', physical: loc.pe ?? loc.p, printed: loc.fe ?? null };
  } else if (present(loc.t)) {
    anchor = { type: 'time', t0: loc.t[0], t1: loc.t[1] };
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
  } else if (present(loc.s) || present(loc.para)) {
    anchor = { type: 'section', path: loc.s ?? [] };
    if (present(loc.para)) anchor.paragraph = loc.para;
    if (present(loc.f)) anchor.printed = loc.f;
  } else {
    anchor = { type: 'image' };
  }
  if (present(loc.char)) anchor.chars = [...loc.char];
  if (present(loc.xywh)) anchor.region = { x: loc.xywh[0], y: loc.xywh[1], w: loc.xywh[2], h: loc.xywh[3] };
  return { anchor: anchor as unknown as Anchor, anchor_end: end as unknown as Anchor | null };
}
