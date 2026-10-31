# Updating Chromium after the 2026-10-31 fixes

The fixes are in the overlay; Chromium has **not** been updated or rebuilt.
The current pin is 156.0.8078.48. On October 31 `scripts/check_upstream.py`
reported Mac Stable **157.0.8103.26**, Chromium commit
`4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`. Check again before starting; use
the newer tag if Stable has advanced. This is an upstream update, not `git
rebase` of this small overlay repository onto Chromium. Because this crosses
from milestone 156 to 157, expect possible patch or Chromium API changes.

The patch series has now been refreshed for 157.0.8103.26 and all 12 patches
apply sequentially with `git apply --check` and `git apply`. Patch 0002 now
adds its dependency to `//chrome/browser/ui/views/frame:browser_view`; 0003
has updated test-target context, and 0007 was regenerated from 157's strings.
This checks patch application only; GN generation and compilation still need
the checkout update below. `UPSTREAM_PIN` deliberately stays at the installed
156 revision until step 3, so use the explicit TAG override in step 1.

Run each block in order and stop if any command fails. Stop any existing
build first, close the development browser, and save your work. A same-series
update can reuse build outputs, but sync plus compiling/linking Chrome and
browser_tests may still take hours on a 16 GB machine. Keep the Mac plugged
in. Do not launch two builds against the same output directory.

## 1. Check the target and preserve your work

```bash
export PATH="$HOME/depot_tools:$HOME/.cargo/bin:$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
cd /Users/kyliandabancourt/Documents/vela
scripts/check_upstream.py
```

Exit status 1 from this checker means an update is due, not that downloading
failed. Review and commit the overlay fixes (or otherwise back them up) before
changing the pin. Do not include local build logs accidentally.

First test the existing patch set against the new tag without modifying the
Chromium checkout:

```bash
cd /Users/kyliandabancourt/Documents/vela
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
git stash push -m "before Merlin Chromium update 2026-10-31"
git fetch --depth=1 origin refs/tags/157.0.8103.26:refs/tags/157.0.8103.26
git checkout --detach refs/tags/157.0.8103.26
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
cd /Users/kyliandabancourt/Documents/vela
python3 - <<'PY'
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
    f'tag: {tag}\ncommit: {commit}\nchannel: Stable (Mac), checked 2026-10-31\n')
PY
scripts/apply_overlay.sh
scripts/check.sh
```

If the target tag changes, change it consistently in all blocks. On a new
Chromium revision, also check the vendored `cxx` version against the Cargo
pin if Rust/FFI compilation fails; do not blindly update only Cargo.lock.

## 4. Build and test

```bash
cd "$HOME/chromium/src"
gn gen out/Modal
gn check out/Modal '//chrome/browser/ui/modal_browser/*'
caffeinate autoninja -C out/Modal chrome browser_tests
```

If compilation fails, save the first actual compiler error. API changes may
require overlay changes; repeated builds alone will not fix them.

```bash
cd /Users/kyliandabancourt/Documents/vela
scripts/run_browser_tests.sh
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*:FindInPageControllerTest.*'
```

The Merlin suite includes the new `RefusedEditStopsPreviousSession` and
`PageColourBucketsAndContrast` tests. Do not rely on the old browser_tests
binary: the build above must finish successfully first.

Finally launch with a disposable profile before using your everyday profile:

```bash
"$HOME/chromium/src/out/Modal/Merlin.app/Contents/MacOS/Merlin" \
  --user-data-dir="$(mktemp -d /tmp/merlin-update-check.XXXXXX)"
```

Check solid light/dark/mid-grey pages, a page without a dominant background,
navigation, switching back to a scrolled tab, both tab layouts and hidden
tabs. The colour policy is a load-time viewport colour cached per document;
scrolling/tab switching should not choose a new colour. For a site theme
changed after loading, reload to refresh the cached colour.

Check external editing, a refused second edit, navigation during editing,
and preservation of the old file after cancellation. Test permissions,
private windows, recovery and extensions as listed in `BETA_REVIEW.md`.
Record the new pin/build and results in `TESTING.md` and `UPSTREAM.md`, and
commit the pin plus any patch/API refreshes. This development build still
needs the separate release/signing work before beta distribution.
