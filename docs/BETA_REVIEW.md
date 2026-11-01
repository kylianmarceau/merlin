# Beta readiness review — 2026-10-31

Follow-up, 2026-11-01: Chromium **157.0.8103.26** now builds, and the complete
Merlin browser suite passes **67/67**, including the editor and page-colour
regressions. The four upstream regression suites pass **136/136** with their
documented per-suite window settings. The overlay contains editor-generation/document guards,
sensitive-field revalidation, private-window export restrictions,
document-scoped colour caching and contrast fixes. See `TESTING.md` for the
build, upstream regression results and validation limits.

The review below records the October 31 source state. Remaining external-beta
work includes dependable site controls and recording indicators, permission/
accessibility/extension acceptance, a working signed and notarized release,
security delivery, and privacy/license review and notices. Updating Chromium
and passing the automated suites does not close those gates.

Reviewed revision: `c7d4d2d` (`tab page colour majority fix`).

Recommendation: hold external beta distribution until the security, editor,
browser-chrome and release gates below are closed. The core feature set is
substantial; adding more features is not the next priority.

This is a repository review, not a certification of Chromium or a completed
interactive acceptance test. It covers the Rust core/FFI/tooling, Chromium
integration, custom UI and WebUI, patches, build/release scripts, public docs
and local planning notes, with deeper tracing of security-sensitive paths and
the latest colour change. No application code was changed by this review.

## Evidence obtained

- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo test --workspace`: **231 passed**, including the portable C++ router
  harness. The first sandboxed run failed to bind a Unix socket; rerunning
  outside that restriction passed. This was not a product test failure.
- `scripts/check_page_scripts.py`: all **15 checks passed** using Node.
- All **12 patches applied** sequentially to files extracted from the local
  Chromium Git object database at the exact pinned commit. This establishes
  patch applicability, not C++ compilation or applicability to a newer tag.
- `scripts/verify_patches.sh` also passed all 12 patches against freshly
  downloaded source files at the pinned tag.
- A small Node reproduction using the actual field-inspection/write scripts
  confirmed that the write script accepts an old editor's text when called
  with the newly inspected password field's token. The C++ routing error
  described below supplies that token. This was a script-level reproduction,
  not an end-to-end browser reproduction.
- Calculated the actual contrast of `InkOn()`'s selected colours: on
  `#999999`, foreground `#ECE8DD` is approximately **2.33:1**.
- No fresh full Chromium build, browser-test run, VoiceOver pass, signing or
  notarization was performed. The local browser/framework timestamps were
  October 30, and `browser_tests` October 29; the reviewed commit is October
  31. The page-colour build log records an interrupted build. Historical
  passing browser suites do not validate the latest source.

## Required before external beta

### 1. Update Chromium and make security delivery operational

`UPSTREAM_PIN` is `156.0.8078.48`. The live
[Chromiumdash Mac Stable endpoint](https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=1)
returned **156.0.8078.80** during this review. The existing docs already
acknowledge a rebase overdue as of October 28.

Rebase, rebuild and retest against the current Stable before distribution.
Operationalize `scripts/check_upstream.py` and the turnaround targets in
`docs/UPSTREAM.md`. A small invited beta can use manual signed updates, but
needs a download location, versioned releases, a way to notify every tester,
and an owner for security fixes. An automatic updater can follow; an absent
security delivery process cannot.

Verify Safe Browsing functionality in the actual distribution build.
`notes/BETA.md` says API-dependent lookups lack configured keys; retaining
warning UI alone does not establish functioning threat protection. Document
the measured limitation prominently instead of implying Chrome-equivalent
protection. Do not publish credentials or put them in review logs.

### 2. Fix external-editor session isolation, or disable external editing

Sources: `modal_browser_controller.cc:2230` (`InspectField`), `:2292`
(`OnFieldValue`), `:2303` (`WriteBackField`), and
`page_scripts.cc` (`kFieldInfoTemplate`, `kFieldWriteTemplate`).

The controller has one mutable `edit_target_`. Every new inspection replaces
it before the new field is approved. The existing editor remains running,
and its save callback resolves the *current* target rather than the target
that editor was created for.

