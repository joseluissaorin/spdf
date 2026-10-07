test_that("opens a 5.0 file and reads its parts", {
  doc <- spdf_open(extdata("quijote.spdf"))
  on.exit(spdf_close(doc))
  info <- spdf_info(doc)
  expect_equal(info$version, "5.0")
  expect_false(info$legacy)
  expect_equal(info$year, 1605L)
  u <- spdf_units(doc)
  expect_s3_class(u, "tbl_df")
  expect_equal(u$ord, seq_len(nrow(u)))
  expect_type(u$anchor, "list")
  f <- spdf_fragments(doc)
  expect_true(all(c("id", "text", "anchor", "anchor_end") %in% names(f)))
  expect_match(spdf_docref(doc), "^sha256-[0-9a-f]{64}$")
})

test_that("reads a legacy 4.1 file through the 5.0 view", {
  doc <- spdf_open(extdata("garcilaso.spdf"))
  on.exit(spdf_close(doc))
  expect_true(doc$legacy)
  d <- spdf_dump(doc)
  expect_true(d$legacy)
  expect_equal(d$spdf_version, "4.1")
  expect_equal(vapply(d$units, function(u) u$ord, numeric(1)), seq_along(d$units))
  v <- spdf_validate(extdata("garcilaso.spdf"))
  expect_true(v$valid)
  expect_equal(vapply(v$warnings, function(w) w$code, character(1)), "W110")
})

test_that("validates the sample files", {
  for (f in c("quijote.spdf", "lazarillo.spdf", "minimo.spdf")) {
    expect_true(spdf_validate(extdata(f))$valid, info = f)
  }
  bad <- tempfile(fileext = ".spdf")
  writeLines("not a database", bad)
  expect_equal(spdf_validate(bad)$errors[[1]]$code, "E001")
})

test_that("refuses views, oversized blobs and gzip bombs", {
  copy <- tempfile(fileext = ".spdf")
  file.copy(extdata("minimo.spdf"), copy)
  con <- DBI::dbConnect(RSQLite::SQLite(), copy)
  DBI::dbExecute(con, "CREATE VIEW v AS SELECT 1")
  DBI::dbDisconnect(con)
  expect_error(spdf_open(copy), class = "spdf_error_E020")
  expect_error(spdf_open(extdata("minimo.spdf"), max_blob_bytes = 2), class = "spdf_error_E001")
  expect_error(spdf_open(extdata("garcilaso.spdf"), max_inflated_bytes = 1024), class = "spdf_error_E001")
})

test_that("dump is canonical JSON", {
  doc <- spdf_open(extdata("minimo.spdf"))
  on.exit(spdf_close(doc))
  j <- spdf_dump_json(doc)
  expect_equal(spdf_canonical_json(jsonlite::fromJSON(j, simplifyVector = FALSE)), j)
  expect_equal(spdf_canonical_json(list(1, 0.97, 0.000001, -0, 1e21, 0.1234567)), "[1,0.97,0.000001,0,1e+21,0.123457]")
})
