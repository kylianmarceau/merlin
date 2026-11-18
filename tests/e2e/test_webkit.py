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
        """WebKit's fetch of the icon (IconFetcher's URLSession; Chromium fetches its own page's icon too)."""
        return self.wait(lambda: next((r for r in self.server.requests_to(f"/icon/{name}.png", host)
                                       if "CFNetwork/" in r.user_agent), None),
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


class ClearDataTest(WebKitCase):
    """privacy.clearData, Merlin's Clear Browsing Data, clears Chromium's data and WebKit's together."""

    def clear(self, **args) -> None:
        reply = self.browser.shell_call("privacy.clearData", {"since": 0, "types": ["cookies"], **args})
        self.assertTrue(reply.get("ok"), reply)

    def chromium_cookie(self, host: str, path: str) -> str:
        """The Cookie header Chromium sends loading `path` from `host` (a Chromium site)."""
        self.browser.open(path, host)  # waits until it has loaded, so its cookie is kept
        return self.wait(lambda: next(iter(self.server.chromium_requests(path, host)), None),
                         f"Chromium to load {host}{path}").cookie

    def webkit_cookie(self, host: str, path: str) -> str:
        self.browser.browserctl("open", url=self.webkit_url(path, host), where="tab")
        return self.webkit_load(path, host).cookie

    def set_cookies(self) -> None:
        """c=1 on localhost and o=1 on other.test in Chromium; w=1 on wk and v=1 on wk2 in WebKit."""
        self.chromium_cookie("localhost", "/set-cookie?c=1")
        self.chromium_cookie("other.test", "/set-cookie?o=1")
        self.webkit_cookie("wk.localhost", "/set-cookie?w=1")
        self.webkit_cookie("wk2.localhost", "/set-cookie?v=1")
        self.assertIn("c=1", self.chromium_cookie("localhost", "/before"))
        self.assertIn("o=1", self.chromium_cookie("other.test", "/before"))
        self.assertIn("w=1", self.webkit_cookie("wk.localhost", "/before"))
        self.assertIn("v=1", self.webkit_cookie("wk2.localhost", "/before"))

    def test_clearing_cookies_clears_both_engines(self) -> None:
        self.set_cookies()
        self.clear()
        self.assertNotIn("c=1", self.chromium_cookie("localhost", "/after"))
        self.assertNotIn("o=1", self.chromium_cookie("other.test", "/after"))
        self.assertNotIn("w=1", self.webkit_cookie("wk.localhost", "/after"))
        self.assertNotIn("v=1", self.webkit_cookie("wk2.localhost", "/after"))

    def test_clearing_one_site_keeps_the_others(self) -> None:
        self.set_cookies()
        self.clear(site="wk.localhost")
        self.assertNotIn("w=1", self.webkit_cookie("wk.localhost", "/after-wk"))
        self.assertIn("v=1", self.webkit_cookie("wk2.localhost", "/after-wk"))
        self.assertIn("c=1", self.chromium_cookie("localhost", "/after-wk"))
        self.clear(site="other.test")
        self.assertNotIn("o=1", self.chromium_cookie("other.test", "/after-other"))
        self.assertIn("c=1", self.chromium_cookie("localhost", "/after-other"))
        self.assertIn("v=1", self.webkit_cookie("wk2.localhost", "/after-other"))

    def test_refusals(self) -> None:
        for args, error in (({"types": []}, "Choose what to clear"), ({"types": ["passwords"]}, "Unknown kind"),
                            ({"types": ["history"], "site": "other.test"}, "history"),
                            ({"types": ["cookies"], "site": "a b"}, "Invalid site")):
            reply = self.browser.shell_call("privacy.clearData", {"since": 0, **args})
            self.assertFalse(reply.get("ok"), reply)
            self.assertIn(error, reply.get("error", ""))

    def test_site_panel_forgets_the_site(self) -> None:
        self.set_cookies()
        self.browser.open("/page", "other.test")
        self.assertTrue(self.browser.shell_call("site.info").get("ok"))
        panel = self.wait(lambda: self.snapshot().get("prompt"), "the site panel")
        self.assertIn("forget", [a["id"] for a in panel["actions"]])
        self.answer(panel, "forget")
        confirm = self.wait(lambda: (p := self.snapshot().get("prompt")) and p["id"] != panel["id"] and p, "the confirmation")
        self.assertEqual(confirm["title"], "Forget other.test?")
        self.answer(confirm, "forget")
        self.wait(lambda: "o=1" not in self.chromium_cookie("other.test", f"/forgot-{time.monotonic()}"), "other.test forgotten")
        self.assertIn("c=1", self.chromium_cookie("localhost", "/after-forget"))

    def snapshot(self) -> dict:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]

    def answer(self, prompt: dict, action: str) -> None:
        time.sleep(0.6)  # prompts ignore answers for their first half second
        reply = self.browser.shell_call("permissions.answer", {"promptId": prompt["id"], "actionId": action})
        self.assertTrue(reply.get("ok"), reply)

