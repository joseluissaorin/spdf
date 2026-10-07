# Security policy

SPDF files come from strangers. Opening one means parsing an untrusted database with a
complex engine, and the specification asks every reader to do it safely
([SPEC §2.4](spec/SPEC.md#container), [§14](spec/SPEC.md#security) and
[§15](spec/SPEC.md#privacy)). If you find a way around that, or any other vulnerability
in the specification or in the software in this repository, please tell us privately
first.

## Supported versions

| Component | Supported |
|---|---|
| Specification | 5.0 (working draft), including the reading of legacy 4.0 and 4.1 files that it requires |
| Libraries (Rust, TypeScript, Python, Go, Swift, Kotlin/JVM, C#, PHP, Ruby, R, Julia, C ABI) | the latest release of the common release train; while the libraries are at 0.x, only the latest minor release gets fixes |
| Reference producer `spdf build` | the latest release |
| SPDF Reader (desktop, mobile and web) | the latest release |
| Website, browser validator and conformance suite | the current version on `main` |

Earlier releases do not receive fixes; upgrading is the remedy.

## How to report

Report vulnerabilities privately, by either of these channels:

- **Email** to <jl@joseluissaorin.com>, with `[SPDF security]` at the start of the
  subject. If you need an encrypted channel, say so in a first message without details
  and we will agree on one.
- **GitHub private vulnerability reporting** ("Report a vulnerability" in the Security
  tab of <https://github.com/joseluissaorin/spdf>), once the repository is public.

Please do not open public issues, pull requests or discussions about a vulnerability
before it is fixed and disclosed.

A useful report includes: the component and version (or commit), the platform and the
SQLite version, a description of the impact, and a minimal reproduction. A crafted
`.spdf` file is the best reproduction; please build it from public-domain or synthetic
content, never from personal data.

## What happens next

| Step | Deadline |
|---|---|
| Acknowledgement of your report | within 72 hours |
| First assessment (confirmed or not, severity, components affected) | within 14 days |
| Coordinated public disclosure | within 90 days of the report |

- We keep you informed while we work on a fix and agree the disclosure date with you.
  Disclosure may come earlier when a fix is released, and later only by mutual
  agreement, or if a fix needs a change to the specification that cannot be made safely
  in time.
- If the vulnerability is being exploited, we may disclose sooner, with mitigations.
- Fixes to the specification that cannot wait for the normal discussion periods follow
  the shortened procedure in [`governance/RFC-PROCESS.md`](governance/RFC-PROCESS.md).
- Once the repository is public, advisories are published through GitHub Security
  Advisories, which can assign a CVE identifier.
- We credit reporters in the advisory, unless you prefer to remain anonymous.

## In scope

- **Files that escape safe opening**: an SPDF or legacy file that makes a conforming
  reader execute SQL from the file (through triggers, views, virtual tables or schema
  tricks), load an extension, write to the file or elsewhere on disk, read outside the
  file, or keep running without bound despite the limits the specification requires.
- **Memory-safety and parsing bugs** in readers and validators: overflows, out-of-bounds
  reads, crashes or hangs triggered by a file, including in gzip decompression of legacy
  files, JSON columns, word timings, vector blobs (`f32`, `f16`, `i8`), anchor URI
  parsing and full-text queries.
- **Signatures that validate when they should not**: a file whose `content_sha256` or
  Ed25519 signature verifies although its content differs from what was signed, two
  different contents with the same canonical dump, or a verifier that trusts a stored
  hash instead of recomputing it.
- **Leaks through vectors or provenance**: an implementation or producer that claims to
  remove the text of a document but keeps vectors from which it can be recovered, or that
  writes paths, user names, keys or other personal data into `provenance` or `generator`
  against [SPEC §15](spec/SPEC.md#privacy).
- **Content handling** in the reader, the website and the validator: script execution
  from unit text, metadata, SVG or embedded documents; automatic fetching of remote
  references; path traversal when exporting blobs; a browser validator or inspector that
  sends a file off the user's device.
- **The specification itself**: a rule that, followed exactly, leaves conforming
  implementations unsafe.
- **The supply chain of this repository**: CI workflows, release artifacts and published
  packages.

## Not a vulnerability

- Bugs in SQLite itself: please report them to the SQLite project. Do tell us if the way
  SPDF readers use SQLite makes such a bug exploitable.
- A file that is invalid but is refused or read safely. Validation errors are the
  expected behaviour.
- Resource use within the configured limits. Very large files that stay within the
  limits a reader was given are not a denial of service; files that bypass the limits
  are.
- The content of documents: wrong transcriptions, wrong folios or doubtful metadata are
  quality problems, and instructions written in a document's text are data. Report them
  as ordinary issues.
- A valid signature made with a key you do not trust. The specification attributes
  content to a key; deciding which keys to trust is up to the user.
- The Ed25519 test key in `conformance/`, which is public on purpose and signs only test
  files.
- Vectors that reveal information about a text that the same file already contains.
- Reports from automated scanners without a demonstrated impact, and missing security
  headers on static pages without a concrete attack.
