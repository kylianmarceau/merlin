#!/usr/bin/env python3
"""Every document a tracked file points to is tracked too.

Project notes, history and evidence are kept locally and never committed
(.gitignore), so a public file that names one sends readers nowhere. This
checks relative Markdown links in tracked .md files, and `docs/<name>.md`
mentions in any tracked text file (code comments, scripts), against the
files git tracks. Run from scripts/check.sh."""
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
# Third-party text that only happens to contain "docs/..." paths.
SKIP = ('patches/', 'overlay/components/merlin_adblock/resources/', 'pnpm-lock.yaml')
LINK = re.compile(r'\]\(([^)\s]+)\)')
MENTION = re.compile(r'(?<![\w/.-])docs/[\w./-]+\.md\b')


def tracked() -> set:
    out = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z'])
    return {p for p in out.decode().split('\0') if p}


def resolve(source: str, target: str) -> str:
    target = target.split('#', 1)[0]
    parts = []
    for part in (PurePosixPath(source).parent / target).parts:
        if part == '..':
            if parts:
                parts.pop()
        elif part != '.':
            parts.append(part)
    return '/'.join(parts)


def problems(files: set) -> list:
    folders = {str(PurePosixPath(f).parent) for f in files}
    bad = []
    for path in sorted(files):
        if path.startswith(SKIP) or not (ROOT / path).is_file():
            continue
        try:
            text = (ROOT / path).read_text()
        except UnicodeDecodeError:
            continue
        found = set()
        if path.endswith('.md'):
            for target in LINK.findall(text):
                if re.match(r'[a-z]+:|#|/', target):
                    continue
                found.add((target, resolve(path, target)))
        for mention in MENTION.findall(text):
            found.add((mention, mention))
        for shown, target in sorted(found):
            if target and target not in files and target.rstrip('/') not in folders:
                bad.append(f'{path}: {shown} is not a tracked file')
    return bad


def main() -> int:
    bad = problems(tracked())
    for line in bad:
        print(line, file=sys.stderr)
    if bad:
        print('Publish these documents or stop pointing to them.', file=sys.stderr)
        return 1
    print('Every document a tracked file points to is tracked.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
