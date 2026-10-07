"""HTML / XHTML → a flat stream of blocks (titles, paragraphs, verse, figures, page breaks).

Shared by the EPUB, HTML and web readers. Standard library only. Light
Markdown in the text: `#` titles, *italics*, **bold**. Verse and line-broken
blocks keep their newlines. Page markers (EPUB `pagebreak`, `doc-pagebreak`,
Gutenberg `pagenum` / `x-ebookmaker-pageno`, or ids listed in a page-list)
become ("page", label) events.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
from typing import Optional

BLOCK = {"p", "div", "li", "dd", "dt", "blockquote", "pre", "figcaption", "caption", "tr", "section", "article", "aside",
         "header", "footer", "main", "nav", "table", "ul", "ol", "dl", "figure", "body", "td", "th", "address", "center"}
SKIP = {"script", "style", "noscript", "svg", "math", "template", "head", "title", "iframe", "object", "form", "button",
        "select", "textarea", "canvas"}
WEB_SKIP = {"nav", "header", "footer", "aside"}
HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


@dataclass
class Block:
    kind: str  # title | para | verse | figure | page | note
    text: str = ""
    level: int = 0
    src: Optional[str] = None
    label: Optional[str] = None
    ids: list[str] = field(default_factory=list)


def _clean(s: str) -> str:
    s = s.replace("­", "")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()


PAGE_CLASS = re.compile(r"\b(pagenum|pageno|x-ebookmaker-pageno|page-?break|pagebreak|page_number)\b", re.I)


class _Parser(HTMLParser):
    def __init__(self, page_ids: dict[str, str], web: bool, base_skip: set[str]):
        super().__init__(convert_charrefs=True)
        self.page_ids = page_ids
        self.blocks: list[Block] = []
        self.buf: list[str] = []
        self.skip_depth = 0
        self.stack: list[str] = []
        self.heading: Optional[int] = None
        self.pre = 0
        self.verse = 0
        self.web = web
        self.skip_tags = SKIP | (WEB_SKIP if web else set())
        self.ids: list[str] = []
        self.page_span: Optional[str] = None
        self.page_span_depth = 0
        self.capture = False
        self.buf_page: list[str] = []
        self.figure_alt: list[tuple[str, str]] = []

    # --- helpers
    def flush(self):
        text = "".join(self.buf)
        self.buf = []
        text = _clean(text)
        ids, self.ids = self.ids, []
        if not text:
            if ids:
                self.blocks.append(Block("anchor", ids=ids))
            return
        if self.heading:
            t = re.sub(r"\s+", " ", text)
            self.blocks.append(Block("title", t, level=self.heading, ids=ids))
        elif "\n" in text and (self.verse or self.pre):
            self.blocks.append(Block("verse", text, ids=ids))
        else:
            self.blocks.append(Block("para", re.sub(r"\s+", " ", text) if not self.pre else text, ids=ids))

    def page(self, label: str):
        self.flush()
        self.blocks.append(Block("page", label=label.strip()))

    # --- events
    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if self.skip_depth or tag in self.skip_tags:
            if tag not in ("br", "img", "hr", "meta", "link", "input"):
                self.skip_depth += 1
            return
        cls = a.get("class", "")
        etype = a.get("epub:type", "") + " " + a.get("role", "")
        if self.page_span:
            if tag == self.page_span:
                self.page_span_depth += 1
            return
        ident = a.get("id") or a.get("name")
        pagebreak = "pagebreak" in etype or "doc-pagebreak" in etype
        page_el = tag in ("span", "a", "div", "p") and bool(PAGE_CLASS.search(cls)) and len(cls) < 80
        swallow = (pagebreak or page_el) and tag not in ("br", "hr", "img")
        if ident and ident in self.page_ids:
            self.page(self.page_ids[ident])
            if swallow:
                self.page_span, self.page_span_depth, self.capture = tag, 1, False
                self.buf_page = []
                return
        elif pagebreak and (a.get("title") or a.get("aria-label")):
            if not self.page_ids:
                self.page(a.get("title") or a.get("aria-label") or "")
            if swallow:
                self.page_span, self.page_span_depth, self.capture = tag, 1, False
                self.buf_page = []
            return
        elif swallow:
            self.page_span, self.page_span_depth, self.capture = tag, 1, not self.page_ids
            self.buf_page = []
            return
        if ident:
            self.ids.append(ident)
        if tag in HEADINGS:
            self.flush()
            self.heading = HEADINGS[tag]
        elif tag in BLOCK:
            self.flush()
            if "poem" in cls or "verse" in cls or "stanza" in cls or "poetry" in cls or "lg" in cls.split():
                self.verse += 1
                self.stack.append("verse")
        if tag == "pre":
            self.pre += 1
        elif tag == "br":
            self.buf.append("\n")
            self.verse = max(self.verse, 0)
        elif tag in ("i", "em", "cite") and not self.heading:
            self.buf.append("*")
        elif tag in ("b", "strong") and not self.heading:
            self.buf.append("**")
        elif tag == "img":
            alt = a.get("alt", "")
            src = a.get("src") or a.get("data-src") or ""
            if src:
                self.flush()
                self.blocks.append(Block("figure", alt, src=src))
        elif tag == "span" and ("line" in cls.split() or "verse" in cls.split()):
            if self.buf and not "".join(self.buf).endswith("\n"):
                self.buf.append("\n")
        elif tag in ("td", "th"):
            self.buf.append(" | ")

    def handle_endtag(self, tag):
        if self.skip_depth:
            if tag in self.skip_tags or tag not in ("br", "img", "hr"):
                self.skip_depth -= 1
            return
        if self.page_span:
            if tag == self.page_span:
                self.page_span_depth -= 1
                if self.page_span_depth == 0:
                    if self.capture:
                        lab = re.sub(r"[\[\]{}()]|pg\.?|p\.|page", "", "".join(self.buf_page), flags=re.I).strip()
                        if lab:
                            self.page(lab)
                    self.buf_page = []
                    self.page_span = None
            return
        if tag in HEADINGS:
            self.flush()
            self.heading = None
        elif tag in BLOCK:
            self.flush()
            if self.stack and self.stack[-1] == "verse" and tag in ("div", "blockquote", "section"):
                self.stack.pop()
                self.verse = max(0, self.verse - 1)
        if tag == "pre":
            self.pre = max(0, self.pre - 1)
        elif tag in ("i", "em", "cite") and not self.heading:
            self.buf.append("*")
        elif tag in ("b", "strong") and not self.heading:
            self.buf.append("**")
        elif tag == "span" and self.verse:
            pass

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.page_span:
            self.buf_page.append(data)
            return
        if self.pre:
            self.buf.append(data)
        else:
            self.buf.append(re.sub(r"\s+", " ", data))


def _fix_emphasis(text: str) -> str:
    text = re.sub(r"\*\*\s*\*\*", "", text)
    text = re.sub(r"(?<!\*)\*\s*\*(?!\*)", "", text)
    text = re.sub(r"\*\*\s+", "** ", text)
    return text


def html_blocks(html: str, page_ids: Optional[dict[str, str]] = None, web: bool = False) -> list[Block]:
    p = _Parser(page_ids or {}, web, set())
    try:
        p.feed(html)
        p.close()
    except Exception:
        pass
    p.flush()
    out = []
    for b in p.blocks:
        if b.kind in ("para", "verse", "title"):
            b.text = _fix_emphasis(b.text).strip()
            if not b.text.strip("* "):
                continue
        out.append(b)
    return out


def html_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    return re.sub(r"\s+", " ", unescape(m.group(1))).strip() if m else None


def html_meta(html: str) -> dict:
    """Embedded bibliographic metadata: Highwire/Dublin Core/Open Graph/JSON-LD basics."""
    meta: dict = {}
    for m in re.finditer(r"<meta\s+[^>]*>", html, re.I):
        tag = m.group(0)
        name = re.search(r"(?:name|property)\s*=\s*[\"']([^\"']+)", tag, re.I)
        content = re.search(r"content\s*=\s*[\"']([^\"']*)", tag, re.I)
        if not name or not content:
            continue
        k, v = name.group(1).lower(), unescape(content.group(1)).strip()
        if not v:
            continue
        if k in ("citation_title", "dc.title", "og:title") and "title" not in meta:
            meta["title"] = v
        elif k in ("citation_author", "dc.creator", "author", "article:author"):
            meta.setdefault("authors", []).append(v)
        elif k in ("citation_publication_date", "citation_date", "dc.date", "article:published_time") and "date" not in meta:
            meta["date"] = v
        elif k in ("citation_doi", "dc.identifier") and re.match(r"^(doi:)?10\.\d{4,}/", v, re.I):
            meta["doi"] = re.sub(r"^doi:", "", v, flags=re.I)
        elif k in ("citation_publisher", "dc.publisher", "og:site_name") and "publisher" not in meta:
            meta["publisher"] = v
        elif k in ("citation_journal_title",):
            meta["container"] = v
        elif k in ("dc.language", "og:locale") and "language" not in meta:
            meta["language"] = v.replace("_", "-")
    lang = re.search(r"<html[^>]*\blang\s*=\s*[\"']([^\"']+)", html, re.I)
    if lang:
        meta.setdefault("language", lang.group(1))
    return meta


def main_content(html: str) -> str:
    """Readability-lite: the <article> or <main> if there is one, else the body."""
    for tag in ("article", "main"):
        ms = list(re.finditer(rf"<{tag}\b[^>]*>(.*?)</{tag}>", html, re.S | re.I))
        if ms:
            best = max(ms, key=lambda m: len(re.sub(r"<[^>]+>", "", m.group(1))))
            if len(re.sub(r"<[^>]+>", "", best.group(1))) > 500:
                return best.group(0)
    m = re.search(r"<body\b[^>]*>(.*)</body>", html, re.S | re.I)
    return m.group(0) if m else html
