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

## Remaining release work

- Complete feature qualification and regression/acceptance checks; record
  actual results and outstanding gaps in [Testing](TESTING.md) and the
  [beta review](BETA_REVIEW.md).
- Build the non-component distribution app using `build/args.release.gn`.
  Preserve the bundle identity and profile location across updates.
- Package an explicitly selected fresh build for GitHub Releases. Publish
  its version, supported macOS/architecture, known limitations, SHA-256
  checksum, third-party notices and these installation steps.
- Test a browser-downloaded artifact on another Mac: installation through
  Gatekeeper's per-app approval, launch, renderer processes, permissions,
  relaunch, replacement update and profile retention. Keep matching symbols
  and build IDs for crash diagnosis.
- Deliver Chromium security updates through versioned GitHub releases and
  notify testers. Updates are manual until an updater exists.

The existing `scripts/package_mac.sh` is an unverified signing/notarization
prototype, not the packaging path for this release. Its dry run does not
produce an artifact. Adapting or replacing that path and validating the
distribution build remain implementation work; this policy does not claim
they are complete. The absence of Apple credentials is not a dependency.

## Installing an unnotarized GitHub release

These steps describe the intended release workflow; installation of a
published artifact still needs the acceptance check above.

1. Download the macOS Apple Silicon artifact from Merlin's GitHub Releases.
   Check its version and requirements against the release notes. If a
   SHA-256 checksum is provided, compare it with
   `shasum -a 256 /path/to/downloaded-artifact`.
2. Open the DMG or extract the archive, then drag `Merlin.app` into
   `/Applications`. Eject the DMG if applicable.
3. Open Merlin from Applications. macOS may block the first launch because
   it cannot verify the developer or Apple has not notarized the app.
4. After that attempt, open **System Settings > Privacy & Security**,
   find the message about Merlin, and click **Open Anyway**. Authenticate
   if prompted and confirm **Open**. Only approve a download you trust.

Apple documents this per-app exception in
[Open apps safely on your Mac](https://support.apple.com/en-gb/102445).
There is no need to disable Gatekeeper globally. If the exception is
unavailable or the app still fails to launch, report the exact message,
macOS version and release version; installation is not yet verified for
that configuration.

To update, quit Merlin, download the newer GitHub release and replace the
app in Applications. Keep the existing profile and configuration folders.
macOS may require approval again for a new download.
