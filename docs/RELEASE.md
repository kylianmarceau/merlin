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

### Signing identity

An ad-hoc signature's designated requirement is a hash of the code
(`codesign -d -r- /Applications/Merlin.app` shows `cdhash H"…"` for 0.3.0),
so each new build looks like a different app to macOS: the keychain asks
again before Merlin can read "Chromium Safe Storage" (the name Chromium
 gives it), the key that encrypts
saved passwords and cookies, and camera, microphone and other privacy grants
reset. Releases are therefore signed with one self-signed certificate, which
makes the requirement `identifier "io.github.kylianmarceau.merlin" and
certificate leaf = H"…"`, the same for every build. Gatekeeper treats a
self-signed app like an ad-hoc one, so the Open Anyway steps don't change,
and no Apple account is involved.

Create it once, on the Mac that packages releases:

```bash
scripts/create_signing_identity.sh /Volumes/<offline drive>/merlin-signing.p12
```

It puts "Merlin Release Signing" in the login keychain and writes a
password-protected `.p12` backup. Package with
`MERLIN_SIGN_IDENTITY="Merlin Release Signing"`; `build-info.txt` records
the identity and the designated requirement, and packaging fails if a named
identity still produced a code-hash requirement.

Custody:

- The private key lives in the maintainer's login keychain and in the `.p12`
  backup, nowhere else. Keep the backup offline (an encrypted drive, not
  cloud storage or this repository) and its password in a password manager.
- To package on another Mac, import the backup there
  (`security import merlin-signing.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign`)
  instead of creating a new identity.
- A new certificate changes the requirement once for everyone: users answer
  the keychain prompt and grant camera and microphone access again. Only do
  that if the key is lost or exposed, and say so in the release notes.
- If the key is exposed, someone could sign an app that macOS lets read
  Merlin's keychain item. Create a new identity, release with it, and tell
  users in the release notes.

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
3. Test the assembled app: `scripts/check.sh`, then
   `scripts/run_e2e_tests.sh`, which also covers the ad blocker switched
   off, without lists, with a list that fails to load, before its rules
   are ready and overloaded (`test_adblock_states`). The ad blocker's
   Chromium browser tests need a development build (`out/Modal` from
   [`build/args.modal.gn`](../build/args.modal.gn), with
   `autoninja -C out/Modal browser_tests`) and its disk space; where you
   have one, run `scripts/run_browser_tests.sh` too and say in the release
   notes whether it ran.
4. Smoke-test the assembled app: it opens, pages and video play,
   hints, the palette, splits and workspaces work, an extension installs,
   and it quits and relaunches cleanly.
5. Install the Finder image builder once with `pipx install dmgbuild==1.6.5`,
   then package the app.

   ```bash
   MERLIN_APP="$PWD/apps/browser/build/assembled/Merlin.app" \
   MERLIN_SIGN_IDENTITY="Merlin Release Signing" \
   MERLIN_VERSION=0.2.0 scripts/package_mac.sh
   ```

   It packages only an assembled app: the engine alone
   (`out/Release/Merlin.app`) is refused. Every packaged binary needs a dSYM
   with its UUID, from the engine's build directory or next to the React
   host; packaging fails naming any that has none. `build-info.txt` records
   the engine's and the shell's source commits from the assembly manifest,
   their lockfiles and binary UUIDs, and the packaging commit separately.

   It stamps `MERLIN_VERSION` into the app's `Info.plist` as `MerlinVersion`,
   which Settings › General › Updates compares with GitHub Releases, and as
   `CFBundleShortVersionString`, which Finder's Get Info shows; Chromium's
   version moves to `MerlinChromiumVersion`. Chromium reads its version from
   its framework's own `Info.plist`, which is untouched, and
   `CFBundleVersion` stays Chromium's build number for LaunchServices. Then it
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
6. Upload to a draft release. Edit
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
7. Run the install test below on the draft's download and record it in
   `dist/<version>/install-qualification.md`, then publish the stable
   draft as Latest:

   ```bash
   gh release edit v0.2.0 --draft=false --latest
   gh workflow run update-merlin.yml --repo kylianmarceau/homebrew-tap
   ```

   The tap also checks hourly for new stable releases. GitHub schedules
   can be delayed. Its updater validates the DMG checksum and commits the
   new cask version; beta releases and drafts are ignored.

