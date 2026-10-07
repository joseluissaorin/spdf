---
title: Governance and RFCs
short: Governance
description: Who maintains SPDF, how the specification changes (through public RFCs with conformance cases), how versions work, and the licences and patent commitment.
---

## Who maintains it

SPDF is edited by [José Luis Saorín Ferrer](https://joseluissaorin.com), who designed it for [Scholaris](https://scholaris.joseluissaorin.com) and opened it as a standard in October 2026. The aim is to hand it over to a small group of maintainers from the implementations and the institutions that adopt it, under a neutral organisation, as soon as there is anyone to hand it to.

## How the specification changes

Nothing changes silently. Every change to the format goes through a **request for comments** (RFC):

1. Someone writes a proposal in `spec/rfcs/NNNN-short-title.md`: the problem, the change, the alternatives considered, and what it breaks.
2. It is discussed in public until it is accepted, rejected or withdrawn.
3. An accepted RFC is merged into the specification **together with at least one conformance case** that checks it.
4. It counts as implemented when at least two independent implementations pass that case.

Editorial fixes (typos, clearer wording, examples) do not need an RFC. Anything that changes what a valid file is, what a reader must do or what a function returns does.

<!-- rfcs -->

## Versions

- The version lives in the file: `PRAGMA user_version` is major × 100 + minor × 10 (5.0 is 500, 5.1 would be 510).
- **Minor versions only add**: a 5.0 reader opens any 5.x file, warns about the newer minor (W105) and ignores what it does not know.
- **Major versions may break**, and readers refuse a major they do not know (E002). The previous major stays readable: every 5.x reader must still read the legacy 4.0 and 4.1 files from Scholaris.
- Vendors extend the format without asking anyone, with tables named `x_<vendor>_<name>` declared in the `extensions` table. An extension marked as required makes readers that do not know it refuse the file (E060) instead of misreading it.

## Licences and patents

- The specification and this documentation are published under **CC BY 4.0**.
- All the code in the repository (libraries, producer, reader, conformance suite, this site) is **MIT OR Apache-2.0**, at your choice.
- The author makes a public commitment **not to assert any patent** against implementations of SPDF.
- The media type `application/vnd.spdf+sqlite3` will be registered with IANA once the specification is stable.

## The repository

The monorepo holds the specification, the conformance suite, every implementation, the reference producer, the reader, the integrations and this site. It stays private until the specification, the conformance suite and the first-tier libraries pass; then it opens in full. Each implementation has its own folder and its own CI workflow, and none may change another's folder.
