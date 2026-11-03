# Repository review and remaining plan — 2026-11-02

Merlin has a substantial working browser implementation. The original modal,
workspace, editor and document-navigation features are present, as are the
custom browser UI and native Brave-engine integration. The remaining first-beta
work is qualification, a few concrete UI/tooling corrections, and distribution.
The ad blocker is implemented but is not yet qualified for default enablement.

This review covers the Merlin repository and working tree, including the
overlay, upstream patch series, Cargo/GN integration, tools, build/test/release
scripts, public documentation, local planning notes and retained blocker
evidence. Security-sensitive paths received closer source inspection. This is
not a line-by-line audit of the external Chromium checkout or a security
certification. Source findings, fresh checks and historical evidence are
distinguished below. No product implementation was changed by this review.

Reviewed HEAD: `fdfa076`, branch `feature/native-adblock`, plus the existing
uncommitted safety-control, workspace and documentation changes. Those changes
are part of the implementation assessed here; they must accompany any release.

## What is already implemented

| Area | Current implementation |
| --- | --- |
| Modal browsing | Normal, Insert, Visual, Command, Hint and Passthrough modes; counts, key sequences, remapping, aliases, configuration and which-key |
| Browser navigation | Link/input hints across frames and open shadow roots; tabs, history, bookmarks, downloads, find, clipboard, marks and macros |
| Workspaces | Save/open/delete, autosave, lazy tab restoration, pins, split pairs and project-folder associations |
| Developer integration | User-only browserctl socket and CLI, project workspace lookup, external editor with generation/document guards and sensitive-field revalidation |
| Document browsing | Outline, heading/code/table motions, searchable links, Markdown/text extraction, selection and Reading mode integration |
| Browser UI | Merlin branding, start page, Settings/History/Bookmarks/Downloads, top/sidebar tabs, groups, dragging, splits, address suggestions, hidden tabs and document-scoped page colours |
| Safety controls | Persistent site-controls entry point, capture indicator/menu/stop actions, pinned/compact capture alerts, explicit Private label, accessibility-theme tint suppression |
| Chromium integration | Checkout and pin agree on `157.0.8103.26`, commit `4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`; 31 patches apply |
| Native blocking | Pinned Brave `adblock` 0.13.3, network/redirect/worker/socket filtering, service-worker and decoded-cache coverage, early scriptlets, cosmetics, popup filtering, bundled lists/resources, profile controls and validated background list updates |

The blocker is an independent native feature, not the full Brave Shields
product. `overlay/components/merlin_adblock/common/features.cc` still declares
`FEATURE_DISABLED_BY_DEFAULT`. Turning modal keys off does not turn protection
off. With the feature flag absent, the Settings protection preference alone
does not activate it.

The old editor-targeting, private editor-export, page-colour cache/contrast,
site-info anchor and workspace-project handoff findings have implementation
fixes and regression coverage. They should not be counted as unimplemented
merely because the original October 31 review text remains in the repository.

## Verification in this review

Follow-up verification against the same working tree on November 2 passed
`scripts/check.sh` again: formatting, warnings-denied Clippy, all 252 workspace
tests, page/measurement script checks, all 18 bundled lists/resources and strict
application/idempotence of all 31 patches. The isolated Unix-socket test needs
execution outside the sandbox. A fresh targeted headless run passed **8/8** in
54 seconds: history, toolbar/address opening, internal URL display/command
handling, refused editor replacement, workspace restore/project lookup and both
page-colour regressions. This targeted run does not exercise typing an internal
alias into the address card or screen-reader suggestion accessibility.

The follow-up build dry run again reported **zero steps** for `chrome
browser_tests`, and all eight retained benchmark source hashes plus its harness
hash match. A fresh public Chromiumdash query returned Mac Stable
**157.0.8103.26**, commit
`4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`, exactly matching the pin and local
checkout. This supersedes the earlier platform/channel uncertainty below.

Follow-up logs: `/tmp/merlin-current-review-check.log`,
`/tmp/merlin-current-review-browser.log` and
`/tmp/merlin-current-review-build.log`. The earlier full-run evidence follows;
it was inspected, not rerun in full during this follow-up.

