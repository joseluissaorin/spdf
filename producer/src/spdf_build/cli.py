"""Command line: `spdf-build build|revectorize|engines|validate`, and `spdf build` when spdf-format is installed."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from . import __version__


def _add_build_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("inputs", nargs="+", help="file(s), a folder of page photos, or an http(s) URL")
    p.add_argument("-o", "--output", help="output .spdf (default: next to the input, or ./<title>.spdf for a URL)")
    p.add_argument("--engine", choices=["local", "gemini", "openai", "fake", "none"], default=None,
                   help="engine preset for the four roles (default: local, or none with --offline and no local models)")
    p.add_argument("--embed", help="embedder: embeddinggemma-2@768|512|256|128, gemini-embedding-2@768, openai:<model>[@dims], fake, none")
    p.add_argument("--vision", help="page reader: gemma-4-e4b, gemma-4-e2b, gemini[:model], openai:<model>, tesseract, fake, none")
    p.add_argument("--llm", help="record, context and descriptions: gemma-4-e4b, gemini[:model], openai:<model>, fake, none")
    p.add_argument("--asr", help="transcriber: whisper-large-v3-turbo[:mlx|cpp], gemini[:model], openai:<model>, fake, none")
    p.add_argument("--base-url", help="base URL for openai: engines (or OPENAI_BASE_URL)")
    p.add_argument("--offline", action="store_true", help="guarantee zero requests to the internet (refuses remote engines, skips catalogues)")
    p.add_argument("--language", help="BCP-47 language of the document (default: detected)")
    p.add_argument("--title")
    p.add_argument("--author", action="append", help="author (repeatable), «Family, Given» or «Given Family»")
    p.add_argument("--year", type=int)
    p.add_argument("--type", dest="csl_type", help="CSL type (book, chapter, article-journal, speech…)")
    p.add_argument("--publisher")
    p.add_argument("--license", help="SPDX id or URL of the licence of the source (goes into documents.rights)")
    p.add_argument("--rights-note")
    p.add_argument("--no-labels", action="store_true", help="ignore PDF page labels (deduce folios only from what is seen)")
    p.add_argument("--force-vision", action="store_true", help="read every PDF page with the vision engine")
    p.add_argument("--trust-ocr", action="store_true", help="economical: keep a scan's OCR layer where it passes the quality bar")
    p.add_argument("--no-context", action="store_true", help="extractive context lines only (no LLM)")
    p.add_argument("--no-figures", action="store_true")
    p.add_argument("--page-images", choices=["none", "scans", "all"], default="scans")
    p.add_argument("--image-vectors", choices=["useful", "all", "none"], default="useful")
    p.add_argument("--dtype", choices=["f32", "f16", "i8"], default="f32")
    p.add_argument("--embed-source", action="store_true", help="ship the original bytes inside the file (blob:source)")
    p.add_argument("--max-units", type=int, help="only the first N units (tests, previews)")
    p.add_argument("--save-reading", help="write what the page readers saw to this JSON (to replay later steps)")
    p.add_argument("--reuse-reading", help="take the pages from such a JSON instead of calling the vision engine")
    p.add_argument("--concurrency", type=int, default=6)
    p.add_argument("--json", action="store_true", help="print the build report as JSON")
    p.add_argument("-q", "--quiet", action="store_true")


def _engines(args):
    from .engines import factory
    from .pipeline import Engines

    preset = args.engine
    if preset is None:
        preset = "local"
    roles = dict(factory.PRESETS[preset])
    for r in ("embed", "vision", "llm", "asr"):
        v = getattr(args, r, None)
        if v:
            roles[r] = v
    if args.offline:
        for r in roles:
            if roles[r].startswith(("gemini", "openai:")) and not (args.base_url or os.environ.get("OPENAI_BASE_URL", "")).startswith(("http://127.", "http://localhost")):
                raise SystemExit(f"--offline: the {r} engine «{roles[r]}» needs the internet; choose a local one or none")
    e = Engines(
        embedder=factory.make_embedder(roles["embed"], args.base_url),
        vision=factory.make_generator(roles["vision"], args.base_url, "vision"),
        llm=factory.make_generator(roles["llm"], args.base_url, "llm"),
        asr=factory.make_asr(roles["asr"], args.base_url),
    )
    return e, roles


def cmd_build(args) -> int:
    from .net import OfflineGuard, offline_env
    from .pipeline import Options, build

    if args.offline:
        os.environ.update(offline_env())
    t0 = time.time()
    engines, roles = _engines(args)
    if args.offline:
        bad = engines.offline_ok()
        if bad:
            raise SystemExit(f"--offline: remote engines {bad}")
    user = {}
    if args.title:
        user["title"] = args.title
    if args.author:
        user["author"] = args.author
    if args.year:
        user["issued"] = args.year
    if args.csl_type:
        user["type"] = args.csl_type
    if args.publisher:
        user["publisher"] = args.publisher
    rights = None
    if args.license or args.rights_note:
        rights = {"license": args.license, "access": "open", "holder": None, "note": args.rights_note}
        rights = {k: v for k, v in rights.items() if v is not None}
    log = (lambda m: None) if args.quiet else (lambda m: print(f"[{time.time() - t0:7.1f}s] {m}", file=sys.stderr, flush=True))
    opts = Options(offline=args.offline, use_labels=not args.no_labels, language=args.language, metadata=user, rights=rights,
                   context=not args.no_context, figures=not args.no_figures, page_images=args.page_images,
                   image_vectors=args.image_vectors, dtype=args.dtype, embed_source=args.embed_source, max_units=args.max_units,
                   force_vision=args.force_vision, trust_ocr=args.trust_ocr, concurrency=args.concurrency, save_reading=args.save_reading,
                   reuse_reading=args.reuse_reading, log=log)
    out = args.output
    if not out:
        first = args.inputs[0]
        out = (Path(first).with_suffix(".spdf") if not first.startswith(("http://", "https://")) else Path("web.spdf"))
    if args.offline:
        with OfflineGuard():
            rep = build(args.inputs, str(out), engines, opts)
            rep.network_attempts = len(OfflineGuard.attempts)
    else:
        rep = build(args.inputs, str(out), engines, opts)
    d = rep.__dict__.copy()
    d["engines"] = roles
    if args.json:
        print(json.dumps(d, ensure_ascii=False, indent=2, default=str))
    else:
        v = rep.validation or {}
        codes = [e["code"] for e in v.get("errors", [])] + [w["code"] for w in v.get("warnings", [])]
        print(f"{rep.path}: {rep.kind}, {rep.units} units, {rep.fragments} fragments, {rep.sections} sections, "
              f"{rep.figures} figures, {rep.vectors} vectors, {rep.seconds} s; "
              f"{'valid' if v.get('valid') else 'INVALID'} ({v.get('validator', '?')}){' ' + ' '.join(codes) if codes else ''}"
              + (f"; network attempts: {rep.network_attempts}" if args.offline else ""))
    return 0 if (rep.validation or {}).get("valid") and rep.network_attempts == 0 else 1


def cmd_revectorize(args) -> int:
    from .engines import factory
    from .net import OfflineGuard, offline_env
    from .output import validate
    from .revectorize import revectorize

    if args.offline:
        os.environ.update(offline_env())
    emb = factory.make_embedder(args.model, getattr(args, "base_url", None))
    if args.offline and not emb.offline:
        raise SystemExit("--offline: this embedder needs the internet")
    log = (lambda m: None) if args.quiet else (lambda m: print(m, file=sys.stderr))
    dtype = args.dtype
    if ":" in args.model.split("@")[-1]:
        dtype = args.model.rsplit(":", 1)[1]
    if args.offline:
        with OfflineGuard():
            r = revectorize(args.file, emb, args.output, dtype, not args.no_images, log)
    else:
        r = revectorize(args.file, emb, args.output, dtype, not args.no_images, log)
    v = validate(r["path"])
    r["validation"] = v
    print(json.dumps(r, ensure_ascii=False, indent=None if not args.json else 2, default=str) if args.json else
          f"{r['path']}: +{r['space']} ({r['fragments']} fragments, {r['units']} units, {r['figures']} figures) "
          f"{'valid' if v.get('valid') else 'INVALID'}")
    return 0 if v.get("valid") else 1


def _add_revec_args(p):
    p.add_argument("file")
    p.add_argument("--model", required=True, help="embeddinggemma-2@256, gemini-embedding-2@768, openai:<model>[@dims], fake@64 (suffix :f16 or :i8 for dtype)")
    p.add_argument("-o", "--output", help="write to a new file instead of in place")
    p.add_argument("--dtype", choices=["f32", "f16", "i8"], default="f32")
    p.add_argument("--no-images", action="store_true")
    p.add_argument("--base-url")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("-q", "--quiet", action="store_true")


def cmd_engines(args) -> int:
    from .engines.factory import availability

    print(json.dumps(availability(), indent=2))
    return 0


def cmd_validate(args) -> int:
    from .output import validate

    rc = 0
    for f in args.files:
        v = validate(f)
        print(json.dumps({"file": f, **v}, ensure_ascii=False))
        rc |= 0 if v.get("valid") else 1
    return rc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="spdf-build", description="Reference producer of SPDF 5.0 files.")
    ap.add_argument("--version", action="version", version=f"spdf-build {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build a SPDF from any input")
    _add_build_args(b)
    b.set_defaults(func=cmd_build)
    r = sub.add_parser("revectorize", help="add (or replace) a vector space without reading again")
    _add_revec_args(r)
    r.set_defaults(func=cmd_revectorize)
    e = sub.add_parser("engines", help="which engines and models are available here")
    e.set_defaults(func=cmd_engines)
    v = sub.add_parser("validate", help="validate SPDF files (spdf-format, or the conformance oracle)")
    v.add_argument("files", nargs="+")
    v.set_defaults(func=cmd_validate)
    args = ap.parse_args(argv)
    return args.func(args)


# entry points for `spdf <command>` (group spdf.commands of spdf-format)
def register(subparsers) -> None:
    b = subparsers.add_parser("build", help="build a SPDF from any input (spdf-build)")
    _add_build_args(b)
    b.set_defaults(func=cmd_build)


def register_revectorize(subparsers) -> None:
    r = subparsers.add_parser("revectorize", help="add a vector space to a SPDF without reading again (spdf-build)")
    _add_revec_args(r)
    r.set_defaults(func=cmd_revectorize)


if __name__ == "__main__":
    sys.exit(main())
