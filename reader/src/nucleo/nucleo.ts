/**
 * El núcleo del lector: todo lo que la interfaz necesita de la plataforma,
 * detrás de una sola interfaz. Hay dos implementaciones:
 *
 *   - web/: 100 % en el navegador, con `spdf-format` (SQLite en WASM) en un Worker,
 *     la biblioteca en OPFS y la inferencia con `spdf-infer-web` (WebGPU).
 *   - tauri/: escritorio y móvil, con comandos de Rust que envuelven el crate `spdf`
 *     y `spdf-infer` (llama.cpp), el llavero del sistema y el disco.
 *
 * La interfaz no sabe en cuál corre. Lo que es lógica de producto y no de
 * plataforma (preguntar con citas verificadas, fusionar resultados de la
 * biblioteca, exportar Markdown) vive fuera, en `src/util/`.
 */
import type {
  Ancla, Figura, Fragmento, InformeValidacion, Lengua, ModoBusqueda,
  Procedencia, Resumen, TipoDocumento, Unidad, Espacio, Acierto,
} from './tipos';

export type Plataforma = 'web' | 'macos' | 'windows' | 'linux' | 'ios' | 'android';

export interface EntradaBiblioteca {
  /** SHA-256 del fichero .spdf tal como está (cambia si se revectoriza). */
  id: string;
  /** SHA-256 del original (documents.source_sha256): lo que usan las anclas y las colecciones. */
  source_sha256: string;
  nombre: string;
  titulo: string;
  autores: string;
  anio: number | null;
  tipo: TipoDocumento;
  version: string;
  legacy: boolean;
  unidades: number;
  bytes: number;
  espacios: string[];
  /** Escritorio: ruta del fichero en disco (no se copia). Web y móvil: no hay. */
  ruta?: string;
  anadido: string;
  abierto?: string;
  ultimaUnidad?: number;
  /** Referencia ('blob:<clave>') de la miniatura de la primera unidad, si la hay. */
  miniatura?: string | null;
}

export interface Coleccion {
  id: string;
  nombre: string;
  /** source_sha256 de cada documento. */
  items: string[];
}

export interface ResultadoImport {
  nombre: string;
  ok: boolean;
  entrada?: EntradaBiblioteca;
  /** Ya estaba en la biblioteca. */
  repetido?: boolean;
  error?: string;
}

export interface PeticionBusqueda {
  /** id de una entrada o 'biblioteca' para buscar en todas. */
  ambito: string;
  consulta: string;
  modo: ModoBusqueda;
  limite?: number;
  lengua: Lengua;
}

export interface ResultadoBusqueda {
  aciertos: Acierto[];
  /** El modo que de verdad se usó (p. ej. léxica si no había espacio compatible). */
  modo: ModoBusqueda;
  /** Documentos en que la semántica no se pudo usar, con el motivo. */
  avisos: { documento: string; motivo: string }[];
  ms: number;
}

export type TipoModelo = 'embed' | 'generate' | 'judge';

export interface ModeloCatalogo {
  id: string;
  nombre: string;
  tipo: TipoModelo;
  bytes: number;
  licencia: string;
  descargado: boolean;
  recomendado: boolean;
  motor: string;
}

export interface Progreso {
  fase: string;
  hecho: number;
  total: number;
  detalle?: string;
}

export type MotorIA = 'local' | 'gemini' | 'prueba';

export interface OpcionesRevectorizar {
  motor: MotorIA;
  /** Modelo local del catálogo (si motor = local). */
  modelo?: string;
  /** Recorte Matryoshka: 768, 512, 256 o 128. */
  dims: number;
  /** 'copia' escribe un .spdf nuevo; 'fichero' reescribe el mismo (solo si el usuario lo pide). */
  destino: 'copia' | 'fichero';
}

export interface OpcionesGenerar {
  motor: MotorIA;
  modelo?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  stop?: string[];
}

export interface Apoyo {
  /** Probabilidad de que el pasaje respalde la afirmación (APOYO_DIRECTO + APLICACION_DE_MARCO). */
  supported: number;
  label: string;
}

