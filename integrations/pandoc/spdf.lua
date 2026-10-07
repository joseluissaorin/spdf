--[[
spdf.lua: a Pandoc Lua filter that turns SPDF anchor URIs written as citations
into real citations, with the folio printed in the source.

  [@spdf:sha256-<64 hex>#p=29]           physical page 29, cited by its printed folio
  [see @spdf:sha256-<hex>#f=21, emphasis added]
  @spdf:<document id>#p=3                in-text citation
  [@{spdf:sha256-<hex>#p=2&pe=3}]        braced form: the whole URI is the key

Run it before citeproc:

  pandoc paper.md --lua-filter spdf.lua --citeproc -o paper.pdf

SPDF files are read with the sqlite3 command-line tool (read-only, safe mode,
defensive, trusted_schema off); nothing from a file is ever executed.
Specification: spec/SPEC.md (SPDF 5.0) in https://github.com/joseluissaorin/spdf

Copyright 2026 José Luis Saorín Ferrer. MIT OR Apache-2.0.
]]

local VERSION = "1.0.0"

local stringify = pandoc.utils.stringify

if not (pandoc.json and pandoc.json.decode and pandoc.json.encode) then
  error("spdf.lua needs pandoc 3.1.1 or later (the pandoc.json module is missing)")
end

local JSON_NULL = pandoc.json.null
local SPDF_APPLICATION_ID = 1397769286
local MAX_GUNZIP = 4 * 1024 * 1024 * 1024 -- bytes, SPEC §2.3
local MAX_VALUE = 512 * 1024 * 1024 -- bytes, SPEC §2.4
local MARK = "@@spdf-lua-output@@"

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

local function is_null(v)
  return v == nil or v == JSON_NULL
end

local function warn(msg)
  msg = "spdf: " .. msg
  if pandoc.log and pandoc.log.warn then
    pandoc.log.warn(msg)
  else
    io.stderr:write("[WARNING] " .. msg .. "\n")
  end
end

-- JSON numbers come back as floats; give integers back when they are integral.
local function int(v)
  if type(v) == "number" then
    return math.tointeger(v)
  end
  return nil
end

local function str(v)
  if is_null(v) then
    return nil
  end
  if type(v) == "number" then
    local i = math.tointeger(v)
    return i and tostring(i) or tostring(v)
  end
  return tostring(v)
end

local function basename(p)
  return pandoc.path.filename(p)
end

local function is_empty(v)
  if is_null(v) or v == "" then
    return true
  end
  return type(v) == "table" and next(v) == nil
end

local function shallow_copy(t)
  local out = {}
  for k, v in pairs(t) do
    out[k] = v
  end
  return out
end

-- Remove nulls and empty containers recursively (CSL items never need them).
local function clean(v)
  if type(v) ~= "table" then
    return v
  end
  local out = {}
  if #v > 0 then
    for _, x in ipairs(v) do
      if not is_empty(x) then
        out[#out + 1] = clean(x)
      end
    end
  else
    for k, x in pairs(v) do
      if not is_empty(x) then
        out[k] = clean(x)
      end
    end
  end
  return out
end

local function json_decode(s)
  local ok, v = pcall(pandoc.json.decode, s, false)
  if ok then
    return v
  end
  return nil
end

-- ---------------------------------------------------------------------------
-- Percent-encoding (SPEC §5.1)
-- ---------------------------------------------------------------------------

local function pct_decode(s)
  local i = 1
  while true do
    local p = s:find("%", i, true)
    if not p then
      break
    end
    if not s:sub(p + 1, p + 2):match("^%x%x$") then
      return nil, "bad percent-encoding in " .. s
    end
    i = p + 3
  end
  local out = s:gsub("%%(%x%x)", function(h)
    return string.char(tonumber(h, 16))
  end)
  if not utf8.len(out) then
    return nil, "percent-encoding does not decode to UTF-8 in " .. s
  end
  return out
end

local function pct_encode(s)
  return (s:gsub("[^A-Za-z0-9%-%._~]", function(c)
    return string.format("%%%02X", c:byte())
  end))
end

-- Shortest decimal form without exponent, for t and xywh values.
local function num_text(x)
  local i = math.tointeger(x)
  if i then
    return tostring(i)
  end
  for digits = 1, 17 do
    local s = string.format("%." .. digits .. "f", x)
    if tonumber(s) == x then
      s = s:gsub("0+$", ""):gsub("%.$", "")
      return s
    end
  end
  return string.format("%.6f", x)
end

local function round(x, places)
  local m = 10 ^ places
  local r = math.floor(x * m + 0.5) / m
  return math.tointeger(r) or r
end

-- ---------------------------------------------------------------------------
-- Anchor URI fragment (SPEC §5)
-- ---------------------------------------------------------------------------

local PARAM_ORDER = { "p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh" }

-- Characters a parameter value may hold while it is read out of running
-- text: the union of every parameter's characters (unreserved, "%", the ":",
-- "," and "/" separators of t, s, ref, char and xywh) plus non-ASCII bytes for
-- the IRI form. Each value is validated afterwards.
local VALUE = "[A-Za-z0-9%%%._~:,/%-\128-\255]*"

-- Prose punctuation that may stick to the end of an in-text citation.
local TRAILING = { ".", ",", ":", ";", "!", "?", "\194\187", "\226\128\157", "\226\128\153", "\226\128\166" }

local function trim_trailing(s)
  local changed = true
  while changed and s ~= "" do
    changed = false
    for _, p in ipairs(TRAILING) do
      if #s >= #p and s:sub(-#p) == p then
        s = s:sub(1, -#p - 1)
        changed = true
      end
    end
  end
  return s
end

-- Read "name=value(&name=value)*" from the start of s. Returns the list of
-- {name, raw} pairs and the unread remainder of s. With trim, prose
-- punctuation stuck to the last value ("p=29." at the end of a sentence)
-- is left in the remainder.
local function scan_params(s, trim)
  local params, pos = {}, 1
  while true do
    local name, value, nxt = s:match("^([A-Za-z]+)=(" .. VALUE .. ")()", pos)
    if not name then
      break
    end
    local more = s:match("^&[A-Za-z]+=", nxt)
    if more then
      params[#params + 1] = { name = name, raw = value }
      pos = nxt + 1
    else
      local trimmed = trim and trim_trailing(value) or value
      params[#params + 1] = { name = name, raw = trimmed }
      pos = nxt - (#value - #trimmed)
      break
    end
  end
  return params, s:sub(pos)
end

local function parse_uint(s, positive)
  if not s or not s:match("^%d+$") or (s:match("^0%d") ~= nil) then
    return nil
  end
  local n = math.tointeger(tonumber(s))
  if not n or (positive and n < 1) then
    return nil
  end
  return n
end

local function parse_npt(s)
  if s:match("^%d+$") or s:match("^%d+%.%d+$") then
    return tonumber(s)
  end
  local h, m, sec = s:match("^(%d+):([0-5]?%d):([0-5]%d%.?%d*)$")
  if not h then
    m, sec = s:match("^([0-5]?%d):([0-5]%d%.?%d*)$")
    h = "0"
  end
  if not m or sec:match("%.$") then
    return nil
  end
  return round(tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(sec), 6)
end

-- Validate the scanned parameters into a locator (SPEC §5.3).
local function make_locator(params)
  local L, unknown = {}, {}
  for _, prm in ipairs(params) do
    local k, v = prm.name, prm.raw
    if L[k] ~= nil then
      return nil, "repeated parameter " .. k
    end
    local bad = function(why)
      return nil, string.format("malformed parameter %s=%s%s", k, v, why and (" (" .. why .. ")") or "")
    end
    if k == "p" or k == "pe" or k == "sl" or k == "para" then
      local n = parse_uint(v, k ~= "para")
      if not n then
        return bad(k == "para" and "an integer" or "an integer from 1")
      end
      L[k] = n
    elseif k == "f" or k == "fe" or k == "sh" then
      local d, err = pct_decode(v)
      if not d or d == "" then
        return bad(err)
      end
      L[k] = d
    elseif k == "t" then
      local body = v:gsub("^npt:", "")
      local xs = {}
      for piece in (body .. ","):gmatch("([^,]*),") do
        local x = parse_npt(piece)
        if not x then
          return bad("seconds or h:mm:ss")
        end
        xs[#xs + 1] = x
      end
      if #xs < 1 or #xs > 2 or (xs[2] and xs[2] < xs[1]) then
        return bad()
      end
      L[k] = xs
    elseif k == "s" then
      local path = {}
      for piece in (v .. "/"):gmatch("([^/]*)/") do
        local d, err = pct_decode(piece)
        if not d then
          return bad(err)
        end
        path[#path + 1] = d
      end
      L[k] = path
    elseif k == "rows" then
      local a, b = v:match("^(%d+)%-(%d+)$")
      a, b = parse_uint(a), parse_uint(b)
      if not a or not b then
        return bad("rows=a-b")
      end
      L[k] = { a, b }
    elseif k == "v" then
      local a, b = v:match("^(%d+)%-(%d+)$")
      if not a then
        a = v
      end
      local na, nb = parse_uint(a), b and parse_uint(b)
      if not na or (b and not nb) then
        return bad("v=line or v=from-to")
      end
      L[k] = nb and { na, nb } or { na }
    elseif k == "ref" then
      local scheme, ref = v:match("^([^:]+):(.*)$")
      if not scheme then
        return bad("ref=scheme:reference")
      end
      local ds, e1 = pct_decode(scheme)
      local dr, e2 = pct_decode(ref)
      if not ds or not dr then
        return bad(e1 or e2)
      end
      L[k] = { scheme = ds, ref = dr }
    elseif k == "char" then
      local a, b = v:match("^(%d+),(%d+)$")
      a, b = parse_uint(a), parse_uint(b)
      if not a or not b or b < a then
        return bad("char=start,end")
      end
      L[k] = { a, b }
    elseif k == "xywh" then
      local body = v:match("^percent:(.*)$")
      if not body then
        return bad("xywh needs percent:")
      end
      local xs = {}
      for piece in (body .. ","):gmatch("([^,]*),") do
        if not (piece:match("^%d+$") or piece:match("^%d+%.%d+$")) then
          return bad()
        end
        xs[#xs + 1] = round(tonumber(piece) / 100, 6)
      end
      if #xs ~= 4 then
        return bad()
      end
      L[k] = xs
    else
      unknown[#unknown + 1] = k
    end
  end
  return L, nil, unknown
end

-- Canonical text of a locator (SPEC §5.1), used for links and messages.
local function format_locator(L)
  local parts = {}
  for _, k in ipairs(PARAM_ORDER) do
    local v = L[k]
    if v ~= nil then
      local s
      if k == "p" or k == "pe" or k == "para" or k == "sl" then
        s = tostring(v)
      elseif k == "f" or k == "fe" or k == "sh" then
        s = pct_encode(v)
      elseif k == "t" then
        local xs = {}
        for i, x in ipairs(v) do
          xs[i] = num_text(round(x, 6))
        end
        s = table.concat(xs, ",")
      elseif k == "s" then
        local xs = {}
        for i, x in ipairs(v) do
          xs[i] = pct_encode(x)
        end
        s = table.concat(xs, "/")
      elseif k == "rows" then
        s = v[1] .. "-" .. v[2]
      elseif k == "v" then
        s = table.concat(v, "-")
      elseif k == "ref" then
        s = pct_encode(v.scheme) .. ":" .. pct_encode(v.ref)
      elseif k == "char" then
        s = v[1] .. "," .. v[2]
      elseif k == "xywh" then
        local xs = {}
        for i, x in ipairs(v) do
          xs[i] = num_text(round(x * 100, 4))
        end
        s = "percent:" .. table.concat(xs, ",")
      end
      parts[#parts + 1] = k .. "=" .. s
    end
  end
  return table.concat(parts, "&")
end

-- ---------------------------------------------------------------------------
-- The sqlite3 command-line tool
-- ---------------------------------------------------------------------------

local sqlite = { bin = "sqlite3", checked = false, safe = false }

local function sqlite_check()
  if sqlite.checked then
    return
  end
  local ok, out = pcall(pandoc.pipe, sqlite.bin, { "-version" }, "")
  if not ok or type(out) ~= "string" then
    error("spdf.lua: the sqlite3 command-line tool was not found (looked for '" .. sqlite.bin
      .. "'). Install it (macOS ships it; Debian/Ubuntu: apt install sqlite3; Fedora: dnf install sqlite)"
      .. " or point the metadata field spdf-sqlite3 at it.", 0)
  end
  local a, b, c = out:match("^(%d+)%.(%d+)%.?(%d*)")
  local version = a and (tonumber(a) * 1000000 + tonumber(b) * 1000 + (tonumber(c) or 0)) or 0
  if version < 3033000 then
    error("spdf.lua: sqlite3 3.33 or later is required for JSON output; found " .. (out:match("^%S+") or "?"), 0)
  end
  sqlite.safe = version >= 3037000
  sqlite.checked = true
end

local DEVNULL = (pandoc.system.os == "mingw32") and "NUL" or "/dev/null"

-- Run one read-only query and return its rows as Lua tables.
local function sqlite_rows(db, sql)
  sqlite_check()
  local args = { "-init", DEVNULL, "-readonly", "-batch", "-bail" }
  if sqlite.safe then
    args[#args + 1] = "-safe"
  end
  args[#args + 1] = db
  local script = table.concat({
    ".dbconfig defensive on",
    "PRAGMA trusted_schema = OFF;",
    "PRAGMA query_only = 1;",
    "PRAGMA mmap_size = 0;",
    "PRAGMA cell_size_check = ON;",
    ".limit length " .. MAX_VALUE,
    ".print " .. MARK,
    ".mode json",
    sql .. ";",
    "",
  }, "\n")
  local ok, out = pcall(pandoc.pipe, sqlite.bin, args, script)
  if not ok then
    return nil, "sqlite3 could not read it"
  end
  local _, mark_end = out:find(MARK, 1, true)
  if not mark_end then
    return nil, "unexpected sqlite3 output"
  end
  local body = out:sub(mark_end + 1)
  if body:match("^[ \t\r\n]*$") then
    return {}
  end
  local rows = json_decode(body)
  if type(rows) ~= "table" then
    return nil, "unexpected sqlite3 output"
  end
  return rows
end

-- ---------------------------------------------------------------------------
-- Legacy 4.x view (SPEC §20.1)
-- ---------------------------------------------------------------------------

local LEGACY_ANCHOR_TYPE = { pagina = "page", tiempo = "time", seccion = "section", diapositiva = "slide",
  hoja = "sheet", web = "web", imagen = "image" }
local LEGACY_ANCHOR_KEY = { tipo = "type", fisica = "physical", impresa = "printed", romana = "roman",
  origen = "source", confianza = "confidence", hablante = "speaker", ruta = "path", parrafo = "paragraph",
  n = "n", hoja = "sheet", filaDesde = "row_from", filaHasta = "row_to", consultada = "accessed", region = "region" }
local LEGACY_SOURCE = { leido = "read", deducido = "inferred", epub = "epub", ninguno = "none" }
local LEGACY_FIELD = { titulo = "title", subtitulo = "spdf.subtitle", tituloOriginal = "original-title",
  autores = "author", editores = "editor", traductores = "translator", entrevistadores = "interviewer",
  anio = "issued", anioOriginal = "original-date", editorial = "publisher", lugar = "publisher-place",
  revista = "container-title", contenedor = "container-title", coleccion = "collection-title",
  volumen = "volume", numero = "issue", paginas = "page", edicion = "edition", doi = "DOI", isbn = "ISBN",
  url = "URL", idioma = "language", tipoCSL = "type", resumen = "abstract",
  idiomaOriginal = "spdf.original_language", fecha = "issued", sinFecha = "spdf.undated" }
local LEGACY_PROVENANCE_SOURCE = { lectura = "reading", usuario = "user", colofon = "colophon",
  impresores = "printers" }
local LEGACY_DEFAULT_TYPE = { audio = "speech", video = "motion_picture", web = "webpage",
  presentacion = "speech", hoja = "dataset", imagen = "graphic", fotos = "graphic" }

local function legacy_anchor(a)
  if type(a) ~= "table" then
    return a
  end
  local out = {}
  for k, v in pairs(a) do
    local key = LEGACY_ANCHOR_KEY[k] or k
    if k == "tipo" then
      v = LEGACY_ANCHOR_TYPE[v] or v
    elseif k == "origen" then
      v = LEGACY_SOURCE[v] or v
    end
    out[key] = v
  end
  return out
end

local function legacy_names(people)
  local out = {}
  if type(people) ~= "table" then
    return out
  end
  for _, a in ipairs(people) do
    local n = {}
    if not is_empty(a.apellidos) then
      n.family = a.apellidos
    end
    if not is_empty(a.nombre) then
      n.given = a.nombre
    end
    if next(n) then
      out[#out + 1] = n
    end
  end
  return out
end

local function date_parts(iso)
  if type(iso) ~= "string" then
    return nil
  end
  local y, rest = iso:match("^[ \t]*(%-?%d%d?%d?%d?)(.*)$")
  if not y then
    return nil
  end
  local parts = { math.tointeger(tonumber(y)) }
  local m, rest2 = rest:match("^%-(%d%d?)(.*)$")
  if m then
    parts[2] = math.tointeger(tonumber(m))
    local d = rest2:match("^%-(%d%d?)")
    if d then
      parts[3] = math.tointeger(tonumber(d))
    end
  end
  return parts
end

local function legacy_metadata(m, kind)
  local function has(k)
    return not is_empty(m[k])
  end
  local item, spdf = {}, {}
  if has("tipoCSL") then
    item.type = m.tipoCSL
  elseif has("revista") then
    item.type = "article-journal"
  else
    item.type = LEGACY_DEFAULT_TYPE[kind] or "book"
  end
  local title = has("titulo") and m.titulo or ""
  if has("subtitulo") then
    item.title = title .. ": " .. m.subtitulo
    item["title-short"] = title
    spdf.subtitle = m.subtitulo
  else
    item.title = title
  end
  if has("tituloOriginal") then
    item["original-title"] = m.tituloOriginal
  end
  local orcid = {}
  for _, pair in ipairs({ { "autores", "author" }, { "editores", "editor" }, { "traductores", "translator" },
    { "entrevistadores", "interviewer" } }) do
    local names = legacy_names(m[pair[1]])
    if #names > 0 then
      item[pair[2]] = names
    end
    if type(m[pair[1]]) == "table" then
      for _, a in ipairs(m[pair[1]]) do
        if not is_empty(a.orcid) then
          local key = (a.apellidos or "") .. (is_empty(a.nombre) and "" or (", " .. a.nombre))
          orcid[key] = a.orcid
        end
      end
    end
  end
  local fecha = has("fecha") and date_parts(m.fecha) or nil
  if fecha and (not has("anio") or fecha[1] == int(m.anio)) then
    item.issued = { ["date-parts"] = { fecha } }
  elseif has("anio") then
    item.issued = { ["date-parts"] = { { int(m.anio) or m.anio } } }
  end
  if has("anioOriginal") then
    item["original-date"] = { ["date-parts"] = { { int(m.anioOriginal) or m.anioOriginal } } }
  end
  for _, pair in ipairs({ { "editorial", "publisher" }, { "lugar", "publisher-place" },
    { "coleccion", "collection-title" }, { "volumen", "volume" }, { "numero", "issue" }, { "paginas", "page" },
    { "edicion", "edition" }, { "doi", "DOI" }, { "isbn", "ISBN" }, { "url", "URL" }, { "idioma", "language" },
    { "resumen", "abstract" } }) do
    if has(pair[1]) then
      item[pair[2]] = m[pair[1]]
    end
  end
  if has("revista") then
    item["container-title"] = m.revista
  elseif has("contenedor") then
    item["container-title"] = m.contenedor
  end
  if has("idiomaOriginal") then
    spdf.original_language = m.idiomaOriginal
  end
  if has("sinFecha") and type(m.sinFecha) == "table" then
    local u = {}
    if not is_null(m.sinFecha.desde) then
      u.from = m.sinFecha.desde
    end
    if not is_null(m.sinFecha.hasta) then
      u.to = m.sinFecha.hasta
    end
    if not is_empty(m.sinFecha.fundamento) then
      u.basis = m.sinFecha.fundamento
    end
    spdf.undated = u
  end
  if has("procedencia") and type(m.procedencia) == "table" then
    local prov = {}
    for campo, v in pairs(m.procedencia) do
      local key = LEGACY_FIELD[campo] or campo
      key = key:gsub("^spdf%.", "")
      if type(v) == "table" then
        prov[key] = { source = LEGACY_PROVENANCE_SOURCE[v.fuente] or v.fuente, confidence = v.confianza }
      end
    end
    spdf.provenance = prov
  end
  if next(orcid) then
    spdf.orcid = orcid
  end
  if next(spdf) then
    item.spdf = spdf
  end
  return item
end

-- ---------------------------------------------------------------------------
-- Opening SPDF files (SPEC §2.3, §2.4, §20)
-- ---------------------------------------------------------------------------

local state = {
  tmp = nil, -- temporary directory for decompressed legacy files
  ntmp = 0,
  library = nil, -- {by_hash = {}, by_id = {}, files = {}}
}

local function read_head(path, n)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local head = f:read(n) or ""
  f:close()
  return head
end

local function gunzip(path)
  state.ntmp = state.ntmp + 1
  local dest = pandoc.path.join({ state.tmp, string.format("legacy-%d.sqlite", state.ntmp) })
  local ok = pcall(pandoc.pipe, "sh",
    { "-c", 'gzip -dc -- "$1" 2>/dev/null | head -c "$3" > "$2"', "sh", path, dest, tostring(MAX_GUNZIP + 1) }, "")
  if not ok then
    -- No POSIX shell (Windows): decompress in memory, without a size limit.
    local ok2, data = pcall(pandoc.pipe, "gzip", { "-dc", path }, "")
    if not ok2 then
      return nil, "it is gzip-compressed and gzip could not decompress it (E001)"
    end
    local f = io.open(dest, "wb")
    f:write(data)
    f:close()
  end
  local f = io.open(dest, "rb")
  if not f then
    return nil, "it is gzip-compressed and could not be decompressed (E001)"
  end
  local size = f:seek("end")
  f:close()
  if size == 0 then
    return nil, "it is gzip-compressed but could not be decompressed (bad gzip data, or no gzip tool) (E001)"
  end
  if size > MAX_GUNZIP then
    return nil, "its gzip payload is larger than 4 GiB"
  end
  return dest
end

local ALLOWED_VTABLES = { fragments_fts = true, fragments_fts_trigram = true }
local LEGACY_TRIGGERS = { fragmentos_ai = true, fragmentos_ad = true, fragmentos_au = true }

local CHECK_SQL = [[
SELECT 'app' AS k, application_id AS a, NULL AS b, NULL AS c FROM pragma_application_id
UNION ALL SELECT 'uv', user_version, NULL, NULL FROM pragma_user_version
UNION ALL SELECT 'obj', type, name,
  CASE WHEN type = 'table' AND upper(sql) LIKE 'CREATE VIRTUAL TABLE%' THEN sql END
  FROM sqlite_master WHERE type IN ('table', 'view', 'trigger')]]

local function open_spdf(path)
  local head = read_head(path, 100)
  if not head then
    return nil, "it cannot be read"
  end
  local db = path
  if head:sub(1, 2) == "\31\139" then
    local dest, err = gunzip(path)
    if not dest then
      return nil, err
    end
    db = dest
    head = read_head(db, 100) or ""
  end
  if head:sub(1, 16) ~= "SQLite format 3\0" then
    return nil, "it is not a SQLite database (E001)"
  end
  local rows, err = sqlite_rows(db, CHECK_SQL)
  if not rows then
    return nil, err
  end
  local app, uv, tables, bad = nil, nil, {}, {}
  for _, r in ipairs(rows) do
    if r.k == "app" then
      app = int(r.a)
    elseif r.k == "uv" then
      uv = int(r.a)
    elseif r.a == "table" then
      tables[r.b] = true
      if not is_null(r.c) then
        local sql = tostring(r.c):lower()
        if not (ALLOWED_VTABLES[r.b] or r.b == "fragmentos_fts") or not sql:find("using[ \t\r\n]+fts5") then
          bad[#bad + 1] = "virtual table " .. r.b
        end
      end
    elseif r.a == "view" then
      bad[#bad + 1] = "view " .. r.b
    elseif r.a == "trigger" then
      bad[#bad + 1] = "trigger " .. r.b
    end
  end
  local legacy
  if app == SPDF_APPLICATION_ID then
    if not uv or uv < 500 or uv > 599 then
      return nil, "it declares an SPDF version this filter does not know (user_version " .. tostring(uv) .. ", E002)"
    end
    legacy = false
  elseif tables.spdf and tables.documentos and tables.unidades then
    legacy = true
  else
    return nil, "it is not an SPDF file (unknown application_id, E002)"
  end
  if legacy then
    local filtered = {}
    for _, b in ipairs(bad) do
      local name = b:match("^trigger (.*)$")
      if not (name and LEGACY_TRIGGERS[name]) then
        filtered[#filtered + 1] = b
      end
    end
    bad = filtered
  end
  if #bad > 0 then
    table.sort(bad)
    return nil, "it contains " .. table.concat(bad, ", ")
      .. "; SPDF files must not carry triggers, views or foreign virtual tables (E020)"
  end
  local doc = { path = path, db = db, legacy = legacy, name = basename(path) }
  local drows
  if legacy then
    drows, err = sqlite_rows(db, "SELECT (SELECT valor FROM spdf WHERE clave = 'spdf_version') AS version, "
      .. "id, tipo AS kind, metadatos AS metadata, huella AS source_sha256 FROM documentos LIMIT 2")
  else
    if not (tables.documents and tables.units) then
      return nil, "it lacks the documents or units table (E010)"
    end
    drows, err = sqlite_rows(db,
      "SELECT id, kind, metadata, source_sha256 FROM documents LIMIT 2")
  end
  if not drows then
    return nil, err
  end
  if #drows ~= 1 then
    return nil, "its documents table does not hold exactly one row (E013)"
  end
  local d = drows[1]
  if legacy then
    local v = str(d.version)
    if not (v and v:match("^4%.")) and uv ~= 400 and uv ~= 410 then
      return nil, "it is not an SPDF file (no 4.x version, E002)"
    end
    doc.version = v or (uv == 400 and "4.0" or "4.1")
  else
    doc.version = string.format("%d.%d", uv // 100, (uv % 100) // 10)
  end
  doc.id = str(d.id)
  doc.kind = str(d.kind)
  local hash = str(d.source_sha256)
  if hash and hash:lower():match("^" .. string.rep("%x", 64) .. "$") then
    doc.hash = hash:lower()
  end
  local meta = type(d.metadata) == "string" and json_decode(d.metadata) or nil
  if type(meta) ~= "table" then
    return nil, "its metadata is not valid JSON (E050)"
  end
  if legacy then
    meta = legacy_metadata(meta, doc.kind)
  end
  if type(meta.type) ~= "string" or type(meta.title) ~= "string" or meta.title == "" then
    return nil, "its metadata has no CSL type and title (E051)"
  end
  doc.csl = meta
  return doc
end

local function load_units(doc)
  if doc.units then
    return doc.units
  end
  local sql = doc.legacy
    and "SELECT id, orden AS ord, ancla AS anchor, impresa AS printed FROM unidades ORDER BY orden, id"
    or "SELECT id, ord, anchor, printed FROM units ORDER BY ord"
  local rows, err = sqlite_rows(doc.db, sql)
  doc.units, doc.by_physical, doc.by_printed = {}, {}, {}
  if not rows then
    warn(string.format("cannot read the units of %s: %s", doc.name, err))
    return doc.units
  end
  local skipped = 0
  for i, r in ipairs(rows) do
    local a = type(r.anchor) == "string" and json_decode(r.anchor) or nil
    if doc.legacy then
      a = legacy_anchor(a)
    end
    if type(a) == "table" and type(a.type) == "string" then
      local u = { id = str(r.id), ord = i, anchor = a }
      doc.units[#doc.units + 1] = u
      if a.type == "page" and int(a.physical) and not doc.by_physical[int(a.physical)] then
        doc.by_physical[int(a.physical)] = u
      end
      local printed = str(a.printed)
      if printed and (a.type == "page" or a.type == "section" or a.type == "web" or a.type == "verse") then
        doc.by_printed[printed] = doc.by_printed[printed] or {}
        table.insert(doc.by_printed[printed], u)
      end
    else
      skipped = skipped + 1
    end
  end
  if skipped > 0 then
    warn(string.format("%s: %d units with an invalid anchor were ignored (E040)", doc.name, skipped))
  end
  return doc.units
end

-- ---------------------------------------------------------------------------
-- Options and the library
-- ---------------------------------------------------------------------------

local opts = {
  library = nil, -- list of path strings
  locale = "en", -- "en" or "es": texts this filter writes itself
  links = false,
  csl_locale = "en-US", -- the locale citeproc will use
}

local function meta_strings(v)
  if v == nil then
    return nil
  end
  if pandoc.utils.type(v) == "List" then
    local out = {}
    for _, x in ipairs(v) do
      out[#out + 1] = stringify(x)
    end
    return out
  end
  return { stringify(v) }
end

local function path_exists(p)
  if pcall(pandoc.system.list_directory, p) then
    return "dir"
  end
  local f = io.open(p, "rb")
  if f then
    f:close()
    return "file"
  end
  return nil
end

local function resolve_path(p)
  if p:sub(1, 2) == "~/" and os.getenv("HOME") then
    p = pandoc.path.join({ os.getenv("HOME"), p:sub(3) })
  end
  if pandoc.path.is_absolute(p) then
    return pandoc.path.normalize(p)
  end
  local cwd = pandoc.system.get_working_directory()
  local c1 = pandoc.path.normalize(pandoc.path.join({ cwd, p }))
  if path_exists(c1) then
    return c1
  end
  local input = PANDOC_STATE.input_files and PANDOC_STATE.input_files[1]
  if input and input ~= "-" then
    local c2 = pandoc.path.normalize(pandoc.path.join({ cwd, pandoc.path.directory(input), p }))
    if path_exists(c2) then
      return c2
    end
  end
  return c1
end

local function style_default_locale(meta)
  local csl = meta.csl or meta["citation-style"]
  if not csl then
    return nil
  end
  csl = stringify(csl)
  if csl:match("^[A-Za-z][A-Za-z0-9+.%-]*://") then
    return nil
  end
  local candidates = { csl, csl .. ".csl" }
  if PANDOC_STATE.user_data_dir then
    candidates[#candidates + 1] = pandoc.path.join({ PANDOC_STATE.user_data_dir, "csl", csl })
    candidates[#candidates + 1] = pandoc.path.join({ PANDOC_STATE.user_data_dir, "csl", csl .. ".csl" })
  end
  for _, c in ipairs(candidates) do
    local head = read_head(resolve_path(c), 4096)
    if head then
      return head:match('default%-locale="([^"]+)"')
    end
  end
  return nil
end

local function read_options(meta)
  opts.library = meta_strings(meta["spdf-library"])
  if not opts.library then
    opts.library = { "." }
    local input = PANDOC_STATE.input_files and PANDOC_STATE.input_files[1]
    if input and input ~= "-" then
      opts.library[2] = pandoc.path.directory(input)
    end
  end
  local lang = meta.lang and stringify(meta.lang) or nil
  local loc = meta["spdf-locale"] and stringify(meta["spdf-locale"]) or lang or "en"
  opts.locale = ((loc:match("^([A-Za-z]+)") or ""):lower() == "es") and "es" or "en"
  local links = meta["spdf-links"]
  opts.links = links == true or (links ~= nil and links ~= false and stringify(links):lower() == "true")
  if meta["spdf-sqlite3"] then
    sqlite.bin = stringify(meta["spdf-sqlite3"])
  end
  opts.csl_locale = lang or style_default_locale(meta) or "en-US"
end

local function load_library()
  if state.library then
    return state.library
  end
  local lib = { by_hash = {}, by_id = {}, files = {} }
  state.library = lib
  local seen = {}
  local files = {}
  for _, entry in ipairs(opts.library) do
    local p = resolve_path(entry)
    local kind = path_exists(p)
    if kind == "dir" then
      local names = pandoc.system.list_directory(p)
      table.sort(names)
      for _, n in ipairs(names) do
        if n:match("%.[Ss][Pp][Dd][Ff]$") then
          local fp = pandoc.path.join({ p, n })
          if not seen[fp] then
            seen[fp] = true
            files[#files + 1] = fp
          end
        end
      end
    elseif kind == "file" then
      if not seen[p] then
        seen[p] = true
        files[#files + 1] = p
      end
    else
      warn("library path not found: " .. entry)
    end
  end
  for _, fp in ipairs(files) do
    local doc, err = open_spdf(fp)
    if not doc then
      warn(string.format("skipping %s: %s", basename(fp), err))
    else
      lib.files[#lib.files + 1] = doc
      if doc.hash then
        local prev = lib.by_hash[doc.hash]
        if prev then
          warn(string.format("%s and %s hold the same document (sha256-%s); using %s",
            prev.name, doc.name, doc.hash:sub(1, 12), prev.name))
        else
          lib.by_hash[doc.hash] = doc
        end
      end
      if doc.id then
        lib.by_id[doc.id] = lib.by_id[doc.id] or {}
        table.insert(lib.by_id[doc.id], doc)
      end
    end
  end
  return lib
end

local function find_document(docref)
  local lib = load_library()
  local hash = docref:match("^sha256%-(.*)$")
  if hash and not (#hash == 64 and hash:match("^%x+$")) then
    return nil, "a sha256- document reference needs the 64 hex digits of documents.source_sha256"
  end
  if hash then
    local doc = lib.by_hash[hash:lower()]
    if doc then
      return doc
    end
    return nil, string.format("no SPDF file in the library holds the document sha256-%s", hash:lower())
  end
  local id, err = pct_decode(docref)
  if not id then
    return nil, err
  end
  local docs = lib.by_id[id]
  if not docs then
    return nil, string.format("no SPDF file in the library holds a document with id '%s'", id)
  end
  if #docs > 1 then
    local names = {}
    for _, d in ipairs(docs) do
      names[#names + 1] = d.name
    end
    warn(string.format("the document id '%s' is held by %s; using %s (cite by sha256- to choose)",
      id, table.concat(names, ", "), docs[1].name))
  end
  return docs[1]
end

-- ---------------------------------------------------------------------------
-- Locale texts and citeproc's locator terms
-- ---------------------------------------------------------------------------

local TEXTS = {
  -- A no-break space keeps "n. pag." together, as pandoc does after abbreviations.
  en = { unnumbered = "n.\u{A0}pag.", slide = "slide", para = "para.", row = "row", rows = "rows" },
  es = { unnumbered = "s.\u{A0}p.", slide = "diap.", para = "párr.", row = "fila", rows = "filas" },
}

local FALLBACK_TERMS = { page = "p.", folio = "fol.", column = "col.", verse = "v." }
local TERM_NAMES = { "page", "folio", "column", "verse" }

local PROBE_CSL = [[<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="%s">
  <info><title>spdf.lua locator terms</title><id>spdf-lua-probe</id><updated>2026-10-07T00:00:00+00:00</updated></info>
  <citation><layout><text value="@@"/>%s<text value="@@"/></layout></citation>
</style>
]]

local terms_cache = {}

-- Pandoc recognises a locator in a citation suffix only by the terms of the
-- locale citeproc uses ("p." in English, "S." in German, "f." for a folio in
-- Spanish). Ask citeproc itself for those terms, once per locale.
local function locator_terms(locale)
  if terms_cache[locale] then
    return terms_cache[locale]
  end
  local terms = shallow_copy(FALLBACK_TERMS)
  if pandoc.utils.citeproc and locale:match("^[A-Za-z0-9%-]+$") then
    local ok, text = pcall(function()
      return pandoc.system.with_temporary_directory("spdf-probe", function(dir)
        local path = pandoc.path.join({ dir, "probe.csl" })
        local body = {}
        for i, name in ipairs(TERM_NAMES) do
          body[#body + 1] = (i > 1 and '<text value="|"/>' or "") .. '<text term="' .. name .. '" form="short"/>'
        end
        local f = io.open(path, "w")
        f:write(PROBE_CSL:format(locale, table.concat(body)))
        f:close()
        local refs = pandoc.read('[{"id":"probe","type":"book","title":"probe"}]', "csljson").meta.references
        local doc = pandoc.Pandoc(
          { pandoc.Para({ pandoc.Cite({ pandoc.Str("probe") }, { pandoc.Citation("probe", "NormalCitation") }) }) },
          { references = refs, csl = path, lang = locale })
        return stringify(pandoc.utils.citeproc(doc).blocks)
      end)
    end)
    local inner = ok and text:match("@@(.-)@@")
    if inner then
      local i = 0
      for piece in (inner .. "|"):gmatch("([^|]*)|") do
        i = i + 1
        local name = TERM_NAMES[i]
        piece = piece:gsub("^[ \t\r\n]+", ""):gsub("[ \t\r\n]+$", "")
        if name and piece ~= "" and not piece:find("[ \t\r\n]") then
          terms[name] = piece
        end
      end
    end
  end
  terms_cache[locale] = terms
  return terms
end

-- ---------------------------------------------------------------------------
-- From a locator to the text of the citation (SPEC §18)
-- ---------------------------------------------------------------------------

local function hms(t)
  local s = math.floor(t)
  local h, m, x = s // 3600, (s % 3600) // 60, s % 60
  if h > 0 then
    return string.format("%d:%02d:%02d", h, m, x)
  end
  return string.format("%d:%02d", m, x)
end

local function folio_text(anchor)
  local p = str(anchor.printed)
  if not p then
    return nil
  end
  if anchor.source == "inferred" then
    return "[" .. p .. "]"
  end
  return p
end

local FOLIATION_LABEL = { page = "page", leaf = "folio", column = "column" }

local function same_path(a, b)
  if type(a) ~= "table" or #a ~= #b then
    return false
  end
  for i = 1, #b do
    if a[i] ~= b[i] then
      return false
    end
  end
  return true
end

-- Returns a locator description, nil for "no locator", or nil plus an error.
--   {label = "page" | "folio" | "column" | "verse", text = "21"}
--   {text = "n. pag."}    text that citeproc must not read as a page number
-- For pages, a second value gives the canonical locator of the page found.
local function resolve_locator(doc, L, where)
  local T = TEXTS[opts.locale]
  local units = load_units(doc)
  local function fail(fmt, ...)
    return nil, string.format(fmt, ...)
  end

  if L.v then
    local a, b = L.v[1], L.v[2]
    local found = false
    for _, u in ipairs(units) do
      local an = u.anchor
      if an.type == "verse" then
        local from, to = int(an.line_from), int(an.line_to) or int(an.line_from)
        if from and a >= from and a <= (to or from) then
          found = true
          break
        end
      end
    end
    if not found then
      return fail("verse v=%d is not in %s", a, doc.name)
    end
    return { label = "verse", text = (b and b ~= a) and (a .. "-" .. b) or tostring(a) }
  end

  if L.p or L.f then
    local start
    if L.p then
      start = doc.by_physical[L.p]
      if not start then
        return fail("page p=%d is not in %s", L.p, doc.name)
      end
      if L.f and str(start.anchor.printed) ~= L.f then
        warn(string.format("%s: f=%s does not match the folio printed on physical page %d (%s); citing the page",
          where, L.f, L.p, str(start.anchor.printed) or "none"))
      end
    else
      local list = doc.by_printed[L.f]
      if not list then
        return fail("no page of %s is printed with the folio f=%s", doc.name, L.f)
      end
      start = list[1]
      if #list > 1 then
        local phys = {}
        for _, u in ipairs(list) do
          phys[#phys + 1] = str(u.anchor.physical) or u.id
        end
        warn(string.format("%s: the folio f=%s is printed on several pages of %s (physical %s); citing the first, add p= to choose",
          where, L.f, doc.name, table.concat(phys, ", ")))
      end
    end
    local finish
    if L.pe then
      finish = doc.by_physical[L.pe]
      if not finish then
        return fail("end page pe=%d is not in %s", L.pe, doc.name)
      end
      if L.fe and str(finish.anchor.printed) ~= L.fe then
        warn(string.format("%s: fe=%s does not match the folio printed on physical page %d (%s); citing the page",
          where, L.fe, L.pe, str(finish.anchor.printed) or "none"))
      end
    elseif L.fe then
      local list = doc.by_printed[L.fe]
      if not list then
        return fail("no page of %s is printed with the end folio fe=%s", doc.name, L.fe)
      end
      finish = list[1]
      for _, u in ipairs(list) do
        if u.ord >= start.ord then
          finish = u
          break
        end
      end
    end
    if finish and finish.ord < start.ord then
      warn(string.format("%s: the end of the range comes before its start; citing the start only", where))
      finish = nil
    end
    local a = start.anchor
    -- The canonical anchor URI of what was found (SPEC §5.2), for links.
    local canon = { p = int(a.physical), f = str(a.printed), char = L.char, xywh = L.xywh }
    if finish then
      local e = finish.anchor
      if int(e.physical) ~= canon.p then
        canon.pe = int(e.physical)
      end
      if str(e.printed) and str(e.printed) ~= canon.f then
        canon.fe = str(e.printed)
      end
    end
    local label = FOLIATION_LABEL[a.foliation or "page"] or "page"
    local sa = folio_text(a)
    if not sa then
      warn(string.format("%s: physical page %s of %s has no printed folio; cited as unnumbered (%s)",
        where, str(a.physical) or "?", doc.name, T.unnumbered))
      return { text = T.unnumbered }, canon
    end
    if finish then
      local sb = folio_text(finish.anchor)
      if sb and str(finish.anchor.printed) ~= str(a.printed) then
        return { label = label, text = sa .. "-" .. sb }, canon
      end
    end
    return { label = label, text = sa }, canon
  end

  if L.t then
    local t0, t1 = L.t[1], L.t[2]
    local found, last = false, nil
    for _, u in ipairs(units) do
      local an = u.anchor
      if an.type == "time" and type(an.t0) == "number" and type(an.t1) == "number" then
        if t0 >= an.t0 and t0 <= an.t1 then
          found = true
        end
        if not last or an.t1 > last then
          last = an.t1
        end
      end
    end
    if not found then
      return fail("t=%s is not inside any time unit of %s", num_text(t0), doc.name)
    end
    if t1 and last and t1 > last then
      return fail("t=%s,%s ends after the last time unit of %s", num_text(t0), num_text(t1), doc.name)
    end
    local text = hms(t0)
    if t1 and math.floor(t1) ~= math.floor(t0) then
      text = text .. "-" .. hms(t1)
    end
    return { text = text }
  end

  if L.s or L.para then
    if L.s then
      local found = false
      for _, u in ipairs(units) do
        if (u.anchor.type == "section" or u.anchor.type == "web") and same_path(u.anchor.path, L.s) then
          found = true
          break
        end
      end
      if not found then
        return fail("section s=%s is not in %s", table.concat(L.s, "/"), doc.name)
      end
    end
    local parts = {}
    if L.s and #L.s > 0 and L.s[#L.s] ~= "" then
      parts[#parts + 1] = "§ " .. L.s[#L.s]
    end
    if L.para then
      parts[#parts + 1] = T.para .. " " .. L.para
    end
    if #parts == 0 then
      return nil
    end
    return { text = table.concat(parts, ", ") }
  end

  if L.sl then
    for _, u in ipairs(units) do
      if u.anchor.type == "slide" and int(u.anchor.n) == L.sl then
        return { text = T.slide .. " " .. L.sl }
      end
    end
    return fail("slide sl=%d is not in %s", L.sl, doc.name)
  end

  if L.sh then
    local found = false
    for _, u in ipairs(units) do
      if u.anchor.type == "sheet" and u.anchor.sheet == L.sh then
        found = true
        break
      end
    end
    if not found then
      return fail("sheet sh=%s is not in %s", L.sh, doc.name)
    end
    if not L.rows then
      return { text = L.sh }
    end
    local a, b = L.rows[1], L.rows[2]
    if a == b then
      return { text = string.format("%s, %s %d", L.sh, T.row, a) }
    end
    return { text = string.format("%s, %s %d-%d", L.sh, T.rows, a, b) }
  end

  if L.ref then
    for _, u in ipairs(units) do
      local an = u.anchor
      if an.type == "canonical" and an.scheme == L.ref.scheme and an.ref == L.ref.ref then
        return { text = L.ref.ref }
      end
    end
    return fail("the canonical reference %s:%s is not in %s", L.ref.scheme, L.ref.ref, doc.name)
  end

  return nil -- the whole document
end

-- Inlines for a citation suffix: "{p. 21}" lets citeproc recognise the
-- locator and its label; "{}, n. pag." stops citeproc from reading plain
-- text (a time, a slide, a canonical reference) as a page number.
local function words(text)
  local out = pandoc.Inlines({})
  local first = true
  for w in text:gmatch("[^ ]+") do
    if not first then
      out:insert(pandoc.Space())
    end
    out:insert(pandoc.Str(w))
    first = false
  end
  return out
end

local function locator_inlines(loc, mode)
  -- Like pandoc's reader: "[@key, p. 4]" has a leading comma, "@key [p. 4]" not.
  local out = pandoc.Inlines({})
  if mode ~= "AuthorInText" then
    out:insert(pandoc.Str(","))
    out:insert(pandoc.Space())
  end
  if loc.label then
    local term = locator_terms(opts.csl_locale)[loc.label] or FALLBACK_TERMS[loc.label]
    out:extend(words("{" .. term .. " " .. loc.text .. "}"))
  else
    out:extend(words("{}, " .. loc.text))
  end
  return out
end

-- ---------------------------------------------------------------------------
-- References
-- ---------------------------------------------------------------------------

local refs = {
  loaded = false,
  ids = {}, -- every id already known (inline or bibliography files)
  sigs = {}, -- signature -> id, to avoid duplicating a work
  new = {}, -- MetaMaps to add
}

local function norm(s)
  if type(s) ~= "string" then
    s = s and stringify(s) or ""
  end
  -- ASCII only: Lua's %a, %p and %s follow the C locale and may split UTF-8.
  s = s:gsub("[A-Z]", string.lower):gsub("[ \t\r\n!-/:-@%[-`{-~]+", " "):gsub("^ ", ""):gsub(" $", "")
  return s
end

local function first_family(authors)
  if type(authors) ~= "table" or not authors[1] then
    return ""
  end
  local a = authors[1]
  return norm(a.family or a.literal or "")
end

local function year_of(issued)
  if type(issued) == "table" and issued["date-parts"] then
    local dp = issued["date-parts"]
    if type(dp[1]) == "table" and dp[1][1] then
      return str(dp[1][1])
    end
    return nil
  end
  if issued then
    return (stringify(issued):match("^%-?%d+"))
  end
  return nil
end

local function signatures(item)
  local out = {}
  if item.DOI and stringify(item.DOI) ~= "" then
    out[#out + 1] = "doi:" .. stringify(item.DOI):lower()
  end
  if item.ISBN and stringify(item.ISBN) ~= "" then
    out[#out + 1] = "isbn:" .. stringify(item.ISBN):gsub("[^%dXx]", ""):upper()
  end
  local title = item.title and norm(item.title) or ""
  local year = year_of(item.issued)
  if title ~= "" and year then
    out[#out + 1] = "tya:" .. title .. "|" .. year .. "|" .. first_family(item.author)
  end
  return out
end

local function load_existing_references(meta)
  if refs.loaded then
    return
  end
  refs.loaded = true
  local m = pandoc.Meta(shallow_copy(meta))
  m.nocite = pandoc.MetaInlines({ pandoc.Cite({ pandoc.Str("@*") }, { pandoc.Citation("*", "AuthorInText") }) })
  local ok, list = pcall(pandoc.utils.references, pandoc.Pandoc({}, m))
  if not ok then
    list = {}
    for _, r in ipairs(meta.references or {}) do
      list[#list + 1] = { id = r.id and stringify(r.id) }
    end
  end
  for _, r in ipairs(list) do
    local id = r.id and stringify(r.id)
    if id then
      refs.ids[id] = true
      local plain = {
        DOI = r.DOI,
        ISBN = r.ISBN,
        title = r.title,
        issued = r.issued,
        author = {},
      }
      if type(r.author) == "table" then
        for i, a in ipairs(r.author) do
          plain.author[i] = { family = a.family and stringify(a.family), literal = a.literal and stringify(a.literal) }
        end
      end
      for _, s in ipairs(signatures(plain)) do
        refs.sigs[s] = refs.sigs[s] or id
      end
    end
  end
end

local function citekey(doc)
  if doc.hash then
    return "spdf-" .. doc.hash:sub(1, 12)
  end
  return "spdf-" .. (doc.id or "document"):gsub("[^A-Za-z0-9%-_]", "-")
end

local function ensure_reference(doc, meta)
  if doc.key then
    return doc.key
  end
  load_existing_references(meta)
  local item = clean(shallow_copy(doc.csl))
  item.spdf = nil
  for _, s in ipairs(signatures(item)) do
    if refs.sigs[s] then
      doc.key = refs.sigs[s]
      return doc.key
    end
  end
  local key = citekey(doc)
  doc.key = key
  if refs.ids[key] then
    return key -- already present (written by hand, or the filter ran before)
  end
  item.id = key
  local parsed = pandoc.read(pandoc.json.encode({ item }), "csljson")
  local ref = parsed.meta.references and parsed.meta.references[1]
  if ref then
    refs.new[#refs.new + 1] = ref
    refs.ids[key] = true
    for _, s in ipairs(signatures(item)) do
      refs.sigs[s] = key
    end
  end
  return key
end

-- ---------------------------------------------------------------------------
-- Citations
-- ---------------------------------------------------------------------------

local current_meta

local function inlines_from(list, from)
  local out = pandoc.Inlines({})
  for i = from or 1, #list do
    out:insert(list[i])
  end
  return out
end

local function has_spdf(cite)
  for _, c in ipairs(cite.citations) do
    if c.id:sub(1, 5) == "spdf:" then
      return true
    end
  end
  return false
end

-- Resolve one citation. Returns the new Citation, the URI for links (or nil),
-- and the leftover of the following Str when the parameters came from it.
local function resolve_citation(c, next_str, is_last)
  local docpart, frag = c.id:match("^spdf:([^#]*)#(.*)$")
  if not docpart then
    docpart, frag = c.id:match("^spdf:(.*)$"), ""
  end
  local suffix = c.suffix
  local text_after -- string read after the key (from the suffix or the next Str)
  local from_next = false
  if frag ~= "" and not frag:find("=") then
    local first = suffix[1]
    if first and first.t == "Str" and first.text:sub(1, 1) == "=" then
      text_after = first.text
      suffix = inlines_from(suffix, 2)
    elseif #suffix == 0 and is_last and next_str and next_str:sub(1, 1) == "=" then
      text_after = next_str
      from_next = true
    end
  end

  local params, leftover = scan_params(frag .. (text_after or ""), text_after ~= nil)
  local raw_frag
  if text_after then
    -- leftover is a tail of text_after
    raw_frag = (frag .. text_after):sub(1, #frag + #text_after - #leftover)
  else
    raw_frag = frag
  end
  local written = "spdf:" .. docpart .. (raw_frag ~= "" and ("#" .. raw_frag) or "")
  local where = "[@" .. written .. "]"

  local rest = pandoc.Inlines({})
  if text_after and not from_next and leftover ~= "" then
    rest:insert(pandoc.Str(leftover))
  end
  rest:extend(suffix)

  local function unresolved(msg)
    warn(string.format("%s: %s; the citation is left unresolved", where, msg))
    return pandoc.Citation(written, c.mode, c.prefix, rest, c.note_num, c.hash), nil,
      from_next and leftover or nil, written
  end

  if docpart == "" then
    return unresolved("empty document reference")
  end
  if not text_after and leftover ~= "" then
    return unresolved("malformed anchor parameters '" .. frag .. "'")
  end
  if frag ~= "" and #params == 0 then
    return unresolved("malformed anchor parameters '" .. frag .. (text_after or "") .. "'")
  end
  local L, err, unknown = make_locator(params)
  if not L then
    return unresolved(err)
  end
  for _, k in ipairs(unknown or {}) do
    warn(string.format("%s: unknown parameter '%s' ignored", where, k))
  end
  local doc, derr = find_document(docpart)
  if not doc then
    return unresolved(derr)
  end
  local loc, extra = resolve_locator(doc, L, where)
  if type(extra) == "string" then
    return unresolved(extra)
  elseif type(extra) == "table" then
    L = extra -- the canonical locator of the page that was found
  end
  local key = ensure_reference(doc, current_meta)
  local new_suffix = pandoc.Inlines({})
  if loc then
    new_suffix:extend(locator_inlines(loc, c.mode))
    -- "@{spdf:…#p=2} [emphasis added]": a suffix that does not start with
    -- punctuation or a space is separated from the locator, as pandoc does.
    local first = rest[1]
    if first and first.t ~= "Space" and first.t ~= "SoftBreak"
      and not (first.t == "Str" and first.text:match("^[%.,;:!?%)]")) then
      new_suffix:insert(pandoc.Str(","))
      new_suffix:insert(pandoc.Space())
    end
  end
  new_suffix:extend(rest)
  local docref = doc.hash and ("sha256-" .. doc.hash) or pct_encode(doc.id or docpart)
  local params_text = format_locator(L)
  local uri = "spdf:" .. docref .. (params_text ~= "" and ("#" .. params_text) or "")
  return pandoc.Citation(key, c.mode, c.prefix, new_suffix, c.note_num, c.hash), uri,
    from_next and leftover or nil, written
end

-- Returns the new Cite, the list of anchor URIs, and (when the parameters of
-- an in-text citation were read from the following Str) that Str's leftover.
local function resolve_cite(cite, next_el)
  local next_str = next_el and next_el.t == "Str" and next_el.text or nil
  local citations, uris = {}, {}
  local leftover_next, consumed
  local n = #cite.citations
  for i, c in ipairs(cite.citations) do
    if c.id:sub(1, 5) == "spdf:" then
      local nc, uri, left = resolve_citation(c, next_str, i == n and n == 1)
      citations[#citations + 1] = nc
      if uri then
        uris[#uris + 1] = uri
      end
      if left then
        leftover_next = left
        consumed = next_str:sub(1, #next_str - #left)
      end
    else
      citations[#citations + 1] = c
    end
  end
  local content = cite.content
  if consumed then
    content = inlines_from(content)
    content:insert(pandoc.Str(consumed))
  end
  return pandoc.Cite(content, citations), uris, leftover_next
end

-- ---------------------------------------------------------------------------
-- Raw text fallback: readers without the citations extension (commonmark,
-- gfm) leave "[@spdf:…]" as plain Str. Re-read those pieces as Markdown.
-- ---------------------------------------------------------------------------

local SPDF_AT = "@{?spdf:"

local function text_inlines(s)
  local out = pandoc.Inlines({})
  local i = 1
  while i <= #s do
    local c = s:sub(i, i)
    if c == " " then
      out:insert(pandoc.Space())
      i = i + 1
    elseif c == "\n" then
      out:insert(pandoc.SoftBreak())
      i = i + 1
    else
      local j = s:find("[ \n]", i) or (#s + 1)
      out:insert(pandoc.Str(s:sub(i, j - 1)))
      i = j
    end
  end
  return out
end

local function reread(text)
  local ok, d = pcall(pandoc.read, text, "markdown")
  if not ok or #d.blocks ~= 1 or not d.blocks[1].content then
    return nil
  end
  local ils = d.blocks[1].content
  for _, el in ipairs(ils) do
    if el.t == "Cite" and has_spdf(el) then
      return ils
    end
  end
  return nil
end

local function convert_run(text)
  local out = pandoc.Inlines({})
  local cursor = 1
  while true do
    local at = text:find(SPDF_AT, cursor)
    if not at then
      break
    end
    local done = false
    -- Bracketed: the nearest "[" before "@" with no "]" in between, and the next "]".
    local before = text:sub(cursor, at - 1)
    local lb
    for pos = #before, 1, -1 do
      local ch = before:sub(pos, pos)
      if ch == "]" then
        break
      elseif ch == "[" then
        lb = cursor + pos - 1
        break
      end
    end
    local rb = text:find("]", at, true)
    if lb and rb then
      local ils = reread(text:sub(lb, rb))
      if ils then
        out:extend(text_inlines(text:sub(cursor, lb - 1)))
        out:extend(ils)
        cursor = rb + 1
        done = true
      end
    end
    if not done then
      -- In-text: the whitespace-delimited word around "@".
      local ws = at
      while ws > cursor and not text:sub(ws - 1, ws - 1):match("[ \n]") do
        ws = ws - 1
      end
      local we = text:find("[ \n]", at) or (#text + 1)
      local ils = reread(text:sub(ws, we - 1))
      if ils then
        out:extend(text_inlines(text:sub(cursor, ws - 1)))
        out:extend(ils)
        cursor = we
      else
        -- "@spdf:" at the start of a word that Pandoc cannot read as a
        -- citation, typically because of a space: say so instead of
        -- leaving it silently as text.
        local prev = at > 1 and text:sub(at - 1, at - 1) or ""
        if prev == "" or prev:match("[ \n%[%(%-;]") then
          local shown = (lb and rb) and text:sub(lb, rb) or text:sub(ws, we - 1)
          warn(string.format("'%s' looks like an SPDF citation but Pandoc cannot read it as one; "
            .. "write spaces and other reserved characters percent-encoded (%%20)", shown))
        end
        out:extend(text_inlines(text:sub(cursor, at)))
        cursor = at + 1
      end
    end
  end
  out:extend(text_inlines(text:sub(cursor)))
  return out
end

local function fallback(ils)
  local any = false
  for _, el in ipairs(ils) do
    if el.t == "Str" and el.text:find(SPDF_AT) then
      any = true
      break
    end
  end
  if not any then
    return ils
  end
  local out = pandoc.Inlines({})
  local i = 1
  while i <= #ils do
    local el = ils[i]
    if el.t == "Str" or el.t == "Space" or el.t == "SoftBreak" then
      local j, parts = i, {}
      while j <= #ils and (ils[j].t == "Str" or ils[j].t == "Space" or ils[j].t == "SoftBreak") do
        parts[#parts + 1] = ils[j].t == "Str" and ils[j].text or (ils[j].t == "Space" and " " or "\n")
        j = j + 1
      end
      local text = table.concat(parts)
      if text:find(SPDF_AT) then
        out:extend(convert_run(text))
      else
        for k = i, j - 1 do
          out:insert(ils[k])
        end
      end
      i = j
    else
      out:insert(el)
      i = i + 1
    end
  end
  return out
end

-- ---------------------------------------------------------------------------
-- The walk
-- ---------------------------------------------------------------------------

local function link_inlines(uris)
  local out = pandoc.Inlines({})
  for i, u in ipairs(uris) do
    if i > 1 then
      out:insert(pandoc.Str(";"))
      out:insert(pandoc.Space())
    end
    out:insert(pandoc.Link({ pandoc.Str(u) }, u))
  end
  return out
end

local function process_inlines(ils, in_note)
  ils = fallback(ils)
  local out = pandoc.Inlines({})
  local i = 1
  local changed = false
  while i <= #ils do
    local el = ils[i]
    if el.t == "Cite" and has_spdf(el) then
      changed = true
      local cite, uris, leftover = resolve_cite(el, ils[i + 1])
      out:insert(cite)
      if opts.links and #uris > 0 then
        if in_note then
          out:insert(pandoc.Space())
          out:insert(pandoc.Str("("))
          out:extend(link_inlines(uris))
          out:insert(pandoc.Str(")"))
        else
          out:insert(pandoc.Note({ pandoc.Para(link_inlines(uris)) }))
        end
      end
      if leftover ~= nil then
        if leftover ~= "" then
          out:insert(pandoc.Str(leftover))
        end
        i = i + 1
      end
    else
      out:insert(el)
    end
    i = i + 1
  end
  return out
end

local function walk_filter(in_note)
  local f = {
    traverse = "topdown",
    Inlines = function(ils)
      return process_inlines(ils, in_note)
    end,
    -- Citations are handled from the list that holds them; their own
    -- content and suffix need no second look.
    Cite = function(c)
      return c, false
    end,
  }
  if not in_note then
    f.Note = function(n)
      return n:walk(walk_filter(true)), false
    end
  end
  return f
end

local function mentions_spdf(doc)
  local found = false
  doc:walk({
    Cite = function(c)
      if has_spdf(c) then
        found = true
      end
    end,
    Str = function(s)
      if s.text:find(SPDF_AT) then
        found = true
      end
    end,
  })
  return found
end

local function Pandoc(doc)
  if not mentions_spdf(doc) then
    return nil
  end
  read_options(doc.meta)
  current_meta = doc.meta
  return pandoc.system.with_temporary_directory("spdf", function(tmp)
    state.tmp = tmp
    doc.blocks = doc.blocks:walk(walk_filter(false))
    if #refs.new > 0 then
      local list = pandoc.MetaList({})
      local existing = doc.meta.references
      if existing then
        for _, r in ipairs(existing) do
          list:insert(r)
        end
      end
      for _, r in ipairs(refs.new) do
        list:insert(r)
      end
      doc.meta.references = list
    end
    return doc
  end)
end

return {
  { Pandoc = Pandoc },
}
