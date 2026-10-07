/**
 * El validador e inspector de la web, entero en el navegador: spdf-format con
 * SQLite en WebAssembly lee el fichero que se suelta (o una muestra), lo valida
 * con los códigos de la especificación y enseña lo que hay dentro: ficha,
 * unidades, fragmentos con sus anclas y su cita, figuras, espacios vectoriales,
 * procedencia y el JSON canónico. No se sube nada.
 */
import { configureBrowserEngine, openSpdf, validate, toBibtex, toCslJson, sha256Hex, type SpdfDocument, type Anchor, type ValidationReport } from 'spdf-format/browser';

type Textos = Record<string, string> & { lengua: 'es' | 'en'; pestanas: Record<string, string> };

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const megas = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const raiz = $('.validador');
const T = JSON.parse($('#textos-validador')?.textContent ?? '{}') as Textos;
const L = T.lengua ?? 'en';
const resultado = $('#resultado')!;
let actual: SpdfDocument | null = null;
const urls: string[] = [];

configureBrowserEngine({ wasmUrl: '/assets/sqlite3.wasm' });

function progreso(t: string) {
  resultado.innerHTML = `<p class="progreso" role="status">${esc(t)}</p>`;
}

function liberar() {
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  if (actual) { void actual.close().catch(() => {}); actual = null; }
}

