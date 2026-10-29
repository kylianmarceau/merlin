#!/usr/bin/env bash
# Regenerates every Merlin icon file from the SVGs in branding/:
#   * branding/merlin-app-icon-1024.png and branding/merlin.icns
#   * the asset catalog PNGs in overlay/chrome/app/theme/merlin/mac/
#   * overlay/.../mac/Assets.car and app.icns, compiled with Chromium's
#     tools/mac/icons/compile_car.py (needs Xcode 26+ and the checkout)
#
# The macOS 26+ icon comes from overlay/.../mac/AppIcon.icon (Icon Composer
# format, hand-written); edit its merlin.svg and icon.json directly.
#
# Run after changing branding/merlin-app-icon.svg or AppIcon.icon, then
# commit the outputs: Chromium checks its compiled icons in, and so do we.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
SRC="$CHROMIUM_DIR/src"
ICON="$ROOT/branding/merlin-app-icon.svg"
MAC="$ROOT/overlay/chrome/app/theme/merlin/mac"
XC="$MAC/Assets.xcassets"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
swiftc -O "$ROOT/scripts/render_svg.swift" -o "$work/render_svg"
render() { "$work/render_svg" "$ICON" "$1" "$2"; }

# Pre-macOS 26 app icon and the document badge, in the asset catalog.
for s in 16 32 64 128 256 512; do
  render "$XC/AppIcon.appiconset/appicon_$s.png" "$s"
done
render "$XC/Icon.iconset/icon_256x256.png" 256
render "$XC/Icon.iconset/icon_256x256@2x.png" 512

# A standalone .icns for the DMG and anywhere outside the build.
mkdir "$work/merlin.iconset"
for s in 16 32 128 256 512; do
  render "$work/merlin.iconset/icon_${s}x${s}.png" "$s"
  render "$work/merlin.iconset/icon_${s}x${s}@2x.png" $((s * 2))
done
iconutil -c icns "$work/merlin.iconset" -o "$ROOT/branding/merlin.icns"
render "$ROOT/branding/merlin-app-icon-1024.png" 1024

# The bundle's app.icns, in Chromium's 1x-only layout (docs/mac/icons.md).
# compile_car.py replaces it with actool's own when actool emits one.
mkdir "$work/app.iconset"
for s in 16 32 128 256 512; do
  render "$work/app.iconset/icon_${s}x${s}.png" "$s"
done
iconutil -c icns "$work/app.iconset" -o "$MAC/app.icns"

[[ -f "$SRC/tools/mac/icons/compile_car.py" ]] ||
  { echo "No Chromium checkout at $SRC; Assets.car not rebuilt" >&2; exit 1; }
python3 "$SRC/tools/mac/icons/compile_car.py" "$XC"
echo "Rebuilt: branding/merlin.icns, $MAC/{app.icns,Assets.car}"
