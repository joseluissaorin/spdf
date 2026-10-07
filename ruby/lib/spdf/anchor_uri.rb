# frozen_string_literal: true

module Spdf
  # Anchor URIs: spdf:<docref>#<params> (specification §3). A locator is the parsed
  # form of the parameters; format(parse(uri)) reproduces the canonical URI.
  module AnchorUri
    ORDER = %w[p pe f fe t s para sl sh rows v ref char xywh].freeze
    SHA_REF = /\Asha256-[0-9a-f]{64}\z/
    INT = /\A(0|[1-9][0-9]*)\z/
    DEC = /\A[0-9]+(\.[0-9]+)?\z/
    CLOCK = /\A(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)\z/

    module_function

    def enc(s)
      s.to_s.b.each_byte.map { |b| b.chr.match?(/[A-Za-z0-9\-._~]/) ? b.chr : Kernel.format("%%%02X", b) }.join
    end

    def dec(s)
      raise bad("bad percent-encoding") if s.match?(/%(?![0-9A-Fa-f]{2})/)

      d = s.b.gsub(/%([0-9A-Fa-f]{2})/) { Regexp.last_match(1).hex.chr }.force_encoding("UTF-8")
      raise bad("percent-encoding is not UTF-8") unless d.valid_encoding?

      d
    end

    def bad(why) = Error.new("E040", "bad anchor URI: #{why}")

    # Locator of an anchor (and optional end anchor).
    def locator(a, e = nil)
      l = {}
      t = a["type"]
      end_type = e && e["type"]
      case t
      when "page"
        l["p"] = a["physical"]
        l["f"] = a["printed"] unless a["printed"].nil?
        if e && end_type == "page"
          l["pe"] = e["physical"] if !e["physical"].nil? && e["physical"] != a["physical"]
          l["fe"] = e["printed"] if !e["printed"].nil? && e["printed"] != a["printed"]
        end
      when "time"
        t1 = e && end_type == "time" ? e["t1"] : a["t1"]
        l["t"] = t1.nil? ? [a["t0"]] : [a["t0"], t1]
      when "section", "web"
        l["s"] = a["path"].to_a.map(&:to_s) if a["path"].is_a?(Array) && !a["path"].empty?
        l["para"] = a["paragraph"] unless a["paragraph"].nil?
        unless a["printed"].nil?
          l["f"] = a["printed"]
          l["fe"] = e["printed"] if e && !e["printed"].nil? && e["printed"] != a["printed"]
        end
      when "slide"
        l["sl"] = a["n"]
      when "sheet"
        l["sh"] = a["sheet"]
        l["rows"] = [a["row_from"], a["row_to"]]
      when "verse"
        from = a["line_from"]
        to = a["line_to"]
        l["v"] = to.nil? || to == from ? [from] : [from, to]
        l["f"] = a["printed"] unless a["printed"].nil?
      when "canonical"
        l["ref"] = { "scheme" => a["scheme"], "ref" => a["ref"] }
      end
      l["char"] = a["chars"].to_a if a["chars"]
      if a["region"]
        r = a["region"]
        l["xywh"] = [r["x"], r["y"], r["w"], r["h"]]
      end
      l
    end

    def int_s(x) = x.is_a?(Float) && x == x.floor ? x.to_i.to_s : x.to_s

    def format_locator(docref, l)
      parts = ORDER.filter_map do |k|
        next unless l.key?(k)

        v = l[k]
        s = case k
            when "p", "pe", "para", "sl" then int_s(v)
            when "f", "fe", "sh" then enc(v)
            when "t" then v.map { |x| Json.number(x.to_f) }.join(",")
            when "s" then v.map { |x| enc(x) }.join("/")
            when "rows" then "#{int_s(v[0])}-#{int_s(v[1])}"
            when "v" then v.map { |x| int_s(x) }.join("-")
            when "ref" then "#{enc(v["scheme"])}:#{enc(v["ref"])}"
            when "char" then "#{int_s(v[0])},#{int_s(v[1])}"
            when "xywh" then "percent:#{v.map { |x| Json.ecma(Kernel.format("%.4f", x.to_f * 100).to_f) }.join(",")}"
            end
        "#{k}=#{s}"
      end
      ref = docref.match?(SHA_REF) ? docref : enc(docref)
      "spdf:#{ref}#{parts.empty? ? "" : "##{parts.join("&")}"}"
    end

    def format(docref, anchor, anchor_end = nil)
      format_locator(docref, locator(anchor, anchor_end))
    end

    def parse_int(s)
      raise bad("not an integer: #{s}") unless s.match?(INT)

      s.to_i
    end

    def canon_num(f)
      r = Json.round6(f)
      r == r.floor && r.abs < 2**53 ? r.to_i : r
    end

    def npt(s)
      return canon_num(s.to_f) if s.match?(DEC)

      m = s.match(CLOCK) or raise bad("bad time: #{s}")
      canon_num((m[1].to_i * 3600) + (m[2].to_i * 60) + m[3].to_f)
    end

    # {"docref" => …, "locator" => {…}}; raises Spdf::Error (E040) on malformed input.
    def parse(uri)
      raise bad("not an spdf: URI") unless uri.start_with?("spdf:")

      docref_raw, _, frag = uri[5..].partition("#")
      raise bad("empty document reference") if docref_raw.empty?

      docref = dec(docref_raw)
      l = {}
      frag.split("&").each do |part|
        next if part.empty?

        k, eq, v = part.partition("=")
        raise bad("parameter without value: #{part}") if eq.empty?
        raise bad("duplicate parameter #{k}") if l.key?(k)

        case k
        when "p", "pe", "para", "sl"
          l[k] = parse_int(v)
          raise bad("#{k} starts at 1") if k != "para" && l[k] < 1
        when "f", "fe", "sh"
          l[k] = dec(v)
        when "t"
          v = v.delete_prefix("npt:")
          xs = v.split(",", -1).map { |x| npt(x) }
          raise bad("bad t") if xs.length > 2 || (xs.length == 2 && xs[1] < xs[0])

          l[k] = xs
        when "s"
          l[k] = v.split("/", -1).map { |x| dec(x) }
        when "rows"
          a, dash, b = v.partition("-")
          raise bad("rows needs a-b") if dash.empty?

          l[k] = [parse_int(a), parse_int(b)]
        when "v"
          xs = v.split("-", -1).map { |x| parse_int(x) }
          raise bad("bad v") if xs.length > 2

          l[k] = xs
        when "ref"
          a, colon, b = v.partition(":")
          raise bad("ref needs scheme:ref") if colon.empty? || a.empty?

          l[k] = { "scheme" => dec(a), "ref" => dec(b) }
        when "char"
          xs = v.split(",", -1)
          raise bad("char needs start,end") unless xs.length == 2

          a = parse_int(xs[0])
          b = parse_int(xs[1])
          raise bad("char end before start") if b < a

          l[k] = [a, b]
        when "xywh"
          raise bad("xywh must use percent:") unless v.start_with?("percent:")

          xs = v[8..].split(",", -1)
          raise bad("bad xywh") unless xs.length == 4 && xs.all? { |x| x.match?(DEC) }

          l[k] = xs.map { |x| canon_num(x.to_f / 100) }
        end
      end
      { "docref" => docref, "locator" => l }
    end
  end
end
