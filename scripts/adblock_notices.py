#!/usr/bin/env python3
"""Render native-blocker source provenance and notices for app distribution."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
parser.add_argument('--append-to', type=Path)
parser.add_argument('--bundle-dir', type=Path)
args = parser.parse_args()
if not any((args.output, args.append_to, args.bundle_dir)):
    parser.error('provide --output, --append-to or --bundle-dir')
repo = Path(__file__).resolve().parent.parent
root = repo / 'overlay/components/merlin_adblock/resources'
manifest = json.loads((root / 'manifest.json').read_text())
assets = manifest['sources'] + [manifest['resources']]
for asset in assets:
    if hashlib.sha256((root / asset['file']).read_bytes()).hexdigest() != asset['sha256']:
        raise SystemExit('bundled digest mismatch: ' + asset['file'])

escape = html.escape
parts = ['<section id="merlin-adblock-notices"><h1>Merlin native ad blocker</h1>',
         '<p>Engine: Brave adblock ' + escape(manifest['engine']) +
         '. Snapshot: ' + escape(manifest['retrieved']) + '.</p>',
         '<pre>' + escape((root / 'NOTICE.md').read_text()) + '</pre>',
         '<h2>Filter sources</h2><table><tr><th>Source</th><th>Revision</th>'
         '<th>License</th><th>Snapshot SHA-256</th></tr>']
for source in manifest['sources']:
    parts.append('<tr><td><a href="' + escape(source['url'], quote=True) + '">' +
                 escape(source['title']) + '</a></td><td>' + escape(source['revision']) +
                 '</td><td>' + escape(source['license']) + '</td><td><code>' +
                 escape(source['sha256']) + '</code></td></tr>')
parts.append('</table><h2>Executable resource source archives</h2>')
for source in manifest['resources']['sources']:
    parts.append('<p><a href="' + escape(source['archive_url'], quote=True) + '">' +
                 escape(source['repository']) + '</a><br>Revision: ' +
                 escape(source['revision']) + '<br>License: ' +
                 escape(source['license']) + '<br>Archive SHA-256: <code>' +
                 escape(source['archive_sha256']) + '</code></p>')
parts.append('<h2>Preserved license texts</h2>')
for path in sorted((root / 'licenses').glob('*.txt')):
    parts.append('<h3>' + escape(path.name) + '</h3><pre>' +
                 escape(path.read_text()) + '</pre>')
parts.append('</section>')
fragment = '\n'.join(parts)
document = ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Merlin ad blocker notices</title><style>'
            'body{font:16px system-ui;margin:2rem;line-height:1.5}'
            'pre,code{white-space:pre-wrap;overflow-wrap:anywhere}'
            'table{border-collapse:collapse}td,th{padding:.5rem;text-align:left;'
            'border:1px solid #888;overflow-wrap:anywhere}</style><body>' +
            fragment + '</body></html>\n')
if args.output:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document)
if args.append_to:
    existing = args.append_to.read_text()
    if 'id="merlin-adblock-notices"' in existing:
        raise SystemExit('ad blocker notices already present')
    end = existing.lower().rfind('</body>')
    if end < 0:
        if '<body' not in existing.lower():
            raise SystemExit('credits document has no body')
        # Chromium deliberately omits optional closing body/html tags.
        end = len(existing)
    args.append_to.write_text(existing[:end] + fragment + existing[end:])
if args.bundle_dir:
    destination = args.bundle_dir
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'index.html').write_text(document)
    for name in ['manifest.json', 'NOTICE.md'] + [a['file'] for a in assets]:
        shutil.copy2(root / name, destination / name)
    shutil.copytree(root / 'licenses', destination / 'licenses', dirs_exist_ok=True)
    shutil.copy2(repo / 'scripts/build_adblock_resources.mjs', destination)
    shutil.copy2(repo / 'build/adblock/crates.json', destination / 'rust-crates.json')
