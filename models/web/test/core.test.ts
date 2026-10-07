import { describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { FakeEmbedder, checkCompat, isCompatible, mrl, taskPrefix, EMBEDDINGGEMMA2_TASK_PREFIXES, type Space, formatGemma4 } from "../src/core.js";
import { resizeBicubic, targetSize } from "../src/image.js";

const fx = (n: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

describe("prefixes and MRL", () => {
  it("uses EmbeddingGemma 2 prefixes", () => {
    expect(taskPrefix("query") + "x").toBe("task: search result | query: x");
    expect(taskPrefix("document") + "x").toBe("title: none | text: x");
    expect(taskPrefix("document", "Quijote")).toBe("title: Quijote | text: ");
  });
  it("renormalises after truncation", () => {
    const v = mrl([3, 4, 12], 2);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
});

describe("FakeEmbedder", () => {
  it("matches the Rust/Python vectors", async () => {
    for (const c of fx("fake.json")) {
      const [v] = await new FakeEmbedder(c.dims).embed([c.text]);
      c.vec.forEach((x: number, i: number) => expect(v[i]).toBeCloseTo(x, 6));
    }
  });
});

describe("compatibility rule", () => {
  const sp = (version: string, dims = 768, dtype: Space["dtype"] = "f32"): Space => ({
    id: `embeddinggemma-2@${dims}`, provider: "google", model: "embeddinggemma-2", version, dims, dtype, normalized: true,
    truncated_from: dims < 768 ? 768 : null, modalities: ["text"], task_prefixes: { ...EMBEDDINGGEMMA2_TASK_PREFIXES },
  });
  it("dtype may differ", () => expect(isCompatible(sp("914f7f89"), sp("914f7f89", 768, "i8"))).toBe(true));
  it("dims must match", () => expect(isCompatible(sp("914f7f89"), sp("914f7f89", 256))).toBe(false));
  it("engine variant is approximate", () => {
    expect(checkCompat(sp("914f7f89"), sp("914f7f89+q4")).kind).toBe("approximate");
    expect(isCompatible(sp("914f7f89"), sp("914f7f89+q4"))).toBe(false);
  });
});

describe("image preprocessing", () => {
  it("target sizes match transformers", () => {
    for (const s of fx("image.json").sizes) expect(targetSize(s.w, s.h)).toEqual(s.target);
  });
  it("bicubic resize is Pillow-exact", () => {
    const f = fx("image.json");
    const { w, h } = f.synthetic;
    const data = new Uint8Array(w * h * 3);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) data[k++] = (x * 7 + y * 13 + c * 101) % 256;
    for (const [size, want] of Object.entries(f.pillow_bicubic_sha256)) {
      const [tw, th] = size.split("x").map(Number);
      const r = resizeBicubic({ width: w, height: h, data }, tw, th);
      expect(crypto.createHash("sha256").update(r.data).digest("hex")).toBe(want);
    }
  });
});

describe("Gemma 4 chat format", () => {
  it("renders like the GGUF template", () => {
    expect(formatGemma4([{ role: "system", content: "SYS" }, { role: "user", content: "USER" }])).toBe(
      "<bos><|turn>system\nSYS<turn|>\n<|turn>user\nUSER<turn|>\n<|turn>model\n",
    );
  });
});
