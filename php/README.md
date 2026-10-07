# SPDF for PHP

`joseluissaorin/spdf` reads, validates, searches, cites and writes **SPDF** files
(Semantic Processed Document Format): documents that have been read once and can be
cited forever. Every passage carries its exact anchor (printed page, folio, second of a
recording, slide, verse), so a citation can only print what the source says.

It is a native implementation of SPDF 5.0 over PDO SQLite. It also reads the legacy
4.0/4.1 files produced by Scholaris (gzip-wrapped, Spanish schema) through the 5.0 view.
It is built for the PHP hosts where journals and libraries live: OJS, Omeka S, WordPress.

## Install

```sh
composer require joseluissaorin/spdf
```

Requirements: PHP 8.1 or newer with `pdo_sqlite` (SQLite with FTS5; 3.44+ recommended), `intl`,
`mbstring` and `zlib`. `sodium` (bundled with PHP) verifies signatures.

## Read, search and cite

```php
use Spdf\Document;

$doc = Document::open('lazarillo.spdf');          // read-only, safe opening

echo $doc->title(), "\n";                         // La vida de Lazarillo de Tormes…
echo $doc->cite(['type' => 'image'], null, 'es'); // (Anónimo, 1554)

foreach ($doc->searchLexical('"Antona Pérez" Tejares', 5) as $hit) {
    $f = $doc->fragment($hit['fragment_id']);
    echo $f['text'], ' ', $doc->cite($hit['anchor'], $f['anchor_end'], 'es'), "\n";
    // hijo de Tomé González y de Antona Pérez… (Anónimo, 1554, p. [4])
    echo $hit['anchor_uri'], "\n";
    // spdf:sha256-3f2a…#p=10&f=4
}
```

Units, fragments, sections, figures, spaces, blobs and provenance are plain arrays with
the 5.0 column names (`$doc->units()`, `$doc->fragments()`, `$doc->blob('blob:cover')`…).
`$doc->metadata()` is the CSL-JSON item plus the `spdf` extension object.

### Vector and hybrid search

```php
$query = $myEmbedder->embed('el ciego y el jarro de vino');   // list<float>, same model as the space
$doc->searchVector($query, 'embeddinggemma-2@768', 10);       // f32, f16 and i8 spaces
$doc->searchHybrid('ciego jarro', $query, 'embeddinggemma-2@768', 10);  // RRF, k = 10
```

These are the reference algorithms of the specification (§6): brute-force dot product
(cosine when the space is not normalized) and reciprocal rank fusion over lists of depth
`max(limit, 50)`.

### Anchors and URIs

```php
use Spdf\AnchorUri;

$uri = $doc->anchorUri($fragment['anchor'], $fragment['anchor_end']);
$parsed = AnchorUri::parse('spdf:sha256-3f2a…#p=29&f=21&char=118,301');
// ['docref' => 'sha256-3f2a…', 'locator' => ['p' => 29, 'f' => '21', 'char' => [118, 301]]]
AnchorUri::format($parsed['docref'], $parsed['locator']);   // the same URI, byte for byte
$doc->locate($uri);   // the units the URI points at ([] if it names another document)
```

### Bibliography

```php
file_put_contents('lazarillo.json', $doc->cslJson());   // Zotero, Pandoc, citeproc
file_put_contents('lazarillo.bib', $doc->bibtex());     // @book{la1554, ...
```

Keys and fields follow the specification (§19): first author's family name, or the first
word of the title, folded to ASCII and lowercased, plus the year (`cervantessaavedra1605`);
the CSL-JSON `id` is the same key. `Spdf\Bibliography::bibtexAll()` exports several
records and disambiguates colliding keys with `a`, `b`, `c`…

## Validate

```php
$report = Spdf\Validator::validate('file.spdf');
// ['valid' => true, 'version' => '5.0', 'profile' => ['core', 'semantic'],
//  'errors' => [], 'warnings' => []]
```

Error and warning codes are those of the specification (§12): `E001` not SQLite,
`E020` trigger or view, `E070` FTS index out of sync, `E081` content hash mismatch…

## Write

```php
use Spdf\Writer;

$w = Writer::create('out.spdf', generator: 'my-journal/1.0', profile: 'core');
$w->document(['id' => 'art-12', 'kind' => 'pdf', 'source_sha256' => hash_file('sha256', 'art-12.pdf'),
    'mime' => 'application/pdf', 'bytes' => filesize('art-12.pdf'), 'unit_count' => 1,
    'metadata' => ['type' => 'article-journal', 'title' => 'Sobre el Lazarillo',
                   'author' => [['family' => 'Pérez', 'given' => 'Ana']], 'issued' => ['date-parts' => [[2026]]]]]);
$w->unit(['id' => 'p1', 'ord' => 1, 'anchor' => ['type' => 'page', 'physical' => 1, 'printed' => '45'],
    'text' => 'Texto de la página…', 'reader' => 'pdf-text-layer']);
$w->fragment(['n' => 1, 'id' => 'f1', 'unit' => 'p1', 'ord' => 1, 'text' => 'Texto de la página…',
    'anchor' => ['type' => 'page', 'physical' => 1, 'printed' => '45']]);
$w->finish(contentHash: true);   // FTS rebuilt, no triggers, VACUUM, atomic rename
```

## Security

Files are untrusted input. `Document::open()` opens them read-only with
`PRAGMA query_only`, `trusted_schema=OFF`, never loads extensions, refuses triggers and
views (except the three FTS triggers of legacy files), bounds blob sizes (512 MiB by
default) and gzip inflation (4 GiB), and copies WAL-mode files instead of touching them.
Limits are set with `new Spdf\Options(maxBlobBytes: …, maxInflatedBytes: …)`.
PDO does not expose `SQLITE_DBCONFIG_DEFENSIVE`; the other measures cover what it guards
in a read-only connection.

## In OJS, Omeka S and WordPress

`examples/` holds three minimal integrations:

- `show-and-cite.php`: a standalone page (title, whole-work citation, search, cited
  passages, BibTeX and CSL-JSON downloads). `SPDF_DIR=… php -S localhost:8080 examples/show-and-cite.php`.
- `ojs/spdfViewer`: an OJS 3.4 generic plugin that renders `.spdf` galleys.
- `omeka-s/SpdfViewer`: an Omeka S module with a file renderer for `application/vnd.spdf`.

The plugin and the module are sketches to start from; they show the calls, not a
finished product.

## Command line

```sh
vendor/bin/spdf validate file.spdf
vendor/bin/spdf dump file.spdf          # canonical dump (RFC 8785)
vendor/bin/spdf search file.spdf "molinos de viento"
vendor/bin/spdf cite file.spdf f12 en
vendor/bin/spdf bibtex file.spdf
vendor/bin/spdf conformance ../conformance
```

## Conformance

`php bin/spdf conformance ../conformance` runs the shared suite of the repository and
prints `{"impl":"php","version":…,"passed":[…],"failed":[…],"skipped":[…]}`. CI runs it on
PHP 8.1 to 8.4 and publishes the report as the `conformance-php` artifact.

## License

MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
