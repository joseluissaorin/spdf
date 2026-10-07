/*
 * Conformance runner of the C implementation: executes every case of
 * conformance/cases/<id>.json through the C ABI (spdf.h) and prints the report of the
 * specification (section 21): {"impl","version","passed","failed","skipped"}.
 * The report is also written to conformance.json in the working directory.
 *
 * Usage: spdf_conformance [path/to/conformance]
 *
 * SPDX-License-Identifier: MIT OR Apache-2.0
 */
#include "spdf.h"
#include "sjson.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <dirent.h>
#include <unistd.h>
#endif

#define TOL 1e-6

static char reason[4096];

static const char *fail(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(reason, sizeof reason, fmt, ap);
    va_end(ap);
    return reason;
}

static const char *abi_fail(const char *what) { return fail("%s failed: %s", what, spdf_last_error()); }

static char *join(const char *dir, const char *rel) {
    size_t n = strlen(dir) + strlen(rel) + 2;
    char *p = (char *)malloc(n);
    snprintf(p, n, "%s/%s", dir, rel);
    return p;
}

static int cmp_str(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }

static char **list_cases(const char *dir, size_t *count) {
    char **names = NULL;
    size_t n = 0, cap = 0;
    char *cases = join(dir, "cases");
#ifdef _WIN32
    char pattern[4096];
    snprintf(pattern, sizeof pattern, "%s\\*.json", cases);
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (n == cap) { cap = cap ? cap * 2 : 256; names = (char **)realloc(names, cap * sizeof(char *)); }
            names[n++] = _strdup(fd.cFileName);
        } while (FindNextFileA(h, &fd));
        FindClose(h);
    }
#else
    DIR *d = opendir(cases);
    if (d) {
        struct dirent *e;
        while ((e = readdir(d)) != NULL) {
            size_t l = strlen(e->d_name);
            if (l < 5 || strcmp(e->d_name + l - 5, ".json") != 0) continue;
            if (n == cap) { cap = cap ? cap * 2 : 256; names = (char **)realloc(names, cap * sizeof(char *)); }
            names[n++] = strdup(e->d_name);
        }
        closedir(d);
    }
#endif
    free(cases);
    if (n) qsort(names, n, sizeof(char *), cmp_str);
    *count = n;
    return names;
}

/* Parses a JSON string returned by the library and frees it. */
static sj *take_json(char *s) {
    if (!s) return NULL;
    const char *err = NULL;
    sj *v = sj_parse(s, strlen(s), &err);
    spdf_string_free(s);
    return v;
}

static char *dump_or_null(const sj *v) { return sj_is_null(v) ? NULL : sj_dump(v); }

static const char *compare_results(const sj *want, const sj *got, int via) {
    if (!got || got->type != SJ_ARR) return fail("results are not an array");
    if (want->count != got->count) return fail("results: expected %zu, got %zu", want->count, got->count);
    for (size_t i = 0; i < want->count; i++) {
        const sj *w = sj_at(want, i), *g = sj_at(got, i);
        const char *wid = sj_str(sj_get(w, "fragment_id")), *gid = sj_str(sj_get(g, "fragment_id"));
        if (!gid || strcmp(wid, gid)) return fail("results[%zu].fragment_id: expected %s, got %s", i, wid, gid ? gid : "?");
        const sj *ws = sj_get(w, "score"), *gs = sj_get(g, "score");
        if (!gs || gs->type != SJ_NUM || fabs(ws->number - gs->number) > TOL)
            return fail("results[%zu].score: expected %s, got %s", i, ws->text, gs && gs->text ? gs->text : "?");
        const char *wu = sj_str(sj_get(w, "anchor_uri")), *gu = sj_str(sj_get(g, "anchor_uri"));
        if ((wu == NULL) != (gu == NULL) || (wu && strcmp(wu, gu)))
            return fail("results[%zu].anchor_uri: expected %s, got %s", i, wu ? wu : "null", gu ? gu : "null");
        if (via && sj_get(w, "via")) {
            char why[512];
            if (!sj_equal(sj_get(w, "via"), sj_get(g, "via"), 0, why, sizeof why)) return fail("results[%zu].via: %s", i, why);
        }
    }
    return NULL;
}

static float *floats(const sj *arr, size_t *dims) {
    *dims = arr ? arr->count : 0;
    float *v = (float *)malloc((*dims ? *dims : 1) * sizeof(float));
    for (size_t i = 0; i < *dims; i++) v[i] = (float)arr->items[i]->number;
    return v;
}

static int code_in(const sj *list, const char *code) {
    for (size_t i = 0; list && i < list->count; i++) {
        const sj *e = list->items[i];
        const char *c = e->type == SJ_STR ? e->text : sj_str(sj_get(e, "code"));
        if (c && !strcmp(c, code)) return 1;
    }
    return 0;
}

