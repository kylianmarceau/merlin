#!/usr/bin/env python3
"""The shipped credits name the React host's components and Ardia (M26, C18)."""
import tempfile
import unittest
from pathlib import Path

import shell_notices


class ShellNoticesTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='merlin-notices-test-')
        self.addCleanup(temp.cleanup)
        self.credits = Path(temp.name) / 'credits.html'
        # Chromium's credits leave out the optional closing tags.
        self.credits.write_text('<!doctype html><body><h1>Chromium</h1>')
        packages = [{'name': name, 'versions': ['1.0.0'], 'licence': 'MIT', 'homepage': 'https://example.org',
                     'texts': ['MIT text']} for name in ('react-native-macos', 'zustand', 'expo-modules-core')]
        pods = [{'name': name, 'licence': 'MIT', 'text': 'pod text'} for name in ('hermes-engine', 'SocketRocket')]
        self.section = shell_notices.fragment((shell_notices.REPO / 'NOTICE').read_text(), packages, pods)

    def test_chromium_credits_alone_miss_the_shell(self):
        self.assertEqual(shell_notices.missing(self.credits),
                         ['React Native', 'Hermes', 'Zustand', 'SocketRocket', 'Expo', 'Ardia'])

    def test_appended_credits_are_complete_and_appear_once(self):
        shell_notices.append(self.credits, self.section)
        shell_notices.append(self.credits, self.section)
        self.assertEqual(shell_notices.missing(self.credits), [])
        self.assertEqual(self.credits.read_text().count('id="merlin-shell-notices"'), 1)

    def test_notice_credits_ardias_new_home(self):
        notice = (shell_notices.REPO / 'NOTICE').read_text()
        self.assertIn('https://github.com/ardia-browser/ardia', notice)
        self.assertNotIn('mantrakp04', notice)


if __name__ == '__main__':
    unittest.main()
