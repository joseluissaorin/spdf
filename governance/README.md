# SPDF governance

How SPDF is maintained and how it changes: who decides, the RFC process that every
normative change goes through, how versions are numbered and what they promise, and the
registrations that will make SPDF files recognizable by archives and operating systems.

## Documents

| Document | What it covers |
|---|---|
| [GOVERNANCE.md](GOVERNANCE.md) | The editor, the future technical committee, decisions, conflicts of interest, appeals, code of conduct, licences and the patent commitment. |
| [RFC-PROCESS.md](RFC-PROCESS.md) | When an RFC is needed, its states and steps, discussion periods, and when an RFC counts as implemented. |
| [VERSIONING.md](VERSIONING.md) | Major, minor and editorial versions, `user_version`, the compatibility promise, deprecation, and the separate versions of the conformance suite and the implementations. |
| [RFCs](../spec/rfcs/) | The RFCs themselves, and the [template](../spec/rfcs/0000-template.md). |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute to the specification, the conformance suite and the implementations. |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1. |
| [SECURITY.md](../SECURITY.md) | How to report a vulnerability privately. |

## In short

- SPDF is edited by **José Luis Saorín Ferrer**, who created it for Scholaris. A
  **technical committee** takes over disputed decisions once three independent
  implementations, maintained by at least two organizations, pass the conformance suite.
- **Nothing changes in silence.** An accepted RFC lands with at least one conformance
  case; it is considered implemented when two independent implementations pass it.
  Discussion lasts at least 14 days, followed by a 7-day final comment period.
- **Versions live in the file**: `PRAGMA user_version` is major × 100 + minor × 10 (5.0 is
  500). Every 5.x reader reads every 5.y file; minor versions only add things readers
  can ignore; deprecated features are removed only in a major version, at least 24
  months later. Every 5.x reader also reads the legacy 4.0 and 4.1 files.
- **Licences**: the specification and documentation under CC BY 4.0, the code under
  `MIT OR Apache-2.0`, and a public commitment not to assert patents against
  implementations.

<!-- rfcs -->

## Registrations in preparation

Drafts of the requests that will register SPDF with the bodies that identify and
describe file formats. None has been submitted: each one starts with a note (in
Spanish) saying who it is for, through which channel, and what is still missing.

| Body | Request | Draft |
|---|---|---|
| IANA | Media type `application/vnd.spdf` (RFC 6838, vendor tree) | [iana-application-vnd.spdf.md](drafts/iana-application-vnd.spdf.md) |
| The National Archives (UK), PRONOM | Format record and DROID signature for SPDF 5.0 | [pronom-submission.md](drafts/pronom-submission.md) |
| Library of Congress | Format description for *Sustainability of Digital Formats* | [loc-sustainability-fdd.md](drafts/loc-sustainability-fdd.md) |
| SQLite and file(1) | `application_id` 0x53504446 in SQLite's `magic.txt` and in libmagic | [sqlite-magic-entry.md](drafts/sqlite-magic-entry.md) |
| W3C | Charter for a Community Group on citable processed documents | [w3c-community-group-charter.md](drafts/w3c-community-group-charter.md) |

## Contact

<jl@joseluissaorin.com>. Security reports: see [SECURITY.md](../SECURITY.md).
