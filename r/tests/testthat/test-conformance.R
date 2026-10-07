test_that("passes the shared conformance suite", {
  dir <- suite_dir()
  skip_if(is.null(dir), "conformance suite not found (run from the SPDF repository)")
  r <- spdf_conformance(dir)
  expect_equal(length(r$failed), 0, info = paste(vapply(r$failed, function(f) paste(f$id, f$reason), character(1)), collapse = "\n"))
})
