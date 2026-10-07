using SPDF
using Test

const SUITE = normpath(joinpath(@__DIR__, "..", "..", "conformance"))
const FILES = joinpath(SUITE, "files")

function lazarillo(path)
    w = SPDF.Writer(path; generator = "SPDF.jl-tests/1", profile = "core semantic")
    SPDF.document!(w, Dict("id" => "lazarillo", "kind" => "pdf", "source_sha256" => "3f"^32, "mime" => "application/pdf",
        "bytes" => 1000, "unit_count" => 2,
        "metadata" => Dict("type" => "book", "title" => "La vida de Lazarillo de Tormes", "title-short" => "Lazarillo de Tormes",
            "issued" => Dict("date-parts" => [[1554]]))))
    SPDF.unit!(w, Dict("id" => "u1", "ord" => 1, "anchor" => Dict("type" => "page", "physical" => 9, "printed" => "3"),
        "text" => "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes", "reader" => "pdf-text-layer"))
    SPDF.unit!(w, Dict("id" => "u2", "ord" => 2, "anchor" => Dict("type" => "page", "physical" => 10, "printed" => "4", "source" => "inferred"),
        "text" => "hijo de Tomé González y de Antona Pérez, naturales de Tejares", "reader" => "pdf-text-layer"))
    SPDF.fragment!(w, Dict("n" => 1, "id" => "f1", "unit" => "u1", "ord" => 1,
        "text" => "Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes",
        "anchor" => Dict("type" => "page", "physical" => 9, "printed" => "3", "chars" => [0, 24])))
    SPDF.fragment!(w, Dict("n" => 2, "id" => "f2", "unit" => "u2", "ord" => 2,
        "text" => "hijo de Tomé González y de Antona Pérez, naturales de Tejares",
        "anchor" => Dict("type" => "page", "physical" => 10, "printed" => "4", "source" => "inferred")))
    SPDF.space!(w, Dict("id" => "toy@3:i8", "provider" => "test", "model" => "toy", "dims" => 3, "dtype" => "i8"))
    SPDF.vector!(w, "fragment", "f1", "toy@3:i8", [1.0, 0.0, 0.0])
    SPDF.vector!(w, "fragment", "f2", "toy@3:i8", [0.6, 0.8, 0.0])
    SPDF.blob!(w, "cover", "image/png", UInt8[0x89, 0x50, 0x4e, 0x47])
    return SPDF.finish!(w)
end

@testset "SPDF.jl" begin
    path = joinpath(mktempdir(), "lazarillo.spdf")
    lazarillo(path)

    @testset "read, dump, validate" begin
        SPDF.open(path) do doc
            @test doc.version == "5.0"
            @test length(units(doc)) == 2
            @test docref(doc) == "sha256-" * "3f"^32
            @test blob(doc, "blob:cover") == UInt8[0x89, 0x50, 0x4e, 0x47]
            j = dump_json(doc)
            @test startswith(j, "{\"blobs\":[{\"bytes\":4,\"key\":\"cover\"")
            @test canonical_json(SPDF.json_parse(j)) == j
        end
        r = validate(path)
        @test r["valid"]
        @test isempty(r["warnings"])
    end

    @testset "search and cite" begin
        SPDF.open(path) do doc
            hits = search_lexical(doc, "lazaro")
            @test hits[1].fragment_id == "f1"
            @test hits[1].anchor_uri == "spdf:sha256-" * "3f"^32 * "#p=9&f=3&char=0,24"
            @test [h.fragment_id for h in search_lexical(doc, "\"Antona Pérez\" Tormes")] == ["f2"]
            @test isempty(search_lexical(doc, "   "))
            @test [h.fragment_id for h in search_vector(doc, [0.6, 0.8, 0.0], "toy@3:i8")] == ["f2", "f1"]
            h = search_hybrid(doc, "Tejares", [1.0, 0.0, 0.0], "toy@3:i8"; limit = 2)
            @test h[1].fragment_id == "f2" && h[1].via == ["lexical", "vector"]
            @test cite(doc, fragments(doc)[2]["anchor"]; locale = "es") == "(Lazarillo de Tormes, 1554, p. [4])"
            @test startswith(bibtex(doc), "@book{la1554,")
            @test csl_item(doc)["id"] == "la1554"
        end
    end

    @testset "anchor URIs" begin
        a = Dict("type" => "section", "path" => ["Cap. 3", "a/b"], "paragraph" => 4, "region" => Dict("x" => 0.125, "y" => 0, "w" => 0.5, "h" => 1))
        u = anchor_uri("doc 1", a)
        @test u == "spdf:doc%201#s=Cap.%203/a%2Fb&para=4&xywh=percent:12.5,0,50,100"
        p = parse_uri(u)
        @test p["locator"]["s"] == ["Cap. 3", "a/b"]
        @test format_locator(p["docref"], p["locator"]) == u
        @test_throws SpdfError parse_uri("spdf:x#p=0")
    end

    @testset "safety" begin
        copy = joinpath(mktempdir(), "view.spdf")
        cp(path, copy)
        db = SPDF.SQLite.DB(copy)
        SPDF.exec!(db, "CREATE VIEW v AS SELECT 1")
        close(db)
        @test_throws SpdfError SPDF.open(copy)
        @test_throws SpdfError SPDF.open(path; max_blob_bytes = 2)
        bad = joinpath(mktempdir(), "bad.spdf")
        write(bad, "not a database"^10)
        @test validate(bad)["errors"][1]["code"] == "E001"
    end

    @testset "numbers and vectors" begin
        @test canonical_json(Any[1.0, 0.97, 0.000001, -0.0, 1e21, 0.1234567]) == "[1,0.97,0.000001,0,1e+21,0.123457]"
        @test bytes2hex(quantize([1.5, -2, 0.1, -0.1], "i8")) == "7f810df3"
        @test bytes2hex(quantize([0.1, 65504, 0, 0.333333], "f16")) == "662eff7b00005535"
        @test_throws SpdfError quantize([65520], "f16")
        @test SPDF.Ed25519.verify(hex2bytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"), UInt8[],
            hex2bytes("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"))
    end

    @testset "conformance suite" begin
        if isdir(joinpath(SUITE, "cases"))
            r = conformance(SUITE)
            for f in r["failed"]
                @info "failed" f["id"] f["reason"]
            end
            @test isempty(r["failed"])
        else
            @info "conformance suite not found; skipped"
        end
    end
end
