import Foundation

/// A "source" is a full dump (contract §11): the canonical dump plus vector
/// values (`vectors.<space>.items = [{target, id, values}]`) and blob bytes
/// (`blobs[].data_base64`). `SPDFSource.write` rebuilds the SPDF 5.0 file.
public enum SPDFSource {
    /// Reads a source JSON file.
    public static func read(_ url: URL) throws -> JSONValue {
        try JSONValue.parse(data: try Data(contentsOf: url))
    }

    /// Encodes source vector values: f32/f16 must be exactly representable,
    /// i8 values are the stored integers (−127…127).
    public static func pack(_ values: [JSONValue], dtype: String) throws -> Data {
        if dtype == "i8" {
            var out = Data()
            for v in values {
                guard case .int(let n) = v, (-127...127).contains(n) else {
                    throw SPDFError("E030", "i8 values are integers in [-127, 127], got \(v.canonicalJSON)")
                }
                out.append(UInt8(bitPattern: Int8(n)))
            }
            return out
        }
        let doubles = try values.map { v -> Double in
            guard let d = v.doubleValue else { throw SPDFError("E030", "vector value \(v.canonicalJSON) is not a number") }
            return d
        }
        let data = try VectorCodec.encode(doubles, dtype: dtype)
        let back = try VectorCodec.decode(data, dtype: dtype)
        for (a, b) in zip(back, doubles) where a != b && !b.isNaN {
            throw SPDFError("E030", "\(dtype) value \(b) is not exactly representable")
        }
        return data
    }

