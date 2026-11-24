"""Automatic Picture in Picture follows the visibility of a playing video.

Chromium's tabs (merlin_auto_pip.cc) and WebKit's (WebKitPages.swift), where
Netflix and other protected video play. Opt in with MERLIN_E2E_PIP=1: the
floating window is a real window on the screen, above every other, for the
length of the test.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest
import urllib.parse
from pathlib import Path
from typing import Optional

from merlin_e2e import Merlin, MerlinTestCase, PageServer, wait_until


def drive_picture_in_picture(browser: Merlin, action: str) -> None:
    request = browser.dir / "pip-sight"
    request.write_text(action)
    wait_until(lambda: not request.exists(), message=f"the native PiP fixture action {action}")


@unittest.skipUnless(os.environ.get("MERLIN_E2E_PIP") == "1", "shows a floating window; set MERLIN_E2E_PIP=1")
class AutoPipTest(MerlinTestCase):
    extra_args = ["--autoplay-policy=no-user-gesture-required"]

    def floating(self, session: str) -> bool:
        return bool(self.browser.eval("!!document.pictureInPictureElement", session))

    def play(self) -> str:
        url = self.browser.open("/video")
        session = self.browser.active_session()
        self.browser.eval("start()", session)
        self.wait(lambda: self.browser.eval("document.getElementById('v').currentTime > 0.15", session),
                  "the video and audio to start playing")
        self.wait(lambda: self.browser.tabs()[0]["url"] == url, "the video tab")
        return session

    def test_video_floats_when_its_tab_is_left_and_returns(self) -> None:
        session = self.play()
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        self.wait(lambda: self.floating(session), "the video to float", timeout=5)
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: not self.floating(session), "the video to return to its page", timeout=5)

    def test_video_follows_window_visibility(self) -> None:
        session = self.play()
        try:
            drive_picture_in_picture(self.browser, "hide")
            self.wait(lambda: self.floating(session), "the video to float", timeout=5)
        finally:
            drive_picture_in_picture(self.browser, "show")
        self.wait(lambda: not self.floating(session), "the video to return to its page", timeout=5)

    def test_both_split_panes_remain_visible(self) -> None:
        session = self.play()
        self.browser.command(f"vsplit {self.server.url('/doc')}")
        self.wait(lambda: len(self.browser.tabs()) == 2, "both split panes")
        time.sleep(0.4)
        self.assertFalse(self.floating(session))
        self.browser.command("only")
        self.wait(lambda: self.floating(session), "the video to float once its pane closes", timeout=5)
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: not self.floating(session), "the video to return to its page", timeout=5)

    def test_manual_pip_survives_switching_back(self) -> None:
        session = self.play()
        result = self.browser.cdp.call("Runtime.evaluate", {
            "expression": "document.getElementById('v').requestPictureInPicture()",
            "awaitPromise": True,
            "userGesture": True,
        }, session)
        self.assertNotIn("exceptionDetails", result)
        self.wait(lambda: self.floating(session), "the manually opened player")
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        time.sleep(0.4)
        self.browser.browserctl("focus", tab=1)
        time.sleep(0.4)
        self.assertTrue(self.floating(session))
        self.browser.eval("document.exitPictureInPicture()", session)

    def test_a_paused_video_stays_in_its_tab(self) -> None:
        session = self.play()
        self.browser.eval("document.getElementById('v').pause()", session)
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")
        time.sleep(1)
        self.assertFalse(self.floating(session), "only a playing video with sound floats")


def video_with_sound() -> bytes:
    """A two-second MP4 with a picture and a tone, from video_fixture.m."""
    with tempfile.TemporaryDirectory(prefix="merlin-e2e-video-") as folder:
        tool, movie = Path(folder) / "video_fixture", Path(folder) / "av.mp4"
        subprocess.run(["xcrun", "clang", "-fobjc-arc", "-O1", "-framework", "AVFoundation", "-framework", "CoreMedia",
                        "-framework", "CoreVideo", "-framework", "Foundation", "-o", str(tool),
                        str(Path(__file__).with_name("video_fixture.m"))], check=True, capture_output=True)
        subprocess.run([str(tool), str(movie)], check=True, capture_output=True)
        return movie.read_bytes()


# A looping video reports its state to the server. The native test shim
# starts playback with a user activation in WebKit. ?muted mutes it. ?player-controls simulates a
# custom player that opts out of the page's Picture in Picture controls.
WEBKIT_VIDEO_HTML = """<!doctype html>
<title>video</title>
<video id="v" src="/av.mp4" loop playsinline width="320" height="180"></video>
<script>
  const v = document.getElementById('v');
  v.muted = location.search.includes('muted');
  if (location.search.includes('player-controls')) v.setAttribute('disablepictureinpicture', '');
  const report = what => fetch('/report?' + what);
  v.addEventListener('playing', () => report('playing'));
  v.addEventListener('webkitpresentationmodechanged', () => report('mode=' + v.webkitPresentationMode));
