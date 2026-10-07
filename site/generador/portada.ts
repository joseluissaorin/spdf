/**
 * La portada: qué es SPDF y por qué, en cinco principios (anclas, procedencia,
 * una lectura y muchas consultas, portabilidad, honestidad de la cita), lo que
 * hay dentro de un .spdf, los perfiles, las implementaciones de un vistazo y
 * por dónde empezar. Sale en HTML y en su gemelo Markdown de los mismos textos.
 */
import { aSvg } from '../dibujo/boceto';
import { folio } from '../dibujo/dibujos/folio';
import { IMPLEMENTACIONES, type Lengua, RUTAS, esc, ORIGEN, rutaMd } from './sitio';
import { estadoDe, etiquetaEstado, type Estado } from './estado';

/**
 * El ejemplo de la línea del ancla: siempre real. Sale de un fichero publicado
 * (una obra de SPDF Commons o, si aún no hay, la muestra del validador) y se
 * puede abrir en el validador; la cita la calcula spdf-format.
 */
export interface EjemploAncla {
  uri: string;
  cita: string;
  /** Página física, folio impreso y tramo de caracteres, para explicarla. */
  p?: number;
  pe?: number;
  f?: string;
  fe?: string;
  char?: [number, number];
  /** De qué obra sale (título y autor) y dónde inspeccionarla. */
  obra: string;
  inspeccionar: Record<Lengua, string>;
}

function uriHtml(uri: string): string {
  const [base, frag = ''] = uri.split('#');
  const corta = base!.replace(/^(spdf:sha256-[0-9a-f]{6})[0-9a-f]+$/, '$1…');
  return `${esc(corta)}#${frag.split('&').map((x) => (/^(p|f)=/.test(x) ? `<b>${esc(x)}</b>` : esc(x))).join('&amp;')}`;
}

function explicacion(e: EjemploAncla, l: Lengua): string {
  const deducido = e.f !== undefined && e.cita.includes(`[${e.f}]`);
  const y = (a: string | number, b: string | number) => (Number(b) === Number(a) + 1 ? (l === 'es' ? `${a} y ${b}` : `${a} and ${b}`) : (l === 'es' ? `${a} a ${b}` : `${a} to ${b}`));
  const partes: string[] = [];
  if (l === 'es') {
    if (e.p !== undefined) partes.push(e.pe !== undefined ? `páginas físicas ${y(e.p, e.pe)} del fichero` : `página física ${e.p} del fichero`);
    if (e.f !== undefined) partes.push(e.fe !== undefined ? `folios impresos ${y(e.f, e.fe)}` : `folio impreso ${e.f}`);
    if (e.char) partes.push(e.pe !== undefined ? `desde el carácter ${e.char[0]} de la primera` : `caracteres ${e.char[0]} a ${e.char[1]} de esa página`);
    const frase = partes.join(', ');
    const nota = deducido ? ` El folio ${e.f} no está impreso en su página: se dedujo de las vecinas y por eso va entre corchetes.` : '';
    return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}, en <cite>${esc(e.obra)}</cite>.${nota} La cita se calcula a partir del ancla guardada al leer; no se adivina nada. <a href="${e.inspeccionar.es}">Ábrelo en el validador</a>.`;
  }
  if (e.p !== undefined) partes.push(e.pe !== undefined ? `physical pages ${y(e.p, e.pe)} of the file` : `physical page ${e.p} of the file`);
  if (e.f !== undefined) partes.push(e.fe !== undefined ? `printed folios ${y(e.f, e.fe)}` : `printed folio ${e.f}`);
  if (e.char) partes.push(e.pe !== undefined ? `from character ${e.char[0]} of the first` : `characters ${e.char[0]} to ${e.char[1]} of that page`);
  const frase = partes.join(', ');
  const nota = deducido ? ` Folio ${e.f} is not printed on its page: it was inferred from its neighbours, which is why it is in brackets.` : '';
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}, in <cite>${esc(e.obra)}</cite>.${nota} The citation is computed from the anchor stored at reading time; nothing is guessed. <a href="${e.inspeccionar.en}">Open it in the validator</a>.`;
}


