/**
 * The three commands against a fake Zotero, with the real fixtures and the engine
 * adapter over the fake `Sqlite.sys.mjs`.
 */

import { MEDIA_TYPE, toCslJson } from 'spdf-format/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { attachSpdf, canAttach, canCite, copyCitationWithFolio, importSpdfAsItem, isSpdfAttachment, type CommandEnv } from '../src/commands.js';
import { mozStorageEngine } from '../src/engine.js';
import { EN, EN_SHA, ES, ES_SHA, LEGACY_FILES, ROTO, legacyRawMetadata, nodeHost, reference, tempDir, translator } from './helpers/env.js';
import { fakeUi, fakeZotero, type UiScript } from './helpers/fake-zotero.js';

const dir = tempDir();
const host = nodeHost(dir);
const engine = mozStorageEngine(host);

/** A copy of the English fixture with one change made through SQL. */
function variant(name: string, sql: string): string {
  const p = join(dir, name);
  copyFileSync(EN, p);
  const db = new DatabaseSync(p);
  db.exec(sql);
  db.close();
  return p;
}

let NO_TYPE: string;
let TWO_ONES: string;

beforeAll(() => {
  // Non-conforming metadata (E051): no CSL type.
  NO_TYPE = variant('no-type.spdf', `UPDATE documents SET metadata = json_remove(metadata, '$.type')`);
  // Two pages printed "1" (as when roman front matter restarts the count).
  TWO_ONES = variant('two-ones.spdf', `UPDATE units SET printed = '1', anchor = json_set(anchor, '$.printed', '1', '$.source', 'read') WHERE ord = 3`);
});

afterAll(() => {
  expect(host.fake.openCount()).toBe(0); // every command closes what it opens
  rmSync(dir, { recursive: true, force: true });
});

function setup(script: UiScript = {}, zotero: Parameters<typeof fakeZotero>[0] = {}, locale: 'en-US' | 'es-ES' = 'en-US') {
  const z = fakeZotero({ locale, ...zotero });
  const u = fakeUi(script);
  const env: CommandEnv = { Zotero: z.Z, ui: u.ui, t: translator(locale), engine, locale: z.Z.locale };
  return { ...z, env, ui: u.log };
}

