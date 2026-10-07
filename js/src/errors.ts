/** Validation and error codes of SPDF 5.0 (contract §12). */
export const CODES = {
  E001: 'not SQLite',
  E002: 'unknown application_id or version',
  E003: 'gzip-wrapped 5.0',
  E010: 'missing required table',
  E011: 'missing required column',
  E012: 'missing spdf_meta key',
  E013: 'documents must hold exactly one row',
  E020: 'trigger or view present',
  E030: 'vector length does not match dims × dtype size',
  E031: 'vector space unknown',
  E032: 'unknown dtype',
  E040: 'invalid anchor JSON',
  E041: 'unknown anchor type',
  E042: 'chars out of range',
  E050: 'invalid metadata JSON',
  E051: 'metadata is not CSL-like',
  E060: 'unknown required extension',
  E070: 'FTS index out of sync',
  E080: 'blob sha256 mismatch',
  E081: 'content_sha256 mismatch',
  E082: 'bad signature',
  E090: 'units.ord not contiguous from 1',
  W100: "profile 'semantic' without vectors",
  W101: "profile 'media' without time anchors",
  W102: 'unit_count differs from the number of units',
  W105: 'newer minor version',
  W110: 'legacy 4.x file',
} as const;

export type SpdfErrorCode = keyof typeof CODES | `W${number}` | 'E000';

/** An error with an SPDF code (`E001`…), raised when a file cannot be opened safely. */
export class SpdfError extends Error {
  override readonly name = 'SpdfError';
  constructor(
    readonly code: SpdfErrorCode,
    message: string,
    readonly where?: string,
  ) {
    super(`${code}: ${message}`);
  }
}
