"""Saved spaces and browserctl, over the real socket."""

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

    def snapshot(self) -> dict:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]

    def test_save_and_open_a_space(self) -> None:
        page = self.server.url("/page")
        doc = self.server.url("/doc")
        form = self.server.url("/form")
        self.browser.command(f"vsplit {doc}")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the split")
        # A favourite shows in every space, so no space's file keeps it.
        self.browser.browserctl("open", url=form, where="background")
        self.wait(lambda: len(self.browser.tabs()) == 3, "a third tab")
        self.browser.browserctl("focus", tab=3)
        self.wait(lambda: self.browser.active_tab()["url"] == form, "the third tab in front")
        self.browser.command("pin")
        self.wait(lambda: self.browser.tabs()[0]["pinned"], "the favourite")

        self.browser.command("space save research")
        saved = self.wait(lambda: (self.browser.workspace_dir / "research.json").exists() and
                          self.workspace_file("research"), "the saved space")
        text = json.dumps(saved)
        self.assertIn(page, text)
        self.assertIn(doc, text)
        self.assertNotIn(form, text)
        self.assertEqual(len(saved["splits"]), 1)

        # Opening the space showing changes nothing.
        self.browser.command("space open research")
        time.sleep(0.5)
        self.assertEqual(len(self.browser.tabs()), 3)

        # Another saved space opens in this window, as a space of its own.
        other = self.server.url("/page", "other.test")
        (self.browser.workspace_dir / "other.json").write_text(json.dumps({
            "format": "modal_browser.workspace", "version": 1, "name": "other", "tabs": [{"url": other}]}))
        self.browser.command("space open other")
        self.wait(lambda: self.browser.active_tab()["url"] == other, "the other space's tab")
        self.assertEqual(self.windows(), {1})
        tabs = {t["url"]: t for t in self.snapshot()["tabs"]}
        research = tabs[doc].get("space")
        self.assertTrue(research, tabs)
        self.assertEqual(tabs[page].get("space"), research)
        self.assertNotEqual(tabs[other].get("space"), research)
        # Opening research again shows its space rather than a second copy.
        self.browser.command("space open research")
        self.wait(lambda: self.browser.active_tab()["url"] in (page, doc), "research again")
        self.assertEqual(len(self.browser.tabs()), 4)
        self.browser.command("space delete other")
        self.browser.command("space delete research")

    def test_workspace_list_and_here(self) -> None:
        project = self.browser.dir / "proj"
        (project / "src").mkdir(parents=True)
        self.browser.workspace_dir.mkdir(parents=True, exist_ok=True)
        doc = self.server.url("/doc")
        (self.browser.workspace_dir / "proj.json").write_text(json.dumps({
            "format": "modal_browser.workspace", "version": 1, "name": "proj",
            "tabs": [{"url": doc}], "project": str(project)}))
        listed = self.browser.browserctl("workspace", action="list")
        self.assertTrue(listed["ok"], listed)
        self.assertIn("proj", json.dumps(listed["result"]))

        tabs = len(self.browser.tabs())
        reply = self.browser.browserctl("workspace", action="here", dir=str(project / "src"))
        self.assertEqual(reply.get("result"), "proj", reply)
        self.wait(lambda: self.browser.active_tab()["url"] == doc, "the project's space")
        self.assertEqual(self.windows(), {1}, "it opens in this window, as a space")
        again = self.browser.browserctl("workspace", action="here", dir=str(project))
        self.assertEqual(again.get("result"), "proj")
        time.sleep(0.5)
        self.assertEqual(len(self.browser.tabs()), tabs + 1, "the same space is shown again")
        elsewhere = self.browser.browserctl("workspace", action="here", dir=str(self.browser.dir))
        self.assertFalse(elsewhere["ok"])
        self.assertIn("no workspace has a project folder", json.dumps(elsewhere))


