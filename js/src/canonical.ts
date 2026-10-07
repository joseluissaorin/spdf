/**
 * Canonical JSON (contract §5 and §8): RFC 8785 (JCS) after rounding every
 * non-integer number to 6 decimals (half to even on the exact binary value).
 * Keys sorted by UTF-16 code units, no whitespace, ECMAScript number form
 * (`1.0` → `1`, `1e-6` → `0.000001`, `-0` → `0`), raw UTF-8 strings.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Rounds to `d` decimals, half to even on the exact binary value. */
export function roundTo(x: number, d: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x === 0 ? 0 : x;
  const a = Math.abs(x);
  const exact = a.toFixed(Math.min(100, d + 25));
  const dot = exact.indexOf('.');
  const tail = exact.slice(dot + 1 + d);
  let digits = a.toFixed(d);
  if (/^50*$/.test(tail)) {
    const intPart = exact.slice(0, dot) + exact.slice(dot + 1, dot + 1 + d);
    const last = Number(intPart[intPart.length - 1]);
    const down = BigInt(intPart);
    const n = last % 2 === 0 ? down : down + 1n;
    const s = n.toString().padStart(d + 1, '0');
    digits = d > 0 ? `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}` : s;
  }
  const r = Number(digits);
  const signed = x < 0 ? -r : r;
  return signed === 0 ? 0 : signed;
}

/** ECMAScript shortest form of a number already rounded (no exponent for |x| ≥ 1e-6). */
export function shortNumber(x: number): string {
  const s = String(x === 0 ? 0 : x);
  if (!/e/i.test(s)) return s;
  return x.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/** Rounds to 6 decimals, half to even on the exact binary value (like Python's `round(x, 6)`). */
export function round6(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`Non-finite number in canonical JSON: ${x}`);
  return roundTo(x, 6);
}

function numberToJson(x: number): string {
  return shortNumber(round6(x));
}

/** JCS (RFC 8785) orders keys by UTF-16 code units: JavaScript's default sort. */
export function sortKeys(keys: string[]): string[] {
  return keys.sort();
}

/** Serializes a value as canonical JSON. `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return numberToJson(value);
    case 'bigint':
      return value.toString();
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      if (value instanceof Uint8Array) throw new Error('Bytes cannot be written as canonical JSON.');
      const obj = value as Record<string, unknown>;
      const keys = sortKeys(Object.keys(obj).filter((k) => obj[k] !== undefined));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`Cannot write ${typeof value} as canonical JSON.`);
  }
}

/** Deep copy with numbers rounded and keys sorted (the parsed form of the canonical JSON). */
export function canonicalize<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
