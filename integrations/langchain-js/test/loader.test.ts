/**
 * Pruebas del cargador de LangChain.js con los ficheros de integrations/fixtures:
 * el texto literal, la cita y la URI en los metadatos, las unidades, los
 * vectores guardados y un recuperador de LangChain que conserva la cita.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Document } from '@langchain/core/documents';
import { VectorStore } from '@langchain/core/vectorstores';
import { SyntheticEmbeddings } from '@langchain/core/utils/testing';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { parseAnchorUri } from 'spdf-format';
import { SpdfLoader } from '../src/index.js';

const FIX = resolve(__dirname, '../../fixtures');
const EN = resolve(FIX, 'spdf-in-five-pages.spdf');
const ES = resolve(FIX, 'spdf-en-cinco-paginas.spdf');

/** Un almacén de vectores mínimo en memoria, para probar la integración con los recuperadores de LangChain. */
class Memoria extends VectorStore {
  private filas: { v: number[]; d: Document }[] = [];
  _vectorstoreType() { return 'memoria'; }
  constructor(e: EmbeddingsInterface) { super(e, {}); }
  async addVectors(vs: number[][], ds: Document[]) { vs.forEach((v, i) => this.filas.push({ v, d: ds[i]! })); }
  async addDocuments(ds: Document[]) { await this.addVectors(await this.embeddings.embedDocuments(ds.map((d) => d.pageContent)), ds); }
  async similaritySearchVectorWithScore(q: number[], k: number): Promise<[Document, number][]> {
    const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0) / (Math.hypot(...a) * Math.hypot(...b));
    return this.filas.map((f) => [f.d, cos(q, f.v)] as [Document, number]).sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}

describe('SpdfLoader', () => {
  it('un Document por fragmento, con el texto literal y la cita', async () => {
    const docs = await new SpdfLoader(EN).load();
    expect(docs).toHaveLength(8);
    const d = docs[0]!;
    expect(d.pageContent).toMatch(/^A document that has been read well/);
    expect(d.metadata).toMatchObject({
      citation: '(Saorín Ferrer, 2026, p. 1)', physical_page: 2, printed_folio: '1', folio_inferred: false,
      title: 'SPDF in five pages', authors: 'José Luis Saorín Ferrer', year: 2026, kind: 'pdf', language: 'en', section: 'I. Anchors',
    });
    expect(d.id).toMatch(/^sha256-[0-9a-f]{64}:f2-1$/);
    const p = parseAnchorUri(String(d.metadata.anchor_uri));
    expect(p.locator).toMatchObject({ p: 2, f: '1' });
    for (const x of docs) for (const v of Object.values(x.metadata)) expect(['string', 'number', 'boolean'].includes(typeof v)).toBe(true);
  });

  it('el folio deducido de la lámina va entre corchetes', async () => {
    const docs = await new SpdfLoader(EN).load();
    const lamina = docs.find((d) => d.metadata.physical_page === 4)!;
    expect(lamina.metadata.citation).toBe('(Saorín Ferrer, 2026, p. [3])');
    expect(lamina.metadata.folio_inferred).toBe(true);
  });

  it('en castellano, una carpeta entera y por unidades', async () => {
    const es = await new SpdfLoader(ES, { locale: 'es', granularity: 'unit' }).load();
    expect(es).toHaveLength(6);
    expect(es[0]!.metadata.citation).toBe('(Saorín Ferrer, 2026, s. p.)');
    expect(es[1]!.metadata.citation).toBe('(Saorín Ferrer, 2026, p. 1)');
    await expect(new SpdfLoader(FIX).load()).rejects.toThrow(/roto\.spdf/);
    const carpeta = await new SpdfLoader(FIX, { locale: 'es', skipInvalid: true }).load();
    expect(carpeta).toHaveLength(16);
  });

  it('una lista de ficheros válidos y los vectores guardados', async () => {
    const docs = await new SpdfLoader([EN, ES], { embeddingsFrom: 'all-MiniLM-L6-v2@384' }).load();
    expect(docs).toHaveLength(16);
    expect((docs[0]!.metadata.embedding as number[]).length).toBe(384);
  });

  it('el fichero roto se rechaza con un error claro', async () => {
    await expect(new SpdfLoader(resolve(FIX, 'roto.spdf')).load()).rejects.toThrow(/view|trigger|E020|unsafe/i);
  });

  it('un recuperador de LangChain devuelve los pasajes con su cita', async () => {
    const docs = await new SpdfLoader(EN, { embeddingsFrom: 'all-MiniLM-L6-v2@384' }).load();
    // Con los vectores guardados: la consulta es el vector de un fragmento y el primero es él mismo.
    const tienda = new Memoria(new SyntheticEmbeddings({ vectorSize: 384 }));
    await tienda.addVectors(docs.map((d) => d.metadata.embedding as number[]), docs.map((d) => new Document({ ...d, metadata: { ...d.metadata, embedding: null } })));
    const objetivo = docs[5]!;
    const [primero] = await tienda.similaritySearchVectorWithScore(objetivo.metadata.embedding as number[], 3);
    expect(primero![0].metadata.citation).toBe(objetivo.metadata.citation);
    // Con unos vectores de prueba: el recuperador funciona y la cita viaja con el documento.
    const sintetico = new Memoria(new SyntheticEmbeddings({ vectorSize: 32 }));
    await sintetico.addDocuments(docs.map((d) => new Document({ pageContent: d.pageContent, metadata: { citation: d.metadata.citation, anchor_uri: d.metadata.anchor_uri } })));
    const res = await sintetico.asRetriever(2).invoke('conformance suite');
    expect(res).toHaveLength(2);
    for (const r of res) expect(String(r.metadata.citation)).toMatch(/^\(Saorín Ferrer, 2026, p\. \[?\d\]?\)$/);
  });
});
