"""Modes, scrolling and the rule that typing in a field is never a command.

Ported from the deleted ModalBrowserBrowserTest (5729e15): the same pages
and expectations, now through the shipped app and its React window.
"""

from __future__ import annotations

import time
import unittest

from merlin_e2e import MerlinTestCase, later


class KeysTest(MerlinTestCase):
    def field_value(self, element_id: str = "t") -> str:
        return self.browser.eval(f"document.getElementById({element_id!r}).value")

    def test_typing_in_a_text_field_is_not_hijacked(self) -> None:
        self.browser.focus("t")
        self.press("jd:G")
        self.wait(lambda: self.field_value() == "jd:G", "the field to hold what was typed")
        self.assertEqual(len(self.browser.tabs()), 1, "'d' closed no tab")
        self.assertEqual(self.browser.scroll_y(), 0, "'j' and 'G' didn't scroll")

    def test_rich_editor_is_not_hijacked(self) -> None:
        self.browser.focus("c")
        self.press("xd")
        self.wait(lambda: self.browser.page_log() == "x d ", "the page to see x and d")
        self.assertEqual(len(self.browser.tabs()), 1)

    def test_escape_leaves_the_field_then_j_scrolls(self) -> None:
        self.browser.focus("t")
        self.press("<Esc>")
        self.wait(lambda: self.browser.eval("document.activeElement === document.body"),
                  "the field to lose focus")
        self.assertEqual(self.browser.page_log(), "", "the Esc that leaves Insert is consumed")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() == 60, "j to scroll one step")
        self.assertEqual(self.browser.page_log(), "", "'j' is a command in Normal mode")

    def test_counts_and_sequences(self) -> None:
        self.press("5j")
        self.wait(lambda: self.browser.scroll_y() == 300, "5j to scroll five steps")
        self.press("G")
        self.wait(lambda: self.browser.scroll_y() > 1000, "G to reach the bottom")
        self.press("gg")
        self.wait(lambda: self.browser.scroll_y() == 0, "gg to reach the top")
        self.press("<C-d>")
        self.wait(lambda: self.browser.scroll_y() > 200, "Ctrl-D to scroll half a page")
        self.assertEqual(self.browser.page_log(), "")

    def test_unbound_keys_reach_the_page(self) -> None:
        self.press("z<Esc>")
        self.wait(lambda: self.browser.page_log() == "z Escape ", "z and Esc to reach the page")

    def test_insert_mode_sends_everything_to_the_page(self) -> None:
        self.press("i")
        self.press("jk")
        self.wait(lambda: self.browser.page_log() == "j k ", "j and k to reach the page")
        self.assertEqual(self.browser.scroll_y(), 0)
        self.press("<Esc>j")
        self.wait(lambda: self.browser.scroll_y() == 60, "Normal mode again after Esc")

    def test_passthrough_forwards_escape(self) -> None:
        self.press("<C-v>")
        self.press("j<Esc>")
        self.wait(lambda: self.browser.page_log() == "j Escape ", "j and Esc to reach the page")
        self.assertEqual(self.browser.scroll_y(), 0)
        self.press("<S-Esc>")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() == 60, "Shift-Esc to leave Passthrough")
        self.assertEqual(self.browser.page_log(), "j Escape ")

    def test_j_scrolls_an_inner_panel(self) -> None:
        self.browser.open("/inner")
        panel = "document.getElementById('panel').scrollTop"
        self.press("j")
        self.wait(lambda: self.browser.eval(panel) == 60, "j to scroll the panel")
        self.press("G")
        self.wait(lambda: self.browser.eval(panel) > 1000, "G to reach the panel's bottom")

    def test_history_keys(self) -> None:
        first = self.browser.active_tab()["url"]
        second = self.browser.open("/second")
        self.press("H")
        self.wait(lambda: self.browser.active_tab()["url"] == first, "H to go back")
        self.wait(lambda: self.browser.eval("document.readyState") == "complete", "the page to load")
        self.press("L")
        self.wait(lambda: self.browser.active_tab()["url"] == second, "L to go forward")

    def test_gu_goes_up_one_level(self) -> None:
        self.browser.open("/a/b/c?q=1")
        self.press("gu")
        self.wait(lambda: self.browser.active_tab()["url"] == self.server.url("/a/b/"),
                  "gu to open the parent")

    def test_brackets_jump_between_headings(self) -> None:
        self.browser.open("/doc")
        top = "Math.round(document.getElementById('usage').getBoundingClientRect().top)"
        self.press("]]")
        self.press("]]")
        self.wait(lambda: abs(self.browser.eval(top)) < 30, "]] ]] to bring Usage to the top")
        self.press("[[")
        self.wait(lambda: self.browser.scroll_y() < 1000, "[[ to go back up")

    def test_marks_return_to_a_position(self) -> None:
        self.press("5j")
        self.wait(lambda: self.browser.scroll_y() == 300, "5j")
        self.press("mb")
        self.press("G")
        self.wait(lambda: self.browser.scroll_y() > 1000, "G")
        self.press("'b")
        self.wait(lambda: self.browser.scroll_y() == 300, "'b to return to the mark")

    def test_a_late_mark_keeps_its_own_page(self) -> None:
        # M23: the page answers m after another tab became active; the mark
        # pairs this page's position with this page's address, not the
        # other tab's.
        page = self.browser.active_tab()["url"]
        self.press("5j")
        self.wait(lambda: self.browser.scroll_y() == 300, "5j")
        other = self.server.url("/page", "b.test")
        self.browser.browserctl("open", url=other, where="tab")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.browser.tabs()[0]["active"], "the first tab")
        self.browser.keep_page_busy(2.5)
        switch = later(0.5, lambda: self.browser.browserctl("focus", tab=2))
        self.press("mb")  # answered once the page is free again
        switch.join()
        self.wait(lambda: self.browser.tabs()[1]["active"], "the other tab")
        self.wait(lambda: "Mark b set" in self.browser.message(), "the late answer", timeout=15)
        self.browser.command("marks")
        marks = self.browser.message()
        self.assertIn(page, marks)
        self.assertNotIn("b.test", marks)
        # In the other tab the mark is on another page, so it doesn't scroll.
        self.press("'b")
        self.wait(lambda: "on another page" in self.browser.message(), "'b to refuse")
        self.assertEqual(self.browser.scroll_y(), 0)

    def test_macros_record_and_replay(self) -> None:
        self.press("qbjq")
        self.wait(lambda: self.browser.scroll_y() == 60, "j while recording")
        self.press("@b")
        self.wait(lambda: self.browser.scroll_y() == 120, "@b to replay j")
        self.press("2@b")
        self.wait(lambda: self.browser.scroll_y() == 240, "2@b to replay it twice")

    def test_escape_cancels_a_pending_sequence(self) -> None:
        # 'g' waits for a second key. Esc cancels it without reaching the
        # page, and the next key starts afresh.
        self.press("g")
        time.sleep(0.1)
        self.press("<Esc>j")
        self.wait(lambda: self.browser.scroll_y() == 60, "j to scroll after the cancelled g")
        self.assertEqual(self.browser.page_log(), "", "the cancelling Esc is consumed")


if __name__ == "__main__":
    unittest.main()
