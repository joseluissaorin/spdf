/**
 * Las muestras del validador (y las pruebas de las integraciones): un librito
 * de seis páginas sobre SPDF, en inglés y en castellano, compuesto en HTML,
 * impreso a PDF con Chrome headless y leído después a SPDF con spdf-format.
 * Así la muestra es honesta: el original existe (va dentro, como blob), cada
 * página tiene su imagen, los folios impresos son los que se ven en el papel,
 * la lámina sin número lleva su folio deducido entre corchetes y los vectores
 * los calcula un modelo de verdad (all-MiniLM-L6-v2, 384 dimensiones).
 *
 * Además deja una copia rota a propósito (con una vista, E020, y unidades mal
 * numeradas, E090) para las pruebas de las integraciones. Esa no se publica en
 * la web: allí solo va lo que valida.
 *
 *   cd site/muestras && npm run generar
 *   → site/public/muestras/{spdf-in-five-pages.spdf, spdf-en-cinco-paginas.spdf, muestras.json}
 *   → integrations/fixtures/{los dos librillos, roto.spdf}
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from '@huggingface/transformers';
import { SpdfWriter, openSpdf, validate, type Anchor, type FragmentInput, type UnitInput } from 'spdf-format';
import { aSvg } from '../dibujo/boceto';
import { folio } from '../dibujo/dibujos/folio';

const aqui = dirname(fileURLToPath(import.meta.url));
const SALIDA = resolve(aqui, '../public/muestras');
const FIXTURES = resolve(aqui, '../../integrations/fixtures');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODELO = 'Xenova/all-MiniLM-L6-v2';
const FECHA = '2026-10-07T12:00:00Z';

type Lengua = 'en' | 'es';

interface Pagina {
  /** Folio impreso en la página (null si no lleva número). */
  impreso: string | null;
  /** Folio deducido (para la lámina sin número). */
  deducido?: string;
  seccion?: string[];
  titulo?: string;
  parrafos: string[];
  lamina?: { pie: string; descripcion: string };
  portada?: { titulo: string; sub: string; autor: string; pie: string };
}

