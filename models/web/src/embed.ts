// EmbeddingGemma 2 in the browser with transformers.js (WebGPU, WASM fallback).

import type * as TJS from "@huggingface/transformers";
import {
  EMBEDDINGGEMMA2_TASK_PREFIXES,
  EMBEDDINGGEMMA2_VERSION,
  mrl,
  taskPrefix,
  type Embed,
  type EmbedOptions,
  type Modality,
  type Space,
} from "./core.js";
import { preprocessImage, type RGBImage } from "./image.js";
import { ModelManager, type CatalogEntry } from "./manager.js";

export type Device = "auto" | "webgpu" | "wasm" | "cpu";

export interface EmbedderOptions {
  manager?: ModelManager;
  device?: Device;
  /** Encoders to load; text-only skips ~300-600 MB. Default: the entry's modalities. */
  modalities?: Modality[];
  /** Vision soft-token budget (70, 140, 280, 560, 1120); 280 = reference. */
  imageTokens?: number;
  /** transformers.js module (default: dynamic import of "@huggingface/transformers"). */
  transformers?: typeof TJS;
}

export async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** Points transformers.js at a ModelManager's verified store (no implicit network downloads). */
export function useManagerCache(T: typeof TJS, mm: ModelManager) {
  T.env.useCustomCache = true;
  T.env.customCache = mm.transformersCache() as unknown as typeof T.env.customCache;
  T.env.useBrowserCache = false;
}

export class Embedder implements Embed {
  private constructor(
    private T: typeof TJS,
    private entry: CatalogEntry,
    private processor: TJS.Processor,
    private model: TJS.PreTrainedModel,
    private mods: Modality[],
    readonly device: string,
    private imageTokens: number,
  ) {}

  static async load(id: string, opts: EmbedderOptions = {}): Promise<Embedder> {
    const mm = opts.manager ?? new ModelManager();
    const entry = mm.entry(id);
    if (!entry) throw new Error(`model not in the catalog: ${id}`);
    if (entry.engine !== "transformers.js") throw new Error(`${id} is not a transformers.js model`);
    if (!(await mm.isDownloaded(id))) throw new Error(`model not downloaded: ${id} (call ModelManager.download first)`);
    const T = opts.transformers ?? (await import("@huggingface/transformers"));
    useManagerCache(T, mm);
    const repo = entry.source.replace("https://huggingface.co/", "");
    let device = opts.device ?? "auto";
    if (device === "auto") device = (await webgpuAvailable()) ? "webgpu" : "wasm";
    const mods = (opts.modalities ?? (entry.modalities as Modality[])).filter((m) => entry.modalities.includes(m));
    const config = await T.AutoConfig.from_pretrained(repo, { revision: entry.revision });
    const cfg = config as unknown as Record<string, unknown>;
    if (!mods.includes("image")) cfg.vision_config = null;
    if (!mods.includes("audio")) cfg.audio_config = null;
    const dtype = entry.dtype ?? "q4";
    const processor = await T.AutoProcessor.from_pretrained(repo, { revision: entry.revision });
    const model = await T.AutoModel.from_pretrained(repo, {
      revision: entry.revision,
      config,
      device: device as TJS.DeviceType,
      dtype: dtype as TJS.DataType,
    });
    const tokens = opts.imageTokens ?? 280;
    const ip = (processor as unknown as { image_processor?: { max_soft_tokens?: number } }).image_processor;
    if (ip) ip.max_soft_tokens = tokens;
    return new Embedder(T, entry, processor, model, ["text", ...mods.filter((m) => m !== "text")], device, tokens);
  }

  private async run(inputs: Record<string, unknown>): Promise<Float32Array[]> {
    const out = (await (this.model as unknown as (x: unknown) => Promise<{ sentence_embedding: TJS.Tensor }>)(inputs)).sentence_embedding;
    const [n, d] = out.dims as number[];
    const data = out.data as Float32Array;
    return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d));
  }

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<Float32Array[]> {
    const task = opts.task ?? "document";
    const out: Float32Array[] = [];
    // one at a time: no padding effects, and WebGPU stays under its dispatch limits
    for (const t of texts) {
      const inputs = await (this.processor as unknown as (x: string[]) => Promise<Record<string, unknown>>)([taskPrefix(task, opts.title) + t]);
      out.push(mrl((await this.run(inputs))[0], opts.dims));
    }
    return out;
  }

  /**
   * Image (Blob, URL, or decoded RGB). Resized here exactly like the reference processor
   * (Pillow-style antialiased bicubic) before transformers.js sees it.
   */
  async embedImage(image: Blob | string | RGBImage, opts: { dims?: number | null } = {}): Promise<Float32Array> {
    if (!this.mods.includes("image")) throw new Error("this embedder was loaded without the vision encoder");
    const T = this.T;
    let rgb: RGBImage;
    if (typeof image === "string" || image instanceof Blob) {
      const raw = typeof image === "string" ? await T.RawImage.fromURL(image) : await T.RawImage.fromBlob(image);
      const r = raw.rgb();
      rgb = { width: r.width, height: r.height, data: r.data as Uint8ClampedArray };
    } else {
      rgb = image;
    }
    const pre = preprocessImage(rgb, this.imageTokens);
    const ri = new T.RawImage(pre.data, pre.width, pre.height, 3);
    // the size formula is not idempotent (843x422 -> 1104x528 -> 1152x528): the image is already at the
    // reference size, so transformers.js must not resize it again
    const ip = (this.processor as unknown as { image_processor: { do_resize: boolean } }).image_processor;
    const prev = ip.do_resize;
    ip.do_resize = false;
    try {
      const inputs = await (this.processor as unknown as (t: null, i: unknown) => Promise<Record<string, unknown>>)(null, [[ri]]);
      return mrl((await this.run(inputs))[0], opts.dims);
    } finally {
      ip.do_resize = prev;
    }
  }

  /** Mono PCM at 16 kHz. */
  async embedAudio(pcm16k: Float32Array, opts: { dims?: number | null } = {}): Promise<Float32Array> {
    if (!this.mods.includes("audio")) throw new Error("this embedder was loaded without the audio encoder");
    const inputs = await (this.processor as unknown as (t: null, i: null, a: Float32Array[]) => Promise<Record<string, unknown>>)(null, null, [pcm16k]);
    return mrl((await this.run(inputs))[0], opts.dims);
  }

  space(dims?: number | null): Space {
    const native = 768;
    const d = dims ?? native;
    return {
      id: `embeddinggemma-2@${d}`,
      provider: "google",
      model: "embeddinggemma-2",
      version: this.entry.space_version ?? EMBEDDINGGEMMA2_VERSION,
      dims: d,
      dtype: "f32",
      normalized: true,
      truncated_from: d < native ? native : null,
      modalities: this.mods,
      task_prefixes: { ...EMBEDDINGGEMMA2_TASK_PREFIXES },
    };
  }

  async dispose() {
    await (this.model as unknown as { dispose(): Promise<void> }).dispose?.();
  }
}
