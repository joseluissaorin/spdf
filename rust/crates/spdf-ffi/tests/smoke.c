/* Smoke test of the C ABI: open, dump, search, cite, validate. */
#include <stdio.h>
#include <string.h>
#include "../include/spdf.h"

#define CHECK(x) do { int rc_ = (x); if (rc_ != SPDF_OK) { \
  fprintf(stderr, "%s failed (%d): %s\n", #x, rc_, spdf_last_error()); return 1; } } while (0)

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "../../../conformance";
  char path[1024];
  snprintf(path, sizeof path, "%s/files/quijote.spdf", dir);
  printf("spdf %s\n", spdf_version());

  SpdfDoc *doc = NULL;
  CHECK(spdf_open(path, NULL, &doc));
  char *out = NULL;
  CHECK(spdf_doc_version(doc, &out));
  if (strcmp(out, "5.0") != 0) { fprintf(stderr, "version %s\n", out); return 1; }
  spdf_string_free(out);

  CHECK(spdf_dump(doc, &out));
  if (strncmp(out, "{\"blobs\":", 9) != 0) { fprintf(stderr, "dump starts %.20s\n", out); return 1; }
  spdf_string_free(out);

  CHECK(spdf_search_lexical(doc, "hidalgo", 3, &out));
  if (!strstr(out, "anchor_uri")) { fprintf(stderr, "search: %s\n", out); return 1; }
  printf("search: %.120s...\n", out);
  spdf_string_free(out);

  CHECK(spdf_locate(doc, "https://example.org/quijote.spdf#p=7", &out));
  if (!strstr(out, "\"document\":true")) { fprintf(stderr, "locate: %s\n", out); return 1; }
  printf("locate: %s\n", out);
  spdf_string_free(out);

  SpdfDoc *docs[2] = { doc, doc };
  CHECK(spdf_export_bibtex_multi((const SpdfDoc *const *)docs, 2, &out));
  if (!strstr(out, "cervantessaavedra1605a") || !strstr(out, "cervantessaavedra1605b")) {
    fprintf(stderr, "bibtex: %s\n", out); return 1;
  }
  spdf_string_free(out);

  CHECK(spdf_export_structure(doc, "tei", &out));
  printf("tei pages: %s\n", out);
  spdf_string_free(out);

  CHECK(spdf_doc_cite(doc, "{\"type\":\"page\",\"physical\":1,\"printed\":\"1r\",\"foliation\":\"leaf\"}", NULL, "es", &out));
  printf("cite: %s\n", out);
  spdf_string_free(out);
  spdf_close(doc);

  CHECK(spdf_validate(path, &out));
  if (!strstr(out, "\"valid\":true")) { fprintf(stderr, "validate: %s\n", out); return 1; }
  spdf_string_free(out);

  if (spdf_anchor_uri_parse("nope", &out) == SPDF_OK) return 1;
  printf("expected error: %s\n", spdf_last_error());
  puts("ok");
  return 0;
}
