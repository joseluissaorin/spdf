package io.github.joseluissaorin.spdf

import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

/** Turns a unit image reference (`blob:<key>` or a URL) into the URL to publish in a manifest. */
public fun interface ImageUrls {
    public fun url(reference: String): String
}

/**
 * Structural exports (SPEC §19.4): ALTO 4, a minimal TEI and a IIIF Presentation 3 manifest.
 * They never invent data: no coordinates or image dimensions (SPDF does not store them), no
 * folio for an unnumbered page, inferred folios in brackets (and absent from ALTO, which only
 * records printed numbers).
 */
public object Structure {
    private const val ALTO_NS = "http://www.loc.gov/standards/alto/ns-v4#"
    private const val TEI_NS = "http://www.tei-c.org/ns/1.0"
    private val BLANK_LINE = Regex("\\n\\s*\\n")
    private val TURN = Regex("^\\*\\*([^*]+):\\*\\*\\s*(.*)$", RegexOption.DOT_MATCHES_ALL)

    /** XML text: escapes `& < > "` and drops characters XML 1.0 cannot carry. */
    private fun xml(s: String): String {
        val b = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            i += Character.charCount(cp)
            when {
                cp == '&'.code -> b.append("&amp;")
                cp == '<'.code -> b.append("&lt;")
                cp == '>'.code -> b.append("&gt;")
                cp == '"'.code -> b.append("&quot;")
                cp == 0x9 || cp == 0xA || cp == 0xD || cp in 0x20..0xD7FF || cp in 0xE000..0xFFFD || cp in 0x10000..0x10FFFF -> b.appendCodePoint(cp)
            }
        }
        return b.toString()
    }

    private fun isPage(u: CitableUnit) = u.anchor.type == "page"

    /** The folio as cited without its label (`ii`, `[iv]`, `1r`), or null when unnumbered. */
    @JvmStatic
    public fun folio(anchor: Anchor): String? {
        val p = anchor["printed"] ?: return null
        return if (anchor["source"] == "inferred") "[${pyStr(p)}]" else pyStr(p)
    }

    /** Paragraphs (split on blank lines), each a list of non-empty trimmed lines. */
    private fun paragraphs(text: String): List<List<String>> =
        text.replace("\r\n", "\n").split(BLANK_LINE).map { p -> p.split("\n").map { it.trim() }.filter { it.isNotEmpty() } }.filter { it.isNotEmpty() }

    private fun words(line: String): List<String> = line.split(Regex("\\s+")).filter { it.isNotEmpty() }

    // ------------------------------------------------------------------ ALTO

    /** ALTO 4.4: one `Page` per page unit, `TextBlock` per paragraph, `TextLine` per line, `String` per word. */
    @JvmStatic
    public fun alto(file: SpdfFile): String {
        val doc = file.document()
        val pages = file.units().filter { isPage(it) }
        val o = StringBuilder()
        o.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        o.append("<alto xmlns=\"$ALTO_NS\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" ")
        o.append("xsi:schemaLocation=\"$ALTO_NS http://www.loc.gov/standards/alto/v4/alto-4-4.xsd\" SCHEMAVERSION=\"4.4\">\n")
        o.append("  <Description>\n    <MeasurementUnit>pixel</MeasurementUnit>\n")
        o.append("    <sourceImageInformation><fileName>${xml(doc.id)}</fileName></sourceImageInformation>\n")
        o.append("    <Processing ID=\"OCR_0\"><processingSoftware><softwareName>${Spdf.IMPL_NAME}</softwareName>")
        o.append("<softwareVersion>${Spdf.VERSION}</softwareVersion></processingSoftware></Processing>\n")
        o.append("  </Description>\n  <Layout>\n")
        pages.forEachIndexed { i, u ->
            val a = u.anchor
            val id = "P${i + 1}"
            val physical = a["physical"].let { if (isIntegral(it)) integralValue(it).toString() else pyStr(it) }
            val printed = if (a["printed"] != null && a["source"] != "inferred") " PRINTED_IMG_NR=\"${xml(pyStr(a["printed"]))}\"" else ""
            o.append("    <Page ID=\"$id\" PHYSICAL_IMG_NR=\"$physical\"$printed>\n")
            o.append("      <PrintSpace ID=\"${id}_PS\">\n")
            paragraphs(u.text).forEachIndexed { b, lines ->
                o.append("        <TextBlock ID=\"${id}_B${b + 1}\">\n")
                lines.forEachIndexed { l, line ->
                    val lid = "${id}_B${b + 1}_L${l + 1}"
                    o.append("          <TextLine ID=\"$lid\">")
                    words(line).forEachIndexed { w, word ->
                        if (w > 0) o.append("<SP/>")
                        o.append("<String ID=\"${lid}_S${w + 1}\" CONTENT=\"${xml(word)}\"/>")
                    }
                    o.append("</TextLine>\n")
                }
                o.append("        </TextBlock>\n")
            }
            o.append("      </PrintSpace>\n    </Page>\n")
        }
        o.append("  </Layout>\n</alto>\n")
        return o.toString()
    }

    // ------------------------------------------------------------------ TEI

    private fun personNames(v: Any?): List<String> = (asList(v) ?: emptyList()).mapNotNull { e ->
        val n = asMap(e) ?: return@mapNotNull null
        if (truthy(n["literal"])) return@mapNotNull pyStr(n["literal"])
        listOf("given", "non-dropping-particle", "family").mapNotNull { k -> n[k]?.takeIf { truthy(it) }?.let { pyStr(it) } }
            .joinToString(" ").ifEmpty { null }
    }

    /**
     * A minimal TEI P5 document: `teiHeader` from the metadata, and a `body` with a `<pb n facs>`
     * before each page unit, `<p>` per paragraph, `<lg>`/`<l n>` for verse, `<u who>` for
     * speaker turns and `<note place="foot">` for notes.
     */
    @JvmStatic
    public fun tei(file: SpdfFile): String {
        val d = file.document()
        val m = d.metadata
        val o = StringBuilder()
        fun line(s: String) = o.append(s).append('\n')
        line("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
        line("<TEI xmlns=\"$TEI_NS\"${d.language?.let { " xml:lang=\"${xml(it)}\"" } ?: ""}>")
        line("  <teiHeader>")
        line("    <fileDesc>")
        line("      <titleStmt>")
        line("        <title>${xml(m["title"]?.let { pyStr(it) } ?: d.title ?: d.id)}</title>")
        for (a in personNames(m["author"])) line("        <author>${xml(a)}</author>")
        for (e in personNames(m["editor"])) line("        <editor>${xml(e)}</editor>")
        line("      </titleStmt>")
        line("      <publicationStmt>")
        val r = d.rights
        if (r != null && listOf("license", "holder", "note", "access").any { truthy(r[it]) }) {
            line("        <availability${r["access"]?.let { " status=\"${xml(pyStr(it))}\"" } ?: ""}>")
            r["license"]?.takeIf { truthy(it) }?.let { line("          <licence target=\"${xml(pyStr(it))}\"/>") }
            r["holder"]?.takeIf { truthy(it) }?.let { line("          <p>${xml(pyStr(it))}</p>") }
            r["note"]?.takeIf { truthy(it) }?.let { line("          <p>${xml(pyStr(it))}</p>") }
            line("        </availability>")
        } else {
            line("        <p>No rights statement in the source file.</p>")
        }
        line("      </publicationStmt>")
        line("      <sourceDesc>")
        line("        <biblStruct>")
        line("          <monogr>")
        for (a in personNames(m["author"])) line("            <author>${xml(a)}</author>")
        line("            <title>${xml(m["title"]?.let { pyStr(it) } ?: "")}</title>")
        val imprint = StringBuilder()
        m["publisher-place"]?.takeIf { truthy(it) }?.let { imprint.append("<pubPlace>${xml(pyStr(it))}</pubPlace>") }
        m["publisher"]?.takeIf { truthy(it) }?.let { imprint.append("<publisher>${xml(pyStr(it))}</publisher>") }
        Export.firstYear(m)?.let { imprint.append("<date when=\"$it\">$it</date>") }
        line("            <imprint>$imprint</imprint>")
        line("          </monogr>")
        line("        </biblStruct>")
        line("      </sourceDesc>")
        line("    </fileDesc>")
        line("  </teiHeader>")
        line("  <text>")
        line("    <body>")
        for (u in file.units()) {
            if (isPage(u)) {
                val n = folio(u.anchor)
                line("      <pb${n?.let { " n=\"${xml(it)}\"" } ?: ""}${u.image?.let { " facs=\"${xml(it)}\"" } ?: ""}/>")
            }
            blocks(u).forEach { line(it) }
            for (note in u.notes ?: emptyList()) line("      <note place=\"foot\">${xml(note)}</note>")
        }
        line("    </body>")
        line("  </text>")
        line("</TEI>")
        return o.toString()
    }

    private fun blocks(u: CitableUnit): List<String> {
        val a = u.anchor
        val out = ArrayList<String>()
        if (a.type == "verse") {
            val from = a.long("line_from") ?: 1L
            out += "      <lg>"
            u.text.split("\n").map { it.trim() }.filter { it.isNotEmpty() }.forEachIndexed { i, l ->
                out += "        <l n=\"${from + i}\">${xml(l)}</l>"
            }
            out += "      </lg>"
            return out
        }
        for (lines in paragraphs(u.text)) {
            val text = lines.joinToString(" ")
            val turn = TURN.matchEntire(text)
            val speaker = a.string("speaker")
            out += when {
                turn != null -> "      <u who=\"${xml(turn.groupValues[1])}\">${xml(turn.groupValues[2])}</u>"
                a.type == "time" && speaker != null -> "      <u who=\"${xml(speaker)}\">${xml(text)}</u>"
                else -> "      <p>${xml(text)}</p>"
            }
        }
        return out
    }

    // ------------------------------------------------------------------ IIIF

    private fun npt(t: Double): String = Json.formatNumber(Json.round6(t))

    /**
     * A IIIF Presentation 3 manifest (as a JSON tree; serialize with [Json.compact]). Paged and
     * other documents: one `Canvas` per unit in order, the page label `{"none": [folio]}` (no
     * label for unnumbered pages), the unit image as painting annotation, the text as a
     * `supplementing` `TextualBody`, figure regions as `#xywh=percent:` targets and sections as
     * `structures`. Audio and video (all units timed): one time-based canvas with `duration`
     * and a `Range` per unit. Ids start at [base] (default `spdf:<docref>`).
     */
    @JvmStatic
    @JvmOverloads
    public fun iiif(file: SpdfFile, base: String? = null, images: ImageUrls = ImageUrls { it }): Map<String, Any?> {
        val d = file.document()
        val root = base ?: "spdf:${file.docRef()}"
        val units = file.units()
        val lang = d.language ?: "none"
        val manifest = linkedMapOf<String, Any?>(
            "@context" to "http://iiif.io/api/presentation/3/context.json",
            "id" to "$root/manifest",
            "type" to "Manifest",
            "label" to mapOf(lang to listOf(d.metadata["title"]?.let { pyStr(it) } ?: d.title ?: d.id)),
        )
        val timed = units.isNotEmpty() && units.all { it.anchor.type == "time" }
        if (timed) {
            val canvas = "$root/canvas/1"
            val duration = d.duration ?: units.last().anchor.number("t1") ?: 0.0
            val painting = d.sourceRef?.let { ref ->
                listOf(linkedMapOf(
                    "id" to "$canvas/media", "type" to "Annotation", "motivation" to "painting", "target" to canvas,
                    "body" to linkedMapOf("id" to images.url(ref), "type" to if (d.kind == "video") "Video" else "Sound", "format" to d.mime),
                ))
            } ?: emptyList()
            fun span(u: CitableUnit) = "$canvas#t=${npt(u.anchor.number("t0") ?: 0.0)},${npt(u.anchor.number("t1") ?: 0.0)}"
            manifest["items"] = listOf(linkedMapOf(
                "id" to canvas, "type" to "Canvas", "duration" to duration,
                "items" to listOf(linkedMapOf("id" to "$canvas/page", "type" to "AnnotationPage", "items" to painting)),
                "annotations" to listOf(linkedMapOf(
                    "id" to "$canvas/text", "type" to "AnnotationPage",
                    "items" to units.mapIndexed { i, u ->
                        linkedMapOf(
                            "id" to "$canvas/text/${i + 1}", "type" to "Annotation", "motivation" to "supplementing",
                            "body" to linkedMapOf("type" to "TextualBody", "value" to u.text, "format" to "text/plain"), "target" to span(u),
                        )
                    },
                )),
            ))
            manifest["structures"] = units.mapIndexed { i, u ->
                val r = linkedMapOf<String, Any?>("id" to "$root/range/${i + 1}", "type" to "Range")
                u.anchor.string("speaker")?.let { r["label"] = mapOf("none" to listOf(it)) }
                r["items"] = listOf(mapOf("id" to span(u), "type" to "Canvas"))
                r
            }
            return manifest
        }
        val figures = file.figures().groupBy { it.unit }
        manifest["items"] = units.mapIndexed { i, u ->
            val canvas = "$root/canvas/${i + 1}"
            val c = linkedMapOf<String, Any?>("id" to canvas, "type" to "Canvas")
            if (isPage(u)) {
                folio(u.anchor)?.let { c["label"] = mapOf("none" to listOf(it)) }
            } else {
                c["label"] = mapOf("none" to listOf(u.anchor.long("n")?.toString() ?: u.ord?.toString() ?: u.id))
            }
            c["items"] = listOf(linkedMapOf(
                "id" to "$canvas/page", "type" to "AnnotationPage",
                "items" to (u.image?.let { img ->
                    listOf(linkedMapOf(
                        "id" to "$canvas/image", "type" to "Annotation", "motivation" to "painting", "target" to canvas,
                        "body" to linkedMapOf("id" to images.url(img), "type" to "Image"),
                    ))
                } ?: emptyList()),
            ))
            val notes = ArrayList<Map<String, Any?>>()
            if (u.text.isNotEmpty()) {
                notes += linkedMapOf(
                    "id" to "$canvas/text/1", "type" to "Annotation", "motivation" to "supplementing",
                    "body" to linkedMapOf("type" to "TextualBody", "value" to u.text, "format" to "text/plain"), "target" to canvas,
                )
            }
            for ((k, g) in (figures[u.id] ?: emptyList()).withIndex()) {
                val r = g.anchor.region() ?: continue
                val xywh = listOf(r.x, r.y, r.w, r.h).joinToString(",") { Json.formatNumber(Json.roundTo(Json.round6(it) * 100, 4)) }
                notes += linkedMapOf(
                    "id" to "$canvas/figure/${k + 1}", "type" to "Annotation", "motivation" to "describing",
                    "body" to linkedMapOf("type" to "TextualBody", "value" to (g.caption ?: g.description ?: g.id), "format" to "text/plain"),
                    "target" to "$canvas#xywh=percent:$xywh",
                )
            }
            if (notes.isNotEmpty()) c["annotations"] = listOf(linkedMapOf("id" to "$canvas/annotations", "type" to "AnnotationPage", "items" to notes))
            c
        }
        val sections = file.sections()
        if (sections.isNotEmpty()) {
            val index = units.withIndex().associate { (i, u) -> u.id to i + 1 }
            manifest["structures"] = sections.map { s ->
                val from = index[s.unitFrom] ?: 1
                val to = s.unitTo?.let { index[it] } ?: from
                linkedMapOf(
                    "id" to "$root/range/${s.id}", "type" to "Range", "label" to mapOf("none" to listOf(s.title)),
                    "items" to (from..maxOf(from, to)).map { k -> mapOf("id" to "$root/canvas/$k", "type" to "Canvas") },
                )
            }
        }
        return manifest
    }

    // ------------------------------------------------------------------ page sequence

    private fun parseXml(text: String): org.w3c.dom.Document {
        val f = DocumentBuilderFactory.newInstance()
        f.isNamespaceAware = true
        f.isExpandEntityReferences = false
        runCatching { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        return f.newDocumentBuilder().parse(org.xml.sax.InputSource(java.io.StringReader(text)))
    }

    private fun elements(doc: org.w3c.dom.Document, ns: String, name: String): List<Element> {
        val nl = doc.getElementsByTagNameNS(ns, name)
        return (0 until nl.length).map { nl.item(it) as Element }
    }

    /**
     * The page sequence the conformance suite compares (SPEC §19.4), read back by parsing the
     * export itself: `alto` → `{physical, printed}` of each `Page`; `tei` → `{n}` of each `pb`;
     * `iiif` → `{label}` of each page canvas.
     */
    @JvmStatic
    public fun pageSequence(file: SpdfFile, format: String): List<Map<String, Any?>> = when (format) {
        "alto" -> elements(parseXml(alto(file)), ALTO_NS, "Page").map { p ->
            val phys = p.getAttribute("PHYSICAL_IMG_NR")
            linkedMapOf(
                "physical" to (phys.toLongOrNull() ?: phys),
                "printed" to if (p.hasAttribute("PRINTED_IMG_NR")) p.getAttribute("PRINTED_IMG_NR") else null,
            )
        }
        "tei" -> elements(parseXml(tei(file)), TEI_NS, "pb").map { pb ->
            linkedMapOf("n" to if (pb.hasAttribute("n")) pb.getAttribute("n") else null)
        }
        "iiif" -> {
            val manifest = asMap(Json.parse(Json.compact(iiif(file))))!!
            val canvases = asList(manifest["items"]) ?: emptyList()
            val units = file.units()
            canvases.indices.filter { it < units.size && isPage(units[it]) }.map { i ->
                val label = asList(asMap(asMap(canvases[i])?.get("label"))?.get("none"))?.firstOrNull()
                linkedMapOf("label" to label)
            }
        }
        else -> throw SpdfException(null, "unknown structure format $format (alto, tei, iiif)")
    }
}
