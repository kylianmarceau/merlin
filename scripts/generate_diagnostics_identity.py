#!/usr/bin/env python3
"""Replace diagnostic product decoration without changing protocols or messages' risk."""
import argparse
import difflib
from pathlib import Path
from urllib.parse import quote
from generate_design_tokens import ROOT, DATA
from generate_password_headers import base
from generate_devtools_identity import PREFIX
import merlin_mark

PATCH = '0042-merlin-diagnostic-decoration.patch'


def edits(src):
    changes = {}
    for path in ('chrome/browser/ai/ai_manager.cc', 'chrome/browser/ai/ai_manager_unittest.cc'):
        before = base(src, path, PATCH)
        needle = 'On-device AI is disabled in Chrome settings.'
        if before.count(needle) != 1:
            raise ValueError('AI diagnostic presentation changed: ' + path)
        changes[path] = before, before.replace(needle, 'On-device AI is disabled in Merlin settings.')
    def original(path):
        return base(src, PREFIX + '/' + path, PATCH)
    path = 'front_end/panels/settings/AISettingsTab.ts'
    before = original(path)
    needle = "'Gemini in Chrome DevTools'"
    if before.count(needle) != 1:
        raise ValueError('AI feature label changed')
    changes[PREFIX + '/' + path] = before, before.replace(needle, "'Gemini in Merlin DevTools'")
    path = 'front_end/Images/src/devtools.svg'
    before = original(path)
    changes[PREFIX + '/' + path] = before, merlin_mark.tile_svg()
    path = 'front_end/panels/layer_viewer/Layers3DView.ts'
    before = original(path)
    after = before
    # The Layers tool's optional mock browser frame is decorative artwork.
    # Keep enum/method names, projection, textures and actual layer data.
    for part, width in (('Left', 120), ('Middle', 16), ('Right', 72)):
        palette = DATA['native']['light']
        content = ''
        if part == 'Left':
            content = merlin_mark.glyph(78, 28, 24, palette['on_surface'])
            content += '<circle cx="18" cy="18" r="4" fill="' + palette['outline'] + '"/>'
            content += '<circle cx="34" cy="18" r="4" fill="' + palette['outline'] + '"/>'
            content += '<circle cx="50" cy="18" r="4" fill="' + palette['outline'] + '"/>'
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="72" viewBox="0 0 {width} 72"><rect width="{width}" height="72" fill="{palette["header"]}"/>{content}<path d="M0 71.5H{width}" stroke="{palette["divider"]}"/></svg>'
        needle = "'Images/chrome" + part + ".avif'"
        if after.count(needle) != 1:
            raise ValueError('Layers mock browser frame changed')
        after = after.replace(needle, "'data:image/svg+xml," + quote(svg, safe='') + "'")
    changes[PREFIX + '/' + path] = before, after
    return changes


def generate(src):
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                   fromfile='a/' + path, tofile='b/' + path)) for path, (a,b) in edits(src).items())


def audit(src):
    for path, (_, expected) in edits(src).items():
        if (src / path).read_text() != expected:
            raise ValueError('diagnostic product decoration changed: ' + path)
    print('Diagnostic decoration audit passed.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('diagnostic decoration patch is stale')
    else:
        target.write_text(content)
    print('Diagnostic decoration patch: current' if a.check else 'Diagnostic decoration patch: generated')


if __name__ == '__main__':
    main()
