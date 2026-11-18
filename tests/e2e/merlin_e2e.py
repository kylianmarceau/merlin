"""End-to-end harness: drives a real, assembled Merlin.app.

Each test class launches its own Merlin instance with a throwaway profile,
config directory, workspace directory and browserctl socket, so the person
running the tests keeps their own browser, settings and clipboard. The app is
launched with `open -g -n`, so it doesn't come to the front.

Keys are sent with the DevTools protocol's Input.dispatchKeyEvent and a native
key code. Chromium then builds a real NSEvent and the key takes the same path
as a key typed on the keyboard: RenderWidgetHostImpl ->
Browser::PreHandleKeyboardEvent -> ReactBrowserWindow -> ModalBrowserController
(content/browser/devtools/protocol/input_handler.cc). A key without a native
code would be marked skip_if_unhandled and never reach Merlin.

Pages come from a local server (fixtures below). Every host ending in .test
resolves to it, so cross-site frames need no network.

The app under test is $MERLIN_APP, defaulting to the assembled build, then
/Applications/Merlin.app. Its Mach-O UUIDs and source commit are printed
before the first test, and an app assembled from other sources than this
checkout is refused unless MERLIN_E2E_ALLOW_OTHER_BUILD=1 (run_e2e_tests.sh
--allow-other-build). `python3 merlin_e2e.py --check-build` does only that.
"""

from __future__ import annotations

import base64
import contextlib
import http.server
import json
import os
import shutil
import plistlib
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path
from typing import Any, Callable, Optional

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_APPS = [
    ROOT / "apps/browser/build/assembled/Merlin.app",
    Path("/Applications/Merlin.app"),
]


# Where WebKit keeps the app's identified data stores, one folder per store.
WEBKIT_STORES = Path.home() / "Library/WebKit/io.github.kylianmarceau.merlin"

sys.path.insert(0, str(ROOT / "scripts/lib"))
from source_state import mismatch, source_state  # noqa: E402


def find_app() -> Path:
    if os.environ.get("MERLIN_APP"):
        return Path(os.environ["MERLIN_APP"]).expanduser().resolve()
    for candidate in DEFAULT_APPS:
        if candidate.exists():
            return candidate
    raise unittest.SkipTest("no Merlin.app: set MERLIN_APP to an assembled build")


def macho_uuids(binary: Path) -> str:
    """The binary's LC_UUIDs, as dwarfdump prints them ("UUID (arm64)")."""
    result = subprocess.run(["xcrun", "dwarfdump", "--uuid", str(binary)], capture_output=True, text=True)
    found = [" ".join(line.split()[1:3]) for line in result.stdout.splitlines() if line.startswith("UUID:")]
    return ", ".join(found) or f"unknown ({(result.stderr or 'no UUID').strip()})"


class OtherBuild(Exception):
    """The app under test wasn't assembled from this checkout."""


class QuarantinedApp(Exception):
    """macOS would run the app under test from a translocated copy, without the test's arguments."""


def refuse_quarantined(app: Path) -> None:
    """Raises QuarantinedApp if any file in the app carries com.apple.quarantine.

    `open` starts a quarantined app from a randomized App Translocation path
    and drops its --args and --env, so the instance would open the person's
    own profile in ~/Library/Application Support/Merlin instead of the test's.
    It also outlives the test: deleting the original while it runs can leave
    it stuck in the kernel, still holding that profile's databases, until the
    Mac restarts (2026-11-18).
    """
    found = subprocess.run(["xattr", "-r", "-l", str(app)], capture_output=True, text=True).stdout
    if "com.apple.quarantine" in found:
        raise QuarantinedApp(
            f"Refusing to test {app}: it is quarantined, so macOS would start it translocated, "
            "without the test's profile and arguments, on your own profile. Test a copy without "
            "the attribute: ditto it elsewhere, then xattr -dr com.apple.quarantine <copy>.")


def describe_and_verify(app: Path, allow_other: bool) -> list[str]:
    """Lines naming the build under test; raises OtherBuild unless it matches HEAD."""
    contents = app / "Contents"
    info: dict = {}
    with contextlib.suppress(OSError, plistlib.InvalidFileException):
        info = plistlib.loads((contents / "Info.plist").read_bytes())
    host = contents / "MacOS" / info.get("CFBundleExecutable", "Merlin")
    framework = contents / "Frameworks/Merlin Framework.framework/Merlin Framework"
    manifest_path = contents / "Resources/merlin-shell-build.json"
    manifest = None
    with contextlib.suppress(OSError, ValueError):
        manifest = json.loads(manifest_path.read_text())
    current = source_state(ROOT)
    recorded = (manifest or {}).get("sourceCommit")
    changes = (manifest or {}).get("sourceChanges")
    lines = [
        # A packaged release shows Merlin's version in CFBundleShortVersionString (docs/RELEASE.md).
        f"app:       {app} (Chromium {info.get('MerlinChromiumVersion') or info.get('CFBundleShortVersionString', '?')})",
        f"host:      {macho_uuids(host)}",
        f"framework: {macho_uuids(framework)}",
        "assembled: " + (f"{recorded}" + (f" + uncommitted changes {changes[:12]}" if changes else "")
                         if recorded else "no source commit recorded"),
        "checkout:  " + current["sourceCommit"] +
        (f" + uncommitted changes {current['sourceChanges'][:12]}" if current["sourceChanges"] else ""),
    ]
    problem = mismatch(manifest, current, ROOT)
    if problem:
        if not allow_other:
            raise OtherBuild(f"Refusing to test {app}: {problem}. Reassemble it from this checkout "
                             "(scripts/assemble_react_app.py), or pass --allow-other-build "
                             "(MERLIN_E2E_ALLOW_OTHER_BUILD=1) to test it anyway.")
        lines.append(f"WARNING:   testing another build: {problem}")
    return lines


