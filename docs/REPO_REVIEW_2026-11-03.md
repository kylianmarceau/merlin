# Repository review and remaining browser plan — 2026-11-03

Reviewed revision: `98c63c9` on `main` (visual identity merged). The working
tree was clean at the start of this review. This report supersedes the
November 2 review's current-status statements; earlier measurements remain
dated evidence.

Implementation follow-up: the four corrections in “Remaining implementation
corrections” below are now implemented in the working tree: accessible address
options/actions and active-descendant updates; shared Rust translation for
address/suggestion aliases; identity-suite default selection; and exact
Mac Stable version/commit checking with distinct ahead/error states. The native
build, GN check, 253 workspace tests, 11 tooling regressions and five targeted
browser cases pass. The updated default browser run also passed **137/137**
(77 modal, 44 blocker, 16 identity), with retries disabled. See
[the follow-up testing record](TESTING.md). The original
review/evidence below describes the pre-fix source. Manual VoiceOver acceptance
and the later blocker/release work remain separate.

Merlin's core browser feature set is implemented. The remaining first-beta
work is correcting specific UI/tooling gaps, qualifying native protection and
the final UI, and producing a tested GitHub distribution. Another broad
feature or visual redesign is not needed to complete the present plan.

## Scope and evidence limits

Reviewed the repository's Rust core/FFI and tools, native browser/renderer
integration, WebUI and shared presentation, all 45 patch purposes and their
application checks, build/dependency/resource/test/release tooling, public
documentation, local `notes/` planning, and retained qualification evidence.
Source tracing concentrated on URL entry, editor/document lifetimes, private
state, browserctl access, blocker attribution/threading/update boundaries and
release behavior. This is a repository-wide implementation/readiness review,
not a line-by-line security audit of the external Chromium or Brave projects.

Fresh verification in this review:

| Check | Result |
| --- | --- |
| Chromium checkout identity | HEAD matches the exact commit in `UPSTREAM_PIN` |
| Live [Chromiumdash Mac Stable](https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=5) query | `157.0.8103.26`, commit `4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`, matches the pin |
| `scripts/check.sh` with local pinned Chromium objects | Passed: formatting, warnings-denied Clippy, 252 workspace tests, page/measurement scripts, branding boundaries, bundled-resource integrity and all 45 patches |
| Patch installer against the reconstructed pinned source | 45 already applied; zero files would change |
| Applied Chromium names/artwork/DevTools/media audit | Passed with `scripts/check_visual_identity.py --src` |
| Generated presentation outputs | All eleven documented token/presentation patch `--check` commands passed |
| Development build graph | `autoninja -n chrome browser_tests` passed with zero build steps; this is freshness evidence, not a clean rebuild |
| Retained identity evidence | All 128 recorded source hashes and 94 screenshot hashes match; representative media, permission and certificate-warning captures inspected |
| Retained blocker benchmark | All eight recorded implementation hashes and the benchmark harness hash match |
| Combined current browser regressions | **134/134 passed** in 922 seconds: 74 modal, 44 blocker (including WebTransport) and 16 identity cases; retries disabled |

The first sandboxed test attempt could not bind the temporary Unix socket.
The successful repository checks ran outside that restriction. Browser tests
use isolated profiles/configuration, a test clipboard and background processes.
No personal browser profile, credentials or devices were used.

Logs for this review are under `/tmp/merlin-repo-review-2026-11-03-*`.
The combined run used
`scripts/run_browser_tests.sh 'ModalBrowserBrowserTest.*:MerlinAdblock*BrowserTest.*:MerlinIdentityBrowserTest.*'`
with `--test-launcher-summary-output=/tmp/merlin-repo-review-2026-11-03-browser.json`.
All 134 recorded statuses are `SUCCESS`. This run did not regenerate screenshots;
the retained image/source hashes were checked separately.
Historical evidence includes 35 loader cases, 136 upstream browser/view/
command/Find cases, 21 worker/extension cases and the signed-out live YouTube
matrix. Those groups and live journeys were not rerun merely because their
retained results exist. No distribution build, packaging, VoiceOver,
account/device authentication or downloaded-artifact acceptance is claimed.

## What is complete

| Plan area | Current state |
| --- | --- |
| Original foundation and modal browsing | Rust session/action model, CXX bridge and portable host harness; Normal/Insert/Visual/Command/Hint/Passthrough; counts, mappings, aliases, configuration and which-key |
| Keyboard-first navigation | Cross-frame/open-shadow-root hints, palettes, tabs, find, history/bookmarks/downloads, clipboard, marks and macros |
| Daily-driver/developer bridge | Splits, pins, windows/profiles, workspace save/restore/autosave/lazy loading/project lookup, user-only browserctl, external editing with generation/document guards |
| Structured document browsing | Outline/folding, heading/code/table motions, searchable links, Markdown/text extraction, selection and Reading mode |
| Browser shell | Merlin start/Settings/History/Bookmarks/Downloads, top/sidebar/custom tabs, groups, tab dragging, hidden tabs, address suggestions and document-scoped page colour |
| Safety corrections | Separate site controls, capture indicators and stop actions, pinned/compact sensitive alerts, Private label, accessibility-theme tint suppression, workspace project transfer |
| Chromium update | The 157 pin is built and matches current Mac Stable at this review's check; the old outstanding 156 rebase is closed |
| Native ad blocker implementation | Pinned Brave `adblock` 0.13.3, native HTTP/redirect/worker/cache/socket hooks, early scriptlets, cosmetics, popup filtering, bundled lists/resources, validated list updater, profile/site controls and private isolation |
| Browser visual identity implementation | Shared tokens, native/WebUI/DevTools presentation, product names/artwork and Merlin-owned media layout; 45 patches, with retained light/dark/narrow/private sample evidence |

