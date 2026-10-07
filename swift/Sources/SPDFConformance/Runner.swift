import Foundation
import SPDF

/// Runs the SPDF conformance suite (conformance/ in the repository) and
/// builds the report of contract §11.
public enum ConformanceRunner {
    public struct Failure: Sendable, Codable, Hashable {
        public var id: String
        public var reason: String
    }

    public struct Report: Sendable, Codable {
        public var impl: String
        public var version: String
        public var passed: [String]
        public var failed: [Failure]
        public var skipped: [Failure]

        public var json: String {
            JSONValue.object([
                "impl": .string(impl), "version": .string(version), "passed": .array(passed.map { .string($0) }),
                "failed": .array(failed.map { .object(["id": .string($0.id), "reason": .string($0.reason)]) }),
                "skipped": .array(skipped.map { .object(["id": .string($0.id), "reason": .string($0.reason)]) }),
            ]).compactJSON
        }
    }

    static let tolerance = 1e-6

    /// Runs every case of `dir/cases` (discovered by listing the folder).
    public static func run(directory dir: URL) throws -> Report {
        var report = Report(impl: SPDF.implementationName, version: SPDF.version, passed: [], failed: [], skipped: [])
        let casesDir = dir.appendingPathComponent("cases")
        let files = try FileManager.default.contentsOfDirectory(atPath: casesDir.path).filter { $0.hasSuffix(".json") }.sorted()
        guard !files.isEmpty else { throw SPDFError("W", "no cases in \(casesDir.path)") }
        for name in files {
            var id = String(name.dropLast(5))
            let reason: String?
            do {
                let c = try JSONValue.parse(data: try Data(contentsOf: casesDir.appendingPathComponent(name)))
                if let cid = c["id"]?.stringValue { id = cid }
                reason = try runCase(dir: dir, kind: c["kind"]?.stringValue ?? "", input: c["input"] ?? .null, expect: c["expect"] ?? .null)
            } catch {
                reason = "\(error)"
            }
            if let reason { report.failed.append(Failure(id: id, reason: reason)) } else { report.passed.append(id) }
        }
        return report
    }

    static func url(_ dir: URL, _ v: JSONValue?) -> URL { dir.appendingPathComponent(v?.stringValue ?? "") }

    static func compareDump(_ got: JSONValue, _ expectedPath: URL) throws -> String? {
        let want = try JSONValue.parse(data: try Data(contentsOf: expectedPath))
        let canon = try JSONValue.parse(got.canonicalJSON)
        return JSONValue.diff(canon, want).map { "dump differs at \($0)" }
    }

