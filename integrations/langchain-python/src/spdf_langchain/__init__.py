"""LangChain document loader for SPDF (Semantic Processed Document Format) files.

Every document is a passage (or a unit) with its exact anchor, a portable anchor URI and a
short citation, so that retrieval-augmented answers cite the printed page::

    from spdf_langchain import SpdfLoader

    docs = SpdfLoader("quijote.spdf").load()
    docs[0].metadata["citation"]      # '(Cervantes Saavedra, 1605, p. 23)'
"""

from __future__ import annotations

from ._records import SECTION_SEPARATOR, SECTIONS_SEPARATOR
from .loader import SpdfLoader

__version__ = "0.1.0"

__all__ = ["SECTIONS_SEPARATOR", "SECTION_SEPARATOR", "SpdfLoader", "__version__"]
