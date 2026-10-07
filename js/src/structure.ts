/**
 * Structural exports (SPEC §19.4): ALTO 4, a minimal TEI and a IIIF Presentation 3
 * manifest. They never invent data: no coordinates unless the file has them, no folio for
 * an unnumbered page, and inferred folios in brackets (and absent from ALTO, which only
 * records printed numbers).
 */

import type { Anchor, CslItem, Unit } from './types.js';
import type { SpdfDocument } from './document.js';
import { anchorToLocator } from './anchors.js';
import { roundTo, shortNumber } from './canonical.js';

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type PageAnchor = Extract<Anchor, { type: 'page' }>;
const isPage = (a: Anchor): a is PageAnchor => !!a && (a as { type?: string }).type === 'page';

/** The folio as cited in §18 without its label: `ii`, `[iv]`, `1r`; null when unnumbered. */
export function folioN(a: PageAnchor): string | null {
  if (a.printed === null || a.printed === undefined) return null;
  return a.source === 'inferred' ? `[${a.printed}]` : a.printed;
}

function paragraphs(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length);
}

/** ALTO 4: one `Page` per page unit, one `TextBlock` per paragraph, one `TextLine` per line. */
export async function toAlto(doc: SpdfDocument): Promise<string> {
  const units = (await doc.units()).filter((u) => isPage(u.anchor));
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.loc.gov/standards/alto/ns-v4# http://www.loc.gov/standards/alto/v4/alto-4-4.xsd" SCHEMAVERSION="4.4">');
  out.push('  <Description>');
  out.push('    <MeasurementUnit>pixel</MeasurementUnit>');
  out.push(`    <sourceImageInformation><fileName>${xml(doc.document.id)}</fileName></sourceImageInformation>`);
  out.push('  </Description>');
  out.push('  <Layout>');
  units.forEach((u, i) => {
    const a = u.anchor as PageAnchor;
    const printed = a.printed !== null && a.printed !== undefined && a.source !== 'inferred' ? ` PRINTED_IMG_NR="${xml(a.printed)}"` : '';
    out.push(`    <Page ID="P${i + 1}" PHYSICAL_IMG_NR="${a.physical}"${printed}>`);
    out.push(`      <PrintSpace ID="P${i + 1}_PS">`);
    paragraphs(u.text).forEach((lines, b) => {
      out.push(`        <TextBlock ID="P${i + 1}_B${b + 1}">`);
      lines.forEach((line, l) => out.push(`          <TextLine ID="P${i + 1}_B${b + 1}_L${l + 1}"><String CONTENT="${xml(line)}"/></TextLine>`));
      out.push('        </TextBlock>');
    });
    out.push('      </PrintSpace>');
    out.push('    </Page>');
  });
  out.push('  </Layout>');
  out.push('</alto>');
  return `${out.join('\n')}\n`;
}

function names(list: CslItem['author']): string[] {
  return (list ?? []).map((n) => n.literal ?? [n.given, n['non-dropping-particle'], n.family].filter(Boolean).join(' ')).filter(Boolean);
}

