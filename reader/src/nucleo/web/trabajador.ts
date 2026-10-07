/// <reference lib="webworker" />
/**
 * El Worker de la versión web: aquí viven SQLite (en WASM, vía `spdf-format`),
 * la biblioteca en OPFS y la inferencia (vía `spdf-infer-web`). El hilo
 * principal solo pinta. Nada sale del navegador: los ficheros se leen de OPFS
 * y la única red posible es la que pida el usuario (descargar un modelo,
 * llamar a Gemini con su clave).
 */
import * as spdf from 'spdf-format/browser';
import { atender, type Evento } from './rpc';
import type { EntradaBiblioteca, Coleccion, PeticionBusqueda, ResultadoBusqueda, OpcionesRevectorizar, OpcionesGenerar, MotorIA, ModeloCatalogo, Progreso } from '../nucleo';
import type { Acierto, Ancla, Espacio, Resumen, Unidad } from '../tipos';
import { fusionarBiblioteca } from '../../util/fusion';
import * as gemini from './gemini';

type Doc = Awaited<ReturnType<typeof spdf.openSpdf>>;

/* ------------------------------------------------------------------ */
/* Almacén: OPFS si existe; si no, memoria (se pierde al cerrar).      */
/* ------------------------------------------------------------------ */
interface Almacen {
  persistente: boolean;
  leer(nombre: string): Promise<File | null>;
  escribir(nombre: string, datos: Uint8Array | string): Promise<void>;
  borrar(nombre: string): Promise<void>;
}

async function almacenOpfs(): Promise<Almacen> {
  const raiz = await navigator.storage.getDirectory();
  const dir = await raiz.getDirectoryHandle('spdf-lector', { create: true });
  return {
    persistente: true,
    async leer(n) {
      try { return await (await dir.getFileHandle(n)).getFile(); } catch { return null; }
    },
    async escribir(n, datos) {
      const fh = await dir.getFileHandle(n, { create: true });
      const b = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
      // En un Worker, el acceso síncrono es lo más rápido y lo que tienen todos los navegadores.
      const h = await (fh as any).createSyncAccessHandle();
      try { h.truncate(0); h.write(b, { at: 0 }); h.flush(); } finally { h.close(); }
    },
    async borrar(n) { try { await dir.removeEntry(n); } catch { /* ya no estaba */ } },
  };
}

function almacenMemoria(): Almacen {
  const m = new Map<string, File>();
  return {
    persistente: false,
    async leer(n) { return m.get(n) ?? null; },
    async escribir(n, d) { m.set(n, new File([d as BlobPart], n)); },
    async borrar(n) { m.delete(n); },
  };
}

let almacen: Almacen;
let pruebas = false;
let entradas: EntradaBiblioteca[] = [];
let colecciones: Coleccion[] = [];

const guardarIndice = () => almacen.escribir('biblioteca.json', JSON.stringify(entradas));
const guardarColecciones = () => almacen.escribir('colecciones.json', JSON.stringify(colecciones));
const fichero = (id: string) => `${id}.spdf`;
const anotaciones = (id: string) => `${id}.spdfa.json`;

async function leerJson<T>(n: string, defecto: T): Promise<T> {
  const f = await almacen.leer(n);
  if (!f) return defecto;
  try { return JSON.parse(await f.text()) as T; } catch { return defecto; }
}

