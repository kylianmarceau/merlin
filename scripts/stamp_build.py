#!/usr/bin/env python3
"""Record the sources a freshly built engine or React host came from.

    scripts/stamp_build.py snapshot engine state.json       # before building
    scripts/stamp_build.py engine ~/chromium/src/out/Release/Merlin.app --since state.json
    scripts/stamp_build.py shell apps/browser/build/native/Build/Products/Release/MerlinShell.app

scripts/build_release.sh and scripts/build_react_shell.sh snapshot the
product's sources before building and stamp it after; with --since, a
product whose sources changed during the build is not stamped. Run it
yourself only right after building a product from this checkout by hand
(autoninja -C out/Release chrome): assembly trusts the commit it records.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from build_stamp import PRODUCTS, stamp  # noqa: E402
from source_state import source_state  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
args = sys.argv[1:]

if len(args) == 3 and args[0] == 'snapshot' and args[1] in PRODUCTS:
    Path(args[2]).write_text(json.dumps(source_state(REPO, PRODUCTS[args[1]])))
    sys.exit(0)
before = None
if len(args) == 4 and args[2] == '--since':
    before = json.loads(Path(args[3]).read_text())
    args = args[:2]
if len(args) != 2 or args[0] not in PRODUCTS:
    sys.exit(__doc__)
try:
    record = stamp(Path(args[1]).resolve(), args[0], REPO, before)
except ValueError as error:
    sys.exit(f'stamp_build: {error}')
changes = f" + uncommitted changes {record['sourceChanges'][:12]}" if record['sourceChanges'] else ''
print(f"stamped {args[0]}: {record['sourceCommit']}{changes}, UUID {', '.join(record['uuids'])}")
