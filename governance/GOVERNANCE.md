# Governance

Who decides what SPDF is, how, and how that changes as the format gains implementers and
users. SPDF starts with a single editor and is designed to pass to a technical committee
as soon as there are people outside the original project to share it with. The key
words MUST, SHOULD and MAY are to be read as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in capitals.

## Principles

- **Nothing changes in silence.** Normative changes go through the
  [RFC process](RFC-PROCESS.md), in public, with recorded reasons.
- **Conformance over authority.** What the format means is settled by the specification
  and its conformance cases, not by what any one implementation does, including the
  reference one.
- **Open by licence.** The specification can be implemented by anyone, for any purpose,
  without asking (see [Licences and patents](#licences-and-patents)).
- **Users outside software count.** Libraries, archives, scholars and readers in every
  language are part of the community, not only implementers.

## Phase 1: the editor

SPDF was created by **José Luis Saorín Ferrer** for Scholaris and opened as a standard in
October 2026. Until the technical committee exists, he is the **editor** and the
**maintainer** of the specification and of this repository.

The editor:

- runs the RFC process: assigns numbers, opens and closes discussion periods, records
  decisions and their reasons;
- decides on RFCs after public discussion, seeking consensus first, and writes down how
  every substantive objection was answered;
- keeps the specification, its Spanish translation and the conformance suite consistent;
- merges changes to each implementation's folder only after its maintainer's review,
  once each folder has a named maintainer;
- represents the project in registrations (IANA, PRONOM, the Library of Congress, the
  SQLite and file(1) projects) and before standards bodies;
- handles security reports as [`SECURITY.md`](../SECURITY.md) describes.

Contact: <jl@joseluissaorin.com>.

**Continuity.** If the editor cannot be reached for 90 days, the maintainers of the
first-tier implementations that pass the conformance suite MAY convene an interim
committee by the rules below, to keep the specification and the repository alive until
the editor returns or a technical committee is formed.

## Phase 2: the technical committee

### When it is formed

The editor calls for a technical committee within 90 days after both conditions hold:

1. **three independent implementations** (in the sense of
   [`RFC-PROCESS.md`](RFC-PROCESS.md#independent-implementations)) pass the whole
   conformance suite of the current version; and
2. they are maintained by **at least two organizations** independent of each other. The
   editor and the projects he leads count as one organization; a person maintaining an
   implementation on their own counts as their own organization.

The editor MAY call for the committee earlier.

### Composition

- Between 5 and 7 members.
- The editor holds a seat while the role of editor exists.
- At least two members are maintainers of implementations that pass the suite, and at
  least one member represents users of the format (a library, archive, publisher or
  research group) rather than an implementation.
- **No organization holds more than one third of the seats** (rounded down, minimum
  one). If a member changes employer and the limit is exceeded, a seat is renewed early.
- Terms are two years and staggered, so that about half the seats are renewed each year.

### How members are chosen

- **First committee.** The editor opens a public call for nominations for 30 days
  (self-nominations welcome), publishes the candidates and their affiliations, and
  proposes a committee that meets the composition rules. It is confirmed unless a
  sustained objection, with reasons, is raised within 14 days; objections are resolved
  in public before the committee takes office.
- **Later renewals.** Elections with approval voting. Voters are people with at least one
  merged contribution to the specification, the conformance suite or an implementation
  in the previous 24 months, plus the named maintainers of implementations. Ties are
  broken by the public random procedure of RFC 3797.
- Vacancies are filled for the rest of the term by the same method, or by co-option
  confirmed as for the first committee when fewer than 6 months remain.

### The editor under the committee

The editor keeps writing and maintaining the specification and running the RFC process,
and is a member of the committee. Disputed decisions are taken by the committee. The
committee may appoint additional editors, and may replace the editor by a two-thirds
majority of its members.

## Making decisions

1. **Consensus first.** Decisions are sought by consensus: no sustained objection
   remains after discussion. Routine matters use lazy consensus: a proposal announced in
   public stands if nobody objects within 7 days.
2. **Voting when consensus fails.** Only when the discussion has been given a fair chance
   and progress requires a decision, the committee votes. A quorum is a majority of its
   members. Decisions take a simple majority of the members voting, except:
   - a new **major version** of the specification, changes to this document,
     [`RFC-PROCESS.md`](RFC-PROCESS.md) or [`VERSIONING.md`](VERSIONING.md), and
     replacing the editor need **two thirds of all members**;
   - the licences cannot be changed to anything less open than they are (see below).
3. **Records.** Every decision is recorded in public, in the RFC, issue or pull request it
   concerns, with the reasons and, for votes, who voted how. Meetings may be held, but
   their decisions are tentative until written down there, and anyone may object within
   7 days of publication, giving technical reasons.
4. In phase 1 the editor takes decisions by the same standard: consensus sought first,
   reasons recorded, objections answered in writing.

## Conflicts of interest

- Committee members and the editor publish their affiliations, employers and funding
  related to SPDF, and keep that information current.
- A member MUST disclose any direct interest in a decision (for example, a proposal that
  favours or harms a product of their employer) and SHOULD abstain from voting on it.
  They may still take part in the discussion.
- The editor's own products, among them Scholaris and SPDF Reader, are declared
  interests. While no committee exists, decisions that would give them an advantage over
  other implementations are explained in writing and remain open to appeal.

## Appeals

- Anyone affected by a decision may appeal it in writing within **30 days** of its
  publication, giving the reasons and the outcome they seek.
- **Phase 1:** the appeal goes to the editor, who reconsiders and answers in public
  within 30 days. If the appellant is not satisfied, the appeal stays on record and the
  first committee reviews it if the matter is still open.
- **Phase 2:** the appeal goes to the whole committee, which answers within 30 days.
  Members who took the decision under appeal may speak, but the outcome needs a majority
  of the members who did not. The committee's answer is final.
- Appeals do not suspend a decision unless the editor or the committee says so.
- The licences allow anyone to fork the specification at any time. Forks are welcome to
  build on SPDF, but files and implementations that do not follow this specification
  must not be presented as conforming SPDF.

## Claims of conformance

An implementation may describe itself as conforming to SPDF *version* for the kinds of
case it claims only if it passes every case of those kinds in a suite that targets that
version, and its report (`conformance.json`) is public. Partial support is welcome and
should be described as such.

## Code of conduct

Everyone who takes part follows the [Contributor Covenant 2.1](../CODE_OF_CONDUCT.md).

- **Phase 1:** reports go to the editor at <jl@joseluissaorin.com>. Reports concerning the
  editor himself are recorded, and the reporter may ask for them to be reviewed by an
  independent mediator agreed with them, or by the first committee.
- **Phase 2:** the committee names two of its members as conduct contacts. A person who
  is the subject of a report, or has a conflict of interest in it, takes no part in
  handling it.
- Reports are kept confidential, as the code of conduct requires.

## Licences and patents

- The **specification and the documentation** are licensed under
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
  (CC BY 4.0).
- The **code** in this repository (libraries, the reference producer, the reader, the
  conformance suite, the website) is licensed under the MIT licence or the Apache
  License 2.0, at the user's choice (`MIT OR Apache-2.0`).
- Contributions are accepted under the same licence as the part of the repository they
  change (inbound = outbound), without a contributor licence agreement or a Developer
  Certificate of Origin sign-off for now (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- **Patent commitment.** José Luis Saorín Ferrer, as author and editor, commits not to
  assert any patent claim that he owns or controls, now or in the future, against
  anyone for making, using, selling, offering, importing or distributing an
  implementation of the SPDF specification. Every contributor to the specification
  makes the same commitment, by the act of contributing, for the patent claims they own
  or control that would necessarily be infringed by implementing the text they
  contributed. The commitment is irrevocable.
- No decision of the editor or of the committee may relicense the specification under
  terms less open than CC BY 4.0, or the code under terms less open than
  `MIT OR Apache-2.0`. Versions already published keep their licences in any case.

## Where the project lives

- Repository: <https://github.com/joseluissaorin/spdf>. It is private until the
  specification, the conformance suite and the first-tier libraries pass, and public
  afterwards. If a GitHub organization `spdf-format` is created, the repository moves
  there.
- Website: <https://spdf.joseluissaorin.com>.
- The editor or the committee may later propose to continue the work in a standards
  venue (for example a W3C Community Group). Such a move is decided by RFC and keeps
  the licences and the patent commitment above.

## Changing this document

This document changes by RFC, with the same discussion and final comment periods as the
specification. Under the committee, the change needs two thirds of all members.
