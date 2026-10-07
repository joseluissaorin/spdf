/**
 * SIMULACRO de `spdf-format/browser` (paquete del agente «js», carpeta js/).
 *
 * Existe solo para que el lector se pueda construir y probar mientras la
 * biblioteca real no esté compilada; vite.config.ts lo sustituye por
 * `../js/dist/entry/browser.js` en cuanto existe. Tiene la MISMA API pública
 * (los nombres que fijó «js» el 7-10-2026) pero solo lo que usa el lector, y sin
 * las garantías de la de verdad: no pasa la conformidad, no valida a fondo y
 * la vista de legado 4.x es aproximada. No lo uses como referencia de nada.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Fila = Record<string, unknown>;
type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Db = InstanceType<Sqlite['oo1']['DB']>;

let motor: Promise<Sqlite> | null = null;
const sqlite = () => (motor ??= sqlite3InitModule());

async function bytesDe(input: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  let b: Uint8Array;
  if (input instanceof Uint8Array) b = input;
  else if (input instanceof ArrayBuffer) b = new Uint8Array(input);
  else b = new Uint8Array(await input.arrayBuffer());
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    b = new Uint8Array(await new Response(s).arrayBuffer());
  }
  return b;
}

async function abrirDb(bytes: Uint8Array): Promise<Db> {
  const s = await sqlite();
  const db = new s.oo1.DB();
  const p = s.wasm.allocFromTypedArray(bytes);
  const rc = s.capi.sqlite3_deserialize(db.pointer!, 'main', p, bytes.length, bytes.length,
    s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_RESIZEABLE);
  db.checkRc(rc);
  return db;
}

const filas = (db: Db, sql: string, bind: unknown[] = []): Fila[] =>
  db.exec({ sql, bind: bind as never, rowMode: 'object', returnValue: 'resultRows' }) as Fila[];
const json = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : v ?? null);

/* ---------------- Vista de legado 4.x (aproximada) ---------------- */
const TIPOS: Record<string, string> = { pdf_escaneado: 'scanned_pdf', fotos: 'photos', imagen: 'image', documento: 'document', presentacion: 'slides', hoja: 'sheet' };
const ANCLAS: Record<string, string> = { pagina: 'page', tiempo: 'time', seccion: 'section', diapositiva: 'slide', hoja: 'sheet', imagen: 'image' };
const CLAVES: Record<string, string> = { tipo: 'type', fisica: 'physical', impresa: 'printed', romana: 'roman', origen: 'source', confianza: 'confidence', hablante: 'speaker', ruta: 'path', parrafo: 'paragraph', filaDesde: 'row_from', filaHasta: 'row_to', consultada: 'accessed' };
const ORIGENES: Record<string, string> = { leido: 'read', deducido: 'inferred', ninguno: 'none' };
function anclaLegado(a: any): any {
  if (!a || typeof a !== 'object') return a;
  const o: any = {};
  for (const [k, v] of Object.entries(a)) o[CLAVES[k] ?? k] = v;
  o.type = ANCLAS[o.type] ?? o.type;
  if (o.source) o.source = ORIGENES[o.source] ?? o.source;
  if (o.type === 'page' && typeof o.physical === 'number') o.physical = Math.max(1, o.physical);
  return o;
}
function cslLegado(m: any): any {
  const persona = (p: any) => ({ family: p.apellidos ?? p.family, given: p.nombre ?? p.given });
  const c: any = { type: m.tipoCSL ?? 'book', title: m.subtitulo ? `${m.titulo}: ${m.subtitulo}` : m.titulo };
  if (m.subtitulo) c['title-short'] = m.titulo;
  if (m.autores?.length) c.author = m.autores.map(persona);
  if (m.editores?.length) c.editor = m.editores.map(persona);
  if (m.traductores?.length) c.translator = m.traductores.map(persona);
  if (m.anio) c.issued = { 'date-parts': [[m.anio]] };
  if (m.anioOriginal) c['original-date'] = { 'date-parts': [[m.anioOriginal]] };
  for (const [a, b] of [['editorial', 'publisher'], ['lugar', 'publisher-place'], ['revista', 'container-title'], ['coleccion', 'collection-title'], ['volumen', 'volume'], ['numero', 'issue'], ['paginas', 'page'], ['edicion', 'edition'], ['doi', 'DOI'], ['isbn', 'ISBN'], ['url', 'URL'], ['idioma', 'language'], ['resumen', 'abstract']])
    if (m[a]) c[b] = m[a];
  c.spdf = { subtitle: m.subtitulo, original_language: m.idiomaOriginal, provenance: m.procedencia };
  return c;
}