/** A minimal TEI: header from the metadata, `<pb n facs>` before each page, paragraphs, verse, turns and notes. */
export async function toTei(doc: SpdfDocument): Promise<string> {
  const d = doc.document;
  const m = d.metadata;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<TEI xmlns="http://www.tei-c.org/ns/1.0"${d.language ? ` xml:lang="${xml(d.language)}"` : ''}>`);
  out.push('  <teiHeader>');
  out.push('    <fileDesc>');
  out.push('      <titleStmt>');
  out.push(`        <title>${xml(String(m.title ?? ''))}</title>`);
  for (const a of names(m.author)) out.push(`        <author>${xml(a)}</author>`);
  for (const e of names(m.editor)) out.push(`        <editor>${xml(e)}</editor>`);
  out.push('      </titleStmt>');
  out.push('      <publicationStmt>');
  const r = d.rights;
  if (r && (r.license || r.note || r.holder)) {
    out.push('        <availability>');
    if (r.license) out.push(`          <licence target="${xml(String(r.license))}"/>`);
    if (r.holder) out.push(`          <p>${xml(String(r.holder))}</p>`);
    if (r.note) out.push(`          <p>${xml(String(r.note))}</p>`);
    out.push('        </availability>');
  } else out.push('        <p>Unknown</p>');
  out.push('      </publicationStmt>');
  out.push('      <sourceDesc>');
  out.push('        <biblStruct>');
  out.push('          <monogr>');
  for (const a of names(m.author)) out.push(`            <author>${xml(a)}</author>`);
  out.push(`            <title>${xml(String(m.title ?? ''))}</title>`);
  const imprint: string[] = [];
  if (m['publisher-place']) imprint.push(`<pubPlace>${xml(String(m['publisher-place']))}</pubPlace>`);
  if (m.publisher) imprint.push(`<publisher>${xml(String(m.publisher))}</publisher>`);
  const year = m.issued?.['date-parts']?.[0]?.[0];
  if (year !== undefined) imprint.push(`<date when="${xml(String(year))}">${xml(String(year))}</date>`);
  out.push(`            <imprint>${imprint.join('')}</imprint>`);
  out.push('          </monogr>');
  out.push('        </biblStruct>');
  out.push('      </sourceDesc>');
  out.push('    </fileDesc>');
  out.push('  </teiHeader>');
  out.push('  <text>');
  out.push('    <body>');
  for (const u of await doc.units()) {
    const a = u.anchor as Anchor & Record<string, unknown>;
    if (isPage(a)) {
      const n = folioN(a);
      out.push(`      <pb${n !== null ? ` n="${xml(n)}"` : ''}${u.image ? ` facs="${xml(u.image)}"` : ''}/>`);
    }
    out.push(...teiBlocks(u, a));
    for (const note of u.notes ?? []) out.push(`      <note place="foot">${xml(note)}</note>`);
  }
  out.push('    </body>');
  out.push('  </text>');
  out.push('</TEI>');
  return `${out.join('\n')}\n`;
}

function teiBlocks(u: Unit, a: Anchor & Record<string, unknown>): string[] {
  const out: string[] = [];
  if (a.type === 'verse') {
    const lines = u.text.split('\n').filter((l) => l.trim());
    const from = typeof a.line_from === 'number' ? a.line_from : 1;
    out.push('      <lg>');
    lines.forEach((l, i) => out.push(`        <l n="${from + i}">${xml(l.trim())}</l>`));
    out.push('      </lg>');
    return out;
  }
  for (const lines of paragraphs(u.text)) {
    const text = lines.join(' ');
    const turn = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(text);
    if (turn) out.push(`      <u who="${xml(turn[1] as string)}">${xml(turn[2] as string)}</u>`);
    else if (a.type === 'time' && typeof a.speaker === 'string') out.push(`      <u who="${xml(a.speaker)}">${xml(text)}</u>`);
    else out.push(`      <p>${xml(text)}</p>`);
  }
  return out;
}

export interface IiifOptions {
  /** Base URL for ids (default: `spdf:<docref>`). */
  base?: string;
  /** Turns a unit image reference (`blob:…` or URL) into a URL; default: the reference itself. */
  imageUrl?: (ref: string) => string;
}

/** IIIF Presentation 3: one canvas per unit (in `ord` order), time-based for audio and video. */
export async function toIiif(doc: SpdfDocument, options: IiifOptions = {}): Promise<Record<string, unknown>> {
  const d = doc.document;
  const base = options.base ?? `spdf:${doc.docref}`;
  const img = options.imageUrl ?? ((r: string) => r);
  const units = await doc.units();
  const timed = units.every((u) => (u.anchor as { type?: string }).type === 'time') && units.length > 0;
  const lang = d.language ?? 'none';
  const manifest: Record<string, unknown> = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: `${base}/manifest`,
    type: 'Manifest',
    label: { [lang]: [String(d.metadata.title ?? d.id)] },
  };
  if (timed) {
    const last = units[units.length - 1]?.anchor as { t1?: number } | undefined;
    const duration = d.duration ?? last?.t1 ?? 0;
    const canvas = `${base}/canvas/1`;
    manifest.items = [
      {
        id: canvas,
        type: 'Canvas',
        duration,
        items: [{ id: `${canvas}/page`, type: 'AnnotationPage', items: d.source_ref ? [{ id: `${canvas}/media`, type: 'Annotation', motivation: 'painting', target: canvas, body: { id: img(d.source_ref), type: d.kind === 'video' ? 'Video' : 'Sound', format: d.mime } }] : [] }],
        annotations: [
          {
            id: `${canvas}/text`,
            type: 'AnnotationPage',
            items: units.map((u, i) => {
              const a = u.anchor as { t0: number; t1: number };
              return { id: `${canvas}/text/${i + 1}`, type: 'Annotation', motivation: 'supplementing', body: { type: 'TextualBody', value: u.text, format: 'text/plain' }, target: `${canvas}#t=${shortNumber(roundTo(a.t0, 6))},${shortNumber(roundTo(a.t1, 6))}` };
            }),
          },
        ],
      },
    ];
    manifest.structures = units.map((u, i) => {
      const a = u.anchor as { t0: number; t1: number };
      return { id: `${base}/range/${i + 1}`, type: 'Range', items: [{ id: `${canvas}#t=${shortNumber(roundTo(a.t0, 6))},${shortNumber(roundTo(a.t1, 6))}`, type: 'Canvas' }] };
    });
    return manifest;
  }
  manifest.items = units.map((u, i) => {
    const canvas = `${base}/canvas/${i + 1}`;
    const c: Record<string, unknown> = { id: canvas, type: 'Canvas' };
    if (isPage(u.anchor)) {
      const n = folioN(u.anchor);
      if (n !== null) c.label = { none: [n] };
    } else {
      const loc = anchorToLocator(u.anchor);
      c.label = { none: [loc.sl !== undefined ? String(loc.sl) : String(u.ord)] };
    }
    if (u.image) {
      c.items = [{ id: `${canvas}/page`, type: 'AnnotationPage', items: [{ id: `${canvas}/image`, type: 'Annotation', motivation: 'painting', target: canvas, body: { id: img(u.image), type: 'Image' } }] }];
    } else c.items = [];
    if (u.text) {
      c.annotations = [{ id: `${canvas}/text`, type: 'AnnotationPage', items: [{ id: `${canvas}/text/1`, type: 'Annotation', motivation: 'supplementing', body: { type: 'TextualBody', value: u.text, format: 'text/plain' }, target: canvas }] }];
    }
    return c;
  });
  const sections = await doc.sections();
  if (sections.length) {
    const index = new Map(units.map((u, i) => [u.id, i + 1]));
    manifest.structures = sections.map((s) => {
      const from = index.get(s.unit_from) ?? 1;
      const to = s.unit_to ? (index.get(s.unit_to) ?? from) : from;
      const items = [];
      for (let k = from; k <= to; k++) items.push({ id: `${base}/canvas/${k}`, type: 'Canvas' });
      return { id: `${base}/range/${s.id}`, type: 'Range', label: { none: [s.title] }, items };
    });
  }
  return manifest;
}

