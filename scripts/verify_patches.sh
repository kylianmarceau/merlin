#!/usr/bin/env bash
# Checks that patches/*.patch apply cleanly to the pinned Chromium tag,
# without a checkout: downloads only the files the patches touch from
# chromium.googlesource.com and checks them with the same git apply command
# used by apply_overlay.sh (no fuzzy context matching).
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${TAG:-$(sed -n 's/^tag: *//p' UPSTREAM_PIN)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Gitiles serves base64 text. Retry: CI fetches hundreds of files, and one
# dropped connection must not read as a patch that no longer applies.
fetch() {
  curl -sSf --max-time 60 --retry 4 --retry-all-errors --retry-delay 2 "$1?format=TEXT" |
    base64 --decode || { echo "Could not download $1" >&2; return 1; }
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
        devtools_revision="$(fetch \
          "https://chromium.googlesource.com/chromium/src/+/refs/tags/$TAG/DEPS" | sed -n "s/.*'devtools_frontend_revision': '\([a-f0-9]*\)'.*/\1/p")"
        [[ "$devtools_revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Missing pinned DevTools revision'; exit 1; }
      fi
      fetch "https://chromium.googlesource.com/devtools/devtools-frontend/+/$devtools_revision/$relative" \
        > "$work/$f"
    fi
  elif [[ -n "${CHROMIUM_SRC:-}" ]]; then
    git -C "$CHROMIUM_SRC" show "$TAG:$f" > "$work/$f"
  else
    fetch "https://chromium.googlesource.com/chromium/src/+/refs/tags/$TAG/$f" > "$work/$f"
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
