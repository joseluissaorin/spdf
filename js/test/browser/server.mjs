// Static server for the browser tests: serves js/ and conformance/, honours Range
// requests and counts the bytes it sends per path (for the remote-reading measurement).
import { createServer } from 'node:http';
import { stat, readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.spdf': 'application/vnd.spdf', '.map': 'application/json' };

export function startServer({ roots, extra = {}, port = 0 }) {
  const counters = new Map();
  const count = (path, n) => {
    const c = counters.get(path) ?? { requests: 0, bytes: 0 };
    c.requests++;
    c.bytes += n;
    counters.set(path, c);
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__cases') {
        const dir = roots['/conformance/'];
        const files = (await readdir(join(dir, 'cases'))).filter((f) => f.endsWith('.json')).map((f) => `cases/${f}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(files));
      }
      let file = extra[url.pathname];
      if (!file) {
        const prefix = Object.keys(roots).filter((p) => url.pathname.startsWith(p)).sort((a, b) => b.length - a.length)[0];
        if (!prefix) {
          res.writeHead(404);
          return res.end();
        }
        const rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
        if (rel.startsWith('..')) {
          res.writeHead(403);
          return res.end();
        }
        file = join(roots[prefix], rel);
      }
      const st = await stat(file);
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };
      const range = req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (range) {
        const a = Number(range[1]);
        const b = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (a >= st.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
        count(url.pathname, b - a + 1);
        return createReadStream(file, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      count(url.pathname, st.size);
      if (req.method === 'HEAD') return res.end();
      return res.end(await readFile(file));
    } catch (e) {
      res.writeHead(404);
      res.end(String(e));
    }
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, counters, reset: () => counters.clear() })),
  );
}
