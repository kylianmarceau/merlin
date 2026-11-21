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

    def advance(self, browser, step):
        reply = browser.shell_call("welcome.advance", {"next": step})
        self.assertTrue(reply["ok"], reply)

    def stage(self, browser, expected):
        wait_until(lambda: browser.snapshot()["welcome"] == expected, message=f"setup stage {expected!r}")

    def lesson(self, browser):
        wait_until(lambda: browser.active_tab()["url"].split("#")[0].endswith("/MerlinTutorial.html"),
                   message="the bundled field guide")
        wait_until(lambda: browser.eval("document.title") == "The coast path · Merlin field guide",
                   message="the coast path to load")

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
        self.stage(browser, "intro")
        self.advance(browser, "appearance")
        self.stage(browser, "appearance")
        appearance = dict(browser.snapshot()["appearance"], mode="dark", accent="ocean")
        self.assertTrue(browser.shell_call("appearance.set", appearance)["ok"])
        self.advance(browser, "workspace")
        self.advance(browser, "appearance")
        self.advance(browser, "workspace")
        browser.restart()
        self.stage(browser, "workspace")
        self.assertTrue(browser.shell_call("settings.set", {"key": "tabs", "value": "top"})["ok"])
        browser.write_config('[options]\nhint_chars = "sdfjkl"\n')
        before = len(browser.tabs())
        self.advance(browser, "tutorial")
        self.lesson(browser)
        for filename in ("MerlinCoast.jpg", "MerlinNight.jpg"):
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
        wait_until(lambda: browser.scroll_y() > 0 and browser.eval(
            "document.querySelector('[href=\"#complete\"]').getBoundingClientRect().bottom <= innerHeight"),
            message="the real end-of-page shortcut to reveal the finish link")
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

    def test_skip_goes_straight_to_browser(self):
        browser = self.launch()
        self.advance(browser, "browse")
        self.stage(browser, "")
        browser.restart()
        self.stage(browser, "")