_verified: dict[Path, bool] = {}


def app_path() -> Path:
    """The app under test, described and checked against the checkout once per run."""
    app = find_app()
    if app not in _verified:
        allow = os.environ.get("MERLIN_E2E_ALLOW_OTHER_BUILD") == "1"
        refuse_quarantined(app)  # whatever --allow-other-build says
        lines = describe_and_verify(app, allow)  # raises OtherBuild for every class until fixed
        # run_e2e_tests.sh has already printed these at the top of the log.
        if os.environ.get("MERLIN_E2E_BUILD_CHECKED") != str(app):
            print("\n".join(["Merlin under test:", *("  " + line for line in lines)]), file=sys.stderr)
        _verified[app] = True
    return app


def wait_until(check: Callable[[], Any], timeout: float = 10.0, interval: float = 0.05,
               message: str = "condition") -> Any:
    """Polls `check` until it returns something truthy and returns that."""
    deadline = time.monotonic() + timeout
    last_error: Optional[BaseException] = None
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except (AssertionError, KeyError, IndexError, ValueError, OSError, CdpError) as error:
            last_error = error
        time.sleep(interval)
    raise AssertionError(f"timed out waiting for {message}" +
                         (f" (last error: {last_error})" if last_error else ""))


# ---------------------------------------------------------------------------
# Pages


PAGE_HTML = """<!doctype html>
<title>modal</title>
<input id="t">
<div id="c" contenteditable>rich</div>
<p id="log"></p>
<div style="height: 5000px"></div>
<script>
  addEventListener('keydown', e => {
    document.getElementById('log').textContent += e.key + ' ';
  });
</script>"""

# A video with sound and no file to fetch: a drawn canvas and a quiet tone,
# recorded for a second and played back as an ordinary <video>, as a site's
# video plays (a live MediaStream isn't a media session player, so it never
# floats). start() is the test's, with autoplay allowed by the test's flags.
VIDEO_HTML = """<!doctype html>
<title>video</title>
<video id="v" width="320" height="180" loop></video>
<script>
  window.start = async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
    const g = canvas.getContext('2d');
    let n = 0;
    const draw = setInterval(() => { g.fillStyle = `hsl(${n++ * 12 % 360} 60% 50%)`; g.fillRect(0, 0, 320, 180); }, 33);
    const audio = new AudioContext();
    await audio.resume();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    const out = audio.createMediaStreamDestination();
    tone.connect(gain).connect(out);
    tone.start();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 1500));
    recorder.stop();
    await stopped;
    clearInterval(draw);
    tone.stop();
    await audio.close();
    const v = document.getElementById('v');
    v.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    await v.play();
  };
</script>"""

# Four targets in document order, three links and a text field. Hint tests
# use hint_chars = "sdfjkl" (A can't be sent, see key_event_specs), so their
# labels are s, d, f, j.
HINTS_HTML = """<!doctype html>
<title>hints</title>
<style>a, input { display: block; margin: 12px; font-size: 18px; }</style>
<a id="one" href="/one">One</a>
<a id="two" href="/two">Two</a>
<a id="three" href="/three" target="_blank">Three</a>
<input id="field" placeholder="type here">
<a id="hidden" href="/hidden" style="display:none">Hidden</a>
<div style="position:relative; height: 40px">
  <a id="covered" href="/covered">Covered</a>
  <div style="position:absolute; inset:0; background:white"></div>
</div>"""

# The document doesn't scroll; an inner panel does, as on many docs sites.
INNER_SCROLL_HTML = """<!doctype html>
<title>inner</title>
<style>html, body { margin: 0; height: 100%; overflow: hidden; }
#panel { height: 100%; overflow: auto; }</style>
<div id="panel"><div style="height: 5000px">tall</div></div>"""

DOC_HTML = """<!doctype html>
<title>Foo docs</title>
<main>
<h1>Foo</h1>
<p id="intro">Read the <a href="https://docs.rs/foo">docs</a> or call
<code>foo()</code> now.</p>
<h2>Install</h2>
<pre class="language-sh">cargo add foo</pre>
<div style="height: 1500px"></div>
<h2 id="usage">Usage</h2>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>
<div style="height: 3000px"></div>
</main>"""

FORM_HTML = """<!doctype html>
<title>form</title>
<textarea id="comment">first draft</textarea>
<input id="pw" type="password" value="secret">
<p id="log"></p>
<script>
  document.getElementById('comment').addEventListener('input', e => {
    document.getElementById('log').textContent += 'input:' + e.inputType + ' ';
  });
</script>"""

FRAMES_HTML = """<!doctype html>
<title>frames</title>
<style>a { display: block; margin: 12px; font-size: 18px; }
iframe { display: block; width: 420px; height: 90px; border: 0; }</style>
<a href="/one">Main link</a>
<iframe id="same" srcdoc="<a href='/inner' style='font-size:18px'>Inner link</a>"></iframe>
<iframe id="cross" src="CROSS"></iframe>"""

CROSS_FRAME_HTML = '<!doctype html><a href="/two" style="font-size:18px">Cross link</a>'

# A page asking for an ad script from a host on EasyList. The request reaches
# the local server only if the blocker lets it through.
ADS_HTML = """<!doctype html>
<title>ads</title>
<p id="state">waiting</p>
<div class="Billboard-ad" id="banner">an advert</div>
<div class="article" id="article">an article</div>
<script>
  const s = document.createElement('script');
  s.src = 'AD_URL';
  s.onload = () => document.getElementById('state').textContent = 'loaded';
  s.onerror = () => document.getElementById('state').textContent = 'blocked';
  document.head.append(s);
</script>"""


