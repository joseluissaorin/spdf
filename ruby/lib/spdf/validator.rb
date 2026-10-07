# frozen_string_literal: true

require "base64"
require "digest"
require "openssl"

module Spdf
  # Validation (specification §12): checks in the order of the specification; a
  # fatal error (E001, E002) stops. "valid" means no errors.
  class Validator
    REQUIRED_TABLES = %w[spdf_meta documents units sections fragments fragments_fts figures spaces vectors blobs
                         provenance extensions].freeze
    REQUIRED_META = %w[spdf_version profile created generator document_id].freeze
    ANCHOR_TYPES = %w[page time section slide sheet web image verse canonical].freeze
    ED25519_DER_PREFIX = "\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00".b

    def self.validate(path, **options) = new.run(path, Container::Options.new(**options))

    def initialize
      @errors = []
      @warnings = []
      @forward_compatible = false
    end

    def run(path, options)
      c = begin
        Container.open(path, options, strict: false)
      rescue Error => e
        err(e.code == "E002" ? "E002" : "E001", e.message)
        return result(nil, [])
      rescue StandardError => e
        err("E001", e.message)
        return result(nil, [])
      end
      begin
        checks(c)
      ensure
        c.close
      end
    end

    # nil if the decoded anchor is fine, else [code, message].
    def self.check_anchor(a, text)
      return ["E040", "anchor is not an object"] unless a.is_a?(Hash)

      t = a["type"]
      return ["E040", "anchor without type"] unless t.is_a?(String)
      return ["E041", "unknown anchor type #{t}"] unless ANCHOR_TYPES.include?(t)

      # An integer is a JSON number with an integral value (10 and 10.0 are the same value).
      int = ->(v) { v.is_a?(Integer) || (v.is_a?(Float) && v.finite? && v == v.floor) }
      num = ->(v) { v.is_a?(Integer) || v.is_a?(Float) }
      ok = case t
           when "page" then int[a["physical"]] && a["physical"] >= 1 && a.key?("printed") && (a["printed"].nil? || a["printed"].is_a?(String))
           when "time" then num[a["t0"]] && num[a["t1"]] && a["t0"] >= 0 && a["t0"] <= a["t1"]
           when "section" then a["path"].is_a?(Array) && a["path"].all? { |x| x.is_a?(String) }
           when "slide" then int[a["n"]] && a["n"] >= 1
           when "sheet" then a["sheet"].is_a?(String) && int[a["row_from"]] && int[a["row_to"]]
           when "web" then a["url"].is_a?(String)
           when "image" then true
           when "verse" then int[a["line_from"]]
           when "canonical" then a["scheme"].is_a?(String) && a["ref"].is_a?(String)
           end
      return ["E040", "#{t} anchor misses or mistypes a required member"] unless ok

      if a.key?("region")
        r = a["region"]
        return ["E040", "bad region"] unless r.is_a?(Hash) && %w[x y w h].all? { |k| num[r[k]] }
      end
      if a.key?("chars")
        ch = a["chars"]
        return ["E040", "bad chars"] unless ch.is_a?(Array) && ch.length == 2 && ch.all? { |x| int[x] }
        if text && !(ch[0] >= 0 && ch[0] <= ch[1] && ch[1] <= Text.nfc(text).length)
          return ["E042", "chars #{ch} out of range"]
        end
      end
      nil
    end

    private

    # A newer minor version may define new anchor types and dtypes (SPEC §22.1, §23).
    def err(code, message, where = "")
      return warn(code, message, where) if @forward_compatible && %w[E041 E032].include?(code)

      @errors << { "code" => code, "message" => message, "where" => where }
    end
    def warn(code, message, where = "") = @warnings << { "code" => code, "message" => message, "where" => where }

    def result(version, profile)
      { "valid" => @errors.empty?, "version" => version, "profile" => profile, "errors" => @errors, "warnings" => @warnings }
    end

    def checks(c)
      db = c.db
      version = c.version
      profile = []
      if c.legacy?
        warn("W110", "legacy SPDF #{version} file")
        %w[spdf documentos unidades fragmentos fragmentos_fts].each { |t| err("E010", "missing legacy table #{t}", t) unless c.table?(t) }
        c.forbidden.each { |f| err("E020", "#{f["type"]} #{f["name"]} present", f["name"]) }
        return result(version, profile)
      end
      warn("E003", "SPDF 5.0 should not be gzip-wrapped") if c.gzipped?
      if version != "5.0"
        warn("W105", "newer minor version #{version}")
        @forward_compatible = true
      end
      c.forbidden.each { |f| err("E020", "#{f["type"]} #{f["name"]} present", f["name"]) }

      present = {}
      REQUIRED_TABLES.each do |t|
        unless c.table?(t)
          err("E010", "missing table #{t}", t)
          next
        end
        have = c.columns(t)
        present[t] = have
        Document::COLUMNS.fetch(t, []).each { |col| err("E011", "missing column #{t}.#{col}", "#{t}.#{col}") unless have.include?(col) }
      end
      ok = ->(t, *cols) { present.key?(t) && cols.all? { |col| present[t].include?(col) } }

      meta = {}
      if ok.call("spdf_meta", "key", "value")
        meta = db.execute("SELECT key, value FROM spdf_meta").to_h
        REQUIRED_META.each { |k| err("E012", "missing spdf_meta key #{k}", k) unless meta.key?(k) }
        profile = meta["profile"].to_s.split
      end

      docs = []
      if ok.call("documents", "id", "metadata")
        docs = if ok.call("documents", "rights", "unit_count")
                 db.execute("SELECT id, metadata, rights, unit_count FROM documents")
               else
                 db.execute("SELECT id, metadata, NULL, NULL FROM documents")
               end
        err("E013", "documents has #{docs.length} rows", "documents") if docs.length != 1
        docs.each do |id, md, rights, _|
          begin
            m = JSON.parse(md.to_s)
            err("E051", "metadata needs a string type and title", id.to_s) unless m.is_a?(Hash) && m["type"].is_a?(String) && m["title"].is_a?(String)
          rescue JSON::ParserError, TypeError
            err("E050", "metadata is not valid JSON", id.to_s)
          end
          next if rights.nil?

          begin
            JSON.parse(rights)
          rescue JSON::ParserError
            err("E050", "rights is not valid JSON", id.to_s)
          end
        end
      end

      if ok.call("extensions", "name", "required")
        db.execute("SELECT name, required FROM extensions ORDER BY name").each do |name, req|
          err("E060", "unknown required extension #{name}", name) if req && req != 0 && !Document::KNOWN_EXTENSIONS.include?(name)
        end
      end

      texts = {}
      if ok.call("units", "id", "ord", "anchor", "text")
        rs = db.execute("SELECT id, ord, anchor, text FROM units ORDER BY ord, id")
        err("E090", "units.ord is not 1..N", "units") if rs.map { |r| r[1] } != (1..rs.length).to_a
        if docs.length == 1 && !docs[0][3].nil? && docs[0][3] != rs.length
          warn("W102", "unit_count #{docs[0][3]} but #{rs.length} units", "documents.unit_count")
        end
        rs.each do |id, _, anchor, text|
          texts[id] = text
          anchor_error(anchor, text, "units/#{id}")
        end
      end
      if ok.call("fragments", "id", "unit", "anchor")
        end_col = ok.call("fragments", "anchor_end") ? "anchor_end" : "NULL"
        db.execute("SELECT id, unit, anchor, #{end_col} FROM fragments ORDER BY n").each do |id, unit, anchor, anchor_end|
          anchor_error(anchor, texts[unit], "fragments/#{id}")
          anchor_error(anchor_end, nil, "fragments/#{id}/anchor_end") unless anchor_end.nil?
        end
      end
      if ok.call("figures", "id", "unit", "anchor")
        db.execute("SELECT id, unit, anchor FROM figures ORDER BY id").each { |id, unit, anchor| anchor_error(anchor, texts[unit], "figures/#{id}") }
      end

      spaces = {}
      if ok.call("spaces", "id", "dims", "dtype")
        db.execute("SELECT id, dims, dtype FROM spaces ORDER BY id").each do |id, dims, dtype|
          spaces[id] = [dims, dtype]
          err("E032", "unknown dtype #{dtype}", id) unless Vectors::SIZES.key?(dtype)
        end
      end
      nvec = 0
      if ok.call("vectors", "target", "id", "space", "data")
        db.execute("SELECT target, id, space, typeof(data), length(data) FROM vectors ORDER BY space, target, id").each do |target, id, space, type, len|
          nvec += 1
          where = "vectors/#{space}/#{target}/#{id}"
          unless spaces.key?(space)
            err("E031", "unknown space #{space}", where)
            next
          end
          dims, dtype = spaces[space]
          next unless Vectors::SIZES.key?(dtype)

          size = Vectors::SIZES[dtype]
          err("E030", "vector length #{len} != #{dims} x #{size}", where) if type != "blob" || len != dims * size
        end
      end

      check_fts(c) if c.table?("fragments_fts")

      if ok.call("blobs", "key", "sha256", "data")
        db.execute("SELECT key, sha256, data FROM blobs ORDER BY key").each do |key, sha, data|
          err("E080", "blob sha256 mismatch", key) if Digest::SHA256.hexdigest(data.to_s.b) != sha
        end
      end

      if meta.key?("content_sha256") && @errors.empty?
        actual = begin
          Document.new(c).content_sha256
        rescue StandardError
          "unavailable"
        end
        if actual != meta["content_sha256"]
          err("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
        elsif meta.key?("signature")
          check_signature(meta)
        end
      end

      warn("W100", "profile semantic without vectors") if profile.include?("semantic") && nvec.zero?
      if profile.include?("media") && ok.call("units", "anchor")
        has_time = db.execute("SELECT anchor FROM units").any? do |(a)|
          JSON.parse(a.to_s)["type"] == "time"
        rescue JSON::ParserError, NoMethodError, TypeError
          false
        end
        warn("W101", "profile media without time anchors") unless has_time
      end
      result(version, profile)
    end

    def anchor_error(raw, text, where)
      a = begin
        raise TypeError unless raw.is_a?(String)

        JSON.parse(raw)
      rescue JSON::ParserError, TypeError
        err("E040", "anchor is not valid JSON", where)
        return
      end
      r = self.class.check_anchor(a, text)
      err(r[0], r[1], where) if r
    end

    def check_fts(c)
      mem = SQLite3::Database.new(":memory:")
      begin
        b = SQLite3::Backup.new(mem, "main", c.db, "main")
        b.step(-1)
        b.finish
        mem.execute("PRAGMA trusted_schema = OFF")
        mem.execute("INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)")
        if c.table?("fragments_fts_trigram")
          mem.execute("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)")
        end
      rescue SQLite3::Exception => e
        err("E070", "FTS index out of sync: #{e.message}", "fragments_fts")
      ensure
        mem.close
      end
    end

    def check_signature(meta)
      ok = begin
        signer = meta["signer"].to_s
        raise ArgumentError unless signer.start_with?("ed25519:")

        pk = Base64.strict_decode64(signer[8..])
        sig = Base64.strict_decode64(meta["signature"].to_s)
        raise ArgumentError unless pk.bytesize == 32 && sig.bytesize == 64

        key = OpenSSL::PKey.read(ED25519_DER_PREFIX + pk)
        key.verify(nil, sig, "spdf-content-sha256:#{meta["content_sha256"]}")
      rescue ArgumentError, OpenSSL::PKey::PKeyError
        false
      end
      err("E082", "signature does not verify", "spdf_meta.signature") unless ok
    end
  end
end
