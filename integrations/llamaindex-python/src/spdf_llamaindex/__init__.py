"""LlamaIndex reader for SPDF (Semantic Processed Document Format) files.

Every document is a passage (or a unit) with its exact anchor, a portable anchor URI and a
short citation, so that retrieval-augmented answers cite the printed page::

    from spdf_llamaindex import SpdfReader

    docs = SpdfReader().load_data("quijote.spdf")
    docs[0].metadata["citation"]      # '(Cervantes Saavedra, 1605, p. 23)'
"""

from __future__ import annotations

from ._records import SECTION_SEPARATOR, SECTIONS_SEPARATOR
from .reader import DEFAULT_EMBED_METADATA_KEYS, DEFAULT_LLM_METADATA_KEYS, SpdfReader

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_EMBED_METADATA_KEYS",
    "DEFAULT_LLM_METADATA_KEYS",
    "SECTIONS_SEPARATOR",
    "SECTION_SEPARATOR",
    "SpdfReader",
    "__version__",
]
