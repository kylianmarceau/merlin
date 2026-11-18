"""The site panel's ad-blocking line: true to the blocker's state, and acting
on the page it describes.

The panel (`site.info`) is a window prompt; its text, `protection` value and
buttons come from merlin_adblock::Service::EffectiveProtection. Its answer
toggles the host it was opened for and reloads only that tab, only while it
still shows the same page, however the window has changed in between.
"""

from __future__ import annotations

import time

from merlin_e2e import MerlinTestCase


class SitePanelCase(MerlinTestCase):
    def snapshot(self) -> dict:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]

    def open_panel(self) -> dict:
        self.assertTrue(self.browser.shell_call("site.info").get("ok"))
        return self.wait(lambda: self.snapshot().get("prompt"), "the site panel")

    def answer(self, prompt: dict, action: str) -> None:
        time.sleep(0.6)  # prompts ignore answers for their first half second
        reply = self.browser.shell_call("permissions.answer", {"promptId": prompt["id"], "actionId": action})
        self.assertTrue(reply.get("ok"), reply)
        self.wait(lambda: not self.snapshot().get("prompt"), "the site panel to close")

    def actions(self, prompt: dict) -> list[str]:
        return [a["id"] for a in prompt["actions"]]

    def tearDown(self) -> None:
        # Whatever a test left behind: blocking on, and no site exceptions.
        self.browser.command("adblock on")
        for host in ("news.test", "asked.test", "other.test"):
            self.browser.shell_call("settings.set", {"key": "adblockException", "value": host})

    def loads(self, path: str, host: str) -> int:
        with self.server.lock:
            return sum(1 for h, p in self.server.requests if h == host and p == path)


class SitePanelTest(SitePanelCase):
    def test_blocking_on(self) -> None:
        self.browser.open("/page", host="news.test")
        prompt = self.open_panel()
        self.assertEqual(prompt["protection"], "enabled")
        self.assertIn("Ads and trackers are blocked", prompt["message"])
        self.assertIn("blocking", self.actions(prompt))
        self.answer(prompt, "done")

    def test_blocking_off_everywhere(self) -> None:
        self.browser.open("/page", host="news.test")
        self.browser.command("adblock off")
        prompt = self.open_panel()
        # Not "blocked", although this host has no exception.
        self.assertEqual(prompt["protection"], "disabledGlobally")
        self.assertNotIn("are blocked", prompt["message"])
        self.assertIn("off for every site", prompt["message"])
        # Nothing to toggle for the site; the way back is Settings.
        self.assertNotIn("blocking", self.actions(prompt))
        self.assertIn("adblock-settings", self.actions(prompt))
        self.answer(prompt, "done")

    def test_blocking_off_for_the_site(self) -> None:
        self.browser.open("/page", host="news.test")
        self.browser.command("adblock site toggle")
        prompt = self.open_panel()
        self.assertEqual(prompt["protection"], "siteException")
        self.assertIn("turned blocking off for this site", prompt["message"])
        blocking = next(a for a in prompt["actions"] if a["id"] == "blocking")
        self.assertEqual(blocking["label"], "Turn blocking on")
        self.answer(prompt, "blocking")
        # The answer turned it back on for this host.
        self.assertEqual(self.open_panel()["protection"], "enabled")
        self.answer(self.snapshot()["prompt"], "done")

    def test_answer_after_switching_tabs_acts_on_the_asked_tab(self) -> None:
        self.browser.open("/page", host="asked.test")
        prompt = self.open_panel()
        self.assertEqual(prompt["protection"], "enabled")
        # Another tab, on another site, is active when the answer comes.
        other = self.server.url("/doc", "other.test")
        self.browser.browserctl("open", url=other, where="tab")
        self.wait(lambda: self.browser.active_tab()["url"] == other and
                  self.browser.eval("document.readyState") == "complete", "the other tab")
        self.server.clear()
        self.answer(prompt, "blocking")
        # The asked tab, still on its page, reloads; the active one doesn't.
        self.wait(lambda: self.loads("/page", "asked.test") == 1, "the asked tab to reload")
        time.sleep(0.5)
        self.assertEqual(self.loads("/doc", "other.test"), 0, "the active tab reloaded")
        # The exception is for the host asked about, not the active one.
        self.assertEqual(self.open_panel()["protection"], "enabled")  # other.test
        self.answer(self.snapshot()["prompt"], "done")
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.browser.active_tab()["url"].startswith("http://asked.test"), "the asked tab")
        self.assertEqual(self.open_panel()["protection"], "siteException")
        self.answer(self.snapshot()["prompt"], "done")

    def test_answer_after_the_tab_moved_on_does_not_reload_it(self) -> None:
        self.browser.open("/page", host="asked.test")
        prompt = self.open_panel()
        # The same tab goes to another page before the answer.
        self.browser.open("/doc", host="asked.test")
        self.server.clear()
        self.answer(prompt, "blocking")
        time.sleep(1)
        self.assertEqual(self.loads("/doc", "asked.test"), 0, "a page the panel did not describe reloaded")
        # The answer still applies to the site it was asked about.
        self.assertEqual(self.open_panel()["protection"], "siteException")
        self.answer(self.snapshot()["prompt"], "done")


class SitePanelNotReadyTest(SitePanelCase):
    def tearDown(self) -> None:
        pass

    # Rules never load (a test-only switch), so the blocker stays initializing.
    extra_args = ["--merlin-test-adblock-hold"]

    def test_rules_still_loading(self) -> None:
        self.browser.open("/page", host="news.test")
        prompt = self.open_panel()
        self.assertEqual(prompt["protection"], "notReady")
        self.assertIn("still loading", prompt["message"])
        self.assertNotIn("are blocked", prompt["message"])
        self.answer(prompt, "done")

    def test_pages_still_load(self) -> None:
        # Fail open: requests that wait for rules are let through, not held.
        self.browser.open("/ads")
        self.wait(lambda: self.browser.eval("document.getElementById('state').textContent") == "loaded",
                  "the ad script to load unblocked")
