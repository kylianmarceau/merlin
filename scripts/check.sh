#!/usr/bin/env bash
# Runs every check that works without a Chromium checkout. CI runs this same
# script (.github/workflows/check.yml), so local and CI results agree.
# Needs cargo, python3, node and pnpm; the patch check needs the network.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> cargo fmt --check"
cargo fmt --all -- --check

echo "==> cargo clippy (warnings are errors)"
cargo clippy --workspace --all-targets -- -D warnings

echo "==> cargo test (Rust core, bridge, C++ host harness)"
cargo test --workspace

echo "==> React shell: install, typecheck and unit tests"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required (corepack enable, or see package.json's packageManager)" >&2
  exit 1
fi
pnpm install --frozen-lockfile
pnpm ui:check
pnpm ui:test

echo "==> upstream checker and browser test runner regressions"
python3 -m unittest discover -s scripts -p 'test_browser_tools.py'

echo "==> assembly, build stamps and dSYM matching (fixtures only)"
python3 -m unittest discover -s scripts -p 'test_react_assembly.py'

echo "==> shipped credits name the React host's components and Ardia"
python3 -m unittest discover -s scripts -p 'test_shell_notices.py'

echo "==> shell vocabulary: generated copies and native code follow the table"
python3 scripts/sync_shell_headers.py --check
python3 -m unittest discover -s scripts -p 'test_shell_vocabulary.py'

echo "==> shell scripts parse"
for script in scripts/*.sh; do bash -n "$script"; done

echo "==> page scripts parse"
scripts/check_page_scripts.py
node --check scripts/benchmark_adblock.mjs
node --check scripts/benchmark_adblock_realistic.mjs
node --check scripts/benchmark_browsers.mjs
node --check scripts/summarize_benchmarks.mjs
node --check scripts/lib/cdp.mjs
node --check scripts/lib/adblock_memory.mjs
node --check scripts/probe_adblock_youtube.mjs
node --check scripts/audit_devtools_strings.cjs

echo "==> visual identity boundaries and generated tokens"
python3 scripts/check_visual_identity.py

echo "==> bundled ad blocker integrity and provenance"
python3 scripts/prepare_adblock_resources.py

echo "==> patches apply to pinned upstream files (needs network)"
scripts/verify_patches.sh

echo "All checks passed."
