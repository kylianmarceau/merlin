#!/usr/bin/env bash
# Checks that patches/*.patch apply cleanly to the pinned Chromium tag,
# without a checkout: downloads only the files the patches touch from
# Chromium's GitHub mirror (or chromium.googlesource.com) and checks them with the same git apply command
# used by apply_overlay.sh (no fuzzy context matching).
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${TAG:-$(sed -n 's/^tag: *//p' UPSTREAM_PIN)}"
work="$(mktemp -d)"
scratch="$(mktemp -d)"
trap 'rm -rf "$work" "$scratch"' EXIT

# Each file comes from Google's read-only GitHub mirror of the repository,
# which serves it raw, or else from Gitiles itself, which serves base64 and
# throttles busy clients (CI) with slow 5xx answers. Each attempt downloads to a
# fresh file, so a retry after a broken transfer can't append to a
# half-written one. With VERIFY_PATCHES_CACHE set, files are kept there by
# tag or revision (both immutable), so later runs download nothing.
cache="${VERIFY_PATCHES_CACHE:-}"
fetch() { # gitiles-url github-url cache-key output
  if [[ -n "$cache" && -s "$cache/$3" ]]; then
    cp "$cache/$3" "$4"
    return
  fi
  local attempt raw="$scratch/download"
  for attempt in 1 2 3 4; do
    if curl -sSf --max-time 60 -o "$4" "$2" ||
       { curl -sSf --max-time 60 -o "$raw" "$1?format=TEXT" &&
         base64 --decode < "$raw" > "$4"; }; then
      if [[ -n "$cache" ]]; then
        mkdir -p "$(dirname "$cache/$3")"
        cp "$4" "$cache/$3"
      fi
      return
    fi
    sleep $((attempt * 3))
  done
  echo "Could not download $2 or $1" >&2
  return 1
}

files=$(python3 - <<'PY'
from pathlib import Path
existing, added = set(), set()
for patch in sorted(Path('patches').glob('*.patch')):
    old = None
    for line in patch.read_text().splitlines():
        if line.startswith('--- '):
            old = line[4:]
            if old.startswith('a/'):
                existing.add(old[2:])
        elif line.startswith('+++ b/') and old == '/dev/null':
            added.add(line[6:])
print('\n'.join(sorted(existing - added)))
PY
)
for f in $files; do
  mkdir -p "$work/$(dirname "$f")"
  if [[ "$f" == third_party/devtools-frontend/src/* ]]; then
    dependency="third_party/devtools-frontend/src"
    relative="${f#"$dependency/"}"
    if [[ -n "${CHROMIUM_SRC:-}" ]]; then
      revision="$(git -C "$CHROMIUM_SRC" rev-parse "$TAG:$dependency")"
      git -C "$CHROMIUM_SRC/$dependency" show "$revision:$relative" > "$work/$f"
    else
      if [[ -z "${devtools_revision:-}" ]]; then
        fetch "https://chromium.googlesource.com/chromium/src/+/refs/tags/$TAG/DEPS" \
          "https://raw.githubusercontent.com/chromium/chromium/$TAG/DEPS" "chromium/$TAG/DEPS" "$scratch/DEPS"
        devtools_revision="$(sed -n "s/.*'devtools_frontend_revision': '\([a-f0-9]*\)'.*/\1/p" "$scratch/DEPS")"
        [[ "$devtools_revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Missing pinned DevTools revision'; exit 1; }
      fi
      fetch "https://chromium.googlesource.com/devtools/devtools-frontend/+/$devtools_revision/$relative" \
        "https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/$devtools_revision/$relative" \
        "devtools/$devtools_revision/$relative" "$work/$f"
    fi
  elif [[ -n "${CHROMIUM_SRC:-}" ]]; then
    git -C "$CHROMIUM_SRC" show "$TAG:$f" > "$work/$f"
  else
    fetch "https://chromium.googlesource.com/chromium/src/+/refs/tags/$TAG/$f" \
      "https://raw.githubusercontent.com/chromium/chromium/$TAG/$f" "chromium/$TAG/$f" "$work/$f"
  fi
done

for p in patches/*.patch; do
  (cd "$work" && git apply --check "$OLDPWD/$p") ||
    { echo "FAIL: $p does not apply to $TAG"; exit 1; }
  (cd "$work" && git apply "$OLDPWD/$p")
  echo "ok   $p"
done
python3 scripts/apply_patches.py --src "$work" --check
echo "All patches apply to $TAG."
