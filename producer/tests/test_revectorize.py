import sqlite3

import spdf

from spdf_build.cli import main


def test_revectorize_adds_a_space_without_reading(inputs, tmp_path):
    out = tmp_path / "r.spdf"
    assert main(["build", str(inputs["pdf"]), "-o", str(out), "--engine", "fake", "--offline", "-q"]) == 0
    assert main(["revectorize", str(out), "--model", "fake@16:i8", "--offline", "-q"]) == 0
    db = sqlite3.connect(out)
    spaces = dict(db.execute("SELECT id, dtype FROM spaces").fetchall())
    assert spaces == {"fake-trigram@64": "f32", "fake-trigram@16:i8": "i8"}
    n = db.execute("SELECT count(*) FROM fragments").fetchone()[0]
    assert db.execute("SELECT count(*) FROM vectors WHERE space='fake-trigram@16:i8'").fetchone()[0] == n
    assert spdf.validate(str(out)).valid
    # running it again replaces, does not duplicate
    assert main(["revectorize", str(out), "--model", "fake@16:i8", "--offline", "-q"]) == 0
    assert sqlite3.connect(out).execute("SELECT count(*) FROM vectors WHERE space='fake-trigram@16:i8'").fetchone()[0] == n
