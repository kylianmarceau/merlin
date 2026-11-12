#!/usr/bin/env bash
# Installs this project into a Chromium checkout at the pinned tag:
#   1. symlinks overlay/ directories into src/ (our own code, no upstream edits)
#   2. applies patches/*.patch (the only upstream edits) with git apply
#   3. writes out/Modal/args.gn
#
# Idempotent. Used on 2026-10-25 against 156.0.8078.48.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROMIUM_DIR="${CHROMIUM_DIR:-$HOME/chromium}"
SRC="$CHROMIUM_DIR/src"
TAG="$(sed -n 's/^tag: *//p' UPSTREAM_PIN)"

[[ -d "$SRC/.git" ]] || { echo "No checkout at $SRC; run scripts/bootstrap_chromium.sh --fetch" >&2; exit 1; }
head_tag="$(git -C "$SRC" describe --tags --exact-match 2>/dev/null || true)"
[[ "$head_tag" == "$TAG" ]] || echo "warning: $SRC is at '${head_tag:-unknown}', patches target $TAG" >&2

# Merlin's own folders, plus the logo folders grit reads when
# branding_path_component = "merlin" (args.modal.gn).
for dir in components/modal_browser components/merlin_adblock chrome/browser/ui/modal_browser \
    chrome/browser/merlin_adblock chrome/renderer/merlin_adblock chrome/app/theme/merlin \
    chrome/app/theme/default_100_percent/merlin chrome/app/theme/default_200_percent/merlin \
    components/resources/default_100_percent/merlin components/resources/default_200_percent/merlin \
    components/vector_icons/merlin; do
  target="$SRC/$dir"
  if [[ -L "$target" ]]; then
    ln -sfn "$ROOT/overlay/$dir" "$target"
  elif [[ -e "$target" ]]; then
    echo "$target exists and is not our symlink; refusing to replace it" >&2
    exit 1
  else
    ln -s "$ROOT/overlay/$dir" "$target"
  fi
  echo "linked  $dir"
done

python3 "$ROOT/scripts/apply_patches.py" --src "$SRC"

mkdir -p "$SRC/out/Modal"
if [[ ! -f "$SRC/out/Modal/args.gn" ]]; then
  cp "$ROOT/build/args.modal.gn" "$SRC/out/Modal/args.gn"
  echo "wrote   out/Modal/args.gn"
else
  grep -q '^branding_file_path' "$SRC/out/Modal/args.gn" ||
    echo 'warning: add  branding_file_path = "//chrome/app/theme/merlin/BRANDING"  to out/Modal/args.gn' >&2
  grep -q '^branding_path_component' "$SRC/out/Modal/args.gn" ||
    echo 'warning: add  branding_path_component = "merlin"  to out/Modal/args.gn' >&2
fi

cat <<EOF
Next:
  cd $ROOT
  "$SRC/third_party/cpython3/host/bin/python3" scripts/prepare_adblock_deps.py --src "$SRC"
  python3 scripts/prepare_adblock_resources.py
  cd $SRC
  gn gen out/Modal && gn check out/Modal '//chrome/browser/ui/modal_browser/*'
  autoninja -C out/Modal chrome browser_tests
  (cd $ROOT && scripts/run_browser_tests.sh)   # ad-block browser tests
  out/Modal/Merlin.app/Contents/MacOS/Merlin --user-data-dir=/tmp/modal-profile
EOF