class WorkspaceAutosaveTest(MerlinTestCase):
    """A window holding a saved space saves each change the space records."""

    # Closing a window with several tabs asks first; these tests close one.
    extra_args = ["-MerlinShell.warnBeforeClosingWindow", "off"]

    def saved(self, name: str) -> dict:
        path = self.browser.workspace_dir / f"{name}.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def saved_soon(self, name: str, check, message: str) -> dict:
        # Autosave waits 3 s after the last change.
        return self.wait(lambda: (w := self.saved(name)) and check(w) and w, message, timeout=8)

    def snapshot(self) -> dict:
        reply = self.browser.shell_call("window.snapshot")
        self.assertTrue(reply.get("ok"), reply)
        return reply["result"]

    def windows(self) -> set[int]:
        return {t["window"] for t in self.browser.tabs()}

    def tearDown(self) -> None:
        for name in ("auto", "closer"):
            self.browser.browserctl("command", line=f"workspace delete {name}")

    def test_autosave_follows_changes(self) -> None:
        # A tab outside the group, so the group can collapse.
        self.browser.browserctl("open", url=self.server.url("/doc"), where="background")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        self.browser.command("workspace save auto")
        self.saved_soon("auto", lambda w: len(w["tabs"]) == 2, "the first save")
        # A new group moves no tab.
        self.browser.command("group Rust")
        self.saved_soon("auto", lambda w: [g["title"] for g in w["groups"]] == ["Rust"], "the new group")
        group = self.snapshot()["groups"][0]["id"]
        # Renamed, recoloured, collapsed: changes to the group alone.
        self.assertTrue(self.browser.shell_call("groups.update", {"groupId": group, "title": "Go"}).get("ok"))
        self.saved_soon("auto", lambda w: [g["title"] for g in w["groups"]] == ["Go"], "the renamed group")
        self.assertTrue(self.browser.shell_call("groups.update", {"groupId": group, "color": "green"}).get("ok"))
        self.saved_soon("auto", lambda w: w["groups"][0]["color"] == "green", "the recoloured group")
        reply = self.browser.shell_call("groups.update", {"groupId": group, "collapsed": True})
        self.assertTrue(reply.get("ok"), reply)
        self.saved_soon("auto", lambda w: w["groups"][0]["collapsed"], "the collapsed group")
        # Collapsing made the other tab active; ungroup the group itself.
        reply = self.browser.shell_call("groups.ungroup", {"groupId": group})
        self.assertTrue(reply.get("ok"), reply)
        self.saved_soon("auto", lambda w: not w["groups"], "the tab out of its group")

    def test_favourites_stay_out_of_a_saved_space(self) -> None:
        self.browser.browserctl("open", url=self.server.url("/doc"), where="background")
        self.wait(lambda: len(self.browser.tabs()) == 2, "a second tab")
        self.browser.command("space save auto")
        self.saved_soon("auto", lambda w: len(w["tabs"]) == 2, "the first save")
        # A favourite shows in every space; unpinned, it is back in its own.
        self.browser.command("pin")
        self.saved_soon("auto", lambda w: len(w["tabs"]) == 1, "the pin")
        self.browser.command("pin")
        self.saved_soon("auto", lambda w: len(w["tabs"]) == 2, "the unpin")

    def test_autosave_keeps_splits(self) -> None:
        doc = self.server.url("/doc")
        self.browser.command(f"vsplit {doc}")
        self.wait(lambda: len(self.browser.tabs()) == 2, "the split")
        self.browser.command("workspace save auto")
        self.saved_soon("auto", lambda w: len(w["splits"]) == 1, "the split saved")
        # Undoing the split keeps both tabs where they are.
        active = self.snapshot()["activeTabId"]
        self.assertTrue(self.browser.shell_call("tabs.unsplit", {"tabId": active}).get("ok"))
        self.saved_soon("auto", lambda w: not w["splits"] and len(w["tabs"]) == 2, "the split undone")

    def test_closing_just_after_a_change_keeps_it(self) -> None:
        # A second window, holding the saved space, closes 0.5 s after a change.
        first = self.server.url("/page", "closer.test")
        self.browser.browserctl("open", url=first, where="window")
        self.wait(lambda: len(self.windows()) == 2 and self.browser.active_tab()["url"] == first,
                  "the second window in front")
        self.browser.command("space save closer")
        self.saved_soon("closer", lambda w: len(w["tabs"]) == 1, "the first save")
        second = self.server.url("/doc", "closer.test")
        self.browser.browserctl("open", url=second, where="background")
        self.wait(lambda: len([t for t in self.browser.tabs() if t["window"] == 1]) == 2, "its second tab")
        self.browser.command("group Closer")
        time.sleep(0.5)
        self.browser.command("browser close-window")
        self.wait(lambda: len(self.windows()) == 1, "the window to close")
        saved = self.saved("closer")
        self.assertEqual([t["url"] for t in saved["tabs"]], [first, second])
        self.assertEqual([g["title"] for g in saved["groups"]], ["Closer"])


if __name__ == "__main__":
    unittest.main()
