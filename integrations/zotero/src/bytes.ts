/**
 * Byte helpers that survive Firefox compartments.
 *
 * In Zotero the plugin runs in its own sandbox, while `IOUtils`, `Sqlite.sys.mjs` and the
 * main window (where `DecompressionStream` lives) belong to other globals. Typed arrays
 * that come from them are cross-compartment wrappers: `x instanceof Uint8Array` is false
 * inside the sandbox, and the `spdf-format` core relies on that test. Everything that
 * enters the plugin is therefore copied into a fresh `Uint8Array` of this realm.
 * `TypedArray.prototype.set` accepts any typed array (unwrapping it) or array-like, so
 * the copy works whatever the source is.
 */

/** A copy of `v` (typed array, ArrayBuffer, array of octets, from any realm) as a local Uint8Array. */
export function toLocalBytes(v: unknown): Uint8Array {
  if (v === null || v === undefined) return new Uint8Array(0);
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') {
    const view = new Uint8Array(v as ArrayBuffer);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out;
  }
  const o = v as { length?: unknown; byteLength?: unknown };
  const length = typeof o.length === 'number' ? o.length : typeof o.byteLength === 'number' ? o.byteLength : null;
  if (length === null) throw new TypeError(`Expected bytes, got ${tag}.`);
  const out = new Uint8Array(length);
  out.set(v as ArrayLike<number>);
  return out;
}

/** Concatenates local chunks. */
export function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** The constructor of the Compression Streams API `DecompressionStream`. */
export type DecompressionStreamCtor = new (format: 'gzip') => {
  readonly writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> } };
  readonly readable: { getReader(): { read(): Promise<{ done: boolean; value?: unknown }>; cancel(reason?: unknown): Promise<void> } };
};

/**
 * Gunzip with `DecompressionStream` (Firefox ≥ 113, so Zotero 7 and 8), aborting past
 * `limit` bytes of output (SPEC §2.3). Only the stream class is needed: no `Blob` and no
 * `ReadableStream` constructor, which the Zotero plugin sandbox does not have.
 */
export async function gunzip(bytes: Uint8Array, limit: number, DS: DecompressionStreamCtor): Promise<Uint8Array> {
  const ds = new DS('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // Write without awaiting: the readable side applies backpressure, so awaiting the
  // write before reading could deadlock. Write errors resurface on the reader.
  const writing = writer.write(bytes).then(
    () => writer.close(),
    () => undefined,
  );
  writing.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toLocalBytes(value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Decompressed size exceeds the limit of ${limit} bytes.`);
      }
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Decompressed size')) throw e;
    throw new Error(`gzip: ${(e as Error)?.message ?? String(e)}`);
  }
  await writing.catch(() => undefined);
  return concat(chunks, total);
}
