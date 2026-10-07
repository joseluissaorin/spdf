// Model catalog (bundled manifest), downloads to OPFS (resumable) or Cache Storage, verified by
// streaming SHA-256, and a transformers.js-compatible cache over the same store.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import manifestJson from "./manifest.js";
import type { Kind, Platform } from "./core.js";

export interface FileEntry {
  role: string;
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  family: string;
  kind: Kind;
  kinds: Kind[];
  engine: string;
  format: string;
  license: string;
  license_url?: string | null;
  source: string;
  revision: string;
  bytes: number;
  files: FileEntry[];
  modalities: string[];
  platforms: Platform[];
  min_memory_mb: number;
  space_version?: string | null;
  dtype?: string;
  judge_calibration?: { choice: { temperature: number; prior_correction: boolean }; noul: { temperature: number; prior_correction: boolean } } | null;
  notes?: string | null;
  /** false: not on the server yet (see notes). */
  published?: boolean;
}

export interface Manifest {
  spdf_models: number;
  updated: string;
  models: CatalogEntry[];
  recommendations: Record<string, Record<string, string[]>>;
}

export interface Progress {
  id: string;
  file: string;
  done: number;
  total: number;
  overallDone: number;
  overallTotal: number;
}

/** Engines this package runs in the browser. */
export const WEB_ENGINES = ["transformers.js", "mediapipe", "onnxruntime-web"];

// ------------------------------------------------------------------ storage

interface Store {
  size(key: string): Promise<number>;
  read(key: string): Promise<Blob | undefined>;
  /** Appends from `offset` (0 = truncate). */
  open(key: string, offset: number): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  remove(prefix: string): Promise<void>;
  readText(key: string): Promise<string | undefined>;
  writeText(key: string, s: string): Promise<void>;
  canResume: boolean;
}

class OpfsStore implements Store {
  canResume = true;
  private root?: FileSystemDirectoryHandle;
  constructor(private base = "spdf-models") {}
  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    if (!this.root) this.root = await (await navigator.storage.getDirectory()).getDirectoryHandle(this.base, { create: true });
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  private async file(key: string, create: boolean): Promise<FileSystemFileHandle | undefined> {
    const parts = key.split("/");
    const name = parts.pop()!;
    try {
      return await (await this.dir(parts, create)).getFileHandle(name, { create });
    } catch {
      return undefined;
    }
  }
  async size(key: string) {
    const f = await this.file(key, false);
    return f ? (await f.getFile()).size : 0;
  }
  async read(key: string) {
    const f = await this.file(key, false);
    return f ? await f.getFile() : undefined;
  }
  async open(key: string, offset: number) {
    const f = (await this.file(key, true))!;
    const w = await (f as FileSystemFileHandle & { createWritable(o?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream> })
      .createWritable({ keepExistingData: offset > 0 });
    if (offset > 0) await w.seek(offset);
    else await w.truncate(0);
    return { write: (b: Uint8Array) => w.write(b as unknown as BufferSource), close: () => w.close(), abort: () => w.abort() };
  }
  async remove(prefix: string) {
    const parts = prefix.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    try {
      await (await this.dir(parts, false)).removeEntry(name, { recursive: true });
    } catch {
      /* not there */
    }
  }
  async readText(key: string) {
    const b = await this.read(key);
    return b ? await b.text() : undefined;
  }
  async writeText(key: string, s: string) {
    const w = await this.open(key, 0);
    await w.write(new TextEncoder().encode(s));
    await w.close();
  }
}

/** Cache Storage fallback (no resume: a file is stored once it is complete and verified). */
class CacheStore implements Store {
  canResume = false;
  constructor(private name = "spdf-models") {}
  private key(k: string) {
    return `https://spdf.local/${k}`;
  }
  async size(key: string) {
    const r = await (await caches.open(this.name)).match(this.key(key));
    return r ? Number(r.headers.get("content-length") ?? (await r.clone().blob()).size) : 0;
  }
  async read(key: string) {
    const r = await (await caches.open(this.name)).match(this.key(key));
    return r ? await r.blob() : undefined;
  }
  async open(key: string, _offset: number) {
    const chunks: Uint8Array[] = [];
    const k = this.key(key);
    const name = this.name;
    return {
      write: async (b: Uint8Array) => void chunks.push(b.slice()),
      close: async () => {
        const blob = new Blob(chunks as BlobPart[]);
        await (await caches.open(name)).put(k, new Response(blob, { headers: { "content-length": String(blob.size) } }));
      },
      abort: async () => void (chunks.length = 0),
    };
  }
  async remove(prefix: string) {
    const c = await caches.open(this.name);
    for (const r of await c.keys()) if (r.url.startsWith(this.key(prefix))) await c.delete(r);
  }
  async readText(key: string) {
    const b = await this.read(key);
    return b ? await b.text() : undefined;
  }
  async writeText(key: string, s: string) {
    await (await caches.open(this.name)).put(this.key(key), new Response(s));
  }
}

function hasOpfs(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory && typeof FileSystemFileHandle !== "undefined"
    && "createWritable" in FileSystemFileHandle.prototype;
}

export interface ManagerOptions {
  store?: "opfs" | "cache" | "auto";
  manifest?: Manifest;
  /** Replaces https://huggingface.co in every URL (a mirror or a same-origin proxy). */
  mirror?: string;
  fetch?: typeof fetch;
}

export class ModelManager {
  readonly manifest: Manifest;
  private store: Store;
  private mirror?: string;
  private fetchFn: typeof fetch;

