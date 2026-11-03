#!/usr/bin/env python3
"""Verify packaged offline lists; optionally reproduce the executable bundle.

The checked-in source lists are the immutable release snapshot. Runtime list
refreshes use the browser updater. Executable resources only change with app
releases. --rebuild-resources downloads pinned, checksum-verified source
archives and invokes the checked-in Node adapter; it never updates the lock.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'overlay/components/merlin_adblock/resources'


def verify():
    manifest = json.loads((DATA / 'manifest.json').read_text())
    seen = set()
    for item in [manifest['resources']] + manifest['sources']:
        file = item['file']
        if Path(file).name != file or file in seen:
            raise ValueError('unsafe or duplicate asset filename')
        seen.add(file)
        data = (DATA / file).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('bundled digest mismatch: ' + file)
        text = data.decode('utf-8')
        if item is not manifest['resources']:
            minimum = item.get('minimum_rules', 1)
            count = sum(bool(line) and not line.startswith(('!', '['))
                        for raw in text.splitlines()
                        if (line := raw.strip(' \t\r\n\f\v')))
            if type(minimum) is not int or minimum < 0 or count < minimum:
                raise ValueError('bundled list violates its rule minimum: ' + file)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('oversize asset: ' + file)
    print(f"Verified {len(manifest['sources'])} lists and the executable resource bundle")
    return manifest


def unpack(archive, target):
    target.mkdir()
    with tarfile.open(archive) as stream:
        members = stream.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 128 * 1024 * 1024:
            raise ValueError('source archive exceeds limits')
        for member in members:
            resolved = (target / member.name).resolve()
            if target.resolve() not in resolved.parents or not (member.isfile() or member.isdir()):
                raise ValueError('unsafe source archive entry')
        stream.extractall(target, members=members)
    roots = list(target.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise ValueError('unexpected source archive layout')
    return roots[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild-resources', action='store_true')
    parser.add_argument('--node', default=os.environ.get('NODE', shutil.which('node')))
    args = parser.parse_args()
    manifest = verify()
    if not args.rebuild_resources:
        return
    if not args.node:
        raise SystemExit('Node 24+ is required to reproduce resources')
    with tempfile.TemporaryDirectory(prefix='merlin-adblock-resources-') as temporary:
        temporary = Path(temporary)
        roots = []
        for index, source in enumerate(manifest['resources']['sources']):
            parsed = urlparse(source['archive_url'])
            if parsed.scheme != 'https' or parsed.netloc != 'codeload.github.com':
                raise ValueError('unexpected source archive endpoint')
            archive = temporary / f'{index}.tar.gz'
            subprocess.run(['curl', '--fail', '--location', '--proto', '=https', '--max-time', '60', source['archive_url'], '--output', str(archive)], check=True)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != source['archive_sha256']:
                raise ValueError('source archive digest mismatch')
            roots.append(unpack(archive, temporary / str(index)))
        output = temporary / 'resources.json'
        subprocess.run([args.node, str(ROOT / 'scripts/build_adblock_resources.mjs'), *map(str, roots), str(output)], check=True)
        if output.read_bytes() != (DATA / 'resources.json').read_bytes():
            raise ValueError('resource reproduction differs from the release snapshot')
        print('Executable bundle reproduced byte for byte')


if __name__ == '__main__':
    main()
