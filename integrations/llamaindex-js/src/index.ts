/**
 * Lector de LlamaIndex.TS para SPDF: cada fragmento (o unidad) de un .spdf es
 * un Document con su texto literal y, en los metadatos, su cita con el folio
 * exacto (`citation`) y su URI de ancla (`anchor_uri`). La cita queda visible
 * para el modelo; el ancla en JSON y las huellas no entran en el texto que se
 * convierte en vectores.
 */
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { Document, FileReader } from '@llamaindex/core/schema';
import { openSpdf } from 'spdf-format';
import { records, recordsOf, type SpdfLoadOptions, type SpdfRecord } from './records.js';

export type { SpdfLoadOptions, SpdfMetadata, Locale } from './records.js';
export { records, recordsOf, spdfFiles } from './records.js';

/** Metadatos que no deben pesar en los vectores (largos o sin significado para el sentido del texto). */
export const EXCLUDED_EMBED_METADATA = ['source', 'spdf_doc_id', 'docref', 'anchor', 'anchor_end', 'anchor_uri', 'spdf_version', 'unit_id', 'fragment_id', 'ord', 'anchor_type', 'folio_inferred', 'physical_page', 'reader', 'confidence'];
/** Metadatos que el modelo no necesita ver al responder; la cita, el título y la sección sí los ve. */
export const EXCLUDED_LLM_METADATA = ['source', 'spdf_doc_id', 'docref', 'anchor', 'anchor_end', 'spdf_version', 'unit_id', 'ord', 'anchor_type', 'reader', 'confidence'];

function aDocumento(r: SpdfRecord): Document {
  return new Document({
    id_: r.id,
    text: r.text,
    metadata: r.metadata,
    excludedEmbedMetadataKeys: EXCLUDED_EMBED_METADATA,
    excludedLlmMetadataKeys: EXCLUDED_LLM_METADATA,
    ...(r.embedding ? { embedding: r.embedding } : {}),
  });
}

export class SpdfReader extends FileReader<Document> {
  /**
   * @param options granularity ('fragment' | 'unit'), locale ('en' | 'es'), recursive, skipInvalid,
   *   embeddingsFrom (un espacio: Document.embedding sale del fichero y no hay que volver a calcularlo
   *   si el modelo de la consulta es el mismo).
   */
  constructor(readonly options: SpdfLoadOptions = {}) {
    super();
  }

  /** Para SimpleDirectoryReader y para quien ya tenga los bytes. */
  async loadDataAsContent(fileContent: Uint8Array, filename = 'document.spdf'): Promise<Document[]> {
    const doc = await openSpdf(fileContent);
    try {
      const out: Document[] = [];
      for await (const r of recordsOf(doc, basename(filename), this.options)) out.push(aDocumento(r));
      return out;
    } finally {
      await doc.close();
    }
  }

  /** Un fichero, una carpeta (se recorre) o una lista de ellos. */
  override async loadData(input: string | string[]): Promise<Document[]> {
    const out: Document[] = [];
    for await (const d of this.lazyLoadData(input)) out.push(d);
    return out;
  }

  async *lazyLoadData(input: string | string[]): AsyncGenerator<Document> {
    for await (const r of records(input, this.options)) yield aDocumento(r);
  }
}

/** Atajo: ¿es esta ruta un fichero .spdf? (para registrar el lector por extensión). */
export const isSpdf = (p: string) => p.toLowerCase().endsWith('.spdf') && statSync(p, { throwIfNoEntry: false })?.isFile() === true;
