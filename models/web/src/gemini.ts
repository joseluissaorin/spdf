// Gemini with the user's own key, in the browser (same API as spdf-infer's `gemini` feature).
// The key goes in the x-goog-api-key header, never in the URL, and is never stored here.

import { mrl, type Embed, type EmbedOptions, type Message, type Space, type TaskName } from "./core.js";
import type { GenParams, GenStats } from "./generate.js";

const API = "https://generativelanguage.googleapis.com/v1beta";

const TASK_TYPE: Record<TaskName, string> = {
  query: "RETRIEVAL_QUERY",
  document: "RETRIEVAL_DOCUMENT",
  question_answering: "QUESTION_ANSWERING",
  fact_checking: "FACT_VERIFICATION",
  classification: "CLASSIFICATION",
  clustering: "CLUSTERING",
  similarity: "SEMANTIC_SIMILARITY",
  code_retrieval: "CODE_RETRIEVAL_QUERY",
  raw: "TASK_TYPE_UNSPECIFIED",
};

async function call(key: string, path: string, body: unknown, stream = false): Promise<Response> {
  const r = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`Gemini HTTP ${r.status}: ${msg}`);
  }
  void stream;
  return r;
}

export class GeminiEmbedder implements Embed {
  readonly nativeDims = 3072;
  constructor(private key: string, readonly model = "gemini-embedding-001") {}

  async embed(texts: string[], opts: EmbedOptions = {}): Promise<Float32Array[]> {
    const task = opts.task ?? "document";
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const requests = texts.slice(i, i + 100).map((t) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text: t }] },
        taskType: TASK_TYPE[task],
        ...(opts.dims ? { outputDimensionality: opts.dims } : {}),
        ...(task === "document" && opts.title ? { title: opts.title } : {}),
      }));
      const r = await (await call(this.key, `models/${this.model}:batchEmbedContents`, { requests })).json();
      for (const e of r.embeddings) out.push(mrl(e.values));
    }
    return out;
  }

  space(dims?: number | null): Space {
    const d = dims ?? this.nativeDims;
    return {
      id: `${this.model}@${d}`,
      provider: "google",
      model: this.model,
      version: null,
      dims: d,
      dtype: "f32",
      normalized: true,
      truncated_from: d < this.nativeDims ? this.nativeDims : null,
      modalities: ["text"],
      task_prefixes: { document: "task_type:RETRIEVAL_DOCUMENT", query: "task_type:RETRIEVAL_QUERY" },
    };
  }
}

export class GeminiGenerator {
  constructor(private key: string, readonly model = "gemini-flash-latest") {}

  async chat(messages: Message[], params: GenParams = {}, onToken?: (t: string) => boolean | void): Promise<GenStats> {
    const system = [params.system, ...messages.filter((m) => m.role === "system").map((m) => m.content)].filter(Boolean).join("\n\n");
    const body: Record<string, unknown> = {
      contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: params.maxTokens, temperature: params.temperature, topK: params.topK, stopSequences: params.stop },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const t0 = performance.now();
    const r = await call(this.key, `models/${this.model}:streamGenerateContent?alt=sse`, body, true);
    const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", text = "", first = 0, promptTokens = 0, generatedTokens = 0;
    let stopReason: GenStats["stopReason"] = "eog";
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let v;
        try {
          v = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        for (const p of v.candidates?.[0]?.content?.parts ?? []) {
          if (typeof p.text !== "string") continue;
          if (!first) first = performance.now();
          text += p.text;
          if (onToken && onToken(p.text) === false) {
            stopReason = "callback";
            await reader.cancel();
            break outer;
          }
        }
        if (v.usageMetadata) {
          promptTokens = v.usageMetadata.promptTokenCount ?? promptTokens;
          generatedTokens = v.usageMetadata.candidatesTokenCount ?? generatedTokens;
        }
        if (v.candidates?.[0]?.finishReason === "MAX_TOKENS") stopReason = "max_tokens";
      }
    }
    const end = performance.now();
    const genMs = end - (first || end);
    return { text, promptTokens, generatedTokens, promptMs: (first || end) - t0, genMs, tokensPerS: genMs > 0 ? generatedTokens / (genMs / 1000) : 0, stopReason };
  }

  generate(prompt: string, params: GenParams = {}, onToken?: (t: string) => boolean | void): Promise<GenStats> {
    return this.chat([{ role: "user", content: prompt }], params, onToken);
  }
}
