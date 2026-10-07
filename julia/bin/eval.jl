# Test protocol for differential testing: one JSON request per stdin line, one
# JSON answer per line ({"ok": ...} or {"error": "..."}).
using SPDF
for line in eachline(stdin)
    isempty(strip(line)) && continue
    out = try
        "{\"ok\":" * SPDF.canonical_json(SPDF.evaluate(SPDF.json_parse(line))) * "}"
    catch e
        SPDF.canonical_json(Dict("error" => sprint(showerror, e)))
    end
    println(out)
    flush(stdout)
end
