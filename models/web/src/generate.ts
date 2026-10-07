// Gemma 4 E2B generation in the browser with MediaPipe GenAI (LiteRT, WebGPU), streamed.

import { formatGemma4, type Message } from "./core.js";
import { ModelManager } from "./manager.js";

export interface GenParams {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  seed?: number;
  system?: string;
  stop?: string[];
}

export interface GenStats {
  text: string;
  promptTokens: number;
  generatedTokens: number;
  promptMs: number;
  genMs: number;
  tokensPerS: number;
  stopReason: "eog" | "stop" | "callback" | "max_tokens";
}

export interface GeneratorOptions {
  manager?: ModelManager;
  /** Where the MediaPipe GenAI wasm files are served (default: jsDelivr, pinned version). */
  wasmBase?: string;
  /** Context window (prompt + answer) in tokens. */
  maxTokens?: number;
}

type LlmInference = {
  generateResponse(q: string, cb?: (partial: string, done: boolean) => void): Promise<string>;
  sizeInTokens(q: string): number;
  setOptions(o: Record<string, unknown>): Promise<void>;
  cancelProcessing?: () => void;
  close(): void;
};

export class Generator {
  private constructor(private llm: LlmInference, readonly id: string) {}

  static async load(id: string, opts: GeneratorOptions = {}): Promise<Generator> {
    const mm = opts.manager ?? new ModelManager();
    const e = mm.entry(id);
    if (!e || e.engine !== "mediapipe") throw new Error(`${id} is not a MediaPipe model`);
    const blob = await mm.file(id, e.files[0].path);
    if (!blob) throw new Error(`model not downloaded: ${id}`);
    const genai = await import("@mediapipe/tasks-genai");
    const fileset = await genai.FilesetResolver.forGenAiTasks(opts.wasmBase ?? "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.29/wasm");
    // stream the 2-3 GB .task from OPFS instead of copying it into JS memory
    const reader = blob.stream().getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const llm = (await genai.LlmInference.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: reader },
      maxTokens: opts.maxTokens ?? 4096,
      topK: 64,
      temperature: 1.0,
      randomSeed: 0xc0ffee,
    } as never)) as unknown as LlmInference;
    return new Generator(llm, id);
  }

  async chat(messages: Message[], params: GenParams = {}, onToken?: (t: string) => boolean | void): Promise<GenStats> {
    const prompt = formatGemma4(messages, true);
    await this.llm.setOptions({ topK: params.topK ?? 64, temperature: params.temperature ?? 1.0, randomSeed: params.seed ?? 0xc0ffee,
      maxTokens: params.maxTokens ? this.llm.sizeInTokens(prompt) + params.maxTokens : undefined });
    const promptTokens = this.llm.sizeInTokens(prompt);
    const t0 = performance.now();
    let first = 0;
    let text = "";
    let stopReason: GenStats["stopReason"] = "eog";
    const stops = params.stop ?? [];
    await this.llm.generateResponse(prompt, (partial) => {
      if (!first) first = performance.now();
      if (stopReason !== "eog") return;
      text += partial;
      const cut = stops.map((s) => text.indexOf(s)).filter((i) => i >= 0);
      if (cut.length) {
        text = text.slice(0, Math.min(...cut));
        stopReason = "stop";
        this.llm.cancelProcessing?.();
        return;
      }
      if (onToken && onToken(partial) === false) {
        stopReason = "callback";
        this.llm.cancelProcessing?.();
      }
    });
    const end = performance.now();
    const generatedTokens = this.llm.sizeInTokens(text);
    const genMs = end - (first || end);
    if (params.maxTokens && generatedTokens >= params.maxTokens) stopReason = "max_tokens";
    return { text, promptTokens, generatedTokens, promptMs: (first || end) - t0, genMs, tokensPerS: genMs > 0 ? generatedTokens / (genMs / 1000) : 0, stopReason };
  }

  async generate(prompt: string, params: GenParams = {}, onToken?: (t: string) => boolean | void): Promise<GenStats> {
    const msgs: Message[] = params.system ? [{ role: "system", content: params.system }] : [];
    msgs.push({ role: "user", content: prompt });
    return this.chat(msgs, params, onToken);
  }

  close() {
    this.llm.close();
  }
}
