#!/usr/bin/env python3
"""Record the sources a freshly built engine or React host came from.

    scripts/stamp_build.py engine ~/chromium/src/out/Release/Merlin.app
    scripts/stamp_build.py shell apps/browser/build/native/Build/Products/Release/MerlinShell.app

scripts/build_release.sh and scripts/build_react_shell.sh run this after
building. Run it yourself only right after building a product from this
checkout by hand (autoninja -C out/Release chrome): assembly trusts the
commit it records.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from build_stamp import PRODUCTS, stamp  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

if len(sys.argv) != 3 or sys.argv[1] not in PRODUCTS:
    sys.exit(__doc__)
record = stamp(Path(sys.argv[2]).resolve(), sys.argv[1], REPO)
changes = f" + uncommitted changes {record['sourceChanges'][:12]}" if record['sourceChanges'] else ''
print(f"stamped {sys.argv[1]}: {record['sourceCommit']}{changes}, UUID {', '.join(record['uuids'])}")
