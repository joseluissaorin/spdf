import Foundation
import SPDF
import SPDFConformance

// spdf-swift: command-line interface of the Swift implementation of SPDF.

func usage() -> Never {
    FileHandle.standardError.write(Data("""
        usage:
          spdf-swift validate FILE
          spdf-swift dump FILE
          spdf-swift search FILE QUERY [-n N]
          spdf-swift cite FILE FRAGMENT_ID [-locale es|en]
          spdf-swift export FILE csl|bibtex|alto|tei|iiif
          spdf-swift uri parse URI
          spdf-swift build SOURCE.json OUT.spdf
          spdf-swift seal FILE [-key SEED]
          spdf-swift conformance [DIR] [-o conformance.json]
          spdf-swift version

        """.utf8))
    exit(2)
}

func die(_ e: Error) -> Never {
    FileHandle.standardError.write(Data("spdf-swift: \(e)\n".utf8))
    exit(1)
}

func say(_ s: String) { FileHandle.standardOutput.write(Data((s + "\n").utf8)) }

func hexBytes(_ s: String) -> Data? {
    var out = Data()
    var it = s.makeIterator()
    while let a = it.next(), let b = it.next() {
        guard let v = UInt8(String([a, b]), radix: 16) else { return nil }
        out.append(v)
    }
    return out
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

@main
struct SPDFCommand {
    static func main() {
        var args = Array(CommandLine.arguments.dropFirst())
        guard !args.isEmpty else { usage() }
        let cmd = args.removeFirst()
        var limit = 10
        var locale = "es"
        var output: String?
        var keyFile: String?
        var pos: [String] = []
        var i = 0
        while i < args.count {
            switch args[i] {
            case "-n": i += 1; limit = Int(args[safe: i] ?? "") ?? 10
            case "-locale": i += 1; locale = args[safe: i] ?? "es"
            case "-o": i += 1; output = args[safe: i]
            case "-key": i += 1; keyFile = args[safe: i]
            default: pos.append(args[i])
            }
            i += 1
        }

        func need(_ n: Int) { if pos.count < n { usage() } }
        do {
            switch cmd {
            case "version":
                say("\(SPDF.implementationName) \(SPDF.version) (SPDF \(SPDF.formatVersion))")
            case "validate":
                need(1)
                let r = SPDFValidator.validate(URL(fileURLWithPath: pos[0]))
                say(r.jsonValue.canonicalJSON)
                if !r.valid { exit(1) }
            case "dump":
                need(1)
                let f = try SPDFFile.open(URL(fileURLWithPath: pos[0]))
                say(try f.dumpJSON())
            case "search":
                need(2)
                let f = try SPDFFile.open(URL(fileURLWithPath: pos[0]))
                let hits: [SearchHit] = try f.searchLexical(pos[1...].joined(separator: " "), limit: limit)
                say(JSONValue.array(hits.map(\.jsonValue)).canonicalJSON)
            case "cite":
                need(2)
                let f = try SPDFFile.open(URL(fileURLWithPath: pos[0]))
                let (a, e) = try f.fragmentAnchors(pos[1])
                say(try f.cite(a, end: e, locale: locale))
            case "export":
                need(2)
                let f = try SPDFFile.open(URL(fileURLWithPath: pos[0]))
                switch pos[1] {
                case "csl": say(try f.exportCSL())
                case "bibtex": FileHandle.standardOutput.write(Data(try f.exportBibTeX().utf8))
                case "alto": FileHandle.standardOutput.write(Data(try f.exportALTO().utf8))
                case "tei": FileHandle.standardOutput.write(Data(try f.exportTEI().utf8))
                case "iiif": say(try f.exportIIIF().canonicalJSON)
                default: usage()
                }
            case "uri":
                need(2)
                guard pos[0] == "parse" else { usage() }
                let p = try AnchorURI.parse(pos[1])
                say(JSONValue.object(["docref": .string(p.docref), "locator": p.locator.jsonValue, "canonical": .string(p.description)]).canonicalJSON)
            case "build":
                need(2)
                try SPDFSource.write(try SPDFSource.read(URL(fileURLWithPath: pos[0])), to: URL(fileURLWithPath: pos[1]))
            case "seal":
                need(1)
                var seed: Data?
                if let k = keyFile {
                    let raw = try Data(contentsOf: URL(fileURLWithPath: k))
                    let text = String(decoding: raw, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                    if raw.count == 32 {
                        seed = raw
                    } else if text.count == 64, let bytes = hexBytes(text) {
                        seed = bytes
                    } else if let b = Data(base64Encoded: text), b.count == 32 {
                        seed = b
                    } else {
                        throw SPDFError("W", "\(k) does not hold a 32-byte Ed25519 seed (raw, hex or base64)")
                    }
                }
                try SPDFSeal.seal(URL(fileURLWithPath: pos[0]), signingKey: seed)
            case "conformance":
                let dir = URL(fileURLWithPath: pos.first ?? "conformance")
                let r = try ConformanceRunner.run(directory: dir)
                say(r.json)
                if let output { try Data((r.json + "\n").utf8).write(to: URL(fileURLWithPath: output)) }
                FileHandle.standardError.write(Data("\(r.passed.count) passed, \(r.failed.count) failed, \(r.skipped.count) skipped\n".utf8))
                if !r.failed.isEmpty { exit(1) }
            default:
                usage()
            }
        } catch {
            die(error)
        }
    }
}
