/**
 * Vector blobs (contract §2): little-endian, `dims × sizeof(dtype)` bytes, no header.
 * `f32` IEEE 754 single, `f16` IEEE 754 half, `i8` signed byte with value = byte / 127.
 */

import type { Dtype } from './types.js';
import { DTYPE_SIZE } from './schema.js';

export function dtypeSize(dtype: string): number {
  const s = DTYPE_SIZE[dtype];
  if (!s) throw new Error(`Unknown dtype «${dtype}» (f32, f16 or i8).`);
  return s;
}

/** Half-precision bits → number. */
export function f16ToNumber(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 0x1f) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** Thrown when a value does not fit the dtype (f16 or f32 overflow). */
export class QuantizeError extends RangeError {
  override readonly name = 'QuantizeError';
}

function roundHalfEven(y: number): number {
  const f = Math.floor(y);
  const d = y - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * number → IEEE 754 binary16 bits, rounding the exact double to nearest even (like
 * Python's `struct.pack('<e')`). Overflow (|x| ≥ 65520) throws, unless `saturate`
 * is set, which returns ±Infinity.
 */
export function numberToF16(value: number, saturate = false): number {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const a = Math.abs(value);
  if (a === Infinity) return sign | 0x7c00;
  if (a === 0) return sign;
  if (a < 2 ** -14) {
    const r = roundHalfEven(a * 2 ** 24); // exact scaling by a power of two
    return sign | r; // r = 1024 is the smallest normal, which has the same bits
  }
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  if (2 ** (e + 1) <= a) e++;
  let r = roundHalfEven(a / 2 ** (e - 10));
  if (r === 2048) {
    r = 1024;
    e++;
  }
  if (e + 15 >= 31) {
    if (saturate) return sign | 0x7c00;
    throw new QuantizeError(`${value} is out of range for f16`);
  }
  return sign | ((e + 15) << 10) | (r - 1024);
}

/** Decodes a vector blob into a Float32Array. */
export function decodeVector(data: Uint8Array, dtype: Dtype | string = 'f32'): Float32Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (dtype) {
    case 'f32': {
      const n = Math.floor(data.byteLength / 4);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
      return out;
    }
    case 'f16': {
      const n = Math.floor(data.byteLength / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = f16ToNumber(dv.getUint16(i * 2, true));
      return out;
    }
    case 'i8': {
      const out = new Float32Array(data.byteLength);
      for (let i = 0; i < data.byteLength; i++) out[i] = dv.getInt8(i) / 127;
      return out;
    }
    default:
      throw new Error(`Unknown dtype «${dtype}».`);
  }
}

/**
 * Writer-side quantization (contract §2): f32 and f16 round to nearest even and fail on
 * overflow ({@link QuantizeError}); i8 is q = clamp(round_half_away_from_zero(v × 127), ±127).
 */
export function encodeVector(v: ArrayLike<number>, dtype: Dtype | string = 'f32'): Uint8Array {
  const n = v.length;
  switch (dtype) {
    case 'f32': {
      const out = new Uint8Array(n * 4);
      const dv = new DataView(out.buffer);
      for (let i = 0; i < n; i++) {
        const x = v[i] as number;
        const f = Math.fround(x);
        if (Number.isFinite(x) && !Number.isFinite(f)) throw new QuantizeError(`${x} is out of range for f32`);
        dv.setFloat32(i * 4, f, true);
      }
      return out;
    }
    case 'f16': {
      const out = new Uint8Array(n * 2);
      const dv = new DataView(out.buffer);
      for (let i = 0; i < n; i++) dv.setUint16(i * 2, numberToF16(v[i] as number), true);
      return out;
    }
    case 'i8': {
      const out = new Uint8Array(n);
      const dv = new DataView(out.buffer);
      for (let i = 0; i < n; i++) {
        // q = clamp(round_half_away_from_zero(v × 127), −127, 127)
        const x = (v[i] as number) * 127;
        const r = Math.sign(x) * Math.round(Math.abs(x));
        dv.setInt8(i, Math.max(-127, Math.min(127, r)) | 0);
      }
      return out;
    }
    default:
      throw new Error(`Unknown dtype «${dtype}».`);
  }
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

export function norm(a: ArrayLike<number>): number {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity; 0 if either vector is zero. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const na = norm(a);
  const nb = norm(b);
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

/** L2-normalizes a vector (copy). */
export function normalize(v: ArrayLike<number>): Float32Array {
  const n = norm(v);
  const out = Float32Array.from(v as ArrayLike<number>);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / n;
  return out;
}
