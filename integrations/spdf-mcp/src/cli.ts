#!/usr/bin/env node
/**
 * spdf-mcp <carpeta|fichero>… [--http <puerto>] [--host 127.0.0.1] [--locale en|es] [--no-recursive]
 *
 * Por defecto habla MCP por stdio (lo que usan Claude Code, Claude Desktop,
 * Cursor o Zed). Con --http sirve Streamable HTTP en /mcp, sin estado, solo en
 * 127.0.0.1 salvo que se pida otra cosa, con protección contra DNS rebinding.
 */
import { createServer as createHttpServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Library, type Locale } from './library.js';
import { createServer, VERSION } from './server.js';

const AYUDA = `spdf-mcp ${VERSION}: MCP server over a folder of SPDF files.

Usage: spdf-mcp <folder|file.spdf>... [options]

  --http <port>      Serve Streamable HTTP on http://<host>:<port>/mcp instead of stdio
  --host <host>      Interface for --http (default 127.0.0.1)
  --locale en|es     Default language of citations (default en)
  --no-recursive     Do not descend into subfolders
  -h, --help         This help

Tools: list_documents, search, read_passage, cite, list_figures, get_metadata.`;

function args(argv: string[]) {
  const o = { roots: [] as string[], http: 0, host: '127.0.0.1', locale: 'en' as Locale, recursive: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h' || a === '--help') { process.stdout.write(`${AYUDA}\n`); process.exit(0); }
    else if (a === '--http') o.http = Number(argv[++i]);
    else if (a === '--host') o.host = argv[++i]!;
    else if (a === '--locale') o.locale = (argv[++i] === 'es' ? 'es' : 'en');
    else if (a === '--no-recursive') o.recursive = false;
    else if (a.startsWith('--')) { process.stderr.write(`Unknown option ${a}\n\n${AYUDA}\n`); process.exit(2); }
    else o.roots.push(a);
  }
  if (!o.roots.length) o.roots.push('.');
  return o;
}

const o = args(process.argv.slice(2));
const lib = await Library.open(o.roots, { locale: o.locale, recursive: o.recursive });
// stdout es el canal MCP: los avisos van a stderr.
process.stderr.write(`spdf-mcp: ${lib.list().length} documents from ${o.roots.join(', ')}${lib.problems.length ? `; ${lib.problems.length} files skipped` : ''}\n`);
for (const p of lib.problems) process.stderr.write(`  skipped ${p.file}: ${p.error}\n`);

if (!o.http) {
  const server = createServer(lib);
  await server.connect(new StdioServerTransport());
} else {
  const permitidos = [`${o.host}:${o.http}`, `localhost:${o.http}`, `127.0.0.1:${o.http}`];
  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/mcp') { res.writeHead(404, { 'content-type': 'text/plain' }).end('spdf-mcp: POST /mcp\n'); return; }
    if (!permitidos.includes(String(req.headers.host))) { res.writeHead(403).end('Forbidden host\n'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
    // Sin estado: un servidor y un transporte por petición, sobre la misma biblioteca abierta.
    const server = createServer(lib);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  http.listen(o.http, o.host, () => process.stderr.write(`spdf-mcp: Streamable HTTP on http://${o.host}:${o.http}/mcp\n`));
}

const cerrar = async () => { await lib.close(); process.exit(0); };
process.on('SIGINT', () => void cerrar());
process.on('SIGTERM', () => void cerrar());
