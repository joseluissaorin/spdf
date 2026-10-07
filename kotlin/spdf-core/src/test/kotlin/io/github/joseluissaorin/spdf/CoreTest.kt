package io.github.joseluissaorin.spdf

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Expected values come from the reference oracle (conformance/tools/spdfref.py, Python 3.13).
class JsonTest {
    @Test
    fun integersStayIntegers() {
        val v = Json.parseObject("""{"a":1,"b":1.0,"c":-0,"d":1e2,"e":12345678901234567890}""")
        assertEquals(1L, v["a"])
        assertEquals(1.0, v["b"])
        assertEquals(0L, v["c"])
        assertEquals(100.0, v["d"])
        assertTrue(v["e"] is Double)
    }

    @Test
    fun rejectsInvalidJson() {
        for (bad in listOf("", "{", "[1,]", "{\"a\":1}x", "NaN", "\"\u0001\"", "01", "1.", "{'a':1}")) {
            assertFailsWith<SpdfException>(bad) { Json.parse(bad) }
        }
    }

    @Test
    fun numberForm() {
        val cases = mapOf(
            0.1 to "0.1", 1e21 to "1e+21", 1e-7 to "1e-7", 1.2345678901234568e+20 to "123456789012345680000",
            1.5e-06 to "0.0000015", 1e-06 to "0.000001", 5e-324 to "5e-324", 1.7976931348623157e+308 to "1.7976931348623157e+308",
            4.35 to "4.35", 0.3333333333333333 to "0.3333333333333333", 2.5e-05 to "0.000025", 100.0 to "100", 1e+20 to "100000000000000000000",
            1.23e-18 to "1.23e-18", -0.5 to "-0.5", 1e+23 to "1e+23", 3.333333333333333e-07 to "3.333333333333333e-7", -0.0 to "0",
        )
        for ((x, s) in cases) assertEquals(s, Json.formatNumber(x), "formatNumber($x)")
    }

    @Test
    fun roundSixDecimalsOnTheExactBinaryValue() {
        val cases = mapOf(
            0.0000005 to 0.0, 0.0000015 to 2e-06, 0.0000025 to 3e-06, 1.0000005 to 1.000001, 2.675 to 2.675,
            -0.0000004 to 0.0, 0.1234565 to 0.123456, 1e300 to 1e300, 4175.4999995 to 4175.499999,
        )
        for ((x, r) in cases) assertEquals(r, Json.round6(x), "round6($x)")
        assertEquals("0", Json.canonical(-0.0000001))
    }

    @Test
    fun jcsLayout() {
        // RFC 8785 §3.2.3: keys sorted by UTF-16 code units.
        val obj = mapOf("€" to "Euro Sign", "\r" to "Carriage Return", "דּ" to "Hebrew Letter Dalet With Dagesh",
            "1" to "One", "😀" to "Emoji: Grinning Face", "\u0080" to "Control", "ö" to "Latin Small Letter O With Diaeresis")
        assertEquals(
            "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\u0080\":\"Control\",\"\u00f6\":\"Latin Small Letter O With Diaeresis\",\"\u20ac\":\"Euro Sign\",\"\ud83d\ude00\":\"Emoji: Grinning Face\",\"\ufb33\":\"Hebrew Letter Dalet With Dagesh\"}",
            Json.compact(obj),
        )
        assertEquals("\"a\\\"b\\\\c\\b\\f\\n\\r\\t\\u0001\\u001f/é\"", Json.compact("a\"b\\c\b\u000c\n\r\t\u0001\u001f/é"))
        assertEquals("""{"a":[1,0.5,true,null],"b":{}}""", Json.canonical(mapOf("b" to emptyMap<String, Any>(), "a" to listOf(1.0, 0.5, true, null))))
    }

    @Test
    fun pythonRepr() {
        val cases = mapOf(4.0 to "4.0", 1e16 to "1e+16", 1e15 to "1000000000000000.0", 0.0001 to "0.0001", 1e-05 to "1e-05",
            123.456 to "123.456", -1.5e-10 to "-1.5e-10")
        for ((x, s) in cases) assertEquals(s, Json.pythonRepr(x))
    }
}