class PacedDownload:
    """A download the test paces: /paced/<name> sends `allowed` bytes, then waits.

    The download stays in progress until the test calls allow(); drop() resets
    every connection serving it, as a lost network does (a clean close after a
    short body would read as the server refusing), until allow() is called
    again. Range requests are answered, though Chromium 157 restarts an
    interrupted download from the start.
    """

    SIZE = 256 * 1024
    ETAG = '"paced-v1"'

    def __init__(self, name: str, first: int = 64 * 1024) -> None:
        self.name = name
        self.body = bytes(i % 251 for i in range(self.SIZE))
        self.allowed = first
        self.dropping = False
        self.requests: list[Optional[str]] = []  # each request's Range header
        self.changed = threading.Condition()

    def allow(self, total: Optional[int] = None) -> None:
        with self.changed:
            self.allowed = self.SIZE if total is None else total
            self.dropping = False
            self.changed.notify_all()

    def drop(self) -> None:
        with self.changed:
            self.dropping = True
            self.changed.notify_all()

    def serve(self, handler: http.server.BaseHTTPRequestHandler) -> None:
        wanted = handler.headers.get("Range")
        with self.changed:
            self.requests.append(wanted)
            dropping = self.dropping
        start = 0
        if wanted and wanted.startswith("bytes=") and wanted.endswith("-"):
            start = min(int(wanted[6:-1] or 0), self.SIZE)
        handler.send_response(206 if start else 200)
        handler.send_header("Content-Type", "application/octet-stream")
        handler.send_header("Content-Disposition", f'attachment; filename="{self.name}"')
        handler.send_header("Content-Length", str(self.SIZE - start))
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("ETag", self.ETAG)
        handler.send_header("Last-Modified", "Mon, 02 Nov 2026 09:00:00 GMT")
        if start:
            handler.send_header("Content-Range", f"bytes {start}-{self.SIZE - 1}/{self.SIZE}")
        handler.end_headers()
        handler.close_connection = True
        sent = start
        deadline = time.monotonic() + 60
        while sent < self.SIZE and not dropping:
            with self.changed:
                self.changed.wait_for(lambda: self.dropping or self.allowed > sent,
                                      timeout=max(0, deadline - time.monotonic()))
                dropping = self.dropping or time.monotonic() > deadline
                end = min(self.allowed, self.SIZE)
            if not dropping and end > sent:
                try:
                    handler.wfile.write(self.body[sent:end])
                    handler.wfile.flush()
                except OSError:
                    return  # the browser paused, cancelled or went away
                sent = end
        if dropping:
            # Reset rather than close, so the browser sees the network fail.
            with contextlib.suppress(OSError):
                handler.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))


# A 2x2 red PNG.
ICON_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==")


class Request:
    """One request the fixture server answered, with the headers tests read."""

    def __init__(self, host: str, path: str, cookie: str, user_agent: str) -> None:
        self.host, self.path, self.cookie, self.user_agent = host, path, cookie, user_agent

    @property
    def webkit(self) -> bool:
        return "Safari/" in self.user_agent and "Chrome/" not in self.user_agent

    def __repr__(self) -> str:
        return f"Request({self.host}{self.path}, cookie={self.cookie!r})"