const LIBRITO: Record<Lengua, { titulo: string; fichero: string; corrido: string; paginas: Pagina[] }> = {
  en: {
    titulo: 'SPDF in five pages',
    fichero: 'spdf-in-five-pages',
    corrido: 'SPDF in five pages',
    paginas: [
      { impreso: null, parrafos: [], portada: { titulo: 'SPDF in five pages', sub: 'A small booklet about a file format, printed by its own website', autor: 'José Luis Saorín Ferrer', pie: 'spdf.joseluissaorin.com · 2026' } },
      { impreso: '1', titulo: 'I. Anchors', seccion: ['I. Anchors'], parrafos: [
        'A document that has been read well is worth more than its text. SPDF keeps the text together with the place it came from: the physical page of the file and the folio printed on it, the second of a recording, the slide, the verse. That place is called an anchor, and every passage carries one.',
        'An anchor can be written as a URI that names the document by the SHA-256 of its original bytes, so it survives copying and renaming. This page is physical page 2 of the file, and its printed folio is 1.',
      ] },
      { impreso: '2', titulo: 'II. Provenance', seccion: ['II. Provenance'], parrafos: [
        'Every unit records who read it: the text layer of a PDF, a vision model, a speech recogniser. It also records how sure the reader was. When a folio is not printed on a page but deduced from its neighbours, the citation puts it in brackets.',
        '§III. Read once, query many',
        'Reading is the expensive part: recognising text, finding folios, dividing sections, computing vectors. SPDF does it once and keeps the result in a single SQLite file that answers lexical, semantic and hybrid searches offline.',
      ] },
      { impreso: null, deducido: '3', seccion: ['III. Read once, query many'], parrafos: [], lamina: {
        pie: 'Plate I. A page with its folio and a manicule pointing at a passage. This plate carries no printed number; its folio, 3, is inferred.',
        descripcion: 'A pen drawing of the recto of a book: scribbled lines of text, the printed folio 21 circled in red, a manicule coming in from the left edge and pointing at three lines washed in gold, and two handwritten notes: “printed 21, physical 29” and “here, and only here”.',
      } },
      { impreso: '4', titulo: 'IV. Portability', seccion: ['IV. Portability'], parrafos: [
        'An SPDF file is an ordinary SQLite database with a small, documented schema. Twelve independent implementations open it, in Rust, TypeScript, Python, Swift, Kotlin, Go, C#, PHP, Ruby, R, Julia and C, and all of them are checked against the same conformance suite.',
        '§V. Honest citation',
        'A citation is computed from the stored anchor and the CSL record, never generated. It can only print what the source says: the right page, or no page at all.',
      ] },
      { impreso: '5', titulo: 'Colophon', seccion: ['Colophon'], parrafos: [
        'This booklet was set in Georgia and printed to PDF by the build of spdf.joseluissaorin.com, then read into SPDF with spdf-format. Its text, anchors, sections, plate and vectors are what the validator shows. Dedicated to the public domain (CC0 1.0).',
      ] },
    ],
  },
  es: {
    titulo: 'SPDF en cinco páginas',
    fichero: 'spdf-en-cinco-paginas',
    corrido: 'SPDF en cinco páginas',
    paginas: [
      { impreso: null, parrafos: [], portada: { titulo: 'SPDF en cinco páginas', sub: 'Un librito sobre un formato de fichero, impreso por su propia web', autor: 'José Luis Saorín Ferrer', pie: 'spdf.joseluissaorin.com · 2026' } },
      { impreso: '1', titulo: 'I. Anclas', seccion: ['I. Anclas'], parrafos: [
        'Un documento bien leído vale más que su texto. SPDF guarda el texto junto con el sitio del que salió: la página física del fichero y el folio impreso en ella, el segundo de una grabación, la diapositiva, el verso. Ese sitio se llama ancla, y cada pasaje lleva la suya.',
        'Un ancla se puede escribir como una URI que nombra el documento por el SHA-256 de los bytes del original, así que sobrevive a las copias y a los cambios de nombre. Esta es la página física 2 del fichero, y su folio impreso es el 1.',
      ] },
      { impreso: '2', titulo: 'II. Procedencia', seccion: ['II. Procedencia'], parrafos: [
        'Cada unidad registra quién la leyó: la capa de texto de un PDF, un modelo de visión, un reconocedor de voz. También registra lo seguro que estaba. Cuando un folio no está impreso en la página sino deducido de las vecinas, la cita lo pone entre corchetes.',
        '§III. Una lectura, muchas consultas',
        'Leer es lo caro: reconocer el texto, encontrar los folios, dividir las secciones, calcular los vectores. SPDF lo hace una sola vez y guarda el resultado en un único fichero SQLite que responde sin conexión a búsquedas léxicas, semánticas e híbridas.',
      ] },
      { impreso: null, deducido: '3', seccion: ['III. Una lectura, muchas consultas'], parrafos: [], lamina: {
        pie: 'Lámina I. Una página con su folio y una manícula que señala un pasaje. Esta lámina no lleva número impreso; su folio, el 3, es deducido.',
        descripcion: 'Un dibujo a pluma del recto de un libro: renglones garabateados, el folio impreso 21 rodeado en rojo, una manícula que entra por el borde izquierdo y señala tres renglones con una aguada de oro, y dos notas a mano: «impresa 21, física 29» y «aquí, y solo aquí».',
      } },
      { impreso: '4', titulo: 'IV. Portabilidad', seccion: ['IV. Portabilidad'], parrafos: [
        'Un fichero SPDF es una base de datos SQLite corriente con un esquema pequeño y documentado. Lo abren doce implementaciones independientes, en Rust, TypeScript, Python, Swift, Kotlin, Go, C#, PHP, Ruby, R, Julia y C, y todas se comprueban con la misma batería de conformidad.',
        '§V. Honestidad de la cita',
        'Una cita se calcula a partir del ancla guardada y de la ficha CSL; no se genera. Solo puede imprimir lo que dice la fuente: la página buena, o ninguna página.',
      ] },
      { impreso: '5', titulo: 'Colofón', seccion: ['Colofón'], parrafos: [
        'Este librito se compuso en Georgia y lo imprimió a PDF la construcción de spdf.joseluissaorin.com; después se leyó a SPDF con spdf-format. Su texto, sus anclas, sus secciones, su lámina y sus vectores son lo que enseña el validador. Cedido al dominio público (CC0 1.0).',
      ] },
    ],
  },
};

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function svgIndependiente(l: Lengua): string {
  const vars = '--d-papel:#F5F0E8;--d-tinta:#2C1810;--d-lapiz:#9A8E80;--d-rojo:#C1453B;--d-azul:#2B4C7E;--d-amarillo:#E8A838;--d-oro:#D6A03A;--d-negro:#1A120D';
  const mano = readFileSync(resolve(aqui, '../public/fuentes/mano.woff2')).toString('base64');
  const estilo = `<style>@font-face{font-family:Mano;src:url(data:font/woff2;base64,${mano}) format('woff2')}svg{${vars}}.nt{font-family:Mano,cursive}.c-pl,.c-co,.c-en{mix-blend-mode:multiply}</style>`;
  return aSvg(folio, { lengua: l, decorativo: true }).replace(/^(<svg[^>]*>)/, `$1${estilo}`);
}

