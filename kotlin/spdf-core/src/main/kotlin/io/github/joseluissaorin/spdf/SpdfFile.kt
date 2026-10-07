package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlDriver
import io.github.joseluissaorin.spdf.sql.SqlRow
import io.github.joseluissaorin.spdf.sql.SqlValue
import io.github.joseluissaorin.spdf.sql.asBytes
import io.github.joseluissaorin.spdf.sql.asText
import io.github.joseluissaorin.spdf.sql.each
import io.github.joseluissaorin.spdf.sql.quoteIdent
import io.github.joseluissaorin.spdf.sql.rows
import java.io.File

/**
 * An open SPDF file (5.0, or legacy 4.0/4.1 through the 5.0 view), read-only. Not thread-safe:
 * use one instance per thread. Close it (it is [AutoCloseable]) to release the connection and
 * any temporary copy.
 *
 * ```kotlin
 * SpdfFile.open("quijote.spdf").use { f ->
 *     for (hit in f.searchLexical("«lugar de la Mancha»", 5)) println(hit.anchorUri)
 * }
 * ```
 */
public class SpdfFile private constructor(private val c: Container) : AutoCloseable {
    private var closed = false

    /** SPDF version of the file: "5.0", "5.1"…, or "4.1" / "4.0" for legacy files. */
    public val version: String get() = c.version ?: ""

    /** True for legacy 4.x files (Spanish schema). */
    public val isLegacy: Boolean get() = c.legacy

    /** True if the file was gzip-wrapped. */
    public val isGzipped: Boolean get() = c.gzipped

    /** The path the file was opened from. */
    public val path: String get() = c.display

    /** The SQLite adapter in use. */
    public val driver: SqlDriver get() = c.driver

    /** The protections the SQLite binding could enforce (SPEC §2.4). */
    public val safety: io.github.joseluissaorin.spdf.sql.SqlSafety get() = c.conn.safety

    override fun close() {
        if (!closed) {
            closed = true
            c.close()
        }
    }

    private fun live(): Container {
        if (closed) throw IllegalStateException("SPDF file is closed")
        return c
    }

    // ------------------------------------------------------------------ helpers

    private fun jv(v: SqlValue): Any? = when (v) {
        SqlValue.Null -> null
        is SqlValue.Integer -> v.value
        is SqlValue.Real -> v.value
        is SqlValue.Text -> v.value
        is SqlValue.Blob -> String(v.value, Charsets.UTF_8)
    }

    /** A JSON-in-TEXT column, parsed (NULL stays null). */
    private fun jcol(v: SqlValue, where: String): Any? = when (v) {
        SqlValue.Null -> null
        is SqlValue.Text, is SqlValue.Blob -> try {
            Json.parse(v.asText()!!)
        } catch (e: SpdfException) {
            throw SpdfException(null, "invalid JSON in $where: ${e.detail}", where, e)
        }
        else -> throw SpdfException(null, "JSON column $where holds a number", where)
    }

    private fun rowsOf(sql: String, vararg args: Any?): List<SqlRow> = try {
        live().conn.rows(sql, *args)
    } catch (e: SpdfException) {
        throw e
    } catch (e: Exception) {
        throw SpdfException(null, "query failed: ${e.message}", c.display, e)
    }

    private fun eachOf(sql: String, vararg args: Any?, handler: (SqlRow) -> Unit) = try {
        live().conn.each(sql, *args, handler = handler)
    } catch (e: SpdfException) {
        throw e
    } catch (e: Exception) {
        throw SpdfException(null, "query failed: ${e.message}", c.display, e)
    }

    /** Rows of a legacy table by column name (`SELECT *`), empty if the table is absent. */
    private fun legacyRows(table: String, order: String): List<SqlRow> =
        if (table in c.tables) rowsOf("SELECT * FROM ${quoteIdent(table)} $order") else emptyList()

    private val blobKeys: Set<String> by lazy {
        if ("blobs" in c.tables) rowsOf("SELECT clave FROM blobs").mapNotNull { it[0].asText() }.toSet() else emptySet()
    }

    // ------------------------------------------------------------- dump pieces

    /** `spdf_meta` as JSON values (legacy keys mapped), ordered by key. */
    private fun metaValues(): Map<String, Any?> {
        val out = java.util.TreeMap<String, Any?>(codePointOrder)
        if (!c.legacy) {
            eachOf("SELECT key, value FROM spdf_meta ORDER BY key") { out[it[0].asText() ?: ""] = jv(it[1]) }
        } else {
            eachOf("SELECT clave, valor FROM spdf ORDER BY clave") {
                val k = it[0].asText() ?: ""
                out[Legacy.META_KEYS[k] ?: k] = jv(it[1])
            }
        }
        return LinkedHashMap(out)
    }

