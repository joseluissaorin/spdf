package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.SqlRow
import io.github.joseluissaorin.spdf.sql.SqlValue
import io.github.joseluissaorin.spdf.sql.asBytes
import io.github.joseluissaorin.spdf.sql.asLong
import io.github.joseluissaorin.spdf.sql.asText
import io.github.joseluissaorin.spdf.sql.exec
import io.github.joseluissaorin.spdf.sql.quoteIdent
import io.github.joseluissaorin.spdf.sql.rows
import java.io.File

/** A validation error or warning. */
public data class Issue(val code: String, val message: String, val where: String) : JsonConvertible {
    override fun toJson(): Map<String, Any?> = linkedMapOf("code" to code, "message" to message, "where" to where)
}

/** The result of [Validator.validate] (SPEC §22). */
public data class ValidationResult(
    /** True if and only if there are no errors (`isValid()` from Java). */
    val isValid: Boolean,
    /** "5.0", "4.1"…, or null when the version is unknown. */
    val version: String?,
    val profile: List<String>,
    val errors: List<Issue>,
    val warnings: List<Issue>,
) : JsonConvertible {
    /** Error codes, sorted and unique. */
    val errorCodes: List<String> get() = errors.map { it.code }.distinct().sorted()

    /** Warning codes, sorted and unique. */
    val warningCodes: List<String> get() = warnings.map { it.code }.distinct().sorted()

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "valid" to isValid, "version" to version, "profile" to profile, "errors" to errors, "warnings" to warnings,
    )
}

/** The validator of SPEC §22: every code, in the reference order. */
public object Validator {
    private val REQUIRED_COLUMNS: List<Pair<String, List<String>>> = listOf(
        "spdf_meta" to listOf("key", "value"),
        "documents" to listOf(
            "id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration", "created",
            "updated", "title", "authors", "year", "language", "rights",
        ),
        "units" to listOf(
            "id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader", "confidence",
            "printed", "t0", "t1", "words",
        ),
        "sections" to listOf("id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"),
        "fragments" to listOf("n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"),
        "fragments_fts" to emptyList(),
        "figures" to listOf("id", "document", "unit", "image", "caption", "description", "anchor"),
        "spaces" to listOf(
            "id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities", "task_prefixes", "created",
        ),
        "vectors" to listOf("target", "id", "space", "document", "data"),
        "blobs" to listOf("key", "mime", "sha256", "data"),
        "provenance" to listOf("document", "stage", "provider", "model", "detail", "ms", "at"),
        "extensions" to listOf("name", "version", "required"),
    )
    private val FORWARD_COMPATIBLE_CODES = setOf("E041", "E032")
    private val REQUIRED_META = listOf("spdf_version", "profile", "created", "generator", "document_id")
    private val ANCHOR_TYPES = setOf("page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical")
    private val FTS5_USING = java.util.regex.Pattern.compile(
        "USING\\s+fts5\\s*\\(",
        java.util.regex.Pattern.CASE_INSENSITIVE,
    )

    /** Validates a file with the default adapter. */
    @JvmStatic
    public fun validate(path: String): ValidationResult = validate(File(path), SqlDriver.default(), OpenOptions.DEFAULT)

    /** Validates a file. Never throws for problems of the file: they are in the result. */
    @JvmStatic
    @JvmOverloads
    public fun validate(file: File, driver: SqlDriver = SqlDriver.default(), options: OpenOptions = OpenOptions.DEFAULT): ValidationResult {
        val v = Run()
        val c = try {
            Container.open(file, driver, options, strict = false)
        } catch (e: SpdfException) {
            v.err(e.code ?: "E001", e.detail, e.where ?: file.path)
            return v.result()
        } catch (e: Exception) {
            v.err("E001", e.message ?: e.toString(), file.path)
            return v.result()
        }
        c.use { v.run(it) }
        return v.result()
    }

