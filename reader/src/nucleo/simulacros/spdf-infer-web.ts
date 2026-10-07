/**
 * SIMULACRO de `spdf-infer-web` (paquete del agente «models», carpeta models/web).
 *
 * Misma API pública que fijó «models» el 7-10-2026 (ModelManager, Embedder,
 * FakeEmbedder, Generator, Judge, isCompatible), pero sin modelos de verdad:
 * - el catálogo lista los modelos reales con su tamaño, pero `download` falla
 *   con un mensaje claro (no hay nada que descargar en el simulacro);
 * - `FakeEmbedder` sí funciona: vectores deterministas por hashing de palabras,
 *   espacio `spdf-fake@<dims>`, útiles para las pruebas de extremo a extremo;
 * - el generador y el juez falsos son extractivos y léxicos.
 * vite.config.ts lo sustituye por models/web/dist en cuanto exista.
 */

export type Task = 'query' | 'document' | 'question_answering' | 'fact_checking' | 'classification' | 'clustering' | 'similarity' | 'code_retrieval' | 'raw';
export type Kind = 'embed' | 'generate' | 'judge';

export interface Space {
  id: string; provider: string; model: string; version: string | null; dims: number; dtype: 'f32';
  normalized: boolean; truncated_from: number | null; modalities: string[];
  task_prefixes: { query?: string; document?: string } | null;
}

export interface CatalogEntry { id: string; name: string; kind: Kind; bytes: number; license: string; modalities: string[]; engine: string }

const CATALOGO: CatalogEntry[] = [
  { id: 'embeddinggemma-2-onnx-q4f16', name: 'EmbeddingGemma 2 (texto, q4f16)', kind: 'embed', bytes: 157_000_000, license: 'Apache-2.0', modalities: ['text'], engine: 'transformers.js' },
  { id: 'gemma-4-e2b-it-web', name: 'Gemma 4 E2B (web)', kind: 'generate', bytes: 1_400_000_000, license: 'Apache-2.0', modalities: ['text'], engine: 'mediapipe' },
];

export class ModelManager {
  constructor(_o: { store?: 'opfs' | 'cache' } = {}) {}
  catalog(): CatalogEntry[] { return CATALOGO; }
  recommend(kind: Kind): CatalogEntry | undefined { return CATALOGO.find((c) => c.kind === kind); }
  async download(_id: string, _p?: (p: { file: string; done: number; total: number }) => void): Promise<void> {
    throw new Error('Simulacro de spdf-infer-web: no hay modelos que descargar todavía (falta models/web compilado).');
  }
  async isDownloaded(_id: string) { return false; }
  async delete(_id: string) {}
}

/* FNV-1a de 32 bits. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class FakeEmbedder {
  constructor(private readonly base = 768) {}
  get dims() { return this.base; }
  static async load() { return new FakeEmbedder(); }
  space(dims = this.base): Space {
    return { id: `spdf-fake@${dims}`, provider: 'spdf', model: 'spdf-fake', version: '1', dims, dtype: 'f32', normalized: true, truncated_from: dims === this.base ? null : this.base, modalities: ['text'], task_prefixes: null };
  }
  async embed(texts: string[], o: { task?: Task; dims?: number } = {}): Promise<Float32Array[]> {
    const dims = o.dims ?? this.base;
    return texts.map((t) => {
      const v = new Float32Array(dims);
      const pal = t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      for (const p of pal) {
        if (p.length < 3) continue;
        const h = fnv(p);
        v[h % dims] += h & 1 ? 1 : -1;
        const h2 = fnv(p.slice(0, 5));
        v[h2 % dims] += 0.5;
      }
      let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
      for (let i = 0; i < dims; i++) v[i] /= n;
      return v;
    });
  }
}

export class Embedder {
  static async load(id: string, _o: unknown = {}): Promise<FakeEmbedder> {
    if (id === 'spdf-fake') return new FakeEmbedder();
    throw new Error(`Simulacro de spdf-infer-web: el modelo «${id}» no está disponible.`);
  }
}

/** Generador falso: devuelve en JSON la primera frase del primer pasaje que reciba. */
export class Generator {
  static async load(_id: string, _o: unknown = {}) { return new Generator(); }
  async generate(prompt: string, _p: unknown, onToken?: (t: string) => boolean | void): Promise<{ text: string }> {
    const m = /\[(P\d+)\][^\n]*\n([^\n]+)/.exec(prompt);
    const frase = m ? (m[2].match(/[^.;:]+[.;:]/)?.[0] ?? m[2]).trim() : '';
    const text = m ? JSON.stringify({ respuesta: [{ afirmacion: frase, pasaje: m[1], cita_literal: frase }] }) : '{"respuesta":[]}';
    for (const t of text.match(/.{1,12}/g) ?? []) onToken?.(t);
    return { text };
  }
}

/** Juez falso: proporción de palabras de la afirmación que están en el pasaje. */
export class Judge {
  static async load(_id?: string, _o: unknown = {}) { return new Judge(); }
  async support(claim: string, passage: string) {
    const pal = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const a = pal(claim), b = pal(passage);
    let c = 0; for (const x of a) if (b.has(x)) c++;
    const s = a.size ? c / a.size : 0;
    return { label: s > 0.6 ? 'APOYO_DIRECTO' : 'CONTEXTO', supported: s, probs: [] };
  }
}

/** Regla del contrato (§2): mismos provider, model, version, dims, normalized, truncated_from y task_prefixes. */
export function isCompatible(a: Partial<Space>, b: Partial<Space>): boolean {
  const n = (x: unknown) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x);
  return a.provider === b.provider && a.model === b.model && n(a.version) === n(b.version) && a.dims === b.dims &&
    n(a.normalized) === n(b.normalized) && n(a.truncated_from) === n(b.truncated_from) &&
    JSON.stringify(a.task_prefixes ?? null) === JSON.stringify(b.task_prefixes ?? null);
}
