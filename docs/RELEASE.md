# GitHub release policy and installation

## Accepted release scope — 2026-11-02

Merlin will be distributed through GitHub Releases without a paid Apple
Developer account. Developer ID signing, Apple notarization and ticket
stapling are intentionally out of scope. They are not unfinished work or
release blockers. Do not recommend purchasing an account during progress
or readiness reviews unless the maintainer explicitly changes this decision.
This policy supersedes signing requirements in older plans and reviews.

Finish the implementation and its tests, build and package the distribution
app, and verify installation of the downloaded artifact. Free ad-hoc signing
where needed for Apple Silicon execution is allowed; it does not establish
a Developer ID identity or Apple notarization.

## Making a release

### Before the first release

- [x] Bundle ID: `io.github.kylianmarceau.merlin` (`MAC_BUNDLE_ID` in
  `overlay/chrome/app/theme/merlin/BRANDING`, chosen 2026-11-04). macOS
  keys permissions and some app data to it, so keep it for every later
  release. `package_mac.sh` refuses the old `local.*` placeholder.
- [x] The source repository and release downloads are public (2026-11-15).
  The public Homebrew tap is `kylianmarceau/homebrew-tap`.
- [ ] Turn on **Settings > Security > Private vulnerability reporting** on
  GitHub. The README, release notes and [SECURITY.md](../SECURITY.md) send
  security reports there; until
  it is on, the Security tab has no **Report a vulnerability** button.

### Every release

1. Commit everything that should ship. `build-info.txt` records the commit
   and flags uncommitted changes.
