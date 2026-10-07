#ifndef CSPDF_H
#define CSPDF_H

#include <stdint.h>
#include <sqlite3.h>

/// Enables SQLITE_DBCONFIG_DEFENSIVE (sqlite3_db_config is variadic, so Swift
/// cannot call it directly). Returns an SQLite result code.
int cspdf_enable_defensive(sqlite3 *db);

/// Gunzips `src` into `dst` (gzip, multi-member, or a plain file copied as is),
/// refusing outputs larger than `limit` bytes. Returns 0 on success,
/// -1 on I/O or format errors, -2 when the limit is exceeded.
int cspdf_gunzip_file(const char *src, const char *dst, int64_t limit);

#endif
