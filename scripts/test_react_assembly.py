#!/usr/bin/env python3
"""Exercise bundle assembly with tiny fixtures; no compiler, build or signing."""
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from assemble_react_app import assemble


class AssemblyTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='merlin-assembly-test-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.engine = self.root / 'engine/Merlin.app'
        self.shell = self.root / 'shell/MerlinShell.app'
        self.output = self.root / 'result/Merlin.app'
        for app, executable, version in ((self.engine, 'Merlin', '13.0'), (self.shell, 'MerlinShell', '14.0')):
            (app / 'Contents/MacOS').mkdir(parents=True)
            (app / 'Contents/Resources').mkdir()
            (app / 'Contents/Frameworks').mkdir()
            binary = app / 'Contents/MacOS' / executable
            binary.write_text(executable)
            binary.chmod(0o755)
            with (app / 'Contents/Info.plist').open('wb') as stream:
                plistlib.dump({'CFBundleIdentifier': 'io.github.kylianmarceau.merlin',
                    'CFBundleExecutable': executable, 'CFBundleShortVersionString': '157.0',
                    'LSMinimumSystemVersion': version, 'NSCameraUsageDescription': 'Camera access'}, stream)
        framework = self.engine / 'Contents/Frameworks/Merlin Framework.framework'
        (framework / 'Versions/157/Helpers').mkdir(parents=True)
        (framework / 'Versions/157/Merlin Framework').write_text('engine')
        (framework / 'Versions/Current').symlink_to('157')
        (framework / 'Merlin Framework').symlink_to('Versions/Current/Merlin Framework')
        (framework / 'Versions/157/Helpers/fixture').write_text('helper')
        (self.shell / 'Contents/Frameworks/hermes.framework').mkdir()
        (self.shell / 'Contents/Resources/main.jsbundle').write_text('bundle')
        (self.engine / 'Contents/Resources/app.icns').write_text('icon')
        # Symbol validation is independent of filesystem assembly and requires
        # real built Mach-O products. Keep it mocked so tests never compile.
        symbols = patch('assemble_react_app.require_symbols')
        symbols.start()
        self.addCleanup(symbols.stop)

    def test_assembly_preserves_identity_helpers_and_sources(self):
        assemble(self.engine, self.shell, self.output)
        with (self.output / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        self.assertEqual(info['CFBundleExecutable'], 'Merlin')
        self.assertEqual(info['LSMinimumSystemVersion'], '14.0')
        self.assertEqual(info['NSCameraUsageDescription'], 'Camera access')
        self.assertEqual((self.output / 'Contents/MacOS/Merlin').read_text(), 'MerlinShell')
        self.assertTrue((self.output / 'Contents/MacOS/Merlin').stat().st_mode & 0o111)
        self.assertEqual((self.engine / 'Contents/MacOS/Merlin').read_text(), 'Merlin')
        self.assertFalse((self.engine / 'Contents/Resources/main.jsbundle').exists())
        self.assertEqual((self.output / 'Contents/Resources/app.icns').read_text(), 'icon')
        framework = self.output / 'Contents/Frameworks/Merlin Framework.framework'
        self.assertTrue((framework / 'Versions/Current').is_symlink())
        self.assertEqual((framework / 'Versions/Current/Helpers/fixture').read_text(), 'helper')

    def test_collision_leaves_no_partial_output(self):
        (self.shell / 'Contents/Resources/app.icns').write_text('wrong icon')
        with self.assertRaisesRegex(ValueError, 'Conflicting resource'):
            assemble(self.engine, self.shell, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.engine / 'Contents/Resources/app.icns').read_text(), 'icon')

    def test_component_engine_and_existing_destination_are_rejected(self):
        (self.engine.parent / 'args.gn').write_text('is_component_build = true\n')
        with self.assertRaisesRegex(ValueError, 'non-component'):
            assemble(self.engine, self.shell, self.output)
        self.assertFalse(self.output.exists())
        self.output.mkdir(parents=True)
        (self.output / 'keep').write_text('user file')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            assemble(self.engine, self.shell, self.output)
        self.assertEqual((self.output / 'keep').read_text(), 'user file')


if __name__ == '__main__':
    unittest.main()