export const TEXTOS = {
  en: {
    titulo: 'SPDF: documents read once, cited forever',
    descripcion: 'SPDF is an open file format for documents that have already been read. Every passage carries its exact anchor (printed page, folio, second, slide, verse), so a citation can only print what the source says.',
    sobre: 'SPDF 5.0 · Semantic Processed Document Format · open standard',
    titular: ['Read once.', 'Cite <em>forever.</em>'],
    titularMd: 'Read once. Cite forever.',
    entrada: 'SPDF is an open file format for documents that have <strong>already been read</strong>. Every passage carries its exact anchor: the printed page, the folio, the second of a recording, the slide or the verse. A citation can only print what the source says.',
    botones: [['spec', 'Read the specification'], ['validador', 'Validate a file'], ['lector', 'Open the reader']] as const,
    canto: 'SQLite 3 · application_id 0x53504446 · user_version 500',
    anclaRotulo: 'Anchor URI',
    porQue: 'Why a format',
    porQueTexto: 'Reading a document well is slow and expensive: OCR, transcription, finding the printed folios, sectioning, embeddings. SPDF stores the result so that nobody has to do it twice, and so that whatever cites from it can be checked.',
    principios: [
      ['Anchors', 'Every passage knows where it is. Fragments are stored with the place they came from: physical page and printed folio (roman, inferred or by leaf), second and word timings in audio and video, slide, sheet range, verse line or a canonical reference such as Stephanus 514a. Anchors serialise as portable URIs.', '{"type":"page","physical":29,"printed":"21"}'],
      ['Provenance', 'Every field says who wrote it. Each unit records which reader produced its text (a PDF text layer, a vision model, a speech recogniser) and with what confidence; the metadata records where each field came from (colophon, title page, catalogue). Inferred folios are cited in brackets.', 'reader: gemma-4-e4b · confidence: 0.97'],
      ['Read once, query many', 'The expensive part happens once. OCR, transcription, sectioning and embeddings are paid for when the file is produced. After that it answers lexical, semantic and hybrid queries offline, even on a phone, with SQLite’s own full-text index and vectors from several models side by side.', 'fts5 unicode61 · f32 | f16 | i8 · RRF k = 10'],
      ['Portability', 'One file, any language, no server. A .spdf is a plain SQLite 3 database: no custom container, no account. It can be memory-mapped or read over HTTP ranges, and twelve independent implementations open it, all tested against the same conformance suite.', 'one document = one file'],
      ['Honest citation', 'A citation can only print what the source says. Short citations and bibliography (CSL-JSON, BibTeX) are derived from the stored anchor and the CSL record, never generated. Agents get the same guarantee through the MCP server: they search, they quote and they cite with the exact folio, and they cannot invent one.', '(Saorín Ferrer, 2026, p. [3])'],
    ] as const,
    dentro: 'Inside a .spdf',
    dentroTexto: 'A single SQLite file, uncompressed so it can be read by ranges, with no triggers and no views. Readers open it read-only, in defensive mode, and never load extensions. The schema is small enough to learn in an afternoon.',
    tablas: [
      ['spdf_meta', 'version, profile, generator, document id'],
      ['documents', 'one CSL-JSON record, with the provenance of each field'],
      ['units', 'the citable units: pages, time spans, slides, sheets'],
      ['fragments', 'passages of 150 to 300 words with their anchors'],
      ['fragments_fts', 'FTS5 index, accent-insensitive'],
      ['sections', 'the heading tree'],
      ['figures', 'figures, plates and frames, with region and description'],
      ['spaces', 'vector spaces, declared as model@dims'],
      ['vectors', 'little-endian f32, f16 or i8'],
      ['blobs', 'the original and the images, with their SHA-256'],
      ['provenance', 'what produced what, with which model, and when'],
      ['extensions', 'x_vendor_name tables, required or optional'],
    ] as const,
    perfilesRotulo: 'Profiles',
    perfiles: [
      ['core', 'Text and anchors. Enough to search and cite.'],
      ['semantic', 'Core plus vectors from one or more embedding models.'],
      ['media', 'Core plus audio and video with per-word timings.'],
      ['full', 'All of the above.'],
    ] as const,
    impl: 'Twelve implementations, one suite',
    implTexto: 'The Rust implementation is the reference and also exposes a C ABI. The others are native and independent: each one opens, validates, dumps, searches, formats anchors, cites and writes, and each one is checked by the same conformance cases on every commit.',
    implMas: 'Status and CI of every implementation',
    empezar: 'Where to start',
    caminos: [
      ['Validate', 'Drop a .spdf on the validator: it checks the file against the specification and shows what is inside, in your browser, without uploading anything.', 'validador', 'Open the validator'],
      ['Read', 'SPDF Reader opens, searches and cites SPDF files on macOS, Windows, Linux, iOS, Android and the web, with local models and no account.', 'descargas', 'Download the reader'],
      ['Build', 'spdf build turns a PDF, a scan, an EPUB or a recording into an SPDF with local models, or with your own API key. Or start from SPDF Commons, a small collection of public-domain works.', 'commons', 'Browse SPDF Commons'],
    ] as const,
    agentes: 'For agents',
    agentesTexto: 'Every page of this site has a Markdown twin (the same address ending in .md), /llms.txt indexes them and /llms-full.txt carries the whole specification. The spdf-mcp server lets any agent search a folder of SPDF files and cite with the exact folio.',
    agentesMas: 'How agents use SPDF',
  },
  es: {
    titulo: 'SPDF: documentos leídos una vez, citables siempre',
    descripcion: 'SPDF es un formato de fichero abierto para documentos que ya se han leído. Cada pasaje lleva su ancla exacta (página impresa, folio, segundo, diapositiva, verso), así que una cita solo puede imprimir lo que dice la fuente.',
    sobre: 'SPDF 5.0 · Semantic Processed Document Format · estándar abierto',
    titular: ['Se lee una vez.', 'Se cita <em>siempre.</em>'],
    titularMd: 'Se lee una vez. Se cita siempre.',
    entrada: 'SPDF es un formato de fichero abierto para documentos que <strong>ya se han leído</strong>. Cada pasaje lleva su ancla exacta: la página impresa, el folio, el segundo de una grabación, la diapositiva o el verso. Una cita solo puede imprimir lo que dice la fuente.',
    botones: [['spec', 'Leer la especificación'], ['validador', 'Validar un fichero'], ['lector', 'Abrir el lector']] as const,
    canto: 'SQLite 3 · application_id 0x53504446 · user_version 500',
    anclaRotulo: 'URI de ancla',
    porQue: 'Por qué un formato',
    porQueTexto: 'Leer bien un documento es lento y caro: reconocer el texto, transcribir, encontrar los folios impresos, dividir en secciones, calcular vectores. SPDF guarda el resultado para que nadie tenga que hacerlo dos veces, y para que todo lo que se cite a partir de él se pueda comprobar.',
    principios: [
      ['Anclas', 'Cada pasaje sabe dónde está. Los fragmentos se guardan con el sitio del que salieron: página física y folio impreso (romano, deducido o por hojas), segundo y tiempos de cada palabra en audio y vídeo, diapositiva, rango de filas, verso o una referencia canónica como Stephanus 514a. Las anclas se escriben como URI portátiles.', '{"type":"page","physical":29,"printed":"21"}'],
      ['Procedencia', 'Cada campo dice quién lo escribió. Cada unidad registra qué lector produjo su texto (la capa de texto de un PDF, un modelo de visión, un reconocedor de voz) y con qué confianza; la ficha registra de dónde salió cada campo (colofón, portada, catálogo). Los folios deducidos se citan entre corchetes.', 'reader: gemma-4-e4b · confidence: 0.97'],
      ['Una lectura, muchas consultas', 'Lo caro se hace una sola vez. El reconocimiento de texto, la transcripción, las secciones y los vectores se pagan al producir el fichero. Después responde a consultas léxicas, semánticas e híbridas sin conexión, incluso en un teléfono, con el índice de texto completo del propio SQLite y vectores de varios modelos a la vez.', 'fts5 unicode61 · f32 | f16 | i8 · RRF k = 10'],
      ['Portabilidad', 'Un fichero, cualquier lenguaje, ningún servidor. Un .spdf es una base de datos SQLite 3 corriente: ni contenedor propio ni cuenta. Se puede proyectar en memoria o leer por rangos HTTP, y lo abren doce implementaciones independientes, todas probadas con la misma batería de conformidad.', 'un documento = un fichero'],
      ['Honestidad de la cita', 'Una cita solo puede imprimir lo que dice la fuente. Las citas cortas y la bibliografía (CSL-JSON, BibTeX) se derivan del ancla guardada y de la ficha CSL; no se generan. Los agentes tienen la misma garantía con el servidor MCP: buscan, citan el pasaje y dan el folio exacto, y no pueden inventárselo.', '(Saorín Ferrer, 2026, p. [3])'],
    ] as const,
    dentro: 'Dentro de un .spdf',
    dentroTexto: 'Un único fichero SQLite, sin comprimir para que se pueda leer por rangos, sin disparadores ni vistas. Los lectores lo abren en solo lectura, en modo defensivo, y nunca cargan extensiones. El esquema es lo bastante pequeño para aprenderlo en una tarde.',
    tablas: [
      ['spdf_meta', 'versión, perfil, programa que lo generó, identificador'],
      ['documents', 'una ficha CSL-JSON, con la procedencia de cada campo'],
      ['units', 'las unidades citables: páginas, tramos de tiempo, diapositivas, hojas'],
      ['fragments', 'pasajes de 150 a 300 palabras con sus anclas'],
      ['fragments_fts', 'índice FTS5, insensible a las tildes'],
      ['sections', 'el árbol de encabezados'],
      ['figures', 'figuras, láminas y fotogramas, con región y descripción'],
      ['spaces', 'espacios vectoriales, declarados como modelo@dims'],
      ['vectors', 'f32, f16 o i8 en little-endian'],
      ['blobs', 'el original y las imágenes, con su SHA-256'],
      ['provenance', 'qué produjo qué, con qué modelo y cuándo'],
      ['extensions', 'tablas x_proveedor_nombre, obligatorias u opcionales'],
    ] as const,
    perfilesRotulo: 'Perfiles',
    perfiles: [
      ['core', 'Texto y anclas. Basta para buscar y citar.'],
      ['semantic', 'Lo anterior más vectores de uno o varios modelos.'],
      ['media', 'Lo básico más audio y vídeo con tiempos por palabra.'],
      ['full', 'Todo lo anterior.'],
    ] as const,
    impl: 'Doce implementaciones, una batería',
    implTexto: 'La de Rust es la de referencia y además ofrece una ABI de C. Las demás son nativas e independientes: cada una abre, valida, vuelca, busca, escribe anclas, cita y construye ficheros, y todas pasan los mismos casos de conformidad en cada commit.',
    implMas: 'El estado y el CI de cada implementación',
    empezar: 'Por dónde empezar',
    caminos: [
      ['Validar', 'Suelta un .spdf en el validador: lo comprueba contra la especificación y te enseña lo que hay dentro, en tu navegador, sin subir nada.', 'validador', 'Abrir el validador'],
      ['Leer', 'El Lector SPDF abre, busca y cita ficheros SPDF en macOS, Windows, Linux, iOS, Android y la web, con modelos locales y sin cuenta.', 'descargas', 'Descargar el lector'],
      ['Construir', 'spdf build convierte un PDF, un escaneado, un EPUB o una grabación en un SPDF con modelos locales o con tu propia clave. O empieza por SPDF Commons, una pequeña colección de obras de dominio público.', 'commons', 'Ver SPDF Commons'],
    ] as const,
    agentes: 'Para agentes',
    agentesTexto: 'Cada hoja de esta web tiene un gemelo en Markdown (la misma dirección terminada en .md), /llms.txt los reúne y /llms-full.txt trae la especificación entera. El servidor spdf-mcp permite a cualquier agente buscar en una carpeta de ficheros SPDF y citar con el folio exacto.',
    agentesMas: 'Cómo usan SPDF los agentes',
  },
};

