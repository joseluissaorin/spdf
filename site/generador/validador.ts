/**
 * La hoja del validador: el armazón se pinta en el servidor (para que no haya
 * saltos al cargar) y cliente/validador.ts lo llena en el navegador con
 * spdf-format y SQLite en WebAssembly. Los textos del cliente viajan en un
 * <script type="application/json"> en la lengua de la hoja.
 */
import { aSvg } from '../dibujo/boceto';
import { maniculaSuelta } from '../dibujo/dibujos/manicula-suelta';
import { esc, type Lengua } from './sitio';
import type { Bloque } from './construir';
import type { Commons } from './commons';
import { megas } from './commons';
import { MUESTRAS } from './muestras';
import { bilingue } from './notas';

export const TEXTOS_CLIENTE = {
  en: {
    leyendo: 'Reading the file…', validando: 'Validating…', abriendo: 'Opening…',
    valido: 'Valid SPDF', invalido: 'Not a valid SPDF', avisos: 'warnings', errores: 'errors', sinErrores: 'No errors.',
    codigo: 'Code', mensaje: 'Message', donde: 'Where', perfil: 'Profile', version: 'Version',
    noAbre: 'The file could not be opened for inspection:', tiempo: 'checked in',
    pestanas: { ficha: 'Record', unidades: 'Units', fragmentos: 'Fragments', figuras: 'Figures', espacios: 'Vectors', procedencia: 'Provenance', json: 'Canonical JSON' },
    titulo: 'Title', autores: 'Authors', anio: 'Year', tipo: 'Kind', lengua: 'Language', unidades: 'Units', fragmentos: 'Fragments', figuras: 'Figures',
    espacios: 'Vector spaces', creado: 'Created', generador: 'Generator', huellaOriginal: 'SHA-256 of the original', huellaFichero: 'SHA-256 of this file', tamano: 'Size',
    citaMuestra: 'A citation from the first page', cslJson: 'CSL-JSON', bibtex: 'BibTeX', derechos: 'Rights',
    buscar: 'Search the fragments', buscarAyuda: 'Lexical search with the reference algorithm (FTS5, accent-insensitive).', sinResultados: 'Nothing found.',
    mas: 'Show more', de: 'of', texto: 'Text', lector: 'Read by', confianza: 'confidence', imagen: 'Image', verImagen: 'Show the page image',
    seccion: 'Section', contexto: 'Context', sinFiguras: 'This file has no figures.', sinEspacios: 'This file carries no vectors (a core profile file).',
    modelo: 'Model', dims: 'Dimensions', dtype: 'Type', normalizado: 'Normalised', modalidades: 'Modalities', vectores: 'Vectors', muestra: 'First vector',
    fase: 'Stage', proveedor: 'Provider', ms: 'ms', cuando: 'When', sinProcedencia: 'No provenance recorded.',
    descargarJson: 'Download the canonical JSON', recortado: 'Showing the first 200 KB.', copiar: 'Copy', copiado: 'Copied',
    otro: 'Check another file', si: 'yes', no: 'no', sp: 'n. pag.',
    errorFetch: 'The sample could not be downloaded.',
  },
  es: {
    leyendo: 'Leyendo el fichero…', validando: 'Validando…', abriendo: 'Abriendo…',
    valido: 'SPDF válido', invalido: 'No es un SPDF válido', avisos: 'avisos', errores: 'errores', sinErrores: 'Ningún error.',
    codigo: 'Código', mensaje: 'Mensaje', donde: 'Dónde', perfil: 'Perfil', version: 'Versión',
    noAbre: 'No se pudo abrir el fichero para inspeccionarlo:', tiempo: 'comprobado en',
    pestanas: { ficha: 'Ficha', unidades: 'Unidades', fragmentos: 'Fragmentos', figuras: 'Figuras', espacios: 'Vectores', procedencia: 'Procedencia', json: 'JSON canónico' },
    titulo: 'Título', autores: 'Autores', anio: 'Año', tipo: 'Tipo', lengua: 'Lengua', unidades: 'Unidades', fragmentos: 'Fragmentos', figuras: 'Figuras',
    espacios: 'Espacios vectoriales', creado: 'Creado', generador: 'Programa', huellaOriginal: 'SHA-256 del original', huellaFichero: 'SHA-256 de este fichero', tamano: 'Tamaño',
    citaMuestra: 'Una cita de la primera página', cslJson: 'CSL-JSON', bibtex: 'BibTeX', derechos: 'Derechos',
    buscar: 'Buscar en los fragmentos', buscarAyuda: 'Búsqueda léxica con el algoritmo de referencia (FTS5, insensible a las tildes).', sinResultados: 'No se ha encontrado nada.',
    mas: 'Ver más', de: 'de', texto: 'Texto', lector: 'Leído por', confianza: 'confianza', imagen: 'Imagen', verImagen: 'Ver la imagen de la página',
    seccion: 'Sección', contexto: 'Contexto', sinFiguras: 'Este fichero no tiene figuras.', sinEspacios: 'Este fichero no lleva vectores (es de perfil core).',
    modelo: 'Modelo', dims: 'Dimensiones', dtype: 'Tipo', normalizado: 'Normalizado', modalidades: 'Modalidades', vectores: 'Vectores', muestra: 'Primer vector',
    fase: 'Fase', proveedor: 'Proveedor', ms: 'ms', cuando: 'Cuándo', sinProcedencia: 'No hay procedencia registrada.',
    descargarJson: 'Descargar el JSON canónico', recortado: 'Se enseñan los primeros 200 KB.', copiar: 'Copiar', copiado: 'Copiado',
    otro: 'Comprobar otro fichero', si: 'sí', no: 'no', sp: 's. p.',
    errorFetch: 'No se pudo descargar la muestra.',
  },
};

