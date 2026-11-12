#!/usr/bin/env bash
# Runs browser_tests without disturbing whoever is using the Mac:
#   --headless                  Chromium uses a headless screen; windows are
#                               created but never shown.
#   --screen-info={1680x1050}   that screen is laptop-sized (the default,
#                               800x600, is too small for upstream tests that
#                               check window geometry, e.g. DevTools sizes).
#
#   scripts/run_browser_tests.sh                      # our suite
#   scripts/run_browser_tests.sh 'BrowserViewTest.*'  # any filter
#
# Filters other than our own suite also get --modal-browser-upstream-defaults
# and --disable-features=MerlinAdblock: upstream tests assume Chromium's
# defaults (tabs on top, no ad blocker; some load ad-like test pages) and must
# not read your config.toml.
# Run FindInPageControllerTest separately: it needs a 1280x900 window for
# FindMovesWhenObscuring. The BrowserView DevTools size tests must retain
# default/restored window sizes, so they must not receive that size override.
#
# Extra arguments after the filter go to browser_tests.
set -euo pipefail
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
filter="${1:-MerlinAdblock*BrowserTest.*}"
shift || true
extra=()
IFS=: read -r -a suites <<< "$filter"
for suite in "${suites[@]}"; do
  if [[ "$suite" != MerlinAdblock* ]]; then
    extra+=(--modal-browser-upstream-defaults --disable-features=MerlinAdblock)
    break
  fi
done
if [[ "$filter" == FindInPageControllerTest.* ]]; then
  extra+=(--window-size=1280,900)
fi
cd "$CHROMIUM_DIR/src"
exec out/Modal/browser_tests --headless '--screen-info={1680x1050}' ${extra[@]+"${extra[@]}"} \
  --gtest_filter="$filter" --test-launcher-jobs=1 --test-launcher-retry-limit=0 "$@"
