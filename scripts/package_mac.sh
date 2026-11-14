#!/usr/bin/env bash
# Packages out/Release/Merlin.app for GitHub Releases.
#
#   MERLIN_VERSION=0.1.0-beta.1 scripts/package_mac.sh
#
# Writes to dist/<version>/:
#   Merlin-<version>-arm64.dmg          the download: app, Applications link,
#                                       install notes, licence, notices
#   Merlin-<version>-arm64.dmg.sha256   its checksum, for the release page
#   build-info.txt                      source commit, Chromium pin, GN args,
#                                       bundle ID and binary UUIDs
#   Merlin-<version>-arm64-dSYMs.zip    debug symbols; keep them, don't upload
#
# No Developer ID, notarization or stapling: the release policy excludes them
# (docs/RELEASE.md). The app is ad-hoc signed instead. The linker already
# signs each binary, but that leaves the bundle without sealed resources, and
# macOS reports a downloaded copy as damaged. Signing every nested binary and
# bundle, innermost first, gives a complete signature, so Gatekeeper offers
# Open Anyway. No hardened runtime, so no entitlements are needed.
#
# Needs out/Release from scripts/build_release.sh (which also writes
# credits.html). MERLIN_PACKAGE_DEV=1 accepts a component build or the
# placeholder bundle ID, to try this script out; its output is named
# *-dev-not-for-release and must not be published. MERLIN_SKIP_SYMBOLS=1
# skips the dSYM archive.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
OUT="${OUT:-out/Release}"
BUILD="$CHROMIUM_DIR/src/$OUT"
APP="${MERLIN_APP:-$BUILD/Merlin.app}"
VERSION="${MERLIN_VERSION:-}"
DEV="${MERLIN_PACKAGE_DEV:-0}"