export function validadorBloque(l: Lengua, activo: boolean, commons: Commons): Bloque {
  const t = l === 'es'
    ? { soltar: 'Suelta aquí un fichero .spdf', o: 'o', elegir: 'elige uno', nada: 'No se sube nada: el fichero se lee en tu navegador.', probar: 'O prueba con una muestra:', sinJs: 'El validador necesita JavaScript para leer el fichero en tu navegador. Sin él, valida desde la línea de órdenes con cualquier implementación (más abajo).', pronto: 'El validador se está terminando: en cuanto la implementación en TypeScript pase la batería de conformidad, funcionará aquí mismo.' }
    : { soltar: 'Drop a .spdf file here', o: 'or', elegir: 'choose one', nada: 'Nothing is uploaded: the file is read in your browser.', probar: 'Or try a sample:', sinJs: 'The validator needs JavaScript to read the file in your browser. Without it, validate from the command line with any implementation (below).', pronto: 'The validator is being finished: as soon as the TypeScript implementation passes the conformance suite, it will work right here.' };
  const muestras = [
    ...MUESTRAS.map((m) => ({ url: m.url, nombre: m.nombre[l], bytes: m.bytes })),
    ...commons.items.filter((o) => o.bytes < 40 * 1024 * 1024).slice(0, 4).map((o) => ({ url: commons.url(o).replace(/^https?:\/\/[^/]+/, ''), nombre: o.title, bytes: o.bytes })),
  ];
  const lista = muestras.length
    ? `<p class="muestras"><span>${t.probar}</span> ${muestras.map((m) => `<button type="button" class="muestra" data-url="${esc(m.url)}" data-nombre="${esc(m.nombre)}" disabled>${esc(m.nombre)} <span class="rotulo">${megas(m.bytes)}</span></button>`).join(' ')}</p>`
    : '';
  const html = `<section class="validador" aria-label="${l === 'es' ? 'Validador' : 'Validator'}" data-activo="${activo ? '1' : '0'}">
<div class="soltar" id="soltar">
<div class="soltar-dibujo" aria-hidden="true">${aSvg(bilingue(maniculaSuelta), { lengua: l, decorativo: true, espera: 0.1 })}</div>
<div class="soltar-texto">
<p class="soltar-titulo">${t.soltar}</p>
<p>${t.o} <label class="boton tinta" for="fichero">${t.elegir}</label><input type="file" id="fichero" accept=".spdf,application/vnd.spdf,application/x-sqlite3,application/vnd.sqlite3,application/gzip" class="solo-lector" ${activo ? '' : 'disabled'}></p>
<p class="rotulo">${t.nada}</p>
</div>
</div>
${lista}
${activo ? '' : `<p class="aviso">${t.pronto}</p>`}
<noscript><p class="aviso">${t.sinJs}</p></noscript>
<div id="resultado" class="resultado" aria-live="polite"></div>
<script type="application/json" id="textos-validador">${JSON.stringify({ lengua: l, ...TEXTOS_CLIENTE[l] }).replace(/</g, '\\u003c')}</script>
</section>`;
  const md = l === 'es'
    ? `El validador funciona en el navegador, en ${'`'}/es/validador${'`'}: suelta un fichero .spdf y lo comprueba con spdf-format y SQLite en WebAssembly, sin subirlo. Desde la línea de órdenes: ${'`'}npx spdf-format validate fichero.spdf${'`'}.${muestras.length ? `\n\nMuestras: ${muestras.map((m) => `${m.nombre} (${m.url})`).join(', ')}.` : ''}`
    : `The validator runs in the browser at ${'`'}/validator${'`'}: drop a .spdf file and it is checked with spdf-format and SQLite in WebAssembly, without uploading it. From the command line: ${'`'}npx spdf-format validate file.spdf${'`'}.${muestras.length ? `\n\nSamples: ${muestras.map((m) => `${m.nombre} (${m.url})`).join(', ')}.` : ''}`;
  return { html, md };
}

