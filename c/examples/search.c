/*
 * Searches a SPDF file and prints each passage with its short citation and anchor URI.
 *   spdf_search FILE QUERY [es|en]
 * SPDX-License-Identifier: MIT OR Apache-2.0
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sjson.h"
#include "spdf.h"

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s FILE QUERY [es|en]\n", argv[0]);
        return 2;
    }
    const char *locale = argc > 3 ? argv[3] : "es";
    SpdfDoc *doc = NULL;
    if (spdf_open(argv[1], NULL, &doc) != SPDF_OK) {   /* read-only, safe opening */
        fprintf(stderr, "%s\n", spdf_last_error());
        return 1;
    }
    char *hits_json = NULL;
    if (spdf_search_lexical(doc, argv[2], 10, &hits_json) != SPDF_OK) {
        fprintf(stderr, "%s\n", spdf_last_error());
        spdf_close(doc);
        return 1;
    }
    sj *hits = sj_parse(hits_json, strlen(hits_json), NULL);
    spdf_string_free(hits_json);
    char *frags_json = NULL;
    spdf_fragments(doc, &frags_json);
    sj *frags = sj_parse(frags_json, strlen(frags_json), NULL);
    spdf_string_free(frags_json);

    for (size_t i = 0; hits && i < hits->count; i++) {
        const sj *hit = sj_at(hits, i);
        const char *id = sj_str(sj_get(hit, "fragment_id"));
        const sj *frag = NULL;
        for (size_t j = 0; frags && j < frags->count; j++)
            if (!strcmp(sj_str(sj_get(sj_at(frags, j), "id")), id)) frag = sj_at(frags, j);
        char *anchor = sj_dump(sj_get(frag, "anchor"));
        char *end = sj_is_null(sj_get(frag, "anchor_end")) ? NULL : sj_dump(sj_get(frag, "anchor_end"));
        char *cite = NULL;
        if (spdf_doc_cite(doc, anchor, end, locale, &cite) == SPDF_OK) {
            printf("%s\n  %s\n  %s\n\n", sj_str(sj_get(frag, "text")), cite, sj_str(sj_get(hit, "anchor_uri")));
            spdf_string_free(cite);
        }
        free(anchor);
        free(end);
    }
    sj_free(hits);
    sj_free(frags);
    spdf_close(doc);
    return 0;
}
