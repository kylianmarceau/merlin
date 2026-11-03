#!/usr/bin/env python3
"""Close component-level fallback gaps found during rendered screenshot review."""
import argparse
import difflib
from pathlib import Path
from generate_password_headers import base
from generate_design_tokens import ROOT

PATCH = '0040-merlin-component-fallbacks.patch'


def generate(src):
    changes = {}
    path = 'ui/webui/resources/cr_elements/cr_shared_vars.css'
    before = base(src, path, PATCH)
    changes[path] = before, before + '\n' + (ROOT / 'branding/generated/merlin_component_tokens.css').read_text()
    path = 'ui/webui/resources/cr_elements/cr_button/cr_button.css'
    before = base(src, path, PATCH)
    changes[path] = before, before + '''
/* Merlin's prominent action pairs the shared accent with its contrast color. */
@media (forced-colors: none) and (prefers-contrast: no-preference) {
  :host(.action-button) {
    --cr-button-background-color: var(--accent, var(--cr-fallback-color-primary));
    --cr-button-text-color: var(--on-accent, var(--cr-fallback-color-on-primary));
  }
}
'''
    path = 'chrome/browser/resources/print_preview/ui/print_preview_vars.css'
    before = base(src, path, PATCH)
    changes[path] = before, before.replace('--iron-icon-fill-color: var(--sunk, var(--google-grey-700));',
                                         '--iron-icon-fill-color: var(--text2, var(--google-grey-700));')
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                   fromfile='a/' + path, tofile='b/' + path)) for path, (a,b) in changes.items())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('component fallback patch is stale')
    else:
        target.write_text(content)
    print('Component fallback patch: current' if a.check else 'Component fallback patch: generated')


if __name__ == '__main__':
    main()
