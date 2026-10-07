package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlDriver
import java.io.File

/**
 * Sources (CONTRACT §11): a full dump, that is the canonical dump plus vector values
 * (`vectors.<space>.items = [{target, id, values}]`) and blob bytes (`blobs[].data_base64`).
 * [write] rebuilds the SPDF 5.0 file a source describes.
 */
public object Sources {
    /** Reads a source JSON file. */
    @JvmStatic
    public fun read(file: File): Map<String, Any?> = Json.parseObject(file.readText(Charsets.UTF_8))

    private fun objs(v: Any?): List<Map<String, Any?>> = asList(v)?.mapNotNull { asMap(it) } ?: emptyList()

    private fun str(v: Any?): String = v as? String ?: ""

    private fun strings(v: Any?): List<String>? = asList(v)?.map { it as? String ?: pyStr(it) }

    /** Builds an SPDF 5.0 file at [file] from [source], writing every value verbatim. */
    @JvmStatic
    @JvmOverloads
    public fun write(source: Map<String, Any?>, file: File, driver: SqlDriver = SqlDriver.default()) {
        val s = asMap(Json.toTree(source))!!
        val trigram = asMap(s["fts"])?.get("trigram") == true
        SpdfWriter.create(file, WriterOptions(trigram = trigram, exact = true), driver).use { w ->
            for ((k, v) in asMap(s["meta"]) ?: emptyMap()) w.setMeta(k, v as? String ?: pyStr(v))
            val d = asMap(s["document"]) ?: throw SpdfException(null, "source without document")
            w.setDocument(
                Document(str(d["id"]), str(d["kind"]), str(d["mime"]), str(d["source_sha256"]), asMap(d["metadata"]) ?: emptyMap()).apply {
                    sourceRef = d["source_ref"] as? String
                    bytes = integralValue(d["bytes"]) ?: 0
                    unitCount = integralValue(d["unit_count"]) ?: 0
                    duration = numberValue(d["duration"])
                    created = str(d["created"])
                    updated = str(d["updated"])
                    title = d["title"] as? String
                    authors = d["authors"] as? String
                    year = integralValue(d["year"])
                    language = d["language"] as? String
                    rights = asMap(d["rights"])
                },
            )
            for (u in objs(s["units"])) {
                w.addUnit(
                    CitableUnit(str(u["id"]), Anchor.ofTree(u["anchor"]) ?: Anchor(emptyMap()), str(u["text"]), str(u["reader"])).apply {
                        ord = integralValue(u["ord"]) ?: 0
                        notes = strings(u["notes"])
                        header = u["header"] as? String
                        footer = u["footer"] as? String
                        image = u["image"] as? String
                        thumbnail = u["thumbnail"] as? String
                        confidence = numberValue(u["confidence"])
                        printed = u["printed"] as? String
                        t0 = numberValue(u["t0"])
                        t1 = numberValue(u["t1"])
                        words = u["words"]
                    },
                )
            }
            for (x in objs(s["sections"])) {
                w.addSection(
                    Section(str(x["id"]), str(x["title"]), str(x["unit_from"]), integralValue(x["level"]) ?: 0).apply {
                        parent = x["parent"] as? String
                        unitTo = x["unit_to"] as? String
                        summary = x["summary"] as? String
                    },
                )
            }
            for (f in objs(s["fragments"])) {
                w.addFragment(
                    Fragment(str(f["id"]), str(f["unit"]), str(f["text"]), Anchor.ofTree(f["anchor"]) ?: Anchor(emptyMap())).apply {
                        n = integralValue(f["n"]) ?: 0
                        ord = integralValue(f["ord"]) ?: 0
                        context = str(f["context"])
                        section = strings(f["section"])
                        anchorEnd = Anchor.ofTree(f["anchor_end"])
                        searchText = f["search_text"] as? String
                    },
                )
            }
            for (g in objs(s["figures"])) {
                w.addFigure(
                    Figure(str(g["id"]), str(g["unit"]), str(g["image"]), Anchor.ofTree(g["anchor"]) ?: Anchor(emptyMap())).apply {
                        caption = g["caption"] as? String
                        description = g["description"] as? String
                    },
                )
            }
            val dtypes = HashMap<String, String>()
            for (sp in objs(s["spaces"])) {
                val space = Space(str(sp["id"]), str(sp["provider"]), str(sp["model"]), integralValue(sp["dims"]) ?: 0, str(sp["dtype"])).apply {
                    version = sp["version"] as? String
                    normalized = truthy(sp["normalized"])
                    rawNormalized = sp["normalized"]
                    truncatedFrom = integralValue(sp["truncated_from"])
                    val mods = asList(sp["modalities"])
                    if (mods != null && mods.all { it is String }) modalities = mods.map { it as String } else rawModalities = sp["modalities"]
                    taskPrefixes = asMap(sp["task_prefixes"])
                    created = sp["created"] as? String
                }
                dtypes[space.id] = space.dtype
                w.addSpace(space)
            }
            val vectors = asMap(s["vectors"]) ?: emptyMap()
            for (space in vectors.keys.sortedWith(codePointOrder)) {
                for (it in objs(asMap(vectors[space])?.get("items"))) {
                    val data = Vectors.packExact(asList(it["values"]) ?: emptyList(), dtypes[space] ?: "f32")
                    w.addVectorRaw(str(it["target"]), str(it["id"]), space, data)
                }
            }
            for (b in objs(s["blobs"])) {
                val data = try {
                    base64Decode(str(b["data_base64"]))
                } catch (e: IllegalArgumentException) {
                    throw SpdfException(null, "blob ${b["key"]}: bad base64", str(b["key"]), e)
                }
                w.addBlob(str(b["key"]), str(b["mime"]), data)
            }
            for (p in objs(s["provenance"])) {
                w.addProvenance(
                    Provenance(str(p["stage"]), str(p["at"])).apply {
                        provider = p["provider"] as? String
                        model = p["model"] as? String
                        detail = p["detail"]
                        ms = integralValue(p["ms"])
                    },
                )
            }
            for (e in objs(s["extensions"])) w.addExtensionRaw(str(e["name"]), str(e["version"]), e["required"])
            w.finish()
        }
    }

    /** The expected dump of a source: without vector values and blob bytes, in canonical form. */
    @JvmStatic
    public fun strip(source: Map<String, Any?>): Map<String, Any?> {
        val d = asMap(Json.canon(source))!!.toMutableMap()
        asMap(d["vectors"])?.let { v -> d["vectors"] = v.mapValues { (_, x) -> asMap(x)?.filterKeys { it != "items" } ?: x } }
        asList(d["blobs"])?.let { l -> d["blobs"] = l.map { b -> asMap(b)?.filterKeys { it != "data_base64" } ?: b } }
        return d
    }
}
