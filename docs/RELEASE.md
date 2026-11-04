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
- [ ] Decide whether the repository is public. Release downloads on a
  private repository are visible only to collaborators.
- [ ] Turn on **Settings > Security > Private vulnerability reporting** on
  GitHub, which [SECURITY.md](../SECURITY.md) points reporters to.

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
   non-component, separate dSYMs and no PGO profile. It then builds `chrome`
   and writes `credits.html`.
3. Smoke-test `out/Release/Merlin.app`: it opens, pages and video play,
   hints, the palette, splits and workspaces work, an extension installs,
   and it quits and relaunches cleanly.
4. Package:

   ```bash
   MERLIN_VERSION=0.1.0-beta.1 scripts/package_mac.sh
   ```

   This ad-hoc signs the app (every binary and bundle, innermost first),
   checks the signature, and writes the DMG, its SHA-256 checksum,
   `build-info.txt` and a dSYM archive to `dist/<version>/`. Keep the dSYMs
   and build info for crash reports. Don't upload the dSYMs.
5. Upload to a draft pre-release. Edit
   [`RELEASE_NOTES.md`](RELEASE_NOTES.md) first if anything changed:

   ```bash
   gh release create v0.1.0-beta.1 --draft --prerelease --title "Merlin 0.1.0-beta.1" \
     --notes-file docs/RELEASE_NOTES.md \
     dist/0.1.0-beta.1/Merlin-0.1.0-beta.1-arm64.dmg \
     dist/0.1.0-beta.1/Merlin-0.1.0-beta.1-arm64.dmg.sha256
   ```

6. Run the install test below on the draft's download, then publish the
   draft.

### Install test

On another Mac, or at least another user account, download the DMG from the
draft release **in a browser**, so macOS quarantines it as it would for a
tester. Record the macOS version and the result of each step:

- [ ] The checksum matches the `.sha256` file.
- [ ] The DMG opens and shows Merlin, Applications, the read-me, licence,
  notices and build info.
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
releases with `scripts/check_upstream.py`, follow [Upstream](UPSTREAM.md) to
update, then release as above. The targets: three days for a Stable security
release, 24 hours when Google reports a fix for a bug exploited in the wild.
Testers hear about releases by watching the repository.

## Installing an unnotarized GitHub release

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
