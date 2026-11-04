"""Offline regressions for Stable identity checks and browser-suite selection."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import check_upstream

ROOT = Path(__file__).resolve().parents[1]
PIN = "157.0.8103.26"
COMMIT = "a" * 40


class UpstreamCheckerTest(unittest.TestCase):
    def run_check(self, version=PIN, commit=COMMIT, *, json_output=False,
                  channel="Stable", platform="Mac", failure=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "UPSTREAM_PIN").write_text(f"tag: {PIN}\ncommit: {COMMIT}\n")
            payload = [{"version": version, "channel": channel,
                        "platform": platform, "hashes": {"chromium": commit}}]
            output, errors = io.StringIO(), io.StringIO()
            with (mock.patch.object(check_upstream, "ROOT", root),
                  mock.patch.object(sys, "argv", ["check_upstream.py"] +
                                    (["--json"] if json_output else [])),
                  mock.patch.object(check_upstream.urllib.request, "urlopen",
                                    side_effect=failure,
                                    return_value=io.BytesIO(json.dumps(payload).encode())),
                  contextlib.redirect_stdout(output),
                  contextlib.redirect_stderr(errors)):
                code = check_upstream.main()
            return code, output.getvalue(), errors.getvalue()

    def test_only_exact_version_and_commit_are_current(self):
        code, output, errors = self.run_check()
        self.assertEqual(code, 0)
        self.assertIn("matches current Mac Stable", output)
        self.assertEqual(errors, "")

    def test_behind_needs_an_update(self):
        code, output, _ = self.run_check("157.0.8103.40")
        self.assertEqual(code, 1)
        self.assertIn("Rebase due", output)

    def test_ahead_is_not_misreported_as_current(self):
        code, output, _ = self.run_check("156.0.8078.80")
        self.assertEqual(code, 2)
        self.assertIn("ahead", output)
        self.assertNotIn("Up to date", output)

    def test_same_version_with_different_commit_is_unconfirmed(self):
        code, output, _ = self.run_check(commit="b" * 40)
        self.assertEqual(code, 2)
        self.assertIn("Commit mismatch", output)

    def test_json_preserves_rebase_signal_and_exposes_identity(self):
        for version, commit, status, expected_code in [
            (PIN, COMMIT, "current", 0),
            ("157.0.8103.40", "b" * 40, "behind", 1),
            ("156.0.8078.80", "b" * 40, "ahead", 2),
            (PIN, "b" * 40, "commit_mismatch", 2),
        ]:
            with self.subTest(status=status):
                code, output, _ = self.run_check(version, commit, json_output=True)
                result = json.loads(output)
                self.assertEqual(code, expected_code)
                self.assertEqual(result["status"], status)
                self.assertEqual(result["rebase_due"], status == "behind")
                self.assertEqual(result["pinned_commit"], COMMIT)

    def test_wrong_channel_platform_and_missing_identity_fail_closed(self):
        for kwargs in [{"channel": "Beta"}, {"platform": "Windows"},
                       {"commit": ""}, {"version": "not-a-version"}]:
            with self.subTest(kwargs=kwargs):
                code, output, errors = self.run_check(json_output=True, **kwargs)
                self.assertEqual(code, 2)
                self.assertEqual(json.loads(output)["status"], "error")
                self.assertIsNone(json.loads(output)["rebase_due"])
                self.assertIn("could not check", errors)

    def test_network_failure_is_not_a_successful_check(self):
        code, output, _ = self.run_check(json_output=True, failure=OSError("offline"))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)["status"], "error")

    def test_newest_stable_is_selected_numerically(self):
        payload = [{"version": v, "channel": "Stable", "platform": "Mac",
                    "hashes": {"chromium": c}} for v, c in
                   [("157.0.8103.9", "b" * 40), (PIN, COMMIT)]]
        with mock.patch.object(check_upstream.urllib.request, "urlopen",
                               return_value=io.BytesIO(json.dumps(payload).encode())):
            self.assertEqual(check_upstream.latest(), (PIN, COMMIT))


class BrowserRunnerTest(unittest.TestCase):
    def run_runner(self, *args):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "src/out/Modal/browser_tests"
            binary.parent.mkdir(parents=True)
            binary.write_text("#!/usr/bin/env python3\nimport json, os, sys\n"
                              "print(json.dumps({'args': sys.argv[1:], "
                              "'background': os.environ.get('MODAL_TESTS_IN_BACKGROUND')}))\n")
            binary.chmod(0o755)
            result = subprocess.run(
                ["/bin/bash", str(ROOT / "scripts/run_browser_tests.sh"), *args],
                env={**os.environ, "CHROMIUM_DIR": directory},
                capture_output=True, text=True, check=True)
            return json.loads(result.stdout)

    def test_default_runs_all_merlin_suites_with_merlin_ui(self):
        result = self.run_runner()
        filters = next(a.split("=", 1)[1] for a in result["args"]
                       if a.startswith("--gtest_filter="))
        self.assertEqual(set(filters.split(":")), {
            "ModalBrowserBrowserTest.*", "MerlinAdblock*BrowserTest.*",
            "MerlinIdentityBrowserTest.*"})
        self.assertNotIn("--modal-browser-upstream-defaults", result["args"])
        self.assertEqual(result["background"], "1")

    def test_explicit_identity_suite_keeps_merlin_ui_and_extra_arguments(self):
        result = self.run_runner("MerlinIdentityBrowserTest.*", "--gtest_repeat=2")
        self.assertNotIn("--modal-browser-upstream-defaults", result["args"])
        self.assertIn("--gtest_repeat=2", result["args"])

    def test_upstream_geometry_settings_remain_suite_specific(self):
        find = self.run_runner("FindInPageControllerTest.*")["args"]
        view = self.run_runner("BrowserViewTest.*")["args"]
        self.assertIn("--modal-browser-upstream-defaults", find)
        self.assertIn("--window-size=1280,900", find)
        self.assertIn("--modal-browser-upstream-defaults", view)
        self.assertFalse(any(a.startswith("--window-size=") for a in view))


if __name__ == "__main__":
    unittest.main()