die() { echo "package_mac: $*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] ||
  die "set MERLIN_VERSION to a version such as 0.1.0-beta.1"
[[ -d "$APP" ]] || die "no app at $APP; run scripts/build_release.sh"
[[ -f "$BUILD/credits.html" ]] ||
  die "no $BUILD/credits.html; run OUT=$OUT scripts/licenses.sh"

plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist"; }
bundle_id="$(plist CFBundleIdentifier)"
chromium_version="$(plist CFBundleShortVersionString)"
min_macos="$(plist LSMinimumSystemVersion)"

suffix=""
if grep -Eq '^[[:space:]]*is_component_build[[:space:]]*=[[:space:]]*true' "$BUILD/args.gn"; then
  [[ "$DEV" == 1 ]] || die "$OUT is a component build; a release needs build/args.release.gn"
  suffix="-dev-not-for-release"
fi
if [[ "$bundle_id" == local.* ]]; then
  [[ "$DEV" == 1 ]] || die "bundle ID $bundle_id is the placeholder; set MAC_BUNDLE_ID in overlay/chrome/app/theme/merlin/BRANDING and rebuild"
  suffix="-dev-not-for-release"
fi

name="Merlin-$VERSION-arm64$suffix"
dist="$ROOT/dist/$VERSION$suffix"
mkdir -p "$dist"
stage="$(mktemp -d "${TMPDIR:-/tmp}/merlin-package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

echo "==> copying Merlin.app"
ditto "$APP" "$stage/Merlin.app"
xattr -cr "$stage/Merlin.app"

echo "==> English only"
# Merlin ships English (US and UK) only (decision 57): about 47 MB of
# Chromium's other translations go. Removed from the app's own Resources
# too, so macOS picks English instead of a translation that isn't there.
# Before signing, which seals what remains.
removed=0
while IFS= read -r -d '' dir; do
  rm -rf "$dir"
  removed=$((removed + 1))
done < <(find "$stage/Merlin.app/Contents/Resources" \
  "$stage/Merlin.app/Contents/Frameworks/Merlin Framework.framework/Versions" \
  -maxdepth 3 -type d -name '*.lproj' \
  -not -name 'Base.lproj' \
  -not -regex '.*/en\(_GB\)\{0,1\}\(_FEMININE\|_MASCULINE\|_NEUTER\)\{0,1\}\.lproj' \
  -not -path '*/Helpers/*' -print0)
echo "removed $removed translations"

echo "==> release version"
# The shell compares this with GitHub Releases for Settings › General ›
# Updates. Chromium's own version stays in CFBundleShortVersionString.
/usr/libexec/PlistBuddy -c "Delete :MerlinVersion" "$stage/Merlin.app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :MerlinVersion string $VERSION" "$stage/Merlin.app/Contents/Info.plist"

echo "==> ad-hoc signing, innermost first"
# Every Mach-O file and code bundle, deepest path first, so each container
# is signed after everything inside it. Symlinks are skipped.
python3 - "$stage/Merlin.app" > "$stage/sign-order" <<'PY'
import os, sys
MAGIC = {b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe",
         b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"}
BUNDLES = (".app", ".framework", ".xpc", ".appex", ".bundle", ".plugin")
found = []
for top, dirs, files in os.walk(sys.argv[1]):
    for d in dirs:
        p = os.path.join(top, d)
        if d.endswith(BUNDLES) and not os.path.islink(p):
            found.append(p)
    for f in files:
        p = os.path.join(top, f)
        if os.path.islink(p):
            continue
        with open(p, "rb") as fh:
            if fh.read(4) in MAGIC:
                found.append(p)
found.append(sys.argv[1])
for p in sorted(set(found), key=lambda p: -p.count(os.sep)):
    sys.stdout.write(p + "\0")
PY
count=0
while IFS= read -r -d '' path; do
  codesign --force --sign - --timestamp=none "$path"
  count=$((count + 1))
done < "$stage/sign-order"
rm "$stage/sign-order"
echo "signed $count items"
codesign --verify --deep --strict --verbose=1 "$stage/Merlin.app"
codesign -dv "$stage/Merlin.app" 2>&1 | grep -E '^(Identifier|Signature|Sealed Resources)'

echo "==> build information"
framework="$stage/Merlin.app/Contents/Frameworks/Merlin Framework.framework/Merlin Framework"
commit="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]] || commit="$commit (with uncommitted changes)"
{
  echo "Merlin $VERSION$suffix"
  echo "Packaged: $(date -u +%Y-%m-%dT%H:%M:%SZ) on macOS $(sw_vers -productVersion)"
  echo "Merlin commit: $commit"
  echo "Chromium: $chromium_version"
  sed 's/^/Pin /' UPSTREAM_PIN
  echo "Bundle ID: $bundle_id"
  echo "Minimum macOS: $min_macos"
  echo "Architecture: arm64"
  echo "Signature: ad-hoc (no Developer ID, not notarized)"
  if [[ -f "$APP/Contents/Resources/merlin-shell-build.json" ]]; then
    echo "UI: React Native macOS / Hermes (shell ABI 1)"
    cat "$APP/Contents/Resources/merlin-shell-build.json"
  fi
  echo
  echo "Binary UUIDs (match these to the dSYMs):"
  dwarfdump --uuid "$stage/Merlin.app/Contents/MacOS/Merlin" "$framework" | sed "s|$stage/||"
  echo
  echo "GN args ($OUT/args.gn):"
  sed 's/^/  /' "$BUILD/args.gn"
} > "$dist/build-info.txt"

echo "==> disk image"
ln -s /Applications "$stage/Applications"
cp "$ROOT/LICENSE" "$stage/LICENSE.txt"
cp "$BUILD/credits.html" "$stage/Third-party notices.html"
cp "$dist/build-info.txt" "$stage/Build info.txt"
cat > "$stage/Read me first.txt" <<EOF
Merlin $VERSION for Macs with Apple Silicon, macOS $min_macos or later.

1. Drag Merlin into Applications.
2. Open Merlin from Applications. macOS will say it can't check the app,
   because Merlin is not notarized by Apple.
3. Open System Settings > Privacy & Security, scroll to the message about
   Merlin and click Open Anyway. Confirm Open.

To update later, quit Merlin and replace the app in Applications. Your
bookmarks, passwords, workspaces and config are kept.

Full steps, known limitations and how to report problems:
https://github.com/kylianmarceau/merlin/blob/main/docs/RELEASE.md
EOF
dmg="$dist/$name.dmg"
rm -f "$dmg"
hdiutil create -volname "Merlin $VERSION" -srcfolder "$stage" -format UDZO \
  -imagekey zlib-level=9 -ov "$dmg" >/dev/null
(cd "$dist" && shasum -a 256 "$name.dmg" > "$name.dmg.sha256")

if [[ "${MERLIN_SKIP_SYMBOLS:-0}" != 1 ]]; then
  dsyms=()
  while IFS= read -r -d '' d; do dsyms+=("$d"); done \
    < <(find "$BUILD" -maxdepth 1 -name '*.dSYM' -print0)
  if (( ${#dsyms[@]} )); then
    echo "==> debug symbols (${#dsyms[@]} dSYMs)"
    rm -rf "$stage/dSYMs" && mkdir "$stage/dSYMs"
    for d in "${dsyms[@]}"; do ditto "$d" "$stage/dSYMs/$(basename "$d")"; done
    if [[ -n "${MERLIN_SHELL_DSYM:-}" ]]; then
      [[ -d "$MERLIN_SHELL_DSYM" ]] || die "no shell dSYM at $MERLIN_SHELL_DSYM"
      ditto "$MERLIN_SHELL_DSYM" "$stage/dSYMs/$(basename "$MERLIN_SHELL_DSYM")"
    fi
    ditto -c -k --keepParent "$stage/dSYMs" "$dist/$name-dSYMs.zip"
  else
    echo "warning: no dSYMs in $BUILD; crash reports from this build can't be symbolized" >&2
  fi
fi

echo
echo "Done: $dist"
ls -lh "$dist"
cat "$dist/$name.dmg.sha256"
if [[ -n "$suffix" ]]; then
  echo
  echo "This is a development package. Do not publish it."
else
  cat <<EOF

Next:
  1. Upload to a draft pre-release:
     gh release create v$VERSION --draft --prerelease --title "Merlin $VERSION" \\
       --notes-file docs/RELEASE_NOTES.md "$dmg" "$dmg.sha256"
  2. Download it in a browser on another Mac and run the install test in
     docs/RELEASE.md before publishing the draft.
EOF
fi
