#!/usr/bin/env node
/**
 * Ficheros SPDF 5.0 de prueba para el lector, con obras de dominio público.
 *
 *   node scripts/fixtures.mjs [carpeta]      (por defecto e2e/datos/)
 *
 * Salen:
 *   - quijote-cap1.spdf: el capítulo I del Quijote (1605) como «libro escaneado»,
 *     con facsímiles SVG por página, preliminares en romanos (folios i–ii),
 *     secciones, fragmentos, una figura descrita y la procedencia.
 *   - quijote-audio.spdf: el arranque del capítulo leído por la voz del sistema
 *     (`say -o`, que escribe a fichero y no suena), con tiempos por palabra.
 *   - quijote-video.spdf: lo mismo como vídeo (forma de onda de ffmpeg).
 *
 * Esto es solo para desarrollar y probar el lector mientras el productor de
 * referencia (`producer/`) genera los suyos: no sustituye a la conformidad.
 * Escribe el esquema 5.0 del contrato (spec/CONTRACT.md, §2) con node:sqlite.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = resolve(process.argv[2] ?? join(aqui, '../e2e/datos'));
mkdirSync(destino, { recursive: true });

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ahora = '2026-10-07T00:00:00Z';

const ESQUEMA = `
CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL,
  source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL,
  duration REAL, created TEXT NOT NULL, updated TEXT NOT NULL,
  title TEXT, authors TEXT, year INTEGER, language TEXT, rights TEXT);
CREATE TABLE units (
  id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,
  anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT,
  image TEXT, thumbnail TEXT, reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
  printed TEXT, t0 REAL, t1 REAL, words TEXT);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);
CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT);
CREATE TABLE fragments (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL,
  ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT,
  anchor TEXT NOT NULL, anchor_end TEXT, search_text TEXT);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);
CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2');
CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,
  caption TEXT, description TEXT, anchor TEXT NOT NULL);
CREATE TABLE spaces (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
  dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1,
  truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT);
CREATE TABLE vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space));
CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL);
CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
`;

/** Miguel de Cervantes, «El ingenioso hidalgo don Quijote de la Mancha» (1605), cap. I. Dominio público. */
const CAPITULO = [
  'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda. El resto della concluían sayo de velarte, calzas de velludo para las fiestas, con sus pantuflos de lo mesmo, y los días de entresemana se honraba con su vellorí de lo más fino.',
  'Tenía en su casa una ama que pasaba de los cuarenta, y una sobrina que no llegaba a los veinte, y un mozo de campo y plaza, que así ensillaba el rocín como tomaba la podadera. Frisaba la edad de nuestro hidalgo con los cincuenta años; era de complexión recia, seco de carnes, enjuto de rostro, gran madrugador y amigo de la caza. Quieren decir que tenía el sobrenombre de Quijada, o Quesada, que en esto hay alguna diferencia en los autores que deste caso escriben; aunque por conjeturas verosímiles se deja entender que se llamaba Quijana. Pero esto importa poco a nuestro cuento; basta que en la narración dél no se salga un punto de la verdad.',
  'Es, pues, de saber que este sobredicho hidalgo, los ratos que estaba ocioso, que eran los más del año, se daba a leer libros de caballerías, con tanta afición y gusto, que olvidó casi de todo punto el ejercicio de la caza, y aun la administración de su hacienda; y llegó a tanto su curiosidad y desatino en esto, que vendió muchas hanegas de tierra de sembradura para comprar libros de caballerías en que leer, y así, llevó a su casa todos cuantos pudo haber dellos.',
  'Y de todos, ningunos le parecían tan bien como los que compuso el famoso Feliciano de Silva, porque la claridad de su prosa y aquellas entricadas razones suyas le parecían de perlas, y más cuando llegaba a leer aquellos requiebros y cartas de desafíos, donde en muchas partes hallaba escrito: «La razón de la sinrazón que a mi razón se hace, de tal manera mi razón enflaquece, que con razón me quejo de la vuestra fermosura».',
  'Con estas razones perdía el pobre caballero el juicio, y desvelábase por entenderlas y desentrañarles el sentido, que no se lo sacara ni las entendiera el mesmo Aristóteles, si resucitara para solo ello. No estaba muy bien con las heridas que don Belianís daba y recebía, porque se imaginaba que, por grandes maestros que le hubiesen curado, no dejaría de tener el rostro y todo el cuerpo lleno de cicatrices y señales.',
  'Tuvo muchas veces competencia con el cura de su lugar —que era hombre docto, graduado en Sigüenza— sobre cuál había sido mejor caballero: Palmerín de Ingalaterra o Amadís de Gaula; mas maese Nicolás, barbero del mesmo pueblo, decía que ninguno llegaba al Caballero del Febo.',
  'En resolución, él se enfrascó tanto en su letura, que se le pasaban las noches leyendo de claro en claro, y los días de turbio en turbio; y así, del poco dormir y del mucho leer, se le secó el celebro, de manera que vino a perder el juicio. Llenósele la fantasía de todo aquello que leía en los libros, así de encantamentos como de pendencias, batallas, desafíos, heridas, requiebros, amores, tormentas y disparates imposibles.',
  'En efeto, rematado ya su juicio, vino a dar en el más estraño pensamiento que jamás dio loco en el mundo, y fue que le pareció convenible y necesario, así para el aumento de su honra como para el servicio de su república, hacerse caballero andante, y irse por todo el mundo con sus armas y caballo a buscar las aventuras.',
  'Lo primero que hizo fue limpiar unas armas que habían sido de sus bisabuelos, que, tomadas de orín y llenas de moho, luengos siglos había que estaban puestas y olvidadas en un rincón. Limpiólas y aderezólas lo mejor que pudo, pero vio que tenían una gran falta, y era que no tenían celada de encaje, sino morrión simple; mas a esto suplió su industria, porque de cartones hizo un modo de media celada.',
  'Fue luego a ver su rocín, y, aunque tenía más cuartos que un real y más tachas que el caballo de Gonela, le pareció que ni el Bucéfalo de Alejandro ni Babieca el del Cid con él se igualaban. Cuatro días se le pasaron en imaginar qué nombre le pondría, y al fin le vino a llamar Rocinante, nombre, a su parecer, alto, sonoro y significativo.',
  'Puesto nombre, y tan a su gusto, a su caballo, quiso ponérsele a sí mismo, y en este pensamiento duró otros ocho días, y al cabo se vino a llamar don Quijote. Limpias, pues, sus armas, hecho del morrión celada, puesto nombre a su rocín y confirmándose a sí mismo, se dio a entender que no le faltaba otra cosa sino buscar una dama de quien enamorarse.',
  'Y fue, a lo que se cree, que en un lugar cerca del suyo había una moza labradora de muy buen parecer, de quien él un tiempo anduvo enamorado, aunque, según se entiende, ella jamás lo supo ni le dio cata dello. Llamábase Aldonza Lorenzo, y a esta le pareció ser bien darle título de señora de sus pensamientos; y, buscándole nombre, vino a llamarla Dulcinea del Toboso, porque era natural del Toboso.',
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Parte un texto en renglones de unos `n` caracteres. */
function renglones(texto, n = 54) {
  const out = []; let l = '';
  for (const w of texto.split(/\s+/)) {
    if ((l + ' ' + w).trim().length > n) { out.push(l.trim()); l = w; } else l += ' ' + w;
  }
  if (l.trim()) out.push(l.trim());
  return out;
}

/** Un facsímil de página «escaneada»: papel envejecido, caja de texto, titulillo y folio. */
function facsimil({ lineas, titulillo, folio, figura = false, portada = null }) {
  const filas = [];
  let y = 150;
  if (portada) {
    filas.push(`<text x="300" y="250" text-anchor="middle" font-size="30" letter-spacing="3">${esc(portada[0])}</text>`);
    filas.push(`<text x="300" y="300" text-anchor="middle" font-size="22" font-style="italic">${esc(portada[1])}</text>`);
    filas.push(`<text x="300" y="360" text-anchor="middle" font-size="18">${esc(portada[2])}</text>`);
    filas.push(`<circle cx="300" cy="500" r="60" fill="none" stroke="#3b2a1d" stroke-width="3"/><path d="M265 520 L300 455 L335 520 Z" fill="#3b2a1d"/>`);
    filas.push(`<text x="300" y="700" text-anchor="middle" font-size="16" letter-spacing="2">EN MADRID, POR JUAN DE LA CUESTA</text>`);
    filas.push(`<text x="300" y="730" text-anchor="middle" font-size="16">Año 1605</text>`);
  }
  for (const l of lineas) {
    filas.push(`<text x="80" y="${y}" font-size="17" textLength="${Math.min(440, l.length * 8.1)}" lengthAdjust="spacingAndGlyphs">${esc(l)}</text>`);
    y += 26;
  }
  if (figura) {
    filas.push(`<g transform="translate(140 ${y + 10})"><rect width="320" height="190" fill="none" stroke="#3b2a1d" stroke-width="2"/>
      <path d="M30 170 L110 60 L150 110 L190 40 L290 170 Z" fill="none" stroke="#3b2a1d" stroke-width="2.5"/>
      <circle cx="250" cy="45" r="18" fill="none" stroke="#3b2a1d" stroke-width="2"/>
      <path d="M60 170 l10 -40 l6 40 M120 170 l-4 -26 l12 0 z" stroke="#3b2a1d" fill="none"/></g>`);
    filas.push(`<text x="300" y="${y + 230}" text-anchor="middle" font-size="14" font-style="italic">Grabado: un caballero y su rocín ante la sierra.</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
<defs><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${folio.length + lineas.length}"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.08 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
<rect width="600" height="900" fill="#ece0c4"/><rect width="600" height="900" filter="url(#g)"/>
<rect x="18" y="14" width="566" height="874" fill="none" stroke="#d8c8a2" stroke-width="6"/>
<g font-family="Georgia, 'Times New Roman', serif" fill="#2f2117">
${titulillo ? `<text x="300" y="88" text-anchor="middle" font-size="14" letter-spacing="3">${esc(titulillo)}</text><line x1="80" y1="100" x2="520" y2="100" stroke="#2f2117"/>` : ''}
${filas.join('\n')}
<text x="300" y="850" text-anchor="middle" font-size="15">${esc(folio)}</text>
</g></svg>`;
}

function nuevo(ruta) {
  if (existsSync(ruta)) rmSync(ruta);
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF;');
  db.exec(ESQUEMA);
  db.exec('PRAGMA application_id = 1397769286; PRAGMA user_version = 500;');
  return db;
}

function cerrar(db) {
  db.exec("INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild');");
  db.exec('VACUUM;');
  db.close();
}

function blob(db, key, mime, data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  db.prepare('INSERT INTO blobs(key, mime, sha256, data) VALUES (?,?,?,?)').run(key, mime, sha(buf), buf);
  return `blob:${key}`;
}

function meta(db, docId, profile) {
  const ins = db.prepare('INSERT INTO spdf_meta(key, value) VALUES (?,?)');
  ins.run('spdf_version', '5.0');
  ins.run('profile', profile);
  ins.run('created', ahora);
  ins.run('generator', 'spdf-reader-fixtures/0.1');
  ins.run('document_id', docId);
  ins.run('license_note', 'Texto de dominio público (Cervantes, 1605). Facsímiles sintéticos generados para pruebas.');
}

const CSL_QUIJOTE = {
  type: 'book',
  title: 'El ingenioso hidalgo don Quijote de la Mancha',
  author: [{ family: 'Cervantes Saavedra', given: 'Miguel de' }],
  issued: { 'date-parts': [[1605]] },
  publisher: 'Juan de la Cuesta',
  'publisher-place': 'Madrid',
  language: 'es',
  abstract: 'Primera parte. Capítulo primero: «Que trata de la condición y ejercicio del famoso hidalgo don Quijote de la Mancha».',
  spdf: { provenance: { title: { source: 'colophon', confidence: 0.99 }, issued: { source: 'colophon', confidence: 0.98 } } },
};

/* ------------------------------------------------------------------ */
/* 1. El libro                                                        */
/* ------------------------------------------------------------------ */
function libro() {
  const ruta = join(destino, 'quijote-cap1.spdf');
  const db = nuevo(ruta);
  const doc = 'quijote-1605-cap1';
  meta(db, doc, 'core');

  // Paginación: portada (sin folio), dos preliminares en romanos, el capítulo desde la p. 1.
  const paginas = [];
  paginas.push({ portada: ['EL INGENIOSO HIDALGO', 'don Quijote de la Mancha', 'Miguel de Cervantes Saavedra'], texto: 'EL INGENIOSO HIDALGO DON QUIJOTE DE LA MANCHA\n\nCompuesto por Miguel de Cervantes Saavedra\n\nEn Madrid, por Juan de la Cuesta. Año 1605', folio: null, romano: false });
  paginas.push({ texto: 'Tasa\n\nYo, Juan Gallo de Andrada, escribano de Cámara del Rey nuestro señor, de los que residen en su Consejo, certifico y doy fe que, habiendo visto por los señores dél un libro intitulado El ingenioso hidalgo de la Mancha, compuesto por Miguel de Cervantes Saavedra, tasaron cada pliego del dicho libro a tres maravedís y medio.', folio: 'iii', romano: true });
  paginas.push({ texto: 'Testimonio de las erratas\n\nEste libro no tiene cosa digna que no corresponda a su original; en testimonio de lo haber correcto, di esta fe. En el Colegio de la Madre de Dios de los Teólogos de la Universidad de Alcalá, en primero de diciembre de 1604 años.', folio: 'iv', romano: true });

  // El capítulo: dos párrafos por página, la figura en la tercera.
  let p = 1;
  for (let i = 0; i < CAPITULO.length; i += 2) {
    const pars = CAPITULO.slice(i, i + 2);
    paginas.push({ texto: (i === 0 ? '# Capítulo primero\n\nQue trata de la condición y ejercicio del famoso hidalgo don Quijote de la Mancha\n\n' : '') + pars.join('\n\n'), folio: String(p), romano: false, figura: i === 4, pars, primera: i === 0 });
    p++;
  }

  const insU = db.prepare(`INSERT INTO units(id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`);
  const unidades = [];
  paginas.forEach((pg, k) => {
    const ord = k + 1;
    const id = `${doc}:u${ord}`;
    const ancla = { type: 'page', physical: ord, printed: pg.folio, roman: pg.romano, foliation: 'page', source: pg.folio ? 'read' : 'none', confidence: pg.folio ? 0.99 : 0.7 };
    const lineas = pg.portada ? [] : renglones(pg.texto.replace(/^# /m, '').replace(/\n+/g, ' '), 54).slice(0, pg.figura ? 16 : 26);
    const img = blob(db, `paginas/${String(ord).padStart(4, '0')}.svg`, 'image/svg+xml',
      facsimil({ lineas, titulillo: pg.folio && !pg.romano ? 'DON QUIJOTE DE LA MANCHA' : (pg.romano ? 'PRELIMINARES' : ''), folio: pg.folio ?? '', figura: !!pg.figura, portada: pg.portada ?? null }));
    const notas = pg.primera ? JSON.stringify(['Lantejas: lentejas. Duelos y quebrantos: huevos con torreznos, comida permitida los sábados.']) : null;
    insU.run(id, doc, ord, JSON.stringify(ancla), pg.texto, notas, pg.folio && !pg.romano ? 'DON QUIJOTE DE LA MANCHA' : null, pg.folio, img, img, 'pdf-text-layer', pg.folio ? 0.98 : 0.8, pg.folio);
    unidades.push({ id, ord, ancla, pg });
  });

  // Secciones.
  const insS = db.prepare('INSERT INTO sections(id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?,?,?,?,?,?,?,?)');
  insS.run(`${doc}:s0`, doc, null, 1, 'Preliminares', unidades[0].id, unidades[2].id, 'Portada, tasa y testimonio de las erratas.');
  insS.run(`${doc}:s1`, doc, null, 1, 'Capítulo primero', unidades[3].id, unidades.at(-1).id, 'Condición y ejercicio del hidalgo; sus lecturas, sus armas, su rocín y su dama.');

  // Fragmentos: un párrafo cada uno, con su ancla exacta (chars en el texto NFC de la unidad).
  const insF = db.prepare(`INSERT INTO fragments(n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  const contextos = [
    'Retrato del hidalgo: su comida, su vestido y su hacienda.',
    'La casa del hidalgo y la duda sobre su nombre: Quijada, Quesada o Quijana.',
    'El hidalgo se entrega a los libros de caballerías y vende tierras para comprarlos.',
    'Las razones enrevesadas de Feliciano de Silva que tanto le gustaban.',
    'Perdía el juicio por desentrañar aquellas razones; las heridas de don Belianís.',
    'Disputas con el cura y el barbero sobre cuál fue el mejor caballero.',
    'Del poco dormir y del mucho leer se le secó el celebro.',
    'Decide hacerse caballero andante.',
    'Limpia las armas de sus bisabuelos y fabrica una celada de cartón.',
    'Bautiza a su caballo: Rocinante.',
    'Se llama a sí mismo don Quijote y busca una dama.',
    'Aldonza Lorenzo se convierte en Dulcinea del Toboso.',
  ];
  for (const u of unidades) {
    const texto = u.pg.texto.normalize('NFC');
    const partes = u.pg.pars ?? [texto.replace(/\n+/g, ' ')];
    for (const par of partes) {
      const desde = [...texto].length - [...texto.slice(texto.indexOf(par))].length;
      const c = [desde, desde + [...par].length];
      n++;
      const seccion = u.pg.pars ? ['Capítulo primero'] : ['Preliminares'];
      const ancla = { ...u.ancla, chars: c };
      const idx = CAPITULO.indexOf(par);
      insF.run(n, `${doc}:f${n}`, doc, u.id, n, par.normalize('NFC'), idx >= 0 ? contextos[idx] : 'Preliminares legales de la primera edición.', JSON.stringify(seccion), JSON.stringify(ancla), null,
        // Capa de ortografía modernizada (solo para buscar): lantejas → lentejas, dél → de él…
        par.includes('lantejas') ? 'lentejas' : par.includes('celebro') ? 'cerebro' : par.includes('efeto') ? 'efecto' : '');
    }
  }

  // Una figura, con su región en la página.
  const u5 = unidades.find((u) => u.pg.figura);
  db.prepare('INSERT INTO figures(id, document, unit, image, caption, description, anchor) VALUES (?,?,?,?,?,?,?)').run(
    `${doc}:fig1`, doc, u5.id, `blob:paginas/${String(u5.ord).padStart(4, '0')}.svg`,
    'Un caballero y su rocín ante la sierra.',
    'Grabado lineal enmarcado: a la izquierda, una sierra de picos agudos; arriba a la derecha, un sol sin rayos; abajo, dos figuras pequeñas, un jinete con lanza y su caballo flaco.',
    JSON.stringify({ ...u5.ancla, region: { x: 0.23, y: 0.52, w: 0.54, h: 0.24 } }));

  db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    doc, 'scanned_pdf', JSON.stringify(CSL_QUIJOTE), sha(Buffer.from('quijote-1605-cap1-fuente-sintetica')), null, 'application/pdf', 0, unidades.length, null, ahora, ahora,
    CSL_QUIJOTE.title, 'Cervantes Saavedra', 1605, 'es', JSON.stringify({ license: 'CC0-1.0', access: 'open', note: 'Obra en dominio público.' }));

  const insP = db.prepare('INSERT INTO provenance(document, stage, provider, model, detail, ms, at) VALUES (?,?,?,?,?,?,?)');
  insP.run(doc, 'read', 'local', 'pdf-text-layer', JSON.stringify({ pages: unidades.length }), 120, ahora);
  insP.run(doc, 'fragment', 'local', 'spdf-reader-fixtures', JSON.stringify({ fragments: n }), 4, ahora);
  insP.run(doc, 'metadata', 'local', 'colophon', JSON.stringify({ fields: ['title', 'author', 'issued', 'publisher'] }), 2, ahora);
  cerrar(db);
  return ruta;
}

/* ------------------------------------------------------------------ */
/* 2. La grabación (audio y vídeo)                                     */
/* ------------------------------------------------------------------ */
function grabacion(tipo) {
  const ruta = join(destino, `quijote-${tipo}.spdf`);
  const tmp = mkdtempSync(join(tmpdir(), 'spdf-fix-'));
  const frases = [CAPITULO[0].split('. ').slice(0, 2).join('. ') + '.', CAPITULO[6].split('; ')[0] + '.', CAPITULO[9].split(', y al fin')[0] + '.'];
  const aiff = join(tmp, 'voz.aiff');
  // `say -o` escribe la voz en un fichero: no suena por los altavoces.
  execFileSync('say', ['-v', 'Eddy (Español (España))', '-r', '165', '-o', aiff, frases.join(' [[slnc 600]] ')]);
  const medio = join(tmp, tipo === 'audio' ? 'voz.m4a' : 'voz.mp4');
  if (tipo === 'audio') {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-c:a', 'aac', '-b:a', '64k', medio]);
  } else {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-filter_complex',
      '[0:a]showwaves=s=640x360:mode=cline:colors=0x2C1810,format=yuv420p[w];color=c=0xF5F0E8:s=640x360[bg];[bg][w]overlay=shortest=1[v]',
      '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', medio]);
  }
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', medio]).toString().trim());
  const datos = readFileSync(medio);

  const db = nuevo(ruta);
  const doc = `quijote-1605-${tipo}`;
  meta(db, doc, 'core media');
  const mime = tipo === 'audio' ? 'audio/mp4' : 'video/mp4';
  const ref = blob(db, `medio/voz.${tipo === 'audio' ? 'm4a' : 'mp4'}`, mime, datos);

  // Tiempos por palabra: proporcionales a la longitud (más una pausa en la puntuación).
  // Una síntesis no da los tiempos reales; para un fichero de prueba basta.
  const pesos = frases.map((f) => f.split(/\s+/).map((w) => w.length + 2 + (/[.,;:]$/.test(w) ? 4 : 0)));
  const total = pesos.flat().reduce((a, b) => a + b, 0) + 2 * 12;
  const porPeso = (dur - 0.3) / total;
  let t = 0.15;
  const insU = db.prepare(`INSERT INTO units(id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words)
    VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,NULL,?,?,?)`);
  const insF = db.prepare(`INSERT INTO fragments(n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text) VALUES (?,?,?,?,?,?,?,NULL,?,NULL,'')`);
  frases.forEach((f, i) => {
    const t0 = t;
    const cs = [];
    for (const p of pesos[i]) { const d = p * porPeso; cs.push(Math.round((t - t0) * 100), Math.round(d * 100)); t += d; }
    const t1 = t;
    t += 12 * porPeso;
    const ancla = { type: 'time', t0: +t0.toFixed(2), t1: +t1.toFixed(2), speaker: 'Voz sintética (lectura)' };
    const id = `${doc}:u${i + 1}`;
    insU.run(id, doc, i + 1, JSON.stringify(ancla), f.normalize('NFC'), 'whisper-large-v3-turbo', 0.93, ancla.t0, ancla.t1, JSON.stringify({ v: 1, t0: ancla.t0, cs }));
    insF.run(i + 1, `${doc}:f${i + 1}`, doc, id, i + 1, f.normalize('NFC'), ['Retrato del hidalgo.', 'El hidalgo pierde el juicio.', 'Rocinante.'][i], JSON.stringify(ancla));
  });

  const csl = { ...CSL_QUIJOTE, type: tipo === 'audio' ? 'song' : 'motion_picture', title: `Don Quijote, capítulo I (lectura en ${tipo === 'audio' ? 'audio' : 'vídeo'})`, abstract: 'Lectura sintética del arranque del capítulo primero, para pruebas.' };
  db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    doc, tipo, JSON.stringify(csl), sha(datos), ref, mime, datos.length, frases.length, +dur.toFixed(3), ahora, ahora,
    csl.title, 'Cervantes Saavedra', 1605, 'es', JSON.stringify({ license: 'CC0-1.0', access: 'open' }));
  db.prepare('INSERT INTO provenance(document, stage, provider, model, detail, ms, at) VALUES (?,?,?,?,?,?,?)').run(doc, 'transcribe', 'local', 'say + tiempos proporcionales', JSON.stringify({ duration: dur }), 900, ahora);
  cerrar(db);
  rmSync(tmp, { recursive: true, force: true });
  return ruta;
}

const hechos = [libro()];
try { hechos.push(grabacion('audio')); hechos.push(grabacion('video')); }
catch (e) { console.warn('Sin `say` o `ffmpeg`: solo se genera el libro.', e.message); }
for (const h of hechos) console.log(h, readFileSync(h).length, 'bytes');
