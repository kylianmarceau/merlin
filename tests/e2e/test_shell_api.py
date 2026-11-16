"""The React shell's own API, driven through browserctl shell-call.

Everything else in these tests reaches Merlin through browserctl's modal
command path. The shell's buttons and panels call the bridge instead
(EngineClient -> merlin_shell_bridge_mac.mm -> services), which is how a
broken download action shipped untested. shell_call goes through that same
dispatcher, for the front window.
"""

from __future__ import annotations

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

    @unittest.expectedFailure
    def test_download_actions_through_the_shell(self):
        # M02: the bridge passes bare actions ("forget") to
        # RunMerlinDownloadAction, which accepts only "download-forget", so
        # every download button in the shell fails with "Unknown download
        # action". Plan item 1.1 fixes it and removes this marker.
        row = self.download_report()
        self.ok("downloads.act", {"downloadId": row["id"], "action": "forget"})
        self.wait(lambda: all(d["id"] != row["id"] for d in self.ok("downloads.list")),
                  "the download to be forgotten")


class ShellApiRefusedTest(MerlinTestCase):
    """Without the test switch, shell-call is refused."""

    shell_api = False

    def test_shell_call_needs_the_test_switch(self):
        reply = self.browser.shell_call("window.snapshot")
        self.assertFalse(reply.get("ok"), reply)
        self.assertIn("--merlin-test-shell-api", reply["error"])
        self.assertTrue(self.browser.browserctl("ping").get("ok"))


if __name__ == "__main__":
    unittest.main()
