package io.github.joseluissaorin.spdf.jdbc

import io.github.joseluissaorin.spdf.Anchor
import io.github.joseluissaorin.spdf.CitableUnit
import io.github.joseluissaorin.spdf.Document
import io.github.joseluissaorin.spdf.Fragment
import io.github.joseluissaorin.spdf.Json
import io.github.joseluissaorin.spdf.OpenOptions
import io.github.joseluissaorin.spdf.Provenance
import io.github.joseluissaorin.spdf.Space
import io.github.joseluissaorin.spdf.SpdfException
import io.github.joseluissaorin.spdf.SpdfFile
import io.github.joseluissaorin.spdf.SpdfWriter
import io.github.joseluissaorin.spdf.Validator
import io.github.joseluissaorin.spdf.WriterOptions
import io.github.joseluissaorin.spdf.conformance.ConformanceRunner
import io.github.joseluissaorin.spdf.sql.SqlDriver
import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import java.util.zip.GZIPOutputStream
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

internal fun conformanceDir(): File {
    val d = File(System.getProperty("spdf.conformance.dir") ?: System.getenv("SPDF_CONFORMANCE_DIR") ?: "../../conformance")
    check(File(d, "cases").isDirectory) { "conformance suite not found at $d (set SPDF_CONFORMANCE_DIR)" }
    return d
}

class ConformanceTest {
    @Test
    fun wholeSuitePasses() {
        val rep = ConformanceRunner(JdbcSqlDriver()).run(conformanceDir())
        println("spdf-kotlin (sqlite-jdbc): ${rep.summary()}")
        assertTrue(rep.passed.isNotEmpty())
        assertEquals(emptyList(), rep.failed.map { "${it.id}: ${it.reason}" })
    }

    @Test
    fun bibtexKeysMatchTheOtherImplementations() {
        // The expected keys come from the suite itself (export-csl-<file>-plain), so this test
        // follows the corpus when it changes.
        val expected = listOf("quijote", "lazarillo", "apolo11", "lunyu", "micrographia").associateWith { name ->
            val case = Json.parseObject(File(conformanceDir(), "cases/export-csl-$name-plain.json").readText())
            (((case["expect"] as Map<*, *>)["items"] as List<*>).single() as Map<*, *>)["id"] as String
        }
        assertEquals("anonnd", expected["lunyu"])
        for ((name, key) in expected) {
            SpdfFile.open(File(conformanceDir(), "files/$name.spdf"), JdbcSqlDriver()).use { f ->
                assertEquals(key, io.github.joseluissaorin.spdf.Export.citationKey(f.metadata()), name)
                assertTrue(f.exportBibTeX().startsWith("@"), name)
                assertTrue(f.exportCslJson().contains("\"id\":\"$key\""), name)
            }
        }
        val (type, fields) = io.github.joseluissaorin.spdf.Export.bibtexFields(
            mapOf("type" to "article-journal", "title" to "On the {origin}", "container-title" to "Nature",
                "author" to listOf(mapOf("literal" to "NASA"), mapOf("family" to "Vega", "non-dropping-particle" to "de", "given" to "Lope"), mapOf("given" to "Ana")),
                "page" to "1-2", "volume" to 3L, "abstract" to "dropped", "translator" to listOf(mapOf("family" to "X"))),
        )
        assertEquals("article", type)
        assertEquals(
            listOf("author" to "{NASA} and de Vega, Lope and {Ana}", "title" to "{On} the \\{origin\\}", "journal" to "{Nature}", "volume" to "3", "pages" to "1-2"),
            fields,
        )
    }
}

class JdbcTest {
    private val driver = JdbcSqlDriver()
    private val tmp: File = Files.createTempDirectory("spdf-kotlin-test").toFile().apply { deleteOnExit() }