  constructor(opts: ManagerOptions = {}) {
    this.manifest = opts.manifest ?? (manifestJson as unknown as Manifest);
    const kind = opts.store ?? "auto";
    this.store = kind === "cache" || (kind === "auto" && !hasOpfs()) ? new CacheStore() : new OpfsStore();
    this.mirror = opts.mirror;
    this.fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  /** Entries this package can run in the browser. */
  catalog(): CatalogEntry[] {
    return this.manifest.models.filter((e) => WEB_ENGINES.includes(e.engine));
  }
  catalogAll(): CatalogEntry[] {
    return this.manifest.models;
  }
  entry(id: string): CatalogEntry | undefined {
    return this.manifest.models.find((e) => e.id === id);
  }

  /** First preference for the web whose memory need fits in half the device memory. */
  recommend(kind: Kind, memoryGB?: number): CatalogEntry | undefined {
    const mem = memoryGB ?? (typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined) ?? 8;
    const prefs = this.manifest.recommendations.web?.[kind] ?? [];
    let last: CatalogEntry | undefined;
    for (const id of prefs) {
      const e = this.entry(id);
      if (!e || e.published === false || !WEB_ENGINES.includes(e.engine)) continue;
      if (e.min_memory_mb <= (mem * 1024) / 2) return e;
      last = e;
    }
    return last;
  }

  private url(f: FileEntry): string {
    return this.mirror ? f.url.replace("https://huggingface.co", this.mirror.replace(/\/$/, "")) : f.url;
  }
  private key(id: string, path: string) {
    return `${id}/${path}`;
  }

  async isDownloaded(id: string): Promise<boolean> {
    const e = this.entry(id);
    if (!e) return false;
    for (const f of e.files) {
      if ((await this.store.readText(this.key(id, f.path) + ".ok")) !== f.sha256) return false;
      if ((await this.store.size(this.key(id, f.path))) !== f.bytes) return false;
    }
    return true;
  }

  async delete(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /** A downloaded file (Blob/File), or undefined. */
  async file(id: string, path: string): Promise<Blob | undefined> {
    const e = this.entry(id);
    const f = e?.files.find((x) => x.path === path);
    if (!f) return undefined;
    if ((await this.store.readText(this.key(id, f.path) + ".ok")) !== f.sha256) return undefined;
    return this.store.read(this.key(id, f.path));
  }

  async download(id: string, onProgress?: (p: Progress) => void): Promise<void> {
    const e = this.entry(id);
    if (!e) throw new Error(`model not in the catalog: ${id}`);
    if (e.published === false && !this.mirror) throw new Error(`${id} is not published yet (${e.notes ?? "see the manifest notes"})`);
    const overallTotal = e.files.reduce((s, f) => s + f.bytes, 0);
    let before = 0;
    for (const f of e.files) {
      const key = this.key(id, f.path);
      if ((await this.store.readText(key + ".ok")) === f.sha256 && (await this.store.size(key)) === f.bytes) {
        before += f.bytes;
        onProgress?.({ id, file: f.path, done: f.bytes, total: f.bytes, overallDone: before, overallTotal });
        continue;
      }
      let attempt = 0;
      for (;;) {
        try {
          await this.fetchFile(id, f, before, overallTotal, onProgress);
          break;
        } catch (err) {
          if (++attempt >= 4) throw err;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      before += f.bytes;
    }
  }

  private async fetchFile(id: string, f: FileEntry, before: number, overallTotal: number, onProgress?: (p: Progress) => void) {
    // The file is written in place; only the ".ok" stamp (written after the SHA-256 matched)
    // makes it count as downloaded, so a partial file is simply resumed.
    const key = this.key(id, f.path);
    const part = key;
    await this.store.remove(key + ".ok");
    let have = this.store.canResume ? await this.store.size(part) : 0;
    if (have > f.bytes) have = 0;
    const hasher = sha256.create();
    if (have > 0) {
      // re-hash what is already on disk
      const blob = (await this.store.read(part))!;
      const reader = blob.slice(0, have).stream().getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        hasher.update(value);
      }
    }
    const resp = await this.fetchFn(this.url(f), have > 0 ? { headers: { Range: `bytes=${have}-` } } : undefined);
    if (!resp.ok && resp.status !== 206) throw new Error(`${f.path}: HTTP ${resp.status}`);
    if (have > 0 && resp.status !== 206) {
      have = 0;
      hasher.destroy?.();
    }
    const h = have > 0 ? hasher : sha256.create();
    const w = await this.store.open(part, have);
    let done = have;
    let last = 0;
    const reader = resp.body!.getReader();
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        h.update(value);
        await w.write(value);
        done += value.length;
        if (done - last > 4 << 20) {
          last = done;
          onProgress?.({ id, file: f.path, done, total: f.bytes, overallDone: before + done, overallTotal });
        }
      }
    } catch (e) {
      await w.close().catch(() => w.abort());
      throw e;
    }
    await w.close();
    const actual = bytesToHex(h.digest());
    if (done !== f.bytes || actual !== f.sha256) {
      await this.store.remove(part);
      throw new Error(`${f.path}: checksum mismatch (expected ${f.sha256}, got ${actual}, ${done} bytes)`);
    }
    await this.store.writeText(key + ".ok", f.sha256);
    onProgress?.({ id, file: f.path, done: f.bytes, total: f.bytes, overallDone: before + f.bytes, overallTotal });
  }

  /**
   * A cache for transformers.js (`env.customCache`): requests for files of a downloaded catalog
   * entry are answered from the store; nothing else is.
   */
  transformersCache() {
    const index = new Map<string, { id: string; f: FileEntry }>();
    for (const e of this.manifest.models) for (const f of e.files) index.set(`${e.source.replace("https://huggingface.co/", "")}/${f.path}`, { id: e.id, f });
    const lookup = (req: string) => {
      const m = /huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/.exec(req) ?? /\/models\/(.+?\/[^/]+)\/(.+)$/.exec(req);
      return m ? index.get(`${m[1]}/${decodeURIComponent(m[2])}`) : undefined;
    };
    return {
      match: async (request: string) => {
        const hit = lookup(request);
        if (!hit) return undefined;
        const blob = await this.file(hit.id, hit.f.path);
        return blob ? new Response(blob, { headers: { "content-length": String(blob.size) } }) : undefined;
      },
      put: async (_request: string, _response: Response) => {
        /* downloads go through ModelManager.download (verified); nothing is cached implicitly */
      },
    };
  }
}
