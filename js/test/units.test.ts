import { describe, expect, it } from 'vitest';
import {
  anchorToLocator,
  canonicalJson,
  cite,
  decodeVector,
  encodeVector,
  f16ToNumber,
  formatAnchorUri,
  formatLocator,
  locatorToAnchor,
  numberToF16,
  parseAnchorUri,
  parseQuery,
  matchExpression,
  round6,
  toBibtex,
  toCslJson,
  toCslJsonArray,
  cslCitationItem,
  cslLocator,
  citationKey,
  type Anchor,
  type CslItem,
} from '../src/entry/node.js';
import { mapLegacyAnchor, mapLegacyMetadata } from '../src/legacy.js';

describe('canonical JSON (JCS after rounding)', () => {
  it('rounds to 6 decimals, half to even on exact ties', () => {
    expect(round6(0.1234565)).toBe(0.123456); // binary value is just below the tie (as Python)
    expect(round6(0.0078125)).toBe(0.007812); // exact tie → even
    expect(round6(0.0078135)).toBe(0.007813);
    expect(round6(0.1234575)).toBe(0.123457);
    expect(round6(-0.0000004)).toBe(0);
    expect(round6(1e-6)).toBe(0.000001);
    expect(round6(2.5)).toBe(2.5);
  });
  it('writes numbers in ECMAScript form and sorts keys', () => {
    expect(canonicalJson({ b: 1.0, a: [0.000001, -0, 1e-7, 1234567.0000004] })).toBe('{"a":[0.000001,0,0,1234567],"b":1}');
    expect(canonicalJson({ é: 'ñ\n"', z: null, A: true })).toBe('{"A":true,"z":null,"é":"ñ\\n\\""}');
  });
});

describe('anchor URIs', () => {
  const doc = { id: 'x', source_sha256: '3f2a'.padEnd(64, '0') };
  it('formats the contract example and round-trips', () => {
    const a: Anchor = { type: 'page', physical: 29, printed: '21', chars: [118, 301] };
    const uri = formatAnchorUri(doc, a);
    expect(uri).toBe(`spdf:sha256-${doc.source_sha256}#p=29&f=21&char=118,301`);
    const p = parseAnchorUri(uri);
    expect(p.docref).toBe(`sha256-${doc.source_sha256}`);
    expect(p.locator).toEqual({ p: 29, f: '21', char: [118, 301] });
    expect(formatAnchorUri(p.docref, p.locator)).toBe(uri);
  });
  it('encodes every parameter in canonical order', () => {
    const a: Anchor = { type: 'page', physical: 10, printed: 'xiv', region: { x: 0.125, y: 0.2, w: 0.3, h: 0.1 } };
    const end: Anchor = { type: 'page', physical: 11, printed: 'xv' };
    expect(formatLocator('x', anchorToLocator(a, end))).toBe('spdf:x#p=10&pe=11&f=xiv&fe=xv&xywh=percent:12.5,20,30,10');
    expect(formatLocator('x', anchorToLocator({ type: 'time', t0: 4160, t1: 4175.5 }))).toBe('spdf:x#t=4160,4175.5');
    expect(formatLocator('x', anchorToLocator({ type: 'section', path: ['Chapter 3', '3.2 The panopticon/x'], paragraph: 4, printed: '145' }))).toBe('spdf:x#f=145&s=Chapter%203/3.2%20The%20panopticon%2Fx&para=4',
    );
    expect(formatLocator('x', anchorToLocator({ type: 'sheet', sheet: 'Datos 1', row_from: 4, row_to: 9 }))).toBe('spdf:x#sh=Datos%201&rows=4-9');
    expect(formatLocator('x', anchorToLocator({ type: 'verse', line_from: 1234, line_to: 1240 }))).toBe('spdf:x#v=1234-1240');
    expect(formatLocator('x', anchorToLocator({ type: 'verse', line_from: 7, line_to: 7 }))).toBe('spdf:x#v=7');
    expect(formatLocator('x', anchorToLocator({ type: 'canonical', scheme: 'stephanus', ref: '514a' }))).toBe('spdf:x#ref=stephanus:514a');
    expect(formatLocator('x', anchorToLocator({ type: 'slide', n: 3 }))).toBe('spdf:x#sl=3');
  });
  it('parses leniently and ignores unknown keys', () => {
    const p = parseAnchorUri('spdf:mi%20doc#zz=1&xywh=percent:10,20,30,40&f=%C3%B1');
    expect(() => parseAnchorUri('spdf:x#xywh=1,2,3,4')).toThrow();
    expect(() => parseAnchorUri('spdf:x#p=0')).toThrow();
    expect(() => parseAnchorUri('spdf:x#p=1&p=2')).toThrow();
    expect(() => parseAnchorUri('spdf:x#f=%FF')).toThrow();
    expect(parseAnchorUri('spdf:x#t=npt:1:09:20,1:09:35.5').locator).toEqual({ t: [4160, 4175.5] });
    expect(p.docref).toBe('mi doc');
    expect(p.locator).toEqual({ f: 'ñ', xywh: [0.1, 0.2, 0.3, 0.4] });
    expect(locatorToAnchor({ t: [1, 2] }).anchor).toEqual({ type: 'time', t0: 1, t1: 2 });
  });
});

