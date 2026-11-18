#!/usr/bin/env bash
# Regenerates every Merlin icon file:
#   * from the falcon SVGs in branding/: product tiles, favicons, the mono
#     glyph and the wordmarks
#   * from the painted app icon, branding/app-icons/daylight.png (Apple grid)
#     and daylight-tile.png (full bleed): branding/merlin-app-icon-1024.png,
#     branding/merlin.icns, the asset catalog PNGs and the Icon Composer layer
#     in overlay/chrome/app/theme/merlin/mac/
#   * overlay/.../mac/Assets.car and app.icns, compiled with Chromium's
#     tools/mac/icons/compile_car.py (needs Xcode 26+ and the checkout)
#
# The macOS 26+ icon comes from overlay/.../mac/AppIcon.icon (Icon Composer
# format), whose one layer is the full-bleed Daylight painting.
# branding/impasto/export_app_icons.py renders the painted icons.
#
# Run after changing an app icon or the falcon, then commit the outputs:
# Chromium checks its compiled icons in, and so do we.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
SRC="$CHROMIUM_DIR/src"
ICON="$ROOT/branding/app-icons/daylight.png"
ICON_TILE="$ROOT/branding/app-icons/daylight-tile.png"
MAC="$ROOT/overlay/chrome/app/theme/merlin/mac"
XC="$MAC/Assets.xcassets"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 "$ROOT/scripts/merlin_mark.py" --write
swiftc -module-cache-path "$work/swift-cache" -O "$ROOT/scripts/render_svg.swift" -o "$work/render_svg"
swiftc -module-cache-path "$work/swift-cache" -O "$ROOT/scripts/render_wordmark.swift" -o "$work/render_wordmark"
# The painted app icon is raster: scale it down with sips.
render() { sips -s format png -z "$2" "$2" "$ICON" --out "$1" >/dev/null; }

# Product tiles, template glyph and password favicon at every resource scale.
TILE="$ROOT/branding/merlin-favicon.svg"
for s in 64 128 256; do
  "$work/render_svg" "$TILE" "$ROOT/overlay/chrome/app/theme/merlin/product_logo_$s.png" "$s"
done
"$work/render_svg" "$ROOT/branding/merlin-mono.svg" "$ROOT/overlay/chrome/app/theme/merlin/product_logo_22_mono.png" 22
for scale in 1 2; do
  theme="$ROOT/overlay/chrome/app/theme/default_$((scale * 100))_percent/merlin"
  components="$ROOT/overlay/components/resources/default_$((scale * 100))_percent/merlin"
  for s in 16 32; do
    "$work/render_svg" "$TILE" "$theme/product_logo_$s.png" $((s * scale))
  done
  "$work/render_svg" "$TILE" "$components/favicon_product.png" $((16 * scale))
  "$work/render_svg" "$ROOT/branding/merlin-password-favicon.svg" "$theme/favicon_password_manager.png" $((16 * scale))
  for variant in normal white; do
    suffix=""; ink="AA4C32"
    if [[ "$variant" == white ]]; then suffix="_white"; ink="F5E9D7"; fi
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-toolbar-mask.png" "$theme/product_logo_name_22$suffix.png" $((22 * scale)) "$ink"
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-version-mask.png" "$components/product_logo$suffix.png" $((32 * scale)) "$ink"
  done
done

# macOS 26+: the Icon Composer layer is the full-bleed painting; macOS
# applies the icon shape itself.
mkdir -p "$MAC/AppIcon.icon/Assets"
rm -f "$MAC/AppIcon.icon/Assets/"*
cp "$ICON_TILE" "$MAC/AppIcon.icon/Assets/daylight.png"

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

# The bundle's app.icns, in Chromium's 1x-only layout (Chromium's //docs/mac/icons.md).
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