</script>"""


class WebKitVideoCase(MerlinTestCase):
    """A Merlin that shows wk.localhost in WebKit, with a video page there."""

    host = "wk.localhost"

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = PageServer()
        movie = video_with_sound()
        respond = cls.server.respond

        def serve(host: str, path: str):
            if path == "/av.mp4":
                return 200, "video/mp4", movie, {"Accept-Ranges": "bytes"}
            if path.startswith("/wkvideo"):
                return 200, "text/html; charset=utf-8", WEBKIT_VIDEO_HTML.encode(), {}
            if path.startswith("/report"):
                return 204, "text/plain", b"", {}
            return respond(host, path)

        cls.server.respond = serve
        engines = {f"http://{cls.host}:{cls.server.port}": "webkit"}
        args = ["-MerlinShell.siteEngines", json.dumps(json.dumps(engines))]
        try:
            cls.browser = Merlin(cls.server, args, cls.shell_api, preferences=cls.preferences)
        except BaseException:
            cls.server.close()
            raise

    def reports(self) -> list[str]:
        return [urllib.parse.unquote(r.path.split("?", 1)[1]) for r in self.server.webkit_requests("/report", self.host)]

    def mode(self) -> Optional[str]:
        """The video's latest presentation mode, or None if it never changed."""
        modes = [r[len("mode="):] for r in self.reports() if r.startswith("mode=")]
        return modes[-1] if modes else None

    def play(self, query: str = "") -> None:
        self.browser.browserctl("open", url=self.server.url("/wkvideo" + query, self.host), where="current")
        self.wait(lambda: self.server.webkit_requests("/wkvideo", self.host), "the video page in WebKit")
        drive_picture_in_picture(self.browser, "play")
        self.wait(lambda: "playing" in self.reports(), "the WebKit video to play", timeout=15)

    def leave(self) -> None:
        self.browser.browserctl("open", url=self.server.url("/doc"), where="tab")


@unittest.skipUnless(os.environ.get("MERLIN_E2E_PIP") == "1", "shows a floating window; set MERLIN_E2E_PIP=1")
class WebKitAutoPipTest(WebKitVideoCase):
    """A WebKit tab's video (Netflix's, say) floats as a Chromium tab's does."""

    def test_video_floats_when_its_tab_is_left_and_returns(self) -> None:
        self.play()
        self.leave()
        self.wait(lambda: self.mode() == "picture-in-picture", "the WebKit video to float", timeout=5)
        # At once, while it may still be moving into the floating window.
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.mode() == "inline", "the WebKit video to return to its page", timeout=5)

    def test_parked_video_keeps_its_screen_position(self) -> None:
        self.play()
        drive_picture_in_picture(self.browser, "geometry")
        result = self.browser.dir / "pip-sight.result"
        original = result.read_text()
        self.leave()
        self.wait(lambda: self.mode() == "picture-in-picture", "the WebKit video to float", timeout=5)
        drive_picture_in_picture(self.browser, "geometry")
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.mode() == "inline", "the WebKit video to return to its page", timeout=5)
        self.assertEqual(result.read_text(), original, "the parked player keeps its on-screen source rect")

    def test_adding_a_split_keeps_the_video_inline(self) -> None:
        self.play()
        self.browser.command(f"vsplit {self.server.url('/doc')}")
        self.wait(lambda: self.browser.snapshot().get("split"), "the second split pane")
        time.sleep(0.5)
        self.assertIsNone(self.mode(), "moving a video into a visible split pane should keep it inline")

    def tearDown(self) -> None:
        # Return to the Chromium tab before reset drives the next test through
        # DevTools. Navigating a WebKit tab from browserctl takes a different path.
        if len(self.browser.tabs()) > 1:
            self.browser.browserctl("focus", tab=2)

    def test_video_follows_window_visibility(self) -> None:
        self.play()
        try:
            drive_picture_in_picture(self.browser, "hide")
            self.wait(lambda: self.mode() == "picture-in-picture", "the WebKit video to float", timeout=5)
        finally:
            drive_picture_in_picture(self.browser, "show")
        self.wait(lambda: self.mode() == "inline", "the WebKit video to return to its page", timeout=5)

    def test_a_muted_video_stays_in_its_tab(self) -> None:
        self.play("?muted")
        self.leave()
        time.sleep(1.5)
        self.assertIsNone(self.mode(), "only a video playing with sound floats")


@unittest.skipUnless(os.environ.get("MERLIN_E2E_PIP") == "1", "shows a floating window; set MERLIN_E2E_PIP=1")
class WebKitCustomPlayerAutoPipTest(WebKitVideoCase):
    def test_video_with_picture_in_picture_hint_can_float_and_return(self) -> None:
        self.play("?player-controls")
        self.leave()
        self.wait(lambda: self.mode() == "picture-in-picture", "the WebKit video to float", timeout=5)
        self.browser.browserctl("focus", tab=1)
        self.wait(lambda: self.mode() == "inline", "the WebKit video to return to its page", timeout=5)


@unittest.skipUnless(os.environ.get("MERLIN_E2E_PIP") == "1", "shows a floating window; set MERLIN_E2E_PIP=1")
class WebKitAutoPipOffTest(WebKitVideoCase):
    """Settings › General › Automatic Picture in Picture, off, reaches WebKit's pages."""

    preferences = {"merlin": {"auto_pip": False}}

    def test_video_stays_in_its_tab(self) -> None:
        self.play()
        self.leave()
        time.sleep(1.5)
        self.assertIsNone(self.mode(), "the setting is off")


if __name__ == "__main__":
    unittest.main()
