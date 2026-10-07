# SPDF para Zotero: https://spdf.joseluissaorin.com/integrations#zotero

## Menús

spdf-menu-import =
    .label = Importar SPDF como elemento…
spdf-menu-attach =
    .label = Adjuntar SPDF…
spdf-menu-cite =
    .label = Copiar cita con folio…

## Diálogos

spdf-error-title = SPDF
spdf-pick-import-title = Importar SPDF como elemento
spdf-pick-attach-title = Adjuntar SPDF
spdf-cite-title = Copiar cita con folio
spdf-cite-prompt = Folio impreso (145, xiv, [21]), página física (p=12) o URI de ancla (spdf:sha256-…#p=29&f=21):
spdf-choose-attachment = Este elemento tiene varios SPDF adjuntos. ¿Cuál quiere usar?
spdf-choose-page = Hay varias páginas con el folio { $folio }. ¿Cuál quiere citar?
spdf-choice-page = Página física { $physical } (folio { $printed })
spdf-choice-page-unnumbered = Página física { $physical } (sin folio)

## Resultados

spdf-copied = Cita copiada
spdf-imported = SPDF importado
spdf-attached = SPDF adjuntado

## Problemas

spdf-open-failed = Este archivo no se puede leer como SPDF. { $reason }
spdf-library-readonly = La biblioteca seleccionada no se puede modificar.
spdf-select-one-item = Seleccione antes un único elemento.
spdf-no-attachment = El elemento seleccionado no tiene ningún SPDF adjunto. Use antes «Adjuntar SPDF…».
spdf-file-missing = El archivo SPDF «{ $name }» no está disponible en este ordenador.
spdf-cite-invalid = «{ $input }» no es un folio impreso, ni una página física, ni una URI de ancla.
spdf-folio-not-found = Este documento no tiene ninguna página con el folio { $folio }. No se ha copiado nada.
spdf-page-not-found = Este documento no tiene página física { $page }. No se ha copiado nada.
spdf-anchor-not-found = La URI de ancla no señala ninguna parte de este documento. No se ha copiado nada.
spdf-other-document = La URI de ancla pertenece a otro documento ({ $docref }), no al SPDF adjunto a este elemento. No se ha copiado nada.
spdf-unexpected-error = Algo ha fallado: { $message }
