#!/usr/bin/env python3
"""Add the React host's third-party notices to Chromium's credits, and check them.

    scripts/shell_notices.py --append-to credits.html    # add (or replace) the section
    scripts/shell_notices.py --check credits.html        # fail if a required credit is missing

Chromium's credits (scripts/licenses.sh) cover the engine and its Rust
crates. The shipped app also contains the React Native host. This adds:

- Merlin's NOTICE, which credits the code adapted from Ardia;
- every production npm package (`pnpm licenses list --prod --json` in
  apps/browser), with the licence file from its package;
- the CocoaPods the host links, Hermes and SocketRocket among them, from
  CocoaPods' generated acknowledgements.

scripts/package_mac.sh runs both on the copy it puts in the DMG, so the
credits describe the host being packaged.
"""
from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import subprocess
import sys
from html import escape
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ACKNOWLEDGEMENTS = REPO / ('apps/browser/macos/Pods/Target Support Files/Pods-MerlinShell-macOS/'
                           'Pods-MerlinShell-macOS-acknowledgements.plist')
SECTION = 'merlin-shell-notices'
# Credits a release must carry: the shell's main components and adapted code.
REQUIRED = {
    'React Native': r'react-native-macos',
    'Hermes': r'hermes-engine',
    'Zustand': r'>zustand<',
    'SocketRocket': r'>SocketRocket<',
    'Expo': r'>expo-modules-core<',
    'Ardia': r'Ardia\s+\(https://github\.com/ardia-browser/ardia\)',
    'Chromium': r'Chromium',
}
MIT = """Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE."""
BSD_2 = """Redistribution and use in source and binary forms, with or without modification, are permitted provided
that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the
   following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
   the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE."""
# For packages that declare one of these licences but ship no licence file.
STANDARD_TEXTS = {'MIT': MIT, 'BSD-2-Clause': BSD_2}
LICENCE_FILES = re.compile(r'^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$', re.I)


def installed_packages() -> dict[tuple[str, str], Path]:
    """{(name, version): directory} for every package in the workspace's node_modules.

    pnpm's `paths` name its virtual store, which the hoisted node linker
    (pnpm-workspace.yaml) doesn't create, so packages are found by name and
    version instead.
    """
    found = {}
    roots = [REPO / 'node_modules', *REPO.glob('apps/*/node_modules'), *REPO.glob('packages/*/node_modules')]
    for root in roots:
        for top, dirs, files in os.walk(root):
            here = Path(top)
            if 'package.json' in files and (here.parent.name == 'node_modules' or
                                            (here.parent.name.startswith('@') and
                                             here.parent.parent.name == 'node_modules')):
                try:
                    manifest = json.loads((here / 'package.json').read_text())
                    found.setdefault((manifest['name'], manifest['version']), here)
                except (ValueError, KeyError, OSError):
                    pass
            dirs[:] = [d for d in dirs if d == 'node_modules' or here.name == 'node_modules'
                       or (here.name.startswith('@') and here.parent.name == 'node_modules')]
    return found


def npm_packages(pnpm_json: Path | None) -> list[dict]:
    if pnpm_json:
        data = json.loads(pnpm_json.read_text())
    else:
        output = subprocess.run(['pnpm', 'licenses', 'list', '--prod', '--json'], cwd=REPO / 'apps/browser',
                                check=True, capture_output=True, text=True).stdout
        data = json.loads(output)
    installed = installed_packages()
    packages = []
    for licence, entries in data.items():
        for entry in entries:
            texts = []
            for version in entry.get('versions', []):
                directory = installed.get((entry['name'], version))
                if not directory:
                    continue
                for item in sorted(directory.iterdir()):
                    if item.is_file() and LICENCE_FILES.match(item.name):
                        text = item.read_text(errors='replace')
                        if text not in texts:
                            texts.append(text)
            if not texts:
                standard = STANDARD_TEXTS.get(licence)
                holder = entry.get('author') or f'the {entry["name"]} authors'
                texts.append(f'The package includes no licence file; its package.json declares {licence}.\n\n' +
                             (f'Copyright (c) {holder}\n\n{standard}' if standard else
                              f'See {entry.get("homepage") or "the package"} for the licence text.'))
            packages.append({'name': entry['name'], 'versions': entry.get('versions', []), 'licence': licence,
                             'homepage': entry.get('homepage') or '', 'texts': texts})
    return sorted(packages, key=lambda package: package['name'])


