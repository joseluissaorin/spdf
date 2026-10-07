# SPDF for C and C++

C and C++ access to **SPDF** files (Semantic Processed Document Format) through the C
ABI of the Rust reference implementation (`rust/crates/spdf-ffi`, header `spdf.h`).
Everything the other implementations do is here: safe opening of SPDF 5.0 and legacy 4.x
files, validation, the canonical dump, the reference lexical, vector and hybrid
searches, anchor URIs (format, parse, locate), short citations, CSL-JSON and BibTeX, and
writing files from a dump. SQLite is bundled inside the library.

This folder adds:

- `CMakeLists.txt`: builds the Rust library with cargo and exposes the CMake target
  `spdf::spdf` (static by default, `-DSPDF_SHARED=ON` for the shared library,
  `-DSPDF_PREBUILT_DIR=…` to use a prebuilt `libspdf_ffi`);
- `include/spdf.hpp`: a header-only C++17 wrapper (RAII `spdf::Document`, exceptions,
  `std::string` results);
- `examples/`: `search.c`, `validate.c` and `search.cpp`;
- `tests/conformance.c`: the conformance runner, which drives every case through the ABI;
- `src/sjson.c`: a small JSON reader used by the examples and the runner (not part of
  the ABI);
- `spdf.pc.in`: a pkg-config file for installations.

## Build

```sh
cmake -S c -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Requirements: a C11 and C++17 compiler, CMake 3.16+, and Rust (cargo) unless
`SPDF_PREBUILT_DIR` points to a built library. Static linking pulls in
`-lpthread -ldl -lm` on Linux and `-framework Security -framework CoreFoundation` on
macOS; the CMake target adds them.

## C

```c
#include "spdf.h"

SpdfDoc *doc = NULL;
if (spdf_open("quijote.spdf", NULL, &doc) != SPDF_OK) {     /* read-only, safe opening */
    fprintf(stderr, "%s\n", spdf_last_error());              /* {"status","code","message"} */
    return 1;
}
char *hits = NULL;
if (spdf_search_lexical(doc, "\"lugar de la Mancha\"", 10, &hits) == SPDF_OK) {
    puts(hits);   /* [{"fragment_id":"q4","score":…,"via":["lexical"],"anchor":{…},"anchor_uri":"spdf:sha256-…#p=5&pe=6&f=1r&fe=1v&char=101,278"}] */
    spdf_string_free(hits);
}
char *cite = NULL;
spdf_doc_cite(doc, "{\"type\":\"page\",\"physical\":5,\"printed\":\"1r\",\"foliation\":\"leaf\"}", NULL, "es", &cite);
puts(cite);       /* (Cervantes Saavedra, 1605, fol. 1r) */
spdf_string_free(cite);
spdf_close(doc);
```

Every function returns an `int` status (`SPDF_OK` = 0) and writes its result through an
out parameter; strings returned by the library are freed with `spdf_string_free`,
byte buffers with `spdf_bytes_free`. Complex values are JSON with the shapes of the
specification.

## C++

```cpp
#include "spdf.hpp"

spdf::Document doc("quijote.spdf");
std::string hits = doc.search("hidalgo", 5);               // JSON array
std::string uri_units = doc.locate("spdf:sha256-…#p=5");   // units an anchor URI points at
std::cout << doc.bibtex();                                 // @book{cervantessaavedra1605, …
```

Errors throw `spdf::Error` (with `status()` and the JSON of `spdf_last_error()`).

## Conformance

`build/spdf_conformance ../conformance` runs every case through the ABI and prints the
report of the specification; `ctest` runs it. CI publishes it as the `conformance-c`
artifact. All kinds are claimed, including `roundtrip` (through `spdf_write_from_dump`)
and `quantize` (through `spdf_quantize`).

## License

MIT OR Apache-2.0, at your option. The SPDF specification is CC BY 4.0.
