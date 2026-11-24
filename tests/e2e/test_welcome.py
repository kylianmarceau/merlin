"""First launch, interrupted setup, website-free practice, and Help replay."""
import unittest

from merlin_e2e import Merlin, PageServer, wait_until


class WelcomeTests(unittest.TestCase):
    def launch(self, **kwargs):
        server = PageServer()
        self.addCleanup(server.close)
        browser = Merlin(server, first_run=True, **kwargs)
        self.addCleanup(browser.close)
        return browser

    def advance(self, browser, step, progress=None):
        args = {"next": step}
        if progress is not None:
            args["progress"] = progress
        reply = browser.shell_call("welcome.advance", args)
        self.assertTrue(reply["ok"], reply)

    def stage(self, browser, expected):
        wait_until(lambda: browser.snapshot()["welcome"] == expected, message=f"setup stage {expected!r}")

    def lesson(self, browser):
        wait_until(lambda: browser.active_tab()["url"].split("#")[0].endswith("/MerlinTutorial.html"),
                   message="the bundled field guide")
        wait_until(lambda: browser.eval("document.title") == "The fjord crossing · Merlin field guide",
                   message="the fjord crossing to load")

    def follow_hint(self, browser):
        browser.press("f")
        hints = wait_until(lambda: browser.snapshot()["modal"].get("hints"), message="real link hints")
        self.assertEqual(len(hints), 1)
        browser.press(hints[0]["label"].lower())

    def click(self, browser, selector):
        session = browser.active_session()
        point = browser.eval(f"""(() => {{
          const box = document.querySelector({selector!r}).getBoundingClientRect();
          return {{x: box.x + box.width / 2, y: box.y + box.height / 2}};
        }})()""", session)
        for event in ("mousePressed", "mouseReleased"):
            browser.cdp.call("Input.dispatchMouseEvent",
                             {"type": event, "button": "left", "clickCount": 1, **point}, session)

    def test_keyboard_path_finishes_explicitly_and_keeps_choices(self):
        browser = self.launch()
        # No input: the end of the bundled opening film starts setup.
        wait_until(lambda: browser.snapshot()["welcome"] == "setup", timeout=15,
                   message="the opening to finish and start setup")
        appearance = dict(browser.snapshot()["appearance"], mode="dark", accent="ocean")
        self.assertTrue(browser.shell_call("appearance.set", appearance)["ok"])
        progress = {"screen": "workspace", "source": "fresh", "custom": True, "favorites": []}
        for screen in ("layout", "source", "layout", "position"):
            progress["screen"] = screen
            self.advance(browser, "setup", progress)
        browser.restart()
        self.stage(browser, "setup")
        self.assertEqual(browser.snapshot()["welcomeProgress"], progress)
        self.assertTrue(browser.shell_call("settings.set", {"key": "tabs", "value": "top"})["ok"])
        browser.write_config('[options]\nhint_chars = "sdfjkl"\n')
        before = len(browser.tabs())
        self.advance(browser, "tutorial")
        self.lesson(browser)
        for filename in ("MerlinAlpenglow.jpg", "MerlinAurora.jpg"):
            with self.subTest(artwork=filename):
                self.assertTrue(browser.eval(f"""new Promise(resolve => {{
                  const image = new Image();
                  image.onload = () => resolve(image.naturalWidth > 1000);
                  image.onerror = () => resolve(false);
                  image.src = {filename!r};
                }})"""))
        self.follow_hint(browser)
        wait_until(lambda: browser.active_tab()["url"].endswith("#lookout"), message="the second exercise")
        self.stage(browser, "practice")
        browser.press("G")
        wait_until(lambda: browser.eval("""
            scrollY > 0 && Math.abs(document.scrollingElement.scrollHeight - innerHeight - scrollY) <= 1
        """), message="the real end-of-page shortcut to finish scrolling to the lookout")
        self.follow_hint(browser)
        self.stage(browser, "ready")
        self.assertEqual(len(browser.tabs()), before + 1)
        self.advance(browser, "browse")
        self.stage(browser, "")
        wait_until(lambda: len(browser.tabs()) == before, message="the practice tab to close")
        browser.restart()
        self.stage(browser, "")
        self.assertEqual(browser.snapshot()["appearance"], appearance)
        self.assertEqual(browser.snapshot()["modal"]["tabLayout"], "top")

    def test_existing_user_can_replay_with_a_mouse(self):
        browser = self.launch(existing_profile=True)
        self.stage(browser, "")
        for _ in range(2):
            self.advance(browser, "tutorial")
            self.lesson(browser)
            self.click(browser, 'a[href="#lookout"]')
            wait_until(lambda: browser.eval("location.hash") == "#lookout", message="the second exercise")
            self.click(browser, 'a[href="#summit"]')
            wait_until(lambda: browser.eval("location.hash") == "#summit", message="the lookout")
            self.click(browser, 'a[href="#complete"]')
            self.stage(browser, "ready")
            self.advance(browser, "browse")
            self.stage(browser, "")
        browser.restart()
        self.stage(browser, "")

    def test_resumes_practice_and_finishing_screen(self):
        browser = self.launch()
        self.advance(browser, "tutorial")
        self.lesson(browser)
        browser.restart()
        self.stage(browser, "practice")
        self.lesson(browser)
        count = len(browser.tabs())
        self.advance(browser, "tutorial")
        self.assertEqual(len(browser.tabs()), count)
        self.advance(browser, "ready")
        browser.restart()
        self.stage(browser, "ready")
        health = browser.shell_call("test.shell", {"action": "state"})["result"]
        wait_until(lambda: browser.shell_call("test.shell", {"action": "state"})["result"]["ready"] > 0,
                   message="the finish screen to render")
        self.assertEqual(health["failures"], 0, health["lastError"])
        self.advance(browser, "import")
        wait_until(lambda: browser.active_tab()["url"] == "chrome://settings/importData", message="the importer")
        self.stage(browser, "")

    def test_native_host_renders_resumed_setup_screens(self):
        browser = self.launch()
        screens = ("source", "layout", "address", "command", "newTab", "position", "tidy",
                   "startup", "sharing", "habits", "color", "appearance", "material", "frame",
                   "siteColor", "details", "search", "privacy", "favorites", "system", "links",
                   "cli", "finish")
        for screen in screens:
            with self.subTest(screen=screen):
                self.advance(browser, "setup", {"screen": screen, "source": "fresh", "custom": True,
                                                 "favorites": ["github", "gmail"]})
                browser.restart()
                self.stage(browser, "setup")
                self.assertEqual(browser.snapshot()["welcomeProgress"]["screen"], screen)

                def rendered():
                    health = browser.shell_call("test.shell", {"action": "state"})["result"]
                    self.assertEqual(health["failures"], 0, health["lastError"])
                    return health["ready"] > 0

                wait_until(rendered, message="native setup to draw " + screen)

    def test_start_browsing_restores_catalog_pins_with_start_fresh(self):
        browser = self.launch()
        self.stage(browser, "setup")
        self.assertTrue(browser.shell_call("settings.set", {"key": "startup", "value": "start"})["ok"])
        progress = {"screen": "finish", "source": "chrome", "custom": False, "favorites": ["github", "github"]}
        self.advance(browser, "setup", progress)
        self.advance(browser, "browse")
        self.stage(browser, "")
        def github_pins():
            return [tab for tab in browser.tabs() if tab.get("pinned") and tab["url"].startswith("https://github.com/")]
        wait_until(github_pins, message="catalog pin")
        self.assertEqual(len(github_pins()), 1)
        browser.restart()
        self.stage(browser, "")
        wait_until(github_pins, message="catalog pin restored")
        self.assertEqual(len(github_pins()), 1)
        pin_id = str(github_pins()[0]["id"])
        self.assertTrue(browser.shell_call("tabs.pin", {"tabId": pin_id, "pinned": False})["ok"])
        browser.restart()
        self.stage(browser, "")
        self.assertFalse(github_pins(), "removing a favorite must survive the next launch too")
