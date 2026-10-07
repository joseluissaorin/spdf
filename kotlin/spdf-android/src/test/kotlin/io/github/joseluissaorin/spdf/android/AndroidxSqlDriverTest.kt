package io.github.joseluissaorin.spdf.android

import io.github.joseluissaorin.spdf.Anchor
import io.github.joseluissaorin.spdf.CitableUnit
import io.github.joseluissaorin.spdf.Document
import io.github.joseluissaorin.spdf.Fragment
import io.github.joseluissaorin.spdf.SpdfException
import io.github.joseluissaorin.spdf.SpdfFile
import io.github.joseluissaorin.spdf.SpdfWriter
import io.github.joseluissaorin.spdf.Validator
import io.github.joseluissaorin.spdf.WriterOptions
import io.github.joseluissaorin.spdf.conformance.ConformanceRunner
import io.github.joseluissaorin.spdf.sql.SqlDriver
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The Android adapter, tested on the host JVM: androidx.sqlite's bundled driver ships the same
 * SQLite build (FTS5, trigram) for Linux, macOS and Windows as for Android.
 */
class AndroidxSqlDriverTest {
    private val driver = AndroidxSqlDriver()

    private fun conformanceDir(): File {
        val d = File(System.getProperty("spdf.conformance.dir") ?: System.getenv("SPDF_CONFORMANCE_DIR") ?: "../../conformance")
        check(File(d, "cases").isDirectory) { "conformance suite not found at $d (set SPDF_CONFORMANCE_DIR)" }
        return d
    }

    @Test
    fun wholeConformanceSuitePasses() {
        val rep = ConformanceRunner(driver).run(conformanceDir())
        println("spdf-kotlin (androidx.sqlite bundled): ${rep.summary()}")
        assertTrue(rep.passed.isNotEmpty())
        assertEquals(emptyList(), rep.failed.map { "${it.id}: ${it.reason}" })
    }

    @Test
    fun bundledSqliteHasFts5AndTrigram() {
        val tmp = Files.createTempDirectory("spdf-androidx").toFile()
        driver.openReadWrite(File(tmp, "x.db").path).use { c ->
            c.execute("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')", emptyList())
            c.execute("CREATE VIRTUAL TABLE u USING fts5(x, tokenize='unicode61 remove_diacritics 2')", emptyList())
        }
        tmp.deleteRecursively()
    }

    @Test
    fun readOnlyAndSafe() {
        val tmp = Files.createTempDirectory("spdf-androidx").toFile()
        val out = File(tmp, "x.spdf")
        SpdfWriter.create(out, WriterOptions(), driver).use { w ->
            w.setDocument(Document("d", "pdf", "application/pdf", "cd".repeat(32), mapOf("type" to "book", "title" to "Rimas")))
            w.addUnit(CitableUnit("u1", Anchor.page(1, "1"), "Volverán las oscuras golondrinas", "test"))
            w.addFragment(Fragment("f1", "u1", "Volverán las oscuras golondrinas", Anchor.page(1, "1")))
            w.finish()
        }
        assertTrue(Validator.validate(out, driver).isValid)
        val before = out.readBytes()
        SpdfFile.open(out, driver).use { f ->
            assertTrue(f.safety.readOnly)
            assertFalse(f.safety.lengthLimit) // enforced by the core instead
            assertEquals(listOf("f1"), f.searchLexical("volveran").map { it.id })
        }
        driver.openReadOnly(out.path, 1 shl 20).use { c ->
            assertFailsWith<RuntimeException> { c.execute("DELETE FROM units", emptyList()) }
        }
        assertTrue(before.contentEquals(out.readBytes()))
        // A value larger than maxBlobSize is refused when SQLITE_LIMIT_LENGTH is not available.
        val e = assertFailsWith<SpdfException> {
            SpdfFile.open(out, driver, io.github.joseluissaorin.spdf.OpenOptions(maxBlobSize = 16)).close()
        }
        assertTrue(e.message!!.contains("maximum blob size"), e.message)
        tmp.deleteRecursively()
    }

    @Test
    fun serviceLoaderFindsTheAndroidAdapter() {
        assertTrue(SqlDriver.default() is AndroidxSqlDriver)
    }
}
