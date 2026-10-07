# Contributing to SPDF

SPDF is three things that change in different ways: a **specification**, a
**conformance suite** that turns the specification into checkable cases, and many
**implementations** that must agree with both. This guide says how to contribute to each.
Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md). Security
problems are reported privately, as [`SECURITY.md`](SECURITY.md) explains, never in a
public issue.

The repository is private until the specification, the conformance suite and the
first-tier libraries pass; until then, contributions come from invited collaborators, and
comments on the specification are welcome by email at <jl@joseluissaorin.com>.

## Contributing to the specification

The normative text is [`spec/SPEC.md`](spec/SPEC.md), in English, with a faithful
Spanish translation in [`spec/SPEC.es.md`](spec/SPEC.es.md). If they differ, the English
text prevails.

- **Editorial changes** (typos, clearer wording, examples, diagrams, translation fixes)
  that would not make any implementation change: open a pull request labelled
  `editorial`. Change both languages when the fix applies to both, or say in the pull
  request that the other language needs the same fix.
- **Normative changes** (anything that changes what a valid file is, what a reader,
  writer or validator must do, or what a function returns) go through an RFC: copy
  [`spec/rfcs/0000-template.md`](spec/rfcs/0000-template.md) and follow
  [`governance/RFC-PROCESS.md`](governance/RFC-PROCESS.md). **An accepted RFC lands with
  at least one conformance case; it is considered implemented when two independent
  implementations pass it.**
- **Questions and ambiguities** are contributions too. If two readings of the text are
  possible, open an issue with both, and an example file or case if you can. Do not
  settle it by copying what another implementation does.
- Use the BCP 14 key words (MUST, SHOULD, MAY) only where they are meant, and in
  capitals.

How versions change, and what a minor version may add, is in
[`governance/VERSIONING.md`](governance/VERSIONING.md).

## Contributing to the conformance suite

The suite in [`conformance/`](conformance/) is normative for behaviour. Its layout, case
format and runner protocol are in [`conformance/README.md`](conformance/README.md).

- **Only public-domain texts whose status anyone can verify.** Name the work, the
  edition and the reason it is in the public domain (for example the author's death
  date, or a government work). Layouts, folios, timings and hashes that are synthetic
  must say so in the document's CSL `note`. Never use personal data.
- **Expectations come from an oracle, not from an implementation**: SQLite running the
  reference SQL, exact arithmetic, the reference oracle `tools/spdfref.py`, or cases
  written and reviewed by hand in `tools/manual/`. A case that only records what one
  library returns is not accepted.
- After editing a source or a manual case, run
  `python3 conformance/tools/generar.py --sellar` and then
  `python3 conformance/tools/verificar.py` (Python 3.13, standard library only), and
  commit the regenerated files.
- Add a line to [`conformance/CHANGELOG.md`](conformance/CHANGELOG.md) and bump the suite
  version as `governance/VERSIONING.md` says.
- Case ids are never renamed or reused. A wrong case is fixed in place and the change is
  logged; a removed case keeps its id retired.
- A new kind of case, or a case that changes what the specification requires, needs an
  RFC.

## Contributing to an implementation

Each implementation lives in its own folder (`rust/`, `js/`, `python/`, `go/`, `swift/`,
`kotlin/`, `dotnet/`, `php/`, `ruby/`, `r/`, `julia/`, `c/`) with its own CI workflow,
`.github/workflows/<folder>.yml`. The same holds for `producer/`, `reader/`, `site/`,
`integrations/` and `models/`.

- **One folder per pull request.** Do not change another implementation's folder or
  workflow in the same pull request; if you find a bug in another implementation, open
  an issue or a separate pull request for it.
- **Follow the specification, not another implementation**, including the reference
  one. When an implementation and the suite disagree, the suite wins until an RFC says
  otherwise.
