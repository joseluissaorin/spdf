# frozen_string_literal: true

require "base64"
require "digest"
require "securerandom"

module Spdf
  # Builds a SPDF 5.0 file: no triggers or views, FTS rebuilt, VACUUM, atomic rename.
  #
  #   Spdf::Writer.create("out.spdf", generator: "my-app/1.0") do |w|
  #     w.document("id" => "d1", "kind" => "pdf", "metadata" => {"type" => "book", "title" => "…"}, …)
  #     w.unit(…)
  #     w.fragment(…)
  #   end
  class Writer
    SCHEMA = <<~SQL
      CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL,
        source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL,
        duration REAL, created TEXT NOT NULL, updated TEXT NOT NULL, title TEXT, authors TEXT,
        year INTEGER, language TEXT, rights TEXT
      );
      CREATE TABLE units (
        id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,
        anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT,
        image TEXT, thumbnail TEXT, reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
        printed TEXT, t0 REAL, t1 REAL, words TEXT
      );
      CREATE INDEX units_doc ON units(document, ord);
      CREATE INDEX units_printed ON units(document, printed);
      CREATE TABLE sections (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
        title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
      );
      CREATE TABLE fragments (
        n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL,
        ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT,
        anchor TEXT NOT NULL, anchor_end TEXT, search_text TEXT
      );
      CREATE INDEX fragments_doc ON fragments(document, ord);
      CREATE INDEX fragments_unit ON fragments(unit);
      CREATE VIRTUAL TABLE fragments_fts USING fts5(
        text, context, section, search_text,
        content='fragments', content_rowid='n',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE figures (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,
        caption TEXT, description TEXT, anchor TEXT NOT NULL
      );
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
        dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1,
        truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT
      );
      CREATE TABLE vectors (
        target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
        document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space)
      );
      CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE provenance (
        document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
        detail TEXT, ms INTEGER, at TEXT NOT NULL
      );
      CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
    SQL
    TRIGRAM = "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')"

    attr_reader :path

    def self.now = Time.now.utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Starts a file; spdf_version, profile, created and generator are filled in.
    def self.create(path, generator: "spdf-format-ruby/#{VERSION}", profile: "core", meta: {}, trigram: false)
      defaults = { "spdf_version" => "5.0", "profile" => profile, "created" => now, "generator" => generator }
      w = new(path, defaults.merge(meta.transform_keys(&:to_s)), trigram: trigram)
      return w unless block_given?

      begin
        yield w
        w.finish
      rescue StandardError
        w.abort
        raise
      end
    end

    # Writes a conformance *source* (canonical dump + vectors.<space>.items + blobs[].data_base64)
    # exactly as given. i8 values are the stored integers; f16 and f32 values are exact.
    def self.from_source(source, path)
      w = new(path, source["meta"].to_h.transform_values(&:to_s), trigram: source.dig("fts", "trigram") ? true : false, exact: true)
      begin
        w.document(source["document"])
        did = source["document"]["id"]
        Array(source["units"]).each { |u| w.send(:insert, "units", pick(u.merge("document" => did), Document::COLUMNS["units"], %w[anchor notes words])) }
        Array(source["sections"]).each { |x| w.section(x) }
        Array(source["fragments"]).each do |f|
          w.send(:insert, "fragments", pick(f.merge("document" => did), Document::COLUMNS["fragments"], %w[section anchor anchor_end]))
        end
        Array(source["figures"]).each { |g| w.figure(g) }
        Array(source["spaces"]).each { |s| w.space(s) }
        (source["vectors"] || {}).each do |space, v|
          dtype = w.instance_variable_get(:@spaces).dig(space, "dtype") || "f32"
          Array(v["items"]).each do |it|
            vals = it["values"]
            bytes = case dtype
                    when "i8" then vals.map(&:to_i).pack("c*")
                    when "f16" then vals.map { |x| Vectors.float_to_half(x.to_f) }.pack("v*")
                    else vals.map(&:to_f).pack("e*")
                    end
            w.send(:insert, "vectors", { "target" => it["target"], "id" => it["id"], "space" => space, "document" => did,
                                         "data" => SQLite3::Blob.new(bytes) })
          end
        end
        Array(source["blobs"]).each do |b|
          data = Base64.decode64(b["data_base64"].to_s)
          w.send(:insert, "blobs", { "key" => b["key"], "mime" => b["mime"], "sha256" => b["sha256"] || Digest::SHA256.hexdigest(data),
                                     "data" => SQLite3::Blob.new(data) })
        end
        Array(source["provenance"]).each { |p| w.provenance(p) }
        Array(source["extensions"]).each { |e| w.extension(e["name"], e["version"], required: e["required"].to_i != 0) }
        w.finish
      rescue StandardError
        w.abort
        raise
      end
    end

    def self.pick(row, cols, json_cols = [], defaults = {})
      cols.to_h do |c|
        v = row.key?(c) ? row[c] : defaults[c]
        v = (v.nil? || v.is_a?(String) ? v : Json.generate(v)) if json_cols.include?(c)
        [c, v]
      end
    end

    def initialize(path, meta, trigram: false, exact: false)
      @path = path.to_s
      @meta = meta
      @trigram = trigram
      @exact = exact
      @spaces = {}
      @document_id = nil
      @finished = false
      @tmp = File.join(File.dirname(@path), ".#{File.basename(@path)}.#{SecureRandom.hex(4)}.tmp")
      @db = SQLite3::Database.new(@tmp)
      @db.execute("PRAGMA page_size = 4096")
      @db.execute("PRAGMA journal_mode = DELETE")
      @db.execute("PRAGMA application_id = #{Container::APPLICATION_ID}")
      @db.execute("PRAGMA user_version = #{Container::USER_VERSION}")
      @db.execute("PRAGMA trusted_schema = OFF")
      @db.transaction
      @db.execute_batch(SCHEMA)
    end

    def document(d)
      d = d.transform_keys(&:to_s)
      @document_id = d["id"].to_s
      m = d["metadata"].is_a?(Hash) ? d["metadata"] : {}
      created = @meta["created"] || Writer.now
      defaults = {
        "created" => created, "updated" => d["created"] || created, "title" => m["title"],
        "year" => m.dig("issued", "date-parts", 0, 0), "language" => m["language"],
        "authors" => (Array(m["author"]).filter_map { |p| p.is_a?(Hash) ? p["family"] || p["literal"] : nil }.join("; ") if m["author"])
      }
      insert("documents", self.class.pick(d, Document::COLUMNS["documents"], %w[metadata rights], defaults))
      self
    end

    def unit(u)
      u = with_doc(u)
      u["text"] = Text.nfc(u["text"].to_s) if u.key?("text")
      u["printed"] = u["anchor"]["printed"] if !u.key?("printed") && u["anchor"].is_a?(Hash)
      insert("units", self.class.pick(u, Document::COLUMNS["units"], %w[anchor notes words], { "text" => "", "confidence" => 1.0 }))
      self
    end

    def section(s)
      insert("sections", self.class.pick(with_doc(s), Document::COLUMNS["sections"]))
      self
    end

    def fragment(f)
      f = with_doc(f)
      %w[text context search_text].each { |k| f[k] = Text.nfc(f[k]) if f[k].is_a?(String) }
      insert("fragments", self.class.pick(f, Document::COLUMNS["fragments"], %w[section anchor anchor_end], { "context" => "" }))
      self
    end

    def figure(g)
      insert("figures", self.class.pick(with_doc(g), Document::COLUMNS["figures"], %w[anchor]))
      self
    end

    def space(s)
      row = self.class.pick(s.transform_keys(&:to_s), Document::COLUMNS["spaces"], %w[modalities task_prefixes],
                            { "dtype" => "f32", "normalized" => 1, "modalities" => ["text"] })
      @spaces[row["id"]] = row
      insert("spaces", row)
      self
    end

    # A vector given as floats (quantized for f16/i8 as the specification says) or raw bytes.
    def vector(target, id, space, values, document: nil)
      sp = @spaces[space] or raise Error.new("E031", "declare space #{space} before its vectors")
      bytes = values.is_a?(String) ? values.b : Vectors.encode(values, sp["dtype"])
      if bytes.bytesize != sp["dims"].to_i * Vectors.size(sp["dtype"])
        raise Error.new("E030", "vector #{target}/#{id} has the wrong length for space #{space}")
      end

      insert("vectors", { "target" => target, "id" => id, "space" => space, "document" => document || @document_id,
                          "data" => SQLite3::Blob.new(bytes) })
      self
    end

    def blob(key, mime, data)
      insert("blobs", { "key" => key, "mime" => mime, "sha256" => Digest::SHA256.hexdigest(data.b), "data" => SQLite3::Blob.new(data.b) })
      self
    end

    def provenance(p)
      insert("provenance", self.class.pick(with_doc(p), Document::COLUMNS["provenance"], %w[detail]))
      self
    end

    def extension(name, version, required: false)
      insert("extensions", { "name" => name, "version" => version, "required" => required ? 1 : 0 })
      self
    end

    # Finalizes the file and returns its path.
    def finish(content_hash: false)
      return @path if @finished

      meta = @meta.dup
      meta["document_id"] ||= @document_id if !@exact && @document_id
      meta.each { |k, v| insert("spdf_meta", { "key" => k.to_s, "value" => v.to_s }) }
      @db.execute("INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
      if @trigram
        @db.execute(TRIGRAM)
        @db.execute("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
      end
      @db.commit
      if content_hash
        hash = Document.open(@tmp) { |d| d.content_sha256 }
        @db.execute("INSERT INTO spdf_meta(key, value) VALUES ('content_sha256', ?)", [hash])
      end
      @db.execute("VACUUM")
      @db.close
      File.rename(@tmp, @path)
      @finished = true
      @path
    end

    def abort
      return if @finished

      @db.rollback if @db.transaction_active?
      @db.close unless @db.closed?
      FileUtils.rm_f(@tmp)
      @finished = true
    end

    private

    def with_doc(row)
      row = row.transform_keys(&:to_s)
      row["document"] ||= @document_id or raise Error.new("E013", "call document first")
      row
    end

    def insert(table, row)
      cols = row.keys
      sql = "INSERT INTO #{Container.quote(table)} (#{cols.map { |c| Container.quote(c) }.join(", ")}) " \
            "VALUES (#{(["?"] * cols.length).join(", ")})"
      @db.execute(sql, row.values.map { |v| v == true ? 1 : (v == false ? 0 : v) })
    end
  end
end
