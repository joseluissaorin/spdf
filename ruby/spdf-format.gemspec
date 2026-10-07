# frozen_string_literal: true

require_relative "lib/spdf/version"

Gem::Specification.new do |s|
  s.name = "spdf-format"
  s.version = Spdf::VERSION
  s.summary = "Read, validate, search, cite and write SPDF (Semantic Processed Document Format) files."
  s.description = <<~DESC
    SPDF is an open format for documents read once and citable forever: every passage
    carries its exact anchor (printed page, folio, second of a recording, slide, verse).
    This gem opens SPDF 5.0 and legacy 4.x files safely, validates them, dumps them
    canonically, runs the reference lexical, vector and hybrid searches, builds anchor
    URIs and short citations, exports CSL-JSON and BibTeX, and writes new files.
  DESC
  s.authors = ["José Luis Saorín Ferrer"]
  s.email = ["jl@joseluissaorin.com"]
  s.homepage = "https://spdf.joseluissaorin.com"
  s.licenses = ["MIT", "Apache-2.0"]
  s.required_ruby_version = ">= 3.1"
  s.metadata = {
    "source_code_uri" => "https://github.com/joseluissaorin/spdf/tree/main/ruby",
    "rubygems_mfa_required" => "true"
  }
  s.files = Dir["lib/**/*.rb", "exe/*", "README.md", "LICENSE-MIT", "LICENSE-APACHE"]
  s.bindir = "exe"
  s.executables = ["spdf"]
  s.require_paths = ["lib"]
  s.add_dependency "sqlite3", ">= 1.6", "< 3"
  s.add_dependency "base64", ">= 0.1"
end