describe('Import SPDF as item…', () => {
  it('creates the item from the CSL-JSON metadata and attaches the file', async () => {
    const s = setup({ pickFile: EN }, { libraryID: 7, collection: { id: 3 } });
    const item = await importSpdfAsItem(s.env);
    expect(item).not.toBeNull();
    expect(s.log.csl).toEqual([
      {
        id: 'saorinferrer2026',
        type: 'pamphlet',
        title: 'SPDF in five pages',
        author: [{ family: 'Saorín Ferrer', given: 'José Luis' }],
        issued: { 'date-parts': [[2026]] },
        publisher: 'spdf.joseluissaorin.com',
        URL: 'https://spdf.joseluissaorin.com/validator',
        language: 'en',
      },
    ]);
    expect(item!.libraryID).toBe(7);
    expect((item as unknown as { collections: number[] }).collections).toEqual([3]);
    expect(item!.getField('title')).toBe('SPDF in five pages');
    expect(item!.getField('extra')).toBe(`SPDF: sha256-${EN_SHA}`);
    expect(s.log.imports).toEqual([{ file: EN, parentItemID: item!.id, contentType: MEDIA_TYPE }]);
    expect(s.log.selected).toEqual([item!.id]);
    expect(s.ui.alerts).toEqual([]);
    expect(s.ui.notices).toEqual([['SPDF imported', 'SPDF in five pages']]);
    // and the new item can be cited at once
    s.pane.selected = [item!];
    const u = fakeUi({ prompts: ['[3]'] });
    const c = await copyCitationWithFolio({ ...s.env, ui: u.ui });
    expect(c?.text).toBe(`(Saorín Ferrer, 2026, p. [3])\nspdf:sha256-${EN_SHA}#p=4&f=3`);
  });

  it('maps legacy 4.x metadata (gzip-wrapped, Spanish names) to CSL-JSON', async () => {
    for (const path of LEGACY_FILES) {
      const ref = await reference(path);
      const expected = toCslJson(ref.document);
      const docref = ref.docref;
      await ref.close();
      const raw = legacyRawMetadata(path); // what the file really says, in Spanish
      expect(typeof raw.titulo).toBe('string');

      const s = setup({ pickFile: path });
      const item = await importSpdfAsItem(s.env);
      expect(item, path).not.toBeNull();
      const csl = s.log.csl[0] as Record<string, unknown>;
      expect(csl).toEqual(expected);
      expect(csl).not.toHaveProperty('spdf');
      expect(String(csl.title)).toContain(String(raw.titulo));
      expect(typeof csl.type).toBe('string');
      if (Array.isArray(raw.autores) && raw.autores.length) expect((csl.author as unknown[]).length).toBe(raw.autores.length);
      expect(item!.getField('extra')).toBe(`SPDF: ${docref}`);
      expect(s.log.imports[0]).toMatchObject({ file: path, contentType: MEDIA_TYPE });
    }
  });

  it('refuses a file a reader must refuse, and says why', async () => {
    const s = setup({ pickFile: ROTO });
    expect(await importSpdfAsItem(s.env)).toBeNull();
    expect(s.ui.alerts).toHaveLength(1);
    expect(s.ui.alerts[0]).toMatch(/^This file cannot be read as SPDF\. E020: /);
    expect(s.log.csl).toEqual([]);
    expect(s.log.imports).toEqual([]);
  });

  it('imports metadata without a CSL type as a generic document, inventing nothing else', async () => {
    const s = setup({ pickFile: NO_TYPE });
    expect(await importSpdfAsItem(s.env)).not.toBeNull();
    expect(s.log.csl[0]).toMatchObject({ type: 'document', title: 'SPDF in five pages' });
    expect(Object.keys(s.log.csl[0] as object).sort()).toEqual(['URL', 'author', 'id', 'issued', 'language', 'publisher', 'title', 'type']);
  });

  it('does nothing in a read-only library, or when the picker is cancelled', async () => {
    const ro = setup({ pickFile: EN }, { canEdit: false });
    expect(await importSpdfAsItem(ro.env)).toBeNull();
    expect(ro.ui.picks).toEqual([]);
    expect(ro.ui.alerts).toEqual(['The selected library cannot be edited.']);
    const cancel = setup({ pickFile: null });
    expect(await importSpdfAsItem(cancel.env)).toBeNull();
    expect(cancel.ui.alerts).toEqual([]);
    expect(cancel.log.saved).toEqual([]);
  });
});

describe('Attach SPDF…', () => {
  it('attaches the file to the selected item and records the hash in Extra', async () => {
    const s = setup({ pickFile: ES });
    const parent = await s.addItem({ title: 'SPDF en cinco páginas', extra: 'tex.ids: x' });
    s.pane.selected = [parent];
    const att = await attachSpdf(s.env);
    expect(att).not.toBeNull();
    expect(s.log.imports).toEqual([{ file: ES, parentItemID: parent.id, contentType: MEDIA_TYPE }]);
    expect(parent.getField('extra')).toBe(`tex.ids: x\nSPDF: sha256-${ES_SHA}`);
    // attaching the same document again does not repeat the line
    await attachSpdf(s.env);
    expect(parent.getField('extra')).toBe(`tex.ids: x\nSPDF: sha256-${ES_SHA}`);
    expect(s.ui.notices[0]).toEqual(['SPDF attached', 'SPDF en cinco páginas']);
  });

  it('needs exactly one regular item', async () => {
    const s = setup({ pickFile: EN });
    const a = await s.addItem();
    const b = await s.addItem();
    s.pane.selected = [a, b];
    expect(await attachSpdf(s.env)).toBeNull();
    s.pane.selected = [await s.addAttachment(a, EN)];
    expect(await attachSpdf(s.env)).toBeNull();
    expect(s.ui.alerts).toEqual(['Select a single item first.', 'Select a single item first.']);
    expect(s.ui.picks).toEqual([]);
  });
});

