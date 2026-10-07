import Foundation

#if canImport(FoundationXML)
import FoundationXML
#endif

/// Structural exports (SPEC §19.4): ALTO 4, a minimal TEI and a IIIF
/// Presentation 3 manifest. They never invent data: no coordinates or
/// dimensions, no folio for an unnumbered page, inferred folios in brackets
/// (and absent from ALTO, which only records printed numbers).
extension SPDFFile {
    static func xml(_ s: String) -> String {
        var out = ""
        for c in s.unicodeScalars {
            switch c {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            default: out.unicodeScalars.append(c)
            }
        }
        return out
    }

    /// Paragraphs (separated by blank lines) of non-empty trimmed lines.
    static func paragraphs(_ text: String) -> [[String]] {
        let normalized = text.replacingOccurrences(of: #"\n\s*\n"#, with: "\u{0}", options: .regularExpression)
        return normalized.split(separator: "\u{0}", omittingEmptySubsequences: false).compactMap { p in
            let lines = p.split(separator: "\n", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            return lines.isEmpty ? nil : lines
        }
    }

    static let turnRe = try! NSRegularExpression(pattern: #"^\*\*([^*]+):\*\*\s*(.*)$"#, options: [.dotMatchesLineSeparators])

    /// The folio as cited, without label: "ii", "[iv]", "1r"; nil when unnumbered.
    static func folioN(_ a: Anchor) -> String? {
        guard let p = a.string("printed") else { return nil }
        return a.string("source") == "inferred" ? "[\(p)]" : p
    }

    /// ALTO 4: one Page per page unit (PHYSICAL_IMG_NR, and PRINTED_IMG_NR for
    /// read folios), one TextBlock per paragraph, one TextLine per line.
    public func exportALTO() throws -> String {
        let doc = try documentInfo()
        let units = try self.units()
        var out = [
            #"<?xml version="1.0" encoding="UTF-8"?>"#,
            #"<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.loc.gov/standards/alto/ns-v4# http://www.loc.gov/standards/alto/v4/alto-4-4.xsd" SCHEMAVERSION="4.4">"#,
            "  <Description>", "    <MeasurementUnit>pixel</MeasurementUnit>",
            "    <sourceImageInformation><fileName>\(SPDFFile.xml(doc["id"]?.stringValue ?? ""))</fileName></sourceImageInformation>",
            "  </Description>", "  <Layout>",
        ]
        var i = 0
        for u in units where u.anchor.type == "page" {
            i += 1
            var printed = ""
            if let p = u.anchor.string("printed"), u.anchor.string("source") != "inferred" {
                printed = " PRINTED_IMG_NR=\"\(SPDFFile.xml(p))\""
            }
            out.append("    <Page ID=\"P\(i)\" PHYSICAL_IMG_NR=\"\(u.anchor.int("physical") ?? 0)\"\(printed)>")
            out.append("      <PrintSpace ID=\"P\(i)_PS\">")
            for (b, lines) in SPDFFile.paragraphs(u.text).enumerated() {
                out.append("        <TextBlock ID=\"P\(i)_B\(b + 1)\">")
                for (l, line) in lines.enumerated() {
                    out.append("          <TextLine ID=\"P\(i)_B\(b + 1)_L\(l + 1)\"><String CONTENT=\"\(SPDFFile.xml(line))\"/></TextLine>")
                }
                out.append("        </TextBlock>")
            }
            out.append("      </PrintSpace>")
            out.append("    </Page>")
        }
        out.append("  </Layout>")
        out.append("</alto>")
        return out.joined(separator: "\n") + "\n"
    }

    static func names(_ v: JSONValue?) -> [String] {
        (v?.arrayValue ?? []).compactMap { n in
            if let lit = n["literal"]?.stringValue, !lit.isEmpty { return lit }
            let parts = ["given", "non-dropping-particle", "family"].compactMap { n[$0]?.stringValue }.filter { !$0.isEmpty }
            return parts.isEmpty ? nil : parts.joined(separator: " ")
        }
    }

    /// A minimal TEI: header from the metadata, `<pb n facs>` before each
    /// page, paragraphs, verse (`<lg>`/`<l n>`), speaker turns (`<u who>`)
    /// and notes (`<note place="foot">`).
    public func exportTEI() throws -> String {
        let doc = try documentInfo()
        let md = doc["metadata"]?.objectValue ?? [:]
        let title = SPDFFile.xml(md["title"]?.stringValue ?? "")
        var out = [#"<?xml version="1.0" encoding="UTF-8"?>"#]
        if let lang = doc["language"]?.stringValue, !lang.isEmpty {
            out.append("<TEI xmlns=\"http://www.tei-c.org/ns/1.0\" xml:lang=\"\(SPDFFile.xml(lang))\">")
        } else {
            out.append("<TEI xmlns=\"http://www.tei-c.org/ns/1.0\">")
        }
        out += ["  <teiHeader>", "    <fileDesc>", "      <titleStmt>", "        <title>\(title)</title>"]
        out += SPDFFile.names(md["author"]).map { "        <author>\(SPDFFile.xml($0))</author>" }
        out += SPDFFile.names(md["editor"]).map { "        <editor>\(SPDFFile.xml($0))</editor>" }
        out += ["      </titleStmt>", "      <publicationStmt>"]
        let r = doc["rights"]?.objectValue ?? [:]
        let lic = r["license"]?.stringValue ?? "", holder = r["holder"]?.stringValue ?? "", note = r["note"]?.stringValue ?? ""
        if !lic.isEmpty || !holder.isEmpty || !note.isEmpty {
            out.append("        <availability>")
            if !lic.isEmpty { out.append("          <licence target=\"\(SPDFFile.xml(lic))\"/>") }
            if !holder.isEmpty { out.append("          <p>\(SPDFFile.xml(holder))</p>") }
            if !note.isEmpty { out.append("          <p>\(SPDFFile.xml(note))</p>") }
            out.append("        </availability>")
        } else {
            out.append("        <p>Unknown</p>")
        }
        out += ["      </publicationStmt>", "      <sourceDesc>", "        <biblStruct>", "          <monogr>"]
        out += SPDFFile.names(md["author"]).map { "            <author>\(SPDFFile.xml($0))</author>" }
        out.append("            <title>\(title)</title>")
        var imprint = ""
        if let p = md["publisher-place"]?.stringValue, !p.isEmpty { imprint += "<pubPlace>\(SPDFFile.xml(p))</pubPlace>" }
        if let p = md["publisher"]?.stringValue, !p.isEmpty { imprint += "<publisher>\(SPDFFile.xml(p))</publisher>" }
        if let y = Bibliography.year(md) { imprint += "<date when=\"\(y)\">\(y)</date>" }
        out.append("            <imprint>\(imprint)</imprint>")
        out += ["          </monogr>", "        </biblStruct>", "      </sourceDesc>", "    </fileDesc>", "  </teiHeader>", "  <text>", "    <body>"]
        for u in try units() {
            let a = u.anchor
            if a.type == "page" {
                var pb = "      <pb"
                if let n = SPDFFile.folioN(a) { pb += " n=\"\(SPDFFile.xml(n))\"" }
                if let img = u.image { pb += " facs=\"\(SPDFFile.xml(img))\"" }
                out.append(pb + "/>")
            }
            if a.type == "verse" {
                var n = a.int("line_from") ?? 1
                out.append("      <lg>")
                for l in u.text.split(separator: "\n", omittingEmptySubsequences: false) {
                    let t = l.trimmingCharacters(in: .whitespacesAndNewlines)
                    if t.isEmpty { continue }
                    out.append("        <l n=\"\(n)\">\(SPDFFile.xml(t))</l>")
                    n += 1
                }
                out.append("      </lg>")
            } else {
                for lines in SPDFFile.paragraphs(u.text) {
                    let text = lines.joined(separator: " ")
                    let ns = text as NSString
                    if let m = SPDFFile.turnRe.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) {
                        let who = ns.substring(with: m.range(at: 1)), rest = ns.substring(with: m.range(at: 2))
                        out.append("      <u who=\"\(SPDFFile.xml(who))\">\(SPDFFile.xml(rest))</u>")
                    } else if a.type == "time", let speaker = a.string("speaker") {
                        out.append("      <u who=\"\(SPDFFile.xml(speaker))\">\(SPDFFile.xml(text))</u>")
                    } else {
                        out.append("      <p>\(SPDFFile.xml(text))</p>")
                    }
                }
            }
            for n in u.notes ?? [] { out.append("      <note place=\"foot\">\(SPDFFile.xml(n))</note>") }
        }
        out += ["    </body>", "  </text>", "</TEI>"]
        return out.joined(separator: "\n") + "\n"
    }

    /// IIIF Presentation 3: one canvas per unit (label = the folio of page
    /// units; unnumbered pages have none), the unit image as painting
    /// annotation, the text as supplementing annotation; audio and video as
    /// one time-based canvas with a range per unit. `base` prefixes the ids
    /// (default `spdf:<docref>`).
    public func exportIIIF(base: String? = nil) throws -> JSONValue {
        let doc = try documentInfo()
        let units = try self.units()
        let base = base ?? "spdf:" + locked { docRef() }
        let md = doc["metadata"]?.objectValue ?? [:]
        let lang = doc["language"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? "none"
        let title = md["title"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? (doc["id"]?.stringValue ?? "")
        var manifest: [String: JSONValue] = [
            "@context": "http://iiif.io/api/presentation/3/context.json", "id": .string(base + "/manifest"),
            "type": "Manifest", "label": .object([lang: .array([.string(title)])]),
        ]
        func text(_ id: String, _ target: String, _ value: String) -> JSONValue {
            .object(["id": .string(id), "type": "Annotation", "motivation": "supplementing", "target": .string(target),
                     "body": .object(["type": "TextualBody", "value": .string(value), "format": "text/plain"])])
        }
        if !units.isEmpty && units.allSatisfy({ $0.anchor.type == "time" }) {
            let canvas = base + "/canvas/1"
            let duration = doc["duration"].flatMap { $0.isNull ? nil : $0 } ?? (units.last?.anchor["t1"] ?? .int(0))
            var media: [JSONValue] = []
            if let ref = doc["source_ref"]?.stringValue, !ref.isEmpty {
                media.append(.object(["id": .string(canvas + "/media"), "type": "Annotation", "motivation": "painting", "target": .string(canvas),
                                      "body": .object(["id": .string(ref), "type": .string(doc["kind"]?.stringValue == "video" ? "Video" : "Sound"),
                                                       "format": doc["mime"] ?? .null])]))
            }
            var texts: [JSONValue] = []
            var ranges: [JSONValue] = []
            for (i, u) in units.enumerated() {
                let f = "\(canvas)#t=\(SPDFNumber.format(SPDFNumber.round6(u.anchor.number("t0") ?? 0))),\(SPDFNumber.format(SPDFNumber.round6(u.anchor.number("t1") ?? 0)))"
                texts.append(text("\(canvas)/text/\(i + 1)", f, u.text))
                ranges.append(.object(["id": .string("\(base)/range/\(i + 1)"), "type": "Range", "items": .array([.object(["id": .string(f), "type": "Canvas"])])]))
            }
            manifest["items"] = .array([.object([
                "id": .string(canvas), "type": "Canvas", "duration": duration,
                "items": .array([.object(["id": .string(canvas + "/page"), "type": "AnnotationPage", "items": .array(media)])]),
                "annotations": .array([.object(["id": .string(canvas + "/text"), "type": "AnnotationPage", "items": .array(texts)])]),
            ])])
            manifest["structures"] = .array(ranges)
            return .object(manifest)
        }
        var index: [String: Int] = [:]
        var items: [JSONValue] = []
        for (i, u) in units.enumerated() {
            index[u.id] = i + 1
            let canvas = "\(base)/canvas/\(i + 1)"
            var c: [String: JSONValue] = ["id": .string(canvas), "type": "Canvas"]
            if u.anchor.type == "page" {
                if let n = SPDFFile.folioN(u.anchor) { c["label"] = .object(["none": .array([.string(n)])]) }
            } else if u.anchor.type == "slide", let n = u.anchor.int("n") {
                c["label"] = .object(["none": .array([.string(String(n))])])
            } else {
                c["label"] = .object(["none": .array([.string(String(u.ord ?? Int64(i + 1)))])])
            }
            if let img = u.image {
                c["items"] = .array([.object(["id": .string(canvas + "/page"), "type": "AnnotationPage", "items": .array([
                    .object(["id": .string(canvas + "/image"), "type": "Annotation", "motivation": "painting", "target": .string(canvas),
                             "body": .object(["id": .string(img), "type": "Image"])]),
                ])])])
            } else {
                c["items"] = .array([])
            }
            if !u.text.isEmpty {
                c["annotations"] = .array([.object(["id": .string(canvas + "/text"), "type": "AnnotationPage",
                                                    "items": .array([text(canvas + "/text/1", canvas, u.text)])])])
            }
            items.append(.object(c))
        }
        manifest["items"] = .array(items)
        let sections = try self.sections()
        if !sections.isEmpty {
            manifest["structures"] = .array(sections.map { s in
                let from = index[s.unitFrom] ?? 1
                let to = s.unitTo.flatMap { index[$0] } ?? from
                let its: [JSONValue] = from <= to ? (from...to).map { .object(["id": .string("\(base)/canvas/\($0)"), "type": "Canvas"]) } : []
                return .object(["id": .string("\(base)/range/\(s.id)"), "type": "Range", "label": .object(["none": .array([.string(s.title)])]),
                                "items": .array(its)])
            })
        }
        return .object(manifest)
    }

    /// Reads back the page sequence of the ALTO, TEI or IIIF export of this
    /// file (what the conformance suite compares, SPEC §19.4), parsing the
    /// exported documents themselves.
    public func pageSequence(format: String) throws -> [JSONValue] {
        switch format {
        case "alto", "tei":
            let text = format == "alto" ? try exportALTO() : try exportTEI()
            let collector = PageCollector(format: format)
            let parser = XMLParser(data: Data(text.utf8))
            parser.delegate = collector
            guard parser.parse() else {
                throw SPDFError("W", "the \(format) export is not well-formed XML: \(parser.parserError.map { "\($0)" } ?? "")")
            }
            return collector.pages
        case "iiif":
            let manifest = try JSONValue.parse(try exportIIIF().compactJSON)
            let units = try self.units()
            var out: [JSONValue] = []
            for (i, c) in (manifest["items"]?.arrayValue ?? []).enumerated() where i < units.count && units[i].anchor.type == "page" {
                out.append(.object(["label": c["label"]?["none"]?[0] ?? .null]))
            }
            return out
        default:
            throw SPDFError("W", "unknown structure format \(format)")
        }
    }
}

private final class PageCollector: NSObject, XMLParserDelegate {
    let format: String
    var pages: [JSONValue] = []

    init(format: String) { self.format = format }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?,
                attributes: [String: String] = [:])
    {
        if format == "alto" && name == "Page" {
            pages.append(.object(["physical": .int(Int64(attributes["PHYSICAL_IMG_NR"] ?? "") ?? 0),
                                  "printed": attributes["PRINTED_IMG_NR"].map { .string($0) } ?? .null]))
        } else if format == "tei" && name == "pb" {
            pages.append(.object(["n": attributes["n"].map { .string($0) } ?? .null]))
        }
    }
}
