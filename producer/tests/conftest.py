import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from fixtures import all_inputs  # noqa: E402


@pytest.fixture(scope="session")
def inputs(tmp_path_factory):
    return all_inputs(tmp_path_factory.mktemp("inputs"))


@pytest.fixture(scope="session")
def scanned_truth(inputs):
    return {int(k): v for k, v in json.loads(inputs["scanned_pdf"].with_suffix(".truth.json").read_text("utf-8")).items()}