    /** Checks one parsed anchor; [text] is the unit text `chars` must fit in (null: unknown). Returns (code, message) or null. */
    @JvmStatic
    public fun checkAnchor(a: Any?, text: String?): Pair<String, String>? {
        val m = asMap(Json.toTree(a)) ?: return "E040" to "anchor is not an object"
        val t = m["type"] as? String ?: return "E040" to "anchor without type"
        if (t !in ANCHOR_TYPES) return "E041" to "unknown anchor type $t"
        val ok = when (t) {
            "page" -> isIntegral(m["physical"]) && numberValue(m["physical"])!! >= 1 && m.containsKey("printed") &&
                (m["printed"] == null || m["printed"] is String)
            "time" -> isNumber(m["t0"]) && isNumber(m["t1"]) && 0 <= numberValue(m["t0"])!! && numberValue(m["t0"])!! <= numberValue(m["t1"])!!
            "section" -> m["path"] is List<*> && (m["path"] as List<*>).all { it is String }
            "slide" -> isIntegral(m["n"]) && numberValue(m["n"])!! >= 1
            "sheet" -> m["sheet"] is String && isIntegral(m["row_from"]) && isIntegral(m["row_to"])
            "web" -> m["url"] is String
            "verse" -> isIntegral(m["line_from"])
            "canonical" -> m["scheme"] is String && m["ref"] is String
            else -> true // image
        }
        if (!ok) return "E040" to "$t anchor misses or mistypes a required member"
        if (m.containsKey("region")) {
            val r = asMap(m["region"])
            if (r == null || !listOf("x", "y", "w", "h").all { isNumber(r[it]) }) return "E040" to "bad region"
        }
        if (m.containsKey("chars")) {
            val c = asList(m["chars"])
            if (c == null || c.size != 2 || !c.all { isIntegral(it) }) return "E040" to "bad chars"
            if (text != null) {
                val n = codePointLength(nfc(text))
                val a0 = numberValue(c[0])!!
                val a1 = numberValue(c[1])!!
                if (!(0 <= a0 && a0 <= a1 && a1 <= n)) return "E042" to "chars [${pyStr(c[0])}, ${pyStr(c[1])}] out of range (unit text has $n code points)"
            }
        }
        return null
    }

    private class Run {
        val errors = ArrayList<Issue>()
        val warnings = ArrayList<Issue>()
        var version: String? = null
        var profile: List<String> = emptyList()

        /** In a newer minor version, codes a later minor may legitimately produce are warnings. */
        var forwardCompatible = false

        fun err(code: String, msg: String, where: String = "") {
            if (forwardCompatible && code in FORWARD_COMPATIBLE_CODES) warnings += Issue(code, msg, where) else errors += Issue(code, msg, where)
        }

        fun warn(code: String, msg: String, where: String = "") {
            warnings += Issue(code, msg, where)
        }

        fun result() = ValidationResult(errors.isEmpty(), version, profile, errors.toList(), warnings.toList())

        /** Runs a check; a query that fails (malformed table…) just skips it, as the reference does. */
        inline fun guard(block: () -> Unit) {
            try {
                block()
            } catch (e: RuntimeException) {
                // skip this check
            }
        }

