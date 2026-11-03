#!/usr/bin/env python3
"""Narrow DevTools presentation patch against Chromium's pinned git dependency."""
import argparse
import difflib
import json
from pathlib import Path
import re
import subprocess
from functools import lru_cache

from generate_design_tokens import DATA, ROOT

PREFIX = 'third_party/devtools-frontend/src'
PATCH = ROOT / 'patches/0039-merlin-devtools-presentation.patch'
MANIFEST = json.loads((ROOT / 'branding/devtools_strings.json').read_text())


def stylesheet():
    aliases = {
        'base': 'base', 'surface': 'surface', 'surface-variant': 'base_container',
        'base-container': 'base_container', 'base-container-elevated': 'base_elevated',
        'cdt-base-container': 'base_container', 'neutral-container': 'base_container',
        'on-surface': 'on_surface', 'on-surface-subtle': 'on_surface_subtle',
        'on-surface-secondary': 'on_surface_subtle', 'on-surface-primary': 'on_surface',
        'primary': 'primary', 'on-primary': 'on_primary',
        'tonal-container': 'primary_container', 'on-tonal-container': 'on_primary_container',
        'outline': 'outline', 'neutral-outline': 'outline', 'divider': 'divider',
        'on-base': 'on_surface', 'on-base-divider': 'divider',
        **{f'surface{i}': 'base_elevated' if i >= 3 else 'base_container' for i in range(1, 6)},
    }
    result = '\n/* Merlin: generated neutral/accent tokens. Semantic and syntax colors stay upstream. */\n'
    result += '@media (forced-colors: none) and (prefers-contrast: no-preference) {\n'
    for mode in ('light', 'dark'):
        selector = ':root.merlin-default-theme' + ('.theme-with-dark-background' if mode == 'dark' else '')
        result += selector + ' {\n'
        result += ''.join(f'  --sys-color-{key}: {DATA["native"][mode][value]};\n' for key, value in aliases.items())
        result += f'  --default-font-family: {DATA["font"]};\n'
        result += f'  --sys-shape-corner-small: {DATA["metrics"]["control_radius"]}px;\n'
        result += f'  --sys-shape-corner-medium: {DATA["metrics"]["card_radius"]}px;\n'
        result += '}\n'
    return result + '}\n'


def generate(src):
    revision = subprocess.check_output(['git', '-C', str(src), 'rev-parse', 'HEAD:' + PREFIX], text=True).strip()
    dep = src / PREFIX
    @lru_cache(maxsize=None)
    def original(path):
        return subprocess.check_output(['git', '-C', str(dep), 'show', revision + ':' + path], text=True)
    changes = {}
    for item in MANIFEST:
        if 'replacement' not in item:
            continue
        path = item['file']
        before, after = changes.get(path, (original(path), original(path)))
        # The exact UIStrings property and original text must both match. All
        # placeholders, markup and protocol literals retain their original bytes.
        pattern = r'(\b' + re.escape(item['key']) + r':\s*)([\'"`])((?:\\.|[^\\])*?)\2'
        def replace(match):
            literal = match.group(3)
            decoded = literal.replace("\\'", "'").replace('\\"', '"').replace('\\`', '`')
            if decoded != item['value']:
                raise ValueError('DevTools source text changed: ' + path + ':' + item['key'])
            value = item['replacement'].replace('\\', '\\\\').replace(match.group(2), '\\' + match.group(2))
            return match.group(1) + match.group(2) + value + match.group(2)
        after, count = re.subn(pattern, replace, after, count=1)
        if count != 1:
            raise ValueError('missing DevTools string: ' + path + ':' + item['key'])
        changes[path] = before, after
    # DevTools keys are stable rather than source-text hashes. Remove stale
    # translations for changed keys so the upstream i18n layer falls back to
    # the new source string, instead of displaying the old product name.
    keys = {x['file'].removeprefix('front_end/') + ' | ' + x['key'] for x in MANIFEST if 'replacement' in x}
    for file in sorted((dep / 'front_end/core/i18n/locales').glob('*.json')):
        path = file.relative_to(dep).as_posix()
        before = original(path)
        after = before
        for key in sorted(keys):
            pattern = r'^  ' + re.escape(json.dumps(key)) + r': \{\n    "message": [^\n]*\n  \},?\n'
            after = re.sub(pattern, '', after, flags=re.M)
        after = re.sub(r',\n\}\n$', '\n}\n', after)
        json.loads(after)
        if before != after:
            changes[path] = before, after
    path = 'front_end/design_system_tokens.css'
    before = original(path)
    changes[path] = before, before + stylesheet()
    path = 'front_end/ui/legacy/theme_support/ThemeSupport.ts'
    before = original(path)
    needle = '    const isIncognito = Root.Runtime.hostConfig.isOffTheRecord === true;'
    if before.count(needle) != 1:
        raise ValueError('DevTools theme host hook changed')
    changes[path] = before, before.replace(needle, needle + '''
    // Keep explicit DevTools theme choices, custom host themes and forced colors.
    const merlinDefault = getComputedStyle(document.body).getPropertyValue('--user-color-source').trim();
    document.documentElement.classList.toggle(
        'merlin-default-theme', useChromeTheme && !isForcedColorsMode &&
            (isIncognito || merlinDefault === 'baseline-default'));''')
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                    fromfile='a/' + PREFIX + '/' + path, tofile='b/' + PREFIX + '/' + path))
                   for path, (a, b) in sorted(changes.items()))


def audit(src):
    node = src / 'third_party/node/mac_arm64/node-darwin-arm64/bin/node'
    if not node.exists():
        node = 'node'
    found = json.loads(subprocess.check_output([str(node), str(ROOT / 'scripts/audit_devtools_strings.cjs'), str(src)], text=True))
    expected = {(x['file'], x['key']): x for x in MANIFEST}
    for item in found:
        entry = expected.pop((item['file'], item['key']), None)
        if not entry or item['value'] != entry.get('replacement', entry['value']):
            raise ValueError('unreviewed DevTools product text: ' + item['file'] + ':' + item['key'])
    if expected:
        raise ValueError('DevTools strings disappeared: ' + str(list(expected)))
    for file in (src / PREFIX / 'front_end/core/i18n/locales').glob('*.json'):
        catalog = json.loads(file.read_text())
        for item in MANIFEST:
            if 'replacement' in item and item['file'].removeprefix('front_end/') + ' | ' + item['key'] in catalog:
                raise ValueError('stale DevTools translation: ' + str(file))
    if not (src / PREFIX / 'front_end/design_system_tokens.css').read_text().endswith(stylesheet()):
        raise ValueError('DevTools shared tokens are stale')
    print(f'DevTools presentation audit passed ({len(MANIFEST)} strings, exact external/compatibility exceptions).')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    p.add_argument('--audit', action='store_true')
    args = p.parse_args()
    if args.audit:
        audit(args.src)
    else:
        content = generate(args.src)
        if args.check:
            if PATCH.read_text() != content:
                raise SystemExit('DevTools identity patch is stale')
        else:
            PATCH.write_text(content)
        print('DevTools identity patch: current' if args.check else 'DevTools identity patch: generated')


if __name__ == '__main__':
    main()
