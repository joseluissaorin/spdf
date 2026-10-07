/**
 * De un SPDF a registros planos para un framework de recuperación: un registro
 * por fragmento (o por unidad), con el texto literal y, en los metadatos, su
 * ancla, su URI de ancla y su cita calculada por spdf-format. Así una respuesta
 * con recuperación puede citar la página impresa y no un número de trozo.
 *
 * Los metadatos son escalares (cadenas, números, booleanos): los almacenes de
 * vectores más comunes no aceptan objetos anidados. El ancla completa va como
 * JSON en `anchor`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSpdf, type Anchor, type SpdfDocument } from 'spdf-format';

export type Locale = 'en' | 'es';

export interface SpdfLoadOptions {
  /** Un registro por fragmento (por defecto) o por unidad (página, tramo de tiempo, diapositiva). */
  granularity?: 'fragment' | 'unit';
  /** Lengua de la cita corta: 'en' (por defecto) o 'es'. */
  locale?: Locale;
  /** Recorrer subcarpetas (por defecto, sí). */
  recursive?: boolean;
  /** Si se da un espacio (p. ej. 'all-MiniLM-L6-v2@384'), cada registro lleva el vector guardado de ese espacio. */
  embeddingsFrom?: string;
  /** Saltar (con un aviso por stderr) los ficheros que no se pueden abrir en vez de fallar. Por defecto, falla. */
  skipInvalid?: boolean;
}

export type SpdfMetadata = Record<string, string | number | boolean | null>;

export interface SpdfRecord {
  id: string;
  text: string;
  metadata: SpdfMetadata;
  embedding?: number[];
}

/** Los ficheros .spdf de una ruta (fichero o carpeta) o de una lista de rutas, en orden estable. */
export function spdfFiles(input: string | string[], recursive = true): string[] {
  const out: string[] = [];
  const walk = (p: string, depth: number) => {
    const st = statSync(p);
    if (st.isFile()) { out.push(p); return; }
    if (depth > 0 && !recursive) return;
    for (const f of readdirSync(p).sort()) {
      const q = join(p, f);
      if (f.startsWith('.')) continue;
      if (statSync(q).isDirectory()) walk(q, depth + 1);
      else if (f.toLowerCase().endsWith('.spdf')) out.push(q);
    }
  };
  for (const p of Array.isArray(input) ? input : [input]) walk(resolve(p), 0);
  return out;
}

function anclaPlana(a: Anchor): SpdfMetadata {
  const m: SpdfMetadata = { anchor_type: a.type };
  if (a.type === 'page') {
    m.physical_page = a.physical;
    m.printed_folio = a.printed ?? null;
    m.folio_inferred = a.source === 'inferred';
  } else if (a.type === 'time') {
    m.t0 = a.t0;
    m.t1 = a.t1;
    if (a.speaker) m.speaker = a.speaker;
  } else if (a.type === 'slide') {
    m.slide = a.n;
  } else if (a.type === 'verse') {
    m.line_from = a.line_from;
    if (a.line_to) m.line_to = a.line_to;
  } else if ((a.type === 'section') && a.printed) {
    m.printed_folio = a.printed;
  }
  return m;
}

/** Sin nulos: algunos almacenes de vectores (Chroma, por ejemplo) rechazan los valores nulos. */
function sinNulos(m: SpdfMetadata): SpdfMetadata {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined)) as SpdfMetadata;
}

/** Los registros de un documento ya abierto. `source` es la ruta o el nombre con que se citará el fichero. */
export async function* recordsOf(doc: SpdfDocument, source: string, o: SpdfLoadOptions = {}): AsyncGenerator<SpdfRecord> {
  const locale = o.locale ?? 'en';
  const d = doc.document;
  const meta = d.metadata;
  const authors = (meta.author ?? []).map((n) => n.literal ?? [n.given, n.family].filter(Boolean).join(' ')).filter(Boolean).join('; ');
  const comun: SpdfMetadata = {
    source,
    spdf_version: doc.legacy ? String(doc.version) : '5.0',
    spdf_doc_id: d.id,
    docref: doc.docref,
    title: meta.title ?? d.title ?? null,
    authors: authors || d.authors || null,
    year: d.year ?? null,
    language: d.language ?? null,
    kind: String(d.kind),
  };
  let vectores: Map<string, Float32Array> | null = null;
  if (o.embeddingsFrom) {
    const objetivo = o.granularity === 'unit' ? 'unit' : 'fragment';
    vectores = new Map((await doc.vectors(o.embeddingsFrom, objetivo)).map((v) => [v.id, v.vector]));
  }
  if (o.granularity === 'unit') {
    for (const u of await doc.units()) {
      const v = vectores?.get(u.id);
      yield {
        id: `${doc.docref}:${u.id}`,
        text: u.text,
        metadata: sinNulos({ ...comun, unit_id: u.id, ord: u.ord, ...anclaPlana(u.anchor), anchor: JSON.stringify(u.anchor), anchor_uri: doc.anchorUri(u.anchor), citation: doc.cite(u.anchor, locale), reader: u.reader, confidence: u.confidence }),
        ...(v ? { embedding: Array.from(v) } : {}),
      };
    }
    return;
  }
  for (const f of await doc.fragments()) {
    const v = vectores?.get(f.id);
    yield {
      id: `${doc.docref}:${f.id}`,
      text: f.text,
      metadata: sinNulos({
        ...comun, fragment_id: f.id, unit_id: f.unit, ord: f.ord, ...anclaPlana(f.anchor),
        section: (f.section ?? []).join(' / ') || null, context: f.context || null,
        anchor: JSON.stringify(f.anchor), anchor_end: f.anchor_end ? JSON.stringify(f.anchor_end) : null,
        anchor_uri: f.anchor_uri, citation: doc.cite(f.anchor, locale, f.anchor_end),
      }),
      ...(v ? { embedding: Array.from(v) } : {}),
    };
  }
}

/** Abre cada fichero, da sus registros y lo cierra. */
export async function* records(input: string | string[], o: SpdfLoadOptions = {}): AsyncGenerator<SpdfRecord> {
  for (const file of spdfFiles(input, o.recursive !== false)) {
    let doc: SpdfDocument;
    try {
      doc = await openSpdf(file);
    } catch (e) {
      if (!o.skipInvalid) throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
      process.stderr.write(`spdf: skipping ${file}: ${(e as Error).message}\n`);
      continue;
    }
    try {
      yield* recordsOf(doc, file, o);
    } finally {
      await doc.close();
    }
  }
}
