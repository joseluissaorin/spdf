"""Shared fixtures: small SPDF 5.0 and legacy 4.x files built from public-domain text.

Text: Miguel de Cervantes, «Don Quijote», part I, chapter 1 (1605), Project Gutenberg #2000.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import spdf

TEXTS = [
    "Primera parte del ingenioso hidalgo don Quijote de la Mancha",
    "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía "
    "un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.",
    "Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, "
    "lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.",
]

SOURCE = b"%PDF-1.4 fake original for tests"
SOURCE_SHA = hashlib.sha256(SOURCE).hexdigest()

METADATA = {
    "type": "book",
    "title": "El ingenioso hidalgo don Quijote de la Mancha",
    "title-short": "Don Quijote",
    "author": [{"family": "Cervantes Saavedra", "given": "Miguel de"}],
    "issued": {"date-parts": [[1605]]},
    "publisher": "Juan de la Cuesta",
    "publisher-place": "Madrid",
    "language": "es",
}

# A 1x1 PNG.
PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def page(i: int, printed: str | None, **extra: Any) -> dict[str, Any]:
    return {"type": "page", "physical": i, "printed": printed, "roman": False, "source": "read", "confidence": 1, **extra}


def build_quijote(
    path: Path, *, sign_key: bytes | None = None, vectors: bool = True, hash_content: bool = True, **writer_kw: Any
) -> Path:
    with spdf.Writer(path, overwrite=True, **writer_kw) as w:
        w.add_document(
            {
                "id": "quijote",
                "kind": "pdf",
                "metadata": METADATA,
                "source_sha256": SOURCE_SHA,
                "source_ref": "blob:original.pdf",
                "mime": "application/pdf",
                "bytes": len(SOURCE),
                "created": "2026-10-07T00:00:00Z",
                "updated": "2026-10-07T00:00:00Z",
                "rights": {"license": "CC0-1.0", "access": "open", "holder": None, "note": None},
            }
        )
        w.set_meta(created="2026-10-07T00:00:00Z", generator="tests/1.0")
        w.add_blob("original.pdf", "application/pdf", SOURCE)
        w.add_blob("pages/0001.png", "image/png", PNG_1x1)
        for i, t in enumerate(TEXTS, start=1):
            printed = None if i == 1 else str(i + 21)
            w.add_unit(
                {
                    "id": f"u{i}",
                    "ord": i,
                    "anchor": page(i, printed),
                    "text": t,
                    "reader": "pdf-text-layer",
                    "image": "blob:pages/0001.png" if i == 1 else None,
                    "notes": ["Nota de prueba."] if i == 3 else None,
                }
            )
            w.add_fragment(
                {
                    "id": f"f{i}",
                    "unit": f"u{i}",
                    "ord": i,
                    "text": t,
                    "context": "Primera parte, capítulo primero.",
                    "section": ["Capítulo primero"],
                    "anchor": page(i, printed, chars=[0, len(t)]),
                }
            )
        w.add_section({"id": "s1", "level": 1, "title": "Capítulo primero", "unit_from": "u1", "unit_to": "u3"})
        w.add_figure(
            {
                "id": "g1",
                "unit": "u1",
                "image": "blob:pages/0001.png",
                "caption": "Portada",
                "description": "Portada de la primera edición.",
                "anchor": {"type": "image", "region": {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.25}},
            }
        )
        if vectors:
            w.add_space({"id": "test@4", "provider": "test", "model": "test", "dims": 4, "created": "2026-10-07"})
            w.add_space(
                {"id": "test@4:i8", "provider": "test", "model": "test", "dims": 4, "dtype": "i8", "created": "2026-10-07"}
            )
            w.add_space(
                {"id": "test@4:f16", "provider": "test", "model": "test", "dims": 4, "dtype": "f16", "created": "2026-10-07"}
            )
            for i in range(1, 4):
                v = [1.0 if j == i - 1 else 0.0 for j in range(4)]
                for sp in ("test@4", "test@4:i8", "test@4:f16"):
                    w.add_vector("fragment", f"f{i}", sp, data=v)
        w.add_provenance({"stage": "read", "provider": "test", "model": "none", "detail": {"pages": 3}, "ms": 5, "at": "2026-10-07T00:00:00Z"})
        if sign_key is not None or not hash_content:
            w.finalize(sign_key=sign_key, content_hash=hash_content)
    return path


LEGACY_DDL = """
CREATE TABLE spdf (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE documentos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, metadatos TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', huella TEXT NOT NULL, original TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, unidades INTEGER NOT NULL DEFAULT 0, duracion REAL, creado TEXT NOT NULL,
  actualizado TEXT NOT NULL, bibliotecas TEXT NOT NULL DEFAULT '[]', titulo TEXT, autores TEXT, anio INTEGER,
  idioma TEXT);
