/**
 * SPDF Commons: la colección de obras de dominio público ya leídas. El catálogo
 * vive en site/commons/catalogo.json (lo escribe commons/publicar.ts al subir
 * los ficheros a R2) y de él salen la tabla de la hoja, el manifiesto
 * .spdfl.json (§9 del contrato) y el JSON-LD de tipo Dataset.
 *
 * Los ficheros se sirven desde R2 a través del Worker: /commons/files/<nombre>.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOR, ORIGEN, SITIO, esc, type Lengua } from './sitio';
import type { Bloque } from './construir';
import { ID } from './plantilla';

export interface ObraCommons {
  /** Nombre del fichero en /commons/files/ (y clave en R2: commons/<fichero>). */
  fichero: string;
  sha256: string;
  /** SHA-256 del original leído (source_sha256): el docref de las URI de ancla. */
  source_sha256: string;
  title: string;
  authors: string;
  year: number | null;
  language: string;
  /** scanned_pdf | pdf | epub | audio | … */
  kind: string;
  profile: string[];
  bytes: number;
  units: number;
  fragments: number;
  /** De dónde salió el original (Gutenberg, Internet Archive, LibriVox…). */
  source: { name: string; url: string };
  /** Una cita de muestra calculada por la biblioteca, con su URI. */
  ejemplo?: { cita: string; uri: string };
  generator?: string;
  created?: string;
  /** Cómo se comprobó a ojo que los folios (o los tiempos) son los buenos. Obligatorio para publicar. */
  verificacion: Record<Lengua, string>;
  /** Fecha (AAAA-MM-DD) de esa comprobación. */
  verificado: string;
}

interface Catalogo { name: string; description: string; items: ObraCommons[] }

const TIPOS: Record<string, Record<Lengua, string>> = {
  scanned_pdf: { en: 'scanned book', es: 'libro escaneado' },
  pdf: { en: 'PDF', es: 'PDF' },
  epub: { en: 'EPUB', es: 'EPUB' },
  audio: { en: 'audiobook', es: 'audiolibro' },
  video: { en: 'video', es: 'vídeo' },
  photos: { en: 'photographs', es: 'fotografías' },
  document: { en: 'document', es: 'documento' },
  web: { en: 'web page', es: 'página web' },
};

const LENGUAS_NOMBRE: Record<string, Record<Lengua, string>> = {
  en: { en: 'English', es: 'inglés' }, es: { en: 'Spanish', es: 'castellano' }, fr: { en: 'French', es: 'francés' },
  de: { en: 'German', es: 'alemán' }, it: { en: 'Italian', es: 'italiano' }, la: { en: 'Latin', es: 'latín' },
  pt: { en: 'Portuguese', es: 'portugués' }, ca: { en: 'Catalan', es: 'catalán' }, el: { en: 'Greek', es: 'griego' },
  ru: { en: 'Russian', es: 'ruso' }, zh: { en: 'Chinese', es: 'chino' }, ja: { en: 'Japanese', es: 'japonés' },
  nl: { en: 'Dutch', es: 'neerlandés' },
};

