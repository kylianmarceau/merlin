"""Input methods, dead keys and focus moving between the page, a field and the palette (6.8).

The policy is in core/src/session.rs: keys an input method is composing
with, and keys Merlin can't name ("Dead", "Process"), always reach the page.
A real input method can't be switched on for a test without changing the
Mac's input sources, so the tests send what one sends: DevTools'
Input.imeSetComposition and Input.insertText for the marked and committed
text, and the key presses an IME takes for itself, which reach the page as
"Process" (Windows key code 229), with the native key code of the key that
was pressed, so they take the same path through Merlin as typed keys do.
"""

from __future__ import annotations

import unittest

from merlin_e2e import ALT, MerlinTestCase

# macOS key codes for the keys these tests press.
MAC = {"j": 0x26, "k": 0x28, "n": 0x2D, "e": 0x0E, "Escape": 0x35}


class InputMethodTest(MerlinTestCase):
    def send(self, event: dict) -> None:
        self.browser.cdp.call("Input.dispatchKeyEvent", event, self.browser.active_session())

    def ime_key(self, key: str) -> None:
        """A key the input method takes: the page sees keydown "Process", then keyup."""
        code = "Escape" if key == "Escape" else f"Key{key.upper()}"
        for kind in ("rawKeyDown", "keyUp"):
            self.send({"type": kind, "key": "Process" if kind == "rawKeyDown" else key, "code": code,
                       "windowsVirtualKeyCode": 229, "nativeVirtualKeyCode": MAC[key]})

    def compose(self, text: str) -> None:
        self.browser.cdp.call("Input.imeSetComposition", {"text": text, "selectionStart": len(text),
                                                          "selectionEnd": len(text)}, self.browser.active_session())

    def commit(self, text: str) -> None:
        self.browser.cdp.call("Input.insertText", {"text": text}, self.browser.active_session())

    def field(self) -> str:
        return self.browser.eval("document.getElementById('t').value")

    def mode(self) -> str:
        return self.browser.snapshot()["modal"]["mode"]

    def test_composing_in_a_field_never_runs_commands(self) -> None:
        self.browser.focus("t")
        self.press("x")  # the first key in a field enters Insert
        self.wait(lambda: self.mode() == "Insert", "Insert mode")
        for key, marked in (("n", "n"), ("j", "に"), ("k", "にk")):
            self.ime_key(key)
            self.compose(marked)
        # Esc while composing is the input method's: it cancels the marked
        # text, and the field keeps focus and Insert mode.
        self.ime_key("Escape")
        self.assertEqual(self.browser.eval("document.activeElement.id"), "t")
        self.assertEqual(self.mode(), "Insert")
        self.ime_key("j")
        self.compose("に")
        self.commit("日本")
        self.wait(lambda: self.field() == "x日本", "the committed text")
        self.assertEqual(self.browser.scroll_y(), 0)
        self.assertIn("Process", self.browser.page_log(), "the page saw the input method's keys")
        # A real Esc, with nothing composing, leaves the field.
        self.press("<Esc>")
        self.wait(lambda: self.mode() == "Normal", "Normal mode")
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() > 0, "j to scroll again")

    def test_process_keys_in_normal_mode_reach_the_page(self) -> None:
        for key in ("j", "k", "j"):
            self.ime_key(key)
        self.assertEqual(self.browser.scroll_y(), 0)
        self.assertEqual(self.browser.page_log().split(), ["Process"] * 3)
        self.assertEqual(self.browser.snapshot()["modal"]["pending"], "")

    def dead_e(self, then: str = "é") -> None:
        """Option-E then E on a US keyboard: a dead key, then the accented letter."""
        base = {"code": "KeyE", "windowsVirtualKeyCode": 0x45, "nativeVirtualKeyCode": MAC["e"]}
        self.send(dict(base, type="rawKeyDown", key="Dead", modifiers=ALT))
        self.send(dict(base, type="keyUp", key="Dead", modifiers=ALT))
        self.send(dict(base, type="rawKeyDown", key=then))
        self.send(dict(base, type="char", key=then, text=then, unmodifiedText=then))
        self.send(dict(base, type="keyUp", key=then))

    def test_dead_keys_reach_the_page(self) -> None:
        self.dead_e()
        self.assertEqual(self.browser.page_log().split(), ["Dead", "é"])
        self.assertEqual(self.browser.scroll_y(), 0)
        self.assertEqual(self.mode(), "Normal")
        self.assertEqual(self.browser.snapshot()["modal"]["pending"], "")
        # In a field the accented letter is typed.
        self.browser.focus("t")
        self.dead_e()
        self.wait(lambda: self.field() == "é", "é in the field")

    def test_a_dead_key_mid_sequence_reaches_the_page(self) -> None:
        # g waits for a second key; a dead key isn't one Merlin can name.
        self.press("g")
        self.dead_e()
        self.assertIn("Dead", self.browser.page_log())
        self.assertEqual(self.browser.scroll_y(), 0)


class FocusTest(MerlinTestCase):
    def mode(self) -> str:
        return self.browser.snapshot()["modal"]["mode"]

    def palette_open(self) -> bool:
        return bool((self.browser.snapshot()["modal"].get("palette") or {}).get("visible"))

    def test_page_to_palette_and_back(self) -> None:
        self.press(":")
        self.wait(self.palette_open, "the palette")
        self.assertEqual(self.mode(), "Command")
        # A key at the page means the person clicked back into it: the
        # palette closes and the key acts in Normal mode.
        self.press("j")
        self.wait(lambda: not self.palette_open(), "the palette to close")
        self.wait(lambda: self.browser.scroll_y() > 0, "j to scroll")
        self.assertEqual(self.mode(), "Normal")

    def test_page_to_field_and_back(self) -> None:
        self.browser.focus("t")
        self.press("jk")
        self.wait(lambda: self.browser.eval("document.getElementById('t').value") == "jk", "typing")
        self.assertEqual(self.mode(), "Insert")
        self.press("<Esc>")
        self.wait(lambda: self.mode() == "Normal", "Normal mode")
        self.assertNotEqual(self.browser.eval("document.activeElement.id"), "t")
        # A field focused by the page itself, after a click on it, is typed in.
        self.browser.eval("document.getElementById('c').focus()")
        self.press("j")
        self.wait(lambda: "j" in self.browser.eval("document.getElementById('c').textContent"), "typing in the editor")
        self.assertEqual(self.browser.scroll_y(), 0)

    def test_the_palette_takes_no_page_keys_while_a_field_has_focus(self) -> None:
        # Typing ':' in a field types it; it never opens the palette.
        self.browser.focus("t")
        self.press(":")
        self.wait(lambda: self.browser.eval("document.getElementById('t').value") == ":", "the colon typed")
        self.assertFalse(self.palette_open())


if __name__ == "__main__":
    unittest.main()