describe('short citation', () => {
  const m = (author?: CslItem['author'], extra: Record<string, unknown> = {}): CslItem =>
    ({ type: 'book', title: 'Vigilar y castigar: nacimiento de la prisión', ...(author ? { author } : {}), issued: { 'date-parts': [[1975]] }, ...extra }) as CslItem;
  const page = (printed: string | null, extra: Record<string, unknown> = {}): Anchor => ({ type: 'page', physical: 9, printed, ...extra }) as Anchor;
  it('names, years and pages', () => {
    expect(cite(page('145'), m([{ family: 'Foucault', given: 'Michel' }]))).toBe('(Foucault, 1975, p. 145)');
    expect(cite(page('145'), m([{ family: 'Deleuze' }, { family: 'Guattari' }]), 'es')).toBe('(Deleuze y Guattari, 1975, p. 145)');
    expect(cite(page('145'), m([{ family: 'Deleuze' }, { family: 'Ibáñez' }]), 'es')).toBe('(Deleuze e Ibáñez, 1975, p. 145)');
    expect(cite(page('145'), m([{ family: 'Deleuze' }, { family: 'Hierro' }]), 'es')).toBe('(Deleuze y Hierro, 1975, p. 145)');
    expect(cite(page('145'), m([{ family: 'Deleuze' }, { family: 'Guattari' }]), 'en')).toBe('(Deleuze and Guattari, 1975, p. 145)');
    expect(cite(page('1'), m([{ family: 'A' }, { family: 'B' }, { family: 'C' }]), 'en')).toBe('(A et al., 1975, p. 1)');
    expect(cite(page('1'), m([{ literal: 'UNESCO' }]))).toBe('(UNESCO, 1975, p. 1)');
    expect(cite(page('1'), m([{ family: 'Gogh', 'non-dropping-particle': 'van' }]))).toBe('(van Gogh, 1975, p. 1)');
    expect(cite(page('1'), m(undefined, { issued: {} }))).toBe('(Vigilar y castigar, s. f., p. 1)');
    expect(cite(page('1'), m(undefined, { issued: {} }), 'en')).toBe('(Vigilar y castigar, n.d., p. 1)');
    expect(cite(page('1'), m([{ family: 'Platón' }], { issued: { 'date-parts': [[-380]] } }))).toBe('(Platón, 380 a. C., p. 1)');
    expect(cite(page('1'), m([{ family: 'Plato' }], { issued: { 'date-parts': [[-380]] } }), 'en')).toBe('(Plato, 380 BC, p. 1)');
    expect(cite(page('xiv'), m([{ family: 'F' }]))).toBe('(F, 1975, p. xiv)');
    expect(cite(page('21', { source: 'inferred' }), m([{ family: 'F' }]))).toBe('(F, 1975, p. [21])');
    expect(cite(page('1r', { foliation: 'leaf' }), m([{ family: 'F' }]))).toBe('(F, 1975, fol. 1r)');
    expect(cite(page('45', { foliation: 'column' }), m([{ family: 'F' }]))).toBe('(F, 1975, col. 45)');
    expect(cite(page(null), m([{ family: 'F' }]))).toBe('(F, 1975, s. p.)');
    expect(cite(page(null), m([{ family: 'F' }]), 'en')).toBe('(F, 1975, n. pag.)');
    expect(cite(page('145'), m([{ family: 'F' }]), 'es', page('146'))).toBe('(F, 1975, pp. 145-146)');
    expect(cite(page('1r', { foliation: 'leaf' }), m([{ family: 'F' }]), 'es', page('2v', { foliation: 'leaf', source: 'inferred' }))).toBe('(F, 1975, fols. 1r-[2v])');
  });
  it('other locators', () => {
    const a = m([{ family: 'Cortázar' }]);
    expect(cite({ type: 'time', t0: 4160.9, t1: 4175 }, a)).toBe('(Cortázar, 1975, 1:09:20)');
    expect(cite({ type: 'time', t0: 42, t1: 50 }, a, 'es', { type: 'time', t0: 60, t1: 65.2 })).toBe('(Cortázar, 1975, 0:42-1:05)');
    expect(cite({ type: 'slide', n: 3 }, a)).toBe('(Cortázar, 1975, diap. 3)');
    expect(cite({ type: 'slide', n: 3 }, a, 'en')).toBe('(Cortázar, 1975, slide 3)');
    expect(cite({ type: 'sheet', sheet: 'Data', row_from: 4, row_to: 9 }, a)).toBe('(Cortázar, 1975, Data, filas 4-9)');
    expect(cite({ type: 'sheet', sheet: 'Data', row_from: 4, row_to: 4 }, a, 'en')).toBe('(Cortázar, 1975, Data, row 4)');
    expect(cite({ type: 'verse', line_from: 1234, line_to: 1240 }, a)).toBe('(Cortázar, 1975, vv. 1234-1240)');
    expect(cite({ type: 'verse', line_from: 1234 }, a, 'en')).toBe('(Cortázar, 1975, v. 1234)');
    expect(cite({ type: 'canonical', scheme: 'stephanus', ref: '514a' }, a)).toBe('(Cortázar, 1975, 514a)');
    expect(cite({ type: 'section', path: ['Cap. 3', '3.2 El panóptico'], paragraph: 4 }, a)).toBe('(Cortázar, 1975, § 3.2 El panóptico, párr. 4)');
    expect(cite({ type: 'section', path: [], paragraph: 4 }, a, 'en')).toBe('(Cortázar, 1975, para. 4)');
    expect(cite({ type: 'section', path: ['x'], printed: '145' }, a)).toBe('(Cortázar, 1975, p. 145)');
    expect(cite({ type: 'image' }, a)).toBe('(Cortázar, 1975)');
    expect(cite({ type: 'slide', n: 1 }, a, 'fr')).toBe('(Cortázar, 1975, slide 1)');
  });
});

