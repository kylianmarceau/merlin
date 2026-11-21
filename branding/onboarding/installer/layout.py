"""Finder layout for the Merlin installer, evaluated by dmgbuild."""

from pathlib import Path

stage = Path(defines["stage"])
files = [str(path) for path in sorted(stage.iterdir())]
symlinks = {"Applications": "/Applications"}
background = defines["background"]
format = "UDZO"
compression_level = 9
window_rect = ((160, 120), (720, 466))
icon_size = 72
text_size = 12
icon_locations = {
    "Merlin.app": (192, 205),
    "Applications": (528, 205),
    "Read me first.txt": (80, 355),
    "LICENSE.txt": (220, 355),
    "NOTICE.txt": (360, 355),
    "Third-party notices.html": (500, 355),
    "Build info.txt": (640, 355),
}
