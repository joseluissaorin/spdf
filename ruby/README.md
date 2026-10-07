# SPDF for Ruby

`spdf-format` reads, validates, searches, cites and writes **SPDF** files (Semantic
Processed Document Format): documents that have been read once and can be cited forever.
Every passage carries its exact anchor (printed page, folio, second of a recording,
slide, verse), so a citation can only print what the source says.

Native implementation of SPDF 5.0 on the `sqlite3` gem. It also reads the legacy 4.0/4.1
files produced by Scholaris (gzip-wrapped, Spanish schema) through the 5.0 view.

## Install

```sh
gem install spdf-format
```

```ruby
require "spdf"
```

Ruby 3.1 or newer. The `sqlite3` gem ships SQLite with FTS5; signatures are verified with
the standard `openssl` library.

## Read, search and cite

```ruby
Spdf::Document.open("lazarillo.spdf") do |doc|          # read-only, safe opening
  puts doc.title
  puts doc.cite({ "type" => "image" }, locale: "es")    # (Anónimo, 1554)

  doc.search_lexical('"Antona Pérez" Tejares', limit: 5).each do |hit|
    f = doc.fragment(hit["fragment_id"])
    puts "#{f["text"]} #{doc.cite(hit["anchor"], f["anchor_end"], locale: "es")}"
    # hijo de Tomé González y de Antona Pérez… (Anónimo, 1554, p. [4])
    puts hit["anchor_uri"]   # spdf:sha256-3f2a…#p=10&f=4
  end
end
```

Rows are hashes with the 5.0 column names: `doc.units`, `doc.fragments`, `doc.sections`,
`doc.figures`, `doc.spaces`, `doc.blob("blob:cover")`, `doc.metadata` (the CSL-JSON item
plus the `spdf` extension object).

### Vector and hybrid search

```ruby
query = embedder.embed("el ciego y el jarro de vino")          # same model as the space
doc.search_vector(query, space: "embeddinggemma-2@768", limit: 10)   # f32, f16, i8
doc.search_hybrid("ciego jarro", query, space: "embeddinggemma-2@768")  # RRF, k = 10
```

### Anchors, bibliography

```ruby
Spdf::AnchorUri.parse("spdf:sha256-3f2a…#p=29&f=21&char=118,301")
# {"docref" => "sha256-3f2a…", "locator" => {"p" => 29, "f" => "21", "char" => [118, 301]}}
File.write("lazarillo.json", doc.csl_json)   # Zotero, Pandoc, citeproc
File.write("lazarillo.bib", doc.bibtex)
```

## Validate

```ruby
Spdf::Validator.validate("file.spdf")
# {"valid" => true, "version" => "5.0", "profile" => ["core"], "errors" => [], "warnings" => []}
```

## Write

```ruby
Spdf::Writer.create("out.spdf", generator: "my-app/1.0") do |w|
  w.document("id" => "d1", "kind" => "pdf", "source_sha256" => Digest::SHA256.file("d1.pdf").hexdigest,
             "mime" => "application/pdf", "bytes" => File.size("d1.pdf"), "unit_count" => 1,
             "metadata" => { "type" => "book", "title" => "Lazarillo de Tormes", "issued" => { "date-parts" => [[1554]] } })
  w.unit("id" => "p1", "ord" => 1, "anchor" => { "type" => "page", "physical" => 1, "printed" => "3" },
         "text" => "Pues sepa Vuestra Merced…", "reader" => "pdf-text-layer")
  w.fragment("n" => 1, "id" => "f1", "unit" => "p1", "ord" => 1, "text" => "Pues sepa Vuestra Merced…",
             "anchor" => { "type" => "page", "physical" => 1, "printed" => "3" })
end
```

## Security

Files are untrusted input: they are opened read-only with `query_only` and
`trusted_schema=OFF`, extensions are never loaded, triggers and views are refused (except
the three FTS triggers of legacy files), blob sizes (512 MiB) and gzip inflation (4 GiB)
are bounded, and WAL-mode files are copied. `Spdf::Document.open(path, max_blob_bytes: …)`
changes the limits. The gem does not expose `SQLITE_DBCONFIG_DEFENSIVE`.

## Command line and conformance

```sh
spdf validate file.spdf
spdf dump file.spdf
spdf search file.spdf "molinos de viento"
spdf cite file.spdf f12 en
spdf conformance path/to/spdf/conformance
```

`spdf conformance` runs every case of the shared suite and prints the report of the
specification (§11). CI publishes it as the `conformance-ruby` artifact. All kinds are
claimed, including `roundtrip`.

## License

MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
