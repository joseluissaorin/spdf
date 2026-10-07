/**
 * spdf-format: SPDF (Semantic Processed Document Format) for JavaScript and TypeScript.
 *
 * This is the platform-agnostic core (`spdf-format/core`). The platform entry points
 * (`spdf-format`, `spdf-format/node`, `spdf-format/bun`, `spdf-format/browser`) export the
 * same API and register their SQLite engine.
 */

export { VERSION } from './version.js';
export type { SqlConnection, SqlEngine, SqlRow, SqlValue, EngineOpenOptions, RandomAccessSource, SourceStats } from './port.js';
export { setDefaultEngine, resolveEngine } from './port.js';
export { SpdfError, CODES, type SpdfErrorCode } from './errors.js';
export * from './types.js';
export {
  SPDF_VERSION,
  APPLICATION_ID,
  USER_VERSION,
  MEDIA_TYPE,
  SCHEMA_50,
  SCHEMA_50_TRIGRAM,
  COLUMNS,
  REQUIRED_META,
  PROFILES,
  KINDS,
  type Profile,
  type TableName,
} from './schema.js';
export {
  openSpdf,
  openRaw,
  SpdfDocument,
  DEFAULT_MAX_BLOB_BYTES,
  DEFAULT_MAX_DECOMPRESSED_BYTES,
  type OpenOptions,
  type SpdfInput,
  type FragmentWithUri,
  type RawOpen,
} from './document.js';
export { dump, dumpDocument, type CanonicalDump } from './dump.js';
export { validate, type ValidationReport, type ValidationIssue, type ValidateOptions } from './validate.js';
export {
  searchLexical,
  searchVector,
  searchHybrid,
  parseQuery,
  matchExpression,
  type SearchHit,
  type VectorHit,
  type LexicalOptions,
  type VectorOptions,
  type HybridOptions,
  type ParsedQuery,
} from './search.js';
export {
  formatAnchorUri,
  parseAnchorUri,
  formatLocator,
  anchorToLocator,
  locatorToAnchor,
  docrefOf,
  checkAnchor,
  codePointLength,
  pctEncode,
  pctDecode,
  type AnchorLocator,
  type ParsedAnchorUri,
  type AnchorProblem,
} from './anchors.js';
export { cite, locator, namesPart, yearPart, formatTime, shortTitle } from './cite.js';
export { toCslJson, toBibtex, citationKey, bibEscape, type CslExportOptions } from './bib.js';
export { SpdfWriter, convertLegacy, authorsColumn } from './writer.js';
export type { WriterOptions, DocumentInput, UnitInput, SectionInput, FragmentInput, FigureInput, SpaceInput, VectorInput, ProvenanceInput, FinishOptions } from './writer.js';
export {
  contentSha256,
  contentSha256OfDump,
  verifyIntegrity,
  verifySignature,
  signContentHash,
  verifyContentHash,
  generateSigningKey,
  signerOf,
  importPrivateKey,
  importPublicKey,
  SIGNATURE_DOMAIN,
  type IntegrityReport,
} from './integrity.js';
export { encodeVector, decodeVector, f16ToNumber, numberToF16, dot, cosine, normalize as normalizeVector, dtypeSize } from './vectors.js';
export { canonicalJson, canonicalize, round6 } from './canonical.js';
export { mapLegacyAnchor, mapLegacyMetadata, mapLegacyKind } from './legacy.js';
export { isGzip, isSqlite, sha256Hex, gunzipWeb, gzipWeb, toHex, fromHex, toBase64, fromBase64 } from './bytes.js';
export { BytesSource, BlobSource, HttpRangeSource, RangeSource, RangeNotSupportedError, xhrTransport, type HttpSourceOptions, type RangeTransport, type RangeSourceStats } from './sources.js';