- `CHROMIUM_SRC="$HOME/chromium/src" scripts/check.sh`: passed after allowing
  the isolated Unix-socket test to run outside the execution sandbox.
- Formatting and warnings-denied Clippy: passed.
- Cargo workspace: 252 tests passed, including 19 blocker engine fixtures,
  the cxx bridge tests and the portable C++ host harness.
- Page-script checks, Node syntax checks and packaged-resource integrity:
  passed. The resource verifier checked 18 lists and the executable bundle.
- All 31 patches applied sequentially to files extracted from the pinned
  Chromium Git objects; patch-installer idempotence also passed.
- The local Chromium checkout HEAD matches `UPSTREAM_PIN`.
- `autoninja -C "$HOME/chromium/src/out/Modal" -n chrome browser_tests`:
  succeeded with zero build steps. No inspected source file was newer than
  `browser_tests`. This is a build-graph freshness check, not a clean rebuild.
- All eight source/harness hashes retained with the primary blocker benchmark
  match the current files.
- Snapshot output contains 14 PNGs; light command-palette, dark tab-palette and
  hint captures were inspected without visible clipping/layout problems.
- Fresh combined headless browser run: **117/118 passed** in 879 seconds.
  All **44/44 blocker cases passed**; Merlin's existing suite passed **73/74**.
  `MerlinHistoryPage` timed out in
  `WaitUntilInitialWebUIPaintAndFlushMetricsForTesting`, called by
  `InProcessBrowserTest::PreRunTestOnMainThread`, before its history-page test
  body. The identical targeted case then passed **2/2** isolated iterations
  in 11 seconds. The first-pass failure remains recorded; the cause of this
  intermittent toolbar-readiness timeout is unresolved, and the evidence does
  not establish a history-query/assertion defect.

Local verification logs are `/tmp/merlin-review-check.log`,
`/tmp/merlin-review-browser-tests.log`, `/tmp/merlin-review-history-rerun.log`
and `/tmp/merlin-review-build-dryrun.log`; snapshots are in
`/tmp/merlin-review-snapshots/`.

Initial sandbox failures were environmental: Unix socket binding and a macOS
sysctl required by Chromium were denied. The successful checks used the
existing tests' isolated profiles/configuration. No personal browsing profile
was used.

Historical evidence remains useful but is not a fresh run in this review:
35 loader cases, 136 upstream browser/view/command/Find cases, 21 worker/extension
cases, and the dated live signed-out YouTube matrix. See [Testing](TESTING.md)
and [blocker implementation](ADBLOCK_IMPLEMENTATION.md).

No release build, packaging, account-based playback, OS permission/device,
VoiceOver or downloaded-artifact installation acceptance was performed here.

## Work required before a beta with protection enabled by default

### 1. Finish blocker performance and compatibility qualification

The source-hash-matched development benchmark is substantive evidence, but it
does not close milestone 6. Its clean-page Navigation Timing medians regress
from 19.60 to 25.70 ms uncached (about 31%) and 18.25 to 24.45 ms cached
(about 34%). The plan allows 5% median and 10% p95 regression. DevTools wall
time has different results and considerable coordination noise; it cannot
erase the browser's own timing regression.

The retained trace has a 6.10 ms median request round trip versus 0.094 ms
median inner match, and 31.15 ms median service-worker-policy spans in that
fixture. These measurements point toward investigating scheduling, IPC and
the policy path as well as engine matching. They are diagnostic observations,
not proof of a single cause or a forecast for every website.

Required evidence:

- Same non-component release build, feature on/off, fixed lists and profiles,
  at least ten paired trials, warm/cold startup, clean/ad-heavy/real sites and
  YouTube; retain raw data and source/build identity.
- Account for browser-owned C++/IPC/V8 state, steady memory and update peaks,
  repeated navigation, DOM churn and evaluator contention. Verify bounded
  retention with 1/10/30 tabs and different evaluator configurations.
- Meet the provisional budgets or explicitly revise them with a reason and
  measurements before changing the default.
- Review the 1,061 unsupported rules by compatibility impact. The task is to
  resolve important gaps or document supported scope, not to assume all
  unsupported syntax is implemented or that all rules must be supported.
- Exercise real login/OAuth, payment, download/upload and popup recovery
  journeys, including protection disabled for a broken site.

