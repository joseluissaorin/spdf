# URI scheme registration (provisional): spdf

> **Borrador sin enviar.** Solicitud de registro provisional del esquema de URI `spdf`
> en el registro de esquemas de URI de IANA, con la plantilla de la sección 7.4 de la
> RFC 7595. Los registros provisionales solo exigen que el nombre no esté ya registrado
> y que la solicitud esté completa; no piden una especificación estable. La RFC 7595
> recomienda anunciar la propuesta en la lista uri-review@ietf.org para recibir
> comentarios antes o a la vez que se envía a IANA.
>
> Vía: el formulario de IANA para esquemas de URI o un correo a iana@iana.org con esta
> plantilla (por verificar cuál prefiere IANA hoy).
>
> Falta antes de enviarla:
>
> 1. Comprobar que `spdf` no figura ya en el registro de esquemas de URI (por
>    verificar el 7-10-2026 no se pudo; consultar
>    <https://www.iana.org/assignments/uri-schemes/>).
> 2. Enlazar una versión fechada de la especificación (etiqueta `spec-v5.0.0`) en lugar
>    del borrador de trabajo.
> 3. Confirmar el responsable del cambio, como en el registro del tipo de medio
>    (`iana-media-type.md`).
>
> Cuando la 5.0 sea final y haya implementaciones independientes en uso, se puede pedir
> el paso a registro permanente, que exige revisión de experto y una especificación
> estable.

---

**Scheme name:** spdf

**Status:** Provisional

**Applications/protocols that use this scheme name:**

Applications that read, cite or annotate documents in the SPDF format (Semantic
Processed Document Format): the SPDF libraries (Rust, TypeScript, Python, Swift,
Kotlin/JVM, Go, C#, PHP, Ruby, R, Julia), the SPDF Reader, the Scholaris citation
application and annotation sidecars (`*.spdfa.json`, W3C Web Annotation), which use
`spdf` URIs as annotation targets.

**Contact:** José Luis Saorín Ferrer <jl@joseluissaorin.com>

**Change controller:** José Luis Saorín Ferrer <jl@joseluissaorin.com>, editor of the
SPDF specification.

**References:**

SPDF: Semantic Processed Document Format, version 5.0, section 5 ("Anchor URI").
<https://spdf.joseluissaorin.com/spec#anchor-uri>; source:
<https://github.com/joseluissaorin/spdf/blob/main/spec/SPEC.md>.

**Scheme syntax:**

```abnf
spdf-uri    = "spdf:" docref [ "#" params ]
docref      = hash-ref / id-ref
hash-ref    = "sha256-" 64lhex          ; lowercase hex SHA-256 of the source document
id-ref      = 1*( unreserved / pct-encoded )
```

`params` is the list of anchor parameters defined in the specification (physical page,
printed folio, time range, section path, paragraph, slide, sheet rows, verse, canonical
reference, character range, region). The time and region parameters use the syntax of
W3C Media Fragments URI 1.0 (`t=4160,4175.5`, `xywh=percent:10,20,30,10`) and the
character range that of RFC 5147 (`char=118,301`). Example:

```text
spdf:sha256-27ea8a4dd0bbf0a511246fe67f81c19084aa2da75c871fe7acde688fd182cb60#p=29&pe=30&f=Ir&fe=Iv&char=729,745
```

**Scheme semantics:**

An `spdf` URI names a document, independently of where copies of it are stored, by the
SHA-256 of the bytes of its original (the scanned book, the recording, the PDF), and
optionally a place in it: a page, a leaf, a time span, a verse, a passage. It is a
name, not a locator: there is no network protocol and no resolution service. An
application resolves it against the SPDF files it holds whose `source_sha256` matches.
The document reference may instead be a document identifier local to a file; such URIs
are only meaningful next to that file.

**Encoding considerations:**

Values are UTF-8 strings percent-encoded as in RFC 3986; every byte other than an
unreserved character is percent-encoded with uppercase hexadecimal digits in the
canonical form. Parsers also accept lowercase hexadecimal digits and unencoded
non-ASCII characters (IRI form, RFC 3987).

**Interoperability considerations:**

The same parameter list is the fragment identifier of `application/vnd.spdf+sqlite3`
resources (`https://example.org/x.spdf#p=5&f=1r`). A canonical form, the order of
parameters and round-trip rules are defined by the specification and tested by its
public conformance suite.

**Security considerations:**

An `spdf` URI reveals which document, and which passage of it, a user is reading:
applications should not send such URIs to third parties without consent. Because the
URI identifies a document by a hash, it cannot be used to retrieve the document, and an
application must not fetch anything from the network to resolve it. Parsers must reject
malformed percent-encoding and invalid UTF-8, and must not use decoded values as file
paths or as query syntax.
