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
# that never takes the keyboard. An app with the hardened runtime (a packaged
# release) is tested as a temporary copy re-signed without it, since the
# runtime ignores the DYLD_INSERT_LIBRARIES shim that keeps it in the
# background; the log says so. A quarantined app (a download) is tested as a
# copy without the attribute: macOS would start it translocated, without the
# test's arguments, on your own profile. Your own Merlin, settings, sign-ins
# and clipboard are left alone. Needs Xcode's command line tools (to build
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
# A packaged app has the hardened runtime, which ignores DYLD_INSERT_LIBRARIES,
# so the harness's background-app shim would not load. Test a copy signed the
# same way without the runtime instead; the binaries are the same.
#
# A downloaded app is quarantined, and macOS starts a quarantined app from a
# translocated copy without the --args and --env the harness passes, so it
# would open your own profile. Test a copy without the attribute instead.
#
# Every run tests a copy (an APFS clone, so it takes no room) under its own
# bundle ID, io.github.kylianmarceau.merlin.e2e: the interface keeps its
# settings and spaces in the app's preferences domain, and the tests must
# never write into your Merlin's (the harness refuses to launch it there).
hardened=0; quarantined=0
[[ "$(codesign -dv "$MERLIN_E2E_BUILD_CHECKED" 2>&1)" == *flags=*runtime* ]] && hardened=1
# grep without -q: with pipefail, -q's early exit would fail the pipeline.
[[ "$(xattr -r -l "$MERLIN_E2E_BUILD_CHECKED" 2>/dev/null)" == *com.apple.quarantine* ]] && quarantined=1
copy_dir="$(mktemp -d "${TMPDIR:-/tmp}/merlin-e2e-app.XXXXXX")"
copy_dir="$(cd "$copy_dir" && pwd -P)"  # the harness compares resolved paths
# End any instance still running from the copy before deleting it: an app
# whose files vanish while it runs can hang in the kernel as it exits.
# (set -e applies in the trap too, so nothing in it may fail.)
trap 'pkill -9 -f -- "$copy_dir/Merlin.app/" 2>/dev/null || true
      for _ in $(seq 1 50); do pgrep -f -- "$copy_dir/Merlin.app/" >/dev/null || break; sleep 0.2; done
      rm -rf "$copy_dir"' EXIT
cp -cR "$MERLIN_E2E_BUILD_CHECKED" "$copy_dir/" 2>/dev/null ||
  ditto "$MERLIN_E2E_BUILD_CHECKED" "$copy_dir/Merlin.app"
xattr -dr com.apple.quarantine "$copy_dir/Merlin.app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.kylianmarceau.merlin.e2e" "$copy_dir/Merlin.app/Contents/Info.plist"
# The new bundle ID needs a new signature (ad hoc, without the hardened runtime).
python3 ../../scripts/sign_app.py "$copy_dir/Merlin.app" >/dev/null
echo "copy:      testing $copy_dir/Merlin.app as io.github.kylianmarceau.merlin.e2e"
if (( hardened )); then
  echo "hardened:  the app has the hardened runtime; the copy is signed without it"
fi
if (( quarantined )); then
  echo "quarantined: testing a copy without com.apple.quarantine, $copy_dir/Merlin.app"
fi
MERLIN_APP="$copy_dir/Merlin.app"
MERLIN_E2E_BUILD_CHECKED="$MERLIN_APP"
export MERLIN_APP
export MERLIN_E2E_BUILD_CHECKED
# No exec: the trap removes a re-signed copy afterwards.
if [[ ${#tests[@]} -eq 0 ]]; then
  python3 -m unittest discover -s . -p 'test_*.py' -v
else
  python3 -m unittest -v "${tests[@]}"
fi