/* ---------------- Búsqueda léxica (§6, simplificada) ---------------- */
function consultaFts(q: string): string | null {
  q = q.normalize('NFC');
  const frases: string[] = [];
  const resto = q.replace(/["“«„]([^"”»“]*)["”»“]/g, (_, f) => { frases.push(f); return ' '; });
  const palabras = (t: string) => t.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const terminos = frases.length ? frases.map((f) => palabras(f).join(' ')).filter(Boolean) : palabras(resto);
  const vistos = new Set<string>();
  const unicos = terminos.filter((t) => { const k = t.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
  if (!unicos.length) return null;
  return unicos.map((t) => `"${t.replace(/"/g, '""')}"`).join(frases.length ? ' AND ' : ' OR ');
}

/* ---------------- URI de ancla y cita (§3, §10, simplificadas) ---------------- */
const cod = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function formatAnchorUri(docref: string, a: any, fin?: any): string {
  const p: string[] = [];
  if (a.type === 'page') {
    p.push(`p=${a.physical}`);
    if (fin?.physical && fin.physical !== a.physical) p.push(`pe=${fin.physical}`);
  }
  if (a.printed != null) p.push(`f=${cod(String(a.printed))}`);
  if (fin?.printed != null && fin.printed !== a.printed) p.push(`fe=${cod(String(fin.printed))}`);
  if (a.type === 'time') p.push(`t=${+a.t0.toFixed(6)},${+(fin?.t1 ?? a.t1 ?? a.t0).toFixed(6)}`);
  if (a.path?.length) p.push(`s=${a.path.map(cod).join('/')}`);
  if (a.paragraph != null) p.push(`para=${a.paragraph}`);
  if (a.type === 'slide') p.push(`sl=${a.n}`);
  if (a.type === 'verse') p.push(`v=${a.line_from}${a.line_to && a.line_to !== a.line_from ? '-' + a.line_to : ''}`);
  if (a.type === 'canonical') p.push(`ref=${cod(a.scheme)}:${cod(a.ref)}`);
  if (a.chars) p.push(`char=${a.chars[0]},${a.chars[1]}`);
  if (a.region) p.push(`xywh=percent:${[a.region.x, a.region.y, a.region.w, a.region.h].map((v: number) => +(v * 100).toFixed(4)).join(',')}`);
  const ref = /^[0-9a-f]{64}$/.test(docref) ? `sha256-${docref}` : docref;
  return `spdf:${ref}#${p.join('&')}`;
}
export function parseAnchorUri(uri: string): { docref: string; locator: Record<string, unknown> } {
  const [, docref = '', frag = ''] = /^spdf:([^#]*)#?(.*)$/.exec(uri) ?? [];
  const locator: Record<string, unknown> = {};
  for (const par of frag.split('&').filter(Boolean)) {
    const [k, v = ''] = par.split('=');
    const d = decodeURIComponent(v);
    if (k === 'p' || k === 'pe' || k === 'para' || k === 'sl') locator[k] = Number(d);
    else if (k === 't' || k === 'char') locator[k] = d.split(',').map(Number);
    else locator[k] = d;
  }
  return { docref, locator };
}

const apellido = (p: any) => p.literal ?? (p['non-dropping-particle'] ? p['non-dropping-particle'] + ' ' : '') + (p.family ?? p.given ?? '');
function hms(s: number): string {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function cite(a: any, document: any, locale: 'es' | 'en' = 'es', fin?: any): string {
  const m = document?.metadata ?? document ?? {};
  const es = locale === 'es';
  const au: any[] = m.author ?? [];
  let nombres: string;
  if (au.length === 1) nombres = apellido(au[0]);
  else if (au.length === 2) {
    const b = apellido(au[1]);
    nombres = `${apellido(au[0])} ${es ? (/^h?[ií](?![aeiouáéó])/i.test(b) ? 'e' : 'y') : 'and'} ${b}`;
  } else if (au.length > 2) nombres = `${apellido(au[0])} et al.`;
  else nombres = m['title-short'] ?? String(m.title ?? '').split(':')[0].trim();
  const y = m.issued?.['date-parts']?.[0]?.[0];
  const anio = y == null ? (es ? 's. f.' : 'n.d.') : y < 0 ? `${-y} ${es ? 'a. C.' : 'BC'}` : String(y);
  let loc = '';
  if (a?.type === 'page' || (a?.printed != null && (a?.type === 'section' || a?.type === 'web'))) {
    const pr = (x: any) => (x.source === 'inferred' ? `[${x.printed}]` : x.printed);
    const pref = a.foliation === 'leaf' ? ['fol.', 'fols.'] : a.foliation === 'column' ? ['col.', 'cols.'] : ['p.', 'pp.'];
    if (a.printed == null) loc = es ? 's. p.' : 'n. pag.';
    else if (fin?.printed != null && fin.printed !== a.printed) loc = `${pref[1]} ${pr(a)}-${pr(fin)}`;
    else loc = `${pref[0]} ${pr(a)}`;
  } else if (a?.type === 'time') loc = fin?.type === 'time' ? `${hms(a.t0)}-${hms(fin.t1 ?? fin.t0)}` : hms(a.t0);
  else if (a?.type === 'section') loc = `§ ${a.path?.at(-1) ?? ''}${a.paragraph != null ? `, ${es ? 'párr.' : 'para.'} ${a.paragraph}` : ''}`;
  else if (a?.type === 'slide') loc = `${es ? 'diap.' : 'slide'} ${a.n}`;
  else if (a?.type === 'verse') loc = a.line_to && a.line_to !== a.line_from ? `vv. ${a.line_from}-${a.line_to}` : `v. ${a.line_from}`;
  else if (a?.type === 'canonical') loc = a.ref;
  else if (a?.type === 'sheet') loc = `${a.sheet}, ${es ? 'filas' : 'rows'} ${a.row_from}-${a.row_to}`;
  return `(${[nombres, anio, loc].filter(Boolean).join(', ')})`;
}

export function toCslJson(document: any): string {
  return JSON.stringify([{ id: document.id, ...document.metadata }], null, 2);
}
export function toBibtex(document: any): string {
  const m = document.metadata ?? {};
  const tipo = ({ book: 'book', 'article-journal': 'article', chapter: 'incollection', thesis: 'phdthesis', webpage: 'online' } as Record<string, string>)[m.type] ?? 'misc';
  const autores = (m.author ?? []).map((p: any) => p.literal ?? [p.family, p.given].filter(Boolean).join(', ')).join(' and ');
  const anio = m.issued?.['date-parts']?.[0]?.[0];
  const clave = `${(m.author?.[0]?.family ?? 'anon').split(' ')[0].normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()}${anio ?? ''}`;
  const campos: [string, unknown][] = [['author', autores], ['title', m.title], ['year', anio], ['publisher', m.publisher], ['address', m['publisher-place']], ['journal', m['container-title']], ['volume', m.volume], ['number', m.issue], ['pages', m.page], ['doi', m.DOI], ['isbn', m.ISBN], ['url', m.URL], ['language', m.language]];
  return `@${tipo}{${clave},\n${campos.filter(([, v]) => v != null && v !== '').map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}\n`;
}

/* ---------------- El documento ---------------- */
export class SpdfDocument {
  version = '5.0';
  legacy = false;
  meta: Record<string, string> = {};
  document: any;
  #db: Db;
  #t: (n: string) => string;
  #fts: string;

  private constructor(db: Db) {
    this.#db = db;
    const tablas = new Set(filas(db, "SELECT name FROM sqlite_master WHERE type='table'").map((f) => f.name as string));
    this.legacy = !tablas.has('spdf_meta') && tablas.has('spdf');
    this.#t = (n) => n;
    this.#fts = this.legacy ? 'fragmentos_fts' : 'fragments_fts';
    if (this.legacy) {
      // Vistas temporales con los nombres 5.0 sobre las tablas en español.
      db.exec(`
        CREATE TEMP VIEW v_meta AS SELECT clave AS key, valor AS value FROM spdf;
        CREATE TEMP VIEW v_units AS SELECT id, documento AS document, (SELECT COUNT(*) FROM unidades u2 WHERE u2.orden < u.orden OR (u2.orden = u.orden AND u2.id <= u.id)) AS ord, ancla AS anchor, texto AS text, notas AS notes, cabecera AS header, pie AS footer,
          CASE WHEN imagen IN (SELECT clave FROM blobs) THEN 'blob:' || imagen WHEN imagen = '' THEN NULL ELSE imagen END AS image,
          CASE WHEN miniatura IN (SELECT clave FROM blobs) THEN 'blob:' || miniatura WHEN miniatura = '' THEN NULL ELSE miniatura END AS thumbnail,
          lector AS reader, confianza AS confidence, impresa AS printed, t0, t1, ${filas(db, "SELECT 1 FROM pragma_table_info('unidades') WHERE name='palabras'").length ? 'palabras' : 'NULL'} AS words FROM unidades u;
        CREATE TEMP VIEW v_sections AS SELECT id, documento AS document, padre AS parent, nivel AS level, titulo AS title, unidad_desde AS unit_from, unidad_hasta AS unit_to, resumen AS summary FROM secciones;
        CREATE TEMP VIEW v_fragments AS SELECT n, id, documento AS document, unidad AS unit, orden AS ord, texto AS text, contexto AS context, seccion AS section, ancla AS anchor, ancla_fin AS anchor_end, texto_busqueda AS search_text FROM fragmentos;
        CREATE TEMP VIEW v_figures AS SELECT id, documento AS document, unidad AS unit, CASE WHEN imagen IN (SELECT clave FROM blobs) THEN 'blob:' || imagen ELSE imagen END AS image, pie AS caption, descripcion AS description, ancla AS anchor FROM figuras;
        CREATE TEMP VIEW v_spaces AS SELECT id, proveedor AS provider, modelo AS model, version, dims, 'f32' AS dtype, normalizado AS normalized, NULL AS truncated_from, modalidades AS modalities, NULL AS task_prefixes, creado AS created FROM espacios;
        CREATE TEMP VIEW v_vectors AS SELECT CASE objetivo WHEN 'fragmento' THEN 'fragment' WHEN 'unidad' THEN 'unit' WHEN 'figura' THEN 'figure' ELSE objetivo END AS target, id, espacio AS space, documento AS document, valores AS data FROM vectores;
        CREATE TEMP VIEW v_blobs AS SELECT clave AS key, mime, NULL AS sha256, datos AS data FROM blobs;
        CREATE TEMP VIEW v_provenance AS SELECT documento AS document, fase AS stage, proveedor AS provider, NULL AS model, detalle AS detail, ms, cuando AS at FROM procedencia;
      `);
      this.#t = (n) => `v_${n === 'spdf_meta' ? 'meta' : n}`;
    }
    for (const f of filas(db, `SELECT key, value FROM ${this.#t('spdf_meta')}`)) this.meta[f.key as string] = f.value as string;
    this.version = this.meta.spdf_version ?? (this.legacy ? '4.1' : '5.0');
    const d = this.legacy
      ? filas(db, `SELECT id, tipo AS kind, metadatos AS metadata, huella AS source_sha256, CASE WHEN original IN (SELECT clave FROM blobs) THEN 'blob:' || original WHEN original = '' THEN NULL ELSE original END AS source_ref, mime, bytes, unidades AS unit_count, duracion AS duration, creado AS created, actualizado AS updated, titulo AS title, autores AS authors, anio AS year, idioma AS language, NULL AS rights FROM documentos LIMIT 1`)[0]
      : filas(db, 'SELECT * FROM documents LIMIT 1')[0];
    if (!d) throw new Error('E010: el fichero no tiene documento');
    this.document = { ...d, metadata: this.legacy ? cslLegado(json(d.metadata)) : json(d.metadata), rights: json(d.rights), kind: TIPOS[d.kind as string] ?? d.kind };
  }

  static async open(input: Uint8Array | ArrayBuffer | Blob): Promise<SpdfDocument> {
    const bytes = await bytesDe(input);
    if (new TextDecoder().decode(bytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('E001: no es una base SQLite');
    const db = await abrirDb(bytes);
    const peligro = filas(db, "SELECT name, type FROM sqlite_master WHERE type IN ('trigger','view')").filter((f) => !/^fragmentos_a[idu]$/.test(f.name as string));
    if (peligro.length) { db.close(); throw new Error(`E020: el fichero contiene ${peligro[0].type} «${peligro[0].name}»`); }
    return new SpdfDocument(db);
  }

  #unidad = (f: Fila) => {
    const a = json(f.anchor);
    return { ...f, anchor: this.legacy ? anclaLegado(a) : a, notes: json(f.notes), words: json(f.words) };
  };
  #frag = (f: Fila) => ({
    ...f, anchor: this.legacy ? anclaLegado(json(f.anchor)) : json(f.anchor),
    anchor_end: this.legacy ? anclaLegado(json(f.anchor_end)) : json(f.anchor_end), section: json(f.section),
  });
  #docref = () => this.document.source_sha256;

  async units(r: { from?: number; to?: number } = {}) {
    return filas(this.#db, `SELECT id, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words FROM ${this.#t('units')} WHERE ord >= ? AND ord <= ? ORDER BY ord`, [r.from ?? 1, r.to ?? 1e9]).map(this.#unidad);
  }
  async unit(ord: number) { return (await this.units({ from: ord, to: ord }))[0] ?? null; }
  async unitByPrinted(folio: string) {
    return filas(this.#db, `SELECT id, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words FROM ${this.#t('units')} WHERE printed = ? ORDER BY ord`, [folio]).map(this.#unidad);
  }
  async sections() { return filas(this.#db, `SELECT id, parent, level, title, unit_from, unit_to, summary FROM ${this.#t('sections')} ORDER BY rowid`); }
  async fragments(unitId?: string) {
    const sql = `SELECT n, id, unit, ord, text, context, section, anchor, anchor_end, search_text FROM ${this.#t('fragments')}`;
    return (unitId ? filas(this.#db, `${sql} WHERE unit = ? ORDER BY n`, [unitId]) : filas(this.#db, `${sql} ORDER BY n`)).map(this.#frag);
  }
  async fragment(id: string) {
    return filas(this.#db, `SELECT n, id, unit, ord, text, context, section, anchor, anchor_end, search_text FROM ${this.#t('fragments')} WHERE id = ?`, [id]).map(this.#frag)[0] ?? null;
  }
  async figures() {
    return filas(this.#db, `SELECT id, unit, image, caption, description, anchor FROM ${this.#t('figures')} ORDER BY id`).map((f) => ({ ...f, anchor: this.legacy ? anclaLegado(json(f.anchor)) : json(f.anchor) }));
  }
  async spaces() {
    return filas(this.#db, `SELECT * FROM ${this.#t('spaces')} ORDER BY id`).map((f) => ({ ...f, modalities: json(f.modalities), task_prefixes: json(f.task_prefixes) }));
  }
  async vectors(spaceId: string, target = 'fragment') {
    return filas(this.#db, `SELECT target, id, data FROM ${this.#t('vectors')} WHERE space = ? AND target = ?`, [spaceId, target]);
  }
  async blob(key: string) {
    const f = filas(this.#db, `SELECT key, mime, sha256, data FROM ${this.#t('blobs')} WHERE key = ?`, [key])[0];
    return f ? { key: f.key as string, mime: f.mime as string, sha256: f.sha256 as string, data: f.data as Uint8Array } : null;
  }
  async blobs() { return filas(this.#db, `SELECT key, mime, length(data) AS bytes FROM ${this.#t('blobs')} ORDER BY key`); }
  async provenance() { return filas(this.#db, `SELECT stage, provider, model, detail, ms, at FROM ${this.#t('provenance')} ORDER BY at, stage`).map((f) => ({ ...f, detail: (() => { try { return json(f.detail); } catch { return f.detail; } })() })); }
  async extensions() {
    try { return filas(this.#db, 'SELECT name, version, required FROM extensions ORDER BY name'); } catch { return []; }
  }
  anchorUri(a: any, fin?: any) { return formatAnchorUri(this.#docref(), a, fin); }
  cite(a: any, locale: 'es' | 'en' = 'es', fin?: any) { return cite(a, this.document, locale, fin); }

  async searchLexical(q: string, o: { limit?: number } = {}) {
    const m = consultaFts(q);
    if (!m) return [];
    const r = filas(this.#db, `SELECT f.n, f.id, f.anchor, -bm25(${this.#fts}, 1.0, 0.5, 0.5, 1.0) AS score FROM ${this.#fts} JOIN ${this.#t('fragments')} f ON f.n = ${this.#fts}.rowid WHERE ${this.#fts} MATCH ? ORDER BY score DESC, f.n LIMIT ?`, [m, o.limit ?? 20]);
    return r.map((f) => { const a = this.legacy ? anclaLegado(json(f.anchor)) : json(f.anchor); return { fragment_id: f.id as string, n: f.n as number, score: f.score as number, via: ['lexical'], anchor: a, anchor_uri: this.anchorUri(a) }; });
  }
  async searchVector(spaceId: string, vector: Float32Array | number[], o: { target?: string; limit?: number } = {}) {
    const sp = (await this.spaces()).find((s: any) => s.id === spaceId);
    if (!sp) throw new Error(`E031: espacio desconocido ${spaceId}`);
    const q = Float64Array.from(vector as ArrayLike<number>);
    const datos = filas(this.#db, `SELECT v.id, v.data, f.n, f.anchor FROM ${this.#t('vectors')} v JOIN ${this.#t('fragments')} f ON f.id = v.id WHERE v.space = ? AND v.target = 'fragment'`, [spaceId]);
    const out = datos.map((f) => {
      const b = f.data as Uint8Array;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let s = 0;
      const dt = (sp as any).dtype ?? 'f32';
      for (let i = 0; i < q.length; i++) s += q[i] * (dt === 'i8' ? dv.getInt8(i) / 127 : dt === 'f16' ? (dv as any).getFloat16?.(i * 2, true) ?? 0 : dv.getFloat32(i * 4, true));
      const a = this.legacy ? anclaLegado(json(f.anchor)) : json(f.anchor);
      return { fragment_id: f.id as string, n: f.n as number, score: s, via: ['vector'], anchor: a, anchor_uri: this.anchorUri(a) };
    });
    out.sort((a, b) => b.score - a.score || a.n - b.n);
    return out.slice(0, o.limit ?? 20);
  }
  async searchHybrid(q: string, vector: Float32Array | number[], spaceId: string, o: { limit?: number; k?: number } = {}) {
    const lim = o.limit ?? 20, prof = Math.max(lim, 50), k = o.k ?? 10;
    const [lx, vc] = await Promise.all([this.searchLexical(q, { limit: prof }), this.searchVector(spaceId, vector, { limit: prof })]);
    const m = new Map<string, any>();
    lx.forEach((h, i) => m.set(h.fragment_id, { ...h, score: 1 / (k + i + 1), via: ['lexical'] }));
    vc.forEach((h, i) => { const e = m.get(h.fragment_id); if (e) { e.score += 1 / (k + i + 1); e.via = ['lexical', 'vector']; } else m.set(h.fragment_id, { ...h, score: 1 / (k + i + 1), via: ['vector'] }); });
    return [...m.values()].sort((a, b) => b.score - a.score || a.n - b.n).slice(0, lim);
  }
  async validate() {
    const errors: any[] = [];
    if (!this.legacy) {
      const t = new Set(filas(this.#db, "SELECT name FROM sqlite_master WHERE type='table'").map((f) => f.name));
      for (const n of ['spdf_meta', 'documents', 'units', 'sections', 'fragments', 'figures', 'spaces', 'vectors', 'blobs', 'provenance', 'extensions'])
        if (!t.has(n)) errors.push({ code: 'E010', message: `Falta la tabla ${n}`, where: n });
    }
    return { valid: errors.length === 0, version: this.version, profile: (this.meta.profile ?? 'core').split(' '), errors, warnings: [{ code: 'W000', message: 'Validación aproximada del simulacro: falta la biblioteca spdf-format real.' }] };
  }
  async dump() {
    return { spdf_version: this.version, ...(this.legacy ? { legacy: true } : {}), meta: this.meta, document: this.document, units: await this.units(), sections: await this.sections(), fragments: await this.fragments(), figures: await this.figures(), spaces: await this.spaces(), blobs: await this.blobs(), provenance: await this.provenance(), extensions: await this.extensions() };
  }
  /** Solo para el escritor del simulacro. */
  exportar(): Promise<Uint8Array> { return sqlite().then((s) => s.capi.sqlite3_js_db_export(this.#db.pointer!)); }
  close() { this.#db.close(); }
}

export const openSpdf = (input: Uint8Array | ArrayBuffer | Blob) => SpdfDocument.open(input);
export const openBlob = (file: Blob) => SpdfDocument.open(file);
export async function validate(input: Uint8Array | ArrayBuffer | Blob) { const d = await openSpdf(input); try { return await d.validate(); } finally { d.close(); } }

/* ---------------- Escritor (solo añadir espacios y vectores) ---------------- */
export class SpdfWriter {
  #db: Db;
  private constructor(db: Db) { this.#db = db; }
  static async fromSpdf(doc: SpdfDocument): Promise<SpdfWriter> {
    if (doc.legacy) throw new Error('El simulacro no convierte legado 4.x a 5.0: hace falta la biblioteca spdf-format real.');
    return new SpdfWriter(await abrirDb(await doc.exportar()));
  }
  addSpace(s: any) {
    this.#db.exec({ sql: 'INSERT OR REPLACE INTO spaces(id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      bind: [s.id ?? `${s.model}@${s.dims}`, s.provider, s.model, s.version ?? null, s.dims, s.dtype ?? 'f32', s.normalized ? 1 : 0, s.truncated_from ?? null, JSON.stringify(s.modalities ?? ['text']), s.task_prefixes ? JSON.stringify(s.task_prefixes) : null, s.created ?? new Date().toISOString()] as never });
    return this;
  }
  addVectors(spaceId: string, items: { target: string; id: string; vector: Float32Array | number[] }[]) {
    const doc = filas(this.#db, 'SELECT id FROM documents LIMIT 1')[0].id;
    this.#db.exec('BEGIN');
    const st = this.#db.prepare('INSERT OR REPLACE INTO vectors(target, id, space, document, data) VALUES (?,?,?,?,?)');
    for (const it of items) {
      const v = Float32Array.from(it.vector as ArrayLike<number>);
      st.bind([it.target, it.id, spaceId, doc, new Uint8Array(v.buffer)] as never).stepReset();
    }
    st.finalize();
    this.#db.exec('COMMIT');
    return this;
  }
  setMeta(key: string, value: string) { this.#db.exec({ sql: 'INSERT OR REPLACE INTO spdf_meta(key, value) VALUES (?,?)', bind: [key, value] }); return this; }
  async finish(): Promise<Uint8Array> {
    const prof = filas(this.#db, "SELECT value FROM spdf_meta WHERE key='profile'")[0]?.value as string ?? 'core';
    if (!prof.split(' ').includes('semantic')) this.setMeta('profile', `${prof} semantic`.trim());
    this.#db.exec('PRAGMA application_id = 1397769286; PRAGMA user_version = 500; VACUUM;');
    const s = await sqlite();
    const out = s.capi.sqlite3_js_db_export(this.#db.pointer!);
    this.#db.close();
    return out;
  }
}
