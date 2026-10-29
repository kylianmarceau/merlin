#!/usr/bin/env python3
# Copyright 2026 The modal_browser Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""The Merlin mark: a merlin's tail, fanned. One geometry for every file.

Five wedge feathers fan out from a round hub; the middle feather is rust,
the rest and the hub forest, on a cream tile. Everything is drawn in a
120 x 120 tile, the same box as the design sketches.

    python3 scripts/merlin_mark.py --write   # rewrites the SVGs below

The PNGs, .icns and Assets.car come from these SVGs: scripts/build_branding.sh.
scripts/rebrand_icons.py imports glyph_path() and vector_icon() from here.
"""

import math
import os
import sys

CREAM = "#F2ECE0"
FOREST = "#12352E"
RUST = "#C4552D"

TILE = 120
HUB = (60.0, 86.0)       # centre of the fan
HUB_R = 7.5
R0, R1 = 10.0, 54.0      # wedges run from R0 to R1 out from the hub
ANGLES = (-52, -26, 0, 26, 52)
HALF = 11.0              # half a wedge, in degrees; wedges sit 26 apart

# Tight bounds of the fan in the tile, for fitting the bare glyph.
_out = math.radians(ANGLES[-1] + HALF)
BOX = (HUB[0] - R1 * math.sin(_out), HUB[1] - R1,
       HUB[0] + R1 * math.sin(_out), HUB[1] + HUB_R)


def _f(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _pt(r: float, deg: float, k: float, ox: float, oy: float) -> tuple:
    a = math.radians(deg)
    return (ox + k * (HUB[0] + r * math.sin(a)), oy + k * (HUB[1] - r * math.cos(a)))


def wedges(k: float = 1, ox: float = 0, oy: float = 0) -> list:
    """Each wedge as (p0, p1, p2, p3, arc radius): in, out, arc, back in."""
    out = []
    for a in ANGLES:
        out.append((_pt(R0, a - HALF, k, ox, oy), _pt(R1, a - HALF, k, ox, oy),
                    _pt(R1, a + HALF, k, ox, oy), _pt(R0, a + HALF, k, ox, oy),
                    R1 * k))
    return out


def wedge_d(w) -> str:
    p0, p1, p2, p3, r = w
    return (f"M{_f(p0[0])} {_f(p0[1])}L{_f(p1[0])} {_f(p1[1])}"
            f"A{_f(r)} {_f(r)} 0 0 1 {_f(p2[0])} {_f(p2[1])}"
            f"L{_f(p3[0])} {_f(p3[1])}Z")


def hub_d(k: float = 1, ox: float = 0, oy: float = 0) -> str:
    cx, cy, r = ox + k * HUB[0], oy + k * HUB[1], k * HUB_R
    return (f"M{_f(cx - r)} {_f(cy)}A{_f(r)} {_f(r)} 0 1 1 {_f(cx + r)} {_f(cy)}"
            f"A{_f(r)} {_f(r)} 0 1 1 {_f(cx - r)} {_f(cy)}Z")


def mark(k: float = 1, ox: float = 0, oy: float = 0) -> str:
    """The coloured fan as SVG elements, tile scaled by k and moved to ox, oy."""
    ws = wedges(k, ox, oy)
    side = "".join(wedge_d(w) for i, w in enumerate(ws) if i != 2)
    return (f'<path d="{side}{hub_d(k, ox, oy)}" fill="{FOREST}"/>'
            f'<path d="{wedge_d(ws[2])}" fill="{RUST}"/>')


def _fit(x0: float, y0: float, size: float, frac: float) -> tuple:
    """Scale and offset that put the fan's bounds `frac` of a square, centred."""
    bw, bh = BOX[2] - BOX[0], BOX[3] - BOX[1]
    k = size * frac / bw
    return k, x0 + (size - bw * k) / 2 - BOX[0] * k, y0 + (size - bh * k) / 2 - BOX[1] * k


def glyph_path(x0: float, y0: float, size: float, frac: float = 0.9) -> str:
    """The bare fan in one colour, as one SVG path d, centred in a square."""
    k, ox, oy = _fit(x0, y0, size, frac)
    return "".join(wedge_d(w) for w in wedges(k, ox, oy)) + hub_d(k, ox, oy)


