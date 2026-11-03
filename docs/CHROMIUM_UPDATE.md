# Updating Chromium after the 2026-10-31 fixes

The checkout and `UPSTREAM_PIN` now target **157.0.8103.26**, Chromium commit
`4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`, selected by the October 31 Mac
Stable check. Build and regression results are recorded in `TESTING.md`.
The blocks below document the update procedure; do not repeat the stash and
sync steps on an already updated checkout. For the next update, check Stable
again and substitute the new tag consistently. This is an upstream update,
not `git rebase` of this overlay repository onto Chromium.

The patch series has now been refreshed for 157.0.8103.26 and all 12 patches
apply sequentially with `git apply --check` and `git apply`. Patch 0002 now
adds its dependency to `//chrome/browser/ui/views/frame:browser_view`; 0003
has updated test-target context, and 0007 was regenerated from 157's strings.
The overlay also follows 157's split GN targets, `BrowserWindowInterface`
test API, reading-mode command rename and typed `TemplateURLID`. Patch
application alone does not establish that a build or browser tests pass.

Run each block in order and stop if any command fails. Stop any existing
build first, close the development browser, and save your work. A same-series
update can reuse build outputs, but sync plus compiling/linking Chrome and
browser_tests may still take hours on a 16 GB machine. Keep the Mac plugged
in. Do not launch two builds against the same output directory.

## 1. Check the target and preserve your work

```bash
export PATH="$HOME/depot_tools:$HOME/.cargo/bin:$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
cd /Users/kyliandabancourt/Documents/merlin &&
scripts/check_upstream.py
```

Exit status 1 from this checker means an update is due, not that downloading
failed. Review and commit the overlay fixes (or otherwise back them up) before
changing the pin. Do not include local build logs accidentally.

First test the existing patch set against the new tag without modifying the
Chromium checkout:

```bash
cd /Users/kyliandabancourt/Documents/merlin &&
TAG=157.0.8103.26 scripts/verify_patches.sh
```

If this fails, stop: the affected patches need refreshing against that tag.
Do not proceed with only some patches applied.

## 2. Save the old Chromium modifications, then sync

```bash
cd "$HOME/chromium/src"
git status --short
git diff --stat
```

Expect the tracked modifications installed by Merlin's patches, and untracked
Merlin overlay symlinks. Inspect anything else before proceeding. Preserve
tracked modifications with a named stash; do not use `git reset --hard` or
`git clean`. This command deliberately does not include untracked symlinks.

```bash
cd "$HOME/chromium/src" &&
git stash push -m "before Merlin Chromium update 2026-10-31" &&
git fetch --depth=1 origin refs/tags/157.0.8103.26:refs/tags/157.0.8103.26 &&
git checkout --detach refs/tags/157.0.8103.26 &&
caffeinate gclient sync -D
```

**Do not pop the old stash onto the new source.** It contains the old applied
patches; the overlay script will apply the current patch files below. Keep
that stash for recovery. If it includes other personal changes, reapply
those separately after reviewing them. If checkout or sync reports a local
file conflict, stop and inspect it rather than deleting the file.

## 3. Update the pin and reapply Merlin

Only after sync succeeds:

```bash
(
set -e
cd /Users/kyliandabancourt/Documents/merlin
python3 - <<'PY'
from datetime import date
from pathlib import Path
import subprocess
src = Path.home() / 'chromium/src'
tag = '157.0.8103.26'
commit = subprocess.check_output(
    ['git', '-C', str(src), 'rev-parse', 'HEAD'], text=True).strip()
expected = subprocess.check_output(
    ['git', '-C', str(src), 'rev-parse', 'refs/tags/' + tag + '^{commit}'],
    text=True).strip()
assert commit == expected, 'Chromium checkout is not at the requested tag'
Path('UPSTREAM_PIN').write_text(
    f'tag: {tag}\ncommit: {commit}\nchannel: Stable (Mac), checked {date.today()}\n')
PY
scripts/apply_overlay.sh
scripts/check.sh
)
```

If the target tag changes, change it consistently in all blocks. On a new
Chromium revision, also check the vendored `cxx` version against the Cargo
pin if Rust/FFI compilation fails; do not blindly update only Cargo.lock.

## 4. Build and test

```bash
cd "$HOME/chromium/src" &&
gn gen out/Modal &&
gn check out/Modal '//chrome/browser/ui/modal_browser/*' &&
caffeinate autoninja -C out/Modal -j 4 chrome browser_tests
```

If compilation fails, save the first actual compiler error. API changes may
require overlay changes; repeated builds alone will not fix them.
Four jobs avoid heavy paging while compiling browser tests on this 16 GB
machine. Higher concurrency can be slower when the large test sources exhaust
available memory.

```bash
cd /Users/kyliandabancourt/Documents/merlin &&
scripts/run_browser_tests.sh &&
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*' &&
scripts/run_browser_tests.sh 'FindInPageControllerTest.*'
```

The Merlin suite includes `RefusedEditStopsPreviousSession`,
`PageColourBucketsAndContrast` and `PageColourNavigationAndCache`. The
`browser_tests` binary must come from the completed build above.
The Find suite runs separately with a 1280x900 headless window so the find bar
can move beside a match. BrowserView's DevTools size tests retain their normal
default/restored bounds. The runner chooses these settings from the filter.

Finally launch with a disposable profile before using your everyday profile:

```bash
merlin_check_dir="$(mktemp -d /tmp/merlin-update-check.XXXXXX)" &&
XDG_CONFIG_HOME="$merlin_check_dir/config" \
XDG_DATA_HOME="$merlin_check_dir/data" \
MODAL_BROWSER_SOCKET="$merlin_check_dir/control.sock" \
"$HOME/chromium/src/out/Modal/Merlin.app/Contents/MacOS/Merlin" \
  --user-data-dir="$merlin_check_dir/profile"
```

These paths isolate Merlin's config, workspaces and control socket as well as
the Chromium profile.

Check solid light/dark/mid-grey pages, a page without a dominant background,
navigation, switching back to a scrolled tab, both tab layouts and hidden
tabs. The colour policy is a load-time viewport colour cached per document;
scrolling/tab switching should not choose a new colour. For a site theme
changed after loading, reload to refresh the cached colour.

If this repository moves or is renamed, rerun `scripts/apply_overlay.sh`
from its new location before building. Chromium's overlay entries are absolute
symlinks. Cargo's host harness may also need `cargo clean -p host_harness`
after a move, because its cached build script embeds the old source path.

Check external editing, a refused second edit, navigation during editing,
and preservation of the old file after cancellation. Test permissions,
private windows, recovery and extensions as listed in `BETA_REVIEW.md`.
Record the new pin/build and results in `TESTING.md` and `UPSTREAM.md`, and
commit the pin plus any patch/API refreshes. This development build still
needs the separate GitHub packaging and unnotarized installation checks in
[Release](RELEASE.md) before beta distribution; Developer ID signing and
notarization are intentionally out of scope.