    /// Runs one case: nil when it passes, else the reason.
    public static func runCase(dir: URL, kind: String, input i: JSONValue, expect e: JSONValue) throws -> String? {
        switch kind {
        case "dump", "legacy_dump":
            let f = try SPDFFile.open(url(dir, i["file"]))
            defer { f.close() }
            if let d = try compareDump(try f.dump(), url(dir, e["dump"])) { return d }
            let h = try f.contentSHA256()
            return h == e["content_sha256"]?.stringValue ? nil : "content_sha256 \(h)"
        case "roundtrip":
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("spdf-rt-\(UUID().uuidString).spdf")
            defer { try? FileManager.default.removeItem(at: tmp) }
            try SPDFSource.write(try SPDFSource.read(url(dir, i["source"])), to: tmp)
            let f = try SPDFFile.open(tmp)
            defer { f.close() }
            return try compareDump(try f.dump(), url(dir, e["dump"]))
        case "validate":
            let r = SPDFValidator.validate(url(dir, i["file"]))
            let got: JSONValue = .object(["valid": .bool(r.valid), "version": r.version.map { .string($0) } ?? .null,
                                          "errors": .array(r.errorCodes.map { .string($0) }),
                                          "warnings": .array(r.warningCodes.map { .string($0) })])
            let sortedCodes: (JSONValue?) -> JSONValue = { v in
                .array(Array(Set((v?.arrayValue ?? []).compactMap(\.stringValue))).sorted().map { .string($0) })
            }
            let want: JSONValue = .object(["valid": e["valid"] ?? .null, "version": e["version"] ?? .null,
                                           "errors": sortedCodes(e["errors"]), "warnings": sortedCodes(e["warnings"])])
            return JSONValue.diff(got, want).map { "got \(got.compactJSON) (\($0))" }
        case "search_lexical", "search_vector", "search_hybrid":
            let f = try SPDFFile.open(url(dir, i["file"]))
            defer { f.close() }
            let limit = Int(i["limit"]?.intValue ?? 10)
            let hits: [SearchHit]
            switch kind {
            case "search_lexical":
                let query = i["query"]?.stringValue ?? ""
                let (route, match) = f.lexicalRoute(LexicalQuery(query), query: query)
                let gotMatch: JSONValue = match.map { .string($0) } ?? .null
                if route != e["route"]?.stringValue || !gotMatch.jsonEquals(e["match"] ?? .null) {
                    return "route/match \(route)/\(gotMatch.compactJSON)"
                }
                hits = try f.searchLexical(query, limit: limit)
            case "search_vector":
                hits = try f.searchVector(i["query_vector"]?.arrayValue?.compactMap(\.doubleValue) ?? [],
                                          space: i["space"]?.stringValue ?? "",
                                          target: VectorTarget(rawValue: i["target"]?.stringValue ?? "fragment") ?? .fragment, limit: limit)
            default:
                hits = try f.searchHybrid(i["query"]?.stringValue ?? "", vector: i["query_vector"]?.arrayValue?.compactMap(\.doubleValue),
                                          space: i["space"]?.stringValue, limit: limit)
            }
            let target = i["target"]?.stringValue ?? "fragment"
            let idKey = kind == "search_vector" && target != "fragment" ? target + "_id" : "fragment_id"
            return compare(hits, e["results"]?.arrayValue ?? [], withVia: kind != "search_vector", idKey: idKey)
        case "anchor_uri":
            if let anchorJSON = i["anchor"] {
                let docref = i["docref"]?.stringValue ?? ""
                guard let anchor = Anchor(anchorJSON) else { return "bad anchor" }
                let end = i["anchor_end"].flatMap(Anchor.init)
                let u = AnchorURI.format(docref: docref, anchor: anchor, end: end)
                if u != e["uri"]?.stringValue { return "format gives \(u)" }
                let p = try AnchorURI.parse(u)
                let got: JSONValue = .object(["docref": .string(p.docref), "locator": p.locator.jsonValue])
                let want: JSONValue = .object(["docref": .string(docref), "locator": e["locator"] ?? .null])
                if let d = JSONValue.diff(got, want) { return "parse differs at \(d)" }
                return p.description == u ? nil : "no round trip"
            }
            if e["error"]?.boolValue == true {
                return (try? AnchorURI.parse(i["uri"]?.stringValue ?? "")) == nil ? nil : "accepted an invalid URI"
            }
            let p = try AnchorURI.parse(i["uri"]?.stringValue ?? "")
            let got: JSONValue = .object(["docref": .string(p.docref), "locator": p.locator.jsonValue])
            let want: JSONValue = .object(["docref": e["docref"] ?? .null, "locator": e["locator"] ?? .null])
            if let d = JSONValue.diff(got, want) { return "parse differs at \(d)" }
            return p.description == e["canonical"]?.stringValue ? nil : "canonical form \(p.description)"
        case "cite":
            guard let anchor = (i["anchor"]).flatMap(Anchor.init) else { return "bad anchor" }
            let t = Citation.cite(anchor, end: i["anchor_end"].flatMap(Anchor.init), metadata: i["metadata"]?.objectValue ?? [:],
                                  locale: i["locale"]?.stringValue ?? "")
            return t == e["text"]?.stringValue ? nil : "got \(t)"
        case "locate":
            let f = try SPDFFile.open(url(dir, i["file"]))
            defer { f.close() }
            let got = try f.locate(i["reference"]?.stringValue ?? "").jsonValue
            return JSONValue.diff(got, e).map { "got \(got.compactJSON) (\($0))" }
        case "export_csl", "export_bibtex":
            var items: [[String: JSONValue]] = []
            for p in i["files"]?.arrayValue ?? [] {
                let f = try SPDFFile.open(url(dir, p))
                items.append(try f.metadata())
                f.close()
            }
            if kind == "export_csl" {
                let got = JSONValue.array(Bibliography.cslItems(items, anchor: i["anchor"].flatMap(Anchor.init),
                                                               end: i["anchor_end"].flatMap(Anchor.init)))
                return JSONValue.diff(got, e["items"] ?? .null).map { "items differ at \($0)" }
            }
            let got = normalizeBibTeX(Bibliography.bibtex(items: items))
            return got == normalizeBibTeX(e["text"]?.stringValue ?? "") ? nil : "got \(got.joined(separator: " | "))"
        case "cite_passage":
            let f = try SPDFFile.open(url(dir, i["file"]))
            defer { f.close() }
            let p = try f.citePassage(fragment: i["fragment"]?.stringValue ?? "", quote: i["quote"]?.stringValue ?? "",
                                      locale: i["locale"]?.stringValue ?? "")
            return p.text == e["text"]?.stringValue && p.uri == e["uri"]?.stringValue ? nil : "got \(p.text) \(p.uri)"
        case "export_structure":
            let f = try SPDFFile.open(url(dir, i["file"]))
            defer { f.close() }
            let got: JSONValue = .object(["pages": .array(try f.pageSequence(format: i["format"]?.stringValue ?? ""))])
            return JSONValue.diff(got, e).map { "pages differ at \($0)" }
        case "quantize":
            let got: JSONValue
            do {
                let data = try VectorCodec.encode(i["values"]?.arrayValue?.compactMap(\.doubleValue) ?? [], dtype: i["dtype"]?.stringValue ?? "")
                got = .object(["hex": .string(data.map { String(format: "%02x", $0) }.joined())])
            } catch {
                got = .object(["error": .bool(true)])
            }
            return got.jsonEquals(e) ? nil : "got \(got.compactJSON)"
        default:
            return "unknown kind \(kind)"
        }
    }

    static func normalizeBibTeX(_ t: String) -> [String] {
        t.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    static func compare(_ hits: [SearchHit], _ expected: [JSONValue], withVia: Bool, idKey: String) -> String? {
        let got = hits.map(\.id), want = expected.map { $0[idKey]?.stringValue ?? "" }
        if got != want { return "order \(got) != \(want)" }
        for (h, x) in zip(hits, expected) {
            if Swift.abs(h.score - (x["score"]?.doubleValue ?? .nan)) > tolerance { return "\(h.id): score \(h.score) != \(x["score"]?.compactJSON ?? "")" }
            if h.anchorURI != x["anchor_uri"]?.stringValue { return "\(h.id): anchor_uri \(h.anchorURI)" }
            if withVia, let via = x["via"], !JSONValue.array(h.via.map { .string($0) }).jsonEquals(via) { return "\(h.id): via \(h.via)" }
        }
        return nil
    }
}
