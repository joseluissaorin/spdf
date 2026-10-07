# RFC 0000: Template

- **Status**: Draft
- **Authors**: Full Name <email> (affiliation, if any)
- **Created**: YYYY-MM-DD
- **Discussion**: link to the pull request or to the public thread
- **Specification**: the SPDF version this targets (for example 5.1) and whether the change is minor (additive) or major (breaking)
- **Affects**: sections of `spec/SPEC.md`, schema files, JSON Schemas, kinds of conformance case
- **Conformance cases**: ids of the cases added or changed
- **Supersedes / superseded by**: RFC numbers, if any
- **Decision**: filled in by the editor or the technical committee (date, outcome and reasons)

Copy this file to `spec/rfcs/0000-short-title.md` and open a pull request. The editor
assigns the next free number when discussion opens and renames the file. Keep every
section below: when one does not apply, write "Not applicable" and one sentence saying
why. Delete these instructions and the italic guidance under each heading before the
final comment period. The process is described in
[`governance/RFC-PROCESS.md`](../../governance/RFC-PROCESS.md); how versions change is in
[`governance/VERSIONING.md`](../../governance/VERSIONING.md).

## Summary

*One paragraph that someone who has never read the specification can follow: what
changes and for whom.*

## Motivation

*The problem, with real examples: a document that cannot be anchored today, a citation
that comes out wrong, an implementation that cannot do something efficiently. Say who
needs this (readers, producers, archives, users of a particular language or kind of
source) and what happens if nothing changes.*

## Guide-level explanation

*Explain the change as it would be taught to an implementer or a producer: new tables,
columns, anchor members or functions, with a small worked example (a row, an anchor, a
URI, a citation). No normative language here.*

## Normative changes

*The exact changes, written so they can be merged into `spec/SPEC.md` as they are. Use
the BCP 14 key words (RFC 2119 and RFC 8174: MUST, SHOULD, MAY) only where they are
meant. For each change give the section, the current text and the new text. Cover,
when they are affected:*

- *the schema (`spec/schema/`) and the canonical dump;*
- *anchors and the anchor URI (parameters, canonical order, parsing);*
- *search, citation and export functions;*
- *validation: new error or warning codes take the next free number in their range and
  their place in the check order;*
- *integrity and signatures;*
- *the legacy mapping (4.x to 5.x view);*
- *sidecars (`.spdfa.json`, `.spdfl.json`);*
- *the value of `PRAGMA user_version` and `spdf_meta.spdf_version` that files using the
  change must carry.*

*The Spanish translation (`spec/SPEC.es.md`) is updated in the same pull request, or the
editor updates it before the change is published.*

## Conformance cases

*An accepted RFC lands with at least one conformance case; it is considered implemented
when two independent implementations pass it. List each case: id, kind, what it checks,
the source or file it uses, and how its expected output was obtained (SQLite running
the reference SQL, exact arithmetic, hand-written and reviewed, the reference oracle),
so that nobody has to trust a single implementation. Follow "Adding cases" in
[`conformance/README.md`](../../conformance/README.md). Only public-domain texts whose
status anyone can verify.*

## Backwards compatibility

*Answer each question:*

- *Do existing files stay valid, with the same canonical dump and the same
  `content_sha256`?*
- *What does a reader of an earlier minor version of the same major do with a file that
  uses the change? It MUST still read it: see the compatibility promise in
  `governance/VERSIONING.md`. If it cannot, the change belongs in a new major version.*
- *What must writers do differently, and when?*
- *Is anything deprecated? Give the version that deprecates it and the earliest major
  version that may remove it (at least 24 months later).*
- *Does the legacy 4.x mapping change?*

## Security and privacy

*New ways for a file to make a reader do work, fetch something, execute something or
reveal something: SQL objects, URLs, embedded content, sizes and limits, information
about people, what vectors or provenance disclose, effects on hashes and signatures. If
there are none, say why.*

## Alternatives

*Other designs considered, including doing nothing, and why this one is better. Prior
art in other formats and standards (TEI, IIIF, W3C Web Annotation, Media Fragments, CSL,
EPUB, PDF) is welcome.*

## Unresolved questions

*What must be settled before acceptance, and what is deliberately left for later.*

## Implementations

*Filled in as implementations land. An RFC becomes Implemented when two independent
implementations pass all of its cases in CI. Two implementations are independent when
neither wraps or translates the other's code: bindings over the Rust core, including the
C ABI, count as the Rust implementation.*

| Implementation | Status | Version or commit | Cases passed |
|---|---|---|---|
| | | | |
