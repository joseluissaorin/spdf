# frozen_string_literal: true

require "digest"
require "set"

module Spdf
  # A SPDF file opened for reading: 5.0, or legacy 4.x through the 5.0 view.
  class Document
    COLUMNS = {
      "spdf_meta" => %w[key value],
      "documents" => %w[id kind metadata source_sha256 source_ref mime bytes unit_count duration created updated
                        title authors year language rights],
      "units" => %w[id document ord anchor text notes header footer image thumbnail reader confidence printed t0 t1 words],
      "sections" => %w[id document parent level title unit_from unit_to summary],
      "fragments" => %w[n id document unit ord text context section anchor anchor_end search_text],
      "figures" => %w[id document unit image caption description anchor],
      "spaces" => %w[id provider model version dims dtype normalized truncated_from modalities task_prefixes created],
      "vectors" => %w[target id space document data],
      "blobs" => %w[key mime sha256 data],
      "provenance" => %w[document stage provider model detail ms at],
      "extensions" => %w[name version required]
    }.freeze
    JSON_COLUMNS = {
      "documents" => %w[metadata rights], "units" => %w[anchor notes words],
      "fragments" => %w[section anchor anchor_end], "figures" => %w[anchor],
      "spaces" => %w[modalities task_prefixes], "provenance" => %w[detail]
    }.freeze
    KNOWN_EXTENSIONS = [].freeze

    attr_reader :container

    # Opens a file safely. Options: max_blob_bytes, max_inflated_bytes, temp_dir.
    def self.open(path, **options)
      c = Container.open(path, Container::Options.new(**options), strict: true)
      doc = new(c)
      begin
        doc.send(:check_extensions)
      rescue StandardError
        c.close
        raise
      end
      return doc unless block_given?

      begin
        yield doc
      ensure
        doc.close
      end
    end

    def initialize(container)
      @container = container
      @db = container.db
      @blob_keys = nil
      @document = nil
      @fragments_by_n = nil
    end

    def close = @container.close
    def version = @container.version
    def legacy? = @container.legacy?

    # Physical name of a 5.0 table in this file, or nil.
    def table_name(table)
      name = legacy? ? Legacy::TABLES.dig(table, 0) : table
      name && @container.table?(name) ? name : nil
    end

    def select_list(table, only = nil)
      name = table_name(table)
      existing = name ? @container.columns(name) : []
      COLUMNS.fetch(table).filter_map do |col|
        next if only && !only.include?(col)

        expr =
          if legacy?
            old = Legacy.column(table, col)
            old && existing.include?(old) ? Container.quote(old) : Legacy::DEFAULTS.fetch("#{table}.#{col}", "NULL")
          else
            existing.include?(col) ? Container.quote(col) : "NULL"
          end
        "#{expr} AS #{Container.quote(col)}"
      end.join(", ")
    end

    # Replaces {col} placeholders by physical column names.
    def physical(table, sql)
      sql.gsub(/\{([a-z_0-9]+)\}/) do
        col = Regexp.last_match(1)
        if legacy?
          old = Legacy.column(table, col)
          old ? Container.quote(old) : "NULL"
        else
          Container.quote(col)
        end
      end
    end

    # Rows of a 5.0 table through the view (hashes with 5.0 column names).
    def rows(table, tail = "", params = [], only: nil)
      name = table_name(table)
      return [] unless name

      sql = "SELECT #{select_list(table, only)} FROM #{Container.quote(name)}"
      sql += " #{physical(table, tail)}" unless tail.empty?
      stmt = @db.prepare(sql)
      begin
        cols = stmt.columns
        stmt.execute(*params).map { |r| map_row(table, cols.zip(r).to_h) }
      ensure
        stmt.close
      end
    end

    def meta
      rows("spdf_meta", "ORDER BY {key}").to_h { |r| [r["key"], r["value"]] }
    end

    def document
      @document ||= begin
        rs = rows("documents", "ORDER BY {id} LIMIT 2")
        raise Error.new("E013", "documents must hold exactly one row") unless rs.length == 1

        rs.first
      end
    end

    def metadata
      m = document["metadata"]
      m.is_a?(Hash) ? m : {}
    end

    def title
      m = metadata
      m["title"].is_a?(String) ? m["title"] : document["title"]
    end

    def docref
      h = document["source_sha256"].to_s.downcase
      h.match?(/\A[0-9a-f]{64}\z/) ? "sha256-#{h}" : document["id"].to_s
    end

    def units
      rs = rows("units", "ORDER BY {ord}, {id}")
      rs.each_with_index { |r, i| r["ord"] = i + 1 } if legacy?
      rs
    end

    def unit(id) = units.find { |u| u["id"] == id }
    def sections = rows("sections", "ORDER BY {id}")
    def fragments = rows("fragments", "ORDER BY {n}")
    def fragment(id) = rows("fragments", "WHERE {id} = ?", [id]).first
    def figures = rows("figures", "ORDER BY {id}")
    def spaces = rows("spaces", "ORDER BY {id}")
    def space(id) = rows("spaces", "WHERE {id} = ?", [id]).first
    def extensions = rows("extensions", "ORDER BY {name}")

    def fragment_by_n(n)
      @fragments_by_n ||= rows("fragments", "ORDER BY {n}", only: %w[n id unit anchor anchor_end]).to_h { |r| [r["n"], r] }
      @fragments_by_n[n]
    end

    # Decoded vectors of a space and target: {id => [floats]}.
    def vectors(space_id, target = "fragment")
      sp = space(space_id) or raise Error.new("E031", "unknown vector space #{space_id}")
      t = legacy? ? Legacy.legacy_target(target) : target
      rows("vectors", "WHERE {space} = ? AND {target} = ? ORDER BY {id}", [space_id, t], only: %w[id data])
        .to_h { |r| [r["id"], Vectors.decode(r["data"].to_s.b, sp["dtype"])] }
    end

    def blobs
      rows("blobs", "ORDER BY {key}", only: %w[key mime data]).map do |r|
        data = r["data"].to_s.b
        { "key" => r["key"], "mime" => r["mime"], "bytes" => data.bytesize, "sha256" => Digest::SHA256.hexdigest(data) }
      end
    end

    def blob(key)
      key = key.delete_prefix("blob:")
      r = rows("blobs", "WHERE {key} = ?", [key], only: %w[data]).first
      r && r["data"].to_s.b
    end

    # Provenance entries sorted by the UTF-8 bytes of each entry's JCS form.
    def provenance
      rows("provenance").map { |r| r.except("document") }.sort_by { |r| Json.canonical(r).b }
    end

    def fts
      name = legacy? ? "fragmentos_fts" : "fragments_fts"
      sql = @db.get_first_value("SELECT sql FROM sqlite_master WHERE name = ?", [name])
      tok = if sql.nil? then nil
            elsif (m = sql.match(/tokenize\s*=\s*(?:'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([A-Za-z0-9_]+))/i))
              raw = m[1] ? m[1].gsub("''", "'") : (m[2] ? m[2].gsub('""', '"') : m[3])
              raw.split.join(" ")
            else "unicode61"
            end
      { "tokenizer" => tok, "trigram" => @container.table?("fragments_fts_trigram") }
    end

    # The canonical dump (specification §5).
    def dump
      doc = document
      strip = ->(rs) { rs.map { |r| r.except("document") } }
      m = meta
      out = {
        "spdf_version" => legacy? ? (m["spdf_version"] || version) : m["spdf_version"],
        "meta" => m,
        "fts" => fts,
        "document" => COLUMNS["documents"].to_h { |c| [c, doc[c]] },
        "units" => strip.call(units),
        "sections" => strip.call(sections),
        "fragments" => strip.call(fragments),
        "figures" => strip.call(figures),
        "spaces" => spaces,
        "vectors" => vector_digests,
        "blobs" => blobs,
        "provenance" => provenance,
        "extensions" => extensions
      }
      out["legacy"] = true if legacy?
      Json.canon(out)
    end

    def dump_json = Json.canonical(dump)

    # SHA-256 of the JCS dump without content_sha256, signature and signer (§8).
    def content_sha256
      d = dump
      d["meta"] = d["meta"].except("content_sha256", "signature", "signer")
      Digest::SHA256.hexdigest(Json.canonical(d))
    end

    def search_lexical(query, limit: 10) = Search.new(self).lexical(query, limit: limit)

    def search_vector(vector, space:, limit: 10, target: "fragment")
      Search.new(self).vector(vector, space: space, limit: limit, target: target)
    end

    def search_hybrid(query, vector, space:, limit: 10)
      Search.new(self).hybrid(query, vector, space: space, limit: limit)
    end

    def anchor_uri(anchor, anchor_end = nil) = AnchorUri.format(docref, anchor, anchor_end)

    RULES = %w[p f t sl v ref s sh].freeze

    # Resolves an anchor URI, or the URL of a .spdf with a fragment, against this file
    # (SPEC §5.4): {"document", "units", "fragments", "char", "xywh"}.
    def locate(reference)
      empty = { "document" => false, "units" => [], "fragments" => [], "char" => nil, "xywh" => nil }
      d = document
      if reference.start_with?("spdf:")
        parsed = AnchorUri.parse(reference)
        return empty unless [ "sha256-#{d["source_sha256"]}", d["id"].to_s ].include?(parsed["docref"])

        l = parsed["locator"]
      else
        _, hash, frag = reference.partition("#")
        l = hash.empty? || frag.empty? ? {} : AnchorUri.parse("spdf:x##{frag}")["locator"]
      end
      out = { "document" => true, "units" => [], "fragments" => [], "char" => l["char"], "xywh" => l["xywh"] }
      rule = RULES.find { |r| l.key?(r) }
      return out unless rule

      us = units
      hits = us.select { |u| anchor_matches?(rule, l, u["anchor"], rule == "f" ? u["printed"] : nil) }.map { |u| u["id"] }
      if rule == "t" && hits.empty?
        timed = us.select { |u| u["anchor"].is_a?(Hash) && u["anchor"]["type"] == "time" }
        last = timed.last
        hits = [last["id"]] if last && last["anchor"]["t1"].is_a?(Numeric) && last["anchor"]["t1"] == l["t"][0]
      end
      frags = fragments.select { |f| anchor_matches?(rule, l, f["anchor"], nil) }
      if hits.empty? && !frags.empty?
        wanted = frags.map { |f| f["unit"] }
        hits = us.select { |u| wanted.include?(u["id"]) }.map { |u| u["id"] }
      end
      if l.key?("char")
        c, dd = l["char"]
        frags = frags.select do |f|
          ch = f["anchor"].is_a?(Hash) ? f["anchor"]["chars"] : nil
          next false unless hits.include?(f["unit"]) && ch.is_a?(Array) && ch.length == 2

          a, b = ch
          c < dd ? (a < dd && c < b) : (a <= c && c < b)
        end
      end
      out.merge("units" => hits, "fragments" => frags.map { |f| f["id"] })
    end

    def cite(anchor, anchor_end = nil, locale: "es") = Cite.short(metadata, anchor, anchor_end, locale: locale)

    def cite_fragment(id, locale: "es")
      f = fragment(id) or raise Error.new("E040", "unknown fragment #{id}")
      cite(f["anchor"], f["anchor_end"].is_a?(Hash) ? f["anchor_end"] : nil, locale: locale)
    end

    # CSL-JSON item ("spdf" member removed, "id" = BibTeX key, SPEC §19).
    def csl_item = Bibliography.csl_item(metadata)
    def csl_json(pretty: true) = Json.generate([csl_item], pretty: pretty)
    def bibtex = Bibliography.bibtex(Bibliography.base(metadata))

    private

    def int?(v) = v.is_a?(Integer) || (v.is_a?(Float) && v.finite? && v == v.floor)

    def anchor_matches?(rule, l, a, printed)
      return false unless a.is_a?(Hash)

      t = a["type"]
      case rule
      when "p" then t == "page" && int?(a["physical"]) && l["p"] <= a["physical"] && a["physical"] <= (l["pe"] || l["p"])
      when "f" then (printed.nil? ? a["printed"] : printed) == l["f"]
      when "t"
        x = l["t"][0]
        t == "time" && a["t0"].is_a?(Numeric) && a["t1"].is_a?(Numeric) && a["t0"] <= x && x < a["t1"]
      when "sl" then t == "slide" && !a["n"].nil? && a["n"] == l["sl"]
      when "v"
        x = l["v"][0]
        lf = a["line_from"]
        lt = a["line_to"].nil? ? lf : a["line_to"]
        t == "verse" && int?(lf) && lf <= x && x <= lt
      when "ref" then t == "canonical" && a["scheme"] == l["ref"]["scheme"] && a["ref"] == l["ref"]["ref"]
      when "s"
        path = a["path"]
        return false unless %w[section web].include?(t) && path.is_a?(Array)
        return path == l["s"] && !a["paragraph"].nil? && a["paragraph"] == l["para"] if l.key?("para")

        path[0, l["s"].length] == l["s"]
      when "sh"
        return false unless t == "sheet" && a["sheet"] == l["sh"]
        return true unless l.key?("rows")

        x = l["rows"][0]
        int?(a["row_from"]) && int?(a["row_to"]) && a["row_from"] <= x && x <= a["row_to"]
      else false
      end
    end

    def blob_keys
      @blob_keys ||= begin
        name = table_name("blobs")
        col = legacy? ? "clave" : "key"
        name ? @db.execute("SELECT #{Container.quote(col)} FROM #{Container.quote(name)}").map(&:first).to_set : Set.new
      end
    end

    def map_row(table, r)
      JSON_COLUMNS.fetch(table, []).each { |c| r[c] = Json.column(r[c]) if r.key?(c) }
      return r unless legacy?

      case table
      when "spdf_meta" then r["key"] = Legacy.meta_key(r["key"].to_s)
      when "documents"
        tipo = r["kind"]
        r["kind"] = Legacy.kind(tipo)
        r["metadata"] = Legacy.metadata(r["metadata"], tipo) if r.key?("metadata")
        r["source_ref"] = Legacy.reference(r["source_ref"], blob_keys) if r.key?("source_ref")
      when "units"
        %w[image thumbnail].each { |k| r[k] = Legacy.reference(r[k], blob_keys) if r.key?(k) }
        r["anchor"] = Legacy.anchor(r["anchor"]) if r.key?("anchor")
      when "fragments"
        %w[anchor anchor_end].each { |k| r[k] = Legacy.anchor(r[k]) if r.key?(k) }
      when "figures"
        r["image"] = Legacy.reference(r["image"], blob_keys, keep_empty: true) if r.key?("image")
        r["anchor"] = Legacy.anchor(r["anchor"]) if r.key?("anchor")
      when "spaces"
        r["modalities"] = Legacy.modalities(r["modalities"]) if r.key?("modalities")
      when "vectors"
        r["target"] = Legacy.target(r["target"].to_s) if r["target"]
      end
      r
    end

    def vector_digests
      name = table_name("vectors")
      return {} unless name

      sql = "SELECT #{select_list("vectors", %w[target id space data])} FROM #{Container.quote(name)} " \
            "ORDER BY #{physical("vectors", "{space}, {target}, {id}")}"
      out = {}
      @db.execute(sql).each do |_t, _i, s, data|
        d = (out[s] ||= { "count" => 0, "sha256" => Digest::SHA256.new })
        d["count"] += 1
        d["sha256"].update(data.to_s.b)
      end
      out.transform_values { |d| { "count" => d["count"], "sha256" => d["sha256"].hexdigest } }
    end

    def check_extensions
      extensions.each do |e|
        if e["required"].to_i != 0 && !KNOWN_EXTENSIONS.include?(e["name"])
          raise Error.new("E060", "the file requires the unknown extension #{e["name"]}")
        end
      end
    end
  end
end
