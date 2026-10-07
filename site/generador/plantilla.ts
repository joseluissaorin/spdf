/**
 * El marco de cada hoja: <head> con todo lo que leen buscadores y agentes
 * (canónica, hreflang, gemelo .md, Open Graph, JSON-LD), la cabecera con la
 * navegación, el pie y el poco JavaScript que hace falta (copiar código y que
 * los dibujos se dibujen al entrar en pantalla).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOR, type Clave, type Lengua, NAV, ORIGEN, OTRA, REPO, REPO_PUBLICO, RUTAS, SITIO, UI, VERSION, esc, rutaMd } from './sitio';
import type { Encabezado } from './md';

function compactar(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').replace(/calc\(([^)]*)\)/g, (m) => m.replace(/([+-])(?=[\d(v])/g, ' $1 ')).trim();
}

let cssListo = '';
export function estilos(): string {
  if (cssListo) return cssListo;
  const propio = readFileSync(resolve(SITIO, 'generador/estilo.css'), 'utf8');
  const dibujos = readFileSync(resolve(SITIO, 'dibujo/dibujos.css'), 'utf8');
  cssListo = compactar(propio) + compactar(dibujos);
  return cssListo;
}

/** En línea en el <head>: decide si los dibujos se animan antes del primer pintado. */
const SCRIPT_CABEZA = `try{if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('anima')}catch(e){}`;

export interface Hoja {
  clave: Clave | string;
  lengua: Lengua;
  ruta: string;
  /** La misma hoja en la otra lengua. */
  alterna: string;
  titulo: string;
  /** Título para <title>, si no es «titulo · SPDF». */
  tituloPestana?: string;
  descripcion: string;
  fecha: string;
  cuerpo: string;
  /** JSON-LD propio de la hoja (se añade al grafo común). */
  ld?: Record<string, unknown>[];
  tipoOg?: 'website' | 'article';
  /** Clave de navegación que se marca como actual. */
  seccion?: Clave;
  scripts?: string[];
  /** Hojas de estilo extra (p. ej. la del validador). */
  estiloExtra?: string;
  /** Sin la cabecera de idiomas alternos (p. ej. una RFC que solo existe en inglés). */
  sinAlterna?: boolean;
  /** El gemelo en Markdown existe (casi siempre). */
  conMd?: boolean;
}

export const ID = {
  autor: `${ORIGEN}/#autor`,
  sitio: `${ORIGEN}/#sitio`,
  formato: `${ORIGEN}/#formato`,
  spec: `${ORIGEN}/spec#especificacion`,
};

export function persona() {
  return {
    '@type': 'Person', '@id': ID.autor, name: AUTOR.nombre, url: AUTOR.web,
    jobTitle: 'Filólogo y programador',
    address: { '@type': 'PostalAddress', addressLocality: 'Santa Cruz de Tenerife', addressRegion: 'Canarias', addressCountry: 'ES' },
    sameAs: ['https://github.com/joseluissaorin'],
  };
}

function sitioWeb(l: Lengua) {
  return {
    '@type': 'WebSite', '@id': ID.sitio, name: 'SPDF', alternateName: 'Semantic Processed Document Format', url: `${ORIGEN}/`, inLanguage: ['en', 'es'],
    publisher: { '@id': ID.autor }, about: { '@id': ID.formato },
    description: l === 'es'
      ? 'La web del estándar abierto SPDF: especificación, implementaciones, validador en el navegador, lector y colección de documentos de dominio público.'
      : 'Home of the SPDF open standard: specification, implementations, in-browser validator, reader and a collection of public-domain documents.',
  };
}

/** El formato en sí, como obra definida (el «qué» de toda la web). */
export function formato(l: Lengua) {
  return {
    '@type': 'DefinedTerm', '@id': ID.formato, name: 'SPDF', alternateName: ['Semantic Processed Document Format', '.spdf', 'application/vnd.spdf+sqlite3'],
    description: l === 'es'
      ? 'Formato de fichero abierto (SQLite 3) para documentos ya leídos: cada pasaje lleva su ancla exacta (página impresa, folio, segundo, diapositiva, verso) para que una cita solo pueda imprimir lo que dice la fuente.'
      : 'An open file format (SQLite 3) for documents that have already been read: every passage carries its exact anchor (printed page, folio, second, slide, verse) so a citation can only print what the source says.',
    inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'File formats' },
    url: `${ORIGEN}/`,
  };
}

