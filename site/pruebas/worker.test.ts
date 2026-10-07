/**
 * Pruebas del Worker con unos assets y un R2 de mentira: Markdown para
 * agentes (Accept, curl, ?format), cabeceras Link y de seguridad, y ficheros
 * de R2 con rangos.
 */
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';

const FICHEROS: Record<string, { cuerpo: string; tipo: string }> = {
  '/': { cuerpo: '<!doctype html><h1>SPDF</h1>', tipo: 'text/html' },
  '/spec': { cuerpo: '<!doctype html><h1>Spec</h1>', tipo: 'text/html' },
  '/index.md': { cuerpo: '# SPDF\n', tipo: 'text/markdown' },
  '/spec.md': { cuerpo: '# Spec\n', tipo: 'text/markdown' },
  '/reader/': { cuerpo: '<!doctype html>lector', tipo: 'text/html' },
};

const ASSETS = {
  async fetch(req: Request | string) {
    const url = new URL(typeof req === 'string' ? req : req.url);
    const f = FICHEROS[url.pathname];
    if (!f) return new Response('no', { status: 404, headers: { 'content-type': 'text/html' } });
    const h = new Headers({ 'content-type': f.tipo });
    if (url.pathname.startsWith('/reader')) h.set('Referrer-Policy', 'no-referrer');
    return new Response(f.cuerpo, { headers: h });
  },
} as unknown as Fetcher;

const DATOS = new TextEncoder().encode('0123456789');
const ARCHIVOS = {
  async get(clave: string, o: { range?: Headers }) {
    if (clave !== 'commons/x.spdf') return null;
    const rango = o.range?.get('range');
    const m = rango ? /bytes=(\d+)-(\d+)/.exec(rango) : null;
    const offset = m ? Number(m[1]) : 0;
    const length = m ? Number(m[2]) - offset + 1 : DATOS.length;
    return {
      size: DATOS.length, httpEtag: '"e"', range: m ? { offset, length } : undefined,
      body: new Blob([DATOS.slice(offset, offset + length)]).stream(),
      writeHttpMetadata(h: Headers) { h.set('content-type', 'application/vnd.spdf'); },
    };
  },
} as unknown as R2Bucket;

const env = { ASSETS, ARCHIVOS };
const pedir = (ruta: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://spdf.joseluissaorin.com${ruta}`, { headers }), env as never);

describe('el Worker', () => {
  it('un navegador recibe HTML con el gemelo anunciado', async () => {
    const r = await pedir('/spec', { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0' });
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('link')).toContain('</spec.md>; rel="alternate"; type="text/markdown"'.replace('</', '<https://spdf.joseluissaorin.com/'));
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('curl a la raíz recibe el Markdown de la portada', async () => {
    const r = await pedir('/', { accept: '*/*', 'user-agent': 'curl/8.7.1' });
    expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await r.text()).toBe('# SPDF\n');
  });

  it('Accept: text/markdown gana; ?format lo fuerza', async () => {
    expect(await (await pedir('/spec', { accept: 'text/markdown' })).text()).toBe('# Spec\n');
    expect(await (await pedir('/spec?format=html', { 'user-agent': 'curl/8' })).text()).toContain('<h1>Spec</h1>');
    expect(await (await pedir('/spec?format=md', { accept: 'text/html' })).text()).toBe('# Spec\n');
    expect((await pedir('/spec', { accept: 'text/html;q=1, text/markdown;q=0.5' })).headers.get('content-type')).toContain('text/html');
  });

  it('el lector no se toca y conserva sus cabeceras', async () => {
    const r = await pedir('/reader/', { 'user-agent': 'curl/8' });
    expect(await r.text()).toContain('lector');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('SPDF Commons sale de R2, con rangos', async () => {
    const todo = await pedir('/commons/files/x.spdf');
    expect(todo.status).toBe(200);
    expect(todo.headers.get('accept-ranges')).toBe('bytes');
    expect(await todo.text()).toBe('0123456789');
    const parte = await pedir('/commons/files/x.spdf', { range: 'bytes=2-5' });
    expect(parte.status).toBe(206);
    expect(parte.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await parte.text()).toBe('2345');
    expect((await pedir('/commons/files/no.spdf')).status).toBe(404);
  });
});
