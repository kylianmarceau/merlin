#!/usr/bin/env bash
# Sets up a Chromium checkout at the pinned tag for this project.
#
#   scripts/bootstrap_chromium.sh            # preflight checks only (default)
#   scripts/bootstrap_chromium.sh --fetch    # also download (~30+ GB, hours)
#
# CHROMIUM_DIR (default: ~/chromium) must be a path without spaces on an APFS
# volume. Follows //docs/mac_build_instructions.md at the pinned tag.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

TAG="$(sed -n 's/^tag: *//p' UPSTREAM_PIN)"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
DEPOT_TOOLS="${DEPOT_TOOLS:-$HOME/depot_tools}"
FETCH=0
[[ "${1:-}" == "--fetch" ]] && FETCH=1

fail=0
check() { # check <ok?> <message> [fix]
  if [[ "$1" == 1 ]]; then echo "  ok    $2"; else echo "  MISS  $2${3:+  -> $3}"; fail=1; fi
}

echo "Preflight for Chromium $TAG"
[[ "$(uname -s)" == Darwin ]] && ok=1 || ok=0
check $ok "macOS host"
check 1 "architecture: $(uname -m)"

dev_dir="$(xcode-select -p 2>/dev/null || true)"
[[ "$dev_dir" == *Xcode*.app/Contents/Developer ]] && ok=1 || ok=0
check $ok "full Xcode selected (have: ${dev_dir:-none})" \
  "install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"

avail_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
[[ "$avail_gb" -ge 100 ]] && ok=1 || ok=0
check $ok "free disk: ${avail_gb} GB (want >= 100 GB for source + one build)"

mem_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
[[ "$mem_gb" -ge 16 ]] && ok=1 || ok=0
check $ok "memory: ${mem_gb} GB (16 GB works; expect slow links)"

[[ "$CHROMIUM_DIR" != *" "* ]] && ok=1 || ok=0
check $ok "checkout path has no spaces: $CHROMIUM_DIR"

[[ -x "$DEPOT_TOOLS/fetch" ]] && ok=1 || ok=0
check $ok "depot_tools at $DEPOT_TOOLS" \
  "git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git $DEPOT_TOOLS"

[[ -d "$CHROMIUM_DIR/src/.git" ]] && have_src=1 || have_src=0
check $have_src "checkout at $CHROMIUM_DIR/src" "rerun with --fetch"

if [[ $FETCH == 0 ]]; then
  [[ $fail == 0 ]] && echo "Preflight passed." || echo "Preflight found missing items (see above)."
  exit $fail
fi

if [[ "$dev_dir" != *Xcode*.app/Contents/Developer ]]; then
  echo "Refusing to fetch: full Xcode is required to build. Fix that first." >&2
  exit 1
fi
export PATH="$PATH:$DEPOT_TOOLS"

if [[ $have_src == 0 ]]; then
  mkdir -p "$CHROMIUM_DIR"
  cd "$CHROMIUM_DIR"
  echo "==> fetch --no-history chromium (long)"
  caffeinate fetch --nohooks --no-history chromium
fi

cd "$CHROMIUM_DIR/src"
echo "==> checking out tag $TAG"
git fetch --depth=1 origin "refs/tags/$TAG:refs/tags/$TAG"
git checkout --detach "tags/$TAG"
echo "==> gclient sync (long)"
caffeinate gclient sync -D --with_tags --nohooks
gclient runhooks

echo "Checkout ready at $CHROMIUM_DIR/src ($TAG)."
echo "Next: CHROMIUM_DIR=$CHROMIUM_DIR $ROOT/scripts/apply_overlay.sh"
