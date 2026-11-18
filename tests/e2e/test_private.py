"""Private windows: no history, nothing in a workspace, and invisible to browserctl.

browserctl and the shell-call test path act on the front normal window, so
the private window is driven over DevTools, which sees its pages.
"""

from __future__ import annotations

import json
import time
import unittest

from merlin_e2e import MerlinTestCase


class PrivateWindowTest(MerlinTestCase):
    def tearDown(self) -> None:
        self.browser.close_private_windows()
        self.browser.browserctl("command", line="workspace delete kept")

    def history(self) -> list[str]:
        reply = self.browser.shell_call("history.search", {"text": ""})
        self.assertTrue(reply.get("ok"), reply)
        return [item["url"] for item in reply["result"]["items"]]

    def private_tab(self, path: str) -> tuple[str, str]:
        """A private window showing `path`, with its DevTools session and address."""
        url = self.server.url(path, "private.test")
        session = self.browser.open_private_window(url)
        self.wait(lambda: self.browser.eval("location.href", session) == url and
                  self.browser.eval("document.readyState", session) == "complete", "the private page")
        return session, url

    def test_pages_in_private_windows_stay_out_of_history(self) -> None:
        normal = self.browser.open("/page?visit=normal")
        _, private = self.private_tab("/page?visit=private")
        # History is written as pages load: the normal visit is there, so a
        # private one would have been too.
        self.wait(lambda: normal in self.history(), "the normal visit in history")
        time.sleep(1)
        self.assertNotIn(private, self.history())
        self.browser.close_private_windows()
        self.assertNotIn(private, self.history())

    def test_private_tabs_never_reach_a_workspace(self) -> None:
        self.browser.command("workspace save kept")
        path = self.browser.workspace_dir / "kept.json"
        self.wait(lambda: path.exists(), "the workspace file")
        session, private = self.private_tab("/page?visit=workspace")
        # A second tab in the private window, by its own keys.
        self.browser.press("t", session)
        self.wait(lambda: len(self.browser.private_pages()) == 2, "the second private tab")
        # Autosave waits 3 s after a change; give it longer.
        time.sleep(4)
        saved = path.read_text()
        self.assertNotIn("private.test", saved)
        self.assertEqual(len(json.loads(saved)["tabs"]), 1)
        # Nothing else in the folder names it either.
        for other in self.browser.workspace_dir.glob("*.json"):
            self.assertNotIn("private.test", other.read_text(), other.name)

    def test_browserctl_never_sees_private_windows(self) -> None:
        normal = self.browser.active_tab()["url"]
        self.browser.eval("""(() => {
            document.getElementById('log').textContent = 'normal words';
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('log'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
        })()""")
        session, private = self.private_tab("/page?visit=browserctl")
        self.browser.eval("""(() => {
            document.getElementById('log').textContent = 'private words';
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('log'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
        })()""", session)
        # The private window is in front, yet every request answers for the normal one.
        tabs = self.browser.tabs()
        self.assertNotIn(private, [t["url"] for t in tabs])
        self.assertEqual({t["window"] for t in tabs}, {1})
        self.assertEqual(self.browser.browserctl("current")["result"]["url"], normal)
        self.assertEqual(self.browser.browserctl("selection").get("result"), "normal words")
        self.assertNotIn("private", json.dumps(self.browser.shell_call("window.snapshot")["result"]["tabs"]))
        # A command runs in the normal window, not the private one.
        before = len(self.browser.private_pages())
        self.browser.command("tabnew")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the new normal tab")
        self.assertEqual(len(self.browser.private_pages()), before)


if __name__ == "__main__":
    unittest.main()
