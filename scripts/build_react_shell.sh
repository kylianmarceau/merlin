#!/usr/bin/env bash
# Explicit, maintainer-run build of the React host. Does not rebuild Chromium.
set -euo pipefail
# CocoaPods fails with an encoding error under a non-UTF-8 locale.
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"
[[ "$LC_ALL" == *UTF-8* ]] || export LC_ALL=en_US.UTF-8
cd "$(dirname "$0")/.."
ROOT="$PWD"
CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA="${MERLIN_SHELL_DERIVED_DATA:-$ROOT/apps/browser/build/native}"
[[ "$CONFIGURATION" == Release || "$CONFIGURATION" == Debug ]] || {
  echo "CONFIGURATION must be Release or Debug" >&2; exit 1;
}
command -v node >/dev/null
command -v pnpm >/dev/null
command -v pod >/dev/null
python3 scripts/sync_shell_headers.py --check
pnpm install --frozen-lockfile
pnpm ui:check
pnpm ui:test
(
  cd apps/browser/macos
  RCT_NEW_ARCH_ENABLED=0 pod install
)
# Expo registers a module only if autolinking found its podspec; without this
# the app builds but shows "Cannot find native module" at launch.
PROVIDER="apps/browser/macos/Pods/Target Support Files/Pods-MerlinShell-macOS/ExpoModulesProvider.swift"
for module in $(python3 -c 'import json,sys
for p in sys.argv[1:]: print(*json.load(open(p))["apple"]["modules"])' packages/engine/expo-module.config.json packages/shell/expo-module.config.json packages/webkit/expo-module.config.json); do
  grep -q "$module.self" "$PROVIDER" || {
    echo "Expo autolinking did not register $module; check its expo-module.config.json" >&2; exit 1;
  }
done
FORCE_BUNDLING=1 RCT_NEW_ARCH_ENABLED=0 xcodebuild \
  -workspace "$ROOT/apps/browser/macos/MerlinShell.xcworkspace" \
  -scheme MerlinShell-macOS -configuration "$CONFIGURATION" \
  -destination 'generic/platform=macOS' -derivedDataPath "$DERIVED_DATA" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build
echo "React host: $DERIVED_DATA/Build/Products/$CONFIGURATION/MerlinShell.app"
echo "Next: assemble it with the rebuilt Chromium app using scripts/assemble_react_app.py."
