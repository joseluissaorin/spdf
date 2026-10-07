// Valen-0.8B (Valen-Team, Apache 2.0) on onnxruntime-web: a native decision model.
// The prompt compiler is a port of Valen's shared-state compiler (models/valen/valen_onnx.py),
// checked token for token against the original on the SPDF judge pairs.

import type { InferenceSession, Tensor as OrtTensor } from "onnxruntime-web";

export type QuestionType = "choice" | "noul" | "score";
export interface Question {
  type: QuestionType;
  instructions: string;
  /** choice: {key: description}; score: ordered descriptions, lowest first; noul: unused. */
  criteria?: Record<string, string> | string[];
}
export interface DecisionRequest {
  state: string;
  questions: Record<string, Question>;
}
export interface Answer {
  type: QuestionType;
  probabilities?: Record<string, number>;
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
}

const NOUL: [string, string][] = [
  ["true", "True / 是：满足问题中的条件。"],
  ["false", "False / 否：不满足问题中的条件。"],
];

export function candidates(q: Question): [string, string][] {
  if (q.type === "noul") return NOUL;
  if (q.type === "choice") return Object.entries(q.criteria as Record<string, string>);
  return (q.criteria as string[]).map((t, i) => [String(i), t]);
}

/** Minimal tokenizer surface (transformers.js PreTrainedTokenizer fits). */
export interface ValenTokenizer {
  encode(text: string, opts: { add_special_tokens: boolean }): number[];
  tokenize(text: string, opts: { add_special_tokens: boolean }): string[];
  all_special_tokens: string[];
}

// GPT-2 byte-level alphabet: token characters -> byte counts
let BYTE_DECODER: Map<string, number> | undefined;
function byteDecoder(): Map<string, number> {
  if (BYTE_DECODER) return BYTE_DECODER;
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) {
    bs.push(b);
    cs.push(256 + n++);
  }
  BYTE_DECODER = new Map(cs.map((c, i) => [String.fromCodePoint(c), bs[i]]));
  return BYTE_DECODER;
}

const utf8 = new TextEncoder();

export interface Readout {
  qid: string;
  kind: QuestionType;
  keys: string[];
  context: [number, number];
  instruction: [number, number];
  candidates: [number, number][];
  decision: number;
}

export function compileRequest(tok: ValenTokenizer, req: DecisionRequest): { ids: number[]; readouts: Readout[] } {
  const special = tok.all_special_tokens.filter((t) => t.length > 1);
  const check = (s: string) => {
    for (const t of special) if (s.includes(t)) throw new Error(`reserved control token in input: ${t}`);
  };
  check(req.state);
  const base = tok.encode(`<|im_start|>user\n${req.state}<|im_end|>\n`, { add_special_tokens: false });
  const ids = base.slice();
  const dec = byteDecoder();
  const specialSet = new Set(special);
  const append = (text: string, span?: [number, number]): [number, number] | undefined => {
    const start = ids.length;
    const t = tok.encode(text, { add_special_tokens: false });
    ids.push(...t);
    if (!span) return undefined;
    // byte offsets of every token, from its byte-level string
    const pieces = tok.tokenize(text, { add_special_tokens: false });
    if (pieces.length !== t.length) throw new Error("tokenize/encode length mismatch");
    const s0 = utf8.encode(text.slice(0, span[0])).length;
    const s1 = utf8.encode(text.slice(0, span[1])).length;
    let off = 0;
    let first = -1, last = -1;
    pieces.forEach((p, i) => {
      const len = specialSet.has(p) ? utf8.encode(p).length : [...p].reduce((n, ch) => n + (dec.has(ch) ? 1 : utf8.encode(ch).length), 0);
      const a = off, b = off + len;
      if (a < s1 && b > s0) {
        if (first < 0) first = i;
        last = i;
      }
      off = b;
    });
    if (first < 0) throw new Error("empty token span for decision role");
    return [start + first, start + last + 1];
  };
  const readouts: Readout[] = [];
  append("<|im_start|>user\n");
  Object.entries(req.questions).forEach(([qid, q], index) => {
    check(q.instructions);
    const pairs = candidates(q);
    pairs.forEach(([k, d]) => (check(k), check(d)));
    const prefix = `Question ${index + 1}\nTask: ${q.type}\nQuestion: `;
    const instruction = append(prefix + q.instructions + "\nCandidates:\n", [prefix.length, prefix.length + q.instructions.length])!;
    const spans: [number, number][] = [];
    for (const [key, desc] of pairs) {
      const p = q.type !== "score" ? key + ": " : "";
      spans.push(append(p + desc, [p.length, p.length + desc.length])!);
      append("\n");
    }
    readouts.push({ qid, kind: q.type, keys: pairs.map(([k]) => k), context: [0, base.length], instruction, candidates: spans, decision: -1 });
  });
  append("<|im_end|>\n<|im_start|>assistant\n");
  readouts.forEach((r, index) => {
    append(`Question ${index + 1} Decision:`);
    r.decision = ids.length - 1;
    append("\n");
  });
  return { ids, readouts };
}

