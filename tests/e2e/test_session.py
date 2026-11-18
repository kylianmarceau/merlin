"""Session restore: after quitting, and after Merlin ends as a crash does (kill -9).

Chromium restores the last session at launch after a clean quit. After a
crash it doesn't, so as not to crash again, and asks instead; in Merlin the
shell asks ("Restore your tabs?"), since Chromium's bubble needs a window
Merlin doesn't have.
"""

from __future__ import annotations

import time
import unittest

from merlin_e2e import MerlinTestCase


class SessionRestoreTest(MerlinTestCase):
    def open_tabs(self) -> list[str]:
        """Three tabs, the first pinned, and a private window that must not come back."""
        urls = [self.server.url(f"/page?session={n}", "restore.test") for n in range(3)]
        self.browser.open("/page?session=0", "restore.test")
        for url in urls[1:]:
            self.browser.browserctl("open", url=url, where="tab")
        self.wait(lambda: [t["url"] for t in self.browser.tabs()] == urls, "the three tabs")
        self.browser.browserctl("focus", tab=1)
        self.browser.command("pin")
        self.wait(lambda: self.browser.tabs()[0]["pinned"], "the pin")
        self.browser.open_private_window(self.server.url("/page?session=private", "restore.test"))
        self.wait(lambda: self.browser.private_pages(), "the private window")
        # Chromium writes the session a couple of seconds after a change.
        time.sleep(3)
        return urls

    def shown(self) -> list[str]:
        return [t["url"] for t in self.browser.tabs()]

    def assert_restored(self, urls: list[str]) -> None:
        self.wait(lambda: all(url in self.shown() for url in urls), "the tabs from before")
        pinned = [t["url"] for t in self.browser.tabs() if t["pinned"]]
        self.assertEqual(pinned, urls[:1])
        self.assertFalse([p for p in self.browser.cdp.pages() if "session=private" in p["url"]],
                         "a private tab came back")

    def test_quitting_restores_the_session(self) -> None:
        urls = self.open_tabs()
        self.browser.restart()
        self.assert_restored(urls)
        self.assertIsNone(self.browser.snapshot().get("prompt"), "a clean quit asks nothing")

    def test_after_a_crash_merlin_asks_and_restores(self) -> None:
        urls = self.open_tabs()
        self.browser.crash_and_restart()
        prompt = self.browser.prompt()
        self.assertEqual(prompt["title"], "Restore your tabs?")
        self.assertEqual([a["id"] for a in prompt["actions"]], ["dismiss", "restore"])
        # Nothing is restored until the person says so.
        self.assertFalse([u for u in urls if u in self.shown()])
        reply = self.browser.answer_prompt("restore")
        self.assertTrue(reply.get("ok"), reply)
        self.assert_restored(urls)
        self.assertIsNone(self.browser.snapshot().get("prompt"))

    def test_declining_after_a_crash_opens_nothing(self) -> None:
        urls = self.open_tabs()
        self.browser.crash_and_restart()
        reply = self.browser.answer_prompt("dismiss")
        self.assertTrue(reply.get("ok"), reply)
        time.sleep(1)
        self.assertFalse([u for u in urls if u in self.shown()])
        self.assertIsNone(self.browser.snapshot().get("prompt"))


if __name__ == "__main__":
    unittest.main()
