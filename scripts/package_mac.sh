#!/usr/bin/env bash
# Signs, notarizes and packages a distribution build for testers.
#
#   scripts/package_mac.sh                 # dry run: prints every step
#   MODAL_SIGN=1 scripts/package_mac.sh    # really sign and notarize
#
# Needs (for MODAL_SIGN=1):
#   * a non-component build in out/Release (build/args.release.gn);
#   * MODAL_SIGN_IDENTITY  "Developer ID Application: Name (TEAMID)";
#   * MODAL_NOTARY_PROFILE a keychain profile made with
#                          `xcrun notarytool store-credentials`.
#
# Uses Chromium's own signing scripts (chrome/installer/mac/signing), which
# know the bundle's helpers, frameworks and entitlements; a plain
# `codesign --deep` does not produce a valid Chromium bundle.
#
# UNVERIFIED: no Developer ID is available on the development machine, so
# only the dry run has been exercised.
set -euo pipefail

CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
OUT="${OUT:-out/Release}"
APP="$CHROMIUM_DIR/src/$OUT/Merlin.app"
DEST="${DEST:-$CHROMIUM_DIR/src/$OUT/signed}"
run() {
  if [[ "${MODAL_SIGN:-0}" == 1 ]]; then
    echo "+ $*"
    "$@"
  else
    echo "(dry run) $*"
  fi
}

if [[ "${MODAL_SIGN:-0}" == 1 ]]; then
  : "${MODAL_SIGN_IDENTITY:?set MODAL_SIGN_IDENTITY}"
  : "${MODAL_NOTARY_PROFILE:?set MODAL_NOTARY_PROFILE}"
  [[ -d "$APP" ]] || { echo "no build at $APP"; exit 1; }
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
  if [[ "$bundle_id" == local.* ]]; then
    echo "bundle ID $bundle_id is the development placeholder; set MAC_BUNDLE_ID"
    echo "in overlay/chrome/app/theme/merlin/BRANDING before signing"
    exit 1
  fi
  if grep -q 'is_component_build = true' "$CHROMIUM_DIR/src/$OUT/args.gn"; then
    echo "component builds cannot be signed; use build/args.release.gn"
    exit 1
  fi
fi

# 1. Sign every nested binary with the hardened runtime and Chromium's
#    entitlements, then build a DMG.
run "$CHROMIUM_DIR/src/chrome/installer/mac/signing/driver.py" \
  --input "$CHROMIUM_DIR/src/$OUT" --output "$DEST" \
  --identity "${MODAL_SIGN_IDENTITY:-<identity>}"

# 2. Notarize with Apple and staple the ticket, so Gatekeeper accepts the
#    app offline.
DMG="$(ls "$DEST"/*.dmg 2>/dev/null | head -1 || true)"
run xcrun notarytool submit "${DMG:-<dmg>}" \
  --keychain-profile "${MODAL_NOTARY_PROFILE:-<profile>}" --wait
run xcrun stapler staple "${DMG:-<dmg>}"

# 3. Check what a tester's Mac will check.
run spctl --assess --type open --context context:primary-signature -v "${DMG:-<dmg>}"
echo "Done. Updates are manual for now."
