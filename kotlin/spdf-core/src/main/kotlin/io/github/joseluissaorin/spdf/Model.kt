package io.github.joseluissaorin.spdf

// Rows of an SPDF 5.0 file (SPEC §3). The same classes are read from files and given to the
// writer. Required members are constructor parameters; the rest are mutable properties, so
// Java code can write `new Fragment(...)` and then call setters.

/** The `documents` row. */
public class Document @JvmOverloads constructor(
    public var id: String,
    /** pdf | scanned_pdf | photos | image | audio | video | document | epub | slides | sheet | web */
    public var kind: String,
    public var mime: String,
    /** Lowercase hex SHA-256 of the original bytes. */
    public var sourceSha256: String,
    /** CSL-JSON item plus the `spdf` extension object. */
    public var metadata: Map<String, Any?> = emptyMap(),
) : JsonConvertible {
    /** `blob:<key>`, a URL, or null. */
    public var sourceRef: String? = null
    public var bytes: Long = 0
    /** Null: the writer counts the units it wrote. */
    public var unitCount: Long? = null
    /** Seconds (audio, video). */
    public var duration: Double? = null
    /** ISO 8601 UTC; null: now (writer). */
    public var created: String? = null
    /** Null: same as [created] (writer). */
    public var updated: String? = null
    public var title: String? = null
    /** `Family; Family`. */
    public var authors: String? = null
    public var year: Long? = null
    /** BCP 47. */
    public var language: String? = null
    /** `{license, access, holder, note}`. */
    public var rights: Map<String, Any?>? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "kind" to kind, "metadata" to metadata, "source_sha256" to sourceSha256, "source_ref" to sourceRef,
        "mime" to mime, "bytes" to bytes, "unit_count" to unitCount, "duration" to duration, "created" to created,
        "updated" to updated, "title" to title, "authors" to authors, "year" to year, "language" to language, "rights" to rights,
    )

    override fun toString(): String = "Document${Json.compact(toJson())}"
}

/** A citable unit (`units` row): a page, a time span, a slide, a section, a sheet… */
public class CitableUnit @JvmOverloads constructor(
    public var id: String,
    public var anchor: Anchor,
    /** NFC text, light Markdown. */
    public var text: String = "",
    /** Who produced the text: `pdf-text-layer`, `gemma-4-e4b`, `whisper-large-v3-turbo`… */
    public var reader: String = "",
) : JsonConvertible {
    /** 1-based, contiguous; null: next ordinal (writer). */
    public var ord: Long? = null
    /** Footnotes. */
    public var notes: List<String>? = null
    public var header: String? = null
    public var footer: String? = null
    /** `blob:<key>` or URL of the page image, frame or slide. */
    public var image: String? = null
    public var thumbnail: String? = null
    /** Null: 1. */
    public var confidence: Double? = null
    /** Printed folio (denormalized from the anchor). */
    public var printed: String? = null
    public var t0: Double? = null
    public var t1: Double? = null
    /** Word timings `{"v":1,"t0":…,"cs":[…]}`. */
    public var words: Any? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "ord" to ord, "anchor" to anchor, "text" to text, "notes" to notes, "header" to header,
        "footer" to footer, "image" to image, "thumbnail" to thumbnail, "reader" to reader, "confidence" to confidence,
        "printed" to printed, "t0" to t0, "t1" to t1, "words" to words,
    )

    override fun toString(): String = "CitableUnit${Json.compact(toJson())}"
}

/** An entry of the table of contents (`sections` row). */
public class Section @JvmOverloads constructor(
    public var id: String,
    public var title: String,
    public var unitFrom: String,
    public var level: Long = 1,
) : JsonConvertible {
    public var parent: String? = null
    public var unitTo: String? = null
    public var summary: String? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "parent" to parent, "level" to level, "title" to title, "unit_from" to unitFrom,
        "unit_to" to unitTo, "summary" to summary,
    )

    override fun toString(): String = "Section${Json.compact(toJson())}"
}

/** A searchable, citable passage (`fragments` row). */
public class Fragment (
    public var id: String,
    public var unit: String,
    /** Literal NFC text (never modernized). */
    public var text: String,
    /** Anchor of the start. */
    public var anchor: Anchor,
) : JsonConvertible {
    /** Stable rowid used by FTS; null: next (writer). */
    public var n: Long? = null
    /** Reading order; null: next (writer). */
    public var ord: Long? = null
    /** One line situating the fragment in the work. */
    public var context: String = ""
    /** Heading path. */
    public var section: List<String>? = null
    /** Anchor of the end if the fragment crosses units. */
    public var anchorEnd: Anchor? = null
    /** Modernized-spelling layer, search only. */
    public var searchText: String? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "n" to n, "id" to id, "unit" to unit, "ord" to ord, "text" to text, "context" to context, "section" to section,
        "anchor" to anchor, "anchor_end" to anchorEnd, "search_text" to searchText,
    )

    override fun toString(): String = "Fragment${Json.compact(toJson())}"
}

