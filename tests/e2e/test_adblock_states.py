"""The ad blocker when it isn't simply on: off, without lists, with a list that
fails to load, before its rules are ready, and under a burst of requests (6.7).

These are the cases Chromium's browser tests (adblock_browsertest.cc) can't
reach without a `browser_tests` build. Each class starts Merlin with rules
of its own (`--merlin-test-adblock-rules`, test instances only) in place of
the bundled lists, optionally loading only after a delay
(`--merlin-test-adblock-rules-delay-ms`). The engine starts again, as at
launch, when the lists go from none to some; the tests use that to look at
the moments before the rules are ready without racing Merlin's own launch.

What the blocker promises meanwhile: a request waits up to two seconds for
the rules, and then goes ahead (it fails open), and the page always loads.
Its other fail-open, past 2,048 waiting requests, is out of a page's reach:
Chromium hands it requests only so many at a time.
"""

from __future__ import annotations

import shutil
import tempfile
import time
import unittest
from pathlib import Path

from merlin_e2e import Merlin, MerlinTestCase, PageServer

RULES = "||pagead2.googlesyndication.com^\n##.Billboard-ad\n"


class RulesCase(MerlinTestCase):
    rules = RULES
    delay_ms = 0

    @classmethod
    def setUpClass(cls) -> None:
        cls.rules_dir = Path(tempfile.mkdtemp(prefix="merlin-e2e-rules-"))
        path = cls.rules_dir / "rules.txt"
        path.write_text(cls.rules)
        cls.server = PageServer()
        args = [f"--merlin-test-adblock-rules={path}", f"--merlin-test-adblock-rules-delay-ms={cls.delay_ms}"]
        try:
            cls.browser = Merlin(cls.server, [*cls.extra_args, *args], cls.shell_api)
        except BaseException:
            cls.server.close()
            shutil.rmtree(cls.rules_dir, ignore_errors=True)
            raise
        cls.lists = cls.adblock()["groups"]

    @classmethod
    def tearDownClass(cls) -> None:
        super().tearDownClass()
        shutil.rmtree(cls.rules_dir, ignore_errors=True)

    @classmethod
    def adblock(cls) -> dict:
        reply = cls.browser.shell_call("settings.get")
        assert reply.get("ok"), reply
        return reply["result"]["adblock"]

    def status(self) -> str:
        return self.adblock()["status"]

    def wait_status(self, start: str, timeout: float = 15) -> str:
        return self.wait(lambda: (s := self.status()).startswith(start) and s, f"the blocker: {start}", timeout)

    def set(self, key: str, value) -> None:
        reply = self.browser.shell_call("settings.set", {"key": key, "value": value})
        self.assertTrue(reply.get("ok"), reply)

    def restart_engine(self) -> None:
        """No lists, then the lists again: the engine starts over, as at launch."""
        self.set("adblockLists", [])
        self.wait_status("Ad blocking disabled")
        self.set("adblockLists", self.lists)

    def ad_state(self) -> str:
        return self.wait(lambda: (s := self.browser.eval("document.getElementById('state').textContent")) != "waiting" and s,
                         "the ad script to finish", timeout=15)

    loads = 0

    def open_ads(self) -> None:
        """A fresh load of the ad page, at an address of its own, so no earlier load is read."""
        RulesCase.loads += 1
        url = self.server.url(f"/ads?load={RulesCase.loads}", "news.test")
        self.browser.browserctl("open", url=url, where="current")
        self.wait(lambda: self.browser.active_tab()["url"] == url, "the ad page")

    def protection(self) -> dict:
        self.assertTrue(self.browser.shell_call("site.info").get("ok"))
        prompt = self.browser.prompt()
        self.browser.answer_prompt("done")
        self.wait(lambda: not self.browser.snapshot().get("prompt"), "the site panel to close")
        return prompt


