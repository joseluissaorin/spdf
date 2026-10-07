/**
 * La biblioteca: una o varias carpetas (o ficheros) de .spdf abiertos con
 * spdf-format en solo lectura. Aquí vive toda la lógica de las herramientas;
 * server.ts solo la expone por MCP. Nada de lo que devuelve se inventa: el
 * texto sale del fichero, la cita sale de `cite` sobre el ancla guardada, y si
 * una página no existe se dice, no se aproxima.
 */
import { readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  openSpdf, parseAnchorUri, locatorToAnchor, toCslJson, toBibtex,
  type Anchor, type SpdfDocument, type Unit, type FragmentWithUri, type Figure,
} from 'spdf-format';

export type Locale = 'en' | 'es';

export interface LibraryOptions {
  /** Recorrer subcarpetas (por defecto, sí). */
  recursive?: boolean;
  /** Lengua por defecto de las citas. */
  locale?: Locale;
}

export interface DocumentSummary {
  doc: string;
  file: string;
  title: string;
  authors: string;
  year: number | null;
  kind: string;
  language: string | null;
  units: number;
  fragments: number;
  figures: number;
  profile: string[];
  spaces: string[];
  spdf_version: string;
}

interface Entry {
  path: string;
  doc: SpdfDocument;
  summary: DocumentSummary;
}

export class SpdfToolError extends Error {}

const SOLO_HEX = /^[0-9a-f]{8,64}$/i;

function authorsOf(d: SpdfDocument): string {
  const a = (d.document.metadata.author ?? []).map((n) => n.literal ?? [n.given, n.family].filter(Boolean).join(' ')).filter(Boolean);
  return a.join('; ') || (d.document.authors ?? '');
}

/** El texto literal de un tramo `chars` de una unidad (puntos de código, fin exclusivo). */
export function sliceChars(text: string, chars?: [number, number] | null): string {
  if (!chars) return text;
  return [...text].slice(chars[0], chars[1]).join('');
}

export class Library {
  private entries = new Map<string, Entry>();
  readonly problems: { file: string; error: string }[] = [];
  readonly locale: Locale;

  private constructor(private readonly roots: string[], private readonly options: LibraryOptions) {
    this.locale = options.locale ?? 'en';
  }

  static async open(roots: string[], options: LibraryOptions = {}): Promise<Library> {
    const lib = new Library(roots.map((r) => resolve(r)), options);
    await lib.refresh();
    return lib;
  }

  /** Vuelve a recorrer las carpetas: abre los ficheros nuevos y cierra los que ya no están. */
  async refresh(): Promise<void> {
    const files = new Set<string>();
    const walk = (p: string, depth: number) => {
      let st;
      try { st = statSync(p); } catch { return; }
      if (st.isFile()) { if (p.toLowerCase().endsWith('.spdf')) files.add(p); return; }
      if (!st.isDirectory() || (depth > 0 && this.options.recursive === false)) return;
      for (const f of readdirSync(p)) if (!f.startsWith('.')) walk(join(p, f), depth + 1);
    };
    for (const r of this.roots) walk(r, 0);
    const known = new Map([...this.entries.values()].map((e) => [e.path, e]));
    for (const [path, e] of known) {
      if (!files.has(path)) { this.entries.delete(e.summary.doc); await e.doc.close().catch(() => {}); }
    }
    this.problems.length = 0;
    for (const path of files) {
      if (known.has(path) && this.entries.has(known.get(path)!.summary.doc)) continue;
      try {
        const doc = await openSpdf(path);
        const [fragments, figures, spaces] = await Promise.all([doc.fragments(), doc.figures(), doc.spaces()]);
        const m = doc.document.metadata;
        const summary: DocumentSummary = {
          doc: doc.docref,
          file: path,
          title: m.title ?? doc.document.title ?? basename(path),
          authors: authorsOf(doc),
          year: doc.document.year ?? null,
          kind: String(doc.document.kind),
          language: doc.document.language ?? (m.language as string | undefined) ?? null,
          units: doc.document.unit_count,
          fragments: fragments.length,
          figures: figures.length,
          profile: String((doc.meta as Record<string, string>).profile ?? '').split(/\s+/).filter(Boolean),
          spaces: spaces.map((s) => s.id),
          spdf_version: doc.legacy ? String(doc.version) : '5.0',
        };
        if (this.entries.has(summary.doc)) {
          // El mismo original dos veces: se queda el primero y se avisa.
          this.problems.push({ file: path, error: `duplicate of ${this.entries.get(summary.doc)!.path} (same source SHA-256)` });
          await doc.close();
          continue;
        }
        this.entries.set(summary.doc, { path, doc, summary });
      } catch (e) {
        this.problems.push({ file: path, error: (e as Error).message });
      }
    }
  }