describe('vectors', () => {
  it('f16 round trip and rounding', () => {
    for (const x of [0, 1, -1, 0.5, 65504, 6.103515625e-5, 5.960464477539063e-8]) expect(f16ToNumber(numberToF16(x))).toBe(x);
    expect(f16ToNumber(numberToF16(1 / 3))).toBeCloseTo(0.33325, 5);
    expect(() => numberToF16(1e6)).toThrow();
    expect(f16ToNumber(numberToF16(1e6, true))).toBe(Infinity);
    expect(numberToF16(65504)).toBe(0x7bff);
    expect(() => numberToF16(65520)).toThrow();
  });
  it('i8 quantization is round half away from zero, clamped', () => {
    expect(Array.from(encodeVector([1, -1, 0.5 / 127, -0.5 / 127, 2, -3], 'i8')).map((b) => (b > 127 ? b - 256 : b))).toEqual([127, -127, 1, -1, 127, -127]);
    expect(Array.from(decodeVector(encodeVector([1, -1], 'i8'), 'i8'))).toEqual([1, -1]);
  });
  it('f32 is little endian', () => {
    expect(Array.from(encodeVector([1], 'f32'))).toEqual([0, 0, 128, 63]);
  });
});

describe('lexical query parsing', () => {
  it('words, OR, dedup by folded key', () => {
    const p = parseQuery('Mancha  mancha MÁNCHA hidalgo-lanza');
    expect(p).toEqual({ terms: ['Mancha', 'hidalgo', 'lanza'], phrases: false });
    expect(matchExpression(p)).toBe('"Mancha" OR "hidalgo" OR "lanza"');
  });
  it('phrases win over loose words; unmatched marks are separators', () => {
    expect(parseQuery('lugar «de la Mancha» y "lanza en astillero"')).toEqual({ terms: ['de la Mancha', 'lanza en astillero'], phrases: true });
    expect(parseQuery('„a b“ c')).toEqual({ terms: ['a b'], phrases: true });
    expect(parseQuery('"abierta sin cierre')).toEqual({ terms: ['abierta', 'sin', 'cierre'], phrases: false });
    expect(matchExpression(parseQuery('"say ""hi"""'))).toBe('"say" AND "hi"');
    expect(parseQuery('Straße ﬁn')).toEqual({ terms: ['Straße', 'ﬁn'], phrases: false });
  });
});

