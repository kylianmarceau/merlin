"""Automatic picture in picture: a video with sound floats when its tab is left.

Opt in with MERLIN_E2E_PIP=1: the floating window is a real window on the
screen, above every other, for the length of the test.
"""

from __future__ import annotations

import os
import time
import unittest

from merlin_e2e import MerlinTestCase


@unittest.skipUnless(os.environ.get("MERLIN_E2E_PIP") == "1", "shows a floating window; set MERLIN_E2E_PIP=1")
class AutoPipTest(MerlinTestCase):
    extra_args = ["--autoplay-policy=no-user-gesture-required"]

    def floating(self, session: str) -> bool:
        return bool(self.browser.eval("!!document.pictureInPictureElement", session))

    def play(self) -> str:
        url = self.browser.open("/video")
        session = self.browser.active_session()
        self.browser.eval("start()", session)
        self.wait(lambda: self.browser.eval("!document.getElementById('v').paused", session), "the video to play")
        self.wait(lambda: self.browser.tabs()[0]["url"] == url, "the video tab")
        return session

    def test_video_floats_when_its_tab_is_left_and_returns(self) -> None:
        session = self.play()
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        self.wait(lambda: self.floating(session), "the video to float", timeout=5)
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: not self.floating(session), "the video to return to its page", timeout=5)

    def test_a_paused_video_stays_in_its_tab(self) -> None:
        session = self.play()
        self.browser.eval("document.getElementById('v').pause()", session)
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        time.sleep(1)
        self.assertFalse(self.floating(session), "only a playing video with sound floats")

if __name__ == "__main__":
    unittest.main()
