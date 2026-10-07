/**
 * Pruebas del servidor con el SDK de MCP como cliente: en memoria (todas las
 * herramientas), por stdio (el binario compilado, como lo lanzaría Claude Code)
 * y por Streamable HTTP. Los ficheros son los de integrations/fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Library, createServer } from '../src/server.js';

const FIXTURES = resolve(__dirname, '../../fixtures');
const CLI = resolve(__dirname, '../dist/cli.js');

type Resultado = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const json = (r: Resultado) => JSON.parse(r.content[0]!.text!);

describe('spdf-mcp en memoria', () => {
  let lib: Library;
  let client: Client;
  let en: string;
  let es: string;

  beforeAll(async () => {
    lib = await Library.open([FIXTURES]);
    const server = createServer(lib);
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'prueba', version: '1.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const docs = lib.list();
    en = docs.find((d) => d.language === 'en')!.doc;
    es = docs.find((d) => d.language === 'es')!.doc;
  });
  afterAll(async () => { await client.close(); await lib.close(); });

  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<Resultado>;

  it('anuncia las seis herramientas y las instrucciones para citar', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cite', 'get_metadata', 'list_documents', 'list_figures', 'read_passage', 'search']);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toMatch(/Never type a page number yourself/);
  });

  it('lista los dos documentos válidos y avisa del roto', async () => {
    const r = json(await call('list_documents', {}));
    expect(r.items).toHaveLength(2);
    expect(r.items.map((d: { title: string }) => d.title).sort()).toEqual(['SPDF en cinco páginas', 'SPDF in five pages']);
    const d = r.items.find((x: { doc: string }) => x.doc === en);
    expect(d).toMatchObject({ authors: 'José Luis Saorín Ferrer', year: 2026, kind: 'pdf', units: 6, fragments: 8, figures: 1, spaces: ['all-MiniLM-L6-v2@384'] });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].file).toMatch(/roto\.spdf$/);
    expect(json(await call('list_documents', { filter: 'cinco' })).items).toHaveLength(1);
  });

  it('busca en todos los documentos y cada resultado trae texto, cita y URI', async () => {
    const r = await call('search', { query: 'folio' });
    const items = json(r).items;
    expect(items.length).toBeGreaterThan(1);
    for (const h of items) {
      expect(h.citation).toMatch(/^\(Saorín Ferrer, 2026, p\. \[?\d\]?\)$/);
      expect(h.anchor_uri).toMatch(/^spdf:sha256-[0-9a-f]{64}#p=\d&f=\d/);
      expect(h.text.length).toBeGreaterThan(40);
    }
    expect(r.structuredContent).toEqual(json(r));
  });

  it('la búsqueda es insensible a las tildes y respeta las frases', async () => {
    const tildes = json(await call('search', { query: 'pagina fisica', docs: [es] })).items;
    expect(tildes[0].text).toMatch(/página física/);
    const frase = json(await call('search', { query: '"honest citation"', docs: [en] })).items;
    expect(frase.every((h: { text: string; section: string[] }) => /honest citation/i.test(h.text + h.section.join(' ')))).toBe(true);
  });

  it('cita con el folio impreso, no con la posición', async () => {
    const r = json(await call('cite', { doc: en, page: 2 }));
    expect(r.citation).toBe('(Saorín Ferrer, 2026, p. 1)');
    expect(r.anchor_uri).toMatch(/#p=2&f=1$/);
    expect(r.quote).toMatch(/^## I\. Anchors/);
    const f = json(await call('cite', { doc: en, folio: '4', locale: 'es' }));
    expect(f.citation).toBe('(Saorín Ferrer, 2026, p. 4)');
  });

  it('un folio deducido va entre corchetes y lo avisa', async () => {
    const r = json(await call('cite', { doc: en, page: 4 }));
    expect(r.citation).toBe('(Saorín Ferrer, 2026, p. [3])');
    expect(r.warnings.join(' ')).toMatch(/inferred/);
  });

  it('una página sin folio impreso no se disfraza', async () => {
    const r = json(await call('cite', { doc: es, page: 1, locale: 'es' }));
    expect(r.citation).toBe('(Saorín Ferrer, 2026, s. p.)');
    expect(r.warnings.join(' ')).toMatch(/s\. p\./);
    const en1 = json(await call('cite', { doc: en, page: 1 }));
    expect(en1.citation).toBe('(Saorín Ferrer, 2026, n. pag.)');
  });

  it('una página que no existe es un error, no una aproximación', async () => {
    const r = await call('cite', { doc: en, folio: '21' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/no page with printed folio 21.*Printed folios: 1, 2, 3, 4, 5\. Do not cite it/);
    const p = await call('read_passage', { doc: en, page: 99 });
    expect(p.isError).toBe(true);
    const d = await call('cite', { doc: 'no-existe', page: 1 });
    expect(d.content[0]!.text).toMatch(/No document "no-existe"/);
  });

  it('lee por URI de ancla, con el tramo exacto de caracteres', async () => {
    const hit = json(await call('search', { query: 'anchor URI SHA-256', docs: [en], limit: 1 })).items[0];
    const r = json(await call('read_passage', { uri: hit.anchor_uri }));
    expect(r.text).toBe(hit.text);
    expect(r.citation).toBe(hit.citation);
    expect(r.anchor_uri).toBe(hit.anchor_uri);
    const corto = json(await call('read_passage', { doc: en.slice(0, 20), fragment_id: hit.fragment_id, around: 1 }));
    expect(corto.neighbours.length).toBeGreaterThanOrEqual(2);
    expect(corto.neighbours.some((n: { current: boolean }) => n.current)).toBe(true);
  });

  it('avisa si la URI dice un folio y la página lleva otro', async () => {
    const r = json(await call('read_passage', { uri: `spdf:${en}#p=3&f=9` }));
    expect(r.citation).toBe('(Saorín Ferrer, 2026, p. 2)');
    expect(r.warnings.join(' ')).toMatch(/printed folio 9/);
  });

  it('búsqueda híbrida con un vector del mismo espacio', async () => {
    const lib2 = lib as unknown as { entries: Map<string, { doc: { vectors: (s: string) => Promise<{ id: string; vector: Float32Array }[]> } }> };
    const v = (await lib2.entries.get(en)!.doc.vectors('all-MiniLM-L6-v2@384'))[0]!;
    const r = json(await call('search', { query: 'anchor', docs: [en], vector: Array.from(v.vector), space: 'all-MiniLM-L6-v2@384', limit: 3 }));
    expect(r.items[0].fragment_id).toBe(v.id);
    expect(r.items[0].via).toEqual(['lexical', 'vector']);
  });

  it('enseña las figuras y su imagen', async () => {
    const r = await call('list_figures', { doc: en, figure_id: 'fig1', include_image: true });
    const f = json(r).items[0];
    expect(f.citation).toBe('(Saorín Ferrer, 2026, p. [3])');
    expect(f.caption).toMatch(/^Plate I\./);
    const img = r.content.find((c) => c.type === 'image')!;
    expect(img.mimeType).toBe('image/webp');
    expect(Buffer.from(img.data!, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  });

  it('da la ficha en CSL-JSON y BibTeX', async () => {
    const r = json(await call('get_metadata', { doc: 'spdf-in-five-pages.spdf' }));
    expect(r.csl).toMatchObject({ type: 'pamphlet', title: 'SPDF in five pages' });
    expect(r.bibtex).toMatch(/^@\w+\{/);
    expect(r.provenance.map((p: { stage: string }) => p.stage)).toContain('embed');
    const c = json(await call('cite', { doc: en, page: 2, reference: true }));
    expect(c.csl.title).toBe('SPDF in five pages');
  });
});

describe('spdf-mcp por stdio (el binario)', () => {
  it('arranca, lista y cita', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, FIXTURES, '--locale', 'es'], stderr: 'pipe' });
    const client = new Client({ name: 'prueba-stdio', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const docs = json(await client.callTool({ name: 'list_documents', arguments: {} }) as Resultado).items;
    const es = docs.find((d: { language: string }) => d.language === 'es').doc;
    const r = json(await client.callTool({ name: 'cite', arguments: { doc: es, folio: '2' } }) as Resultado);
    expect(r.citation).toBe('(Saorín Ferrer, 2026, p. 2)');
    await client.close();
  }, 20_000);
});

describe('spdf-mcp por Streamable HTTP', () => {
  let proc: ChildProcess;
  const puerto = 18_000 + Math.floor(Math.random() * 2000);
  beforeAll(async () => {
    proc = spawn(process.execPath, [CLI, FIXTURES, '--http', String(puerto)], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise<void>((ok, mal) => {
      const t = setTimeout(() => mal(new Error('no arrancó')), 10_000);
      proc.stderr!.on('data', (d) => { if (String(d).includes('Streamable HTTP on')) { clearTimeout(t); ok(); } });
    });
  });
  afterAll(() => { proc.kill(); });

  it('responde a un cliente MCP por HTTP', async () => {
    const client = new Client({ name: 'prueba-http', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${puerto}/mcp`)));
    const r = json(await client.callTool({ name: 'search', arguments: { query: 'conformance suite', limit: 2 } }) as Resultado);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].citation).toMatch(/p\. 4\)$/);
    await client.close();
  });

  it('rechaza un Host ajeno (DNS rebinding)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((ok) => {
      const r = request({ host: '127.0.0.1', port: puerto, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (res) => { res.resume(); ok(res.statusCode!); });
      r.end('{}');
    });
    expect(status).toBe(403);
  });
});
