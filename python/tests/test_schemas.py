"""Outputs checked against the JSON Schemas of the specification (spec/json-schema)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import spdf
from spdf import sidecars

jsonschema = pytest.importorskip("jsonschema")

SCHEMAS = Path(__file__).resolve().parents[2] / "spec" / "json-schema"
pytestmark = pytest.mark.skipif(not SCHEMAS.is_dir(), reason="spec/json-schema not found")


def _registry() -> Any:
    from referencing import Registry, Resource

    resources = []
    for p in SCHEMAS.glob("*.schema.json"):
        doc = json.loads(p.read_text(encoding="utf-8"))
        resources.append((doc["$id"], Resource.from_contents(doc)))
    return Registry().with_resources(resources)


def _check(name: str, instance: Any) -> None:
    schema = json.loads((SCHEMAS / name).read_text(encoding="utf-8"))
    cls = jsonschema.validators.validator_for(schema)
    validator = cls(schema, registry=_registry())
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    assert not errors, "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:5])


def test_dumps_match_schema(quijote: Path, legacy41: Path) -> None:
    _check("dump.schema.json", spdf.dump(quijote))
    _check("dump.schema.json", spdf.dump(legacy41))


def test_validation_results_match_schema(quijote: Path, legacy41: Path, tmp_path: Path) -> None:
    bad = tmp_path / "bad.spdf"
    bad.write_text("x")
    for p in (quijote, legacy41, bad):
        _check("validation-result.schema.json", spdf.validate(p).to_dict())


def test_metadata_and_anchors_match_schema(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        _check("metadata.schema.json", f.document.metadata)
        for u in f.units():
            _check("anchor.schema.json", u.anchor.to_dict())


def test_sidecars_match_schema(quijote: Path) -> None:
    with spdf.open(quijote) as f:
        notes = [sidecars.annotation(f, fr, body="nota") for fr in f.fragments()]
    _check("annotation.schema.json", sidecars.annotation_collection(notes, "Notas"))
    _check("collection.schema.json", sidecars.library([quijote], "Fuentes"))
