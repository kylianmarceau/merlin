#!/usr/bin/env python3
"""The shell vocabulary is defined once: generated copies and native code follow it."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sync_shell_headers as sync


class ShellVocabularyTest(unittest.TestCase):
    def setUp(self):
        self.data = sync.load()

    def test_checked_in_copies_are_generated_from_the_table(self):
        self.assertEqual(sync.TS_OUT.read_text(), sync.typescript(self.data))
        self.assertEqual(sync.CC_OUT.read_text(), sync.cpp(self.data))
        self.assertEqual(sync.native_problems(self.data), [])

    def test_names_become_constants(self):
        self.assertEqual(sync.constant('modal.palette.text'), 'kModalPaletteText')
        self.assertEqual(sync.constant('hint_chars'), 'kHintChars')
        self.assertEqual(sync.constant('newTab'), 'kNewTab')
        self.assertEqual(sync.snake('downloadAction'), 'download_action')
        self.assertEqual(sync.plural('downloadAction'), 'downloadActions')
        self.assertEqual(sync.plural('security'), 'securities')
        self.assertEqual(sync.plural('paletteKey'), 'paletteKeys')

    def test_renaming_a_method_the_engine_handles_is_caught_in_native_code(self):
        renamed = copy.deepcopy(self.data)
        calls = renamed['methods']['calls']
        calls[calls.index('tabs.pin')] = 'tabs.setPinned'
        problems = sync.native_problems(renamed)
        self.assertTrue(any('shell::method::kTabsPin' in p for p in problems), problems)

    def test_renaming_a_value_native_code_uses_is_caught(self):
        renamed = copy.deepcopy(self.data)
        sides = renamed['enums']['splitSide']
        sides[sides.index('top')] = 'above'
        problems = sync.native_problems(renamed)
        self.assertTrue(any('shell::split_side::kTop' in p for p in problems), problems)

    def test_native_code_may_not_spell_a_method_name(self):
        with tempfile.TemporaryDirectory() as directory:
            overlay = Path(directory)
            (overlay / 'bridge.mm').write_text('if (name == "tabs.pin") {}\n'
                                               'Set("type", "omnibox.results");\n')
            with mock.patch.object(sync, 'OVERLAY', overlay), mock.patch.object(sync, 'ROOT', overlay):
                problems = sync.native_problems(self.data)
        self.assertEqual(problems, ['bridge.mm:1 spells "tabs.pin"; use shell::method::kTabsPin'])

    def test_malformed_tables_are_refused(self):
        for change in (lambda d: d['methods']['calls'].append('tabs.create'),
                       lambda d: d['methods']['calls'].append('Tabs.Create'),
                       lambda d: d['enums']['splitSide'].append('left'),
                       lambda d: d['methods'].pop('nativeOnly')):
            broken = copy.deepcopy(self.data)
            change(broken)
            with tempfile.NamedTemporaryFile('w', suffix='.json') as table:
                json.dump(broken, table)
                table.flush()
                with mock.patch.object(sync, 'VOCABULARY', Path(table.name)), self.assertRaises(SystemExit):
                    sync.load()


if __name__ == '__main__':
    unittest.main()
