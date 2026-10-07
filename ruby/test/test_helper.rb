# frozen_string_literal: true

$LOAD_PATH.unshift File.expand_path("../lib", __dir__)
require "spdf"
require "minitest/autorun"
require "tmpdir"
require "zlib"

module Fixture
  module_function

  def tmp(name = "t.spdf")
    File.join(Dir.mktmpdir("spdf-test"), name)
  end

  def lazarillo
    path = tmp
    Spdf::Writer.create(path, generator: "spdf-ruby-tests/1", profile: "core semantic") do |w|
      w.document("id" => "lazarillo", "kind" => "pdf",
                 "metadata" => { "type" => "book", "title" => "La vida de Lazarillo de Tormes: y de sus fortunas y adversidades",
                                 "title-short" => "Lazarillo de Tormes", "issued" => { "date-parts" => [[1554]] }, "language" => "es" },
                 "source_sha256" => "3f" * 32, "mime" => "application/pdf", "bytes" => 1000, "unit_count" => 2)
      w.unit("id" => "u1", "ord" => 1, "anchor" => { "type" => "page", "physical" => 9, "printed" => "3", "source" => "read" },
             "text" => "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes", "reader" => "pdf-text-layer")
      w.unit("id" => "u2", "ord" => 2, "anchor" => { "type" => "page", "physical" => 10, "printed" => "4", "source" => "inferred" },
             "text" => "hijo de Tomé González y de Antona Pérez, naturales de Tejares, aldea de Salamanca", "reader" => "pdf-text-layer")
      w.fragment("n" => 1, "id" => "f1", "unit" => "u1", "ord" => 1, "section" => ["Tratado primero"],
                 "text" => "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes",
                 "anchor" => { "type" => "page", "physical" => 9, "printed" => "3", "chars" => [0, 24] })
      w.fragment("n" => 2, "id" => "f2", "unit" => "u2", "ord" => 2,
                 "text" => "hijo de Tomé González y de Antona Pérez, naturales de Tejares, aldea de Salamanca",
                 "anchor" => { "type" => "page", "physical" => 10, "printed" => "4", "source" => "inferred" }, "search_text" => "")
      w.space("id" => "toy@3", "provider" => "test", "model" => "toy", "dims" => 3)
      w.space("id" => "toy@3:i8", "provider" => "test", "model" => "toy", "dims" => 3, "dtype" => "i8")
      %w[toy@3 toy@3:i8].each do |s|
        w.vector("fragment", "f1", s, [1.0, 0.0, 0.0])
        w.vector("fragment", "f2", s, [0.6, 0.8, 0.0])
      end
      w.blob("cover", "image/png", "\x89PNG".b)
      w.provenance("stage" => "read", "provider" => "local", "model" => "gemma-4-e4b", "ms" => 10, "at" => "2026-10-07T10:00:00Z")
    end
    path
  end
end
