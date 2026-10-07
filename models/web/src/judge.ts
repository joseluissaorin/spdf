// The Jev-style judge in the browser, with the same API as spdf-infer's Judge:
//   classify(instruction, content, labels) -> [[label, p]], support(claim, passage) -> Support,
//   relevance(query, passage) -> [0, 1].
// Engines: Valen-0.8B on onnxruntime-web (a native decision model), or Gemma 4 E2B on
// transformers.js scored by the logits of the option letters (the native default's method).

import type * as TJS from "@huggingface/transformers";
import { formatGemma4 } from "./core.js";
import { useManagerCache, webgpuAvailable } from "./embed.js";
import { ModelManager, type CatalogEntry } from "./manager.js";
import { predict, type DecisionRequest, type ValenSessions } from "./valen.js";

export interface Label {
  name: string;
  description?: string | null;
}
export interface Calibration {
  temperature: number;
  priorCorrection: boolean;
}

export const RELATIONS = [
  "APOYO_DIRECTO",
  "APLICACION_DE_MARCO",
  "CONTEXTO",
  "CONTRADICCION",
  "IMPOSIBLE_TEMPORAL",
  "OPINION_REFERIDA",
  "AFIRMACION_NEGATIVA",
] as const;
export type Relation = (typeof RELATIONS)[number];

export const RELATION_DESCRIPTIONS: Record<Relation, string> = {
  APOYO_DIRECTO: "The passage directly states the claim or logically entails it.",
  APLICACION_DE_MARCO: "The claim applies a concept or framework from the passage to a new domain the passage does not discuss.",
  CONTEXTO: "The passage is on the same topic and gives background, but does not establish this specific claim.",
  CONTRADICCION: "The passage states the opposite of the claim or gives a different fact, number, date or name.",
  IMPOSIBLE_TEMPORAL: "The source cannot speak about what the claim says because of chronology: it was written before the events, works or ideas the claim attributes to it.",
  OPINION_REFERIDA: "The claim reports someone's view, and the passage is where that view is stated or reported.",
  AFIRMACION_NEGATIVA: "The claim says something is absent or does not happen, while the passage only discusses what is present.",
};
export const SUPPORT_TASK = "Checking academic citations. Does the passage support the claim, so that a skeptical reader checking the citation would agree the source says it?";
export const SUPPORT_YES = "The passage states or clearly entails the claim.";
export const SUPPORT_NO = "The passage only shares the topic, says something different, or contradicts the claim.";
export const RELATION_TASK = "Checking academic citations. How does the passage relate to the claim?";
export const RELEVANCE_TASK = "Search relevance. How well does the passage answer the query?";
export const RELEVANCE_LABELS: Label[] = [
  { name: "0", description: "Irrelevant: unrelated to the query." },
  { name: "1", description: "Related: same topic, but does not help answer the query." },
  { name: "2", description: "Relevant: partially answers the query or gives useful evidence for it." },
  { name: "3", description: "Highly relevant: directly and fully answers the query." },
];

export interface SourceInfo {
  author?: string | null;
  title?: string | null;
  year?: number | null;
}
export interface Support {
  label: Relation;
  probs: [Relation, number][];
  supported: number;
}

export function pairContent(claim: string, passage: string, source?: SourceInfo): string {
  const parts = [source?.author, source?.title, source?.year].filter((x) => x != null && x !== "");
  return (parts.length ? `Source: ${parts.join(", ")}\n` : "") + `Claim: ${claim.trim()}\nPassage: ${passage.trim()}`;
}

function softmax(z: number[], t = 1): number[] {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp((x - m) / (t > 0 ? t : 1)));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

interface Engine {
  classify(task: string, content: string, labels: Label[], cal: Calibration): Promise<number[]>;
  support(claim: string, passage: string, source?: SourceInfo): Promise<Support>;
  relevance(query: string, passage: string): Promise<number>;
  dispose(): Promise<void>;
}

// ------------------------------------------------------------------ Gemma 4 (letters' logits)

const SYSTEM = "You are a careful, skeptical judge. Read the task, the content and the options, and choose the single best option. Answer with the letter of that option only.";

