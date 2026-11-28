"""Merlin's lean defaults, read from the running browser (M30).

Chromium's own pages report what the browser process holds:
chrome://prefs-internals/<name> a profile preference's value (the default
unless someone changed it), chrome://local-state the browser-wide ones, and
chrome://version the command line the feature list was built from, to which
Merlin adds its --disable-features. Hidden pages Chromium would keep loaded
(Tab Search, a prewarmed search page) would be DevTools targets.

A second instance with --modal-browser-upstream-defaults shows that the
checks see Merlin's changes, not values these Chromium pages always show.
"""

from __future__ import annotations

import json
import time
import unittest

from merlin_e2e import MerlinTestCase

# Features Merlin turns off at run time (merlin_process_policy.h).
DISABLED_FEATURES = ["Glic", "ApiGlicPrivate", "LensOverlay", "LensStandalone", "Compose",
                     "MediaRouter", "AIPromptAPI", "AISummarizationAPI", "AIWriterAPI",
                     "AIRewriterAPI", "AIProofreadingAPI", "MacAppCodeSignClone"]


class DefaultsCase(MerlinTestCase):
    # chrome://local-state is one of Chromium's debug pages, off until this
    # (chrome://chrome-urls' switch) is on; the profile is the test's own.
    local_state = {"internal_only_uis_enabled": True}

    def read_page(self, url: str, ready: str = "document.body && document.body.innerText.trim()") -> str:
        """Loads a Chromium page in the active tab and returns its text once `ready` holds."""
        session = self.browser.active_session()
        self.browser.cdp.call("Page.navigate", {"url": url}, session)
        return self.wait(lambda: self.browser.eval(f"location.href === {json.dumps(url)} && ({ready})", session)
                         and self.browser.eval("document.body.innerText", session), f"{url} to load")

    def profile_pref(self, name: str):
        return json.loads(self.read_page(f"chrome://prefs-internals/{name}"))

    def read_local_state(self) -> dict:
        # The page asks the browser for the JSON and writes it into a <pre>.
        self.read_page("chrome://local-state/",
                       "document.getElementById('content')?.textContent.trim().startsWith('{')")
        return json.loads(self.browser.eval("document.getElementById('content').textContent"))

    def local_pref(self, state: dict, name: str):
        node = state
        for part in name.split("."):
            node = node[part]
        return node["value"]

    def command_line(self) -> str:
        return self.read_page("chrome://version/", "document.getElementById('command_line')?.textContent")

    def disabled_features(self) -> set[str]:
        line = self.browser.eval("document.getElementById('command_line').textContent")
        found: set[str] = set()
        for part in line.split():
            if part.startswith("--disable-features="):
                found.update(part.split("=", 1)[1].split(","))
        return found

    def hidden_page_urls(self) -> list[str]:
        return [t["url"] for t in self.browser.cdp.targets()]


class LeanDefaultsTest(DefaultsCase):
    def test_profile_preferences(self) -> None:
        # New tabs are blank (the shell draws its start page over them), the
        # address field has no AI Mode entry, and Ctrl-Tab goes to the tab used last.
        self.assertEqual(self.profile_pref("newtab_page_location_override"), "about:blank")
        self.assertEqual(self.profile_pref("omnibox.ai_mode_settings"), 1)
        self.assertIs(self.profile_pref("browser.ctrl_tab_mru"), True)

    def test_browser_wide_preferences(self) -> None:
        state = self.read_local_state()
        # Memory Saver on (kEnabled), no on-device AI model download (kDisallowed),
        # and no running on after the last window closes.
        self.assertEqual(self.local_pref(state, "performance_tuning.high_efficiency_mode.state"), 2)
        self.assertEqual(self.local_pref(state, "optimization_guide.gen_ai_local_foundational_model_settings"), 1)
        self.assertIs(self.local_pref(state, "background_mode.enabled"), False)

    def test_gemini_lens_cast_and_ai_apis_are_off(self) -> None:
        self.command_line()
        missing = set(DISABLED_FEATURES) - self.disabled_features()
        self.assertFalse(missing, f"features left on: {sorted(missing)}")
        # Pages can't reach the built-in AI APIs.
        self.browser.open("/page")
        self.assertEqual(self.browser.eval(
            "['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'Proofreader'].filter(n => n in self)"), [])

    def test_no_field_trials(self) -> None:
        # disable_fieldtrial_testing_config: none of Chromium's test
        # experiments, and an unbranded build fetches no variations seed. The
        # only trials are client-side ones that need no seed: UKM's sampling
        # rate and, since Chromium 159, the client ID backup fix, which an
        # unbranded (unknown channel) build always puts in its Default group,
        # overriding no feature.
        self.read_page("chrome://version/?show-variations-cmd",
                       "document.getElementById('variations-cmd')?.textContent.includes('--')")
        self.assertTrue(self.browser.eval("document.getElementById('variations-seed-section').hidden"),
                        "a variations seed")
        line = self.browser.eval("document.getElementById('variations-cmd').textContent")
        self.assertIn("--disable-field-trial-config", line.split())
        forced = next((p for p in line.split() if p.startswith("--force-fieldtrials=")), "")
        trials = [t for t in forced.split("=", 1)[-1].strip('"').split("/")[::2] if t]
        self.assertEqual(sorted(trials), ["ClientIdBackupCorrectnessFix", "UkmSamplingRate"], line)
        self.assertIn("ClientIdBackupCorrectnessFix/Default/", forced, line)

    def test_no_hidden_search_or_tab_search_pages(self) -> None:
        # Switching tabs is what makes Chromium prewarm a search page.
        self.browser.command("tabnew")
        self.press("J")
        self.press("K")
        time.sleep(1)
        urls = self.hidden_page_urls()
        self.assertFalse([u for u in urls if "tab-search.top-chrome" in u], urls)
        self.assertFalse([u for u in urls if "/search/warmup" in u], urls)


class UpstreamDefaultsTest(DefaultsCase):
    """--modal-browser-upstream-defaults gives Chromium's own defaults back."""

    extra_args = ["--modal-browser-upstream-defaults"]

    def test_chromium_defaults_return(self) -> None:
        self.command_line()
        self.assertFalse(set(DISABLED_FEATURES) & self.disabled_features())


if __name__ == "__main__":
    unittest.main()
