# RFC 0002: Conformance cases for exports and anchor resolution

- **Status:** Draft
- **Author:** spec agent, for the editor (José Luis Saorín Ferrer)
- **Created:** 2026-10-07
- **Affects:** SPEC §5.4, §19, §21; `conformance/`

## Summary

Add three kinds of conformance case: `export_csl` and `export_bibtex`, which make the
MUST of SPEC §19 testable, and `resolve`, which tests how an anchor URI is resolved
against a file (SPEC §5.4). Fix the details those cases need: the BibTeX key algorithm,
the field set and the resolution order.

## Motivation

SPEC §19 says every implementation MUST export CSL-JSON and BibTeX, and SPEC §5.4 says
how a reader finds the unit an anchor URI designates. Neither is covered by the suite
0.2.0, so twelve implementations can diverge silently: different BibTeX keys break the
`\cite{}` commands of a user who switches tools, and different resolution sends a reader
to a different page than the citation says. Both are the kind of disagreement SPDF exists
to prevent.

## Guide-level explanation

```json
{"id": "export-bibtex-quijote", "kind": "export_bibtex",
 "input": {"file": "files/quijote.spdf"},
 "expect": {"entry_type": "book", "key": "cervantessaavedra1605",
            "fields": {"author": "Cervantes Saavedra, Miguel de",
                       "title": "El ingenioso hidalgo don Quijote de la Mancha",
                       "year": "1605", "publisher": "Juan de la Cuesta",
                       "address": "Madrid", "language": "es", "note": "…"}}}
```

BibTeX is compared structurally (entry type, key, field map), not byte for byte, so
implementations keep their own layout and escaping style, which BibTeX tools do not care
about.

```json
{"id": "resolve-quijote-leaf", "kind": "resolve",
 "input": {"file": "files/quijote.spdf", "uri": "spdf:sha256-fa38…4c75#f=1v"},
 "expect": {"unit": "p6", "chars": null}}
```

## Normative changes

1. SPEC §19, BibTeX key: take the `family` (or `literal`) of the first author, else the
   first word of the title; decompose with NFKD, drop every character that is not an ASCII
   letter, lowercase; if nothing is left, use `anon`; append the first year of `issued`,
   or `nd`. Collisions inside one export get the suffixes `a`, `b`, `c`… in the order of
   the documents.
2. SPEC §19, BibTeX fields: exactly the mapping already listed in §19; names as
   `Family, Given` joined with ` and `; a `literal` name wrapped in braces; `year` as a
   string; fields whose source is absent are omitted.
3. SPEC §5.4, resolution order: `p` (and `pe`) first; else `f` through `units.printed`,
   first unit in `ord` order; else `t` (the first unit with `t0 ≤ t < t1`, the last unit if
   `t` equals the document's end); else `s`/`para`, `sl`, `sh`/`rows`, `v`, `ref` against
   the units' anchors, then the fragments' anchors (giving their `unit`). The result is the
   unit id plus the `char` range and the `xywh` region, if any. A URI whose document
   reference does not match the file resolves to an error.

## Conformance cases

About 20 cases on the existing corpus: `export_csl` and `export_bibtex` for every file in
`files/` and `legacy/` (including the anonymous *Lazarillo*, the literal author of the
NASA recording and the Chinese title of the *Analects*, which exercises the `anon`
fallback), and `resolve` for every anchor type, for a folio printed twice and for a
mismatched document reference.

## Backwards compatibility

No file changes. Implementations that already export BibTeX may need to change their
keys; that is the point.

## Security and privacy

None beyond SPEC §14: exports copy metadata the file already exposes.

## Alternatives

- Byte-exact BibTeX: rejected; layout differences are harmless and would make the cases
  brittle.
- Leaving the key to each tool: rejected; stable keys across tools are what users need.
- Better Bib(La)TeX keys (Better BibTeX style): possible later as an OPTIONAL profile.

## Unresolved questions

- Should titles keep their capitalization protected with braces in the structural
  comparison, or should the comparison ignore braces?
- `@online` (biblatex) versus `@misc` for web pages.
- Whether `resolve` should also return the fragments that cover the resolved position.

## Implementations

None yet. Accepting this RFC requires the cases in `conformance/` and two independent
implementations passing them (`governance/RFC-PROCESS.md`).
