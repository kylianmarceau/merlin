"""The window's interface recovers when it fails (7.1, M34).

test.shell (shell-call only, never React) makes the interface fail on
purpose: while drawing, which the window's error boundary catches, or from a
timer, outside React, which React Native reports as fatal and the host
answers by reloading the shared bridge. Each window's root reports when it
has drawn from the browser's state ("ready") and when its boundary caught a
failure, and test.shell's state reads those counts back.
"""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase


class InterfaceRecoveryTest(MerlinTestCase):
    def ok(self, method: str, args: dict | None = None):
        reply = self.browser.shell_call(method, args)
        self.assertTrue(reply.get("ok"), f"{method}: {reply}")
        return reply.get("result")

    def state(self) -> dict:
        return self.ok("test.shell", {"action": "state"})

    def tabs(self) -> list[tuple]:
        return [(t["window"], t["id"], t["url"]) for t in self.browser.tabs()]

    def drawn(self) -> dict:
        """Ready counts by window, once every window has drawn at least once."""
        self.wait(lambda: all(w["ready"] for w in self.state()["windows"].values()), "every window to draw")
        return {id: w["ready"] for id, w in self.state()["windows"].items()}

    def front(self) -> str:
        return self.ok("window.snapshot")["windowId"]

    def test_a_failure_while_drawing_shows_the_boundary_and_reload_restores_the_window(self):
        self.browser.browserctl("open", url=self.server.url("/page?second"), where="tab")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        tabs = self.tabs()
        window = self.front()
        ready = self.drawn()[window]
        failures = self.state()["failures"]
        self.ok("test.shell", {"action": "throwInRender"})
        self.wait(lambda: self.state()["failures"] == failures + 1, "the error boundary to report the failure")
        self.assertIn("a failure while drawing", self.state()["lastError"])
        # What Reload Interface sends: a new root for this window alone.
        self.ok("shell.reloadWindow")
        self.wait(lambda: self.state()["ready"] > ready, "the new root to draw the window")
        self.assertEqual(self.tabs(), tabs)
        # The new root doesn't inherit the failure, and the window answers keys.
        self.assertEqual(self.state()["failures"], failures + 1)
        active = self.browser.active_tab()["url"]
        self.press("gt")
        self.wait(lambda: self.browser.active_tab()["url"] != active, "gt to switch tabs")

    def test_a_bridge_reload_brings_every_window_back_with_its_tabs(self):
        self.browser.browserctl("open", url=self.server.url("/page?other-window"), where="window")
        self.wait(lambda: len({t["window"] for t in self.browser.tabs()}) == 2, "a second window")
        tabs = self.tabs()
        ready = self.drawn()
        self.ok("test.shell", {"action": "reloadBridge"})
        self.wait(lambda: all(self.state()["windows"][id]["ready"] > count for id, count in ready.items()),
                  "every window to draw again after the reload", timeout=30)
        self.assertEqual(self.tabs(), tabs)
        self.browser.command("browser close-window")
        self.wait(lambda: len({t["window"] for t in self.browser.tabs()}) == 1, "the second window to close")

    def test_a_failure_outside_react_reloads_the_bridge_instead_of_ending_merlin(self):
        tabs = self.tabs()
        ready = self.drawn()
        # Without the host's fatal handler, React Native's release build
        # raises an exception here, and the browser quits.
        self.ok("test.shell", {"action": "throwInTimer"})
        self.wait(lambda: all(self.state()["windows"][id]["ready"] > count for id, count in ready.items()),
                  "the interface to come back after the bridge reloads", timeout=30)
        self.assertEqual(self.tabs(), tabs)
        self.assertTrue(self.browser.browserctl("ping").get("ok"))


if __name__ == "__main__":
    unittest.main()
