"""A web page by URL, with its dated copy.

The fetched bytes are the source (shipped as a blob, so the copy travels with
the file); the date of access goes into every anchor (`accessed`) and into the
CSL `accessed` field; the final URL after redirects is the one cited. If the
URL serves a PDF, EPUB or other document, the matching reader takes over.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .. import net
from ..model import Source
from .blocks import units_by_sections
from .html import html_blocks, html_meta, html_title, main_content


def fetch(url: str, timeout: float = 30) -> tuple[bytes, dict, str, str]:
    data, headers, final = net.request("GET", url, headers={"Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"},
                                       timeout=timeout, retries=2, raw=True)
    h = {k.lower(): v for k, v in headers.items()}
    accessed = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return data, h, final, accessed


def read_web_html(data: bytes, url: str, accessed: str, headers: Optional[dict] = None) -> Source:
    ctype = (headers or {}).get("content-type", "")
    enc = "utf-8"
    if "charset=" in ctype:
        enc = ctype.split("charset=")[-1].split(";")[0].strip() or "utf-8"
    html = data.decode(enc, errors="replace")
    hints = html_meta(html)
    t = hints.get("title") or html_title(html)
    if t:
        hints["title"] = t
    hints["url"] = url
    hints["accessed"] = accessed
    blocks = html_blocks(main_content(html), web=True)
    units, _ids, toc = units_by_sections(blocks, "web", anchor_type="web", base_anchor={"url": url, "accessed": accessed})
    for u in units:
        u.kind = "web"
    return Source(path=url, kind="web", mime="text/html", data=data, units=units, toc=toc, hints=hints)
