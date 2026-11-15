"""config.toml: bindings, unmapped keys, options, aliases and per-site passthrough."""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase


class ConfigTest(MerlinTestCase):
    def test_config_binds_and_unbinds(self) -> None:
        self.browser.write_config("""
[options]
scroll_step = 100
[keys.normal]
x = "tabnew"
[unmap]
normal = ["t"]
""")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() == 100, "scroll_step to apply")
        self.press("t")
        self.wait(lambda: self.browser.page_log() == "t ", "an unmapped key to reach the page")
        self.assertEqual(len(self.browser.tabs()), 1)
        self.press("x")
        self.wait(lambda: len(self.browser.tabs()) == 2, "x to open a tab")

    def test_a_bad_line_keeps_the_rest_of_the_file(self) -> None:
        self.browser.write_config("""
[options]
scroll_step = 1
[keys.normal]
x = "tabnew"
""")
        # scroll_step = 1 is out of range and reported; the binding still loads.
        self.press("x")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the binding after the bad line")

    def test_aliases_are_commands(self) -> None:
        self.browser.write_config(f"""
[aliases]
docs = "open {self.server.url('/doc')}"
""")
        self.browser.command("docs")
        self.wait(lambda: self.browser.active_tab()["url"] == self.server.url("/doc"),
                  "the alias to open /doc")

    def test_passthrough_sites(self) -> None:
        self.browser.write_config('[options]\npassthrough_sites = ["passthrough.test"]\n')
        self.browser.open("/page", host="passthrough.test")
        self.press("j")
        self.wait(lambda: self.browser.page_log() == "j ", "j to reach the page")
        self.assertEqual(self.browser.scroll_y(), 0)
        # Other sites keep the modal keys.
        self.browser.open("/page")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() == 60, "j to scroll elsewhere")

    def test_disabling_modal_browsing_gives_every_key_to_the_page(self) -> None:
        self.browser.write_config("[options]\nmodal_browsing = false\n")
        self.press("jd")
        self.wait(lambda: self.browser.page_log() == "j d ", "j and d to reach the page")
        self.assertEqual(self.browser.scroll_y(), 0)
        self.assertEqual(len(self.browser.tabs()), 1)


if __name__ == "__main__":
    unittest.main()
