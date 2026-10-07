# RFC 0003: Vector spaces, engines and quantization

- **Status**: Draft (from the models agent, for the spec agent)
- **Authors**: models agent, on behalf of José Luis Saorín Ferrer <jl@joseluissaorin.com>
- **Created**: 2026-10-07
- **Discussion**: this file; data in `models/INFORME.md`, rule in `models/COMPATIBILIDAD.md`
- **Specification**: SPDF 5.0 (clarifications, additive) and 5.1 (optional `i8` scale)
- **Affects**: `spec/SPEC.md` §2 (spaces, vectors), conformance (a new kind of case, optional)
- **Conformance cases**: proposed `space_compat` (see below); none changed
- **Supersedes / superseded by**: none
- **Decision**: pending

*The task brief asked for `0002-espacios-y-cuantizacion.md`; 0002 was taken when this was
written, so it takes the next free number.*

## Summary

The contract already says when two spaces are compatible (same provider, model, version,
dims, normalized, truncated_from and task_prefixes; the storage dtype may differ). What it
does not say is what goes into `version` when the same checkpoint runs on different engines
and quantizations, and those engines do not produce the same vectors. We measured six engines
and fifteen weight formats of EmbeddingGemma 2 on a public-domain corpus and propose: one
measurable rule for "same space", a `+variant` suffix for close-but-not-equal engines, a
canonical `task_prefixes` value, normative image preprocessing, and a note on `i8` storage.

## Motivation

A reader computes the query vector with whatever engine it has (llama.cpp on a laptop,
transformers.js in a browser) and compares it with vectors a producer computed elsewhere.
Measured against the reference (sentence-transformers, f32), on 290 passages and 40 queries in
16 languages, 54 images and 24 audio clips:

- 8-bit and wider formats (GGUF Q8_0 and BF16, ONNX fp32/fp16/q8, MLX bf16/8-bit) stay at mean
  cosine ≥ 0.9987 and 5th percentile ≥ 0.9961 in every modality: interchangeable.
- 4-bit formats (ONNX q4/q4f16, MLX 4-bit) fall to mean ≤ 0.982 and p5 ≤ 0.975; mixing a 4-bit
  query with an 8-bit corpus changes 5–12 % of the top-10 results. Comparable, not equal.
- The biggest error is not quantization but image preprocessing: llama.cpp resizing images
  itself gives mean 0.980 / p5 0.960; transformers.js resizing itself, 0.996 / 0.988.
- Storage in `i8` as defined (`q = round(v·127)`) loses more than a good 8-bit engine:
  cosine 0.998 and top-10 overlap 0.97 at 768 dims; `f16` is exact for practical purposes.

Without a rule, two producers could write the same `version` for vectors that do not match,
and a reader could not tell.

## Proposal (normative text for SPEC.md)

### 1. Same space

> A producer MUST write in `spaces.version` an identifier of the model checkpoint (for
> EmbeddingGemma 2, the first 8 hex digits of the Hugging Face revision: `914f7f89`). It MAY
> write that bare identifier only if its engine, weights and preprocessing, on the SPDF
> compatibility corpus, give for every declared modality a mean cosine ≥ 0.999 and a 5th
> percentile ≥ 0.995 with the reference vectors of that checkpoint, at the stored `dims`.

### 2. Approximate variants

> An engine that misses §1 but reaches mean ≥ 0.97 and 5th percentile ≥ 0.95 MUST append
> `+<variant>` to the identifier (`914f7f89+q4`). Under the compatibility rule this is a
> different space. A reader MAY compare across variants of one checkpoint only after warning
> the user, and SHOULD re-embed the query with an engine of the stored space when it can.
> Below those thresholds it is a different model and MUST use a different `model`.

### 3. Task prefixes

> For EmbeddingGemma 2 retrieval spaces, `task_prefixes` MUST be
> `{"document":"title: {title} | text: ","query":"task: search result | query: "}`, where
> `{title}` is the document title or `none`. Other prefixes declare a different space.

### 4. Image preprocessing

> Image vectors of EmbeddingGemma 2 spaces MUST be computed on images resized to the largest
> size that keeps the aspect ratio within 280 vision tokens (sides multiple of 48 px,
> `get_aspect_ratio_preserving_size` of the reference processor) with antialiased bicubic
> resampling as Pillow implements it, and the engine MUST NOT resize again. Another token
> budget is a variant (`+img560`).

(spdf-infer and spdf-infer-web implement it, bit-exact with Pillow, with tests.)

### 5. Storage dtype

> `f16` storage is lossless for retrieval purposes and is RECOMMENDED when size matters.
> `i8` storage (value `q/127`) is lossy for unit vectors with many dimensions (cosine ≈ 0.998
> at 768 dims) and producers SHOULD avoid it for spaces above 256 dims.

Optional for 5.1: an `i8_scale` column in `spaces` (value `q·i8_scale/127`; for EmbeddingGemma 2
at 768 dims the 99.9th percentile of |v|, ≈ 0.30) raises the cosine to 0.9996. Not needed if
`f16` is the recommended compact form.

### 6. Matryoshka

No change: a truncated space is `model@dims` with `truncated_from`; vectors of different `dims`
are never compared. Measured: every compatible engine stays compatible at 512, 256 and 128.

## Conformance

Optional new kind `space_compat`: the compatibility corpus manifest (texts in the repository;
images and audio by URL and SHA-256) and the reference vectors of `embeddinggemma-2@914f7f89`
(f32, about 1.25 MB). An implementation that ships an embedder runs it and reports the six
numbers (mean and p5 per modality). Everything needed is in `models/bench`; the spec agent
decides whether it belongs in `conformance/` or stays a recommendation.

## Drawbacks

The thresholds are empirical, from one model and one corpus. Another model may need others;
the rule is written per model checkpoint so each can carry its own.

## Alternatives

- Put the engine and quantization in `model` (for example `embeddinggemma-2-q8`): rejected,
  it would split spaces that are measurably identical.
- Rely on `dtype`: it describes storage, not the engine that produced the values.

## Unresolved questions

- Whether `space_compat` becomes a conformance kind.
- Reference vectors for Gemini embedding spaces (no local reference exists).
