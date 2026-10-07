"""The whole conformance suite (conformance/cases), as one pytest case per suite case."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from spdf.conformance import HANDLERS, find_conformance_dir

ROOT = find_conformance_dir(Path(__file__).resolve().parent)
CASES = sorted((ROOT / "cases").glob("*.json")) if ROOT else []


@pytest.mark.skipif(ROOT is None, reason="conformance/ directory not found")
@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_case(path: Path) -> None:
    assert ROOT is not None
    case = json.loads(path.read_text(encoding="utf-8"))
    HANDLERS[case["kind"]](case, ROOT)


def test_suite_present_in_repo() -> None:
    # In the monorepo the suite must be found; outside it (sdist installs) it is optional.
    if (Path(__file__).resolve().parents[2] / "conformance" / "cases").is_dir():
        assert ROOT is not None and len(CASES) > 0