function optionsPrompt(task: string, content: string, labels: Label[]): string {
  let s = `Task: ${task.trim()}\n\n<content>\n${content.trim()}\n</content>\n\nOptions:\n`;
  labels.forEach((l, i) => {
    const letter = String.fromCharCode(65 + i);
    s += l.description ? `${letter}) ${l.name}: ${l.description}\n` : `${letter}) ${l.name}\n`;
  });
  return s + "\nAnswer with one letter.";
}

class GemmaEngine implements Engine {
  private priors = new Map<string, number[]>();
  constructor(
    private T: typeof TJS,
    private tok: TJS.PreTrainedTokenizer,
    private model: TJS.PreTrainedModel,
    private letters: number[],
    private choiceCal: Calibration,
    private noulCal: Calibration,
  ) {}

  private async logits(task: string, content: string, labels: Label[]): Promise<number[]> {
    const prompt = formatGemma4([{ role: "system", content: SYSTEM }, { role: "user", content: optionsPrompt(task, content, labels) }]);
    const inputs = this.tok(prompt, { add_special_tokens: false });
    let captured: Float32Array | undefined;
    const T = this.T;
    class Capture extends T.LogitsProcessor {
      _call(_ids: bigint[][], logits: TJS.Tensor) {
        if (!captured) captured = (logits.data as Float32Array).slice();
        return logits;
      }
    }
    const lp = new T.LogitsProcessorList();
    lp.push(new Capture());
    await (this.model as unknown as { generate(x: unknown): Promise<unknown> }).generate({ ...inputs, max_new_tokens: 1, do_sample: false, logits_processor: lp });
    const v = captured!;
    const vocab = v.length; // [1, vocab] for the last position
    return labels.map((_, i) => v[(this.letters[i] % vocab)]);
  }

  async classify(task: string, content: string, labels: Label[], cal: Calibration): Promise<number[]> {
    let p = softmax(await this.logits(task, content, labels), cal.temperature);
    if (cal.priorCorrection) {
      const key = task + "\u0001" + labels.map((l) => l.name).join("\u0001");
      let prior = this.priors.get(key);
      if (!prior) {
        prior = softmax(await this.logits(task, "N/A", labels), cal.temperature);
        this.priors.set(key, prior);
      }
      p = p.map((x, i) => x / Math.max(prior![i], 1e-6));
      const s = p.reduce((a, b) => a + b, 0);
      p = p.map((x) => x / s);
    }
    return p;
  }

  async support(claim: string, passage: string, source?: SourceInfo): Promise<Support> {
    const c = pairContent(claim, passage, source);
    const yes = (await this.classify(SUPPORT_TASK, c, [{ name: "YES", description: SUPPORT_YES }, { name: "NO", description: SUPPORT_NO }], this.noulCal))[0];
    const p = await this.classify(RELATION_TASK, c, RELATIONS.map((r) => ({ name: r, description: RELATION_DESCRIPTIONS[r] })), this.choiceCal);
    const probs = RELATIONS.map((r, i) => [r, p[i]] as [Relation, number]);
    return { label: probs.reduce((a, b) => (b[1] > a[1] ? b : a))[0], probs, supported: yes };
  }

  async relevance(query: string, passage: string): Promise<number> {
    const p = await this.classify(RELEVANCE_TASK, `Query: ${query.trim()}\nPassage: ${passage.trim()}`, RELEVANCE_LABELS, this.choiceCal);
    return p.reduce((a, x, i) => a + i * x, 0) / 3;
  }

  async dispose() {
    await (this.model as unknown as { dispose(): Promise<void> }).dispose?.();
  }
}

// ------------------------------------------------------------------ Valen (decision model)

class ValenEngine implements Engine {
  constructor(private s: ValenSessions, private choiceCal: Calibration, private noulCal: Calibration) {}

  async classify(task: string, content: string, labels: Label[], cal: Calibration): Promise<number[]> {
    const criteria = Object.fromEntries(labels.map((l) => [l.name, l.description ?? l.name]));
    const req: DecisionRequest = { state: content, questions: { q: { type: "choice", instructions: task, criteria } } };
    const a = (await predict(this.s, req, cal.temperature)).answers.q;
    return labels.map((l) => a.probabilities![l.name]);
  }

