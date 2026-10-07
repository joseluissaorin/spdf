/**
 * What the plugin needs from an SPDF file, on top of `spdf-format`: open it safely,
 * turn its metadata into what Zotero imports, and remember its hash.
 */

import { MEDIA_TYPE, openSpdf, toCslJson, type CslItem, type SpdfDocument, type SqlEngine } from 'spdf-format/core';

export { MEDIA_TYPE };

/** File extension of SPDF files. */
export const EXTENSION = 'spdf';

/**
 * Opens an SPDF file read only (5.0, or legacy 4.x, gzip-wrapped or not). Throws what
 * a reader must refuse (E001, E002, E010, E020, E060) as an `SpdfError`.
 */
export function openDocument(path: string, engine: SqlEngine): Promise<SpdfDocument> {
  return openSpdf(path, { engine });
}

/**
 * The CSL-JSON item Zotero imports: the document's metadata without the `spdf`
 * extension (SPEC §19). For legacy 4.x files `spdf-format` has already mapped the
 * Spanish `MetadatosDocumento` to CSL-JSON (`mapLegacyMetadata`).
 */
export function cslForZotero(doc: SpdfDocument): CslItem {
  const csl = toCslJson(doc.document);
  // A conforming file always has a CSL type (E051). For one that does not, use the
  // generic type Zotero itself falls back to, rather than failing the import; nothing
  // else is filled in.
  if (typeof csl.type !== 'string' || !csl.type) csl.type = 'document';
  return csl;
}

/** The line kept in Zotero's Extra field so anchor URIs can be matched to the item later. */
export function spdfExtraLine(docref: string): string {
  return `SPDF: ${docref}`;
}

/** `extra` with the SPDF line added (once; other lines are kept as they are). */
export function withSpdfLine(extra: string | null | undefined, docref: string): string {
  const line = spdfExtraLine(docref);
  const current = (extra ?? '').replace(/\s+$/, '');
  if (current.split(/\r?\n/).some((l) => l.trim() === line)) return current;
  return current ? `${current}\n${line}` : line;
}

/** A short description of an error for a dialog: the SPDF code and message when there is one. */
export function describeError(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
