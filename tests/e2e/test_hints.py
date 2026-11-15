"""Link hints: following, opening in the background, fields and frames.

The labels themselves are drawn by the React shell, which these tests can't
read; they choose targets by label, whose order is fixed by the hint
characters and the fixture's document order. The tests use "sdfjkl", because
the A key can't be sent through DevTools: labels are s, d, f, j.
"""

from __future__ import annotations

import time
import unittest

from merlin_e2e import MerlinTestCase


class HintsTest(MerlinTestCase):
    def show_hints(self, keys: str) -> None:
        # Labels are collected from the page asynchronously; a label typed
        # within a couple of milliseconds of f arrives before them. The old
        # browser tests waited for the labels to show; these can't see them,
        # so they leave a person's shortest gap between keys.
        self.press(keys)
        time.sleep(0.15)

    def setUp(self) -> None:
        super().setUp()
        self.browser.write_config('[options]\nhint_chars = "sdfjkl"\n')
        self.browser.open("/hints")

    def test_hint_follows_a_link(self) -> None:
        self.show_hints("f")
        self.press("d")  # the second target, "Two"
        self.wait(lambda: self.browser.active_tab()["url"] == self.server.url("/two"),
                  "the hint to open /two")

    def test_escape_cancels_hints(self) -> None:
        self.show_hints("f")
        self.press("<Esc>")
        self.press("j")  # would focus the field if the hints were still up
        time.sleep(0.5)
        self.assertNotEqual(self.browser.eval("document.activeElement.id"), "field")
        self.assertEqual(self.browser.active_tab()["url"], self.server.url("/hints"))

    def test_hint_on_a_field_enters_insert(self) -> None:
        self.show_hints("f")
        self.press("j")  # the fourth target, the text field
        self.wait(lambda: self.browser.eval("document.activeElement.id") == "field",
                  "the field to have focus")
        self.press("jk")
        self.wait(lambda: self.browser.eval("document.getElementById('field').value") == "jk",
                  "typing to go into the field")

    def test_capital_f_opens_a_link_in_the_background(self) -> None:
        self.show_hints("F")
        self.press("d")  # links only, so "d" is "Two"
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        tabs = self.browser.tabs()
        self.assertEqual(tabs[0]["url"], self.server.url("/hints"))
        self.assertTrue(tabs[0]["active"], "the new tab opens in the background")
        self.wait(lambda: self.browser.tabs()[1]["url"] == self.server.url("/two"),
                  "the background tab to load /two")

    def test_gi_focuses_the_only_field(self) -> None:
        self.press("gi")
        self.wait(lambda: self.browser.eval("document.activeElement.id") == "field",
                  "gi to focus the field")
        self.press("x")
        self.wait(lambda: self.browser.eval("document.getElementById('field').value") == "x",
                  "Insert mode after gi")

    def test_hints_reach_into_frames(self) -> None:
        self.browser.open("/frames")
        # Targets: the main link, the same-origin frame's link, the cross-site
        # (out-of-process) frame's link: s, d, f.
        self.show_hints("f")
        self.show_hints("f")
        self.wait(lambda: self.server.requested("/two", "b.test"),
                  "the cross-site frame's link to be followed")


if __name__ == "__main__":
    unittest.main()
