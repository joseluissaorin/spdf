# Versioning

How the SPDF specification is numbered, how the number is written inside files, what
each kind of version may change, and how the conformance suite and the libraries are
versioned on their own. The normative rules are in
[SPEC §23](../spec/SPEC.md#versioning); this document repeats them and adds the policy
around them. The key words MUST, SHOULD and MAY are to be read as described in BCP 14
(RFC 2119 and RFC 8174) when, and only when, they appear in capitals.

## Specification versions

The specification is numbered **MAJOR.MINOR**. Editorial corrections do not change that
number; they are published as editorial releases with a third number.

| Kind | Example | May change | Needs |
|---|---|---|---|
| Major | 5.0 → 6.0 | anything, including breaking changes | RFCs |
| Minor | 5.0 → 5.1 | only OPTIONAL additions (see the compatibility promise) | RFCs |
| Editorial | 5.0.0 → 5.0.1 | wording, examples, translations, corrections that change no behaviour | no RFC |

An editorial release never changes what a valid file is or what an implementation must
do. It does not change the version written in files, and conformance results do not
depend on it.

Releases of the specification are tagged in the repository as `spec-vMAJOR.MINOR.PATCH`
(the first is `spec-v5.0.0`), separately from the tags of the libraries.

Each published text states its maturity next to its number:

- **Working draft**: stable enough to implement, open to change by RFC. SPDF 5.0 has been
  a working draft since 2026-10-07.
- **Final**: every RFC it contains is Implemented (two independent implementations pass
  its cases) and the conformance suite covers every MUST that can be tested. A final
  version changes only through editorial releases; anything else waits for the next
  minor or major version.

## The version inside a file

```text
PRAGMA user_version = MAJOR × 100 + MINOR × 10
```

| Version | `user_version` | Bytes 60 to 63 |
|---|---|---|
| 4.0 (legacy) | 400 (or 0, see below) | `00 00 01 90` |
| 4.1 (legacy) | 410 | `00 00 01 9A` |
| 5.0 | 500 | `00 00 01 F4` |
| 5.1 | 510 | `00 00 01 FE` |

- The same version is written as text in `spdf_meta.spdf_version` (`"5.0"`), never with
  the editorial number.
- Writers write the units digit as 0. Readers accept the whole range of their major (500
  to 599 for 5.x), as the specification says.
- A 5.x writer that uses nothing introduced after 5.0 SHOULD write 500, so that readers
  of 5.0 do not warn.
- The encoding allows ten minor versions per major (x.0 to x.9). If a major ever needs
  more, the RFC that proposes the eleventh defines its encoding.
- Legacy 4.x files could not always set `user_version` (some have 0); their version is in
  the `spdf` table, and the legacy rules of the specification ([SPEC §20](../spec/SPEC.md#legacy))
  cover them.
- The optional `version` parameter of the media type (`application/vnd.spdf;
  version=5.0`) is informative. The file header is authoritative.

## What readers do with versions

- A reader of major M reads every minor of M, ignoring what it does not know. On a minor
  newer than its own it MAY warn (W105).
- A reader refuses a major it does not know (E002), and SHOULD keep reading older majors.
  Every 5.x reader MUST read the legacy versions 4.0 and 4.1, and MAY import 3.0.

## The compatibility promise

**A file that conforms to 5.0 is readable by every conforming reader of any later 5.x
version, and its anchor URIs keep resolving. A 5.0 reader reads every 5.x file.**

To keep that promise, a minor version:

- MAY add OPTIONAL things only: tables, columns, `spdf_meta` keys, anchor members or
  anchor types, metadata members, and validation warnings or errors for things that were
  already forbidden;
- MUST NOT remove or rename anything, change the meaning or the type of existing data,
  make something optional required, or change the canonical dump, the `content_sha256`,
  the anchor URIs, the citations or the reference search results of files that use
  nothing new;
- states, in each RFC that adds something a reader of an earlier minor cannot interpret
  (a new anchor type, for example), what such a reader does with it: it reads the rest of
  the file and leaves the unknown part aside. The RFC also says how a validator of an
  earlier minor reports it, and a conformance case checks both.

A major version may change or remove anything. Its RFC says how its readers treat files
of the previous major, as 5.0 does for 4.x.

## Deprecation

- A feature is deprecated by an RFC in a minor version, which gives the reason and the
  replacement. Deprecated features stay in the specification and readers keep reading
  them; writers SHOULD stop writing them.
- A deprecated feature is removed no earlier than the next **major** version, and no
  earlier than **24 months** after the publication of the version that deprecated it.
- The specification lists every deprecation with the version that deprecated it and the
  earliest version that may remove it.

## Things versioned on their own

The specification, the conformance suite and the libraries have separate version
numbers. None of them waits for the others to release.

| What | Where the number lives | Scheme |
|---|---|---|
| Specification | `spec/SPEC.md`, `user_version`, `spdf_meta.spdf_version`; tags `spec-vX.Y.Z` | MAJOR.MINOR (+ editorial) |
| Conformance suite | `conformance/manifest.json` (`suite_version`, and the `spdf_version` it targets) | semantic versioning |
| Libraries | each package manifest; tags `X.Y.Z` (Go: `go/vX.Y.Z`) | one semantic version shared by all libraries |
| SPDF Reader, `spdf build`, the website | their own manifests | their own |
| Collection manifests | `spdf_library` member of `*.spdfl.json` (now `"1.0"`) | MAJOR.MINOR, with the same promise as the specification |
| Extensions | `extensions.version` of each extension | chosen by its vendor |

### The conformance suite

- **Major**: it targets a new major version of the specification, or a kind of case is
  retired.
- **Minor**: new cases or new kinds of case.
- **Patch**: a wrong case corrected in place, or a fix in the tools that changes no
  expectation.
- While the suite is at 0.x, as now, minor releases may also correct expectations.
- Every change is logged in `conformance/CHANGELOG.md`. Case ids are never renamed or
  reused.

### The libraries

- The libraries follow a **common release train**: a semantic version tag without prefix
  (`0.1.0`, `0.2.0`…) marks a coordinated release of every library, with the same number
  in all of them. Go uses `go/vX.Y.Z` with the same number, as Go modules in a
  subdirectory require.
- The libraries stay at 0.x until the 5.0 specification is final and there are two
  independent producers and at least three independent readers that pass the whole
  conformance suite. Then they release 1.0.0.
- Each library states in its README which specification versions it supports, which
  product class and kinds of case it claims ([SPEC §21](../spec/SPEC.md#conformance)) and
  which suite version it passes; its runner reports its own version in
  `conformance.json`.
- A library MUST NOT claim to support a specification version unless it passes every
  case of the kinds it claims in a suite that targets that version.
- A new minor of the specification does not force a major release of the libraries:
  reading newer minors is already part of the compatibility promise.