def pods(acknowledgements: Path) -> list[dict]:
    specifiers = plistlib.loads(acknowledgements.read_bytes())['PreferenceSpecifiers']
    return [{'name': item['Title'], 'licence': item.get('License') or '', 'text': item.get('FooterText', '')}
            for item in specifiers if item.get('Title') and item.get('Title') != 'Acknowledgements']


def fragment(notice: str, packages: list[dict], linked_pods: list[dict]) -> str:
    parts = [f'<section id="{SECTION}"><h2>Merlin\'s interface (React Native host)</h2>',
             '<h3>NOTICE</h3><pre>' + escape(notice) + '</pre>',
             '<h3>CocoaPods</h3>']
    for pod in linked_pods:
        parts.append(f'<h4>{escape(pod["name"])}</h4><p>{escape(pod["licence"])}</p>'
                     f'<pre>{escape(pod["text"])}</pre>')
    parts.append('<h3>npm packages</h3>')
    for package in packages:
        link = (f' <a href="{escape(package["homepage"], quote=True)}">{escape(package["homepage"])}</a>'
                if package['homepage'].startswith(('https://', 'http://')) else '')
        parts.append(f'<h4>{escape(package["name"])}</h4><p>{escape(", ".join(package["versions"]))} · '
                     f'{escape(package["licence"])}{link}</p>')
        for text in package['texts']:
            parts.append(f'<pre>{escape(text)}</pre>')
    parts.append('</section>')
    return ''.join(parts)


def append(credits: Path, section: str) -> None:
    existing = credits.read_text()
    start = existing.find(f'<section id="{SECTION}">')
    if start >= 0:  # replace an earlier copy rather than repeat it
        end = existing.index('</section>', start) + len('</section>')
        existing = existing[:start] + existing[end:]
    end = existing.lower().rfind('</body>')
    if end < 0:
        if '<body' not in existing.lower():
            raise SystemExit('shell_notices: credits document has no body')
        end = len(existing)  # Chromium omits the optional closing tags
    credits.write_text(existing[:end] + section + existing[end:])


def missing(credits: Path) -> list[str]:
    text = credits.read_text()
    return [name for name, pattern in REQUIRED.items() if not re.search(pattern, text)]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--append-to', type=Path)
    parser.add_argument('--check', type=Path)
    parser.add_argument('--pnpm-json', type=Path, help='saved `pnpm licenses list --prod --json` output')
    parser.add_argument('--acknowledgements', type=Path, default=ACKNOWLEDGEMENTS)
    args = parser.parse_args()
    if not (args.append_to or args.check):
        parser.error('provide --append-to or --check')
    if args.append_to:
        if not args.acknowledgements.is_file():
            parser.exit(1, f'shell_notices: no {args.acknowledgements}; run scripts/build_react_shell.sh\n')
        packages = npm_packages(args.pnpm_json)
        linked = pods(args.acknowledgements)
        append(args.append_to, fragment((REPO / 'NOTICE').read_text(), packages, linked))
        print(f'shell notices: NOTICE, {len(linked)} pods, {len(packages)} npm packages')
    if args.check:
        absent = missing(args.check)
        if absent:
            parser.exit(1, f'shell_notices: {args.check} has no credit for {", ".join(absent)}\n')
        print(f'notices include {", ".join(REQUIRED)}')


if __name__ == '__main__':
    sys.exit(main())
