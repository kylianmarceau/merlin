"""The React shell's own API, driven through browserctl shell-call.

Everything else in these tests reaches Merlin through browserctl's modal
command path. The shell's buttons and panels call the bridge instead
(EngineClient -> merlin_shell_bridge_mac.mm -> services), which is how a
broken download action shipped untested. shell_call goes through that same
dispatcher, for the front window.
"""

from __future__ import annotations

import threading
import unittest

from merlin_e2e import MerlinTestCase


class ShellApiTest(MerlinTestCase):
    def ok(self, method: str, args: dict | None = None):
        reply = self.browser.shell_call(method, args)
        self.assertTrue(reply.get("ok"), f"{method}: {reply}")
        return reply.get("result")

    def error(self, method: str, args: dict | None = None) -> str:
        reply = self.browser.shell_call(method, args)
        self.assertFalse(reply.get("ok"), f"{method} should have failed: {reply}")
        return reply["error"]

    def test_calls_reach_the_shells_dispatcher(self):
        snapshot = self.ok("window.snapshot")
        tabs = self.browser.tabs()
        self.assertEqual([(t["id"], t["url"]) for t in snapshot["tabs"]],
                         [(str(t["id"]), t["url"]) for t in tabs])
        # A call that changes the window, as the shell's Pin menu item does.
        self.ok("tabs.pin", {"tabId": snapshot["tabs"][0]["id"], "pinned": True})
        self.wait(lambda: self.browser.tabs()[0]["pinned"], "the tab to be pinned")

    def test_engine_errors_come_back(self):
        tab = self.ok("window.snapshot")["tabs"][0]["id"]
        self.assertEqual(self.error("tabs.activate", {"tabId": "999999"}),
                         "Tab has closed or belongs to another window")
        self.assertEqual(self.error("tabs.frobnicate", {"tabId": tab}), "Unsupported engine method")
        self.assertEqual(self.error("downloads.act", {"downloadId": "1", "action": "explode"}),
                         "Invalid download action")

    def test_workspace_colour_survives_a_restart(self):
        original = self.ok("window.snapshot")["appearance"]
        try:
            appearance = {**original, "mode": "dark", "accent": "graphite"}
            self.ok("appearance.set", appearance)
            self.assertEqual(self.ok("window.snapshot")["appearance"], appearance)
            self.browser.restart()
            self.assertEqual(self.ok("window.snapshot")["appearance"], appearance)
        finally:
            self.ok("appearance.set", original)

    def test_requests_answer_with_their_reply(self):
        # Requests answer with a "reply" event after the call returns;
        # shell_call waits for it, as EngineClient.request does.
        folder = self.ok("bookmarks.folder")["folderId"]
        self.ok("bookmarks.createFolder", {"parentId": folder, "title": "Shell API folder"})
        exported = self.browser.dir / "bookmarks.html"
        self.ok("bookmarks.export", {"path": str(exported)})
        self.assertIn("Shell API folder", exported.read_text())
        # A write that fails says so (M14 is the shell then showing "Saved").
        locked = self.browser.dir / "locked"
        locked.mkdir()
        locked.chmod(0o500)
        self.addCleanup(locked.chmod, 0o700)
        self.assertEqual(self.error("bookmarks.export", {"path": str(locked / "bookmarks.html")}),
                         "The bookmarks could not be saved there")
        self.assertFalse((locked / "bookmarks.html").exists())
        # Refused before it starts: answered at once, with no reply event.
        self.assertEqual(self.error("bookmarks.export", {"path": "relative.html"}),
                         "Choose where to save the bookmarks")

    def download_report(self) -> dict:
        """Downloads the fixture file and returns its row from downloads.list."""
        self.browser.browserctl("open", url=self.server.url("/report-2026.pdf"), where="current")

        def finished():
            rows = [d for d in self.ok("downloads.list") if d["name"] == "report-2026.pdf"]
            return rows[0] if rows and rows[0].get("status") == "done" else None
        row = self.wait(finished, "the download to finish", timeout=20)
        self.assertTrue((self.browser.downloads / "report-2026.pdf").is_file())
        return row

    def test_downloads_are_listed_through_the_shell(self):
        row = self.download_report()
        self.assertEqual(row["received"], 20000)

    def test_a_suggestion_opens_only_if_it_is_still_the_row_shown(self):
        # M18: Chromium's list changes as results arrive, so the shell sends
        # the row's address with its index, and a row that no longer matches
        # is refused rather than opening whatever is at that index now.
        two = self.server.url("/two")
        self.ok("omnibox.query", {"queryId": "q1", "text": two, "preventInline": True})
        refusals = []

        def open_row() -> bool:
            wrong = self.browser.shell_call("omnibox.open", {
                "queryId": "q1", "index": 0, "url": self.server.url("/one"), "newTab": False})
            refusals.append(wrong)
            right = self.browser.shell_call("omnibox.open", {
                "queryId": "q1", "index": 0, "url": two, "newTab": False})
            return right.get("ok")

        self.wait(open_row, "the suggestion for /two to open")
        self.assertFalse(refusals[-1].get("ok"), refusals[-1])
        self.assertEqual(refusals[-1].get("error"), "The suggestions changed; choose one again")
        self.wait(lambda: self.browser.active_tab()["url"] == two, "/two to load")
        self.assertFalse(self.server.requested("/one"))
        # Another query's ID is refused too.
        self.ok("omnibox.query", {"queryId": "q2", "text": two, "preventInline": True})
        self.assertEqual(self.error("omnibox.open", {"queryId": "q1", "index": 0, "url": two, "newTab": False}),
                         "The suggestions changed; choose one again")

    def test_config_changes_never_overwrite_each_other(self):
        # M21: Settings' switches and its Config File editor change the same
        # file. Options set at once from several places all land, and a
        # whole-file save from an older copy is refused.
        self.browser.write_config("# mine\n[options]\n")
        opened = self.ok("settings.config")
        replies = []
        changes = [("auto_insert", False), ("smooth_scroll", False), ("hint_chars", "sdfjkl")]
        threads = [threading.Thread(target=lambda n=name, v=value: replies.append(
            self.browser.shell_call("settings.setOption", {"name": n, "value": v}))) for name, value in changes]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual([r.get("ok") and r.get("result") for r in replies], ["", "", ""], replies)
        text = self.browser.config_file.read_text()
        for line in ("# mine", "auto_insert = false", "smooth_scroll = false", 'hint_chars = "sdfjkl"'):
            self.assertIn(line, text)

        # The editor still holds the file as it was opened.
        stale = self.ok("settings.saveConfig", {"text": opened["text"] + "# edited\n", "revision": opened["revision"]})
        self.assertIn("changed since you opened it", stale["error"])
        self.assertEqual(self.browser.config_file.read_text(), text)

        current = self.ok("settings.config")
        self.assertNotEqual(current["revision"], opened["revision"])
        saved = self.ok("settings.saveConfig", {"text": current["text"] + "# edited\n", "revision": current["revision"]})
        self.assertEqual(saved["error"], "")
        self.assertEqual(self.browser.config_file.read_text(), text + "# edited\n")
        self.assertEqual(self.ok("settings.config")["revision"], saved["revision"])
        self.assertIn("Invalid configuration revision", self.error("settings.saveConfig", {"text": "x"}))


