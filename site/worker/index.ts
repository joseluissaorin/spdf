/**
 * El Worker de spdf.joseluissaorin.com. Casi todo son ficheros estáticos
 * (env.ASSETS); el Worker solo añade tres cosas:
 *
 *  1. Markdown para agentes: si la petición pide `Accept: text/markdown`, o la
 *     hace curl, wget o HTTPie, una hoja se responde con su gemelo .md (así un
 *     simple `curl` a la raíz devuelve el contenido legible). `?format=html`
 *     o `?format=md` fuerzan una u otra. Las hojas HTML anuncian su gemelo con
 *     una cabecera Link.
 *  2. SPDF Commons y las descargas del lector, desde R2 (con rangos HTTP, para
 *     que los lectores puedan abrir un .spdf remoto sin bajarlo entero).
 *  3. Cabeceras de seguridad comunes.
 */

interface Env {
  ASSETS: Fetcher;
  ARCHIVOS?: R2Bucket;
}

const AGENTES_DE_TERMINAL = /^(curl|wget|httpie|xh|lwp-request|python-urllib|aiohttp)\b/i;

/** ¿Es una ruta de hoja (no un fichero con extensión ni el lector)? */
function esHoja(ruta: string): boolean {
  if (ruta.startsWith('/reader') || ruta.startsWith('/assets/') || ruta.startsWith('/commons/files/') || ruta.startsWith('/download/files/')) return false;
  return !/\.[a-z0-9]+$/i.test(ruta);
}

function rutaMd(ruta: string): string {
  const r = ruta.replace(/\/+$/, '') || '/';
  return r === '/' ? '/index.md' : `${r}.md`;
}

function quiereMarkdown(req: Request, url: URL): boolean {
  const f = url.searchParams.get('format');
  if (f === 'md' || f === 'markdown') return true;
  if (f === 'html') return false;
  const accept = req.headers.get('accept') ?? '';
  if (/text\/markdown/i.test(accept)) {
    // Gana el Markdown si se pide antes que el HTML o con más peso.
    const peso = (tipo: string) => {
      const m = new RegExp(`${tipo.replace('/', '\\/')}\\s*(;\\s*q=([0-9.]+))?`, 'i').exec(accept);
      return m ? Number(m[2] ?? 1) : -1;
    };
    return peso('text/markdown') >= peso('text/html');
  }
  const ua = req.headers.get('user-agent') ?? '';
  return AGENTES_DE_TERMINAL.test(ua) && !/text\/html/i.test(accept);
}

function seguridad(h: Headers, ruta: string): void {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!ruta.startsWith('/reader')) h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/** Un fichero de R2, con soporte de Range e If-None-Match. */
async function desdeR2(env: Env, req: Request, clave: string, nombre: string): Promise<Response> {
  if (!env.ARCHIVOS) return new Response('Not configured', { status: 503 });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const obj = await env.ARCHIVOS.get(clave, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('ETag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, ETag, Accept-Ranges');
  h.set('Cache-Control', 'public, max-age=86400');
  if (!h.has('Content-Type')) h.set('Content-Type', nombre.endsWith('.spdf') ? 'application/vnd.spdf' : 'application/octet-stream');
  h.set('Content-Disposition', `attachment; filename="${nombre.replace(/"/g, '')}"`);
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });
  const cuerpo = (obj as R2ObjectBody).body;
  if (obj.range && 'offset' in obj.range) {
    const r = obj.range as { offset: number; length?: number };
    const fin = r.offset + (r.length ?? obj.size - r.offset) - 1;
    h.set('Content-Range', `bytes ${r.offset}-${fin}/${obj.size}`);
    h.set('Content-Length', String(fin - r.offset + 1));
    return new Response(req.method === 'HEAD' ? null : cuerpo, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(req.method === 'HEAD' ? null : cuerpo, { status: 200, headers: h });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ruta = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, If-None-Match, Accept', 'Access-Control-Max-Age': '86400' } });
    }

    // R2: SPDF Commons y las descargas del lector.
    const commons = /^\/commons\/files\/([^/]+)$/.exec(ruta);
    if (commons) return desdeR2(env, req, `commons/${commons[1]}`, commons[1]!);
    const descarga = /^\/download\/files\/(.+)$/.exec(ruta);
    if (descarga && !descarga[1]!.includes('..')) return desdeR2(env, req, `reader/${descarga[1]}`, descarga[1]!.split('/').pop()!);

    // Markdown para agentes.
    if ((req.method === 'GET' || req.method === 'HEAD') && esHoja(ruta) && quiereMarkdown(req, url)) {
      const md = await env.ASSETS.fetch(new Request(new URL(rutaMd(ruta), url), { method: req.method }));
      if (md.ok) {
        const h = new Headers(md.headers);
        h.set('Content-Type', 'text/markdown; charset=utf-8');
        h.set('Vary', 'Accept, User-Agent');
        h.set('Link', `<${url.origin}${ruta}>; rel="canonical"; type="text/html"`);
        h.set('Access-Control-Allow-Origin', '*');
        seguridad(h, ruta);
        return new Response(md.body, { status: 200, headers: h });
      }
    }

    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    seguridad(h, ruta);
    if (esHoja(ruta) && (h.get('content-type') ?? '').includes('text/html')) {
      h.append('Link', `<${url.origin}${rutaMd(ruta)}>; rel="alternate"; type="text/markdown"`);
      h.append('Link', `<${url.origin}/llms.txt>; rel="describedby"; type="text/plain"`);
      h.set('Vary', 'Accept, User-Agent');
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
} satisfies ExportedHandler<Env>;
