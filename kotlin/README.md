# SPDF for Kotlin and Java

Native Kotlin/JVM implementation of **SPDF** (Semantic Processed Document Format):
documents that have been read once and can be cited forever, because every passage carries
its exact anchor (printed page, folio, second of a recording, slide, verse). It is usable
from Kotlin, Java and Android, and independent of the other implementations in this
repository (it does not wrap the Rust ABI).

- Maven coordinates: `io.github.joseluissaorin:spdf` (JVM), `io.github.joseluissaorin:spdf-android`
  (Android), both on top of `io.github.joseluissaorin:spdf-core`.
- Java 17 or newer on the JVM; Android minSdk 23. Built with Kotlin 2.4 at language level 2.2,
  so apps on Kotlin 2.1 or newer can consume it.
- Conformance: passes the whole SPDF conformance suite (`../conformance`, 229 cases in
  suite 0.3.0) with **both** SQLite adapters, every kind (`dump`, `legacy_dump`,
  `roundtrip`, `validate`, `search_lexical`, `search_vector`, `search_hybrid`,
  `anchor_uri`, `cite`, `quantize`). Nothing is skipped: this is a full reader and writer.

## Modules

| Artifact | What | SQLite |
|---|---|---|
| `spdf-core` | all the logic: safe opening, dump, validation, search, anchors, citation, export, writer, conformance runner | none: it talks to a small `SqlDriver` interface with typed values (`SqlValue`: NULL, INTEGER, REAL, TEXT, BLOB) |
| `spdf` | `JdbcSqlDriver` and the `spdf` command-line tool | `org.xerial:sqlite-jdbc` (bundled SQLite with FTS5 and `trigram`) |
| `spdf-android` | `AndroidxSqlDriver` | `androidx.sqlite` driver API with `BundledSQLiteDriver` (`androidx.sqlite:sqlite-bundled`): the app ships its own SQLite with FTS5 and `trigram`, which `android.database.sqlite` does not guarantee |

Both adapters register themselves with `java.util.ServiceLoader`, so `SpdfFile.open(path)`
picks the one on the classpath. You can always pass a driver explicitly (recommended on
Android, where R8 may strip service files). Any other binding can be plugged in by
implementing `SqlDriver` (three methods).

```kotlin
// build.gradle.kts
dependencies {
    implementation("io.github.joseluissaorin:spdf:0.1.0")          // JVM
    // implementation("io.github.joseluissaorin:spdf-android:0.1.0") // Android
}
```

```xml
<dependency>
  <groupId>io.github.joseluissaorin</groupId>
  <artifactId>spdf</artifactId>
  <version>0.1.0</version>
</dependency>
```

## What it does

| | |
|---|---|
| Safe opening | read-only (`SQLITE_OPEN_READONLY`), `query_only`, `trusted_schema = OFF`, `mmap_size = 0`, `cell_size_check`, no extensions; files with triggers, views or foreign virtual tables refused (E020); unknown required extensions refused (E060); maximum value size (512 MiB) and maximum gunzipped size (4 GiB); WAL files are read through a copy with the header patched |
| Versions | SPDF 5.0, and the legacy 4.0 / 4.1 files of Scholaris (Spanish schema, gzip-wrapped) through the 5.0 view, metadata mapped to CSL-JSON |
| Dump | canonical JSON (RFC 8785 / JCS) of the whole file, `content_sha256` |
| Validation | every code of SPEC §22 (E001–E090, W100–W110) in the reference order; FTS `integrity-check` on a private copy; Ed25519 signatures (platform provider, with a pure fallback for older Android) |
| Search | lexical (FTS5 BM25, CJK route with `trigram` or substring), vector (`f32`, `f16`, `i8`; dot product or cosine), hybrid (reciprocal rank fusion, k = 10) |
| Anchors | anchor ↔ URI (`spdf:sha256-…#p=29&f=21&char=118,301`), strict parser, canonical form |
| Citation | short author-date citation in Spanish and English |
| Export | CSL-JSON and BibTeX, with the key and field rules of SPEC §19 / RFC 0002 (same keys as every other implementation: `cervantessaavedra1605`, `la1554`, `anonnd`) |
| Writer | builds valid SPDF 5.0 files (FTS kept in sync, `VACUUM`, no triggers, atomic replace); f16/i8 quantization as the spec says |
| Typed reading | `document()`, `units()`, `fragments()`, `sections()`, `figures()`, `spaces()`, `provenance()`, `blob(key)` |