    private fun documentRow(): Map<String, Any?> {
        if (!c.legacy) {
            val rows = rowsOf(
                "SELECT id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, " +
                    "title, authors, year, language, rights FROM documents ORDER BY id",
            )
            if (rows.size != 1) throw SpdfException("E013", "documents must hold exactly one row (it has ${rows.size})", "documents")
            val r = rows[0]
            val d = LinkedHashMap<String, Any?>()
            for (k in r.columns) d[k] = jv(r[k])
            d["metadata"] = jcol(r["metadata"], "documents.metadata")
            d["rights"] = jcol(r["rights"], "documents.rights")
            return d
        }
        val rows = legacyRows("documentos", "ORDER BY id")
        if (rows.size != 1) throw SpdfException("E013", "documents must hold exactly one row (it has ${rows.size})", "documentos")
        val r = rows[0]
        val tipo = jv(r["tipo"])
        return linkedMapOf(
            "id" to jv(r["id"]),
            "kind" to ((tipo as? String)?.let { Legacy.KINDS[it] } ?: tipo),
            "metadata" to Legacy.metadata(jcol(r["metadatos"], "documentos.metadatos"), tipo as? String),
            "source_sha256" to jv(r["huella"]),
            "source_ref" to Legacy.ref(jv(r["original"]), blobKeys),
            "mime" to jv(r["mime"]),
            "bytes" to jv(r["bytes"]),
            "unit_count" to jv(r["unidades"]),
            "duration" to jv(r["duracion"]),
            "created" to jv(r["creado"]),
            "updated" to jv(r["actualizado"]),
            "title" to jv(r["titulo"]),
            "authors" to jv(r["autores"]),
            "year" to jv(r["anio"]),
            "language" to jv(r["idioma"]),
            "rights" to null,
        )
    }

    private fun unitRows(): List<Map<String, Any?>> {
        if (!c.legacy) {
            return rowsOf(
                "SELECT id, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words " +
                    "FROM units ORDER BY ord, id",
            ).map { r ->
                val u = LinkedHashMap<String, Any?>()
                for (k in r.columns) u[k] = jv(r[k])
                val id = u["id"]
                u["anchor"] = jcol(r["anchor"], "units/$id/anchor")
                u["notes"] = jcol(r["notes"], "units/$id/notes")
                u["words"] = jcol(r["words"], "units/$id/words")
                u
            }
        }
        return legacyRows("unidades", "ORDER BY orden, id").mapIndexed { i, r ->
            val id = jv(r["id"])
            linkedMapOf(
                "id" to id, "ord" to (i + 1).toLong(), "anchor" to Legacy.anchor(jcol(r["ancla"], "unidades/$id/ancla")),
                "text" to jv(r["texto"]), "notes" to jcol(r["notas"], "unidades/$id/notas"), "header" to jv(r["cabecera"]),
                "footer" to jv(r["pie"]), "image" to Legacy.ref(jv(r["imagen"]), blobKeys),
                "thumbnail" to Legacy.ref(jv(r["miniatura"]), blobKeys), "reader" to jv(r["lector"]),
                "confidence" to jv(r["confianza"]), "printed" to jv(r["impresa"]), "t0" to jv(r["t0"]), "t1" to jv(r["t1"]),
                "words" to if (r.has("palabras")) jcol(r["palabras"], "unidades/$id/palabras") else null,
            )
        }
    }

    private fun sectionRows(): List<Map<String, Any?>> {
        if (!c.legacy) {
            if (!c.hasTable("sections")) return emptyList()
            return rowsOf("SELECT id, parent, level, title, unit_from, unit_to, summary FROM sections ORDER BY id").map { r ->
                LinkedHashMap<String, Any?>().apply { for (k in r.columns) put(k, jv(r[k])) }
            }
        }
        return legacyRows("secciones", "ORDER BY id").map { r ->
            linkedMapOf(
                "id" to jv(r["id"]), "parent" to jv(r["padre"]), "level" to jv(r["nivel"]), "title" to jv(r["titulo"]),
                "unit_from" to jv(r["unidad_desde"]), "unit_to" to jv(r["unidad_hasta"]), "summary" to jv(r["resumen"]),
            )
        }
    }

    private fun fragmentRows(where: String = "", vararg args: Any?): List<Map<String, Any?>> {
        if (!c.legacy) {
            return rowsOf(
                "SELECT n, id, unit, ord, text, context, section, anchor, anchor_end, search_text FROM fragments $where ORDER BY n",
                *args,
            ).map { r ->
                val f = LinkedHashMap<String, Any?>()
                for (k in r.columns) f[k] = jv(r[k])
                val id = f["id"]
                f["section"] = jcol(r["section"], "fragments/$id/section")
                f["anchor"] = jcol(r["anchor"], "fragments/$id/anchor")
                f["anchor_end"] = jcol(r["anchor_end"], "fragments/$id/anchor_end")
                f
            }
        }
        if ("fragmentos" !in c.tables) return emptyList()
        return rowsOf("SELECT * FROM fragmentos $where ORDER BY n", *args).map { r ->
            val id = jv(r["id"])
            linkedMapOf(
                "n" to jv(r["n"]), "id" to id, "unit" to jv(r["unidad"]), "ord" to jv(r["orden"]), "text" to jv(r["texto"]),
                "context" to jv(r["contexto"]), "section" to jcol(r["seccion"], "fragmentos/$id/seccion"),
                "anchor" to Legacy.anchor(jcol(r["ancla"], "fragmentos/$id/ancla")),
                "anchor_end" to Legacy.anchor(jcol(r["ancla_fin"], "fragmentos/$id/ancla_fin")),
                "search_text" to if (r.has("texto_busqueda")) jv(r["texto_busqueda"]) else null,
            )
        }
    }

