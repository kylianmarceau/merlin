#!/usr/bin/env python3
"""Exercise bundle assembly with tiny fixtures; no compiler, build or signing."""
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from assemble_react_app import assemble
from source_state import mismatch, source_state


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
        state = patch('assemble_react_app.source_state',
                      return_value={'sourceCommit': 'c' * 40, 'sourceChanges': None})
        state.start()
        self.addCleanup(state.stop)

    def test_manifest_records_the_source_commit(self):
        import json
        assemble(self.engine, self.shell, self.output)
        manifest = json.loads((self.output / 'Contents/Resources/merlin-shell-build.json').read_text())
        self.assertEqual(manifest['sourceCommit'], 'c' * 40)
        self.assertIsNone(manifest['sourceChanges'])

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
        self.assertNotIn('NSDockTilePlugIn', info)
        framework = self.output / 'Contents/Frameworks/Merlin Framework.framework'
        self.assertTrue((framework / 'Versions/Current').is_symlink())
        self.assertEqual((framework / 'Versions/Current/Helpers/fixture').read_text(), 'helper')

    def test_dock_tile_plugin_and_its_info_key_are_carried_over(self):
        plugin = self.shell / 'Contents/PlugIns/MerlinDockTile.plugin/Contents/MacOS'
        plugin.mkdir(parents=True)
        (plugin / 'MerlinDockTile').write_text('plug-in')
        info_path = self.shell / 'Contents/Info.plist'
        with info_path.open('rb') as stream:
            info = plistlib.load(stream)
        info['NSDockTilePlugIn'] = 'MerlinDockTile.plugin'
        with info_path.open('wb') as stream:
            plistlib.dump(info, stream)
        assemble(self.engine, self.shell, self.output)
        with (self.output / 'Contents/Info.plist').open('rb') as stream:
            self.assertEqual(plistlib.load(stream)['NSDockTilePlugIn'], 'MerlinDockTile.plugin')
        self.assertEqual((self.output / 'Contents/PlugIns/MerlinDockTile.plugin/Contents/MacOS/MerlinDockTile')
                         .read_text(), 'plug-in')

    def test_icon_assets_are_checked_against_the_copied_icons(self):
        import os
        import assemble_react_app
        repo = self.root / 'repo'
        icons = repo / 'overlay/chrome/app/theme/merlin/mac'
        icons.mkdir(parents=True)
        (repo / 'patches').mkdir()
        (repo / 'apps/browser/src').mkdir(parents=True)
        source = icons / 'Assets.car'
        source.write_text('new icon')
        framework = self.engine / 'Contents/Frameworks/Merlin Framework.framework/Versions/157/Merlin Framework'
        copied = self.engine / 'Contents/Resources/app.icns'
        os.utime(framework, (source.stat().st_mtime - 60,) * 2)
        with patch.object(assemble_react_app, 'REPO', repo):
            # Copied into the app after the change: current, though the framework is older.
            os.utime(copied, (source.stat().st_mtime + 1,) * 2)
            self.assertEqual(assemble_react_app.stale_engine_sources(self.engine, self.shell)[0], [])
            # Not copied yet: stale.
            os.utime(copied, (source.stat().st_mtime - 60,) * 2)
            self.assertEqual(assemble_react_app.stale_engine_sources(self.engine, self.shell)[0], [source])

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

    def test_products_older_than_their_sources_are_rejected(self):
        import os
        import assemble_react_app
        repo = self.root / 'repo'
        (repo / 'overlay').mkdir(parents=True)
        (repo / 'patches').mkdir()
        (repo / 'apps/browser/src').mkdir(parents=True)
        source = repo / 'overlay/bridge.mm'
        source.write_text('new code')
        framework = self.engine / 'Contents/Frameworks/Merlin Framework.framework/Versions/157/Merlin Framework'
        os.utime(framework, (source.stat().st_mtime - 60,) * 2)
        with patch.object(assemble_react_app, 'REPO', repo):
            with self.assertRaisesRegex(ValueError, 'engine is older than its sources'):
                assemble(self.engine, self.shell, self.output)
            self.assertFalse(self.output.exists())
            assemble(self.engine, self.shell, self.output, allow_stale=True)
            self.assertTrue(self.output.exists())


class SourceStateTest(unittest.TestCase):
    """The record e2e runs compare: commit plus a digest of uncommitted product changes."""

    def setUp(self):
        import subprocess
        temp = tempfile.TemporaryDirectory(prefix='merlin-source-state-')
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.git = lambda *args: subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                                                capture_output=True, text=True).stdout.strip()
        self.git('init', '-q')
        (self.repo / 'overlay').mkdir()
        (self.repo / 'overlay/engine.cc').write_text('one')
        (self.repo / 'tests').mkdir()
        (self.repo / 'tests/test_x.py').write_text('test')
        self.git('add', '.')
        self.git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'start')

    def test_clean_checkout_matches_itself(self):
        state = source_state(self.repo)
        self.assertEqual(state, {'sourceCommit': self.git('rev-parse', 'HEAD'), 'sourceChanges': None})
        self.assertIsNone(mismatch(dict(state), state))

    def test_changes_outside_product_sources_do_not_count(self):
        clean = source_state(self.repo)
        (self.repo / 'tests/test_x.py').write_text('edited test')
        (self.repo / 'notes.md').write_text('untracked note')
        self.assertEqual(source_state(self.repo), clean)

    def test_uncommitted_product_changes_are_digested(self):
        clean = source_state(self.repo)
        (self.repo / 'overlay/engine.cc').write_text('two')
        edited = source_state(self.repo)
        self.assertIsNotNone(edited['sourceChanges'])
        self.assertIn('assembled without', mismatch(clean, edited))
        self.assertIn('no longer has', mismatch(edited, clean))
        self.assertIsNone(mismatch(edited, source_state(self.repo)))
        (self.repo / 'overlay/new.cc').write_text('untracked')
        self.assertIn('differ', mismatch(edited, source_state(self.repo)))

    def test_other_commit_and_missing_records_are_refused(self):
        state = source_state(self.repo)
        self.assertIn('no assembly manifest', mismatch(None, state))
        self.assertIn('records no source commit', mismatch({'abi': 1}, state))
        self.assertIn('assembled from commit 0000000000', mismatch(
            {'sourceCommit': '0' * 40, 'sourceChanges': None}, state))


if __name__ == '__main__':
    unittest.main()