The previous requirement to commit the safety/workspace working-tree additions
is also closed: those prerequisites and release-policy notes were committed
before the identity merge. They are included in the reviewed HEAD.

The blocker is an integration of Brave's engine, not the complete Brave
Shields product. `common/features.cc` still uses
`FEATURE_DISABLED_BY_DEFAULT`. A normal launch therefore does not provide
native blocking; development opt-in remains `--enable-features=MerlinAdblock`.
Settings preferences alone do not override that feature flag.

## Remaining implementation corrections

1. **Expose address suggestions to accessibility.** In
   `merlin_address_editor.cc:94`, the containing view has a listbox role,
   but suggestions are plain data painted by `PaintRow`. There are no
   accessible option nodes or selected-option announcements. Add names,
   roles, selection/active-descendant behavior and notifications, then verify
   keyboard use and VoiceOver. The command palette already has option views;
   that does not cover the separate address card.
2. **Make internal URL entry consistent.** `Begin()` formats the underlying
   `chrome://` URL; `OpenTyped()` sends text directly to Chromium's classifier
   without the Rust `merlin://` translation used by `:open`. Add explicit
   address-card alias handling and a test that types an alias into that card.
   `MerlinUrlsInBarAndPalette` currently exercises the command path and passive
   display. The exact present interactive classifier outcome was not reproduced
   in this review.
3. **Include the identity suite in normal regression selection.** The default
   filter in `scripts/run_browser_tests.sh:26` includes modal and blocker
   suites, but omits `MerlinIdentityBrowserTest.*` (16 current cases). Explicit
   invocation works. Add it to the normal suite or make a single documented
   aggregate check so the new presentation tests do not silently disappear
   from routine verification.
4. **Fix the upstream checker's ahead/equal logic.**
   `scripts/check_upstream.py:49` distinguishes only behind versus not-behind.
   A fresh mock with Stable `156.0.8078.80` and the current 157 pin incorrectly
   prints “current Mac Stable” and exits zero. Distinguish ahead, equal and
   behind and check the release commit. Today's real equality is confirmed;
   this defect is not evidence that the present pin needs another rebase.

These are source findings, not a claim that every manual acceptance item below
is a confirmed product defect.

## Finish native protection qualification before default enablement

Milestones 1–3 of `ADBLOCK_PLAN.md` are implemented. The release baseline in
milestone 0 and the remaining gates in milestones 4–6 are open.

- Build the non-component distribution configuration, then compare that same
  binary with protection on/off, fixed lists and isolated profiles. Retain at
  least ten paired trials for startup, clean/ad-heavy fixtures, real sites and
  YouTube, including median/p95 and raw/build/source identity.
- Investigate clean-page latency. The hash-matched development run has
  Navigation Timing medians of **19.60 → 25.70 ms** uncached and
  **18.25 → 24.45 ms** cached: approximately **31% and 34%**, versus the
  provisional 5% median/10% p95 budget. DevTools wall-clock clean-page results
  look better but do not cancel this observation. These are small absolute
  development-build timings, not a measured release-build failure.
- Profile scheduling/IPC as well as matching. The retained trace shows a
  **6.10 ms** median request round trip and **0.094 ms** inner match; its
  service-worker-policy fixture has a **31.15 ms** median span. These spans
  identify investigation targets, not a proven single cause.
- Measure complete blocker-owned steady memory, update peaks, multiple
  configurations, repeated navigation, DOM churn and evaluator contention.
  Stable 1/10/30-tab RSS samples already exist. The **10.43 MiB** warm Rust
  allocation result excludes C++/IPC/V8/reserved pages; the **46.45 MiB** Rust
  replacement-build peak is separate. Neither closes the full 32 MiB steady
  ownership target. Meet the provisional budgets or document a justified
  measured revision before enabling the default.
- Triage the **1,061 unsupported rules** by real compatibility impact. The
  engine supports 160,407 rules in the bundled audit; shared resources do not
  imply full uBlock/Brave syntax parity. Resolve important gaps or publish
  the supported boundary.
- Exercise real OAuth/login, payment, upload/download and legitimate popup
  journeys, including recovery by disabling protection for one site.
- Complete or explicitly scope the remaining YouTube conditions: signed-in
  non-Premium playback when a suitable account is available, observed mid-roll
  eligibility, Shorts ad eligibility and native UI/accessibility acceptance.
  Signed-out normal/private playback, an ad-eligible unprotected music control,
  nine-minute playback, SPA, playlist/autoplay, Shorts transitions, embeds,
  captions/fullscreen/PiP and a dated Brave reference already have evidence.

