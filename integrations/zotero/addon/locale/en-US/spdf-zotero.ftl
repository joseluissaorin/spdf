# SPDF for Zotero: https://spdf.joseluissaorin.com/integrations#zotero

## Menus

spdf-menu-import =
    .label = Import SPDF as Item…
spdf-menu-attach =
    .label = Attach SPDF…
spdf-menu-cite =
    .label = Copy Citation with Folio…

## Dialogs

spdf-error-title = SPDF
spdf-pick-import-title = Import SPDF as Item
spdf-pick-attach-title = Attach SPDF
spdf-cite-title = Copy Citation with Folio
spdf-cite-prompt = Printed folio (145, xiv, [21]), physical page (p=12) or anchor URI (spdf:sha256-…#p=29&f=21):
spdf-choose-attachment = This item has several SPDF attachments. Which one should be used?
spdf-choose-page = Several pages carry the folio { $folio }. Which one should be cited?
spdf-choice-page = Physical page { $physical } (folio { $printed })
spdf-choice-page-unnumbered = Physical page { $physical } (no folio)

## Results

spdf-copied = Citation copied
spdf-imported = SPDF imported
spdf-attached = SPDF attached

## Problems

spdf-open-failed = This file cannot be read as SPDF. { $reason }
spdf-library-readonly = The selected library cannot be edited.
spdf-select-one-item = Select a single item first.
spdf-no-attachment = The selected item has no SPDF attachment. Use “Attach SPDF…” first.
spdf-file-missing = The SPDF file “{ $name }” is not available on this computer.
spdf-cite-invalid = “{ $input }” is not a printed folio, a physical page or an anchor URI.
spdf-folio-not-found = This document has no page with the folio { $folio }. Nothing was copied.
spdf-page-not-found = This document has no physical page { $page }. Nothing was copied.
spdf-anchor-not-found = The anchor URI does not point to any part of this document. Nothing was copied.
spdf-other-document = The anchor URI belongs to another document ({ $docref }), not to the SPDF attached to this item. Nothing was copied.
spdf-unexpected-error = Something went wrong: { $message }