/** El HTML del librito: seis páginas A6, el folio impreso abajo en el centro. */
function htmlLibrito(l: Lengua): string {
  const L = LIBRITO[l];
  const paginas = L.paginas.map((p) => {
    if (p.portada) {
      return `<section class="p portada"><div class="cuadro"></div><h1>${esc(p.portada.titulo)}</h1><p class="sub">${esc(p.portada.sub)}</p><p class="autor">${esc(p.portada.autor)}</p><p class="pie">${esc(p.portada.pie)}</p></section>`;
    }
    if (p.lamina) {
      return `<section class="p lamina"><div class="dib">${svgIndependiente(l)}</div><p class="pie-lamina">${esc(p.lamina.pie)}</p></section>`;
    }
    const cuerpo = p.parrafos.map((x) => (x.startsWith('§') ? `<h2>${esc(x.slice(1))}</h2>` : `<p>${esc(x)}</p>`)).join('');
    return `<section class="p"><p class="corrido">${esc(L.corrido)}</p>${p.titulo ? `<h2>${esc(p.titulo)}</h2>` : ''}${cuerpo}${p.impreso ? `<p class="folio">${p.impreso}</p>` : ''}</section>`;
  }).join('');
  return `<!doctype html><html lang="${l}"><meta charset="utf-8"><title>${esc(L.titulo)}</title><style>
@page{size:105mm 148mm;margin:0}
*{box-sizing:border-box}html,body{margin:0;background:#F5F0E8;color:#2C1810;font-family:Georgia,serif}
.p{width:105mm;height:148mm;padding:14mm 12mm 16mm;position:relative;break-after:page;overflow:hidden;background:#F5F0E8}
.p:last-child{break-after:auto}
.corrido{font-size:6.5pt;letter-spacing:.12em;text-transform:uppercase;text-align:center;color:#7a5f4e;margin:0 0 7mm}
h1{font-weight:normal;font-size:24pt;line-height:1.05;margin:30mm 0 6mm;letter-spacing:-.02em}
h2{font-weight:normal;font-size:12pt;margin:0 0 3mm;color:#B83E33}
p{font-size:8.6pt;line-height:1.45;margin:0 0 3mm;text-align:justify;hyphens:none}
.portada .cuadro{position:absolute;right:-10mm;top:-10mm;width:46mm;height:46mm;border-radius:50%;background:#C1453B}
.portada .sub{font-style:italic;font-size:10pt;text-align:left}
.portada .autor{position:absolute;left:12mm;bottom:24mm;font-size:9pt;text-align:left}
.portada .pie{position:absolute;left:12mm;bottom:14mm;font-family:Menlo,monospace;font-size:6pt;letter-spacing:.06em;color:#7a5f4e}
.folio{position:absolute;left:0;right:0;bottom:8mm;text-align:center;font-size:8pt;margin:0}
.lamina{padding:12mm 8mm}
.lamina .dib svg{width:100%;height:auto;display:block}
.pie-lamina{font-style:italic;font-size:7.6pt;text-align:left;margin-top:6mm}
</style><body>${paginas}</body></html>`;
}

