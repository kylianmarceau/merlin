#!/usr/bin/env bash
# Replay first launch in its own profile, settings and workspace.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$root/apps/browser/build/assembled-painted-coast/Merlin.app}"
if [[ ! -x "$app/Contents/MacOS/Merlin" ]]; then
  echo "Pass the path to an assembled Merlin.app as the first argument." >&2
  exit 1
fi
preview="$(mktemp -d "${TMPDIR:-/tmp}/merlin-onboarding-preview.XXXXXX")"
mkdir "$preview/config" "$preview/data"
open -n -a "$app" --env "XDG_CONFIG_HOME=$preview/config" --env "XDG_DATA_HOME=$preview/data" \
  --args "--user-data-dir=$preview/profile" --use-mock-keychain --no-default-browser-check --window-size=1150,760 about:blank
