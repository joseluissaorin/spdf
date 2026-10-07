/**
 * `spdf-format` in the browser (and Web Workers, Deno, Cloudflare Workers): SQLite
 * compiled to WebAssembly (`@sqlite.org/sqlite-wasm`, an optional peer dependency),
 * `DecompressionStream` for gzip, WebCrypto for hashes and signatures.
 *
 * Extras: `openRemote(url)` reads a file over HTTP Range requests without downloading
 * it; `openBlob(file)` reads a `File`/`Blob` lazily inside a Worker.
 */
import { setDefaultEngine } from '../port.js';
import { wasmEngine, type WasmEngine, type WasmEngineOptions } from '../adapters/wasm.js';
import { openRaw, openSpdf, SpdfDocument, type OpenOptions } from '../document.js';
import { BlobSource, HttpRangeSource, RangeNotSupportedError, type HttpSourceOptions } from '../sources.js';
import { isGzip } from '../bytes.js';

let engineOptions: WasmEngineOptions = {};
let engine: WasmEngine | null = null;

function browserEngine(): WasmEngine {
  return (engine ??= wasmEngine(engineOptions));
}

/** Configures the WebAssembly engine (call before opening anything). */
export function configureBrowserEngine(options: WasmEngineOptions): void {
  engineOptions = { ...options };
  engine = null;
  setDefaultEngine(async () => browserEngine());
}

setDefaultEngine(async () => browserEngine());

export * from '../index.js';
export { wasmEngine, type WasmEngine, type WasmEngineOptions } from '../adapters/wasm.js';

export interface RemoteOptions extends OpenOptions, HttpSourceOptions {
  /** If the server ignores Range requests, download the whole file instead (default true). */
  fallbackToDownload?: boolean;
}

async function download(url: string, options: RemoteOptions): Promise<Uint8Array> {
  const res = await fetch(url, { ...(options.headers ? { headers: options.headers } : {}), credentials: options.withCredentials ? 'include' : 'same-origin' });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Opens an SPDF by URL reading only the pages it needs (HTTP Range requests through a
 * read-only SQLite VFS). Best inside a Web Worker (synchronous requests block the thread
 * that runs SQLite). Cross-origin servers must allow the `Range` header and expose
 * `Content-Range`. Legacy gzip files are downloaded whole.
 */
export async function openRemote(url: string, options: RemoteOptions = {}): Promise<SpdfDocument> {
  try {
    const { source, head } = await HttpRangeSource.open(url, options);
    if (isGzip(head)) return openSpdf(await download(url, options), options);
    const raw = await openRaw({ source, head }, options);
    return SpdfDocument.fromRaw(raw, options);
  } catch (e) {
    if (e instanceof RangeNotSupportedError && options.fallbackToDownload !== false) return openSpdf(await download(url, options), options);
    throw e;
  }
}

/**
 * Opens a `File`/`Blob` (also an OPFS file from `getFile()`). Inside a Worker it is read
 * lazily with `FileReaderSync`; elsewhere it is read into memory.
 */
export async function openBlob(blob: Blob, options: OpenOptions = {}): Promise<SpdfDocument> {
  const canLazy = typeof (globalThis as { FileReaderSync?: unknown }).FileReaderSync === 'function';
  if (!canLazy) return openSpdf(blob, options);
  const source = new BlobSource(blob);
  const head = source.read(0, 100);
  if (isGzip(head)) return openSpdf(blob, options);
  return SpdfDocument.fromRaw(await openRaw({ source, head }, options), options);
}

export { HttpRangeSource, BlobSource };
