package io.github.joseluissaorin.spdf

/**
 * An SPDF error. [code] is the validation code of SPEC §22 when there is one (`E001`,
 * `E020`…), null for other failures (bad arguments, malformed JSON…).
 */
public class SpdfException @JvmOverloads constructor(
    public val code: String?,
    message: String,
    public val where: String? = null,
    cause: Throwable? = null,
) : RuntimeException(format(code, message, where), cause) {
    /** The message without code and location. */
    public val detail: String = message

    private companion object {
        fun format(code: String?, message: String, where: String?): String {
            val head = if (code != null) "$code: $message" else message
            return if (!where.isNullOrEmpty()) "$head ($where)" else head
        }
    }
}
