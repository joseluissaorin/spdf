import Foundation
import SPDF
import SPDFConformance
import XCTest

final class SPDFTests: XCTestCase {
    static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    static var conformance: URL {
        if let d = ProcessInfo.processInfo.environment["SPDF_CONFORMANCE_DIR"] { return URL(fileURLWithPath: d) }
        return repo.appendingPathComponent("conformance")
    }

    func tmp(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("spdf-test-\(UUID().uuidString)-\(name)")
    }

    /// The SQLite of this platform has FTS5 with unicode61 remove_diacritics 2 and trigram.
    func testSQLiteHasFTS5() throws {
        let url = tmp("fts.spdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let w = try SPDFWriter(url: url, options: .init(trigram: true))
        try w.setDocument(SPDFDocumentInfo(id: "d", kind: "document", metadata: ["type": "book", "title": "Prueba"],
                                           sourceSHA256: String(repeating: "ab", count: 32), mime: "text/plain", bytes: 1))
        try w.add(SPDFUnit(id: "u1", anchor: Anchor(["type": "section", "path": ["Uno"], "paragraph": 1]), text: "Canción de otoño", reader: "test"))
        try w.add(SPDFFragment(id: "f1", unit: "u1", text: "Canción de otoño en primavera",
                               anchor: Anchor(["type": "section", "path": ["Uno"], "paragraph": 1])))
        try w.add(SPDFFragment(id: "f2", unit: "u1", text: "學而時習之，不亦說乎",
                               anchor: Anchor(["type": "canonical", "scheme": "lunyu", "ref": "1.1"])))
        try w.finish()
        let f = try SPDFFile.open(url)
        defer { f.close() }
        XCTAssertEqual(try f.searchLexical("CANCION").map(\.id), ["f1"])
        XCTAssertEqual(try f.searchLexical("時習之").map(\.id), ["f2"])
        XCTAssertEqual(f.lexicalRoute(LexicalQuery("時習之"), query: "時習之").route, "trigram")
        let v = SPDFValidator.validate(url)
        XCTAssertTrue(v.valid, "\(v.errors)")
    }

    func testWriteReadSearchCite() throws {
        let url = tmp("sample.spdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let w = try SPDFWriter(url: url, options: .init(generator: "test/1"))
        try w.setDocument(SPDFDocumentInfo(
            id: "doc1", kind: "pdf",
            metadata: ["type": "book", "title": "Don Quijote", "author": [["family": "Cervantes", "given": "Miguel de"]],
                       "issued": ["date-parts": [[1605]]]],
            sourceSHA256: String(repeating: "AB", count: 32), mime: "application/pdf", bytes: 10, created: "2026-10-07T00:00:00Z"))
        let page1 = Anchor(["type": "page", "physical": 1, "printed": "1", "source": "read"])
        let page2 = Anchor(["type": "page", "physical": 2, "printed": .null])
        try w.add(SPDFUnit(id: "u1", anchor: page1, text: "En un lugar de la Mancha", reader: "test"))
        try w.add(SPDFUnit(id: "u2", anchor: page2, text: "Canción del caballero", reader: "test"))
        try w.add(SPDFFragment(id: "f1", unit: "u1", text: "En un lugar de la Mancha", anchor: page1))
        try w.add(SPDFFragment(id: "f2", unit: "u2", text: "Canción del caballero", anchor: page2))
        try w.add(VectorSpace(id: "toy@3", provider: "test", model: "toy", dims: 3, dtype: "f16"))
        try w.addVector(target: .fragment, id: "f1", space: "toy@3", values: [1, 0, 0])
        try w.addVector(target: .fragment, id: "f2", space: "toy@3", values: [0, 1, 0])
        try w.addBlob(key: "img", mime: "image/png", data: Data([1, 2, 3]))
        try w.add(SPDFProvenance(stage: "read", detail: ["pages": 2], at: "2026-10-07T00:00:00Z"))
        try w.finish()

        let v = SPDFValidator.validate(url)
        XCTAssertTrue(v.valid, "\(v.errors)")
        XCTAssertEqual(v.profile, ["core", "semantic"])
        let f = try SPDFFile.open(url)
        defer { f.close() }
        let hits = try f.searchLexical("cancion")
        XCTAssertEqual(hits.map(\.id), ["f2"])
        XCTAssertTrue(hits[0].anchorURI.hasPrefix("spdf:sha256-abab"))
        XCTAssertTrue(hits[0].anchorURI.hasSuffix("#p=2"))
        XCTAssertEqual(try f.cite(hits[0].anchor!, locale: "es"), "(Cervantes, 1605, s. p.)")
        XCTAssertEqual(try f.searchVector([0.9, 0.1, 0], space: "toy@3").map(\.id), ["f1", "f2"])
        XCTAssertEqual(try f.searchHybrid("caballero", vector: [1, 0, 0], space: "toy@3").count, 2)
        XCTAssertTrue(try f.exportBibTeX().hasPrefix("@book{cervantes1605,"))
        XCTAssertEqual(try f.blob("blob:img").data, Data([1, 2, 3]))
        XCTAssertEqual(try f.units().count, 2)
    }

    func testAsyncAPI() async throws {
        let url = SPDFTests.conformance.appendingPathComponent("files/quijote.spdf")
        let f = try await SPDFFile.open(url)
        defer { f.close() }
        let hits = try await f.searchLexical("Mancha", limit: 3)
        XCTAssertFalse(hits.isEmpty)
        let r = await SPDFValidator.validate(url)
        XCTAssertTrue(r.valid)
    }

    func testRejectsTriggers() throws {
        XCTAssertThrowsError(try SPDFFile.open(SPDFTests.conformance.appendingPathComponent("invalid/E020-trigger.spdf"))) { e in
            XCTAssertEqual((e as? SPDFError)?.code, "E020")
        }
    }

    func testCanonicalJSON() throws {
        let v = try JSONValue.parse(#"{"b":1.0,"a":[0.1234567,1e-7,-0.0,1e21,"é "],"c":null}"#)
        XCTAssertEqual(v.canonicalJSON, "{\"a\":[0.123457,0,0,1e+21,\"é\u{2028}\"],\"b\":1,\"c\":null}")
        XCTAssertEqual(SPDFNumber.format(4175.5), "4175.5")
        XCTAssertEqual(SPDFNumber.format(1e-7), "1e-7")
        XCTAssertEqual(SPDFNumber.format(123456789012345680000), "123456789012345680000")
        XCTAssertEqual(SPDFNumber.round6(0.0078125), 0.007812)
    }

    func testURIRoundTrip() throws {
        let a = Anchor(["type": "section", "path": ["Capítulo 3", "3.2 El panóptico/torre"], "paragraph": 4, "printed": "145",
                        "chars": [118, 301], "region": ["x": 0.125, "y": 0.2, "w": 0.3, "h": 0.1]])
        let uri = AnchorURI.format(docref: "doc 1", anchor: a)
        XCTAssertEqual(uri, "spdf:doc%201#f=145&s=Cap%C3%ADtulo%203/3.2%20El%20pan%C3%B3ptico%2Ftorre&para=4&char=118,301&xywh=percent:12.5,20,30,10")
        let p = try AnchorURI.parse(uri)
        XCTAssertEqual(p.docref, "doc 1")
        XCTAssertEqual(p.description, uri)
        XCTAssertThrowsError(try AnchorURI.parse("spdf:x#p=0"))
    }

    func testWriterSealsAndSigns() throws {
        let url = ProcessInfo.processInfo.environment["SPDF_SIGNED_OUT"].map { URL(fileURLWithPath: $0) } ?? tmp("signed.spdf")
        let w = try SPDFWriter(url: url, options: .init(generator: "test/1", signingKey: Data((32..<64).map { UInt8($0) })))
        try w.setDocument(SPDFDocumentInfo(id: "rimas", kind: "document",
                                           metadata: ["type": "book", "title": "Rimas", "author": [["family": "Bécquer", "given": "Gustavo Adolfo"]]],
                                           sourceSHA256: String(repeating: "cd", count: 32), mime: "text/plain", bytes: 64,
                                           created: "2026-10-07T00:00:00Z"))
        let a = Anchor(["type": "verse", "line_from": 1, "line_to": 2])
        try w.add(SPDFUnit(id: "u1", anchor: a, text: "Volverán las oscuras golondrinas\nen tu balcón sus nidos a colgar,", reader: "manual"))
        try w.add(SPDFFragment(id: "f1", unit: "u1", text: "Volverán las oscuras golondrinas en tu balcón sus nidos a colgar,", anchor: a))
        try w.finish()
        let r = SPDFValidator.validate(url)
        XCTAssertTrue(r.valid, "\(r.errors)")
        let f = try SPDFFile.open(url)
        defer { f.close() }
        let meta = try f.meta()
        XCTAssertEqual(meta["content_sha256"], try f.contentSHA256())
        XCTAssertTrue(meta["signer"]?.hasPrefix("ed25519:") == true)
        XCTAssertNotNil(meta["signature"])
    }

    /// The whole conformance suite: every case must pass.
    func testConformanceSuite() throws {
        let report = try ConformanceRunner.run(directory: SPDFTests.conformance)
        if let out = ProcessInfo.processInfo.environment["SPDF_CONFORMANCE_OUT"] {
            try Data((report.json + "\n").utf8).write(to: URL(fileURLWithPath: out))
        }
        for f in report.failed { XCTFail("\(f.id): \(f.reason)") }
        XCTAssertGreaterThanOrEqual(report.passed.count, 341)
    }
}
