#!/usr/bin/env python3
"""Map DevTools' independent navigation/checkbox/focus tokens to Merlin roles."""
import argparse
import difflib
from pathlib import Path
from generate_design_tokens import ROOT
from generate_devtools_identity import PREFIX
from generate_password_headers import base

PATCH = '0043-merlin-devtools-controls.patch'


def edits(src):
    changes = {}
    path = PREFIX + '/front_end/application_tokens.css'
    before = base(src, path, PATCH)
    changes[path] = before, before + '''
/* Merlin's browser theme also covers application-level component tokens. */
@media (forced-colors: none) and (prefers-contrast: no-preference) {
  :root.merlin-default-theme,
  :root.merlin-default-theme.theme-with-dark-background {
    --sys-color-primary-bright: var(--sys-color-primary);
    --sys-color-state-focus-ring: var(--sys-color-primary);
    --sys-color-state-header-hover: var(--sys-color-neutral-container);
    --app-color-navigation-drawer-label-selected: var(--sys-color-on-tonal-container);
    --app-color-navigation-drawer-background-selected: var(--sys-color-tonal-container);
  }
}
'''
    path = PREFIX + '/front_end/ui/components/buttons/button.css'
    before = base(src, path, PATCH)
    needle = 'border-radius: var(--sys-shape-corner-full);'
    if before.count(needle) != 2:
        raise ValueError('DevTools button shape boundary changed')
    # Buttons only: circular icon-only controls keep their own radius.
    changes[path] = before, before.replace(needle, 'border-radius: var(--sys-shape-corner-small);', 1)
    return changes


def generate(src):
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                   fromfile='a/' + path, tofile='b/' + path)) for path, (a,b) in edits(src).items())


def audit(src):
    for path, (_, expected) in edits(src).items():
        if (src / path).read_text() != expected:
            raise ValueError('DevTools control tokens changed: ' + path)
    print('DevTools control audit passed.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('DevTools control patch is stale')
    else:
        target.write_text(content)
    print('DevTools control patch: current' if a.check else 'DevTools control patch: generated')


if __name__ == '__main__':
    main()