  async support(claim: string, passage: string, source?: SourceInfo): Promise<Support> {
    const req: DecisionRequest = {
      state: pairContent(claim, passage, source),
      questions: {
        support: { type: "noul", instructions: "Does the passage support the claim, so that a skeptical reader checking the citation would agree the source says it?" },
        relation: { type: "choice", instructions: "How does the passage relate to the claim?", criteria: { ...RELATION_DESCRIPTIONS } },
      },
    };
    const a = (await predict(this.s, req, 1)).answers;
    // calibration: temperature on log-probabilities
    const relP = softmax(RELATIONS.map((r) => Math.log(Math.max(a.relation.probabilities![r], 1e-12))), this.choiceCal.temperature);
    const y = a.support.noul!;
    const yes = softmax([Math.log(Math.max(y, 1e-12)), Math.log(Math.max(1 - y, 1e-12))], this.noulCal.temperature)[0];
    const probs = RELATIONS.map((r, i) => [r, relP[i]] as [Relation, number]);
    return { label: probs.reduce((x, b) => (b[1] > x[1] ? b : x))[0], probs, supported: yes };
  }

  async relevance(query: string, passage: string): Promise<number> {
    const req: DecisionRequest = {
      state: `Query: ${query}\nPassage: ${passage}`,
      questions: { relevance: { type: "score", instructions: "How well does the passage answer the search query?", criteria: RELEVANCE_LABELS.map((l) => l.description!) } },
    };
    return ((await predict(this.s, req, this.choiceCal.temperature)).answers.relevance.score ?? 0) / 3;
  }

  async dispose() {
    await this.s.backbone.release();
    await this.s.head.release();
  }
}

// ------------------------------------------------------------------ remote (models/valen/server.py)

class RemoteEngine implements Engine {
  constructor(private base: string, private token?: string) {}
  private async post(path: string, body: unknown) {
    const r = await fetch(this.base.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`judge server: HTTP ${r.status}`);
    return r.json();
  }
  async classify(task: string, content: string, labels: Label[]): Promise<number[]> {
    const r = await this.post("/judge/classify", { instruction: task, content, labels });
    return (r.probs as [string, number][]).map(([, p]) => p);
  }
  async support(claim: string, passage: string, source?: SourceInfo): Promise<Support> {
    return (await this.post("/judge/support", { claim, passage, source })) as Support;
  }
  async relevance(query: string, passage: string): Promise<number> {
    return (await this.post("/judge/relevance", { query, passage })).relevance;
  }
  async dispose() {}
}

// ------------------------------------------------------------------ public API

export interface JudgeOptions {
  manager?: ModelManager;
  device?: "auto" | "webgpu" | "wasm";
  transformers?: typeof TJS;
}

export class Judge {
  calibration: Calibration;
  supportCalibration: Calibration;
  private constructor(private engine: Engine, readonly entry: CatalogEntry) {
    const c = entry.judge_calibration;
    this.calibration = c ? { temperature: c.choice.temperature, priorCorrection: c.choice.prior_correction } : { temperature: 1, priorCorrection: false };
    this.supportCalibration = c ? { temperature: c.noul.temperature, priorCorrection: c.noul.prior_correction } : { temperature: 1, priorCorrection: false };
  }

  /**
   * A Gemma judge on a transformers.js model the caller has already configured access to
   * (env.localModelPath, a custom cache…). `repo` is the model id or local path.
   */
  static async fromTransformers(T: typeof TJS, repo: string, opts: { device?: "webgpu" | "wasm"; dtype?: string; revision?: string } = {}): Promise<Judge> {
    const tok = await T.AutoTokenizer.from_pretrained(repo, opts.revision ? { revision: opts.revision } : {});
    const model = await T.AutoModelForCausalLM.from_pretrained(repo, {
      ...(opts.revision ? { revision: opts.revision } : {}),
      device: (opts.device ?? "webgpu") as TJS.DeviceType,
      dtype: (opts.dtype ?? "q4f16") as TJS.DataType,
    });
    const letters = Array.from({ length: 26 }, (_, i) => tok.encode(String.fromCharCode(65 + i), { add_special_tokens: false })[0]);
    const cal = { temperature: 1, priorCorrection: false };
    return new Judge(new GemmaEngine(T, tok, model, letters, cal, cal), { id: repo, engine: "transformers.js" } as CatalogEntry);
  }