Concrete sequence: edit field A externally; focus field B and request an
edit; let B be rejected, for example because it is a password input; save
editor A. Its callback now uses B's frame/origin/token. The write script
checks that token and element connectivity, but does not reject password
fields. A's text can overwrite B and emit input/change events there. B may
also be on a different site because the target's stored origin was replaced.

Bind an immutable target and generation to each editing session and every
inspection/read/save/done callback. Reject stale results and revalidate the
field at read/write time. A denied replacement must not retarget an existing
session. Test overlap, refusal, navigation, tab closure and queued callbacks
from a replaced editor. Disabling the feature is a valid initial-beta option.

### 3. Restore dependable site controls and sensitive-state indicators

`ModalBrowserController::ApplyTabLayout` hides Chromium's location bar.
`MerlinAddressField::SiteInfoBounds` (`merlin_toolbar.cc:374`) exposes site
information only when the warning chip has text. Secure HTTPS pages have no
visible site-info control in the custom field. Add a consistently available,
keyboard-accessible control for permissions, cookies and certificate details.

`MerlinTab::AlertBounds` (`merlin_tab_bar.cc:424`) returns no alert whenever
the tab is pinned or too compact to show a title. This also hides recording/
capture alerts, not just audio decoration. Preserve sensitive-state indicators
in pinned, compact, collapsed-sidebar and hidden-tab layouts. Do not depend
on an OS indicator as the sole per-site browser control.

Because the stock location bar and parts of the toolbar are hidden, test
permission prompts and their fallback anchors on the final build: camera,
microphone, geolocation, notifications, screen sharing, blocked popups,
password/autofill UI, certificate errors and dangerous downloads. Missing
replacement controls are confirmed in source; whether every upstream prompt
still presents correctly is an acceptance-test gap, not a proven universal
failure. Also verify that private windows remain unmistakably identifiable.

### 4. Finish and exercise the release pipeline

`build/args.release.gn` explicitly says it has not been built. The branding
still uses `MAC_BUNDLE_ID=local.merlin.Merlin` and an empty team ID.

There is also a concrete script defect: `scripts/package_mac.sh:52` executes
`chrome/installer/mac/signing/driver.py` directly. In the pinned checkout this
is a non-executable Python module, with no shebang or top-level entry-point
call. Chromium documents using the generated Packaging `sign_chrome.py`
entry point, after building the installer target. Merely obtaining a
Developer ID will not make the current command work.

Choose the permanent application identity before tester profiles depend on
it; build the non-component app and packaging target; use the generated
signing entry point; require an explicit, fresh output artifact; notarize and
verify the result. Test installation from a downloaded/quarantined artifact
on another Mac, launch, renderer processes, permissions, relaunch, update
replacement and profile retention. Preserve matching symbols/build IDs for
diagnosing tester crashes.

### 5. Reconcile privacy promises and distribution notices

`docs/PRIVACY.md:27` promises nothing is written from private windows, but
external editing and `:extract ... editor` have no private-window gate and
create temporary files. Either enforce that promise or accurately describe
explicit exports and their retention. Navigation also does not immediately
destroy `field_editor_`; the documented cleanup behaviour needs correction
or implementation, including crash leftovers and detached editor launchers.

The inventory still describes a two-pixel top-edge colour sample, although
the implementation now reads the visible viewport. It also omits Settings'
config-file writes. Update these statements before distributing the browser.

The Cargo workspace declares BSD-3-Clause and source headers refer to a
LICENSE file, but no root LICENSE file is present. Add the intended project
license and produce/check the notices for the actual release. The credits
generator's existence is not evidence that notices were shipped. Obtain the
license/privacy review called for by the existing beta plan.

### 6. Validate the final browser rather than only the Rust core

Rebuild both `chrome` and `browser_tests` after the fixes and rebase. Run the
entire Merlin browser suite and upstream regression filters in
`docs/TESTING.md`. The upstream-defaults run intentionally bypasses Merlin
UI, so also exercise the safety/user journeys with Merlin's UI enabled.

