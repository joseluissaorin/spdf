/*
 * sjson: a small JSON reader and writer for the SPDF C examples and the conformance
 * runner. Not part of the SPDF ABI. Numbers keep their source text so that values are
 * passed back to the library exactly as written.
 *
 * SPDX-License-Identifier: MIT OR Apache-2.0
 */
#ifndef SPDF_SJSON_H
#define SPDF_SJSON_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { SJ_NULL, SJ_BOOL, SJ_NUM, SJ_STR, SJ_ARR, SJ_OBJ } sj_type;

typedef struct sj {
    sj_type type;
    int boolean;          /* SJ_BOOL */
    double number;        /* SJ_NUM */
    char *text;           /* SJ_NUM: source lexeme; SJ_STR: UTF-8 value (NUL-terminated) */
    size_t len;           /* SJ_STR: byte length */
    size_t count;         /* SJ_ARR, SJ_OBJ */
    struct sj **items;    /* SJ_ARR, SJ_OBJ: values */
    char **keys;          /* SJ_OBJ: keys */
} sj;

/* Parses JSON text; returns NULL and sets *error (static string) on failure. */
sj *sj_parse(const char *text, size_t len, const char **error);
/* Reads and parses a whole file. */
sj *sj_parse_file(const char *path, const char **error);
void sj_free(sj *v);

sj *sj_get(const sj *object, const char *key);   /* NULL if absent or not an object */
sj *sj_at(const sj *array, size_t i);             /* NULL if out of range */
const char *sj_str(const sj *v);                  /* string value or NULL */
int sj_is_null(const sj *v);                      /* NULL pointer or JSON null */

/* Compact JSON text of a value (numbers verbatim); free with free(). */
char *sj_dump(const sj *v);

/* Structural equality: object key order ignored, numbers within `tolerance`.
 * Returns 1 if equal; otherwise 0 and a reason in `why`. */
int sj_equal(const sj *want, const sj *got, double tolerance, char *why, size_t why_len);

/* Reads a whole file into a NUL-terminated buffer (free with free()). */
char *sj_read_file(const char *path, size_t *len);

#ifdef __cplusplus
}
#endif

#endif /* SPDF_SJSON_H */
