#!/usr/bin/env bash
# Builds the distribution app in out/Release from build/args.release.gn,
# then writes its third-party credits.
#
#   scripts/build_release.sh
#
# Run scripts/apply_overlay.sh first. The first build takes several hours
# and a lot of disk; it refuses to start with less than 50 GB free
# (MERLIN_MIN_FREE_GB to change). If linking runs out of memory on a 16 GB
# Mac, rerun it: ninja resumes where it stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
SRC="$CHROMIUM_DIR/src"
OUT="out/Release"
TAG="$(sed -n 's/^tag: *//p' UPSTREAM_PIN)"
MIN_FREE_GB="${MERLIN_MIN_FREE_GB:-50}"

die() { echo "build_release: $*" >&2; exit 1; }

[[ -d "$SRC/.git" ]] || die "no Chromium checkout at $SRC"
command -v gn >/dev/null && command -v autoninja >/dev/null ||
  die "gn and autoninja not found; add depot_tools to PATH"

head_tag="$(git -C "$SRC" describe --tags --exact-match 2>/dev/null || true)"
[[ "$head_tag" == "$TAG" ]] ||
  die "checkout is at '${head_tag:-unknown}', UPSTREAM_PIN says $TAG"
[[ -L "$SRC/components/modal_browser" ]] ||
  die "overlay not linked; run scripts/apply_overlay.sh"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "warning: this repository has uncommitted changes; the build will" >&2
  echo "         include them, but build-info will name the last commit." >&2
fi

# Official builds need the PGO profile named in chrome/build/mac-arm.pgo.txt.
pgo="$SRC/chrome/build/pgo_profiles/$(cat "$SRC/chrome/build/mac-arm.pgo.txt")"
[[ -s "$pgo" ]] || die "no PGO profile at $pgo; set \"checkout_pgo_profiles\": True in
  custom_vars in $CHROMIUM_DIR/.gclient, then run gclient runhooks (see docs/PERFORMANCE.md)"
# With PGO on, V8 also optimizes its builtins from its own profile, which the
# same gclient hook downloads (v8/tools/builtins-pgo/download_profiles.py).
[[ -s "$SRC/v8/tools/builtins-pgo/profiles/x64.profile" ]] ||
  die "no V8 builtins profile in $SRC/v8/tools/builtins-pgo/profiles; run gclient runhooks,
  or: (cd $SRC && python3 v8/tools/builtins-pgo/download_profiles.py download --depot-tools \"\$(dirname \"\$(command -v gclient)\")\" --check-v8-revision)"

free_gb="$(df -Pk "$SRC" | awk 'NR == 2 { print int($4 / 1048576) }')"
(( free_gb >= MIN_FREE_GB )) ||
  die "only ${free_gb} GB free on the Chromium disk; free at least ${MIN_FREE_GB} GB"

mkdir -p "$SRC/$OUT"
cp "$ROOT/build/args.release.gn" "$SRC/$OUT/args.gn"
echo "wrote   $OUT/args.gn"

cd "$SRC"
gn gen "$OUT"
autoninja -C "$OUT" chrome

cd "$ROOT"
OUT="$OUT" scripts/licenses.sh
echo
echo "Built $SRC/$OUT/Merlin.app"
echo "Next: MERLIN_VERSION=<version> scripts/package_mac.sh"
