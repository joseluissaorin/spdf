/*
 * Validates SPDF files and prints the report of the specification for each one.
 *   spdf_validate FILE...
 * Exit status 1 if any file is invalid.
 * SPDX-License-Identifier: MIT OR Apache-2.0
 */
#include <stdio.h>
#include <string.h>

#include "spdf.h"

int main(int argc, char **argv) {
    int invalid = 0;
    for (int i = 1; i < argc; i++) {
        char *report = NULL;
        if (spdf_validate(argv[i], &report) != SPDF_OK) {
            fprintf(stderr, "%s: %s\n", argv[i], spdf_last_error());
            invalid = 1;
            continue;
        }
        printf("%s\n%s\n", argv[i], report);
        if (strstr(report, "\"valid\":false")) invalid = 1;
        spdf_string_free(report);
    }
    return invalid;
}
