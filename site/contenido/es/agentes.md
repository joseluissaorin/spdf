---
title: SPDF para agentes
short: Agentes
description: Cómo leen esta web y usan los ficheros SPDF los modelos de lenguaje y los agentes: gemelos en Markdown, llms.txt, el servidor MCP y las reglas para citar sin inventar.
---

Esta web está escrita para que la lean igual las personas que las máquinas. Todo lo que aquí lee una persona, un agente lo puede pedir como texto plano.

## Leer esta web

- Cada hoja tiene un **gemelo en Markdown**: la misma dirección terminada en `.md` (la portada es `/es.md`). Las hojas también responden en Markdown si se piden con `Accept: text/markdown`, y por defecto a `curl` y a `wget`.
- [`/llms.txt`](/llms.txt) enumera todas las hojas con una línea de descripción, en inglés y en castellano.
- [`/llms-full.txt`](/llms-full.txt) trae **la especificación entera** y todas las hojas de la web en un solo fichero.
- [`/status.json`](/status.json) da el estado del CI y los casos de conformidad de cada implementación, en JSON.
- [`/sitemap.xml`](/sitemap.xml) enumera todas las hojas con sus alternativas de lengua. `robots.txt` da la bienvenida a los buscadores y a los rastreadores de IA, también para entrenar.
- Las hojas llevan JSON-LD de schema.org: la especificación como `TechArticle`, las implementaciones como `SoftwareSourceCode` y SPDF Commons como `Dataset`.

## Usar ficheros SPDF desde un agente

El [servidor MCP](/es/integraciones#mcp) `spdf-mcp` apunta a una carpeta de ficheros `.spdf` y da a cualquier cliente MCP (Claude, ChatGPT, Cursor, Zed, tu propio agente) estas herramientas:

| Herramienta | Qué hace |
| --- | --- |
| `list_documents` | Los documentos de la carpeta, con título, autores, año, tipo y número de unidades |
| `search` | Búsqueda léxica (o híbrida, si los ficheros llevan vectores y se da un vector de consulta) en todos los documentos, con anclas |
| `read_passage` | El texto literal de un fragmento, de una unidad (página, tramo de tiempo, diapositiva) o de un intervalo, por id, folio impreso o URI de ancla |
| `cite` | La cita corta con el folio o el segundo exactos, la URI de ancla y el texto citado, en castellano o en inglés |
| `list_figures` | Figuras, láminas y fotogramas con pie, descripción y ancla; si se pide, la imagen |
| `get_metadata` | La ficha CSL-JSON y el BibTeX de un documento |

```sh
npx spdf-mcp ~/Biblioteca/SPDF          # stdio
npx spdf-mcp ~/Biblioteca/SPDF --http 8765   # Streamable HTTP, opcional
```

## Reglas para citar sin inventar

1. **El texto, del fichero; la cita, del ancla.** Toma el texto de un pasaje de `read_passage` o del resultado de la búsqueda, y su cita de `cite`. No escribas nunca un número de página por tu cuenta.
2. **Folio impreso, no posición.** Una página tiene una posición física en el fichero y, casi siempre, un folio impreso. Se cita el folio impreso, y `cite` ya lo hace. Si una página no tiene folio impreso, la cita dice `s. p.` (`n. pag.` en inglés): no lo sustituyas por la posición.
3. **Los corchetes significan deducido.** `p. [21]` quiere decir que el folio se dedujo de las páginas vecinas, no que se leyó en la página. Conserva los corchetes.
4. **Guarda la URI de ancla.** Ponla junto a la afirmación (en una nota, un enlace o un comentario) para que una persona pueda abrir el pasaje exacto con cualquier lector de SPDF.
5. **El texto literal es literal.** Los fragmentos conservan la grafía de la fuente. La capa modernizada (`search_text`) existe solo para encontrarlos: nunca se cita de ella.
6. **Si el fichero no lo dice, no lo cites.** Un resultado de búsqueda es un candidato, no una prueba: lee el pasaje antes de atribuirle una afirmación.
