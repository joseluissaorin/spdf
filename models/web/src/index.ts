// spdf-infer-web: the browser twin of the spdf-infer crate.
export * from "./core.js";
export { ModelManager, WEB_ENGINES, type CatalogEntry, type FileEntry, type Manifest, type Progress, type ManagerOptions } from "./manager.js";
export { Embedder, webgpuAvailable, useManagerCache, type EmbedderOptions, type Device } from "./embed.js";
export { Generator, type GenParams, type GenStats, type GeneratorOptions } from "./generate.js";
export {
  Judge,
  RELATIONS,
  RELATION_DESCRIPTIONS,
  RELEVANCE_LABELS,
  pairContent,
  type Label,
  type Calibration,
  type Relation,
  type Support,
  type SourceInfo,
  type JudgeOptions,
} from "./judge.js";
export { compileRequest, features, answer, predict, candidates, type DecisionRequest, type Question, type Answer } from "./valen.js";
export { targetSize, resizeBicubic, preprocessImage, type RGBImage } from "./image.js";
