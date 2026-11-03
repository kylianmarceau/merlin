# Visual identity evidence

Captures are from isolated Chromium browser-test profiles on macOS, using real
WebUI renderers and compositor output for native bubbles. Fixture usernames,
local URLs and ports are synthetic. No personal credentials were exported.

The page tests request narrow 640 × 800 windows; macOS/Chromium may enforce a
larger minimum window width. The PNG dimensions record the actual rendered size.
Private windows retain Chromium's dark mode in both regular-profile theme
settings. `light-private-*` records a private window opened while the regular
profile uses Light; it is not a claim of a light private-window mode.

| Surface | Light | Dark |
| --- | --- | --- |
| Password save prompt | [capture](light-password-save.png) | [capture](dark-password-save.png) |
| Password safe status | [capture](light-password-success.png) | [capture](dark-password-success.png) |
| Password review status | [capture](light-password-review.png) | [capture](dark-password-review.png) |
| Local card save | [capture](light-card-save.png) | [capture](dark-card-save.png) |
| Passkey creation | [capture](light-passkey-create.png) | [capture](dark-passkey-create.png) |
| Media controls | [capture](light-media.png) | [capture](dark-media.png) |
| Media paused | [capture](light-media-paused.png) | [capture](dark-media-paused.png) |
| Media without artwork | [capture](light-media-no-artwork.png) | [capture](dark-media-no-artwork.png) |
| Media live-state presentation | [capture](light-media-live.png) | [capture](dark-media-live.png) |
| Cast permission notice | [capture](light-media-cast-permission.png) | [capture](dark-media-cast-permission.png) |
| Two media sessions, narrow window | [capture](light-media-multiple-narrow.png) | [capture](dark-media-multiple-narrow.png) |
| Password list | [capture](light-passwords.png) | [capture](dark-passwords.png) |
| Password checkup | [capture](light-password-checkup.png) | [capture](dark-password-checkup.png) |
| Password settings | [capture](light-password-settings.png) | [capture](dark-password-settings.png) |
| Merlin Settings reference | [capture](light-settings.png) | [capture](dark-settings.png) |
| Start page | [capture](light-start.png) | [capture](dark-start.png) |
| History | [capture](light-history.png) | [capture](dark-history.png) |
| Downloads | [capture](light-downloads.png) | [capture](dark-downloads.png) |
| Bookmarks | [capture](light-bookmarks.png) | [capture](dark-bookmarks.png) |
| Permissions page | [capture](light-permissions.png) | [capture](dark-permissions.png) |
| Permission prompt | [capture](light-permission.png) | [capture](dark-permission.png) |
| Site information | [capture](light-site-info.png) | [capture](dark-site-info.png) |
| Addresses | [capture](light-addresses.png) | [capture](dark-addresses.png) |
| Payments | [capture](light-payments.png) | [capture](dark-payments.png) |
| Security settings | [capture](light-security.png) | [capture](dark-security.png) |
| Extensions | [capture](light-extensions.png) | [capture](dark-extensions.png) |
| Certificates | [capture](light-certificates.png) | [capture](dark-certificates.png) |
| Private new tab | [capture](light-private-start.png) | [capture](dark-private-start.png) |
| Certificate warning | [capture](light-certificate-warning.png) | [capture](dark-certificate-warning.png) |
| Network error | [capture](light-network-error.png) | [capture](dark-network-error.png) |
| Print preview | [capture](light-print-preview.png) | [capture](dark-print-preview.png) |
| DevTools preferences | [capture](light-devtools.png) | [capture](dark-devtools.png) |

Narrow page variants have the suffix `-narrow.png`. The machine-readable
[browser test summary](browser-tests.json) is the source of truth for the most
recent run; test failures must be resolved before recording qualification.

## Verification status

2026-11-03, macOS 27.0.1 (26A434), Chromium 157.0.8103.26:
**29 distinct browser checks passed**, with **94 PNG captures**. See the
[qualification report](QUALIFICATION.md) and [source/image hashes](manifest.json).
The full run passed 28/28 cases. After the cast-permission wrapping fix, a
[focused follow-up](media-followup-tests.json) passed all three media cases,
including the additional permission-notice fixture (29 distinct cases total).

VoiceOver and actual macOS authentication are not certified by the automated
tests. Permission tests use Chromium's real
prompt view and a recording test delegate: they verify allow/once/deny callback
routing without granting microphone access or bypassing OS permission prompts.
Media tests verify that the actual native pause/play controls change an HTML
media element's playback state. Password tests exercise the real save/cancel
button paths with Chromium's synthetic password fixture, not personal passwords.

The local-card fixture checks actual view/controller accept and decline callback
routing with a synthetic test number; it does not upload or charge a card. The
passkey fixture checks relying-party text, focus and the actual creation-decision
callback without creating a real authenticator credential.

Print preview uses Chromium's real normal-mode print service in a background,
non-activating browser test process. That one case removes the headless switch,
because Chromium deliberately selects a different printing service in headless
mode. The test stops at preview and does not save or print a file. Other cases
retain the test runner's headless mode.

The maintainer can use [the manual macOS check sheet](MANUAL_CHECKS.md) for
Touch ID/Keychain, passkeys, VoiceOver and the remaining state matrix.

The media correction replaces the earlier Chromium card arrangement with a
Merlin-owned layout. Browser service controls and event/state bindings are
retained; the geometry regression requires the smaller primary action below
the timeline, so changing colours alone cannot satisfy the check. The live
case publishes a synthetic live MediaSession state. The cast-notice case uses
local mock Mojo endpoints and the real warning view; it does not certify an
actual macOS permission decision or a connection to a physical receiver.