class ShellApiRefusedTest(MerlinTestCase):
    """Without the test switch, shell-call is refused."""

    shell_api = False

    def test_shell_call_needs_the_test_switch(self):
        reply = self.browser.shell_call("window.snapshot")
        self.assertFalse(reply.get("ok"), reply)
        self.assertIn("--merlin-test-shell-api", reply["error"])
        self.assertTrue(self.browser.browserctl("ping").get("ok"))


class BrowserctlSwitchTest(MerlinTestCase):
    """Settings › General › Allow command-line access: it writes `browserctl` with settings.setOption."""

    def test_the_switch_closes_the_socket_and_the_config_reopens_it(self):
        snapshot = self.browser.shell_call("window.snapshot")["result"]
        self.assertIs(snapshot["modal"]["browserctl"], True)
        # The switch's call, as GeneralPane sends it.
        reply = self.browser.shell_call("settings.setOption", {"name": "browserctl", "value": False})
        self.assertEqual((reply.get("ok"), reply.get("result")), (True, ""), reply)
        self.assertIn("browserctl = false", self.browser.config_file.read_text())

        def refused() -> bool:
            try:
                self.browser.browserctl("ping")
            except OSError:
                return True
            return False

        self.wait(refused, "the browserctl socket to close")
        # Only Settings turns it on again from here: browserctl can't reach
        # the shell any more, so set the file and start Merlin again.
        text = self.browser.config_file.read_text()
        self.browser.config_file.write_text(text.replace("browserctl = false", "browserctl = true"))
        self.browser.restart()
        self.assertIs(self.browser.shell_call("window.snapshot")["result"]["modal"]["browserctl"], True)


if __name__ == "__main__":
    unittest.main()