describe('legacy mapping', () => {
  it('maps anchors, keeping unknown members', () => {
    expect(mapLegacyAnchor({ tipo: 'pagina', fisica: 3, impresa: '1', romana: false, origen: 'deducido', confianza: 0.5, extra: 1 })).toEqual({
      type: 'page',
      physical: 3,
      printed: '1',
      roman: false,
      source: 'inferred',
      confidence: 0.5,
      extra: 1,
    });
    expect(mapLegacyAnchor({ tipo: 'hoja', hoja: 'A', filaDesde: 1, filaHasta: 2 })).toEqual({ type: 'sheet', sheet: 'A', row_from: 1, row_to: 2 });
  });
  it('maps metadata to CSL', () => {
    const m = mapLegacyMetadata(
      {
        titulo: 'Título',
        subtitulo: 'Sub',
        autores: [{ nombre: 'Ana', apellidos: 'Pérez', orcid: 'X' }],
        anio: 1977,
        fecha: '1977-03-20',
        revista: 'Revista',
        sinFecha: { desde: 1600, hasta: 1610, fundamento: 'impresor' },
        idiomaOriginal: 'fr',
        procedencia: { titulo: { fuente: 'colofon', confianza: 0.9 } },
        doi: '',
      },
      'pdf',
    );
    expect(m).toEqual({
      type: 'article-journal',
      title: 'Título: Sub',
      'title-short': 'Título',
      author: [{ family: 'Pérez', given: 'Ana' }],
      issued: { 'date-parts': [[1977, 3, 20]] },
      'container-title': 'Revista',
      spdf: {
        subtitle: 'Sub',
        orcid: { 'Pérez, Ana': 'X' },
        original_language: 'fr',
        undated: { from: 1600, to: 1610, basis: 'impresor' },
        provenance: { title: { source: 'colophon', confidence: 0.9 } },
      },
    });
    expect(mapLegacyMetadata({ titulo: 'T' }, 'video').type).toBe('motion_picture');
    expect(mapLegacyMetadata({ titulo: 'T', anio: 1990, fecha: '1991-01-01' }, 'audio')).toEqual({ type: 'speech', title: 'T', issued: { 'date-parts': [[1990]] } });
  });
});

describe('bibliography (SPEC §19)', () => {
  const m: CslItem = {
    type: 'book',
    title: 'El ingenioso hidalgo don Quijote de la Mancha',
    author: [{ family: 'Cervantes Saavedra', given: 'Miguel de' }],
    issued: { 'date-parts': [[1605]] },
    publisher: 'Juan de la Cuesta',
    'publisher-place': 'Madrid',
    page: '1-312',
    spdf: { subtitle: 'x' },
  };
  it('CSL-JSON drops the spdf extension; id is the BibTeX key', () => {
    const c = toCslJson(m);
    expect(c.id).toBe('cervantessaavedra1605');
    expect(c.spdf).toBeUndefined();
    expect(toCslJsonArray([m, m]).map((x) => x.id)).toEqual(['cervantessaavedra1605a', 'cervantessaavedra1605b']);
    expect(cslCitationItem(m, { type: 'page', physical: 9, printed: '21', source: 'inferred' }, { type: 'page', physical: 10, printed: '22' })).toMatchObject({ label: 'page', locator: '[21]-22' });
    expect(cslLocator({ type: 'time', t0: 4160, t1: 4170 })).toEqual(['timestamp', '1:09:20']);
  });
  it('BibTeX', () => {
    expect(toBibtex(m)).toBe(
      '@book{cervantessaavedra1605,\n  author = {Cervantes Saavedra, Miguel de},\n  title = {{El} ingenioso hidalgo don {Quijote} de la {Mancha}},\n  year = {1605},\n  publisher = {Juan de la Cuesta},\n  address = {Madrid},\n  pages = {1-312}\n}\n',
    );
    expect(toBibtex({ type: 'article-journal', title: 'a {b} c\\d', 'container-title': 'Revista', author: [{ literal: 'UNESCO' }] })).toBe(
      '@article{unescond,\n  author = {{UNESCO}},\n  title = {a \\{b\\} c\\textbackslash{}d},\n  journal = {{Revista}}\n}\n',
    );
    expect(citationKey({ type: 'book', title: 'Lazarillo de Tormes', issued: { 'date-parts': [[1554]] } })).toBe('lazarillo1554');
  });
});

describe('package', () => {
  it('VERSION matches package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const { VERSION } = await import('../src/version.js');
    expect(VERSION).toBe(pkg.version);
  });
});
