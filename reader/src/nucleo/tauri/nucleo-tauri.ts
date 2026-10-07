/**
 * El núcleo de escritorio y móvil: cada método es un comando de Rust
 * (src-tauri/src/comandos.rs) que envuelve el crate `spdf` y `spdf-infer`.
 * Los blobs (páginas, figuras, audio, vídeo) se sirven por un protocolo propio
 * (`spdf://`), con rangos HTTP para que el vídeo se pueda adelantar, sin
 * copiarlos a la memoria de la vista web.
 */
import { invoke, Channel, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Nucleo, Capacidades, Plataforma, EntradaBiblioteca, Coleccion, ResultadoImport, Progreso, PeticionBusqueda, ResultadoBusqueda, ModeloCatalogo, EstadoClave, MotorIA, OpcionesRevectorizar, OpcionesGenerar, Apoyo } from '../nucleo';
import type { Ancla, Figura, Fragmento, InformeValidacion, Lengua, Procedencia, Resumen, Unidad, Espacio } from '../tipos';

export class NucleoTauri implements Nucleo {
  plataforma: Plataforma = 'macos';
  capacidades: Capacidades = { iaLocal: true, webgpu: false, llavero: true, escribirEnFichero: true, pruebas: false };
  #pruebas: boolean;
  #consultas: string[] = [];