/** Los fragmentos de una página: uno por párrafo, con su intervalo de caracteres en el texto de la unidad. */
function textoDeUnidad(p: Pagina): { texto: string; partes: { texto: string; desde: number; hasta: number; seccion: string[] }[] } {
  if (p.portada) {
    const t = [p.portada.titulo, p.portada.sub, p.portada.autor, p.portada.pie].join('\n\n');
    return { texto: t, partes: [] };
  }
  if (p.lamina) return { texto: p.lamina.pie, partes: [{ texto: p.lamina.pie, desde: 0, hasta: [...p.lamina.pie].length, seccion: p.seccion ?? [] }] };
  const bloques: string[] = [];
  const partes: { texto: string; desde: number; hasta: number; seccion: string[] }[] = [];
  let seccion = p.seccion ?? [];
  if (p.titulo) bloques.push(`## ${p.titulo}`);
  for (const x of p.parrafos) {
    if (x.startsWith('§')) { bloques.push(`## ${x.slice(1)}`); seccion = [x.slice(1)]; continue; }
    const previo = bloques.length ? `${bloques.join('\n\n')}\n\n` : '';
    const desde = [...previo].length;
    bloques.push(x);
    partes.push({ texto: x, desde, hasta: desde + [...x].length, seccion });
  }
  return { texto: bloques.join('\n\n').normalize('NFC'), partes };
}