function migas(h: Hoja): Record<string, unknown> {
  const inicio = RUTAS.inicio[h.lengua];
  const elementos = [{ '@type': 'ListItem', position: 1, name: 'SPDF', item: `${ORIGEN}${inicio}` }];
  if (h.ruta !== inicio) elementos.push({ '@type': 'ListItem', position: 2, name: h.titulo, item: `${ORIGEN}${h.ruta}` });
  return { '@type': 'BreadcrumbList', '@id': `${ORIGEN}${h.ruta}#migas`, itemListElement: elementos };
}

function grafo(h: Hoja): string {
  const url = `${ORIGEN}${h.ruta}`;
  const pagina = {
    '@type': 'WebPage', '@id': `${url}#pagina`, url, name: h.titulo, description: h.descripcion, inLanguage: h.lengua,
    isPartOf: { '@id': ID.sitio }, about: { '@id': ID.formato }, author: { '@id': ID.autor }, publisher: { '@id': ID.autor },
    dateModified: h.fecha, breadcrumb: { '@id': `${url}#migas` },
    license: 'https://creativecommons.org/licenses/by/4.0/',
    encoding: { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: `${ORIGEN}${rutaMd(h.ruta)}` },
  };
  const g = { '@context': 'https://schema.org', '@graph': [persona(), sitioWeb(h.lengua), formato(h.lengua), pagina, migas(h), ...(h.ld ?? [])] };
  return JSON.stringify(g).replace(/</g, '\\u003c');
}

function cabecera(h: Hoja): string {
  const u = UI[h.lengua];
  const enlace = (c: Clave) => `<a href="${RUTAS[c][h.lengua]}"${h.seccion === c ? ' aria-current="page"' : ''}>${u.nav[c]}</a>`;
  return `<header class="cabecera">
<a class="marca" href="${RUTAS.inicio[h.lengua]}">SPDF <small>${VERSION}</small></a>
<nav aria-label="${u.principal}">${NAV.map(enlace).join('')}<a class="lector" href="/reader/">${u.lector}</a><a class="lengua" href="${h.alterna}" hreflang="${OTRA[h.lengua]}" lang="${OTRA[h.lengua]}" title="${u.otraTitulo}">${u.otra}</a></nav>
</header>`;
}

function pie(h: Hoja): string {
  const u = UI[h.lengua];
  const l = h.lengua;
  const todas: Clave[] = ['spec', 'implementaciones', 'docs', 'validador', 'descargas', 'commons', 'integraciones', 'gobernanza', 'citar', 'agentes'];
  const año = h.fecha.slice(0, 4);
  return `<footer class="pie"><div class="pie-dentro">
<div>
<p class="lema">SPDF, <em>${u.lema}</em>.</p>
<p class="legal">${u.licencia}</p>
<p class="legal">${l === 'es' ? 'Nació como formato interno de' : 'Born as the internal format of'} <a href="https://scholaris.joseluissaorin.com">Scholaris</a>.${REPO_PUBLICO ? ` <a href="${REPO}">GitHub</a>.` : ''}</p>
</div>
<nav aria-label="${u.pie}"><h2>${l === 'es' ? 'La web' : 'The site'}</h2><ul>${todas.map((c) => `<li><a href="${RUTAS[c][l]}">${u.nav[c]}</a></li>`).join('')}<li><a href="/reader/">${u.lector}</a></li></ul></nav>
<div><h2>${u.paraMaquinas}</h2><ul>
<li><a href="${rutaMd(h.ruta)}" type="text/markdown">${l === 'es' ? 'Esta hoja en Markdown' : 'This page as Markdown'}</a></li>
<li><a href="/llms.txt" type="text/plain">llms.txt</a></li>
<li><a href="/llms-full.txt" type="text/plain">llms-full.txt</a></li>
<li><a href="/sitemap.xml">sitemap.xml</a></li>
<li><a href="/status.json" type="application/json">status.json</a></li>
</ul></div>
<p class="colofon rotulo"><span>© ${año} <a href="${AUTOR.web}" rel="author">${AUTOR.nombre}</a> · Santa Cruz de Tenerife</span><span>application_id 0x53504446 · user_version 500</span></p>
</div></footer>`;
}

