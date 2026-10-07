package io.github.joseluissaorin.spdf

import io.github.joseluissaorin.spdf.sql.SqlDriver
import java.io.File

/**
 * Entry points and constants of the SPDF library (Semantic Processed Document Format).
 * Everything here is static for Java (`Spdf.open(...)`, `Spdf.validate(...)`).
 */
public object Spdf {
    /** Version of this library. */
    public const val VERSION: String = "0.1.0"

    /** Name of this implementation in conformance reports. */
    public const val IMPL_NAME: String = "spdf-kotlin"

    /** SPDF version written by [SpdfWriter]. */
    public const val FORMAT_VERSION: String = "5.0"

    /** `PRAGMA application_id` of an SPDF file (0x53504446, "SPDF"). */
    public const val APPLICATION_ID: Long = 1397769286L

    /** `PRAGMA user_version` of an SPDF 5.0 file. */
    public const val USER_VERSION: Long = 500L

    /** Reciprocal rank fusion constant of hybrid search. */
    public const val RRF_K: Int = 10

    /** Prefix of the signed message (`spdf-content-sha256:<hex>`). */
    public const val SIGNATURE_PREFIX: String = "spdf-content-sha256:"

    /** `spdf_meta` keys left out of `content_sha256`. */
    @JvmField
    public val INTEGRITY_KEYS: List<String> = listOf("content_sha256", "signature", "signer")

    /** Opens a file with the default adapter. */
    @JvmStatic
    public fun open(path: String): SpdfFile = SpdfFile.open(path)

    /** Opens a file with a given adapter. */
    @JvmStatic
    @JvmOverloads
    public fun open(file: File, driver: SqlDriver, options: OpenOptions = OpenOptions.DEFAULT): SpdfFile = SpdfFile.open(file, driver, options)

    /** Validates a file with the default adapter. */
    @JvmStatic
    public fun validate(path: String): ValidationResult = Validator.validate(path)

    /** Validates a file with a given adapter. */
    @JvmStatic
    @JvmOverloads
    public fun validate(file: File, driver: SqlDriver, options: OpenOptions = OpenOptions.DEFAULT): ValidationResult =
        Validator.validate(file, driver, options)

    /** Starts writing a new SPDF 5.0 file with the default adapter. */
    @JvmStatic
    public fun create(path: String): SpdfWriter = SpdfWriter.create(path)

    /** Builds a file from a source (full dump JSON). */
    @JvmStatic
    @JvmOverloads
    public fun writeSource(source: Map<String, Any?>, file: File, driver: SqlDriver = SqlDriver.default()): Unit = Sources.write(source, file, driver)

    /** The canonical URI of an anchor. */
    @JvmStatic
    @JvmOverloads
    public fun anchorUri(docref: String, anchor: Anchor, end: Anchor? = null): String = AnchorUri.format(docref, anchor, end)

    /** Parses an anchor URI (strict). */
    @JvmStatic
    public fun parseUri(uri: String): AnchorUri.Parsed = AnchorUri.parse(uri)

    /** Short citation of an anchor of the work described by a CSL-JSON item. */
    @JvmStatic
    @JvmOverloads
    public fun cite(anchor: Anchor, end: Anchor?, metadata: Map<String, Any?>, locale: String = "es"): String =
        Citation.cite(anchor, end, metadata, locale)
}
