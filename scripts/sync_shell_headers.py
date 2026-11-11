#!/usr/bin/env python3
"""Keep the shell/Chromium C ABI declarations byte-identical. No build required."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
pairs = {
    'MerlinEngineAPI.h': 'merlin_shell_api.h',
    'MerlinShellAPI.h': 'merlin_shell_host_api.h',
}
for source, target in pairs.items():
    canonical = root / 'packages/engine/include' / source
    overlay = root / 'overlay/chrome/browser/ui/modal_browser' / target
    if args.check:
        if not overlay.exists() or canonical.read_bytes() != overlay.read_bytes():
            raise SystemExit(f'{target} differs from {source}; run scripts/sync_shell_headers.py')
    else:
        overlay.write_bytes(canonical.read_bytes())
print('Shell ABI headers match' if args.check else 'Shell ABI headers synchronized')
