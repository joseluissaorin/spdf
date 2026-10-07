# Citable Processed Documents Community Group Charter

> **Borrador sin enviar.** Propuesta de carta (*charter*) para un Community Group de
> W3C que se ocupe de SPDF y de su modelo de anclas. Sigue la plantilla oficial de
> cartas de Community Group (`w3c/cg-charter`, comprobada el 7-10-2026); los apartados
> de proceso, contribución, transparencia, elección de presidentes y enmiendas son su
> texto, adaptado lo mínimo.
>
> Vía: se propone un grupo nuevo desde <https://www.w3.org/community/groups/proposed/>
> con una cuenta de W3C (gratuita; no hace falta ser miembro de W3C ni pagar). Según el
> proceso de los Community Groups, la propuesta está completa con un nombre que no use
> otro grupo, una descripción del alcance y el apoyo de cinco personas; entonces W3C
> anuncia el grupo. La carta se aprueba después, dentro del grupo. Por verificar si
> W3C pide ahora redactar las cartas en el repositorio `w3c-cg/charter-proposals`.
>
> Falta antes de proponerlo:
>
> 1. **Nombre.** Aquí «Citable Processed Documents Community Group», que describe el
>    problema y no el producto; la alternativa es «SPDF Community Group». Comprobar que
>    no existe ya un grupo con ese nombre.
> 2. **Cinco apoyos**, mejor de organizaciones distintas (implementadores, bibliotecas,
>    archivos, editores de TEI o IIIF), y un **segundo presidente** ajeno al proyecto.
> 3. **Licencias.** Las contribuciones a las especificaciones del grupo quedan bajo el
>    CLA de W3C y los informes finales, bajo su acuerdo de especificación final (FSA).
>    La especificación SPDF actual es CC BY 4.0, que permite aportarla, pero conviene
>    confirmar con el Community Development Lead de W3C cómo conviven las dos licencias
>    y si el repositorio puede seguir con MIT OR Apache-2.0 para el código y la batería.
> 4. Decidir por RFC, según `governance/GOVERNANCE.md`, si la especificación pasa a
>    desarrollarse en el grupo o el grupo solo la revisa; y que el repositorio sea
>    público.

---

- **Status:** draft. This charter is a work in progress. To submit feedback, please use
  the issues of the repository where it is being developed: [repository URL].
- **This charter:** [URI]
- **Previous charter:** none
- **Start date:** [date the charter takes effect]
- **Last modified:** 2026-10-07

## Goals

The mission of the Citable Processed Documents Community Group is to develop open,
royalty-free specifications that let a document be **read once and cited forever**: a
portable file format that keeps the text read from a book, scan, recording, slide deck,
spreadsheet or web page together with the exact location of every passage in its source
(printed page and folio, leaf, column, verse, canonical reference, time, slide), so that
people, software and language-model agents can quote and cite it without approximation.

The group starts from SPDF (Semantic Processed Document Format), version 5.0, an open
specification with a conformance suite and implementations in several programming
languages, and aims to make it a shared community specification, aligned with the W3C
and other standards that already address annotation, fragments, bibliographic metadata
and digital editions.

## Scope of work

The group will work on:

- **The SPDF file format**: the container (a single SQLite 3 database), its schema, the
  CSL-JSON metadata profile, text normalization and offsets, rights and provenance
  information, vector spaces for semantic search, integrity and signatures, profiles,
  extensions, and the reading of earlier versions.
- **The anchor model and the anchor URI**: how a location in a document is described
  (pages and folios, leaves and columns, time ranges, sections and paragraphs, slides,
  spreadsheet rows, verses, canonical references, character ranges and regions) and how
  it is written as a URI, keeping the syntax of W3C Media Fragments and RFC 5147 where
  they overlap.
- **Annotation and collection sidecars**: annotation files that use the W3C Web
  Annotation Data Model with an SPDF anchor selector, and collection manifests that list
  documents by hash.
- **Reference behaviour that must be identical across implementations**: canonical
  serialization, validation, reference search, short citations and exports.
- **A conformance test suite** for all of the above.
- **Mappings** between SPDF anchors and the location models of TEI, IIIF, ALTO, CTS and
  W3C Web Annotation.