CREATE TABLE unidades (id TEXT PRIMARY KEY, documento TEXT NOT NULL, orden INTEGER NOT NULL, ancla TEXT NOT NULL,
  texto TEXT NOT NULL DEFAULT '', notas TEXT, cabecera TEXT, pie TEXT, imagen TEXT, miniatura TEXT,
  lector TEXT NOT NULL, confianza REAL NOT NULL DEFAULT 1, impresa TEXT, t0 REAL, t1 REAL{palabras});
CREATE TABLE secciones (id TEXT PRIMARY KEY, documento TEXT NOT NULL, padre TEXT, nivel INTEGER NOT NULL,
  titulo TEXT NOT NULL, unidad_desde TEXT NOT NULL, unidad_hasta TEXT, resumen TEXT);
CREATE TABLE fragmentos (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, documento TEXT NOT NULL,
  unidad TEXT NOT NULL, orden INTEGER NOT NULL, texto TEXT NOT NULL, contexto TEXT NOT NULL DEFAULT '',
  seccion TEXT, ancla TEXT NOT NULL, ancla_fin TEXT{texto_busqueda});
CREATE VIRTUAL TABLE fragmentos_fts USING fts5(texto, contexto, seccion{fts_extra},
  content='fragmentos', content_rowid='n', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER fragmentos_ai AFTER INSERT ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion{fts_extra}) VALUES (new.n, new.texto, new.contexto,
  new.seccion{fts_new});
END;
CREATE TRIGGER fragmentos_ad AFTER DELETE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion{fts_extra}) VALUES ('delete', old.n,
  old.texto, old.contexto, old.seccion{fts_old});
END;
CREATE TRIGGER fragmentos_au AFTER UPDATE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion{fts_extra}) VALUES ('delete', old.n,
  old.texto, old.contexto, old.seccion{fts_old});
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion{fts_extra}) VALUES (new.n, new.texto, new.contexto,
  new.seccion{fts_new});
END;
CREATE TABLE figuras (id TEXT PRIMARY KEY, documento TEXT NOT NULL, unidad TEXT NOT NULL, imagen TEXT NOT NULL,
  pie TEXT, descripcion TEXT, ancla TEXT NOT NULL);
CREATE TABLE espacios (id TEXT PRIMARY KEY, proveedor TEXT NOT NULL, modelo TEXT NOT NULL, version TEXT,
  dims INTEGER NOT NULL, normalizado INTEGER NOT NULL DEFAULT 1, modalidades TEXT NOT NULL, creado TEXT);
CREATE TABLE vectores (objetivo TEXT NOT NULL, id TEXT NOT NULL, espacio TEXT NOT NULL, documento TEXT NOT NULL,
  valores BLOB NOT NULL, PRIMARY KEY (objetivo, id, espacio));
CREATE TABLE blobs (clave TEXT PRIMARY KEY, mime TEXT NOT NULL, datos BLOB NOT NULL);
CREATE TABLE procedencia (documento TEXT NOT NULL, fase TEXT NOT NULL, proveedor TEXT, detalle TEXT, ms INTEGER,
  cuando TEXT NOT NULL);
