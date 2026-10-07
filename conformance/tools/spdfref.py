"""Reference helpers for the SPDF conformance suite (Python 3.13, standard library only).

This module is the oracle the generator and the checker use. It is deliberately
plain: every function follows `spec/CONTRACT.md` (and `spec/SPEC.md`) step by step,
so implementers can read it side by side with the specification.

It is NOT the Python library of SPDF (that lives in `python/`).
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import math
import os
import re
import sqlite3
import struct
import tempfile
import unicodedata
import urllib.parse
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import ed25519

APPLICATION_ID = 1397769286  # 0x53504446, "SPDF"
USER_VERSION = 500
SPDF_VERSION = "5.0"
TOKENIZER = "unicode61 remove_diacritics 2"

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_50 = ROOT / "spec" / "schema" / "spdf-5.0.sql"
SCHEMA_41 = ROOT / "spec" / "schema" / "spdf-4.1.sql"
SCHEMA_40 = ROOT / "spec" / "schema" / "spdf-4.0.sql"

SIGN_PREFIX = b"spdf-content-sha256:"
INTEGRITY_KEYS = ("content_sha256", "signature", "signer")


class SpdfError(Exception):
    """A file or value that the reference refuses."""


# ---------------------------------------------------------------------------
# Numbers and canonical JSON (RFC 8785, JCS)
# ---------------------------------------------------------------------------


def round6(x: float) -> float:
    """Round to 6 decimals, half to even on the exact binary value; -0 becomes 0."""
    r = round(x, 6)
    return 0.0 if r == 0 else r


def es_number(x) -> str:
    """ECMAScript Number::toString (the number form of RFC 8785)."""
    if isinstance(x, bool):
        raise TypeError("booleans are not numbers here")
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        raise SpdfError("NaN and infinities are not allowed in SPDF JSON")
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    t = Decimal(repr(abs(x))).as_tuple()  # shortest round-trip digits
    digits = "".join(map(str, t.digits)).lstrip("0") or "0"
    # strip trailing zeros, adjusting the exponent
    exp = t.exponent + (len("".join(map(str, t.digits))) - len("".join(map(str, t.digits)).rstrip("0")))
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    n = exp + k  # position of the decimal point relative to the digits
    if k <= n <= 21:
        s = digits + "0" * (n - k)
    elif 0 < n <= 21:
        s = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        s = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        es = ("+" if e > 0 else "-") + str(abs(e))
        s = digits + "e" + es if k == 1 else digits[0] + "." + digits[1:] + "e" + es
    return sign + s


def canon(obj):
    """Round every non-integer number to 6 decimals, recursively."""
    if isinstance(obj, bool) or obj is None or isinstance(obj, str):
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, float):
        r = round6(obj)
        return int(r) if r.is_integer() and abs(r) < 2**53 else r
    if isinstance(obj, list):
        return [canon(v) for v in obj]
    if isinstance(obj, dict):
        return {k: canon(v) for k, v in obj.items()}
    raise TypeError(f"not JSON: {type(obj)}")


def _jcs_string(s: str) -> str:
    out = ['"']
    for c in s:
        o = ord(c)
        if c == '"':
            out.append('\\"')
        elif c == "\\":
            out.append("\\\\")
        elif c == "\b":
            out.append("\\b")
        elif c == "\f":
            out.append("\\f")
        elif c == "\n":
            out.append("\\n")
        elif c == "\r":
            out.append("\\r")
        elif c == "\t":
            out.append("\\t")
        elif o < 0x20:
            out.append(f"\\u{o:04x}")
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def _utf16_key(k: str) -> bytes:
    return k.encode("utf-16-be", "surrogatepass")


def jcs(obj) -> str:
    """RFC 8785 serialization of an already canonical value."""
    if obj is None:
        return "null"
    if obj is True:
        return "true"
    if obj is False:
        return "false"
    if isinstance(obj, (int, float)):
        return es_number(obj)
    if isinstance(obj, str):
        return _jcs_string(obj)
    if isinstance(obj, list):
        return "[" + ",".join(jcs(v) for v in obj) + "]"
    if isinstance(obj, dict):
        items = sorted(obj.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{" + ",".join(_jcs_string(k) + ":" + jcs(v) for k, v in items) + "}"
    raise TypeError(f"not JSON: {type(obj)}")


def pretty(obj, indent: int = 2, level: int = 0) -> str:
    """Readable form with the same key order and number form as JCS (for files on disk)."""
    pad = " " * (indent * (level + 1))
    end = " " * (indent * level)
    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(not isinstance(v, (list, dict)) for v in obj):
            return "[" + ", ".join(jcs(v) for v in obj) + "]"
        return "[\n" + ",\n".join(pad + pretty(v, indent, level + 1) for v in obj) + "\n" + end + "]"
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = sorted(obj.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{\n" + ",\n".join(pad + _jcs_string(k) + ": " + pretty(v, indent, level + 1) for k, v in items) + "\n" + end + "}"
    return jcs(obj)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((pretty(canon(obj)) + "\n").encode("utf-8"))  # LF on every platform


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def stored_json(obj) -> str:
    """How the generator stores JSON in TEXT columns (any valid JSON is allowed)."""
    return jcs(canon(obj))


# ---------------------------------------------------------------------------
# Opening files safely
# ---------------------------------------------------------------------------

SQLITE_MAGIC = b"SQLite format 3\x00"
GZIP_MAGIC = b"\x1f\x8b"
MAX_GZIP = 4 * 1024**3


class Opened:
    """A read-only connection plus what we learned while opening."""

    def __init__(self, con: sqlite3.Connection, gzipped: bool, tmp: str | None):
        self.con = con
        self.gzipped = gzipped
        self._tmp = tmp

    def close(self) -> None:
        self.con.close()
        if self._tmp:
            os.unlink(self._tmp)


def open_file(path: Path) -> Opened:
    """Open read-only, query_only, trusted_schema off. Decompress gzip to a temp file."""
    raw = Path(path).read_bytes()
    gzipped = raw[:2] == GZIP_MAGIC
    tmp = None
    target = str(path)
    if gzipped:
        try:
            with gzip.GzipFile(fileobj=__import__("io").BytesIO(raw)) as g:
                data = g.read(MAX_GZIP + 1)
        except (OSError, EOFError) as e:
            raise SpdfError(f"E001 bad gzip: {e}")
        if len(data) > MAX_GZIP:
            raise SpdfError("E001 gzip payload too large")
        raw = data
        fd, tmp = tempfile.mkstemp(suffix=".sqlite")
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        target = tmp
    if raw[:16] != SQLITE_MAGIC:
        if tmp:
            os.unlink(tmp)
        raise SpdfError("E001 not a SQLite database")
    uri = Path(target).resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.execute("PRAGMA query_only = 1")
    con.execute("PRAGMA trusted_schema = OFF")
    return Opened(con, gzipped, tmp)


def table_names(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table')")}


def detect(con) -> tuple[str, str | None]:
    """('5', version) for 5.x, ('4', version) for legacy 4.x, ('?', None) otherwise."""
    app = con.execute("PRAGMA application_id").fetchone()[0]
    uv = con.execute("PRAGMA user_version").fetchone()[0]
    tables = table_names(con)
    if app == APPLICATION_ID:
        if 500 <= uv <= 599:
            return "5", f"{uv // 100}.{(uv % 100) // 10}"
        return "?", None
    if "spdf" in tables and "documentos" in tables:
        row = con.execute("SELECT valor FROM spdf WHERE clave = 'spdf_version'").fetchone()
        if row and str(row[0]).startswith("4."):
            return "4", str(row[0])
        if uv in (400, 410):
            return "4", f"{uv // 100}.{(uv % 100) // 10}"
    return "?", None


# ---------------------------------------------------------------------------
# Canonical dump, 5.0
# ---------------------------------------------------------------------------


def _j(v):
    return None if v is None else json.loads(v)


def _rows(con, sql, *args):
    cur = con.execute(sql, args)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _tokenizer(con, table: str) -> str | None:
    row = con.execute("SELECT sql FROM sqlite_master WHERE name = ?", (table,)).fetchone()
    if not row or not row[0]:
        return None
    m = re.search(r"""tokenize\s*=\s*(?:'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([A-Za-z0-9_]+))""", row[0], re.I)
    if not m:
        return "unicode61"  # the FTS5 default
    raw = m.group(1).replace("''", "'") if m.group(1) is not None else m.group(2).replace('""', '"') if m.group(2) is not None else m.group(3)
    return " ".join(raw.split())


def sort_provenance(rows: list[dict]) -> list[dict]:
    """Provenance entries ordered by the UTF-8 bytes of their JCS form (writer-independent)."""
    return sorted(rows, key=lambda r: jcs(canon(r)).encode("utf-8"))


def dump_50(con) -> dict:
    meta = {r["key"]: r["value"] for r in _rows(con, "SELECT key, value FROM spdf_meta ORDER BY key")}
    docs = _rows(con, "SELECT * FROM documents ORDER BY id")
    if len(docs) != 1:
        raise SpdfError("E013 documents must hold exactly one row")
    d = docs[0]
    document = {k: d[k] for k in ("id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count",
                                  "duration", "created", "updated", "title", "authors", "year", "language", "rights")}
    document["metadata"] = _j(document["metadata"])
    document["rights"] = _j(document["rights"])
    units = []
    for u in _rows(con, "SELECT id, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words FROM units ORDER BY ord, id"):
        u["anchor"], u["notes"], u["words"] = _j(u["anchor"]), _j(u["notes"]), _j(u["words"])
        units.append(u)
    sections = _rows(con, "SELECT id, parent, level, title, unit_from, unit_to, summary FROM sections ORDER BY id")
    fragments = []
    for f in _rows(con, "SELECT n, id, unit, ord, text, context, section, anchor, anchor_end, search_text FROM fragments ORDER BY n"):
        f["section"], f["anchor"], f["anchor_end"] = _j(f["section"]), _j(f["anchor"]), _j(f["anchor_end"])
        fragments.append(f)
    figures = []
    for g in _rows(con, "SELECT id, unit, image, caption, description, anchor FROM figures ORDER BY id"):
        g["anchor"] = _j(g["anchor"])
        figures.append(g)
    spaces = []
    for s in _rows(con, "SELECT id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created FROM spaces ORDER BY id"):
        s["modalities"], s["task_prefixes"] = _j(s["modalities"]), _j(s["task_prefixes"])
        spaces.append(s)
    vectors = {}
    for (space,) in con.execute("SELECT DISTINCT space FROM vectors ORDER BY space").fetchall():
        h = hashlib.sha256()
        n = 0
        for (data,) in con.execute("SELECT data FROM vectors WHERE space = ? ORDER BY target, id", (space,)):
            h.update(bytes(data))
            n += 1
        vectors[space] = {"count": n, "sha256": h.hexdigest()}
    blobs = [{"key": k, "mime": m, "bytes": len(bytes(b)), "sha256": sha256_hex(bytes(b))}
             for k, m, b in con.execute("SELECT key, mime, data FROM blobs ORDER BY key")]
    provenance = []
    for p in _rows(con, "SELECT stage, provider, model, detail, ms, at FROM provenance"):
        p["detail"] = _j(p["detail"])
        provenance.append(p)
    provenance = sort_provenance(provenance)
    extensions = _rows(con, "SELECT name, version, required FROM extensions ORDER BY name")
    tables = table_names(con)
    return canon({
        "spdf_version": meta.get("spdf_version"),
        "meta": meta,
        "fts": {"tokenizer": _tokenizer(con, "fragments_fts"), "trigram": "fragments_fts_trigram" in tables},
        "document": document,
        "units": units,
        "sections": sections,
        "fragments": fragments,
        "figures": figures,
        "spaces": spaces,
        "vectors": vectors,
        "blobs": blobs,
        "provenance": provenance,
        "extensions": extensions,
    })


# ---------------------------------------------------------------------------
# Legacy 4.x: the 5.0 view
# ---------------------------------------------------------------------------

LEGACY_KIND = {"pdf": "pdf", "pdf_escaneado": "scanned_pdf", "fotos": "photos", "imagen": "image", "audio": "audio",
               "video": "video", "documento": "document", "epub": "epub", "presentacion": "slides", "hoja": "sheet", "web": "web"}
LEGACY_ANCHOR_TYPE = {"pagina": "page", "tiempo": "time", "seccion": "section", "diapositiva": "slide", "hoja": "sheet",
                      "web": "web", "imagen": "image"}
LEGACY_ANCHOR_KEY = {"tipo": "type", "fisica": "physical", "impresa": "printed", "romana": "roman", "origen": "source",
                     "confianza": "confidence", "hablante": "speaker", "ruta": "path", "parrafo": "paragraph", "n": "n",
                     "hoja": "sheet", "filaDesde": "row_from", "filaHasta": "row_to", "consultada": "accessed", "region": "region"}
LEGACY_SOURCE = {"leido": "read", "deducido": "inferred", "epub": "epub", "ninguno": "none"}
LEGACY_TARGET = {"fragmento": "fragment", "unidad": "unit", "figura": "figure"}
LEGACY_MODALITY = {"texto": "text", "imagen": "image", "audio": "audio", "video": "video", "pdf": "pdf"}
LEGACY_META_KEY = {"creado": "created", "generador": "generator"}
LEGACY_FIELD = {"titulo": "title", "subtitulo": "spdf.subtitle", "tituloOriginal": "original-title", "autores": "author",
                "editores": "editor", "traductores": "translator", "entrevistadores": "interviewer", "anio": "issued",
                "anioOriginal": "original-date", "editorial": "publisher", "lugar": "publisher-place",
                "revista": "container-title", "contenedor": "container-title", "coleccion": "collection-title",
                "volumen": "volume", "numero": "issue", "paginas": "page", "edicion": "edition", "doi": "DOI",
                "isbn": "ISBN", "url": "URL", "idioma": "language", "tipoCSL": "type", "resumen": "abstract",
                "idiomaOriginal": "spdf.original_language", "fecha": "issued", "sinFecha": "spdf.undated"}
LEGACY_PROVENANCE_SOURCE = {"lectura": "reading", "usuario": "user", "colofon": "colophon", "impresores": "printers"}


def legacy_anchor(a):
    if a is None:
        return None
    out = {}
    for k, v in a.items():
        key = LEGACY_ANCHOR_KEY.get(k, k)
        if k == "tipo":
            v = LEGACY_ANCHOR_TYPE.get(v, v)
        elif k == "origen":
            v = LEGACY_SOURCE.get(v, v)
        out[key] = v
    return out


def _legacy_names(people):
    out = []
    for a in people or []:
        n = {}
        if a.get("apellidos"):
            n["family"] = a["apellidos"]
        if a.get("nombre"):
            n["given"] = a["nombre"]
        if n:
            out.append(n)
    return out


def _date_parts(iso: str):
    m = re.match(r"^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?", iso.strip())
    if not m:
        return None
    return [int(g) for g in m.groups() if g is not None]


def legacy_default_type(kind: str, m: dict) -> str:
    if m.get("tipoCSL"):
        return m["tipoCSL"]
    if m.get("revista"):
        return "article-journal"
    return {"audio": "speech", "video": "motion_picture", "web": "webpage", "presentacion": "speech",
            "hoja": "dataset", "imagen": "graphic", "fotos": "graphic"}.get(kind, "book")


def legacy_metadata(m: dict, kind: str) -> dict:
    """MetadatosDocumento (Scholaris 4.x) -> CSL-JSON item + "spdf" extension (CONTRACT §7)."""
    def has(k):
        v = m.get(k)
        return v is not None and v != "" and v != []

    item: dict = {"type": legacy_default_type(kind, m)}
    spdf: dict = {}
    title = m.get("titulo") or ""
    if has("subtitulo"):
        item["title"] = f"{title}: {m['subtitulo']}"
        item["title-short"] = title
        spdf["subtitle"] = m["subtitulo"]
    else:
        item["title"] = title
    if has("tituloOriginal"):
        item["original-title"] = m["tituloOriginal"]
    orcid = {}
    for src, dst in (("autores", "author"), ("editores", "editor"), ("traductores", "translator"), ("entrevistadores", "interviewer")):
        names = _legacy_names(m.get(src))
        if names:
            item[dst] = names
        for a in m.get(src) or []:
            if a.get("orcid"):
                key = a.get("apellidos", "") + (", " + a["nombre"] if a.get("nombre") else "")
                orcid[key] = a["orcid"]
    fecha = _date_parts(m["fecha"]) if has("fecha") else None
    if fecha and (not has("anio") or fecha[0] == m["anio"]):
        item["issued"] = {"date-parts": [fecha]}
    elif has("anio"):
        item["issued"] = {"date-parts": [[m["anio"]]]}
    if has("anioOriginal"):
        item["original-date"] = {"date-parts": [[m["anioOriginal"]]]}
    simple = (("editorial", "publisher"), ("lugar", "publisher-place"), ("coleccion", "collection-title"),
              ("volumen", "volume"), ("numero", "issue"), ("paginas", "page"), ("edicion", "edition"), ("doi", "DOI"),
              ("isbn", "ISBN"), ("url", "URL"), ("idioma", "language"), ("resumen", "abstract"))
    for src, dst in simple:
        if has(src):
            item[dst] = m[src]
    if has("revista"):
        item["container-title"] = m["revista"]
    elif has("contenedor"):
        item["container-title"] = m["contenedor"]
    if has("idiomaOriginal"):
        spdf["original_language"] = m["idiomaOriginal"]
    if has("sinFecha"):
        sf = m["sinFecha"]
        u = {}
        if sf.get("desde") is not None:
            u["from"] = sf["desde"]
        if sf.get("hasta") is not None:
            u["to"] = sf["hasta"]
        if sf.get("fundamento"):
            u["basis"] = sf["fundamento"]
        spdf["undated"] = u
    if has("procedencia"):
        prov = {}
        for campo, v in m["procedencia"].items():
            key = LEGACY_FIELD.get(campo, campo)
            if key.startswith("spdf."):
                key = key[5:]
            prov[key] = {"source": LEGACY_PROVENANCE_SOURCE.get(v.get("fuente"), v.get("fuente")), "confidence": v.get("confianza")}
        spdf["provenance"] = prov
    if orcid:
        spdf["orcid"] = orcid
    if spdf:
        item["spdf"] = spdf
    return item


def _legacy_ref(v, blob_keys, empty_keeps=False):
    if v is None:
        return None
    if v == "":
        return "" if empty_keeps else None
    if v in blob_keys:
        return "blob:" + v
    return v


def dump_legacy(con) -> dict:
    tables = table_names(con)
    meta = {}
    for r in _rows(con, "SELECT clave, valor FROM spdf ORDER BY clave"):
        meta[LEGACY_META_KEY.get(r["clave"], r["clave"])] = r["valor"]
    meta = dict(sorted(meta.items()))
    blob_keys = {r[0] for r in con.execute("SELECT clave FROM blobs")} if "blobs" in tables else set()
    docs = _rows(con, "SELECT * FROM documentos ORDER BY id")
    if len(docs) != 1:
        raise SpdfError("E013 documents must hold exactly one row")
    d = docs[0]
    document = {
        "id": d["id"], "kind": LEGACY_KIND.get(d["tipo"], d["tipo"]),
        "metadata": legacy_metadata(json.loads(d["metadatos"]), d["tipo"]),
        "source_sha256": d["huella"], "source_ref": _legacy_ref(d["original"], blob_keys), "mime": d["mime"],
        "bytes": d["bytes"], "unit_count": d["unidades"], "duration": d["duracion"], "created": d["creado"],
        "updated": d["actualizado"], "title": d["titulo"], "authors": d["autores"], "year": d["anio"],
        "language": d["idioma"], "rights": None,
    }
    ucols = {r[1] for r in con.execute("PRAGMA table_info(unidades)")}
    units = []
    for i, u in enumerate(_rows(con, "SELECT * FROM unidades ORDER BY orden, id"), start=1):
        units.append({
            "id": u["id"], "ord": i, "anchor": legacy_anchor(_j(u["ancla"])), "text": u["texto"], "notes": _j(u["notas"]),
            "header": u["cabecera"], "footer": u["pie"], "image": _legacy_ref(u["imagen"], blob_keys),
            "thumbnail": _legacy_ref(u["miniatura"], blob_keys), "reader": u["lector"], "confidence": u["confianza"],
            "printed": u["impresa"], "t0": u["t0"], "t1": u["t1"], "words": _j(u["palabras"]) if "palabras" in ucols else None,
        })
    sections = [{"id": s["id"], "parent": s["padre"], "level": s["nivel"], "title": s["titulo"], "unit_from": s["unidad_desde"],
                 "unit_to": s["unidad_hasta"], "summary": s["resumen"]}
                for s in _rows(con, "SELECT * FROM secciones ORDER BY id")]
    fcols = {r[1] for r in con.execute("PRAGMA table_info(fragmentos)")}
    fragments = [{"n": f["n"], "id": f["id"], "unit": f["unidad"], "ord": f["orden"], "text": f["texto"], "context": f["contexto"],
                  "section": _j(f["seccion"]), "anchor": legacy_anchor(_j(f["ancla"])), "anchor_end": legacy_anchor(_j(f["ancla_fin"])),
                  "search_text": f["texto_busqueda"] if "texto_busqueda" in fcols else None}
                 for f in _rows(con, "SELECT * FROM fragmentos ORDER BY n")]
    figures = [{"id": g["id"], "unit": g["unidad"], "image": _legacy_ref(g["imagen"], blob_keys, empty_keeps=True), "caption": g["pie"],
                "description": g["descripcion"], "anchor": legacy_anchor(_j(g["ancla"]))}
               for g in _rows(con, "SELECT * FROM figuras ORDER BY id")]
    spaces = [{"id": s["id"], "provider": s["proveedor"], "model": s["modelo"], "version": s["version"], "dims": s["dims"],
               "dtype": "f32", "normalized": s["normalizado"], "truncated_from": None,
               "modalities": [LEGACY_MODALITY.get(x, x) for x in json.loads(s["modalidades"])], "task_prefixes": None,
               "created": s["creado"]}
              for s in _rows(con, "SELECT * FROM espacios ORDER BY id")]
    vectors = {}
    rows = [(LEGACY_TARGET.get(o, o), i, e, bytes(v)) for o, i, e, v in con.execute("SELECT objetivo, id, espacio, valores FROM vectores")]
    for space in sorted({r[2] for r in rows}):
        sel = sorted((r for r in rows if r[2] == space), key=lambda r: (r[0], r[1]))
        h = hashlib.sha256()
        for r in sel:
            h.update(r[3])
        vectors[space] = {"count": len(sel), "sha256": h.hexdigest()}
    blobs = [{"key": k, "mime": m, "bytes": len(bytes(b)), "sha256": sha256_hex(bytes(b))}
             for k, m, b in con.execute("SELECT clave, mime, datos FROM blobs ORDER BY clave")]
    provenance = sort_provenance([{"stage": p["fase"], "provider": p["proveedor"], "model": None, "detail": _j(p["detalle"]), "ms": p["ms"], "at": p["cuando"]}
                                  for p in _rows(con, "SELECT fase, proveedor, detalle, ms, cuando FROM procedencia")])
    version = meta.get("spdf_version") or detect(con)[1]
    return canon({
        "spdf_version": version, "legacy": True, "meta": meta,
        "fts": {"tokenizer": _tokenizer(con, "fragmentos_fts"), "trigram": False},
        "document": document, "units": units, "sections": sections, "fragments": fragments, "figures": figures,
        "spaces": spaces, "vectors": vectors, "blobs": blobs, "provenance": provenance, "extensions": [],
    })


def dump_file(path: Path) -> dict:
    o = open_file(path)
    try:
        kind, _ = detect(o.con)
        if kind == "5":
            return dump_50(o.con)
        if kind == "4":
            return dump_legacy(o.con)
        raise SpdfError("E002 unknown application_id/version")
    finally:
        o.close()


def content_sha256(dump: dict) -> str:
    d = json.loads(json.dumps(dump))
    for k in INTEGRITY_KEYS:
        d.get("meta", {}).pop(k, None)
    return sha256_hex(jcs(canon(d)).encode("utf-8"))


# ---------------------------------------------------------------------------
# Writing a 5.0 file from a source ("full dump")
# ---------------------------------------------------------------------------

DTYPE = {"f32": ("<f", 4), "f16": ("<e", 2), "i8": ("<b", 1)}


def pack_vector(values, dtype: str) -> bytes:
    fmt, _ = DTYPE[dtype]
    if dtype == "i8":
        for v in values:
            if not isinstance(v, int) or not -127 <= v <= 127:
                raise SpdfError(f"i8 values are integers in [-127, 127], got {v!r}")
    out = b"".join(struct.pack(fmt, v) for v in values)
    if dtype in ("f32", "f16"):
        back = struct.unpack(f"<{len(values)}{fmt[1]}", out)
        if any(float(a) != float(b) for a, b in zip(back, values)):
            raise SpdfError(f"{dtype} values must be exactly representable")
    return out


def quantize(values, dtype: str) -> bytes:
    """Writer-side encoding of float values (CONTRACT §2): f32/f16 round to nearest even, i8 = clamp(round_half_away(v*127))."""
    if dtype == "i8":
        out = []
        for v in values:
            x = float(v) * 127
            if abs(x) >= 127:  # also catches v * 127 overflowing to infinity
                out.append(127 if x > 0 else -127)
                continue
            q = math.floor(abs(x) + 0.5) * (1 if x >= 0 else -1)
            out.append(max(-127, min(127, int(q))))
        return struct.pack(f"<{len(out)}b", *out)
    if dtype in ("f32", "f16"):
        fmt = "f" if dtype == "f32" else "e"
        try:
            data = struct.pack(f"<{len(values)}{fmt}", *[float(v) for v in values])
        except (OverflowError, struct.error):
            raise SpdfError(f"value out of range for {dtype}")
        return data
    raise SpdfError(f"unknown dtype {dtype}")


def unpack_vector(data: bytes, dtype: str) -> list[float]:
    fmt, size = DTYPE[dtype]
    n = len(data) // size
    vals = struct.unpack(f"<{n}{fmt[1]}", data)
    if dtype == "i8":
        return [v / 127 for v in vals]
    return [float(v) for v in vals]


def strip_source(source: dict) -> dict:
    """The expected dump of a source: drop vector values and blob bytes."""
    d = json.loads(json.dumps(source))
    for v in d.get("vectors", {}).values():
        v.pop("items", None)
    for b in d.get("blobs", []):
        b.pop("data_base64", None)
    return canon(d)


def seal_source(source: dict) -> dict:
    """Fill the derived fields of a source: vector count/sha256, blob bytes/sha256 (unless forced)."""
    s = canon(source)
    spaces = {sp["id"]: sp for sp in s.get("spaces", [])}
    for space, v in s.get("vectors", {}).items():
        dtype = spaces[space]["dtype"] if space in spaces else "f32"
        items = sorted(v["items"], key=lambda it: (it["target"], it["id"]))
        v["items"] = items
        h = hashlib.sha256()
        for it in items:
            h.update(pack_vector(it["values"], dtype))
        v["count"] = len(items)
        v["sha256"] = h.hexdigest()
    for b in s.get("blobs", []):
        data = base64.b64decode(b["data_base64"])
        b["bytes"] = len(data)
        b["sha256"] = sha256_hex(data)
    s["blobs"] = sorted(s.get("blobs", []), key=lambda b: b["key"])
    s["units"] = sorted(s.get("units", []), key=lambda u: (u["ord"], u["id"]))
    s["fragments"] = sorted(s.get("fragments", []), key=lambda f: f["n"])
    for k, key in (("sections", "id"), ("figures", "id"), ("spaces", "id"), ("extensions", "name")):
        s[k] = sorted(s.get(k, []), key=lambda r: r[key])
    s["provenance"] = sort_provenance(s.get("provenance", []))
    return s


def write_50(source: dict, path: Path, *, schema_sql: str | None = None, vacuum: bool = True, page_size: int = 4096) -> None:
    """Build a SPDF 5.0 file from a full dump. Rows are inserted in dump order."""
    s = canon(source)
    path = Path(path)
    if path.exists():
        path.unlink()
    con = sqlite3.connect(str(path))
    con.execute(f"PRAGMA page_size = {int(page_size)}")
    con.execute("PRAGMA journal_mode = DELETE")
    con.executescript(schema_sql if schema_sql is not None else SCHEMA_50.read_text(encoding="utf-8"))
    if s.get("fts", {}).get("trigram"):
        con.execute("CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')")
    doc = s["document"]
    did = doc["id"]
    con.executemany("INSERT INTO spdf_meta(key, value) VALUES (?, ?)", sorted(s["meta"].items()))
    con.execute(
        "INSERT INTO documents (id, kind, metadata, source_sha256, source_ref, mime, bytes, unit_count, duration, created, updated, title, authors, year, language, rights) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (did, doc["kind"], stored_json(doc["metadata"]), doc["source_sha256"], doc["source_ref"], doc["mime"], doc["bytes"],
         doc["unit_count"], _real(doc["duration"]), doc["created"], doc["updated"], doc["title"], doc["authors"], doc["year"],
         doc["language"], None if doc["rights"] is None else stored_json(doc["rights"])))
    for u in s["units"]:
        con.execute(
            "INSERT INTO units (id, document, ord, anchor, text, notes, header, footer, image, thumbnail, reader, confidence, printed, t0, t1, words) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (u["id"], did, u["ord"], stored_json(u["anchor"]), u["text"], _sj(u["notes"]), u["header"], u["footer"], u["image"],
             u["thumbnail"], u["reader"], _real(u["confidence"]), u["printed"], _real(u["t0"]), _real(u["t1"]), _sj(u["words"])))
    for x in s["sections"]:
        con.execute("INSERT INTO sections (id, document, parent, level, title, unit_from, unit_to, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (x["id"], did, x["parent"], x["level"], x["title"], x["unit_from"], x["unit_to"], x["summary"]))
    for f in s["fragments"]:
        con.execute(
            "INSERT INTO fragments (n, id, document, unit, ord, text, context, section, anchor, anchor_end, search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f["n"], f["id"], did, f["unit"], f["ord"], f["text"], f["context"], _sj(f["section"]), stored_json(f["anchor"]),
             _sj(f["anchor_end"]), f["search_text"]))
    for g in s["figures"]:
        con.execute("INSERT INTO figures (id, document, unit, image, caption, description, anchor) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (g["id"], did, g["unit"], g["image"], g["caption"], g["description"], stored_json(g["anchor"])))
    dtypes = {}
    for sp in s["spaces"]:
        dtypes[sp["id"]] = sp["dtype"]
        con.execute(
            "INSERT INTO spaces (id, provider, model, version, dims, dtype, normalized, truncated_from, modalities, task_prefixes, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sp["id"], sp["provider"], sp["model"], sp["version"], sp["dims"], sp["dtype"], sp["normalized"], sp["truncated_from"],
             stored_json(sp["modalities"]), _sj(sp["task_prefixes"]), sp["created"]))
    for space, v in s["vectors"].items():
        for it in v["items"]:
            con.execute("INSERT INTO vectors (target, id, space, document, data) VALUES (?, ?, ?, ?, ?)",
                        (it["target"], it["id"], space, did, pack_vector(it["values"], dtypes.get(space, "f32"))))
    for b in s["blobs"]:
        con.execute("INSERT INTO blobs (key, mime, sha256, data) VALUES (?, ?, ?, ?)",
                    (b["key"], b["mime"], b["sha256"], base64.b64decode(b["data_base64"])))
    for p in s["provenance"]:
        con.execute("INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (did, p["stage"], p["provider"], p["model"], _sj(p["detail"]), p["ms"], p["at"]))
    for e in s["extensions"]:
        con.execute("INSERT INTO extensions (name, version, required) VALUES (?, ?, ?)", (e["name"], e["version"], e["required"]))
    con.execute("INSERT INTO fragments_fts(fragments_fts) VALUES ('rebuild')")
    if s.get("fts", {}).get("trigram"):
        con.execute("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES ('rebuild')")
    con.commit()
    if vacuum:
        con.execute("VACUUM")
    con.close()


def _sj(v):
    return None if v is None else stored_json(v)


def _real(v):
    return None if v is None else float(v)


# ---------------------------------------------------------------------------
# Writing a legacy 4.x file (Spanish schema, gzip)
# ---------------------------------------------------------------------------


def write_legacy(source: dict, path: Path) -> None:
    """Build an authentic 4.0/4.1 file: the Scholaris schema verbatim, triggers included, gzip level 6, mtime 0."""
    version = source["version"]
    schema = (SCHEMA_41 if version == "4.1" else SCHEMA_40).read_text(encoding="utf-8")
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    os.unlink(tmp)
    con = sqlite3.connect(tmp)
    con.execute("PRAGMA page_size = 4096")
    con.execute("PRAGMA journal_mode = DELETE")
    con.executescript(schema)
    t = source["tablas"]
    json_cols = {"metadatos", "bibliotecas", "ancla", "notas", "palabras", "seccion", "ancla_fin", "modalidades", "detalle"}
    for table in ("spdf", "documentos", "unidades", "secciones", "fragmentos", "figuras", "espacios", "vectores", "blobs", "procedencia"):
        for row in t.get(table, []):
            cols, vals = [], []
            for k, v in row.items():
                if table == "vectores" and k == "valores":
                    v = pack_vector(v, "f32")
                elif table == "blobs" and k == "datos":
                    v = base64.b64decode(v)
                elif k in json_cols and v is not None:
                    v = stored_json(v)
                cols.append(k)
                vals.append(v)
            con.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", vals)
    if source.get("user_version") is not None:
        con.execute(f"PRAGMA user_version = {int(source['user_version'])}")
    con.commit()
    con.execute("VACUUM")
    con.close()
    data = Path(tmp).read_bytes()
    os.unlink(tmp)
    Path(path).write_bytes(gzip.compress(data, compresslevel=6, mtime=0))


# ---------------------------------------------------------------------------
# Lexical search (CONTRACT §6)
# ---------------------------------------------------------------------------

QUOTES = {'"': ('"',), "“": ("”",), "«": ("»",), "„": ("“", "”")}
CJK_RANGES = ((0x2E80, 0x2FDF), (0x3040, 0x30FF), (0x3100, 0x312F), (0x3130, 0x318F), (0x31A0, 0x31FF), (0x3400, 0x4DBF),
              (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7AF), (0xF900, 0xFAFF), (0xFF66, 0xFF9F), (0x20000, 0x3FFFF))
BM25_WEIGHTS = (1.0, 0.5, 0.5, 1.0)


def is_word_char(c: str) -> bool:
    return unicodedata.category(c)[0] in "LMN"


def words(s: str) -> list[str]:
    out, cur = [], []
    for c in s:
        if is_word_char(c):
            cur.append(c)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def dedup_key(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def is_cjk(q: str) -> bool:
    return any(a <= ord(c) <= b for c in q for a, b in CJK_RANGES)


def query_terms(query: str) -> tuple[list[str], str]:
    """(terms, operator) of the reference algorithm."""
    q = unicodedata.normalize("NFC", query)
    phrases, rest = [], []
    i = 0
    while i < len(q):
        c = q[i]
        if c in QUOTES:
            closes = QUOTES[c]
            j = next((k for k in range(i + 1, len(q)) if q[k] in closes), None)
            if j is not None:
                phrases.append(q[i + 1:j])
                rest.append(" ")
                i = j + 1
                continue
            rest.append(" ")
            i += 1
            continue
        rest.append(c)
        i += 1
    phrase_terms = [" ".join(words(p)) for p in phrases if words(p)]
    if phrase_terms:
        terms, op = phrase_terms, " AND "
    else:
        terms, op = words("".join(rest)), " OR "
    seen, out = set(), []
    for t in terms:
        k = dedup_key(t)
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out, op


def fts_string(t: str) -> str:
    return '"' + t.replace('"', '""') + '"'


def match_expression(query: str) -> str | None:
    terms, op = query_terms(query)
    if not terms:
        return None
    return op.join(fts_string(t) for t in terms)


def lexical_search(con, query: str, limit: int = 10) -> dict:
    """Returns {"route", "match", "results": [(n, fragment_id, score)]}."""
    terms, op = query_terms(query)
    if not terms:
        return {"route": "fts", "match": None, "results": []}
    match = op.join(fts_string(t) for t in terms)
    q = unicodedata.normalize("NFC", query)
    tables = table_names(con)
    if is_cjk(q):
        if "fragments_fts_trigram" in tables and all(len(t) >= 3 for t in terms):
            rows = con.execute(
                "SELECT f.n, f.id, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram JOIN fragments f ON f.n = fragments_fts_trigram.rowid "
                "WHERE fragments_fts_trigram MATCH ? ORDER BY r, f.n LIMIT ?", (match, limit)).fetchall()
            return {"route": "trigram", "match": match, "results": [(n, i, -r) for n, i, r in rows]}
        hits_sql = " + ".join("(instr(text, ?) > 0)" for _ in terms)
        need = len(terms) if op == " AND " else 1
        rows = con.execute(
            f"SELECT n, id, ({hits_sql}) AS hits FROM fragments WHERE ({hits_sql}) >= ? ORDER BY hits DESC, n LIMIT ?",
            (*terms, *terms, need, limit)).fetchall()
        return {"route": "substring", "match": None, "results": [(n, i, float(h)) for n, i, h in rows]}
    w = ", ".join(str(x) for x in BM25_WEIGHTS)
    rows = con.execute(
        f"SELECT f.n, f.id, bm25(fragments_fts, {w}) AS r FROM fragments_fts JOIN fragments f ON f.n = fragments_fts.rowid "
        "WHERE fragments_fts MATCH ? ORDER BY r, f.n LIMIT ?", (match, limit)).fetchall()
    return {"route": "fts", "match": match, "results": [(n, i, -r) for n, i, r in rows]}


# ---------------------------------------------------------------------------
# Vector and hybrid search
# ---------------------------------------------------------------------------


def vector_search(con, space: str, query: list[float], limit: int = 10, target: str = "fragment", exact: bool = False):
    """[(tiebreak, id, score)] ordered by score desc then tiebreak. With exact=True scores are Fractions."""
    sp = con.execute("SELECT dims, dtype, normalized FROM spaces WHERE id = ?", (space,)).fetchone()
    if not sp:
        raise SpdfError(f"unknown space {space}")
    dims, dtype, normalized = sp
    if len(query) != dims:
        raise SpdfError("query vector has the wrong length")
    if target == "fragment":
        tb = {i: n for n, i in con.execute("SELECT n, id FROM fragments")}
    elif target == "unit":
        tb = {i: o for o, i in con.execute("SELECT ord, id FROM units")}
    else:
        tb = None
    out = []
    for vid, data in con.execute("SELECT id, data FROM vectors WHERE space = ? AND target = ?", (space, target)):
        data = bytes(data)
        if exact:
            fmt, size = DTYPE[dtype]
            raw = struct.unpack(f"<{len(data) // size}{fmt[1]}", data)
            vals = [Fraction(v, 127) if dtype == "i8" else Fraction(v) for v in raw]
            qs = [Fraction(x) for x in query]
            score = sum(a * b for a, b in zip(qs, vals))
            if not normalized:
                import decimal
                with decimal.localcontext() as ctx:
                    ctx.prec = 60
                    num = Decimal(score.numerator) / Decimal(score.denominator)
                    nq = sum(x * x for x in qs)
                    nv = sum(x * x for x in vals)
                    den = (Decimal(nq.numerator) / Decimal(nq.denominator)).sqrt() * (Decimal(nv.numerator) / Decimal(nv.denominator)).sqrt()
                    score = Fraction(num / den) if den else Fraction(0)
        else:
            vals = unpack_vector(data, dtype)
            score = 0.0
            for a, b in zip(query, vals):
                score += float(a) * b
            if not normalized:
                nq = math.sqrt(sum(float(a) * float(a) for a in query))
                nv = math.sqrt(sum(b * b for b in vals))
                score = score / (nq * nv) if nq and nv else 0.0
        out.append((tb[vid] if tb is not None else vid, vid, score))
    out.sort(key=lambda r: (-r[2], r[0]))
    return out[:limit]


RRF_K = 10


def hybrid_search(con, query_text: str, space: str, query_vector: list[float], limit: int = 10, exact: bool = False):
    """[(n, id, score, via)] with RRF k=10 over lists of depth max(limit, 50)."""
    depth = max(limit, 50)
    lex = lexical_search(con, query_text, depth)["results"]
    vec = vector_search(con, space, query_vector, depth, exact=exact)
    scores: dict[str, object] = {}
    via: dict[str, list[str]] = {}
    nmap = {i: n for n, i in con.execute("SELECT n, id FROM fragments")}
    for name, lst in (("lexical", lex), ("vector", vec)):
        for rank, row in enumerate(lst, start=1):
            fid = row[1]
            inc = Fraction(1, RRF_K + rank) if exact else 1.0 / (RRF_K + rank)
            scores[fid] = scores.get(fid, Fraction(0) if exact else 0.0) + inc
            via.setdefault(fid, []).append(name)
    out = sorted(((nmap[f], f, s, via[f]) for f, s in scores.items()), key=lambda r: (-r[2], r[0]))
    return out[:limit], out


# ---------------------------------------------------------------------------
# Anchor URI (CONTRACT §3)
# ---------------------------------------------------------------------------

UNRESERVED = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
PARAM_ORDER = ("p", "pe", "f", "fe", "t", "s", "para", "sl", "sh", "rows", "v", "ref", "char", "xywh")
SHA_REF = re.compile(r"^sha256-[0-9a-f]{64}$")


def enc(s: str) -> str:
    return "".join(chr(b) if b in UNRESERVED else f"%{b:02X}" for b in s.encode("utf-8"))


def dec(s: str) -> str:
    if re.search(r"%(?![0-9A-Fa-f]{2})", s):
        raise SpdfError("bad percent-encoding")
    try:
        return urllib.parse.unquote(s, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        raise SpdfError("percent-encoding is not UTF-8")


def fmt_num(x) -> str:
    return es_number(canon(x))


def pct(frac) -> str:
    return es_number(canon(round(float(frac) * 100, 4)))


def anchor_locator(anchor: dict, end: dict | None = None) -> dict:
    L: dict = {}
    t = anchor.get("type")
    if t == "page":
        L["p"] = anchor["physical"]
        if anchor.get("printed") is not None:
            L["f"] = anchor["printed"]
        if end and end.get("type") == "page":
            if end.get("physical") is not None and end["physical"] != anchor["physical"]:
                L["pe"] = end["physical"]
            if end.get("printed") is not None and end.get("printed") != anchor.get("printed"):
                L["fe"] = end["printed"]
    elif t == "time":
        t1 = end["t1"] if end and end.get("type") == "time" else anchor.get("t1")
        L["t"] = [anchor["t0"]] if t1 is None else [anchor["t0"], t1]
    elif t in ("section", "web"):
        if anchor.get("path"):
            L["s"] = list(anchor["path"])
        if anchor.get("paragraph") is not None:
            L["para"] = anchor["paragraph"]
        if anchor.get("printed") is not None:
            L["f"] = anchor["printed"]
            if end and end.get("printed") is not None and end["printed"] != anchor["printed"]:
                L["fe"] = end["printed"]
    elif t == "slide":
        L["sl"] = anchor["n"]
    elif t == "sheet":
        L["sh"] = anchor["sheet"]
        L["rows"] = [anchor["row_from"], anchor["row_to"]]
    elif t == "verse":
        a, b = anchor["line_from"], anchor.get("line_to")
        L["v"] = [a] if b is None or b == a else [a, b]
        if anchor.get("printed") is not None:
            L["f"] = anchor["printed"]
    elif t == "canonical":
        L["ref"] = {"scheme": anchor["scheme"], "ref": anchor["ref"]}
    if anchor.get("chars") is not None:
        L["char"] = list(anchor["chars"])
    if anchor.get("region") is not None:
        r = anchor["region"]
        L["xywh"] = [r["x"], r["y"], r["w"], r["h"]]
    return canon(L)


def format_locator(docref: str, L: dict) -> str:
    ref = docref if SHA_REF.match(docref) else enc(docref)
    parts = []
    for k in PARAM_ORDER:
        if k not in L:
            continue
        v = L[k]
        if k in ("p", "pe", "para", "sl"):
            s = str(v)
        elif k in ("f", "fe", "sh"):
            s = enc(v)
        elif k == "t":
            s = ",".join(fmt_num(x) for x in v)
        elif k == "s":
            s = "/".join(enc(e) for e in v)
        elif k == "rows":
            s = f"{v[0]}-{v[1]}"
        elif k == "v":
            s = "-".join(str(x) for x in v)
        elif k == "ref":
            s = enc(v["scheme"]) + ":" + enc(v["ref"])
        elif k == "char":
            s = f"{v[0]},{v[1]}"
        elif k == "xywh":
            s = "percent:" + ",".join(pct(x) for x in v)
        parts.append(f"{k}={s}")
    return "spdf:" + ref + ("#" + "&".join(parts) if parts else "")


def format_uri(docref: str, anchor: dict, end: dict | None = None) -> str:
    return format_locator(docref, anchor_locator(anchor, end))


_INT = re.compile(r"^(0|[1-9][0-9]*)$")
_DEC = re.compile(r"^[0-9]+(\.[0-9]+)?$")
_CLOCK = re.compile(r"^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$")


def _int(s: str) -> int:
    if not _INT.match(s):
        raise SpdfError(f"not an integer: {s!r}")
    return int(s)


def _npt(s: str) -> float:
    if _DEC.match(s):
        return float(s)
    m = _CLOCK.match(s)
    if not m:
        raise SpdfError(f"bad time: {s!r}")
    h = int(m.group(1) or 0)
    return round6(h * 3600 + int(m.group(2)) * 60 + float(m.group(3)))


def parse_uri(uri: str) -> dict:
    if not uri.startswith("spdf:"):
        raise SpdfError("not an spdf: URI")
    rest = uri[5:]
    docref_raw, _, frag = rest.partition("#")
    if not docref_raw:
        raise SpdfError("empty document reference")
    docref = dec(docref_raw)
    L: dict = {}
    if frag:
        for part in frag.split("&"):
            if not part:
                continue
            k, eq, v = part.partition("=")
            if not eq:
                raise SpdfError(f"parameter without value: {part!r}")
            if k in L:
                raise SpdfError(f"duplicate parameter {k}")
            if k in ("p", "pe", "para", "sl"):
                L[k] = _int(v)
                if k in ("p", "pe", "sl") and L[k] < 1:
                    raise SpdfError(f"{k} starts at 1")
            elif k in ("f", "fe", "sh"):
                L[k] = dec(v)
            elif k == "t":
                v = v[4:] if v.startswith("npt:") else v
                xs = [_npt(x) for x in v.split(",")]
                if len(xs) > 2 or (len(xs) == 2 and xs[1] < xs[0]):
                    raise SpdfError("bad t")
                L[k] = xs
            elif k == "s":
                L[k] = [dec(e) for e in v.split("/")]
            elif k == "rows":
                a, dash, b = v.partition("-")
                if not dash:
                    raise SpdfError("rows needs a-b")
                L[k] = [_int(a), _int(b)]
            elif k == "v":
                xs = [_int(x) for x in v.split("-")]
                if len(xs) > 2:
                    raise SpdfError("bad v")
                L[k] = xs
            elif k == "ref":
                a, colon, b = v.partition(":")
                if not colon or not a:
                    raise SpdfError("ref needs scheme:ref")
                L[k] = {"scheme": dec(a), "ref": dec(b)}
            elif k == "char":
                xs = v.split(",")
                if len(xs) != 2:
                    raise SpdfError("char needs start,end")
                a, b = _int(xs[0]), _int(xs[1])
                if b < a:
                    raise SpdfError("char end before start")
                L[k] = [a, b]
            elif k == "xywh":
                if not v.startswith("percent:"):
                    raise SpdfError("xywh must use percent:")
                xs = v[8:].split(",")
                if len(xs) != 4 or not all(_DEC.match(x) for x in xs):
                    raise SpdfError("bad xywh")
                L[k] = [round6(float(x) / 100) for x in xs]
            # unknown keys are ignored
    return canon({"docref": docref, "locator": L})


# ---------------------------------------------------------------------------
# Short citation (CONTRACT §10)
# ---------------------------------------------------------------------------

VOWELS = set("aeiouáéíóúü")


def _name(a: dict) -> str:
    if a.get("literal"):
        return a["literal"]
    if a.get("family"):
        ndp = a.get("non-dropping-particle")
        return (ndp + " " if ndp else "") + a["family"]
    return a.get("given", "")


def _starts_with_i_sound(s: str) -> bool:
    low = s.lower()
    if low[:2] in ("hi", "hí"):
        rest = low[2:]
    elif low[:1] in ("i", "í"):
        rest = low[1:]
    else:
        return False
    return not (rest and rest[0] in VOWELS)


def _short_title(m: dict) -> str:
    if m.get("title-short"):
        return m["title-short"]
    return (m.get("title") or "").split(":")[0].strip()


def _hms(t: float) -> str:
    s = math.floor(t)
    h, m, x = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{x:02d}" if h else f"{m}:{x:02d}"


def _page_locator(anchor, end, es, label_single, label_plural):
    def lab(a):
        p = a.get("printed")
        if p is None:
            return None
        return f"[{p}]" if a.get("source") == "inferred" else p
    a = lab(anchor)
    if a is None:
        return "s. p." if es else "n. pag."
    if end and end.get("type") == anchor.get("type"):
        b = lab(end)
        if b is not None and end.get("printed") != anchor.get("printed"):
            return f"{label_plural} {a}-{b}"
    return f"{label_single} {a}"


def locator(anchor: dict, end: dict | None, es: bool) -> str | None:
    t = anchor.get("type")
    if t == "page":
        fol = anchor.get("foliation", "page")
        single = {"page": "p.", "leaf": "fol.", "column": "col."}[fol]
        plural = {"page": "pp.", "leaf": "fols.", "column": "cols."}[fol]
        return _page_locator(anchor, end, es, single, plural)
    if t == "time":
        s = _hms(anchor["t0"])
        if end and end.get("type") == "time":
            s += "-" + _hms(end["t1"])
        return s
    if t in ("section", "web"):
        if anchor.get("printed") is not None:
            return _page_locator(anchor, end, es, "p.", "pp.")
        parts = []
        if anchor.get("path"):
            parts.append("§ " + anchor["path"][-1])
        if anchor.get("paragraph") is not None:
            parts.append(("párr. " if es else "para. ") + str(anchor["paragraph"]))
        return ", ".join(parts) or None
    if t == "slide":
        return ("diap. " if es else "slide ") + str(anchor["n"])
    if t == "sheet":
        a, b = anchor["row_from"], anchor["row_to"]
        if a == b:
            return f"{anchor['sheet']}, {'fila' if es else 'row'} {a}"
        return f"{anchor['sheet']}, {'filas' if es else 'rows'} {a}-{b}"
    if t == "verse":
        a, b = anchor["line_from"], anchor.get("line_to")
        return f"v. {a}" if b is None or b == a else f"vv. {a}-{b}"
    if t == "canonical":
        return anchor["ref"]
    return None


def cite(anchor: dict, end: dict | None, metadata: dict, locale: str) -> str:
    es = locale.split("-")[0].lower() == "es"
    names = [_name(a) for a in metadata.get("author") or []]
    names = [n for n in names if n]
    if not names:
        who = _short_title(metadata)
    elif len(names) == 1:
        who = names[0]
    elif len(names) == 2:
        conj = (" e " if _starts_with_i_sound(names[1]) else " y ") if es else " and "
        who = names[0] + conj + names[1]
    else:
        who = names[0] + " et al."
    year = None
    issued = metadata.get("issued") or {}
    dp = issued.get("date-parts") if isinstance(issued, dict) else None
    if dp and dp[0]:
        y = dp[0][0]
        y = int(y)
        year = str(y) if y > 0 else (f"{-y} a. C." if es else f"{-y} BC")
    if year is None:
        year = "s. f." if es else "n.d."
    loc = locator(anchor, end, es)
    return "(" + ", ".join([who, year] + ([loc] if loc else [])) + ")"


# ---------------------------------------------------------------------------
# Validation (CONTRACT §12)
# ---------------------------------------------------------------------------

REQUIRED_COLUMNS = {
    "spdf_meta": ["key", "value"],
    "documents": ["id", "kind", "metadata", "source_sha256", "source_ref", "mime", "bytes", "unit_count", "duration", "created",
                  "updated", "title", "authors", "year", "language", "rights"],
    "units": ["id", "document", "ord", "anchor", "text", "notes", "header", "footer", "image", "thumbnail", "reader", "confidence",
              "printed", "t0", "t1", "words"],
    "sections": ["id", "document", "parent", "level", "title", "unit_from", "unit_to", "summary"],
    "fragments": ["n", "id", "document", "unit", "ord", "text", "context", "section", "anchor", "anchor_end", "search_text"],
    "fragments_fts": [],
    "figures": ["id", "document", "unit", "image", "caption", "description", "anchor"],
    "spaces": ["id", "provider", "model", "version", "dims", "dtype", "normalized", "truncated_from", "modalities", "task_prefixes", "created"],
    "vectors": ["target", "id", "space", "document", "data"],
    "blobs": ["key", "mime", "sha256", "data"],
    "provenance": ["document", "stage", "provider", "model", "detail", "ms", "at"],
    "extensions": ["name", "version", "required"],
}
REQUIRED_META = ("spdf_version", "profile", "created", "generator", "document_id")
ANCHOR_TYPES = {"page", "time", "section", "slide", "sheet", "web", "image", "verse", "canonical"}
LEGACY_TRIGGERS = {"fragmentos_ai", "fragmentos_ad", "fragmentos_au"}
ALLOWED_VTABLES = {"fragments_fts", "fragments_fts_trigram"}
KNOWN_EXTENSIONS: set[str] = set()


def _is_int(v):
    """A JSON number with an integral value (10 and 10.0 are the same JSON value)."""
    if isinstance(v, bool):
        return False
    return isinstance(v, int) or (isinstance(v, float) and v.is_integer())


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_anchor(a, text: str | None):
    """None if fine, else (code, message)."""
    if not isinstance(a, dict):
        return ("E040", "anchor is not an object")
    t = a.get("type")
    if not isinstance(t, str):
        return ("E040", "anchor without type")
    if t not in ANCHOR_TYPES:
        return ("E041", f"unknown anchor type {t!r}")
    req = {
        "page": lambda: _is_int(a.get("physical")) and a["physical"] >= 1 and "printed" in a and (a["printed"] is None or isinstance(a["printed"], str)),
        "time": lambda: _is_num(a.get("t0")) and _is_num(a.get("t1")) and 0 <= a["t0"] <= a["t1"],
        "section": lambda: isinstance(a.get("path"), list) and all(isinstance(x, str) for x in a["path"]),
        "slide": lambda: _is_int(a.get("n")) and a["n"] >= 1,
        "sheet": lambda: isinstance(a.get("sheet"), str) and _is_int(a.get("row_from")) and _is_int(a.get("row_to")),
        "web": lambda: isinstance(a.get("url"), str),
        "image": lambda: True,
        "verse": lambda: _is_int(a.get("line_from")),
        "canonical": lambda: isinstance(a.get("scheme"), str) and isinstance(a.get("ref"), str),
    }[t]
    if not req():
        return ("E040", f"{t} anchor misses or mistypes a required member")
    if "region" in a:
        r = a["region"]
        if not (isinstance(r, dict) and all(_is_num(r.get(k)) for k in "xywh")):
            return ("E040", "bad region")
    if "chars" in a:
        c = a["chars"]
        if not (isinstance(c, list) and len(c) == 2 and all(_is_int(x) for x in c)):
            return ("E040", "bad chars")
        if text is not None and not (0 <= c[0] <= c[1] <= len(unicodedata.normalize("NFC", text))):
            return ("E042", f"chars {c} out of range (unit text has {len(text)} code points)")
    return None


def validate_file(path: Path) -> dict:
    errors, warnings = [], []
    version, profile = None, []

    def err(code, msg, where=""):
        errors.append({"code": code, "message": msg, "where": where})

    def warn(code, msg, where=""):
        warnings.append({"code": code, "message": msg, "where": where})

    def result():
        return {"valid": not errors, "version": version, "profile": profile, "errors": errors, "warnings": warnings}

    try:
        o = open_file(path)
    except SpdfError as e:
        err("E001", str(e))
        return result()
    except sqlite3.DatabaseError as e:
        err("E001", str(e))
        return result()
    con = o.con
    try:
        try:
            kind, version = detect(con)
        except sqlite3.DatabaseError as e:
            err("E001", str(e))
            return result()
        if kind == "?":
            err("E002", "unknown application_id or user_version")
            return result()
        if kind == "4":
            warn("W110", f"legacy SPDF {version} file")
            _validate_legacy(con, err)
            return result()
        if o.gzipped:
            warn("E003", "SPDF 5.0 should not be gzip-wrapped")
        if version != "5.0":
            warn("W105", f"newer minor version {version}")
            hard_err = err

            def err(code, msg, where=""):  # noqa: F811 - a later minor may define these
                (warn if code in ("E041", "E032") else hard_err)(code, msg, where)
        for name, typ in con.execute("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')"):
            err("E020", f"{typ} {name} present", name)
        for name, sql in con.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'"):
            if name not in ALLOWED_VTABLES or not re.search(r"USING\s+fts5\s*\(", sql or "", re.I):
                err("E020", f"virtual table {name} present", name)
        tables = table_names(con)
        present = {}
        for t, cols in REQUIRED_COLUMNS.items():
            if t not in tables:
                err("E010", f"missing table {t}", t)
                continue
            have = {r[1] for r in con.execute(f'PRAGMA table_info("{t}")')}
            present[t] = have
            for c in cols:
                if c not in have:
                    err("E011", f"missing column {t}.{c}", f"{t}.{c}")
        meta = {}
        if "key" in present.get("spdf_meta", ()) and "value" in present.get("spdf_meta", ()):
            meta = dict(con.execute("SELECT key, value FROM spdf_meta"))
            for k in REQUIRED_META:
                if k not in meta:
                    err("E012", f"missing spdf_meta key {k}", k)
            profile = (meta.get("profile") or "").split()
        ok = lambda t, *cols: t in present and all(c in present[t] for c in cols)
        docs = []
        if ok("documents", "id", "metadata"):
            docs = con.execute("SELECT id, metadata, rights, unit_count FROM documents").fetchall() if ok("documents", "rights", "unit_count") else \
                [(i, m, None, None) for i, m in con.execute("SELECT id, metadata FROM documents")]
            if len(docs) != 1:
                err("E013", f"documents has {len(docs)} rows", "documents")
            for did, md, rights, unit_count in docs:
                try:
                    m = json.loads(md)
                    if not (isinstance(m, dict) and isinstance(m.get("type"), str) and isinstance(m.get("title"), str)):
                        err("E051", "metadata needs a string type and title", did)
                except (json.JSONDecodeError, TypeError):
                    err("E050", "metadata is not valid JSON", did)
                if rights is not None:
                    try:
                        json.loads(rights)
                    except json.JSONDecodeError:
                        err("E050", "rights is not valid JSON", did)
        if ok("extensions", "name", "required"):
            for name, req in con.execute("SELECT name, required FROM extensions ORDER BY name"):
                if req and name not in KNOWN_EXTENSIONS:
                    err("E060", f"unknown required extension {name}", name)
        texts = {}
        if ok("units", "id", "ord", "anchor", "text"):
            rows = con.execute("SELECT id, ord, anchor, text FROM units ORDER BY ord, id").fetchall()
            if [r[1] for r in rows] != list(range(1, len(rows) + 1)):
                err("E090", "units.ord is not 1..N", "units")
            if docs and len(docs) == 1 and docs[0][3] is not None and docs[0][3] != len(rows):
                warn("W102", f"unit_count {docs[0][3]} but {len(rows)} units", "documents.unit_count")
            for uid, _, anc, text in rows:
                texts[uid] = text
                _anchor_err(err, anc, text, f"units/{uid}")
        if ok("fragments", "id", "unit", "anchor"):
            has_end = "anchor_end" in present["fragments"]
            for fid, unit, anc, end in con.execute(f"SELECT id, unit, anchor, {'anchor_end' if has_end else 'NULL'} FROM fragments ORDER BY n"):
                _anchor_err(err, anc, texts.get(unit), f"fragments/{fid}")
                if end is not None:
                    _anchor_err(err, end, None, f"fragments/{fid}/anchor_end")
        if ok("figures", "id", "unit", "anchor"):
            for gid, unit, anc in con.execute("SELECT id, unit, anchor FROM figures ORDER BY id"):
                _anchor_err(err, anc, texts.get(unit), f"figures/{gid}")
        spaces = {}
        if ok("spaces", "id", "dims", "dtype"):
            for sid, dims, dtype in con.execute("SELECT id, dims, dtype FROM spaces ORDER BY id"):
                spaces[sid] = (dims, dtype)
                if dtype not in DTYPE:
                    err("E032", f"unknown dtype {dtype!r}", sid)
        nvec = 0
        if ok("vectors", "target", "id", "space", "data"):
            for target, vid, space, data in con.execute("SELECT target, id, space, data FROM vectors ORDER BY space, target, id"):
                nvec += 1
                where = f"vectors/{space}/{target}/{vid}"
                if space not in spaces:
                    err("E031", f"unknown space {space}", where)
                    continue
                dims, dtype = spaces[space]
                if dtype not in DTYPE:
                    continue
                if not isinstance(data, bytes) or len(data) != dims * DTYPE[dtype][1]:
                    err("E030", f"vector length {len(data) if isinstance(data, bytes) else '?'} != {dims} x {DTYPE[dtype][1]}", where)
        if "fragments_fts" in tables:
            mem = sqlite3.connect(":memory:")
            try:
                con.backup(mem)
                mem.execute("INSERT INTO fragments_fts(fragments_fts, rank) VALUES ('integrity-check', 1)")
                if "fragments_fts_trigram" in tables:
                    mem.execute("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES ('integrity-check', 1)")
            except sqlite3.DatabaseError as e:
                err("E070", f"FTS index out of sync: {e}", "fragments_fts")
            finally:
                mem.close()
        if ok("blobs", "key", "sha256", "data"):
            for key, sha, data in con.execute("SELECT key, sha256, data FROM blobs ORDER BY key"):
                if sha256_hex(bytes(data)) != sha:
                    err("E080", "blob sha256 mismatch", key)
        if "content_sha256" in meta and not errors:
            try:
                actual = content_sha256(dump_50(con))
            except (SpdfError, json.JSONDecodeError) as e:
                actual = f"unavailable ({e})"
            if actual != meta["content_sha256"]:
                err("E081", "content_sha256 does not match the canonical dump", "spdf_meta.content_sha256")
            elif "signature" in meta:
                ok_sig = False
                try:
                    signer = meta.get("signer", "")
                    if signer.startswith("ed25519:"):
                        pk = base64.b64decode(signer[8:], validate=True)
                        sig = base64.b64decode(meta["signature"], validate=True)
                        ok_sig = ed25519.verify(pk, SIGN_PREFIX + meta["content_sha256"].encode("ascii"), sig)
                except (ValueError, TypeError):
                    ok_sig = False
                if not ok_sig:
                    err("E082", "signature does not verify", "spdf_meta.signature")
        if "semantic" in profile and nvec == 0:
            warn("W100", "profile semantic without vectors")
        if "media" in profile and ok("units", "anchor"):
            has_time = any(json.loads(a).get("type") == "time" for (a,) in con.execute("SELECT anchor FROM units") if _json_ok(a))
            if not has_time:
                warn("W101", "profile media without time anchors")
        return result()
    finally:
        o.close()


def _json_ok(s):
    try:
        json.loads(s)
        return True
    except (json.JSONDecodeError, TypeError):
        return False


def _anchor_err(err, raw, text, where):
    try:
        a = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        err("E040", "anchor is not valid JSON", where)
        return
    r = check_anchor(a, text)
    if r:
        err(r[0], r[1], where)


def _validate_legacy(con, err):
    tables = table_names(con)
    for t in ("spdf", "documentos", "unidades", "fragmentos", "fragmentos_fts"):
        if t not in tables:
            err("E010", f"missing legacy table {t}", t)
    for name, typ in con.execute("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')"):
        if not (typ == "trigger" and name in LEGACY_TRIGGERS):
            err("E020", f"{typ} {name} present", name)


def sign_dump_meta(source: dict, secret: bytes) -> dict:
    """Set meta.content_sha256, meta.signer and meta.signature of a source (in place) and return it."""
    meta = source["meta"]
    for k in INTEGRITY_KEYS:
        meta.pop(k, None)
    h = content_sha256(strip_source(source))
    meta["content_sha256"] = h
    meta["signer"] = "ed25519:" + base64.b64encode(ed25519.public_key(secret)).decode("ascii")
    meta["signature"] = base64.b64encode(ed25519.sign(secret, SIGN_PREFIX + h.encode("ascii"))).decode("ascii")
    return source


# ---------------------------------------------------------------------------
# Resolution of anchor URIs and resource URLs (SPEC §5.4)
# ---------------------------------------------------------------------------

RULE_ORDER = ("p", "f", "t", "sl", "v", "ref", "s", "sh")


def _anchor_matches(rule: str, L: dict, a: dict | None, printed=None) -> bool:
    if not isinstance(a, dict):
        return False
    t = a.get("type")
    if rule == "p":
        return t == "page" and _is_int(a.get("physical")) and L["p"] <= a["physical"] <= L.get("pe", L["p"])
    if rule == "f":
        return (printed if printed is not None else a.get("printed")) == L["f"]
    if rule == "t":
        x = L["t"][0]
        return t == "time" and _is_num(a.get("t0")) and _is_num(a.get("t1")) and a["t0"] <= x < a["t1"]
    if rule == "sl":
        return t == "slide" and a.get("n") == L["sl"]
    if rule == "v":
        x = L["v"][0]
        lf = a.get("line_from")
        lt = a.get("line_to") if a.get("line_to") is not None else lf
        return t == "verse" and _is_int(lf) and lf <= x <= lt
    if rule == "ref":
        return t == "canonical" and a.get("scheme") == L["ref"]["scheme"] and a.get("ref") == L["ref"]["ref"]
    if rule == "s":
        path = a.get("path")
        if t not in ("section", "web") or not isinstance(path, list):
            return False
        if "para" in L:
            return path == L["s"] and a.get("paragraph") == L["para"]
        return path[: len(L["s"])] == L["s"]
    if rule == "sh":
        if t != "sheet" or a.get("sheet") != L["sh"]:
            return False
        if "rows" in L:
            x = L["rows"][0]
            return _is_int(a.get("row_from")) and _is_int(a.get("row_to")) and a["row_from"] <= x <= a["row_to"]
        return True
    return False


def locate(dump: dict, reference: str) -> dict:
    """SPEC §5.4 on a canonical dump."""
    empty = {"document": False, "units": [], "fragments": [], "char": None, "xywh": None}
    doc = dump["document"]
    if reference.startswith("spdf:"):
        parsed = parse_uri(reference)
        if parsed["docref"] not in ("sha256-" + doc["source_sha256"], doc["id"]):
            return empty
        L = parsed["locator"]
    else:
        _, hash_, frag = reference.partition("#")
        L = parse_uri("spdf:x#" + frag)["locator"] if hash_ and frag else {}
    out = {"document": True, "units": [], "fragments": [], "char": L.get("char"), "xywh": L.get("xywh")}
    rule = next((r for r in RULE_ORDER if r in L), None)
    if rule is None:
        return canon(out)
    units = [u["id"] for u in dump["units"] if _anchor_matches(rule, L, u["anchor"], u["printed"] if rule == "f" else None)]
    if rule == "t" and not units:
        timed = [u for u in dump["units"] if isinstance(u["anchor"], dict) and u["anchor"].get("type") == "time"]
        if timed and _is_num(timed[-1]["anchor"].get("t1")) and timed[-1]["anchor"]["t1"] == L["t"][0]:
            units = [timed[-1]["id"]]
    frags = [f for f in dump["fragments"] if _anchor_matches(rule, L, f["anchor"])]
    if not units and frags:
        order = {u["id"]: u["ord"] for u in dump["units"]}
        units = sorted({f["unit"] for f in frags}, key=lambda i: order.get(i, 0))
    if "char" in L:
        c, d = L["char"]
        def keep(f):
            ch = f["anchor"].get("chars") if isinstance(f["anchor"], dict) else None
            if f["unit"] not in units or not (isinstance(ch, list) and len(ch) == 2):
                return False
            a, b = ch
            return (a < d and c < b) if c < d else (a <= c < b)
        frags = [f for f in frags if keep(f)]
    out["units"] = units
    out["fragments"] = [f["id"] for f in frags]
    return canon(out)


# ---------------------------------------------------------------------------
# Exports (SPEC §19)
# ---------------------------------------------------------------------------


def _fold_ascii(s: str) -> str:
    return re.sub(r"[^A-Za-z]", "", unicodedata.normalize("NFKD", s)).lower()


def _first_year(item: dict):
    dp = (item.get("issued") or {}).get("date-parts") if isinstance(item.get("issued"), dict) else None
    if dp and dp[0]:
        return int(dp[0][0])
    return None


def base_key(item: dict) -> str:
    base = ""
    authors = item.get("author") or []
    if authors:
        a = authors[0]
        base = _fold_ascii(a.get("family") or a.get("literal") or a.get("given") or "")
    if not base:
        title = item.get("title-short") or item.get("title") or ""
        words = title.split()
        base = _fold_ascii(words[0]) if words else ""
    base = base or "anon"
    y = _first_year(item)
    return base + (str(y) if y is not None else "nd")


def _suffix(n: int) -> str:
    out = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(97 + r) + out
    return out


def export_keys(items: list[dict]) -> list[str]:
    bases = [base_key(i) for i in items]
    seen: dict[str, int] = {}
    out = []
    for b in bases:
        if bases.count(b) == 1:
            out.append(b)
        else:
            n = seen.get(b, 0)
            seen[b] = n + 1
            out.append(b + _suffix(n))
    return out


def csl_label_locator(anchor: dict | None, end: dict | None):
    if not isinstance(anchor, dict):
        return None
    t = anchor.get("type")
    def folio(a):
        p = a.get("printed")
        if p is None:
            return None
        return f"[{p}]" if a.get("source") == "inferred" else p
    if t == "page" or (t in ("section", "web") and anchor.get("printed") is not None):
        a = folio(anchor)
        if a is None:
            return None
        label = {"leaf": "folio", "column": "column"}.get(anchor.get("foliation", "page"), "page") if t == "page" else "page"
        if end and end.get("type") == t and end.get("printed") is not None and end.get("printed") != anchor.get("printed"):
            return label, f"{a}-{folio(end)}"
        return label, a
    if t in ("section", "web"):
        if anchor.get("paragraph") is not None:
            return "paragraph", str(anchor["paragraph"])
        if anchor.get("path"):
            return "section", anchor["path"][-1]
        return None
    if t == "time":
        s = _hms(anchor["t0"])
        if end and end.get("type") == "time":
            s += "-" + _hms(end["t1"])
        return "timestamp", s
    if t == "verse":
        a, b = anchor["line_from"], anchor.get("line_to")
        return "verse", str(a) if b is None or b == a else f"{a}-{b}"
    if t == "canonical":
        return "section", anchor["ref"]
    if t == "sheet":
        a, b = anchor["row_from"], anchor["row_to"]
        return "line", str(a) if a == b else f"{a}-{b}"
    return None


def export_csl(items: list[dict], anchor: dict | None = None, end: dict | None = None) -> list[dict]:
    out = []
    for item, key in zip(items, export_keys(items)):
        it = {k: v for k, v in item.items() if k != "spdf"}
        it["id"] = key
        out.append(it)
    if anchor is not None and len(out) == 1:
        ll = csl_label_locator(anchor, end)
        if ll:
            out[0]["label"], out[0]["locator"] = ll
    return canon(out)


BIBTEX_TYPES = {"book": "book", "article-journal": "article", "article-magazine": "article", "article-newspaper": "article",
                "chapter": "incollection", "paper-conference": "inproceedings", "thesis": "phdthesis", "report": "techreport"}
BIBTEX_SIMPLE = (("publisher", "publisher"), ("publisher-place", "address"), ("collection-title", "series"), ("volume", "volume"),
                 ("issue", "number"), ("page", "pages"), ("edition", "edition"), ("DOI", "doi"), ("ISBN", "isbn"), ("URL", "url"),
                 ("language", "language"), ("note", "note"))


def bib_escape(s: str) -> str:
    return "".join({"\\": "\\textbackslash{}", "{": "\\{", "}": "\\}"}.get(c, c) for c in s)


def bib_protect(s: str) -> str:
    return "".join("{" + bib_escape(tok) + "}" if any(unicodedata.category(c) == "Lu" for c in tok) else bib_escape(tok)
                   for tok in re.split(r"(\s+)", s))


def bib_names(people) -> str | None:
    out = []
    for p in people or []:
        if p.get("literal"):
            out.append("{" + bib_escape(p["literal"]) + "}")
            continue
        fam = p.get("family") or ""
        if fam and p.get("non-dropping-particle"):
            fam = p["non-dropping-particle"] + " " + fam
        given = p.get("given") or ""
        if fam and given:
            out.append(f"{bib_escape(fam)}, {bib_escape(given)}")
        elif fam or given:
            out.append("{" + bib_escape(fam or given) + "}")
    return " and ".join(out) or None


def export_bibtex(items: list[dict]) -> str:
    entries = []
    for item, key in zip(items, export_keys(items)):
        etype = BIBTEX_TYPES.get(item.get("type", ""), "misc")
        fields = []
        for src, dst in (("author", "author"), ("editor", "editor")):
            n = bib_names(item.get(src))
            if n:
                fields.append((dst, n))
        if item.get("title"):
            fields.append(("title", bib_protect(item["title"])))
        y = _first_year(item)
        if y is not None:
            fields.append(("year", str(y)))
        if item.get("container-title"):
            fields.append(("journal" if etype == "article" else "booktitle", bib_protect(item["container-title"])))
        for src, dst in BIBTEX_SIMPLE:
            v = item.get(src)
            if v not in (None, "", []):
                fields.append((dst, bib_escape(str(v))))
        body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields)
        entries.append(f"@{etype}{{{key},\n{body}\n}}\n")
    return "\n".join(entries)


def normalize_bibtex(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r\n", "\n").split("\n") if line.strip()]


def _pb_n(a: dict):
    p = a.get("printed")
    if p is None:
        return None
    return f"[{p}]" if a.get("source") == "inferred" else p


def export_structure(dump: dict, fmt: str) -> dict:
    pages = []
    for u in dump["units"]:
        a = u["anchor"]
        if not (isinstance(a, dict) and a.get("type") == "page"):
            continue
        if fmt == "alto":
            printed = a.get("printed") if a.get("printed") is not None and a.get("source") != "inferred" else None
            pages.append({"physical": a["physical"], "printed": printed})
        elif fmt == "tei":
            pages.append({"n": _pb_n(a)})
        elif fmt == "iiif":
            pages.append({"label": _pb_n(a)})
        else:
            raise SpdfError(f"unknown format {fmt}")
    return canon({"pages": pages})
