# Runs the shared conformance suite and prints the JSON report (also saved as
# conformance.json). Usage: julia --project=. bin/conformance.jl ../conformance
using SPDF
dir = isempty(ARGS) ? joinpath(@__DIR__, "..", "..", "conformance") : ARGS[1]
report = SPDF.conformance(dir)
json = SPDF.canonical_json(report)
write("conformance.json", json * "\n")
println(json)
exit(isempty(report["failed"]) ? 0 : 1)
