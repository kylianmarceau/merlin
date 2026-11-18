"""Tabs the shell shows in WebKit.

A fixture host is routed to WebKit through the shell's engine preferences,
given for this process only (`-MerlinShell.siteEngines`). WebKit resolves
hosts itself, without Chromium's --host-resolver-rules, so its fixtures are
on `*.localhost`, which macOS resolves to this Mac. The server tells WebKit's
requests from Chromium's by their user agent: Chromium's tab loads the
address too before the shell moves it off the site.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from merlin_e2e import Merlin, MerlinTestCase, PageServer

# Where URLSession.shared caches for the app: the person's, never the tests'.
SHARED_CACHE = Path.home() / "Library/Caches/io.github.kylianmarceau.merlin"


def files_mentioning(folder: Path, text: str) -> list[Path]:
    """Files under `folder` whose bytes contain `text` (a cache's index names the URLs it keeps)."""
    needle = text.encode()
    found = []
    for path in folder.rglob("*") if folder.exists() else []:
        try:
            if path.is_file() and needle in path.read_bytes():
                found.append(path)
        except OSError:
            pass
    return found


class WebKitCase(MerlinTestCase):
    """A Merlin that shows `wk.localhost` and `wk2.localhost` in WebKit."""

    hosts = ("wk.localhost", "wk2.localhost")

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = PageServer()
        engines = {f"http://{host}:{cls.server.port}": "webkit" for host in cls.hosts}
        # A quoted property-list string: NSArgumentDomain would read bare JSON as a dictionary.
        args = ["-MerlinShell.siteEngines", json.dumps(json.dumps(engines))]
        try:
            cls.browser = Merlin(cls.server, [*cls.extra_args, *args], cls.shell_api)
        except BaseException:
            cls.server.close()
            raise

    def webkit_url(self, path: str, host: str = "wk.localhost") -> str:
        return self.server.url(path, host)

    def webkit_load(self, path: str, host: str = "wk.localhost"):
        """The request WebKit made for `path`, once it has made it."""
        return self.wait(lambda: next(iter(self.server.webkit_requests(path, host)), None),
                         f"WebKit to load {host}{path}")


class PrivateSessionTest(WebKitCase):
    """WebKit's private session lasts as long as Chromium's: until the last private window closes."""

    def tearDown(self) -> None:
        self.browser.close_private_windows()

    def test_private_windows_open_together_share_sign_ins(self) -> None:
        self.browser.open_private_window(self.webkit_url("/set-cookie?shared=1"))
        self.webkit_load("/set-cookie?shared=1")
        self.browser.open_private_window(self.webkit_url("/check-shared"))
        self.assertIn("shared=1", self.webkit_load("/check-shared").cookie)

    def test_last_private_window_ends_the_session(self) -> None:
        self.browser.open_private_window(self.webkit_url("/set-cookie?gone=1"))
        self.webkit_load("/set-cookie?gone=1")
        self.browser.open_private_window(self.webkit_url("/check-before"))
        self.assertIn("gone=1", self.webkit_load("/check-before").cookie)
        self.browser.close_private_windows()
        self.browser.open_private_window(self.webkit_url("/check-after"))
        self.assertNotIn("gone=1", self.webkit_load("/check-after").cookie)

    def test_normal_windows_never_see_private_cookies(self) -> None:
        self.browser.open_private_window(self.webkit_url("/set-cookie?secret=1", "wk2.localhost"))
        self.webkit_load("/set-cookie?secret=1", "wk2.localhost")
        self.browser.browserctl("open", url=self.webkit_url("/check-normal", "wk2.localhost"), where="current")
        self.assertNotIn("secret=1", self.webkit_load("/check-normal", "wk2.localhost").cookie)


class IconTest(WebKitCase):
    """WebKit pages' icons are fetched apart: private ones leave nothing on disk, and no icon keeps a cookie."""

    def tearDown(self) -> None:
        self.browser.close_private_windows()

    @property
    def icon_cache(self) -> Path:
        return self.browser.webkit_folder / "icons"

    def icon_fetch(self, name: str, host: str = "wk.localhost"):
        return self.wait(lambda: next(iter(self.server.requests_to(f"/icon/{name}.png", host)), None),
                         f"the icon {name} to be fetched")

    def load_normal_icon(self, name: str, host: str = "wk.localhost") -> None:
        self.browser.browserctl("open", url=self.webkit_url(f"/icon-page?name={name}", host), where="current")
        self.webkit_load(f"/icon-page?name={name}", host)
        self.icon_fetch(name, host)

    def test_normal_icons_are_cached_in_their_own_folder(self) -> None:
        name = f"normal-{uuid.uuid4().hex[:8]}"
        self.load_normal_icon(name)
        self.wait(lambda: files_mentioning(self.icon_cache, name), "the icon in WebKit's icon cache")
        self.assertEqual(files_mentioning(SHARED_CACHE, name), [], "an icon reached the app's shared URL cache")

    def test_private_icons_leave_nothing_on_disk(self) -> None:
        name = f"private-{uuid.uuid4().hex[:8]}"
        self.browser.open_private_window(self.webkit_url(f"/icon-page?name={name}"))
        self.webkit_load(f"/icon-page?name={name}")
        self.icon_fetch(name)
        # A normal page's icon after it: once that one is on disk, a private
        # icon written the same way would be too.
        after = f"after-{uuid.uuid4().hex[:8]}"
        self.load_normal_icon(after, "wk2.localhost")
        self.wait(lambda: files_mentioning(self.icon_cache, after), "the normal icon in WebKit's icon cache")
        time.sleep(1)
        self.assertEqual(files_mentioning(self.icon_cache, name), [])
        self.assertEqual(files_mentioning(SHARED_CACHE, name), [], "a private icon reached the app's shared URL cache")

    def test_icons_send_and_keep_no_cookies(self) -> None:
        first, second = (f"cookie-{n}-{uuid.uuid4().hex[:8]}" for n in (1, 2))
        self.load_normal_icon(first)
        # The icon's response set icon-<first>=1; a later icon from that host doesn't send it.
        self.browser.browserctl("open", url=self.webkit_url(f"/icon-page?name={second}"), where="tab")
        self.webkit_load(f"/icon-page?name={second}")
        self.assertEqual(self.icon_fetch(second).cookie, "")