export type EstadoClave = 'ninguna' | 'memoria' | 'llavero';

export interface Capacidades {
  /** Hay inferencia local en esta plataforma (llama.cpp o WebGPU/WASM). */
  iaLocal: boolean;
  webgpu: boolean;
  /** Puede guardar la clave en el llavero del sistema. */
  llavero: boolean;
  /** Puede reescribir el fichero original (escritorio). */
  escribirEnFichero: boolean;
  /** Se puede usar el modelo falso de pruebas (solo en modo pruebas). */
  pruebas: boolean;
}

export interface Nucleo {
  readonly plataforma: Plataforma;
  readonly capacidades: Capacidades;
  /** Arranca lo que haga falta (worker, OPFS, base de la biblioteca). */
  iniciar(): Promise<void>;

  /* Biblioteca y colecciones */
  biblioteca(): Promise<EntradaBiblioteca[]>;
  /** Web: File[]; Tauri: rutas. */
  importar(origen: (File | string)[], alProgreso?: (p: Progreso) => void): Promise<ResultadoImport[]>;
  /** Abre el diálogo nativo de ficheros (Tauri); en la web devuelve null y la UI usa <input type=file>. */
  elegirFicheros(): Promise<string[] | null>;
  quitar(id: string): Promise<void>;
  recordarPosicion(id: string, ord: number): Promise<void>;
  colecciones(): Promise<Coleccion[]>;
  guardarColeccion(c: Coleccion): Promise<void>;
  borrarColeccion(id: string): Promise<void>;

  /* Un documento */
  abrir(id: string): Promise<Resumen>;
  unidades(id: string, desde: number, hasta: number): Promise<Unidad[]>;
  fragmentos(id: string, unidad?: string): Promise<Fragmento[]>;
  figuras(id: string): Promise<Figura[]>;
  procedencia(id: string): Promise<Procedencia[]>;
  validar(id: string): Promise<InformeValidacion>;
  volcado(id: string): Promise<unknown>;
  /** URL utilizable en <img>, <audio> o <video> para 'blob:<clave>' o una URL. */
  recurso(id: string, ref: string): Promise<string | null>;
  unidadesPorFolio(id: string, folio: string): Promise<number[]>;

  /* Búsqueda y citas */
  buscar(p: PeticionBusqueda): Promise<ResultadoBusqueda>;
  citar(id: string, ancla: Ancla, lengua: Lengua, fin?: Ancla | null): Promise<string>;
  uriAncla(id: string, ancla: Ancla, fin?: Ancla | null): Promise<string>;
  referencia(id: string, formato: 'csl' | 'bibtex'): Promise<string>;

  /* Anotaciones (.spdfa.json, fichero hermano; nunca dentro del SPDF) */
  leerAnotaciones(id: string): Promise<string | null>;
  guardarAnotaciones(id: string, json: string): Promise<void>;

  /** Guarda un fichero que exporta el usuario (descarga en la web, diálogo en Tauri). */
  guardarComo(nombre: string, contenido: string | Uint8Array, mime: string): Promise<boolean>;

  /* Modelos e IA (todo bajo demanda) */
  modelos(): Promise<ModeloCatalogo[]>;
  descargarModelo(id: string, alProgreso: (p: Progreso) => void): Promise<void>;
  borrarModelo(id: string): Promise<void>;
  estadoClave(): Promise<EstadoClave>;
  guardarClave(clave: string, persistir: boolean): Promise<void>;
  borrarClave(): Promise<void>;
  /** Espacio que produciría un motor con un recorte dado (para comprobar compatibilidad). */
  espacioDe(motor: MotorIA, dims: number, modelo?: string): Promise<Espacio | null>;
  revectorizar(id: string, o: OpcionesRevectorizar, alProgreso: (p: Progreso) => void): Promise<EntradaBiblioteca>;
  generar(prompt: string, o: OpcionesGenerar, alToken: (t: string) => void): Promise<string>;
  juzgar(afirmacion: string, pasaje: string, motor: MotorIA): Promise<Apoyo>;
}
