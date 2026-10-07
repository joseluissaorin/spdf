extdata <- function(name) system.file("extdata", name, package = "spdf")

suite_dir <- function() {
  candidates <- c(file.path("..", "..", "..", "conformance"), file.path("..", "..", "..", "..", "conformance"))
  for (d in candidates) if (dir.exists(file.path(d, "cases"))) return(normalizePath(d))
  NULL
}
