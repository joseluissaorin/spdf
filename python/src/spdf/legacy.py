"""Mapping of legacy SPDF 4.0/4.1 values (Spanish identifiers) to the 5.0 view (contract §7).

These functions are pure: they take decoded JSON values from a 4.x file and
return the 5.0 equivalent. :func:`spdf.open` applies them transparently, so a
legacy file reads exactly like a 5.0 one.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .schema import LEGACY_KINDS, LEGACY_TARGETS

__all__ = [
    "default_type",
    "map_anchor",
    "map_kind",
    "map_meta_key",
    "map_metadata",
    "map_modalities",
    "map_target",
]

_ANCHOR_KEYS: dict[str, str] = {
    "tipo": "type",
    "fisica": "physical",
    "impresa": "printed",
    "romana": "roman",
    "origen": "source",
    "confianza": "confidence",
    "hablante": "speaker",
    "ruta": "path",
    "parrafo": "paragraph",
    "hoja": "sheet",
    "filaDesde": "row_from",
    "filaHasta": "row_to",
    "consultada": "accessed",
    "region": "region",
}

_ANCHOR_TYPES: dict[str, str] = {
    "pagina": "page",
    "tiempo": "time",
    "seccion": "section",
    "diapositiva": "slide",
    "hoja": "sheet",
    "web": "web",
    "imagen": "image",
}

_ANCHOR_SOURCES: dict[str, str] = {"leido": "read", "deducido": "inferred", "epub": "epub", "ninguno": "none"}


def map_kind(kind: str) -> str:
    """Map a legacy ``documentos.tipo`` to a 5.0 ``documents.kind``."""
    return LEGACY_KINDS.get(kind, kind)


def map_target(target: str) -> str:
    """Map a legacy ``vectores.objetivo`` to a 5.0 ``vectors.target``."""
    return LEGACY_TARGETS.get(target, target)


def map_anchor(anchor: Any) -> Any:
    """Map a legacy anchor object (``{"tipo":"pagina",…}``) to the 5.0 shape."""
    if not isinstance(anchor, Mapping):
        return anchor
    out: dict[str, Any] = {}
    for key, value in anchor.items():
        new_key = str(_ANCHOR_KEYS.get(key, key))
        if new_key == "type" and isinstance(value, str):
            value = _ANCHOR_TYPES.get(value, value)
        elif new_key == "source" and isinstance(value, str):
            value = _ANCHOR_SOURCES.get(value, value)
        out[new_key] = value
    return out


# --- Metadata (MetadatosDocumento -> CSL-JSON) -----------------------------

_SIMPLE_META: tuple[tuple[str, str], ...] = (
    ("editorial", "publisher"),
    ("lugar", "publisher-place"),
    ("coleccion", "collection-title"),
    ("volumen", "volume"),
    ("numero", "issue"),
    ("paginas", "page"),
    ("edicion", "edition"),
    ("doi", "DOI"),
    ("isbn", "ISBN"),
    ("url", "URL"),
    ("idioma", "language"),
    ("resumen", "abstract"),
)

# Field names used as provenance keys (legacy field -> CSL name; "spdf." prefixes dropped).
_FIELD_NAMES: dict[str, str] = {
    "titulo": "title",
    "subtitulo": "subtitle",
    "tituloOriginal": "original-title",
    "autores": "author",
    "editores": "editor",
    "traductores": "translator",
    "entrevistadores": "interviewer",
    "anio": "issued",
    "anioOriginal": "original-date",
    "editorial": "publisher",
    "lugar": "publisher-place",
    "revista": "container-title",
    "contenedor": "container-title",
    "coleccion": "collection-title",
    "volumen": "volume",
    "numero": "issue",
    "paginas": "page",
    "edicion": "edition",
    "doi": "DOI",
    "isbn": "ISBN",
    "url": "URL",
    "idioma": "language",
    "tipoCSL": "type",
    "resumen": "abstract",
    "idiomaOriginal": "original_language",
    "fecha": "issued",
    "sinFecha": "undated",
}

_PROVENANCE_SOURCES: dict[str, str] = {
    "lectura": "reading",
    "usuario": "user",
    "colofon": "colophon",
    "impresores": "printers",
}

_NAME_LISTS: tuple[tuple[str, str], ...] = (
    ("autores", "author"),
    ("editores", "editor"),
    ("traductores", "translator"),
    ("entrevistadores", "interviewer"),
)

_MODALITIES: dict[str, str] = {
    "texto": "text",
    "imagen": "image",
    "audio": "audio",
    "video": "video",
    "pdf": "pdf",
}

_META_KEYS: dict[str, str] = {"creado": "created", "generador": "generator"}

_DATE_RE = re.compile(r"^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?")


def map_meta_key(key: str) -> str:
    """Map a legacy ``spdf`` table key (``creado`` → ``created``…); others stay verbatim."""
    return _META_KEYS.get(key, key)


def map_modalities(value: Any) -> Any:
    """Map legacy modality names (``texto`` → ``text``, ``imagen`` → ``image``)."""
    if isinstance(value, list):
        return [_MODALITIES.get(x, x) if isinstance(x, str) else x for x in value]
    return value


def _date_parts(iso: str) -> list[int] | None:
    m = _DATE_RE.match(iso.strip())
    if not m:
        return None
    return [int(g) for g in m.groups() if g is not None]


def _has(m: Mapping[str, Any], key: str) -> bool:
    v = m.get(key)
    return v is not None and v != "" and v != []


def _names(people: Any, orcids: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(people, list):
        return out
    for p in people:
        if not isinstance(p, Mapping):
            continue
        n: dict[str, Any] = {}
        if p.get("apellidos"):
            n["family"] = p["apellidos"]
        if p.get("nombre"):
            n["given"] = p["nombre"]
        if n:
            out.append(n)
        if p.get("orcid"):
            key = str(p.get("apellidos") or "") + (", " + str(p["nombre"]) if p.get("nombre") else "")
            orcids[key] = p["orcid"]
    return out


def default_type(kind: str | None, meta: Mapping[str, Any]) -> str:
    """CSL type of a legacy record: ``tipoCSL``, else article-journal with a journal, else by kind."""
    if meta.get("tipoCSL"):
        return str(meta["tipoCSL"])
    if meta.get("revista"):
        return "article-journal"
    by_kind = {
        "audio": "speech",
        "video": "motion_picture",
        "web": "webpage",
        "presentacion": "speech",
        "slides": "speech",
        "hoja": "dataset",
        "sheet": "dataset",
        "imagen": "graphic",
        "image": "graphic",
        "fotos": "graphic",
        "photos": "graphic",
    }
    return by_kind.get(kind or "", "book")


def map_metadata(meta: Any, kind: str | None = None) -> dict[str, Any]:
    """Map a legacy ``MetadatosDocumento`` object to a CSL-JSON item plus the ``spdf`` extension.

    ``kind`` is the legacy ``documentos.tipo``; it decides the CSL ``type`` when the record
    has no ``tipoCSL`` and no journal. Empty or absent fields are omitted.
    """
    m: Mapping[str, Any] = meta if isinstance(meta, Mapping) else {}
    item: dict[str, Any] = {"type": default_type(kind, m)}
    ext: dict[str, Any] = {}
    title = m.get("titulo") or ""
    if _has(m, "subtitulo"):
        item["title"] = f"{title}: {m['subtitulo']}"
        item["title-short"] = title
        ext["subtitle"] = m["subtitulo"]
    else:
        item["title"] = title
    if _has(m, "tituloOriginal"):
        item["original-title"] = m["tituloOriginal"]
    orcids: dict[str, str] = {}
    for legacy_key, csl_key in _NAME_LISTS:
        names = _names(m.get(legacy_key), orcids)
        if names:
            item[csl_key] = names
    fecha = _date_parts(m["fecha"]) if _has(m, "fecha") and isinstance(m["fecha"], str) else None
    if fecha and (not _has(m, "anio") or fecha[0] == m["anio"]):
        item["issued"] = {"date-parts": [fecha]}
    elif _has(m, "anio"):
        item["issued"] = {"date-parts": [[m["anio"]]]}
    if _has(m, "anioOriginal"):
        item["original-date"] = {"date-parts": [[m["anioOriginal"]]]}
    for legacy_key, csl_key in _SIMPLE_META:
        if _has(m, legacy_key):
            item[csl_key] = m[legacy_key]
    if _has(m, "revista"):
        item["container-title"] = m["revista"]
    elif _has(m, "contenedor"):
        item["container-title"] = m["contenedor"]
    if _has(m, "idiomaOriginal"):
        ext["original_language"] = m["idiomaOriginal"]
    if _has(m, "sinFecha") and isinstance(m["sinFecha"], Mapping):
        sf = m["sinFecha"]
        undated: dict[str, Any] = {}
        if sf.get("desde") is not None:
            undated["from"] = sf["desde"]
        if sf.get("hasta") is not None:
            undated["to"] = sf["hasta"]
        if sf.get("fundamento"):
            undated["basis"] = sf["fundamento"]
        ext["undated"] = undated
    if _has(m, "procedencia") and isinstance(m["procedencia"], Mapping):
        prov: dict[str, Any] = {}
        for field_name, info in m["procedencia"].items():
            key = str(_FIELD_NAMES.get(field_name, field_name))
            if isinstance(info, Mapping):
                src = info.get("fuente")
                prov[key] = {
                    "source": _PROVENANCE_SOURCES.get(src, src) if isinstance(src, str) else src,
                    "confidence": info.get("confianza"),
                }
            else:
                prov[key] = info
        ext["provenance"] = prov
    if orcids:
        ext["orcid"] = orcids
    if ext:
        item["spdf"] = ext
    return item
