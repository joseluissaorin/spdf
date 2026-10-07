// Shared transformers.js embedding loop, used by the Node bench and by the browser page.
// emit(record) receives {mod, id, cls, ms, ms_model, vec}.

export async function runBench(T, { modelId, device, dtype, items, emit, log = () => {}, noResize = false }) {
  const { AutoProcessor, AutoModel } = T;
  const t0 = performance.now();
  const processor = await AutoProcessor.from_pretrained(modelId);
  if (noResize) processor.image_processor.do_resize = false; // images arrive pre-resized (spdf-infer-web)
  const model = await AutoModel.from_pretrained(modelId, { device, dtype });
  const loadMs = performance.now() - t0;
  log(`loaded in ${loadMs.toFixed(0)} ms`);

  const embed = async (prep) => {
    const t = performance.now();
    const inputs = await prep();
    const tm = performance.now();
    const out = await model(inputs);
    const v = out.sentence_embedding.data; // already L2-normalized by the graph
    const vec = Array.from(v);
    const end = performance.now();
    return { vec, ms: end - t, ms_model: end - tm };
  };
  const prepFor = (it) => {
    if (it.mod === "text") return () => processor([it.text]);
    if (it.mod === "image") return async () => processor(null, [[await it.image()]]);
    return async () => processor(null, null, [await it.audio()]);
  };
  // warm-up once per modality
  for (const mod of ["text", "image", "audio"]) {
    const first = items.find((x) => x.mod === mod);
    if (first) await embed(prepFor(first));
  }
  for (const it of items) {
    const r = await embed(prepFor(it));
    emit({ mod: it.mod, id: it.id, cls: it.cls, ms: r.ms, ms_model: r.ms_model, vec: r.vec });
  }
  return { loadMs };
}

// Minimal WAV (PCM16 mono) reader -> Float32Array
export function wavToFloat32(buf) {
  const dv = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength);
  let off = 12;
  let fmt = null;
  while (off < dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") fmt = { channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    if (id === "data") {
      if (!fmt || fmt.bits !== 16 || fmt.channels !== 1) throw new Error("expected PCM16 mono WAV");
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(off + 8 + 2 * i, true) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}
