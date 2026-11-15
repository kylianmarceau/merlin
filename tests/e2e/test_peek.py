"""Peek: a link in a floating card over the page, kept or dismissed."""

from __future__ import annotations

import time
import unittest

from merlin_e2e import MerlinTestCase, wait_until


class PeekTest(MerlinTestCase):
    def peek(self, url: str):
        """The peek's DevTools target: a page outside the tab strip."""
        return next((t for t in self.browser.cdp.targets() if t["type"] == "other" and t["url"] == url), None)

    def open_peek(self, url: str) -> str:
        self.browser.command(f"peek {url}")
        target = self.wait(lambda: self.peek(url), "the peek to load")
        session = self.browser.cdp.session_for(target["targetId"])
        wait_until(lambda: self.browser.eval("document.readyState", session) == "complete",
                   message="the peeked page to load")
        return session

    def test_peek_leaves_the_tab_where_it_is(self) -> None:
        doc = self.server.url("/doc")
        self.open_peek(doc)
        tabs = self.browser.tabs()
        self.assertEqual([t["url"] for t in tabs], [self.server.url("/page")], "no tab opens for a peek")

    def test_escape_in_the_peek_closes_it(self) -> None:
        doc = self.server.url("/doc")
        session = self.open_peek(doc)
        self.browser.press("<Esc>", session)
        self.wait(lambda: self.peek(doc) is None, "Esc to close the peek")
        self.assertEqual(len(self.browser.tabs()), 1)

    def test_command_return_keeps_the_page_as_a_tab(self) -> None:
        doc = self.server.url("/doc")
        session = self.open_peek(doc)
        self.browser.press("<D-CR>", session)
        self.wait(lambda: [t["url"] for t in self.browser.tabs()] == [self.server.url("/page"), doc],
                  "Cmd-Return to move the page into a tab after the current one")
        self.assertTrue(self.browser.tabs()[1]["active"], "the kept page is the active tab")
        self.assertIsNone(self.peek(doc), "the page is a tab now, not a peek")

    def test_gf_peeks_at_a_link(self) -> None:
        self.browser.write_config('[options]\nhint_chars = "sdfjkl"\n')
        self.browser.open("/hints")
        self.press("gf")
        time.sleep(0.15)  # as in test_hints: labels arrive asynchronously
        self.press("d")  # links only: "d" is "Two"
        two = self.server.url("/two")
        self.wait(lambda: self.peek(two), "gf to peek at /two")
        self.assertEqual(self.browser.active_tab()["url"], self.server.url("/hints"), "the tab stays on its page")

    def test_switching_tabs_closes_the_peek(self) -> None:
        doc = self.server.url("/doc")
        self.browser.browserctl("open", url=self.server.url("/hints"), where="background")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a background tab")
        self.open_peek(doc)
        self.browser.browserctl("focus", tab=2)
        self.wait(lambda: self.peek(doc) is None, "a tab switch to close the peek")


if __name__ == "__main__":
    unittest.main()
