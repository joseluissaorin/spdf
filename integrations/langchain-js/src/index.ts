/**
 * Cargador de LangChain.js para SPDF: cada fragmento (o unidad) de un .spdf es
 * un Document con su texto literal y, en los metadatos, su cita con el folio
 * exacto (`citation`) y su URI de ancla (`anchor_uri`).
 */
import { Document } from '@langchain/core/documents';
import { BaseDocumentLoader } from '@langchain/core/document_loaders/base';
import { records, type SpdfLoadOptions } from './records.js';

export type { SpdfLoadOptions, SpdfMetadata, Locale } from './records.js';
export { records, recordsOf, spdfFiles } from './records.js';

export class SpdfLoader extends BaseDocumentLoader {
  /**
   * @param input Un fichero .spdf, una carpeta (se recorre) o una lista de ellos.
   * @param options granularity ('fragment' | 'unit'), locale ('en' | 'es'), recursive, embeddingsFrom
   *   (con un espacio, el vector guardado va en metadata.embedding; LangChain no tiene un campo propio).
   */
  constructor(readonly input: string | string[], readonly options: SpdfLoadOptions = {}) {
    super();
  }

  async *lazyLoad(): AsyncGenerator<Document> {
    for await (const r of records(this.input, this.options)) {
      yield new Document({ id: r.id, pageContent: r.text, metadata: r.embedding ? { ...r.metadata, embedding: r.embedding } : r.metadata });
    }
  }

  async load(): Promise<Document[]> {
    const out: Document[] = [];
    for await (const d of this.lazyLoad()) out.push(d);
    return out;
  }
}
