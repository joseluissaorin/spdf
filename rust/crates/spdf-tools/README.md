# spdf-tools

The `spdf` command, built on the reference implementation of **SPDF 5.0**
(*Semantic Processed Document Format*).

```sh
cargo install spdf-tools            # installs the `spdf` binary

spdf validate book.spdf             # report with the specification codes (exit 1 if invalid)
spdf info book.spdf                 # summary
spdf dump book.spdf > book.json     # canonical JSON (RFC 8785)
spdf search book.spdf --lexical "panóptico"
spdf search book.spdf --vector-file q.json --space embeddinggemma-2@768
spdf search book.spdf --hybrid "panóptico" --vector-file q.json --space embeddinggemma-2@768
spdf cite book.spdf --fragment f12 --locale es
spdf anchor parse "spdf:sha256-…#p=29&f=21&char=118,301"
spdf anchor format --docref sha256-… --anchor '{"type":"page","physical":29,"printed":"21"}'
spdf export book.spdf --bibtex
spdf convert old-4.1.spdf new-5.0.spdf
spdf build-from-dump source.json out.spdf
spdf keygen mykey                   # mykey.key (secret) and mykey.pub
spdf sign book.spdf signed.spdf --key mykey.key
spdf verify signed.spdf --signer mykey.pub
spdf conformance path/to/conformance    # runs every case and prints the protocol JSON
```

Query vectors for `--vector-file` are a JSON array of numbers or raw little-endian f32.

With `--features http` the library can also read remote files by HTTP range requests.

License: MIT OR Apache-2.0.
