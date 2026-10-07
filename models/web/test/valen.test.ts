import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileRequest } from "../src/valen.js";

const cache = process.env.SPDF_MODELS_CACHE ?? path.join(os.homedir(), ".cache", "spdf-models");
const hasTok = fs.existsSync(path.join(cache, "valen-onnx", "tokenizer.json"));

describe.skipIf(!hasTok)("Valen compiler", () => {
  it("matches Valen's own compiler (fixtures)", async () => {
    const T = await import("@huggingface/transformers");
    T.env.localModelPath = cache + "/";
    T.env.allowRemoteModels = false;
    const tok = (await T.AutoTokenizer.from_pretrained("valen-onnx")) as never;
    const cases = JSON.parse(fs.readFileSync(new URL("./fixtures/valen_compile.json", import.meta.url), "utf8"));
    for (const c of cases) {
      const { ids, readouts } = compileRequest(tok, c.request);
      expect(ids).toEqual(c.ids);
      readouts.forEach((r, i) => {
        expect(r.instruction).toEqual(c.readouts[i].instruction);
        expect(r.candidates).toEqual(c.readouts[i].candidates);
        expect(r.decision).toBe(c.readouts[i].decision);
      });
    }
  });
});
