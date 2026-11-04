#!/usr/bin/env python3
# Copyright 2026 The modal_browser Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""Draws the Merlin glyph where Chromium's WebUI icon sets draw its logo.

Settings, the certificate manager and other WebUI pages show the product
as `cr:chrome-product` / `settings20:chrome-product`: inline SVG paths in
icon-set files, not resources, so `branding_path_component` cannot reach
them. Patch 0009 is the output of this script:

    python3 scripts/rebrand_icons.py --patch ~/chromium/src \\
        > patches/0009-merlin-product-icons.patch
    python3 scripts/rebrand_icons.py --apply ~/chromium/src

Each `<g id="chrome-product">` keeps its id and viewBox; only the path
inside changes, so every page that names the icon shows the swept-back falcon.
WHOLE_FILES are logo images and ICON_FILES Views vector icons, replaced
outright.
"""

import os
import re
import subprocess
import sys
import tempfile

import merlin_mark  # scripts/merlin_mark.py: the one drawing of the mark

FILES = [
    "ui/webui/resources/cr_elements/icons.html.ts",
    "chrome/browser/resources/settings/icons.html.ts",
    "chrome/browser/resources/webui_browser/icons.html.ts",
]

# Whole files replaced by the Merlin tile (branding/merlin-favicon.svg):
# the dark-theme product logo in WebUI toolbars (Settings, Extensions).
WHOLE_FILES = {"ui/webui/resources/images/chrome_logo_dark.svg": merlin_mark.tile_svg()}

# Views vector icons that draw Chromium's logo whatever the branding: the
# address field's chip on chrome:// pages, starter-pack rows, notifications.
# Replaced by the glyph on each file's own canvas (components/vector_icons/
# merlin/product.icon is the same drawing at 24).
ICON_FILES = {
    "chrome/app/vector_icons/chrome_product.icon": 16,
    "components/omnibox/browser/vector_icons/chrome_product.icon": 24,
    "components/omnibox/browser/vector_icons/product_chrome_refresh_old.icon": 15,
    "components/omnibox/browser/vector_icons/product_old.icon": 32,
    "ui/message_center/vector_icons/chrome_product.icon": 24,
    "ui/message_center/vector_icons/product_old.icon": 96,
}

GROUP = re.compile(r'(<g id="chrome-product"(?: viewBox="([^"]+)")?>)(.*?)(</g>)',
                   re.S)


def glyph(x0: float, y0: float, size: float) -> str:
    """The swept-back falcon as one path, centred in the box."""
    return f'<path d="{merlin_mark.glyph_path(x0, y0, size)}"></path>'


def vector_icon(size: int) -> str:
    """The glyph in Chromium's .icon path language."""
    return merlin_mark.vector_icon(size)


def rebrand(text: str) -> tuple[str, int]:
    count = 0

    def one(m: re.Match) -> str:
        nonlocal count
        if m.group(2):
            x0, y0, w, _h = (float(v) for v in m.group(2).split())
        else:
            sizes = re.findall(r'<cr-iconset name="[^"]+" size="(\d+)"',
                               text[:m.start()])
            x0, y0, w = 0.0, 0.0, float(sizes[-1] if sizes else 24)
        count += 1
        return m.group(1) + glyph(x0, y0, w) + m.group(4)

    return GROUP.sub(one, text), count


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--patch", "--apply"):
        print(__doc__)
        return 2
    mode, src = sys.argv[1], os.path.expanduser(sys.argv[2])
    total = 0
    for path in FILES + list(WHOLE_FILES) + list(ICON_FILES):
        if mode == "--patch":
            before = subprocess.run(["git", "-C", src, "show", f"HEAD:{path}"],
                                    check=True, capture_output=True,
                                    text=True).stdout
        else:
            with open(os.path.join(src, path), encoding="utf-8") as f:
                before = f.read()
        if path in WHOLE_FILES:
            after, count = WHOLE_FILES[path], 1
        elif path in ICON_FILES:
            after, count = vector_icon(ICON_FILES[path]), 1
        else:
            after, count = rebrand(before)
        total += count
        if after == before:
            continue
        if mode == "--apply":
            with open(os.path.join(src, path), "w", encoding="utf-8") as f:
                f.write(after)
            continue
        with tempfile.TemporaryDirectory() as tmp:
            a, b = os.path.join(tmp, "a"), os.path.join(tmp, "b")
            with open(a, "w", encoding="utf-8") as f:
                f.write(before)
            with open(b, "w", encoding="utf-8") as f:
                f.write(after)
            sys.stdout.write(subprocess.run(
                ["diff", "-u", f"--label=a/{path}", f"--label=b/{path}", a, b],
                capture_output=True, text=True).stdout)
    print(f"replaced {total} icons", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