/** El localizador corto de un ancla, para las listas (la cita completa la da `cite`). */
function localizador(a: Anchor): { principal: string; detalle: string } {
  switch (a.type) {
    case 'page': {
      const f = a.printed == null ? T.sp : a.source === 'inferred' ? `[${a.printed}]` : a.printed;
      const pre = a.foliation === 'leaf' ? 'fol.' : a.foliation === 'column' ? 'col.' : 'p.';
      return { principal: a.printed == null ? f : `${pre} ${f}`, detalle: `#${a.physical}${a.source ? ` · ${a.source}` : ''}` };
    }
    case 'time': {
      const m = (s: number) => { const h = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = Math.floor(s % 60); return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`; };
      return { principal: m(a.t0), detalle: `→ ${m(a.t1)}${a.speaker ? ` · ${a.speaker}` : ''}` };
    }
    case 'slide': return { principal: `${L === 'es' ? 'diap.' : 'slide'} ${a.n}`, detalle: '' };
    case 'section': return { principal: `§ ${a.path[a.path.length - 1] ?? ''}`, detalle: a.paragraph ? `¶ ${a.paragraph}` : '' };
    case 'sheet': return { principal: a.sheet, detalle: `${a.row_from}-${a.row_to}` };
    case 'verse': return { principal: `v. ${a.line_from}${a.line_to && a.line_to !== a.line_from ? `-${a.line_to}` : ''}`, detalle: a.printed ?? '' };
    case 'canonical': return { principal: a.ref, detalle: a.scheme };
    case 'web': return { principal: 'web', detalle: a.url };
    default: return { principal: a.type, detalle: '' };
  }
}

const FORMAS: Record<string, string> = {
  core: '<span class="cuadrado"></span>', semantic: '<span class="circulo"></span>', media: '<span class="triangulo"></span>',
  full: '<span class="cuadrado"></span><span class="circulo"></span><span class="triangulo"></span>',
};

function problemas(r: ValidationReport): string {
  const filas = [
    ...r.errors.map((e) => `<tr><td><code>${esc(e.code)}</code></td><td>${esc(e.message)}</td><td><code>${esc(e.where ?? '')}</code></td></tr>`),
    ...r.warnings.map((e) => `<tr class="aviso-w"><td><code>${esc(e.code)}</code></td><td>${esc(e.message)}</td><td><code>${esc(e.where ?? '')}</code></td></tr>`),
  ];
  if (!filas.length) return `<p class="problemas">${esc(T.sinErrores)}</p>`;
  return `<div class="tabla problemas cuerpo" tabindex="0"><table><thead><tr><th scope="col">${esc(T.codigo)}</th><th scope="col">${esc(T.mensaje)}</th><th scope="col">${esc(T.donde)}</th></tr></thead><tbody>${filas.join('')}</tbody></table></div>`;
}

async function blobUrl(d: SpdfDocument, ref: string | null | undefined): Promise<string | null> {
  if (!ref || !ref.startsWith('blob:')) return ref && /^https?:/.test(ref) ? ref : null;
  const b = await d.blob(ref.slice(5));
  if (!b) return null;
  const u = URL.createObjectURL(new Blob([b.data], { type: b.mime }));
  urls.push(u);
  return u;
}

// ---------------------------------------------------------------------------

async function procesar(bytes: Uint8Array, nombre: string) {
  liberar();
  const t0 = performance.now();
  progreso(T.validando);
  let informe: ValidationReport;
  try {
    informe = await validate(bytes);
  } catch (e) {
    resultado.innerHTML = `<div class="veredicto invalido"><span class="sello" aria-hidden="true">×</span><h2>${esc(T.invalido)}</h2><p>${esc((e as Error).message)}</p></div>`;
    return;
  }
  const ms = Math.round(performance.now() - t0);
  const huella = await sha256Hex(bytes);
  progreso(T.abriendo);
  let doc: SpdfDocument | null = null;
  let errorApertura = '';
  try {
    doc = await openSpdf(bytes);
    actual = doc;
  } catch (e) {
    errorApertura = (e as Error).message;
  }
  const perfiles = (informe.profile ?? []) as string[];
  const formas = perfiles.map((p) => FORMAS[p] ?? '').join('');
  const veredicto = `<div class="veredicto ${informe.valid ? 'valido' : 'invalido'}">
<span class="sello" aria-hidden="true">${informe.valid ? '✓' : '×'}</span>
<h2>${esc(informe.valid ? T.valido : T.invalido)}${informe.version ? ` ${esc(informe.version)}` : ''}${formas ? `<span class="formas" aria-hidden="true">${formas}</span>` : ''}</h2>
<p>${esc(nombre)} · ${megas(bytes.length)} · ${perfiles.length ? `${esc(T.perfil)} ${esc(perfiles.join(' '))} · ` : ''}${informe.errors.length} ${esc(T.errores)}, ${informe.warnings.length} ${esc(T.avisos)} · ${esc(T.tiempo)} ${ms} ms</p>
</div>`;
  let html = veredicto + problemas(informe);
  if (!doc) {
    if (errorApertura) html += `<p class="aviso">${esc(T.noAbre)} ${esc(errorApertura)}</p>`;
    resultado.innerHTML = html;
    return;
  }
  const d = doc;
  const doct = d.document as unknown as Record<string, unknown> & { metadata: Record<string, unknown>; unit_count: number; source_sha256: string; kind: string };
  const [fragmentos, figuras, espacios] = await Promise.all([d.fragments(), d.figures(), d.spaces()]);
  const meta = d.meta as Record<string, string>;
  const autores = ((doct.metadata.author as { family?: string; given?: string; literal?: string }[] | undefined) ?? []).map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' ')).join('; ');
  const resumen: [string, string][] = [
    [T.titulo, esc(doct.metadata.title ?? doct.title ?? '')],
    [T.autores, esc(autores || (doct.authors ?? ''))],
    [T.anio, esc(doct.year ?? '')],
    [T.tipo, `<code>${esc(doct.kind)}</code>`],
    [T.lengua, esc(doct.language ?? doct.metadata.language ?? '')],
    [T.unidades, String(doct.unit_count)],
    [T.fragmentos, String(fragmentos.length)],
    [T.figuras, String(figuras.length)],
    [T.espacios, espacios.length ? espacios.map((s) => `<code>${esc(s.id)}</code>`).join('<br>') : '0'],
    [T.creado, esc(meta.created ?? doct.created ?? '')],
    [T.generador, `<code>${esc(meta.generator ?? '')}</code>`],
    [T.huellaOriginal, `<code>${esc(doct.source_sha256)}</code>`],
    [T.huellaFichero, `<code>${esc(huella)}</code>`],
  ];
  html += `<dl class="resumen">${resumen.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v || '·'}</dd></div>`).join('')}</dl>`;
  const P = T.pestanas;
  const pestanas: [string, string, number | null][] = [
    ['ficha', P.ficha, null], ['unidades', P.unidades, doct.unit_count], ['fragmentos', P.fragmentos, fragmentos.length],
    ['figuras', P.figuras, figuras.length], ['espacios', P.espacios, espacios.length], ['procedencia', P.procedencia, null], ['json', P.json, null],
  ];
  html += `<div class="pestanas" role="tablist" aria-label="${esc(nombre)}">${pestanas.map(([id, t, n], i) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(t)}${n !== null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
  html += pestanas.map(([id], i) => `<div class="panel cuerpo" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0"${i ? ' hidden' : ''}></div>`).join('');
  html += `<p class="mas"><button type="button" class="boton papel" id="otro">${esc(T.otro)}</button></p>`;
  resultado.innerHTML = html;
  $('#otro')?.addEventListener('click', () => { liberar(); resultado.innerHTML = ''; $('#soltar')?.scrollIntoView({ behavior: 'smooth' }); ($('#fichero') as HTMLInputElement | null)?.focus(); });

  const hechos = new Set<string>();
  const pintores: Record<string, (p: HTMLElement) => Promise<void>> = {
    ficha: (p) => pintarFicha(p, d),
    unidades: (p) => pintarUnidades(p, d),
    fragmentos: (p) => pintarFragmentos(p, d, fragmentos),
    figuras: (p) => pintarFiguras(p, d, figuras),
    espacios: (p) => pintarEspacios(p, d, espacios),
    procedencia: (p) => pintarProcedencia(p, d),
    json: (p) => pintarJson(p, d, nombre),
  };
  const abrir = async (id: string) => {
    for (const [pid] of pestanas) {
      const b = $(`#tab-${pid}`)!; const panel = $(`#panel-${pid}`)!;
      const si = pid === id;
      b.setAttribute('aria-selected', String(si)); b.tabIndex = si ? 0 : -1; panel.hidden = !si;
    }
    if (!hechos.has(id)) {
      hechos.add(id);
      const panel = $(`#panel-${id}`)!;
      panel.innerHTML = `<p class="progreso">${esc(T.abriendo)}</p>`;
      try { await pintores[id]!(panel); } catch (e) { panel.innerHTML = `<p class="aviso">${esc((e as Error).message)}</p>`; }
    }
  };
  const lista = $('.pestanas')!;
  lista.addEventListener('click', (e) => { const b = (e.target as Element).closest('[role=tab]'); if (b) void abrir(b.id.slice(4)); });
  lista.addEventListener('keydown', (e) => {
    const ids = pestanas.map(([id]) => id);
    const i = ids.indexOf((document.activeElement as HTMLElement)?.id.slice(4));
    if (i < 0) return;
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % ids.length; else if (e.key === 'ArrowLeft') j = (i - 1 + ids.length) % ids.length; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = ids.length - 1; else return;
    e.preventDefault(); ($(`#tab-${ids[j]}`) as HTMLElement).focus(); void abrir(ids[j]!);
  });
  await abrir('ficha');
}

function bloqueCodigo(texto: string, lengua: string) {
  return `<div class="codigo" data-lengua="${esc(lengua)}"><button class="copiar" type="button">${esc(T.copiar)}</button><pre tabindex="0"><code>${esc(texto)}</code></pre></div>`;
}

async function pintarFicha(p: HTMLElement, d: SpdfDocument) {
  const primera = (await d.units({ from: 1, to: 3 })).find((u) => u.anchor.type !== 'page' || u.anchor.printed != null) ?? (await d.unit(1));
  const cita = primera ? d.cite(primera.anchor, L) : '';
  const csl = JSON.stringify(toCslJson(d.document), null, 2);
  const bib = toBibtex(d.document);
  const derechos = d.document.rights ? JSON.stringify(d.document.rights, null, 2) : '';
  p.innerHTML = `${cita ? `<h3>${esc(T.citaMuestra)}</h3><p class="cita-grande">${esc(cita)}</p><p><code class="uri">${esc(d.anchorUri(primera!.anchor))}</code></p>` : ''}
<h3>${esc(T.cslJson)}</h3>${bloqueCodigo(csl, 'json')}
<h3>${esc(T.bibtex)}</h3>${bloqueCodigo(bib, 'bibtex')}
${derechos ? `<h3>${esc(T.derechos)}</h3>${bloqueCodigo(derechos, 'json')}` : ''}`;
}

const PASO = 40;

async function pintarUnidades(p: HTMLElement, d: SpdfDocument) {
  const total = await d.unitCount();
  p.innerHTML = '<ol class="lista-u"></ol><p class="mas"></p>';
  const ol = $('ol', p)!; const mas = $('.mas', p)!;
  let desde = 1;
  const tanda = async () => {
    const us = await d.units({ from: desde, to: desde + PASO - 1 });
    ol.insertAdjacentHTML('beforeend', us.map((u) => {
      const loc = localizador(u.anchor);
      const texto = u.text.length > 700 ? `${u.text.slice(0, 700)}…` : u.text;
      return `<li><div class="loc">${esc(loc.principal)}<small>${esc(loc.detalle)}</small></div><div><p class="meta">${esc(T.lector)} ${esc(u.reader)} · ${esc(T.confianza)} ${u.confidence}</p><p class="t">${esc(texto)}</p>${u.image ? `<details data-img="${esc(u.image)}"><summary>${esc(T.verImagen)}</summary></details>` : ''}</div></li>`;
    }).join(''));
    desde += PASO;
    mas.innerHTML = desde <= total ? `<button type="button" class="boton papel">${esc(T.mas)} (${Math.min(desde - 1, total)} ${esc(T.de)} ${total})</button>` : '';
    mas.querySelector('button')?.addEventListener('click', () => void tanda());
  };
  ol.addEventListener('toggle', async (e) => {
    const det = e.target as HTMLDetailsElement;
    if (!det.open || det.dataset.hecho) return;
    det.dataset.hecho = '1';
    const u = await blobUrl(d, det.dataset.img);
    if (u) det.insertAdjacentHTML('beforeend', `<img src="${u}" alt="" loading="lazy">`);
  }, true);
  await tanda();
}

async function pintarFragmentos(p: HTMLElement, d: SpdfDocument, todos: Awaited<ReturnType<SpdfDocument['fragments']>>) {
  p.innerHTML = `<form class="buscador" role="search"><label class="solo-lector" for="q">${esc(T.buscar)}</label><input id="q" type="search" placeholder="${esc(T.buscar)}" autocomplete="off"><button class="boton tinta" type="submit">${esc(T.buscar.split(' ')[0])}</button></form><p class="ayuda">${esc(T.buscarAyuda)}</p><ol class="lista-u"></ol><p class="mas"></p>`;
  const ol = $('ol', p)!; const mas = $('.mas', p)!;
  const pintar = (fs: typeof todos, n = PASO) => {
    ol.innerHTML = fs.slice(0, n).map((f) => {
      const loc = localizador(f.anchor);
      return `<li><div class="loc">${esc(loc.principal)}<small>${esc(loc.detalle)}</small></div><div><p class="meta">${esc(d.cite(f.anchor, L, f.anchor_end))}${f.section?.length ? ` · ${esc(f.section.join(' / '))}` : ''}</p>${f.context ? `<p class="ctx">${esc(f.context)}</p>` : ''}<p class="t">${esc(f.text)}</p><code class="uri">${esc(f.anchor_uri)}</code></div></li>`;
    }).join('') || `<li><p>${esc(T.sinResultados)}</p></li>`;
    mas.innerHTML = fs.length > n ? `<button type="button" class="boton papel">${esc(T.mas)} (${n} ${esc(T.de)} ${fs.length})</button>` : '';
    mas.querySelector('button')?.addEventListener('click', () => pintar(fs, n + PASO));
  };
  pintar(todos);
  $('form', p)!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = ($('#q', p) as HTMLInputElement).value.trim();
    if (!q) { pintar(todos); return; }
    const hits = await d.searchLexical(q, { limit: 100 });
    const porId = new Map(todos.map((f) => [f.id, f]));
    pintar(hits.map((h) => porId.get(h.fragment_id)).filter((f): f is (typeof todos)[number] => !!f));
  });
}

async function pintarFiguras(p: HTMLElement, d: SpdfDocument, figuras: Awaited<ReturnType<SpdfDocument['figures']>>) {
  if (!figuras.length) { p.innerHTML = `<p>${esc(T.sinFiguras)}</p>`; return; }
  const tarjetas = await Promise.all(figuras.slice(0, 60).map(async (f) => {
    const u = await blobUrl(d, f.image);
    const loc = localizador(f.anchor);
    const r = f.anchor.region;
    const recorte = r && u ? ` style="object-fit:none;object-position:${(r.x + r.w / 2) * 100}% ${(r.y + r.h / 2) * 100}%"` : '';
    void recorte;
    return `<figure>${u ? `<img src="${u}" alt="${esc(f.description ?? f.caption ?? '')}" loading="lazy">` : ''}<figcaption><strong>${esc(loc.principal)}</strong> · ${esc(d.cite(f.anchor, L))}<br>${esc(f.caption ?? '')}${f.description ? `<br><em>${esc(f.description)}</em>` : ''}</figcaption></figure>`;
  }));
  p.innerHTML = `<div class="figuras-r">${tarjetas.join('')}</div>`;
}

/** El primer vector, pintado como una tira: rojo los negativos, azul los positivos. */
function tira(v: Float32Array): string {
  const c = document.createElement('canvas');
  c.width = Math.min(v.length, 1536); c.height = 1;
  const x = c.getContext('2d')!;
  const img = x.createImageData(c.width, 1);
  let max = 1e-9;
  for (const n of v) max = Math.max(max, Math.abs(n));
  for (let i = 0; i < c.width; i++) {
    const t = v[i]! / max;
    const [r, g, b] = t < 0 ? [193, 69, 59] : [43, 76, 126];
    const a = Math.min(1, Math.abs(t) * 1.4);
    img.data.set([Math.round(245 + (r - 245) * a), Math.round(240 + (g - 240) * a), Math.round(232 + (b - 232) * a), 255], i * 4);
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}

async function pintarEspacios(p: HTMLElement, d: SpdfDocument, espacios: Awaited<ReturnType<SpdfDocument['spaces']>>) {
  if (!espacios.length) { p.innerHTML = `<p>${esc(T.sinEspacios)}</p>`; return; }
  const filas = await Promise.all(espacios.map(async (s) => {
    const vs = await d.vectors(s.id);
    return { s, n: vs.length, primero: vs[0]?.vector };
  }));
  p.innerHTML = `<div class="tabla" tabindex="0"><table><thead><tr><th scope="col">id</th><th scope="col">${esc(T.modelo)}</th><th scope="col" class="a-right">${esc(T.dims)}</th><th scope="col">${esc(T.dtype)}</th><th scope="col">${esc(T.normalizado)}</th><th scope="col">${esc(T.modalidades)}</th><th scope="col" class="a-right">${esc(T.vectores)}</th></tr></thead><tbody>${filas.map(({ s, n }) => `<tr><td><code>${esc(s.id)}</code></td><td>${esc(s.provider)} / ${esc(s.model)}${s.version ? `<br><small>${esc(s.version)}</small>` : ''}</td><td class="a-right">${s.dims}${s.truncated_from ? ` ← ${s.truncated_from}` : ''}</td><td><code>${s.dtype}</code></td><td>${s.normalized ? T.si : T.no}</td><td>${esc(s.modalities.join(', '))}</td><td class="a-right">${n}</td></tr>`).join('')}</tbody></table></div>
${filas.filter((f) => f.primero).map(({ s, primero }) => `<h3>${esc(T.muestra)} · <code>${esc(s.id)}</code></h3><img class="tira" src="${tira(primero!)}" alt="" width="${s.dims}" height="1">`).join('')}`;
}

async function pintarProcedencia(p: HTMLElement, d: SpdfDocument) {
  const ps = await d.provenance();
  if (!ps.length) { p.innerHTML = `<p>${esc(T.sinProcedencia)}</p>`; return; }
  p.innerHTML = `<div class="tabla" tabindex="0"><table><thead><tr><th scope="col">${esc(T.fase)}</th><th scope="col">${esc(T.proveedor)}</th><th scope="col">${esc(T.modelo)}</th><th scope="col" class="a-right">${esc(T.ms)}</th><th scope="col">${esc(T.cuando)}</th></tr></thead><tbody>${ps.map((r) => `<tr><td>${esc(r.stage)}</td><td>${esc(r.provider ?? '')}</td><td><code>${esc(r.model ?? '')}</code>${r.detail ? `<br><small><code>${esc(JSON.stringify(r.detail))}</code></small>` : ''}</td><td class="a-right">${r.ms ?? ''}</td><td>${esc(r.at)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pintarJson(p: HTMLElement, d: SpdfDocument, nombre: string) {
  const dump = await d.dump();
  const texto = JSON.stringify(dump, null, 2);
  const u = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  urls.push(u);
  const corto = texto.length > 200_000;
  p.innerHTML = `<p><a class="boton papel" href="${u}" download="${esc(nombre.replace(/\.spdf$/i, ''))}.dump.json">${esc(T.descargarJson)}</a></p>${corto ? `<p class="ayuda">${esc(T.recortado)}</p>` : ''}<pre class="json" tabindex="0"><code>${esc(corto ? `${texto.slice(0, 200_000)}\n…` : texto)}</code></pre>`;
}

// ---------------------------------------------------------------------------
// Entrada: soltar, elegir o probar una muestra
// ---------------------------------------------------------------------------

async function desdeFichero(f: File) {
  progreso(T.leyendo);
  await procesar(new Uint8Array(await f.arrayBuffer()), f.name);
}

if (raiz && raiz.dataset.activo === '1') {
  const zona = $('#soltar')!;
  const input = $('#fichero') as HTMLInputElement;
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void desdeFichero(f); input.value = ''; });
  for (const ev of ['dragenter', 'dragover']) {
    (ev === 'dragover' ? document : zona).addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('encima'); });
  }
  for (const ev of ['dragleave', 'dragend']) zona.addEventListener(ev, () => zona.classList.remove('encima'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.classList.remove('encima');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void desdeFichero(f);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.muestra')) {
    b.disabled = false;
    b.addEventListener('click', async () => {
      b.disabled = true;
      progreso(T.leyendo);
      try {
        const r = await fetch(b.dataset.url!);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await procesar(new Uint8Array(await r.arrayBuffer()), b.dataset.url!.split('/').pop()!);
      } catch (e) {
        resultado.innerHTML = `<p class="aviso">${esc(T.errorFetch)} ${esc((e as Error).message)}</p>`;
      } finally {
        b.disabled = false;
      }
    });
  }
  // Una muestra por la dirección: /validator#muestra=spdf-in-five-pages.spdf
  const m = /muestra=([\w.-]+)/.exec(location.hash);
  if (m) document.querySelector<HTMLButtonElement>(`.muestra[data-url$="/${m[1]}"]`)?.click();
}
