/**
 * Test fixtures built on the fly: SPDF 5.0 files written with SpdfWriter and legacy
 * 4.0/4.1 files built with the original Scholaris schema (Spanish names, gzip).
 * Texts are from Don Quijote (1605), public domain.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { SpdfWriter, type SqlEngine } from '../src/entry/node.js';

const here = new URL('./fixtures/', import.meta.url);

export const QUIJOTE = [
  'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.',
  'Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.',
  'Es, pues, de saber que este sobredicho hidalgo, los ratos que estaba ocioso, que eran los más del año, se daba a leer libros de caballerías con tanta afición y gusto.',
  'Con estas razones perdía el pobre caballero el juicio, y desvelábase por entenderlas y desentrañarles el sentido, que no se lo sacara ni las entendiera el mesmo Aristóteles.',
];

export const SHA = 'f'.repeat(64);

/** A small SPDF 5.0 file: 4 pages, 4 fragments, one f32 space and one i8 space, a blob. */
export async function buildQuijote50(options: { engine?: SqlEngine; contentHash?: boolean; signWith?: CryptoKey | Uint8Array } = {}): Promise<Uint8Array> {
  const w = await SpdfWriter.create(options.engine ? { engine: options.engine } : {});
  await w.setMeta('created', '2026-10-07T00:00:00Z');
  await w.setMeta('generator', 'spdf-format-tests/1');
  await w.setDocument({
    id: 'quijote-1605',
    kind: 'scanned_pdf',
    metadata: {
      type: 'book',
      title: 'El ingenioso hidalgo don Quijote de la Mancha',
      author: [{ family: 'Cervantes Saavedra', given: 'Miguel de' }],
      issued: { 'date-parts': [[1605]] },
      publisher: 'Juan de la Cuesta',
      'publisher-place': 'Madrid',
      language: 'es',
    },
    source_sha256: SHA,
    source_ref: 'blob:original',
    mime: 'application/pdf',
    bytes: 1234,
    created: '2026-10-07T00:00:00Z',
    updated: '2026-10-07T00:00:00Z',
    rights: { license: 'CC0-1.0', access: 'open' },
  });
  await w.addUnits(
    QUIJOTE.map((text, i) => ({
      id: `u${i + 1}`,
      anchor: { type: 'page' as const, physical: i + 1, printed: i === 0 ? null : `${i}`, foliation: 'page' as const, source: i === 3 ? ('inferred' as const) : ('read' as const), confidence: 0.97 },
      text,
      reader: 'pdf-text-layer',
      confidence: 0.99,
    })),
  );
  await w.addSections([{ id: 's1', level: 1, title: 'Capítulo primero', unit_from: 'u1', unit_to: 'u4' }]);
  await w.addFragments(
    QUIJOTE.map((text, i) => ({
      id: `f${i + 1}`,
      unit: `u${i + 1}`,
      text,
      context: 'Primera parte, capítulo I',
      section: ['Capítulo primero'],
      anchor: { type: 'page' as const, physical: i + 1, printed: i === 0 ? null : `${i}`, source: i === 3 ? ('inferred' as const) : ('read' as const), chars: [0, Array.from(text).length] as [number, number] },
      search_text: i === 3 ? 'mismo' : '',
    })),
  );
  const s1 = await w.addSpace({ provider: 'test', model: 'toy', dims: 4, modalities: ['text'], created: '2026-10-07T00:00:00Z' });
  const s2 = await w.addSpace({ provider: 'test', model: 'toy', dims: 4, dtype: 'i8', modalities: ['text'], created: '2026-10-07T00:00:00Z' });
  const vecs = [
    [1, 0, 0, 0],
    [0.6, 0.8, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0.8, 0.6],
  ];
  for (const s of [s1, s2]) await w.addVectors(s, vecs.map((v, i) => ({ target: 'fragment' as const, id: `f${i + 1}`, vector: v })));
  await w.addBlob('original', 'application/pdf', new TextEncoder().encode('%PDF-1.4 test'));
  await w.addProvenance({ stage: 'read', provider: 'local', model: 'pdf-text-layer', detail: { pages: 4 }, ms: 12, at: '2026-10-07T00:00:00Z' });
  return w.finish({ contentHash: options.contentHash ?? false, ...(options.signWith ? { signWith: options.signWith } : {}) });
}

