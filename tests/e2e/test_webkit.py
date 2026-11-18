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

from merlin_e2e import Merlin, MerlinTestCase, PageServer


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
