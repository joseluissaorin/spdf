/**
 * Construye la web entera en site/dist: cada hoja en HTML estático (se lee sin
 * JavaScript) y en su gemelo .md, la especificación renderizada desde
 * spec/SPEC.md y spec/SPEC.es.md, la documentación de cada implementación desde
 * su README, el estado del CI, los ficheros para agentes (llms.txt,
 * llms-full.txt, sitemap, robots), el JavaScript del validador y, si existe,
 * la build web del lector en /reader.
 *
 *   npm run build            (con red: pregunta a GitHub por el CI)
 *   SPDF_SIN_RED=1 npm run build
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { aSvg, type Dibujo } from '../dibujo/boceto';
import { compas } from '../dibujo/dibujos/compas';
import { escuadra } from '../dibujo/dibujos/escuadra';
import { tintero } from '../dibujo/dibujos/tintero';
import { estante } from '../dibujo/dibujos/estante';
import { sobre } from '../dibujo/dibujos/sobre';
import { regla } from '../dibujo/dibujos/regla';
import { transportador } from '../dibujo/dibujos/transportador';
import { notaFolio } from '../dibujo/dibujos/nota-folio';
import { imprenta } from '../dibujo/dibujos/imprenta';
import { paginaArrancada } from '../dibujo/dibujos/pagina-arrancada';
import { aHtml, frontal, textoPlano, type Encabezado } from './md';
import { bilingue } from './notas';
import { html, indice, fechaLegible, ID, type Hoja } from './plantilla';
import { portadaHtml, portadaMd, TEXTOS as PORTADA, type EjemploAncla } from './portada';
import { estados, estadoDe, etiquetaEstado, type Estado } from './estado';
import {
  AUTOR, IMPLEMENTACIONES, INTEGRACIONES, LENGUAS, ORIGEN, OTRA, OTRAS_PIEZAS, PUBLICADO, RAIZ, REPO, REPO_PUBLICO, RUTAS, SITIO, UI, VERSION,
  esc, ficheroHtml, rutaMd, type Clave, type Lengua,
} from './sitio';
import { commonsBloque, cargarCommons } from './commons';
import { descargasBloque } from './descargas';
import { validadorBloque, VALIDADOR_CSS } from './validador';

const DIST = resolve(SITIO, 'dist');
const HOY = new Date().toISOString().slice(0, 10);
/** Celda vacía de una tabla (la raya, sola). */
const NADA = '\u2014';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const leer = (p: string) => readFileSync(p, 'utf8');
const existe = (p: string) => existsSync(p);

function escribir(rel: string, contenido: string | Buffer): void {
  const destino = join(DIST, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}

/** Fecha (AAAA-MM-DD) del último commit que tocó estas rutas, o hoy. */
function fechaGit(rutas: string[]): string {
  try {
    const f = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...rutas], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  } catch { /* sin git */ }
  return HOY;
}

export function vineta(d0: Dibujo, l: Lengua, clase = 'vineta'): string {
  return `<div class="${clase}" aria-hidden="true">${aSvg(bilingue(d0), { lengua: l, decorativo: true })}</div>`;
}

const VINETAS: Partial<Record<Clave, Dibujo>> = {
  spec: compas, implementaciones: escuadra, docs: tintero, descargas: imprenta, commons: estante,
  integraciones: transportador, gobernanza: sobre, citar: notaFolio, agentes: regla,
};

// ---------------------------------------------------------------------------
// Bloques dinámicos (HTML y su versión Markdown)
// ---------------------------------------------------------------------------

export interface Bloque { html: string; md: string }

function estadoBloque(l: Lengua, e: Record<string, Estado>): Bloque {
  const cab = l === 'es'
    ? ['Implementación', 'Paquete', 'Nivel', 'CI en main', 'Último run']
    : ['Implementation', 'Package', 'Tier', 'CI on main', 'Last run'];
  const nivel = (n: 1 | 2) => (n === 1 ? (l === 'es' ? 'primer nivel' : 'first tier') : (l === 'es' ? 'segundo nivel' : 'second tier'));
  const cuando = (s: Estado) => (s.fecha ? `<time datetime="${s.fecha}">${fechaLegible(s.fecha.slice(0, 10), l)}</time>${s.commit ? `<small><code>${s.commit}</code></small>` : ''}` : NADA);
  const filas = IMPLEMENTACIONES.map((im) => {
    const s = estadoDe(e, im.carpeta);
    const c = s.conformidad;
    const barra = c && c.pasados + c.fallidos > 0 ? `<span class="barra" aria-hidden="true"><i style="width:${Math.round((100 * c.pasados) / (c.pasados + c.fallidos))}%"></i></span>` : '';
    return `<tr><td><a href="${RUTAS.docs[l]}/${im.id}">${esc(im.nombre)}</a> <code class="paquete">${esc(im.paquete)}</code><small>${esc(im.nota[l])} · ${nivel(im.nivel)}</small></td><td>${barra}${etiquetaEstado(s, l)}</td><td>${cuando(s)}</td></tr>`;
  }).join('');
  const otras = OTRAS_PIEZAS.map((o) => {
    const s = estadoDe(e, o.carpeta);
    return `<tr><td>${esc(o.nombre[l])} <code class="paquete">${o.carpeta}/</code></td><td>${etiquetaEstado(s, l)}</td><td>${cuando(s)}</td></tr>`;
  }).join('');
  const nota = l === 'es'
    ? `<p class="rotulo">Comprobado al construir esta web, el ${fechaLegible(HOY, l)}. También en <a href="/status.json">/status.json</a>.</p>`
    : `<p class="rotulo">Checked when this site was built, on ${fechaLegible(HOY, l)}. Also as <a href="/status.json">/status.json</a>.</p>`;
  const htmlT = `<div class="tabla" tabindex="0"><table class="estado-impl"><thead><tr><th scope="col">${cab[0]}</th><th scope="col">${cab[3]}</th><th scope="col">${cab[4]}</th></tr></thead><tbody>${filas}${otras}</tbody></table></div>${nota}`;
  const md = [
    `| ${cab.join(' | ')} |`, '| --- | --- | --- | --- | --- |',
    ...IMPLEMENTACIONES.map((im) => {
      const s = estadoDe(e, im.carpeta);
      return `| ${im.nombre} | \`${im.paquete}\` | ${nivel(im.nivel)} | ${etiquetaEstado(s, l, true)} | ${s.fecha?.slice(0, 10) ?? NADA} |`;
    }),
    ...OTRAS_PIEZAS.map((o) => { const s = estadoDe(e, o.carpeta); return `| ${o.nombre[l]} | \`${o.carpeta}/\` | ${NADA} | ${etiquetaEstado(s, l, true)} | ${s.fecha?.slice(0, 10) ?? NADA} |`; }),
    '', `${l === 'es' ? 'Comprobado el' : 'Checked on'} ${HOY}. JSON: ${ORIGEN}/status.json`,
  ].join('\n');
  return { html: htmlT, md };
}