class VectorsTest {
    @Test
    fun halfRoundsToNearestEvenFromDouble() {
        val cases = mapOf(
            0.1 to "662e", 65504.0 to "ff7b", 0.0 to "0000", 0.333333 to "5535", 1e-08 to "0000", 6e-08 to "0100", 3e-08 to "0100",
            2.98e-08 to "0000", 6.1e-05 to "ff03", 65519.99 to "ff7b", -2.5 to "00c1", 1.0009765625 to "013c", 1.00048828125 to "003c",
            1.00146484375 to "023c", 5.960464477539063e-08 to "0100", 2.9802322387695312e-08 to "0000",
        )
        for ((x, h) in cases) assertEquals(h, hex(Vectors.quantize(doubleArrayOf(x), "f16")), "f16($x)")
        assertFailsWith<SpdfException> { Vectors.quantize(doubleArrayOf(65520.0), "f16") }
        assertFailsWith<SpdfException> { Vectors.quantize(doubleArrayOf(1e39), "f32") }
        for (h in 0 until 0x7c00) assertEquals(h, Vectors.doubleToHalf(Vectors.halfToDouble(h)), "half $h")
    }

    @Test
    fun i8RoundsHalfAwayFromZeroAndClamps() {
        assertEquals("007f8140c0205f", hex(Vectors.quantize(doubleArrayOf(0.0, 1.0, -1.0, 0.5, -0.5, 0.25, 0.75), "i8")))
        assertEquals("7f810df3", hex(Vectors.quantize(doubleArrayOf(1.5, -2.0, 0.1, -0.1), "i8")))
        val back = Vectors.decode(Vectors.quantize(doubleArrayOf(1.0, -1.0), "i8"), "i8")
        assertEquals(listOf(1.0, -1.0), back.toList())
    }
}

