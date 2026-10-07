import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { SpdfDocument } from 'spdf-format/core';
import { mozStorageEngine } from '../src/engine.js';
import { citationFor, parseQuery, resolveQuery, sameDocument, type Citation } from '../src/locate.js';
import { openDocument } from '../src/spdf.js';
import { EN, EN_SHA, ES, ES_SHA, LEGACY_40, LEGACY_41, nodeHost, tempDir } from './helpers/env.js';

const dir = tempDir();
const engine = mozStorageEngine(nodeHost(dir));
let en: SpdfDocument;
let es: SpdfDocument;

beforeAll(async () => {
  en = await openDocument(EN, engine);
  es = await openDocument(ES, engine);
});
afterAll(async () => {
  await en.close();
  await es.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Resolves `input` and returns the citation of the only match, or the failure. */
async function citeInput(doc: SpdfDocument, input: string, locale = 'en'): Promise<Citation | { fail: string; detail: string }> {
  const q = parseQuery(input);
  if (!q) return { fail: 'invalid', detail: input };
  const r = await resolveQuery(doc, q);
  if (!r.ok) return { fail: r.reason, detail: r.detail };
  expect(r.matches).toHaveLength(1);
  return citationFor(doc, r.matches[0]!, locale);
}

describe('parseQuery', () => {
  it('reads folios, physical pages and anchor URIs', () => {
    expect(parseQuery('145')).toEqual({ kind: 'printed', value: '145' });
    expect(parseQuery('  xiv ')).toEqual({ kind: 'printed', value: 'xiv' });
    expect(parseQuery('[21]')).toEqual({ kind: 'printed', value: '21' });
    expect(parseQuery('p. 145')).toEqual({ kind: 'printed', value: '145' });
    expect(parseQuery('pp. 3-4')).toEqual({ kind: 'printed', value: '3-4' });
    expect(parseQuery('pág. 12')).toEqual({ kind: 'printed', value: '12' });
    expect(parseQuery('fol. 1r')).toEqual({ kind: 'printed', value: '1r' });
    expect(parseQuery('f=A-3')).toEqual({ kind: 'printed', value: 'A-3' });
    expect(parseQuery('1r')).toEqual({ kind: 'printed', value: '1r' });
    expect(parseQuery('p=12')).toEqual({ kind: 'physical', from: 12, to: null });
    expect(parseQuery('#12')).toEqual({ kind: 'physical', from: 12, to: null });
    expect(parseQuery('p=2-3')).toEqual({ kind: 'physical', from: 2, to: 3 });
    expect(parseQuery(`spdf:sha256-${EN_SHA}#p=29&f=21`)).toMatchObject({ kind: 'uri', docref: `sha256-${EN_SHA}`, locator: { p: 29, f: '21' } });
  });

  it('rejects empty input, page 0, reversed ranges and malformed URIs', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery('   ')).toBeNull();
    expect(parseQuery('p=0')).toBeNull();
    expect(parseQuery('p=5-2')).toBeNull();
    expect(parseQuery('spdf:')).toBeNull();
    expect(parseQuery('[]')).toEqual({ kind: 'printed', value: '[]' });
  });
});

