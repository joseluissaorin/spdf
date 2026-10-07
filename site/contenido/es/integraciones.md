---
title: Integraciones
short: Integraciones
description: SPDF en las herramientas que la gente ya usa: un servidor MCP para agentes, cargadores para LlamaIndex y LangChain en Python y JavaScript, un complemento de Zotero y un filtro de Pandoc que convierte las anclas de SPDF en citas con el folio impreso.
---

El formato vale lo que valgan los sitios a los que llega. Estas integraciones viven en la carpeta `integrations/` del repositorio, cada una con sus pruebas y su README, y todas se apoyan en las bibliotecas oficiales: ninguna vuelve a implementar el formato.

<!-- integraciones -->

## Servidor MCP {#mcp}

`spdf-mcp` es un servidor del [Model Context Protocol](https://modelcontextprotocol.io) en TypeScript sobre `spdf-format`. Apúntalo a una carpeta de ficheros `.spdf` y cualquier agente podrá listar los documentos, buscar en ellos, leer un pasaje, ver las figuras y citar con el folio exacto, sin poder inventárselo.

```sh
npx spdf-mcp ~/Biblioteca/SPDF                # stdio
npx spdf-mcp ~/Biblioteca/SPDF --http 8765    # Streamable HTTP
```

En Claude Code: `claude mcp add spdf -- npx spdf-mcp ~/Biblioteca/SPDF`. En cualquier cliente que lea una configuración en JSON:

```json
{ "mcpServers": { "spdf": { "command": "npx", "args": ["spdf-mcp", "/ruta/a/la/biblioteca"] } } }
```

Herramientas: `list_documents`, `search`, `read_passage`, `cite`, `list_figures`, `get_metadata`. Las reglas que siguen están en [SPDF para agentes](/es/agentes).

## LlamaIndex y LangChain {#loaders}

Cargadores que convierten cada fragmento de un SPDF en un documento del framework, **con su ancla y su cita en los metadatos**, para que las respuestas con recuperación citen la página impresa y no un número de trozo.

```py
from spdf_llamaindex import SpdfReader          # pip install spdf-llamaindex
docs = SpdfReader(locale="es").load_data("darwin-origin.spdf")
docs[0].metadata["citation"]     # '(Darwin, 1859, p. 21)'
docs[0].metadata["anchor_uri"]   # 'spdf:sha256-…#p=29&f=21'
```

```py
from spdf_langchain import SpdfLoader            # pip install spdf-langchain
for doc in SpdfLoader("biblioteca/", locale="es").lazy_load():
    print(doc.metadata["citation"], doc.page_content[:60])
```

```js
import { SpdfLoader } from 'spdf-langchain';      // npm install spdf-langchain
const docs = await new SpdfLoader('darwin-origin.spdf').load();
```

```js
import { SpdfReader } from 'spdf-llamaindex';     // npm install spdf-llamaindex
const docs = await new SpdfReader().loadData('darwin-origin.spdf');
```

## Zotero {#zotero}

Un complemento para Zotero 7 y 8 que lleva SPDF a una biblioteca de referencias:

- **Importar un SPDF como ítem**: la ficha CSL-JSON que va dentro del fichero se convierte en un ítem de Zotero, con el fichero adjunto.
- **Adjuntar un SPDF** a un ítem que ya existe.
- **Copiar una cita con el folio**: elige una página o pega una URI de ancla y tendrás `(Darwin, 1859, p. 21)` en el portapapeles, con la URI de ancla al lado.

Se instala desde el fichero `.xpi` (Herramientas → Complementos → Instalar complemento desde un archivo).

## Pandoc {#pandoc}

Un filtro Lua para Pandoc que convierte las anclas de SPDF de tu Markdown en citas de verdad, en cualquier estilo CSL:

```markdown
Darwin lo llama una lucha por la existencia [@spdf:sha256-3f2a9c…#p=29].
```

```sh
pandoc ensayo.md --lua-filter spdf.lua -M spdf-library=biblioteca/ --citeproc -o ensayo.docx
```

El filtro lee los ficheros SPDF de la carpeta de la biblioteca, añade sus fichas CSL a la bibliografía, **sustituye la página física por el folio impreso** (`p=29` pasa a ser la página 21) y avisa si la página que citas no existe. Después citeproc le da forma en Chicago, APA, MLA o el estilo que elijas.

Por qué Pandoc y no Calibre: la escritura académica en Markdown ya pasa por Pandoc y citeproc, y el paso que más importa para la honestidad de una cita (convertir una posición en un fichero en el folio que una persona encontrará en el papel) está justo ahí. Calibre es una biblioteca para leer, y eso ya lo cubre el [lector](/es/descargas).
