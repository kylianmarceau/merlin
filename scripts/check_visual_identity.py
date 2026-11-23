#!/usr/bin/env python3
"""Offline branding boundary checks; --src also audits the applied Chromium tree."""
import argparse
import json
import re
import hashlib
from pathlib import Path
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET

import generate_design_tokens as tokens
import generate_identity_artwork as art
import rebrand_remaining_names as names
import rebrand_icons as icons
import generate_private_identity as private
import generate_devtools_identity as devtools
import generate_diagnostics_identity as diagnostics
import generate_autofill_headers as autofill
import generate_devtools_controls as devtools_controls
import generate_media_presentation as media
import generate_media_permission_layout as media_permission

ROOT=Path(__file__).resolve().parent.parent


class BrandingBoundaries(unittest.TestCase):
    def test_app_icon_choices_match_bundled_resources(self):
        shell = ROOT / 'packages/shell/macos'
        choices = re.findall(r'Variant\(id: "([^"]+)", name: "([^"]+)"\)',
                             (shell / 'AppIcons.swift').read_text())
        self.assertEqual(choices[0], ('default', 'Ice Blue'))
        self.assertEqual(len(choices), 8)
        expected = sorted(f'MerlinAppIcon-{id_}.png' for id_, _ in choices)
        self.assertEqual(sorted(p.name for p in (shell / 'AppIcons').glob('*.png')), expected)
        project = ROOT / 'apps/browser/macos/MerlinShell.xcodeproj/project.pbxproj'
        copied = re.findall(r'/(MerlinAppIcon-[a-z-]+\.png)"', project.read_text())
        self.assertEqual(sorted(copied), sorted(expected * 2))

    def test_generated_falcon_assets_are_current(self):
        for path, expected in art.merlin_mark.outputs(ROOT).items():
            with self.subTest(asset=str(path.relative_to(ROOT))):
                self.assertEqual(path.read_text(), expected)

    def test_native_falcon_coordinates_are_valid_float_literals(self):
        # Integer-valued coordinates must still have a decimal before C++'s f.
        for size in (15, 16, 24, 32, 96):
            with self.subTest(size=size):
                self.assertIsNone(re.search(r'(?<![\w.])\d+f\b', icons.vector_icon(size)))

    def test_product_text_only(self):
        before='''<!-- <message name="COMMENT">Chrome</message> -->
<message name="IDS_FIXTURE" desc="Chrome internal description">
Chrome blocked <ph name="CHROME_SITE">$1<ex>Chrome example</ex></ph>.
<ph name="LINK">&lt;a href="chrome://settings/"&gt;</ph>Chrome settings<ph name="END">&lt;/a&gt;</ph>
</message>'''
        result=names.transform(before)
        self.assertIn('Merlin blocked',result)
        self.assertIn('Merlin settings',result)
        for unchanged in ['<!-- <message name="COMMENT">Chrome</message> -->',
                          'desc="Chrome internal description"',
                          '<ph name="CHROME_SITE">$1<ex>Chrome example</ex></ph>',
                          'href="chrome://settings/"']:
            self.assertIn(unchanged,result)
        self.assertEqual(names.transform(result),result)

    def test_external_destination_keeps_name(self):
        message='<message name="IDS_DOWNLOAD_CHROME">Download Chrome</message>'
        self.assertEqual(names.transform(message),message)

    def test_warning_words_and_placeholders_are_preserved(self):
        message='<message name="IDS_FIXTURE">Chrome strongly recommends going back to safety. <ph name="SITE">$1<ex>example.com</ex></ph> may steal your passwords.</message>'
        self.assertEqual(names.transform(message),message.replace('>Chrome ', '>Merlin '))

    def test_artwork_keeps_distinct_warning_states(self):
        before='<svg xmlns="http://www.w3.org/2000/svg" width="316" height="112" viewBox="0 0 316 112"/>'
        for dark in (False,True):
            images={role:art.artwork(before,role,dark) for role in ('safe','error','compromised','running')}
            self.assertEqual(len(set(images.values())),4)
            for role,svg in images.items():
                self.assertEqual(ET.fromstring(svg).get('viewBox'),'0 0 316 112')
                if role in ('error','compromised'):
                    self.assertIn('#FF8A80' if dark else '#B3261E',svg)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path);a=p.parse_args()
    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(BrandingBoundaries))
    if not result.wasSuccessful():raise SystemExit(1)
    for path,expected in tokens.generate().items():
        if path.read_text()!=expected:raise SystemExit('stale generated tokens: '+str(path))
    if a.src:
        devtools.audit(a.src)
        diagnostics.audit(a.src)
        devtools_controls.audit(a.src)
        for path, (_, expected) in media.edits(a.src).items():
            if (a.src/path).read_text() != expected:
                raise SystemExit('media presentation hook changed: ' + path)
        if (a.src/media_permission.PATH).read_text() != media_permission.edit(a.src)[1]:
            raise SystemExit('cast-permission wrapping changed')
        for path, tone in autofill.HEADERS.items():
            current = (a.src/path).read_text()
            if 'MerlinBubbleHeaderOrDefault(' not in current or 'BubbleHeaderTone::' + tone not in current:
                raise SystemExit('stock autofill header: ' + path)
        expected_css=(ROOT/'branding/generated/merlin_webui_tokens.css').read_text()
        expected_css+='\n'+(ROOT/'branding/generated/merlin_component_tokens.css').read_text()
        if not (a.src/'ui/webui/resources/cr_elements/cr_shared_vars.css').read_text().endswith(expected_css):
            raise SystemExit('shared WebUI presentation tokens are not applied')
        bad,allowed=names.audit(a.src)
        if bad:raise SystemExit('\n'.join(bad))
        for path,role,dark in art.resources(a.src):
            original=subprocess.check_output(['git','-C',str(a.src),'show','HEAD:'+path],text=True)
            if (a.src/path).read_text()!=art.artwork(original,role,dark):raise SystemExit('stock/unexpected artwork: '+path)
        for path,expected in icons.WHOLE_FILES.items():
            if (a.src/path).read_text()!=expected:raise SystemExit('stock product artwork: '+path)
        for path,size in icons.ICON_FILES.items():
            if (a.src/path).read_text()!=icons.vector_icon(size):raise SystemExit('stock native product icon: '+path)
        for path in icons.FILES:
            current=(a.src/path).read_text()
            if icons.rebrand(current)[0]!=current:raise SystemExit('stock WebUI product icon: '+path)
        if (a.src/'chrome/browser/resources/password_manager/images/password_manager_logo.svg').read_text()!=art.merlin_mark.tile_svg():
            raise SystemExit('stock password manager product logo')
        known={path for path,_,_ in art.resources(a.src)}
        for directory in art.MANIFEST:
            for asset in (a.src/directory).glob('*.svg'):
                if any(word in asset.name for word in ('promo','banner','illustration')) and str(asset.relative_to(a.src)) not in known:
                    raise SystemExit('unreviewed promotional artwork: '+str(asset))
        for path,convert in private.resources(a.src):
            original=subprocess.check_output(['git','-C',str(a.src),'show','HEAD:'+path],text=True)
            if (a.src/path).read_text()!=convert(original):raise SystemExit('stock private artwork: '+path)
        for path,exception in json.loads((ROOT/'branding/artwork_exceptions.json').read_text()).items():
            if hashlib.sha256((a.src/path).read_bytes()).hexdigest()!=exception['sha256']:
                raise SystemExit('external artwork changed; review exception: '+path)
        print(f'Applied desktop name and artwork checks passed ({len(allowed)} explicit name exceptions).')
    print('Visual identity boundary checks passed.')

if __name__=='__main__':main()