        fun run(c: Container) {
            version = c.version
            if (c.kind == '?') {
                err("E002", "unknown application_id or user_version")
                return
            }
            val conn = c.conn
            if (c.legacy) {
                warn("W110", "legacy SPDF $version file")
                for (t in listOf("spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts")) {
                    if (t !in c.tables) err("E010", "missing legacy table $t", t)
                }
                for (e in c.master.filter { it.type == "trigger" || it.type == "view" }) {
                    if (!(e.type == "trigger" && e.name in Legacy.TRIGGERS)) err("E020", "${e.type} ${e.name} present", e.name)
                }
                return
            }
            if (c.gzipped) warn("E003", "SPDF 5.0 should not be gzip-wrapped")
            if (version != "5.0") {
                warn("W105", "newer minor version $version")
                forwardCompatible = true // SPEC §22.1 step 4: unknown anchor types and dtypes
            }
            for (e in c.master.filter { it.type == "trigger" || it.type == "view" }) err("E020", "${e.type} ${e.name} present", e.name)
            for (e in c.master) {
                if (e.type != "table" || !(e.sql ?: "").uppercase(java.util.Locale.ROOT).startsWith("CREATE VIRTUAL TABLE")) continue
                if (e.name !in ALLOWED_VTABLES || !FTS5_USING.matcher(e.sql ?: "").find()) err("E020", "virtual table ${e.name} present", e.name)
            }
            val tables = c.tables
            val present = HashMap<String, Set<String>>()
            for ((t, cols) in REQUIRED_COLUMNS) {
                if (t !in tables) {
                    err("E010", "missing table $t", t)
                    continue
                }
                val have = if (t == "fragments_fts") emptySet() else c.columns(t)
                present[t] = have
                for (col in cols) if (col !in have) err("E011", "missing column $t.$col", "$t.$col")
            }
            fun ok(t: String, vararg cols: String) = present[t]?.let { p -> cols.all { it in p } } ?: false

            // spdf_meta
            val meta = LinkedHashMap<String, Any?>()
            if (ok("spdf_meta", "key", "value")) {
                guard {
                    conn.rows("SELECT key, value FROM spdf_meta").forEach { meta[it[0].asText() ?: ""] = it[1].toAny() }
                    for (k in REQUIRED_META) if (!meta.containsKey(k)) err("E012", "missing spdf_meta key $k", k)
                    profile = ((meta["profile"] as? String) ?: "").split(Regex("\\s+")).filter { it.isNotEmpty() }
                }
            }
            // documents
            var docs: List<SqlRow>? = null
            if (ok("documents", "id", "metadata")) {
                guard {
                    val full = ok("documents", "rights", "unit_count")
                    val d = conn.rows(if (full) "SELECT id, metadata, rights, unit_count FROM documents" else "SELECT id, metadata FROM documents")
                    docs = d
                    if (d.size != 1) err("E013", "documents has ${d.size} rows", "documents")
                    for (r in d) {
                        val id = r[0].asText() ?: ""
                        val md = r[1]
                        var parsed: Any? = null
                        var parsedOk = false
                        if (md is SqlValue.Text || md is SqlValue.Blob) {
                            try {
                                parsed = Json.parse(md.asText()!!)
                                parsedOk = true
                            } catch (e: SpdfException) {
                                err("E050", "metadata is not valid JSON", id)
                            }
                        } else {
                            err("E050", "metadata is not valid JSON", id)
                        }
                        if (parsedOk) {
                            val m = asMap(parsed)
                            if (m == null || m["type"] !is String || m["title"] !is String) err("E051", "metadata needs a string type and title", id)
                        }
                        if (full && r[2] != SqlValue.Null) {
                            val rights = r[2]
                            val bad = if (rights is SqlValue.Text || rights is SqlValue.Blob) {
                                try {
                                    Json.parse(rights.asText()!!)
                                    false
                                } catch (e: SpdfException) {
                                    true
                                }
                            } else {
                                true
                            }
                            if (bad) err("E050", "rights is not valid JSON", id)
                        }
                    }
                }
            }
            // extensions
            if (ok("extensions", "name", "required")) {
                guard {
                    for (r in conn.rows("SELECT name, required FROM extensions ORDER BY name")) {
                        val name = r[0].asText() ?: ""
                        if (sqlTruthy(r[1]) && name !in Container.KNOWN_EXTENSIONS) err("E060", "unknown required extension $name", name)
                    }
                }
            }
            // units, fragments, figures
            val texts = HashMap<String, String?>()
            if (ok("units", "id", "ord", "anchor", "text")) {
                guard {
                    val rows = conn.rows("SELECT id, ord, anchor, text FROM units ORDER BY ord, id")
                    val contiguous = rows.withIndex().all { (i, r) ->
                        when (val o = r[1]) {
                            is SqlValue.Integer -> o.value == (i + 1).toLong()
                            is SqlValue.Real -> o.value == (i + 1).toDouble()
                            else -> false
                        }
                    }
                    if (!contiguous) err("E090", "units.ord is not 1..N", "units")
                    val d = docs
                    if (d != null && d.size == 1 && d[0].size > 3 && d[0][3] != SqlValue.Null) {
                        val uc = d[0][3]
                        val same = when (uc) {
                            is SqlValue.Integer -> uc.value == rows.size.toLong()
                            is SqlValue.Real -> uc.value == rows.size.toDouble()
                            else -> false
                        }
                        if (!same) warn("W102", "unit_count ${uc.toAny()} but ${rows.size} units", "documents.unit_count")
                    }
                    for (r in rows) {
                        val uid = r[0].asText() ?: ""
                        val text = r[3].asText()
                        texts[uid] = text
                        anchorErr(r[2], text, "units/$uid")
                    }
                }
            }
            if (ok("fragments", "id", "unit", "anchor")) {
                guard {
                    val end = if ("anchor_end" in present.getValue("fragments")) "anchor_end" else "NULL"
                    for (r in conn.rows("SELECT id, unit, anchor, $end FROM fragments ORDER BY n")) {
                        val fid = r[0].asText() ?: ""
                        anchorErr(r[2], texts[r[1].asText() ?: ""], "fragments/$fid")
                        if (r[3] != SqlValue.Null) anchorErr(r[3], null, "fragments/$fid/anchor_end")
                    }
                }
            }
            if (ok("figures", "id", "unit", "anchor")) {
                guard {
                    for (r in conn.rows("SELECT id, unit, anchor FROM figures ORDER BY id")) {
                        anchorErr(r[2], texts[r[1].asText() ?: ""], "figures/${r[0].asText() ?: ""}")
                    }
                }
            }
            // spaces and vectors
            val spaces = HashMap<String, Pair<SqlValue, String?>>()
            if (ok("spaces", "id", "dims", "dtype")) {
                guard {
                    for (r in conn.rows("SELECT id, dims, dtype FROM spaces ORDER BY id")) {
                        val sid = r[0].asText() ?: ""
                        val dtype = (r[2] as? SqlValue.Text)?.value
                        spaces[sid] = r[1] to dtype
                        if (Vectors.size(dtype) == 0) err("E032", "unknown dtype ${pyStr(r[2].toAny())}", sid)
                    }
                }
            }
            var nvec = 0
            if (ok("vectors", "target", "id", "space", "data")) {
                guard {
                    for (r in conn.rows("SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id")) {
                        nvec++
                        val space = r[2].asText() ?: ""
                        val where = "vectors/$space/${r[0].asText() ?: ""}/${r[1].asText() ?: ""}"
                        val sp = spaces[space]
                        if (sp == null) {
                            err("E031", "unknown space $space", where)
                            continue
                        }
                        val size = Vectors.size(sp.second)
                        if (size == 0) continue
                        val dims = sp.first.asLong()
                        val len = r[4].asLong() ?: -1
                        if (r[3].asText() != "blob" || dims == null || len != dims * size) {
                            err("E030", "vector length $len != ${pyStr(sp.first.toAny())} x $size", where)
                        }
                    }
                }
            }
            // FTS index, on a private copy (the check is a write)
            if ("fragments_fts" in tables) {
                try {
                    c.driver.openPrivateCopy(c.physical.path, c.options.tempDir).use { copy ->
                        copy.exec("PRAGMA trusted_schema = OFF")
                        copy.exec("INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)")
                        if ("fragments_fts_trigram" in tables) {
                            copy.exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)")
                        }
                    }
                } catch (e: Exception) {
                    err("E070", "FTS index out of sync: ${e.message}", "fragments_fts")
                }
            }
            // blobs
            if (ok("blobs", "key", "sha256", "data")) {
                guard {
                    conn.query("SELECT key, sha256, data FROM blobs ORDER BY key", emptyList()) { r ->
                        val data = r[2].asBytes() ?: ByteArray(0)
                        if (sha256Hex(data) != r[1].asText()) err("E080", "blob sha256 mismatch", r[0].asText() ?: "")
                    }
                }
            }
            // integrity
            if (meta.containsKey("content_sha256") && errors.isEmpty()) {
                val actual = try {
                    SpdfFile.contentSha256Of(SpdfFile.of(c).dump())
                } catch (e: Exception) {
                    "unavailable (${e.message})"
                }
                if (actual != meta["content_sha256"]) {
                    err("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
                } else if (meta.containsKey("signature")) {
                    if (!verifySignature(actual, meta["signature"], meta["signer"])) {
                        err("E082", "signature does not verify", "spdf_meta.signature")
                    }
                }
            }
            // profile warnings
            if ("semantic" in profile && nvec == 0) warn("W100", "profile semantic without vectors")
            if ("media" in profile && ok("units", "anchor")) {
                var hasTime = false
                guard {
                    for (r in conn.rows("SELECT anchor FROM units")) {
                        val a = try {
                            r[0].asText()?.let { Json.parse(it) }
                        } catch (e: SpdfException) {
                            null
                        }
                        if (asMap(a)?.get("type") == "time") hasTime = true
                    }
                }
                if (!hasTime) warn("W101", "profile media without time anchors")
            }
        }

        private fun anchorErr(raw: SqlValue, text: String?, where: String) {
            val a = if (raw is SqlValue.Text || raw is SqlValue.Blob) {
                try {
                    Json.parse(raw.asText()!!)
                } catch (e: SpdfException) {
                    err("E040", "anchor is not valid JSON", where)
                    return
                }
            } else {
                err("E040", "anchor is not valid JSON", where)
                return
            }
            checkAnchor(a, text)?.let { (code, msg) -> err(code, msg, where) }
        }
    }

    /** Verifies `signature` over `spdf-content-sha256:<hex>` with `signer` (`ed25519:<base64 key>`). */
    @JvmStatic
    public fun verifySignature(contentSha256: String, signature: Any?, signer: Any?): Boolean {
        if (signer !is String || !signer.startsWith("ed25519:") || signature !is String) return false
        return try {
            val pk = base64Decode(signer.substring(8))
            val sig = base64Decode(signature)
            Ed25519.verify(pk, (Spdf.SIGNATURE_PREFIX + contentSha256).toByteArray(Charsets.US_ASCII), sig)
        } catch (e: IllegalArgumentException) {
            false
        }
    }
}
