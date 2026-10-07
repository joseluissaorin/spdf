"""Integrity: ``content_sha256`` and Ed25519 signatures (contract §8).

* ``content_sha256`` = lowercase hex SHA-256 of the RFC 8785 serialization of the
  canonical dump without ``meta.content_sha256``, ``meta.signature`` and ``meta.signer``;
* ``signature`` = standard base64 of the Ed25519 signature over the ASCII bytes
  ``"spdf-content-sha256:" + content_sha256``;
* ``signer`` = ``"ed25519:"`` + standard base64 of the 32-byte public key.

The ``cryptography`` package is used when installed (``pip install spdf-format[crypto]``);
otherwise a pure-Python Ed25519 is used (fine for verifying; for signing prefer
``cryptography``).
"""

from __future__ import annotations

import base64
import binascii
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import _ed25519
from .errors import SignatureError

__all__ = [
    "IntegrityReport",
    "generate_key",
    "load_private_key",
    "load_public_key",
    "public_key_of",
    "sign_hash",
    "signature_message",
    "signer_id",
    "verify_hash",
]

PREFIX = b"spdf-content-sha256:"


def signature_message(content_sha256: str) -> bytes:
    """The exact bytes that are signed."""
    return PREFIX + content_sha256.lower().encode("ascii")


def _crypto() -> Any:
    try:
        from cryptography.hazmat.primitives.asymmetric import ed25519
    except ImportError:
        return None
    return ed25519


def generate_key() -> bytes:
    """A new random 32-byte Ed25519 private key (seed)."""
    return os.urandom(32)


def public_key_of(private_key: bytes) -> bytes:
    """The 32-byte public key of a private key."""
    ed = _crypto()
    if ed is not None:
        from cryptography.hazmat.primitives import serialization

        pk = ed.Ed25519PrivateKey.from_private_bytes(private_key).public_key()
        raw: bytes = pk.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return raw
    return _ed25519.public_key(private_key)


def signer_id(public_key: bytes) -> str:
    """The ``signer`` value of a public key: ``ed25519:<base64>``."""
    if len(public_key) != 32:
        raise SignatureError("an Ed25519 public key is 32 bytes")
    return "ed25519:" + base64.b64encode(public_key).decode("ascii")


def sign_hash(content_sha256: str, private_key: bytes) -> tuple[str, str]:
    """Sign a content hash. Returns ``(signature, signer)`` ready for ``spdf_meta``."""
    msg = signature_message(content_sha256)
    ed = _crypto()
    if ed is not None:
        sig: bytes = ed.Ed25519PrivateKey.from_private_bytes(private_key).sign(msg)
    else:
        sig = _ed25519.sign(private_key, msg)
    return base64.b64encode(sig).decode("ascii"), signer_id(public_key_of(private_key))


def _b64(value: str, what: str) -> bytes:
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (binascii.Error, ValueError, UnicodeEncodeError) as exc:
        raise SignatureError(f"{what} is not valid base64") from exc


def parse_signer(signer: str) -> bytes:
    """The public key bytes of a ``signer`` value."""
    if not isinstance(signer, str) or not signer.startswith("ed25519:"):
        raise SignatureError("signer must be 'ed25519:<base64 public key>'")
    key = _b64(signer[8:], "signer")
    if len(key) != 32:
        raise SignatureError("signer public key must be 32 bytes")
    return key


def verify_hash(content_sha256: str, signature: str, signer: str) -> bool:
    """True if ``signature`` verifies over ``content_sha256`` with the key in ``signer``."""
    try:
        key = parse_signer(signer)
        sig = _b64(signature, "signature")
    except SignatureError:
        return False
    if len(sig) != 64:
        return False
    msg = signature_message(content_sha256)
    ed = _crypto()
    if ed is not None:
        from cryptography.exceptions import InvalidSignature

        try:
            ed.Ed25519PublicKey.from_public_bytes(key).verify(sig, msg)
            return True
        except (InvalidSignature, ValueError):
            return False
    return _ed25519.verify(key, msg, sig)


def load_private_key(source: str | os.PathLike[str] | bytes) -> bytes:
    """Load a private key: 32 raw bytes, base64/hex text, or a PEM PKCS#8 file (needs cryptography)."""
    data = Path(os.fspath(source)).read_bytes() if not isinstance(source, bytes) else source
    if len(data) == 32:
        return data
    text = data.strip()
    if text.startswith(b"-----BEGIN"):
        ed = _crypto()
        if ed is None:
            raise SignatureError("reading PEM keys needs the 'cryptography' package (spdf-format[crypto])")
        from cryptography.hazmat.primitives import serialization

        key = serialization.load_pem_private_key(text, password=None)
        if not isinstance(key, ed.Ed25519PrivateKey):
            raise SignatureError("the PEM key is not an Ed25519 private key")
        raw: bytes = key.private_bytes(
            serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
        )
        return raw
    for decoder in (_from_hex_bytes, _from_b64_bytes):
        try:
            raw = decoder(text)
        except (ValueError, binascii.Error, UnicodeDecodeError):
            continue
        if len(raw) == 32:
            return raw
    raise SignatureError("unrecognized private key format (expected 32 raw bytes, hex, base64 or PEM)")


def _from_hex_bytes(b: bytes) -> bytes:
    return bytes.fromhex(b.decode("ascii"))


def _from_b64_bytes(b: bytes) -> bytes:
    return base64.b64decode(b, validate=True)


def _from_b64_str(s: str) -> bytes:
    return base64.b64decode(s, validate=True)


def load_public_key(value: str | bytes) -> bytes:
    """Load a public key from ``ed25519:<base64>``, base64, hex or 32 raw bytes."""
    if isinstance(value, bytes):
        if len(value) == 32:
            return value
        value = value.decode("ascii").strip()
    v = value.strip()
    if v.startswith("ed25519:"):
        return parse_signer(v)
    for decoder in (bytes.fromhex, _from_b64_str):
        try:
            raw = decoder(v)
        except (ValueError, binascii.Error):
            continue
        if len(raw) == 32:
            return raw
    raise SignatureError("unrecognized public key format")


@dataclass(frozen=True)
class IntegrityReport:
    """Outcome of :func:`spdf.verify`."""

    content_sha256: str
    stored_sha256: str | None
    hash_ok: bool | None
    signed: bool
    signature_ok: bool | None
    signer: str | None
    trusted: bool | None

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)
