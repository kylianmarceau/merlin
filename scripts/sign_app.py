#!/usr/bin/env python3
"""Sign every binary and bundle in Merlin.app, innermost first.

    scripts/sign_app.py Merlin.app --runtime --entitlements ~/chromium/src/chrome/app
    scripts/sign_app.py Merlin.app                       # no hardened runtime (e2e copies)
    scripts/sign_app.py Merlin.app --identity "Merlin Release Signing" --runtime ...

The linker signs each binary, but that leaves bundles without sealed
resources, and macOS reports a downloaded copy as damaged. Signing every
Mach-O file and bundle, deepest first, gives each container a complete
signature. The identity defaults to ad-hoc (`-`); the release policy
excludes Developer ID (docs/RELEASE.md).

With --runtime the app gets the hardened runtime and Chromium's own
entitlement files (chrome/app in the engine's checkout): the app gets
app-entitlements.plist (camera, microphone, location, USB, Bluetooth,
print, photos), renderer helpers helper-renderer-entitlements.plist and
GPU helpers helper-gpu-entitlements.plist (both allow-jit).

Every executable also gets com.apple.security.cs.disable-library-validation.
Library validation only lets a hardened process load code signed by its own
team, and ad-hoc code has no team ID, so without it the host can't load
Hermes or the Merlin framework, nor the helpers the framework ("mapping
process and mapped file (non-platform) have different Team IDs").
"""
from __future__ import annotations

import argparse
import os
import plistlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

MAGIC = {b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'}
BUNDLES = ('.app', '.framework', '.xpc', '.appex', '.bundle', '.plugin')
# Helper bundle name suffix -> Chromium entitlement file.
HELPERS = {
    ' (Renderer).app': 'helper-renderer-entitlements.plist',
    ' (Aperitif Renderer).app': 'helper-renderer-entitlements.plist',
    ' (GPU).app': 'helper-gpu-entitlements.plist',
    ' (Aperitif GPU).app': 'helper-gpu-entitlements.plist',
}
APP_ENTITLEMENTS = 'app-entitlements.plist'
LIBRARY_VALIDATION = 'com.apple.security.cs.disable-library-validation'
MH_EXECUTE = 2


def is_executable(path: Path) -> bool:
    """Whether a Mach-O file is a main executable (not a dylib or bundle)."""
    with path.open('rb') as stream:
        header = stream.read(4096)
    if header[:4] == b'\xca\xfe\xba\xbe':  # universal: look at the first slice
        offset = struct.unpack('>I', header[16:20])[0]
        with path.open('rb') as stream:
            stream.seek(offset)
            header = stream.read(16)
    if header[:4] in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe'):
        return struct.unpack('<I', header[12:16])[0] == MH_EXECUTE
    return struct.unpack('>I', header[12:16])[0] == MH_EXECUTE


def sign_order(app: Path) -> list[Path]:
    found = []
    for top, dirs, files in os.walk(app):
        for name in dirs:
            path = Path(top) / name
            if name.endswith(BUNDLES) and not path.is_symlink():
                found.append(path)
        for name in files:
            path = Path(top) / name
            if path.is_symlink():
                continue
            with path.open('rb') as stream:
                if stream.read(4) in MAGIC:
                    found.append(path)
    found.append(app)
    return sorted(set(found), key=lambda path: -len(path.parts))


def entitlements_for(path: Path, app: Path, directory: Path) -> Path | None:
    """Chromium's entitlement file for an app or helper bundle; None for anything else."""
    if path == app:
        return directory / APP_ENTITLEMENTS
    for suffix, name in HELPERS.items():
        if path.name.endswith(suffix):
            return directory / name
    return None


def with_library_validation_off(source: Path | None, work: Path) -> Path:
    """A copy of an entitlement file (or an empty one) that turns library validation off."""
    entitlements = plistlib.loads(source.read_bytes()) if source else {}
    entitlements[LIBRARY_VALIDATION] = True
    target = work / (source.name if source else 'executable-entitlements.plist')
    target.write_bytes(plistlib.dumps(entitlements))
    return target


def sign(app: Path, identity: str = '-', runtime: bool = False, entitlements: Path | None = None,
         keychain: Path | None = None) -> int:
    if runtime and entitlements is None:
        raise ValueError('the hardened runtime needs Chromium\'s entitlement files (--entitlements)')
    if entitlements:
        for name in {APP_ENTITLEMENTS, *HELPERS.values()}:
            if not (entitlements / name).is_file():
                raise ValueError(f'no {name} in {entitlements}')
    count = 0
    with tempfile.TemporaryDirectory(prefix='merlin-entitlements-') as work:
        for path in sign_order(app):
            command = ['codesign', '--force', '--sign', identity, '--timestamp=none']
            if keychain:
                command += ['--keychain', str(keychain)]
            if runtime:
                command += ['--options', 'runtime']
                if path.is_dir() and path.suffix == '.app':
                    chosen = with_library_validation_off(entitlements_for(path, app, entitlements), Path(work))
                    command += ['--entitlements', str(chosen)]
                elif path.is_file() and is_executable(path):
                    chosen = with_library_validation_off(None, Path(work))
                    command += ['--entitlements', str(chosen)]
            subprocess.run([*command, str(path)], check=True, capture_output=True, text=True)
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('app', type=Path)
    parser.add_argument('--identity', default='-', help='a code-signing identity; ad-hoc (-) by default')
    parser.add_argument('--keychain', type=Path, help='the keychain holding --identity')
    parser.add_argument('--runtime', action='store_true', help='turn on the hardened runtime')
    parser.add_argument('--entitlements', type=Path, help="Chromium's chrome/app directory")
    args = parser.parse_args()
    try:
        count = sign(args.app.resolve(), args.identity, args.runtime, args.entitlements, args.keychain)
    except (ValueError, OSError) as error:
        parser.exit(1, f'sign_app: {error}\n')
    except subprocess.CalledProcessError as error:
        parser.exit(1, f'sign_app: {" ".join(error.cmd)} failed:\n{error.stderr}')
    print(f'signed {count} items' + (' with the hardened runtime' if args.runtime else ''))


if __name__ == '__main__':
    sys.exit(main())
