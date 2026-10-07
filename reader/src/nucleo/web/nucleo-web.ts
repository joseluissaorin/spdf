/**
 * El núcleo de la versión web: un Worker hace todo el trabajo (SQLite en WASM,
 * OPFS, inferencia) y aquí solo se traducen las llamadas y se convierten los
 * blobs en URL de objeto para <img>, <audio> y <video>.
 */
import type { Nucleo, Capacidades, EntradaBiblioteca, Coleccion, ResultadoImport, Progreso, PeticionBusqueda, ResultadoBusqueda, ModeloCatalogo, EstadoClave, MotorIA, OpcionesRevectorizar, OpcionesGenerar, Apoyo } from '../nucleo';
import type { Ancla, Figura, Fragmento, InformeValidacion, Lengua, Procedencia, Resumen, Unidad, Espacio } from '../tipos';
import { Canal } from './rpc';

export class NucleoWeb implements Nucleo {
  readonly plataforma = 'web' as const;
  capacidades: Capacidades = { iaLocal: true, webgpu: false, llavero: false, escribirEnFichero: false, pruebas: false };
  persistente = true;
  #c: Canal;
  #urls = new Map<string, Promise<string | null>>();

  constructor(o: { pruebas?: boolean } = {}) {
    const w = new Worker(new URL('./trabajador.ts', import.meta.url), { type: 'module', name: 'spdf' });
    this.#c = new Canal(w);
    this.capacidades.pruebas = !!o.pruebas;
  }

  #l<T>(m: string, ...a: unknown[]): Promise<T> { return this.#c.llamar<T>(m, a); }

  async iniciar() {
    const r = await this.#c.llamar<{ persistente: boolean; webgpu: boolean }>('iniciar', [{ pruebas: this.capacidades.pruebas }]);
    this.persistente = r.persistente;
    this.capacidades.webgpu = r.webgpu;
    // Pedir almacenamiento persistente: que el navegador no borre la biblioteca por falta de espacio.
    void navigator.storage?.persist?.().catch(() => {});
  }

  biblioteca() { return this.#l<EntradaBiblioteca[]>('biblioteca'); }
  importar(origen: (File | string)[], alProgreso?: (p: Progreso) => void) {
    const ficheros = origen.filter((o): o is File => o instanceof File);
    return this.#c.llamar<ResultadoImport[]>('importar', [ficheros], (e) => alProgreso?.(e as Progreso));
  }
  async elegirFicheros() { return null; }
  quitar(id: string) { this.#olvidar(id); return this.#l<void>('quitar', id); }
  recordarPosicion(id: string, ord: number) { return this.#l<void>('recordarPosicion', id, ord); }
  colecciones() { return this.#l<Coleccion[]>('colecciones'); }
  guardarColeccion(c: Coleccion) { return this.#l<void>('guardarColeccion', c); }
  borrarColeccion(id: string) { return this.#l<void>('borrarColeccion', id); }

  abrir(id: string) { return this.#l<Resumen>('abrir', id); }
  unidades(id: string, desde: number, hasta: number) { return this.#l<Unidad[]>('unidades', id, desde, hasta); }
  fragmentos(id: string, unidad?: string) { return this.#l<Fragmento[]>('fragmentos', id, unidad); }
  figuras(id: string) { return this.#l<Figura[]>('figuras', id); }
  procedencia(id: string) { return this.#l<Procedencia[]>('procedencia', id); }
  validar(id: string) { return this.#l<InformeValidacion>('validar', id); }
  volcado(id: string) { return this.#l<unknown>('volcado', id); }

  recurso(id: string, ref: string): Promise<string | null> {
    if (/^(https?:|data:)/i.test(ref)) return Promise.resolve(ref);
    const clave = ref.startsWith('blob:') ? ref.slice(5) : ref;
    const k = `${id}|${clave}`;
    let p = this.#urls.get(k);
    if (!p) {
      p = this.#l<{ mime: string; data: Uint8Array } | null>('blob', id, clave).then((b) =>
        b ? URL.createObjectURL(new Blob([b.data as BlobPart], { type: b.mime })) : null);
      this.#urls.set(k, p);
    }
    return p;
  }
  #olvidar(id: string) {
    for (const [k, p] of this.#urls) if (k.startsWith(`${id}|`)) { void p.then((u) => u && URL.revokeObjectURL(u)); this.#urls.delete(k); }
  }
  unidadesPorFolio(id: string, folio: string) { return this.#l<number[]>('unidadesPorFolio', id, folio); }

  buscar(p: PeticionBusqueda) { return this.#l<ResultadoBusqueda>('buscar', p); }
  citar(id: string, ancla: Ancla, lengua: Lengua, fin?: Ancla | null) { return this.#l<string>('citar', id, ancla, lengua, fin ?? null); }
  uriAncla(id: string, ancla: Ancla, fin?: Ancla | null) { return this.#l<string>('uriAncla', id, ancla, fin ?? null); }
  referencia(id: string, formato: 'csl' | 'bibtex') { return this.#l<string>('referencia', id, formato); }

  leerAnotaciones(id: string) { return this.#l<string | null>('leerAnotaciones', id); }
  guardarAnotaciones(id: string, json: string) { return this.#l<void>('guardarAnotaciones', id, json); }
  leerFichero(id: string) { return this.#l<Uint8Array | null>('leerFichero', id); }

  async guardarComo(nombre: string, contenido: string | Uint8Array, mime: string) {
    const url = URL.createObjectURL(new Blob([contenido as BlobPart], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  }

  modelos() { return this.#l<ModeloCatalogo[]>('modelos'); }
  descargarModelo(id: string, alProgreso: (p: Progreso) => void) { return this.#c.llamar<void>('descargarModelo', [id], (e) => alProgreso(e as Progreso)); }
  borrarModelo(id: string) { return this.#l<void>('borrarModelo', id); }
  estadoClave() { return this.#l<EstadoClave>('estadoClave'); }
  guardarClave(clave: string, persistir: boolean) { return this.#l<void>('guardarClave', clave, persistir); }
  borrarClave() { return this.#l<void>('borrarClave'); }
  espacioDe(motor: MotorIA, dims: number, modelo?: string) { return this.#l<Espacio | null>('espacioDe', motor, dims, modelo); }
  revectorizar(id: string, o: OpcionesRevectorizar, alProgreso: (p: Progreso) => void) {
    return this.#c.llamar<EntradaBiblioteca>('revectorizar', [id, o], (e) => alProgreso(e as Progreso));
  }
  generar(prompt: string, o: OpcionesGenerar, alToken: (t: string) => void) {
    return this.#c.llamar<string>('generar', [prompt, o], (e) => alToken((e as { token: string }).token));
  }
  juzgar(afirmacion: string, pasaje: string, motor: MotorIA) { return this.#l<Apoyo>('juzgar', afirmacion, pasaje, motor); }
}
