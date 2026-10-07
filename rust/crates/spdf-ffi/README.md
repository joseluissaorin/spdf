# spdf-ffi

Stable C ABI over the Rust reference implementation of **SPDF 5.0**: the base of the C
implementation and an option for languages without a comfortable SQLite.

- Header: [`include/spdf.h`](include/spdf.h), generated with cbindgen (CI checks it is
  current).
- Library: `cargo build --release -p spdf-ffi` builds `libspdf_ffi.a`/`.so`/`.dylib`
  (`spdf_ffi.lib`/`.dll` on Windows). SQLite is bundled inside.
- Static linking also needs `-lpthread -ldl -lm` on Linux and
  `-framework Security -framework CoreFoundation` on macOS.

Conventions:

- every function returns an `int` status (`SPDF_OK` = 0) and writes its result through
  an out parameter;
- strings are UTF-8 and NUL-terminated; strings returned by the library belong to the
  caller and are freed with `spdf_string_free`, byte buffers with `spdf_bytes_free`;
- complex values are JSON, with the same shapes as the Rust types and the conformance
  protocol;
- after a failure, `spdf_last_error()` returns `{"status","code","message"}` for the
  calling thread;
- `SpdfDoc` handles are opaque, closed with `spdf_close`, and used from one thread at a
  time.

```c
#include "spdf.h"

SpdfDoc *doc = NULL;
if (spdf_open("book.spdf", NULL, &doc) != SPDF_OK) {
    fprintf(stderr, "%s\n", spdf_last_error());
    return 1;
}
char *hits = NULL;
if (spdf_search_lexical(doc, "panóptico", 10, &hits) == SPDF_OK) {
    puts(hits);                 /* [{"fragment_id":…,"score":…,"via":["lexical"],…}] */
    spdf_string_free(hits);
}
spdf_close(doc);
```

See [`tests/smoke.c`](tests/smoke.c) for a complete program. License: MIT OR Apache-2.0.