export function html(h: Hoja): string {
  const u = UI[h.lengua];
  const url = `${ORIGEN}${h.ruta}`;
  const titulo = h.tituloPestana ?? `${h.titulo} · SPDF`;
  const es = h.lengua === 'es' ? h.ruta : h.alterna;
  const en = h.lengua === 'en' ? h.ruta : h.alterna;
  const tarjeta = `${ORIGEN}/tarjeta-${h.lengua}.png`;
  return `<!doctype html>
<html lang="${h.lengua}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(h.descripcion)}">
<meta name="author" content="${AUTOR.nombre}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="${url}">
${h.sinAlterna ? '' : `<link rel="alternate" hreflang="en" href="${ORIGEN}${en}">
<link rel="alternate" hreflang="es" href="${ORIGEN}${es}">
<link rel="alternate" hreflang="x-default" href="${ORIGEN}${en}">`}
<link rel="alternate" type="text/markdown" title="${esc(h.titulo)} (Markdown)" href="${ORIGEN}${rutaMd(h.ruta)}">
<link rel="alternate" type="text/plain" title="llms.txt" href="${ORIGEN}/llms.txt">
<link rel="author" href="${AUTOR.web}">
<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">
<meta name="theme-color" content="#f5f0e8">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fuentes/mano.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="${h.tipoOg ?? 'article'}">
<meta property="og:site_name" content="SPDF">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(h.titulo)}">
<meta property="og:description" content="${esc(h.descripcion)}">
<meta property="og:image" content="${tarjeta}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${h.lengua === 'es' ? 'es_ES' : 'en_GB'}">
<meta property="og:locale:alternate" content="${h.lengua === 'es' ? 'en_GB' : 'es_ES'}">
<meta name="twitter:card" content="summary_large_image">
<style>${estilos()}${h.estiloExtra ?? ''}</style>
<script>${SCRIPT_CABEZA}</script>
<script type="application/ld+json">${grafo(h)}</script>
</head>
<body>
<a class="saltar" href="#contenido">${u.saltar}</a>
${cabecera(h)}
<main id="contenido">
${h.cuerpo}
</main>
${pie(h)}
<script src="/sitio.js" defer></script>
${(h.scripts ?? []).map((s) => `<script type="module" src="${s}"></script>`).join('\n')}
</body>
</html>
`;
}

/** Índice lateral de una hoja larga: los h2 (y los h3 si se pide). */
export function indice(enc: Encabezado[], l: Lengua, o: { conH3?: boolean; extra?: string; md: string } ): string {
  const u = UI[l];
  const lista = enc.filter((e) => e.nivel === 2 || (o.conH3 && e.nivel === 3));
  if (!lista.length && !o.extra) return '';
  return `<aside class="indice" aria-labelledby="indice-t"><div class="pegado">
<h2 id="indice-t">${u.enEsta}</h2>
<ol>${lista.map((e) => `<li class="n${e.nivel}"><a href="#${e.id}">${esc(e.texto)}</a></li>`).join('')}</ol>
${o.extra ?? ''}
<h2>${u.paraMaquinas}</h2>
<div class="formatos"><a href="${o.md}" type="text/markdown">${l === 'es' ? 'Esta hoja en .md' : 'This page as .md'}</a><a href="/llms.txt" type="text/plain">llms.txt</a><a href="/llms-full.txt" type="text/plain">llms-full.txt</a></div>
</div></aside>`;
}

export function fechaLegible(fecha: string, l: Lengua): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString(l === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
