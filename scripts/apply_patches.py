#!/usr/bin/env python3
"""Apply Merlin's patch series, including when later patches overlap earlier ones.

All transforms are checked on copies before touching the checkout. Unrelated
local edits survive; partially applied or conflicting hunks fail for review.
"""
import argparse
import difflib
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
parser.add_argument('--check', action='store_true', help='validate without changing source files')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
patches = sorted((repo / 'patches').glob('*.patch'))
paths = set()
for patch in patches:
    for line in patch.read_text().splitlines():
        if line.startswith(('--- a/', '+++ b/')):
            path = line[6:].split('\t')[0]
            if PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
                raise SystemExit('unsupported patch path: ' + path)
            paths.add(path)


def apply(directory, *options, input_bytes=None, quiet=False):
    return subprocess.run(['git', 'apply', *options], cwd=directory,
                          input=input_bytes, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE if quiet else None)


with tempfile.TemporaryDirectory(prefix='merlin-patch-apply-') as directory:
    work = Path(directory)
    before = {}
    for path in sorted(paths):
        source = args.src / path
        before[path] = source.read_bytes() if source.is_file() else None
        if source.exists() and not source.is_file():
            raise SystemExit('expected a source file: ' + str(source))
        if before[path] is not None:
            target = work / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    # Later patches may change the context of earlier applied patches. Undo
    # applied hunks on the copies in reverse order, then verify the full series.
    already = 0
    for patch in reversed(patches):
        if apply(work, '--reverse', '--check', str(patch), quiet=True).returncode == 0:
            subprocess.run(['git', 'apply', '--reverse', str(patch)], cwd=work, check=True)
            already += 1
    for patch in patches:
        if apply(work, '--check', str(patch), quiet=True).returncode:
            raise SystemExit('patch context differs; checkout left unchanged: ' + patch.name)
        subprocess.run(['git', 'apply', str(patch)], cwd=work, check=True)
    changes = []
    changed = 0
    for path in sorted(paths):
        target = work / path
        after = target.read_bytes() if target.is_file() else None
        old = before[path]
        if old == after:
            continue
        changed += 1
        changes.append('diff --git a/' + path + ' b/' + path + '\n')
        if old is None:
            changes.append('new file mode 100644\n')
        if after is None:
            changes.append('deleted file mode 100644\n')
        file_diff = difflib.unified_diff(
            (old or b'').decode('utf-8', errors='surrogateescape').splitlines(True),
            (after or b'').decode('utf-8', errors='surrogateescape').splitlines(True),
            fromfile='a/' + path if old is not None else '/dev/null',
            tofile='b/' + path if after is not None else '/dev/null')
        for line in file_diff:
            changes.append(line if line.endswith('\n') else
                           line + '\n\\ No newline at end of file\n')
    patch_bytes = ''.join(changes).encode('utf-8', errors='surrogateescape')
    if patch_bytes:
        if apply(args.src, '--check', input_bytes=patch_bytes).returncode:
            raise SystemExit('checkout changed during validation; no patch applied')
        if not args.check:
            if apply(args.src, input_bytes=patch_bytes).returncode:
                raise SystemExit('could not apply validated patch changes')
    print(f'{len(patches)} patches verified; {already} already applied; '
          f'{changed} files ' + ('would change' if args.check else 'changed'))
