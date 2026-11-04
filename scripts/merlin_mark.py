#!/usr/bin/env python3
# Copyright 2026 The modal_browser Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""Merlin's approved swept-back falcon, in rust on cream.

The vector contours in branding/merlin-falcon.json were traced from the approved
artwork, retaining its wing channel, eye and beak. All SVG, WebUI and native
Views representations use those same contours; no surface draws its own mark.

    python3 scripts/merlin_mark.py --write

scripts/build_branding.sh renders all PNG, ICNS and macOS asset catalog files.
"""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
CREAM = "#F5E9D7"
RUST = "#AA4C32"
TILE = 120
GEOMETRY = json.loads((ROOT / "branding/merlin-falcon.json").read_text())
UNIT = TILE / GEOMETRY["canvas"]
BOX = tuple(value * UNIT for value in GEOMETRY["bounds"])


def _f(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _commands(k=1.0, ox=0.0, oy=0.0):
    for command, *values in GEOMETRY["commands"]:
        yield command, [value * UNIT * k + (ox if i % 2 == 0 else oy)
                        for i, value in enumerate(values)]


def _path(k=1.0, ox=0.0, oy=0.0):
    return "".join(command + " ".join(_f(value) for value in values)
                   for command, values in _commands(k, ox, oy))


def mark(k: float = 1, ox: float = 0, oy: float = 0) -> str:
    """The approved falcon, on its original square canvas, scaled and offset."""
    return f'<path d="{_path(k, ox, oy)}" fill="{RUST}"/>'


def _fit(x0: float, y0: float, size: float, frac: float) -> tuple:
    width, height = BOX[2] - BOX[0], BOX[3] - BOX[1]
    k = size * frac / max(width, height)
    return k, x0 + (size - width * k) / 2 - BOX[0] * k, y0 + (size - height * k) / 2 - BOX[1] * k


def glyph_path(x0: float, y0: float, size: float, frac: float = 0.9) -> str:
    """The bare falcon, including its negative-space eye, fitted in a square."""
    return _path(*_fit(x0, y0, size, frac))


def vector_icon(size: int, frac: float = 0.92) -> str:
    """The same contours in Chromium's native .icon path language."""
    names = {"M": "MOVE_TO", "C": "CUBIC_TO", "Z": "CLOSE"}
    lines = [f"CANVAS_DIMENSIONS, {size},", "FILL_RULE_NONZERO,"]
    for command, values in _commands(*_fit(0, 0, size, frac)):
        # Explicit f suffixes avoid narrowing decimal doubles in C++ arrays.
        args = ", " + ", ".join(f"{value:.3f}f" for value in values) if values else ""
        lines.append(names[command] + args + ",")
    return ("// Copyright 2026 The modal_browser Authors\n"
            "// Use of this source code is governed by a BSD-style license that can be\n"
            "// found in the LICENSE file.\n//\n"
            "// Merlin's swept-back falcon (scripts/merlin_mark.py).\n\n"
            + "\n".join(lines) + "\n")


def tile_svg(size: float = 200, label: str = "Merlin") -> str:
    """The selected rust falcon on a cream tile: pages and browser favicons."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_f(size)} {_f(size)}" '
            f'role="img" aria-label="{label}">'
            f'<rect width="{_f(size)}" height="{_f(size)}" rx="{_f(size * 0.23)}" fill="{CREAM}"/>'
            f'{mark(size / TILE)}</svg>\n')


def app_icon_svg() -> str:
    """macOS icon on Apple's 1024 grid, preserving native padding and mask."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            'viewBox="0 0 1024 1024" role="img" aria-label="Merlin app icon">'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{CREAM}"/>'
            f'{mark(824 / TILE, 100, 100)}</svg>\n')


def icon_composer_layer() -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            f'viewBox="0 0 1024 1024">{mark(1024 / TILE)}</svg>\n')


def mark_svg() -> str:
    margin = 6
    x, y = BOX[0] - margin, BOX[1] - margin
    width, height = BOX[2] - BOX[0] + 2 * margin, BOX[3] - BOX[1] + 2 * margin
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_f(x)} {_f(y)} {_f(width)} {_f(height)}" '
            f'role="img" aria-label="Merlin">{mark()}</svg>\n')


def mono_svg(size: int = 22, color: str = "#000000") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'<path d="{glyph_path(0, 0, size, 0.95)}" fill="{color}"/></svg>\n')


def password_svg() -> str:
    """A key retains the password manager's distinct purpose in the new palette."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" '
            'aria-label="Merlin passwords">'
            f'<rect width="32" height="32" rx="7.4" fill="{CREAM}"/>'
            f'<circle cx="11" cy="16" r="4.6" fill="none" stroke="{RUST}" stroke-width="2.6"/>'
            '<path d="M15.4 16 H25.5 M22.5 16 V20 M25.5 16 V19" fill="none" '
            f'stroke="{RUST}" stroke-width="2.6" stroke-linecap="round"/></svg>\n')


def outputs(root: str) -> dict:
    root = Path(root)
    theme = root / "overlay/chrome/app/theme/merlin"
    icons = root / "overlay/components/vector_icons/merlin"
    return {
        root / "branding/merlin-mark.svg": mark_svg(),
        root / "branding/merlin-app-icon.svg": app_icon_svg(),
        root / "branding/merlin-favicon.svg": tile_svg(),
        root / "branding/merlin-password-favicon.svg": password_svg(),
        root / "branding/merlin-mono.svg": mono_svg(),
        theme / "product_logo.svg": tile_svg(),
        theme / "product_logo_animation.svg": tile_svg(),
        theme / "mac/AppIcon.icon/Assets/merlin.svg": icon_composer_layer(),
        icons / "product.icon": vector_icon(24),
        icons / "product_refresh.icon": vector_icon(24),
    }


def main() -> int:
    if sys.argv[1:] != ["--write"]:
        print(__doc__)
        return 2
    for path, text in outputs(ROOT).items():
        path.write_text(text)
        print("wrote", path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