    private fun sample(name: String = "sample.spdf", trigram: Boolean = false): File {
        val out = File(tmp, name)
        SpdfWriter.create(out, WriterOptions(generator = "test/1", trigram = trigram), driver).use { w ->
            w.setDocument(
                Document("doc1", "pdf", "application/pdf", "AB".repeat(32), mapOf(
                    "type" to "book", "title" to "Don Quijote: primera parte",
                    "author" to listOf(mapOf("family" to "Cervantes", "given" to "Miguel de")),
                    "issued" to mapOf("date-parts" to listOf(listOf(1605))), "language" to "es",
                )).apply {
                    created = "2026-10-07T00:00:00Z"
                    title = "Don Quijote"
                },
            )
            w.addUnit(CitableUnit("u1", Anchor.page(1, "1", "read"), "En un lugar de la Mancha, de cuyo nombre no quiero acordarme", "test"))
            w.addUnit(CitableUnit("u2", Anchor.page(2, null), "Canción del caballero", "test")) // NFD on purpose
            w.addFragment(Fragment("f1", "u1", "En un lugar de la Mancha, de cuyo nombre no quiero acordarme", Anchor.page(1, "1").with("chars", listOf(0, 24))))
            w.addFragment(Fragment("f2", "u2", "Canción del caballero", Anchor.page(2, null)))
            w.addSpace(Space("toy@3", "test", "toy", 3))
            w.addSpace(Space("toy@3:i8", "test", "toy", 3, "i8"))
            w.addVector("fragment", "f1", "toy@3", doubleArrayOf(1.0, 0.0, 0.0))
            w.addVector("fragment", "f2", "toy@3", floatArrayOf(0f, 1f, 0f))
            w.addVector("fragment", "f1", "toy@3:i8", doubleArrayOf(1.0, 0.0, 0.0))
            w.addBlob("img", "image/png", byteArrayOf(1, 2, 3))
            w.addBlob("empty", "application/octet-stream", ByteArray(0))
            w.addProvenance(Provenance("read", "2026-10-07T00:00:00Z").apply { detail = mapOf("pages" to 2) })
            w.finish()
        }
        return out
    }

    @Test
    fun bundledSqliteHasFts5AndTrigram() {
        DriverManager.getConnection("jdbc:sqlite::memory:").use { c ->
            c.createStatement().use { s ->
                s.execute("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')")
                s.execute("CREATE VIRTUAL TABLE u USING fts5(x, tokenize='unicode61 remove_diacritics 2')")
            }
        }
    }

    @Test
    fun writeReadValidateSearch() {
        val path = sample()
        val res = Validator.validate(path, driver)
        assertTrue(res.isValid, res.toString())
        SpdfFile.open(path, driver).use { f ->
            assertEquals("5.0", f.version)
            assertTrue(f.safety.readOnly && f.safety.lengthLimit)
            val d = f.dump()
            val js = Json.canonical(d)
            assertTrue(js.contains("\"spdf_version\":\"5.0\"") && js.contains("\"tokenizer\":\"unicode61 remove_diacritics 2\""), js)
            assertEquals(64, f.contentSha256().length)
            assertEquals("Canción del caballero", f.units()[1].text) // NFC on write
            assertEquals(listOf(0L, 3L), (d["blobs"] as List<*>).map { (it as Map<*, *>)["bytes"] })
            assertContentEquals(ByteArray(0), assertNotNull(f.blob("blob:empty")).data)
            assertContentEquals(byteArrayOf(1, 2, 3), assertNotNull(f.blob("img")).data)

            val hits = f.searchLexical("cancion", 5)
            assertEquals(listOf("f2"), hits.map { it.id })
            assertTrue(hits[0].anchorUri.startsWith("spdf:sha256-abab") && hits[0].anchorUri.endsWith("#p=2"), hits[0].anchorUri)
            assertEquals("(Cervantes, 1605, s. p.)", f.cite(hits[0].anchor!!, null, "es"))
            assertEquals("(Cervantes, 1605, p. 1)", f.citeFragment("f1", "en"))

            val vh = f.searchVector(doubleArrayOf(0.9, 0.1, 0.0), "toy@3")
            assertEquals(listOf("f1", "f2"), vh.map { it.id })
            assertEquals(0.9, vh[0].score, 1e-6)
            val hy = f.searchHybrid("caballero", doubleArrayOf(1.0, 0.0, 0.0), "toy@3", 5)
            assertEquals(listOf("f2", "f1"), hy.map { it.id })
            assertEquals(listOf("lexical", "vector"), hy[0].via)

            assertTrue(f.exportBibTeX().startsWith("@book{cervantes1605,"), f.exportBibTeX())
            assertTrue(f.exportCslJson().contains("\"id\":\"cervantes1605\""))
            assertEquals(2, f.units().size)
            assertEquals(listOf("toy@3", "toy@3:i8"), f.spaces().map { it.id })
            assertEquals("core semantic", f.meta()["profile"])
        }
    }

