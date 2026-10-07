"""A small HTTP server for Valen-0.8B with the judge contract of spdf-infer / spdf-infer-web.

    python models/valen/server.py [--port 8765] [--host 127.0.0.1] [--device auto|cuda|mps|cpu]
                                  [--engine torch|onnx] [--variant int8|q4|fp32] [--token SECRET]

Endpoints (JSON in, JSON out):
  GET  /health
  POST /v1/systemone        {"state": str, "questions": {...}}        Valen's own request shape
  POST /judge/classify      {"instruction", "content", "labels": [{"name", "description"}]} -> {"probs": [[name, p], ...]}
  POST /judge/support       {"claim", "passage", "source"?: {"author","title","year"}} -> {"label", "probs", "supported"}
  POST /judge/relevance     {"query", "passage"} -> {"relevance": 0..1}

torch runs the original checkpoint (trust_remote_code at the pinned revision; CUDA or MPS
recommended); onnx runs the exported graphs (models/valen/export_onnx.py) on onnxruntime.
Listens on 127.0.0.1 unless told otherwise; with --token every request needs
`Authorization: Bearer <token>`.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CACHE = Path(os.environ.get("SPDF_MODELS_CACHE", Path.home() / ".cache" / "spdf-models"))

from eval_judges import RELATIONS, RELEVANCE, SUPPORT_Q  # noqa: E402


class Valen:
    def __init__(self, engine: str, device: str, variant: str, temperature: float = 1.0, support_temperature: float = 1.0):
        self.lock = threading.Lock()
        self.t_choice, self.t_noul = temperature, support_temperature
        if engine == "onnx":
            from valen_onnx import ValenOnnx

            self.m = ValenOnnx(variant)
            self.run = lambda req, t: self.m.predict(req, temperature=t)
            self.device = "onnxruntime-cpu"
        else:
            import torch
            from transformers import AutoModel

            if device == "auto":
                device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
            self.m = AutoModel.from_pretrained(str(CACHE / "Valen-Team" / "Valen-0.8B"), trust_remote_code=True, dtype="auto",
                                               attn_implementation="sdpa").to(device).eval()
            self.run = lambda req, t: self.m.predict(req, execution="shared_state", temperature=t)
            self.device = device

    def predict(self, req, t=1.0):
        with self.lock:
            return self.run(req, t)

    def classify(self, instruction, content, labels):
        crit = {l["name"]: (l.get("description") or l["name"]) for l in labels}
        a = self.predict({"state": content, "questions": {"q": {"type": "choice", "instructions": instruction, "criteria": crit}}},
                         self.t_choice)["answers"]["q"]
        return [[l["name"], a["probabilities"][l["name"]]] for l in labels]

    def support(self, claim, passage, source=None):
        s = source or {}
        src = ", ".join(str(x) for x in (s.get("author"), s.get("title"), s.get("year")) if x)
        state = (f"Source: {src}\n" if src else "") + f"Claim: {claim}\nPassage: {passage}"
        ans = self.predict({"state": state, "questions": {
            "support": {"type": "noul", "instructions": SUPPORT_Q},
            "relation": {"type": "choice", "instructions": "How does the passage relate to the claim?", "criteria": RELATIONS}}},
            self.t_choice)["answers"]
        import math

        y = min(max(ans["support"]["noul"], 1e-9), 1 - 1e-9)
        if self.t_noul != 1.0:  # temperature on log-probabilities
            a, b = math.log(y) / self.t_noul, math.log(1 - y) / self.t_noul
            y = 1 / (1 + math.exp(b - a))
        probs = [[k, ans["relation"]["probabilities"][k]] for k in RELATIONS]
        return {"label": max(probs, key=lambda x: x[1])[0], "probs": probs, "supported": y}

    def relevance(self, query, passage):
        a = self.predict({"state": f"Query: {query}\nPassage: {passage}", "questions": {
            "relevance": {"type": "score", "instructions": "How well does the passage answer the search query?", "criteria": RELEVANCE}}},
            self.t_choice)["answers"]["relevance"]
        return {"relevance": a["score"] / 3.0}


def make_handler(v: Valen, token: str | None):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def _send(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _auth(self):
            if not token:
                return True
            got = self.headers.get("Authorization", "")
            return hmac.compare_digest(got, f"Bearer {token}")

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"status": "ok", "model": "Valen-0.8B", "device": v.device})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if not self._auth():
                return self._send(401, {"error": "unauthorized"})
            try:
                n = int(self.headers.get("Content-Length", 0))
                if n > 4 << 20:
                    return self._send(413, {"error": "request too large"})
                body = json.loads(self.rfile.read(n) or b"{}")
                if self.path == "/v1/systemone":
                    out = v.predict({"state": body["state"], "questions": body["questions"]})
                elif self.path == "/judge/classify":
                    out = {"probs": v.classify(body["instruction"], body["content"], body["labels"])}
                elif self.path == "/judge/support":
                    out = v.support(body["claim"], body["passage"], body.get("source"))
                elif self.path == "/judge/relevance":
                    out = v.relevance(body["query"], body["passage"])
                else:
                    return self._send(404, {"error": "not found"})
                self._send(200, out)
            except (KeyError, ValueError, TypeError) as exc:
                self._send(400, {"error": f"bad request: {exc}"})
            except Exception as exc:  # noqa: BLE001
                self._send(500, {"error": str(exc)})

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--engine", default="torch", choices=["torch", "onnx"])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--variant", default="int8")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--support-temperature", type=float, default=1.0)
    ap.add_argument("--token", default=os.environ.get("VALEN_SERVER_TOKEN"))
    a = ap.parse_args()
    if a.host not in ("127.0.0.1", "localhost", "::1") and not a.token:
        sys.exit("refusing to listen on a non-local address without --token")
    v = Valen(a.engine, a.device, a.variant, a.temperature, a.support_temperature)
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(v, a.token))
    print(f"Valen-0.8B ({a.engine}, {v.device}) on http://{a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
