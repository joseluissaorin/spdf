package io.github.joseluissaorin.spdf.conformance

import io.github.joseluissaorin.spdf.Anchor
import io.github.joseluissaorin.spdf.AnchorUri
import io.github.joseluissaorin.spdf.Citation
import io.github.joseluissaorin.spdf.Hit
import io.github.joseluissaorin.spdf.Json
import io.github.joseluissaorin.spdf.JsonConvertible
import io.github.joseluissaorin.spdf.LexicalQuery
import io.github.joseluissaorin.spdf.Locator
import io.github.joseluissaorin.spdf.OpenOptions
import io.github.joseluissaorin.spdf.SpdfException
import io.github.joseluissaorin.spdf.SpdfFile
import io.github.joseluissaorin.spdf.Sources
import io.github.joseluissaorin.spdf.Spdf
import io.github.joseluissaorin.spdf.Validator
import io.github.joseluissaorin.spdf.Vectors
import io.github.joseluissaorin.spdf.sql.SqlDriver
import java.io.File

/** One failed or skipped case. */
public data class CaseResult(val id: String, val reason: String) : JsonConvertible {
    override fun toJson(): Map<String, Any?> = linkedMapOf("id" to id, "reason" to reason)
}

/** The runner report of CONTRACT §11: `{"impl","version","passed","failed","skipped"}`. */
public data class ConformanceReport(
    val impl: String,
    val version: String,
    val passed: List<String>,
    val failed: List<CaseResult>,
    val skipped: List<CaseResult>,
) : JsonConvertible {
    override fun toJson(): Map<String, Any?> =
        linkedMapOf("impl" to impl, "version" to version, "passed" to passed, "failed" to failed, "skipped" to skipped)

    /** One line of compact JSON (sorted keys). */
    public fun toJsonString(): String = Json.compact(this)

    /** "N passed, N failed, N skipped". */
    public fun summary(): String = "${passed.size} passed, ${failed.size} failed, ${skipped.size} skipped"
}

/**
 * Runs the SPDF conformance suite (`conformance/` in the repository) with a given SQLite
 * adapter. Cases are discovered by listing the JSON files of `cases/`; a case that throws is a failure.
 */