Key use cases: verifiable citation in the humanities and social sciences; reading and
citing early printed books, manuscripts and classical texts by folio, verse or canonical
reference; citing oral history and recorded lectures to the second; archives and
libraries publishing searchable, citable derivatives of their holdings; language-model
agents that must quote a source and say exactly where.

## Out of scope

- Optical character recognition, speech recognition, embedding models and ranking
  methods beyond the reference behaviour that makes implementations interoperable.
- Specific products: readers, editors, producers or services.
- Citation styles, which belong to the Citation Style Language project; bibliographic
  vocabularies beyond the CSL-JSON profile.
- Changes to the Web Annotation, Media Fragments, IIIF, TEI, ALTO or CSL specifications
  themselves. The group may send them comments and requests.
- Encryption, access control and digital rights management.
- Protocols for storing, synchronizing or serving documents.

## Deliverables

### Specifications

- **SPDF: Semantic Processed Document Format.** The file format, its anchor model and
  anchor URI, starting from version 5.0. Estimated: a first Community Group Report within
  12 months of the group's start.
- **SPDF annotation and collection sidecars.** The `.spdfa.json` profile of W3C Web
  Annotation with the SPDF anchor selector, and the `.spdfl.json` collection manifest.
  This may be published as part of the format specification or as a separate report.

### Non-normative reports

The group may produce other Community Group Reports within the scope of this charter that
are not Specifications, for instance:

- Use cases and requirements for citable processed documents.
- Mapping notes between SPDF anchors and TEI, IIIF, ALTO, CTS and CSL locators.
- Implementation reports based on the conformance suite.

### Test suites and other software

The group MAY produce test suites to support the Specifications. The SPDF conformance
suite already exists and will be maintained by the group. Please see the GitHub LICENSE
file for test suite contribution licensing information.

## Dependencies or liaisons

- W3C *Web Annotation Data Model* and *Vocabulary* (Recommendations, 2017): annotation
  sidecars and selectors.
- W3C *Media Fragments URI 1.0 (basic)* (Recommendation, 2012): time and spatial
  parameters of the anchor URI.
- IETF: RFC 5147 (character ranges), RFC 8785 (JSON canonicalization), RFC 8032
  (Ed25519), and IANA registrations for the media type `application/vnd.spdf` and the
  `spdf` URI scheme.
- IIIF Consortium: Presentation API 3.0 and the region syntax of the Image API, for
  exports and mappings.
- TEI Consortium: TEI P5, for exports and for the citation practices of digital
  editions.
- Citation Style Language project: the CSL-JSON schema used for metadata.
- Library of Congress: ALTO.
- The CITE architecture: CTS URNs for canonical references.
- SQLite: the file format and the `application_id` registry in its source tree.
- Digital preservation registries: PRONOM (The National Archives, UK) and the Library of
  Congress *Sustainability of Digital Formats*.

## Community and Business Group Process

The group operates under the Community and Business Group Process. Terms in this
Charter that conflict with those of the Community and Business Group Process are void.

As with other Community Groups, W3C seeks organizational licensing commitments under the
W3C Community Contributor License Agreement (CLA). When people request to participate
without representing their organization's legal interests, W3C will in general approve
those requests for this group with the following understanding: W3C will seek and
expect an organizational commitment under the CLA starting with the individual's first
request to make a contribution to a group Deliverable. The section on Contribution
Mechanics describes how W3C expects to monitor these contribution requests.

The W3C Code of Conduct and the W3C Antitrust and competition policy apply to
participation in this group.

## Work limited to charter scope

The group will not publish Specifications on topics other than those listed under
Specifications above. See below for how to modify the charter.

## Contribution mechanics

Substantive Contributions to Specifications can only be made by Community Group
Participants who have agreed to the W3C Community Contributor License Agreement (CLA).

Reports other than Specifications published by this group should use the W3C Software
and Document License where possible.

Community Group participants agree to make all contributions in the GitHub repository the
group is using for the particular document. This may be in the form of a pull request
(preferred), by raising an issue, or by adding a comment to an existing issue.

All GitHub repositories attached to the Community Group must contain a copy of the
CONTRIBUTING and LICENSE files.

## Transparency

