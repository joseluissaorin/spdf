test_that("lexical search finds old spellings through the modernized layer", {
  doc <- spdf_open(extdata("lazarillo.spdf"))
  on.exit(spdf_close(doc))
  r <- spdf_search(doc, "cosas")
  expect_gt(nrow(r), 0)
  expect_true(all(startsWith(r$anchor_uri, "spdf:sha256-")))
  expect_equal(nrow(spdf_search(doc, "   ")), 0)
})

test_that("citations follow the specification", {
  m <- list(type = "book", title = "El ingenioso hidalgo", author = list(list(family = "Cervantes"), list(family = "Iglesias")),
            issued = list("date-parts" = list(list(1605))))
  expect_equal(spdf_cite(m, list(type = "page", physical = 10, printed = "4", source = "inferred")), "(Cervantes e Iglesias, 1605, p. [4])")
  expect_equal(spdf_cite(m, list(type = "time", t0 = 4160, t1 = 4175.5), locale = "en"), "(Cervantes and Iglesias, 1605, 1:09:20)")
  expect_equal(spdf_cite(list(title = "Rimas: libro"), list(type = "verse", line_from = 3, line_to = 5)), "(Rimas, s. f., vv. 3-5)")
})

test_that("anchor URIs round-trip", {
  a <- list(type = "section", path = list("Cap. 3", "a/b"), paragraph = 4, region = list(x = 0.125, y = 0, w = 0.5, h = 1))
  u <- spdf_anchor_uri("doc 1", a)
  expect_equal(u, "spdf:doc%201#s=Cap.%203/a%2Fb&para=4&xywh=percent:12.5,0,50,100")
  p <- spdf_parse_uri(u)
  expect_equal(unlist(p$locator$s), c("Cap. 3", "a/b"))
  expect_equal(spdf_format_locator(p$docref, p$locator), u)
  expect_error(spdf_parse_uri("spdf:x#p=0"), class = "spdf_error_E040")
})

test_that("writes a file that validates and reads back", {
  out <- tempfile(fileext = ".spdf")
  anchor <- list(type = "page", physical = 1L, printed = "45")
  spdf_write(out,
    document = list(id = "d1", kind = "pdf", source_sha256 = strrep("ab", 32), mime = "application/pdf",
                    bytes = 10L, unit_count = 1L, metadata = list(type = "book", title = "Prueba", issued = list("date-parts" = list(list(2026))))),
    units = list(list(id = "p1", ord = 1L, anchor = anchor, text = "Hola mundo", reader = "manual")),
    fragments = list(list(n = 1L, id = "f1", unit = "p1", ord = 1L, text = "Hola mundo", anchor = anchor)),
    spaces = list(list(id = "toy@2:i8", provider = "test", model = "toy", dims = 2L, dtype = "i8", modalities = list("text"))),
    vectors = list("toy@2:i8" = list(items = list(list(target = "fragment", id = "f1", values = c(0.6, 0.8))))),
    profile = "core semantic")
  expect_true(spdf_validate(out)$valid)
  doc <- spdf_open(out)
  on.exit(spdf_close(doc))
  expect_equal(spdf_search(doc, "mundo")$fragment_id, "f1")
  expect_equal(spdf_search_vector(doc, c(0.6, 0.8), "toy@2:i8")$fragment_id, "f1")
  expect_equal(spdf_cite(spdf_metadata(doc), spdf_fragments(doc)$anchor[[1]]), "(Prueba, 2026, p. 45)")
  expect_match(spdf_bibtex(doc), "^@book\\{prueba2026,")
})

test_that("quantization matches the specification", {
  expect_equal(paste(spdf_vector_encode(c(1.5, -2, 0.1, -0.1), "i8"), collapse = ""), "7f810df3")
  expect_equal(paste(spdf_vector_encode(c(0.1, 65504, 0, 0.333333), "f16"), collapse = ""), "662eff7b00005535")
  expect_error(spdf_vector_encode(65520, "f16"), class = "spdf_error_E030")
})

test_that("corpus helpers count terms by work", {
  files <- c(extdata("quijote.spdf"), extdata("lazarillo.spdf"), extdata("minimo.spdf"))
  corpus <- spdf_corpus(files)
  expect_equal(nrow(corpus), 3)
  counts <- spdf_count_terms(files, c("hijo", "cosas"))
  expect_equal(nrow(counts), 6)
  expect_true(all(c("title", "year", "term", "fragments", "occurrences") %in% names(counts)))
})
