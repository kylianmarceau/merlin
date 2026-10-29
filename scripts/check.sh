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

echo "==> patches apply to pinned upstream files (needs network)"
scripts/verify_patches.sh

echo "All checks passed."
