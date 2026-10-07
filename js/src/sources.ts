/**
 * Random-access byte sources for the read-only VFS of the WebAssembly adapter.
 *
 * SQLite's VFS is synchronous, so every source reads synchronously: HTTP with
 * synchronous `XMLHttpRequest` Range requests (fine in a Web Worker; allowed but
 * discouraged on the main thread), a `Blob`/`File` with `FileReaderSync` (Workers only).
 */

import type { RandomAccessSource, SourceStats } from './port.js';

/** Bytes already in memory (handy for tests and as a fallback). */
export class BytesSource implements RandomAccessSource {
  private requests = 0;
  private fetched = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get size(): number {
    return this.bytes.byteLength;
  }
  read(offset: number, length: number): Uint8Array {
    this.requests++;
    const out = this.bytes.subarray(offset, Math.min(this.bytes.byteLength, offset + length));
    this.fetched += out.byteLength;
    return out;
  }
  stats(): SourceStats {
    return { requests: this.requests, bytesFetched: this.fetched };
  }
}

/** A `Blob` (or `File`, also from OPFS) read in slices with `FileReaderSync`. Workers only. */
export class BlobSource implements RandomAccessSource {
  private requests = 0;
  private fetched = 0;
  private readonly reader: { readAsArrayBuffer(b: Blob): ArrayBuffer };
  constructor(private readonly blob: Blob) {
    const FRS = (globalThis as { FileReaderSync?: new () => { readAsArrayBuffer(b: Blob): ArrayBuffer } }).FileReaderSync;
    if (!FRS) throw new Error('FileReaderSync is only available in Web Workers.');
    this.reader = new FRS();
  }
  get size(): number {
    return this.blob.size;
  }
  read(offset: number, length: number): Uint8Array {
    this.requests++;
    const out = new Uint8Array(this.reader.readAsArrayBuffer(this.blob.slice(offset, offset + length)));
    this.fetched += out.byteLength;
    return out;
  }
  stats(): SourceStats {
    return { requests: this.requests, bytesFetched: this.fetched };
  }
}

export interface HttpSourceOptions {
  /** Smallest request, in bytes (a power of two ≥ 512). Default 4096 (the SPDF page size). */
  chunkSize?: number;
  /** Largest request when sequential reads grow the read-ahead. Default 256 KiB. */
  maxReadAhead?: number;
  /** Cache budget in bytes (least recently used chunks are evicted). Default 64 MiB. */
  cacheBytes?: number;
  /** Extra request headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Send cookies on cross-origin requests. */
  withCredentials?: boolean;
}

/** Thrown when the server does not honour Range requests. */
export class RangeNotSupportedError extends Error {
  override readonly name = 'RangeNotSupportedError';
}

/** Fetches bytes `[start, end]` (inclusive) synchronously. */
export type RangeTransport = (start: number, end: number) => Uint8Array;

export interface RangeSourceStats extends SourceStats {
  /** Distinct chunks SQLite actually asked for (the rest was read-ahead). */
  chunksUsed: number;
  chunkSize: number;
}

/**
 * A random-access source over any synchronous range transport, with a chunk cache and an
 * adaptive read-ahead: a miss that continues the previous fetch doubles the next request
 * (up to `maxReadAhead`), which turns B-tree scans and long FTS doclists into few
 * requests; a jump resets it to one chunk.
 */
export class RangeSource implements RandomAccessSource {
  readonly chunkSize: number;
  private readonly maxReadAhead: number;
  private readonly cacheBytes: number;
  private readonly cache = new Map<number, Uint8Array>(); // chunk index → bytes (LRU order)
  private readonly used = new Set<number>();
  private cached = 0;
  protected requests = 0;
  protected fetched = 0;
  private lastEnd = -1;
  private ahead = 1;

  constructor(
    readonly size: number,
    private readonly transport: RangeTransport,
    options: HttpSourceOptions = {},
  ) {
    const cs = options.chunkSize ?? 4096;
    if (cs < 512 || (cs & (cs - 1)) !== 0) throw new Error('chunkSize must be a power of two ≥ 512.');
    this.chunkSize = cs;
    this.maxReadAhead = Math.max(cs, options.maxReadAhead ?? 256 * 1024);
    this.cacheBytes = Math.max(this.maxReadAhead * 4, options.cacheBytes ?? 64 * 1024 * 1024);
  }

  stats(): RangeSourceStats {
    return { requests: this.requests, bytesFetched: this.fetched, chunksUsed: this.used.size, chunkSize: this.chunkSize };
  }

  /** Forgets the cache (for measurements). */
  resetCache(): void {
    this.cache.clear();
    this.cached = 0;
    this.lastEnd = -1;
    this.ahead = 1;
  }

  resetStats(): void {
    this.requests = 0;
    this.fetched = 0;
    this.used.clear();
  }

  /** Seeds the cache with bytes already fetched from offset 0 (the first request). */
  protected seed(head: Uint8Array): void {
    for (let i = 0; (i + 1) * this.chunkSize <= head.byteLength; i++) this.store(i, head.subarray(i * this.chunkSize, (i + 1) * this.chunkSize));
  }