    /// Builds an SPDF 5.0 file at `url` from a source.
    public static func write(_ source: JSONValue, to url: URL) throws {
        let trigram = source["fts"]?["trigram"]?.boolValue ?? false
        let w = try SPDFWriter(url: url, options: .init(trigram: trigram, exact: true))
        do {
            for (k, v) in source["meta"]?.objectValue ?? [:] { w.setMeta(k, v.stringValue ?? "") }
            guard let doc = source["document"]?.objectValue else { throw SPDFError("W", "source without document") }
            try w.setDocument(SPDFDocumentInfo(
                id: doc["id"]?.stringValue ?? "", kind: doc["kind"]?.stringValue ?? "",
                metadata: doc["metadata"]?.objectValue ?? [:], sourceSHA256: doc["source_sha256"]?.stringValue ?? "",
                sourceRef: doc["source_ref"]?.stringValue, mime: doc["mime"]?.stringValue ?? "",
                bytes: doc["bytes"]?.intValue ?? 0, unitCount: doc["unit_count"]?.intValue ?? 0,
                duration: doc["duration"]?.doubleValue, created: doc["created"]?.stringValue ?? "",
                updated: doc["updated"]?.stringValue ?? "", title: doc["title"]?.stringValue,
                authors: doc["authors"]?.stringValue, year: doc["year"]?.intValue, language: doc["language"]?.stringValue,
                rights: doc["rights"]?.objectValue))
            for u in source["units"]?.arrayValue ?? [] {
                guard let anchor = u["anchor"].flatMap(Anchor.init) else { throw SPDFError("E040", "unit without anchor") }
                try w.add(SPDFUnit(
                    id: u["id"]?.stringValue ?? "", ord: u["ord"]?.intValue ?? 0, anchor: anchor, text: u["text"]?.stringValue ?? "",
                    notes: u["notes"]?.arrayValue?.map { $0.stringValue ?? "" }, header: u["header"]?.stringValue,
                    footer: u["footer"]?.stringValue, image: u["image"]?.stringValue, thumbnail: u["thumbnail"]?.stringValue,
                    reader: u["reader"]?.stringValue ?? "", confidence: u["confidence"]?.doubleValue ?? 1,
                    printed: u["printed"]?.stringValue, t0: u["t0"]?.doubleValue, t1: u["t1"]?.doubleValue,
                    words: u["words"].flatMap { $0.isNull ? nil : $0 }))
            }
            for s in source["sections"]?.arrayValue ?? [] {
                try w.add(SPDFSection(id: s["id"]?.stringValue ?? "", parent: s["parent"]?.stringValue, level: s["level"]?.intValue ?? 0,
                                      title: s["title"]?.stringValue ?? "", unitFrom: s["unit_from"]?.stringValue ?? "",
                                      unitTo: s["unit_to"]?.stringValue, summary: s["summary"]?.stringValue))
            }
            for f in source["fragments"]?.arrayValue ?? [] {
                guard let anchor = f["anchor"].flatMap(Anchor.init) else { throw SPDFError("E040", "fragment without anchor") }
                try w.add(SPDFFragment(
                    n: f["n"]?.intValue ?? 0, id: f["id"]?.stringValue ?? "", unit: f["unit"]?.stringValue ?? "",
                    ord: f["ord"]?.intValue ?? 0, text: f["text"]?.stringValue ?? "", context: f["context"]?.stringValue ?? "",
                    section: f["section"]?.arrayValue?.map { $0.stringValue ?? "" }, anchor: anchor,
                    anchorEnd: f["anchor_end"].flatMap(Anchor.init), searchText: f["search_text"]?.stringValue))
            }
            for g in source["figures"]?.arrayValue ?? [] {
                guard let anchor = g["anchor"].flatMap(Anchor.init) else { throw SPDFError("E040", "figure without anchor") }
                try w.add(SPDFFigure(id: g["id"]?.stringValue ?? "", unit: g["unit"]?.stringValue ?? "", image: g["image"]?.stringValue ?? "",
                                     caption: g["caption"]?.stringValue, description: g["description"]?.stringValue, anchor: anchor))
            }
            var dtypes: [String: String] = [:]
            for s in source["spaces"]?.arrayValue ?? [] {
                let sp = VectorSpace(id: s["id"]?.stringValue ?? "", provider: s["provider"]?.stringValue ?? "",
                                     model: s["model"]?.stringValue ?? "", version: s["version"]?.stringValue,
                                     dims: s["dims"]?.intValue ?? 0, dtype: s["dtype"]?.stringValue ?? "f32",
                                     normalized: (s["normalized"]?.intValue ?? 1) != 0, truncatedFrom: s["truncated_from"]?.intValue,
                                     modalities: [], taskPrefixes: s["task_prefixes"]?.objectValue, created: s["created"]?.stringValue)
                dtypes[sp.id] = sp.dtype
                try w.add(sp, modalitiesJSON: s["modalities"] ?? .array([]))
            }
            let vectors = source["vectors"]?.objectValue ?? [:]
            for space in vectors.keys.sorted() {
                for it in vectors[space]?["items"]?.arrayValue ?? [] {
                    let data = try pack(it["values"]?.arrayValue ?? [], dtype: dtypes[space] ?? "f32")
                    guard let target = VectorTarget(rawValue: it["target"]?.stringValue ?? "") else {
                        throw SPDFError("W", "unknown vector target")
                    }
                    try w.addVector(target: target, id: it["id"]?.stringValue ?? "", space: space, data: data)
                }
            }
            for b in source["blobs"]?.arrayValue ?? [] {
                guard let data = Data(base64Encoded: b["data_base64"]?.stringValue ?? "") else {
                    throw SPDFError("E080", "blob \(b["key"]?.stringValue ?? "") is not base64")
                }
                try w.addBlob(key: b["key"]?.stringValue ?? "", mime: b["mime"]?.stringValue ?? "", data: data)
            }
            for p in source["provenance"]?.arrayValue ?? [] {
                try w.add(SPDFProvenance(stage: p["stage"]?.stringValue ?? "", provider: p["provider"]?.stringValue,
                                         model: p["model"]?.stringValue, detail: p["detail"].flatMap { $0.isNull ? nil : $0 },
                                         ms: p["ms"]?.intValue, at: p["at"]?.stringValue ?? ""))
            }
            for e in source["extensions"]?.arrayValue ?? [] {
                try w.addExtension(name: e["name"]?.stringValue ?? "", version: e["version"]?.stringValue ?? "",
                                   required: (e["required"]?.intValue ?? 0) != 0)
            }
            try w.finish()
        } catch {
            w.abort()
            throw error
        }
    }
}