The standalone Rust allocation probe reports 10.43 MiB warm engine ownership
and a 46.45 MiB replacement-build peak. It excludes C++, IPC, V8 and allocator
reservation. Process-tree RSS increases of approximately 56–104 MiB are also
not blocker-owned heap measurements. Neither result alone passes or fails the
32 MiB steady-state ownership target.

Milestones 1–3 are implemented; milestone 4 has remaining real-site journey
acceptance; milestone 5 has remaining YouTube/native UI conditions; milestone
6 has remaining release-build/performance/default-enable gates. Milestone 0's
release baseline is also still open.

### 2. Complete the remaining live YouTube conditions

Do not repeat completed work as if no playback testing exists. Dated evidence
already covers signed-out normal/private playback, an ad-eligible unprotected
music control, nine-minute playback, native SPA navigation, playlist/autoplay,
Shorts transitions, cross-site embedding and foreground captions/fullscreen/PiP.

Remaining conditions are signed-in non-Premium playback when an appropriate
account is available, observed mid-roll eligibility, Shorts-specific ad
eligibility and native UI/accessibility acceptance. The Brave reference run
does not establish parity, and no finite sample establishes permanently zero
ads. Close or explicitly scope each outstanding condition before defaulting
the blocker on.

### 3. Correct the address-card gaps and run active-window acceptance

Two source findings deserve implementation work:

1. **Suggestion accessibility:** `merlin_address_editor.cc:94` creates a named
   listbox with a textfield, but stores suggestions as plain `Row` data and
   paints them in `PaintRow`. There are no option views/virtual accessibility
   nodes or active-option announcements. `SetRows` and `SelectRow` repaint
   without exposing the selected suggestion. Add accessible options, names,
   selection state and notifications, then verify with VoiceOver. Merely
   naming the containing listbox does not expose its painted rows.
2. **Internal URL consistency:** `MerlinAddressEditor::Begin` formats the real
   `chrome://` URL, and `OpenTyped` at line 579 sends text directly to Chromium's
   classifier. It does not call the Rust `merlin://` translation used by
   `:open` and the start page's fallback path. Consequently the card lacks
   that internal alias handling. The existing `MerlinUrlsInBarAndPalette`
   regression tests `RunCommandLine("open merlin://version")` and the passive
   address display, not typing the alias into the card. Add explicit card
   coverage; the precise current search/external-handler outcome depends on
   Chromium classification and was not reproduced interactively here.

Then perform active-window keyboard/focus and Japanese/other IME acceptance;
VoiceOver on the address results, palette, outline, tabs and Settings; zoomed
iframe hints; narrow windows; fullscreen; groups and cross-window drag; clean
quit, force quit, recovery and multiple profiles/windows.

Investigate the intermittent initial WebUI-toolbar paint timeout observed in
the fresh suite. The passing isolated reruns narrow the evidence but do not
resolve the startup/test-readiness race or establish its root cause.

Real camera, microphone, display/tab sharing, permission bubbles, autofill,
certificate warnings and dangerous-download recovery still require actual
device/OS journeys. Current headless capture tests use Chromium's real capture
service with synthetic streams; permission-anchor tests use a synthetic
delegate because headless permission requests are intentionally denied.

Run the real extension matrix: a password manager, Dark Reader, uBlock Origin
Lite, Vimium coexistence and MV3 worker/command/permission flows. An unpacked
test content script and upstream interception tests do not replace those
user journeys.

## Work required to distribute the browser

### 4. Build and package the chosen GitHub release

The accepted scope is [GitHub Releases without Developer ID signing or Apple
notarization](RELEASE.md). Neither paid credentials nor notarization is a
dependency. Free ad-hoc signing may be used where required for execution.

Concrete unfinished implementation:

- There is no `~/chromium/src/out/Release` build. Validate the release GN
  configuration on the current pin and build the non-component app.
- The example at `build/args.release.gn:7` imports
  `//build/args.release.gn`, but `apply_overlay.sh` does not install this file
  into Chromium's `build/` directory, and that target path is absent locally.
  Supply a working copy/import procedure or release-build helper.
- `scripts/package_mac.sh:34` still requires Developer ID/notary credentials
  when enabled; its default is a print-only dry run. It does not implement the
  selected release path. Replace/adapt it to package an explicit fresh app,
  validate the bundle and produce a versioned archive/DMG and SHA-256 checksum.
