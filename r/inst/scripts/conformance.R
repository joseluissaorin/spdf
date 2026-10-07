# Runs the shared conformance suite and prints the JSON report (also saved to
# conformance.json in the working directory). Usage:
#   Rscript inst/scripts/conformance.R path/to/spdf/conformance
args <- commandArgs(trailingOnly = TRUE)
dir <- if (length(args) > 0) args[1] else "../conformance"
report <- spdf::spdf_conformance(dir)
json <- spdf::spdf_canonical_json(report)
writeLines(json, "conformance.json", useBytes = TRUE)
cat(json, "\n")
quit(status = if (length(report$failed) == 0) 0 else 1)