/** La tabla de clases de producto del README raíz (entre <!-- product-status:start --> y :end), traducida al castellano si hace falta. */
function clasesBloque(l: Lengua): Bloque {
  const readme = resolve(RAIZ, 'README.md');
  const m = existe(readme) ? /<!-- product-status:start -->\s*([\s\S]*?)\s*<!-- product-status:end -->/.exec(leer(readme)) : null;
  if (!m) return { html: '', md: '' };
  let tabla = m[1]!.trim();
  if (l === 'es') {
    const T: [RegExp, string][] = [
      [/\bImplementation\b/, 'Implementación'], [/\bFolder\b/, 'Carpeta'], [/\bSemantic reader\b/, 'Lector semántico'], [/\| Reader \|/, '| Lector |'],
      [/\bWriter\b/, 'Escritor'], [/\bValidator\b/, 'Validador'], [/Suite (\d)/g, 'Batería $1'], [/\| yes \|/g, '| sí |'], [/\| untested \|/g, '| sin probar |'],
      [/\| pending \|/g, '| pendiente |'], [/\(reference\)/, '(referencia)'], [/outputs validate/, 'lo que produce valida'], [/own checks/, 'pruebas propias'], [/Producer/, 'Productor'],
    ];
    for (const [a, b] of T) tabla = tabla.replace(a, b);
    // Dos pasadas para las celdas contiguas («| yes | yes |»).
    tabla = tabla.replace(/\| yes \|/g, '| sí |').replace(/\| untested \|/g, '| sin probar |').replace(/\| pending \|/g, '| pendiente |');
  }
  return { html: aHtml(tabla, { enlace: () => null }).html, md: tabla };
}

function docsBloque(l: Lengua, e: Record<string, Estado>): Bloque {
  const li = IMPLEMENTACIONES.map((im) => `<li><a href="${RUTAS.docs[l]}/${im.id}"><strong>${esc(im.nombre)}</strong><span><code>${esc(im.instalar)}</code></span><span>${esc(im.nota[l])}</span>${etiquetaEstado(estadoDe(e, im.carpeta), l)}</a></li>`).join('');
  const md = IMPLEMENTACIONES.map((im) => `- [${im.nombre}](${ORIGEN}${rutaMd(`${RUTAS.docs[l]}/${im.id}`)}): \`${im.instalar}\`. ${im.nota[l]}`).join('\n');
  return { html: `<ul class="hojas">${li}</ul>`, md };
}

function integracionesBloque(l: Lengua): Bloque {
  const hay = (c: string) => existe(resolve(RAIZ, 'integrations', c, 'README.md'));
  const lista = INTEGRACIONES.filter((i) => hay(i.carpeta));
  const html = `<ul class="hojas">${lista.map((i) => `<li><a href="${RUTAS.integraciones[l]}/${i.id}"><strong>${esc(i.nombre[l])}</strong><span>${esc(i.resumen[l])}</span><span class="rotulo">integrations/${i.carpeta}</span></a></li>`).join('')}</ul>`;
  const md = lista.map((i) => `- [${i.nombre[l]}](${ORIGEN}${rutaMd(`${RUTAS.integraciones[l]}/${i.id}`)}): ${i.resumen[l]}`).join('\n');
  return { html, md };
}

