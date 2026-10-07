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

__all__ = ["map_anchor", "map_kind", "map_meta_key", "map_metadata", "map_target"]

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
        new_key = _ANCHOR_KEYS.get(key, key)
        if new_key == "type" and isinstance(value, str):
            value = _ANCHOR_TYPES.get(value, value)
        elif new_key == "source" and isinstance(value, str):
            value = _ANCHOR_SOURCES.get(value, value)
        out[new_key] = value
    return out


# --- Metadata (MetadatosDocumento -> CSL-JSON) -----------------------------

_SIMPLE_META: dict[str, str] = {
    "tituloOriginal": "original-title",
    "editorial": "publisher",
    "lugar": "publisher-place",
    "revista": "container-title",
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
}

_NAME_LISTS: dict[str, str] = {
    "autores": "author",
    "editores": "editor",
    "traductores": "translator",
    "entrevistadores": "interviewer",
}

_DATE_RE = re.compile(r"^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?")


def _date_parts(value: Any) -> dict[str, Any] | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return {"date-parts": [[value]]}
    if isinstance(value, float) and value.is_integer():
        return {"date-parts": [[int(value)]]}
    if isinstance(value, str):
        m = _DATE_RE.match(value.strip())
        if m:
            return {"date-parts": [[int(g) for g in m.groups() if g is not None]]}
        if value.strip():
            return {"literal": value.strip()}
    return None


def _person(p: Any, orcids: dict[str, str]) -> dict[str, str] | None:
    if isinstance(p, str):
        return {"literal": p} if p.strip() else None
    if not isinstance(p, Mapping):
        return None
    family = str(p.get("apellidos") or "").strip()
    given = str(p.get("nombre") or "").strip()
    name: dict[str, str] = {}
    if family:
        name["family"] = family
    if given:
        name["given"] = given
    if not name:
        return None
    orcid = p.get("orcid")
    if isinstance(orcid, str) and orcid.strip():
        key = f"{family}, {given}" if family and given else (family or given)
        orcids[key] = orcid.strip()
    return name


def _default_type(kind: str | None, meta: Mapping[str, Any]) -> str:
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
    if kind and kind in by_kind:
        return by_kind[kind]
    if meta.get("revista"):
        return "article-journal"
    return "book"


def map_meta_key(key: str) -> str:
    """Map a legacy ``spdf`` table key (``creado`` → ``created``…); others stay verbatim."""
    return _META_KEYS.get(key, key)


_META_KEYS: dict[str, str] = {"creado": "created", "generador": "generator"}


def map_metadata(meta: Any, kind: str | None = None) -> dict[str, Any]:
    """Map a legacy ``MetadatosDocumento`` object to a CSL-JSON item plus the ``spdf`` extension.

    ``kind`` is the legacy ``documentos.tipo`` (or the mapped 5.0 kind); it decides the
    CSL ``type`` when the record has no ``tipoCSL``.
    """
    if not isinstance(meta, Mapping):
        return {"type": _default_type(kind, {})}
    csl: dict[str, Any] = {}
    ext: dict[str, Any] = {}
    orcids: dict[str, str] = {}

    title = _text(meta.get("titulo"))
    subtitle = _text(meta.get("subtitulo"))
    if title and subtitle:
        csl["title"] = f"{title}: {subtitle}"
        csl["title-short"] = title
    elif title or subtitle:
        csl["title"] = title or subtitle
    if subtitle:
        ext["subtitle"] = subtitle

    for legacy_key, csl_key in _NAME_LISTS.items():
        people = meta.get(legacy_key)
        if isinstance(people, list):
            names = [n for n in (_person(p, orcids) for p in people) if n]
            if names:
                csl[csl_key] = names

    year = meta.get("anio")
    issued = None
    fecha = meta.get("fecha")
    if isinstance(fecha, str) and fecha.strip():
        full = _date_parts(fecha)
        parts = full.get("date-parts") if full else None
        if parts and (year is None or parts[0][0] == year):
            issued = full
    if issued is None and year is not None and year != "":
        issued = _date_parts(year)
    if issued:
        csl["issued"] = issued
    if meta.get("anioOriginal") not in (None, ""):
        original = _date_parts(meta.get("anioOriginal"))
        if original:
            csl["original-date"] = original

    for legacy_key, csl_key in _SIMPLE_META.items():
        value = meta.get(legacy_key)
        if value is None or value == "":
            continue
        if csl_key == "container-title" and "container-title" in csl:
            continue
        csl[csl_key] = value if isinstance(value, str) else str(value)
    contenedor = _text(meta.get("contenedor"))
    if contenedor and "container-title" not in csl:
        csl["container-title"] = contenedor
    if "type" not in csl:
        csl["type"] = _default_type(kind, meta)

    if meta.get("idiomaOriginal"):
        ext["original_language"] = meta["idiomaOriginal"]
    undated = meta.get("sinFecha")
    if isinstance(undated, Mapping):
        mapped: dict[str, Any] = {}
        for old, new in (("desde", "from"), ("hasta", "to"), ("fundamento", "basis")):
            if undated.get(old) not in (None, ""):
                mapped[new] = undated[old]
        if mapped:
            ext["undated"] = mapped
    provenance = meta.get("procedencia")
    if isinstance(provenance, Mapping) and provenance:
        mapped_prov: dict[str, Any] = {}
        for field_name, info in provenance.items():
            if isinstance(info, Mapping):
                entry: dict[str, Any] = {}
                for k, v in info.items():
                    entry[_PROVENANCE_KEYS.get(k, k)] = v
                mapped_prov[field_name] = entry
            else:
                mapped_prov[field_name] = info
        ext["provenance"] = mapped_prov
    if orcids:
        ext["orcid"] = orcids
    if ext:
        csl["spdf"] = ext
    return csl


_PROVENANCE_KEYS: dict[str, str] = {"fuente": "source", "confianza": "confidence"}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value).strip())
