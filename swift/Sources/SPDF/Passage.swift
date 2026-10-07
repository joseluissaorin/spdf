import Foundation

/// The citation of a quotation (SPEC §18.2).
public struct PassageCitation: Sendable, Hashable {
    /// The short citation, e.g. "(Hooke, 1665, p. 211)".
    public var text: String
    /// The anchor URI of the quotation.
    public var uri: String
    public var anchor: Anchor
    /// Set only for a quotation spanning both units of a crossing fragment.
    public var anchorEnd: Anchor?
}

extension SPDFFile {
    /// Cites a quotation taken from a fragment by the unit it lies in, never by
    /// the start anchor of its fragment (SPEC §18.2): the start unit (with
    /// chars) if the quotation is in the fragment's part of it, the end unit if
    /// it is in the final part, or the range of both if it spans them.
    public func citePassage(fragment fragmentID: String, quote: String, locale: String) throws -> PassageCitation {
        try locked {
            guard let doc = try documentRow() else { throw SPDFError("E013", "no document") }
            let units = try tableView("units")
            guard let fr = try tableView("fragments").first(where: { $0["id"]?.stringValue == fragmentID }) else {
                throw SPDFError("W", "no fragment \(fragmentID)")
            }
            let unitAnchors = units.map { (id: $0["id"]?.stringValue ?? "", anchor: $0["anchor"] ?? .null) }
            var texts: [String: [Unicode.Scalar]] = [:]
            var anchors: [String: JSONValue] = [:]
            for u in units {
                let id = u["id"]?.stringValue ?? ""
                texts[id] = Array((u["text"]?.stringValue ?? "").unicodeScalars)
                anchors[id] = u["anchor"] ?? .null
            }
            let q = Array(quote.precomposedStringWithCanonicalMapping.unicodeScalars)
            func find(_ hay: ArraySlice<Unicode.Scalar>) -> Int? {
                guard q.count <= hay.count else { return nil }
                if q.isEmpty { return hay.startIndex }
                var i = hay.startIndex
                while i + q.count <= hay.endIndex {
                    if hay[i..<(i + q.count)].elementsEqual(q) { return i }
                    i += 1
                }
                return nil
            }
            func segment(_ text: [Unicode.Scalar], _ chars: (Int64, Int64)?) -> ArraySlice<Unicode.Scalar> {
                let lo = max(0, min(Int(chars?.0 ?? 0), text.count))
                let hi = max(lo, min(Int(chars?.1 ?? Int64(text.count)), text.count))
                return text[lo..<hi]
            }
            func strip(_ a: JSONValue) -> Anchor { Anchor(SPDFFile.identity(a)) ?? Anchor([:]) }
            let u1 = fr["unit"]?.stringValue ?? ""
            let seg1 = segment(texts[u1] ?? [], fr["anchor"].flatMap(Anchor.init)?.chars)
            let u2 = fr["anchor_end"].flatMap { SPDFFile.endUnit(unitAnchors, start: u1, anchorEnd: $0) }
            let seg2 = u2.map { segment(texts[$0.id] ?? [], fr["anchor_end"].flatMap(Anchor.init)?.chars) }
            var anchor: Anchor
            var end: Anchor?
            if let i = find(seg1) {
                anchor = strip(anchors[u1] ?? .null)
                anchor["chars"] = .array([.int(Int64(i)), .int(Int64(i + q.count))])
            } else if let u2, let seg2, let i = find(seg2) {
                anchor = strip(u2.anchor)
                anchor["chars"] = .array([.int(Int64(i)), .int(Int64(i + q.count))])
            } else if let u2, find(ArraySlice((fr["text"]?.stringValue ?? "").unicodeScalars)) != nil {
                anchor = strip(anchors[u1] ?? .null)
                end = strip(u2.anchor)
            } else {
                throw SPDFError("W", "the quote is not in fragment \(fragmentID)")
            }
            let md = doc["metadata"]?.objectValue ?? [:]
            let docref = "sha256-" + (doc["source_sha256"]?.stringValue ?? "")
            return PassageCitation(text: Citation.cite(anchor, end: end, metadata: md, locale: locale),
                                   uri: AnchorURI.format(docref: docref, anchor: anchor, end: end), anchor: anchor, anchorEnd: end)
        }
    }
}
