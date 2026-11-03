#!/usr/bin/env python3
"""Let the existing cast-permission notice wrap inside compact media cards."""
import argparse
import difflib
from pathlib import Path
from generate_password_headers import base
from generate_design_tokens import ROOT

PATCH = '0045-merlin-media-permission-wrap.patch'
PATH = 'chrome/browser/ui/views/global_media_controls/cast_device_selector_view.cc'


def edit(src):
    before = base(src, PATH, PATCH)
    after = before
    old = 'constexpr int kPermissionRejectedLabelWidth = 400;\n'
    if after.count(old) != 1:
        raise ValueError('cast permission width changed')
    after = after.replace(old, '')
    old = '''  gfx::Size preferred_size(kPermissionRejectedLabelWidth,
                           permission_rejected_label_->GetHeightForWidth(
                               kPermissionRejectedLabelWidth));
  permission_rejected_label_->SetPreferredSize(preferred_size);'''
    if after.count(old) != 1:
        raise ValueError('cast permission label layout changed')
    after = after.replace(old, '''  // Respect the actual card width, including compact browser presentations.
  permission_rejected_view_->SetOrientation(
      views::BoxLayout::Orientation::kVertical);''')
    return before, after


def generate(src):
    before, after = edit(src)
    return ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                   fromfile='a/' + PATH, tofile='b/' + PATH))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('media permission layout patch is stale')
    else:
        target.write_text(content)
    print('Media permission layout patch: current' if a.check else 'Media permission layout patch: generated')


if __name__ == '__main__':
    main()
