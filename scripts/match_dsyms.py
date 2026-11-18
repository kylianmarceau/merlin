#!/usr/bin/env python3
"""Find the dSYM for every Mach-O file in a packaged app, by UUID.

    scripts/match_dsyms.py Merlin.app --search out/Release --search <shell products> \
        --copy-to stage/dSYMs --map stage/dSYMs/UUIDs.txt

Fails, naming each file, if a binary has no dSYM with its UUID: its crash
reports could not be symbolized. Prebuilt third-party binaries that ship
without symbols are listed in EXEMPT and recorded as such in the map. Only
the matching dSYMs are copied (as APFS clones where possible), not every
dSYM a build directory holds.
"""
from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from build_stamp import app_uuids, macho_uuids  # noqa: E402

# Prebuilt by their projects, without dSYMs in the products Merlin builds from.
EXEMPT = {
    'Contents/Frameworks/hermes.framework/*': 'Hermes, prebuilt by the hermes-engine pod',
}


def dsym_uuids(directories: list[Path]) -> dict[str, Path]:
    found = {}
    for directory in directories:
        for dsym in sorted(directory.glob('*.dSYM')):
            for uuid in macho_uuids(dsym):
                found.setdefault(uuid, dsym)
    return found


def match(binaries: dict[str, list[str]], dsyms: dict[str, Path], exempt: dict[str, str] = EXEMPT):
    """(lines of the UUID map, dSYMs to keep, binaries with no dSYM)."""
    lines, keep, missing = [], [], []
    for path, uuids in sorted(binaries.items()):
        reason = next((why for pattern, why in exempt.items() if fnmatch.fnmatch(path, pattern)), None)
        for uuid in uuids or ['(no UUID)']:
            dsym = dsyms.get(uuid)
            if dsym:
                lines.append(f'{uuid}  {path}  ->  {dsym.name}')
                if dsym not in keep:
                    keep.append(dsym)
            elif reason:
                lines.append(f'{uuid}  {path}  ->  no dSYM ({reason})')
            else:
                missing.append(f'{path} ({uuid})')
    return lines, keep, missing


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('app', type=Path)
    parser.add_argument('--search', type=Path, action='append', default=[], help='a directory holding dSYMs')
    parser.add_argument('--dsym', type=Path, action='append', default=[], help='one more dSYM bundle')
    parser.add_argument('--copy-to', type=Path)
    parser.add_argument('--map', type=Path)
    args = parser.parse_args()
    dsyms = dsym_uuids(args.search)
    for extra in args.dsym:
        if not extra.is_dir():
            parser.exit(1, f'match_dsyms: no dSYM at {extra}\n')
        for uuid in macho_uuids(extra):
            dsyms[uuid] = extra
    lines, keep, missing = match(app_uuids(args.app), dsyms)
    if missing:
        parser.exit(1, 'match_dsyms: no dSYM matches these packaged binaries, so their crash reports could '
                       'not be symbolized:\n  ' + '\n  '.join(missing) +
                    '\nRebuild them with symbols (scripts/build_react_shell.sh makes the shell\'s), '
                    'or pass the dSYM with MERLIN_SHELL_DSYM.\n')
    if args.copy_to:
        args.copy_to.mkdir(parents=True, exist_ok=True)
        for dsym in keep:
            # -c clones on APFS: the engine's dSYMs are several GB.
            if subprocess.run(['cp', '-cR', str(dsym), str(args.copy_to)]).returncode:
                subprocess.run(['ditto', str(dsym), str(args.copy_to / dsym.name)], check=True)
    if args.map:
        args.map.write_text('\n'.join(lines) + '\n')
    print(f'{len(keep)} dSYMs match {len(lines)} packaged binaries')


if __name__ == '__main__':
    main()
