#!/usr/bin/env bash
# Regenerates Merlin's product tiles, favicons, glyphs, wordmarks and default
# app icon from branding/merlin-pixel.svg. The macOS asset catalog is compiled
# with Chromium's tools/mac/icons/compile_car.py (Xcode 26+ and the checkout).
# Commit the in-tree build outputs after changing the artwork.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
SRC="$CHROMIUM_DIR/src"
MAC="$ROOT/overlay/chrome/app/theme/merlin/mac"
XC="$MAC/Assets.xcassets"
START="$ROOT/apps/browser/src/components/start"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 "$ROOT/scripts/merlin_mark.py" --write
swiftc -module-cache-path "$work/swift-cache" -O "$ROOT/scripts/render_svg.swift" -o "$work/render_svg"
swiftc -module-cache-path "$work/swift-cache" -O "$ROOT/scripts/render_wordmark.swift" -o "$work/render_wordmark"
TILE="$ROOT/branding/merlin-favicon.svg"
render() { "$work/render_svg" "$TILE" "$1" "$2"; }

# Product tiles, template glyph and password favicon at every resource scale.
for s in 64 128 256; do
  render "$ROOT/overlay/chrome/app/theme/merlin/product_logo_$s.png" "$s"
done
"$work/render_svg" "$ROOT/branding/merlin-mono.svg" "$ROOT/overlay/chrome/app/theme/merlin/product_logo_22_mono.png" 22
for scale in 1 2; do
  theme="$ROOT/overlay/chrome/app/theme/default_$((scale * 100))_percent/merlin"
  components="$ROOT/overlay/components/resources/default_$((scale * 100))_percent/merlin"
  for s in 16 32; do
    render "$theme/product_logo_$s.png" $((s * scale))
  done
  render "$components/favicon_product.png" $((16 * scale))
  "$work/render_svg" "$ROOT/branding/merlin-password-favicon.svg" "$theme/favicon_password_manager.png" $((16 * scale))
  for variant in normal white; do
    suffix=""; ink="AA4C32"
    if [[ "$variant" == white ]]; then suffix="_white"; ink="F5E9D7"; fi
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-toolbar-mask.png" "$theme/product_logo_name_22$suffix.png" $((22 * scale)) "$ink"
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-version-mask.png" "$components/product_logo$suffix.png" $((32 * scale)) "$ink"
  done
done

# AppKit image tinting can fill the transparent pixels on macOS. Bake both inks.
render_start_mark() {
  local part="$1" name="$2" size="$3" ink="$4"
  python3 "$ROOT/scripts/merlin_mark.py" "--start-$part" "$ink" > "$work/start.svg"
  "$work/render_svg" "$work/start.svg" "$START/$name.png" "$size"
  "$work/render_svg" "$work/start.svg" "$START/$name@2x.png" $((size * 2))
}
render_start_mark falcon merlin-logo 76 '#1F2421'
render_start_mark falcon merlin-logo-light 76 '#F7F7F7'
render_start_mark prompt merlin-prompt 18 '#1F2421'
render_start_mark prompt merlin-prompt-light 18 '#FFFFFF'

# The Dock override and fallback app icons need the transparent macOS margin.
python3 "$ROOT/scripts/merlin_mark.py" --app-icon > "$work/app-icon.svg"
render_app_icon() { "$work/render_svg" "$work/app-icon.svg" "$1" "$2"; }
render_app_icon "$ROOT/packages/shell/macos/AppIcons/MerlinAppIcon-default.png" 512

# macOS 26+ supplies the icon mask and the background in icon.json.
python3 "$ROOT/scripts/merlin_mark.py" --composer > "$work/composer.svg"
"$work/render_svg" "$work/composer.svg" "$MAC/AppIcon.icon/Assets/mark.png" 1024

# Pre-macOS 26 app icon and the document badge, in the asset catalog.
for s in 16 32 64 128 256 512; do
  render_app_icon "$XC/AppIcon.appiconset/appicon_$s.png" "$s"
done
render_app_icon "$XC/Icon.iconset/icon_256x256.png" 256
render_app_icon "$XC/Icon.iconset/icon_256x256@2x.png" 512

# A standalone .icns for the DMG and anywhere outside the build.
mkdir "$work/merlin.iconset"
for s in 16 32 128 256 512; do
  render_app_icon "$work/merlin.iconset/icon_${s}x${s}.png" "$s"
  render_app_icon "$work/merlin.iconset/icon_${s}x${s}@2x.png" $((s * 2))
done
iconutil -c icns "$work/merlin.iconset" -o "$ROOT/branding/merlin.icns"
render_app_icon "$ROOT/branding/merlin-app-icon-1024.png" 1024

# The bundle's app.icns, in Chromium's 1x-only layout (Chromium's //docs/mac/icons.md).
# compile_car.py replaces it with actool's own when actool emits one.
mkdir "$work/app.iconset"
for s in 16 32 128 256 512; do
  render_app_icon "$work/app.iconset/icon_${s}x${s}.png" "$s"
done
iconutil -c icns "$work/app.iconset" -o "$MAC/app.icns"

[[ -f "$SRC/tools/mac/icons/compile_car.py" ]] ||
  { echo "No Chromium checkout at $SRC; Assets.car not rebuilt" >&2; exit 1; }
python3 "$SRC/tools/mac/icons/compile_car.py" "$XC"
echo "Rebuilt: branding/merlin.icns, $MAC/{app.icns,Assets.car}"