describe('citations from the English fixture', () => {
  const uri = (params: string) => `spdf:sha256-${EN_SHA}#${params}`;

  it('physical page 2 is printed folio 1', async () => {
    expect(await citeInput(en, 'p=2')).toEqual({ citation: '(Saorín Ferrer, 2026, p. 1)', uri: uri('p=2&f=1'), text: `(Saorín Ferrer, 2026, p. 1)\n${uri('p=2&f=1')}` });
    expect(await citeInput(en, '1')).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 1)', uri: uri('p=2&f=1') });
  });

  it('the plate carries an inferred folio, cited in brackets', async () => {
    for (const input of ['3', '[3]', 'p. 3', '#4', 'p=4', uri('p=4'), uri('f=3')]) {
      expect(await citeInput(en, input), input).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. [3])', uri: uri('p=4&f=3') });
    }
    expect(await citeInput(en, '3', 'es')).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. [3])' });
  });

  it('the cover has no folio: n. pag. in English, s. p. in Spanish', async () => {
    expect(await citeInput(en, 'p=1', 'en')).toEqual({ citation: '(Saorín Ferrer, 2026, n. pag.)', uri: uri('p=1'), text: `(Saorín Ferrer, 2026, n. pag.)\n${uri('p=1')}` });
    expect(await citeInput(en, 'p=1', 'es')).toMatchObject({ citation: '(Saorín Ferrer, 2026, s. p.)' });
    expect(await citeInput(en, 'p=1', 'es-ES')).toMatchObject({ citation: '(Saorín Ferrer, 2026, s. p.)' });
    expect(await citeInput(en, 'p=1', 'fr-FR')).toMatchObject({ citation: '(Saorín Ferrer, 2026, n. pag.)' });
  });

  it('ranges of folios and of physical pages', async () => {
    expect(await citeInput(en, '1-2')).toMatchObject({ citation: '(Saorín Ferrer, 2026, pp. 1-2)', uri: uri('p=2&pe=3&f=1&fe=2') });
    expect(await citeInput(en, 'pp. 2-[3]')).toMatchObject({ citation: '(Saorín Ferrer, 2026, pp. 2-[3])' });
    expect(await citeInput(en, 'p=3-4')).toMatchObject({ citation: '(Saorín Ferrer, 2026, pp. 2-[3])', uri: uri('p=3&pe=4&f=2&fe=3') });
    expect(await citeInput(en, uri('p=2&pe=3&f=1&fe=2'))).toMatchObject({ citation: '(Saorín Ferrer, 2026, pp. 1-2)' });
  });

  it('keeps the character range and region of an anchor URI', async () => {
    expect(await citeInput(en, uri('p=3&char=10,20&xywh=percent:10,20,30,40'))).toMatchObject({
      citation: '(Saorín Ferrer, 2026, p. 2)',
      uri: uri('p=3&f=2&char=10,20&xywh=percent:10,20,30,40'),
    });
  });

  it('a URI without parameters cites the whole document', async () => {
    expect(await citeInput(en, `spdf:sha256-${EN_SHA}`)).toEqual({ citation: '(Saorín Ferrer, 2026)', uri: `spdf:sha256-${EN_SHA}`, text: `(Saorín Ferrer, 2026)\nspdf:sha256-${EN_SHA}` });
  });

  it('roman-looking and case variants match case-insensitively only as a fallback', async () => {
    expect(await citeInput(en, 'P. 2')).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 2)' });
  });

  it('never invents a folio or a page', async () => {
    expect(await citeInput(en, '6')).toEqual({ fail: 'not-found', detail: '6' });
    expect(await citeInput(en, 'xiv')).toEqual({ fail: 'not-found', detail: 'xiv' });
    expect(await citeInput(en, 'p=7')).toEqual({ fail: 'not-found', detail: '7' });
    expect(await citeInput(en, '4-9')).toEqual({ fail: 'not-found', detail: '9' });
    expect(await citeInput(en, uri('p=29&f=21'))).toEqual({ fail: 'not-found', detail: '29' });
    expect(await citeInput(en, uri('sl=3'))).toEqual({ fail: 'not-found', detail: 'locator' });
  });

  it('refuses an anchor URI of another document', async () => {
    expect(await citeInput(en, `spdf:sha256-${ES_SHA}#p=2`)).toEqual({ fail: 'other-document', detail: `sha256-${ES_SHA}` });
    expect(sameDocument(en, `sha256-${EN_SHA.toUpperCase()}`)).toBe(true);
    expect(sameDocument(en, en.document.id)).toBe(true);
    expect(sameDocument(en, 'something-else')).toBe(false);
  });
});

describe('citations from the Spanish fixture', () => {
  it('cites in Spanish with the same folios', async () => {
    expect(await citeInput(es, 'p=2', 'es')).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 1)', uri: `spdf:sha256-${ES_SHA}#p=2&f=1` });
    expect(await citeInput(es, '[3]', 'es')).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. [3])' });
    expect(await citeInput(es, 'p=1', 'es')).toMatchObject({ citation: '(Saorín Ferrer, 2026, s. p.)' });
  });
});

describe('legacy 4.x files', () => {
  it('roman folios (4.1, gzip-wrapped)', async () => {
    const doc = await openDocument(LEGACY_41, engine);
    try {
      expect(await citeInput(doc, 'ix', 'es')).toMatchObject({ citation: '(Garcilaso de la Vega, 1580, p. ix)' });
      expect(await citeInput(doc, 'IX', 'es')).toMatchObject({ citation: '(Garcilaso de la Vega, 1580, p. ix)' });
      expect(await citeInput(doc, 'x', 'es')).toMatchObject({ citation: '(Garcilaso de la Vega, 1580, p. [x])' });
      expect(await citeInput(doc, 'p=1', 'es')).toMatchObject({ citation: '(Garcilaso de la Vega, 1580, s. p.)' });
    } finally {
      await doc.close();
    }
  });

  it('time anchors (4.0 recording)', async () => {
    const doc = await openDocument(LEGACY_40, engine);
    try {
      const ref = doc.docref;
      expect(await citeInput(doc, `spdf:${ref}#t=12`, 'en')).toMatchObject({ citation: '(Kennedy, 1962, 0:12)', uri: expect.stringMatching(new RegExp(`^spdf:${ref}#t=12(,12)?$`)) });
      expect(await citeInput(doc, `spdf:${ref}#t=0,9.5`, 'en')).toMatchObject({ citation: '(Kennedy, 1962, 0:00)' });
      expect(await citeInput(doc, '1')).toEqual({ fail: 'not-found', detail: '1' });
    } finally {
      await doc.close();
    }
  });
});