/** The page sequence the conformance suite compares (SPEC §19.4). */
export async function pageSequence(doc: SpdfDocument, format: 'alto' | 'tei' | 'iiif'): Promise<Array<Record<string, unknown>>> {
  const units = (await doc.units()).filter((u) => isPage(u.anchor));
  if (format === 'alto') {
    const alto = await toAlto(doc);
    return [...alto.matchAll(/<Page ID="[^"]*" PHYSICAL_IMG_NR="(\d+)"(?: PRINTED_IMG_NR="([^"]*)")?/g)].map((m) => ({ physical: Number(m[1]), printed: m[2] !== undefined ? unxml(m[2]) : null }));
  }
  if (format === 'tei') {
    const tei = await toTei(doc);
    return [...tei.matchAll(/<pb(?: n="([^"]*)")?[^>]*\/>/g)].map((m) => ({ n: m[1] !== undefined ? unxml(m[1]) : null }));
  }
  const manifest = await toIiif(doc);
  const pageIds = new Set(units.map((u) => u.id));
  const all = await doc.units();
  return (manifest.items as Array<{ label?: { none?: string[] } }>)
    .filter((_, i) => pageIds.has((all[i] as Unit).id))
    .map((c) => ({ label: c.label?.none?.[0] ?? null }));
}

function unxml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