export const VALIDADOR_CSS = `
.validador{margin:0 0 3rem}
.soltar{position:relative;display:grid;grid-template-columns:minmax(10rem,18rem) minmax(0,1fr);gap:1rem 2.5rem;align-items:center;padding:2rem clamp(1rem,4vw,3rem);border:2px dashed var(--filete-2);background:var(--hoja);transition:border-color .2s,background-color .2s}
.soltar.encima{border-color:var(--rojo);background:rgb(193 69 59/.06)}
.soltar-titulo{font-size:clamp(1.5rem,3.2vw,2.3rem);line-height:1.1;margin:0 0 .8rem;letter-spacing:-.01em}
.soltar-texto p{margin:0 0 .7rem}
.soltar .boton{cursor:pointer}
.soltar input:focus-visible+label,.soltar label:focus-within{outline:2px solid var(--rojo);outline-offset:3px}
.muestras{display:flex;flex-wrap:wrap;gap:.5rem .6rem;align-items:center;margin:1.2rem 0 0;font-size:.95rem;color:var(--tinta-2)}
.muestra{font:inherit;font-size:.92rem;padding:.4rem .7rem;border:1px solid var(--filete-2);background:var(--papel);cursor:pointer;border-radius:2px;color:var(--tinta)}
.muestra:hover:not(:disabled){border-color:var(--rojo);color:var(--rojo)}
.muestra:disabled{cursor:wait;opacity:.6}
.resultado{margin-top:2.2rem}
.resultado:empty{display:none}
.progreso{font-family:var(--mono);font-size:.9rem;color:var(--apagado)}
.progreso::before{content:'';display:inline-block;width:.7rem;height:.7rem;margin-right:.6rem;background:var(--rojo-bauhaus);animation:girar 1.1s linear infinite}
@keyframes girar{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.progreso::before{animation:none}}
.veredicto{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.2rem 1.4rem;align-items:center;padding:1.4rem 0 1.5rem;border-top:3px solid var(--tinta);border-bottom:1px solid var(--filete)}
.veredicto .sello{width:4.2rem;height:4.2rem;display:grid;place-items:center;font:600 1.9rem/1 var(--serif);color:var(--hoja);grid-row:span 2}
.veredicto.valido .sello{background:#2f6b3a;border-radius:50%}
.veredicto.invalido .sello{background:var(--rojo-bauhaus)}
.veredicto h2{margin:0;font-size:clamp(1.7rem,3.6vw,2.6rem);letter-spacing:-.015em}
.veredicto.invalido h2{color:var(--rojo)}
.veredicto p{margin:0;color:var(--tinta-2)}
.veredicto .formas{display:inline-flex;gap:.25rem;vertical-align:middle;margin-left:.4rem}
.veredicto .formas span{width:1rem;height:1rem}
.problemas{margin:1.2rem 0 0}
.problemas td:first-child code{color:var(--rojo);font-weight:600}
.problemas tr.aviso-w td:first-child code{color:#8a5a00}
.resumen{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:0;margin:1.8rem 0 0;border-top:1px solid var(--filete)}
.resumen div{padding:.7rem 1rem .8rem 0;border-bottom:1px solid var(--filete)}
.resumen dt{font:500 .68rem/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--apagado)}
.resumen dd{margin:.15rem 0 0;overflow-wrap:anywhere}
.resumen dd code{font-size:.78rem;background:none;padding:0;line-height:1.45;display:inline-block}
.pestanas{display:flex;flex-wrap:wrap;gap:0;margin:2.4rem 0 0;border-bottom:2px solid var(--tinta)}
.pestanas button{font:inherit;font-size:1rem;padding:.6rem 1rem .55rem;border:0;background:none;color:var(--tinta-2);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
.pestanas button:hover{color:var(--tinta)}
.pestanas button[aria-selected=true]{color:var(--rojo);border-bottom-color:var(--rojo)}
.pestanas button .n{font:500 .7rem var(--mono);color:var(--apagado);margin-left:.35rem}
.panel{padding:1.6rem 0 0}
.panel[hidden]{display:none}
.panel h3{font-size:1.2rem;margin:1.6rem 0 .6rem}
.panel h3:first-child{margin-top:0}
.cita-grande{font-size:1.4rem;margin:0 0 .3rem}
.lista-u{list-style:none;margin:0;padding:0;border-top:1px solid var(--filete)}
.lista-u>li{display:grid;grid-template-columns:7.5rem minmax(0,1fr);gap:.3rem 1.2rem;padding:.8rem 0;border-bottom:1px solid var(--filete)}
.lista-u .loc{font:500 .85rem/1.4 var(--mono);color:var(--rojo)}
.lista-u .loc small{display:block;color:var(--apagado);font-weight:400;font-size:.72rem}
.lista-u .meta{font:.72rem/1.4 var(--mono);color:var(--apagado);margin:0 0 .35rem}
.lista-u p.t{margin:0;white-space:pre-line;font-size:.98rem}
.lista-u .uri{font-size:.74rem;color:var(--tinta-2);overflow-wrap:anywhere;background:none;padding:0}
.lista-u details summary{cursor:pointer;color:var(--tinta-2);font-size:.9rem;margin-top:.4rem}
.lista-u img{max-height:32rem;width:auto;border:1px solid var(--filete);margin-top:.6rem;background:#fff}
.lista-u .ctx{font-style:italic;color:var(--tinta-2);margin:0 0 .3rem;font-size:.92rem}
.mas{margin:1rem 0 0}
.buscador{display:flex;gap:.6rem;flex-wrap:wrap;margin:0 0 .4rem}
.buscador input{flex:1 1 16rem;font:inherit;padding:.6rem .8rem;border:1.5px solid var(--tinta);background:var(--hoja);border-radius:2px;color:var(--tinta)}
.buscador input:focus{outline:2px solid var(--rojo);outline-offset:2px}
.ayuda{font-size:.88rem;color:var(--apagado);margin:0 0 1rem}
.figuras-r{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:1.2rem}
.figuras-r figure{margin:0;padding:.8rem;background:var(--hoja);border:1px solid var(--filete)}
.figuras-r img{width:100%;height:auto;aspect-ratio:4/3;object-fit:contain;background:#fff}
.figuras-r figcaption{font-size:.88rem;margin-top:.6rem;color:var(--tinta-2)}
.tira{display:block;width:100%;height:2.2rem;margin:.3rem 0 0;image-rendering:pixelated;border:1px solid var(--filete)}
pre.json{max-height:34rem;overflow:auto;background:#2a1d16;color:#f3eadb;padding:1rem 1.1rem;font-size:.8rem;line-height:1.5;margin:0 0 1rem}
@media (max-width:640px){.soltar{grid-template-columns:minmax(0,1fr)}.soltar-dibujo{max-width:13rem}.lista-u>li{grid-template-columns:minmax(0,1fr)}}
`;
