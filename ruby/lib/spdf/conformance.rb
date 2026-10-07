# frozen_string_literal: true

require "tmpdir"
require "cgi/escape"

module Spdf
  # Runner of the shared conformance suite (conformance/cases/*.json, §11).
  class Conformance
    IMPL = "spdf-format (Ruby)"
    TOLERANCE = 1e-6

    def initialize(dir)
      @dir = File.expand_path(dir)
    end

    def run
      report = { "impl" => IMPL, "version" => VERSION, "passed" => [], "failed" => [], "skipped" => [] }
      Dir[File.join(@dir, "cases", "*.json")].sort.each do |file|
        c = JSON.parse(File.read(file, encoding: "UTF-8"))
        id = c["id"] || File.basename(file, ".json")
        begin
          reason = run_case(c)
          if reason.nil?
            report["passed"] << id
          elsif reason == :skip
            report["skipped"] << { "id" => id, "reason" => "ALTO, TEI and IIIF exports (SPEC §19.4, optional) are not implemented" }
          else
            report["failed"] << { "id" => id, "reason" => reason }
          end
        rescue StandardError, ScriptError => e
          report["failed"] << { "id" => id, "reason" => "#{e.class}: #{e.message}" }
        end
      end
      report
    end

    # Structural comparison (numbers within TOLERANCE); nil or a reason.
    def self.compare(want, got, path = "$")
      if want.is_a?(Numeric) && got.is_a?(Numeric)
        return (want - got).abs <= TOLERANCE ? nil : "#{path}: expected #{want}, got #{got}"
      end
      if want.is_a?(Hash) && got.is_a?(Hash)
        missing = want.keys - got.keys
        extra = got.keys - want.keys
        return "#{path}.#{missing.first}: missing" unless missing.empty?
        return "#{path}.#{extra.first}: unexpected key" unless extra.empty?

        want.each do |k, v|
          r = compare(v, got[k], "#{path}.#{k}")
          return r if r
        end
        return nil
      end
      if want.is_a?(Array) && got.is_a?(Array)
        return "#{path}: expected #{want.length} items, got #{got.length}" if want.length != got.length

        want.each_with_index do |v, i|
          r = compare(v, got[i], "#{path}[#{i}]")
          return r if r
        end
        return nil
      end
      want == got ? nil : "#{path}: expected #{want.inspect[0, 200]}, got #{got.inspect[0, 200]}"
    end

    # One request of the `spdf eval` test protocol.
    def self.evaluate(q)
      doc = -> { Document.open(q["file"]) }
      case q["op"]
      when "dump" then doc.call.dump
      when "validate" then Validator.validate(q["file"])
      when "lexical" then doc.call.search_lexical(q["query"], limit: q.fetch("limit", 10))
      when "vector" then doc.call.search_vector(q["vector"], space: q["space"], limit: q.fetch("limit", 10), target: q.fetch("target", "fragment"))
      when "hybrid" then doc.call.search_hybrid(q["query"], q["vector"], space: q["space"], limit: q.fetch("limit", 10))
      when "uri" then AnchorUri.format(q["docref"], q["anchor"], q["end"])
      when "format_locator" then AnchorUri.format_locator(q["docref"], q["locator"])
      when "parse_uri" then AnchorUri.parse(q["uri"])
      when "cite" then Cite.short(q["metadata"], q["anchor"], q["end"], locale: q.fetch("locale", "es"))
      when "write"
        Writer.from_source(q["source"], q["path"])
        Document.open(q["path"]) { |d| d.dump }
      when "csl" then doc.call.csl_item
      when "bibtex" then doc.call.bibtex
      else raise Error.new("E000", "unknown op #{q["op"].inspect}")
      end
    end

    private

    def path(rel) = File.join(@dir, rel)
    def json(rel) = JSON.parse(File.read(path(rel), encoding: "UTF-8"))

    def run_case(c)
      input = c["input"] || {}
      ex = c["expect"] || {}
      case c["kind"]
      when "dump", "legacy_dump"
        Document.open(path(input["file"])) do |d|
          r = self.class.compare(json(ex["dump"]), d.dump, "dump")
          return r if r

          sha = d.content_sha256
          return "content_sha256: expected #{ex["content_sha256"]}, got #{sha}" if ex["content_sha256"] && sha != ex["content_sha256"]
        end
        nil
      when "roundtrip"
        Dir.mktmpdir("spdf-rt") do |dir|
          out = File.join(dir, "roundtrip.spdf")
          Writer.from_source(json(input["source"]), out)
          Document.open(out) { |d| self.class.compare(json(ex["dump"]), d.dump, "dump") }
        end
      when "validate"
        r = Validator.validate(path(input["file"]))
        return "version: expected #{ex["version"].inspect}, got #{r["version"].inspect}" if ex.key?("version") && ex["version"] != r["version"]
        return "valid: expected #{ex["valid"]}, got #{r["valid"]} (#{r["errors"].map { |e| e["code"] }.join(",")})" if ex.key?("valid") && ex["valid"] != r["valid"]

        %w[errors warnings].each do |k|
          next unless ex.key?(k)

          want = ex[k].map { |e| e.is_a?(Hash) ? e["code"] : e }.uniq.sort
          got = r[k].map { |e| e["code"] }.uniq.sort
          return "#{k}: expected #{want}, got #{got}" if want != got
        end
        nil
      when "search_lexical"
        Document.open(path(input["file"])) do |d|
          got = Search.new(d).lexical_detailed(input["query"], limit: input.fetch("limit", 10))
          %w[route match].each do |k|
            return "#{k}: expected #{ex[k].inspect}, got #{got[k].inspect}" if ex.key?(k) && ex[k] != got[k]
          end
          compare_results(ex["results"], got["results"], true)
        end
      when "search_vector"
        Document.open(path(input["file"])) do |d|
          got = d.search_vector(input["query_vector"], space: input["space"], limit: input.fetch("limit", 10), target: input.fetch("target", "fragment"))
          compare_results(ex["results"], got, false)
        end
      when "search_hybrid"
        Document.open(path(input["file"])) do |d|
          compare_results(ex["results"], d.search_hybrid(input["query"], input["query_vector"], space: input["space"], limit: input.fetch("limit", 10)), true)
        end
      when "anchor_uri" then anchor_uri_case(input, ex)
      when "locate"
        got = Document.open(path(input["file"])) do |d|
          d.locate(input["reference"])
        rescue Error
          { "document" => false, "units" => [], "fragments" => [], "char" => nil, "xywh" => nil }
        end
        self.class.compare(ex, got, "locate")
      when "export_csl"
        metas = input["files"].map { |f| Document.open(path(f), &:metadata) }
        self.class.compare(ex["items"], Bibliography.csl_items(metas, input["anchor"], input["anchor_end"]), "items")
      when "export_bibtex"
        metas = input["files"].map { |f| Document.open(path(f), &:metadata) }
        lines = ->(t) { t.to_s.split(/\r?\n/).map(&:strip).reject(&:empty?) }
        want = lines.call(ex["text"])
        got = lines.call(Bibliography.bibtex_all(metas))
        diff = want.each_index.find { |i| want[i] != got[i] }
        return "line #{diff + 1}: expected #{want[diff]}, got #{got[diff]}" if diff
        return "expected #{want.length} lines, got #{got.length}" if want.length != got.length

        nil
      when "cite_passage"
        Document.open(path(input["file"])) do |d|
          self.class.compare(ex, d.cite_passage(input["fragment"], input["quote"], locale: input.fetch("locale", "en")), "cite_passage")
        end
      when "export_structure"
        Document.open(path(input["file"])) { |d| self.class.compare(ex["pages"], pages(d, input["format"]), "pages") }
      when "quantize"
        hex = begin
          Vectors.encode(input["values"], input["dtype"]).unpack1("H*")
        rescue Error => e
          return ex["error"] == true ? nil : "unexpected error: #{e.message}"
        end
        return "expected an error, got #{hex}" if ex["error"] == true

        hex == ex["hex"] ? nil : "expected #{ex["hex"]}, got #{hex}"
      when "cite"
        text = Cite.short(input["metadata"] || {}, input["anchor"], input["anchor_end"], locale: input.fetch("locale", "en"))
        text == ex["text"] ? nil : "expected #{ex["text"]}, got #{text}"
      else "unknown case kind #{c["kind"]}"
      end
    end

    def xml_attr(tag, name)
      m = tag.match(/\s#{name}="([^"]*)"/)
      m && CGI.unescapeHTML(m[1])
    end

    # Page sequence of an ALTO, TEI or IIIF export, read back from the exported document.
    def pages(doc, format)
      case format
      when "alto"
        doc.alto.scan(/<Page\s[^>]*>/).map { |t| { "physical" => xml_attr(t, "PHYSICAL_IMG_NR").to_i, "printed" => xml_attr(t, "PRINTED_IMG_NR") } }
      when "tei"
        xml = doc.tei
        xml[xml.index("<body>")..].scan(%r{<pb(?:\s[^>]*)?/>}).map { |t| { "n" => xml_attr(t, "n") } }
      when "iiif"
        base = "https://example.org/iiif"
        manifest = JSON.parse(JSON.generate(doc.iiif(base)))
        page_canvases = doc.units.select { |u| u["anchor"].is_a?(Hash) && u["anchor"]["type"] == "page" }.map { |u| "#{base}/canvas/#{u["ord"]}" }
        manifest["items"].select { |c| page_canvases.include?(c["id"]) }.map { |c| { "label" => c["label"]&.values&.first&.first } }
      else raise Error.new("E000", "unknown format #{format}")
      end
    end

    def anchor_uri_case(input, ex)
      if input.key?("uri")
        if ex["error"] == true
          begin
            r = AnchorUri.parse(input["uri"])
            return "expected a parse error, got #{r["locator"]}"
          rescue Error
            return nil
          end
        end
        p = AnchorUri.parse(input["uri"])
        return "docref: expected #{ex["docref"]}, got #{p["docref"]}" if p["docref"] != ex["docref"]

        r = self.class.compare(ex["locator"], p["locator"], "locator")
        return r if r

        f = AnchorUri.format_locator(p["docref"], p["locator"])
        return f == ex["canonical"] ? nil : "format(parse(uri)): expected #{ex["canonical"]}, got #{f}"
      end
      uri = AnchorUri.format(input["docref"], input["anchor"], input["anchor_end"])
      return "uri: expected #{ex["uri"]}, got #{uri}" if uri != ex["uri"]

      p = AnchorUri.parse(uri)
      return "parse(uri).docref: expected #{input["docref"]}, got #{p["docref"]}" if p["docref"] != input["docref"]

      r = self.class.compare(ex["locator"], p["locator"], "locator")
      return r if r

      f = AnchorUri.format_locator(p["docref"], p["locator"])
      f == uri ? nil : "format(parse(uri)): expected #{uri}, got #{f}"
    end

    def compare_results(want, got, via)
      if want.length != got.length
        return "results: expected #{want.length}, got #{got.length}"
      end
      want.each_with_index do |w, i|
        g = got[i]
        %w[fragment_id unit_id figure_id].each do |k|
          return "results[#{i}].#{k}: expected #{w[k]}, got #{g[k]}" if w.key?(k) && w[k] != g[k]
        end
        return "results[#{i}].score: expected #{w["score"]}, got #{g["score"]}" if (w["score"] - g["score"]).abs > TOLERANCE
        return "results[#{i}].anchor_uri: expected #{w["anchor_uri"]}, got #{g["anchor_uri"]}" if w["anchor_uri"] != g["anchor_uri"]
        return "results[#{i}].via: expected #{w["via"]}, got #{g["via"]}" if via && w.key?("via") && w["via"] != g["via"]
      end
      nil
    end
  end
end
