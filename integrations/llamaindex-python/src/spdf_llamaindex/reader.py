"""``SpdfReader``: SPDF files as LlamaIndex documents that cite the printed page."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from typing import Any

from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document

from ._records import Record, Source, check_options, iter_records

__all__ = [
    "DEFAULT_EMBED_METADATA_KEYS",
    "DEFAULT_LLM_METADATA_KEYS",
    "SpdfReader",
]

#: Metadata keys included in the text that is embedded (the rest is excluded).
DEFAULT_EMBED_METADATA_KEYS: tuple[str, ...] = ("title", "section")
#: Metadata keys the LLM sees next to each passage (the rest is excluded).
DEFAULT_LLM_METADATA_KEYS: tuple[str, ...] = ("title", "authors", "year", "section", "citation")


class SpdfReader(BaseReader):
    """Read SPDF files (``.spdf``) into LlamaIndex :class:`~llama_index.core.schema.Document` objects.

    One document per fragment (the default, passages of about 150 to 300 words) or per
    unit (page, time span, slide…). The text is the literal passage of the source; the
    metadata carries the anchor, a portable anchor URI and a ready-made short citation
    such as ``(Saorín Ferrer, 2026, p. 1)``.

    Args:
        granularity: ``"fragment"`` (default) or ``"unit"``.
        locale: locale of the citation (``"en"``, ``"es"``; others fall back to English).
        include_embeddings: id of a vector space of the files (for example
            ``"all-MiniLM-L6-v2@384"``). When given, ``Document.embedding`` is set from the
            stored vectors, so an index whose embedding model matches that space does not
            embed the passages again. A file without that space raises an error.
        excluded_embed_metadata_keys: metadata keys kept out of the embedded text. By
            default every key except ``title`` and ``section``.
        excluded_llm_metadata_keys: metadata keys hidden from the LLM. By default every key
            except ``title``, ``authors``, ``year``, ``section`` and ``citation``.

    Example::

        from spdf_llamaindex import SpdfReader

        docs = SpdfReader(locale="en").load_data("library/")      # a file, a folder or a list
        docs[0].metadata["citation"]                              # '(Saorín Ferrer, 2026, p. 1)'
    """

    def __init__(
        self,
        *,
        granularity: str = "fragment",
        locale: str = "en",
        include_embeddings: str | None = None,
        excluded_embed_metadata_keys: Sequence[str] | None = None,
        excluded_llm_metadata_keys: Sequence[str] | None = None,
    ) -> None:
        check_options(granularity, locale)
        self.granularity = granularity
        self.locale = locale
        self.include_embeddings = include_embeddings
        self.excluded_embed_metadata_keys = (
            list(excluded_embed_metadata_keys) if excluded_embed_metadata_keys is not None else None
        )
        self.excluded_llm_metadata_keys = (
            list(excluded_llm_metadata_keys) if excluded_llm_metadata_keys is not None else None
        )

    def lazy_load_data(  # type: ignore[override]
        self,
        file: Source | Iterable[Source],
        extra_info: dict[str, Any] | None = None,
        fs: Any = None,
    ) -> Iterator[Document]:
        """Yield documents one by one, file after file.

        Args:
            file: a ``.spdf`` file, a folder (searched recursively for ``*.spdf``) or a list
                of files and folders.
            extra_info: metadata added to every document (it wins over the reader's keys).
            fs: an optional ``fsspec`` filesystem to read from (``SimpleDirectoryReader``
                passes it).
        """
        for rec in iter_records(
            file,
            granularity=self.granularity,
            locale=self.locale,
            vector_space=self.include_embeddings,
            fs=fs,
        ):
            yield self._document(rec, extra_info)

    def load_data(  # type: ignore[override]
        self,
        file: Source | Iterable[Source],
        extra_info: dict[str, Any] | None = None,
        fs: Any = None,
    ) -> list[Document]:
        """Load every document (see :meth:`lazy_load_data`)."""
        return list(self.lazy_load_data(file, extra_info=extra_info, fs=fs))

    def _document(self, rec: Record, extra_info: dict[str, Any] | None) -> Document:
        metadata = dict(rec.metadata)
        if extra_info:
            metadata.update(extra_info)
        if self.excluded_embed_metadata_keys is not None:
            excluded_embed = list(self.excluded_embed_metadata_keys)
        else:
            excluded_embed = [k for k in metadata if k not in DEFAULT_EMBED_METADATA_KEYS]
        if self.excluded_llm_metadata_keys is not None:
            excluded_llm = list(self.excluded_llm_metadata_keys)
        else:
            excluded_llm = [k for k in metadata if k not in DEFAULT_LLM_METADATA_KEYS]
        return Document(
            id_=rec.id,
            text=rec.text,
            metadata=metadata,
            excluded_embed_metadata_keys=excluded_embed,
            excluded_llm_metadata_keys=excluded_llm,
            embedding=rec.vector,
        )