    @Test
    fun writerSealsAndSigns() {
        val seed = ByteArray(32) { (it * 7 + 1).toByte() }
        val out = File(tmp, "signed.spdf")
        SpdfWriter.create(out, WriterOptions(generator = "test/1", signingKey = seed), driver).use { w ->
            w.setDocument(Document("s", "document", "text/plain", "ef".repeat(32), mapOf("type" to "book", "title" to "Rimas")).apply { created = "2026-10-07T00:00:00Z" })
            w.addUnit(CitableUnit("u1", Anchor.verse(1, 4), "Volverán las oscuras golondrinas", "test"))
            w.addFragment(Fragment("f1", "u1", "Volverán las oscuras golondrinas", Anchor.verse(1, 4)))
            w.setMeta("content_sha256", "will be replaced")
            w.finish()
        }
        val r = Validator.validate(out, driver)
        assertTrue(r.isValid, r.toString())
        // CI hands this file to the reference oracle (and other implementations) to verify it.
        System.getenv("SPDF_SIGNED_OUT")?.let { out.copyTo(File(it), overwrite = true) }
        SpdfFile.open(out, driver).use { f ->
            val meta = f.meta()
            assertEquals(f.contentSha256(), meta["content_sha256"])
            assertEquals("ed25519:" + java.util.Base64.getEncoder().encodeToString(io.github.joseluissaorin.spdf.Ed25519.publicKey(seed)), meta["signer"])
            assertTrue(Validator.verifySignature(meta["content_sha256"]!!, meta["signature"], meta["signer"]))
        }
        // Unsigned files still get content_sha256; exact mode keeps the meta verbatim.
        SpdfFile.open(sample(), driver).use { assertEquals(it.contentSha256(), it.meta()["content_sha256"]) }
        // Tampering is detected.
        val bad = File(tmp, "tampered.spdf")
        out.copyTo(bad)
        DriverManager.getConnection("jdbc:sqlite:" + bad.absolutePath).use { it.createStatement().use { s -> s.execute("UPDATE units SET text = 'otra cosa'") } }
        assertEquals(listOf("E081"), Validator.validate(bad, driver).errorCodes)
        val forged = File(tmp, "forged.spdf")
        out.copyTo(forged)
        DriverManager.getConnection("jdbc:sqlite:" + forged.absolutePath).use {
            it.createStatement().use { s -> s.execute("UPDATE spdf_meta SET value = '" + java.util.Base64.getEncoder().encodeToString(ByteArray(64)) + "' WHERE key = 'signature'") }
        }
        assertEquals(listOf("E082"), Validator.validate(forged, driver).errorCodes)
    }

    @Test
    fun structuralExports() {
        val dir = conformanceDir()
        SpdfFile.open(File(dir, "files/quijote.spdf"), driver).use { f ->
            val pages = f.units().filter { it.anchor.type == "page" }
            val alto = f.exportAlto()
            assertTrue(alto.contains("<Page ID=\"P1\" PHYSICAL_IMG_NR=\"${pages[0].anchor.long("physical")}\""), alto.take(800))
            assertTrue(alto.contains("<String ID=\"P1_B1_L1_S1\" CONTENT="))
            assertEquals(pages.map { io.github.joseluissaorin.spdf.Structure.folio(it.anchor) }, f.structurePages("tei").map { it["n"] })
            assertEquals(pages.map { it.anchor.long("physical") }, f.structurePages("alto").map { it["physical"] })
            val tei = f.exportTei()
            val first = pages.first { it.image != null }
            assertTrue(tei.contains("facs=\"${first.image}\""), tei.take(400))
            val iiif = Json.parseObject(f.exportIiif())
            assertEquals("Manifest", iiif["type"])
            assertEquals(f.units().size, (iiif["items"] as List<*>).size)
            assertEquals(f.structurePages("tei").size, f.units().count { it.anchor.type == "page" })
        }
        SpdfFile.open(File(dir, "files/apolo11.spdf"), driver).use { f ->
            val m = Json.parseObject(f.exportIiif())
            val canvas = (m["items"] as List<*>).single() as Map<*, *>
            assertTrue(canvas.containsKey("duration"))
            assertEquals(f.units().size, (m["structures"] as List<*>).size)
            assertTrue(f.exportTei().contains("<u who=\""))
        }
    }

    @Test
    fun readOnlyConnectionRefusesWrites() {
        val path = sample()
        val before = path.readBytes()
        driver.openReadOnly(path.path, 1 shl 20).use { c ->
            assertFailsWith<RuntimeException> { c.execute("DELETE FROM units", emptyList()) }
            assertFailsWith<RuntimeException> { c.execute("CREATE TABLE x(a)", emptyList()) }
            // SQLITE_LIMIT_LENGTH is in force.
            assertFailsWith<RuntimeException> { c.queryAll("SELECT zeroblob(${(1 shl 20) + 1})", emptyList()) }
        }
        assertContentEquals(before, path.readBytes())
    }

