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
    --gn-out-dir "$OUT" "$dest")
echo "Chromium credits: $dest"
python3 scripts/adblock_notices.py --append-to "$dest"
echo "Native blocker source provenance and notices added."

# Print the audited Rust graph as a second check. The native blocker's crates
# are vendored by gnrt and included in Chromium's generated credits above.
cargo tree --workspace --edges normal --prefix none --format '{p} {l}' | sort -u
