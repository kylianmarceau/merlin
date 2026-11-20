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

    def test_command_w_closes_the_page_of_the_only_pin(self) -> None:
        def snapshot():
            reply = self.browser.shell_call("window.snapshot")
            self.assertTrue(reply.get("ok"), reply)
            return reply["result"]

        before = snapshot()
        tab = before["tabs"][0]
        self.press("gp")
        self.wait(lambda: snapshot()["tabs"][0]["pinned"], "the tab to pin")
        self.press("<D-w>")

        asleep = self.wait(lambda: (s := snapshot())["tabs"][0]["discarded"] and s,
                           "the pin's page to unload")
        self.assertEqual(asleep["windowId"], before["windowId"])
        self.assertEqual(len(asleep["tabs"]), 2)
        pin, replacement = asleep["tabs"]
        self.assertEqual((pin["id"], pin["url"], pin["pinned"]), (tab["id"], tab["url"], True))
        self.assertEqual(asleep["activeTabId"], replacement["id"])
        self.assertTrue(replacement["start"])

        reply = self.browser.shell_call("tabs.activate", {"tabId": tab["id"]})
        self.assertTrue(reply.get("ok"), reply)
        # The harness never gives the test app keyboard focus. Chromium loads
        # discarded contents when their tab is active in a focused window.
        self.wait(lambda: snapshot()["activeTabId"] == tab["id"], "the pin to be selectable again")
        self.assertEqual(snapshot()["tabs"][0]["url"], tab["url"])

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
