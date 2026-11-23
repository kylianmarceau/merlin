#!/usr/bin/env bash
# Regenerates Merlin's product tiles, favicons, glyphs, wordmarks and default
# app icon from the Ice Blue falcon artwork. The macOS asset catalog is compiled
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
TILE="$ROOT/branding/merlin-ice-blue.png"
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
    suffix=""; ink="1738AB"
    if [[ "$variant" == white ]]; then suffix="_white"; ink="E1ECFF"; fi
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-toolbar-mask.png" "$theme/product_logo_name_22$suffix.png" $((22 * scale)) "$ink"
    "$work/render_wordmark" "$TILE" "$ROOT/branding/merlin-wordmark-version-mask.png" "$components/product_logo$suffix.png" $((32 * scale)) "$ink"
  done
done

# Use the painted tile on New Tab and the onboarding workspace preview.
render "$START/merlin-logo.png" 76
render "$START/merlin-logo@2x.png" 152

# The New Tab button uses a small monochrome terminal prompt in both themes.
render_start_prompt() {
  local name="$1" ink="$2"
  python3 "$ROOT/scripts/merlin_mark.py" --start-prompt "$ink" > "$work/prompt.svg"
  "$work/render_svg" "$work/prompt.svg" "$START/$name.png" 18
  "$work/render_svg" "$work/prompt.svg" "$START/$name@2x.png" 36
}
render_start_prompt merlin-prompt '#1F2421'
render_start_prompt merlin-prompt-light '#FFFFFF'

# The artwork already has a small transparent border. Pad it to macOS's
# standard icon footprint for the default Dock override and older systems.
render_app_icon() { "$work/render_svg" "$TILE" "$1" "$2" 0.07; }
render_app_icon "$ROOT/packages/shell/macos/AppIcons/MerlinAppIcon-default.png" 512

# Icon Composer supplies the background and system mask. Give it the painted
# falcon alone so macOS can restyle the foreground and background separately.
"$work/render_svg" "$TILE" "$MAC/AppIcon.icon/Assets/mark.png" 1024 -0.044 --falcon-layer

# Pre-macOS 26 app icon and the document badge, in the asset catalog.
for s in 16 32 64 128 256 512; do
  render_app_icon "$XC/AppIcon.appiconset/appicon_$s.png" "$s"
done
render_app_icon "$XC/Icon.iconset/icon_256x256.png" 256
render_app_icon "$XC/Icon.iconset/icon_256x256@2x.png" 512

# A native-size reference PNG for artwork tools.
render_app_icon "$ROOT/branding/merlin-app-icon-1024.png" 1024

# Use Chromium's tool to write its 1x-only compatibility icon.
[[ -f "$SRC/tools/mac/icons/compile_car.py" ]] ||
  { echo "No Chromium checkout at $SRC; Assets.car not rebuilt" >&2; exit 1; }
xcrun clang -fobjc-arc -framework Foundation -framework CoreGraphics \
  "$SRC/tools/mac/icons/makeicns2.m" -o "$work/makeicns2"
mkdir "$work/app.iconset"
for s in 16 32 128 256 512; do
  cp "$XC/AppIcon.appiconset/appicon_$s.png" "$work/app.iconset/$s.png"
done
"$work/makeicns2" "$work/app.iconset"
cp "$work/app.icns" "$ROOT/branding/merlin.icns"
cp "$work/app.icns" "$MAC/app.icns"
python3 "$SRC/tools/mac/icons/compile_car.py" "$XC"
echo "Rebuilt: branding/merlin.icns, $MAC/{app.icns,Assets.car}"