class Ed25519Test {
    private fun bytes(h: String) = ByteArray(h.length / 2) { h.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

    // RFC 8032 §7.1, TEST 1 and TEST 2.
    private val pk1 = bytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
    private val sig1 = bytes("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
    private val pk2 = bytes("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
    private val sig2 = bytes("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")

    @Test
    fun providerAndPureAgree() {
        assertTrue(Ed25519.verify(pk1, ByteArray(0), sig1))
        assertTrue(Ed25519.Pure.verify(pk1, ByteArray(0), sig1))
        assertTrue(Ed25519.verify(pk2, byteArrayOf(0x72), sig2))
        assertTrue(Ed25519.Pure.verify(pk2, byteArrayOf(0x72), sig2))
        assertFalse(Ed25519.verify(pk1, byteArrayOf(1), sig1))
        assertFalse(Ed25519.Pure.verify(pk1, byteArrayOf(1), sig1))
        assertFalse(Ed25519.Pure.verify(pk2, byteArrayOf(0x72), sig1))
        assertFalse(Ed25519.verify(pk1, ByteArray(0), sig1.copyOf(63)))
    }
}

class AnchorAndCitationTest {
    private val sha = "sha256-" + "3f2a".repeat(16)

    @Test
    fun uriRoundTrip() {
        val a = Anchor.page(29, "21", source = "inferred").with("chars", listOf(118, 301))
        val uri = AnchorUri.format(sha, a)
        assertEquals("spdf:$sha#p=29&f=21&char=118,301", uri)
        val p = AnchorUri.parse(uri)
        assertEquals(29L, p.locator.p)
        assertEquals(uri, p.canonical())
        assertEquals("spdf:$sha#t=4160,4175.5", AnchorUri.format(sha, Anchor.time(4160.0, 4175.5)))
        assertEquals("spdf:doc%201#s=Cap%C3%ADtulo%203/3.2&para=4", AnchorUri.format("doc 1", Anchor.section(listOf("Capítulo 3", "3.2"), 4)))
        val r = Anchor.of(mapOf("type" to "image", "region" to mapOf("x" to 0.125, "y" to 0.2, "w" to 0.3, "h" to 0.1)))
        assertEquals("spdf:$sha#xywh=percent:12.5,20,30,10", AnchorUri.format(sha, r))
        for (bad in listOf("http://x", "spdf:", "spdf:x#p=0", "spdf:x#p=1&p=2", "spdf:x#char=5,1", "spdf:x#xywh=1,2,3,4", "spdf:%E9", "spdf:x#t=5,1")) {
            assertFailsWith<SpdfException>(bad) { AnchorUri.parse(bad) }
        }
        assertNull(AnchorUri.parse("spdf:x#zz=1&zz=2").locator.p) // unknown keys are ignored, even repeated
    }

    @Test
    fun citations() {
        val md = mapOf(
            "type" to "book", "title" to "Arte nuevo de hacer comedias",
            "author" to listOf(mapOf("family" to "Vega", "non-dropping-particle" to "de", "given" to "Lope")),
            "issued" to mapOf("date-parts" to listOf(listOf(1609))),
        )
        assertEquals("(de Vega, 1609, p. [21])", Citation.cite(Anchor.page(29, "21", "inferred"), null, md, "es"))
        assertEquals("(de Vega, 1609, n. pag.)", Citation.cite(Anchor.page(1, null), null, md, "en"))
        val two = md + ("author" to listOf(mapOf("family" to "Cervantes"), mapOf("family" to "Iglesias")))
        assertEquals("(Cervantes e Iglesias, 1609, 1:09:20)", Citation.cite(Anchor.time(4160.9, 4170.0), null, two, "es-ES"))
        val hierro = md + ("author" to listOf(mapOf("family" to "Cervantes"), mapOf("family" to "Hierro")))
        assertEquals("(Cervantes y Hierro, 1609, diap. 3)", Citation.cite(Anchor.slide(3), null, hierro, "es"))
        assertEquals("(Arte nuevo, s. f.)", Citation.cite(Anchor.of(mapOf("type" to "image")), null, mapOf("title" to "Arte nuevo: de hacer comedias"), "es"))
    }

    @Test
    fun lexicalCompilation() {
        assertEquals("\"lugar\" OR \"de\" OR \"la\" OR \"Mancha\"", LexicalQuery.compile("lugar, de la Mancha").match)
        assertEquals("\"lugar de la Mancha\"", LexicalQuery.compile("«lugar de la Mancha» hidalgo").match)
        assertEquals("\"Straße\" OR \"ﬁn\" OR \"STRASSE\"", LexicalQuery.compile("Straße ﬁn STRASSE").match)
        assertEquals("\"canción\"", LexicalQuery.compile("canción CANCION Canción").match)
        assertNull(LexicalQuery.compile("  ¿? ").match)
        assertTrue(LexicalQuery.compile("學而時習之").cjk)
        assertEquals(listOf("𠀀a"), LexicalQuery.compile("𠀀a").terms) // supplementary code points are letters too
    }
}

private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it.toInt() and 0xff) }

class PlatformTest {
    @Test
    fun base64IsStrictStandardBase64() {
        val rnd = java.util.Random(7)
        for (n in 0..40) {
            val b = ByteArray(n).also { rnd.nextBytes(it) }
            val s = java.util.Base64.getEncoder().encodeToString(b)
            assertEquals(s, base64Encode(b))
            assertTrue(b.contentEquals(base64Decode(s)))
        }
        for (bad in listOf("QQ", "QQ=", "Q===", "QQ==QQ==", "QQ!=", "QUJD\n", "=QUJ")) {
            assertFailsWith<IllegalArgumentException>(bad) { base64Decode(bad) }
        }
    }

    /** The core must run on Android API 23 (the minSdk of androidx.sqlite): no newer JDK APIs. */
    @Test
    fun coreAvoidsApisMissingOnAndroid23() {
        val root = java.io.File(SpdfFile::class.java.protectionDomain.codeSource.location.toURI())
        val forbidden = listOf(
            "java/nio/file/", "java/time/", "java/util/Base64", "java/util/stream/", "floorDiv", "floorMod",
            "java/util/Optional", "java/util/function/",
        )
        val classes = root.walkTopDown().filter { it.name.endsWith(".class") }.toList()
        assertTrue(classes.size > 20, "classes not found under $root")
        for (f in classes) {
            val text = String(f.readBytes(), Charsets.ISO_8859_1)
            for (api in forbidden) {
                if (api == "floorDiv" || api == "floorMod") {
                    // Kotlin's Long.floorDiv/mod compile to plain arithmetic; only java.lang.Math's are API 24.
                    if (text.contains("java/lang/Math") && text.contains(api)) throw AssertionError("${f.name} uses Math.$api")
                    continue
                }
                if (text.contains(api)) throw AssertionError("${f.name} references $api")
            }
        }
    }
}
