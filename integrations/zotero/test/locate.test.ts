import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { SpdfDocument } from 'spdf-format/core';
import { mozStorageEngine } from '../src/engine.js';
import { citationFor, parseQuery, resolveQuery, sameDocument, type Citation } from '../src/locate.js';
import { openDocument } from '../src/spdf.js';
import { formatTime } from 'spdf-format/core';
import { EN, EN_SHA, ES, ES_SHA, legacyWith, nodeHost, reference, tempDir } from './helpers/env.js';

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

/**
 * Legacy 4.x files: the conformance corpus is rebuilt from time to time, so the files
 * are found by the kind of anchor they hold and the expectations come from the
 * official Node engine of spdf-format, plus the rules of SPEC §18 that make a
 * citation honest (an inferred folio in brackets, a page without folio unnumbered).
 */
describe('legacy 4.x files (whatever the conformance corpus holds)', () => {
  type PageAnchor = { type: string; physical: number; printed?: string | null; source?: string };

  it('page units: every folio and physical page cites as the reference does', async () => {
    const path = await legacyWith('page', (a) => typeof a.printed === 'string');
    const doc = await openDocument(path, engine);
    const ref = await reference(path);
    try {
      let checked = 0;
      for (const u of await ref.units()) {
        const a = u.anchor as unknown as PageAnchor;
        if (a.type !== 'page') continue;
        for (const locale of ['es', 'en']) {
          const expected = { citation: ref.cite(u.anchor, locale), uri: ref.anchorUri(u.anchor) };
          const honest = a.printed ? (a.source === 'inferred' ? `p. [${a.printed}])` : `p. ${a.printed})`) : locale === 'es' ? 's. p.)' : 'n. pag.)';
          expect(expected.citation.endsWith(honest), `${expected.citation} ends with ${honest}`).toBe(true);
          expect(await citeInput(doc, `p=${a.physical}`, locale)).toMatchObject(expected);
          expect(await citeInput(doc, expected.uri, locale)).toMatchObject(expected);
          if (a.printed) {
            expect(await citeInput(doc, a.printed, locale)).toMatchObject(expected);
            expect(await citeInput(doc, `[${a.printed}]`, locale)).toMatchObject(expected);
            expect(await citeInput(doc, `p. ${a.printed.toUpperCase()}`, locale)).toMatchObject(expected);
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(await citeInput(doc, 'no-such-folio')).toEqual({ fail: 'not-found', detail: 'no-such-folio' });
      expect(await citeInput(doc, 'p=99999')).toEqual({ fail: 'not-found', detail: '99999' });
    } finally {
      await doc.close();
      await ref.close();
    }
  });

  it('time units: a second inside a unit cites that second', async () => {
    const path = await legacyWith('time');
    const doc = await openDocument(path, engine);
    const ref = await reference(path);
    try {
      const timed = (await ref.units()).filter((u) => (u.anchor as { type: string }).type === 'time');
      for (const u of timed) {
        const a = u.anchor as unknown as { t0: number; t1: number };
        const t = Math.floor((a.t0 + a.t1) / 2);
        const uri = `spdf:${ref.docref}#t=${t}`;
        const expected = ref.cite({ ...(u.anchor as object), t0: t, t1: t } as never, 'en');
        // h:mm:ss from one hour on, m:ss below, seconds floored (SPEC §18)
        expect(expected.endsWith(`, ${formatTime(t)})`)).toBe(true);
        expect(await citeInput(doc, uri, 'en')).toMatchObject({ citation: expected, uri: expect.stringMatching(new RegExp(`^spdf:${ref.docref}#t=${t}(,${t})?$`)) });
      }
      const first = timed[0]!.anchor as unknown as { t0: number };
      if (first.t0 >= 1) expect(await citeInput(doc, `spdf:${ref.docref}#t=${first.t0 - 1}`)).toEqual({ fail: 'not-found', detail: `t=${first.t0 - 1}` });
    } finally {
      await doc.close();
      await ref.close();
    }
  });

  it('section units: anchor URIs with a heading path or a paragraph', async () => {
    const path = await legacyWith('section');
    const doc = await openDocument(path, engine);
    const ref = await reference(path);
    try {
      let checked = 0;
      for (const u of await ref.units()) {
        if ((u.anchor as { type: string }).type !== 'section') continue;
        const uri = ref.anchorUri(u.anchor);
        for (const locale of ['es', 'en']) {
          expect(await citeInput(doc, uri, locale)).toMatchObject({ citation: ref.cite(u.anchor, locale), uri });
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(await citeInput(doc, `spdf:${ref.docref}#para=99999`)).toEqual({ fail: 'not-found', detail: 'locator' });
    } finally {
      await doc.close();
      await ref.close();
    }
  });
});