Record build hash, args, OS and results for:

- New profile; clean quit, force quit and recovery; multiple windows/profiles;
  workspace save/restore and autosave; upgrade retaining user data.
- Real mouse/keyboard interaction with the address card, Cmd-L, Cmd-S,
  fullscreen, splits, tab groups, drag between windows and last-tab closure.
- Typing in ordinary and rich fields; Japanese/other IME; VoiceOver; keyboard
  navigation of suggestions, tabs and settings; zoom and iframe hints.
- Password manager extension autofill/popups/shortcuts, Dark Reader, an MV3
  blocker, and service-worker extension permissions/commands. The unpacked
  test extension does not validate the actual compatibility matrix.
- Downloads, uploads, PDFs and the intended site's media/calling workflows.
  Keep no-Widevine/no-proprietary-codec limitations visible to testers.

## Verdict on the latest tab/page-colour changes

The basic design is appropriate: compositor readback avoids trusting DOM
colour claims, the sample is small (at most 96 by 96), transparent pixels
are ignored, nearby colours are bucketed, and the chosen colour is applied
to the active tab, toolbar background and custom navigation/address controls.
No pixel data is persisted or sent by this sampler.

However, it is **not yet correct across navigation and colour ranges**:

1. **Old colour survives pages with no dominant colour.**
   `PrimaryPageChanged` only schedules a sample; it never clears `LastColor`.
   `OnSampled` returns immediately for `nullopt`, leaving the previous page's
   colour in place. A solid-colour page followed by a photo/gradient can keep
   the first site's colour indefinitely, contradicting the neutral-fallback
   comment. Reset per document and explicitly apply the neutral fallback.
2. **Readback results are not tied to a document generation.** A WebContents
   weak pointer protects against destruction but remains valid across
   navigation. A late old-page sample can overwrite the new page's cache.
   Additionally, switching tabs while `sampling_` is true can consume the
   new tab's timer without scheduling a replacement. Use generation checks
   and a pending-resample mechanism.
3. **It samples the viewport, not the whole document.** `GetViewBounds()`
   supplies the visible area. `Watch()` samples again on every tab switch,
   even with a cached colour, so scrolling and switching away/back can
   change the colour. Decide whether stability is per document or per view
   and implement that policy consistently. SPA/theme changes also need a
   deliberate refresh policy.
4. **Contrast selection is insufficient.** `modal_style.cc:92` chooses light
   text below luminance 0.4. On `#999999` this yields only 2.33:1 contrast;
   dimmed text is worse. Select text using measured contrast and ensure
   security-chip and remaining stock toolbar icons stay readable on arbitrary
   page colours. Respect high-contrast/forced-colour modes too.
5. **No dedicated colour tests exist in the browser test source.** Add tests
   for black/white/mid-tone samples, no-dominant fallback, rapid navigation,
   delayed callbacks, switching while sampling, cached tabs, theme changes
   and the chosen scrolling policy. Then check both tab layouts and hidden
   tabs on the compiled browser.

These are functional/readability corrections, not a reason for another
visual redesign. If they delay the beta, a neutral toolbar is a reasonable
temporary fallback.

## Work that can wait

More visual polish, tab animations, whole-group dragging, richer omnibox
special rows, site-specific keymaps beyond passthrough, persistent marks,
the planned `script` command, and a bundled browserctl installer need not
block a clearly scoped beta. Automatic updates can follow a small invited
beta only if manual security delivery is dependable. DRM/codecs are product
scope decisions; do not promise those sites work without validating them.

Some old checklist items are already obsolete: Merlin has a name and icons,
custom Settings/History/Bookmarks/Downloads pages, and iframe hint coverage.
Refresh `notes/BETA.md`, the contradictory old testing sections and
`docs/UPSTREAM.md` instead of treating every historical TODO as unfinished.

Suggested order: editor isolation and browser safety controls; Chromium
rebase; colour correctness/contrast; fresh build and acceptance tests;
release signing/distribution and truthful documentation; then aesthetic work.
