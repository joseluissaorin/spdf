/**
 * Pruebas del lector de LlamaIndex.TS con los ficheros de integrations/fixtures:
 * documentos con su cita, vectores guardados, un VectorStoreIndex con un modelo
 * de vectores falso y un recuperador que devuelve los nodos con su cita.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BaseEmbedding } from '@llamaindex/core/embeddings';
import { MetadataMode } from '@llamaindex/core/schema';
import { Settings, VectorStoreIndex } from 'llamaindex';
import { SpdfReader } from '../src/index.js';

const FIX = resolve(__dirname, '../../fixtures');
const EN = resolve(FIX, 'spdf-in-five-pages.spdf');
const ES = resolve(FIX, 'spdf-en-cinco-paginas.spdf');

/** Vectores de juguete deterministas: bolsa de letras normalizada (sin red ni claves). */
class Letras extends BaseEmbedding {
  async getTextEmbedding(t: string): Promise<number[]> {
    const v = new Array(26).fill(0);
    for (const c of t.toLowerCase().normalize('NFD')) { const i = c.charCodeAt(0) - 97; if (i >= 0 && i < 26) v[i] += 1; }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
}

describe('SpdfReader', () => {
  it('documentos por fragmento con su cita y su URI', async () => {
    const docs = await new SpdfReader().loadData(EN);
    expect(docs).toHaveLength(8);
    expect(docs[0]!.metadata).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 1)', printed_folio: '1', physical_page: 2, section: 'I. Anchors' });
    expect(docs[0]!.id_).toMatch(/^sha256-[0-9a-f]{64}:f2-1$/);
    expect(docs.find((d) => d.metadata.physical_page === 4)!.metadata.citation).toBe('(Saorín Ferrer, 2026, p. [3])');
  });

  it('el modelo ve la cita; los vectores no ven el ancla en JSON', async () => {
    const [d] = await new SpdfReader().loadData(EN);
    expect(d!.getContent(MetadataMode.LLM)).toContain('citation: (Saorín Ferrer, 2026, p. 1)');
    expect(d!.getContent(MetadataMode.EMBED)).not.toContain('anchor_uri');
    expect(d!.getContent(MetadataMode.EMBED)).not.toContain('"physical"');
  });

  it('desde bytes (SimpleDirectoryReader), en castellano y por unidades', async () => {
    const r = new SpdfReader({ locale: 'es', granularity: 'unit' });
    const docs = await r.loadDataAsContent(new Uint8Array(readFileSync(ES)), 'spdf-en-cinco-paginas.spdf');
    expect(docs).toHaveLength(6);
    expect(docs[0]!.metadata.citation).toBe('(Saorín Ferrer, 2026, s. p.)');
    expect(docs[0]!.metadata.source).toBe('spdf-en-cinco-paginas.spdf');
  });

  it('carpetas, ficheros rotos y vectores guardados', async () => {
    await expect(new SpdfReader().loadData(FIX)).rejects.toThrow(/roto\.spdf/);
    const docs = await new SpdfReader({ skipInvalid: true, embeddingsFrom: 'all-MiniLM-L6-v2@384' }).loadData(FIX);
    expect(docs).toHaveLength(16);
    expect(docs.every((d) => d.embedding?.length === 384)).toBe(true);
  });

  it('un VectorStoreIndex recupera nodos que conservan su cita', async () => {
    Settings.embedModel = new Letras();
    const docs = await new SpdfReader().loadData([EN]);
    const index = await VectorStoreIndex.fromDocuments(docs);
    const nodos = await index.asRetriever({ similarityTopK: 3 }).retrieve('conformance suite implementations');
    expect(nodos).toHaveLength(3);
    for (const n of nodos) expect(String(n.node.metadata.citation)).toMatch(/^\(Saorín Ferrer, 2026, p\. \[?\d\]?\)$/);
  });
});