2. Build. Needs about 50 GB free and several hours the first time:

   ```bash
   scripts/apply_overlay.sh
   scripts/build_release.sh
   ```

   This writes `out/Release/args.gn` from
   [`build/args.release.gn`](../build/args.release.gn): optimized,
   non-component, profile-guided (PGO) and with separate dSYMs. It then
   builds `chrome` and writes `credits.html`. The PGO profile comes with
   `gclient runhooks` once `~/chromium/.gclient` sets
   `"checkout_pgo_profiles": True` in `custom_vars`; the script stops with
   instructions if it is missing.
   Build the React host and assemble it with the engine using the commands
   in [the shell build guide](../apps/browser/README.md#build-when-ready).
   The distribution app is `apps/browser/build/assembled/Merlin.app`.
3. Smoke-test the assembled app: it opens, pages and video play,
   hints, the palette, splits and workspaces work, an extension installs,
   and it quits and relaunches cleanly.
4. Package:

   ```bash
   MERLIN_APP="$PWD/apps/browser/build/assembled/Merlin.app" \
   MERLIN_VERSION=0.2.0 scripts/package_mac.sh
   ```

   It packages only an assembled app: the engine alone
   (`out/Release/Merlin.app`) is refused. Every packaged binary needs a dSYM
   with its UUID, from the engine's build directory or next to the React
   host; packaging fails naming any that has none. `build-info.txt` records
   the engine's and the shell's source commits from the assembly manifest,
   their lockfiles and binary UUIDs, and the packaging commit separately.

   It stamps `MERLIN_VERSION` into the app's `Info.plist` as `MerlinVersion`,
   which Settings › General › Updates compares with GitHub Releases. Then it
   signs the app (`scripts/sign_app.py`: every binary and bundle, innermost
   first) with the hardened runtime and Chromium's entitlement files: camera,
   microphone, location, USB, Bluetooth, print and photos for the app, JIT
   for the renderer and GPU helpers. Every executable also has library
   validation turned off: it admits only code signed by the app's own team,
   and ad-hoc code has no team ID, so the host could not load Hermes or the
   framework without it. It checks the signature, and writes the DMG, its SHA-256 checksum,
   `build-info.txt` and a dSYM archive to `dist/<version>/`. Keep the dSYMs
   and build info for crash reports. Don't upload the dSYMs.
   To promote an unchanged beta, reuse that beta's compiled, assembled app
   and package it with the stable version. There is no need to recompile
   Chromium or the shell solely to remove a beta suffix. Keep the original
   source commit and matching dSYMs; verify the repackaged download.
5. Upload to a draft release. Edit
   [`RELEASE_NOTES.md`](RELEASE_NOTES.md) first if anything changed:

   ```bash
   gh release create v0.2.0 --draft --title "Merlin 0.2.0" \
     --notes-file docs/RELEASE_NOTES.md \
     dist/0.2.0/Merlin-0.2.0-arm64.dmg \
     dist/0.2.0/Merlin-0.2.0-arm64.dmg.sha256
   ```

   Beta versions use a suffix such as `0.3.0-beta.1` and `--prerelease`.
   The tag must identify the commit used to build the app; use `--target`
   with that commit when repackaging an older beta.
6. Run the install test below on the draft's download, then publish the
   stable draft as Latest:

   ```bash
   gh release edit v0.2.0 --draft=false --latest
   gh workflow run update-merlin.yml --repo kylianmarceau/homebrew-tap
   ```

   The tap also checks hourly for new stable releases. GitHub schedules
   can be delayed. Its updater validates the DMG checksum and commits the
   new cask version; beta releases and drafts are ignored.

### Install test

On another Mac, or at least another user account, download the DMG from the
draft release **in a browser**, so macOS quarantines it as it would for a
tester. Record the macOS version and the result of each step:

- [ ] The checksum matches the `.sha256` file.
- [ ] The DMG opens and shows Merlin, Applications, the read-me, licence,
  NOTICE, third-party notices and build info. The notices include React
  Native, Hermes, Zustand, SocketRocket, Expo and Ardia (packaging checks
  this with `scripts/shell_notices.py --check`).
- [ ] After dragging to Applications, the first launch is blocked with
  "can't check" (not "damaged"), and **Open Anyway** in Privacy & Security
  opens it.
- [ ] Pages load; renderer, GPU and network helpers run (Activity Monitor
  shows `Merlin Helper` processes).
- [ ] A permission prompt works, e.g. location or notifications on a test
  site, along with the macOS prompt if one appears.
- [ ] Quit and relaunch without approving again.
- [ ] Replace the app with a newer package (or a repackage of the same
  build): bookmarks, history, workspaces and `config.toml` are still there.

If macOS reports the app as damaged, the signature is broken: don't publish.
Check `codesign --verify --deep --strict --verbose=2 /Applications/Merlin.app`.

### Security updates

Updates are manual until an updater exists. Check for Chromium Stable
releases with `scripts/check_upstream.py`, follow the rebase procedure in `docs/UPSTREAM.md` to
update, then release as above. The targets: three days for a Stable security
release, 24 hours when Google reports a fix for a bug exploited in the wild.
Testers hear about releases by watching the repository.

## Installing an unnotarized GitHub release

### Homebrew

Requires an Apple Silicon Mac and macOS 14 Sonoma or later:

```bash
brew install --cask kylianmarceau/tap/merlin
```

Attempt to open Merlin, then approve it in **System Settings > Privacy &
Security > Open Anyway**, as described below. Homebrew preserves macOS
quarantine protections. Quit Merlin before upgrading:

```bash
brew update
brew upgrade --cask kylianmarceau/tap/merlin
```

Profiles and configuration are kept. To switch an existing manual install
to Homebrew, follow the [tap's adoption instructions](https://github.com/kylianmarceau/homebrew-tap#readme).

### Direct download

1. Download the macOS Apple Silicon artifact from Merlin's GitHub Releases.
   Check its version and requirements against the release notes. Compare
   its SHA-256 checksum with the `.sha256` file:
   `shasum -a 256 /path/to/downloaded-artifact`.
2. Open the DMG, then drag `Merlin.app` into `/Applications`. Eject the DMG.
3. Open Merlin from Applications. macOS blocks the first launch because
   Apple has not notarized the app.
4. After that attempt, open **System Settings > Privacy & Security**,
   find the message about Merlin, and click **Open Anyway**. Authenticate
   if prompted and confirm **Open**. Only approve a download you trust.

Apple documents this per-app exception in
[Open apps safely on your Mac](https://support.apple.com/en-gb/102445).
There is no need to disable Gatekeeper globally. If the exception is
unavailable or the app still fails to launch, report the exact message,
macOS version and release version.

To update, quit Merlin, download the newer GitHub release and replace the
app in Applications. Keep the existing profile and configuration folders.
macOS may require approval again for a new download.
