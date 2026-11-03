# Visual identity qualification — 2026-11-03

Branch: `feature/merlin-visual-identity`. macOS 27.0.1 (26A434), Apple Silicon.
Chromium: `157.0.8103.26`. This is a development component build, with isolated
synthetic browser-test profiles. Evidence was captured from the development
tree before the merge. Existing browser-safety/workspace prerequisites were
subsequently recorded separately; release-policy and review documentation was
also committed at the maintainer's request before merging. This report does
not certify every inventoried UI state.

## Automated results

| Check | Result | Evidence |
| --- | --- | --- |
| Development `chrome browser_tests` build | Passed | [build log](build.txt) |
| GN generation/dependency check | Passed | [GN log](gn-check.txt) |
| Identity and existing Merlin browser regressions | 28/28 passed, 252 seconds | [summary](browser-tests.json), [log](browser-tests.txt) |
| Light/dark captures, including narrow/private samples | 94 PNGs; sample pairs inspected | [capture index](README.md), [dimensions/hashes](manifest.json) |
| Repository checks: Rust fmt/clippy/tests, C++ host harness, JS syntax, resource provenance | Passed | [check log](repository-checks.txt) |
| Pinned Chromium/dependency patch applicability and installer idempotence | 45/45 passed, zero files would change | [patch log](patch-verification.txt) |
| Generated identity outputs | All fourteen generators current | [generator log](generator-checks.txt) |
| Applied names, artwork, tokens and diagnostic boundary checks | Passed; 54 desktop message and 12 DevTools exceptions reviewed explicitly | [source audit](source-audit.txt) |

The repository-wide core/format check log predates the media layout batch.
The current native build, GN check, source audit and 45-patch verification include
the media changes. The full 28-case run passed; a subsequent cast-notice wrapping
fix passed a focused three-case media run (29 distinct passing cases total).
See [the follow-up summary](media-followup-tests.json) and
[log](media-followup-tests.txt). The source/image manifest records both result
files and the resulting overlay/patch hashes.

## What the browser tests establish

- Shared native colours, geometry and focus contrast; high-contrast/custom-theme
  opt-out and explicit private-window identity.
- Settings, passwords/checkup, permissions, addresses/payments, security,
  certificates, extensions and Merlin library/start pages render with common
  tokens in light/dark and requested narrow windows.
- Password save/cancel controls and semantic safe/review headers use the real
  Chromium fixture/controller paths.
- The Merlin-owned media layout preserves actual playback and seeking, native
  focus and original media actions. It is captured with artwork, without artwork,
  paused, with two sessions in a narrow window, and with synthetic live state.
  Live media hides finite-duration timestamps and seek controls.
- The cast-permission notice wraps inside the compact card without truncating its
  text or settings link. This uses the real notice with local mock endpoints;
  actual OS permission and receiver behavior still need manual qualification.
- Real permission prompt views route allow, allow-once and deny through a recording
  delegate; site controls open and retain their security/permission anchors.
- An actual expired-certificate server produces the warning and Back to safety
  returns to the preceding page. Network errors keep their browser-only styling.
- The normal print-preview service loads, and its prominent action uses Merlin's
  gold/contrast pair. No file was saved or printed.
- DevTools preferences retain their native browser-theme option and use Merlin's
  surface, selection, checkbox and focus roles, with the correct product label.
- Local-card accept/decline and passkey-creation decisions reach their actual
  view/controller callbacks. The passkey fixture preserves the relying-party
  identity and checks focus. Events occur after the input-protection interval;
  production input-protection logic is unchanged.
- Existing settings changes, URL presentation, history, bookmarks, downloads,
  menus, toolbar and logo tests continue to pass.

These checks do not establish successful real card persistence/upload, payment
authentication, creation of a hardware passkey, or approval by a macOS service.
No real credentials, account data or payments were used.

## Remaining qualification and exceptions

Full acceptance remains open. Complete [the manual macOS sheet](MANUAL_CHECKS.md)
for VoiceOver, full keyboard traversal, Touch ID/Keychain, passkeys and security
keys, actual OS permissions, cast/device choosers, account/managed-profile states,
payment authentication, extension warnings, unsafe-download/Safe Browsing
variants, recovery and the other uncommon states in the inventory.

Truthful external service/provider names, compatibility and trust-policy names,
copyright/credits, internal identifiers, security-sensitive URLs and user agents
remain unchanged. Four phone/laptop/connection animations remain as instructional
art, pinned to exact hashes. DevTools falls back to English source for its 44
changed translation keys until Merlin translations are supplied. The exact
exceptions and update procedure are in [the inventory/batch report](../VISUAL_IDENTITY.md).

Website content, extension-owned UI and macOS-owned dialogs are outside the
branding boundary. Private new-tab captures stay dark even when the regular
profile uses Light. New source inventory entries are review leads, not an
automatic claim of completed visual or functional qualification.
