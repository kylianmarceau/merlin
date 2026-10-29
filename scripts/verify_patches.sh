#!/usr/bin/env bash
# Checks that patches/*.patch apply cleanly to the pinned Chromium tag,
# without a checkout: downloads only the files the patches touch from
# chromium.googlesource.com and dry-runs `patch` against them.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${TAG:-$(sed -n 's/^tag: *//p' UPSTREAM_PIN)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

files=$(sed -n 's|^+++ b/||p' patches/*.patch | sort -u)
for f in $files; do
  mkdir -p "$work/$(dirname "$f")"
  curl -sf --max-time 60 \
    "https://chromium.googlesource.com/chromium/src/+/refs/tags/$TAG/$f?format=TEXT" |
    base64 --decode > "$work/$f"
done

for p in patches/*.patch; do
  (cd "$work" && patch -p1 --dry-run --silent < "$OLDPWD/$p" > /dev/null) ||
    { echo "FAIL: $p does not apply to $TAG"; exit 1; }
  (cd "$work" && patch -p1 --silent < "$OLDPWD/$p")
  echo "ok   $p"
done
echo "All patches apply to $TAG."
