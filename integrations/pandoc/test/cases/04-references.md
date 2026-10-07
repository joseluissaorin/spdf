---
title: Merging with existing references
spdf-library:
- ../../fixtures/spdf-in-five-pages.spdf
- ../../fixtures/spdf-en-cinco-paginas.spdf
- ../../../conformance/files/quijote.spdf
bibliography: cases/04-references.json
references:
- id: darwin1859
  type: book
  title: On the Origin of Species
  author:
  - family: Darwin
    given: Charles
  issued:
    date-parts:
    - [1859]
  publisher: John Murray
- id: saorin2026
  type: pamphlet
  title: SPDF in Five Pages
  author:
  - family: Saorín Ferrer
    given: José Luis
  issued:
    date-parts:
    - [2026]
- id: spdf-HASH_QUIJOTE_12
  type: book
  title: Don Quijote (an entry written by hand under the filter's own key)
  author:
  - family: Cervantes Saavedra
    given: Miguel de
  issued:
    date-parts:
    - [1605]
---

An unrelated reference stays [@darwin1859].

The English booklet is already in the references as `saorin2026`, so the
citation uses that key [@spdf:sha256-HASH_EN#p=2] and the bibliography lists it once,
next to a citation written by hand [@saorin2026, p. 4].

The Spanish booklet is in the bibliography file as `cinco`
[@spdf:sha256-HASH_ES#p=3].

An entry already carries the filter's own key, so it is not added twice
[@spdf:sha256-HASH_QUIJOTE#p=29].

# References
