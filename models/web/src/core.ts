// Types shared by every engine, task prefixes, Matryoshka truncation, spaces and their compatibility.
// Mirrors spdf-infer (Rust): same names in camelCase, same rule (models/COMPATIBILIDAD.md).

export type Kind = "embed" | "generate" | "judge";
export type Platform = "macos" | "ios" | "windows" | "linux" | "android" | "web";
export type Modality = "text" | "image" | "audio" | "video";

export type TaskName =
  | "query"
  | "document"
  | "question_answering"
  | "fact_checking"
  | "classification"
  | "clustering"
  | "similarity"
  | "code_retrieval"
  | "raw";

/** Instruction prefix EmbeddingGemma 2 was trained with. */
export function taskPrefix(task: TaskName, title?: string | null): string {
  switch (task) {
    case "query":
      return "task: search result | query: ";
    case "document":
      return `title: ${title && title.trim() ? title : "none"} | text: `;
    case "question_answering":
      return "task: question answering | query: ";
    case "fact_checking":
      return "task: fact checking | query: ";
    case "classification":
      return "task: classification | query: ";
    case "clustering":
      return "task: clustering | query: ";
    case "similarity":
      return "task: sentence similarity | query: ";
    case "code_retrieval":
      return "task: code retrieval | query: ";
    case "raw":
      return "";
  }
}

/** Canonical `task_prefixes` of an EmbeddingGemma 2 retrieval space. */
export const EMBEDDINGGEMMA2_TASK_PREFIXES: Record<string, string> = {
  document: "title: {title} | text: ",
  query: "task: search result | query: ",
};

/** Revision of google/embeddinggemma-2 every artefact was converted from (spaces.version). */
export const EMBEDDINGGEMMA2_VERSION = "914f7f89";

/** A row of the SPDF `spaces` table. */
export interface Space {
  id: string;
  provider: string;
  model: string;
  version: string | null;
  dims: number;
  dtype: "f32" | "f16" | "i8";
  normalized: boolean;
  truncated_from: number | null;
  modalities: Modality[];
  task_prefixes: Record<string, string> | null;
}

export function withDtype(space: Space, dtype: Space["dtype"]): Space {
  const base = space.id.split(":")[0];
  return { ...space, dtype, id: dtype === "f32" ? base : `${base}:${dtype}` };
}

/** Matryoshka truncation to `dims` (if given) and L2 normalisation. */
export function mrl(v: ArrayLike<number>, dims?: number | null): Float32Array {
  const d = dims ?? v.length;
  if (d <= 0 || d > v.length) throw new Error(`dims ${d} out of range (native ${v.length})`);
  let n = 0;
  for (let i = 0; i < d; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d);
  for (let i = 0; i < d; i++) out[i] = v[i] / n;
  return out;
}

export interface EmbedOptions {
  task?: TaskName;
  title?: string | null;
  dims?: number | null;
}

/** Anything that turns text into vectors of a declared space. */
export interface Embed {
  embed(texts: string[], opts?: EmbedOptions): Promise<Float32Array[]>;
  space(dims?: number | null): Space;
}

// ------------------------------------------------------------------ compatibility

export type Compat = { kind: "same" } | { kind: "approximate"; reason: string } | { kind: "incompatible"; reason: string };

const baseVersion = (v: string | null) => (v == null ? null : v.split("+")[0]);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(x: unknown): unknown {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return x;
}

/** The contract rule with a reason; engine variants of one checkpoint are "approximate". */
export function checkCompat(stored: Space, query: Space): Compat {
  if (stored.provider !== query.provider || stored.model !== query.model)
    return { kind: "incompatible", reason: `model ${stored.provider}/${stored.model} differs from ${query.provider}/${query.model}` };
  if (stored.dims !== query.dims) return { kind: "incompatible", reason: `dims ${stored.dims} vs ${query.dims}` };
  if (stored.normalized !== query.normalized) return { kind: "incompatible", reason: "normalisation differs" };
  if ((stored.truncated_from ?? null) !== (query.truncated_from ?? null))
    return { kind: "incompatible", reason: `truncated_from ${stored.truncated_from} vs ${query.truncated_from}` };
  if (!sameJson(stored.task_prefixes ?? null, query.task_prefixes ?? null)) return { kind: "incompatible", reason: "task prefixes differ" };
  if ((stored.version ?? null) !== (query.version ?? null)) {
    if (stored.version != null && baseVersion(stored.version) === baseVersion(query.version))
      return { kind: "approximate", reason: `same checkpoint, engine variants differ (${stored.version} vs ${query.version})` };
    return { kind: "incompatible", reason: `version ${stored.version} vs ${query.version}` };
  }
  return { kind: "same" };
}

/** The contract rule exactly: one query vector serves both spaces. */
export function isCompatible(stored: Space, query: Space): boolean {
  return checkCompat(stored, query).kind === "same";
}

// ------------------------------------------------------------------ fake embedder

/** Deterministic, download-free embedder for end-to-end tests (same output as Rust's FakeEmbedder). */
export class FakeEmbedder implements Embed {
  constructor(readonly dims = 768) {}
  private vecFor(s: string): Float32Array {
    // FNV-1a 64 seed + splitmix64, as in spdf-infer
    const bytes = new TextEncoder().encode(s);
    let h = 0xcbf29ce484222325n;
    const M = (1n << 64n) - 1n;
    for (const b of bytes) {
      h ^= BigInt(b);
      h = (h * 0x100000001b3n) & M;
    }
    const v = new Float32Array(this.dims);
    for (let i = 0; i < this.dims; i++) {
      h = (h + 0x9e3779b97f4a7c15n) & M;
      let z = h;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
      z ^= z >> 31n;
      v[i] = Number(z >> 11n) / 2 ** 53 * 2 - 1;
    }
    return v;
  }
  async embed(texts: string[], opts: EmbedOptions = {}): Promise<Float32Array[]> {
    const task = opts.task ?? "document";
    return texts.map((t) => mrl(this.vecFor(taskPrefix(task, opts.title) + t), opts.dims));
  }
  space(dims?: number | null): Space {
    const d = dims ?? this.dims;
    return {
      id: `spdf-fake@${d}`,
      provider: "spdf",
      model: "spdf-fake",
      version: "1",
      dims: d,
      dtype: "f32",
      normalized: true,
      truncated_from: d < this.dims ? this.dims : null,
      modalities: ["text"],
      task_prefixes: { ...EMBEDDINGGEMMA2_TASK_PREFIXES },
    };
  }
}

// ------------------------------------------------------------------ chat formatting

export type Role = "system" | "user" | "assistant";
export interface Message {
  role: Role;
  content: string;
}

/** Gemma 4 chat format (from the GGUF Jinja template, thinking disabled). */
export function formatGemma4(messages: Message[], addGenerationPrompt = true): string {
  let s = "<bos>";
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : m.role;
    s += `<|turn>${role}\n${m.content.trim()}<turn|>\n`;
  }
  if (addGenerationPrompt) s += "<|turn>model\n";
  return s;
}
