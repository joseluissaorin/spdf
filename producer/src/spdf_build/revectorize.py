"""Re-vectorize an existing SPDF in another space, without reading the document again.

The fragments (text + context line), the unit images and the figure crops are
already in the file; only the vectors of the new space are computed and added
(several spaces live side by side). If the space already exists, its vectors
are replaced. Works on SPDF 5.0 files.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Optional

from .engines.base import space_row
from .minispdf import encode_vector
from .pipeline import now


def revectorize(path: str, embedder, out: Optional[str] = None, dtype: str = "f32", images: bool = True, log=lambda m: None) -> dict:
    src = Path(path)
    dst = Path(out) if out else src
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copyfile(src, tmp)
    t0 = time.time()
    db = sqlite3.connect(tmp)
    try:
        ver = db.execute("PRAGMA user_version").fetchone()[0]
        if not 500 <= ver < 600:
            raise SystemExit(f"{path}: not a SPDF 5.0 file (user_version {ver}); convert legacy files first")
        doc, meta_json = db.execute("SELECT id, metadata FROM documents").fetchone()
        title = json.loads(meta_json).get("title")
        frags = db.execute("SELECT id, text, context FROM fragments ORDER BY n").fetchall()
        texts = [(f"{c}\n\n{t}" if c else t) for _, t, c in frags]
        V = embedder.embed_documents(texts, title=title)
        row = space_row(embedder, dtype, now())
        sid = row["id"]
        db.execute("DELETE FROM vectors WHERE space = ?", (sid,))
        db.execute("DELETE FROM spaces WHERE id = ?", (sid,))
        cols = list(row)
        db.execute(f"INSERT INTO spaces ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                   [json.dumps(row[c]) if c in ("modalities", "task_prefixes") and row[c] is not None else row[c] for c in cols])
        n = 0
        for (fid, _, _), v in zip(frags, V):
            db.execute("INSERT INTO vectors (target, id, space, document, data) VALUES ('fragment', ?, ?, ?, ?)",
                       (fid, sid, doc, encode_vector(v, dtype)))
            n += 1
        nu = nf = 0
        if images and "image" in embedder.modalities:
            blobs = dict(db.execute("SELECT 'blob:' || key, data FROM blobs").fetchall())
            # units that had an image vector in some space, or every unit with an image if none had
            had = {r[0] for r in db.execute("SELECT DISTINCT id FROM vectors WHERE target = 'unit'")}
            units = [(uid, img) for uid, img in db.execute("SELECT id, image FROM units WHERE image IS NOT NULL ORDER BY ord")
                     if img in blobs and (not had or uid in had)]
            if units:
                for (uid, img), v in zip(units, embedder.embed_images([blobs[i] for _, i in units])):
                    db.execute("INSERT INTO vectors (target, id, space, document, data) VALUES ('unit', ?, ?, ?, ?)",
                               (uid, sid, doc, encode_vector(v, dtype)))
                    nu += 1
            figs = [(fid, img) for fid, img in db.execute("SELECT id, image FROM figures ORDER BY id") if img in blobs]
            if figs:
                for (fid, img), v in zip(figs, embedder.embed_images([blobs[i] for _, i in figs])):
                    db.execute("INSERT INTO vectors (target, id, space, document, data) VALUES ('figure', ?, ?, ?, ?)",
                               (fid, sid, doc, encode_vector(v, dtype)))
                    nf += 1
        prof = db.execute("SELECT value FROM spdf_meta WHERE key = 'profile'").fetchone()
        parts = (prof[0].split() if prof else ["core"])
        if "semantic" not in parts:
            parts.append("semantic")
            order = ["core", "semantic", "media", "full"]
            parts.sort(key=lambda p: order.index(p) if p in order else 9)
            db.execute("INSERT OR REPLACE INTO spdf_meta (key, value) VALUES ('profile', ?)", (" ".join(parts),))
        # an existing content hash no longer matches: drop it (and any signature over it)
        dropped = [k for (k,) in db.execute("SELECT key FROM spdf_meta WHERE key IN ('content_sha256','signature','signer')")]
        db.execute("DELETE FROM spdf_meta WHERE key IN ('content_sha256','signature','signer')")
        ms = int((time.time() - t0) * 1000)
        db.execute("INSERT INTO provenance (document, stage, provider, model, detail, ms, at) VALUES (?, 'vectors', ?, ?, ?, ?, ?)",
                   (doc, embedder.provider, embedder.model, json.dumps({"space": sid, "fragments": n, "units": nu, "figures": nf,
                                                                       "revectorized": True, "integrity_dropped": dropped}), ms, now()))
        db.commit()
        db.execute("VACUUM")
    finally:
        db.close()
    tmp.replace(dst)
    log(f"{dst}: space {sid}, {n} fragments, {nu} units, {nf} figures in {ms} ms")
    return {"path": str(dst), "space": sid, "fragments": n, "units": nu, "figures": nf, "ms": ms}