    private fun figureRows(): List<Map<String, Any?>> {
        if (!c.legacy) {
            if (!c.hasTable("figures")) return emptyList()
            return rowsOf("SELECT id, unit, image, caption, description, anchor FROM figures ORDER BY id").map { r ->
                val g = LinkedHashMap<String, Any?>()
                for (k in r.columns) g[k] = jv(r[k])
                g["anchor"] = jcol(r["anchor"], "figures/${g["id"]}/anchor")
                g
            }
        }
        return legacyRows("figuras", "ORDER BY id").map { r ->
            val id = jv(r["id"])
            linkedMapOf(
                "id" to id, "unit" to jv(r["unidad"]), "image" to Legacy.ref(jv(r["imagen"]), blobKeys, keepEmpty = true),
                "caption" to jv(r["pie"]), "description" to jv(r["descripcion"]),
                "anchor" to Legacy.anchor(jcol(r["ancla"], "figuras/$id/ancla")),
            )
        }
    }

    private fun spaceRows(): List<Map<String, Any?>> {
        if (!c.legacy) {
            if (!c.hasTable("spaces")) return emptyList()
            return rowsOf(
                "SELECT id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created " +
                    "FROM spaces ORDER BY id",
            ).map { r ->
                val s = LinkedHashMap<String, Any?>()
                for (k in r.columns) s[k] = jv(r[k])
                s["modalities"] = jcol(r["modalities"], "spaces/${s["id"]}/modalities")
                s["task_prefixes"] = jcol(r["task_prefixes"], "spaces/${s["id"]}/task_prefixes")
                s
            }
        }
        return legacyRows("espacios", "ORDER BY id").map { r ->
            val id = jv(r["id"])
            val mods = jcol(r["modalidades"], "espacios/$id/modalidades")
            linkedMapOf(
                "id" to id, "provider" to jv(r["proveedor"]), "model" to jv(r["modelo"]), "version" to jv(r["version"]),
                "dims" to jv(r["dims"]), "dtype" to "f32", "normalized" to jv(r["normalizado"]), "truncated_from" to null,
                "modalities" to (asList(mods)?.map { m -> (m as? String)?.let { Legacy.MODALITIES[it] } ?: m } ?: mods),
                "task_prefixes" to null, "created" to jv(r["creado"]),
            )
        }
    }

