"""The onboarding choices use the regular native browser services."""
import time
import unittest

from merlin_e2e import Merlin, PageServer, wait_until


class OnboardingBehaviorTests(unittest.TestCase):
    def launch(self, *extra_args):
        server = PageServer()
        self.addCleanup(server.close)
        browser = Merlin(server, extra_args=list(extra_args))
        self.addCleanup(browser.close)
        return browser, server

    def call(self, browser, method, args=None):
        reply = browser.shell_call(method, args)
        self.assertTrue(reply["ok"], reply)
        return reply.get("result")

    def test_import_retry_does_not_duplicate_native_data(self):
        browser, server = self.launch()
        page = server.url("/doc?imported")
        data = {
            "bookmarks": {"url": page, "title": "Imported fixture", "folders": ["Fixture"]},
            "history": {"url": page, "title": "Imported fixture", "time": time.time() - 300, "visits": 1},
            "tabs": {"url": page, "pinned": True},
        }
        for category, row in data.items():
            args = {"category": category, "entries": [row]}
            self.assertEqual(self.call(browser, "setup.importBatch", args), 1)
            self.assertEqual(self.call(browser, "setup.importBatch", args), 0)
        snapshot = browser.snapshot()
        self.assertEqual(sum(t["url"] == page and t["pinned"] for t in snapshot["tabs"]), 1)
        browser.restart()
        for category in ("bookmarks", "history"):
            self.assertEqual(self.call(browser, "setup.importBatch", {"category": category, "entries": [data[category]]}), 0)

    def test_search_choice_is_used_by_the_address_field_after_restart(self):
        browser, _ = self.launch()
        result = self.call(browser, "settings.set", {"key": "engine", "value": "kagi"})
        self.assertEqual(next(item for item in result["engines"] if item["id"] == result["engine"])["setupKey"], "kagi")
        browser.restart()
        result = self.call(browser, "settings.get")
        self.assertEqual(next(item for item in result["engines"] if item["id"] == result["engine"])["setupKey"], "kagi")

    def test_shared_tab_moves_as_the_same_live_page_and_survives_source_window_close(self):
        browser, server = self.launch("-MerlinShell.sharedTabs", "on", "-MerlinShell.warnBeforeClosingWindow", "off")
        page = browser.open("/doc?shared")
        original = browser.active_session()
        browser.eval("globalThis.sharedProbe = 42", original)
        other = server.url("/doc?other")
        reply = browser.browserctl("open", url=other, where="window")
        self.assertTrue(reply["ok"], reply)
        wait_until(lambda: len({t["window"] for t in browser.tabs()}) == 2, message="second normal window")
        remote = wait_until(
            lambda: next((t for t in browser.snapshot()["tabs"] if t.get("sharedFrom") and t["url"] == page), None),
            message="shared page in second window")
        self.call(browser, "tabs.activate", {"tabId": remote["id"]})
        wait_until(lambda: any(t["url"] == page and not t.get("sharedFrom") and
                               t["id"] == browser.snapshot()["activeTabId"] for t in browser.snapshot()["tabs"]),
                   message="active page transferred")
        self.assertEqual(browser.eval("sharedProbe", original), 42)
        browser.command("browser close-window")
        wait_until(lambda: len({t["window"] for t in browser.tabs()}) == 1, message="closing the destination window")
        wait_until(lambda: any(t["url"] == page for t in browser.tabs()), message="the shared page retained")
        self.assertEqual(browser.eval("sharedProbe", original), 42)

    def test_modified_links_follow_the_selected_shortcuts_after_restart(self):
        for name, modifier in (("shift", 8), ("option", 1)):
            with self.subTest(peek=name):
                browser, server = self.launch("-MerlinShell.peekModifier", name, "-MerlinShell.groupLinkTabs", "on")
                browser.restart()
                opener = browser.open("/hints")
                target = server.url("/one")
                session = browser.active_session()
                point = browser.eval("""(() => {
                    const box = document.querySelector('#one').getBoundingClientRect();
                    return {x: box.left + 3, y: box.top + 3};
                })()""", session)

                def click_with(modifiers):
                    for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
                        browser.cdp.call("Input.dispatchMouseEvent", {
                            "type": kind, "button": "left", "buttons": buttons, "clickCount": 1,
                            "modifiers": modifiers, **point,
                        }, session)

                click_with(modifier)
                peek = wait_until(lambda: next((t for t in browser.cdp.targets()
                    if t["type"] == "other" and t["url"] == target), None), message=f"{name}-click Peek")
                self.assertEqual(browser.active_tab()["url"], opener)
                browser.press("<Esc>", browser.cdp.session_for(peek["targetId"]))
                click_with(4)  # Command-click
                def related_tabs():
                    return [tab for tab in browser.snapshot()["tabs"] if tab["url"] in (opener, target)]
                wait_until(lambda: len(related_tabs()) == 2, message="related background tab")
                source, linked = related_tabs()
                self.assertTrue(source.get("group"))
                self.assertEqual(linked.get("group"), source["group"])
