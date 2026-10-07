---
title: Cómo citar
short: Citar
description: Cómo citar la especificación de SPDF en tu trabajo, y cómo cita SPDF los documentos que guarda, con el folio, el segundo o el verso exactos.
---

## Citar la especificación

Si SPDF te sirve en tu investigación, cita la propia especificación, con la versión que hayas usado. Cita recomendada:

> Saorín Ferrer, José Luis. 2026. *SPDF: Semantic Processed Document Format. Specification, version 5.0.* https://spdf.joseluissaorin.com/spec

<!-- cita-spec -->

Cada versión publicada de la especificación tendrá su DOI; mientras tanto, cita la dirección y la versión.

## Cómo cita SPDF lo que guarda

La razón de ser del formato es que una cita **se calcula a partir del ancla guardada; no se genera**. Todas las implementaciones tienen la misma función `cite`, comprobada por la batería de conformidad, que recibe un ancla, la ficha CSL del documento y una lengua:

| Ancla | En castellano | En inglés |
| --- | --- | --- |
| página, folio impreso leído en la página | `(Darwin, 1859, p. 21)` | `(Darwin, 1859, p. 21)` |
| página, folio deducido de las vecinas | `(Darwin, 1859, p. [21])` | `(Darwin, 1859, p. [21])` |
| página, folio en romanos | `(Woolf, 1929, p. xiv)` | `(Woolf, 1929, p. xiv)` |
| foliación por hojas | `(Cervantes, 1605, fol. 1r)` | `(Cervantes, 1605, fol. 1r)` |
| una página sin número impreso | `(Darwin, 1859, s. p.)` | `(Darwin, 1859, n. pag.)` |
| intervalo | `(Darwin, 1859, pp. 21-22)` | `(Darwin, 1859, pp. 21-22)` |
| momento de una grabación | `(Cortázar, 1977, 1:09:20)` | `(Cortázar, 1977, 1:09:20)` |
| diapositiva | `(Gould, 2024, diap. 3)` | `(Gould, 2024, slide 3)` |
| verso | `(Milton, 1667, vv. 234-240)` | `(Milton, 1667, vv. 234-240)` |
| referencia canónica (año CSL −375) | `(Plato, 375 a. C., 514a)` | `(Plato, 375 BC, 514a)` |

Dos autores se unen con *y* en castellano (con *e* ante el sonido /i/, como pide la norma) y con *and* en inglés; tres o más pasan a *et al.* Una página sin folio impreso nunca se cita con su posición en el fichero disfrazada de número de página.

Las referencias bibliográficas completas se exportan en **CSL-JSON** (siempre) y en **BibTeX**, así que se les puede aplicar cualquier estilo CSL (Chicago, APA, MLA, ISO 690…) con citeproc, Zotero o Pandoc.

## URI de ancla

Cada pasaje se puede señalar con una URI portátil que sobrevive a que el fichero cambie de nombre o se copie, porque nombra el documento por el SHA-256 de los bytes del original:

```text
spdf:sha256-3f2a9c…#p=29&f=21&char=118,301
```

Los parámetros siguen W3C Media Fragments y la RFC 5147 donde coinciden: `p` página física, `f` folio impreso, `t` segundos, `s` ruta de secciones, `sl` diapositiva, `v` verso, `ref` referencia canónica, `char` intervalo de caracteres, `xywh` región en porcentaje. La gramática completa está en la [especificación](/es/especificacion#anchor-uri).

## Citar desde tus herramientas de escritura

- **Pandoc**: escribe `[@spdf:sha256-3f2a9c…#p=29]` en Markdown y el [filtro de Pandoc](/es/integraciones#pandoc) lo convierte en una cita de verdad con el folio impreso, en cualquier estilo CSL.
- **Zotero**: el [complemento de Zotero](/es/integraciones#zotero) importa la ficha CSL de un SPDF como ítem, adjunta el fichero y copia una cita con el folio.
- **Agentes**: el [servidor MCP](/es/integraciones#mcp) da a cualquier agente una herramienta `cite` que devuelve a la vez la cita, la URI de ancla y el texto citado, así que no puede citar una página que no diga lo que afirma.