- Decide the permanent bundle identity and preserve the profile location.
  A purchased domain is not technically required; the important property is
  deliberate identity stability across releases.
- Ship supported macOS/arm64 requirements, known limitations, installation
  instructions, notices, build identity and matching crash symbols.
- Test a browser-downloaded/quarantined artifact on another Mac: per-app
  Open Anyway approval, installation, helpers/renderers, permissions, relaunch,
  replacement update and profile/config/workspace retention.

### 5. Make security delivery operational

Manual GitHub updates are acceptable for a small invited beta under the
existing policy. Versioned artifacts, tester notifications, a responsible
maintainer and a dependable security-release turnaround are still necessary.
The documented targets are three days for ordinary Stable security releases
and 24 hours for fixes described as exploited in the wild. No in-repo CI or
release workflow currently automates this.

There is also a reproducible checker defect at `scripts/check_upstream.py:49`:
every pin that is not numerically behind the endpoint is labelled "current
Mac Stable." With pin 157.0.8103.26 and a mocked Stable result 156.0.8078.80,
the checker prints that claim and exits 0. Distinguish equal, behind and ahead,
and verify the channel/commit rather than inferring Stable membership from
version ordering.

The earlier external check returned Mac Stable 156.0.8078.80, leaving the
platform/channel claim uncertain at that time. The fresh follow-up query to
[Chromiumdash Mac Stable](https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=5)
now returns **157.0.8103.26** with the exact pinned commit. The current pin is
therefore independently confirmed by that endpoint; another Chromium rebase
is not an outstanding item as of this check. Recheck before distribution.
The checker's ahead-versus-equal defect remains reproducible with mocked input
and should still be corrected.

Verify effective Safe Browsing/threat protection in the distribution build.
Preserved warning UI does not prove API-dependent protection works. Publish
the measured limitation if those services are unavailable. Do not expose API
credentials in evidence or logs.

The blocker added hooks in content/Blink, workers and decoded caches; future
rebases must repeat their tests as well as the original UI regressions.

### 6. Finish notices, privacy review and current-status documentation

- The workspace declares BSD-3-Clause and headers refer to `LICENSE`, but no
  root project LICENSE exists. Supply the intended license text.
- Generate and inspect notices for the actual release, including Chromium,
  Rust dependencies, filter lists and executable resources. Source notices and
  a generator exist; no distributed artifact containing them was verified.
  Complete the independent privacy/license reviews retained in the beta plan.
- The privacy inventory now correctly describes private editor restrictions
  and viewport sampling, but still omits Settings' config-file writes from
  its files-written table. `merlin_settings_page.cc:1151` writes through
  `config_file::Write`. Decision 14 also retains the older claim that the
  browser only reads the configuration.
- Reconcile stale phase notes, 12/13/31 patch counts and GN "UNVERIFIED"
  comments. Preserve historical results as history, with one clear current
  checklist. Keep the accepted no-notarization release scope prominent.
- Commit the existing working-tree implementation and its untracked safety
  source files/patch before building from a clean checkout or publishing a
  release tag. A build from HEAD alone omits those working-tree additions.

## Features that can wait

These remain deferred or partial, but need not block this scoped beta:

- A permissioned scripting/plugin API (`:script` is the only registered
  built-in still explicitly implemented as a planned command).
- Site-specific keymaps beyond passthrough/unmap, persistent marks, richer
  omnibox special rows and keyword chips.
- Address inside the active tab (old redesign step 7b), horizontal tab
  scrolling, whole-group dragging, fullscreen drop targets and extra polish.
- Bundling browserctl or adding a binary updater. Dependable manual security
  delivery is required in the interim.
- Windows/Linux/Intel support, Google Sync, Widevine and proprietary codecs.
  Those are scope decisions, not missing prerequisites for the chosen arm64
  macOS release. Their limitations must remain clear.

Recommended execution order: fix the small address/tooling defects; make the
release build reproducible; profile and qualify the blocker on that build;
complete real-device/accessibility/extension acceptance; finish notices and
security delivery; package and test downloaded installation; then publish a
versioned GitHub beta. Default-enable protection only after its gates close.
