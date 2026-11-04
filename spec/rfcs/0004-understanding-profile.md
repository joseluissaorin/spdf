# RFC 0004: The `understanding` profile

- **Status**: Draft
- **Authors**: José Luis Saorín Ferrer <jl@joseluissaorin.com> (editor); drafted by the
  SPDF team of Scholaris *Comprensión*
- **Created**: 2026-11-04
- **Discussion**: this file, until the editor opens the discussion
- **Specification**: SPDF 5.1, minor (additive)
- **Affects**: SPEC §3 (six OPTIONAL tables; `vectors.target` value `card`; `spdf_meta` key
  `understanding_sha256`), §4.1 (time anchor member `span`), §10 (profile `understanding`),
  §12 (understanding dump), §13 (integrity), §15 and §16 (privacy, rights), §17.1
  (annotations 1.1), §22 (validation step and codes); `spec/schema/spdf-5.1.sql` (written on
  acceptance); `spec/json-schema/understanding.schema.json`; a new kind of conformance case,
  `understanding_dump`
- **Conformance cases**: added to suite 0.4.3, because they test 5.0 behaviour the profile
  relies on: `uri-time-instant-region`, `uri-time-instant-span`, `uri-page-chars-region`,
  `uri-parse-time-region-clock`, `validate-OK-optional-extension`,
  `dump-OK-optional-extension`, `validate-W105-newer-minor-understanding`. Proposed for
  acceptance: see [Conformance cases](#conformance-cases)
- **Supersedes / superseded by**: none
- **Decision**: pending

## Summary

An SPDF file today says *what a document says and where*: its text, unit by unit, with
anchors to the printed page, the folio, the second or the slide. This RFC adds an optional
layer that says *what the document is and how it is built*, as a specialist who had studied
it would note it: its structure (chapters, scenes, shots, poems, stanzas), analytical
**cards** written with the vocabulary of a discipline (narratology, film analysis, prosody,
argumentation), the **entities** that appear in it with their Wikidata identifiers, every
**appearance** of an entity anchored to the exact material place (characters of a page, the
region of a frame at a given second, a voice in a span), **relations** between works (this
film adapts that story, this book translates that one) and fine **alignments** inside a
relation (this scene corresponds to that passage, and here is what changes). Every claim
carries **evidence**: a list of anchors with the literal quotation or a description of what
is seen or heard. The layer is declared by a new profile, `understanding`, and readers of
5.0 ignore it.

## Motivation

Scholaris, one of the two SPDF producers, already computes this layer for every document of
a library (its documentation calls it *comprensión*), and stores it in its internal schema
and, under 5.0, as the optional extension `scholaris_comprension`. Three things make a
standard place for it worth having.

**It is expensive and durable.** Reading a feature film or a novel with a frontier model,
window by window with the whole work in context, and writing anchored cards per scene costs,
measured on 2026-11-04, between 0.09 and 0.16 USD and about a minute per batch of segment
cards. The result does not change unless the reading changes. Today it lives in the
producer's database: when the `.spdf` moves to another library, another reader or an archive,
the analysis stays behind and every reader recomputes it, or does without it.

**Readers need it to answer real questions.** A reader holding a film and the short story it
adapts cannot answer "how does the function of this place change between the story and the
film, how is the first scene shot, and who dominates the frame?" from fragments alone. It
needs the scene and shot structure of the film, cards that analyse each scene with the
vocabulary of film analysis, the characters as entities shared by both works, where each
character is visible (a region of a frame at a second), and the alignment of scenes with
passages. 5.0 has `sections` (a heading tree), `figures` and `fragments`; none of them can
hold a shot, a claim with its evidence, a character or a correspondence between two works.

**Without a standard, vendors diverge.** The extension mechanism (SPEC §11) already lets a
producer write `x_<vendor>_<name>` tables, and Scholaris does. A second producer would write
its own, with other names and other anchors, and no reader could rely on either. The
conformance suite cannot test an extension.

What the layer must guarantee, learnt from building it:

- **Material anchoring.** Every derived statement (a card, an appearance, an alignment) points
  to evidence: document, anchor and, when the medium allows, the exact position: characters of
  the unit text, a region of the page or frame image, the instant of a video frame, the speaker.
  What has no evidence is marked as such and is never quoted as fact.
- **Layers, not substitution.** The literal layer (units and fragments) is untouched. The
  understanding layer is derived, versioned (model, prompt and schema version, date) and can be
  recomputed.
- **One grammar for every medium.** Books, articles, manuscripts, films, lectures, interviews,
  podcasts, slides and sheets share the same structures.
- **Language-independent identity.** Entities are normalized with Wikidata identifiers; cards
  are written in the document's language; quotations are always in the original.

## Guide-level explanation

Six tables hold the layer. They have the same columns as the Scholaris prototype, without the
vendor prefix:

| Table | One row is | Key columns |
|---|---|---|
| `segments` | a part of the document in its structure tree: part, chapter, scene, shot, act, poem, stanza, topic of a lecture, turn of an interview | `parent`, `level`, `ord`, `kind`, `title`, `anchor`, `anchor_end`, `unit_from`, `unit_to`, `origin` |
| `cards` | the analysis of something (the whole document, a segment, an entity, a figure or a relation) through a lens | `target`, `target_id`, `lens`, `class`, `language`, `text`, `data`, `evidence`, `model`, `version`, `created` |
| `entities` | a person, character, work, place, organization, concept, event, date or object that appears in the document | `kind`, `name`, `aliases`, `wikidata`, `description`, `fictional` |
| `appearances` | one place where an entity is in the material, with its role | `entity`, `segment`, `anchor`, `anchor_end`, `form`, `role` |
| `relations` | a link between this document and another work (or between two entities) | `source`, `target`, `kind`, `evidence`, `origin` |
| `alignments` | a fine correspondence inside a relation | `relation`, `ord`, `kind`, `doc_a`, `anchor_a`, `doc_b`, `anchor_b`, `note` |

Card vectors go in the core `vectors` table with the new target `card`, in a space of
`spaces`, so that a reader searches the analysis with the same query vector as the text.

A worked example on the corpus document `minimo` (Bécquer, *Rimas* XXI and LIII, 1885; the
whole layer is in [`conformance/tools/manual/understanding.json`](../../conformance/tools/manual/understanding.json)).
The poem is a segment:

```json
{"id": "s-xxi", "parent": null, "level": 1, "ord": 1, "kind": "poem", "title": "XXI",
 "anchor": {"type": "section", "path": ["XXI"], "paragraph": 1, "printed": "159"},
 "anchor_end": null, "unit_from": "u1", "unit_to": "u1",
 "summary": "La pregunta por la poesía se contesta señalando a quien pregunta.",
 "origin": "read", "confidence": 1, "t0": null, "t1": null}
```

A card analyses it through the lens of poetry, and every claim it makes has evidence (one of
its three pieces is shown):

```json
{"n": 1, "id": "c-xxi", "document": "minimo", "target": "segment", "target_id": "s-xxi",
 "lens": "poetry", "class": "poem", "language": "es",
 "text": "Cuatro versos. La pregunta de la amada abre el primero y vuelve al comienzo del tercero (anáfora); el último verso la contesta sin definir la poesía: la identifica con quien pregunta.",
 "data": {"verses": 4, "figures": ["anaphora"]},
 "evidence": [
   {"doc": "sha256-cfc8a2dcf65ec4eee72e3980eb2a4d0e5ec76fb016a8381a580f525ca3b862cc",
    "anchor": {"type": "section", "path": ["XXI"], "paragraph": 1, "printed": "159", "chars": [106, 124]},
    "quote": "Poesía... eres tú.", "mode": "text", "unit": "u1"}],
 "model": "hand-written", "version": "rfc-0004", "created": "2026-11-04T00:00:00Z"}
```

The evidence is a place a reader can open and cite: its anchor URI is
`spdf:sha256-cfc8…62cc#f=159&s=XXI&para=1&char=106,124`, and its short citation is
`(Bécquer, 1885, p. 159)`. Because `quote` is literal text in `text` mode, a reader can check
it against the unit: the code points [106, 124) of unit `u1` are exactly "Poesía... eres tú.".

The concept of poetry is an entity with its Wikidata identifier, and the same verse is an
appearance in which the poem *defines* it:

```json
{"id": "e-poesia", "kind": "concept", "name": "poesía", "aliases": [], "wikidata": "Q482",
 "description": null, "fictional": null}
{"id": "a3", "entity": "e-poesia", "segment": "s-xxi",
 "anchor": {"type": "section", "path": ["XXI"], "paragraph": 1, "printed": "159", "chars": [106, 124]},
 "anchor_end": null, "form": "Poesía... eres tú.", "role": "defined", "confidence": 1, "t0": null, "physical": null}
```

In a film, what is seen in a frame is anchored to the instant of that frame, with the region
where it is, and the shot it belongs to as `span`:

```json
{"type": "time", "t0": 3723.5, "t1": 3723.5, "span": [3720, 3731],
 "region": {"x": 0.25, "y": 0.1, "w": 0.3, "h": 0.6}}
```

Its URI, `#t=3723.5,3723.5&xywh=percent:25,10,30,60`, is a W3C Media Fragment: the region of
the frame at 1:02:03.5. A 5.0 reader already formats and parses it (cases
`uri-time-instant-region` and `uri-time-instant-span`), and seeks to the right frame.

A relation says that this document adapts, translates or edits another, named by its docref;
its alignments pair spans of the two:

```json
{"id": "r1", "source": "sha256-<film>", "target": "sha256-<story>", "kind": "adaptation_of",
 "note": "…", "evidence": […], "confidence": 0.9, "origin": "model", "created": "…"}
{"id": "al1", "relation": "r1", "ord": 1, "kind": "transformed",
 "doc_a": "sha256-<film>", "anchor_a": {"type": "time", "t0": 0, "t1": 192}, "anchor_end_a": null, "segment_a": "sc1",
 "doc_b": "sha256-<story>", "anchor_b": {"type": "page", "physical": 9, "printed": "7", "chars": [0, 640]}, "anchor_end_b": null, "segment_b": null,
 "note": "The opening walk is shot from below; the story tells it in the first person.", "confidence": 0.8}
```

A reader that holds both files resolves each docref by its source hash, opens both at the
aligned places and shows the note. A reader that holds only one shows the anchor of the
other, which still says where to look.

Readers search cards as they search fragments. The file holds no full-text index for cards
(a 5.0 reader would refuse an unknown virtual table, SPEC §2.4), so a reader that wants one
builds it on a private copy or in memory, with the same tokenizer as `fragments_fts`.

**Before 5.1.** Producers carry the layer as an optional 5.0 extension with the same columns
under their vendor prefix. Scholaris writes `scholaris_comprension` version 1.0
(`x_scholaris_segments`, …, plus `x_scholaris_vectors` for card vectors, because 5.0 does not
allow the target `card`). Moving to 5.1 is renaming the tables, moving the card vectors to
`vectors` and declaring the profile. A file MUST NOT carry both.

## Normative changes

### 1. Schema (SPEC §3)

Add to §3.1, after `extensions`, the OPTIONAL tables of the profile `understanding`. They are
REQUIRED in a file whose `profile` includes `understanding`, and MAY be empty. A file that
has one of them has all six.

```sql
CREATE TABLE segments (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL, ord INTEGER NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, anchor TEXT NOT NULL, anchor_end TEXT, unit_from TEXT NOT NULL,
  unit_to TEXT NOT NULL, summary TEXT, origin TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, t0 REAL, t1 REAL);
CREATE INDEX segments_ord ON segments(document, ord);
CREATE TABLE cards (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT, target TEXT NOT NULL, target_id TEXT NOT NULL,
  lens TEXT NOT NULL, class TEXT NOT NULL, language TEXT, text TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '[]', model TEXT NOT NULL, version TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX cards_target ON cards(target, target_id);
CREATE TABLE entities (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  wikidata TEXT, description TEXT, fictional INTEGER);
CREATE TABLE appearances (
  id TEXT PRIMARY KEY, entity TEXT NOT NULL, document TEXT NOT NULL, segment TEXT, anchor TEXT NOT NULL,
  anchor_end TEXT, form TEXT NOT NULL, role TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, t0 REAL, physical INTEGER);
CREATE INDEX appearances_entity ON appearances(entity);
CREATE TABLE relations (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, note TEXT,
  evidence TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1, origin TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE alignments (
  id TEXT PRIMARY KEY, relation TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL,
  doc_a TEXT, anchor_a TEXT, anchor_end_a TEXT, segment_a TEXT, doc_b TEXT, anchor_b TEXT, anchor_end_b TEXT, segment_b TEXT,
  note TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 1);
CREATE INDEX alignments_relation ON alignments(relation, ord);
```

New subsection §3.13 *The understanding layer*:

- **`segments`**. The structure tree. `level` starts at 1; `parent` is the enclosing segment
  or NULL; `ord` is the position in reading order over the whole tree in preorder (unique
  integers, not necessarily contiguous). `kind` is an open vocabulary token (§6 below).
  `anchor` locates the start and `anchor_end` the end, both anchors of this document; `unit_from`
  and `unit_to` are the first and last unit ids. `origin` says where the segment comes from:
  `read` (the document's own table of contents or headings), `inferred` (deduced from the
  layout) or `model`. `t0` and `t1` are denormalized for time anchors (`anchor.t0` and the `t1` of
  `anchor_end`, or of `anchor`) and NULL otherwise. Segments of a high level SHOULD also be
  written as `sections` when the document has no heading tree of its own, so that 5.0 readers
  can navigate them.
- **`cards`**. `target` is `document`, `segment`, `entity`, `figure` or `relation`, and
  `target_id` the id of that row (for `document`, the document id). `lens` names the discipline
  whose vocabulary the card uses and `class` what the card is (`global`, `scene`, `shot`,
  `poem`, `character`, `argument`…); both are open tokens. `text` is analytical prose in
  `language` (BCP 47, normally the document's); it is what readers show and search. `data` is a
  JSON object whose members are defined by the lens; `version` identifies the lens schema and
  the prompt that produced the card, and `model` the model (or `hand-written`). `document` is
  the document id, or NULL for a card about something beyond this document (a relation, an
  entity across works). `n` is a stable integer rowid for indexes built by readers.
- **`entities`**. Only the entities that appear in this document (through its appearances,
  cards or relations). `kind` is one of `person`, `work`, `place`, `organization`, `concept`,
  `event`, `date`, `object`, `other`; `fictional` is 1 for a character, 0 for a real person or
  thing, NULL when unknown or not applicable. `wikidata` is a Wikidata item id (`^Q[1-9][0-9]*$`)
  or NULL; producers MUST NOT invent one: it is set only when a source or a check supports it,
  and a character is never linked to the real person it echoes. `aliases` is a JSON array of
  the other forms the entity takes in the document.
- **`appearances`**. `entity` is an id of `entities`, `segment` an id of `segments` or NULL;
  `form` is how the entity appears ("Diego", "a silhouette by the window"); `role` is `named`,
  `alluded`, `present`, `speaks`, `visible`, `audible`, `quoted`, `defined` or `other`. `t0` is
  `anchor.t0` for time anchors and `physical` is `anchor.physical` for page anchors, NULL
  otherwise.
- **`relations`**. `source` and `target` are each a docref (SPEC §5.1: `sha256-` and the
  source hash, or a document id) or `entity:` followed by an id of `entities`. One of them is
  normally this document. `kind` is `adaptation_of`, `translation_of`, `edition_of`,
  `version_of`, `cites`, `comments_on`, `responds_to`, `part_of`, `same_work`, `portrays`
  (an actor portrays a character: Wikidata P161 with qualifier P453) or `related`, read as
  "source *kind* target". `origin` is `metadata`, `wikidata`, `model` or `user`.
- **`alignments`**. `relation` is an id of `relations`; side `a` belongs to the relation's
  source and side `b` to its target. `doc_a` and `doc_b` are docrefs; `anchor_*` are anchors of
  those documents; `segment_*` are segment ids of that document when known (an id of another
  document is opaque and MAY be unresolvable). `kind` is `equivalent`, `translated`,
  `condensed`, `expanded`, `transformed`, `reordered`, `added`, `omitted` or `allusion`.
  `added` has side `a` only, `omitted` side `b` only, every other kind both sides; an absent
  side has NULL in its four columns. `note` says what changes and with what effect.

### 2. Evidence

`cards.evidence` and `relations.evidence` are JSON arrays of evidence objects:

| member | | |
|---|---|---|
| `doc` | REQUIRED | docref of the document the evidence is in; for this document, its own docref |
| `anchor` | REQUIRED | an anchor (§4) of that document |
| `anchor_end` | OPTIONAL | end anchor, same type |
| `mode` | REQUIRED | `text`, `image`, `video`, `audio` or `data` |
| `quote` | OPTIONAL | in `text` mode, literal text of the document in its original language and spelling; in other modes, a description of what is seen or heard |
| `unit`, `fragment`, `figure` | OPTIONAL | ids of rows of that document, as hints |

Rules:

1. A claim of a card or relation that the evidence does not support is an interpretation.
   Writers MUST NOT present inferred facts as evidence, and readers MUST NOT present a card's
   `text` or a `quote` in a non-text mode as a quotation of the document.
2. In `text` mode with `chars` in the anchor and `unit` given, `quote` MUST be, when written,
   the code points `chars` of that unit's NFC text. Writers SHOULD set both whenever they can.
   A later correction of the text layer can break the match, so validators report it as W108,
   a warning.
3. The anchor URI of an evidence object is `format(doc, anchor, anchor_end)` (§5.2); that is
   how readers link and cite it (§18).

### 3. Material precision (SPEC §4)

Writers SHOULD give the finest location they can verify, and MUST NOT give a finer one than
they can: no invented characters, regions or instants, as no invented folios (§4.2).

- Text: `chars` in the unit text.
- Page, slide or still image: `region` of the unit image, with `chars` when the text is known.
- Something seen in a video frame: a `time` anchor with `t0 = t1` = the time of the frame, and
  `region`. The enclosing span (the shot, the utterance) MAY be given in the new member `span`.
- Speech: a `time` anchor with `speaker`, and the span of the words when word timings exist.

Add to §4.1, as an OPTIONAL member of `time` anchors: "`span`: `[start, end]`, seconds, `start
≤ t0 ≤ t1 ≤ end`: the interval (a shot, an utterance) that contains the instant or span of the
anchor. It does not take part in the anchor URI nor in citations." A 5.0 reader keeps it as an
unknown member, which §4.1 already requires.

### 4. Vocabularies

Closed vocabularies: `segments.origin`, `cards.target`, `entities.kind`, `appearances.role`,
`relations.kind`, `relations.origin`, `alignments.kind` and evidence `mode`. A value a reader
does not know (a later minor may add values) is kept, reported by validators as W106, and
treated as `other` (role, entity kind), `related` (relation kind), `transformed` (alignment
kind), `model` (origin) or `data` (mode); a card with an unknown `target` keeps its text but
links nothing.

Open vocabularies: `segments.kind`, `cards.lens`, `cards.class`: lowercase ASCII tokens
(`^[a-z][a-z0-9_]*$`). RECOMMENDED values for `kind`: `work`, `part`, `chapter`, `section`,
`sequence`, `scene`, `shot`, `act`, `tableau`, `poem`, `stanza`, `topic`, `block`, `turn`,
`slide`, `table`, `folio`, `article`, `other`; for `lens`: `narrative`, `poetry`, `drama`,
`film`, `documentary`, `journalism`, `interview`, `podcast`, `lecture`, `essay`, `scientific`,
`archival`, `legal`, `data`, `presentation`, `general`.

### 5. Vectors (SPEC §3.9, §9)

`vectors.target` MAY also be `card`, with `vectors.id` an id of `cards`. Card vectors live in
spaces of `spaces` like any other; the reference vector search (§8.2) gains the target `card`,
ordered by score and then by `cards.n`. Hybrid search is unchanged (fragments only).

### 6. Profile (SPEC §10)

Add to the table: `understanding`: "The six tables of §3.13; every anchor in them valid; every
reference resolvable (E120); `understanding_sha256` present and correct (E083). A file that
declares the profile without the tables, or with all of them empty, raises W104." A file that
uses the tables writes `PRAGMA user_version = 510` and `spdf_version` `5.1`.

### 7. Understanding dump and integrity (SPEC §12, §13)

The canonical dump of §12 does not change. A new function `understanding_dump(file)` returns:

```jsonc
{"segments":    [{"id","parent","level","ord","kind","title","anchor","anchor_end","unit_from",
                  "unit_to","summary","origin","confidence","t0","t1"}],          // ORDER BY ord, id
 "cards":       [{"n","id","document","target","target_id","lens","class","language","text",
                  "data","evidence","model","version","created"}],                 // ORDER BY n
 "entities":    [{"id","kind","name","aliases","wikidata","description","fictional"}], // ORDER BY id
 "appearances": [{"id","entity","segment","anchor","anchor_end","form","role","confidence",
                  "t0","physical"}],                                               // ORDER BY id
 "relations":   [{"id","source","target","kind","note","evidence","confidence","origin","created"}], // ORDER BY id
 "alignments":  [{"id","relation","ord","kind","doc_a","anchor_a","anchor_end_a","segment_a",
                  "doc_b","anchor_b","anchor_end_b","segment_b","note","confidence"}]} // ORDER BY relation, ord, id
```

with the rules of §12 (every member present, NULL as `null`, JSON columns parsed, numbers
rounded to 6 decimals, BINARY order). The `document` column is dropped from `segments` and
`appearances` (it is always the document id) and kept in `cards` (where NULL means something).
Its JSON Schema is [`json-schema/understanding.schema.json`](../json-schema/understanding.schema.json).

New `spdf_meta` key `understanding_sha256`: the lowercase hex SHA-256 of the JCS
serialization of the understanding dump. Because it is a row of `spdf_meta`, it is part of the
canonical dump, so `content_sha256` and the signature (§13) cover the layer without changing
how they are computed. Validators of 5.1 recompute it (E083 on mismatch); validators of 5.0
check `content_sha256` as before and it still matches.

### 8. Validation (SPEC §22)

New step after step 12: "12a. If the file has the understanding tables (version 5.1 or later):
anchors of `segments`, `cards.evidence`, `appearances`, `relations.evidence` and `alignments`
(E040, E041, E042, with `where` = `<table>/<id>`); references (E120); evidence lists and rows
(E121); vocabularies (W106); quotations (W108)." Step 15 also recomputes
`understanding_sha256` (E083). Step 16 adds W104. New codes:

| code | meaning |
|---|---|
| E083 | `understanding_sha256` mismatch |
| E120 | unresolvable reference in the understanding layer: a segment `parent`, a card `target_id` in this file, an appearance `entity` or `segment`, an alignment `relation`, an `entity:` end of a relation, a `card` vector without its card |
| E121 | malformed row in the understanding layer: evidence that is not an array of objects with `doc`, `anchor` and `mode`; `data` that is not an object; `aliases` that is not an array of strings; `wikidata` that is not an item id; an alignment without the sides its `kind` requires |
| W104 | profile `understanding` without understanding tables, or with all of them empty |
| W106 | value outside a closed vocabulary of the understanding layer |
| W108 | a `text` quotation differs from the unit text at its `chars` |

### 9. Annotations, version 1.1 (SPEC §17.1)

The research memory of a reader (the evidence it collected, its notes, the answer it wrote)
stays outside the file, in a `.spdfa.json` sidecar, as §15 requires. Two additions make it
expressible:

- `spdf_annotations` `"1.1"`: an annotation's `target` MAY be an array of SPDF targets (the
  multiplicity of W3C Web Annotation §3.2.1), for notes and syntheses that rest on several
  pieces of evidence. A collection that uses an array declares 1.1; one that does not, 1.0.
  Readers of 1.0 skip annotations whose target they cannot read.
- RECOMMENDED for evidence: the `SpdfAnchorSelector` with the material anchor of §3 above; a
  `TextQuoteSelector` with the literal quotation and up to 32 code points of `prefix` and
  `suffix` from the verified passage; for time anchors, a `FragmentSelector` conforming to
  Media Fragments (`conformsTo` `http://www.w3.org/TR/media-frags/`) with the `t` and `xywh`
  of the URI. Motivations: `commenting` (a claim the evidence supports), `highlighting`,
  `questioning` (a hypothesis or an open question), `describing` (a synthesis).

`json-schema/annotation.schema.json` changes accordingly on acceptance (target: object or
non-empty array of objects).

### 10. Legacy (SPEC §20)

No change. Scholaris's internal 4.2 schema has Spanish-named equivalents of these tables
(`segmentos`, `fichas`, `apariciones`, `relaciones`, `alineaciones`); 4.2 is not a public
legacy version and the 5.0 view of a 4.x file ignores them.

## Conformance cases

**Added to suite 0.4.3.** They use only kinds that every runner already runs, and test 5.0
behaviour this profile relies on:

| id | kind | checks | expectation from |
|---|---|---|---|
| `uri-time-instant-region` | `anchor_uri` | an instant (`t0 = t1`) with a region formats as `t=…,…&xywh=percent:…` | hand-written, checked by the reference |
| `uri-time-instant-span` | `anchor_uri` | the member `span` takes no part in the URI | hand-written, checked by the reference |
| `uri-page-chars-region` | `anchor_uri` | `chars` and `region` together, in canonical order | hand-written, checked by the reference |
| `uri-parse-time-region-clock` | `anchor_uri` | an unordered URI with a clock time parses to the instant and the region | hand-written, checked by the reference |
| `validate-OK-optional-extension` | `validate` | `minimo` with the layer as the optional extension `scholaris_comprension`: valid, no warnings | the reference validator |
| `dump-OK-optional-extension` | `dump` | the same file dumps as `minimo` plus its row in `extensions` (extension tables are not in the dump, §11) | `minimo`'s source plus the row, not the dumper |
| `validate-W105-newer-minor-understanding` | `validate` | a 5.1 file with the six tables, `understanding_sha256` and a `card` vector: a 5.0 validator reports only W105 | the reference validator |

The layer is hand-written in its dump form in `conformance/tools/manual/understanding.json`
(public-domain text; every `quote` and `form` checked against the unit text). The generator
writes it into both files, reads it back with the understanding dump and stops if they
differ. The TypeScript library `spdf-format` 0.1.0, an independent implementation, passes the
seven cases.

**Proposed for acceptance** (new kind `understanding_dump`: input `file`, expect `dump` and
`understanding_sha256`; a runner that does not claim the profile skips the whole kind):

- `understanding-dump-minimo` on `files/minimo-understanding.spdf`, built from
  `sources/minimo.json` and `tools/manual/understanding.json`; and `roundtrip` of the same.
- `validate` cases, one rule each: `E083-understanding-sha256`, `E120-dangling-entity`,
  `E121-evidence-without-doc`, `W104-understanding-empty`, `W106-unknown-role`,
  `W108-quote-differs`.
- `search_vector` with target `card`.
- An annotations 1.1 example in `spec/examples/` checked against the updated schema.

## Backwards compatibility

- **Do existing files stay valid, with the same dump and `content_sha256`?** Yes. Nothing
  changes for files that do not use the tables.
- **What does a 5.0 reader do with a 5.1 file that uses the profile?** It reads it: §2.4 refuses
  only triggers, views and foreign virtual tables, and the layer adds plain tables; unknown
  tables, the `spdf_meta` key, the profile token, the anchor member `span` and the vector target
  `card` are ignored. Its default vector search filters by target `fragment`. The canonical
  dump is the same for a 5.0 and a 5.1 reader: the layer is in neither, `understanding_sha256`
  is in both as a meta row, and card vectors count in `vectors.<space>` for both, since that
  member does not depend on the target. So `content_sha256` and the signature still verify. A 5.0 validator reports W105 and
  nothing else (case `validate-W105-newer-minor-understanding`; the reference validator and
  `spdf-format` 0.1.0 agree).
- **What must writers do?** Nothing, unless they write the layer. Writers that do write
  `user_version` 510 and `spdf_version` 5.1, and do not write the vendor prototype as well.
- **Deprecation**: none.
- **Legacy mapping**: unchanged.

## Security and privacy

- **No new code.** The layer is plain tables. It deliberately has no full-text index: a stored
  FTS5 table would be a foreign virtual table to every 5.0 reader (§2.4, E020). Readers build
  indexes on private copies.
- **Sizes.** `text`, `quote`, `data` and evidence lists are untrusted input: the length limits
  and JSON nesting limits of §14 apply to them.
- **No automatic fetching.** A `wikidata` id is an identifier, not an instruction: readers MUST
  NOT query Wikidata (or follow docrefs to the network) when a file is opened, only on a user
  action (§14, remote references).
- **Model output is data.** Cards are usually written by a language model and may contain text
  that looks like instructions; applications that pass card text to a model MUST treat it as
  data (§14, model inputs). `model`, `version`, `created` and `origin` are claims of the writer;
  only a trusted signature attributes them (§13), and it covers the layer through
  `understanding_sha256`.
- **People.** Entities and appearances can describe living people: who is visible in a frame,
  who speaks, what a description says about them. Producers SHOULD keep `description` to what
  the document or a public identifier supports, SHOULD NOT infer special categories of personal
  data (health, beliefs, orientation, origin), SHOULD let users remove or pseudonymize people
  as for `speaker` (§15), and MUST keep `fictional` honest: a character is not the person who
  plays it nor the person it echoes. Readers SHOULD NOT index appearances of real people into
  shared services without consent.
- **Research memory stays outside.** A reader's evidence, notes and answers are personal and go
  to `.spdfa.json` sidecars (§9 above), never into the shared file.
- **Copyright.** Cards may quote copyrighted text, and a layer of a protected work is part of a
  copy of that work (§16). SPDF does not grant rights. Guidance for producers:
  - keep each `quote` to the shortest passage that supports the claim (RECOMMENDED at most 400
    code points), as quotation exceptions require (Berne Convention art. 10(1): "compatible
    with fair practice" and not exceeding "that justified by the purpose"; in the EU, Directive
    2001/29/EC art. 5(3)(d); in the United States, fair use, 17 U.S.C. §107);
  - never let the quotations of a layer reconstitute the work, or a substantial part of it;
  - keep card text analytical: a detailed retelling of a protected plot can be a derivative
    work; a synopsis that serves the analysis is not the goal in itself;
  - the layer inherits the `rights` of the document (§16): when a writer strips the text of a
    restricted document to share it, it MUST strip the quotations and the card vectors too
    (vectors leak text, §15), and MAY keep cards whose text quotes nothing;
  - `rights.note` is the place to state the licence of the analysis when it differs from that
    of the work (for example, an analysis released under CC BY 4.0 over a work in copyright).
  The conformance corpus uses only public-domain texts.

## Alternatives

- **Vendor extensions forever** (doing nothing). Each producer keeps its own tables; nothing is
  testable; readers implement one format per vendor. This RFC keeps the extension route open
  until 5.1 is published and then closes the gap.
- **Everything as W3C Web Annotations inside the file** (JSON-LD rows). Expressive, but a
  reader cannot query "every shot where this character is visible" with SQL, references are
  not checked, and annotations are what users write, which SPDF keeps outside (§17).
- **TEI stand-off** (`<standOff>`, `<listPerson>`, `<linkGrp>`). Rich and established, but XML
  inside SQLite gives up indexing and typed columns. An exporter can map segments to `<div>`,
  entities to `<listPerson>`/`<listPlace>` with `@ref` to Wikidata, and alignments to
  `<linkGrp>`; that is a natural candidate for §19.4.
- **IIIF annotations for regions.** Good for still images; for frames of a video, the anchor
  URI already speaks Media Fragments, which IIIF and Web Annotation also use.
- **The layer in the canonical dump.** Simpler, but a 5.0 validator would compute a different
  `content_sha256` for every 5.1 file and report E081. The separate dump chained through
  `spdf_meta` keeps both versions in agreement.
- **One generic table of claims** with a JSON body. Fewer tables, but no typed columns, no
  references to validate, no indexes for the queries readers make.
- **Other authority files** (VIAF, GND, Getty TGN, ISNI). Wikidata links most of them (P214,
  P227, P1667, P213), so one identifier reaches the rest. A later minor MAY add an
  `identifiers` JSON column.

## Unresolved questions

- Vectors for entities (target `entity`): useful for searching people and places across
  languages; left out until a producer needs them.
- Cards about relations and entities across works (`document` NULL) in a one-document file:
  keep them, as now, or move them to a library-level sidecar?
- A registry of lens schemas for `cards.data`, so that readers can render structured fields
  of, say, a film shot (scale, angle, movement) without knowing the producer.
- Whether alignments should name segments of the other document at all, since those ids only
  resolve when both files come from the same producer.
- Cards in several languages (a card and its translation): a `translations` member, or one card
  per language linked by `data`?
- The name of the profile (`understanding` or `analysis`) and of `span`.
- Whether annotations 1.1 should be a separate RFC.

## Implementations

| Implementation | Status | Version or commit | Cases passed |
|---|---|---|---|
| Scholaris (TypeScript): writes and reads the prototype `scholaris_comprension` 1.0 under 5.0, and annotations 1.1 | prototype | `9d4a54b` (branch `ola2/spdf5`) | n/a (extension) |
| Reference (`conformance/tools`, Python): writes the layer and its understanding dump | prototype | this branch | the seven cases of 0.4.3 |
| `spdf-format` (TypeScript) 0.1.0 | reader of 5.0 | `74e7ff6` | the seven cases of 0.4.3 |
