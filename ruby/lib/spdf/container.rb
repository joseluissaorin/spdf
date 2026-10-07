# frozen_string_literal: true

require "sqlite3"
require "tmpdir"
require "zlib"
require "fileutils"

module Spdf
  # Safe opening of a SPDF container (specification §1): read-only, query_only,
  # trusted_schema=OFF, bounded gzip inflation and blob sizes, WAL files copied,
  # triggers and views refused (except the three FTS triggers of legacy 4.x files).
  class Container
    APPLICATION_ID = 1_397_769_286
    USER_VERSION = 500
    LEGACY_TRIGGERS = %w[fragmentos_ai fragmentos_ad fragmentos_au].freeze
    SQLITE_MAGIC = "SQLite format 3\0".b

    # Limits applied when opening untrusted files.
    Options = Struct.new(:max_blob_bytes, :max_inflated_bytes, :temp_dir, keyword_init: true) do
      def initialize(max_blob_bytes: 512 * 1024 * 1024, max_inflated_bytes: 4 * 1024 * 1024 * 1024, temp_dir: nil)
        super
      end
    end

    attr_reader :db, :version, :application_id, :user_version, :tables, :forbidden

    def legacy? = @legacy
    def gzipped? = @gzipped

    def self.open(path, options = Options.new, strict: true)
      c = new
      begin
        c.send(:open_file, path.to_s, options, strict)
      rescue StandardError
        c.close
        raise
      end
      c
    end

    def initialize
      @legacy = false
      @gzipped = false
      @tables = []
      @forbidden = []
      @temp = nil
      @version = nil
    end

    def table?(name) = @tables.include?(name)

    def columns(table)
      return [] unless table?(table)

      @db.execute("PRAGMA table_info(#{Container.quote(table)})").map { |r| r[1] }
    end

    def self.quote(name) = "\"#{name.to_s.gsub('"', '""')}\""

    def close
      @db&.close unless @db&.closed?
      @db = nil
      FileUtils.rm_f(@temp) if @temp
      @temp = nil
    end

    private

    def open_file(path, options, strict)
      raise Error.new("E001", "cannot read file: #{path}") unless File.file?(path) && File.readable?(path)

      head = File.binread(path, 100) || "".b
      real = File.expand_path(path)
      if head.byteslice(0, 2) == "\x1f\x8b".b
        @gzipped = true
        real = inflate(real, options)
        head = File.binread(real, 100) || "".b
      end
      raise Error.new("E001", "not a SQLite database (nor gzip-wrapped SQLite)") unless head.bytesize >= 100 && head.start_with?(SQLITE_MAGIC)

      if head.getbyte(18) == 2 || head.getbyte(19) == 2
        unless @temp
          tmp = new_temp(options)
          FileUtils.cp(real, tmp)
          real = tmp
        end
        File.open(real, "r+b") { |f| f.seek(18) && f.write("\x01\x01".b) }
      end

      begin
        @db = SQLite3::Database.new(real, readonly: true)
        @db.execute("PRAGMA query_only = 1")
        @db.execute("PRAGMA trusted_schema = OFF")
        @db.execute("PRAGMA cell_size_check = ON")
        master = @db.execute("SELECT type, name, sql FROM sqlite_master")
      rescue SQLite3::Exception => e
        raise Error.new("E001", "SQLite cannot read this file: #{e.message}")
      end
      @application_id = @db.get_first_value("PRAGMA application_id").to_i
      @user_version = @db.get_first_value("PRAGMA user_version").to_i
      @tables = master.select { |t, _| t == "table" }.map { |_, n| n }
      detect_version
      allowed = @legacy ? %w[fragmentos_fts] : %w[fragments_fts fragments_fts_trigram]
      master.each do |type, name, sql|
        if type == "table" && sql.to_s.match?(/\A\s*CREATE\s+VIRTUAL\s+TABLE/i) &&
           (!allowed.include?(name) || !sql.match?(/USING\s+fts5\s*\(/i))
          @forbidden << { "type" => "virtual table", "name" => name }
          next
        end
        next unless %w[trigger view].include?(type)
        next if @legacy && type == "trigger" && LEGACY_TRIGGERS.include?(name)

        @forbidden << { "type" => type, "name" => name }
      end
      if strict && !@forbidden.empty?
        f = @forbidden.first
        raise Error.new("E020", "the file contains a #{f["type"]} (#{f["name"]}); refusing to open it")
      end
      check_blob_sizes(options) if strict
    end

    def detect_version
      uv = @user_version
      if @application_id == APPLICATION_ID
        if uv.between?(500, 599)
          @version = "#{uv / 100}.#{(uv % 100) / 10}"
          return
        end
      elsif table?("spdf") && table?("documentos")
        v = begin
          @db.get_first_value("SELECT valor FROM spdf WHERE clave = 'spdf_version'")
        rescue SQLite3::Exception
          nil
        end
        if v.to_s.start_with?("4.")
          @legacy = true
          @version = v.to_s
          return
        end
        if [400, 410].include?(uv)
          @legacy = true
          @version = "#{uv / 100}.#{(uv % 100) / 10}"
          return
        end
      end
      raise Error.new("E002", "unknown application_id or user_version (#{@application_id}, #{uv})")
    end

    def check_blob_sizes(options)
      checks = @legacy ? { "blobs" => "datos", "vectores" => "valores" } : { "blobs" => "data", "vectors" => "data" }
      checks.each do |table, column|
        next unless table?(table)

        max = @db.get_first_value("SELECT coalesce(max(length(#{column})), 0) FROM #{table}").to_i
        if max > options.max_blob_bytes
          raise Error.new("E001", "a blob in #{table} is #{max} bytes, above the limit of #{options.max_blob_bytes}")
        end
      end
    end

    def new_temp(options)
      dir = options.temp_dir || Dir.tmpdir
      @temp = File.join(dir, "spdf-#{Process.pid}-#{rand(1 << 48).to_s(36)}.sqlite")
    end

    def inflate(path, options)
      tmp = new_temp(options)
      total = 0
      File.open(path, "rb") do |io|
        gz = Zlib::GzipReader.new(io)
        File.open(tmp, "wb") do |out|
          while (chunk = gz.read(1 << 20))
            total += chunk.bytesize
            raise Error.new("E001", "inflated size exceeds the limit of #{options.max_inflated_bytes} bytes") if total > options.max_inflated_bytes

            out.write(chunk)
          end
        end
        gz.finish
      end
      tmp
    rescue Zlib::Error => e
      raise Error.new("E001", "bad gzip: #{e.message}")
    end
  end
end
