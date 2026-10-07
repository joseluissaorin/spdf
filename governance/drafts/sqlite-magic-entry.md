# application_id 0x53504446 ("SPDF") for SQLite's magic.txt and for file(1)

> **Borrador sin enviar.** Dos propuestas para que las herramientas reconozcan un SPDF
> sin abrirlo: una línea en `magic.txt`, el fichero del árbol de fuentes de SQLite que
> lista los `application_id` conocidos (la documentación del formato de fichero de
> SQLite remite a él), y las reglas equivalentes en el fichero mágico de file(1) y
> libmagic, que es lo que de verdad usan los sistemas operativos.
>
> Vías:
>
> 1. **SQLite.** El registro del sufijo `+sqlite3` en IANA pide añadir el valor a
>    `magic.txt` enviando un parche a la lista sqlite-users. Según tengo entendido esa
>    lista se cerró y la sustituyó el foro de SQLite (<https://sqlite.org/forum>); por
>    verificar si basta un mensaje en el foro o si hay que escribir a los desarrolladores.
>    SQLite no acepta parches de código de terceros, pero `magic.txt` es un fichero de
>    texto que mantienen ellos: lo normal es pedir la línea y dejar que la añadan.
> 2. **file(1) y libmagic.** El proyecto lo mantiene Christos Zoulas. Vías publicadas en
>    su README: el gestor de fallos <https://bugs.astron.com/> y la lista
>    <file@astron.com>; el código público está en GitHub (`file/file`), pero por
>    verificar si allí aceptan *pull requests* o solo las vías anteriores. Conviene
>    adjuntar un fichero de muestra (los de `conformance/files/` son de dominio público) y,
>    si lo aceptan, añadirlo también a su batería de pruebas (`file/file-tests`).
>
> Falta antes de enviarlas:
>
> - Que la especificación tenga una versión estable. La URL que citan los comentarios
>   de la regla (`https://spdf.joseluissaorin.com/spec`) ya responde (comprobado el
>   7-10-2026), pero sirve un borrador de trabajo.
> - Una URL pública para la muestra que cita el mensaje del foro.
> - Decidir el nombre que se imprime: aquí «SPDF document», con el nombre completo en
>   `magic.txt` como pide la propuesta inicial; los demás valores del fichero usan
>   nombres cortos.
> - El tipo de medio: libmagic suele usar tipos registrados o `x-` y puede pedir que
>   `application/vnd.spdf` esté ya en IANA (ver `iana-application-vnd.spdf.md`); si no,
>   la alternativa es dejar `application/vnd.sqlite3` y añadir solo el nombre. Por
>   verificar con el mantenedor.
>
> Probado el 7-10-2026 con file 5.41 (el de macOS) cargando las reglas con la variable
> `MAGIC`: los siete ficheros 5.0 de la batería se reconocen, y un SQLite con otro
> `application_id` (`invalid/E002-application-id.spdf`) no. Los diffs están hechos contra
> las versiones de `magic.txt` (rama `master` del espejo de SQLite en GitHub) y de
> `magic/Magdir/sql` (revisión 1.38) descargadas ese día.

---

## 1. SQLite `magic.txt`

SQLite's documentation of the database header says that the `application_id` at offset
68 lets utilities such as file(1) identify application file formats, and that the list
of assigned values is the `magic.txt` file in the SQLite source tree. SPDF uses
`PRAGMA application_id = 1397769286` (0x53504446, ASCII "SPDF") and stores the
specification version in `PRAGMA user_version` (major × 100 + minor × 10; 500 for
version 5.0).

### Proposed lines

```text
>68  belong  =0x53504446  SPDF document (Semantic Processed Document Format)
>>60 belong  x            \b, user_version %d -
```

The second line prints the format version, which SPDF keeps in `user_version`. Output
with the current `magic.txt`:

```text
quijote.spdf: SPDF document (Semantic Processed Document Format), user_version 500 - SQLite3 database
```

If a single line in the style of the other entries is preferred:

```text
>68  belong  =0x53504446  SPDF document -
```

which prints `SPDF document - SQLite3 database`.

### As a patch

```diff
--- a/magic.txt
+++ b/magic.txt
@@ -30,4 +30,6 @@
 >68  belong  =0x45737269  Esri Spatially-Enabled Database -
 >68  belong  =0x4d504258  MBTiles tileset -
 >68  belong  =0x6a035744  TeXnicard card database
+>68  belong  =0x53504446  SPDF document (Semantic Processed Document Format)
+>>60 belong  x            \b, user_version %d -
 >0   string  =SQLite      SQLite3 database
```

### Message (forum post)

> **Subject:** application_id 0x53504446 for SPDF, for magic.txt
>
> SPDF (Semantic Processed Document Format) is an open file format for documents that
> have been read once (OCR, text layer or speech recognition) and stored so that every
> passage can be cited with its exact page, folio, verse or time. Each file is a single
> uncompressed SQLite 3 database. The specification (CC BY 4.0) is at
> https://spdf.joseluissaorin.com/spec.
>
> SPDF files set `PRAGMA application_id = 1397769286` (0x53504446, "SPDF" in ASCII) and
> keep the format version in `user_version` (500 for version 5.0). Could this value be
> added to the list in magic.txt? Suggested lines:
>
> ```
> >68  belong  =0x53504446  SPDF document (Semantic Processed Document Format)
> >>60 belong  x            \b, user_version %d -
> ```
>
> A public-domain sample file is available at [URL of a sample]. Thank you for SQLite,
> and for the application_id mechanism in particular.
>
> José Luis Saorín Ferrer, editor of the SPDF specification

## 2. file(1) and libmagic: `magic/Magdir/sql`

In libmagic the SQLite 3 rules live in `magic/Magdir/sql`. Known application ids appear
twice: once to set the media type and extensions, once to print the name. The generic
rules that follow already print the user version, so no extra rule is needed for it.

### Patch

```diff
--- a/magic/Magdir/sql
+++ b/magic/Magdir/sql
@@ -196,6 +196,13 @@
 >>68 belong =0x4D504258  database
 !:mime	application/vnd.sqlite3
 !:ext	mbtiles
+# URL:		https://spdf.joseluissaorin.com
+# Reference:	https://spdf.joseluissaorin.com/spec
+# Note:		SPDF, Semantic Processed Document Format, with application id 53504446h "SPDF"
+#		and the version as user version (500 for 5.0)
+>>68 belong =0x53504446  database
+!:mime	application/vnd.spdf
+!:ext	spdf
 >>68 default x           database
 !:mime	application/vnd.sqlite3
 # no examples found with s3db sl3 suffix
@@ -228,6 +235,7 @@
 >>>68 belong =0x544f4952 (Riot Games patcher)
 >>>68 belong =0x544d5052 (Twinmotion project)
 >>>68 belong =0x43484557 (Chewing IME)
+>>>68 belong =0x53504446 (SPDF document)
 # unknown application ID
 >>>68 default x
 >>>>68 belong !0         \b, application id %u
```

### Result

```text
$ file darwin.spdf
darwin.spdf: SQLite 3.x database (SPDF document), user version 500 (0x1f4), last written using SQLite version …
$ file --mime-type darwin.spdf
darwin.spdf: application/vnd.spdf
$ file --extension darwin.spdf
darwin.spdf: spdf
```

### Message (bug tracker or mailing list)

> **Subject:** magic: SQLite application id 0x53504446 (SPDF document)
>
> The attached patch to `magic/Magdir/sql` recognizes SPDF files (Semantic Processed
> Document Format), SQLite 3 databases with `application_id` 0x53504446 ("SPDF"), and
> gives them the media type `application/vnd.spdf` and the extension `spdf`. The format
> keeps its version in `user_version`, which the existing rules already print.
> Specification: https://spdf.joseluissaorin.com/spec. A public-domain sample is
> attached; it can go into file-tests if useful.
>
> José Luis Saorín Ferrer, editor of the SPDF specification

## Legacy files

SPDF 4.0 and 4.1 files (written by the Scholaris application before version 5.0) are
SQLite databases compressed with gzip and have `application_id` 0. file(1) reports them
as gzip data, and with `-z` as a SQLite 3.x database with user version 410 or 400 (or 0).
No rule is proposed for them: a user version alone is not a reliable signature.
