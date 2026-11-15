# Security

## Reporting a problem

Please don't report security problems in a public issue. Use GitHub's
**Report a vulnerability** button on this repository's **Security** tab,
which opens a private advisory only the maintainer can see. Include the
Merlin version (`chrome://version`), macOS version, steps to reproduce,
and whether stock Chromium at the same version behaves the same.

Problems in Chromium itself belong in
[Chromium's security tracker](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/);
Merlin picks up the fix with its next Chromium update.

## Supported versions

Only the newest GitHub release gets fixes. Merlin doesn't update itself:
`brew upgrade --cask kylianmarceau/tap/merlin` installs new releases, and
**Watch > Custom > Releases** on this repository announces them.

## Chromium security updates

Merlin aims to ship a release within three days of a Chromium Stable
security update, and within 24 hours when Google reports a fix for a bug
exploited in the wild. `scripts/check_upstream.py` checks for them.