### Install test

Every release is qualified on its own download before it is published:
a quarantined DMG on a fresh macOS account through Open Anyway, replacing the
previous version (profile, passwords without a keychain prompt, workspaces,
camera access kept), camera, microphone, screen sharing, location and
notification prompts, and one run on macOS 14 (a VM is fine). The checklist
is [install-qualification.md](install-qualification.md); packaging copies
it to `dist/<version>/install-qualification.md`, where the results are
recorded and kept with `build-info.txt`. Don't publish with a failed step.

If macOS reports the app as damaged, the signature is broken: don't publish.
Check `codesign --verify --deep --strict --verbose=2 /Applications/Merlin.app`.

### Security updates

Updates are manual until an updater exists. Testers hear about releases by
watching the repository. The targets (SECURITY.md): three days for a Chromium
Stable security release, 24 hours when Google reports a fix for a bug
exploited in the wild.

`scripts/package_mac.sh` is the gate: it runs `scripts/check_upstream.py`
against the pin the engine was built with and refuses to package unless that
is the current Mac Stable release. `MERLIN_ALLOW_STALE_CHROMIUM=1` packages
anyway; `build-info.txt` then says so, and `dist/<version>/release-notes.md`,
the notes to upload, opens with a security notice. If the check itself
fails (no network), it refuses too.

### Security-only release

To meet those targets, a Chromium security update ships on its own, with no
feature work:

1. Branch from the last release's commit (or `main` if nothing unreleased is
   on it): `git switch -c security/<chromium version> <commit>`.
2. Bump the pin: update `UPSTREAM_PIN` to the version and commit
   `scripts/check_upstream.py` reports, and sync the checkout by the rebase
   procedure in [UPSTREAM.md](UPSTREAM.md#rebase-procedure).
3. Refresh the patches: `scripts/apply_patches.py`, then
   `scripts/verify_patches.sh`. Fix only what no longer applies.
4. Build: `scripts/build_release.sh`, `scripts/build_react_shell.sh` and
   assembly, as above.
5. Test: `scripts/check.sh` (which includes `pnpm ui:check` and `ui:test`)
   and `scripts/run_e2e_tests.sh`
   against the assembled app.
6. Package without the override and follow **Every release** from step 6,
   with release notes that name the Chromium version and its security fixes.
   Bump only the patch version (0.3.0 to 0.3.1).

If a rebase can't be finished in time, say so in a security advisory or
release note rather than packaging a stale engine silently.

## Installing an unnotarized GitHub release

### Homebrew

Requires an Apple Silicon Mac and macOS 14 Sonoma or later:

```bash
brew install --cask kylianmarceau/tap/merlin
```

Attempt to open Merlin, then approve it in **System Settings > Privacy &
Security > Open Anyway**, as described below. Homebrew preserves macOS
quarantine protections. To upgrade:

```bash
brew update
brew upgrade --cask kylianmarceau/tap/merlin
```

The upgrade quits a running Merlin first. Profiles and configuration are
kept; `brew uninstall --zap --cask merlin` removes them with the app. To switch an existing manual install
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

A fresh profile opens on a painted Norwegian fjord under the northern lights with a short stereo soundtrack,
then moves directly into setup. **Mute** silences the film and keeps it muted
on replay. **Skip intro** jumps to appearance, and **Replay intro** on that
screen plays the film again. Reduce Motion takes you straight to setup.
Choose a light, dark or system appearance, then your tab placement and
workspace colour. In the offline field guide, press `f` and type the
displayed hint to board the boat. Press `Shift-G` to reach the landing.
Both exercises also support a mouse. **Finish practice** leads to the
finish screen, where **Start browsing** returns to your tabs and **Import
bookmarks…** opens the importer. Interrupted setup resumes at its saved
step. **Help › Keyboard Tutorial** reopens the guide. To replay first launch
from a checkout, run `scripts/preview_onboarding.sh /path/to/Merlin.app`.
Each run uses a fresh temporary profile, configuration and workspace.

To update, quit Merlin, download the newer GitHub release and replace the
app in Applications. Keep the existing profile and configuration folders.
macOS may require approval again for a new download.
