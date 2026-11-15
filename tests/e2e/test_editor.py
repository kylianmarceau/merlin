"""Editing a field in an external editor (:edit, ge, Ctrl-Shift-E)."""

from __future__ import annotations

import json
import time
import unittest

from merlin_e2e import MerlinTestCase


class EditorTest(MerlinTestCase):
    def use_editor(self, script: str) -> None:
        # The editor is a shell script that writes the file and exits, as
        # saving and quitting Neovim would.
        # A JSON string is also a valid TOML basic string.
        self.browser.write_config(
            f'[options]\neditor = ["/bin/sh", "-c", {json.dumps(script)}, "sh", "{{file}}"]\n')

    def comment(self) -> str:
        return self.browser.eval("document.getElementById('comment').value")

    def test_editor_writes_back(self) -> None:
        self.use_editor("printf 'edited in nvim' > \"$1\"")
        self.browser.open("/form")
        self.browser.focus("comment")
        self.browser.command("edit")
        self.wait(lambda: self.comment() == "edited in nvim", "the editor's text in the field")
        self.assertIn("input:insertReplacementText", self.browser.page_log(),
                      "the page sees an ordinary input event")

    def test_editor_gets_the_fields_text(self) -> None:
        copy = self.browser.dir / "seen.txt"
        self.use_editor(f'cp "$1" {copy}')
        self.browser.open("/form")
        self.browser.focus("comment")
        self.browser.command("edit")
        self.wait(lambda: copy.exists() and copy.read_text() == "first draft",
                  "the editor to receive the field's text")

    def test_password_fields_never_leave_the_browser(self) -> None:
        copy = self.browser.dir / "leaked.txt"
        self.use_editor(f'cp "$1" {copy}')
        self.browser.open("/form")
        self.browser.focus("pw")
        self.browser.command("edit!")
        time.sleep(1.5)
        self.assertFalse(copy.exists(), "a password field was written to a file")
        self.assertEqual(self.browser.eval("document.getElementById('pw').value"), "secret")


if __name__ == "__main__":
    unittest.main()
