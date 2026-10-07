"""``SpdfLoader``: SPDF files as LangChain documents that cite the printed page."""

from __future__ import annotations

import os
from collections.abc import Iterable, Iterator

from langchain_core.document_loaders import BaseLoader
from langchain_core.documents import Document

from ._records import Source, check_options, iter_records

__all__ = ["SpdfLoader"]


class SpdfLoader(BaseLoader):
    """Load SPDF files (``.spdf``) as LangChain :class:`~langchain_core.documents.Document` objects.

    One document per fragment (the default, passages of about 150 to 300 words) or per
    unit (page, time span, slide…). ``page_content`` is the literal passage of the source;
    the metadata carries the anchor, a portable anchor URI and a ready-made short citation
    such as ``(Saorín Ferrer, 2026, p. 1)``.

    Args:
        file_path: a ``.spdf`` file, a folder (searched recursively for ``*.spdf``, hidden
            entries skipped) or a list of files and folders.
        granularity: ``"fragment"`` (default) or ``"unit"``.
        locale: locale of the citation (``"en"``, ``"es"``; others fall back to English).
        with_vectors: id of a vector space of the files (for example
            ``"all-MiniLM-L6-v2@384"``). When given, the stored vector is put in
            ``metadata["vector"]`` (a list of floats) and the space id in
            ``metadata["vector_space"]``. Off by default: a long list in the metadata is
            not what most vector stores expect. A file without that space raises an error.

    Example::

        from spdf_langchain import SpdfLoader

        docs = SpdfLoader("library/").load()        # a file, a folder or a list
        docs[0].metadata["citation"]                 # '(Saorín Ferrer, 2026, p. 1)'
    """

    def __init__(
        self,
        file_path: Source | Iterable[Source],
        *,
        granularity: str = "fragment",
        locale: str = "en",
        with_vectors: str | None = None,
    ) -> None:
        check_options(granularity, locale)
        self.file_path: Source | list[Source] = (
            file_path if isinstance(file_path, (str, os.PathLike)) else list(file_path)
        )
        self.granularity = granularity
        self.locale = locale
        self.with_vectors = with_vectors

    def lazy_load(self) -> Iterator[Document]:
        """Yield documents one by one, file after file."""
        for rec in iter_records(
            self.file_path,
            granularity=self.granularity,
            locale=self.locale,
            vector_space=self.with_vectors,
        ):
            metadata = dict(rec.metadata)
            if rec.vector is not None:
                metadata["vector"] = rec.vector
            yield Document(id=rec.id, page_content=rec.text, metadata=metadata)
