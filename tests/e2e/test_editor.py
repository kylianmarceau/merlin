"""Editing a field in an external editor (:edit, ge, Ctrl-Shift-E)."""

from __future__ import annotations

import json
import time
import unittest
from pathlib import Path

from merlin_e2e import MerlinTestCase


class EditorTest(MerlinTestCase):
    # Closing a window with several tabs asks first; a test closes one.
    extra_args = ["-MerlinShell.warnBeforeClosingWindow", "off"]

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

    def message(self) -> str:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]["modal"]["message"]

    def watch_field(self) -> None:
        # Every value the page sees, to catch a half-written save.
        self.browser.eval("window.seen = []; document.getElementById('comment')"
                          ".addEventListener('input', e => seen.push(e.target.value))")

    def test_a_slow_save_reaches_the_field_whole(self) -> None:
        # Written a piece at a time, faster than the file is checked, as a
        # large save over a slow disk would be.
        whole = " ".join(f"part{i}" for i in range(1, 13))
        self.use_editor(': > "$1"; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do '
                        'if [ $i -gt 1 ]; then printf " " >> "$1"; fi; printf "part$i" >> "$1"; '
                        'sleep 0.15; done; sleep 2')
        self.browser.open("/form")
        self.watch_field()
        self.browser.focus("comment")
        self.browser.command("edit")
        self.wait(lambda: self.comment() == whole, "the whole save in the field", timeout=15)
        self.assertEqual(set(self.browser.eval("window.seen")), {whole}, "part of a save reached the page")

    def test_an_editor_that_fails_at_once_stops_the_edit(self) -> None:
        where = self.browser.dir / "failed-path.txt"
        self.use_editor(f'printf "%s" "$1" > {where}; exit 1')
        self.browser.open("/form")
        self.browser.focus("comment")
        self.browser.command("edit")
        self.wait(lambda: "exited with an error" in self.message(), "the error", timeout=6)
        path = Path(where.read_text())
        self.assertIn(str(path), self.message(), "the message says where the text is")
        # No watch is left running: a later write to the file changes nothing.
        path.write_text("too late")
        time.sleep(1.5)
        self.assertEqual(self.comment(), "first draft")

    def test_closing_the_window_while_editing_keeps_the_file(self) -> None:
        where = self.browser.dir / "open-path.txt"
        # An editor that stays open, as Neovim would with the file loaded.
        self.use_editor(f'printf "%s" "$1" > {where}; sleep 30')
        windows = lambda: {t["window"] for t in self.browser.tabs()}
        form = self.server.url("/form", "editing.test")
        self.browser.browserctl("open", url=form, where="window")
        self.wait(lambda: len(windows()) == 2 and self.browser.active_tab()["url"] == form and
                  self.browser.eval("document.readyState") == "complete", "a second window on the form")
        self.browser.focus("comment")
        self.browser.command("edit")
        self.wait(lambda: where.exists() and where.read_text(), "the editor to open the file")
        path = Path(where.read_text())
        path.write_text("my unsaved essay")
        self.browser.command("browser close-window")
        self.wait(lambda: len(windows()) == 1, "the window to close")
        time.sleep(1.5)  # the editor's worker would delete it by now
        self.assertTrue(path.exists(), "the file the editor has open was deleted")
        self.assertEqual(path.read_text(), "my unsaved essay")
        # The window that stays says where it is.
        self.assertIn(str(path), self.message())
        path.unlink()
        path.parent.rmdir()


if __name__ == "__main__":
    unittest.main()