/** A legacy 4.x file (gzip-wrapped SQLite with the Scholaris schema). */
export function buildLegacy(version: '4.0' | '4.1' = '4.1', options: { gzip?: boolean; extraSql?: string } = {}): Uint8Array {
  const schema = readFileSync(new URL(`legacy-v${version}.sql`, here), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(`PRAGMA user_version = ${version === '4.0' ? 400 : 410}`);
  const ins = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));
  ins("INSERT INTO spdf (clave, valor) VALUES ('spdf_version', ?)", version);
  ins("INSERT INTO spdf (clave, valor) VALUES ('creado', '2025-11-02T10:00:00.000Z')");
  ins("INSERT INTO spdf (clave, valor) VALUES ('generador', 'scholaris-nube/spdf 0.2')");
  const metadatos = {
    titulo: 'El ingenioso hidalgo don Quijote de la Mancha',
    subtitulo: 'Primera parte',
    autores: [{ nombre: 'Miguel de', apellidos: 'Cervantes Saavedra', orcid: '0000-0000-0000-0001' }],
    anio: 1605,
    editorial: 'Juan de la Cuesta',
    lugar: 'Madrid',
    idioma: 'es',
    procedencia: { titulo: { fuente: 'colofon', confianza: 0.98 } },
  };
  ins(
    `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, duracion, creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
     VALUES ('doc1', 'pdf_escaneado', ?, 'listo', ?, 'original.pdf', 'application/pdf', 999, 3, NULL, '2025-11-02T10:00:00.000Z', '2025-11-02T10:00:00.000Z', '["b1"]', ?, 'Cervantes Saavedra', 1605, 'es')`,
    JSON.stringify(metadatos),
    'e'.repeat(64),
    metadatos.titulo,
  );
  const words = version === '4.1' ? ', palabras' : '';
  for (let i = 0; i < 3; i++) {
    const ancla = { tipo: 'pagina', fisica: i + 1, impresa: i === 0 ? null : `${i}`, romana: false, origen: i === 2 ? 'deducido' : 'leido', confianza: 0.9 };
    ins(
      `INSERT INTO unidades (id, documento, orden, ancla, texto, notas, cabecera, pie, imagen, miniatura, lector, confianza, impresa, t0, t1${words})
       VALUES (?, 'doc1', ?, ?, ?, NULL, NULL, NULL, ?, '', 'gemini-3-flash', 0.95, ?, NULL, NULL${version === '4.1' ? ', NULL' : ''})`,
      `un${i}`,
      i,
      JSON.stringify(ancla),
      QUIJOTE[i] as string,
      i === 0 ? 'pagina-1.webp' : 'r2://imagenes/x.webp',
      ancla.impresa,
    );
    const busq = version === '4.1' ? ', texto_busqueda' : '';
    ins(
      `INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin${busq})
       VALUES (?, 'doc1', ?, ?, ?, 'Capítulo I', '["Capítulo primero"]', ?, NULL${version === '4.1' ? ", ''" : ''})`,
      `fr${i}`,
      `un${i}`,
      i,
      QUIJOTE[i] as string,
      JSON.stringify(ancla),
    );
  }
  ins("INSERT INTO secciones (id, documento, padre, nivel, titulo, unidad_desde, unidad_hasta, resumen) VALUES ('se1', 'doc1', NULL, 1, 'Capítulo primero', 'un0', 'un2', NULL)");
  ins("INSERT INTO figuras (id, documento, unidad, imagen, pie, descripcion, ancla) VALUES ('fi1', 'doc1', 'un0', 'pagina-1.webp', 'Portada', 'Grabado', ?)", JSON.stringify({ tipo: 'imagen', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }));
  ins("INSERT INTO espacios (id, proveedor, modelo, version, dims, normalizado, modalidades, creado) VALUES ('toy@2', 'test', 'toy', NULL, 2, 1, '[\"texto\"]', '2025-11-02T10:00:00.000Z')");
  const f32 = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);
  ins("INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('fragmento', 'fr0', 'toy@2', 'doc1', ?)", f32([1, 0]));
  ins("INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('fragmento', 'fr1', 'toy@2', 'doc1', ?)", f32([0, 1]));
  ins("INSERT INTO blobs (clave, mime, datos) VALUES ('pagina-1.webp', 'image/webp', ?)", new Uint8Array([82, 73, 70, 70]));
  ins("INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES ('doc1', 'lectura', 'gemini', '{\"paginas\":3}', 1500, '2025-11-02T10:00:00.000Z')");
  if (options.extraSql) db.exec(options.extraSql);
  const bytes = db.serialize();
  db.close();
  return options.gzip === false ? bytes : new Uint8Array(gzipSync(bytes));
}

/** Rewrites a 5.0 file with raw SQL (for invalid fixtures). */
export function mutate(bytes: Uint8Array, sql: string): Uint8Array {
  const db = new DatabaseSync(':memory:');
  db.deserialize(bytes);
  db.exec(sql);
  const out = db.serialize();
  db.close();
  return out;
}
