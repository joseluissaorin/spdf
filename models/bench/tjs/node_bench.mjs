// transformers.js in Node (onnxruntime-node). Prints one JSON line per embedded item.
// node node_bench.mjs --dtype q4 --device cpu --limit 0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as T from "@huggingface/transformers";
import { runBench, wavToFloat32 } from "./embed_core.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const dtype = args.dtype ?? "q4";
const device = args.device ?? "cpu";
const limit = Number(args.limit ?? 0);
const CACHE = process.env.SPDF_MODELS_CACHE ?? path.join(os.homedir(), ".cache", "spdf-models");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CORPUS = path.join(HERE, "..", "corpus");

T.env.localModelPath = CACHE + "/";
T.env.allowRemoteModels = false;
T.env.useFSCache = false;

const DOC = "title: none | text: ";
const QUERY = "task: search result | query: ";
let texts = fs.readFileSync(path.join(CORPUS, "texts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
let images = JSON.parse(fs.readFileSync(path.join(CORPUS, "images.json"), "utf8"));
let audio = JSON.parse(fs.readFileSync(path.join(CORPUS, "audio.json"), "utf8"));
if (limit) [texts, images, audio] = [texts.slice(0, limit), images.slice(0, limit), audio.slice(0, limit)];
const items = [
  ...texts.map((t) => ({ mod: "text", id: t.id, cls: "text_" + t.length, text: (t.kind === "query" ? QUERY : DOC) + t.text })),
  ...images.map((im) => ({ mod: "image", id: im.id, cls: "image", image: () => T.RawImage.read(path.join(CACHE, "bench-corpus", "images", im.file)) })),
  ...audio.map((a) => ({ mod: "audio", id: a.id, cls: "audio_10s", audio: async () => wavToFloat32(fs.readFileSync(path.join(CACHE, "bench-corpus", "audio", a.file))) })),
];
const { loadMs } = await runBench(T, {
  modelId: "onnx-community/embeddinggemma-2-ONNX", device, dtype, items,
  emit: (r) => process.stdout.write(JSON.stringify(r) + "\n"),
  log: (m) => process.stderr.write(m + "\n"),
});
process.stdout.write(JSON.stringify({ done: true, loadMs, versions: { transformers: T.env.version, node: process.version } }) + "\n");
