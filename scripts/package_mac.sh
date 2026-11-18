#!/usr/bin/env bash
# Packages the assembled Merlin.app for GitHub Releases.
#
#   MERLIN_APP="$PWD/apps/browser/build/assembled/Merlin.app" \
#   MERLIN_VERSION=0.2.0 scripts/package_mac.sh
#
# MERLIN_APP is required and must be an app from scripts/assemble_react_app.py.
# The engine on its own (out/Release/Merlin.app) opens Chromium's windows
# without Merlin's interface, so it is refused: no assembly manifest, no
# Hermes, no React bundle, or no engine or shell API export.
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
# (docs/RELEASE.md). The app is ad-hoc signed instead (scripts/sign_app.py):
# every nested binary and bundle, innermost first, so Gatekeeper offers Open
# Anyway rather than calling a download damaged. It has the hardened runtime,
# with Chromium's entitlement files for the app (camera, microphone,
# location...) and its renderer and GPU helpers (JIT), and library
# validation off, which ad-hoc code (no team ID) needs.
#
# MERLIN_SIGN_IDENTITY names Merlin's self-signed certificate
# (scripts/create_signing_identity.sh; MERLIN_SIGN_KEYCHAIN if it isn't in
# the login keychain). Signed with it, every release has the same designated
# requirement, so saved passwords and privacy grants survive updates.
# Without it the signature is ad-hoc and packaging warns.
#
# Needs out/Release from scripts/build_release.sh (which also writes
# credits.html), the React host from scripts/build_react_shell.sh, and the two
# assembled. MERLIN_PACKAGE_DEV=1 accepts a component build or the
# placeholder bundle ID, to try this script out; its output is named
# *-dev-not-for-release and must not be published. MERLIN_SKIP_SYMBOLS=1
# (development packages only) skips the dSYM archive.
#
# Every packaged Mach-O file needs a dSYM with its UUID (scripts/
# match_dsyms.py), found in the engine's build directory and next to the
# React host (scripts/build_react_shell.sh writes MerlinShell.app.dSYM);
# MERLIN_SHELL_DSYM names one elsewhere. build-info.txt records the engine
# and shell source commits from the assembly manifest, and the packaging
# commit separately.
set -euo pipefail
# A relative MERLIN_APP means one relative to where the script was run.
if [[ -n "${MERLIN_APP:-}" && "$MERLIN_APP" != /* ]]; then
  MERLIN_APP="$PWD/$MERLIN_APP"
fi
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="${MERLIN_APP:-}"
VERSION="${MERLIN_VERSION:-}"
DEV="${MERLIN_PACKAGE_DEV:-0}"

die() { echo "package_mac: $*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] ||
  die "set MERLIN_VERSION to a version such as 0.2.0 or 0.3.0-beta.1"
assemble_hint="build it with scripts/build_release.sh and scripts/build_react_shell.sh, assemble it with scripts/assemble_react_app.py, then set MERLIN_APP to apps/browser/build/assembled/Merlin.app"
[[ -n "$APP" ]] || die "set MERLIN_APP to the assembled Merlin.app; $assemble_hint"
[[ -d "$APP" ]] || die "no app at $APP; $assemble_hint"
# Only the assembled product ships. out/Release/Merlin.app is the engine alone.
not_assembled() { die "$APP is not an assembled Merlin.app: $1. $assemble_hint"; }
[[ -f "$APP/Contents/Resources/merlin-shell-build.json" ]] ||
  not_assembled "it has no assembly manifest (Contents/Resources/merlin-shell-build.json)"
[[ -d "$APP/Contents/Frameworks/hermes.framework" ]] ||
  not_assembled "it has no Hermes framework"
[[ -f "$APP/Contents/Resources/main.jsbundle" ]] ||
  not_assembled "it has no React bundle (main.jsbundle)"
exports() { xcrun nm -gU "$1" 2>/dev/null | awk '{ print $NF }'; }
exports "$APP/Contents/Frameworks/Merlin Framework.framework/Merlin Framework" |
  grep -x _MerlinEngineGetAPI >/dev/null || not_assembled "its framework does not export MerlinEngineGetAPI"
exports "$APP/Contents/MacOS/Merlin" | grep -x _MerlinShellGetAPI >/dev/null ||
  not_assembled "its executable is not the React host (no MerlinShellGetAPI export)"

# Provenance comes from the assembly manifest, not from this checkout: the
# engine's and the host's source commits, their binary UUIDs and lockfiles.
manifest="$APP/Contents/Resources/merlin-shell-build.json"
field() { python3 -c 'import json, sys
value = json.load(open(sys.argv[1]))
for key in sys.argv[2].split("."):
    value = (value or {}).get(key) if isinstance(value, dict) else None
print("" if value is None else value if isinstance(value, str) else json.dumps(value))' "$manifest" "$1"; }
engine_commit="$(field engine.sourceCommit)"
shell_commit="$(field shell.sourceCommit)"
[[ -n "$engine_commit" && -n "$shell_commit" ]] ||
  not_assembled "its manifest records no engine or shell source commit (assembled before builds were stamped)"
stale="$(field staleProducts)"
if [[ "$stale" != "[]" ]]; then
  [[ "$DEV" == 1 ]] || die "$APP was assembled with --allow-stale from a stale $stale; rebuild, reassemble, then package"
fi
ENGINE_APP="$(field engineApp)"
SHELL_APP="$(field shellApp)"
BUILD="$(dirname "$ENGINE_APP")"
OUT="out/$(basename "$BUILD")"
[[ -f "$BUILD/credits.html" ]] ||
  die "no $BUILD/credits.html; run OUT=$OUT scripts/licenses.sh"

plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist"; }
bundle_id="$(plist CFBundleIdentifier)"
# An app packaged before keeps Chromium's version in MerlinChromiumVersion.
chromium_version="$(plist MerlinChromiumVersion 2>/dev/null || plist CFBundleShortVersionString)"
min_macos="$(plist LSMinimumSystemVersion)"

suffix=""
symbols_skipped=0
if [[ "${MERLIN_SKIP_SYMBOLS:-0}" == 1 ]]; then
  [[ "$DEV" == 1 ]] || die "a release keeps every binary's dSYM; MERLIN_SKIP_SYMBOLS=1 needs MERLIN_PACKAGE_DEV=1"
  symbols_skipped=1
  suffix="-dev-not-for-release"
fi
[[ "$stale" == "[]" ]] || suffix="-dev-not-for-release"
if grep -Eq '^[[:space:]]*is_component_build[[:space:]]*=[[:space:]]*true' "$BUILD/args.gn"; then
  [[ "$DEV" == 1 ]] || die "$OUT is a component build; a release needs build/args.release.gn"
  suffix="-dev-not-for-release"
fi
if [[ "$bundle_id" == local.* ]]; then
  [[ "$DEV" == 1 ]] || die "bundle ID $bundle_id is the placeholder; set MAC_BUNDLE_ID in overlay/chrome/app/theme/merlin/BRANDING and rebuild"
  suffix="-dev-not-for-release"
fi

# Security-release gate: the Chromium the engine was built against must be
# the current Mac Stable release, which carries the security fixes
# (scripts/check_upstream.py). MERLIN_ALLOW_STALE_CHROMIUM=1 packages anyway
# and says so in build-info.txt and at the top of the release notes.
echo "==> Chromium security check"
engine_pin="$(mktemp "${TMPDIR:-/tmp}/merlin-engine-pin.XXXXXX")"
git show "$engine_commit:UPSTREAM_PIN" > "$engine_pin" 2>/dev/null || cp UPSTREAM_PIN "$engine_pin"
upstream_status=0
upstream="$(python3 scripts/check_upstream.py --json --pin "$engine_pin")" || upstream_status=$?
rm -f "$engine_pin"
upstream_field() { python3 -c 'import json, sys
try: print(json.loads(sys.argv[1]).get(sys.argv[2]) or "")
except ValueError: print("no answer" if sys.argv[2] == "error" else "")' "$upstream" "$1"; }
upstream_state="$(upstream_field status)"
stale_chromium=""
if [[ "$upstream_status" != 0 ]]; then
  case "$upstream_state" in
    behind) stale_chromium="This build uses Chromium $(upstream_field pinned); Mac Stable is $(upstream_field stable), with security fixes it lacks" ;;
    error) stale_chromium="Chromium's current Stable release could not be checked ($(upstream_field error))" ;;
    *) stale_chromium="Chromium $(upstream_field pinned) is not confirmed as current Mac Stable ($upstream_state)" ;;
  esac
  if [[ "${MERLIN_ALLOW_STALE_CHROMIUM:-0}" != 1 && "$DEV" != 1 ]]; then
    die "$stale_chromium. Rebase first (docs/RELEASE.md, \"Security-only release\"), or set MERLIN_ALLOW_STALE_CHROMIUM=1 to package anyway; the release notes will say so"
  fi
  echo "warning: $stale_chromium; packaging anyway" >&2
else
  echo "Chromium $(upstream_field pinned) is current Mac Stable"
fi

name="Merlin-$VERSION-arm64$suffix"
dist="$ROOT/dist/$VERSION$suffix"
mkdir -p "$dist"
work="$(mktemp -d "${TMPDIR:-/tmp}/merlin-package.XXXXXX")"
trap 'rm -rf "$work"' EXIT
stage="$work/dmg"        # becomes the disk image
symbols="$work/dSYMs"    # becomes the dSYM archive, outside the disk image
mkdir "$stage"

echo "==> copying Merlin.app"
ditto "$APP" "$stage/Merlin.app"
xattr -cr "$stage/Merlin.app"

echo "==> English only"
# Merlin ships English (US and UK) only: about 47 MB of
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
# Finder's Version column and Get Info read CFBundleShortVersionString, so it
# says Merlin's version; Chromium's moves to MerlinChromiumVersion (decision
# 64). Chromium reads its framework's own Info.plist, which keeps its version,
# and CFBundleVersion stays Chromium's build number for LaunchServices.
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$stage/Merlin.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :MerlinChromiumVersion" "$stage/Merlin.app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :MerlinChromiumVersion string $chromium_version" "$stage/Merlin.app/Contents/Info.plist"

echo "==> signing with the hardened runtime, innermost first"
# Chromium's own entitlement files, from the checkout the engine was built in.
identity="${MERLIN_SIGN_IDENTITY:--}"
sign_args=(--identity "$identity")
[[ -z "${MERLIN_SIGN_KEYCHAIN:-}" ]] || sign_args+=(--keychain "$MERLIN_SIGN_KEYCHAIN")
if [[ "$identity" == - && -z "$suffix" ]]; then
  echo "warning: ad-hoc signature. Each build then looks like a new app to macOS: the keychain" >&2
  echo "         asks again about saved passwords and privacy grants reset. Set MERLIN_SIGN_IDENTITY" >&2
  echo "         (docs/RELEASE.md, \"Signing identity\")." >&2
fi
python3 scripts/sign_app.py "$stage/Merlin.app" "${sign_args[@]}" \
  --runtime --entitlements "$(dirname "$(dirname "$BUILD")")/chrome/app"
codesign --verify --deep --strict --verbose=1 "$stage/Merlin.app"
signature="$(codesign -dv "$stage/Merlin.app" 2>&1)"
grep -E '^(Identifier|Signature|Sealed Resources|CodeDirectory)' <<< "$signature"
[[ "$signature" == *flags=*runtime* ]] || die "the signed app has no hardened runtime"
requirement="$(codesign -d -r- "$stage/Merlin.app" 2>&1 | sed -n 's/^\(# \)\{0,1\}designated => //p')"
if [[ "$identity" != - && "$requirement" == cdhash* ]]; then
  die "signed with $identity, but the designated requirement is still a code hash: $requirement"
fi
echo "designated requirement: $requirement"

if [[ "$symbols_skipped" != 1 ]]; then
  echo "==> debug symbols: one dSYM per packaged binary, matched by UUID"
  dsym_args=(--search "$BUILD" --search "$(dirname "$SHELL_APP")")
  [[ -z "${MERLIN_SHELL_DSYM:-}" ]] || dsym_args+=(--dsym "$MERLIN_SHELL_DSYM")
  python3 scripts/match_dsyms.py "$stage/Merlin.app" "${dsym_args[@]}" \
    --copy-to "$symbols" --map "$symbols/UUIDs.txt"
fi

echo "==> build information"
framework="$stage/Merlin.app/Contents/Frameworks/Merlin Framework.framework/Merlin Framework"
packaging_commit="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]] || packaging_commit="$packaging_commit (with uncommitted changes)"
changes() { local c; c="$(field "$1.sourceChanges")"; [[ -z "$c" ]] || echo " + uncommitted changes $c"; }
{
  echo "Merlin $VERSION$suffix"
  echo "Packaged: $(date -u +%Y-%m-%dT%H:%M:%SZ) on macOS $(sw_vers -productVersion)"
  echo "Engine source commit: $engine_commit$(changes engine)"
  echo "Shell source commit: $shell_commit$(changes shell)"
  echo "Packaging commit: $packaging_commit (scripts and docs only)"
  echo "Chromium: $chromium_version"
  if [[ -n "$stale_chromium" ]]; then
    echo "Chromium security check: NOT CURRENT, packaged with MERLIN_ALLOW_STALE_CHROMIUM=1: $stale_chromium"
  else
    echo "Chromium security check: current Mac Stable on $(date -u +%Y-%m-%d)"
  fi
  # The pin the engine was built against, not the packaging checkout's.
  git show "$engine_commit:UPSTREAM_PIN" 2>/dev/null | sed 's/^/Pin /' ||
    echo "Pin: unknown (commit $engine_commit is not in this clone)"
  echo "Bundle ID: $bundle_id"
  echo "Minimum macOS: $min_macos"
  echo "Architecture: arm64"
  if [[ "$identity" == - ]]; then
    echo "Signature: ad-hoc, hardened runtime (no Developer ID, not notarized)"
  else
    echo "Signature: self-signed \"$identity\", hardened runtime (no Developer ID, not notarized)"
  fi
  echo "Designated requirement: $requirement"
  echo "UI: React Native macOS / Hermes (shell ABI 1)"
  echo "Lockfiles (SHA-256):"
  python3 -c 'import json, sys
for name, digest in json.load(open(sys.argv[1]))["lockfiles"].items(): print(f"  {name} {digest}")' "$manifest"
  echo
  if [[ "$symbols_skipped" == 1 ]]; then
    echo "Binary UUIDs (no dSYMs kept; MERLIN_SKIP_SYMBOLS=1):"
    dwarfdump --uuid "$stage/Merlin.app/Contents/MacOS/Merlin" "$framework" | sed "s|$stage/||"
  else
    echo "Binary UUIDs and their dSYMs:"
    sed 's/^/  /' "$symbols/UUIDs.txt"
  fi
  echo
  echo "Assembly manifest:"
  sed 's/^/  /' "$manifest"
  echo
  echo "GN args ($OUT/args.gn):"
  sed 's/^/  /' "$BUILD/args.gn"
} > "$dist/build-info.txt"

echo "==> disk image"
ln -s /Applications "$stage/Applications"
cp "$ROOT/LICENSE" "$stage/LICENSE.txt"
cp "$ROOT/NOTICE" "$stage/NOTICE.txt"
cp "$BUILD/credits.html" "$stage/Third-party notices.html"
# The engine's credits plus the React host's: npm packages, Pods (Hermes,
# SocketRocket, React), and NOTICE for the code adapted from Ardia.
python3 scripts/shell_notices.py --append-to "$stage/Third-party notices.html"
python3 scripts/shell_notices.py --check "$stage/Third-party notices.html"
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

# The install test's checklist, to fill in for this release (docs/RELEASE.md).
sed "s/{{VERSION}}/$VERSION$suffix/g" docs/install-qualification.md > "$dist/install-qualification.md"

# The release notes to upload: docs/RELEASE_NOTES.md, headed by a warning
# when the gate above was overridden.
notes="$dist/release-notes.md"
{
  if [[ -n "$stale_chromium" ]]; then
    echo "> **Security notice:** $stale_chromium."
    echo "> A release with the current Chromium follows; see SECURITY.md."
    echo
  fi
  cat docs/RELEASE_NOTES.md
} > "$notes"

if [[ "$symbols_skipped" != 1 ]]; then
  # No AppleDouble (._) files or extended attributes in the archive.
  ditto -c -k --norsrc --noextattr --keepParent "$symbols" "$dist/$name-dSYMs.zip"
fi

echo
echo "Done: $dist"
ls -lh "$dist"
cat "$dist/$name.dmg.sha256"
if [[ -n "$suffix" ]]; then
  echo
  echo "This is a development package. Do not publish it."
else
  release_kind="release"
  release_flags="--draft"
  if [[ "$VERSION" == *-* ]]; then
    release_kind="pre-release"
    release_flags="$release_flags --prerelease"
  fi
  cat <<EOF

Next:
  1. Upload to a draft $release_kind:
     gh release create v$VERSION $release_flags --title "Merlin $VERSION" \\
       --notes-file "$notes" "$dmg" "$dmg.sha256"
  2. Download it in a browser on another Mac and run the install test in
     docs/RELEASE.md before publishing the draft.
  3. For a stable release, publish as Latest, then update the Homebrew tap:
     gh workflow run update-merlin.yml --repo kylianmarceau/homebrew-tap
EOF
fi