async function sha256(b: ArrayBuffer | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Documentos abiertos (caché pequeña, de uso reciente)                */
/* ------------------------------------------------------------------ */
interface Abierto { doc: Doc; unidades: Unidad[]; ordDe: Map<string, number> }
const abiertos = new Map<string, Promise<Abierto>>();

function abierto(id: string): Promise<Abierto> {
  let p = abiertos.get(id);
  if (p) { abiertos.delete(id); abiertos.set(id, p); return p; }
  p = (async () => {
    const f = await almacen.leer(fichero(id));
    if (!f) throw new Error('El fichero ya no está en la biblioteca.');
    const doc = await spdf.openBlob(f);
    const unidades = (await doc.units()) as unknown as Unidad[];
    return { doc, unidades, ordDe: new Map(unidades.map((u) => [u.id, u.ord])) };
  })();
  p.catch(() => abiertos.delete(id));
  abiertos.set(id, p);
  while (abiertos.size > 6) {
    const [viejo, pv] = abiertos.entries().next().value!;
    abiertos.delete(viejo);
    void pv.then((a) => a.doc.close()).catch(() => {});
  }
  return p;
}

function cerrar(id: string) {
  const p = abiertos.get(id);
  abiertos.delete(id);
  void p?.then((a) => a.doc.close()).catch(() => {});
}

function autoresDe(m: any, autores: string | null): string {
  const a = (m?.author ?? []) as any[];
  if (a.length) return a.map((p) => p.literal ?? [p.given, p.family].filter(Boolean).join(' ')).join('; ');
  return autores ?? '';
}

async function entradaDe(id: string, nombre: string, bytes: number, doc: Doc, prev?: EntradaBiblioteca): Promise<EntradaBiblioteca> {
  const d = doc.document as any;
  const u1 = (await doc.unit(1)) as any;
  const espacios = ((await doc.spaces()) as any[]).map((s) => s.id);
  const y = d.metadata?.issued?.['date-parts']?.[0]?.[0];
  return {
    id, source_sha256: d.source_sha256, nombre,
    titulo: d.metadata?.title ?? d.title ?? nombre,
    autores: autoresDe(d.metadata, d.authors),
    anio: typeof y === 'number' ? y : d.year ?? null,
    tipo: d.kind, version: doc.version, legacy: doc.legacy,
    unidades: d.unit_count, bytes, espacios,
    anadido: prev?.anadido ?? new Date().toISOString(),
    abierto: prev?.abierto, ultimaUnidad: prev?.ultimaUnidad,
    miniatura: await miniaturaDe(doc, u1?.thumbnail ?? u1?.image ?? null),
  };
}

/** La miniatura de la primera unidad como data: URL (si es pequeña), para la ficha de la biblioteca. */
async function miniaturaDe(doc: Doc, ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const clave = ref.startsWith('blob:') ? ref.slice(5) : /^[a-z]+:/i.test(ref) ? null : ref;
  if (!clave) return null;
  const b = await doc.blob(clave);
  if (!b || b.data.length > 96_000) return null;
  let bin = '';
  for (let i = 0; i < b.data.length; i += 0x8000) bin += String.fromCharCode(...b.data.subarray(i, i + 0x8000));
  return `data:${b.mime};base64,${btoa(bin)}`;
}

/* ------------------------------------------------------------------ */
/* Inferencia (se carga solo si se usa)                                */
/* ------------------------------------------------------------------ */
type Infer = typeof import('spdf-infer-web');
let infer: Promise<Infer> | null = null;
const ia = () => (infer ??= import('spdf-infer-web'));
let gestor: any = null;
const gestorModelos = async () => (gestor ??= new (await ia()).ModelManager({ store: 'opfs' }));

let claveGemini: string | null = null;
let claveGuardada = false;

interface Incrustador { space(dims?: number): Espacio; embed(t: string[], o: { task: string; title?: string; dims?: number }): Promise<Float32Array[]> }
const incrustadores = new Map<string, Promise<Incrustador>>();

async function incrustador(motor: MotorIA, modelo?: string): Promise<Incrustador> {
  const k = `${motor}:${modelo ?? ''}`;
  let p = incrustadores.get(k);
  if (!p) {
    p = (async (): Promise<Incrustador> => {
      const m = await ia();
      if (motor === 'prueba') {
        if (!pruebas) throw new Error('El modelo de pruebas solo existe en modo pruebas.');
        const F = (m as any).FakeEmbedder;
        return (F.load ? await F.load() : new F()) as Incrustador;
      }
      if (motor === 'gemini') {
        if (!claveGemini) throw new Error('Falta la clave de Gemini.');
        const G = (m as any).GeminiEmbedder;
        return G ? (new G(claveGemini) as Incrustador) : gemini.incrustador(claveGemini);
      }
      const g = await gestorModelos();
      const id = modelo ?? g.recommend?.('embed')?.id;
      if (!id || !(await g.isDownloaded(id))) throw new Error('El modelo de vectores no está descargado.');
      return (await m.Embedder.load(id, { device: 'auto' })) as unknown as Incrustador;
    })();
    p.catch(() => incrustadores.delete(k));
    incrustadores.set(k, p);
  }
  return p;
}

/** Motores con los que se podría consultar ahora mismo, en orden de preferencia. */
async function motoresDisponibles(): Promise<{ motor: MotorIA; modelo?: string }[]> {
  const out: { motor: MotorIA; modelo?: string }[] = [];
  try {
    const g = await gestorModelos();
    for (const c of g.catalog() as any[]) if (c.kind === 'embed' && (await g.isDownloaded(c.id))) out.push({ motor: 'local', modelo: c.id });
  } catch { /* sin inferencia local */ }
  if (claveGemini) out.push({ motor: 'gemini' });
  if (pruebas) out.push({ motor: 'prueba' });
  return out;
}

const compatible = async (guardado: Espacio, consulta: Espacio) => {
  const m = await ia();
  return (m as any).isCompatible ? (m as any).isCompatible(guardado, consulta) : guardado.id === consulta.id;
};

/** El vector de la consulta para un espacio del documento, si algún motor disponible es compatible. */
const vectoresConsulta = new Map<string, Float32Array>();
async function vectorPara(espacios: Espacio[], q: string): Promise<{ espacio: Espacio; v: Float32Array } | { motivo: string }> {
  if (!espacios.length) return { motivo: 'sin-vectores' };
  const motores = await motoresDisponibles();
  if (!motores.length) return { motivo: 'sin-modelo' };
  for (const e of espacios) {
    for (const mo of motores) {
      let inc: Incrustador;
      try { inc = await incrustador(mo.motor, mo.modelo); } catch { continue; }
      const qs = inc.space(e.dims);
      if (!(await compatible(e, qs))) continue;
      const k = `${qs.id}|${mo.motor}|${q}`;
      let v = vectoresConsulta.get(k);
      if (!v) { [v] = await inc.embed([q], { task: 'query', dims: e.dims }); vectoresConsulta.set(k, v); }
      return { espacio: e, v };
    }
  }
  return { motivo: 'incompatible' };
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */
async function buscarEn(id: string, p: PeticionBusqueda, limite: number): Promise<{ aciertos: Acierto[]; modo: PeticionBusqueda['modo']; motivo?: string }> {
  const a = await abierto(id);
  const d = a.doc;
  let crudos: any[] = [];
  let modo = p.modo;
  let motivo: string | undefined;
  if (p.modo !== 'lexica') {
    const r = await vectorPara((await d.spaces()) as unknown as Espacio[], p.consulta);
    if ('v' in r) {
      crudos = p.modo === 'semantica'
        ? await d.searchVector(r.espacio.id, r.v, { target: 'fragment', limit: limite })
        : await d.searchHybrid(p.consulta, r.v, r.espacio.id, { limit: limite, k: 10 });
    } else { motivo = r.motivo; modo = 'lexica'; }
  }
  if (modo === 'lexica') crudos = await d.searchLexical(p.consulta, { limit: limite });
  const aciertos: Acierto[] = [];
  for (const h of crudos) {
    const f = (await d.fragment(h.fragment_id)) as any;
    if (!f) continue;
    const ancla = (h.anchor ?? f.anchor) as Ancla;
    aciertos.push({
      fragment_id: h.fragment_id, n: h.n ?? f.n, score: h.score, via: h.via, anchor: ancla, anchor_uri: h.anchor_uri,
      documento: id, texto: f.text, contexto: f.context ?? '',
      unidad_ord: a.ordDe.get(f.unit) ?? 1, folio: (ancla as any).printed ?? null,
      cita: d.cite(ancla, p.lengua, f.anchor_end ?? undefined),
    });
  }
  return { aciertos, modo, motivo };
}

/* ------------------------------------------------------------------ */
/* Los métodos                                                         */
/* ------------------------------------------------------------------ */
atender({
  async iniciar(o: { pruebas?: boolean } = {}) {
    pruebas = !!o.pruebas;
    try { almacen = await almacenOpfs(); } catch { almacen = almacenMemoria(); }
    entradas = await leerJson('biblioteca.json', []);
    colecciones = await leerJson('colecciones.json', []);
    const k = await almacen.leer('clave-gemini');
    if (k) { claveGemini = (await k.text()).trim() || null; claveGuardada = !!claveGemini; }
    return { persistente: almacen.persistente, webgpu: 'gpu' in navigator };
  },

  async biblioteca() { return entradas; },

  async importar(ficheros: File[], emitir: (e: Evento) => void) {
    const out = [];
    for (const [i, f] of ficheros.entries()) {
      emitir({ fase: 'importar', hecho: i, total: ficheros.length, detalle: f.name } satisfies Progreso);
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const id = await sha256(buf);
        const ya = entradas.find((e) => e.id === id);
        if (ya) { out.push({ nombre: f.name, ok: true, entrada: ya, repetido: true }); continue; }
        const doc = await spdf.openSpdf(buf);
        try {
          await almacen.escribir(fichero(id), buf);
          const e = await entradaDe(id, f.name, buf.length, doc);
          entradas = [e, ...entradas];
          await guardarIndice();
          out.push({ nombre: f.name, ok: true, entrada: e });
        } finally { doc.close(); }
      } catch (err) {
        out.push({ nombre: f.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    emitir({ fase: 'importar', hecho: ficheros.length, total: ficheros.length } satisfies Progreso);
    return out;
  },

  async quitar(id: string) {
    cerrar(id);
    entradas = entradas.filter((e) => e.id !== id);
    await guardarIndice();
    await almacen.borrar(fichero(id));
  },

  async recordarPosicion(id: string, ord: number) {
    const e = entradas.find((x) => x.id === id);
    if (!e) return;
    e.ultimaUnidad = ord;
    e.abierto = new Date().toISOString();
    await guardarIndice();
  },

  async colecciones() { return colecciones; },
  async guardarColeccion(c: Coleccion) {
    colecciones = [...colecciones.filter((x) => x.id !== c.id), c];
    await guardarColecciones();
  },
  async borrarColeccion(id: string) {
    colecciones = colecciones.filter((x) => x.id !== id);
    await guardarColecciones();
  },

  async abrir(id: string): Promise<Resumen> {
    const a = await abierto(id);
    const d = a.doc as any;
    const doc = d.document;
    const ref = doc.source_ref as string | null;
    return {
      entrada: id, version: d.version, legacy: d.legacy, meta: d.meta, document: doc,
      sections: await d.sections(), spaces: await d.spaces(),
      figuras: (await d.figures()).length, fragmentos: (await d.fragments()).length,
      extensions: await d.extensions(),
      folios: a.unidades.map((u) => u.printed ?? null),
      medio: (doc.kind === 'audio' || doc.kind === 'video') && ref ? { ref, mime: doc.mime } : null,
    };
  },

  async unidades(id: string, desde: number, hasta: number) {
    const a = await abierto(id);
    return a.unidades.filter((u) => u.ord >= desde && u.ord <= hasta);
  },
  async fragmentos(id: string, unidad?: string) { return (await abierto(id)).doc.fragments(unidad); },
  async figuras(id: string) { return (await abierto(id)).doc.figures(); },
  async procedencia(id: string) { return (await abierto(id)).doc.provenance(); },
  async validar(id: string) {
    const f = await almacen.leer(fichero(id));
    if (!f) throw new Error('El fichero ya no está en la biblioteca.');
    return spdf.validate(f);
  },
  async volcado(id: string) { return (await abierto(id)).doc.dump(); },
  async blob(id: string, clave: string) {
    const b = await (await abierto(id)).doc.blob(clave);
    return b ? { mime: b.mime, data: b.data } : null;
  },
  async unidadesPorFolio(id: string, folio: string) {
    const a = await abierto(id);
    const f = folio.trim().replace(/^\[|\]$/g, '').toLowerCase();
    return a.unidades.filter((u) => (u.printed ?? '').toLowerCase() === f).map((u) => u.ord);
  },

  async buscar(p: PeticionBusqueda): Promise<ResultadoBusqueda> {
    const t0 = performance.now();
    const limite = p.limite ?? 30;
    const ids = p.ambito === 'biblioteca' ? entradas.map((e) => e.id) : [p.ambito];
    const listas: Acierto[][] = [];
    const avisos: ResultadoBusqueda['avisos'] = [];
    let modo = p.modo;
    for (const id of ids) {
      try {
        const r = await buscarEn(id, p, limite);
        listas.push(r.aciertos);
        if (r.motivo) avisos.push({ documento: id, motivo: r.motivo });
        if (r.modo === 'lexica' && ids.length === 1) modo = 'lexica';
      } catch (err) {
        avisos.push({ documento: id, motivo: err instanceof Error ? err.message : String(err) });
      }
    }
    if (ids.length > 1 && avisos.length === ids.length && p.modo !== 'lexica') modo = 'lexica';
    const aciertos = ids.length === 1 ? (listas[0] ?? []) : fusionarBiblioteca(listas, limite);
    return { aciertos, modo, avisos, ms: Math.round(performance.now() - t0) };
  },

  async citar(id: string, ancla: Ancla, lengua: 'es' | 'en', fin?: Ancla | null) {
    return (await abierto(id)).doc.cite(ancla, lengua, fin ?? undefined);
  },
  async uriAncla(id: string, ancla: Ancla, fin?: Ancla | null) {
    return (await abierto(id)).doc.anchorUri(ancla, fin ?? undefined);
  },
  async referencia(id: string, formato: 'csl' | 'bibtex') {
    const d = (await abierto(id)).doc.document;
    const r = formato === 'csl' ? spdf.toCslJson(d) : spdf.toBibtex(d);
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  },

  async leerAnotaciones(id: string) { const f = await almacen.leer(anotaciones(id)); return f ? f.text() : null; },
  async guardarAnotaciones(id: string, json: string) { await almacen.escribir(anotaciones(id), json); },
  async leerFichero(id: string) { const f = await almacen.leer(fichero(id)); return f ? new Uint8Array(await f.arrayBuffer()) : null; },

  /* IA */
  async modelos(): Promise<ModeloCatalogo[]> {
    const g = await gestorModelos();
    const rec = new Set(['embed', 'generate', 'judge'].map((k) => g.recommend?.(k)?.id).filter(Boolean));
    const out: ModeloCatalogo[] = [];
    for (const c of g.catalog() as any[]) {
      out.push({ id: c.id, nombre: c.name, tipo: c.kind, bytes: c.bytes, licencia: c.license, descargado: await g.isDownloaded(c.id), recomendado: rec.has(c.id), motor: c.engine });
    }
    return out;
  },
  async descargarModelo(id: string, emitir: (e: Evento) => void) {
    const g = await gestorModelos();
    await g.download(id, (p: { file: string; done: number; total: number }) => emitir({ fase: 'descargar', hecho: p.done, total: p.total, detalle: p.file } satisfies Progreso));
    incrustadores.clear();
  },
  async borrarModelo(id: string) { await (await gestorModelos()).delete(id); incrustadores.clear(); },

  async estadoClave() { return claveGemini ? (claveGuardada ? 'llavero' : 'memoria') : 'ninguna'; },
  async guardarClave(clave: string, persistir: boolean) {
    claveGemini = clave.trim() || null;
    claveGuardada = persistir && !!claveGemini;
    if (claveGuardada) await almacen.escribir('clave-gemini', claveGemini!);
    else await almacen.borrar('clave-gemini');
    incrustadores.clear();
    vectoresConsulta.clear();
  },
  async borrarClave() { claveGemini = null; claveGuardada = false; await almacen.borrar('clave-gemini'); incrustadores.clear(); },

  async espacioDe(motor: MotorIA, dims: number, modelo?: string) {
    try { return (await incrustador(motor, modelo)).space(dims); } catch { return null; }
  },

  async revectorizar(id: string, o: OpcionesRevectorizar, emitir: (e: Evento) => void) {
    const a = await abierto(id);
    const doc = a.doc as any;
    const inc = await incrustador(o.motor, o.modelo);
    const espacio = { ...inc.space(o.dims), created: new Date().toISOString() };
    const frags = (await doc.fragments()) as any[];
    const titulo = doc.document?.metadata?.title ?? undefined;
    const lote = o.motor === 'gemini' ? 64 : 16;
    const items: { target: string; id: string; vector: Float32Array }[] = [];
    for (let i = 0; i < frags.length; i += lote) {
      emitir({ fase: 'vectores', hecho: i, total: frags.length } satisfies Progreso);
      const parte = frags.slice(i, i + lote);
      const vs = await inc.embed(parte.map((f) => f.text), { task: 'document', title: titulo, dims: o.dims });
      parte.forEach((f, j) => items.push({ target: 'fragment', id: f.id, vector: vs[j] }));
    }
    emitir({ fase: 'escribir', hecho: frags.length, total: frags.length } satisfies Progreso);
    const w = await (spdf as any).SpdfWriter.fromSpdf(doc);
    const sid: string = (await w.addSpace(espacio)) ?? espacio.id;
    await w.addVectors(sid, items);
    const bytes: Uint8Array = await w.finish();
    // Siempre 5.0 válido: si la biblioteca dice que no, no se guarda nada.
    const informe = await spdf.validate(bytes);
    if (!informe.valid) throw new Error(`El fichero revectorizado no es válido: ${informe.errors.map((e: any) => e.code).join(', ')}`);
    const nuevoId = await sha256(bytes);
    const prev = entradas.find((e) => e.id === id)!;
    await almacen.escribir(fichero(nuevoId), bytes);
    const nd = await spdf.openSpdf(bytes);
    let e: EntradaBiblioteca;
    try {
      const base = prev.nombre.replace(/\.spdf$/i, '');
      e = await entradaDe(nuevoId, o.destino === 'copia' ? `${base} (${espacio.id}).spdf` : prev.nombre, bytes.length, nd, o.destino === 'fichero' ? prev : undefined);
    } finally { nd.close(); }
    if (o.destino === 'fichero') {
      // Las anotaciones siguen al fichero.
      const an = await almacen.leer(anotaciones(id));
      if (an) await almacen.escribir(anotaciones(nuevoId), await an.text());
      cerrar(id);
      entradas = entradas.map((x) => (x.id === id ? e : x));
      await almacen.borrar(fichero(id));
      await almacen.borrar(anotaciones(id));
    } else {
      entradas = [e, ...entradas];
    }
    await guardarIndice();
    emitir({ fase: 'hecho', hecho: frags.length, total: frags.length } satisfies Progreso);
    return e;
  },

  async generar(prompt: string, o: OpcionesGenerar, emitir: (e: Evento) => void) {
    let texto = '';
    const alToken = (t: string) => { texto += t; emitir({ token: t }); return true; };
    if (o.motor === 'gemini') {
      if (!claveGemini) throw new Error('Falta la clave de Gemini.');
      await gemini.generar(claveGemini, prompt, o, alToken);
      return texto;
    }
    const m = await ia();
    let id = o.modelo;
    if (o.motor === 'local') {
      const g = await gestorModelos();
      id ??= g.recommend?.('generate')?.id;
      if (!id || !(await g.isDownloaded(id))) throw new Error('El modelo de lenguaje no está descargado.');
    } else if (!pruebas) throw new Error('El modelo de pruebas solo existe en modo pruebas.');
    const gen = await m.Generator.load(id ?? 'spdf-fake');
    await gen.generate(prompt, { max_tokens: o.max_tokens ?? 700, temperature: o.temperature ?? 0.2, system: o.system, stop: o.stop }, alToken);
    return texto;
  },

  async juzgar(afirmacion: string, pasaje: string, motor: MotorIA) {
    if (motor === 'gemini') {
      if (!claveGemini) throw new Error('Falta la clave de Gemini.');
      return gemini.juzgar(claveGemini, afirmacion, pasaje);
    }
    const m = await ia();
    const j = await m.Judge.load(motor === 'prueba' ? 'spdf-fake' : undefined as never);
    const r = await j.support(afirmacion, pasaje);
    return { supported: r.supported, label: String(r.label) };
  },
});
