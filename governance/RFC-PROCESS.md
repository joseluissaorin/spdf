# The RFC process

Every normative change to SPDF goes through a public request for comments (RFC) and
lands together with the conformance cases that check it. This document says when an RFC
is needed, how it moves from draft to decision, and when it counts as implemented. The
key words MUST, SHOULD and MAY are to be read as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in capitals.

## The rule

**An accepted RFC lands with at least one conformance case; it is considered implemented
when two independent implementations pass it.**

Everything below exists to apply that rule fairly.

## When an RFC is needed

An RFC is REQUIRED for any change to what a valid file is, what a reader, writer or
validator must do, or what a function defined by the specification returns. In
particular:

- the schema, the canonical dump, `user_version` or `spdf_meta` keys;
- anchor types, anchor members and the anchor URI;
- the reference search, citation and export functions;
- validation codes and their order;
- integrity and signatures;
- the legacy mapping;
- the sidecar formats (`.spdfa.json`, `.spdfl.json`);
- profiles, and the rules for extensions;
- this process, [`VERSIONING.md`](VERSIONING.md) and [`GOVERNANCE.md`](GOVERNANCE.md).

An RFC is NOT needed for:

- **editorial changes**: typos, clearer wording, examples, diagrams, translations, as long
  as no implementation would have to change. Open a pull request labelled `editorial`.
  If anyone shows that an "editorial" change alters behaviour, it becomes an RFC;
- **fixes to a wrong conformance case** that contradicts the specification: fixed in
  place and logged, as [`conformance/README.md`](../conformance/README.md) describes;
- **vendor extensions**: tables named `x_<vendor>_<name>` declared in the `extensions`
  table need no permission. An RFC is needed only to make an extension part of the
  specification;
- **implementation changes** that do not change behaviour defined by the specification.

When in doubt, open an issue and ask.

## States

| State | Meaning |
|---|---|
| Draft | Written, not yet open for discussion. |
| Discussion | Open for public comment, at least 14 days. |
| Final comment period | Last call, 7 days, with a proposed disposition. |
| Accepted | Decided in favour; merged with its normative text and at least one conformance case. |
| Implemented | Two independent implementations pass all of its cases in CI. |
| Rejected | Decided against, with reasons. |
| Postponed | Good idea, wrong time; may be reopened. |
| Withdrawn | Abandoned by its authors. |
| Superseded | Replaced by a later RFC, which is named. |

## Steps

1. **Before writing (optional).** Open an issue to test the idea. It saves everyone time
   when the answer is "this already exists" or "this belongs in an extension".
2. **Draft.** Copy [`spec/rfcs/0000-template.md`](../spec/rfcs/0000-template.md) to
   `spec/rfcs/0000-short-title.md` and open a pull request. Fill in every section; the
   Conformance cases section may start as a sketch, but it MUST be complete before the
   final comment period.
3. **Discussion, at least 14 days.** The editor assigns the next free number, renames the
   file, sets the state to Discussion and announces it. Anyone may comment. Authors
   revise the text in the same pull request; each substantive revision is summarized in
   a comment so that late readers can follow.
4. **Final comment period, 7 days.** When the discussion has settled, the editor (or the
   technical committee, once it exists) announces a proposed disposition: accept, reject
   or postpone. A new substantive objection during this period returns the RFC to
   Discussion; the 7 days start again when it is resolved.
5. **Decision.** The editor, or the technical committee once it exists, decides by the
   rules in [`GOVERNANCE.md`](GOVERNANCE.md), and records in the RFC the date, the
   outcome and the reasons, including how each substantive objection was answered.
6. **Merge.** An accepted RFC is merged together with:
   - the normative text in `spec/SPEC.md` and its Spanish translation `spec/SPEC.es.md`;
   - any schema change in `spec/schema/`;
   - **at least one conformance case** in `conformance/`, with its line in
     `conformance/CHANGELOG.md` and the suite version bumped as
     [`VERSIONING.md`](VERSIONING.md) says.
   An RFC without a conformance case is not merged.
7. **Implemented.** When two independent implementations pass every case of the RFC in
   CI (their `conformance-<folder>` artifacts show it), the editor sets the state to
   Implemented and records which implementations and versions.

A version of the specification is published as final only with Implemented RFCs.
Accepted RFCs that are not yet implemented may appear in working drafts, marked as such.

## Independent implementations

Two implementations are independent when neither wraps, binds or mechanically translates
the other's code, and each was written from the specification. Bindings over the Rust
core, including the C ABI and anything built on it, count together with the Rust
implementation. Implementations may share the conformance suite and the reference
oracle; that is what they are for. Independence of authorship is not required for this
rule; it matters for forming the technical committee (see
[`GOVERNANCE.md`](GOVERNANCE.md)).

## Where discussion happens

- On the RFC's pull request, once the repository is public. Decisions reached in calls or
  meetings are tentative until they are written in the pull request.
- Until the repository is public, the editor publishes RFCs in Discussion on the website
  and collects comments sent to <jl@joseluissaorin.com>; comments are recorded in the
  pull request with their author's permission.
- Contributions in English or Spanish are welcome. The normative text is written in
  English, with a faithful Spanish translation.

## Shortened periods

The editor (or the committee) MAY shorten the discussion and final comment periods only
to fix a security problem, or a defect that makes conforming implementations
incompatible with each other. The reason is recorded in the RFC, and the change is open
to an RFC that revisits it afterwards with the normal periods.

## Numbering and files

- RFCs are numbered with four digits, in the order discussion opens. Numbers are never
  reused; a rejected or withdrawn RFC keeps its number and file.
- `0000-template.md` is the template, not an RFC.
- A Spanish version MAY sit next to the English one as `NNNN-short-title.es.md`; the
  English text prevails if they differ.
- [RFC 0001](../spec/rfcs/0001-spdf-5.0.md), which defines SPDF 5.0, was accepted by the
  editor before this process existed, without its discussion periods. Every later RFC
  follows this document.
