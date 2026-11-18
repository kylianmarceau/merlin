"""A page's renderer, or the GPU process, crashing (6.9).

A crashed tab shows the shell's own crashed page (`crashed` in the
snapshot) until it is reloaded; afterwards modal keys and hints work on the
new renderer as before. The GPU process restarts by itself and every page
keeps working. DevTools crashes the renderer (Page.crash); the GPU process
is ended with SIGKILL, found by DevTools' SystemInfo.getProcessInfo.
"""

from __future__ import annotations

import os
import signal
import time
import unittest

from merlin_e2e import CdpError, MerlinTestCase


class CrashTest(MerlinTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.browser.write_config('[options]\nhint_chars = "sdfjkl"\n')

    def active(self) -> dict:
        snapshot = self.browser.snapshot()
        return next(t for t in snapshot["tabs"] if t["id"] == snapshot["activeTabId"])

    def fresh_session(self) -> str:
        """The active tab's DevTools session, attached again: a crash ends the old one."""
        self.browser.cdp.sessions.clear()
        return self.browser.active_session()

    def crash_renderer(self) -> None:
        try:
            self.browser.cdp.call("Page.crash", session=self.browser.active_session(), timeout=5)
        except (CdpError, OSError):
            pass  # the page never answers: it has gone
        self.wait(lambda: self.active()["crashed"], "the tab to show it crashed")

    def gpu_process(self):
        processes = self.browser.cdp.call("SystemInfo.getProcessInfo")["processInfo"]
        return next((p["id"] for p in processes if p["type"] == "GPU"), None)

    def assert_keys_and_hints_work(self) -> None:
        self.fresh_session()
        self.browser.open("/page")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() > 0, "j to scroll")
        self.browser.open("/hints")
        self.press("f")
        # Hints collect their labels from the page first, and a renderer
        # started after a crash answers more slowly than a warm one: a
        # person's 0.15 s gap (test_hints) failed here whenever the Mac was
        # busy, on 0.3.1 as on 0.3.2.
        time.sleep(1.0)
        self.press("s")
        self.wait(lambda: self.browser.active_tab()["url"].endswith("/one"), "the first hint to be followed")

    def test_a_crashed_tab_shows_it_and_reloads(self) -> None:
        self.browser.open("/page?crash=1")
        self.crash_renderer()
        self.assertEqual(self.active()["url"], self.server.url("/page?crash=1"), "the tab keeps its address")
        # Keys at a crashed tab do nothing harmful, and the browser keeps answering.
        self.assertTrue(self.browser.browserctl("ping")["ok"])
        self.server.clear()
        reply = self.browser.shell_call("navigation.reload", {"tabId": self.active()["id"]})
        self.assertTrue(reply.get("ok"), reply)
        self.wait(lambda: not self.active()["crashed"] and self.server.requested("/page?crash=1"), "the reload")
        self.fresh_session()
        self.wait(lambda: self.browser.eval("document.readyState") == "complete", "the page to load again")
        self.assert_keys_and_hints_work()

    def test_reload_command_after_a_crash(self) -> None:
        self.browser.open("/page?crash=2")
        self.crash_renderer()
        self.browser.command("reload")
        self.wait(lambda: not self.active()["crashed"], "the reload")
        self.assert_keys_and_hints_work()

    def test_other_tabs_survive_a_crash(self) -> None:
        self.browser.open("/page?survivor=1")
        self.browser.browserctl("open", url=self.server.url("/page?crash=3"), where="tab")
        self.wait(lambda: self.browser.active_tab()["url"].endswith("crash=3"), "the second tab")
        self.crash_renderer()
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.browser.active_tab()["url"].endswith("survivor=1"), "the first tab")
        self.assertFalse(self.active()["crashed"])
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() > 0, "j to scroll the survivor")

    def test_the_gpu_process_restarts(self) -> None:
        self.browser.open("/page")
        gpu = self.gpu_process()
        self.assertIsNotNone(gpu, "no GPU process")
        os.kill(gpu, signal.SIGKILL)
        self.wait(lambda: self.gpu_process() not in (None, gpu), "a new GPU process")
        self.assertTrue(self.browser.browserctl("ping")["ok"])
        self.assertFalse(self.active()["crashed"], "a GPU crash ends no page")
        self.assert_keys_and_hints_work()
        # The page draws again: a screenshot needs the new GPU process.
        shot = self.browser.cdp.call("Page.captureScreenshot", {"format": "png"}, self.browser.active_session())
        self.assertTrue(shot.get("data"))

if __name__ == "__main__":
    unittest.main()