Change the feature default only after these gates close. Keeping protection
opt-in is a possible explicitly scoped development preview; it does not
complete the planned default-protected browser.

## Complete final browser acceptance

Use `visual-identity-evidence/MANUAL_CHECKS.md` and the smoke/extension matrices
in `TESTING.md` and `BETA_REVIEW.md`. Shared styling is implemented; full state
qualification remains open.

- Active-window keyboard/focus, Japanese/other IME, VoiceOver, zoomed iframe
  hints, narrow windows, tabs/groups/cross-window dragging, splits and fullscreen.
- Real camera/microphone/screen/tab sharing, OS permissions, capture stop and
  cancellation, autofill/password/passkey/Touch ID/Keychain, and available
  device/cast chooser journeys. Synthetic callback fixtures do not certify
  these OS/account/hardware paths.
- Real extension journeys: a password manager, Dark Reader, uBlock Origin
  Lite, Vimium coexistence and MV3 worker/command/permission behavior.
- Clean quit, force quit/recovery, multiple windows/profiles, downloads/
  uploads/PDFs and replacement updates retaining profile/config/workspaces.
- Warning/error/recovery variants, including effective Safe Browsing behavior
  in the actual distribution build. Preserved warning views alone do not
  establish API-dependent threat protection. Document measured limitations.

The November 2 review recorded one intermittent pre-test WebUI-toolbar paint
timeout and passing isolated reruns. A later clean full run can demonstrate
current success, but does not itself establish the old timeout's root cause.

## Produce the selected GitHub release

Follow `RELEASE.md`: no paid Apple account, Developer ID signing,
notarization or stapling. Free ad-hoc signing where required is compatible
with the selected scope.

- Make release-build setup reproducible. Only `out/Modal` currently has an
  args file. The example `import("//build/args.release.gn")` cannot work in the
  installed checkout because the overlay installer does not copy that file
  there. Provide a working copy procedure/helper, validate the args on 157 and
  build the non-component app.
- Replace/adapt `scripts/package_mac.sh`. Its default prints a dry run; its
  real path requires Developer ID/notary credentials and calls an unsuitable
  old signing entry point. It does not produce the chosen GitHub package.
  Accept an explicit fresh build, validate the complete bundle, and produce
  a versioned archive/DMG plus SHA-256 checksum.
- Deliberately settle the bundle identity (`local.merlin.Merlin` today) and
  retain it and the Merlin profile location across updates. Buying a domain
  is not a technical prerequisite. Retain matching symbols/build IDs.
- Ship minimum supported macOS/arm64 requirements, build/version identity,
  limitations, notices, installation/update instructions and a release channel.
- Test a browser-downloaded/quarantined artifact on another Mac: per-app
  Open Anyway approval, installation, launch/helpers/renderers, permissions,
  relaunch, replacement update and user-data retention.
- Operate security delivery: a responsible owner, Stable checks, versioned
  artifacts and tester notifications. The documented targets are three days
  for Stable security fixes and 24 hours for exploited-in-the-wild fixes.
  No in-repo CI/release workflow currently automates this. Manual updates are
  acceptable for the scoped invited beta if delivery is dependable.

## Close documentation, license and privacy work

- Add the intended root project `LICENSE`: the workspace declares
  BSD-3-Clause and source headers refer to that file, but it is absent.
- Generate and inspect notices from the actual release dependency graph,
  including Chromium, Rust crates, filter lists and executable resources;
  verify they are inside the shipped artifact. Complete the retained
  independent privacy/license reviews.
- Add Settings' config-file writes to `PRIVACY.md`'s files-written inventory
  (`OnSaveConfig` calls `config_file::Write`); update decision 14's older
  read-only claim. Earlier private-editor and viewport-sampling corrections
  are already implemented/documented.
- Consolidate current status. Historical plans contain superseded rebase,
  shell, theme, patch-count and test-count statements, even where an update
  note explains their age. `UPSTREAM.md` now records the current 45-patch
  inventory; retain useful history but link one current checklist and remove
  misleading GN “UNVERIFIED” comments where builds already provide evidence.

## Deferred work, outside the first-beta gate

Permissioned scripting/plugin support (`:script` remains explicitly planned),
site-specific keymaps, persistent marks, cross-frame document extraction,
richer omnibox special rows/keyword chips, address-inside-active-tab redesign
step 7b, horizontal tab scrolling, whole-group dragging, fullscreen drop targets,
bundled browserctl and a binary updater can follow. Porting the Cargo tests to
Chromium gtest is useful integration work, not evidence that no tests exist.

Windows/Linux/Intel, Google Sync, Widevine and proprietary codecs remain scope
decisions. Keep their limitations clear; do not add them as prerequisites for
the chosen macOS arm64 release. Browser identity still needs its manual state
matrix; a new complete redesign is not an outstanding implementation task.

Recommended order: address/test/checker fixes → reproducible release build →
blocker profiling and compatibility qualification → final active-window,
accessibility/device/extension acceptance → notices/security delivery →
package and downloaded-install/update acceptance → versioned GitHub beta.