    private fun vectorDigests(): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        if (!c.legacy) {
            if (!c.hasTable("vectors")) return out
            for (space in rowsOf("SELECT DISTINCT space FROM vectors ORDER BY space").map { it[0] }) {
                val h = sha256()
                var n = 0L
                eachOf("SELECT data FROM vectors WHERE space = ? ORDER BY target, id", space) {
                    h.update(it[0].asBytes() ?: ByteArray(0))
                    n++
                }
                out[jv(space).toString()] = linkedMapOf("count" to n, "sha256" to hex(h.digest()))
            }
            return out
        }
        if ("vectores" !in c.tables) return out
        data class V(val target: String, val id: String, val space: String, val data: ByteArray)
        val all = rowsOf("SELECT objetivo, id, espacio, valores FROM vectores").map {
            val t = it[0].asText() ?: ""
            V(Legacy.TARGETS[t] ?: t, it[1].asText() ?: "", it[2].asText() ?: "", it[3].asBytes() ?: ByteArray(0))
        }
        for (space in all.map { it.space }.toSortedSet(codePointOrder)) {
            val sel = all.filter { it.space == space }.sortedWith { a, b ->
                val k = codePointOrder.compare(a.target, b.target)
                if (k != 0) k else codePointOrder.compare(a.id, b.id)
            }
            val h = sha256()
            sel.forEach { h.update(it.data) }
            out[space] = linkedMapOf("count" to sel.size.toLong(), "sha256" to hex(h.digest()))
        }
        return out
    }

    private fun blobList(): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        val sql = if (c.legacy) "SELECT clave, mime, datos FROM blobs ORDER BY clave" else "SELECT key, mime, data FROM blobs ORDER BY key"
        if (!c.hasTable("blobs")) return out
        eachOf(sql) {
            val data = it[2].asBytes() ?: ByteArray(0)
            out += linkedMapOf("key" to jv(it[0]), "mime" to jv(it[1]), "bytes" to data.size.toLong(), "sha256" to sha256Hex(data))
        }
        return out
    }

    private fun provenanceRows(): List<Map<String, Any?>> {
        val rows: List<Map<String, Any?>> = if (!c.legacy) {
            if (!c.hasTable("provenance")) return emptyList()
            rowsOf("SELECT stage, provider, model, detail, ms, at FROM provenance").map { r ->
                linkedMapOf(
                    "stage" to jv(r["stage"]), "provider" to jv(r["provider"]), "model" to jv(r["model"]),
                    "detail" to jcol(r["detail"], "provenance.detail"), "ms" to jv(r["ms"]), "at" to jv(r["at"]),
                )
            }
        } else {
            if ("procedencia" !in c.tables) return emptyList()
            rowsOf("SELECT fase, proveedor, detalle, ms, cuando FROM procedencia").map { r ->
                linkedMapOf(
                    "stage" to jv(r["fase"]), "provider" to jv(r["proveedor"]), "model" to null,
                    "detail" to jcol(r["detalle"], "procedencia.detalle"), "ms" to jv(r["ms"]), "at" to jv(r["cuando"]),
                )
            }
        }
        return sortProvenance(rows)
    }

    private fun extensionRows(): List<Map<String, Any?>> {
        if (c.legacy || !c.hasTable("extensions")) return emptyList()
        return rowsOf("SELECT name, version, required FROM extensions ORDER BY name").map { r ->
            LinkedHashMap<String, Any?>().apply { for (k in r.columns) put(k, jv(r[k])) }
        }
    }

    private fun tokenizer(table: String): String? {
        val sql = c.master.firstOrNull { it.name == table }?.sql
        if (sql.isNullOrEmpty()) return null
        val m = TOKENIZE.find(sql) ?: return "unicode61" // the FTS5 default
        val g = m.groups
        val raw = g[1]?.value?.replace("''", "'") ?: g[2]?.value?.replace("\"\"", "\"") ?: g[3]?.value ?: ""
        return raw.trim().split(WHITESPACE).filter { it.isNotEmpty() }.joinToString(" ")
    }

    // ------------------------------------------------------------------ public

    /** `spdf_meta` (legacy keys mapped to 5.0 names), ordered by key. */
    public fun meta(): Map<String, String?> = metaValues().mapValues { (_, v) -> v?.let { if (it is String) it else pyStr(it) } }

    /**
     * The canonical dump (SPEC §19, CONTRACT §5) as a JSON tree: numbers already rounded,
     * arrays in canonical order. Serialize it with [Json.canonical].
     */
    public fun dump(): Map<String, Any?> {
        live()
        val meta = metaValues()
        val version: Any? = if (c.legacy) meta["spdf_version"].takeIf { truthy(it) } ?: c.version else meta["spdf_version"]
        val out = LinkedHashMap<String, Any?>()
        out["spdf_version"] = version
        if (c.legacy) out["legacy"] = true
        out["meta"] = meta
        out["fts"] = if (c.legacy) {
            linkedMapOf("tokenizer" to tokenizer("fragmentos_fts"), "trigram" to false)
        } else {
            linkedMapOf("tokenizer" to tokenizer("fragments_fts"), "trigram" to ("fragments_fts_trigram" in c.tables))
        }
        out["document"] = documentRow()
        out["units"] = unitRows()
        out["sections"] = sectionRows()
        out["fragments"] = fragmentRows()
        out["figures"] = figureRows()
        out["spaces"] = spaceRows()
        out["vectors"] = vectorDigests()
        out["blobs"] = blobList()
        out["provenance"] = provenanceRows()
        out["extensions"] = extensionRows()
        @Suppress("UNCHECKED_CAST")
        return Json.canon(out) as Map<String, Any?>
    }

    /** The canonical dump serialized as RFC 8785 (JCS). */
    public fun dumpJson(): String = Json.canonical(dump())

    /**
     * `content_sha256` (SPEC §18): SHA-256 of the JCS dump without `meta.content_sha256`,
     * `meta.signature` and `meta.signer`.
     */
    public fun contentSha256(): String = contentSha256Of(dump())

    /** The document row (5.0 view). */
    public fun document(): Document {
        val d = Json.canon(documentRow()).let { asMap(it)!! }
        return Document(
            d["id"] as? String ?: "", d["kind"] as? String ?: "", d["mime"] as? String ?: "", d["source_sha256"] as? String ?: "",
            asMap(d["metadata"]) ?: emptyMap(),
        ).apply {
            sourceRef = d["source_ref"] as? String
            bytes = integralValue(d["bytes"]) ?: 0
            unitCount = integralValue(d["unit_count"])
            duration = numberValue(d["duration"])
            created = d["created"] as? String
            updated = d["updated"] as? String
            title = d["title"] as? String
            authors = d["authors"] as? String
            year = integralValue(d["year"])
            language = d["language"] as? String
            rights = asMap(d["rights"])
        }
    }

    /** The document metadata as a CSL-JSON item (legacy metadata mapped to CSL). */
    public fun metadata(): Map<String, Any?> = asMap(documentRow()["metadata"]) ?: emptyMap()

    /** The citable units in order. */
    public fun units(): List<CitableUnit> = unitRows().map { Json.canon(it) }.map { unitOf(asMap(it)!!) }

    /** The fragments in rowid order. */
    public fun fragments(): List<Fragment> = fragmentRows().map { fragmentOf(asMap(Json.canon(it))!!) }

    /** One fragment by id, or null. */
    public fun fragment(id: String): Fragment? {
        return fragmentRows("WHERE id = ?", id).firstOrNull()?.let { fragmentOf(asMap(Json.canon(it))!!) }
    }

    /** The table of contents. */
    public fun sections(): List<Section> = sectionRows().map { asMap(Json.canon(it))!! }.map { s ->
        Section(s["id"] as? String ?: "", s["title"] as? String ?: "", s["unit_from"] as? String ?: "", integralValue(s["level"]) ?: 0).apply {
            parent = s["parent"] as? String
            unitTo = s["unit_to"] as? String
            summary = s["summary"] as? String
        }
    }

    /** The figures. */
    public fun figures(): List<Figure> = figureRows().map { asMap(Json.canon(it))!! }.map { g ->
        Figure(g["id"] as? String ?: "", g["unit"] as? String ?: "", g["image"] as? String ?: "", Anchor.ofTree(g["anchor"]) ?: Anchor(emptyMap())).apply {
            caption = g["caption"] as? String
            description = g["description"] as? String
        }
    }

    /** The vector spaces. */
    public fun spaces(): List<Space> = spaceRows().map { asMap(Json.canon(it))!! }.map { s ->
        Space(s["id"] as? String ?: "", s["provider"] as? String ?: "", s["model"] as? String ?: "", integralValue(s["dims"]) ?: 0, s["dtype"] as? String ?: "f32").apply {
            version = s["version"] as? String
            normalized = truthy(s["normalized"])
            truncatedFrom = integralValue(s["truncated_from"])
            val mods = asList(s["modalities"])
            if (mods != null && mods.all { it is String }) modalities = mods.map { it as String } else rawModalities = s["modalities"]
            taskPrefixes = asMap(s["task_prefixes"])
            created = s["created"] as? String
        }
    }

    /** The provenance entries (canonical order). */
    public fun provenance(): List<Provenance> = provenanceRows().map { asMap(Json.canon(it))!! }.map { p ->
        Provenance(p["stage"] as? String ?: "", p["at"] as? String ?: "").apply {
            provider = p["provider"] as? String
            model = p["model"] as? String
            detail = p["detail"]
            ms = integralValue(p["ms"])
        }
    }

    /** A stored blob by key (`blob:` prefix optional), or null. Values above the max blob size are refused. */
    public fun blob(key: String): Blob? {
        val k = key.removePrefix("blob:")
        if (!c.hasTable("blobs")) return null
        val (kc, dc) = if (c.legacy) "clave" to "datos" else "key" to "data"
        val len = rowsOf("SELECT length($dc) FROM blobs WHERE $kc = ?", k).firstOrNull()?.get(0) ?: return null
        val size = (len as? SqlValue.Integer)?.value ?: 0
        if (size > c.options.maxBlobSize) throw SpdfException(null, "blob $k is larger than the maximum blob size", k)
        val r = rowsOf("SELECT mime, $dc FROM blobs WHERE $kc = ?", k).firstOrNull() ?: return null
        return Blob(k, r[0].asText() ?: "", r[1].asBytes() ?: ByteArray(0))
    }

    private fun unitOf(u: Map<String, Any?>): CitableUnit =
        CitableUnit(u["id"] as? String ?: "", Anchor.ofTree(u["anchor"]) ?: Anchor(emptyMap()), u["text"] as? String ?: "", u["reader"] as? String ?: "").apply {
            ord = integralValue(u["ord"])
            notes = asList(u["notes"])?.map { it as? String ?: pyStr(it) }
            header = u["header"] as? String
            footer = u["footer"] as? String
            image = u["image"] as? String
            thumbnail = u["thumbnail"] as? String
            confidence = numberValue(u["confidence"])
            printed = u["printed"] as? String
            t0 = numberValue(u["t0"])
            t1 = numberValue(u["t1"])
            words = u["words"]
        }

    private fun fragmentOf(f: Map<String, Any?>): Fragment =
        Fragment(f["id"] as? String ?: "", f["unit"] as? String ?: "", f["text"] as? String ?: "", Anchor.ofTree(f["anchor"]) ?: Anchor(emptyMap())).apply {
            n = integralValue(f["n"])
            ord = integralValue(f["ord"])
            context = f["context"] as? String ?: ""
            section = asList(f["section"])?.map { it as? String ?: pyStr(it) }
            anchorEnd = Anchor.ofTree(f["anchor_end"])
            searchText = f["search_text"] as? String
        }

    // ------------------------------------------------------------------ anchors

    private val docRefValue: String by lazy {
        val r = rowsOf(
            "SELECT ${c.col("documents", "source_sha256")}, id FROM ${quoteIdent(c.table("documents"))} ORDER BY id LIMIT 1",
        ).firstOrNull()
        val sha = r?.get(0)?.asText()
        when {
            !sha.isNullOrEmpty() -> AnchorUri.docRef(sha)
            else -> r?.get(1)?.asText() ?: ""
        }
    }

    /** The document reference used in anchor URIs (`sha256-<hex>`, or the document id). */
    public fun docRef(): String = docRefValue

    /** The canonical anchor URI of an anchor (and optional end anchor) of this document. */
    @JvmOverloads
    public fun anchorUri(anchor: Anchor, end: Anchor? = null): String = AnchorUri.format(docRefValue, anchor, end)

    /** Short citation of an anchor of this document (SPEC §16). */
    @JvmOverloads
    public fun cite(anchor: Anchor, end: Anchor? = null, locale: String = "es"): String = Citation.cite(anchor, end, metadata(), locale)

    /** Short citation of a fragment of this document. */
    @JvmOverloads
    public fun citeFragment(fragmentId: String, locale: String = "es"): String {
        val f = fragment(fragmentId) ?: throw SpdfException(null, "no fragment $fragmentId")
        return cite(f.anchor, f.anchorEnd, locale)
    }

    // ------------------------------------------------------------------ search

    /** How a query is executed on this file: route `fts`, `trigram` or `substring`, and the MATCH string. */
    public fun lexicalRoute(query: LexicalQuery): Pair<String, String?> {
        val match = query.match ?: return "fts" to null
        if (query.cjk) {
            val trigram = c.table("fragments_fts") + "_trigram"
            if (trigram in c.tables && query.terms.all { codePointLength(it) >= 3 }) return "trigram" to match
            return "substring" to null
        }
        return "fts" to match
    }

    private fun fts4Columns(table: String): Boolean {
        val sql = c.master.firstOrNull { it.name == table }?.sql ?: return true
        return sql.contains("search_text") || sql.contains("texto_busqueda")
    }

    /** Lexical search (SPEC §10.1): FTS5 BM25, the CJK trigram route, or the substring fallback. */
    @JvmOverloads
    public fun searchLexical(query: String, limit: Int = 10): List<Hit> {
        live()
        val lq = LexicalQuery.compile(query)
        val (route, match) = lexicalRoute(lq)
        if (lq.match == null) return emptyList()
        val frag = quoteIdent(c.table("fragments"))
        val n = c.col("fragments", "n")
        val sel = "f.$n, f.${c.col("fragments", "id")}, f.${c.col("fragments", "anchor")}, f.${c.col("fragments", "anchor_end")}"
        val found = ArrayList<Pair<SqlRow, Double>>()
        when (route) {
            "trigram" -> {
                val t = quoteIdent(c.table("fragments_fts") + "_trigram")
                eachOf("SELECT $sel, bm25($t) AS r FROM $t JOIN $frag f ON f.$n = $t.rowid WHERE $t MATCH ? ORDER BY r, f.$n LIMIT ?", match, limit) {
                    found += it to -((it[4] as? SqlValue.Real)?.value ?: 0.0)
                }
            }
            "substring" -> {
                val text = c.col("fragments", "text")
                val hits = lq.terms.joinToString(" + ") { "(instr($text, ?) > 0)" }
                val need = if (lq.phrases) lq.terms.size else 1
                val args = ArrayList<Any?>()
                args.addAll(lq.terms)
                args.addAll(lq.terms)
                args.add(need)
                args.add(limit)
                eachOf("SELECT $sel, ($hits) AS hits FROM $frag f WHERE ($hits) >= ? ORDER BY hits DESC, f.$n LIMIT ?", *args.toTypedArray()) {
                    found += it to ((it[4] as? SqlValue.Integer)?.value ?: 0L).toDouble()
                }
            }
            else -> {
                val t = quoteIdent(c.table("fragments_fts"))
                val w = if (fts4Columns(c.table("fragments_fts"))) "1.0, 0.5, 0.5, 1.0" else "1.0, 0.5, 0.5"
                eachOf("SELECT $sel, bm25($t, $w) AS r FROM $t JOIN $frag f ON f.$n = $t.rowid WHERE $t MATCH ? ORDER BY r, f.$n LIMIT ?", match, limit) {
                    found += it to -((it[4] as? SqlValue.Real)?.value ?: 0.0)
                }
            }
        }
        return found.map { (r, score) -> fragmentHit(r, score, "lexical") }
    }

    private fun anchorOf(v: SqlValue): Anchor? {
        val tree = try {
            jcol(v, "anchor")
        } catch (e: SpdfException) {
            return null
        }
        return Anchor.ofTree(if (c.legacy) Legacy.anchor(tree) else tree)
    }

    private fun fragmentHit(r: SqlRow, score: Double, via: String): Hit {
        val a = anchorOf(r[2])
        val e = anchorOf(r[3])
        val uri = if (a != null) AnchorUri.format(docRefValue, a, e) else AnchorUri.format(docRefValue, Locator())
        return Hit("fragment", r[1].asText() ?: "", score, listOf(via), a, e, uri, (r[0] as? SqlValue.Integer)?.value ?: 0)
    }

    /**
     * Vector search (SPEC §10.2): brute force over the vectors of [space] and [target]
     * (`fragment`, `unit` or `figure`); dot product for normalized spaces, cosine otherwise.
     */
    @JvmOverloads
    public fun searchVector(query: DoubleArray, space: String, target: String = "fragment", limit: Int = 10): List<Hit> {
        live()
        val sp = rowsOf(
            "SELECT ${c.select("spaces", listOf("dims", "dtype", "normalized"))} FROM ${quoteIdent(c.table("spaces"))} WHERE ${c.col("spaces", "id")} = ?",
            space,
        ).firstOrNull() ?: throw SpdfException("E031", "unknown vector space $space", space)
        val dims = (sp[0] as? SqlValue.Integer)?.value ?: 0
        val dtype = sp[1].asText() ?: "f32"
        val normalized = sqlTruthy(sp[2])
        if (query.size.toLong() != dims) throw SpdfException(null, "query vector has ${query.size} dimensions, space $space has $dims")
        val stored = if (c.legacy) Legacy.TARGETS.entries.firstOrNull { it.value == target }?.key ?: target else target
        val ties = HashMap<String, Long>()
        when (target) {
            "fragment" -> eachOf("SELECT ${c.col("fragments", "n")}, id FROM ${quoteIdent(c.table("fragments"))}") {
                ties[it[1].asText() ?: ""] = (it[0] as? SqlValue.Integer)?.value ?: 0
            }
            "unit" -> if (c.legacy) {
                rowsOf("SELECT id FROM unidades ORDER BY orden, id").forEachIndexed { i, r -> ties[r[0].asText() ?: ""] = (i + 1).toLong() }
            } else {
                eachOf("SELECT ord, id FROM units") { ties[it[1].asText() ?: ""] = (it[0] as? SqlValue.Integer)?.value ?: 0 }
            }
        }
        val qn = Math.sqrt(query.sumOf { it * it })
        data class S(val id: String, val score: Double)
        val scored = ArrayList<S>()
        eachOf(
            "SELECT id, ${c.col("vectors", "data")} FROM ${quoteIdent(c.table("vectors"))} WHERE ${c.col("vectors", "space")} = ? AND ${c.col("vectors", "target")} = ?",
            space, stored,
        ) {
            val v = Vectors.decode(it[1].asBytes() ?: ByteArray(0), dtype)
            var dot = 0.0
            for (i in 0 until minOf(v.size, query.size)) dot += query[i] * v[i]
            var score = dot
            if (!normalized) {
                val vn = Math.sqrt(v.sumOf { x -> x * x })
                score = if (qn != 0.0 && vn != 0.0) dot / (qn * vn) else 0.0
            }
            scored += S(it[0].asText() ?: "", score)
        }
        val sorted = scored.sortedWith { a, b ->
            when {
                a.score != b.score -> if (a.score > b.score) -1 else 1
                target == "figure" -> codePointOrder.compare(a.id, b.id)
                else -> (ties[a.id] ?: Long.MAX_VALUE).compareTo(ties[b.id] ?: Long.MAX_VALUE)
            }
        }.take(limit)
        return sorted.map { s ->
            val (a, e) = anchorsOf(target, s.id)
            val uri = if (a != null) AnchorUri.format(docRefValue, a, e) else AnchorUri.format(docRefValue, Locator())
            Hit(target, s.id, s.score, listOf("vector"), a, e, uri, ties[s.id] ?: 0)
        }
    }

    /** [searchVector] for float query vectors. */
    @JvmOverloads
    public fun searchVector(query: FloatArray, space: String, target: String = "fragment", limit: Int = 10): List<Hit> =
        searchVector(DoubleArray(query.size) { query[it].toDouble() }, space, target, limit)

    private fun anchorsOf(target: String, id: String): Pair<Anchor?, Anchor?> {
        val t5 = when (target) {
            "fragment" -> "fragments"
            "unit" -> "units"
            "figure" -> "figures"
            else -> return null to null
        }
        if (!c.hasTable(t5)) return null to null
        val cols = if (t5 == "fragments") listOf("anchor", "anchor_end") else listOf("anchor")
        val r = rowsOf("SELECT ${c.select(t5, cols)} FROM ${quoteIdent(c.table(t5))} WHERE id = ?", id).firstOrNull() ?: return null to null
        return anchorOf(r[0]) to if (r.size > 1) anchorOf(r[1]) else null
    }

    /**
     * Hybrid search (SPEC §10.3): reciprocal rank fusion (k = 10) of the lexical list and the
     * vector list (fragments), each to depth max(limit, 50). Without a vector it is lexical only.
     */
    @JvmOverloads
    public fun searchHybrid(query: String, vector: DoubleArray?, space: String?, limit: Int = 10): List<Hit> {
        val depth = maxOf(limit, 50)
        val lex = searchLexical(query, depth)
        val vec = if (vector != null && space != null) searchVector(vector, space, "fragment", depth) else emptyList()
        return fuse(lex, vec, limit)
    }

    // ------------------------------------------------------------------ export

    /** The document as a CSL-JSON array with one item (without the `spdf` extension). */
    public fun exportCslJson(): String {
        val md = metadata()
        return Json.compact(listOf(Export.cslItem(md, Export.citationKey(md))))
    }

    /** The document as a BibTeX entry. */
    public fun exportBibTeX(): String {
        val md = metadata()
        return Export.bibtex(md, Export.citationKey(md))
    }

    internal val container: Container get() = live()

    public companion object {
        // As declared: 'quoted' (with '' escapes), "quoted" or a bare word; whitespace collapsed.
        private val TOKENIZE = Regex(
            "tokenize\\s*=\\s*(?:'((?:[^']|'')*)'|\"((?:[^\"]|\"\")*)\"|([A-Za-z0-9_]+))",
            RegexOption.IGNORE_CASE,
        )
        private val WHITESPACE = Regex("\\s+")

        /** Opens a file with the default adapter ([SqlDriver.default]). */
        @JvmStatic
        public fun open(path: String): SpdfFile = open(File(path), SqlDriver.default(), OpenOptions.DEFAULT)

        /** Opens a file safely (SPEC §2.4). Gzip-wrapped files are decompressed to a temporary file first. */
        @JvmStatic
        @JvmOverloads
        public fun open(file: File, driver: SqlDriver = SqlDriver.default(), options: OpenOptions = OpenOptions.DEFAULT): SpdfFile =
            SpdfFile(Container.open(file, driver, options, strict = true))

        /** Opens an SPDF held in memory (gzip-wrapped or not), through a temporary file removed on close. */
        @JvmStatic
        @JvmOverloads
        public fun open(data: ByteArray, driver: SqlDriver = SqlDriver.default(), options: OpenOptions = OpenOptions.DEFAULT): SpdfFile =
            SpdfFile(Container.open(data, driver, options, strict = true))

        internal fun of(c: Container): SpdfFile = SpdfFile(c)

        /** `content_sha256` of a dump tree. */
        @JvmStatic
        public fun contentSha256Of(dump: Map<String, Any?>): String {
            val d = LinkedHashMap(dump)
            asMap(d["meta"])?.let { m -> d["meta"] = LinkedHashMap(m).apply { Spdf.INTEGRITY_KEYS.forEach { remove(it) } } }
            return sha256Hex(Json.canonical(d).toByteArray(Charsets.UTF_8))
        }

        /** Provenance entries ordered by the UTF-8 bytes of their JCS form (writer-independent). */
        internal fun sortProvenance(rows: List<Map<String, Any?>>): List<Map<String, Any?>> =
            rows.map { it to Json.canonical(it).toByteArray(Charsets.UTF_8) }.sortedWith { a, b -> byteOrder.compare(a.second, b.second) }.map { it.first }

        /** Reciprocal rank fusion, k = 10: score = Σ 1/(10 + rank); ties by fragment n. */
        @JvmStatic
        public fun fuse(lexical: List<Hit>, vector: List<Hit>, limit: Int): List<Hit> {
            val acc = LinkedHashMap<String, Triple<Hit, Double, MutableList<String>>>()
            for ((name, list) in listOf("lexical" to lexical, "vector" to vector)) {
                list.forEachIndexed { i, h ->
                    val prev = acc[h.id]
                    val inc = 1.0 / (Spdf.RRF_K + i + 1)
                    if (prev == null) {
                        acc[h.id] = Triple(h, inc, mutableListOf(name))
                    } else {
                        prev.third += name
                        acc[h.id] = Triple(prev.first, prev.second + inc, prev.third)
                    }
                }
            }
            return acc.values.map { (h, s, via) -> h.with(s, via.toList()) }
                .sortedWith { a, b -> if (a.score != b.score) (if (a.score > b.score) -1 else 1) else a.n.compareTo(b.n) }
                .take(limit)
        }
    }
}
