#!/usr/bin/env python3
# Copyright 2026 The modal_browser Authors
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""Generate Merlin's product tiles and glyphs from the pixel falcon SVG.

    python3 scripts/merlin_mark.py --write

scripts/build_branding.sh renders all PNG, ICNS and macOS asset catalog files.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
CREAM = "#F5E9D7"
RUST = "#AA4C32"
SVG_NS = "http://www.w3.org/2000/svg"
SOURCE = ET.parse(ROOT / "branding/merlin-pixel.svg").getroot()
VIEW_BOX = SOURCE.attrib["viewBox"]
BACKGROUND, FALCON = SOURCE.findall(f"{{{SVG_NS}}}path")
FALCON_PATH = FALCON.attrib["d"]
FALCON_INK = FALCON.attrib["fill"]
FILL_RULE = FALCON.attrib["fill-rule"]


def _parse_polygon(path: str) -> list[tuple[str, list[float]]]:
    """Read the source's absolute move, line and close commands."""
    commands = []
    for command, coordinates in re.findall(r"([A-Za-z])([^A-Za-z]*)", path):
        values = [float(value) for value in coordinates.split()]
        if (command, len(values)) not in {("M", 2), ("L", 2), ("Z", 0)}:
            raise ValueError(f"Unexpected command in pixel falcon: {command}{coordinates}")
        commands.append((command, values))
    return commands


CONTOURS = _parse_polygon(FALCON_PATH)
X, Y = zip(*(values for _, values in CONTOURS if values))
BOX = (min(X), min(Y), max(X), max(Y))


def _f(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _commands(k=1.0, ox=0.0, oy=0.0):
    for command, values in CONTOURS:
        yield command, [value * k + (ox if i % 2 == 0 else oy)
                        for i, value in enumerate(values)]


def _path(k=1.0, ox=0.0, oy=0.0):
    return "".join(command + " ".join(_f(value) for value in values)
                   for command, values in _commands(k, ox, oy))


def _falcon(path: str, color: str | None) -> str:
    fill = f' fill="{color}"' if color is not None else ""
    return f'<path d="{path}" fill-rule="{FILL_RULE}"{fill}/>'


def _fit(x0: float, y0: float, size: float, frac: float) -> tuple:
    width, height = BOX[2] - BOX[0], BOX[3] - BOX[1]
    k = size * frac / max(width, height)
    return k, x0 + (size - width * k) / 2 - BOX[0] * k, y0 + (size - height * k) / 2 - BOX[1] * k


def glyph(x0: float, y0: float, size: float, color: str | None = None, frac: float = 0.9) -> str:
    """The foreground mark fitted to a square, optionally in a surface's ink color."""
    return _falcon(_path(*_fit(x0, y0, size, frac)), color)


def vector_icon(size: int, frac: float = 0.92) -> str:
    """The same contours in Chromium's native .icon path language."""
    names = {"M": "MOVE_TO", "L": "LINE_TO", "Z": "CLOSE"}
    # Views uses even-odd fill by default, matching the pixel artwork.
    lines = [f"CANVAS_DIMENSIONS, {size},"]
    for command, values in _commands(*_fit(0, 0, size, frac)):
        # Explicit f suffixes avoid narrowing decimal doubles in C++ arrays.
        args = ", " + ", ".join(f"{value:.3f}f" for value in values) if values else ""
        lines.append(names[command] + args + ",")
    return ("// Copyright 2026 The modal_browser Authors\n"
            "// Use of this source code is governed by a BSD-style license that can be\n"
            "// found in the LICENSE file.\n//\n"
            "// Merlin's pixel falcon (scripts/merlin_mark.py).\n\n"
            + "\n".join(lines) + "\n")


def tile_svg() -> str:
    """The supplied full-color artwork with a fluid SVG viewport."""
    return (f'<svg xmlns="{SVG_NS}" viewBox="{VIEW_BOX}" role="img" aria-label="Merlin">'
            f'<path d="{BACKGROUND.attrib["d"]}" fill="{BACKGROUND.attrib["fill"]}"/>'
            f'{_falcon(FALCON_PATH, FALCON_INK)}</svg>\n')


def composer_svg() -> str:
    """The foreground layer for macOS, which fills and masks the icon itself."""
    return (f'<svg xmlns="{SVG_NS}" viewBox="{VIEW_BOX}">'
            f'{_falcon(FALCON_PATH, FALCON_INK)}</svg>\n')


def mark_svg() -> str:
    margin = 40
    x, y = BOX[0] - margin, BOX[1] - margin
    width, height = BOX[2] - BOX[0] + 2 * margin, BOX[3] - BOX[1] + 2 * margin
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_f(x)} {_f(y)} {_f(width)} {_f(height)}" '
            f'role="img" aria-label="Merlin">{_falcon(FALCON_PATH, FALCON_INK)}</svg>\n')


def mono_svg(size: int = 22, color: str = "#000000") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'{glyph(0, 0, size, color, frac=0.95)}</svg>\n')


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
        root / "branding/merlin-favicon.svg": tile_svg(),
        root / "branding/merlin-password-favicon.svg": password_svg(),
        root / "branding/merlin-mono.svg": mono_svg(),
        theme / "product_logo.svg": tile_svg(),
        theme / "product_logo_animation.svg": tile_svg(),
        icons / "product.icon": vector_icon(24),
        icons / "product_refresh.icon": vector_icon(24),
    }


def main() -> int:
    if sys.argv[1:] == ["--composer"]:
        sys.stdout.write(composer_svg())
        return 0
    if sys.argv[1:] != ["--write"]:
        print(__doc__)
        return 2
    for path, text in outputs(ROOT).items():
        path.write_text(text)
        print("wrote", path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