class PageServer:
    """Serves the fixtures on 127.0.0.1 and records every path requested."""

    def __init__(self) -> None:
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # keep test output clean
                pass

            def do_GET(self) -> None:  # noqa: N802 (http.server's name)
                host = (self.headers.get("Host") or "").split(":")[0]
                with server.lock:
                    server.requests.append((host, self.path))
                    server.sent.append(Request(host, self.path, self.headers.get("Cookie") or "",
                                               self.headers.get("User-Agent") or ""))
                    paced = server.paced.get(self.path.split("?")[0])
                if paced:
                    paced.serve(self)
                    return
                status, kind, body, headers = server.respond(host, self.path)
                self.send_response(status)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(body)))
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

        self.lock = threading.Lock()
        self.requests: list[tuple[str, str]] = []
        self.sent: list[Request] = []
        self.paced: dict[str, PacedDownload] = {}
        class Server(http.server.ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request: Any, client_address: Any) -> None:
                # Browsers drop keep-alive connections when a test moves on.
                pass

        self.httpd = Server(("127.0.0.1", 0), Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        # The same pages over TLS, with a certificate for expired.test that
        # expired in 2024 (fixtures/): every certificate check fails on it.
        fixtures = Path(__file__).with_name("fixtures")
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(fixtures / "expired.test.pem", fixtures / "expired.test.key")
        self.httpsd = Server(("127.0.0.1", 0), Handler)
        self.httpsd.socket = context.wrap_socket(self.httpsd.socket, server_side=True)
        self.https_port = self.httpsd.server_address[1]
        threading.Thread(target=self.httpsd.serve_forever, daemon=True).start()

    def https_url(self, path: str, host: str = "expired.test") -> str:
        """A fixture page over TLS whose certificate expired (see __init__)."""
        return f"https://{host}:{self.https_port}{path}"

    def paced_download(self, name: str, first: int = 64 * 1024) -> tuple[PacedDownload, str]:
        """A new paced download and its URL (see PacedDownload)."""
        download = PacedDownload(name, first)
        with self.lock:
            self.paced[f"/paced/{name}"] = download
        return download, self.url(f"/paced/{name}")

    def clear(self) -> None:
        with self.lock:
            self.requests.clear()
            self.sent.clear()

    def requests_to(self, path_prefix: str, host: Optional[str] = None) -> list[Request]:
        """Every request for paths starting with `path_prefix`, by any engine."""
        with self.lock:
            return [r for r in self.sent if r.path.startswith(path_prefix) and (host is None or r.host == host)]

    def chromium_requests(self, path_prefix: str, host: Optional[str] = None) -> list[Request]:
        """Requests Chromium's pages made."""
        return [r for r in self.requests_to(path_prefix, host) if "Chrome/" in r.user_agent]

    def webkit_requests(self, path_prefix: str, host: Optional[str] = None) -> list[Request]:
        """Requests WebKit made (Chromium's say Chrome in their user agent)."""
        with self.lock:
            return [r for r in self.sent if r.webkit and r.path.startswith(path_prefix)
                    and (host is None or r.host == host)]

    def url(self, path: str, host: str = "localhost") -> str:
        return f"http://{host}:{self.port}{path}"

    def requested(self, path_prefix: str, host: Optional[str] = None) -> bool:
        with self.lock:
            return any(p.startswith(path_prefix) and (host is None or h == host)
                       for h, p in self.requests)

    def respond(self, host: str, path: str) -> tuple[int, str, bytes, dict]:
        html = "text/html; charset=utf-8"
        pages = {
            "/hints": HINTS_HTML,
            "/inner": INNER_SCROLL_HTML,
            "/doc": DOC_HTML,
            "/video": VIDEO_HTML,
            "/form": FORM_HTML,
            "/frame": CROSS_FRAME_HTML,
            "/frames": FRAMES_HTML.replace("CROSS", self.url("/frame", "b.test")),
            "/ads": ADS_HTML.replace("AD_URL", self.url("/pagead/js/adsbygoogle.js",
                                                        "pagead2.googlesyndication.com")),
        }
        if path.startswith("/icon-page?"):
            # /icon-page?name=X: a page whose icon is /icon/X.png.
            name = path.split("=", 1)[1]
            return 200, html, (f'<!doctype html><title>{name}</title><link rel="icon" href="/icon/{name}.png">'
                               "<p>A page with an icon.</p>").encode(), {}
        if path.startswith("/icon/"):
            # Cacheable for a day, and it sets a cookie: neither may outlast a private page.
            name = path[len("/icon/"):].split(".")[0]
            return 200, "image/png", ICON_PNG, {"Cache-Control": "max-age=86400", "Set-Cookie": f"icon-{name}=1; Path=/"}
        if path.startswith("/opener-page"):
            # Opens /opener-child (or ?open=<url>) as soon as it loads.
            target = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get("open", ["/opener-child"])[0]
            return 200, html, ("<!doctype html><title>Opener</title><p>Opens a window.</p>"
                               f"<script>window.open({json.dumps(target)}, 'signin', 'width=420,height=480');</script>").encode(), {}
        if path.startswith("/opener-child"):
            # Reports its opener's title (readable only through a working, same-site opener), then closes.
            return 200, html, ("<!doctype html><title>Child</title><script>"
                               "const t = window.opener ? window.opener.document.title : 'none';"
                               "fetch('/opener-report?title=' + encodeURIComponent(t)).finally(() => window.close());"
                               "</script>").encode(), {}
        if path.startswith("/flood?"):
            # /flood?n=N: N requests to the ad host at once; #done counts those settled.
            count = int(urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["n"][0])
            base = self.url("/pagead/flood/", "pagead2.googlesyndication.com")
            return 200, html, ("<!doctype html><title>flood</title><p id=\"done\">0</p><script>"
                               f"let done = 0; for (let i = 0; i < {count}; i++) "
                               f"fetch({json.dumps(base)} + i, {{mode: 'no-cors', cache: 'no-store'}})"
                               ".catch(() => {}).finally(() => { document.getElementById('done').textContent = ++done; });"
                               "</script>").encode(), {}
        if path.startswith("/set-cookie?"):
            # /set-cookie?name=value sets a session cookie for the host.
            return 200, html, PAGE_HTML.encode(), {"Set-Cookie": f"{path.split('?', 1)[1]}; Path=/"}
        if path.startswith("/pagead/"):
            return 200, "text/javascript", b"window.adLoaded = true;", {}
        if path == "/report-2026.pdf":
            return 200, "application/octet-stream", b"x" * 20000, {
                "Content-Disposition": 'attachment; filename="report-2026.pdf"'}
        return 200, html, pages.get(path.split("?")[0], PAGE_HTML).encode(), {}

    def close(self) -> None:
        for httpd in (self.httpd, self.httpsd):
            httpd.shutdown()
            httpd.server_close()


# ---------------------------------------------------------------------------
# The DevTools protocol, over a minimal WebSocket client (no dependencies).


def later(seconds: float, action: Callable[[], Any]) -> threading.Thread:
    """Runs `action` on another thread after `seconds`, while this one waits on a page.

    Join the returned thread before checking what `action` did.
    """
    thread = threading.Thread(target=lambda: (time.sleep(seconds), action()), daemon=True)
    thread.start()
    return thread


class CdpError(Exception):
    pass


class TargetClosed(CdpError):
    """The page went away while a call to it was pending (say, a key closed its tab)."""


class Cdp:
    """A DevTools browser connection with flattened page sessions."""

    def __init__(self, port: int, browser_path: str) -> None:
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {browser_path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                           "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CdpError("DevTools closed the connection during the handshake")
            response += chunk
        head, _, self.buffer = response.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise CdpError(f"DevTools refused the WebSocket: {head[:200]!r}")
        self.next_id = 0
        self.events: list[dict] = []
        self.sessions: dict[str, str] = {}  # target id -> session id

    def _send_frame(self, payload: bytes) -> None:
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 1 << 16:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _read(self, n: int) -> bytes:
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise CdpError("DevTools connection closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def _recv_message(self) -> dict:
        message = b""
        while True:
            first, second = self._read(2)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length)
            opcode = first & 0x0F
            if opcode == 0x8:
                raise CdpError("DevTools closed the connection")
            if opcode in (0x9, 0xA):  # ping/pong: nothing to answer for tests
                continue
            message += payload
            if first & 0x80:
                return json.loads(message)

    def call(self, method: str, params: Optional[dict] = None,
             session: Optional[str] = None, timeout: float = 30) -> dict:
        self.next_id += 1
        request: dict = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            request["sessionId"] = session
        self._send_frame(json.dumps(request).encode())
        self.sock.settimeout(timeout)
        while True:
            message = self._recv_message()
            if message.get("id") == self.next_id:
                if "error" in message:
                    raise CdpError(f"{method}: {message['error'].get('message')}")
                return message.get("result", {})
            if "method" in message:
                self.events.append(message)
                if (message["method"] == "Target.detachedFromTarget" and session and
                        message["params"].get("sessionId") == session):
                    self.sessions = {t: s for t, s in self.sessions.items() if s != session}
                    raise TargetClosed(f"{method}: the page closed")

    def targets(self) -> list[dict]:
        """Every DevTools target, tabs or not (a peek's page is "other")."""
        return self.call("Target.getTargets")["targetInfos"]

    def pages(self) -> list[dict]:
        return [t for t in self.targets() if t["type"] == "page"]

    def session_for(self, target_id: str) -> str:
        if target_id not in self.sessions:
            result = self.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})
            self.sessions[target_id] = result["sessionId"]
        return self.sessions[target_id]

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.close()


