"""Network access: one place for HTTP and for the `--offline` guarantee.

`OfflineGuard` patches the socket layer for the whole process: any attempt to
resolve or connect to a non-loopback address raises `OfflineError` and is
counted. `spdf-build --offline` runs the entire build inside the guard and
prints the count (it must be 0: steps that would need the network are skipped
before they try), and the tests assert it.
"""
from __future__ import annotations

import ipaddress
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

USER_AGENT = "spdf-build/0.1 (+https://github.com/joseluissaorin/spdf)"


class OfflineError(ConnectionError):
    pass


def _is_local(host: Any) -> bool:
    if host is None:
        return True
    h = str(host).strip("[]")
    if h in ("localhost", "") or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_loopback
    except ValueError:
        return False


class OfflineGuard:
    """Context manager that forbids every non-loopback connection."""

    attempts: list[str] = []
    active = False

    def __enter__(self):
        OfflineGuard.attempts = []
        OfflineGuard.active = True
        self._saved = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)
        orig_connect, orig_connect_ex, orig_create, orig_gai = self._saved

        def check(addr):
            host = addr[0] if isinstance(addr, tuple) else addr
            if isinstance(addr, (str, bytes)):  # AF_UNIX
                return
            if not _is_local(host):
                OfflineGuard.attempts.append(str(host))
                raise OfflineError(f"--offline: blocked connection to {host}")

        def connect(sock, addr):
            check(addr)
            return orig_connect(sock, addr)

        def connect_ex(sock, addr):
            check(addr)
            return orig_connect_ex(sock, addr)

        def create_connection(address, *a, **k):
            check(address)
            return orig_create(address, *a, **k)

        def getaddrinfo(host, *a, **k):
            if not _is_local(host):
                OfflineGuard.attempts.append(str(host))
                raise OfflineError(f"--offline: blocked name resolution of {host}")
            return orig_gai(host, *a, **k)

        socket.socket.connect = connect
        socket.socket.connect_ex = connect_ex
        socket.create_connection = create_connection
        socket.getaddrinfo = getaddrinfo
        return self

    def __exit__(self, *exc):
        socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = self._saved
        OfflineGuard.active = False
        return False


def offline_env() -> dict[str, str]:
    """Environment that keeps model libraries from phoning home."""
    return {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_DATASETS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1"}


def request(method: str, url: str, headers: Optional[dict] = None, body: Any = None, timeout: float = 60,
            retries: int = 2, raw: bool = False) -> Any:
    """HTTP with JSON in and out (or raw bytes). Retries 429/5xx with backoff."""
    if OfflineGuard.active:
        OfflineGuard.attempts.append(urllib.parse.urlparse(url).hostname or url)
        raise OfflineError(f"--offline: blocked request to {url}")
    h = {"User-Agent": USER_AGENT, **(headers or {})}
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body).encode("utf-8")
            h.setdefault("Content-Type", "application/json")
    last: Optional[Exception] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = r.read()
                if raw:
                    return payload, dict(r.headers), r.geturl()
                return json.loads(payload.decode("utf-8")) if payload else None
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(1.5 * (2 ** attempt))
                continue
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code} from {urllib.parse.urlparse(url).hostname}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            if attempt < retries:
                time.sleep(1.0 * (2 ** attempt))
                continue
            raise
    raise RuntimeError(str(last))


def get_json(url: str, headers: Optional[dict] = None, timeout: float = 8) -> Any:
    return request("GET", url, headers=headers, timeout=timeout, retries=1)