class SwitchedOffTest(RulesCase):
    def setUp(self) -> None:
        super().setUp()
        self.wait_status("Ad blocking ready")

    def tearDown(self) -> None:
        self.set("adblock", True)
        self.set("adblockLists", self.lists)

    def test_the_test_rules_block(self) -> None:
        self.open_ads()
        self.assertEqual(self.ad_state(), "blocked")
        self.assertFalse(self.server.requested("/pagead/"))

    def test_off_in_settings_lets_everything_through(self) -> None:
        self.set("adblock", False)
        self.wait_status("Ad blocking disabled")
        self.open_ads()
        self.assertEqual(self.ad_state(), "loaded")
        self.assertTrue(self.server.requested("/pagead/"))
        self.assertNotEqual(self.browser.eval("getComputedStyle(document.getElementById('banner')).display"), "none")
        self.assertEqual(self.protection()["protection"], "disabledGlobally")
        # On again, the same page is blocked again.
        self.set("adblock", True)
        self.wait_status("Ad blocking ready")
        self.server.clear()
        self.open_ads()
        self.assertEqual(self.ad_state(), "blocked")
        self.assertFalse(self.server.requested("/pagead/"))

    def test_no_lists_blocks_nothing_and_says_so(self) -> None:
        self.set("adblockLists", [])
        self.wait_status("Ad blocking disabled")
        self.open_ads()
        self.assertEqual(self.ad_state(), "loaded")
        prompt = self.protection()
        self.assertEqual(prompt["protection"], "disabledGlobally")
        self.assertIn("no filter lists", prompt["message"])


class BrokenListTest(RulesCase):
    """Rules that don't load: the blocker says so, and pages load unblocked."""

    rules = "! no valid rules\n"

    def test_a_list_that_fails_to_load(self) -> None:
        self.wait_status("Ad blocking degraded")
        self.open_ads()
        self.assertEqual(self.ad_state(), "loaded")
        self.assertTrue(self.server.requested("/pagead/"))
        prompt = self.protection()
        self.assertEqual(prompt["protection"], "degraded")
        self.assertIn("could not be loaded", prompt["message"])


class StartingTest(RulesCase):
    """Rules that take a second to load: requests made meanwhile wait for them."""

    delay_ms = 1000

    def setUp(self) -> None:
        super().setUp()
        self.wait_status("Ad blocking ready")

    def test_requests_before_the_rules_are_ready_wait_for_them(self) -> None:
        self.restart_engine()
        self.assertTrue(self.status().startswith("Ad blocking initializing"))
        self.open_ads()
        self.assertEqual(self.ad_state(), "blocked")
        self.assertFalse(self.server.requested("/pagead/"), "a request went ahead of the rules")

    def test_a_burst_while_the_rules_load_settles_and_stays_blocked(self) -> None:
        # Six thousand requests at once while the rules load: none hangs,
        # the page keeps working, and none reaches the network ahead of the
        # rules. (Chromium hands the blocker only so many at a time, so a
        # page never fills its 2,048-request queue; that limit, past which
        # requests go ahead unchecked, is not reached here.)
        self.restart_engine()
        self.browser.open("/flood?n=6000")
        self.wait(lambda: self.browser.eval("document.getElementById('done').textContent") == "6000",
                  "all 6,000 requests to settle", timeout=30)
        self.wait_status("Ad blocking ready")
        self.assertEqual(self.server.requests_to("/pagead/flood/"), [])
        self.assertEqual(self.browser.eval("1 + 1"), 2)


class SlowStartTest(RulesCase):
    """Rules that take five seconds: after two, requests go ahead and the panel says why."""

    delay_ms = 5000

    def setUp(self) -> None:
        super().setUp()
        self.wait_status("Ad blocking ready")

    def test_requests_go_ahead_after_two_seconds_then_rules_apply(self) -> None:
        self.restart_engine()
        started = time.monotonic()
        self.open_ads()
        self.assertEqual(self.ad_state(), "loaded")
        self.assertGreater(time.monotonic() - started, 1.5, "the request didn't wait for the rules")
        self.assertTrue(self.server.requested("/pagead/"))
        prompt = self.protection()
        self.assertEqual(prompt["protection"], "degraded")
        # The rules arrive late, and apply from then on.
        self.wait_status("Ad blocking ready")
        self.server.clear()
        self.open_ads()
        self.assertEqual(self.ad_state(), "blocked")
        self.assertFalse(self.server.requested("/pagead/"))


if __name__ == "__main__":
    unittest.main()
