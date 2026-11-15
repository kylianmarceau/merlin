#!/usr/bin/env bash
# End-to-end tests against a real, assembled Merlin.app (tests/e2e).
#
#   scripts/run_e2e_tests.sh                     # every test
#   scripts/run_e2e_tests.sh test_keys           # one module
#   scripts/run_e2e_tests.sh test_keys.KeysTest.test_counts_and_sequences
#   MERLIN_APP=~/Downloads/Merlin.app scripts/run_e2e_tests.sh
#
# The app defaults to apps/browser/build/assembled/Merlin.app, then
# /Applications/Merlin.app. Each test class starts its own instance with a
# throwaway profile, config, workspace folder, browserctl socket and DevTools
# port, as a background app that never takes the keyboard. Your own Merlin,
# settings, sign-ins and clipboard are left alone. Needs Xcode's command line
# tools (to build tests/e2e/background_app.m) and the system Python 3.
set -euo pipefail
cd "$(dirname "$0")/../tests/e2e"
if [[ $# -eq 0 ]]; then
  exec python3 -m unittest discover -s . -p 'test_*.py' -v
fi
exec python3 -m unittest -v "$@"
