/**
 * El servidor MCP: seis herramientas sobre una biblioteca de SPDF (ver
 * library.ts) y unas instrucciones para el modelo con las reglas para citar
 * sin inventar. Cada herramienta devuelve el resultado como texto (JSON
 * legible) y como contenido estructurado.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Library, SpdfToolError, type Locale } from './library.js';

export { Library, SpdfToolError } from './library.js';
export const VERSION = '0.1.0';

export const INSTRUCTIONS = `This server gives you a library of SPDF files: documents that have already been read, where every passage carries its exact anchor (printed page or folio, second of a recording, slide, verse).

Rules for citing without inventing:
1. Quote from the file, cite from the anchor. Take the text of a passage from search or read_passage, and its citation from cite (or the citation field those tools return). Never type a page number yourself.
2. Printed folio, not position. Citations use the folio printed on the page. If a page has no printed folio the citation says "n. pag." (Spanish "s. p."): do not replace it with the page's position in the file.
3. Brackets mean inferred: "p. [21]" means the folio was deduced from neighbouring pages. Keep the brackets.
4. Keep the anchor_uri next to the claim so a human can open the exact passage.
5. Fragments keep the spelling of the source; quote them literally.
6. A search result is a candidate, not evidence: read the passage before attributing a claim to it. If the file does not say it, do not cite it.`;

const locale = z.enum(['en', 'es']).optional().describe('Language of the citation: "en" (default) or "es".');
const docRef = z.string().describe('The document: its doc reference from list_documents (sha256-…), a unique prefix of it, its id or its file name.');

function salida(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: (Array.isArray(result) ? { items: result } : result) as Record<string, unknown>,
  };
}

function error(e: unknown) {
  const msg = e instanceof SpdfToolError ? e.message : `Error: ${(e as Error).message}`;
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

/** Envuelve una herramienta: los errores esperables vuelven como isError, con un mensaje que dice qué hacer. */
function seguro<A>(f: (a: A) => Promise<ReturnType<typeof salida> | { content: unknown[]; isError?: boolean }>) {
  return async (a: A) => {
    try { return (await f(a)) as never; } catch (e) { return error(e) as never; }
  };
}