const FORMA: Record<string, string> = {
  core: '<span class="cuadrado"></span>',
  semantic: '<span class="circulo"></span>',
  media: '<span class="triangulo"></span>',
  full: '<span class="cuadrado"></span><span class="circulo"></span><span class="triangulo"></span>',
};

function ruta(c: string, l: Lengua): string {
  if (c === 'lector') return '/reader/';
  return RUTAS[c as keyof typeof RUTAS][l];
}

export function portadaHtml(l: Lengua, estados: Record<string, Estado>, ej: EjemploAncla): string {
  const t = TEXTOS[l];
  const botones = t.botones.map(([c, txt], i) => `<a class="boton ${i === 0 ? 'tinta' : 'papel'}" href="${ruta(c, l)}">${txt}${i === 0 ? ' <span class="flecha" aria-hidden="true">→</span>' : ''}</a>`).join('');
  const lenguajes = IMPLEMENTACIONES.map((im) => {
    const e = estadoDe(estados, im.carpeta);
    return `<li><a href="${RUTAS.docs[l]}/${im.id}"><strong>${esc(im.nombre)}</strong><code>${esc(im.paquete)}</code>${etiquetaEstado(e, l)}</a></li>`;
  }).join('');
  return `<div class="portada">
<section class="heroe" aria-labelledby="titular">
<div class="texto">
<p class="sobre rotulo">${t.sobre}</p>
<h1 id="titular">${t.titular.map((s) => `<span>${s}</span>`).join('')}</h1>
<p class="entrada">${t.entrada}</p>
<div class="acciones">${botones}</div>
</div>
<figure class="lamina">
<div class="sol" aria-hidden="true"></div>
<div class="hoja" aria-hidden="true"></div>
${aSvg(folio, { lengua: l, espera: 0.25 })}
</figure>
<span class="canto rotulo" aria-hidden="true">${t.canto}</span>
</section>
<section class="ancla-demo" aria-label="${t.anclaRotulo}">
<span class="rotulo">${t.anclaRotulo}</span>
<code>${uriHtml(ej.uri)}</code>
<span class="cita">${esc(ej.cita)}</span>
<p>${explicacion(ej, l)}</p>
</section>
<section class="capitulos" aria-labelledby="por-que">
<header><h2 id="por-que">${t.porQue}</h2><p>${t.porQueTexto}</p></header>
<ol class="principios">${t.principios.map(([h, p, d]) => {
    const [lema, ...resto] = p.split('. ');
    return `<li><h3>${h}</h3><p><strong>${lema}.</strong> ${resto.join('. ')}</p><code>${esc(d)}</code></li>`;
  }).join('')}</ol>
</section>
<section class="dentro" aria-labelledby="dentro">
<div>
<h2 id="dentro">${t.dentro}</h2>
<p>${t.dentroTexto}</p>
<p class="rotulo">${t.perfilesRotulo}</p>
<ul class="perfiles">${t.perfiles.map(([n, d]) => `<li><span class="forma" aria-hidden="true">${FORMA[n]}</span><strong>${n}</strong><span>${d}</span></li>`).join('')}</ul>
</div>
<ul class="tablas">${t.tablas.map(([n, d]) => `<li><code>${n}</code><span>${d}</span></li>`).join('')}</ul>
</section>
<section class="franja" aria-labelledby="impl">
<h2 id="impl">${t.impl}</h2>
<p>${t.implTexto} <a href="${RUTAS.implementaciones[l]}">${t.implMas}</a>.</p>
<ul class="lenguajes">${lenguajes}</ul>
</section>
<section class="caminos" aria-labelledby="empezar">
<h2 id="empezar">${t.empezar}</h2>
${t.caminos.map(([h, p, c, mas]) => `<div class="camino"><h3>${h}</h3><p>${p}</p><a class="mas" href="${ruta(c, l)}">${mas} →</a></div>`).join('\n')}
<div class="camino"><h3>${t.agentes}</h3><p>${t.agentesTexto}</p><a class="mas" href="${RUTAS.agentes[l]}">${t.agentesMas} →</a></div>
</section>
</div>`;
}

