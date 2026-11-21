"""First launch, interrupted setup, upgrade and the bundled keyboard lesson."""
import unittest

from merlin_e2e import Merlin, PageServer, wait_until


class WelcomeTests(unittest.TestCase):
    def launch(self, **kwargs):
        server = PageServer()
        self.addCleanup(server.close)
        browser = Merlin(server, first_run=True, **kwargs)
        self.addCleanup(browser.close)
        return browser

    def test_resume_practise_and_relaunch(self):
        browser = self.launch()
        wait_until(lambda: browser.snapshot().get("welcome") == "appearance", message="intro to finish")
        browser.restart()
        self.assertEqual(browser.snapshot()["welcome"], "appearance")
        browser.write_config('[options]\nhint_chars = "sdfjkl"\n')
        appearance = dict(browser.snapshot()["appearance"], mode="dark", accent="ocean")
        self.assertTrue(browser.shell_call("appearance.set", appearance)["ok"])
        self.assertTrue(browser.shell_call("welcome.advance", {"next": "tutorial"})["ok"])
        wait_until(lambda: browser.active_tab()["url"].endswith("/MerlinTutorial.html"), message="local tutorial")
        wait_until(lambda: browser.eval("document.title") == "Link hints · Merlin", message="tutorial to load")
        browser.press("f")
        hints = wait_until(lambda: browser.snapshot()["modal"].get("hints"), message="real link hints")
        before = len(browser.tabs())
        browser.press(hints[0]["label"].lower())
        wait_until(lambda: len(browser.tabs()) == before + 1 and browser.active_tab()["url"] == "about:blank",
                   message="hint to open the new tab")
        browser.restart()
        self.assertEqual(browser.snapshot()["welcome"], "")
        self.assertEqual(browser.snapshot()["appearance"], appearance)

    def test_upgrade_can_replay_without_running_setup(self):
        browser = self.launch(existing_profile=True)
        self.assertEqual(browser.snapshot()["welcome"], "")
        self.assertTrue(browser.shell_call("welcome.advance", {"next": "tutorial"})["ok"])
        wait_until(lambda: browser.active_tab()["url"].endswith("/MerlinTutorial.html"), message="tutorial replay")
        browser.restart()
        self.assertEqual(browser.snapshot()["welcome"], "")

    def test_skip_goes_straight_to_browser(self):
        browser = self.launch()
        self.assertTrue(browser.shell_call("welcome.advance", {"next": "browse"})["ok"])
        self.assertEqual(browser.snapshot()["welcome"], "")
        browser.restart()
        self.assertEqual(browser.snapshot()["welcome"], "")

    def test_import_opens_the_existing_importer(self):
        browser = self.launch()
        self.assertTrue(browser.shell_call("welcome.advance", {"next": "import"})["ok"])
        wait_until(lambda: browser.active_tab()["url"] == "chrome://settings/importData",
                   message="the bookmark importer to open")
        self.assertEqual(browser.snapshot()["welcome"], "")
