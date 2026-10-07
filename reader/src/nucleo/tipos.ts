/**
 * Tipos del dominio, en la vista 5.0 del contrato (spec/CONTRACT.md, §2–§6).
 * Los nombres de los campos son los de las columnas (snake_case), igual que el
 * volcado canónico, la API de `spdf-format` y los tipos serde del crate `spdf`:
 * así viajan sin traducir entre el núcleo (web o Tauri) y la interfaz.
 */

export type Version = '5.0' | '4.0' | '4.1' | string;

export type TipoDocumento =
  | 'pdf' | 'scanned_pdf' | 'photos' | 'image' | 'audio' | 'video'
  | 'document' | 'epub' | 'slides' | 'sheet' | 'web';

export interface Region { x: number; y: number; w: number; h: number }

export interface AnclaBase {
  region?: Region;
  chars?: [number, number];
}
export interface AnclaPagina extends AnclaBase {
  type: 'page';
  physical: number;
  printed?: string | null;
  roman?: boolean;
  foliation?: 'page' | 'leaf' | 'column';
  source?: 'read' | 'inferred' | 'epub' | 'none';
  confidence?: number;
}
export interface AnclaTiempo extends AnclaBase { type: 'time'; t0: number; t1?: number; speaker?: string }
export interface AnclaSeccion extends AnclaBase { type: 'section'; path: string[]; paragraph?: number; printed?: string }
export interface AnclaDiapositiva extends AnclaBase { type: 'slide'; n: number }
export interface AnclaHoja extends AnclaBase { type: 'sheet'; sheet: string; row_from?: number; row_to?: number }
export interface AnclaWeb extends AnclaBase { type: 'web'; url: string; path?: string[]; paragraph?: number; accessed?: string }
export interface AnclaImagen extends AnclaBase { type: 'image' }
export interface AnclaVerso extends AnclaBase { type: 'verse'; line_from: number; line_to?: number; printed?: string }
export interface AnclaCanonica extends AnclaBase { type: 'canonical'; scheme: string; ref: string }

export type Ancla =
  | AnclaPagina | AnclaTiempo | AnclaSeccion | AnclaDiapositiva | AnclaHoja
  | AnclaWeb | AnclaImagen | AnclaVerso | AnclaCanonica;

export interface PersonaCsl { family?: string; given?: string; literal?: string }
export interface FechaCsl { 'date-parts'?: (number | string)[][]; literal?: string; raw?: string }

/** Un ítem CSL-JSON con la extensión `spdf` (§4). */
export interface MetadatosCsl {
  type: string;
  title?: string;
  author?: PersonaCsl[];
  editor?: PersonaCsl[];
  translator?: PersonaCsl[];
  interviewer?: PersonaCsl[];
  issued?: FechaCsl;
  'original-date'?: FechaCsl;
  publisher?: string;
  'publisher-place'?: string;
  'container-title'?: string;
  'collection-title'?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  edition?: string | number;
  DOI?: string;
  ISBN?: string;
  URL?: string;
  language?: string;
  abstract?: string;
  spdf?: {
    provenance?: Record<string, { source?: string; confidence?: number }>;
    undated?: { from?: number; to?: number; basis?: string };
    original_language?: string;
    orcid?: Record<string, string>;
    subtitle?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface Derechos { license?: string; access?: string; holder?: string; note?: string }

export interface Documento {
  id: string;
  kind: TipoDocumento;
  metadata: MetadatosCsl;
  source_sha256: string;
  source_ref: string | null;
  mime: string;
  bytes: number;
  unit_count: number;
  duration: number | null;
  created: string;
  updated: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  language: string | null;
  rights: Derechos | null;
}

export interface TiemposPalabras { v: 1; t0: number; cs: number[] }

export interface Unidad {
  id: string;
  ord: number;
  anchor: Ancla;
  text: string;
  notes: string[] | null;
  header: string | null;
  footer: string | null;
  image: string | null;
  thumbnail: string | null;
  reader: string;
  confidence: number;
  printed: string | null;
  t0: number | null;
  t1: number | null;
  words: TiemposPalabras | null;
}

export interface Seccion {
  id: string;
  parent: string | null;
  level: number;
  title: string;
  unit_from: string;
  unit_to: string | null;
  summary: string | null;
}

export interface Fragmento {
  n: number;
  id: string;
  unit: string;
  ord: number;
  text: string;
  context: string;
  section: string[] | null;
  anchor: Ancla;
  anchor_end: Ancla | null;
  search_text: string | null;
}

export interface Figura {
  id: string;
  unit: string;
  image: string;
  caption: string | null;
  description: string | null;
  anchor: Ancla;
}

export interface Espacio {
  id: string;
  provider: string;
  model: string;
  version: string | null;
  dims: number;
  dtype: 'f32' | 'f16' | 'i8';
  normalized: boolean | number;
  truncated_from: number | null;
  modalities: string[];
  task_prefixes: { query?: string; document?: string } | null;
  created: string | null;
}

export interface Procedencia {
  stage: string;
  provider: string | null;
  model: string | null;
  detail: string | null;
  ms: number | null;
  at: string;
}

export interface Extension { name: string; version: string; required: boolean | number }

export interface ErrorValidacion { code: string; message: string; where?: string }
export interface InformeValidacion {
  valid: boolean;
  version: string;
  profile: string[];
  errors: ErrorValidacion[];
  warnings: ErrorValidacion[];
}

/** Un acierto de búsqueda (§6), más lo que la interfaz necesita para pintarlo sin otra ida y vuelta. */
export interface Acierto {
  fragment_id: string;
  n: number;
  score: number;
  via: ('lexical' | 'vector')[];
  anchor: Ancla;
  anchor_uri: string;
  /** Añadidos por el núcleo del lector. */
  documento: string;      // id de la entrada de biblioteca
  texto: string;          // texto del fragmento
  contexto: string;
  unidad_ord: number;
  folio: string | null;
  cita: string;           // cita corta ya formateada
}

export type ModoBusqueda = 'lexica' | 'semantica' | 'hibrida';
export type Lengua = 'es' | 'en';

/** Lo que el lector sabe de un documento al abrirlo (una sola ida y vuelta). */
export interface Resumen {
  entrada: string;               // id de la biblioteca (sha256 del fichero)
  version: Version;
  legacy: boolean;
  meta: Record<string, string>;
  document: Documento;
  sections: Seccion[];
  spaces: Espacio[];
  figuras: number;
  fragmentos: number;
  extensions: Extension[];
  /** Ord → folio impreso, para el navegador de páginas sin cargar todas las unidades. */
  folios: (string | null)[];
  /** Hay medio reproducible (blob o URL) para audio o vídeo. */
  medio: { ref: string; mime: string } | null;
}