export const megas = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function cargarCommons() {
  const cat = JSON.parse(readFileSync(resolve(SITIO, 'commons/catalogo.json'), 'utf8')) as Catalogo;
  const items = cat.items;
  // Validar no basta: un folio mal puesto pasa el validador. Sin una comprobación a ojo, documentada, no se publica.
  for (const o of items) {
    if (!o.verificacion?.en || !o.verificacion?.es || !/^\d{4}-\d{2}-\d{2}$/.test(o.verificado ?? '')) {
      throw new Error(`commons: ${o.fichero} no dice cómo se verificaron sus folios (verificacion.en, verificacion.es, verificado): no se publica nada.`);
    }
  }
  const url = (o: ObraCommons) => `${ORIGEN}/commons/files/${encodeURIComponent(o.fichero)}`;
  const manifiesto = {
    spdf_library: '1.0',
    name: cat.name,
    description: cat.description,
    url: `${ORIGEN}/commons`,
    license: 'CC0-1.0',
    items: items.map((o) => ({ sha256: o.sha256, title: o.title, authors: o.authors, year: o.year, url: url(o), language: o.language, kind: o.kind, bytes: o.bytes, source_sha256: o.source_sha256 })),
  };
  return {
    items,
    url,
    escribir(escribir: (rel: string, c: string) => void) {
      escribir('commons/commons.spdfl.json', JSON.stringify(manifiesto, null, 2));
    },
    ld(l: Lengua): Record<string, unknown>[] {
      return [{
        '@type': 'Dataset', '@id': `${ORIGEN}/commons#coleccion`, name: 'SPDF Commons',
        description: l === 'es'
          ? 'Obras de dominio público ya leídas en SPDF (libros escaneados, EPUB y grabaciones de LibriVox), con su texto, sus anclas, sus secciones y sus vectores.'
          : 'Public-domain works already read into SPDF (scanned books, EPUBs and LibriVox recordings), with their text, anchors, sections and vectors.',
        url: `${ORIGEN}${l === 'es' ? '/es/commons' : '/commons'}`, license: 'https://creativecommons.org/publicdomain/zero/1.0/',
        creator: { '@id': ID.autor }, publisher: { '@id': ID.autor }, isAccessibleForFree: true,
        inLanguage: [...new Set(items.map((o) => o.language))],
        keywords: ['SPDF', 'public domain', 'digital humanities', 'citation', 'OCR', 'transcription', 'embeddings'],
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${ORIGEN}/commons/commons.spdfl.json`, name: 'commons.spdfl.json' },
          ...items.map((o) => ({ '@type': 'DataDownload', encodingFormat: 'application/vnd.spdf+sqlite3', contentUrl: url(o), name: o.title, contentSize: `${o.bytes} B` })),
        ],
        variableMeasured: ['text', 'anchor', 'section', 'figure', 'vector'],
        citation: `${AUTOR.nombre}. SPDF Commons. ${ORIGEN}/commons`,
      }];
    },
  };
}

export type Commons = ReturnType<typeof cargarCommons>;

export function commonsBloque(l: Lengua, c: Commons): Bloque {
  if (!c.items.length) {
    const t = l === 'es'
      ? 'Las primeras obras se están leyendo con el productor de referencia. Aparecerán aquí, con su manifiesto, en cuanto pasen el validador.'
      : 'The first works are being read with the reference producer. They will appear here, with their manifest, as soon as they pass the validator.';
    return { html: `<p class="aviso">${t}</p>`, md: t };
  }
  const cab = l === 'es' ? ['Obra', 'Lengua', 'Tipo', 'Unidades', 'Tamaño', 'Descargar'] : ['Work', 'Language', 'Kind', 'Units', 'Size', 'Download'];
  const filas = c.items.map((o) => {
    const lengua = LENGUAS_NOMBRE[o.language]?.[l] ?? o.language;
    const tipo = TIPOS[o.kind]?.[l] ?? o.kind;
    const ej = o.ejemplo ? `<small><code>${esc(o.ejemplo.cita)}</code></small>` : '';
    const fecha = new Date(`${o.verificado}T12:00:00Z`).toLocaleDateString(l === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const ver = `<small class="verificacion"><span class="rotulo">${l === 'es' ? 'Verificado el' : 'Verified on'} ${esc(fecha)}.</span> ${esc(o.verificacion[l])}</small>`;
    const inspeccionar = `${l === 'es' ? '/es/validador' : '/validator'}#url=/commons/files/${encodeURIComponent(o.fichero)}`;
    return `<tr><td><strong>${esc(o.title)}</strong><small>${esc(o.authors)}${o.year ? `, ${o.year}` : ''} · <a href="${esc(o.source.url)}" rel="noopener">${esc(o.source.name)}</a></small>${ej}${ver}</td><td>${lengua}</td><td>${tipo}</td><td class="a-right">${o.units}</td><td class="a-right nowrap">${megas(o.bytes)}</td><td><a href="${c.url(o)}" download>.spdf</a><br><a href="${inspeccionar}">${l === 'es' ? 'inspeccionar' : 'inspect'}</a></td></tr>`;
  }).join('');
  const manifiesto = l === 'es' ? 'El manifiesto de la colección' : 'The collection manifest';
  const htmlT = `<div class="tabla" tabindex="0"><table class="estado-impl commons"><thead><tr>${cab.map((x, i) => `<th scope="col"${i === 3 || i === 4 ? ' class="a-right"' : ''}>${x}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div><p><a class="boton papel" href="/commons/commons.spdfl.json" download>${manifiesto} <code>commons.spdfl.json</code></a></p>`;
  const md = [
    `| ${cab.join(' | ')} |`, '| --- | --- | --- | ---: | ---: | --- |',
    ...c.items.map((o) => `| ${o.title} (${o.authors}${o.year ? `, ${o.year}` : ''}) | ${LENGUAS_NOMBRE[o.language]?.[l] ?? o.language} | ${TIPOS[o.kind]?.[l] ?? o.kind} | ${o.units} | ${megas(o.bytes)} | ${c.url(o)} |`),
    '', `${manifiesto}: ${ORIGEN}/commons/commons.spdfl.json`, '',
    `### ${l === 'es' ? 'Cómo se verificó cada obra' : 'How each work was verified'}`, '',
    ...c.items.map((o) => `- **${o.title}** (${o.verificado}): ${o.verificacion[l]}`),
  ].join('\n');
  return { html: htmlT, md };
}
