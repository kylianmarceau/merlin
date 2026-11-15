"""The native ad blocker in the shipped app: network, cosmetic and per-site.

The fixture asks for Google's ad script from pagead2.googlesyndication.com,
which the harness resolves to the local server, so the request is observable
without the network.
"""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase


class AdblockTest(MerlinTestCase):
    def state(self) -> str:
        return self.browser.eval("document.getElementById('state').textContent")

    def display(self, element_id: str) -> str:
        return self.browser.eval(f"getComputedStyle(document.getElementById({element_id!r})).display")

    def test_ad_requests_are_blocked(self) -> None:
        self.browser.open("/ads")
        self.wait(lambda: self.state() != "waiting", "the ad script to finish")
        self.assertEqual(self.state(), "blocked")
        self.assertFalse(self.server.requested("/pagead/"), "the ad request reached the network")

    def test_ad_elements_are_hidden(self) -> None:
        # Not on localhost: EasyList turns generic hiding off there
        # (@@://localhost:$generichide).
        self.browser.open("/ads", host="news.test")
        # EasyList's generic ##.Billboard-ad, which no bundled list exempts
        # (uBlock's lists do exempt some generic ones, such as .ad_unit).
        self.wait(lambda: self.display("banner") == "none", "the cosmetic filter to hide .Billboard-ad")
        self.assertNotEqual(self.display("article"), "none", "ordinary content stays")

    def test_turning_it_off_for_a_site(self) -> None:
        self.browser.open("/ads")
        self.wait(lambda: self.state() == "blocked", "blocking first")
        try:
            self.browser.command("adblock site toggle")
            self.server.clear()
            self.browser.command("reload")
            self.wait(lambda: self.browser.eval("document.readyState") == "complete" and
                      self.state() == "loaded", "the ad script to load with protection off")
            self.assertTrue(self.server.requested("/pagead/"))
        finally:
            self.browser.command("adblock site toggle")


if __name__ == "__main__":
    unittest.main()
