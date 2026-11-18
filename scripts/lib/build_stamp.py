"""What each built product records about its sources, in its own Info.plist.

scripts/build_release.sh stamps the engine (out/Release/Merlin.app) and
scripts/build_react_shell.sh stamps the React host right after building
them. The stamp names the source commit, a digest of any uncommitted
changes to that product's sources, and the Mach-O UUID of the binary that
was built. Assembly compares the commit with the checkout and the UUID with
the binary: a product rebuilt without restamping (autoninja run directly)
has a new UUID, so its stamp no longer describes it.
"""
from __future__ import annotations

import plistlib
import subprocess
from pathlib import Path

from source_state import ENGINE_SOURCES, SHELL_SOURCES, source_state

KEY = 'MerlinBuild'
ENGINE_BINARY = 'Contents/Frameworks/Merlin Framework.framework/Merlin Framework'
PRODUCTS = {'engine': ENGINE_SOURCES, 'shell': SHELL_SOURCES}


def macho_uuids(binary: Path) -> list[str]:
    """Every LC_UUID of a Mach-O file, one per architecture."""
    result = subprocess.run(['xcrun', 'dwarfdump', '--uuid', str(binary)], check=True,
                            capture_output=True, text=True)
    return [line.split()[1] for line in result.stdout.splitlines() if line.startswith('UUID:')]


MACHO_MAGIC = {b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'}


def app_uuids(app: Path) -> dict[str, list[str]]:
    """{path inside the app: [UUIDs]} for every Mach-O file in it, symlinks skipped."""
    found = {}
    for path in sorted(app.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            if stream.read(4) not in MACHO_MAGIC:
                continue
        found[str(path.relative_to(app))] = macho_uuids(path)
    return found


def binary(app: Path, product: str) -> Path:
    if product == 'engine':
        return app / ENGINE_BINARY
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    return app / 'Contents/MacOS' / info['CFBundleExecutable']


def stamp(app: Path, product: str, repo: Path, before: dict | None = None) -> dict:
    """Records the checkout's state for `product` in the app's Info.plist and returns it.

    `before` is the state captured when the build started; if the sources
    changed while it ran, the build may mix the two, so nothing is stamped.
    """
    state = source_state(repo, PRODUCTS[product])
    if before is not None and before != state:
        raise ValueError(f'the {product} sources changed while it was building '
                         f'({before["sourceCommit"][:12]} → {state["sourceCommit"][:12]}); build it again')
    record = {'product': product, **state, 'uuids': macho_uuids(binary(app, product))}
    path = app / 'Contents/Info.plist'
    info = plistlib.loads(path.read_bytes())
    info[KEY] = {key: value for key, value in record.items() if value is not None}
    path.write_bytes(plistlib.dumps(info))
    return record


def read(app: Path, product: str) -> tuple[dict | None, str | None]:
    """(the stamp, why it doesn't describe the binary now) for a built product."""
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    record = info.get(KEY)
    if not record:
        return None, 'it has no build stamp'
    record = {'sourceChanges': None, **record}
    if record.get('product') != product:
        return record, f"its stamp is for the {record.get('product')}"
    if record.get('uuids') != macho_uuids(binary(app, product)):
        return record, 'it was rebuilt after it was stamped (its binary UUID changed)'
    return record, None