/** Cada integración, con su README entero (en inglés) en su propia hoja. */
function integracionesSubhojas(): void {
  for (const i of INTEGRACIONES) {
    const readme = resolve(RAIZ, 'integrations', i.carpeta, 'README.md');
    if (!existe(readme)) continue;
    const cuerpo = frontal(leer(readme)).cuerpo.replace(/^#\s+.+\n/, '');
    for (const l of LENGUAS) {
      const ruta = `${RUTAS.integraciones[l]}/${i.id}`;
      const enlace = enlaceRepo(`integrations/${i.carpeta}`, l);
      hoja({
        clave: `integracion-${i.id}`, seccion: 'integraciones', l, ruta, alterna: `${RUTAS.integraciones[OTRA[l]]}/${i.id}`,
        titulo: i.nombre[l], descripcion: i.resumen[l], md: `${l === 'es' ? '*El README de la integración está en inglés, como su código.*\n\n' : ''}${cuerpo}`,
        fecha: fechaGit([`integrations/${i.carpeta}/README.md`]), miga: [{ texto: UI[l].nav.integraciones, ruta: RUTAS.integraciones[l] }], enlace,
        ld: [{ '@type': 'SoftwareSourceCode', '@id': `${ORIGEN}${RUTAS.integraciones.en}/${i.id}#codigo`, name: i.nombre.en, description: i.resumen.en, license: ['https://opensource.org/licenses/MIT', 'https://www.apache.org/licenses/LICENSE-2.0'], author: { '@id': ID.autor }, about: { '@id': ID.formato }, url: `${ORIGEN}${ruta}` }],
      });
    }
  }
}

function citaSpecBloque(l: Lengua): Bloque {
  const bib = `@techreport{spdf-5.0,
  author      = {Saor{\\'\\i}n Ferrer, Jos{\\'e} Luis},
  title       = {{SPDF}: Semantic Processed Document Format. Specification, version ${VERSION}},
  year        = {2026},
  institution = {spdf.joseluissaorin.com},
  url         = {${ORIGEN}/spec},
  note        = {CC BY 4.0}
}`;
  const csl = JSON.stringify([{
    id: 'spdf-5.0', type: 'report', title: `SPDF: Semantic Processed Document Format. Specification, version ${VERSION}`,
    author: [{ family: 'Saorín Ferrer', given: 'José Luis' }], issued: { 'date-parts': [[2026]] }, URL: `${ORIGEN}/spec`, version: VERSION, language: 'en',
  }], null, 2);
  const cff = `cff-version: 1.2.0
message: "${l === 'es' ? 'Si usas SPDF, cita su especificación así.' : 'If you use SPDF, please cite its specification as below.'}"
title: "SPDF: Semantic Processed Document Format. Specification"
version: "${VERSION}"
date-released: ${PUBLICADO}
authors:
  - family-names: "Saorín Ferrer"
    given-names: "José Luis"
url: "${ORIGEN}/spec"
license: CC-BY-4.0`;
  const md = `\`\`\`bibtex\n${bib}\n\`\`\`\n\n\`\`\`json\n${csl}\n\`\`\`\n\n\`\`\`yaml\n${cff}\n\`\`\``;
  return { html: aHtml(md, { copiar: UI[l].copiar }).html, md };
}

function rfcsBloque(l: Lengua): Bloque {
  const dir = resolve(RAIZ, 'spec/rfcs');
  const rfcs = existe(dir) ? readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.endsWith('.es.md') && !f.startsWith('0000')).sort() : [];
  const titulo = l === 'es' ? 'Las RFC' : 'The RFCs';
  if (!rfcs.length) {
    const t = l === 'es' ? 'Todavía no hay ninguna RFC publicada. La plantilla y la primera, la que fija la versión 5.0, están en preparación.' : 'No RFC has been published yet. The template and the first one, which fixes version 5.0, are being prepared.';
    return { html: `<h2 id="rfcs">${titulo}</h2><p>${t}</p>`, md: `## ${titulo}\n\n${t}` };
  }
  const items = rfcs.map((f) => {
    const { datos, cuerpo } = frontal(leer(join(dir, f)));
    const h1 = /^#\s+(.+)$/m.exec(cuerpo)?.[1] ?? f;
    const estado = datos.status ?? datos.estado ?? (/^\s*(?:[-*]\s*)?\**(?:Status|Estado)\**\s*:?\**\s*(.+)$/im.exec(cuerpo)?.[1] ?? '');
    return { f, n: f.slice(0, 4), titulo: h1.replace(/^RFC\s*\d+\s*[:·.-]\s*/i, '').replace(/[`*]/g, ''), estado: estado.replace(/[*|]/g, '').trim() };
  });
  const base = `${RUTAS.gobernanza[l]}/rfcs`;
  const plantilla = existe(join(dir, '0000-template.md')) ? `<p><a href="${base}/0000">${l === 'es' ? 'La plantilla para escribir una RFC' : 'The template for writing an RFC'}</a></p>` : '';
  const htmlL = `<h2 id="rfcs">${titulo}</h2><ul class="hojas">${items.map((r) => `<li><a href="${base}/${r.n}"><strong>RFC ${r.n}</strong><span>${esc(r.titulo)}</span>${r.estado ? `<span class="rotulo">${esc(r.estado)}</span>` : ''}</a></li>`).join('')}</ul>${plantilla}`;
  const md = `## ${titulo}\n\n${items.map((r) => `- [RFC ${r.n}: ${r.titulo}](${ORIGEN}${base}/${r.n}.md)${r.estado ? ` (${r.estado})` : ''}`).join('\n')}`;
  return { html: htmlL, md };
}

// ---------------------------------------------------------------------------
// Hojas de contenido
// ---------------------------------------------------------------------------

interface Contenido { titulo: string; corto: string; descripcion: string; cuerpo: string }

function contenido(clave: string, l: Lengua): Contenido {
  const { datos, cuerpo } = frontal(leer(resolve(SITIO, `contenido/${l}/${clave}.md`)));
  return { titulo: datos.title ?? clave, corto: datos.short ?? datos.title ?? clave, descripcion: datos.description ?? '', cuerpo };
}

/** Enlaces internos del Markdown → en los gemelos .md, absolutos y a otros .md. */
function enlacesParaMd(md: string): string {
  return md
    .replace(/\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g, (_, ruta: string, ancla = '') => {
      if (/\.(txt|xml|json|md|spdf)$/.test(ruta) || ruta.startsWith('/reader') || ruta.startsWith('/commons/files')) return `](${ORIGEN}${ruta}${ancla})`;
      return `](${ORIGEN}${rutaMd(ruta)}${ancla})`;
    })
    .replace(/\s*\{#[\w-]+\}$/gm, '');
}

function markdownDe(h: { titulo: string; descripcion: string; ruta: string; alterna?: string; lengua: Lengua; fecha: string }, cuerpo: string): string {
  return `---
title: ${JSON.stringify(h.titulo)}
description: ${JSON.stringify(h.descripcion)}
url: ${ORIGEN}${h.ruta}
markdown: ${ORIGEN}${rutaMd(h.ruta)}
lang: ${h.lengua}
${h.alterna ? `alternate_${OTRA[h.lengua]}: ${ORIGEN}${rutaMd(h.alterna)}\n` : ''}updated: ${h.fecha}
author: ${AUTOR.nombre} (${AUTOR.web})
license: CC-BY-4.0
---

# ${h.titulo}

> ${h.descripcion}

${enlacesParaMd(cuerpo).trim()}
`;
}

/** Todo lo que se publica, para el sitemap, llms.txt y llms-full.txt. */
const PUBLICADAS: { ruta: string; alterna?: string; lengua: Lengua; titulo: string; descripcion: string; md: string; fecha: string; clave: string }[] = [];

interface OpcionesHoja {
  clave: string;
  seccion?: Clave;
  l: Lengua;
  ruta: string;
  alterna: string;
  titulo: string;
  descripcion: string;
  /** Markdown del cuerpo (sin título). */
  md: string;
  /** Bloques que sustituyen a <!-- nombre --> en HTML y en Markdown. */
  bloques?: Record<string, Bloque>;
  /** Trozos en línea que sustituyen a {{nombre}} (dentro de una lista o de una tabla). */
  enLinea?: Record<string, Bloque>;
  fecha: string;
  vineta?: Dibujo;
  miga?: { texto: string; ruta: string }[];
  ancho?: boolean;
  conH3?: boolean;
  bcp14?: boolean;
  aviso?: string;
  ld?: Record<string, unknown>[];
  scripts?: string[];
  estiloExtra?: string;
  enlace?: (href: string) => string | null;
  sinAlterna?: boolean;
  /** HTML extra al final del índice lateral. */
  extraIndice?: string;
}

function hoja(o: OpcionesHoja): void {
  const u = UI[o.l];
  const marcas: string[] = [];
  let md = o.md;
  let mdGemelo = o.md;
  for (const [nombre, b] of Object.entries(o.bloques ?? {})) {
    md = md.replace(`<!-- ${nombre} -->`, `\n\n<div data-bloque="${nombre}"></div>\n\n`);
    mdGemelo = mdGemelo.replace(`<!-- ${nombre} -->`, b.md);
    marcas.push(nombre);
  }
  for (const [nombre, b] of Object.entries(o.enLinea ?? {})) {
    md = md.split(`{{${nombre}}}`).join(`@@${nombre}@@`);
    mdGemelo = mdGemelo.split(`{{${nombre}}}`).join(b.md);
  }
  const { html: cuerpoHtml0, encabezados } = aHtml(md, { copiar: u.copiar, bcp14: o.bcp14, enlace: o.enlace });
  let cuerpoHtml = cuerpoHtml0;
  for (const [nombre, b] of Object.entries(o.enLinea ?? {})) cuerpoHtml = cuerpoHtml.split(`@@${nombre}@@`).join(b.html);
  for (const nombre of marcas) cuerpoHtml = cuerpoHtml.replace(new RegExp(`(<p>)?<div data-bloque="${nombre}"></div>(</p>)?`), o.bloques![nombre]!.html);
  const enc: Encabezado[] = [...encabezados];
  for (const nombre of marcas) for (const m of o.bloques![nombre]!.html.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)) enc.push({ nivel: 2, id: m[1]!, texto: m[2]! });
  const ordenados = enc.sort((a, b) => cuerpoHtml.indexOf(`id="${a.id}"`) - cuerpoHtml.indexOf(`id="${b.id}"`));

  const miga = [{ texto: 'SPDF', ruta: RUTAS.inicio[o.l] }, ...(o.miga ?? [])];
  const cabeza = `<header class="cabeza${o.vineta ? ' con-vineta' : ''}">
${o.vineta ? vineta(o.vineta, o.l) : ''}
<nav class="miga rotulo" aria-label="${o.l === 'es' ? 'Estás en' : 'You are here'}"><ol>${miga.map((m) => `<li><a href="${m.ruta}">${esc(m.texto)}</a></li>`).join('')}<li aria-current="page">${esc(o.titulo)}</li></ol></nav>
<h1>${esc(o.titulo)}</h1>
<p class="entradilla">${esc(o.descripcion)}</p>
<p class="datos rotulo"><span>${u.revisado} <time datetime="${o.fecha}">${fechaLegible(o.fecha, o.l)}</time></span><a href="${rutaMd(o.ruta)}" type="text/markdown">${u.markdown}</a></p>
</header>`;
  const aviso = o.aviso ? `<div class="aviso" role="note">${aHtml(o.aviso).html}</div>` : '';
  const lateral = o.ancho ? '' : indice(ordenados, o.l, { conH3: o.conH3, md: rutaMd(o.ruta), extra: o.extraIndice });
  const cuerpo = `<div class="marco${o.ancho || !lateral ? ' ancho' : ''}">
<article class="doc">
${cabeza}
${aviso}
<div class="cuerpo">
${cuerpoHtml}
</div>
</article>
${lateral}
</div>`;
  const h: Hoja = {
    clave: o.clave, lengua: o.l, ruta: o.ruta, alterna: o.alterna, titulo: o.titulo, descripcion: o.descripcion, fecha: o.fecha,
    cuerpo, seccion: o.seccion, ld: o.ld, scripts: o.scripts, estiloExtra: o.estiloExtra, sinAlterna: o.sinAlterna,
  };
  escribir(ficheroHtml(o.ruta), html(h));
  escribir(rutaMd(o.ruta).slice(1), markdownDe({ ...o, alterna: o.sinAlterna ? undefined : o.alterna, lengua: o.l }, mdGemelo));
  PUBLICADAS.push({ ruta: o.ruta, alterna: o.sinAlterna ? undefined : o.alterna, lengua: o.l, titulo: o.titulo, descripcion: o.descripcion, md: enlacesParaMd(mdGemelo), fecha: o.fecha, clave: o.clave });
}

// ---------------------------------------------------------------------------
// La especificación
// ---------------------------------------------------------------------------

/** `<a id="x"></a>` justo antes de un encabezado → el encabezado se queda con ese id. */
function idsFijos(md: string): string {
  return md.replace(/<a id="([\w-]+)"><\/a>[ \t]*\n(?:[ \t]*\n)*(#{1,6} [^\n]+)/g, (_, id: string, h: string) => `${h} {#${id}}`);
}

function especificacion(l: Lengua): void {
  const enLengua = resolve(RAIZ, l === 'es' ? 'spec/SPEC.es.md' : 'spec/SPEC.md');
  const ingles = resolve(RAIZ, 'spec/SPEC.md');
  const contrato = resolve(RAIZ, 'spec/CONTRACT.md');
  let fuente: string;
  let aviso: string | undefined;
  if (existe(enLengua)) {
    fuente = enLengua;
  } else if (existe(ingles)) {
    fuente = ingles;
    aviso = 'La traducción española de la especificación se está terminando. Mientras tanto, este es el texto normativo en inglés.';
  } else {
    fuente = contrato;
    aviso = l === 'es'
      ? '**Borrador de trabajo.** La especificación normativa (`spec/SPEC.md`) se está escribiendo. Mientras tanto, esta hoja enseña el **contrato de implementación** con el que trabajan hoy todas las implementaciones, en inglés; la especificación lo absorberá y lo sustituirá.'
      : '**Working draft.** The normative specification (`spec/SPEC.md`) is being written. Until it lands, this page shows the **implementation contract** every implementation codes against today; the specification will absorb and supersede it.';
  }
  const sinFrontal = frontal(leer(fuente)).cuerpo;
  const h1 = /^#\s+(.+)$/m.exec(sinFrontal);
  const cuerpo = idsFijos(h1 ? sinFrontal.replace(h1[0], '') : sinFrontal);
  const titulo = l === 'es' ? `Especificación de SPDF ${VERSION}` : `SPDF ${VERSION} specification`;
  const descripcion = l === 'es'
    ? `La especificación normativa del formato SPDF ${VERSION}: contenedor, esquema, anclas y su URI, ficha CSL-JSON, búsqueda, vectores, integridad, validación, cita y conformidad.`
    : `The normative specification of the SPDF ${VERSION} format: container, schema, anchors and their URI, CSL-JSON metadata, search, vectors, integrity, validation, citation and conformance.`;
  const rel = fuente.slice(RAIZ.length + 1);
  const fecha = fechaGit([rel]);
  const enlace = enlaceRepo('spec', l);
  hoja({
    clave: 'spec', seccion: 'spec', l, ruta: RUTAS.spec[l], alterna: RUTAS.spec[OTRA[l]], titulo, descripcion, md: cuerpo, fecha,
    vineta: compas, conH3: true, bcp14: true, aviso, enlace,
    extraIndice: `<p class="rotulo">${l === 'es' ? 'Fuente' : 'Source'}: <code>${rel}</code><br>CC BY 4.0</p>`,
    ld: [{
      '@type': 'TechArticle', '@id': `${ORIGEN}${RUTAS.spec[l]}#especificacion`, headline: titulo, name: titulo, description: descripcion,
      inLanguage: l, version: VERSION, author: { '@id': ID.autor }, publisher: { '@id': ID.autor }, license: 'https://creativecommons.org/licenses/by/4.0/',
      dateModified: fecha, datePublished: PUBLICADO, about: { '@id': ID.formato }, proficiencyLevel: 'Expert',
      url: `${ORIGEN}${RUTAS.spec[l]}`,
      encoding: { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: `${ORIGEN}${rutaMd(RUTAS.spec[l])}` },
      ...(l === 'es' ? { translationOfWork: { '@id': `${ORIGEN}${RUTAS.spec.en}#especificacion` } } : {}),
    }],
  });
}

// ---------------------------------------------------------------------------
// Documentación por lenguaje
// ---------------------------------------------------------------------------

function docsDeLenguaje(e: Record<string, Estado>): void {
  for (const im of IMPLEMENTACIONES) {
    for (const l of LENGUAS) {
      const carpeta = resolve(RAIZ, im.carpeta);
      const readmeEs = join(carpeta, 'README.es.md');
      const readme = l === 'es' && existe(readmeEs) ? readmeEs : join(carpeta, 'README.md');
      const s = estadoDe(e, im.carpeta);
      const titulo = l === 'es' ? `SPDF en ${im.nombre}` : `SPDF in ${im.nombre}`;
      const descripcion = l === 'es'
        ? `Cómo instalar y usar la implementación de SPDF en ${im.nombre} (${im.paquete}): abrir, validar, buscar y citar. ${im.nota.es}`
        : `How to install and use the ${im.nombre} implementation of SPDF (${im.paquete}): open, validate, search and cite. ${im.nota.en}`;
      const nivel = im.nivel === 1 ? (l === 'es' ? 'primero' : 'first') : (l === 'es' ? 'segundo' : 'second');
      const ficha = [
        `- **${l === 'es' ? 'Paquete' : 'Package'}**: \`${im.paquete}\``,
        `- **${l === 'es' ? 'Instalar' : 'Install'}**: \`${im.instalar}\``,
        ...(im.registro ? [`- **${l === 'es' ? 'Registro' : 'Registry'}**: [${im.registro.nombre}](${im.registro.url})`] : []),
        `- **${l === 'es' ? 'Nivel' : 'Tier'}**: ${nivel}`,
        `- **CI**: {{ci}}`,
        `- **${l === 'es' ? 'Carpeta' : 'Folder'}**: \`${im.carpeta}/\``,
      ].join('\n');
      const cabeza = ficha;
      let md: string;
      let fecha = HOY;
      if (existe(readme)) {
        const r = frontal(leer(readme)).cuerpo.replace(/^#\s+.+\n/, '');
        const lenguaReadme = readme.endsWith('.es.md') ? 'es' : lenguaDe(r);
        const nota = lenguaReadme === l ? '' : l === 'es' ? '\n\n*El README de la biblioteca está en inglés.*\n' : '\n\n*The README of this library is written in Spanish.*\n';
        md = `${cabeza}${nota}\n\n${r}`;
        fecha = fechaGit([`${im.carpeta}/README.md`]);
      } else {
        md = `${cabeza}\n\n${l === 'es'
          ? `La implementación en ${im.nombre} se está escribiendo. Cuando su README llegue al repositorio, aparecerá aquí entero, con ejemplos. Mientras tanto, la [especificación](${RUTAS.spec.es}) y la [documentación común](${RUTAS.docs.es}) cuentan lo que hará.`
          : `The ${im.nombre} implementation is being written. When its README lands in the repository it will appear here in full, with examples. Meanwhile, the [specification](${RUTAS.spec.en}) and the [common documentation](${RUTAS.docs.en}) describe what it will do.`}`;
      }
      const enlace = enlaceRepo(im.carpeta, l);
      const ruta = `${RUTAS.docs[l]}/${im.id}`;
      // El estado del CI va dentro de la tabla: se sustituye tras renderizar.
      const ci: Bloque = { html: etiquetaEstado(s, l), md: etiquetaEstado(s, l, true) };
      hoja({
        clave: `docs-${im.id}`, seccion: 'docs', l, ruta, alterna: `${RUTAS.docs[OTRA[l]]}/${im.id}`, titulo, descripcion, md, fecha,
        miga: [{ texto: UI[l].nav.docs, ruta: RUTAS.docs[l] }], enLinea: { ci }, enlace,
        ld: [{
          '@type': 'SoftwareSourceCode', '@id': `${ORIGEN}${RUTAS.docs.en}/${im.id}#codigo`, name: `SPDF for ${im.nombre}`, alternateName: im.paquete,
          programmingLanguage: im.nombre, ...(REPO_PUBLICO ? { codeRepository: `${REPO}/tree/main/${im.carpeta}` } : {}),
          license: ['https://opensource.org/licenses/MIT', 'https://www.apache.org/licenses/LICENSE-2.0'], author: { '@id': ID.autor },
          about: { '@id': ID.formato }, description: im.nota.en, url: `${ORIGEN}${ruta}`,
          ...(im.registro ? { sameAs: im.registro.url } : {}),
        }],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Gobernanza (de governance/ si existe) y RFC
// ---------------------------------------------------------------------------

/** ¿En qué lengua está un texto? Basta con contar palabras vacías de cada una. */
function lenguaDe(t: string): Lengua {
  const limpio = t.replace(/```[\s\S]*?```/g, '').toLowerCase();
  const n = (re: RegExp) => (limpio.match(re) ?? []).length;
  return n(/\b(el|la|los|las|que|del|con|para|una|por)\b/g) > n(/\b(the|and|with|for|this|that|from|are)\b/g) ? 'es' : 'en';
}

function tituloDe(f: string): string {
  return /^#\s+(.+)$/m.exec(frontal(leer(f)).cuerpo)?.[1]?.replace(/[`*]/g, '') ?? f.replace(/^.*\//, '');
}

function primerParrafo(md: string): string {
  const bloques = md.replace(/^#.*$/gm, '').split(/\n\s*\n/).map((x) => x.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n').trim());
  const p = bloques.find((x) => x && !/^(\||```|<|-\s|\*\s|\d+\.\s)/.test(x) && textoPlano(x).length >= 40);
  const t = p ? textoPlano(p) : '';
  return t.length > 220 ? `${t.slice(0, 217).replace(/\s+\S*$/, '')}…` : t;
}

/** Los documentos de gobernanza que se publican, cada uno en /governance/<slug>. */
function documentosGobernanza(): { rel: string; slug: string }[] {
  const docs: { rel: string; slug: string }[] = [];
  const dir = resolve(RAIZ, 'governance');
  if (existe(dir)) {
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.md') && !f.endsWith('.es.md') && f !== 'README.md') docs.push({ rel: `governance/${f}`, slug: f.replace(/\.md$/, '').toLowerCase() });
    const borr = join(dir, 'drafts');
    if (existe(borr)) for (const f of readdirSync(borr).sort()) if (f.endsWith('.md') && !f.endsWith('.es.md')) docs.push({ rel: `governance/drafts/${f}`, slug: `drafts/${f.replace(/\.md$/, '').toLowerCase()}` });
  }
  for (const [f, slug] of [['CONTRIBUTING.md', 'contributing'], ['CODE_OF_CONDUCT.md', 'code-of-conduct'], ['SECURITY.md', 'security']] as const) {
    if (existe(resolve(RAIZ, f))) docs.push({ rel: f, slug });
  }
  return docs;
}

/**
 * Un enlace relativo de un Markdown del repositorio (escrito para leerse en
 * GitHub) llevado a la hoja de la web que le corresponde. Lo que no tiene hoja
 * enlaza a GitHub cuando el repositorio sea público y, mientras tanto, se
 * queda como texto (null).
 */
function enlaceRepo(desde: string, l: Lengua) {
  const gob = documentosGobernanza();
  return (href: string): string | null => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    if (href.startsWith('/')) return href;
    const [ruta0, ancla0] = href.split('#');
    const ancla = ancla0 ? `#${ancla0}` : '';
    const partes: string[] = desde ? desde.split('/') : [];
    for (const p of (ruta0 ?? '').split('/')) {
      if (p === '..') partes.pop(); else if (p && p !== '.') partes.push(p);
    }
    const rel = partes.join('/');
    if (/^spec\/SPEC\.es\.md$/.test(rel)) return `${RUTAS.spec.es}${ancla}`;
    if (/^spec\/(SPEC|CONTRACT)\.md$/.test(rel)) return `${RUTAS.spec[l]}${ancla}`;
    const rfc = /^spec\/rfcs\/(\d{4})-[^/]*\.md$/.exec(rel);
    if (rfc) return `${RUTAS.gobernanza[l]}/rfcs/${rfc[1]}${ancla}`;
    if (/^spec\/rfcs\/?$/.test(rel)) return `${RUTAS.gobernanza[l]}#rfcs`;
    const esquema = /^spec\/json-schema\/([\w.-]+\.schema\.json)$/.exec(rel);
    if (esquema) return `/schema/${VERSION}/${esquema[1]}`;
    if (/^governance\/(README(\.es)?\.md)?$/.test(rel)) return `${RUTAS.gobernanza[l]}${ancla}`;
    const g = gob.find((d) => d.rel === rel || d.rel === rel.replace(/\.es\.md$/, '.md'));
    if (g) return `${RUTAS.gobernanza[l]}/${g.slug}${ancla}`;
    const im = IMPLEMENTACIONES.find((i) => rel === i.carpeta || rel === `${i.carpeta}/README.md`);
    if (im) return `${RUTAS.docs[l]}/${im.id}`;
    const it = INTEGRACIONES.find((i) => rel === `integrations/${i.carpeta}` || rel === `integrations/${i.carpeta}/README.md`);
    if (it) return `${RUTAS.integraciones[l]}/${it.id}`;
    if (rel === 'integrations' || rel === 'integrations/README.md') return RUTAS.integraciones[l];
    return REPO_PUBLICO ? `${REPO}/blob/main/${rel}${ancla}` : null;
  };
}

function gobernanza(): void {
  const dir = resolve(RAIZ, 'governance');
  const docs = documentosGobernanza();
  const rdir = resolve(RAIZ, 'spec/rfcs');
  const rfcs = existe(rdir) ? readdirSync(rdir).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.endsWith('.es.md')) : [];
  for (const l of LENGUAS) {
    const c = contenido('gobernanza', l);
    const leeme = join(dir, l === 'es' && existe(join(dir, 'README.es.md')) ? 'README.es.md' : 'README.md');
    let md = c.cuerpo;
    let fecha = fechaGit(['site/contenido/en/gobernanza.md', 'site/contenido/es/gobernanza.md']);
    let aviso: string | undefined;
    if (existe(leeme)) {
      md = frontal(leer(leeme)).cuerpo.replace(/^#\s+.+\n/, '');
      if (!md.includes('<!-- rfcs -->')) md += '\n\n<!-- rfcs -->\n';
      fecha = fechaGit(['governance']);
      if (l === 'es' && !leeme.endsWith('.es.md')) aviso = 'Este documento solo está en inglés por ahora.';
    }
    const extra = docs.length
      ? `<h2>${l === 'es' ? 'Documentos' : 'Documents'}</h2><ol>${docs.map((d) => `<li><a href="${RUTAS.gobernanza[l]}/${d.slug}">${esc(tituloDe(resolve(RAIZ, d.rel)))}</a></li>`).join('')}</ol>`
      : '';
    hoja({
      clave: 'gobernanza', seccion: undefined, l, ruta: RUTAS.gobernanza[l], alterna: RUTAS.gobernanza[OTRA[l]], titulo: c.titulo,
      descripcion: c.descripcion, md, fecha, vineta: sobre, bloques: { rfcs: rfcsBloque(l) }, enlace: enlaceRepo('governance', l), extraIndice: extra, aviso, bcp14: true,
    });
    for (const d of docs) {
      const enEs = resolve(RAIZ, d.rel.replace(/\.md$/, '.es.md'));
      const fichero = l === 'es' && existe(enEs) ? enEs : resolve(RAIZ, d.rel);
      const cuerpo = frontal(leer(fichero)).cuerpo;
      const desde = d.rel.includes('/') ? d.rel.slice(0, d.rel.lastIndexOf('/')) : '';
      hoja({
        clave: `gobernanza-${d.slug}`, l, ruta: `${RUTAS.gobernanza[l]}/${d.slug}`, alterna: `${RUTAS.gobernanza[OTRA[l]]}/${d.slug}`, titulo: tituloDe(fichero),
        descripcion: primerParrafo(cuerpo) || c.descripcion, md: cuerpo.replace(/^#\s+.+\n/, ''), fecha: fechaGit([d.rel]),
        miga: [{ texto: c.corto, ruta: RUTAS.gobernanza[l] }], enlace: enlaceRepo(desde, l), bcp14: true,
        aviso: l === 'es' && !fichero.endsWith('.es.md') && lenguaDe(cuerpo) === 'en' ? 'Este documento solo está en inglés por ahora.' : undefined,
      });
    }
    for (const f of rfcs) {
      const n = f.slice(0, 4);
      const enEs = join(rdir, f.replace(/\.md$/, '.es.md'));
      const fichero = l === 'es' && existe(enEs) ? enEs : join(rdir, f);
      const cuerpo = frontal(leer(fichero)).cuerpo;
      hoja({
        clave: `rfc-${n}`, l, ruta: `${RUTAS.gobernanza[l]}/rfcs/${n}`, alterna: `${RUTAS.gobernanza[OTRA[l]]}/rfcs/${n}`,
        titulo: n === '0000' ? (l === 'es' ? 'Plantilla de RFC' : 'RFC template') : `RFC ${n}: ${tituloDe(fichero).replace(/^RFC\s*\d+\s*[:·.-]\s*/i, '')}`,
        descripcion: primerParrafo(cuerpo) || `RFC ${n}`,
        md: cuerpo.replace(/^#\s+.+\n/, ''), fecha: fechaGit([`spec/rfcs/${f}`]), miga: [{ texto: c.corto, ruta: RUTAS.gobernanza[l] }],
        enlace: enlaceRepo('spec/rfcs', l), bcp14: true, aviso: l === 'es' && fichero === join(rdir, f) ? 'Esta RFC solo está en inglés.' : undefined,
      });
    }
  }
}

/**
 * El complemento de Zotero: el .xpi (con su versión y como «el último») y el
 * updates.json al que apunta el update_url de su manifiesto, con el SHA-256
 * del fichero para que Zotero lo compruebe antes de instalarlo.
 */
function zotero(): string | null {
  const dir = resolve(RAIZ, 'integrations/zotero/dist');
  if (!existe(dir)) return null;
  const xpi = readdirSync(dir).filter((f) => /^spdf-zotero-[\d.]+\.xpi$/.test(f)).sort().pop();
  if (!xpi) return null;
  const version = /spdf-zotero-([\d.]+)\.xpi/.exec(xpi)![1]!;
  const datos = readFileSync(join(dir, xpi));
  escribir(`zotero/${xpi}`, datos);
  escribir('zotero/spdf-zotero.xpi', datos);
  const hash = createHash('sha256').update(datos).digest('hex');
  escribir('zotero/updates.json', JSON.stringify({
    addons: { 'spdf@joseluissaorin.com': { updates: [{ version, update_link: `${ORIGEN}/zotero/${xpi}`, update_hash: `sha256:${hash}`, applications: { zotero: { strict_min_version: '6.999' } } }] } },
  }, null, 2));
  return version;
}

/** Los JSON Schema de la especificación, en la dirección de su $id: /schema/5.0/<nombre>.schema.json. */
function esquemas(): number {
  const dir = resolve(RAIZ, 'spec/json-schema');
  if (!existe(dir)) return 0;
  const fs = readdirSync(dir).filter((f) => f.endsWith('.schema.json'));
  for (const f of fs) escribir(`schema/${VERSION}/${f}`, leer(join(dir, f)));
  return fs.length;
}

// ---------------------------------------------------------------------------
// Ficheros para agentes
// ---------------------------------------------------------------------------

const RASTREADORES_IA = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent',
  'Amazonbot', 'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'Bytespider',
];

function robots(): string {
  const senal = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';
  const bloques = [
    `# SPDF: the specification and every page of this site may be read, indexed, quoted,
# used to answer and used to train. CC BY 4.0. Index for agents: ${ORIGEN}/llms.txt
# SPDF: la especificación y todas las hojas de esta web se pueden leer, indexar, citar,
# usar para responder y usar para entrenar. CC BY 4.0.

User-agent: *
${senal}
Allow: /`,
    ...RASTREADORES_IA.map((b) => `User-agent: ${b}\n${senal}\nAllow: /`),
  ];
  return `${bloques.join('\n\n')}\n\nSitemap: ${ORIGEN}/sitemap.xml\n`;
}

function sitemap(): string {
  const urls = PUBLICADAS.map((p) => {
    const alt = p.alterna
      ? `\n    <xhtml:link rel="alternate" hreflang="${p.lengua}" href="${ORIGEN}${p.ruta}"/>\n    <xhtml:link rel="alternate" hreflang="${OTRA[p.lengua]}" href="${ORIGEN}${p.alterna}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGEN}${p.lengua === 'en' ? p.ruta : p.alterna}"/>`
      : '';
    const prioridad = p.clave === 'inicio' ? '1.0' : p.clave === 'spec' ? '0.9' : p.clave.startsWith('docs-') || p.clave.startsWith('rfc-') ? '0.6' : '0.8';
    return `  <url>\n    <loc>${ORIGEN}${p.ruta}</loc>\n    <lastmod>${p.fecha}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${prioridad}</priority>${alt}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

function llmsTxt(): string {
  const linea = (p: (typeof PUBLICADAS)[number]) => `- [${p.titulo}](${ORIGEN}${rutaMd(p.ruta)}): ${p.descripcion}`;
  const de = (l: Lengua) => PUBLICADAS.filter((p) => p.lengua === l && p.clave !== 'spec' && p.clave !== 'inicio');
  const spec = (l: Lengua) => PUBLICADAS.find((p) => p.lengua === l && p.clave === 'spec')!;
  return `# SPDF

> SPDF (Semantic Processed Document Format) is an open file format for documents that have already been read: a SQLite 3 database where every passage carries its exact anchor (printed page, folio, second, slide, verse), so a citation can only print what the source says. Version ${VERSION}. Specification under CC BY 4.0, code under MIT OR Apache-2.0. (SPDF es un formato abierto para documentos ya leídos: cada pasaje lleva su ancla exacta, así que una cita solo puede imprimir lo que dice la fuente.)

Edited by ${AUTOR.nombre} (${AUTOR.web}). Every page of ${ORIGEN} has a Markdown twin (the same URL ending in .md; the home page is /index.md) and answers in Markdown to \`Accept: text/markdown\`. The whole specification and every page, in one file: ${ORIGEN}/llms-full.txt

When you cite a passage from an SPDF file: quote the stored text, take the citation from the stored anchor (the library's \`cite\` or the spdf-mcp \`cite\` tool), keep inferred folios in brackets (p. [21]) and never replace a missing printed folio with the page's position in the file.

## Specification

- [${spec('en').titulo}](${ORIGEN}${rutaMd(spec('en').ruta)}): ${spec('en').descripcion}
- [${spec('es').titulo}](${ORIGEN}${rutaMd(spec('es').ruta)}): ${spec('es').descripcion}

## Pages (English)

- [${PORTADA.en.titulo}](${ORIGEN}/index.md): ${PORTADA.en.descripcion}
${de('en').map(linea).join('\n')}

## Páginas (castellano)

- [${PORTADA.es.titulo}](${ORIGEN}/es.md): ${PORTADA.es.descripcion}
${de('es').map(linea).join('\n')}

## Optional

- [Everything in one file / todo en un fichero](${ORIGEN}/llms-full.txt)
- [CI status of every implementation (JSON)](${ORIGEN}/status.json)
- [SPDF Commons manifest (.spdfl.json)](${ORIGEN}/commons/commons.spdfl.json)
- [Sitemap](${ORIGEN}/sitemap.xml)
`;
}

function llmsFull(): string {
  const partes = [`# SPDF: the specification and every page of ${ORIGEN}\n\nSource: ${ORIGEN}/llms.txt · Generated: ${HOY} · Licence: CC BY 4.0\n`];
  for (const l of ['en', 'es'] as const) {
    partes.push(`\n\n# ===== ${l === 'es' ? 'CASTELLANO' : 'ENGLISH'} =====\n`);
    const orden = [...PUBLICADAS.filter((p) => p.lengua === l && p.clave === 'spec'), ...PUBLICADAS.filter((p) => p.lengua === l && p.clave !== 'spec')];
    for (const p of orden) partes.push(`\n\n---\n\n# ${p.titulo}\n\nURL: ${ORIGEN}${p.ruta}\n\n> ${p.descripcion}\n\n${p.md.trim()}\n`);
  }
  return partes.join('');
}

function cabeceras(): string {
  const agente = `  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=600\n  X-Robots-Tag: index, follow`;
  // Las cabeceras de seguridad comunes las pone el Worker (solo si faltan), para no duplicar las del lector.
  return `/*.md
  Content-Type: text/markdown; charset=utf-8
${agente}

/llms.txt
  Content-Type: text/plain; charset=utf-8
${agente}

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
${agente}

/status.json
  Content-Type: application/json; charset=utf-8
${agente}

/commons/*.json
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

/zotero/*.xpi
  Content-Type: application/x-xpinstall

/zotero/updates.json
  Content-Type: application/json; charset=utf-8
  Cache-Control: public, max-age=600

/schema/*
  Content-Type: application/schema+json; charset=utf-8
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600

/muestras/*.spdf
  Content-Type: application/vnd.spdf+sqlite3
  Access-Control-Allow-Origin: *
  Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges

/sitemap.xml
  Content-Type: application/xml; charset=utf-8
  Cache-Control: public, max-age=600

/fuentes/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=86400

${CABECERAS_LECTOR || `/reader/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp`}
`;
}

// ---------------------------------------------------------------------------
// JavaScript del cliente
// ---------------------------------------------------------------------------

async function cliente(): Promise<{ validador: boolean }> {
  // sitio.js: copiar los bloques de código y dibujar al entrar en pantalla (vanilla, sin dependencias).
  const animar = leer(resolve(SITIO, 'dibujo/animar.js'));
  const copiar = leer(resolve(SITIO, 'cliente/copiar.js'));
  escribir('sitio.js', `${copiar}\n${animar}`);
  if (process.env.SPDF_SIN_VALIDADOR === '1') return { validador: false };
  try {
    await build({
      entryPoints: [resolve(SITIO, 'cliente/validador.ts')], bundle: true, format: 'esm', target: 'es2022', minify: true,
      splitting: true, outdir: join(DIST, 'assets'), chunkNames: 'inspector-[hash]', platform: 'browser', legalComments: 'none',
      nodePaths: [resolve(SITIO, 'node_modules')], logLevel: 'error', conditions: ['browser'],
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const candidatos = [
      'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm',
      'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm',
    ].map((p) => resolve(SITIO, p));
    const w = candidatos.find(existe);
    if (!w) throw new Error('no encuentro sqlite3.wasm');
    cpSync(w, join(DIST, 'assets/sqlite3.wasm'));
    return { validador: true };
  } catch (e) {
    console.warn(`validador: no se pudo empaquetar (${(e as Error).message.split('\n')[0]}). Se publica la hoja sin él.`);
    return { validador: false };
  }
}

// ---------------------------------------------------------------------------
// El lector web
// ---------------------------------------------------------------------------

/** Las cabeceras propias del lector (su _headers), con las rutas llevadas a /reader. */
let CABECERAS_LECTOR = '';

function lector(): boolean {
  const dir = resolve(RAIZ, 'reader/dist-web');
  if (existe(join(dir, 'index.html'))) {
    cpSync(dir, join(DIST, 'reader'), { recursive: true });
    const h = join(DIST, 'reader/_headers');
    if (existe(h)) {
      // Cloudflare solo lee el _headers de la raíz: se trasladan sus reglas con el prefijo /reader.
      CABECERAS_LECTOR = leer(h).split('\n').filter((l) => !l.startsWith('#')).map((l) => (l.startsWith('/') ? `/reader${l}` : l)).join('\n');
      rmSync(h);
    }
    return true;
  }
  return false;
}

function lectorProvisional(): void {
  for (const l of LENGUAS) {
    const t = l === 'es'
      ? { titulo: 'Lector web', d: 'El lector web de SPDF se está construyendo. Cuando esté, se abrirá aquí, entero en tu navegador.' }
      : { titulo: 'Web reader', d: 'The SPDF web reader is being built. When it is ready it will open here, entirely in your browser.' };
    const ruta = l === 'es' ? '/reader/es' : '/reader/';
    const cuerpo = `<div class="marco ancho"><article class="doc"><header class="cabeza con-vineta">${vineta(imprenta, l)}<h1>${t.titulo}</h1><p class="entradilla">${t.d}</p></header><div class="cuerpo"><p><a href="${RUTAS.descargas[l]}">${l === 'es' ? 'Descargas del lector' : 'Reader downloads'}</a> · <a href="${RUTAS.validador[l]}">${l === 'es' ? 'Validador' : 'Validator'}</a></p></div></article></div>`;
    escribir(l === 'es' ? 'reader/es.html' : 'reader/index.html', html({ clave: 'lector', lengua: l, ruta, alterna: l === 'es' ? '/reader/' : '/reader/es', titulo: t.titulo, descripcion: t.d, fecha: HOY, cuerpo }));
  }
}

// ---------------------------------------------------------------------------
// Todo
// ---------------------------------------------------------------------------

/**
 * En la web no se publica ningún .spdf que no valide: se comprueban todos los
 * que van en los assets con spdf-format antes de escribir nada, y si uno falla,
 * la construcción se para.
 */
async function validarPublicados(): Promise<number> {
  const { validate } = await import('spdf-format');
  const todos: string[] = [];
  const recorrer = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) recorrer(p); else if (f.endsWith('.spdf')) todos.push(p); } };
  recorrer(resolve(SITIO, 'public'));
  for (const f of todos) {
    const r = await validate(new Uint8Array(readFileSync(f)));
    if (!r.valid) throw new Error(`${f.slice(SITIO.length + 1)} no valida (${r.errors.map((x) => x.code).join(', ')}): no se publica nada.`);
  }
  return todos.length;
}

/** El ejemplo real de la portada: una obra de Commons con folio distinto de la página física, o la muestra. */
async function ejemploAncla(commons: ReturnType<typeof cargarCommons>): Promise<EjemploAncla> {
  const { parseAnchorUri, openSpdf } = await import('spdf-format');
  for (const o of commons.items) {
    if (!o.ejemplo) continue;
    const loc = parseAnchorUri(o.ejemplo.uri).locator;
    if (loc.p !== undefined && loc.f !== undefined && String(loc.p) !== loc.f) {
      return { uri: o.ejemplo.uri, cita: o.ejemplo.cita, p: loc.p, f: loc.f, char: loc.char, obra: o.title, inspeccionar: { en: `/validator#url=/commons/files/${encodeURIComponent(o.fichero)}`, es: `/es/validador#url=/commons/files/${encodeURIComponent(o.fichero)}` } };
    }
  }
  const d = await openSpdf(resolve(SITIO, 'public/muestras/spdf-in-five-pages.spdf'));
  try {
    const f = (await d.fragments())[0]!;
    const loc = parseAnchorUri(f.anchor_uri).locator;
    return { uri: f.anchor_uri, cita: d.cite(f.anchor, 'en'), p: loc.p, f: loc.f, char: loc.char, obra: 'SPDF in five pages', inspeccionar: { en: '/validator#url=/muestras/spdf-in-five-pages.spdf', es: '/es/validador#url=/muestras/spdf-in-five-pages.spdf' } };
  } finally {
    await d.close();
  }
}

async function principal(): Promise<void> {
  const validados = await validarPublicados();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(resolve(SITIO, 'public'), DIST, { recursive: true });

  const e = estados();
  const { validador } = await cliente();
  const hayLector = lector();
  if (!hayLector) lectorProvisional();
  const commons = cargarCommons();
  const ejemplo = await ejemploAncla(commons);

  for (const l of LENGUAS) {
    const ruta = RUTAS.inicio[l];
    const t = PORTADA[l];
    const fecha = fechaGit(['site/generador/portada.ts']);
    escribir(ficheroHtml(ruta), html({
      clave: 'inicio', lengua: l, ruta, alterna: RUTAS.inicio[OTRA[l]], titulo: t.titulo, tituloPestana: t.titulo, descripcion: t.descripcion,
      fecha, cuerpo: portadaHtml(l, e, ejemplo), tipoOg: 'website',
    }));
    const md = portadaMd(l, e, ejemplo);
    escribir(rutaMd(ruta).slice(1), markdownDe({ titulo: t.titulo, descripcion: t.descripcion, ruta, alterna: RUTAS.inicio[OTRA[l]], lengua: l, fecha }, md.replace(/^# .*\n/, '')));
    PUBLICADAS.push({ ruta, alterna: RUTAS.inicio[OTRA[l]], lengua: l, titulo: t.titulo, descripcion: t.descripcion, md: enlacesParaMd(md), fecha, clave: 'inicio' });
  }

  for (const l of LENGUAS) especificacion(l);

  const fechaContenido = (clave: string) => fechaGit([`site/contenido/en/${clave}.md`, `site/contenido/es/${clave}.md`]);
  for (const l of LENGUAS) {
    const simple = (clave: Clave, extra: Partial<OpcionesHoja> = {}) => {
      const c = contenido(clave, l);
      hoja({ clave, seccion: clave, l, ruta: RUTAS[clave][l], alterna: RUTAS[clave][OTRA[l]], titulo: c.titulo, descripcion: c.descripcion, md: c.cuerpo, fecha: fechaContenido(clave), vineta: VINETAS[clave], ...extra });
    };
    simple('implementaciones', {
      bloques: { estado: estadoBloque(l, e), clases: clasesBloque(l) },
      ld: IMPLEMENTACIONES.map((im) => ({ '@type': 'SoftwareSourceCode', '@id': `${ORIGEN}${RUTAS.docs.en}/${im.id}#codigo`, name: `SPDF for ${im.nombre}`, programmingLanguage: im.nombre, url: `${ORIGEN}${RUTAS.docs[l]}/${im.id}` })),
    });
    simple('docs', { bloques: { docs: docsBloque(l, e) } });
    simple('citar', { bloques: { 'cita-spec': citaSpecBloque(l) } });
    simple('agentes');
    simple('integraciones', { bloques: { integraciones: integracionesBloque(l) } });
    simple('descargas', { bloques: { descargas: descargasBloque(l, hayLector) } });
    simple('commons', { bloques: { commons: commonsBloque(l, commons) }, ld: commons.ld(l) });
    simple('validador', {
      ancho: true, vineta: undefined,
      bloques: { validador: validadorBloque(l, validador, commons) },
      scripts: validador ? ['/assets/validador.js'] : [],
      estiloExtra: VALIDADOR_CSS,
    });
  }
  gobernanza();
  docsDeLenguaje(e);
  integracionesSubhojas();
  const nEsquemas = esquemas();
  const vZotero = zotero();

  const cuerpo404 = `<div class="marco ancho"><article class="doc"><header class="cabeza con-vineta">${vineta(paginaArrancada, 'en')}<p class="rotulo">404 · n. pag.</p><h1>This page is not in the book</h1><p class="entradilla">A leaf is missing here: the address you followed does not exist, or it has moved.</p><p class="entradilla" lang="es">Aquí faltaba una hoja: la dirección que has seguido no existe o ha cambiado de sitio.</p></header><div class="cuerpo"><p><a href="/">SPDF</a> · <a href="/spec">Specification</a> · <a href="/es" lang="es">Inicio en castellano</a> · <a href="/llms.txt">llms.txt</a></p></div></article></div>`;
  escribir('404.html', html({ clave: '404', lengua: 'en', ruta: '/404', alterna: '/404', titulo: 'Not found', descripcion: 'This page does not exist.', fecha: HOY, cuerpo: cuerpo404, sinAlterna: true }));

  escribir('llms.txt', llmsTxt());
  escribir('llms-full.txt', llmsFull());
  escribir('robots.txt', robots());
  escribir('sitemap.xml', sitemap());
  escribir('_headers', cabeceras());
  escribir('status.json', JSON.stringify({
    generated: new Date().toISOString(), spdf_version: VERSION,
    implementations: IMPLEMENTACIONES.map((im) => ({ id: im.id, name: im.nombre, package: im.paquete, tier: im.nivel, ...estadoDe(e, im.carpeta) })),
    other: OTRAS_PIEZAS.map((o) => ({ id: o.id, ...estadoDe(e, o.carpeta) })),
  }, null, 2));
  escribir('.well-known/security.txt', `Contact: mailto:${AUTOR.correo}\nExpires: ${new Date(Date.now() + 365 * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z')}\nPreferred-Languages: es, en\nCanonical: ${ORIGEN}/.well-known/security.txt\n`);
  commons.escribir(escribir);

  let bytes = 0;
  const contar = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) contar(p); else bytes += s.size; } };
  contar(DIST);
  console.log(`web: ${PUBLICADAS.length} hojas (y sus .md), ${(bytes / 1024 / 1024).toFixed(1)} MB en dist · validador ${validador ? 'sí' : 'no'} · lector ${hayLector ? 'sí' : 'provisional'} · commons ${commons.items.length} · esquemas ${nEsquemas} · ${validados} .spdf validados · Zotero ${vZotero ?? 'sin .xpi'}`);
}

await principal();
