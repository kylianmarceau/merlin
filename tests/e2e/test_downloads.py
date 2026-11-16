"""Download actions, as the shell's download rows and menus send them (M02).

Every action goes through shell_call("downloads.act"), the bridge call the
shell's buttons make, on a download the fixture server paces
(PacedDownload), so each state is held until the test moves on.

Opening a file and showing it in Finder put windows in front of whoever is
using the Mac, so those two only run with MERLIN_E2E_DESKTOP=1; the rest of
the time their refusals still prove the shell's names reach them.
"""

from __future__ import annotations

import os
import time
import unittest
from typing import Optional

from merlin_e2e import MerlinTestCase, PacedDownload


class DownloadsTest(MerlinTestCase):
    def act(self, row: dict, action: str) -> dict:
        return self.browser.shell_call("downloads.act", {"downloadId": row["id"], "action": action})

    def ok(self, row: dict, action: str) -> None:
        reply = self.act(row, action)
        self.assertTrue(reply.get("ok"), f"{action}: {reply}")

    def refused(self, row: dict, action: str, error: str) -> None:
        self.assertEqual(self.act(row, action), {"v": 1, "id": 1, "ok": False, "error": error}, action)

    def row(self, name: str) -> Optional[dict]:
        reply = self.browser.shell_call("downloads.list")
        self.assertTrue(reply.get("ok"), reply)
        return next((d for d in reply["result"] if d["name"] == name), None)

    def status(self, name: str, status: str, timeout: float = 20) -> dict:
        def reached():
            row = self.row(name)
            return row if row and row.get("status") == status else None
        return self.wait(reached, f"{name} to be {status}", timeout=timeout)

    def start(self, name: str) -> tuple[PacedDownload, dict]:
        """Starts a paced download and returns it once its first bytes arrived."""
        download, url = self.server.paced_download(name)
        self.addCleanup(download.drop)  # never leave a server thread waiting
        self.browser.browserctl("open", url=url, where="current")
        row = self.wait(lambda: (r := self.row(name)) and r.get("status") == "progress" and
                        r["received"] >= 64 * 1024 and r, f"{name} to start")
        return download, row

    def file(self, name: str):
        return self.browser.downloads / name

    def test_pause_and_resume(self):
        download, row = self.start("paused.bin")
        self.ok(row, "pause")
        self.status("paused.bin", "paused")
        # The same action resumes it.
        self.ok(row, "pause")
        self.status("paused.bin", "progress")
        # The modal command runs the same action.
        self.browser.command(f"browser download-pause {row['id']}")
        self.status("paused.bin", "paused")
        self.browser.command(f"browser download-pause {row['id']}")
        self.status("paused.bin", "progress")
        download.allow()
        self.status("paused.bin", "done")
        self.assertEqual(self.file("paused.bin").read_bytes(), download.body)

    def test_cancel(self):
        _, row = self.start("cancelled.bin")
        self.ok(row, "cancel")
        self.status("cancelled.bin", "cancelled")
        self.assertFalse(self.file("cancelled.bin").exists())
        self.refused(row, "cancel", "The download is not running")
        self.refused(row, "show", "The file is no longer on disk")
        self.refused(row, "retry", "This download cannot be resumed")

    def test_retry_after_the_connection_drops(self):
        download, row = self.start("retried.bin")
        download.drop()
        # Chromium retries a lost connection a few times by itself, then
        # stops: wait until it has given up.
        self.status("retried.bin", "failed", timeout=30)
        def settled():
            before = len(download.requests)
            time.sleep(1)
            return len(download.requests) == before and self.row("retried.bin")["status"] == "failed"
        self.wait(settled, "Chromium to stop retrying by itself", timeout=30)
        self.assertFalse(self.file("retried.bin").exists())
        asked = len(download.requests)
        download.allow()
        self.ok(row, "retry")
        self.status("retried.bin", "done")
        self.assertGreater(len(download.requests), asked, "retry should fetch the file again")
        self.assertEqual(self.file("retried.bin").read_bytes(), download.body)

    def test_forget_a_finished_download(self):
        download, row = self.start("forgotten.bin")
        self.refused(row, "forget", "Cancel the download first")
        download.allow()
        self.status("forgotten.bin", "done")
        self.ok(row, "forget")
        self.wait(lambda: self.row("forgotten.bin") is None, "the download to leave the list")
        # Forgetting removes it from the list, not from the disk.
        self.assertTrue(self.file("forgotten.bin").is_file())

    def test_open_and_show_wait_for_the_file(self):
        download, row = self.start("pending.bin")
        self.refused(row, "open", "The file is not ready to open")
        self.refused(row, "discard", "Only held-back files are discarded")
        download.allow()
        self.status("pending.bin", "done")
        self.refused(row, "pause", "The download is not running")

    @unittest.skipUnless(os.environ.get("MERLIN_E2E_DESKTOP") == "1",
                         "opens a file and a Finder window; set MERLIN_E2E_DESKTOP=1")
    def test_open_and_show_a_finished_file(self):
        download, row = self.start("shown.txt")
        download.allow()
        self.status("shown.txt", "done")
        self.ok(row, "show")
        self.ok(row, "open")


if __name__ == "__main__":
    unittest.main()
