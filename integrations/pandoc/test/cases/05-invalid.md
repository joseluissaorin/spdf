---
title: Files the filter must refuse
spdf-library:
- ../../fixtures/roto.spdf
- ../../../conformance/invalid/E001-not-sqlite.spdf
- ../../../conformance/invalid/E001-gzip-of-text.spdf
- ../../../conformance/invalid/E002-application-id.spdf
- ../../../conformance/invalid/E013-two-documents.spdf
- ../../../conformance/invalid/E020-trigger.spdf
- ../../fixtures/spdf-in-five-pages.spdf
- no-such-folder
---

`roto.spdf` holds the same document as `spdf-in-five-pages.spdf` but carries
a view, so it is refused and the valid copy is used [@spdf:sha256-HASH_EN#p=2].

# References