describe('Copy citation with folio…', () => {
  async function withAttachment(script: UiScript, locale: 'en-US' | 'es-ES' = 'en-US', path: string = EN) {
    const s = setup(script, {}, locale);
    const parent = await s.addItem({ title: 'SPDF in five pages' });
    const att = await s.addAttachment(parent, path);
    s.pane.selected = [parent];
    return { ...s, parent, att };
  }

  it('copies the citation and, on the next line, the anchor URI', async () => {
    const s = await withAttachment({ prompts: ['3'] });
    const c = await copyCitationWithFolio(s.env);
    expect(c).toEqual({
      citation: '(Saorín Ferrer, 2026, p. [3])',
      uri: `spdf:sha256-${EN_SHA}#p=4&f=3`,
      text: `(Saorín Ferrer, 2026, p. [3])\nspdf:sha256-${EN_SHA}#p=4&f=3`,
    });
    expect(s.log.clipboard).toEqual([c!.text]);
    expect(s.ui.prompts[0]).toMatch(/^Printed folio \(145, xiv, \[21\]\), physical page \(p=12\) or anchor URI/);
    expect(s.ui.notices).toEqual([['Citation copied', '(Saorín Ferrer, 2026, p. [3])']]);
  });

  it('physical page 2 is p. 1; the cover is s. p. in Spanish and n. pag. in English', async () => {
    expect((await copyCitationWithFolio((await withAttachment({ prompts: ['p=2'] })).env))?.citation).toBe('(Saorín Ferrer, 2026, p. 1)');
    expect((await copyCitationWithFolio((await withAttachment({ prompts: ['p=1'] }, 'es-ES')).env))?.citation).toBe('(Saorín Ferrer, 2026, s. p.)');
    expect((await copyCitationWithFolio((await withAttachment({ prompts: ['p=1'] }, 'en-US')).env))?.citation).toBe('(Saorín Ferrer, 2026, n. pag.)');
  });

  it('accepts a full anchor URI', async () => {
    const s = await withAttachment({ prompts: [`spdf:sha256-${EN_SHA}#p=2&char=0,12`] });
    expect(await copyCitationWithFolio(s.env)).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 1)', uri: `spdf:sha256-${EN_SHA}#p=2&f=1&char=0,12` });
  });

  it('works from the SPDF attachment itself and from a sibling attachment', async () => {
    const s = await withAttachment({ prompts: ['2', '4'] });
    s.pane.selected = [s.att];
    expect((await copyCitationWithFolio(s.env))?.citation).toBe('(Saorín Ferrer, 2026, p. 2)');
    s.pane.selected = [await s.addAttachment(s.parent, '/elsewhere/book.pdf', 'application/pdf')];
    expect((await copyCitationWithFolio(s.env))?.citation).toBe('(Saorín Ferrer, 2026, p. 4)');
  });

  it('warns and copies nothing when the folio or page does not exist', async () => {
    const s = await withAttachment({ prompts: ['9', 'p=40', `spdf:sha256-${EN_SHA}#p=29&f=21`, `spdf:sha256-${EN_SHA}#f=xiv`, `spdf:sha256-${EN_SHA}#sl=2`] });
    for (let i = 0; i < 5; i++) expect(await copyCitationWithFolio(s.env)).toBeNull();
    expect(s.ui.alerts).toEqual([
      'This document has no page with the folio 9. Nothing was copied.',
      'This document has no physical page 40. Nothing was copied.',
      'This document has no physical page 29. Nothing was copied.',
      'This document has no page with the folio xiv. Nothing was copied.',
      'The anchor URI does not point to any part of this document. Nothing was copied.',
    ]);
    expect(s.log.clipboard).toEqual([]);
  });

  it('says so in Spanish, with Spanish quotation marks', async () => {
    const s = await withAttachment({ prompts: ['9', 'spdf:'] }, 'es-ES');
    await copyCitationWithFolio(s.env);
    await copyCitationWithFolio(s.env);
    expect(s.ui.alerts).toEqual([
      'Este documento no tiene ninguna página con el folio 9. No se ha copiado nada.',
      '«spdf:» no es un folio impreso, ni una página física, ni una URI de ancla.',
    ]);
    expect(s.log.clipboard).toEqual([]);
  });

  it('refuses an anchor URI of a document that is not attached', async () => {
    const s = await withAttachment({ prompts: [`spdf:sha256-${ES_SHA}#p=2`] });
    expect(await copyCitationWithFolio(s.env)).toBeNull();
    expect(s.ui.alerts).toEqual([`The anchor URI belongs to another document (sha256-${ES_SHA}), not to the SPDF attached to this item. Nothing was copied.`]);
  });

  it('with several SPDF attachments, a URI picks its own document and a folio asks which one', async () => {
    const s = await withAttachment({ prompts: [`spdf:sha256-${ES_SHA}#p=6`, '5'], select: 1 });
    await s.addAttachment(s.parent, ES);
    expect(await copyCitationWithFolio(s.env)).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 5)', uri: `spdf:sha256-${ES_SHA}#p=6&f=5` });
    expect(s.ui.selects).toEqual([]);
    expect(await copyCitationWithFolio(s.env)).toMatchObject({ uri: `spdf:sha256-${ES_SHA}#p=6&f=5` });
    expect(s.ui.selects).toEqual([
      { message: 'This item has several SPDF attachments. Which one should be used?', options: ['spdf-in-five-pages.spdf', 'spdf-en-cinco-paginas.spdf'] },
    ]);
  });

  it('when two pages carry the same folio, asks which one', async () => {
    const s = await withAttachment({ prompts: ['1'], select: 1 }, 'en-US', TWO_ONES);
    const c = await copyCitationWithFolio(s.env);
    expect(s.ui.selects).toEqual([{ message: 'Several pages carry the folio 1. Which one should be cited?', options: ['Physical page 2 (folio 1)', 'Physical page 3 (folio 1)'] }]);
    expect(c).toMatchObject({ citation: '(Saorín Ferrer, 2026, p. 1)', uri: expect.stringMatching(/#p=3&f=1$/) });
  });

  it('explains a missing file, a missing attachment and a cancelled prompt', async () => {
    const s = await withAttachment({ prompts: [null, '1'] });
    expect(await copyCitationWithFolio(s.env)).toBeNull(); // cancelled
    expect(s.ui.alerts).toEqual([]);
    const lonely = await s.addItem({ title: 'No SPDF here' });
    s.pane.selected = [lonely];
    expect(await copyCitationWithFolio(s.env)).toBeNull();
    const missingParent = await s.addItem();
    await s.addAttachment(missingParent, false, MEDIA_TYPE, 'gone.spdf');
    s.pane.selected = [missingParent];
    expect(await copyCitationWithFolio(s.env)).toBeNull();
    expect(s.ui.alerts).toEqual([
      'The selected item has no SPDF attachment. Use “Attach SPDF…” first.',
      'The SPDF file “gone.spdf” is not available on this computer.',
    ]);
  });
});

describe('which items the commands apply to', () => {
  it('recognizes SPDF attachments by media type or extension', async () => {
    const s = setup();
    const parent = await s.addItem();
    expect(isSpdfAttachment(await s.addAttachment(parent, '/x/a.spdf', 'application/octet-stream'))).toBe(true);
    expect(isSpdfAttachment(await s.addAttachment(parent, '/x/a.bin', MEDIA_TYPE))).toBe(true);
    expect(isSpdfAttachment(await s.addAttachment(parent, '/x/a.pdf', 'application/pdf'))).toBe(false);
    expect(isSpdfAttachment(parent)).toBe(false);
  });

  it('canAttach and canCite', async () => {
    const s = setup();
    const withSpdf = await s.addItem();
    await s.addAttachment(withSpdf, EN);
    const without = await s.addItem();
    expect(canAttach([withSpdf])).toBe(true);
    expect(canAttach([withSpdf, without])).toBe(false);
    expect(canCite(s.Z, [withSpdf])).toBe(true);
    expect(canCite(s.Z, [without])).toBe(false);
    expect(canCite(s.Z, [])).toBe(false);
  });
});
