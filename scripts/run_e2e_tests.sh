#!/usr/bin/env bash
# End-to-end tests against a real, assembled Merlin.app (tests/e2e).
#
#   scripts/run_e2e_tests.sh                     # every test
#   scripts/run_e2e_tests.sh test_keys           # one module
#   scripts/run_e2e_tests.sh test_keys.KeysTest.test_counts_and_sequences
#   MERLIN_APP=~/Downloads/Merlin.app scripts/run_e2e_tests.sh --allow-other-build
#
# The app defaults to apps/browser/build/assembled/Merlin.app, then
# /Applications/Merlin.app. The log starts with the app's Mach-O UUIDs and the
# commit it was assembled from. An app assembled from another commit, or with
# other uncommitted product changes, than this checkout is refused unless
# --allow-other-build is given (anywhere among the arguments).
#
# Each test class starts its own instance with a throwaway profile, config,
# workspace folder, browserctl socket and DevTools port, as a background app
# that never takes the keyboard. Your own Merlin, settings, sign-ins and
# clipboard are left alone. Needs Xcode's command line tools (to build
# tests/e2e/background_app.m) and the system Python 3.
set -euo pipefail
# A relative MERLIN_APP means one relative to where the script was run.
if [[ -n "${MERLIN_APP:-}" && "$MERLIN_APP" != /* ]]; then
  MERLIN_APP="$PWD/$MERLIN_APP"
  export MERLIN_APP
fi
cd "$(dirname "$0")/../tests/e2e"
tests=()
check=(--check-build)
for argument in "$@"; do
  if [[ "$argument" == --allow-other-build ]]; then
    check+=(--allow-other-build)
    export MERLIN_E2E_ALLOW_OTHER_BUILD=1
  else
    tests+=("$argument")
  fi
done
report="$(python3 merlin_e2e.py "${check[@]}")"
# The last line is the app's path; the harness then skips printing it again.
echo "${report%$'\n'*}"
MERLIN_E2E_BUILD_CHECKED="${report##*$'\n'}"
export MERLIN_E2E_BUILD_CHECKED
if [[ ${#tests[@]} -eq 0 ]]; then
  exec python3 -m unittest discover -s . -p 'test_*.py' -v
fi
exec python3 -m unittest -v "${tests[@]}"
