"""--offline: zero requests to the internet, verified by the socket guard."""
import socket

import pytest

from spdf_build import net
from spdf_build.cli import main
from spdf_build.net import OfflineError, OfflineGuard


def test_guard_blocks_and_counts():
    with OfflineGuard():
        with pytest.raises(OfflineError):
            socket.create_connection(("example.org", 80), timeout=1)
        with pytest.raises(OfflineError):
            net.get_json("https://api.crossref.org/works/10.1000/x")
        assert len(OfflineGuard.attempts) == 2
    assert not OfflineGuard.active


def test_guard_allows_loopback():
    with OfflineGuard():
        s = socket.socket()
        try:
            s.connect_ex(("127.0.0.1", 9))  # nothing listening: refused, but not blocked
        finally:
            s.close()
        assert OfflineGuard.attempts == []


def test_offline_build_makes_no_request(inputs, tmp_path, capsys):
    out = tmp_path / "x.spdf"
    rc = main(["build", str(inputs["pdf"]), "-o", str(out), "--engine", "fake", "--offline", "-q"])
    assert rc == 0
    assert OfflineGuard.attempts == []
    assert "network attempts: 0" in capsys.readouterr().out


def test_offline_refuses_remote_engines(inputs, tmp_path):
    with pytest.raises(SystemExit):
        main(["build", str(inputs["pdf"]), "-o", str(tmp_path / "y.spdf"), "--engine", "gemini", "--offline", "-q"])


def test_loopback_http_is_allowed_offline():
    import http.server
    import threading

    srv = http.server.HTTPServer(("127.0.0.1", 0), type("H", (http.server.BaseHTTPRequestHandler,), {
        "do_GET": lambda self: (self.send_response(200), self.send_header("Content-Type", "application/json"),
                                self.end_headers(), self.wfile.write(b'{"ok": true}')),
        "log_message": lambda *a: None}))
    threading.Thread(target=srv.handle_request, daemon=True).start()
    with OfflineGuard():
        assert net.get_json(f"http://127.0.0.1:{srv.server_port}/x") == {"ok": True}
        assert OfflineGuard.attempts == []
    srv.server_close()
