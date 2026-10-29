#!/usr/bin/env bash
# Generates the third-party credits for the built browser with Chromium's
# own tool, plus our Rust crates, into out/<dir>/credits.html.
#
#   scripts/licenses.sh            # uses out/Modal
#   OUT=out/Release scripts/licenses.sh
#
# This lists licenses; it is not the independent license review the
# product plan requires before a public release.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
OUT="${OUT:-out/Modal}"
dest="$CHROMIUM_DIR/src/$OUT/credits.html"

(cd "$CHROMIUM_DIR/src" &&
  python3 tools/licenses/licenses.py credits --gn-target //chrome:chrome \
    --gn-out-dir "$OUT" > "$dest")
echo "Chromium credits: $dest"

# Our own crates: the core and bridge have no third-party Rust dependencies
# except cxx (vendored by Chromium, so already in the credits above);
# browserctl and the dev tools use only the core.
cargo tree --workspace --edges normal --prefix none --format '{p} {l}' | sort -u