    @Test
    fun refusesTriggersViewsAndForeignVirtualTables() {
        for ((name, ddl) in listOf(
            "trigger" to "CREATE TRIGGER evil AFTER INSERT ON units BEGIN SELECT 1; END",
            "view" to "CREATE VIEW v AS SELECT 1",
            "vtable" to "CREATE VIRTUAL TABLE x_evil USING fts5(a)",
        )) {
            val path = sample("$name.spdf")
            DriverManager.getConnection("jdbc:sqlite:" + path.absolutePath).use { it.createStatement().use { s -> s.execute(ddl) } }
            val e = assertFailsWith<SpdfException> { SpdfFile.open(path, driver).close() }
            assertEquals("E020", e.code)
            assertEquals(listOf("E020"), Validator.validate(path, driver).errorCodes)
        }
    }

    @Test
    fun gzipAndWalCopies() {
        val path = sample()
        val gz = File(tmp, "wrapped.spdf")
        GZIPOutputStream(gz.outputStream()).use { it.write(path.readBytes()) }
        SpdfFile.open(gz, driver).use { f ->
            assertTrue(f.isGzipped)
            assertEquals(2, f.units().size)
        }
        assertEquals(listOf("E003"), Validator.validate(gz, driver).warningCodes)
        val e = assertFailsWith<SpdfException> { SpdfFile.open(gz, driver, OpenOptions(maxDecompressedSize = 1000)).close() }
        assertEquals("E001", e.code)
        // A WAL-mode file is opened through a copy whose header says rollback journal.
        val wal = File(tmp, "wal.spdf")
        path.copyTo(wal)
        DriverManager.getConnection("jdbc:sqlite:" + wal.absolutePath).use { it.createStatement().use { s -> s.execute("PRAGMA journal_mode=WAL") } }
        assertEquals(2, wal.readBytes()[18].toInt())
        SpdfFile.open(wal, driver).use { assertEquals(2, it.fragments().size) }
        assertEquals(2, wal.readBytes()[18].toInt(), "the original file is never touched")
        // Bytes in memory.
        SpdfFile.open(path.readBytes(), driver).use { assertEquals("5.0", it.version) }
    }

    @Test
    fun notADatabase() {
        val f = File(tmp, "text.spdf").apply { writeText("hello, this is not SQLite at all") }
        assertEquals("E001", assertFailsWith<SpdfException> { SpdfFile.open(f, driver) }.code)
        assertEquals(listOf("E001"), Validator.validate(f, driver).errorCodes)
    }

    @Test
    fun writerDiscardsUnfinishedFiles() {
        val out = File(tmp, "never.spdf")
        assertFailsWith<IllegalStateException> {
            SpdfWriter.create(out, WriterOptions(), driver).use { w ->
                w.setDocument(Document("d", "pdf", "application/pdf", "00".repeat(32)))
                error("boom")
            }
        }
        assertFalse(out.exists())
        assertTrue(tmp.listFiles()!!.none { it.name.startsWith(".spdf-writer-") })
    }

    @Test
    fun dumpReportsTheTokenizerAsDeclared() {
        val cases = mapOf(
            "CREATE VIRTUAL TABLE fragments_fts USING fts5(text, TOKENIZE = \"unicode61   remove_diacritics 2\")" to "unicode61 remove_diacritics 2",
            "CREATE VIRTUAL TABLE fragments_fts USING fts5(text, tokenize=trigram)" to "trigram",
            "CREATE VIRTUAL TABLE fragments_fts USING fts5(text)" to "unicode61",
            "CREATE VIRTUAL TABLE fragments_fts USING fts5(text, tokenize = ' porter   unicode61 ')" to "porter unicode61",
        )
        for ((i, entry) in cases.entries.withIndex()) {
            val path = sample("tok$i.spdf")
            DriverManager.getConnection("jdbc:sqlite:" + path.absolutePath).use { c ->
                c.createStatement().use { s ->
                    s.execute("DROP TABLE fragments_fts")
                    s.execute(entry.key)
                }
            }
            SpdfFile.open(path, driver).use { f -> assertEquals(entry.value, (f.dump()["fts"] as Map<*, *>)["tokenizer"]) }
        }
    }

    @Test
    fun serviceLoaderFindsTheJdbcAdapter() {
        assertTrue(SqlDriver.default() is JdbcSqlDriver)
        SpdfFile.open(sample().path).use { assertEquals("doc1", it.document().id) }
    }
}