The group will conduct all of its technical work in public. All technical work will
occur in its GitHub repositories (and not in mailing list discussions). This is to
ensure contributions can be tracked through a software tool.

Meetings may be restricted to Community Group participants, but a public summary or
minutes must be posted to a GitHub issue.

## Decision process

This group will seek to make decisions where there is consensus. Normative changes to
the Specifications follow a request-for-comments process: a proposal is discussed in
public for at least 14 days, followed by a 7-day final comment period, and the Chairs
assess consensus. **An accepted proposal lands with at least one conformance case; it is
considered implemented when two independent implementations pass it.** A Specification
is published as a final Community Group Report only with implemented proposals.

Where consensus is not clear, the Chairs may issue a Call for Consensus to allow
multi-day online feedback for a proposed course of action. It is expected that
participants can earn Committer status through a history of valuable contributions, as
is common in open source projects. After discussion and due consideration of different
opinions, a decision should be publicly recorded as the resolution of a GitHub issue.

If substantial disagreement remains (e.g., the group is divided) and the group needs to
decide an Issue in order to continue to make progress, the Committers will choose an
alternative that had substantial support (with a vote of Committers if necessary).
Individuals who disagree with the choice are strongly encouraged to take ownership of
their objection by taking ownership of an alternative fork. This is explicitly allowed
(and preferred to blocking progress) to let implementation experience inform which spec
is ultimately chosen by the group to move ahead with.

Any decisions reached at any meeting are tentative and should be recorded in a GitHub
Issue. Any group participant may object to a decision reached at an online or in-person
meeting within 7 days of publication of the decision provided that they include clear
technical reasons for their objection. The Chairs will facilitate discussion to try to
resolve the objection according to this decision process.

It is the Chairs' responsibility to ensure that the decision process is fair, respects
the consensus of the CG, and does not unreasonably favor or discriminate against any
group participant or their employer.

## Chair selection

Participants in this group choose their Chair(s) and can replace their Chair(s) at any
time using whatever means they prefer. However, if 5 participants, no two from the same
organization, call for an election, the group must use the following process to replace
any current Chair(s) with a new Chair, consulting the Community Development Lead on
election operations (e.g., voting infrastructure and using RFC 3797).

- Participants announce their candidacies. Participants have 14 days to announce their
  candidacies, but this period ends as soon as all participants have announced their
  intentions. If there is only one candidate, that person becomes the Chair. If there
  are two or more candidates, there is a vote. Otherwise, nothing changes.
- Participants vote. Participants have 21 days to vote for a single candidate, but this
  period ends as soon as all participants have voted. The individual who receives the
  most votes, no two from the same organization, is elected chair. In case of a tie,
  RFC 3797 is used to break the tie. An elected Chair may appoint co-Chairs.

Participants dissatisfied with the outcome of an election may ask the Community
Development Lead to intervene. The Community Development Lead, after evaluating the
election, may take any action including no action.

Proposed initial Chairs: José Luis Saorín Ferrer (editor of SPDF), and a second Chair
from another organization, to be identified before the group is proposed.

## Amendments to this charter

The group can decide to work on a proposed amended charter, editing the text using the
Decision Process described above. The decision on whether to adopt the amended charter
is made by conducting a 30-day vote on the proposed new charter. The new charter, if
approved, takes effect on either the proposed date in the charter itself, or 7 days
after the result of the election is announced, whichever is later. A new charter must
receive 2/3 of the votes cast in the approval vote to pass. The group may make simple
corrections to the charter such as deliverable dates by the simpler group decision
process rather than this charter amendment process. The group will use the amendment
process for any substantive changes to the goals, scope, deliverables, decision process
or rules for amending the charter.

## Licensing

- Specifications: contributions under the W3C Community Contributor License Agreement
  (CLA); final reports under the W3C Community Final Specification Agreement (FSA). The
  SPDF specification brought to the group is already published under CC BY 4.0, and
  that publication remains available under its licence.
- Other reports: the W3C Software and Document License where possible.
- Test suites and software: as stated in the LICENSE file of the repository (currently
  MIT OR Apache-2.0).
- The editor of SPDF and its contributors have committed not to assert patents against
  implementations of the specification; the CLA and the FSA add W3C's royalty-free
  patent commitments for contributions made in the group.
