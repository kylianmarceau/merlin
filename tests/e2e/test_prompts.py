"""Site permission prompts and page dialogs, answered as the shell's buttons answer them.

Native code queues each question (merlin_shell_bridge_mac.mm) and the
snapshot carries the current one; the shell's buttons call
`permissions.answer` with its ID and one of its actions, and a typed answer
goes first through `prompts.update`. These tests make the same calls through
shell-call, then check what the page got, and that keys reach the page as
before: the field that had focus keeps it, and Normal-mode keys act again.

The permission asked for is window management (`getScreenDetails`): unlike
location, notifications or the camera, granting it asks macOS for nothing.
"""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase

ASK = """window.asked = 'pending';
getScreenDetails().then(() => { window.asked = 'granted'; }, e => { window.asked = e.name; });"""
STATE = "navigator.permissions.query({name: 'window-management'}).then(s => s.state)"


class PermissionPromptTest(MerlinTestCase):
    # A person's answer stays with the site (Browser.resetPermissions clears
    # only DevTools' overrides), so each question comes from a site of its
    # own: Chromium resolves *.localhost to this Mac and treats it as secure.
    asked_sites = 0

    def new_site(self) -> None:
        PermissionPromptTest.asked_sites += 1
        self.browser.open("/page", f"ask{PermissionPromptTest.asked_sites}.localhost")

    def setUp(self) -> None:
        super().setUp()
        self.new_site()

    def ask(self) -> dict:
        """The page asks, as after a click (the request needs no gesture, but sites make it from one)."""
        self.browser.cdp.call("Runtime.evaluate", {"expression": ASK, "userGesture": True},
                              self.browser.active_session())
        prompt = self.browser.prompt()
        self.assertEqual(prompt["kind"], "permission")
        self.assertEqual(prompt["origin"], self.browser.eval("location.origin"))
        return prompt

    def asked(self) -> str:
        return self.wait(lambda: (v := self.browser.eval("window.asked")) != "pending" and v, "the page's answer")

    def test_allow(self) -> None:
        self.ask()
        self.assertTrue(self.browser.answer_prompt("allow").get("ok"))
        self.assertEqual(self.asked(), "granted")
        self.assertEqual(self.browser.eval(STATE), "granted")
        self.assertIsNone(self.browser.snapshot()["prompt"])

    def test_block(self) -> None:
        self.ask()
        self.assertTrue(self.browser.answer_prompt("deny").get("ok"))
        self.assertEqual(self.asked(), "NotAllowedError")
        self.assertEqual(self.browser.eval(STATE), "denied")

    def test_not_now_leaves_the_question_open(self) -> None:
        prompt = self.ask()
        self.assertEqual([a["id"] for a in prompt["actions"]][:2], ["dismiss", "deny"])
        self.assertTrue(self.browser.answer_prompt("dismiss").get("ok"))
        self.assertEqual(self.asked(), "NotAllowedError")
        self.assertEqual(self.browser.eval(STATE), "prompt", "dismissing decides nothing")

    def test_refused_answers(self) -> None:
        prompt = self.ask()
        # Too soon: a click meant for the page can't answer it.
        early = self.browser.shell_call("permissions.answer", {"promptId": prompt["id"], "actionId": "allow"})
        self.assertIn("Wait a moment", early.get("error", ""), early)
        self.assertIn("Invalid prompt action", self.browser.answer_prompt("accept").get("error", ""))
        self.assertTrue(self.browser.answer_prompt("deny").get("ok"))
        stale = self.browser.shell_call("permissions.answer", {"promptId": prompt["id"], "actionId": "allow"})
        self.assertIn("no longer active", stale.get("error", ""), stale)
        self.assertEqual(self.browser.eval(STATE), "denied")

    def test_keys_reach_the_page_after_an_answer(self) -> None:
        # A field had focus: it keeps it, and typing goes on in it.
        self.browser.focus("t")
        self.ask()
        self.assertTrue(self.browser.answer_prompt("deny").get("ok"))
        self.press("jk")
        self.wait(lambda: self.browser.eval("document.getElementById('t').value") == "jk", "typing in the field")
        self.assertEqual(self.browser.eval("document.activeElement.id"), "t")
        self.assertEqual(self.browser.scroll_y(), 0)
        # Without one, Normal-mode keys act on the page again.
        self.new_site()
        self.ask()
        self.assertTrue(self.browser.answer_prompt("dismiss").get("ok"))
        self.press("j")
        self.wait(lambda: self.browser.scroll_y() > 0, "j to scroll")
        self.assertEqual(self.browser.snapshot()["modal"]["mode"], "Normal")


class PageDialogTest(MerlinTestCase):
    """alert, confirm and prompt: the page waits for the answer."""

    def start(self, expression: str) -> dict:
        # The dialog blocks the page's script, so start it after this call returns.
        self.browser.eval(f"window.result = 'pending'; setTimeout(() => {{ window.result = {expression}; }})")
        return self.browser.prompt()

    def result(self):
        return self.wait(lambda: (v := self.browser.eval("window.result")) != "pending" and [v], "the dialog's result")[0]

    def test_confirm(self) -> None:
        prompt = self.start("confirm('Delete it?')")
        self.assertEqual(prompt["kind"], "confirm")
        self.assertEqual(prompt["message"], "Delete it?")
        self.assertTrue(self.browser.answer_prompt("accept").get("ok"))
        self.assertIs(self.result(), True)
        self.start("confirm('Delete it?')")
        self.assertTrue(self.browser.answer_prompt("cancel").get("ok"))
        self.assertIs(self.result(), False)

    def test_prompt_takes_the_typed_answer(self) -> None:
        prompt = self.start("prompt('Name?', 'default')")
        self.assertEqual(prompt["input"]["defaultValue"], "default")
        self.assertTrue(self.browser.shell_call("prompts.update", {"promptId": prompt["id"], "text": "Merlin"}).get("ok"))
        self.assertTrue(self.browser.answer_prompt("accept").get("ok"))
        self.assertEqual(self.result(), "Merlin")

    def test_alert_and_keys_afterwards(self) -> None:
        self.browser.focus("t")
        self.start("alert('Saved') || 'closed'")
        self.assertTrue(self.browser.answer_prompt("accept").get("ok"))
        self.assertEqual(self.result(), "closed")
        self.press("jk")
        self.wait(lambda: self.browser.eval("document.getElementById('t').value") == "jk", "typing in the field")


if __name__ == "__main__":
    unittest.main()