  private store(index: number, bytes: Uint8Array): void {
    if (this.cache.has(index)) return;
    this.cache.set(index, bytes);
    this.cached += bytes.byteLength;
    while (this.cached > this.cacheBytes) {
      const [k, v] = this.cache.entries().next().value as [number, Uint8Array];
      this.cache.delete(k);
      this.cached -= v.byteLength;
    }
  }

  private get(index: number): Uint8Array | undefined {
    const v = this.cache.get(index);
    if (v) {
      this.cache.delete(index);
      this.cache.set(index, v);
    }
    return v;
  }

  private fetchChunks(first: number, count: number): void {
    const start = first * this.chunkSize;
    const end = Math.min(this.size, (first + count) * this.chunkSize) - 1;
    if (end < start) return;
    const bytes = this.transport(start, end);
    this.requests++;
    this.fetched += bytes.byteLength;
    for (let i = 0; i * this.chunkSize < bytes.byteLength; i++) {
      this.store(first + i, bytes.subarray(i * this.chunkSize, Math.min(bytes.byteLength, (i + 1) * this.chunkSize)));
    }
  }

  read(offset: number, length: number): Uint8Array {
    if (offset >= this.size || length <= 0) return new Uint8Array(0);
    const endByte = Math.min(this.size, offset + length);
    const firstChunk = Math.floor(offset / this.chunkSize);
    const lastChunk = Math.floor((endByte - 1) / this.chunkSize);
    const maxChunks = Math.max(1, Math.floor(this.maxReadAhead / this.chunkSize));
    const totalChunks = Math.ceil(this.size / this.chunkSize);
    for (let c = firstChunk; c <= lastChunk; c++) {
      this.used.add(c);
      if (this.get(c)) continue;
      this.ahead = c === this.lastEnd ? Math.min(maxChunks, this.ahead * 2) : 1;
      let n = Math.max(this.ahead, lastChunk - c + 1);
      n = Math.min(n, totalChunks - c);
      while (n > lastChunk - c + 1 && this.cache.has(c + n - 1)) n--;
      this.fetchChunks(c, n);
      this.lastEnd = c + n;
    }
    if (firstChunk === lastChunk) {
      const chunk = this.get(firstChunk) as Uint8Array;
      const from = offset - firstChunk * this.chunkSize;
      return chunk.subarray(from, from + (endByte - offset));
    }
    const out = new Uint8Array(endByte - offset);
    let pos = 0;
    for (let c = firstChunk; c <= lastChunk; c++) {
      const chunk = this.get(c) as Uint8Array;
      const from = c === firstChunk ? offset - c * this.chunkSize : 0;
      const to = c === lastChunk ? endByte - c * this.chunkSize : chunk.byteLength;
      out.set(chunk.subarray(from, to), pos);
      pos += to - from;
    }
    return out;
  }
}

/** A synchronous range transport over `XMLHttpRequest` (Workers; also the main thread). */
export function xhrTransport(url: string, options: HttpSourceOptions = {}): RangeTransport {
  // Outside Workers a synchronous XHR can only return binary through responseText.
  const binaryText = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === 'undefined';
  return (start, end) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    if (options.withCredentials) xhr.withCredentials = true;
    for (const [k, v] of Object.entries(options.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
    if (binaryText) xhr.overrideMimeType('text/plain; charset=x-user-defined');
    else xhr.responseType = 'arraybuffer';
    xhr.send(null);
    if (xhr.status !== 206 && xhr.status !== 200) throw new Error(`Range ${start}-${end} of ${url}: HTTP ${xhr.status}`);
    let bytes: Uint8Array;
    if (binaryText) {
      const text = xhr.responseText;
      bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    } else {
      bytes = new Uint8Array(xhr.response as ArrayBuffer);
    }
    if (xhr.status === 200) bytes = bytes.subarray(start, end + 1); // server ignored Range
    return bytes;
  };
}

/** An HTTP resource read lazily with synchronous Range requests (see {@link RangeSource}). */
export class HttpRangeSource extends RangeSource {
  constructor(
    readonly url: string,
    size: number,
    options: HttpSourceOptions = {},
  ) {
    super(size, xhrTransport(url, options), options);
  }

  /** Opens a URL: one small asynchronous request learns the size and checks Range support. */
  static async open(url: string, options: HttpSourceOptions = {}): Promise<{ source: HttpRangeSource; head: Uint8Array }> {
    const headers = { ...(options.headers ?? {}), Range: 'bytes=0-4095' };
    const res = await fetch(url, { headers, credentials: options.withCredentials ? 'include' : 'same-origin' });
    if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
    const head = new Uint8Array(await res.arrayBuffer());
    if (res.status !== 206) throw new RangeNotSupportedError(`${url} does not support Range requests (HTTP ${res.status}).`);
    const cr = res.headers.get('Content-Range');
    const total = cr ? /\/(\d+)\s*$/.exec(cr)?.[1] : undefined;
    if (!total) throw new RangeNotSupportedError(`${url}: no readable Content-Range header (CORS must expose it).`);
    const source = new HttpRangeSource(url, Number(total), options);
    source.requests = 1;
    source.fetched = head.byteLength;
    source.seed(head);
    return { source, head };
  }
}
