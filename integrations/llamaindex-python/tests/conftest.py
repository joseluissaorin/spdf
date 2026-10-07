from __future__ import annotations

import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
EN = FIXTURES / "spdf-in-five-pages.spdf"
ES = FIXTURES / "spdf-en-cinco-paginas.spdf"
BROKEN = FIXTURES / "roto.spdf"
SPACE = "all-MiniLM-L6-v2@384"


@pytest.fixture
def library(tmp_path: Path) -> Path:
    """A folder with both valid booklets (one nested) and a hidden copy that must be skipped."""
    root = tmp_path / "library"
    (root / "es").mkdir(parents=True)
    (root / ".trash").mkdir()
    shutil.copy(EN, root / EN.name)
    shutil.copy(ES, root / "es" / ES.name)
    shutil.copy(EN, root / ".trash" / EN.name)
    (root / "notes.txt").write_text("not a SPDF file", encoding="utf-8")
    return root
