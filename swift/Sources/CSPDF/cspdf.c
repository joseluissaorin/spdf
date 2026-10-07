#include "cspdf.h"

#include <stdio.h>
#include <zlib.h>

int cspdf_enable_defensive(sqlite3 *db) {
#ifdef SQLITE_DBCONFIG_DEFENSIVE
    return sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, (int *)0);
#else
    (void)db;
    return SQLITE_OK;
#endif
}

int cspdf_gunzip_file(const char *src, const char *dst, int64_t limit) {
    gzFile in = gzopen(src, "rb");
    if (!in) return -1;
    FILE *out = fopen(dst, "wb");
    if (!out) {
        gzclose(in);
        return -1;
    }
    char buf[1 << 16];
    int64_t total = 0;
    int rc = 0;
    for (;;) {
        int n = gzread(in, buf, (unsigned)sizeof buf);
        if (n < 0) {
            rc = -1;
            break;
        }
        if (n == 0) {
            int err = 0;
            gzerror(in, &err);
            if (err != Z_OK && err != Z_STREAM_END) rc = -1;
            break;
        }
        total += n;
        if (total > limit) {
            rc = -2;
            break;
        }
        if (fwrite(buf, 1, (size_t)n, out) != (size_t)n) {
            rc = -1;
            break;
        }
    }
    if (gzclose(in) != Z_OK && rc == 0) rc = -1;
    if (fclose(out) != 0 && rc == 0) rc = -1;
    return rc;
}
