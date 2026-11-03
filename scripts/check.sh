#!/usr/bin/env bash
# Runs every check that works without a Chromium checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> cargo fmt --check"
cargo fmt --all -- --check

echo "==> cargo clippy (warnings are errors)"
cargo clippy --workspace --all-targets -- -D warnings

echo "==> cargo test (Rust core, bridge, C++ host harness)"
cargo test --workspace

echo "==> page scripts parse (needs node; skipped without it)"
scripts/check_page_scripts.py
if command -v node >/dev/null 2>&1; then
  node --check scripts/benchmark_adblock.mjs
  node --check scripts/lib/cdp.mjs
  node --check scripts/lib/adblock_memory.mjs
  node --check scripts/probe_adblock_youtube.mjs
  node --check scripts/audit_devtools_strings.cjs
fi

echo "==> visual identity boundaries and generated tokens"
python3 scripts/check_visual_identity.py

echo "==> bundled ad blocker integrity and provenance"
python3 scripts/prepare_adblock_resources.py

echo "==> patches apply to pinned upstream files (needs network)"
scripts/verify_patches.sh

echo "All checks passed."
