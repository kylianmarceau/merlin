#!/usr/bin/env bash
# Builds MerlinDockTile.plugin into a built React host app and points the
# app's Info.plist at it (NSDockTilePlugIn), as Ardia does. The Dock loads the
# plug-in to keep the chosen app icon after Merlin quits. scripts/
# build_react_shell.sh runs this; scripts/assemble_react_app.py carries the
# plug-in and the Info.plist key into Merlin.app. Signing is packaging's job
# (scripts/package_mac.sh signs .plugin bundles); the linker's ad-hoc
# signature is enough to load it locally.
#
#   packages/shell/docktile/build.sh path/to/MerlinShell.app
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="${1:?usage: build.sh path/to/App.app}"
[[ -d "$app/Contents" ]] || { echo "build.sh: no app at $app" >&2; exit 1; }
name="MerlinDockTile"
info="$app/Contents/Info.plist"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info").DockTilePlugIn"
min_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$info" 2>/dev/null || echo 14.0)"
plugin="$app/Contents/PlugIns/$name.plugin"
sources=("$here/DockTilePlugIn.swift" "$here/../macos/AppIcons.swift")
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rm -rf "$plugin"
mkdir -p "$plugin/Contents/MacOS"
xcrun swiftc -O -g -parse-as-library -module-name "$name" -target "arm64-apple-macos$min_os" \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" -module-cache-path "$work/cache" \
  -Xlinker -bundle -emit-executable -framework AppKit \
  -o "$plugin/Contents/MacOS/$name" "${sources[@]}"
# Its symbols, next to the app's own dSYM, for packaging to match by UUID.
dsym="$(dirname "$app")/$name.plugin.dSYM"
rm -rf "$dsym"
xcrun dsymutil "$plugin/Contents/MacOS/$name" -o "$dsym"

cat > "$plugin/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>$min_os</string>
  <key>NSPrincipalClass</key><string>MerlinDockTilePlugIn</string>
</dict>
</plist>
PLIST

/usr/libexec/PlistBuddy -c "Delete :NSDockTilePlugIn" "$info" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSDockTilePlugIn string $name.plugin" "$info"
echo "Dock tile plug-in: $plugin"
