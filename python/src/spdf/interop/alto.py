"""ALTO XML (v4) export.

One ``<Page>`` per page unit, with ``PHYSICAL_IMG_NR`` = ``physical`` and
``PRINTED_IMG_NR`` = printed folio (SPEC §19), one ``TextBlock`` per paragraph and one
``TextLine`` per line. SPDF stores text per unit, not word boxes, so blocks, lines and
strings carry no coordinates (they are optional in ALTO 4); page ``WIDTH``/``HEIGHT``
come from the embedded page image when there is one. Running headers go to
``TopMargin``, footers to ``BottomMargin`` and footnotes to a separate block tagged
as notes. Light Markdown markers are removed.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from xml.sax.saxutils import escape, quoteattr

from .._version import __version__
from .images import image_size

if TYPE_CHECKING:
    from ..model import Unit
    from ..reader import SpdfFile

__all__ = ["to_alto"]

ALTO_NS = "http://www.loc.gov/standards/alto/ns-v4#"
ALTO_XSD = "http://www.loc.gov/standards/alto/v4/alto-4-4.xsd"

_MD_PREFIX = re.compile(r"^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(?=\S))")
_MD_INLINE = re.compile(r"(\*\*|__|`)")


def _clean_line(line: str) -> str:
    line = _MD_PREFIX.sub("", line)
    return _MD_INLINE.sub("", line)


def _block(block_id: str, text: str, tag: str = "TextBlock", extra: str = "") -> list[str]:
    paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    for bi, para in enumerate(paragraphs, start=1):
        bid = f"{block_id}_{bi}"
        out.append(f'<{tag} ID="{bid}"{extra}>')
        for li, line in enumerate((ln for ln in para.split("\n") if ln.strip()), start=1):
            words = _clean_line(line).split()
            if not words:
                continue
            out.append(f'<TextLine ID="{bid}_L{li}">')
            parts = []
            for wi, w in enumerate(words, start=1):
                if wi > 1:
                    parts.append("<SP/>")
                parts.append(f'<String ID="{bid}_L{li}_W{wi}" CONTENT={quoteattr(w)}/>')
            out.append("".join(parts))
            out.append("</TextLine>")
        out.append(f"</{tag}>")
    return out


def _page(f: SpdfFile, u: Unit) -> list[str]:
    physical = u.anchor.physical if u.anchor.physical is not None else u.ord
    pid = f"P{physical}"
    attrs = [f'ID="{pid}"', f'PHYSICAL_IMG_NR="{physical}"']
    printed = u.printed if u.printed is not None else u.anchor.printed
    if printed:
        attrs.append(f"PRINTED_IMG_NR={quoteattr(printed)}")
    if u.image and u.image.startswith("blob:"):
        data = f.blob(u.image)
        size = image_size(data) if data else None
        if size:
            attrs.append(f'WIDTH="{size[0]}" HEIGHT="{size[1]}"')
    if u.confidence is not None:
        attrs.append(f'PC="{max(0.0, min(1.0, float(u.confidence))):.4g}"')
    out = [f"<Page {' '.join(attrs)}>"]
    if u.header:
        out.append(f'<TopMargin ID="{pid}_TM">')
        out += _block(f"{pid}_TM_B", u.header)
        out.append("</TopMargin>")
    if u.footer:
        # ALTO's PageType sequence puts BottomMargin before PrintSpace.
        out.append(f'<BottomMargin ID="{pid}_BM">')
        out += _block(f"{pid}_BM_B", u.footer)
        out.append("</BottomMargin>")
    out.append(f'<PrintSpace ID="{pid}_PS">')
    out += _block(f"{pid}_B", u.text)
    if u.notes:
        out += _block(f"{pid}_N", "\n\n".join(u.notes), extra=' TAGREFS="TAG_NOTE"')
    out.append("</PrintSpace>")
    out.append("</Page>")
    return out


def to_alto(f: SpdfFile) -> str:
    """ALTO 4 XML for every unit of the file."""
    doc = f.document
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<alto xmlns="{ALTO_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        f'xsi:schemaLocation="{ALTO_NS} {ALTO_XSD}">',
        "<Description>",
        "<MeasurementUnit>pixel</MeasurementUnit>",
        "<sourceImageInformation>",
        f"<fileName>{escape(doc.display_title)}</fileName>",
        f"<fileIdentifier>{escape(f.docref)}</fileIdentifier>",
        "</sourceImageInformation>",
        '<Processing ID="PROC_SPDF">',
        "<processingStepDescription>Export from SPDF</processingStepDescription>",
        "<processingSoftware>",
        "<softwareName>spdf-format</softwareName>",
        f"<softwareVersion>{escape(__version__)}</softwareVersion>",
        "</processingSoftware>",
        "</Processing>",
        "</Description>",
        "<Tags>",
        '<StructureTag ID="TAG_NOTE" LABEL="footnote"/>',
        "</Tags>",
        "<Layout>",
    ]
    pages = [u for u in f.iter_units() if u.anchor.type == "page"]
    if not pages:
        from ..errors import SpdfError

        raise SpdfError("ALTO export needs page units; this document has none (try IIIF or TEI)")
    for u in pages:
        lines += _page(f, u)
    lines += ["</Layout>", "</alto>", ""]
    return "\n".join(lines)