/** El gemelo Markdown de la portada. */
export function portadaMd(l: Lengua, estados: Record<string, Estado>, ej: EjemploAncla): string {
  const t = TEXTOS[l];
  const P: string[] = [];
  P.push(`# ${t.titularMd}`, '');
  P.push(t.botones.map(([c, txt]) => `[${txt}](${ORIGEN}${c === 'lector' ? '/reader/' : rutaMd(ruta(c, l))})`).join(' · '), '');
  P.push(`${t.anclaRotulo}: \`${ej.uri}\` → ${ej.cita}`, '', explicacion(ej, l).replace(/<a href="([^"]+)">([^<]+)<\/a>/, `[$2](${ORIGEN}$1)`).replace(/<\/?cite>/g, '*'), '');
  P.push(`## ${t.porQue}`, '', t.porQueTexto, '');
  t.principios.forEach(([h, p, d], i) => P.push(`### ${['I', 'II', 'III', 'IV', 'V'][i]}. ${h}`, '', p, '', `\`${d}\``, ''));
  P.push(`## ${t.dentro}`, '', t.dentroTexto, '', `| ${l === 'es' ? 'Tabla' : 'Table'} | ${l === 'es' ? 'Qué guarda' : 'What it holds'} |`, '| --- | --- |');
  for (const [n, d] of t.tablas) P.push(`| \`${n}\` | ${d} |`);
  P.push('', `### ${t.perfilesRotulo}`, '');
  for (const [n, d] of t.perfiles) P.push(`- \`${n}\`: ${d}`);
  P.push('', `## ${t.impl}`, '', t.implTexto, '');
  for (const im of IMPLEMENTACIONES) {
    const e = estadoDe(estados, im.carpeta);
    P.push(`- **${im.nombre}** (\`${im.paquete}\`): ${etiquetaEstado(e, l, true)}. ${ORIGEN}${rutaMd(`${RUTAS.docs[l]}/${im.id}`)}`);
  }
  P.push('', `## ${t.empezar}`, '');
  for (const [h, p, c] of t.caminos) P.push(`### ${h}`, '', p, '', `${ORIGEN}${rutaMd(ruta(c, l))}`, '');
  P.push(`### ${t.agentes}`, '', t.agentesTexto, '', `${ORIGEN}${rutaMd(RUTAS.agentes[l])}`, '');
  return P.join('\n');
}