def vector_icon(size: int, frac: float = 0.92) -> str:
    """The bare fan in Chromium's .icon path language."""
    k, ox, oy = _fit(0, 0, size, frac)
    lines = [f"CANVAS_DIMENSIONS, {size},"]
    for p0, p1, p2, p3, r in wedges(k, ox, oy):
        lines += [f"MOVE_TO, {_f(p0[0])}, {_f(p0[1])},",
                  f"LINE_TO, {_f(p1[0])}, {_f(p1[1])},",
                  f"ARC_TO, {_f(r)}, {_f(r)}, 0, 0, 1, {_f(p2[0])}, {_f(p2[1])},",
                  f"LINE_TO, {_f(p3[0])}, {_f(p3[1])},",
                  "CLOSE,"]
    lines.append(f"CIRCLE, {_f(ox + k * HUB[0])}, {_f(oy + k * HUB[1])}, {_f(k * HUB_R)}")
    return ("// Copyright 2026 The modal_browser Authors\n"
            "// Use of this source code is governed by a BSD-style license that"
            " can be\n// found in the LICENSE file.\n//\n"
            "// The Merlin glyph, a fanned tail (scripts/merlin_mark.py).\n\n"
            + "\n".join(lines) + "\n")


def tile_svg(size: float = 200, label: str = "Merlin") -> str:
    """The cream tile with the fan: favicons, product logos, page icons."""
    k = size / TILE
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_f(size)} {_f(size)}" '
            f'role="img" aria-label="{label}">'
            f'<rect width="{_f(size)}" height="{_f(size)}" rx="{_f(size * 0.23)}" fill="{CREAM}"/>'
            f"{mark(k)}</svg>\n")


def app_icon_svg() -> str:
    """macOS app icon on Apple's 1024 grid: an 824 px body at 100, 100."""
    k = 824 / TILE
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            'viewBox="0 0 1024 1024" role="img" aria-label="Merlin app icon">'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{CREAM}"/>'
            f"{mark(k, 100, 100)}</svg>\n")


def icon_composer_layer() -> str:
    """The fan alone for Icon Composer, which fills the whole canvas with cream."""
    k = 1024 / TILE
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
            f'viewBox="0 0 1024 1024">{mark(k)}</svg>\n')


def mark_svg() -> str:
    """The fan alone, cropped to its bounds plus a margin, for light grounds."""
    m = 6
    x, y, w, h = BOX[0] - m, BOX[1] - m, BOX[2] - BOX[0] + 2 * m, BOX[3] - BOX[1] + 2 * m
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_f(x)} {_f(y)} {_f(w)} {_f(h)}" '
            f'role="img" aria-label="Merlin">{mark()}</svg>\n')


def mono_svg(size: int = 22, color: str = "#000000") -> str:
    """The bare fan in one colour: the macOS menu bar / tray template."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'<path d="{glyph_path(0, 0, size, 0.95)}" fill="{color}"/></svg>\n')


def password_svg() -> str:
    """The password manager's tab icon: a key on the cream tile."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" '
            'aria-label="Merlin passwords">'
            f'<rect width="32" height="32" rx="7.4" fill="{CREAM}"/>'
            f'<circle cx="11" cy="16" r="4.6" fill="none" stroke="{FOREST}" stroke-width="2.6"/>'
            '<path d="M15.4 16 H25.5 M22.5 16 V20 M25.5 16 V19" fill="none" '
            f'stroke="{FOREST}" stroke-width="2.6" stroke-linecap="round"/></svg>\n')


def outputs(root: str) -> dict:
    theme = os.path.join(root, "overlay/chrome/app/theme/merlin")
    icons = os.path.join(root, "overlay/components/vector_icons/merlin")
    return {
        os.path.join(root, "branding/merlin-mark.svg"): mark_svg(),
        os.path.join(root, "branding/merlin-app-icon.svg"): app_icon_svg(),
        os.path.join(root, "branding/merlin-favicon.svg"): tile_svg(),
        os.path.join(root, "branding/merlin-password-favicon.svg"): password_svg(),
        os.path.join(root, "branding/merlin-mono.svg"): mono_svg(),
        os.path.join(theme, "product_logo.svg"): tile_svg(),
        os.path.join(theme, "product_logo_animation.svg"): tile_svg(),
        os.path.join(theme, "mac/AppIcon.icon/Assets/merlin.svg"): icon_composer_layer(),
        os.path.join(icons, "product.icon"): vector_icon(24),
        os.path.join(icons, "product_refresh.icon"): vector_icon(24),
    }


def main() -> int:
    if sys.argv[1:] != ["--write"]:
        print(__doc__)
        return 2
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for path, text in outputs(root).items():
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", os.path.relpath(path, root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