"""


def legacy_page(i: int, printed: str | None) -> dict[str, Any]:
    return {"tipo": "pagina", "fisica": i, "impresa": printed, "romana": False, "origen": "leido", "confianza": 1}


LEGACY_META = {
    "titulo": "El ingenioso hidalgo don Quijote de la Mancha",
    "subtitulo": "Primera parte",
    "autores": [{"nombre": "Miguel de", "apellidos": "Cervantes Saavedra", "orcid": "0000-0000-0000-0000"}],
    "anio": 1605,
    "editorial": "Juan de la Cuesta",
    "lugar": "Madrid",
    "idioma": "es",
    "sinFecha": {"desde": 1604, "hasta": 1605, "fundamento": "prueba"},
    "procedencia": {"titulo": {"fuente": "colofon", "confianza": 0.98}},
}


def build_legacy(path: Path, *, version: str = "4.1", gzipped: bool = True) -> Path:
    """A legacy 4.x file like those exported by Scholaris (0-based order, gzip, FTS triggers)."""
    v41 = version == "4.1"
    ddl = LEGACY_DDL.format(
        palabras=", palabras TEXT" if v41 else "",
        texto_busqueda=", texto_busqueda TEXT" if v41 else "",
        fts_extra=", texto_busqueda" if v41 else "",
        fts_new=", new.texto_busqueda" if v41 else "",
        fts_old=", old.texto_busqueda" if v41 else "",
    )
    raw = path.with_suffix(".sqlite")
    if raw.exists():
        raw.unlink()
    c = sqlite3.connect(raw)
    c.executescript(ddl)
    c.execute(f"PRAGMA user_version = {410 if v41 else 400}")
    c.executemany(
        "INSERT INTO spdf VALUES (?, ?)",
        [("spdf_version", version), ("creado", "2026-10-06T20:00:00.000Z"), ("generador", "scholaris-nube/test")],
    )
    c.execute(
        "INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, creado, "
        "actualizado, bibliotecas, titulo, autores, anio, idioma) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "doc_mini", "pdf_escaneado", json.dumps(LEGACY_META, ensure_ascii=False), "listo", SOURCE_SHA,
            "original.pdf", "application/pdf", len(SOURCE), 3, "2026-10-06T20:00:00Z", "2026-10-06T20:00:00Z", "[]",
            LEGACY_META["titulo"], "Cervantes Saavedra", 1605, "es",
        ),
    )
    for i, t in enumerate(TEXTS):
        printed = None if i == 0 else str(i + 22)
        cols = "id, documento, orden, ancla, texto, lector, confianza, impresa, imagen"
        vals: list[Any] = [f"u{i}", "doc_mini", i, json.dumps(legacy_page(i + 1, printed)), t, "prueba", 1, printed,
                           "paginas/0001.png" if i == 0 else ""]
        c.execute(f"INSERT INTO unidades ({cols}) VALUES ({','.join('?' * len(vals))})", vals)
        fcols = "id, documento, unidad, orden, texto, contexto, seccion, ancla"
        fvals: list[Any] = [f"f{i}", "doc_mini", f"u{i}", i, t, "Primera parte, capítulo primero.",
                            json.dumps(["Capítulo primero"]), json.dumps(legacy_page(i + 1, printed))]
        if v41:
            fcols += ", texto_busqueda"
            fvals.append("")
        c.execute(f"INSERT INTO fragmentos ({fcols}) VALUES ({','.join('?' * len(fvals))})", fvals)
    c.execute(
        "INSERT INTO espacios VALUES (?,?,?,?,?,?,?,?)",
        ("prueba@4", "pruebas", "prueba", None, 4, 1, json.dumps(["texto"]), "2026-10-06T20:00:00Z"),
    )
    import struct

    for i in range(3):
        vec = [1.0 if j == (i + 1) % 3 else 0.0 for j in range(4)]
        c.execute(
            "INSERT INTO vectores VALUES (?,?,?,?,?)",
            ("fragmento", f"f{i}", "prueba@4", "doc_mini", struct.pack("<4f", *vec)),
        )
    c.execute("INSERT INTO blobs VALUES (?,?,?)", ("original.pdf", "application/pdf", SOURCE))
    c.execute("INSERT INTO blobs VALUES (?,?,?)", ("paginas/0001.png", "image/png", PNG_1x1))
    c.execute(
        "INSERT INTO figuras VALUES (?,?,?,?,?,?,?)",
        ("g1", "doc_mini", "u0", "", "Portada", None, json.dumps({"tipo": "imagen", "region": {"x": 0, "y": 0, "w": 1, "h": 0.5}})),
    )
    c.execute(
        "INSERT INTO procedencia VALUES (?,?,?,?,?,?)",
        ("doc_mini", "lectura", "gemini", json.dumps({"tramo": 1}), 10, "2026-10-06T20:00:01Z"),
    )
    c.commit()
    c.close()
    data = raw.read_bytes()
    raw.unlink()
    path.write_bytes(gzip.compress(data) if gzipped else data)
    return path


@pytest.fixture
def quijote(tmp_path: Path) -> Path:
    return build_quijote(tmp_path / "quijote.spdf")


@pytest.fixture
def legacy41(tmp_path: Path) -> Path:
    return build_legacy(tmp_path / "legacy41.spdf", version="4.1")


@pytest.fixture
def legacy40(tmp_path: Path) -> Path:
    return build_legacy(tmp_path / "legacy40.spdf", version="4.0", gzipped=False)


@pytest.fixture
def mutate(tmp_path: Path) -> Callable[..., Path]:
    """Copy the Quijote file and run SQL on the copy (to build invalid files)."""

    counter = {"n": 0}

    def _mutate(*statements: str, base: Path | None = None) -> Path:
        counter["n"] += 1
        src = base or build_quijote(tmp_path / f"base{counter['n']}.spdf", hash_content=False)
        dst = tmp_path / f"mutated{counter['n']}.spdf"
        dst.write_bytes(src.read_bytes())
        c = sqlite3.connect(dst)
        for s in statements:
            c.execute(s)
        c.commit()
        c.close()
        return dst

    return _mutate
