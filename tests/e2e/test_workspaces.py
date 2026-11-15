"""Workspaces and browserctl, over the real socket."""

from __future__ import annotations

import json
import os
import time
import unittest

from merlin_e2e import MerlinTestCase


class BrowserctlTest(MerlinTestCase):
    def test_ping_names_the_protocol(self) -> None:
        reply = self.browser.browserctl("ping")
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["v"], 1)

    def test_open_tabs_focus_and_command(self) -> None:
        doc = self.server.url("/doc")
        reply = self.browser.browserctl("open", url=doc, where="tab")
        self.assertEqual(reply, {"v": 1, "id": 1, "ok": True, "result": ""})
        self.wait(lambda: len(self.browser.tabs()) == 2, "the new tab")
        self.wait(lambda: self.browser.tabs()[1]["url"] == doc, "the new tab's address")
        self.assertTrue(self.browser.tabs()[1]["active"])

        self.assertTrue(self.browser.browserctl("focus", tab=1)["ok"])
        self.wait(lambda: self.browser.tabs()[0]["active"], "focus to select tab 1")
        self.assertTrue(self.browser.browserctl("command", line="pin")["ok"])
        self.wait(lambda: self.browser.tabs()[0]["pinned"], ":pin over browserctl")
        current = self.browser.browserctl("current")
        self.assertTrue(current["ok"], current)
        self.assertIn(self.server.url("/page"), json.dumps(current["result"]))

    def test_refusals(self) -> None:
        refused = self.browser.browserctl("open", url="javascript:alert(1)")
        self.assertFalse(refused["ok"], refused)
        unknown = self.browser.browserctl("rm")
        self.assertFalse(unknown["ok"])
        self.assertIn("unknown command", json.dumps(unknown))
        typo = self.browser.browserctl("command", line="tabnw")
        self.assertFalse(typo["ok"])
        self.assertIn("did you mean", json.dumps(typo))
        self.assertEqual(len(self.browser.tabs()), 1, "nothing was opened")

    def test_selection_prints_the_selected_text(self) -> None:
        self.browser.open("/doc")
        self.browser.eval("""(() => {
            const range = document.createRange();
            range.selectNodeContents(document.querySelector('h1'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
        })()""")
        self.wait(lambda: self.browser.browserctl("selection").get("result") == "Foo",
                  "browserctl selection to print Foo")

    def test_socket_is_only_for_this_user(self) -> None:
        mode = os.stat(self.browser.socket.parent).st_mode & 0o777
        self.assertEqual(mode & 0o077, 0, f"socket directory mode {oct(mode)}")


class WorkspacesTest(MerlinTestCase):
    def workspace_file(self, name: str) -> dict:
        return json.loads((self.browser.workspace_dir / f"{name}.json").read_text())

    def windows(self) -> set[int]:
        return {t["window"] for t in self.browser.tabs()}

    def test_save_and_restore_tabs_pins_and_splits(self) -> None:
        doc = self.server.url("/doc")
        form = self.server.url("/form")
        self.browser.command(f"vsplit {doc}")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the split")
        self.browser.command("pin")
        self.wait(lambda: all(t["pinned"] for t in self.browser.tabs()), "the split to be pinned")
        self.browser.browserctl("open", url=form, where="background")
        self.wait(lambda: len(self.browser.tabs()) == 3, "a third tab")

        self.browser.command("workspace save research")
        saved = self.wait(lambda: (self.browser.workspace_dir / "research.json").exists() and
                          self.workspace_file("research"), "the workspace file")
        text = json.dumps(saved)
        self.assertIn(doc, text)
        self.assertIn(form, text)
        self.assertIn("splits", saved)

        # Opening the workspace this window already is changes nothing.
        self.browser.command("workspace open research")
        time.sleep(0.5)
        self.assertEqual(self.windows(), {1})

        # From a window that is another workspace, it opens a new window.
        self.browser.command("workspace save other")
        self.browser.command("workspace open research")
        self.wait(lambda: len(self.windows()) == 2, "the research window")
        restored = [t for t in self.browser.tabs() if t["window"] == 1]
        self.assertEqual([t["url"] for t in restored][:2],
                         [self.server.url("/page"), doc], "the front window is research")
        self.assertEqual(len(restored), 3)
        self.assertTrue(restored[0]["pinned"] and restored[1]["pinned"])
        self.browser.command("workspace delete other")
        self.browser.command("workspace delete research")

    def test_workspace_list_and_here(self) -> None:
        project = self.browser.dir / "proj"
        (project / "src").mkdir(parents=True)
        self.browser.workspace_dir.mkdir(parents=True, exist_ok=True)
        (self.browser.workspace_dir / "proj.json").write_text(json.dumps({
            "format": "modal_browser.workspace", "version": 1, "name": "proj",
            "tabs": [{"url": self.server.url("/doc")}], "project": str(project)}))
        listed = self.browser.browserctl("workspace", action="list")
        self.assertTrue(listed["ok"], listed)
        self.assertIn("proj", json.dumps(listed["result"]))

        windows = len(self.windows())
        reply = self.browser.browserctl("workspace", action="here", dir=str(project / "src"))
        self.assertEqual(reply.get("result"), "proj", reply)
        self.wait(lambda: len(self.windows()) == windows + 1, "the project's window")
        again = self.browser.browserctl("workspace", action="here", dir=str(project))
        self.assertEqual(again.get("result"), "proj")
        time.sleep(0.5)
        self.assertEqual(len(self.windows()), windows + 1, "the same window is reused")
        elsewhere = self.browser.browserctl("workspace", action="here", dir=str(self.browser.dir))
        self.assertFalse(elsewhere["ok"])
        self.assertIn("no workspace has a project folder", json.dumps(elsewhere))



if __name__ == "__main__":
    unittest.main()