export function createServer(lib: Library): McpServer {
  const server = new McpServer({ name: 'spdf-mcp', title: 'SPDF library', version: VERSION }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

  server.registerTool('list_documents', {
    title: 'List documents',
    description: 'List the SPDF documents in the library: doc reference, title, authors, year, kind, language, number of units, fragments and figures, and vector spaces. Optionally filter by a word of the title or author, or rescan the folders.',
    inputSchema: { filter: z.string().optional().describe('Only documents whose title, author, year or file name contains this.'), refresh: z.boolean().optional().describe('Rescan the folders for new or removed files first.') },
    outputSchema: z.object({ items: z.array(z.object({ doc: z.string(), title: z.string(), authors: z.string(), year: z.number().nullable() }).loose()), problems: z.array(z.object({ file: z.string(), error: z.string() })) }).loose(),
    annotations: ro,
  }, seguro(async ({ filter, refresh }: { filter?: string; refresh?: boolean }) => {
    if (refresh) await lib.refresh();
    const items = lib.list(filter);
    return salida({ items, problems: lib.problems });
  }));

  server.registerTool('search', {
    title: 'Search passages',
    description: 'Search the passages (fragments) of one, several or all documents. Lexical search with the SPDF reference algorithm (accent-insensitive; "quoted phrases" stay phrases). If you pass a query embedding in `vector` with its `space` (see list_documents), the search is hybrid (reciprocal rank fusion). Every result carries the literal text, its citation with the exact folio or second, and its anchor URI.',
    inputSchema: {
      query: z.string().min(1).describe('Words or "a quoted phrase".'),
      docs: z.array(z.string()).optional().describe('Restrict to these documents (doc references, ids or file names).'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10).'),
      vector: z.array(z.number()).optional().describe('Optional query embedding for hybrid search.'),
      space: z.string().optional().describe('Vector space of `vector`, e.g. all-MiniLM-L6-v2@384.'),
      locale,
    },
    outputSchema: z.object({ items: z.array(z.object({ doc: z.string(), fragment_id: z.string(), citation: z.string(), anchor_uri: z.string(), text: z.string() }).loose()) }).loose(),
    annotations: ro,
  }, seguro(async (a: { query: string; docs?: string[]; limit?: number; vector?: number[]; space?: string; locale?: Locale }) => {
    return salida({ items: await lib.search(a.query, { docs: a.docs, limit: a.limit, vector: a.vector, space: a.space, locale: a.locale }) });
  }));

  server.registerTool('read_passage', {
    title: 'Read a passage',
    description: 'Read the literal text of a passage: a fragment (fragment_id), a page by its printed folio (folio) or physical position (page), the time span containing a second (time), or whatever an anchor URI points to (uri). Returns the text, its citation, its anchor URI, who read it and with what confidence, warnings, and optionally the neighbouring fragments. Fails clearly if the page does not exist.',
    inputSchema: {
      doc: docRef.optional(),
      fragment_id: z.string().optional(),
      folio: z.string().optional().describe('Printed folio as printed: "21", "xiv", "1r".'),
      page: z.number().int().min(1).optional().describe('Physical page (position in the file, from 1).'),
      time: z.number().min(0).optional().describe('Second of a recording.'),
      uri: z.string().optional().describe('An anchor URI: spdf:sha256-…#p=29&f=21&char=118,301'),
      around: z.number().int().min(0).max(5).optional().describe('With fragment_id: also return this many fragments before and after.'),
      locale,
    },
    annotations: ro,
  }, seguro(async (a: { doc?: string; fragment_id?: string; folio?: string; page?: number; time?: number; uri?: string; around?: number; locale?: Locale }) => {
    const r = await lib.locate(a);
    const neighbours = a.around && r.fragment_id ? await lib.neighbours(r.doc, r.fragment_id, a.around) : undefined;
    return salida({ ...r, ...(neighbours ? { neighbours } : {}) });
  }));

  server.registerTool('cite', {
    title: 'Cite a passage',
    description: 'The short citation of a passage, computed from its stored anchor: (Author, Year, p. 21), with the exact printed folio, "p. [21]" if the folio is inferred, "n. pag." if the page has none, or h:mm:ss for recordings. Returns the citation, the anchor URI and the quoted text together, plus the full reference as CSL-JSON and BibTeX if asked. Same ways to point at the passage as read_passage.',
    inputSchema: {
      doc: docRef.optional(),
      fragment_id: z.string().optional(),
      folio: z.string().optional(),
      page: z.number().int().min(1).optional(),
      time: z.number().min(0).optional(),
      uri: z.string().optional(),
      locale,
      reference: z.boolean().optional().describe('Also return the full reference (CSL-JSON and BibTeX).'),
    },
    outputSchema: z.object({ citation: z.string(), anchor_uri: z.string(), quote: z.string(), warnings: z.array(z.string()) }).loose(),
    annotations: ro,
  }, seguro(async (a: { doc?: string; fragment_id?: string; folio?: string; page?: number; time?: number; uri?: string; locale?: Locale; reference?: boolean }) => {
    const r = await lib.locate(a);
    const out: Record<string, unknown> = { citation: r.citation, anchor_uri: r.anchor_uri, quote: r.text, doc: r.doc, title: r.title, warnings: r.warnings };
    if (a.reference) {
      const m = await lib.metadata(r.doc);
      out.csl = m.csl;
      out.bibtex = m.bibtex;
    }
    return salida(out);
  }));

  server.registerTool('list_figures', {
    title: 'List figures',
    description: 'List the figures, plates and video frames of one or all documents, with caption, description, citation and anchor URI. With doc and figure_id and include_image, also return the image itself (the page or frame image; `region` gives the figure\'s box as fractions of it).',
    inputSchema: {
      doc: docRef.optional(),
      figure_id: z.string().optional(),
      include_image: z.boolean().optional(),
      locale,
    },
    annotations: ro,
  }, seguro(async (a: { doc?: string; figure_id?: string; include_image?: boolean; locale?: Locale }) => {
    let figs = await lib.figures(a.doc, a.locale);
    if (a.figure_id) figs = figs.filter((f) => f.figure_id === a.figure_id);
    if (a.figure_id && !figs.length) throw new SpdfToolError(`No figure "${a.figure_id}"${a.doc ? ` in ${a.doc}` : ''}.`);
    const res = salida({ items: figs });
    if (a.include_image && a.doc && a.figure_id) {
      const img = await lib.figureImage(a.doc, a.figure_id);
      if (img && /^image\/(png|jpeg|webp|gif)$/.test(img.mime)) {
        (res.content as unknown[]).push({ type: 'image', data: Buffer.from(img.data).toString('base64'), mimeType: img.mime });
      }
    }
    return res;
  }));

  server.registerTool('get_metadata', {
    title: 'Get the reference',
    description: 'The bibliographic record of a document as CSL-JSON (ready for citeproc, Zotero or Pandoc) and BibTeX, its rights, the SHA-256 of the original and how it was read (provenance).',
    inputSchema: { doc: docRef },
    annotations: ro,
  }, seguro(async ({ doc }: { doc: string }) => salida(await lib.metadata(doc))));

  return server;
}