  list(filter?: string): DocumentSummary[] {
    const all = [...this.entries.values()].map((e) => e.summary).sort((a, b) => a.title.localeCompare(b.title));
    if (!filter) return all;
    const q = filter.toLowerCase();
    return all.filter((s) => `${s.title} ${s.authors} ${s.year ?? ''} ${basename(s.file)}`.toLowerCase().includes(q));
  }

  /** Encuentra un documento por docref (sha256-…), prefijo del hash (8+), id, nombre de fichero o URI de ancla. */
  resolve(ref: string): Entry {
    const r = ref.trim();
    if (r.startsWith('spdf:')) return this.resolve(parseAnchorUri(r).docref);
    const exact = this.entries.get(r);
    if (exact) return exact;
    const hex = r.replace(/^sha256-/i, '').toLowerCase();
    const candidates = [...this.entries.values()].filter((e) =>
      (SOLO_HEX.test(hex) && e.summary.doc.startsWith(`sha256-${hex}`)) ||
      e.doc.document.id === r ||
      basename(e.path) === r || basename(e.path, '.spdf') === r);
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) throw new SpdfToolError(`"${ref}" matches ${candidates.length} documents; use the full doc reference from list_documents.`);
    throw new SpdfToolError(`No document "${ref}" in the library. Call list_documents to see what is available.`);
  }

  private pick(docs?: string[]): Entry[] {
    if (docs && docs.length) return docs.map((d) => this.resolve(d));
    return [...this.entries.values()];
  }

  /**
   * Búsqueda en uno o varios documentos. Las puntuaciones de BM25 no se pueden
   * comparar entre ficheros (cada uno tiene sus estadísticas), así que las
   * listas de cada documento se funden por rango recíproco (k = 10, como la
   * búsqueda híbrida de referencia).
   */
  async search(query: string, o: { docs?: string[]; limit?: number; vector?: number[]; space?: string; locale?: Locale } = {}) {
    const limit = Math.min(Math.max(o.limit ?? 10, 1), 50);
    const locale = o.locale ?? this.locale;
    const lists = await Promise.all(this.pick(o.docs).map(async (e) => {
      let hits;
      if (o.vector && o.vector.length) {
        const space = o.space ?? e.summary.spaces[0];
        if (!space || !e.summary.spaces.includes(space)) return [];
        hits = await e.doc.searchHybrid(query, o.vector, space, { limit, k: 10 });
      } else {
        hits = await e.doc.searchLexical(query, { limit });
      }
      return hits.map((h, i) => ({ e, h, rank: i + 1 }));
    }));
    const merged = lists.flat().map((x) => ({ ...x, fused: 1 / (10 + x.rank) }));
    merged.sort((a, b) => b.fused - a.fused || a.rank - b.rank || a.h.n - b.h.n);
    return merged.slice(0, limit).map(({ e, h }) => ({
      doc: e.summary.doc,
      title: e.summary.title,
      fragment_id: h.fragment_id,
      citation: e.doc.cite(h.anchor, locale, h.anchor_end),
      anchor_uri: h.anchor_uri,
      text: h.fragment.text,
      section: h.fragment.section ?? [],
      context: h.fragment.context,
      score: Number(h.score.toFixed(6)),
      via: h.via,
    }));
  }

  /** Las unidades cuyo número de página física es `physical`. */
  private async unitsByPhysical(e: Entry, physical: number): Promise<Unit[]> {
    const all = await e.doc.units();
    return all.filter((u) => u.anchor.type === 'page' && u.anchor.physical === physical);
  }

  private async foliosOf(e: Entry): Promise<string> {
    const us = await e.doc.units();
    const f = us.map((u) => (u.anchor.type === 'page' ? u.printed ?? null : null)).filter((x): x is string => !!x);
    if (!f.length) return 'no unit has a printed folio';
    return f.length > 12 ? `${f.slice(0, 6).join(', ')} … ${f.slice(-3).join(', ')}` : f.join(', ');
  }

  /**
   * Localiza un pasaje: por fragmento, por folio impreso, por página física,
   * por segundo (audio y vídeo) o por URI de ancla. Devuelve el texto literal,
   * su ancla y su cita, con avisos si algo no cuadra. Nunca devuelve una
   * página parecida en lugar de la pedida.
   */
  async locate(o: { doc?: string; fragment_id?: string; folio?: string; page?: number; time?: number; uri?: string; locale?: Locale }) {
    const locale = o.locale ?? this.locale;
    const warnings: string[] = [];
    let e: Entry;
    let anchor: Anchor;
    let anchorEnd: Anchor | null = null;
    let text: string;
    let unit: Unit | null = null;
    let fragment: FragmentWithUri | null = null;

    if (o.uri) {
      const parsed = parseAnchorUri(o.uri);
      e = this.resolve(parsed.docref);
      const loc = parsed.locator;
      const target = locatorToAnchor(loc);
      anchorEnd = target.anchor_end;
      if (loc.p !== undefined) {
        const us = await this.unitsByPhysical(e, loc.p);
        if (!us.length) throw new SpdfToolError(`${e.summary.title} has no physical page ${loc.p} (it has ${e.summary.units} units). Do not cite it.`);
        unit = us[0]!;
        if (loc.f !== undefined && unit.printed !== loc.f) warnings.push(`The URI says printed folio ${loc.f}, but physical page ${loc.p} carries ${unit.printed ?? 'no printed folio'}. The citation follows the file.`);
      } else if (loc.f !== undefined) {
        const us = await e.doc.unitByPrinted(loc.f);
        if (!us.length) throw new SpdfToolError(`${e.summary.title} has no page with printed folio ${loc.f}. Printed folios: ${await this.foliosOf(e)}. Do not cite it.`);
        unit = us[0]!;
        if (us.length > 1) warnings.push(`Printed folio ${loc.f} appears on ${us.length} pages (physical ${us.map((u) => (u.anchor.type === 'page' ? u.anchor.physical : u.ord)).join(', ')}); using the first. Add p= to disambiguate.`);
      } else if (loc.t) {
        unit = await this.unitAtTime(e, loc.t[0]);
      } else {
        throw new SpdfToolError('This anchor URI has no page, folio or time; read_passage needs one of them.');
      }
      anchor = { ...unit.anchor, ...(loc.char ? { chars: loc.char } : {}) } as Anchor;
      if (loc.t && unit.anchor.type === 'time') anchor = { ...unit.anchor, t0: loc.t[0], t1: loc.t[1] } as Anchor;
      text = sliceChars(unit.text, loc.char ?? null);
      if (target.anchor.type !== unit.anchor.type) warnings.push(`The URI points to a ${target.anchor.type} anchor; the unit found is a ${unit.anchor.type}.`);
    } else {
      if (!o.doc) throw new SpdfToolError('Give "doc" (from list_documents) or a full anchor "uri".');
      e = this.resolve(o.doc);
      if (o.fragment_id) {
        fragment = await e.doc.fragment(o.fragment_id);
        if (!fragment) throw new SpdfToolError(`${e.summary.title} has no fragment "${o.fragment_id}".`);
        anchor = fragment.anchor;
        anchorEnd = fragment.anchor_end;
        text = fragment.text;
      } else if (o.folio !== undefined) {
        const us = await e.doc.unitByPrinted(String(o.folio));
        if (!us.length) throw new SpdfToolError(`${e.summary.title} has no page with printed folio ${o.folio}. Printed folios: ${await this.foliosOf(e)}. Do not cite it.`);
        if (us.length > 1) warnings.push(`Printed folio ${o.folio} appears on ${us.length} pages; using the first. Use "page" (physical) to pick another.`);
        unit = us[0]!;
        anchor = unit.anchor;
        text = unit.text;
      } else if (o.page !== undefined) {
        const us = await this.unitsByPhysical(e, o.page);
        if (!us.length) throw new SpdfToolError(`${e.summary.title} has no physical page ${o.page} (it has ${e.summary.units} units). Do not cite it.`);
        unit = us[0]!;
        anchor = unit.anchor;
        text = unit.text;
      } else if (o.time !== undefined) {
        unit = await this.unitAtTime(e, o.time);
        anchor = unit.anchor;
        text = unit.text;
      } else {
        throw new SpdfToolError('Say which passage: fragment_id, folio, page, time or uri.');
      }
    }
    if (anchor.type === 'page' && anchor.printed == null) {
      warnings.push(locale === 'es'
        ? 'Esta página no lleva folio impreso: la cita dice «s. p.». No la sustituyas por la posición de la página en el fichero.'
        : 'This page carries no printed folio: the citation says "n. pag.". Do not replace it with the page\'s position in the file.');
    }
    if (anchor.type === 'page' && anchor.source === 'inferred') {
      warnings.push(locale === 'es'
        ? 'El folio está deducido de las páginas vecinas, no leído en la página: se cita entre corchetes. Consérvalos.'
        : 'The folio was inferred from the neighbouring pages, not read on the page: it is cited in brackets. Keep them.');
    }
    return {
      doc: e.summary.doc,
      title: e.summary.title,
      fragment_id: fragment?.id ?? null,
      unit_id: unit?.id ?? fragment?.unit ?? null,
      citation: e.doc.cite(anchor, locale, anchorEnd),
      anchor_uri: e.doc.anchorUri(anchor, anchorEnd),
      text,
      section: fragment?.section ?? [],
      context: fragment?.context ?? '',
      reader: unit?.reader ?? null,
      confidence: unit?.confidence ?? null,
      warnings,
    };
  }

  private async unitAtTime(e: Entry, t: number): Promise<Unit> {
    const us = (await e.doc.units()).filter((u) => u.anchor.type === 'time');
    const u = us.find((x) => x.anchor.type === 'time' && x.anchor.t0 <= t && t < x.anchor.t1) ?? null;
    if (!u) throw new SpdfToolError(`${e.summary.title} has no time span containing ${t} s. Do not cite it.`);
    return u;
  }

  /** Fragmentos vecinos de uno dado (para leer el contexto antes de citar). */
  async neighbours(doc: string, fragmentId: string, around: number) {
    const e = this.resolve(doc);
    const all = await e.doc.fragments();
    const i = all.findIndex((f) => f.id === fragmentId);
    if (i < 0) return [];
    return all.slice(Math.max(0, i - around), i + around + 1).map((f) => ({ fragment_id: f.id, citation: e.doc.cite(f.anchor, this.locale, f.anchor_end), text: f.text, current: f.id === fragmentId }));
  }

  async figures(doc?: string, locale?: Locale) {
    const out: { doc: string; title: string; figure_id: string; caption: string | null; description: string | null; citation: string; anchor_uri: string; region: Anchor['region'] | null; image: string }[] = [];
    for (const e of this.pick(doc ? [doc] : undefined)) {
      for (const f of await e.doc.figures()) {
        out.push({
          doc: e.summary.doc, title: e.summary.title, figure_id: f.id, caption: f.caption, description: f.description,
          citation: e.doc.cite(f.anchor, locale ?? this.locale), anchor_uri: e.doc.anchorUri(f.anchor), region: f.anchor.region ?? null, image: f.image,
        });
      }
    }
    return out;
  }

  async figureImage(doc: string, figureId: string): Promise<{ data: Uint8Array; mime: string; figure: Figure } | null> {
    const e = this.resolve(doc);
    const f = (await e.doc.figures()).find((x) => x.id === figureId);
    if (!f) throw new SpdfToolError(`${e.summary.title} has no figure "${figureId}".`);
    if (!f.image.startsWith('blob:')) return null;
    const b = await e.doc.blob(f.image.slice(5));
    return b ? { data: b.data, mime: b.mime, figure: f } : null;
  }

  async metadata(doc: string) {
    const e = this.resolve(doc);
    const d = e.doc.document;
    return {
      doc: e.summary.doc,
      file: e.path,
      csl: toCslJson(d),
      bibtex: toBibtex(d),
      rights: d.rights ?? null,
      source_sha256: d.source_sha256,
      provenance: (await e.doc.provenance()).map((p) => ({ stage: p.stage, provider: p.provider, model: p.model, at: p.at })),
    };
  }

  async close(): Promise<void> {
    for (const e of this.entries.values()) await e.doc.close().catch(() => {});
    this.entries.clear();
  }
}
