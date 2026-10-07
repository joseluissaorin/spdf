package io.github.joseluissaorin.spdf.cli

import io.github.joseluissaorin.spdf.AnchorUri
import io.github.joseluissaorin.spdf.Json
import io.github.joseluissaorin.spdf.OpenOptions
import io.github.joseluissaorin.spdf.SpdfException
import io.github.joseluissaorin.spdf.SpdfFile
import io.github.joseluissaorin.spdf.Sources
import io.github.joseluissaorin.spdf.Spdf
import io.github.joseluissaorin.spdf.Validator
import io.github.joseluissaorin.spdf.conformance.ConformanceRunner
import io.github.joseluissaorin.spdf.jdbc.JdbcSqlDriver
import java.io.File
import java.io.PrintStream
import kotlin.system.exitProcess

/**
 * The `spdf` command-line tool.
 *
 * ```
 * spdf validate FILE
 * spdf dump FILE
 * spdf search FILE QUERY [-n N]
 * spdf vsearch FILE SPACE V1,V2,... [-n N] [--target fragment|unit|figure]
 * spdf hybrid FILE SPACE V1,V2,... QUERY [-n N]
 * spdf cite FILE FRAGMENT_ID [--locale es|en]
 * spdf export FILE csl|bibtex|alto|tei|iiif
 * spdf uri parse URI
 * spdf locate FILE REFERENCE        (an spdf: URI, or FILE-URL#p=5&f=1r)
 * spdf build SOURCE.json OUT.spdf
 * spdf conformance [DIR] [-o conformance.json]
 * spdf version
 * ```
 */
public object Main {
    private val out = PrintStream(java.io.FileOutputStream(java.io.FileDescriptor.out), true, "UTF-8")
    private val err = PrintStream(java.io.FileOutputStream(java.io.FileDescriptor.err), true, "UTF-8")

    private const val USAGE = """usage:
  spdf validate FILE
  spdf dump FILE
  spdf search FILE QUERY [-n N]
  spdf vsearch FILE SPACE V1,V2,... [-n N] [--target fragment|unit|figure]
  spdf hybrid FILE SPACE V1,V2,... QUERY [-n N]
  spdf cite FILE FRAGMENT_ID [--locale es|en]
  spdf export FILE csl|bibtex|alto|tei|iiif
  spdf uri parse URI
  spdf locate FILE REFERENCE
  spdf build SOURCE.json OUT.spdf
  spdf conformance [DIR] [-o conformance.json]
  spdf version"""

    @JvmStatic
    public fun main(args: Array<String>) {
        exitProcess(run(args.toList()))
    }

    /** Runs a command and returns the exit code (0 ok, 1 failure, 2 usage). */
    @JvmStatic
    public fun run(argv: List<String>): Int {
        if (argv.isEmpty()) return usage()
        val cmd = argv[0]
        val pos = ArrayList<String>()
        var n = 10
        var locale = "es"
        var output: String? = null
        var target = "fragment"
        var i = 1
        while (i < argv.size) {
            val a = argv[i]
            fun value(): String = argv.getOrNull(i + 1) ?: throw IllegalArgumentException("$a needs a value")
            when (a) {
                "-n", "--n", "--limit" -> { n = value().toInt(); i++ }
                "-locale", "--locale" -> { locale = value(); i++ }
                "-o", "--output" -> { output = value(); i++ }
                "--target" -> { target = value(); i++ }
                else -> pos += a
            }
            i++
        }
        val driver = JdbcSqlDriver()
        fun need(k: Int) = if (pos.size < k) throw UsageException() else Unit
        fun open(p: String) = SpdfFile.open(File(p), driver, OpenOptions.DEFAULT)
        fun vector(s: String) = s.split(",").map { it.trim().toDouble() }.toDoubleArray()
        return try {
            when (cmd) {
                "version", "--version" -> out.println("${Spdf.IMPL_NAME} ${Spdf.VERSION} (SPDF ${Spdf.FORMAT_VERSION}, ${driver.name})")
                "validate" -> {
                    need(1)
                    val r = Validator.validate(File(pos[0]), driver)
                    out.println(Json.canonical(r))
                    if (!r.isValid) return 1
                }
                "dump" -> {
                    need(1)
                    open(pos[0]).use { out.println(it.dumpJson()) }
                }
                "search" -> {
                    need(2)
                    open(pos[0]).use { out.println(Json.canonical(it.searchLexical(pos.drop(1).joinToString(" "), n))) }
                }
                "vsearch" -> {
                    need(3)
                    open(pos[0]).use { out.println(Json.canonical(it.searchVector(vector(pos[2]), pos[1], target, n))) }
                }
                "hybrid" -> {
                    need(4)
                    open(pos[0]).use { out.println(Json.canonical(it.searchHybrid(pos.drop(3).joinToString(" "), vector(pos[2]), pos[1], n))) }
                }
                "cite" -> {
                    need(2)
                    open(pos[0]).use { out.println(it.citeFragment(pos[1], locale)) }
                }
                "export" -> {
                    need(2)
                    open(pos[0]).use {
                        when (pos[1]) {
                            "csl" -> out.println(it.exportCslJson())
                            "bibtex" -> out.print(it.exportBibTeX())
                            "alto" -> out.print(it.exportAlto())
                            "tei" -> out.print(it.exportTei())
                            "iiif" -> out.println(Json.pretty(Json.parse(it.exportIiif())))
                            else -> throw UsageException()
                        }
                    }
                }
                "uri" -> {
                    need(2)
                    if (pos[0] != "parse") throw UsageException()
                    val p = AnchorUri.parse(pos[1])
                    out.println(Json.canonical(mapOf("docref" to p.docref, "locator" to p.locator, "canonical" to p.canonical())))
                }
                "locate" -> {
                    need(2)
                    open(pos[0]).use { out.println(Json.canonical(it.locate(pos[1]))) }
                }
                "build" -> {
                    need(2)
                    Sources.write(Sources.read(File(pos[0])), File(pos[1]), driver)
                }
                "conformance" -> {
                    val dir = File(pos.getOrNull(0) ?: "conformance")
                    val rep = ConformanceRunner(driver).run(dir)
                    val js = rep.toJsonString()
                    out.println(js)
                    output?.let { o ->
                        val f = File(o)
                        f.absoluteFile.parentFile?.mkdirs()
                        f.writeText(js + "\n", Charsets.UTF_8)
                    }
                    err.println(rep.summary())
                    for (f in rep.failed) err.println("FAIL ${f.id}: ${f.reason}")
                    if (rep.failed.isNotEmpty()) return 1
                }
                else -> return usage()
            }
            0
        } catch (e: UsageException) {
            usage()
        } catch (e: SpdfException) {
            err.println("spdf: ${e.message}")
            1
        } catch (e: Exception) {
            err.println("spdf: ${e.message ?: e}")
            1
        }
    }

    private class UsageException : RuntimeException()

    private fun usage(): Int {
        err.println(USAGE)
        return 2
    }
}
