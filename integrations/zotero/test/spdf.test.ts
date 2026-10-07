import { describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { mozStorageEngine } from '../src/engine.js';
import { cslForZotero, describeError, openDocument, spdfExtraLine, withSpdfLine } from '../src/spdf.js';
import { structuredCloneFallback } from '../src/shims/structured-clone.js';
import { EN, EN_SHA, ES, nodeHost, tempDir } from './helpers/env.js';

describe('CSL-JSON for Zotero', () => {
  it('is the metadata without the spdf extension, with the BibTeX key as id', async () => {
    const dir = tempDir();
    const engine = mozStorageEngine(nodeHost(dir));
    for (const [path, title, lang] of [
      [EN, 'SPDF in five pages', 'en'],
      [ES, 'SPDF en cinco páginas', 'es'],
    ] as const) {
      const doc = await openDocument(path, engine);
      try {
        const csl = cslForZotero(doc);
        expect(csl).toMatchObject({ id: 'saorinferrer2026', type: 'pamphlet', title, language: lang, author: [{ family: 'Saorín Ferrer', given: 'José Luis' }], issued: { 'date-parts': [[2026]] } });
        expect(csl).not.toHaveProperty('spdf');
        expect(doc.document.metadata).toHaveProperty('spdf'); // the document itself is untouched
      } finally {
        await doc.close();
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the SPDF line in Extra', () => {
  const ref = `sha256-${EN_SHA}`;
  it('is added once, after what is already there', () => {
    expect(spdfExtraLine(ref)).toBe(`SPDF: ${ref}`);
    expect(withSpdfLine('', ref)).toBe(`SPDF: ${ref}`);
    expect(withSpdfLine(null, ref)).toBe(`SPDF: ${ref}`);
    expect(withSpdfLine('original-date: 1543\n', ref)).toBe(`original-date: 1543\nSPDF: ${ref}`);
    expect(withSpdfLine(`a\nSPDF: ${ref}`, ref)).toBe(`a\nSPDF: ${ref}`);
    expect(withSpdfLine(`SPDF: sha256-${'0'.repeat(64)}`, ref)).toBe(`SPDF: sha256-${'0'.repeat(64)}\nSPDF: ${ref}`);
  });

  it('errors are described by their message (which carries the SPDF code)', () => {
    expect(describeError(new Error('E020: the file contains view v'))).toBe('E020: the file contains view v');
    expect(describeError('plain')).toBe('plain');
  });
});

describe('structuredClone fallback (Zotero plugin sandbox)', () => {
  it('copies JSON metadata exactly and deeply', () => {
    const csl = { type: 'book', author: [{ family: 'Saorín Ferrer', given: 'José Luis' }], issued: { 'date-parts': [[2026, 10, 7]] }, spdf: { undated: { from: -400, to: -350 } } };
    const copy = structuredCloneFallback(csl);
    expect(copy).toEqual(csl);
    expect(copy).not.toBe(csl);
    expect(copy.author[0]).not.toBe(csl.author[0]);
    expect(structuredCloneFallback(undefined)).toBeUndefined();
  });
});
