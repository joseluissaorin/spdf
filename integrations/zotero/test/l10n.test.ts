/**
 * The Fluent files: same messages in English and Spanish, every id the code uses is
 * there, and the Spanish text follows the house rules (accents, « » quotes, no em dash
 * surrounded by spaces, no straight double quotes). No emojis anywhere a person reads.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ftl } from './helpers/env.js';

const en = ftl('en-US');
const es = ftl('es-ES');
/** An em dash with a space on each side (built from code points to keep it out of the source). */
const SPACED_EM_DASH = String.fromCodePoint(32, 0x2014, 32);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

const placeables = (s: string | null) => [...(s ?? '').matchAll(/\{\s*\$([a-z]+)\s*\}/g)].map((m) => m[1]).sort();

describe('Fluent strings', () => {
  it('English and Spanish have the same messages, attributes and placeables', () => {
    expect([...es.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [id, m] of en) {
      const s = es.get(id)!;
      expect(Object.keys(s.attributes), id).toEqual(Object.keys(m.attributes));
      expect(placeables(s.value), id).toEqual(placeables(m.value));
    }
  });

  it('every id used in the code exists, menus have a label', () => {
    const code = sourceFiles(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const used = new Set([...code.matchAll(/'(spdf-(?!zotero)[a-z][a-z-]*)'/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) {
      expect(en.has(id), id).toBe(true);
      expect(es.has(id), id).toBe(true);
    }
    for (const id of ['spdf-menu-import', 'spdf-menu-attach', 'spdf-menu-cite']) {
      expect(en.get(id)!.attributes.label).toMatch(/…$/);
      expect(es.get(id)!.attributes.label).toMatch(/…$/);
    }
    // nothing in the files is unused
    for (const id of en.keys()) expect(used.has(id), `${id} is not used`).toBe(true);
  });

  it('Spanish is written in Spanish, with its accents and quotation marks', () => {
    const all = [...es.values()].flatMap((m) => [m.value ?? '', ...Object.values(m.attributes)]).join('\n');
    for (const ch of ['á', 'í', 'ú', 'ñ', '¿', '«', '»']) expect(all, ch).toContain(ch);
    expect(all).not.toContain(SPACED_EM_DASH);
    expect(all).not.toContain('"');
    expect(all).not.toMatch(/[“”]/);
    expect(es.get('spdf-select-one-item')!.value).toBe('Seleccione antes un único elemento.');
    for (const [id, m] of es) if (id !== 'spdf-error-title') expect(m.value ?? m.attributes.label, id).not.toBe(en.get(id)!.value ?? en.get(id)!.attributes.label);
  });

  it('no emojis and no spaced em dashes in anything a person reads', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'addon')), join(ROOT, 'README.md')];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.includes(SPACED_EM_DASH), f).toBe(false);
    }
  });
});