## Kotlin

```kotlin
import io.github.joseluissaorin.spdf.*

SpdfFile.open("quijote.spdf").use { f ->          // also legacy .spdf (gzip) files
    for (hit in f.searchLexical("«lugar de la Mancha»", limit = 5)) {
        println("${hit.fragmentId} ${hit.score} ${hit.anchorUri}")
        println(f.cite(hit.anchor!!, hit.anchorEnd, locale = "es"))
        // q4 1.889394 spdf:sha256-fa38…#p=5&pe=6&f=1r&fe=1v&char=101,278
        // (Cervantes Saavedra, 1605, fols. 1r-[1v])
    }
    val query = DoubleArray(8)                     // your own query embedding
    val nearest = f.searchVector(query, space = "toy-embedding@8", limit = 5)
    val fused = f.searchHybrid("hidalgo", query, "toy-embedding@8", limit = 5)
    println(f.exportBibTeX())
}

// Validation and canonical dump
val result = Validator.validate("file.spdf")
println("${result.isValid} ${result.errorCodes} ${result.warningCodes}")
SpdfFile.open("file.spdf").use { f ->
    val jcs: String = f.dumpJson()                 // RFC 8785 bytes
    val sum: String = f.contentSha256()            // integrity hash of SPEC §18
}

// Anchors and citations
val a = Anchor.page(29, "21", source = "inferred")
val uri = AnchorUri.format("sha256-3f2a…", a)       // spdf:sha256-3f2a…#p=29&f=21
val parsed = AnchorUri.parse(uri)                    // strict: malformed URIs throw SpdfException
val text = Citation.cite(a, null, mapOf(
    "type" to "book", "title" to "Arte nuevo de hacer comedias",
    "author" to listOf(mapOf("family" to "Vega", "non-dropping-particle" to "de", "given" to "Lope")),
    "issued" to mapOf("date-parts" to listOf(listOf(1609))),
), "es")                                             // (de Vega, 1609, p. [21])

// Writing
SpdfWriter.create(File("out.spdf"), WriterOptions(generator = "my-tool/1.0")).use { w ->
    w.setDocument(Document("doc", "pdf", "application/pdf", sha256Hex, mapOf("type" to "book", "title" to "…")))
    w.addUnit(CitableUnit("u1", Anchor.page(1, "1"), "…", reader = "pdf-text-layer"))
    w.addFragment(Fragment("f1", "u1", "…", Anchor.page(1, "1")))
    w.addSpace(Space("embeddinggemma-2@768", "local", "embeddinggemma-2", 768))
    w.addVector("fragment", "f1", "embeddinggemma-2@768", embedding)   // FloatArray or DoubleArray
    w.addBlob("pages/0001.png", "image/png", png)
    w.finish()   // rebuilds FTS, VACUUM, atomic move; closing without finish() discards the file
}
```

`Sources.write(source, file)` builds a file from a full JSON dump (the format of
`conformance/sources/`).

## Java

```java
import io.github.joseluissaorin.spdf.*;
import java.util.List;
import java.util.Map;

try (SpdfFile f = SpdfFile.open("quijote.spdf")) {
    List<Hit> hits = f.searchLexical("lugar de la Mancha", 5);
    for (Hit h : hits) {
        System.out.println(h.getFragmentId() + " " + h.getAnchorUri());
        System.out.println(f.cite(h.getAnchor(), h.getAnchorEnd(), "en"));
    }
}

ValidationResult r = Spdf.validate("quijote.spdf");
System.out.println(r.isValid() + " " + r.getErrorCodes());

try (SpdfWriter w = SpdfWriter.create("out.spdf")) {
    Document d = new Document("lazarillo", "pdf", "application/pdf", sha256Hex,
        Map.of("type", "book", "title", "La vida de Lazarillo de Tormes"));
    d.setTitle("Lazarillo de Tormes");
    w.setDocument(d);
    w.addUnit(new CitableUnit("u1", Anchor.page(3, "A2r", "read", "leaf"), "Pues sepa Vuestra Merced", "pdf-text-layer"));
    Fragment frag = new Fragment("f1", "u1", "Pues sepa Vuestra Merced", Anchor.page(3, "A2r", "read", "leaf"));
    frag.setContext("Prólogo");
    w.addFragment(frag);
    w.finish();
}

AnchorUri.Parsed p = Spdf.parseUri("spdf:sha256-3f2a…#p=29&f=21");
String cite = Spdf.cite(Anchor.verse(12), null, Json.parseObject("{\"title\":\"Rimas\",\"author\":[{\"family\":\"Bécquer\"}]}"), "es");
```