  constructor(o: { pruebas?: boolean } = {}) { this.#pruebas = !!o.pruebas; }

  async iniciar() {
    const r = await invoke<{ plataforma: Plataforma; capacidades: Capacidades; consultas: string[] }>('iniciar', { pruebas: this.#pruebas });
    this.plataforma = r.plataforma;
    this.capacidades = r.capacidades;
    this.#consultas = r.consultas ?? [];
    // Medidas para RENDIMIENTO.md (solo si el proceso se lanzó con SPDF_MEDIR=1; si no, el comando no apunta nada).
    const enviar = (nombre: string, ms: number) => void invoke('medida', { nombre, ms, detalle: null }).catch(() => {});
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'spdf:interfaz') enviar('webview_hasta_interfaz', e.startTime);
        if (e.name === 'spdf:apertura') enviar('apertura_hasta_texto', e.duration);
      }
    }).observe({ entryTypes: ['mark', 'measure'] });
  }

  /** Ficheros abiertos «con» el lector (doble clic, Abrir con…, compartir en el móvil). */
  alAbrirFicheros(f: (rutas: string[]) => void): () => void {
    let soltar: (() => void) | undefined;
    let vivo = true;
    void listen<string[]>('spdf://abrir', (e) => f(e.payload)).then((u) => { if (vivo) soltar = u; else u(); });
    void invoke<string[]>('ficheros_pendientes').then((r) => { if (r.length) f(r); });
    return () => { vivo = false; soltar?.(); };
  }

  biblioteca() { return invoke<EntradaBiblioteca[]>('biblioteca'); }
  async importar(origen: (File | string)[], alProgreso?: (p: Progreso) => void) {
    const rutas = origen.filter((o): o is string => typeof o === 'string');
    const ficheros = origen.filter((o): o is File => o instanceof File);
    const canal = new Channel<Progreso>();
    if (alProgreso) canal.onmessage = alProgreso;
    const out: ResultadoImport[] = rutas.length ? await invoke<ResultadoImport[]>('importar', { rutas, canal }) : [];
    // Arrastrados a la ventana en el móvil o sin ruta: se pasan los bytes.
    for (const f of ficheros) {
      const datos = new Uint8Array(await f.arrayBuffer());
      out.push(...(await invoke<ResultadoImport[]>('importar_bytes', { nombre: f.name, datos: Array.from(datos) })));
    }
    return out;
  }
  async elegirFicheros() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ multiple: true, filters: [{ name: 'SPDF', extensions: ['spdf', 'gz'] }] });
    if (!r) return [];
    return Array.isArray(r) ? r : [r];
  }
  quitar(id: string) { return invoke<void>('quitar', { id }); }
  recordarPosicion(id: string, ord: number) { return invoke<void>('recordar_posicion', { id, ord }); }
  colecciones() { return invoke<Coleccion[]>('colecciones'); }
  guardarColeccion(c: Coleccion) { return invoke<void>('guardar_coleccion', { c }); }
  borrarColeccion(id: string) { return invoke<void>('borrar_coleccion', { id }); }

  async abrir(id: string) {
    const r = await invoke<Resumen>('abrir', { id });
    if (this.#consultas.length) void this.#medirBusquedas(id);
    return r;
  }

  /** Modo medición: las consultas de SPDF_MEDIR_CONSULTAS, por el mismo camino que el panel de búsqueda. */
  async #medirBusquedas(id: string) {
    const qs = this.#consultas;
    this.#consultas = [];
    for (const ambito of [id, 'biblioteca']) {
      for (const consulta of qs) {
        const t0 = performance.now();
        const r = await this.buscar({ ambito, consulta, modo: 'lexica', limite: 60, lengua: 'es' });
        void invoke('medida', { nombre: ambito === 'biblioteca' ? 'buscar_biblioteca_ida_y_vuelta' : 'buscar_documento_ida_y_vuelta', ms: performance.now() - t0, detalle: `${consulta} · ${r.aciertos.length}` });
      }
    }
  }
  unidades(id: string, desde: number, hasta: number) { return invoke<Unidad[]>('unidades', { id, desde, hasta }); }
  fragmentos(id: string, unidad?: string) { return invoke<Fragmento[]>('fragmentos', { id, unidad: unidad ?? null }); }
  figuras(id: string) { return invoke<Figura[]>('figuras', { id }); }
  procedencia(id: string) { return invoke<Procedencia[]>('procedencia', { id }); }
  validar(id: string) { return invoke<InformeValidacion>('validar', { id }); }
  volcado(id: string) { return invoke<unknown>('volcado', { id }); }
  async recurso(id: string, ref: string) {
    if (/^(https?:|data:)/i.test(ref)) return ref;
    const clave = ref.startsWith('blob:') ? ref.slice(5) : ref;
    return convertFileSrc(`${id}/${encodeURIComponent(clave)}`, 'spdf');
  }
  unidadesPorFolio(id: string, folio: string) { return invoke<number[]>('unidades_por_folio', { id, folio }); }

  buscar(p: PeticionBusqueda) { return invoke<ResultadoBusqueda>('buscar', { p }); }
  citar(id: string, ancla: Ancla, lengua: Lengua, fin?: Ancla | null) { return invoke<string>('citar', { id, ancla, lengua, fin: fin ?? null }); }
  uriAncla(id: string, ancla: Ancla, fin?: Ancla | null) { return invoke<string>('uri_ancla', { id, ancla, fin: fin ?? null }); }
  referencia(id: string, formato: 'csl' | 'bibtex') { return invoke<string>('referencia', { id, formato }); }

  leerAnotaciones(id: string) { return invoke<string | null>('leer_anotaciones', { id }); }
  guardarAnotaciones(id: string, json: string) { return invoke<void>('guardar_anotaciones', { id, json }); }
  /** Guardar una copia del SPDF: diálogo nativo y copia del fichero en Rust (sin pasar los bytes por la vista). */
  async leerFichero(id: string): Promise<Uint8Array | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const e = (await this.biblioteca()).find((x) => x.id === id);
    const destino = await save({ defaultPath: e?.nombre ?? 'documento.spdf', filters: [{ name: 'SPDF', extensions: ['spdf'] }] });
    if (destino) await invoke('copiar_fichero', { id, destino });
    return null;
  }

  async guardarComo(nombre: string, contenido: string | Uint8Array, _mime: string) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ext = nombre.includes('.') ? nombre.split('.').slice(1).join('.') : '';
    const destino = await save({ defaultPath: nombre, filters: ext ? [{ name: ext, extensions: [ext.split('.').at(-1)!] }] : undefined });
    if (!destino) return false;
    const datos = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
    await invoke('escribir_fichero', { ruta: destino, datos: Array.from(datos) });
    return true;
  }

  modelos() { return invoke<ModeloCatalogo[]>('modelos'); }
  descargarModelo(id: string, alProgreso: (p: Progreso) => void) {
    const canal = new Channel<Progreso>();
    canal.onmessage = alProgreso;
    return invoke<void>('descargar_modelo', { id, canal });
  }
  borrarModelo(id: string) { return invoke<void>('borrar_modelo', { id }); }
  estadoClave() { return invoke<EstadoClave>('estado_clave'); }
  guardarClave(clave: string, persistir: boolean) { return invoke<void>('guardar_clave', { clave, persistir }); }
  borrarClave() { return invoke<void>('borrar_clave'); }
  espacioDe(motor: MotorIA, dims: number, modelo?: string) { return invoke<Espacio | null>('espacio_de', { motor, dims, modelo: modelo ?? null }); }
  revectorizar(id: string, o: OpcionesRevectorizar, alProgreso: (p: Progreso) => void) {
    const canal = new Channel<Progreso>();
    canal.onmessage = alProgreso;
    return invoke<EntradaBiblioteca>('revectorizar', { id, o, canal });
  }
  generar(prompt: string, o: OpcionesGenerar, alToken: (t: string) => void) {
    const canal = new Channel<string>();
    canal.onmessage = alToken;
    return invoke<string>('generar', { prompt, o, canal });
  }
  juzgar(afirmacion: string, pasaje: string, motor: MotorIA) { return invoke<Apoyo>('juzgar', { afirmacion, pasaje, motor }); }
}
