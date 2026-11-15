"""Tab groups by command; the shell's menus call the same engine paths."""

from __future__ import annotations

import time
import unittest

from merlin_e2e import MerlinTestCase


class GroupsTest(MerlinTestCase):
    def groups(self) -> list[str]:
        return [t.get("group", "") for t in self.browser.tabs()]

    def test_group_names_a_new_group(self) -> None:
        self.browser.command("group Research")
        self.wait(lambda: self.groups() == ["Research"], ":group to put the tab in Research")

    def test_group_joins_a_group_by_name_ignoring_case(self) -> None:
        self.browser.command("group Research")
        self.wait(lambda: self.groups() == ["Research"], "the first group")
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        self.wait(lambda: len(self.browser.tabs()) == 2 and self.browser.tabs()[1]["active"], "a second, active tab")
        self.browser.command("group research")
        self.wait(lambda: self.groups() == ["Research", "Research"], "the second tab to join Research")

    def test_ungroup_takes_the_tab_out(self) -> None:
        self.browser.command("group Reading")
        self.wait(lambda: self.groups() == ["Reading"], "the group")
        self.browser.command("ungroup")
        self.wait(lambda: self.groups() == [""], ":ungroup to take the tab out")

    def test_pinned_tabs_are_not_grouped(self) -> None:
        self.press("gp")
        self.wait(lambda: self.browser.tabs()[0]["pinned"], "the tab to pin")
        self.browser.command("group Pinned")
        time.sleep(0.5)
        self.assertEqual(self.groups(), [""], "Chromium would pin the whole group instead")


if __name__ == "__main__":
    unittest.main()