public class ConformanceRunner @JvmOverloads constructor(
    private val driver: SqlDriver,
    private val implName: String = Spdf.IMPL_NAME,
) {
    /** Runs every case in [dir]/cases. */
    public fun run(dir: File): ConformanceReport {
        val cases = File(dir, "cases").listFiles { f -> f.isFile && f.name.endsWith(".json") }
            ?.sortedBy { it.name }
            ?: throw SpdfException(null, "no cases in ${File(dir, "cases")}")
        if (cases.isEmpty()) throw SpdfException(null, "no cases in ${File(dir, "cases")}")
        val passed = ArrayList<String>()
        val failed = ArrayList<CaseResult>()
        for (f in cases) {
            var id = f.name.removeSuffix(".json")
            val reason = try {
                val c = Json.parseObject(f.readText(Charsets.UTF_8))
                (c["id"] as? String)?.let { id = it }
                @Suppress("UNCHECKED_CAST")
                runCase(dir, c["kind"] as? String ?: "", c["input"] as? Map<String, Any?> ?: emptyMap(), c["expect"] as? Map<String, Any?> ?: emptyMap())
            } catch (e: Throwable) {
                "${e::class.java.simpleName}: ${e.message}"
            }
            if (reason == null) passed += id else failed += CaseResult(id, reason)
        }
        return ConformanceReport(implName, Spdf.VERSION, passed, failed, emptyList())
    }

    private fun str(v: Any?): String = v as? String ?: ""

    @Suppress("UNCHECKED_CAST")
    private fun anchor(v: Any?): Anchor? = (v as? Map<String, Any?>)?.let { Anchor.of(it) }

    private fun doubles(v: Any?): DoubleArray = ((v as? List<*>) ?: emptyList<Any?>()).map { (it as? Number)?.toDouble() ?: 0.0 }.toDoubleArray()

    /** Runs one case; null when it passes, else the reason. */
    public fun runCase(dir: File, kind: String, input: Map<String, Any?>, expect: Map<String, Any?>): String? {
        when (kind) {
            "dump", "legacy_dump" -> {
                SpdfFile.open(File(dir, str(input["file"])), driver, OpenOptions.DEFAULT).use { f ->
                    val d = f.dump()
                    val want = Json.parse(File(dir, str(expect["dump"])).readText(Charsets.UTF_8))
                    Json.diff(d, want)?.let { return "dump differs at $it" }
                    val h = SpdfFile.contentSha256Of(d)
                    if (h != str(expect["content_sha256"])) return "content_sha256 $h != ${expect["content_sha256"]}"
                }
                return null
            }
            "roundtrip" -> {
                val src = Sources.read(File(dir, str(input["source"])))
                val tmp = File.createTempFile("spdf-roundtrip-", "").apply { delete(); mkdirs() }
                try {
                    val out = File(tmp, "x.spdf")
                    Sources.write(src, out, driver)
                    SpdfFile.open(out, driver, OpenOptions.DEFAULT).use { f ->
                        val want = Json.parse(File(dir, str(expect["dump"])).readText(Charsets.UTF_8))
                        Json.diff(f.dump(), want)?.let { return "roundtrip dump differs at $it" }
                    }
                } finally {
                    tmp.deleteRecursively()
                }
                return null
            }
            "validate" -> {
                val r = Validator.validate(File(dir, str(input["file"])), driver, OpenOptions.DEFAULT)
                val got = linkedMapOf("valid" to r.isValid, "version" to r.version, "errors" to r.errorCodes, "warnings" to r.warningCodes)
                fun codes(v: Any?) = ((v as? List<*>) ?: emptyList<Any?>()).mapNotNull { it as? String }.distinct().sorted()
                val want = linkedMapOf("valid" to expect["valid"], "version" to expect["version"], "errors" to codes(expect["errors"]), "warnings" to codes(expect["warnings"]))
                return Json.diff(got, want)?.let { "got ${Json.compact(got)} ($it)" }
            }
            "search_lexical", "search_vector", "search_hybrid" -> {
                SpdfFile.open(File(dir, str(input["file"])), driver, OpenOptions.DEFAULT).use { f ->
                    val limit = (input["limit"] as? Long)?.toInt() ?: 10
                    val hits: List<Hit> = when (kind) {
                        "search_lexical" -> {
                            val (route, match) = f.lexicalRoute(LexicalQuery.compile(str(input["query"])))
                            if (route != expect["route"] || !Json.equivalent(match, expect["match"])) {
                                return "route/match $route/$match != ${expect["route"]}/${expect["match"]}"
                            }
                            f.searchLexical(str(input["query"]), limit)
                        }
                        "search_vector" -> f.searchVector(doubles(input["query_vector"]), str(input["space"]), (input["target"] as? String) ?: "fragment", limit)
                        else -> f.searchHybrid(str(input["query"]), doubles(input["query_vector"]), str(input["space"]), limit)
                    }
                    return compareHits(hits, expect["results"], kind != "search_vector")
                }
            }
            "anchor_uri" -> {
                if (input.containsKey("anchor")) {
                    val docref = str(input["docref"])
                    val uri = AnchorUri.format(docref, anchor(input["anchor"]) ?: return "no anchor", anchor(input["anchor_end"]))
                    if (uri != expect["uri"]) return "format gives $uri"
                    val p = AnchorUri.parse(uri)
                    Json.diff(p, mapOf("docref" to docref, "locator" to expect["locator"]))?.let { return "parse differs at $it" }
                    if (p.canonical() != uri) return "no round trip"
                    return null
                }
                if (expect["error"] == true) {
                    return try {
                        AnchorUri.parse(str(input["uri"]))
                        "accepted an invalid URI"
                    } catch (e: SpdfException) {
                        null
                    }
                }
                val p = AnchorUri.parse(str(input["uri"]))
                Json.diff(p, mapOf("docref" to expect["docref"], "locator" to expect["locator"]))?.let { return "parse differs at $it" }
                @Suppress("UNCHECKED_CAST")
                val canonical = AnchorUri.format(p.docref, Locator.fromJson((Json.toTree(p.locator) as Map<String, Any?>)))
                if (canonical != expect["canonical"]) return "canonical form $canonical"
                return null
            }
            "cite" -> {
                @Suppress("UNCHECKED_CAST")
                val md = input["metadata"] as? Map<String, Any?> ?: emptyMap()
                val t = Citation.cite(anchor(input["anchor"]) ?: return "no anchor", anchor(input["anchor_end"]), md, str(input["locale"]))
                return if (t == expect["text"]) null else "got \"$t\""
            }
            "quantize" -> {
                val got: Map<String, Any?> = try {
                    val bytes = Vectors.quantize(doubles(input["values"]), str(input["dtype"]))
                    mapOf("hex" to bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) })
                } catch (e: SpdfException) {
                    mapOf("error" to true)
                }
                return Json.diff(got, expect)?.let { "got ${Json.compact(got)}" }
            }
        }
        return "unknown kind $kind"
    }

    private fun compareHits(hits: List<Hit>, expected: Any?, withVia: Boolean): String? {
        val exp = ((expected as? List<*>) ?: emptyList<Any?>()).map { it as Map<*, *> }
        val gotIds = hits.map { it.id }
        val wantIds = exp.map { it["fragment_id"] as? String ?: "" }
        if (gotIds != wantIds) return "order $gotIds != $wantIds"
        for ((i, e) in exp.withIndex()) {
            val h = hits[i]
            val ws = (e["score"] as? Number)?.toDouble() ?: Double.NaN
            if (Math.abs(h.score - ws) > TOLERANCE) return "${h.id}: score ${h.score} != $ws"
            if (h.anchorUri != e["anchor_uri"]) return "${h.id}: anchor_uri ${h.anchorUri} != ${e["anchor_uri"]}"
            if (withVia && e.containsKey("via") && !Json.equivalent(h.via, e["via"])) return "${h.id}: via ${h.via} != ${e["via"]}"
        }
        return null
    }

    private companion object {
        const val TOLERANCE = 1e-6
    }
}