# ---------------------------------------------------------------------------
# Keys


# macOS virtual key codes (Carbon's kVK_ANSI_*), Windows key codes and DOM codes.
_MAC_LETTER = dict(zip("asdfhgzxcv bqweryt", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 11, 12, 13, 14, 15, 16, 17]))
_MAC_LETTER.update({"o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26,
                    "k": 0x28, "n": 0x2D, "m": 0x2E})
_MAC_DIGIT = {"1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17,
              "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D}
# character -> (mac code, windows code, DOM code, needs shift)
_PUNCT = {
    ":": (0x29, 0xBA, "Semicolon", True), ";": (0x29, 0xBA, "Semicolon", False),
    "?": (0x2C, 0xBF, "Slash", True), "/": (0x2C, 0xBF, "Slash", False),
    "'": (0x27, 0xDE, "Quote", False), "`": (0x32, 0xC0, "Backquote", False),
    "]": (0x1E, 0xDD, "BracketRight", False), "[": (0x21, 0xDB, "BracketLeft", False),
    "@": (0x13, 0x32, "Digit2", True), "$": (0x15, 0x34, "Digit4", True),
    " ": (0x31, 0x20, "Space", False),
}
_SPECIAL = {
    "Escape": (0x35, 0x1B, "Escape"), "Enter": (0x24, 0x0D, "Enter"),
    "Tab": (0x30, 0x09, "Tab"), "Backspace": (0x33, 0x08, "Backspace"),
}
ALT, CTRL, META, SHIFT = 1, 2, 4, 8


def key_event_specs(key: str, modifiers: int = 0) -> list[dict]:
    """The rawKeyDown/char/keyUp events a real press of `key` produces.

    `key` is one character, or a DOM key name from _SPECIAL.
    """
    if key in _SPECIAL:
        mac, win, code = _SPECIAL[key]
        text = {"Enter": "\r", "Tab": "\t"}.get(key, "")
        dom_key = key
    elif len(key) == 1 and key.isalpha():
        lower = key.lower()
        mac, win, code = _MAC_LETTER[lower], ord(lower.upper()), f"Key{lower.upper()}"
        if key.isupper():
            modifiers |= SHIFT
        text, dom_key = key, key
    elif key in _MAC_DIGIT:
        mac, win, code, text, dom_key = _MAC_DIGIT[key], ord(key), f"Digit{key}", key, key
    elif key in _PUNCT:
        mac, win, code, shifted = _PUNCT[key]
        if shifted:
            modifiers |= SHIFT
        text, dom_key = key, key
    else:
        raise ValueError(f"no key spec for {key!r}")
    if mac == 0:
        # kVK_ANSI_A is 0, and DevTools reads a native code of 0 as "none":
        # it then marks the event skip_if_unhandled, so it never reaches
        # Merlin (input_handler.cc). Tests use other letters.
        raise ValueError("the A key can't be sent through DevTools; use another letter")
    if modifiers & (CTRL | META):
        # Control and Command chords type no text, as on a real keyboard.
        text = ""
        if key.isalpha():
            dom_key = key.lower()
    base = {"modifiers": modifiers, "key": dom_key, "code": code,
            "windowsVirtualKeyCode": win, "nativeVirtualKeyCode": mac}
    down = dict(base, type="rawKeyDown")
    events = [down]
    if text:
        events.append(dict(base, type="char", text=text, unmodifiedText=text))
    events.append(dict(base, type="keyUp"))
    return events


def parse_keys(keys: str) -> list[tuple[str, int]]:
    """Splits Vim notation ("5j", "<C-w>v", "<Esc>", "<S-Esc>") into presses."""
    names = {"esc": "Escape", "cr": "Enter", "enter": "Enter", "tab": "Tab",
             "bs": "Backspace", "space": " "}
    presses: list[tuple[str, int]] = []
    i = 0
    while i < len(keys):
        if keys[i] == "<" and ">" in keys[i:]:
            end = keys.index(">", i)
            parts = keys[i + 1:end].split("-")
            mods = 0
            for part in parts[:-1]:
                mods |= {"C": CTRL, "S": SHIFT, "A": ALT, "M": ALT, "D": META}[part]
            last = parts[-1]
            presses.append((names.get(last.lower(), last), mods))
            i = end + 1
        else:
            presses.append((keys[i], 0))
            i += 1
    return presses


# ---------------------------------------------------------------------------
# The browser


def background_library(directory: Path) -> Path:
    """Builds background_app.m, which keeps the test instance in the background."""
    out = directory / "libmerlin_e2e_background.dylib"
    subprocess.run(["xcrun", "clang", "-dynamiclib", "-fobjc-arc", "-O1",
                    "-framework", "AppKit", "-framework", "ApplicationServices",
                    "-o", str(out), str(Path(__file__).with_name("background_app.m"))],
                   check=True, capture_output=True)
    return out


class Merlin:
    """One Merlin instance with isolated state."""

    def __init__(self, server: PageServer, extra_args: Optional[list[str]] = None,
                 shell_api: bool = True, local_state: Optional[dict] = None,
                 extra_env: Optional[dict] = None) -> None:
        self.server = server
        self.app = app_path()
        self.dir = Path(tempfile.mkdtemp(prefix="merlin-e2e-"))
        self.profile = self.dir / "profile"
        self.config_home = self.dir / "config"
        self.data_home = self.dir / "data"
        self.downloads = self.dir / "downloads"
        self.webkit_folder = self.dir / "webkit"
        # Unix socket paths are limited to 104 bytes; keep this one short.
        self.socket_dir = Path(tempfile.mkdtemp(prefix="me2e-", dir="/tmp"))
        self.socket = self.socket_dir / "s.sock"
        for path in (self.profile / "Default", self.config_dir, self.data_home, self.downloads):
            path.mkdir(parents=True)
        self.config_file.write_text("")
        # Downloads land in the throwaway folder, never in ~/Downloads, and
        # never ask where to go.
        (self.profile / "Default/Preferences").write_text(json.dumps({
            "download": {"default_directory": str(self.downloads), "prompt_for_download": False,
                         "directory_upgrade": True},
            "savefile": {"default_directory": str(self.downloads)},
        }))
        # Browser-wide preferences a test class starts with (MerlinTestCase.local_state).
        if local_state:
            (self.profile / "Local State").write_text(json.dumps(local_state))
        args = [
            f"--user-data-dir={self.profile}",
            "--remote-debugging-port=0",
            f"--modal-browser-socket={self.socket}",
            "--no-first-run", "--no-default-browser-check",
            # Never touch the login keychain of whoever runs the tests.
            "--use-mock-keychain", "--password-store=basic",
            # NSArgumentDomain overrides only this process, without changing
            # the person's saved preferences. These tests observe real tabs;
            # the React new-tab pop-up is covered by the shell's unit tests.
            "-MerlinShell.newTabPopup", "off",
            f"--host-resolver-rules=MAP *.test 127.0.0.1, MAP pagead2.googlesyndication.com 127.0.0.1",
            "--window-size=1280,900",
            # A hidden window is occluded; keep its pages running at full speed.
            "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            # browserctl shell-call: the React shell's own API (shell_call).
            *(["--merlin-test-shell-api"] if shell_api else []),
            *(extra_args or []),
            "about:blank",
        ]
        env = {"XDG_CONFIG_HOME": str(self.config_home), "XDG_DATA_HOME": str(self.data_home),
               "DYLD_INSERT_LIBRARIES": str(background_library(self.dir)),
               # WebKit's cookies, site data and icon cache for normal pages
               # go in a folder of this run's own, never the person's.
               "MERLIN_WEBKIT_TEST_FOLDER": str(self.webkit_folder),
               # A probe's own, such as MERLIN_STARTUP_TRACE (scripts/probe_large_libraries.py).
               **(extra_env or {})}
        # -g: don't bring it forward; -j: launch it hidden, so its window never
        # takes the keyboard from whoever is using the Mac.
        command = ["open", "-g", "-j", "-n", "-a", str(self.app)]
        for key, value in env.items():
            command += ["--env", f"{key}={value}"]
        self._launch_command = command + ["--args", *args]
        self._launch()

    def _launch(self) -> None:
        subprocess.run(self._launch_command, check=True)
        try:
            self._connect()
        except BaseException:
            self.close()
            raise

    def restart(self) -> None:
        """Quits Merlin as Command-Q does and starts it again with the same profile, config and data."""
        with contextlib.suppress(Exception):
            self.cdp.call("Browser.close", timeout=10)
        self.cdp.close()
        marker = f"--user-data-dir={self.profile}"
        wait_until(lambda: subprocess.run(["pgrep", "-f", "--", marker], capture_output=True).returncode != 0,
                   timeout=30, message="Merlin to quit")
        (self.profile / "DevToolsActivePort").unlink(missing_ok=True)
        self._launch()

    def crash_and_restart(self) -> None:
        """Ends Merlin as a crash does (SIGKILL to every process of it) and starts it again."""
        # Chromium marks the session as running in the profile's preferences,
        # which it writes some seconds after launch; a crash before then
        # looks like a clean exit, as it would to Chromium.
        preferences = self.profile / "Default/Preferences"
        wait_until(lambda: '"exit_type":"Crashed"' in preferences.read_text(), timeout=30,
                   interval=0.5, message="Chromium to record the running session")
        self.cdp.close()
        marker = f"--user-data-dir={self.profile}"
        subprocess.run(["pkill", "-9", "-f", "--", marker], capture_output=True)
        wait_until(lambda: subprocess.run(["pgrep", "-f", "--", marker], capture_output=True).returncode != 0,
                   timeout=30, message="Merlin to end")
        (self.profile / "DevToolsActivePort").unlink(missing_ok=True)
        self._launch()

    def _connect(self) -> None:
        port_file = self.profile / "DevToolsActivePort"
        wait_until(lambda: port_file.exists() and len(port_file.read_text().split()) >= 2,
                   timeout=60, message="Merlin to start (DevToolsActivePort)")
        port, path = port_file.read_text().split()[:2]
        self.cdp = Cdp(int(port), path)
        wait_until(lambda: self.browserctl("ping").get("ok"), timeout=30,
                   message="browserctl to answer")

    @property
    def config_dir(self) -> Path:
        return self.config_home / "modal_browser"

    @property
    def config_file(self) -> Path:
        return self.config_dir / "config.toml"

    @property
    def workspace_dir(self) -> Path:
        return self.data_home / "modal_browser" / "workspaces"

    # -- browserctl ---------------------------------------------------------

    def browserctl(self, cmd: str, **fields: Any) -> dict:
        """One request over the browserctl socket; returns the reply object."""
        request = {"v": 1, "id": 1, "cmd": cmd, **fields}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(30)
            s.connect(str(self.socket))
            s.sendall((json.dumps(request) + "\n").encode())
            data = b""
            while not data.endswith(b"\n"):
                chunk = s.recv(65536)
                if not chunk:
                    break
                data += chunk
        return json.loads(data)

    def command(self, line: str) -> dict:
        """Runs a `:` command line in the front window."""
        reply = self.browserctl("command", line=line)
        if not reply.get("ok"):
            raise AssertionError(f":{line} failed: {reply}")
        return reply

    def shell_call(self, method: str, args: Optional[dict] = None) -> dict:
        """Runs a React shell bridge method in the front window, as the shell does.

        The call goes through the dispatcher EngineClient uses
        (merlin_shell_bridge_mac.mm), not the modal command path. Requests
        (settings.*, bookmarks.*, downloads.list...) answer once their reply
        arrives. Returns the browserctl reply: {"ok": true, "result": ...} or
        {"ok": false, "error": ...}.
        """
        return self.browserctl("shell-call", method=method, args=args or {})

    def tabs(self) -> list[dict]:
        reply = self.browserctl("tabs")
        assert reply.get("ok"), reply
        return reply["result"]

    def active_tab(self) -> dict:
        return next(t for t in self.tabs() if t["active"] and t["window"] == 1)

    # -- private windows ----------------------------------------------------

    def private_pages(self) -> list[dict]:
        """Private windows' tabs, which browserctl never lists; DevTools does."""
        default = self.cdp.call("Target.getBrowserContexts")["defaultBrowserContextId"]
        return [p for p in self.cdp.pages() if p.get("browserContextId") != default]

    def open_private_window(self, url: Optional[str] = None) -> str:
        """Opens a private window (`:private`) and loads `url` in its tab.

        Returns the tab's DevTools session.
        """
        before = {p["targetId"] for p in self.private_pages()}
        self.command("private")
        page = wait_until(lambda: next((p for p in self.private_pages() if p["targetId"] not in before), None),
                          message="the private window")
        session = self.cdp.session_for(page["targetId"])
        if url:
            self.cdp.call("Page.navigate", {"url": url}, session)
        return session

    def close_private_windows(self) -> None:
        """Closes every private window, as closing their last tabs does."""
        for page in self.private_pages():
            with contextlib.suppress(CdpError):
                self.cdp.call("Target.closeTarget", {"targetId": page["targetId"]})
        wait_until(lambda: not self.private_pages(), message="the private windows to close")
        # The shell hears that a window closed when its root goes, just after.
        time.sleep(1)

    # -- pages --------------------------------------------------------------

    def active_session(self) -> str:
        """The DevTools session of the front window's active tab."""
        url = self.active_tab()["url"]
        pages = [p for p in self.cdp.pages() if p["url"] == url]
        if not pages:
            raise AssertionError(f"no DevTools page for the active tab {url}")
        # Several tabs can show the same URL; the front window's active one
        # is the most recently attached when only one matches, else the last
        # listed (DevTools lists the newest first).
        return self.cdp.session_for(pages[0]["targetId"])

    def open(self, path: str, host: str = "localhost") -> str:
        """Loads a fixture in the active tab and waits until it has loaded."""
        url = self.server.url(path, host)
        reply = self.browserctl("open", url=url, where="current")
        assert reply.get("ok"), reply
        # The tab shows the new address before its document commits; until
        # then the old document answers, complete, so check it is the new one.
        wait_until(lambda: self.active_tab()["url"] == url and
                   self.eval("location.href + ' ' + document.readyState") == f"{url} complete",
                   message=f"{url} to load")
        return url

    def eval(self, expression: str, session: Optional[str] = None) -> Any:
        result = self.cdp.call("Runtime.evaluate", {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        }, session or self.active_session())
        if "exceptionDetails" in result:
            raise CdpError(result["exceptionDetails"].get("text", "exception"))
        return result["result"].get("value")

    def press(self, keys: str, session: Optional[str] = None) -> None:
        """Types keys in Vim notation at the active page, as the keyboard would."""
        session = session or self.active_session()
        for key, mods in parse_keys(keys):
            for event in key_event_specs(key, mods):
                try:
                    self.cdp.call("Input.dispatchKeyEvent", event, session)
                except TargetClosed:
                    # The key closed its own tab; DevTools never answers it.
                    if keys.endswith(key) or len(parse_keys(keys)) == 1:
                        return
                    session = self.active_session()
                    break

    def keep_page_busy(self, seconds: float) -> None:
        """Blocks the active page's renderer for `seconds`, starting at once.

        Merlin's scripts in that page run, and answer, only afterwards: a
        request sent meanwhile is answered late, as by a slow page. The
        browser itself keeps answering browserctl.
        """
        self.eval("setTimeout(() => { const end = Date.now() + %d; while (Date.now() < end); }, 100)"
                  % int(seconds * 1000))
        time.sleep(0.25)

    def message(self) -> str:
        """The front window's status message."""
        reply = self.shell_call("window.snapshot")
        assert reply.get("ok"), reply
        return reply["result"]["modal"]["message"]

    def snapshot(self) -> dict:
        """The front window's state, as the shell draws it."""
        reply = self.shell_call("window.snapshot")
        assert reply.get("ok"), reply
        return reply["result"]

    def prompt(self, timeout: float = 10) -> dict:
        """The front window's current question (a permission, a dialog), once there is one."""
        return wait_until(lambda: self.snapshot().get("prompt"), timeout=timeout, message="a prompt")

    def answer_prompt(self, action: str, **fields: Any) -> dict:
        """Answers the current prompt as its button would; returns the bridge's reply.

        A prompt refuses answers in its first half second, so a click meant
        for something else can't answer it; this waits that out.
        """
        prompt = self.prompt()
        time.sleep(0.6)
        return self.shell_call("permissions.answer", {"promptId": prompt["id"], "actionId": action, **fields})

    def scroll_y(self) -> int:
        return int(self.eval("Math.round(window.scrollY)"))

    def page_log(self) -> str:
        return self.eval("document.getElementById('log').textContent")

    def focus(self, element_id: str) -> None:
        self.eval(f"document.getElementById({element_id!r}).focus()")
        wait_until(lambda: self.eval(f"document.activeElement.id === {element_id!r}"),
                   message=f"#{element_id} to have focus")

    # -- state between tests ------------------------------------------------

    def write_config(self, text: str) -> None:
        self.config_file.write_text(text)
        self.command("config-reload")
        # The file is read off the UI thread; give the reload a moment, then
        # confirm the browser is answering again.
        time.sleep(0.3)
        self.browserctl("ping")

    def reset(self) -> None:
        """One window, one tab on the default page, in Normal mode."""
        if self.config_file.read_text():
            self.write_config("")
        if len(self.tabs()) > 1:
            keep = self.active_tab()["url"]
            pages = self.cdp.pages()
            kept = next((p for p in pages if p["url"] == keep), pages[0])
            for page in pages:
                if page["targetId"] != kept["targetId"]:
                    with contextlib.suppress(CdpError):
                        self.cdp.call("Target.closeTarget", {"targetId": page["targetId"]})
            wait_until(lambda: len(self.tabs()) == 1, message="the other tabs to close")
        if self.tabs()[0]["pinned"]:
            self.command("pin")
        if self.tabs()[0].get("group"):
            self.command("ungroup")
        # A peek left open by a test closes as a page would (CloseContents).
        for target in self.cdp.targets():
            if target["type"] == "other" and target["url"].startswith(self.server.url("/")):
                with contextlib.suppress(CdpError):
                    self.cdp.call("Target.closeTarget", {"targetId": target["targetId"]})
        # Leave Insert, Passthrough or a pending sequence before loading the
        # page: a bare Esc in Normal mode reaches the page.
        with contextlib.suppress(AssertionError, CdpError):
            self.press("<Esc>")
        self.open("/page")
        # Loading the same address again is a reload, which restores the
        # last test's scroll position.
        self.eval("scrollTo(0, 0)")

    def close(self) -> None:
        if hasattr(self, "cdp"):
            with contextlib.suppress(Exception):
                self.cdp.call("Browser.close", timeout=10)
            self.cdp.close()
        marker = f"--user-data-dir={self.profile}"
        with contextlib.suppress(AssertionError):
            wait_until(lambda: subprocess.run(["pgrep", "-f", "--", marker],
                                              capture_output=True).returncode != 0,
                       timeout=15, message="Merlin to quit")
        subprocess.run(["pkill", "-f", "--", marker], capture_output=True)
        # WebKit keeps the run's own store (WKWebsiteDataStore(forIdentifier:)) in the app's container.
        with contextlib.suppress(OSError):
            store = (self.webkit_folder / "webkit-store-id").read_text().strip()
            if store:
                for path in WEBKIT_STORES.glob(f"*/{store}"):
                    shutil.rmtree(path, ignore_errors=True)
        shutil.rmtree(self.dir, ignore_errors=True)
        shutil.rmtree(self.socket_dir, ignore_errors=True)


class MerlinTestCase(unittest.TestCase):
    """Shares one Merlin per test class; each test starts from reset()."""

    browser: Merlin
    server: PageServer
    extra_args: list[str] = []
    shell_api = True
    local_state: dict = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = PageServer()
        try:
            cls.browser = Merlin(cls.server, cls.extra_args, cls.shell_api, cls.local_state)
        except BaseException:
            cls.server.close()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.server.close()

    def setUp(self) -> None:
        self.browser.reset()
        self.server.clear()

    # Shorthands
    def press(self, keys: str) -> None:
        self.browser.press(keys)

    def wait(self, check: Callable[[], Any], message: str = "condition", timeout: float = 10) -> Any:
        return wait_until(check, timeout=timeout, message=message)


if __name__ == "__main__":
    # run_e2e_tests.sh calls this first, so a stale app stops the run before
    # any test starts and the log opens with the build's identity.
    import argparse
    parser = argparse.ArgumentParser(description="Describe the Merlin.app under test and check its sources.")
    parser.add_argument("--check-build", action="store_true", required=True)
    parser.add_argument("--allow-other-build", action="store_true")
    options = parser.parse_args()
    try:
        app = find_app()
        lines = describe_and_verify(app, options.allow_other_build)
    except unittest.SkipTest as error:
        sys.exit(f"merlin_e2e: {error}")
    except OtherBuild as error:
        sys.exit(f"merlin_e2e: {error}")
    print("\n".join(["Merlin under test:", *("  " + line for line in lines)]))
    print(app)