/** Role features [n_candidates, 4, hidden] for one question. */
export function features(h: Float32Array, hidden: number, r: Readout): Float32Array {
  const mean = (a: number, b: number, out: Float32Array, o: number) => {
    for (let t = a; t < b; t++) for (let j = 0; j < hidden; j++) out[o + j] += h[t * hidden + j];
    for (let j = 0; j < hidden; j++) out[o + j] /= b - a;
  };
  const n = r.candidates.length;
  const f = new Float32Array(n * 4 * hidden);
  const ctx = new Float32Array(hidden), ins = new Float32Array(hidden);
  mean(r.context[0], r.context[1], ctx, 0);
  mean(r.instruction[0], r.instruction[1], ins, 0);
  r.candidates.forEach(([a, b], i) => {
    const o = i * 4 * hidden;
    f.set(ctx, o);
    f.set(ins, o + hidden);
    mean(a, b, f, o + 2 * hidden);
    f.set(h.subarray(r.decision * hidden, (r.decision + 1) * hidden), o + 3 * hidden);
  });
  return f;
}

export function answer(kind: QuestionType, keys: string[], logits: ArrayLike<number>, temperature = 1): Answer {
  const z = Array.from(logits, (x) => x / temperature);
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  const p = e.map((x) => x / s);
  if (kind === "noul") return { type: kind, noul: p[keys.indexOf("true")] };
  const mode = p.indexOf(Math.max(...p));
  const probabilities = Object.fromEntries(keys.map((k, i) => [k, p[i]]));
  if (kind === "choice") {
    const confidence = p.length === 1 ? 1 : Math.max(0, (p[mode] - 1 / p.length) / (1 - 1 / p.length));
    return { type: kind, probabilities, choice: keys[mode], confidence };
  }
  const score = p.reduce((a, x, i) => a + i * x, 0);
  const dist = p.reduce((a, x, i) => a + x * Math.abs(i - mode), 0);
  const uniform = p.reduce((a, _x, i) => a + Math.abs(i - (p.length - 1) / 2), 0) / p.length;
  return { type: kind, probabilities, score, confidence: Math.max(0, 1 - dist / uniform) };
}

export interface ValenSessions {
  ort: typeof import("onnxruntime-web");
  backbone: InferenceSession;
  head: InferenceSession;
  tokenizer: ValenTokenizer;
  hidden?: number;
}

/** Runs one decision request (shared state: one backbone pass for all questions). */
export async function predict(s: ValenSessions, req: DecisionRequest, temperature = 1): Promise<{ answers: Record<string, Answer>; tokens: number }> {
  const hidden = s.hidden ?? 1024;
  const { ids, readouts } = compileRequest(s.tokenizer, req);
  const n = ids.length;
  const T = s.ort.Tensor;
  const feeds: Record<string, OrtTensor> = {
    input_ids: new T("int64", BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
    attention_mask: new T("int64", new BigInt64Array(n).fill(1n), [1, n]),
    position_ids: new T("int64", BigInt64Array.from({ length: 3 * n }, (_, i) => BigInt(i % n)), [3, 1, n]),
  };
  for (const name of s.backbone.inputNames) {
    if (feeds[name]) continue;
    // empty recurrent/conv states and KV cache (Qwen3.5-0.8B shapes; metadata when ORT exposes it)
    const meta = (s.backbone as unknown as { inputMetadata?: { name: string; shape?: (number | string)[] }[] }).inputMetadata?.find((m) => m.name === name);
    const known = name.startsWith("past_conv") ? [1, 6144, 4] : name.startsWith("past_recurrent") ? [1, 16, 128, 128] : [1, 2, 0, 256];
    const shape = meta?.shape ? (meta.shape.map((d) => (d === "batch_size" ? 1 : typeof d === "string" ? 0 : d)) as number[]) : known;
    feeds[name] = new T("float32", new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
  }
  const out = await s.backbone.run(feeds, ["hidden_states"]);
  const h = (await out.hidden_states.getData()) as Float32Array;
  const answers: Record<string, Answer> = {};
  for (const r of readouts) {
    const f = features(h, hidden, r);
    const res = await s.head.run({ features: new T("float32", f, [r.candidates.length, 4, hidden]) });
    answers[r.qid] = answer(r.kind, r.keys, (await res.logits.getData()) as Float32Array, temperature);
  }
  return { answers, tokens: n };
}