async function generar(l: Lengua, extractor: Awaited<ReturnType<typeof pipeline>>): Promise<{ fichero: string; bytes: Uint8Array }> {
  const L = LIBRITO[l];
  const tmp = mkdtempSync(join(tmpdir(), 'spdf-librito-'));
  const t0 = Date.now();
  const html = join(tmp, 'librito.html');
  writeFileSync(html, htmlLibrito(l));
  const pdf = join(tmp, 'librito.pdf');
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: 'ignore' });
  const msPdf = Date.now() - t0;
  // Fechas fijas en el PDF (misma longitud, para no mover la tabla xref): así el original, y con él
  // el docref de las URI de ancla, no cambia cada vez que se regeneran las muestras.
  const texto = readFileSync(pdf).toString('latin1').replace(/\/(CreationDate|ModDate) \(D:(\d{14})/g, (_m, k: string) => `/${k} (D:20261007120000`);
  writeFileSync(pdf, Buffer.from(texto, 'latin1'));
  const original = new Uint8Array(readFileSync(pdf));
  // Imágenes de las páginas, a 80 ppp, en WebP.
  execFileSync('pdftoppm', ['-r', '80', '-png', pdf, join(tmp, 'pag')]);
  const pngs = readdirSync(tmp).filter((f) => /^pag-\d+\.png$/.test(f)).sort();
  if (pngs.length !== L.paginas.length) throw new Error(`el PDF tiene ${pngs.length} páginas y el librito ${L.paginas.length}`);
  const imagenes = pngs.map((f) => {
    const webp = join(tmp, f.replace('.png', '.webp'));
    execFileSync('cwebp', ['-quiet', '-q', '72', join(tmp, f), '-o', webp]);
    return new Uint8Array(readFileSync(webp));
  });

  const w = await SpdfWriter.create({ generator: 'spdf-site-muestras/1.0 (spdf-format)' });
  const docId = `${L.fichero}`;
  await w.setDocument({
    id: docId, kind: 'pdf', mime: 'application/pdf', bytes: original.length, source_sha256: sha256(original), source_ref: 'blob:original',
    created: FECHA, updated: FECHA, language: l,
    metadata: {
      type: 'pamphlet', title: L.titulo, author: [{ family: 'Saorín Ferrer', given: 'José Luis' }], issued: { 'date-parts': [[2026]] },
      publisher: 'spdf.joseluissaorin.com', URL: `https://spdf.joseluissaorin.com${l === 'es' ? '/es/validador' : '/validator'}`, language: l,
      spdf: { provenance: { title: { source: 'title page', confidence: 1 }, author: { source: 'title page', confidence: 1 }, issued: { source: 'title page', confidence: 1 } } },
    },
    rights: { license: 'CC0-1.0', access: 'open', holder: 'José Luis Saorín Ferrer', note: l === 'es' ? 'Cedido al dominio público.' : 'Dedicated to the public domain.' },
  });
  await w.addBlob('original', 'application/pdf', original);
  const unidades: UnitInput[] = [];
  const fragmentos: FragmentInput[] = [];
  const secciones = new Map<string, string>();
  for (const [i, p] of L.paginas.entries()) {
    const fisica = i + 1;
    const clave = `page-${String(fisica).padStart(3, '0')}`;
    await w.addBlob(clave, 'image/webp', imagenes[i]!);
    const anchor: Anchor = p.deducido
      ? { type: 'page', physical: fisica, printed: p.deducido, source: 'inferred', confidence: 0.9 }
      : { type: 'page', physical: fisica, printed: p.impreso, source: p.impreso ? 'read' : 'none', confidence: 1 };
    const { texto, partes } = textoDeUnidad(p);
    const id = `u${fisica}`;
    unidades.push({ id, anchor, text: texto, image: `blob:${clave}`, reader: 'html-source', confidence: 1, header: p.portada || p.lamina ? null : L.corrido, footer: p.impreso });
    for (const s of [p.titulo, ...p.parrafos.filter((x) => x.startsWith('§')).map((x) => x.slice(1))]) {
      if (s && !secciones.has(s)) secciones.set(s, id);
    }
    for (const [k, parte] of partes.entries()) {
      fragmentos.push({
        id: `f${fisica}-${k + 1}`, unit: id, text: parte.texto.normalize('NFC'),
        context: l === 'es' ? `${L.titulo}, ${parte.seccion.join(' / ')}` : `${L.titulo}, ${parte.seccion.join(' / ')}`,
        section: parte.seccion, anchor: { ...anchor, chars: [parte.desde, parte.hasta] },
      });
    }
  }
  await w.addUnits(unidades);
  const ids = [...secciones.keys()];
  await w.addSections(ids.map((t, i) => ({ id: `s${i + 1}`, level: 1, title: t, unit_from: secciones.get(t)!, unit_to: i + 1 < ids.length ? secciones.get(ids[i + 1]!)! : null })));
  await w.addFragments(fragmentos);
  const lamina = L.paginas.findIndex((p) => p.lamina);
  const pl = L.paginas[lamina]!;
  await w.addFigures([{
    id: 'fig1', unit: `u${lamina + 1}`, image: `blob:page-${String(lamina + 1).padStart(3, '0')}`, caption: pl.lamina!.pie, description: pl.lamina!.descripcion,
    anchor: { type: 'page', physical: lamina + 1, printed: pl.deducido!, source: 'inferred', confidence: 0.9, region: { x: 0.07, y: 0.08, w: 0.86, h: 0.6 } },
  }]);

  // Vectores de verdad: all-MiniLM-L6-v2, media de los tokens, normalizados.
  const t1 = Date.now();
  const salida = await extractor(fragmentos.map((f) => f.text), { pooling: 'mean', normalize: true }) as { data: Float32Array; dims: number[] };
  const dims = salida.dims[1]!;
  const espacio = await w.addSpace({ provider: 'sentence-transformers', model: 'all-MiniLM-L6-v2', version: MODELO, dims, dtype: 'f32', normalized: true, modalities: ['text'], created: FECHA });
  await w.addVectors(espacio, fragmentos.map((f, i) => ({ target: 'fragment', id: f.id, vector: salida.data.slice(i * dims, (i + 1) * dims) })));
  const msVec = Date.now() - t1;

  await w.addProvenance({ stage: 'typeset', provider: 'chrome-headless', model: null, detail: { from: 'html', to: 'application/pdf' }, ms: msPdf, at: FECHA });
  await w.addProvenance({ stage: 'text', provider: 'html-source', model: null, detail: { units: unidades.length }, ms: 0, at: FECHA });
  await w.addProvenance({ stage: 'folios', provider: 'html-source', model: null, detail: { read: unidades.filter((u) => u.anchor.type === 'page' && u.anchor.source === 'read').length, inferred: 1 }, ms: 0, at: FECHA });
  await w.addProvenance({ stage: 'images', provider: 'pdftoppm+cwebp', model: null, detail: { dpi: 80, format: 'image/webp' }, ms: 0, at: FECHA });
  await w.addProvenance({ stage: 'embed', provider: 'transformers.js', model: MODELO, detail: { space: espacio, vectors: fragmentos.length }, ms: msVec, at: FECHA });
  await w.setMeta('created', FECHA);
  const bytes = await w.finish({ contentHash: true });
  rmSync(tmp, { recursive: true, force: true });
  return { fichero: `${L.fichero}.spdf`, bytes };
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  const extractor = await pipeline('feature-extraction', MODELO, { dtype: 'fp32' });
  const lista: { fichero: string; nombre: Record<Lengua, string>; bytes: number; sha256: string; valido: boolean; codigos: string[] }[] = [];
  for (const l of ['en', 'es'] as const) {
    const { fichero, bytes } = await generar(l, extractor);
    writeFileSync(join(SALIDA, fichero), bytes);
    writeFileSync(join(FIXTURES, fichero), bytes);
    const r = await validate(bytes);
    if (!r.valid) throw new Error(`${fichero} no es válido: ${JSON.stringify(r.errors)}`);
    const d = await openSpdf(bytes);
    const f = (await d.fragments())[0]!;
    console.log(`${fichero}: ${bytes.length} B, válido, ${r.warnings.length} avisos · ${d.cite(f.anchor, l)} · ${f.anchor_uri}`);
    await d.close();
    lista.push({ fichero, nombre: { en: LIBRITO[l].titulo, es: LIBRITO[l].titulo }, bytes: bytes.length, sha256: sha256(bytes), valido: true, codigos: r.warnings.map((x) => x.code) });
  }
  // La copia rota, solo para las pruebas: el librito inglés con una vista dentro (E020) y unidades mal numeradas (E090).
  const roto = join(FIXTURES, 'roto.spdf');
  copyFileSync(join(SALIDA, 'spdf-in-five-pages.spdf'), roto);
  const db = new DatabaseSync(roto);
  db.exec("CREATE VIEW x_rotura AS SELECT id, text FROM fragments; UPDATE units SET ord = ord + 1 WHERE ord = 6;");
  db.close();
  const rb = new Uint8Array(readFileSync(roto));
  const rr = await validate(rb);
  console.log(`roto.spdf: ${rr.valid ? 'válido (¡no debería!)' : 'no válido'} · ${rr.errors.map((e) => e.code).join(', ')}`);
  if (rr.valid) throw new Error('roto.spdf debería ser inválido');
  writeFileSync(join(SALIDA, 'muestras.json'), JSON.stringify(lista, null, 2));
}

await main();
