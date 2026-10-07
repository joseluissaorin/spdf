/* sjson: small JSON reader/writer (see sjson.h). SPDX-License-Identifier: MIT OR Apache-2.0 */
#include "sjson.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *p;
    const char *end;
    const char *error;
    int depth;
} parser;

static sj *new_value(sj_type t) {
    sj *v = (sj *)calloc(1, sizeof(sj));
    if (v) v->type = t;
    return v;
}

static void skip_ws(parser *ps) {
    while (ps->p < ps->end && (*ps->p == ' ' || *ps->p == '\t' || *ps->p == '\n' || *ps->p == '\r')) ps->p++;
}

static int append(char **buf, size_t *len, size_t *cap, const char *data, size_t n) {
    if (*len + n + 1 > *cap) {
        size_t nc = (*cap ? *cap * 2 : 64);
        while (nc < *len + n + 1) nc *= 2;
        char *nb = (char *)realloc(*buf, nc);
        if (!nb) return 0;
        *buf = nb;
        *cap = nc;
    }
    memcpy(*buf + *len, data, n);
    *len += n;
    (*buf)[*len] = '\0';
    return 1;
}

static int utf8_encode(unsigned long cp, char out[4]) {
    if (cp < 0x80) { out[0] = (char)cp; return 1; }
    if (cp < 0x800) { out[0] = (char)(0xC0 | (cp >> 6)); out[1] = (char)(0x80 | (cp & 0x3F)); return 2; }
    if (cp < 0x10000) {
        out[0] = (char)(0xE0 | (cp >> 12)); out[1] = (char)(0x80 | ((cp >> 6) & 0x3F)); out[2] = (char)(0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = (char)(0xF0 | (cp >> 18)); out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    out[2] = (char)(0x80 | ((cp >> 6) & 0x3F)); out[3] = (char)(0x80 | (cp & 0x3F));
    return 4;
}

static int hex4(parser *ps, unsigned long *cp) {
    if (ps->end - ps->p < 4) return 0;
    unsigned long v = 0;
    for (int i = 0; i < 4; i++) {
        char c = ps->p[i];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= (unsigned long)(c - '0');
        else if (c >= 'a' && c <= 'f') v |= (unsigned long)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= (unsigned long)(c - 'A' + 10);
        else return 0;
    }
    ps->p += 4;
    *cp = v;
    return 1;
}

static char *parse_string_raw(parser *ps, size_t *out_len) {
    /* ps->p points after the opening quote */
    char *buf = NULL;
    size_t len = 0, cap = 0;
    if (!append(&buf, &len, &cap, "", 0)) return NULL;
    while (ps->p < ps->end) {
        char c = *ps->p++;
        if (c == '"') { *out_len = len; return buf; }
        if ((unsigned char)c < 0x20) { ps->error = "control character in string"; free(buf); return NULL; }
        if (c != '\\') { append(&buf, &len, &cap, &c, 1); continue; }
        if (ps->p >= ps->end) break;
        char e = *ps->p++;
        char ch;
        switch (e) {
            case '"': ch = '"'; break;
            case '\\': ch = '\\'; break;
            case '/': ch = '/'; break;
            case 'b': ch = '\b'; break;
            case 'f': ch = '\f'; break;
            case 'n': ch = '\n'; break;
            case 'r': ch = '\r'; break;
            case 't': ch = '\t'; break;
            case 'u': {
                unsigned long cp;
                if (!hex4(ps, &cp)) { ps->error = "bad \\u escape"; free(buf); return NULL; }
                if (cp >= 0xD800 && cp <= 0xDBFF && ps->end - ps->p >= 6 && ps->p[0] == '\\' && ps->p[1] == 'u') {
                    unsigned long lo;
                    ps->p += 2;
                    if (!hex4(ps, &lo)) { ps->error = "bad surrogate"; free(buf); return NULL; }
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                }
                char out[4];
                int n = utf8_encode(cp, out);
                append(&buf, &len, &cap, out, (size_t)n);
                continue;
            }
            default: ps->error = "bad escape"; free(buf); return NULL;
        }
        append(&buf, &len, &cap, &ch, 1);
    }
    ps->error = "unterminated string";
    free(buf);
    return NULL;
}

static sj *parse_value(parser *ps);

static sj *parse_value(parser *ps) {
    skip_ws(ps);
    if (ps->p >= ps->end) { ps->error = "unexpected end"; return NULL; }
    if (++ps->depth > 512) { ps->error = "too deep"; return NULL; }
    char c = *ps->p;
    sj *v = NULL;
    if (c == '{' || c == '[') {
        int obj = c == '{';
        ps->p++;
        v = new_value(obj ? SJ_OBJ : SJ_ARR);
        size_t cap = 0;
        skip_ws(ps);
        if (ps->p < ps->end && *ps->p == (obj ? '}' : ']')) { ps->p++; ps->depth--; return v; }
        for (;;) {
            char *key = NULL;
            if (obj) {
                skip_ws(ps);
                if (ps->p >= ps->end || *ps->p != '"') { ps->error = "expected key"; sj_free(v); return NULL; }
                ps->p++;
                size_t kl;
                key = parse_string_raw(ps, &kl);
                if (!key) { sj_free(v); return NULL; }
                skip_ws(ps);
                if (ps->p >= ps->end || *ps->p != ':') { ps->error = "expected ':'"; free(key); sj_free(v); return NULL; }
                ps->p++;
            }
            sj *item = parse_value(ps);
            if (!item) { free(key); sj_free(v); return NULL; }
            if (v->count == cap) {
                cap = cap ? cap * 2 : 8;
                v->items = (sj **)realloc(v->items, cap * sizeof(sj *));
                if (obj) v->keys = (char **)realloc(v->keys, cap * sizeof(char *));
            }
            v->items[v->count] = item;
            if (obj) v->keys[v->count] = key;
            v->count++;
            skip_ws(ps);
            if (ps->p < ps->end && *ps->p == ',') { ps->p++; continue; }
            if (ps->p < ps->end && *ps->p == (obj ? '}' : ']')) { ps->p++; break; }
            ps->error = "expected ',' or closing bracket";
            sj_free(v);
            return NULL;
        }
    } else if (c == '"') {
        ps->p++;
        v = new_value(SJ_STR);
        v->text = parse_string_raw(ps, &v->len);
        if (!v->text) { free(v); return NULL; }
    } else if (c == 't' && ps->end - ps->p >= 4 && !strncmp(ps->p, "true", 4)) {
        v = new_value(SJ_BOOL); v->boolean = 1; ps->p += 4;
    } else if (c == 'f' && ps->end - ps->p >= 5 && !strncmp(ps->p, "false", 5)) {
        v = new_value(SJ_BOOL); v->boolean = 0; ps->p += 5;
    } else if (c == 'n' && ps->end - ps->p >= 4 && !strncmp(ps->p, "null", 4)) {
        v = new_value(SJ_NULL); ps->p += 4;
    } else if (c == '-' || isdigit((unsigned char)c)) {
        const char *s = ps->p;
        if (*ps->p == '-') ps->p++;
        while (ps->p < ps->end && (isdigit((unsigned char)*ps->p) || *ps->p == '.' || *ps->p == 'e' || *ps->p == 'E' ||
                                   *ps->p == '+' || *ps->p == '-')) ps->p++;
        size_t n = (size_t)(ps->p - s);
        v = new_value(SJ_NUM);
        v->text = (char *)malloc(n + 1);
        memcpy(v->text, s, n);
        v->text[n] = '\0';
        char *endp = NULL;
        v->number = strtod(v->text, &endp);
        if (!endp || *endp != '\0') { ps->error = "bad number"; sj_free(v); return NULL; }
    } else {
        ps->error = "unexpected character";
        return NULL;
    }
    ps->depth--;
    return v;
}

sj *sj_parse(const char *text, size_t len, const char **error) {
    parser ps = {text, text + len, NULL, 0};
    sj *v = parse_value(&ps);
    if (v) {
        skip_ws(&ps);
        if (ps.p != ps.end) { sj_free(v); v = NULL; ps.error = "trailing characters"; }
    }
    if (!v && error) *error = ps.error ? ps.error : "invalid JSON";
    return v;
}

char *sj_read_file(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    char *buf = NULL;
    size_t n = 0, cap = 0;
    char chunk[65536];
    size_t r;
    while ((r = fread(chunk, 1, sizeof chunk, f)) > 0) {
        if (!append(&buf, &n, &cap, chunk, r)) { free(buf); fclose(f); return NULL; }
    }
    fclose(f);
    if (!buf) { buf = (char *)calloc(1, 1); }
    if (len) *len = n;
    return buf;
}

sj *sj_parse_file(const char *path, const char **error) {
    size_t n;
    char *text = sj_read_file(path, &n);
    if (!text) { if (error) *error = "cannot read file"; return NULL; }
    sj *v = sj_parse(text, n, error);
    free(text);
    return v;
}

void sj_free(sj *v) {
    if (!v) return;
    for (size_t i = 0; i < v->count; i++) {
        sj_free(v->items[i]);
        if (v->keys) free(v->keys[i]);
    }
    free(v->items);
    free(v->keys);
    free(v->text);
    free(v);
}

sj *sj_get(const sj *o, const char *key) {
    if (!o || o->type != SJ_OBJ) return NULL;
    for (size_t i = 0; i < o->count; i++) if (!strcmp(o->keys[i], key)) return o->items[i];
    return NULL;
}

sj *sj_at(const sj *a, size_t i) {
    if (!a || (a->type != SJ_ARR && a->type != SJ_OBJ) || i >= a->count) return NULL;
    return a->items[i];
}

const char *sj_str(const sj *v) { return v && v->type == SJ_STR ? v->text : NULL; }

int sj_is_null(const sj *v) { return !v || v->type == SJ_NULL; }

static void dump_string(char **buf, size_t *len, size_t *cap, const char *s, size_t n) {
    append(buf, len, cap, "\"", 1);
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        char esc[8];
        if (c == '"') append(buf, len, cap, "\\\"", 2);
        else if (c == '\\') append(buf, len, cap, "\\\\", 2);
        else if (c < 0x20) { snprintf(esc, sizeof esc, "\\u%04x", c); append(buf, len, cap, esc, 6); }
        else append(buf, len, cap, (const char *)&s[i], 1);
    }
    append(buf, len, cap, "\"", 1);
}

static void dump_value(char **buf, size_t *len, size_t *cap, const sj *v) {
    if (!v) { append(buf, len, cap, "null", 4); return; }
    switch (v->type) {
        case SJ_NULL: append(buf, len, cap, "null", 4); break;
        case SJ_BOOL: append(buf, len, cap, v->boolean ? "true" : "false", v->boolean ? 4 : 5); break;
        case SJ_NUM: append(buf, len, cap, v->text, strlen(v->text)); break;
        case SJ_STR: dump_string(buf, len, cap, v->text, v->len); break;
        case SJ_ARR:
        case SJ_OBJ:
            append(buf, len, cap, v->type == SJ_ARR ? "[" : "{", 1);
            for (size_t i = 0; i < v->count; i++) {
                if (i) append(buf, len, cap, ",", 1);
                if (v->type == SJ_OBJ) {
                    dump_string(buf, len, cap, v->keys[i], strlen(v->keys[i]));
                    append(buf, len, cap, ":", 1);
                }
                dump_value(buf, len, cap, v->items[i]);
            }
            append(buf, len, cap, v->type == SJ_ARR ? "]" : "}", 1);
            break;
    }
}

char *sj_dump(const sj *v) {
    char *buf = NULL;
    size_t len = 0, cap = 0;
    append(&buf, &len, &cap, "", 0);
    dump_value(&buf, &len, &cap, v);
    return buf;
}

static int fail(char *why, size_t n, const char *path, const char *msg) {
    if (why && n) snprintf(why, n, "%s: %s", path, msg);
    return 0;
}

static int equal_at(const sj *a, const sj *b, double tol, char *why, size_t n, const char *path) {
    char sub[512];
    if (sj_is_null(a) || sj_is_null(b)) return sj_is_null(a) == sj_is_null(b) ? 1 : fail(why, n, path, "null mismatch");
    if (a->type != b->type) return fail(why, n, path, "type mismatch");
    switch (a->type) {
        case SJ_BOOL: return a->boolean == b->boolean ? 1 : fail(why, n, path, "boolean differs");
        case SJ_NUM: {
            if (fabs(a->number - b->number) <= tol) return 1;
            char m[160];
            snprintf(m, sizeof m, "expected %s, got %s", a->text, b->text);
            return fail(why, n, path, m);
        }
        case SJ_STR: {
            if (a->len == b->len && !memcmp(a->text, b->text, a->len)) return 1;
            char m[400];
            snprintf(m, sizeof m, "expected \"%.150s\", got \"%.150s\"", a->text, b->text);
            return fail(why, n, path, m);
        }
        case SJ_ARR:
            if (a->count != b->count) return fail(why, n, path, "array length differs");
            for (size_t i = 0; i < a->count; i++) {
                snprintf(sub, sizeof sub, "%s[%zu]", path, i);
                if (!equal_at(a->items[i], b->items[i], tol, why, n, sub)) return 0;
            }
            return 1;
        case SJ_OBJ:
            if (a->count != b->count) {
                for (size_t i = 0; i < b->count; i++)
                    if (!sj_get(a, b->keys[i])) { snprintf(sub, sizeof sub, "%s.%s", path, b->keys[i]); return fail(why, n, sub, "unexpected key"); }
            }
            for (size_t i = 0; i < a->count; i++) {
                snprintf(sub, sizeof sub, "%s.%s", path, a->keys[i]);
                sj *bv = NULL;
                int found = 0;
                for (size_t j = 0; j < b->count; j++) if (!strcmp(b->keys[j], a->keys[i])) { bv = b->items[j]; found = 1; break; }
                if (!found) return fail(why, n, sub, "missing");
                if (!equal_at(a->items[i], bv, tol, why, n, sub)) return 0;
            }
            return 1;
        default: return 1;
    }
}

int sj_equal(const sj *want, const sj *got, double tol, char *why, size_t why_len) {
    return equal_at(want, got, tol, why, why_len, "$");
}
