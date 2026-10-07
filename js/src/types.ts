/** The SPDF 5.0 data model (contract §2–§4), with the same names as the schema. */

export type Region = { x: number; y: number; w: number; h: number };

interface AnchorCommon {
  /** Fractions 0–1 of the unit image. */
  region?: Region;
  /** Code points `[start, end)` in the NFC `units.text`. */
  chars?: [number, number];
}

export interface PageAnchor extends AnchorCommon {
  type: 'page';
  physical: number;
  printed: string | null;
  roman?: boolean;
  foliation?: 'page' | 'leaf' | 'column';
  source?: 'read' | 'inferred' | 'epub' | 'none';
  confidence?: number;
}
export interface TimeAnchor extends AnchorCommon {
  type: 'time';
  t0: number;
  t1: number;
  speaker?: string;
}
export interface SectionAnchor extends AnchorCommon {
  type: 'section';
  path: string[];
  paragraph?: number;
  printed?: string | null;
}
export interface SlideAnchor extends AnchorCommon {
  type: 'slide';
  n: number;
}
export interface SheetAnchor extends AnchorCommon {
  type: 'sheet';
  sheet: string;
  row_from: number;
  row_to: number;
}
export interface WebAnchor extends AnchorCommon {
  type: 'web';
  url: string;
  path?: string[];
  paragraph?: number;
  accessed?: string;
}
export interface ImageAnchor extends AnchorCommon {
  type: 'image';
}
export interface VerseAnchor extends AnchorCommon {
  type: 'verse';
  line_from: number;
  line_to?: number;
  printed?: string | null;
}
export interface CanonicalAnchor extends AnchorCommon {
  type: 'canonical';
  scheme: string;
  ref: string;
}

export type Anchor =
  | PageAnchor
  | TimeAnchor
  | SectionAnchor
  | SlideAnchor
  | SheetAnchor
  | WebAnchor
  | ImageAnchor
  | VerseAnchor
  | CanonicalAnchor;

export const ANCHOR_TYPES = ['page', 'time', 'section', 'slide', 'sheet', 'web', 'image', 'verse', 'canonical'] as const;
export type AnchorType = Anchor['type'];

// ---------------------------------------------------------------------------
// CSL-JSON
// ---------------------------------------------------------------------------

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  'dropping-particle'?: string;
  'non-dropping-particle'?: string;
  suffix?: string;
}

export interface CslDate {
  'date-parts'?: Array<Array<number | string>>;
  literal?: string;
  raw?: string;
  circa?: boolean | string | number;
  season?: string | number;
}

/** The `spdf` extension object inside the metadata (contract §4). */
export interface SpdfMetadataExtension {
  provenance?: Record<string, { source: string; confidence: number }>;
  undated?: { from?: number; to?: number; basis: string };
  original_language?: string;
  orcid?: Record<string, string>;
  subtitle?: string;
  [key: string]: unknown;
}

/** A CSL-JSON item plus the `spdf` extension. */
export interface CslItem {
  type: string;
  title: string;
  id?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  interviewer?: CslName[];
  issued?: CslDate;
  'original-date'?: CslDate;
  'original-title'?: string;
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
  spdf?: SpdfMetadataExtension;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Rows (5.0 view)
// ---------------------------------------------------------------------------

export type Kind = 'pdf' | 'scanned_pdf' | 'photos' | 'image' | 'audio' | 'video' | 'document' | 'epub' | 'slides' | 'sheet' | 'web';

export interface Rights {
  license?: string;
  access?: string;
  holder?: string;
  note?: string;
  [key: string]: unknown;
}

export interface DocumentRecord {
  id: string;
  kind: Kind | string;
  metadata: CslItem;
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
  rights: Rights | null;
}

/** Word timings: `cs` alternates start and duration in centiseconds from `t0`. */
export interface WordTimings {
  v: 1;
  t0: number;
  cs: number[];
}

export interface Unit {
  id: string;
  document: string;
  ord: number;
  anchor: Anchor;
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
  words: WordTimings | null;
}

export interface Section {
  id: string;
  document: string;
  parent: string | null;
  level: number;
  title: string;
  unit_from: string;
  unit_to: string | null;
  summary: string | null;
}

export interface Fragment {
  n: number;
  id: string;
  document: string;
  unit: string;
  ord: number;
  text: string;
  context: string;
  section: string[] | null;
  anchor: Anchor;
  anchor_end: Anchor | null;
  search_text: string | null;
}

export interface Figure {
  id: string;
  document: string;
  unit: string;
  image: string;
  caption: string | null;
  description: string | null;
  anchor: Anchor;
}

export type Dtype = 'f32' | 'f16' | 'i8';
export type VectorTarget = 'fragment' | 'unit' | 'figure';

export interface Space {
  id: string;
  provider: string;
  model: string;
  version: string | null;
  dims: number;
  dtype: Dtype;
  normalized: boolean;
  truncated_from: number | null;
  modalities: string[];
  task_prefixes: { query?: string; document?: string; [k: string]: unknown } | null;
  created: string | null;
}

export interface VectorRecord {
  target: VectorTarget;
  id: string;
  space: string;
  document: string;
  vector: Float32Array;
}

export interface BlobInfo {
  key: string;
  mime: string;
  bytes: number;
  sha256: string;
}

export interface BlobRecord {
  key: string;
  mime: string;
  sha256: string;
  data: Uint8Array;
}

export interface ProvenanceRecord {
  document: string;
  stage: string;
  provider: string | null;
  model: string | null;
  detail: unknown;
  ms: number | null;
  at: string;
}

export interface ExtensionRecord {
  name: string;
  version: string;
  required: boolean;
}

export type Locale = 'es' | 'en';
