"""Spaces with their own data, as Arc's spaces have profiles, over the real engine.

A space that keeps its own data has its own cookies, logins, history and so
on: Chromium keeps them in a profile of their own, whose tabs live in a
window of their own, swapped into the Merlin window's place
(overlay/chrome/browser/ui/modal_browser/merlin_space_windows.h).
"""

from __future__ import annotations

import unittest

from merlin_e2e import MerlinTestCase


class SpaceDataTest(MerlinTestCase):
    # DevTools names the data last used its default, which changes as the
    # windows swap, so the data is told apart by the Home page's own.
    home_context = ""
    # Closing a window would ask first: it has more than one tab, counting
    # those of its spaces with other data.
    extra_args = ["-MerlinShell.warnBeforeClosingWindow", "off"]

    def pages(self) -> list[dict]:
        return [p for p in self.browser.cdp.pages() if p.get("type") == "page"]

    def pages_with_other_data(self) -> list[dict]:
        return [p for p in self.pages() if p.get("browserContextId") != self.home_context]

    def windows(self) -> list[dict]:
        """Every window of the interface: its space data, whether it's on screen, and its tabs' addresses."""
        reply = self.browser.shell_call("test.shell", {"action": "state"})
        self.assertTrue(reply.get("ok"), reply)
        return list(reply["result"]["windows"].values())

    def on_screen(self) -> list[str]:
        """The data of each window on screen."""
        return sorted(w["data"] for w in self.windows() if w["visible"])

    def cookie_in(self, session: str) -> str:
        return self.browser.eval("document.cookie", session)

    def load(self, session: str, url: str) -> None:
        self.browser.cdp.call("Page.navigate", {"url": url}, session)
        self.wait(lambda: self.browser.eval("location.href + ' ' + document.readyState", session) == f"{url} complete",
                  f"{url} to load")

    def test_a_space_with_its_own_data_keeps_its_own_cookies(self) -> None:
        snapshot = self.browser.shell_call("window.snapshot")
        self.assertTrue(snapshot.get("ok"), snapshot)
        self.assertEqual(snapshot["result"].get("data"), "Default", "the first window holds Home's data")

        page = self.browser.open("/page")
        home = self.browser.active_session()
        self.home_context = next(p["browserContextId"] for p in self.pages() if p["url"] == page)
        self.browser.eval("document.cookie = 'who=home; max-age=3600'", home)
        self.assertEqual(self.cookie_in(home), "who=home")

        made = self.browser.shell_call("spaces.newData", {"name": "Work"})
        self.assertTrue(made.get("ok"), made)
        data = made["result"]
        self.assertRegex(data, r"^Profile [1-9][0-9]*$")

        shown = self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": data})
        self.assertTrue(shown.get("ok"), shown)
        work_page = self.wait(lambda: next(iter(self.pages_with_other_data()), None), "the Work window's tab")
        work = self.browser.cdp.session_for(work_page["targetId"])
        # One Merlin window: Work's window took Home's place, which hides.
        self.wait(lambda: self.on_screen() == [data], "only Work's window on screen")
        self.assertEqual(sorted(w["data"] for w in self.windows()), ["Default", data])

        # The same site, logged out: Home's cookie isn't there, and Work's
        # doesn't reach Home.
        self.load(work, page)
        self.assertEqual(self.cookie_in(work), "", "Home's cookie stays with Home's data")
        self.browser.eval("document.cookie = 'who=work; max-age=3600'", work)
        self.assertEqual(self.cookie_in(work), "who=work")
        self.assertEqual(self.cookie_in(home), "who=home", "Work's cookie stays with Work's data")

        # A second request for the same data uses the window it has.
        again = self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": data})
        self.assertTrue(again.get("ok"), again)
        self.assertEqual(len(self.pages_with_other_data()), 1, "no second Work window")

        # Data Merlin doesn't have, and names that aren't data, are refused.
        refused = self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": "Profile 999"})
        self.assertFalse(refused.get("ok"), refused)
        refused = self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": "../Default"})
        self.assertFalse(refused.get("ok"), refused)
        refused = self.browser.shell_call("spaces.deleteData", {"data": "Default"})
        self.assertFalse(refused.get("ok"), "Home's data can't be deleted")

        # Both windows come back after a restart, each with its own data.
        self.browser.restart()
        restored = self.wait(lambda: (lambda found: found if len({p["browserContextId"] for p in found}) == 2 else None)(
            [p for p in self.pages() if p["url"] == page]), "both tabs after the restart", timeout=20)
        # The hidden window's tab is restored unloaded, as background tabs
        # are, until its window shows; loading it reads the cookie from disk.
        self.wait(lambda: len(self.on_screen()) == 1, "one window of the pair on screen after the restart", timeout=10)
        cookies = {}
        for target in restored:
            session = self.browser.cdp.session_for(target["targetId"])
            self.load(session, page)
            cookies[target["browserContextId"]] = self.cookie_in(session)
        self.assertEqual(sorted(cookies.values()), ["who=home", "who=work"])
        self.home_context = next(context for context, cookie in cookies.items() if cookie == "who=home")

        # Deleting the data closes its window, and only its window.
        deleted = self.browser.shell_call("spaces.deleteData", {"data": data})
        self.assertTrue(deleted.get("ok"), deleted)
        self.wait(lambda: not self.pages_with_other_data(), "the Work window to close", timeout=20)
        self.assertTrue(any(p["url"] == page for p in self.pages()), "Home's window stays")

    def test_a_window_carries_on_when_its_data_has_no_tabs_and_closes_whole(self) -> None:
        page = self.browser.open("/page")
        data = self.browser.shell_call("spaces.newData", {"name": "Work"})["result"]
        self.assertTrue(self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": data}).get("ok"))
        self.wait(lambda: self.on_screen() == [data], "Work's window on screen")

        # Work's last tab closes: Home's window comes back in its place.
        work_tab = next(p for p in self.pages() if p["url"] != page)
        self.browser.cdp.call("Target.closeTarget", {"targetId": work_tab["targetId"]})
        self.wait(lambda: [w["data"] for w in self.windows()] == ["Default"], "Work's window to close")
        self.wait(lambda: self.on_screen() == ["Default"], "Home's window back on screen")

        # Closing the Merlin window closes both of its windows.
        self.assertTrue(self.browser.shell_call("spaces.showData", {"spaceId": "sworke2e", "data": data}).get("ok"))
        self.wait(lambda: self.on_screen() == [data], "Work's window on screen again")
        self.assertEqual(len(self.windows()), 2)
        self.browser.command("browser close-window")
        self.wait(lambda: not self.pages(), "both windows to close")


if __name__ == "__main__":
    unittest.main()
