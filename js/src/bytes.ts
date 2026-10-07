/** Byte helpers that work on every platform (Web APIs only). */

const SQLITE_MAGIC = 'SQLite format 3\u0000';

export function isGzip(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export function isSqlite(b: Uint8Array): boolean {
  if (b.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (b[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export function toBytes(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/** Collects a stream of byte chunks into one array, aborting past `limit` bytes. */
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`Decompressed size exceeds the limit of ${limit} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Gunzip with the Compression Streams API (browsers, Deno, Bun, Node ≥ 18, Workers). */
export async function gunzipWeb(bytes: Uint8Array, limit = 4 * 1024 ** 3): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const input = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
  return collect(input.pipeThrough(ds) as ReadableStream<Uint8Array>, limit);
}

/** Gzip with the Compression Streams API. */
export async function gzipWeb(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const input = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
  return collect(input.pipeThrough(cs) as ReadableStream<Uint8Array>, Number.MAX_SAFE_INTEGER);
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] as number];
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error('Invalid hex string.');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const utf8 = {
  encode: (s: string): Uint8Array => new TextEncoder().encode(s),
  decode: (b: Uint8Array): string => new TextDecoder().decode(b),
};

/** SHA-256 with WebCrypto, as lowercase hex. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const b = typeof data === 'string' ? utf8.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>);
  return toHex(new Uint8Array(digest));
}

/** SHA-256 over several chunks (concatenated). */
export async function sha256HexOfChunks(chunks: readonly Uint8Array[]): Promise<string> {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return sha256Hex(all);
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return all;
}
