"""Tabs, pins and splits, by key and by command."""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase


class TabsTest(MerlinTestCase):
    def visibility(self, url: str) -> str:
        page = next(p for p in self.browser.cdp.pages() if p["url"] == url)
        return self.browser.eval("document.visibilityState",
                                 self.browser.cdp.session_for(page["targetId"]))

    def test_t_opens_a_new_tab(self) -> None:
        self.press("t")
        self.wait(lambda: len(self.browser.tabs()) == 2, "t to open a tab")
        self.wait(lambda: self.browser.tabs()[1]["active"], "the new tab to be active")

    def test_d_closes_the_tab_and_u_reopens_it(self) -> None:
        page = self.server.url("/page")
        doc = self.server.url("/doc")
        self.browser.browserctl("open", url=doc, where="background")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        self.press("d")
        self.wait(lambda: [t["url"] for t in self.browser.tabs()] == [doc], "d to close /page")
        self.wait(lambda: self.browser.eval("document.readyState") == "complete", "doc to show")
        self.press("u")
        self.wait(lambda: page in [t["url"] for t in self.browser.tabs()], "u to reopen /page")

    def test_j_k_move_between_tabs(self) -> None:
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.browser.tabs()[0]["active"], "the first tab")
        self.press("J")
        self.wait(lambda: self.browser.tabs()[1]["active"], "J to select the next tab")
        self.wait(lambda: self.browser.eval("document.readyState") == "complete", "doc to load")
        self.press("K")
        self.wait(lambda: self.browser.tabs()[0]["active"], "K to select the previous tab")

    def test_gp_pins_and_unpins(self) -> None:
        self.press("gp")
        self.wait(lambda: self.browser.tabs()[0]["pinned"], "gp to pin the tab")
        self.press("gp")
        self.wait(lambda: not self.browser.tabs()[0]["pinned"], "gp again to unpin it")

    def test_vsplit_shows_two_pages(self) -> None:
        page = self.server.url("/page")
        doc = self.server.url("/doc")
        self.browser.command(f"vsplit {doc}")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the split's second tab")
        self.wait(lambda: self.visibility(doc) == "visible", "the new half to show")
        self.assertEqual(self.visibility(page), "visible", "both halves show at once")
        self.assertTrue(self.browser.tabs()[1]["active"], "the new half has focus")

        self.wait(lambda: self.browser.eval("document.readyState") == "complete", "doc to load")
        self.press("<C-w>w")
        self.wait(lambda: self.browser.tabs()[0]["active"], "Ctrl-W w to move to the other half")
        self.press("<C-w>o")
        self.wait(lambda: self.visibility(doc) == "hidden", "Ctrl-W o to end the split")
        self.assertEqual(len(self.browser.tabs()), 2, "ending a split keeps both tabs")

    def test_a_background_tab_is_hidden(self) -> None:
        doc = self.server.url("/doc")
        self.browser.browserctl("open", url=doc, where="background")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a background tab")
        self.wait(lambda: any(p["url"] == doc for p in self.browser.cdp.pages()), "doc to load")
        self.assertEqual(self.visibility(doc), "hidden")
        self.assertTrue(self.browser.tabs()[0]["active"])


if __name__ == "__main__":
    unittest.main()