static const char *same_codes(const char *what, const sj *want, const sj *got) {
    for (size_t i = 0; want && i < want->count; i++) {
        const char *c = want->items[i]->type == SJ_STR ? want->items[i]->text : sj_str(sj_get(want->items[i], "code"));
        if (!code_in(got, c)) return fail("%s: expected %s, missing", what, c);
    }
    for (size_t i = 0; got && i < got->count; i++) {
        const char *c = sj_str(sj_get(got->items[i], "code"));
        if (!code_in(want, c)) return fail("%s: unexpected %s", what, c);
    }
    return NULL;
}

static const char *run_case(const char *dir, const sj *c, int *skipped) {
    const char *kind = sj_str(sj_get(c, "kind"));
    const sj *in = sj_get(c, "input"), *ex = sj_get(c, "expect");
    char why[1024];
    const char *r = NULL;
    *skipped = 0;
    if (!kind) return fail("case without kind");

    if (!strcmp(kind, "dump") || !strcmp(kind, "legacy_dump") || !strcmp(kind, "roundtrip")) {
        char *path = NULL, *tmp = NULL;
        if (!strcmp(kind, "roundtrip")) {
            char *src_path = join(dir, sj_str(sj_get(in, "source")));
            char *text = sj_read_file(src_path, NULL);
            free(src_path);
            if (!text) return fail("cannot read source");
            size_t tl = strlen(dir) + 64;
            tmp = (char *)malloc(tl);
#ifdef _WIN32
            snprintf(tmp, tl, "spdf-roundtrip-%lu.spdf", (unsigned long)GetCurrentProcessId());
#else
            snprintf(tmp, tl, "/tmp/spdf-roundtrip-%ld.spdf", (long)getpid());
#endif
            remove(tmp);
            int st = spdf_write_from_dump(text, tmp);
            free(text);
            if (st != SPDF_OK) { free(tmp); return abi_fail("spdf_write_from_dump"); }
            path = tmp;
        } else {
            path = join(dir, sj_str(sj_get(in, "file")));
        }
        SpdfDoc *doc = NULL;
        if (spdf_open(path, NULL, &doc) != SPDF_OK) { r = abi_fail("spdf_open"); goto dump_done; }
        char *out = NULL;
        if (spdf_dump(doc, &out) != SPDF_OK) { r = abi_fail("spdf_dump"); goto dump_close; }
        sj *got = take_json(out);
        char *want_path = join(dir, sj_str(sj_get(ex, "dump")));
        const char *perr = NULL;
        sj *want = sj_parse_file(want_path, &perr);
        free(want_path);
        if (!want || !got) r = fail("cannot parse dumps");
        else if (!sj_equal(want, got, TOL, why, sizeof why)) r = fail("dump %s", why);
        sj_free(want);
        sj_free(got);
        if (!r && sj_str(sj_get(ex, "content_sha256"))) {
            char *ver = NULL;
            if (spdf_verify(doc, NULL, &ver) != SPDF_OK) r = abi_fail("spdf_verify");
            else {
                sj *v = take_json(ver);
                const char *h = sj_str(sj_get(v, "computed_sha256"));
                if (!h || strcmp(h, sj_str(sj_get(ex, "content_sha256"))))
                    r = fail("content_sha256: expected %s, got %s", sj_str(sj_get(ex, "content_sha256")), h ? h : "?");
                sj_free(v);
            }
        }
    dump_close:
        spdf_close(doc);
    dump_done:
        if (tmp) remove(tmp);
        free(path);
        return r;
    }

    if (!strcmp(kind, "validate")) {
        char *path = join(dir, sj_str(sj_get(in, "file")));
        char *out = NULL;
        int st = spdf_validate(path, &out);
        free(path);
        if (st != SPDF_OK) return abi_fail("spdf_validate");
        sj *got = take_json(out);
        const sj *wv = sj_get(ex, "valid"), *gv = sj_get(got, "valid");
        if (wv && (!gv || gv->boolean != wv->boolean)) r = fail("valid: expected %d", wv->boolean);
        const sj *wver = sj_get(ex, "version"), *gver = sj_get(got, "version");
        if (!r && wver && (sj_is_null(wver) != sj_is_null(gver) || (!sj_is_null(wver) && strcmp(sj_str(wver), sj_str(gver) ? sj_str(gver) : ""))))
            r = fail("version differs");
        if (!r && sj_get(ex, "errors")) r = same_codes("errors", sj_get(ex, "errors"), sj_get(got, "errors"));
        if (!r && sj_get(ex, "warnings")) r = same_codes("warnings", sj_get(ex, "warnings"), sj_get(got, "warnings"));
        sj_free(got);
        return r;
    }

    if (!strncmp(kind, "search_", 7)) {
        char *path = join(dir, sj_str(sj_get(in, "file")));
        SpdfDoc *doc = NULL;
        int st = spdf_open(path, NULL, &doc);
        free(path);
        if (st != SPDF_OK) return abi_fail("spdf_open");
        const sj *lim = sj_get(in, "limit");
        uint32_t limit = lim ? (uint32_t)lim->number : 10;
        char *out = NULL;
        size_t dims = 0;
        float *vec = NULL;
        if (!strcmp(kind, "search_lexical")) {
            st = spdf_search_lexical(doc, sj_str(sj_get(in, "query")), limit, &out);
        } else if (!strcmp(kind, "search_vector")) {
            vec = floats(sj_get(in, "query_vector"), &dims);
            st = spdf_search_vector(doc, sj_str(sj_get(in, "space")), sj_str(sj_get(in, "target")), vec, dims, limit, &out);
        } else {
            vec = floats(sj_get(in, "query_vector"), &dims);
            st = spdf_search_hybrid(doc, sj_str(sj_get(in, "query")), sj_str(sj_get(in, "space")), vec, dims, limit, &out);
        }
        free(vec);
        if (st != SPDF_OK) r = abi_fail(kind);
        else {
            sj *got = take_json(out);
            r = compare_results(sj_get(ex, "results"), got, strcmp(kind, "search_vector") != 0);
            sj_free(got);
        }
        spdf_close(doc);
        return r;
    }

    if (!strcmp(kind, "anchor_uri")) {
        const char *uri_in = sj_str(sj_get(in, "uri"));
        char *uri = NULL;
        if (uri_in) {
            const sj *err = sj_get(ex, "error");
            char *parsed = NULL;
            int st = spdf_anchor_uri_parse(uri_in, &parsed);
            if (err && err->type == SJ_BOOL && err->boolean) {
                if (st == SPDF_OK) { spdf_string_free(parsed); return fail("expected a parse error"); }
                return NULL;
            }
            if (st != SPDF_OK) return abi_fail("spdf_anchor_uri_parse");
            sj *p = take_json(parsed);
            if (strcmp(sj_str(sj_get(p, "docref")), sj_str(sj_get(ex, "docref")))) r = fail("docref differs");
            else if (!sj_equal(sj_get(ex, "locator"), sj_get(p, "locator"), TOL, why, sizeof why)) r = fail("locator %s", why);
            else {
                char *loc = sj_dump(sj_get(p, "locator"));
                char *again = NULL;
                if (spdf_anchor_uri_format_locator(sj_str(sj_get(p, "docref")), loc, &again) != SPDF_OK) r = abi_fail("format_locator");
                else if (strcmp(again, sj_str(sj_get(ex, "canonical")))) r = fail("format(parse(uri)): expected %s, got %s", sj_str(sj_get(ex, "canonical")), again);
                spdf_string_free(again);
                free(loc);
            }
            sj_free(p);
            return r;
        }
        char *anchor = sj_dump(sj_get(in, "anchor"));
        char *end = dump_or_null(sj_get(in, "anchor_end"));
        int st = spdf_anchor_uri_format(sj_str(sj_get(in, "docref")), anchor, end, &uri);
        free(anchor);
        free(end);
        if (st != SPDF_OK) return abi_fail("spdf_anchor_uri_format");
        if (strcmp(uri, sj_str(sj_get(ex, "uri")))) { r = fail("uri: expected %s, got %s", sj_str(sj_get(ex, "uri")), uri); spdf_string_free(uri); return r; }
        char *parsed = NULL;
        if (spdf_anchor_uri_parse(uri, &parsed) != SPDF_OK) { spdf_string_free(uri); return abi_fail("spdf_anchor_uri_parse"); }
        sj *p = take_json(parsed);
        if (strcmp(sj_str(sj_get(p, "docref")), sj_str(sj_get(in, "docref")))) r = fail("parse(uri).docref differs");
        else if (!sj_equal(sj_get(ex, "locator"), sj_get(p, "locator"), TOL, why, sizeof why)) r = fail("locator %s", why);
        else {
            char *loc = sj_dump(sj_get(p, "locator"));
            char *again = NULL;
            if (spdf_anchor_uri_format_locator(sj_str(sj_get(p, "docref")), loc, &again) != SPDF_OK) r = abi_fail("format_locator");
            else if (strcmp(again, uri)) r = fail("format(parse(uri)): expected %s, got %s", uri, again);
            spdf_string_free(again);
            free(loc);
        }
        sj_free(p);
        spdf_string_free(uri);
        return r;
    }

    if (!strcmp(kind, "cite")) {
        const sj *m = sj_get(in, "metadata");
        char *meta = sj_is_null(m) ? strdup("{}") : sj_dump(m);
        char *anchor = sj_dump(sj_get(in, "anchor"));
        char *end = dump_or_null(sj_get(in, "anchor_end"));
        const char *locale = sj_str(sj_get(in, "locale"));
        char *text = NULL;
        int st = spdf_cite(meta, anchor, end, locale ? locale : "en", &text);
        free(meta);
        free(anchor);
        free(end);
        if (st != SPDF_OK) return abi_fail("spdf_cite");
        if (strcmp(text, sj_str(sj_get(ex, "text")))) r = fail("expected %s, got %s", sj_str(sj_get(ex, "text")), text);
        spdf_string_free(text);
        return r;
    }

    if (!strcmp(kind, "quantize")) {
        const sj *vals = sj_get(in, "values");
        size_t n = vals ? vals->count : 0;
        double *v = (double *)malloc((n ? n : 1) * sizeof(double));
        for (size_t i = 0; i < n; i++) v[i] = vals->items[i]->number;
        uint8_t *data = NULL;
        size_t len = 0;
        int st = spdf_quantize(v, n, sj_str(sj_get(in, "dtype")), &data, &len);
        free(v);
        const sj *err = sj_get(ex, "error");
        int want_error = err && err->type == SJ_BOOL && err->boolean;
        if (st != SPDF_OK) return want_error ? NULL : abi_fail("spdf_quantize");
        char *hex = (char *)malloc(len * 2 + 1);
        for (size_t i = 0; i < len; i++) snprintf(hex + 2 * i, 3, "%02x", data[i]);
        hex[len * 2] = '\0';
        spdf_bytes_free(data, len);
        if (want_error) r = fail("expected an error, got %s", hex);
        else if (strcmp(hex, sj_str(sj_get(ex, "hex")))) r = fail("expected %s, got %s", sj_str(sj_get(ex, "hex")), hex);
        free(hex);
        return r;
    }
    return fail("unknown case kind %s", kind);
}