  /** A judge served over HTTP with the same contract (models/valen/server.py). */
  static remote(baseUrl: string, token?: string): Judge {
    const entry = { id: "remote", engine: "server" } as CatalogEntry;
    return new Judge(new RemoteEngine(baseUrl, token), entry);
  }

  static async load(id: string, opts: JudgeOptions = {}): Promise<Judge> {
    const mm = opts.manager ?? new ModelManager();
    const e = mm.entry(id);
    if (!e) throw new Error(`model not in the catalog: ${id}`);
    if (!(await mm.isDownloaded(id))) throw new Error(`model not downloaded: ${id}`);
    const device = opts.device === "auto" || !opts.device ? ((await webgpuAvailable()) ? "webgpu" : "wasm") : opts.device;
    const cal = e.judge_calibration;
    const choice = { temperature: cal?.choice.temperature ?? 1, priorCorrection: cal?.choice.prior_correction ?? false };
    const noul = { temperature: cal?.noul.temperature ?? 1, priorCorrection: cal?.noul.prior_correction ?? false };
    if (e.engine === "onnxruntime-web") {
      const ort = await import("onnxruntime-web/webgpu");
      const T = opts.transformers ?? (await import("@huggingface/transformers"));
      const file = async (role: string) => {
        const f = e.files.find((x) => x.role === role)!;
        return new Uint8Array(await (await mm.file(id, f.path))!.arrayBuffer());
      };
      const data = e.files.find((x) => x.role === "onnx_data");
      const so = {
        executionProviders: device === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
        externalData: data ? [{ path: data.path.split("/").pop()!, data: await file("onnx_data") }] : undefined,
      } as never;
      const backbone = await ort.InferenceSession.create(await file("onnx"), so);
      const head = await ort.InferenceSession.create(await file("head"), { executionProviders: ["wasm"] });
      useManagerCache(T, mm);
      const tokenizer = (await T.AutoTokenizer.from_pretrained(e.source.replace("https://huggingface.co/", ""), { revision: e.revision })) as unknown as ValenSessions["tokenizer"];
      return new Judge(new ValenEngine({ ort: ort as never, backbone, head, tokenizer }, choice, noul), e);
    }
    if (e.engine === "transformers.js") {
      const T = opts.transformers ?? (await import("@huggingface/transformers"));
      useManagerCache(T, mm);
      const repo = e.source.replace("https://huggingface.co/", "");
      const tok = await T.AutoTokenizer.from_pretrained(repo, { revision: e.revision });
      const model = await T.AutoModelForCausalLM.from_pretrained(repo, { revision: e.revision, device: device as TJS.DeviceType, dtype: (e.dtype ?? "q4f16") as TJS.DataType });
      const letters = Array.from({ length: 26 }, (_, i) => {
        const ids = tok.encode(String.fromCharCode(65 + i), { add_special_tokens: false });
        if (ids.length !== 1) throw new Error("option letters must be single tokens");
        return ids[0];
      });
      return new Judge(new GemmaEngine(T, tok, model, letters, choice, noul), e);
    }
    throw new Error(`${id}: engine ${e.engine} cannot judge in the browser (Gemma 4 .task files expose no logits)`);
  }

  /** Probabilities for each label (sum 1), in order. */
  async classify(instruction: string, content: string, labels: Label[]): Promise<[string, number][]> {
    const p = await this.engine.classify(instruction, content, labels, this.calibration);
    return labels.map((l, i) => [l.name, p[i]]);
  }
  support(claim: string, passage: string, source?: SourceInfo): Promise<Support> {
    return this.engine.support(claim, passage, source);
  }
  relevance(query: string, passage: string): Promise<number> {
    return this.engine.relevance(query, passage);
  }
  dispose() {
    return this.engine.dispose();
  }
}