Every entry point is static for Java (`@JvmStatic`), optional parameters have overloads
(`@JvmOverloads`), rows are classes with a constructor for the required members and setters
for the rest, and nothing is `suspend`. `src/test/java` in the `spdf` module checks this.

## Android

```kotlin
val driver = AndroidxSqlDriver()                                   // BundledSQLiteDriver inside
val options = OpenOptions(tempDir = context.cacheDir)              // gunzipped and private copies go here
SpdfFile.open(File(context.filesDir, "book.spdf"), driver, options).use { f ->
    val hits = f.searchLexical("golondrinas")
}
```

`spdf-android` is a plain JVM library on purpose: it needs no Android SDK to build, and its
tests run the androidx bundled driver on the host JVM (the artifact ships Linux, macOS and
Windows natives too), including the whole conformance suite. Android apps consume it like any
jar; Gradle resolves the Android variant of `androidx.sqlite:sqlite-bundled` (with the native
library for each ABI) for them. The core avoids JDK APIs newer than Android API 23 (a test
checks the bytecode).

## Safety notes

SPDF files come from strangers (SPEC §2.4, §14). What each adapter enforces:

| | sqlite-jdbc | androidx.sqlite bundled |
|---|---|---|
| `SQLITE_OPEN_READONLY` | yes | yes |
| `query_only`, `trusted_schema = OFF`, `mmap_size = 0`, `cell_size_check` | yes (set and checked by the core) | yes (set and checked by the core) |
| extension loading | off | never enabled (no `addExtension`) |
| `SQLITE_DBCONFIG_DEFENSIVE` | not exposed by sqlite-jdbc | not exposed by the driver API |
| maximum value size | `SQLITE_LIMIT_LENGTH` | not exposed: no value can exceed the file size, so files larger than the limit are measured once when opened |

`SpdfFile.safety` reports what was in force. Without the defensive flag, the read-only,
query-only connection still refuses every write, and files with triggers, views or foreign
virtual tables are refused before any query on user tables. The FTS `integrity-check` (a
write) runs on a private temporary copy.

## Command line

```sh
./gradlew :spdf:installDist
B=spdf/build/install/spdf/bin/spdf
$B validate file.spdf
$B dump file.spdf
$B search file.spdf "lugar de la Mancha" -n 5
$B vsearch file.spdf toy-embedding@8 0,0.5,0.25,0.75,0.25,0,0.25,0 -n 3
$B hybrid file.spdf toy-embedding@8 0,0.5,0.25,0.75,0.25,0,0.25,0 selection -n 3
$B cite file.spdf q4 --locale en
$B export file.spdf bibtex
$B uri parse 'spdf:sha256-…#p=29&f=21'
$B build source.json out.spdf
$B conformance ../conformance -o conformance.json
```

## Conformance

```sh
./gradlew build                      # unit tests; both adapters run the whole suite
./gradlew :spdf:conformance          # runner report in build/conformance.json
./gradlew :spdf:run --args="conformance ../conformance -o conformance.json"
```

The runner discovers the cases by listing `conformance/cases/*.json` (`SPDF_CONFORMANCE_DIR`
overrides the location) and prints `{"impl":"spdf-kotlin","version":"0.1.0","passed":[…],
"failed":[…],"skipped":[…]}`; it exits non-zero if anything fails.

## Building

Gradle 9.8 through the wrapper, Kotlin 2.4, any JDK 17 or newer (bytecode targets 17).
`./gradlew publishAllPublicationsToBuildRepoRepository` writes exactly what would be
published to `build/repo`; publishing to Maven Central is described in
[`PUBLICAR.md`](PUBLICAR.md) (in Spanish).

## License

MIT OR Apache-2.0.
