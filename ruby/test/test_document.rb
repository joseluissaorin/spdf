# frozen_string_literal: true

require_relative "test_helper"

class TestDocument < Minitest::Test
  def setup
    @file = Fixture.lazarillo
  end

  def test_reads
    Spdf::Document.open(@file) do |d|
      assert_equal "5.0", d.version
      refute d.legacy?
      assert_equal 2, d.units.length
      assert_equal "sha256-#{"3f" * 32}", d.docref
      assert_equal "\x89PNG".b, d.blob("blob:cover")
    end
  end

  def test_validates
    r = Spdf::Validator.validate(@file)
    assert r["valid"], r.inspect
    assert_empty r["warnings"]
  end

  def test_dump_is_canonical
    Spdf::Document.open(@file) do |d|
      j = d.dump_json
      assert j.start_with?('{"blobs":[{"bytes":4,"key":"cover"')
      assert_equal j, Spdf::Json.canonical(JSON.parse(j))
    end
  end

  def test_lexical_search
    Spdf::Document.open(@file) do |d|
      hits = d.search_lexical("lazaro")
      assert_equal "f1", hits[0]["fragment_id"]
      assert_equal "spdf:sha256-#{"3f" * 32}#p=9&f=3&char=0,24", hits[0]["anchor_uri"]
      assert_equal %w[f2], d.search_lexical('"Antona Pérez" Tormes').map { |h| h["fragment_id"] }
      assert_empty d.search_lexical("   ")
    end
  end

  def test_vector_and_hybrid
    Spdf::Document.open(@file) do |d|
      assert_equal %w[f2 f1], d.search_vector([0.6, 0.8, 0.0], space: "toy@3:i8").map { |h| h["fragment_id"] }
      h = d.search_hybrid("Salamanca", [1.0, 0.0, 0.0], space: "toy@3", limit: 2)
      assert_equal "f2", h[0]["fragment_id"]
      assert_equal %w[lexical vector], h[0]["via"]
      assert_in_delta 1.0 / 11 + 1.0 / 12, h[0]["score"], 1e-12
      assert_raises(Spdf::Error) { d.search_vector([1.0], space: "toy@3") }
    end
  end

  def test_citations_and_exports
    Spdf::Document.open(@file) do |d|
      assert_equal "(Lazarillo de Tormes, 1554, p. 3)", d.cite_fragment("f1")
      assert_equal "(Lazarillo de Tormes, 1554, p. [4])", d.cite_fragment("f2", locale: "en")
      assert_equal "lazarillo", JSON.parse(d.csl_json)[0]["id"]
      assert d.bibtex.start_with?("@book{1554vida,")
    end
  end

  def test_rejects_views
    db = SQLite3::Database.new(@file)
    db.execute("CREATE VIEW v AS SELECT 1")
    db.close
    e = assert_raises(Spdf::Error) { Spdf::Document.open(@file) }
    assert_equal "E020", e.code
  end

  def test_limits
    assert_raises(Spdf::Error) { Spdf::Document.open(@file, max_blob_bytes: 2) }
    gz = Fixture.tmp("legacy.spdf")
    File.binwrite(gz, Zlib.gzip(File.binread(@file)))
    assert_raises(Spdf::Error) { Spdf::Document.open(gz, max_inflated_bytes: 1024) }
  end

  def test_anchor_uri
    uri = Spdf::AnchorUri.format("doc 1", { "type" => "section", "path" => ["Cap. 3", "a/b"], "paragraph" => 4,
                                            "region" => { "x" => 0.125, "y" => 0, "w" => 0.5, "h" => 1 } })
    assert_equal "spdf:doc%201#s=Cap.%203/a%2Fb&para=4&xywh=percent:12.5,0,50,100", uri
    p = Spdf::AnchorUri.parse(uri)
    assert_equal ["Cap. 3", "a/b"], p["locator"]["s"]
    assert_equal uri, Spdf::AnchorUri.format_locator(p["docref"], p["locator"])
    assert_raises(Spdf::Error) { Spdf::AnchorUri.parse("spdf:x#p=0") }
  end

  def test_canonical_json
    assert_equal "[1,0.97,0.000001,0,1e+21,0.123457]", Spdf::Json.canonical([1.0, 0.97, 0.000001, -0.0, 1e21, 0.1234567])
    assert_equal '{"a":{},"b":[],"é":"\u001f"}', Spdf::Json.canonical({ "é" => "\x1f", "b" => [], "a" => {} })
  end

  def test_half_floats
    [0.0, 1.0, -2.5, 0.333251953125, 65_504.0].each do |f|
      assert_equal f, Spdf::Vectors.decode(Spdf::Vectors.encode([f], "f16"), "f16")[0]
    end
    assert_equal [76, 102, -127], Spdf::Vectors.encode([0.6, 0.8, -2.0], "i8").unpack("c*")
  end
end
