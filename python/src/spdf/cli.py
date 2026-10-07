"""Command line interface: ``spdf validate|dump|info|search|cite|export|convert|conformance|sign|verify``.

Other packages add subcommands through the ``spdf.commands`` entry point group: each
entry point is a callable ``register(subparsers)`` that adds its parser to the
``argparse`` sub-parsers and sets ``func`` (``handler(args) -> int``) with
``set_defaults``. Example (``pyproject.toml`` of the producer)::

    [project.entry-points."spdf.commands"]
    build = "spdf_build.cli:register"
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any

from . import __version__
from ._sqlite import driver_info

__all__ = ["build_parser", "main"]


def _out(text: str, path: str | None = None) -> None:
    if path and path != "-":
        Path(path).write_text(text, encoding="utf-8")
        return
    data = text if text.endswith("\n") else text + "\n"
    buf = getattr(sys.stdout, "buffer", None)
    if buf is not None:
        sys.stdout.flush()
        buf.write(data.encode("utf-8"))
        buf.flush()
    else:  # pragma: no cover
        sys.stdout.write(data)


def _json(obj: Any, pretty: bool = True) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None, sort_keys=False)


def _err(msg: str) -> None:
    sys.stderr.write(msg + "\n")


# -- commands --------------------------------------------------------------------------


def cmd_validate(args: argparse.Namespace) -> int:
    from .validate import validate

    status = 0
    results = []
    for path in args.files:
        r = validate(path, check_fts=not args.no_fts)
        results.append({"file": path, **r.to_dict()})
        if not r.valid:
            status = 1
        if not args.json:
            mark = "valid" if r.valid else "INVALID"
            _out(f"{path}: {mark} (SPDF {r.version or '?'}, profile: {' '.join(r.profile) or '-'})")
            for i in r.errors:
                _out(f"  {i.code} {i.message}" + (f" [{i.where}]" if i.where else ""))
            for i in r.warnings:
                _out(f"  {i.code} (warning) {i.message}" + (f" [{i.where}]" if i.where else ""))
    if args.json:
        _out(_json(results[0] if len(results) == 1 else results))
    return status


def cmd_dump(args: argparse.Namespace) -> int:
    from .reader import open_spdf

    with open_spdf(args.file) as f:
        text = f.dump_json(indent=2) if args.pretty else f.dump_json()
    _out(text, args.output)
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    if args.env or not args.file:
        _out(_json({"spdf-format": __version__, "python": sys.version.split()[0], **driver_info()}))
        return 0
    from .reader import open_spdf

    with open_spdf(args.file) as f:
        d = f.document
        info = {
            "file": args.file,
            "version": f.version,
            "legacy": f.legacy,
            "gzip": f.gzip_wrapped,
            "profile": f.profile,
            "document": {
                "id": d.id,
                "kind": d.kind,
                "title": d.display_title,
                "authors": d.authors,
                "year": d.year,
                "language": d.language,
                "units": d.unit_count,
                "source_sha256": d.source_sha256,
            },
            "citation": f.cite(None, locale=args.locale),
            "docref": f.docref,
            "counts": {
                "units": sum(1 for _ in f.iter_units()),
                "fragments": sum(1 for _ in f.iter_fragments()),
                "figures": len(f.figures()),
                "sections": len(f.sections()),
                "blobs": len(f.blobs()),
            },
            "spaces": [
                {"id": s.id, "model": s.model, "dims": s.dims, "dtype": s.dtype, "normalized": s.normalized}
                for s in f.spaces()
            ],
            "meta": f.meta,
        }
    if args.json:
        _out(_json(info))
    else:
        doc = info["document"]
        lines = [
            f"{doc['title']}",
            f"  {info['citation']}",
            f"  SPDF {info['version']}{' (legacy)' if info['legacy'] else ''}, kind {doc['kind']}, "
            f"profile {' '.join(info['profile']) or '-'}",
            f"  units {info['counts']['units']}, fragments {info['counts']['fragments']}, "
            f"figures {info['counts']['figures']}, sections {info['counts']['sections']}, "
            f"blobs {info['counts']['blobs']}",
            f"  docref spdf:{info['docref']}",
        ]
        for s in info["spaces"]:
            lines.append(f"  space {s['id']} ({s['dims']} × {s['dtype']})")
        _out("\n".join(lines))
    return 0


def _load_vector(value: str) -> list[float]:
    p = Path(value)
    text = p.read_text(encoding="utf-8") if p.is_file() else value
    data = json.loads(text)
    if isinstance(data, dict):
        data = data.get("vector")
    if not isinstance(data, list):
        raise SystemExit("--vector must be a JSON array (inline or in a file)")
    return [float(x) for x in data]


def cmd_search(args: argparse.Namespace) -> int:
    from .reader import open_spdf

    with open_spdf(args.file) as f:
        mode = args.mode or ("hybrid" if args.vector and args.query else "vector" if args.vector else "lexical")
        if mode == "lexical":
            hits = f.search(args.query or "", limit=args.limit)
        elif mode == "vector":
            if not args.vector:
                raise SystemExit("vector search needs --vector")
            hits = f.search_vector(_load_vector(args.vector), space=args.space, limit=args.limit)
        else:
            if not args.vector:
                raise SystemExit("hybrid search needs --vector")
            hits = f.search_hybrid(args.query or "", _load_vector(args.vector), space=args.space, limit=args.limit)
        if args.json:
            _out(_json([{**h.to_dict(), "citation": f.cite(h.fragment or h.anchor, locale=args.locale)} for h in hits]))
            return 0
        for i, h in enumerate(hits, start=1):
            text = (h.fragment.text if h.fragment else "").replace("\n", " ")
            cite = f.cite(h.fragment or h.anchor, locale=args.locale)
            _out(f"{i:>2}. {cite}  [{h.score:.4f} {'+'.join(h.via)}]\n    {text[:160]}\n    {h.anchor_uri}")
    return 0


def cmd_cite(args: argparse.Namespace) -> int:
    from .reader import open_spdf

    with open_spdf(args.file) as f:
        item: Any = None
        if args.fragment:
            item = f.fragment(args.fragment)
            if item is None:
                raise SystemExit(f"no fragment {args.fragment!r}")
        elif args.unit:
            item = f.unit(args.unit)
            if item is None:
                raise SystemExit(f"no unit {args.unit!r}")
        elif args.uri:
            item = args.uri
        _out(f.cite(item, locale=args.locale))
        if args.bibtex:
            _out(f.to_bibtex())
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    from .reader import open_spdf

    with open_spdf(args.file) as f:
        fmt = args.format
        if fmt == "csl":
            text = _json(f.to_csl_json())
        elif fmt == "bibtex":
            text = f.to_bibtex()
        elif fmt == "alto":
            text = f.to_alto()
        elif fmt == "iiif":
            if not args.base_url:
                raise SystemExit("--format iiif needs --base-url (where manifest.json will be published)")
            if args.images_dir:
                out_dir = Path(args.images_dir)
                for b in f.blobs():
                    if b.mime.startswith(("image/", "audio/", "video/")):
                        target = (out_dir / "blobs" / b.key).resolve()
                        if out_dir.resolve() not in target.parents:
                            raise SystemExit(f"unsafe blob key {b.key!r}")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(f.blob(b.key) or b"")
            text = _json(f.to_iiif(args.base_url, locale=args.locale))
        elif fmt == "jsonl":
            from .interop.frames import fragment_records

            text = "\n".join(
                json.dumps(r, ensure_ascii=False) for r in fragment_records(f, locale=args.locale)
            )
        else:  # pragma: no cover - argparse restricts choices
            raise SystemExit(f"unknown format {fmt}")
    _out(text, args.output)
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    from .integrity import load_private_key
    from .writer import convert_legacy

    key = load_private_key(args.sign_key) if args.sign_key else None
    out = convert_legacy(args.source, args.destination, overwrite=args.overwrite, sign_key=key)
    _out(f"wrote {out}")
    return 0


def cmd_conformance(args: argparse.Namespace) -> int:
    from .conformance import find_conformance_dir, run

    root = Path(args.dir) if args.dir else find_conformance_dir()
    if root is None:
        _err("conformance directory not found (pass it as an argument)")
        return 2
    report = run(root, only=args.case or None)
    text = _json(report, pretty=not args.compact)
    _out(text, args.output)
    if not args.output or args.output == "-":
        pass
    if report["failed"]:
        _err(f"{len(report['failed'])} conformance case(s) failed")
        return 1
    return 0


def cmd_sign(args: argparse.Namespace) -> int:
    from . import sign
    from .integrity import load_private_key

    report = sign(args.file, load_private_key(args.key))
    _out(_json(report.to_dict()))
    return 0 if report.signature_ok else 1


def cmd_verify(args: argparse.Namespace) -> int:
    from . import verify

    report = verify(args.file, args.public_key)
    _out(_json(report.to_dict()))
    ok = report.hash_ok is not False and report.signature_ok is not False and report.trusted is not False
    return 0 if ok else 1


# -- parser ------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="spdf", description="SPDF (Semantic Processed Document Format) tools")
    p.add_argument("--version", action="version", version=f"spdf-format {__version__}")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")

    s = sub.add_parser("validate", help="validate files (exit 1 if any is invalid)")
    s.add_argument("files", nargs="+")
    s.add_argument("--json", action="store_true", help="print the result object of the specification")
    s.add_argument("--no-fts", action="store_true", help="skip the FTS index integrity check")
    s.set_defaults(func=cmd_validate)

    s = sub.add_parser("dump", help="print the canonical JSON dump")
    s.add_argument("file")
    s.add_argument("--pretty", action="store_true", help="indented (not canonical) output")
    s.add_argument("-o", "--output")
    s.set_defaults(func=cmd_dump)

    s = sub.add_parser("info", help="summary of a file (or of the environment with --env)")
    s.add_argument("file", nargs="?")
    s.add_argument("--json", action="store_true")
    s.add_argument("--env", action="store_true", help="show the SQLite driver and FTS5 support")
    s.add_argument("--locale", default="es")
    s.set_defaults(func=cmd_info)

    s = sub.add_parser("search", help="lexical, vector or hybrid search")
    s.add_argument("file")
    s.add_argument("query", nargs="?", default="")
    s.add_argument("--mode", choices=["lexical", "vector", "hybrid"])
    s.add_argument("--vector", help="query vector: JSON array inline or a file with it")
    s.add_argument("--space", help="vector space id (default: the only one)")
    s.add_argument("--limit", type=int, default=10)
    s.add_argument("--locale", default="es")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("cite", help="short citation of the document, a fragment, a unit or an anchor URI")
    s.add_argument("file")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--fragment")
    g.add_argument("--unit")
    g.add_argument("--uri")
    s.add_argument("--locale", default="es")
    s.add_argument("--bibtex", action="store_true", help="also print the BibTeX entry")
    s.set_defaults(func=cmd_cite)

    s = sub.add_parser("export", help="export bibliographic data or the text")
    s.add_argument("file")
    s.add_argument("--format", "-f", required=True, choices=["csl", "bibtex", "alto", "iiif", "jsonl"])
    s.add_argument("--base-url", help="IIIF: public base URL of the manifest")
    s.add_argument("--images-dir", help="IIIF: also write embedded images/media under DIR/blobs/")
    s.add_argument("--locale", default="es")
    s.add_argument("-o", "--output")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("convert", help="convert a legacy 4.x file to SPDF 5.0")
    s.add_argument("source")
    s.add_argument("destination")
    s.add_argument("--overwrite", action="store_true")
    s.add_argument("--sign-key", help="Ed25519 private key file to sign the result")
    s.set_defaults(func=cmd_convert)

    s = sub.add_parser("conformance", help="run the conformance suite and print the report")
    s.add_argument("dir", nargs="?", help="the conformance/ directory (default: search upwards)")
    s.add_argument("--case", action="append", help="run only this case id (repeatable)")
    s.add_argument("--compact", action="store_true")
    s.add_argument("-o", "--output")
    s.set_defaults(func=cmd_conformance)

    s = sub.add_parser("sign", help="add content_sha256 and an Ed25519 signature (in place)")
    s.add_argument("file")
    s.add_argument("--key", required=True, help="private key: 32 raw bytes, hex, base64 or PEM")
    s.set_defaults(func=cmd_sign)

    s = sub.add_parser("verify", help="check content_sha256 and the signature")
    s.add_argument("file")
    s.add_argument("--public-key", help="expected signer (ed25519:<base64>, hex or base64)")
    s.set_defaults(func=cmd_verify)

    _load_plugins(sub)
    return p


def _load_plugins(sub: Any) -> None:
    try:
        eps = importlib_metadata.entry_points(group="spdf.commands")
    except Exception:  # pragma: no cover
        return
    for ep in eps:
        try:
            register = ep.load()
            register(sub)
        except Exception as exc:  # a broken plugin must not break the CLI
            _err(f"spdf: could not load command plugin {ep.name!r}: {exc}")


def main(argv: Sequence[str] | None = None) -> int:
    from .errors import SpdfError

    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 2
    try:
        result = args.func(args)
        return int(result or 0)
    except SpdfError as exc:
        _err(f"spdf: {exc}")
        return 1
    except FileNotFoundError as exc:
        _err(f"spdf: {exc}")
        return 1
    except BrokenPipeError:  # pragma: no cover
        return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