/** A figure of a unit (`figures` row). */
public class Figure (
    public var id: String,
    public var unit: String,
    /** `blob:<key>` (cropped) or the unit image plus the region in the anchor. */
    public var image: String,
    public var anchor: Anchor,
) : JsonConvertible {
    public var caption: String? = null
    /** Description in the document language. */
    public var description: String? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "unit" to unit, "image" to image, "caption" to caption, "description" to description, "anchor" to anchor,
    )

    override fun toString(): String = "Figure${Json.compact(toJson())}"
}

/** A vector space (`spaces` row). */
public class Space @JvmOverloads constructor(
    /** `<model>@<dims>` for f32, `<model>@<dims>:<dtype>` otherwise. */
    public var id: String,
    public var provider: String,
    public var model: String,
    public var dims: Long,
    /** f32 | f16 | i8. */
    public var dtype: String = "f32",
) : JsonConvertible {
    public var version: String? = null
    public var normalized: Boolean = true
    /** Matryoshka: original dims if truncated. */
    public var truncatedFrom: Long? = null
    public var modalities: List<String> = listOf("text")
    /** `{"query": "...", "document": "..."}` used at encode time. */
    public var taskPrefixes: Map<String, Any?>? = null
    public var created: String? = null

    /** Raw modalities JSON, if it was not a list of strings (kept verbatim by the writer). */
    internal var rawModalities: Any? = null

    /** Raw `normalized` value of a source (kept verbatim by the writer in exact mode). */
    internal var rawNormalized: Any? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "id" to id, "provider" to provider, "model" to model, "version" to version, "dims" to dims, "dtype" to dtype,
        "normalized" to if (normalized) 1L else 0L, "truncated_from" to truncatedFrom, "modalities" to (rawModalities ?: modalities),
        "task_prefixes" to taskPrefixes, "created" to created,
    )

    override fun toString(): String = "Space${Json.compact(toJson())}"
}

/** A processing stage (`provenance` row). */
public class Provenance (
    public var stage: String,
    /** ISO 8601. */
    public var at: String,
) : JsonConvertible {
    public var provider: String? = null
    public var model: String? = null
    /** A JSON object or null. */
    public var detail: Any? = null
    public var ms: Long? = null

    override fun toJson(): Map<String, Any?> = linkedMapOf(
        "stage" to stage, "provider" to provider, "model" to model, "detail" to detail, "ms" to ms, "at" to at,
    )

    override fun toString(): String = "Provenance${Json.compact(toJson())}"
}

/** A stored binary object (`blobs` row), referenced as `blob:<key>`. */
public class Blob(public val key: String, public val mime: String, public val data: ByteArray) {
    /** SHA-256 of [data] (lowercase hex). */
    public val sha256: String by lazy { sha256Hex(data) }

    override fun toString(): String = "Blob(key=$key, mime=$mime, ${data.size} bytes)"
}

/** A search result (SPEC §10). */
public class Hit(
    /** fragment | unit | figure. */
    public val target: String,
    public val id: String,
    public val score: Double,
    /** Lists that produced it: `lexical`, `vector`. */
    public val via: List<String>,
    public val anchor: Anchor?,
    public val anchorEnd: Anchor?,
    public val anchorUri: String,
    /** Fragment rowid or unit ord, used to break ties (0 for figures). */
    public val n: Long,
) : JsonConvertible {
    /** The fragment id (null for unit and figure hits). */
    public val fragmentId: String? get() = if (target == "fragment") id else null

    override fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>()
        if (target == "fragment") {
            m["fragment_id"] = id
        } else {
            m["target"] = target
            m["id"] = id
        }
        m["score"] = score
        m["via"] = via
        m["anchor"] = anchor
        if (anchorEnd != null) m["anchor_end"] = anchorEnd
        m["anchor_uri"] = anchorUri
        return m
    }

    internal fun with(score: Double, via: List<String>): Hit = Hit(target, id, score, via, anchor, anchorEnd, anchorUri, n)

    override fun toString(): String = "Hit${Json.compact(toJson())}"
}