static void json_str(FILE *f, const char *s) {
    fputc('"', f);
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
        else if (c < 0x20) fprintf(f, "\\u%04x", c);
        else fputc(c, f);
    }
    fputc('"', f);
}

int main(int argc, char **argv) {
    const char *dir = argc > 1 ? argv[1] : "../conformance";
    size_t n = 0;
    char **names = list_cases(dir, &n);
    char **ids = (char **)calloc(n ? n : 1, sizeof(char *));
    char **reasons = (char **)calloc(n ? n : 1, sizeof(char *));
    int *status = (int *)calloc(n ? n : 1, sizeof(int)); /* 0 pass, 1 fail, 2 skip */
    size_t failed = 0;
    for (size_t i = 0; i < n; i++) {
        char rel[2048];
        snprintf(rel, sizeof rel, "cases/%s", names[i]);
        char *path = join(dir, rel);
        const char *err = NULL;
        sj *c = sj_parse_file(path, &err);
        free(path);
        const char *id = c ? sj_str(sj_get(c, "id")) : NULL;
        ids[i] = strdup(id ? id : names[i]);
        int skipped = 0;
        const char *r = c ? run_case(dir, c, &skipped) : fail("cannot parse case: %s", err ? err : "?");
        if (r) {
            reasons[i] = strdup(r);
            status[i] = skipped ? 2 : 1;
            if (!skipped) failed++;
        }
        sj_free(c);
    }
    FILE *outs[2] = {stdout, fopen("conformance.json", "wb")};
    for (int k = 0; k < 2; k++) {
        FILE *f = outs[k];
        if (!f) continue;
        fprintf(f, "{\"impl\":\"spdf (C ABI)\",\"version\":");
        json_str(f, spdf_version());
        for (int pass = 0; pass < 3; pass++) {
            fprintf(f, pass == 0 ? ",\"passed\":[" : pass == 1 ? "],\"failed\":[" : "],\"skipped\":[");
            int first = 1;
            for (size_t i = 0; i < n; i++) {
                if (status[i] != pass) continue;
                if (!first) fputc(',', f);
                first = 0;
                if (pass == 0) json_str(f, ids[i]);
                else {
                    fprintf(f, "{\"id\":");
                    json_str(f, ids[i]);
                    fprintf(f, ",\"reason\":");
                    json_str(f, reasons[i]);
                    fputc('}', f);
                }
            }
        }
        fprintf(f, "]}\n");
        if (k == 1) fclose(f);
    }
    for (size_t i = 0; i < n; i++) { free(names[i]); free(ids[i]); free(reasons[i]); }
    free(names); free(ids); free(reasons); free(status);
    return failed ? 1 : 0;
}