- **Run the conformance runner.** Every implementation ships a runner that discovers
  `conformance/cases/*.json` and prints the report described in
  `conformance/README.md`. A change must not turn a passing case into a failing one. CI
  uploads the report as the artifact `conformance-<folder>`.
- **Keep the safety rules**: safe opening, size limits and the other requirements of
  [SPEC §2.4](spec/SPEC.md#container) and [§14](spec/SPEC.md#security) are not optional,
  even in tests and examples.
- Follow the conventions of the language: its formatter, linter and test framework, as
  the folder's README describes. Add tests with the change.
- New dependencies need a reason in the pull request. Prefer what the platform already
  provides; SQLite comes first.
- Models are downloaded on demand and never committed or packaged.

## Pull requests

- Keep them small and about one thing. Explain the why, not only the what.
- Link the RFC, issue or conformance case the change relates to.
- CI must pass, including the conformance runner of the folder you touched.
- Before pushing, rebase on the current `main` (`git pull --rebase`).
- Never commit secrets, credentials, API keys or personal data.

## Commit messages

- Subject line: `<area>: <what changed>`, where `<area>` is the top-level folder
  (`spec`, `conformance`, `governance`, `rust`, `js`, `python`, …) or `ci`, and the
  summary is in English or Spanish, at most 72 characters, without a final period.
- A body, separated by a blank line, says why the change is needed when that is not
  obvious.
- Every commit ends with a `Signed-off-by` line (see below). Add `Co-authored-by` lines
  for every co-author.
- Contributions prepared with the help of AI tools are welcome. The person who signs off
  is responsible for them, has reviewed them, and certifies the DCO for them; say in the
  pull request which tools were used.

## Licensing of contributions

Contributions are licensed under the licence of the part of the repository they change:

| Part | Licence |
|---|---|
| Specification and documentation (`spec/`, `governance/`, prose in every folder) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Code (implementations, producer, reader, conformance suite, website, integrations) | MIT OR Apache-2.0, at the user's choice ([`LICENSE-MIT`](LICENSE-MIT), [`LICENSE-APACHE`](LICENSE-APACHE)) |

Every commit must carry a `Signed-off-by: Full Name <email>` line (`git commit -s`). With
it you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the contribution or otherwise have the right to submit it under the
licence above. Contributors to the specification also make the patent commitment
described in [`governance/GOVERNANCE.md`](governance/GOVERNANCE.md#licences-and-patents):
they will not assert patents they own or control against implementations of SPDF.

## Languages

- The normative specification is written in English, with a faithful Spanish
  translation maintained alongside it.
- Issues, pull requests, reviews and discussions may be in English or Spanish.
- Documentation for people is published in English and, where possible, in Spanish.
  Spanish text is written with correct spelling, accents and `ñ` included; identifiers
  in code, schemas and JSON keys stay in English without accents.

## Reporting security problems

Do not report vulnerabilities in public issues. Follow [`SECURITY.md`](SECURITY.md):
email <jl@joseluissaorin.com> or, once the repository is public, use GitHub's private
vulnerability reporting.

## En español

Las contribuciones en español son igual de bienvenidas. La especificación normativa está
en inglés y tiene una traducción española fiel en `spec/SPEC.es.md`; si se contradicen,
manda el inglés. Las erratas y mejoras de redacción se proponen con un *pull request*
marcado `editorial`; todo cambio normativo pasa por una RFC (`spec/rfcs/`, proceso en
`governance/RFC-PROCESS.md`), y una RFC aceptada entra con al menos un caso de
conformidad y se da por implementada cuando dos implementaciones independientes lo
pasan. Los casos de la batería solo usan obras de dominio público comprobable. Cada
implementación vive en su carpeta, con su propio flujo de CI, y un *pull request* toca
una sola carpeta. Cada commit lleva la línea `Signed-off-by` del DCO; la especificación
y la documentación se publican con CC BY 4.0 y el código con MIT OR Apache-2.0. Los
fallos de seguridad se comunican en privado, como explica `SECURITY.md`.
