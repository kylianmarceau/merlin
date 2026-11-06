# Testing

## Results, 2026-11-04: one profile, no profile UI

Branch `feature/no-profiles`, Chromium **157.0.8103.26**, macOS arm64
`out/Modal` component development build (DCHECKs on). The change is
[decision 44](DECISIONS.md#44-one-profile-no-profile-ui) and patch 0051 in
[Upstream](UPSTREAM.md#single-profile-patch-2026-11-04).

| Check | Result |
| --- | --- |
| Native `chrome browser_tests` rebuild | Passed |
| Default browser suite | **148/148 passed** |
| New case | `OneProfileOnly`: no profile creation or guest mode, startup opens a window, picker entry points do nothing, profile commands disabled, `:profile` and `:palette profiles` rejected |
| Patch series | **51 patches** verified with `apply_patches.py --check` |
| Repository checks | Formatting, warnings-denied Clippy, **254 workspace tests**, page scripts, visual identity and blocker integrity passed; the networked upstream patch check could not reach the network |
| Running app | Menu bar has no Profiles menu; launch opens the restored window with no picker |

## Results, 2026-11-04: speed and memory defaults

Working tree on `main` after `f978977`, Chromium **157.0.8103.26**, macOS
arm64 `out/Modal` component development build (DCHECKs on). The changes are
described in [Architecture](ARCHITECTURE.md#speed-and-memory-defaults) and
patches 0047–0048 in [Upstream](UPSTREAM.md#speed-and-memory-patches-2026-11-04).

| Check | Result |
| --- | --- |
| Native `chrome browser_tests` rebuild | Passed |
| Default browser suite | **146/146 passed**, 1,154 seconds |
| New cases | `StartPagesShareOneProcess`, `NoHiddenTabSearchPage`, `MemorySaverOnByDefault`, `SuggestionsOpenFromTheAddressBar`, `AddressCardUsesThePageLoadedAhead` (a prerendered page is activated by Enter in the address card) and `StartPageEnterOpensTopMatch` passed |
| Patch series | **48 patches** verified with `apply_patches.py --check` |
| GN header checks | Passed for `//chrome/browser/ui/modal_browser/*`, `//chrome/browser/ui/webui/top_chrome/*` and `//chrome/browser:core` |
| Repository checks | Page scripts, visual identity boundaries and browser tool tests passed; Rust code unchanged |

Not measured yet: process count and memory with several start pages open,
startup footprint without the hidden Tab Search page, and typed-navigation
timing once the predictor has learned. Measure them on the fast
non-development build; this build overstates every cost.

## Results, 2026-11-04: native blocker performance pass

Branch `feature/adblock-performance`, Chromium **157.0.8103.26**, macOS arm64
`out/Modal` component development build (DCHECKs on). The changes and
measurements are in the
[implementation record](ADBLOCK_IMPLEMENTATION.md#performance-pass-2026-11-04).

| Check | Result |
| --- | --- |
| Native `chrome browser_tests` rebuild | Passed |
| Default browser suite | **140/140 passed**, 1,063 seconds, retries disabled: 77 modal, 47 blocker and 16 identity cases |
| New blocker case | `ServiceWorkerClaimAfterLoadStillFiltersSyntheticAds` passed |
| Repository checks | Passed: formatting, warnings-denied Clippy, **254 workspace tests**, page scripts, source/resource boundaries and **46 patches** |
| GN header checks | Passed for browser and renderer blocker targets, `content/renderer` and `content/public/renderer` |
| Realistic page-load benchmark | Clean +3.7 ms, ad-heavy +2.8 ms, service worker +11.5 ms median load-event cost (was +13.6 / +8.3 / +47.1) |
| Physical memory | One-tab blocker overhead +21.9 MiB (was +45.8); 10-tab idle CPU 0.17 s per 15 s (was 0.88) |

Reproduce the measurements with:

```bash
node scripts/benchmark_adblock_realistic.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --runs 8 --loads 3 --trace --output /tmp/adblock-realistic.json
python3 scripts/analyze_adblock_trace.py /tmp/adblock-realistic-*-on.trace.json
node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --physical-memory --output /tmp/adblock-physical.json
```

`--trace-categories "loading,toplevel,mojom"` records scheduler tasks too,
which is how the UI-thread relay cost was found. Rust code in this build has
debug assertions on, which makes engine matching about 17× slower than in a
release build, so these numbers overstate the blocker's cost.

## Results, 2026-11-03: address entry, accessibility and tooling

Working tree based on `98c63c9`, Chromium **157.0.8103.26**, macOS arm64
`out/Modal` development component build. This follows the repository review's
first group of implementation corrections.

| Check | Result |
| --- | --- |
| Native `chrome browser_tests` rebuild | Passed |
| UI GN dependency check | Passed |
| Repository checks | Passed: formatting, warnings-denied Clippy, **253 workspace tests**, page scripts, source/resource boundaries and **45 patches** |
| Offline upstream-checker and browser-runner regressions | **11/11 passed**, now included in `scripts/check.sh` |
| Targeted address/toolbar browser cases | **5/5 passed**, 41 seconds, retries disabled |
| Updated default browser suite | **137/137 passed**, 943 seconds, retries disabled: 77 modal, 44 blocker and 16 identity cases |
| Live upstream checker | Exact Mac Stable version and Chromium commit match; `status: "current"`, exit 0 |

The new browser cases are `MerlinAddressCardInternalAliases`,
`MerlinInternalAddressSuggestions` and
`MerlinAddressSuggestionsAccessibility`. The targeted run also includes
`MerlinUrlsInBarAndPalette` and `MerlinToolbarFollowsPage`.

Internal-page coverage types into the real address textfield and presses Enter
for version, Settings, nested Settings, start-page and uppercase/whitespace/
query/fragment aliases. It also reopens the card to check alias display and
retains ordinary HTTP navigation. Suggestions use Chromium's actual provider;
Merlin aliases resolve to internal URLs without appending a `chrome://`
completion suffix to the user's `merlin://` text.

Accessibility coverage uses deterministic suggestion data in the actual native
card. It checks exposed option names/roles/positions/selection, textfield/list
controls and active-descendant relations, arrow-key selection notifications,
updated results at the same index, keyboard focus retention, accessible focus
and activation actions, replacement/shrinking results and Escape cleanup.
An accessibility activation performs a real navigation. These automated checks
do not certify a human VoiceOver listening/traversal session; that remains in
the manual acceptance matrix.

`scripts/run_browser_tests.sh` now defaults to modal, native-blocker **and**
identity suites. Offline runner tests invoke the actual shell script with a
temporary fake executable, checking default/explicit filters, extra arguments,
background operation and upstream-specific geometry flags. Checker tests cover
equal/behind/ahead versions, commit mismatches, wrong channel/platform,
malformed responses, network failure and JSON status/exit behavior.

The complete default-suite run used
`scripts/run_browser_tests.sh '' --test-launcher-summary-output=/tmp/merlin-address-full.json`;
the empty optional filter selects the script's default suites. All 137 summary
statuses are `SUCCESS`.

Local logs and summaries are `/tmp/merlin-address-{build,gn,check,targeted,full}.*`.
The retained identity PNGs/manifest describe the earlier capture source;
they were not regenerated or relabeled as evidence for these source changes.

## Results, 2026-11-02: native ad blocking

Branch `feature/native-adblock`, Chromium **157.0.8103.26**, arm64 `out/Modal`
component development build on the same M2/16 GB host described below.
The blocker is independent of modal browsing and remains opt-in pending
performance and remaining manual qualification. Packaging/publication are
outside this task.

| Check | Result |
|---|---|
| Native blocker browser fixtures | **44 distinct cases passed**: complete 43-case checkpoint plus all 13 affected cosmetic/scriptlet/lifecycle cases, including the added batching fixture |
| Existing Merlin browser suite | **74/74 passed**, including snapshots, Settings and content fullscreen restoration |
| Loader regression units | **35/35 passed**, including deferred Service Worker response-body preservation |
| Upstream browser/view/commands and Find | **92/92 + 44/44 passed** |
| Feature-enabled worker/extension interceptor regression | **21/21 passed** |
| Workspace formatting, warnings-denied lint, Rust/bridge/host tests, page scripts | Passed; **252 tests** |
| Bundled sources and resources | Integrity/provenance verification passed; **19 engine fixtures** passed |
| Pinned patches and installer idempotence | **31/31 passed**, using local pinned Git objects |
| Browser, renderer and UI GN checks | Passed |
| Live signed-out YouTube | Protected normal/private playback, nine-minute playback, SPA, playlist/autoplay, Shorts transitions, cross-site embed and foreground captions/fullscreen/PiP passed; unprotected music control showed ads |

Run the independent fixtures explicitly with:

```bash
scripts/run_browser_tests.sh 'MerlinAdblock*BrowserTest.*'
scripts/run_browser_tests.sh 'ModalBrowserBrowserTest.*'
CHROMIUM_SRC="$HOME/chromium/src" scripts/check.sh
node scripts/benchmark_adblock.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --trace --output /tmp/adblock-benchmark.json
python3 scripts/analyze_adblock_trace.py /tmp/adblock-benchmark-*.trace.json
python3 scripts/measure_adblock_heap.py --output /tmp/adblock-heap.json
node scripts/probe_adblock_youtube.mjs --app "$HOME/chromium/src/out/Modal/Merlin.app" --mode on --headful --output /tmp/adblock-youtube.json
```

The browser runner's default includes Merlin, native blocker and identity suites;
upstream filters retain upstream UI defaults without disabling the blocker
when explicitly enabled. Tests use isolated configurations and profiles.
Live probes never use an everyday profile or account credentials. Retained
measurements, source audit limitations and the live playback comparison are
in [the implementation record](ADBLOCK_IMPLEMENTATION.md). A local fixture
pass does not establish ad eligibility or live YouTube parity.

## Results, 2026-11-01: safety controls and workspace context

Same Chromium **157.0.8103.26** pin and arm64 `out/Modal` configuration as the
rebase below; overlay changes based on `ea82179`, including patch 0013.

| Check | Result |
|---|---|
| `gn gen`, overlay `gn check`, incremental `chrome browser_tests` build | Passed |
| Rust formatting, Clippy with warnings denied, workspace tests | Passed; **232 tests**, including the portable C++ restore/save handoff |
| Page-script syntax and field-safety checks | Passed |
| Strict sequential patch application from the pinned commit's local Git objects | **13/13 passed** |
| Merlin browser tests | **73 distinct cases passed**: 72 in the full run, plus the snapshot case rerun after creating its output directory |
| Upstream `BrowserViewTest`, `BrowserCommandsTest`, `BrowserCommandControllerBrowserTest` | **92/92 passed**, default/restored window bounds |
| Upstream `FindInPageControllerTest.*` | **44/44 passed**, 1280x900 window; upstream total **136/136** |

The new cases cover HTTPS site controls activated by keyboard; the Page Info
and real permission-prompt view anchors in top/sidebar/hidden-tab layouts;
live changes from Chromium's capture-state service; pinned-tab alerts and
their accessible text; capture-stop callbacks for multiple/background tabs;
stale menu rejection after navigation; explicit Private labels; actual
high-contrast/forced-colour tint suppression; and `workspace here` skipping a
disabled front window. `WorkspaceSaveAndRestore` additionally saves the
restored new window and verifies that its project folder survives.

The first full run's snapshot case failed only because the requested output
directory did not exist. After creating it, the case passed and saved 14 PNGs;
representative light/dark captures were inspected. No product change was
needed for that rerun.

Permission requests are intentionally denied by Chromium's headless request
manager. The prompt-view regression uses Chromium's synthetic test delegate
and its real bubble factory; production permission checks remain intact.
Capture tests register synthetic streams with Chromium's real indicator and
stop callbacks, without using hardware or requesting OS authorization. Real
camera/microphone/display permission journeys, VoiceOver and active-window
keyboard/IME acceptance remain manual release checks.

## Results, 2026-11-01: Chromium 157 rebase

Chromium **157.0.8103.26**, commit
`4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`. The live Mac Stable checker
confirmed this pin on November 1. Overlay: the rebase changes accompanying
this record, based on `2618ce0` and including the editor/colour fixes.

Host: Apple M2, 16 GB, macOS 27.0.1. `out/Modal` is the arm64 development
configuration: release component build, DCHECKs enabled, symbol levels zero,
Merlin branding, proprietary codecs and Widevine disabled. Four compile jobs
avoided the heavy paging observed with eight jobs on large browser-test files.

| Check | Result |
|---|---|
| `gn gen out/Modal`, overlay `gn check` | Passed |
| `autoninja -C out/Modal -j 4 chrome browser_tests` | Passed; both final targets built |
| Rust formatting, Clippy with warnings denied, workspace tests | Passed; **231 tests** |
| Page-script parsing and executable field-safety checks | Passed |
| Strict sequential patch application to the pinned upstream | **12/12 passed** |
| `ModalBrowserBrowserTest.*` | **67/67 passed**, including snapshots |
| `BrowserViewTest`, `BrowserCommandsTest`, `BrowserCommandControllerBrowserTest` | **92/92 passed**, default/restored window bounds |
| `FindInPageControllerTest.*` | **44/44 passed**, 1280x900 window; upstream total **136/136** |
| Built app `--version` | `Merlin 157.0.8103.26` |
| Built app renderer smoke | Passed: JavaScript executed in an isolated headless profile |

The renderer smoke used temporary config, workspace, socket and profile paths,
and a mock keychain. It did not exercise the developer's everyday profile or
real keychain. The snapshots test produced 14 PNGs; representative light/dark
palette captures were inspected.

The editor refusal/recovery, normal editor write-back, page-colour navigation,
stale callback, neutral-cache and full grey-range contrast cases passed. The
first native run also exposed three stale expectations from the earlier
design. Tests now check the checked-in cream/rust fan logo and 112x32 wordmark,
the address card with selected text and Escape dismissal, and both editable
targets in the navigated iframe. Product behaviour was preserved.

The upstream find-bar overlap test failed in headless mode's default small
window and passed with `--window-size=1280,900`. The runner now supplies that
window for the Find suite, within its 1680x1050 screen. Applying the override
globally interferes with DevTools' default/restored-size assertions, so the
BrowserView and command suites keep their normal bounds. Assertions in the
upstream tests were unchanged. Run these groups separately and sequentially:

```bash
scripts/run_browser_tests.sh &&
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*' &&
scripts/run_browser_tests.sh 'FindInPageControllerTest.*'
```

This validates the component development build. It emitted Objective-C
duplicate-class warnings for ANGLE/Crashpad and headless display fallback logs.
A non-component GitHub release build and unnotarized installation, real keyboard/IME and
VoiceOver, permission/capture UI, the extension matrix, and upgrade/recovery
acceptance still need their release checks. See `BETA_REVIEW.md`.

Developer ID signing and notarization are intentionally out of scope under
[the release policy](RELEASE.md), not pending tests or release blockers.

## 2026-10-31 safety and colour regression additions

`RefusedEditStopsPreviousSession` checks that a denied replacement cannot keep
the previous editor writing into a new target, and preserves its recovery file.
`PageColourBucketsAndContrast` covers neutral samples and contrast across every
grey value. `PageColourNavigationAndCache` covers navigation, cached neutral
results and stale readbacks. `scripts/check_page_scripts.py` also executes
field-safety checks for stale tokens and metadata changing to password/payment/OTP/read-only
or disabled fields. These C++ cases are included in the fresh run above.

## Run everything available today

```bash
scripts/check.sh
```

That runs, in order:

| Command | What it proves |
|---|---|
| `cargo fmt --all -- --check` | formatting |
| `cargo clippy --workspace --all-targets -- -D warnings` | no lint warnings, including in tests |
| `cargo test --workspace` | Rust core, bridge mapping, and the C++ harness (below) |
| `scripts/check_page_scripts.py` | the JavaScript in `page_scripts.cc`, assembled as the C++ does, parses, can run twice in one scope, and rejects stale tokens and sensitive/non-editable field changes (needs Node; skipped without it) |
| `scripts/verify_patches.sh` | all patches apply to the pinned upstream files (needs network); `TAG=<version>` checks another tag |

Not part of `check.sh` (they answer different questions):

| Command | What it tells you |
|---|---|
| `scripts/check_upstream.py` | whether a newer Mac Stable (security fixes) is out; exit 1 when a rebase is due |
| `scripts/licenses.sh` | third-party credits for the built browser |
| `scripts/package_mac.sh` | historical signing/notarization prototype; dry run only, not the chosen GitHub packaging path (see [Release](RELEASE.md)) |

## Results, 2026-10-28

Host: Apple M2, 16 GB, macOS 27.0.1, rustc 1.99.1. All passing.

| Suite | File | Tests |
|---|---|---|
| Core: session state machine | `core/tests/session.rs` | 56 |
| Core: Phase 3/4 session flows (splits, workspaces, lists, outline, extract, edit, Visual) | `core/tests/phase3.rs` | 17 |
| Core: page structure, outline, Markdown | `core/tests/document.rs` | 8 |
| Core: workspace files | `core/tests/workspace.rs` | 5 |
| Core: JSON | `core/tests/json.rs` | 5 |
| Core: browserctl protocol | `core/tests/ipc.rs` | 4 |
| Core: external-edit policy and command | `core/tests/editor.rs` | 4 |
| Core: aliases, edit key, marks, macros, projects | `core/tests/extras.rs` | 7 |
| Core: palette (command line, tabs, commands) | `core/tests/palette.rs` | 20 |
| Core: commands, parser, completion, help | `core/tests/commands.rs` | 19 |
| Core: config, TOML subset, site rules | `core/tests/config.rs` | 13 |
| Core: key notation and DOM keys | `core/tests/keys.rs` | 11 |
| Core: hint labels and filtering | `core/tests/hints.rs` | 9 |
| Core: fuzzy ranking | `core/tests/fuzzy.rs` | 8 |
| Core: keymap lookup and config errors | `core/tests/keymap.rs` | 8 |
| Core: URL vs search classification | `core/tests/target.rs` | 7 |
| Bridge: mapping, UTF-16 marks, bad enum values | `ffi/tests/bridge.rs` | 16 |
| C++ host harness (30 scenarios, one Rust test) | `tools/host_harness/cpp/scenarios.cc` | 1 |
| browserctl CLI: arguments, a fake browser over a real socket | `tools/browserctl/src/main.rs` | 3 |
| **Total** | | **221** |

Check a config file without the browser:

```bash
cargo run -p modal_browser_core --example check_config -- ~/.config/modal_browser/config.toml
```

### What the C++ harness covers

`tools/host_harness` compiles the real
`overlay/chrome/browser/ui/modal_browser/modal_input_router.cc` (the same
file GN builds) against the real cxx bridge, with `-Wall -Wextra -Werror`, and
drives it with `FakeBrowser`, an in-memory window with tabs, history and
scroll state. Scenarios:

1. `:` then `tabnew https://docs.rs` opens and focuses a new tab at that URL.
2. `o` pre-fills `open `; search terms open a search; `H`/`L` walk history.
3. `open docs.rs` becomes `https://docs.rs`.
4. Typos and `javascript:` URLs show errors and keep the command line open;
   Esc closes it.
5. Typing `jjkdgG:/ftu` in a text field reaches the page, changes nothing.
   A rich-text field with a late focus notification is safe too.
6. Esc in a text field blurs it and returns to Normal; `j` then scrolls.
7. Bare Esc in Normal reaches the page.
8. `G`, `gg` with timer start/stop, `5j`, prefix timeout, `<C-d>`.
9. `J`/`K` with counts and wrap-around, `d`/`u`, `t`.
10. Cmd+T, Cmd+L, lone modifiers, dead keys and IME `Process` keys pass
    through, including mid-sequence.
11. Browser UI focus and IME composition are untouched.
12. Passthrough forwards Esc and letters; Shift+Esc exits.
13. Hint filter typing and Backspace; selecting a text field enters Insert.
14. `r`, `R`, `/`, `<C-l>`, `:help tabnew`, `:vsplit` reports "planned".
15. Tab completion and runtime key binding, including a rejected binding.
16. Hints: collect, label in page order, follow, `F` background tab, `yf`
    copy, `gi` with one field, Esc, stale answers after Esc ignored,
    navigation hides them.
17. Tab switcher: recent-first order, fuzzy filter, `:b 3`, `:b query`,
    `g0`/`g$`.
18. Command list runs a command; `:` Tab completion and Up history.
19. `yy`, `ym`, `P` with a clipboard answer, script URLs refused.
20. `gu`, `gU`, `n`/`N`.
21. Which-key entries after `g`, cleared by Esc.
22. Config: options, bindings, site passthrough, `:config-reload`, errors
    with line numbers, missing file means defaults.
23. Shell: the config's vertical-tabs default, `gs` collapse, `:vertical-tabs`
    toggles, and a config default never overrides the user's own choice.
24. Splits: `<C-w>v`, `<C-w>w`, `<C-w>o`, `:split url` stacked, refusing a
    second split and script URLs; `gp` and `:pin off`.
25. Workspaces: save (snapshot answered by the host, file written), open in
    another window that holds only a new tab (reused, pins and split pairs
    restored, active tab), missing names, delete, private windows refused.
26. Lists: history palette loaded by the host, filtered, Enter opens; a
    bookmarklet is not opened; `:profile`, `:private`, `:downloads`, `gB`,
    `:devtools`.
27. Outline: `gO` requests the document, rows appear, search + Enter
    reveals the element; `]]`, `2[c`; `yM` copies escaped Markdown.
28. External editor and Visual mode: no editor configured, `$VISUAL`
    used, password refused even with `!`; `v` hints text blocks, motions
    with counts, `y` copies and clears.
29. browserctl requests parsed through the bridge, `open` through the
    session's URL rules, error and pong replies byte for byte, workspace
    name check, editor argv substitution.
30. Marks (`ma`, `'a`), a recorded macro replayed with `@b`, an alias from
    the config, and `workspace project` + `workspace_for_dir`.

## Browser tests (in Chromium), 2026-10-28

```bash
autoninja -C ~/chromium/src/out/Modal chrome browser_tests
scripts/run_browser_tests.sh                 # our 45 tests
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*' &&
scripts/run_browser_tests.sh 'FindInPageControllerTest.*'
```

`run_browser_tests.sh` runs headless and in the background: it passes
`--headless` (Chromium uses a headless screen, so windows are never shown)
and sets `MODAL_TESTS_IN_BACKGROUND=1`, so each test process becomes a
background app that can never be frontmost
(`background_test_process_mac.mm`, test-only, linked into browser_tests,
browser process only). Serial, retries off. Tests use a temporary
browserctl socket (`--modal-browser-socket`), workspace directory and
config file, so a browser you are running is never touched.

**Our suite: 51/51 pass headless** on the final build (424 s, one run).
The run before it found two problems, both fixed: the extension test
deleted its temporary folder outside the scope that allows blocking
(test-only), and page scripts did not see into web components (found by
hand on MDN, below).

Tests added after Phase 4: `HintsReachIntoIframes` (labels in a
same-origin and a cross-site iframe, following each), `MarksReturnToAPosition`,
`EditKeyInsideAField`, `BrowserctlWorkspaceHere`,
`ExtensionContentScriptCoexists` (an MV3 content script sees the keys left
to the page and not ours; all of them in Passthrough),
`NewProfilesReopenTheirSession`, and lazy restore inside
`WorkspaceSaveAndRestore`.

**Upstream regression: 136/136 pass headless** (1409 s, with
`--modal-browser-upstream-defaults`), including
`FindInPageControllerTest.FindMovesWhenObscuring`, which failed headless in
Phase 2.

## Gate checks on the real build, 2026-10-28

Run on the maintainer's own browser profile, driving it with `browserctl`
(the same command path as the `:` line) and checking the screen.

| Gate | Check | Result |
|---|---|---|
| 3: side by side | `browserctl open https://docs.rs`, `command 'vsplit https://www.rust-lang.org'` | Pass: two pages, "Left view"/"Right view"; `split-focus` and `split-swap` work |
| 3: save/relaunch/restore | `workspace save gate`, quit, relaunch, `workspace open gate` | Pass: 4 tabs in a new window, pin and split kept, Docs.rs active |
| 3: terminal | `open`, `tabs`, `tabs --json`, `focus --tab 3`, `current --json`, `ping` | Pass |
| 3: Neovim | `editor` = Ghostty + nvim; `hint input`, `edit` | Pass: Neovim opened the field's text in a private 0700 folder; `:w` updated the field ("Updated the field from your editor"); `edit!` on a password field refused |
| 3: session restore | quit and relaunch | **Failed, fixed**: only pinned tabs came back. The restore default was set after Chromium had decided what to open; a profile that never chose now gets "continue where you left off" written once. Pass after the fix |
| 3: editor cleanup | `:q` in Neovim | **Found**: Ghostty on macOS keeps running after its window closes, so the edit stayed open and the temporary file stayed until the next edit. With `--quit-after-last-window-closed=true` it exits and the file is removed within 2 s; the docs now recommend that |
| 4: outline | MDN `Array`, `outline` | Pass: 48 entries with H1/H2/H3 depths and a table |
| 4: export | `extract markdown` on MDN | **Failed, fixed**: 2 of 49 code blocks; MDN puts its JavaScript examples in web components. Scripts now walk open shadow roots and slots; 49/49 blocks with `js` language after the fix |

Not checked by hand: typing in the palette, `v` and `yc` with labels, and a
real GitHub comment box (the steps need typing into the browser, which the
checks above could not do; the browser tests cover them).

Historical Phase 2 upstream regression: 135/136 headless (`BrowserViewTest`,
`BrowserCommandsTest`, `BrowserCommandControllerBrowserTest`,
`FindInPageControllerTest`); `FindInPageControllerTest.FindMovesWhenObscuring`
failed with the old headless window setup. The November 1 results above
validate it with a sufficiently wide Find-suite window.

Tests install `ui::TestClipboard`, so they never read or change your
clipboard, and point the config path at a temporary directory, so your own
`config.toml` never affects them.

### Round 2, step 1 (2026-10-29)

Targeted run on the `out/Modal` build with patches 0001-0009, headless:

| Test | Result |
|---|---|
| `MerlinMarksReplaceChromiumLogo` (product logo pixels, version page wordmark and credit lines) | pass |
| `MerlinUrlsInBarAndPalette` (display mapping, typed merlin:// opens chrome://, bar and tab list) | pass after a fix (a lone trailing `/` was shown) |
| `NewTabsOpenMerlinStartPage` (written in round 1, first run) | pass after a fix: Chromium keeps chrome://newtab as the address after the override, so the test checks the loaded WebUI, not the URL |
| `PageCardBarAndTabLayout` (written in round 1, first run) | pass |
| `Snapshots` | pass |

Rust: 223 tests, including `merlin_pages_open_their_chrome_urls`.

Screenshots (throwaway profile, test config, `browserctl` over a relative
socket, `screencapture -l`): start page, version, Settings and About,
profile picker, tab switcher, tabs on top, in light and dark. The full
browser_tests suite and the upstream regression suites were not run.

### Round 2, steps 2 to 8 (2026-10-29)

Targeted run, patches 0001-0010, headless (`scripts/run_browser_tests.sh`):

| Test | Result |
|---|---|
| `MerlinSettingsReplacesSettings` (chrome://settings, /help and /syncSetup load Merlin Settings; no Google, Chrome or AI in its sections; /content stays Chromium's with its menu hidden) | pass after a fix: /help now opens the About section |
| `MerlinSettingsChangesPreferences` (theme, download prompt, startup; out-of-range values ignored) | pass |
| `MerlinHistoryPage` | pass |
| `MerlinDownloadsPage` (empty state, `?classic`, bubble default off) | pass |
| `MerlinBookmarksPage` (folder view, rename through the model) | pass |
| `MerlinMenuReplacesChromiumMenu` (⋮ and account hidden, menu palette, `:browser zoom-in`, AI Mode default) | pass |
| `MerlinToolbarFollowsPage` (Chromium's field, back, forward, reload and tab search hidden; Merlin's field hidden on the start page and showing host and path on a site; a new tab opens no command line; clicking the field opens `:open <address>`; its "Not secure" tag opens page info; back returns to the start page), replacing `TabsOnTopHaveNoAddressField`. Also rerun: `PageCardBarAndTabLayout`, `MerlinUrlsInBarAndPalette`, and `MerlinMenuReplacesChromiumMenu` (now checks ⋮ stays drawn at 1 px, the fix for the startup crash after a force quit) | pass |
| `ErrorPagesAreRestyled` | pass |
| `MerlinMarksReplaceChromiumLogo`, `MerlinUrlsInBarAndPalette`, `NewTabsOpenMerlinStartPage`, `Snapshots` | pass |

The first run checked the committed URL's host; Chromium keeps the typed
chrome:// address after the rewrite, so the tests check the loaded WebUI.
Rust: 227 tests (menu, downloads palette, `:browser`, `key_bindings`).
`scripts/verify_patches.sh`: all ten patches apply to 156.0.8078.48.
Screenshots in light and dark: Settings, Keys, About, site permissions,
History, Bookmarks, Downloads, the Merlin menu, a network error, a
certificate warning (expired.badssl.com), tabs on top and the address
palette. The full browser_tests suite and the upstream regression suites
were not run.

### Snapshots

`ModalBrowserBrowserTest.Snapshots` paints every surface to PNG when
`MODAL_SNAPSHOT_DIR` is set (it is skipped otherwise):

```bash
MODAL_SNAPSHOT_DIR=/tmp/modal-snapshots scripts/run_browser_tests.sh 'ModalBrowserBrowserTest.Snapshots'
```

It writes `hints.png` (labels over the page), `palette_tabs*.png`,
`palette_commands*.png`, `palette_cmdline.png`, `palette_error.png`,
`status_which_key.png` and `status_insert.png`, then `dark_*.png` for the
same surfaces with Chrome's appearance set to dark.

Baseline measurement: `scripts/baseline.py out/Modal/Merlin.app`.
Interleave stock and fork runs.

## Manual exploration

```bash
cargo run -p modalctl
```

Type `keys gg`, `keys! jk<Esc>` (text field focused), `:tabnew docs.rs`,
`focus editable`, `complete tab`, `keys f` then `hints 20` then `keys a`,
`keys ?` then `palette reopen`, `page mail.google.com`, `config file.toml`.

## Not run yet

| Check | Command (in `src/`) |
|---|---|
| Rust tests inside Chromium | port `tests/*.rs` to `#[gtest]`, then `autoninja -C out/Modal components_unittests` |
| Real OS key events and palette focus in an active window | `interactive_ui_tests` case (to be written) |
| Hints at page zoom other than 100% | browser tests to be written; same-origin and cross-site iframe hints are covered by `HintsReachIntoIframes` |

### Browser smoke test plan (by hand)

`out/Modal/Merlin.app/Contents/MacOS/Merlin --user-data-dir=/tmp/modal-profile`

Phase 1 rows were checked by hand after the Phase 1 build. Phase 2 rows are
the Phase 2 gate: browse GitHub, docs.rs and MDN largely without a mouse.

| # | Steps | Expected |
|---|---|---|
| 1 | Open example.com | Page renders; no mode pill in Normal |
| 2 | `:` | Palette near the top with `:` prompt and a focused field; command list under it |
| 3 | `tabnew https://docs.rs`, Enter | New foreground tab loads docs.rs; palette hides; focus returns to the page |
| 4 | `:tabnw x`, Enter | Red error under the field, palette stays; Esc closes it |
| 5 | Click a search box on docs.rs, type `jjk:` | Text appears in the box; pill says INSERT |
| 6 | Esc | Field blurs; pill gone; `j` scrolls |
| 7 | Type in the omnibox (Cmd+L) | Normal typing; nothing intercepted |
| 8 | Japanese IME in a text field and in the palette | Composition works; candidates not stolen |
| 9 | Cmd+T, Cmd+W, Cmd+F | Native behaviour unchanged |
| 10 | `<C-v>` on a site, press Esc | Site gets Esc; Shift+Esc returns to Normal |
| 11 | Google Docs, GitHub comment box | Typing unaffected |
| 12 | VoiceOver on the palette | Field announced ("Command line", "Search tabs"); rows read as list options |
| 13 | docs.rs crate page: `f`, type a label | Yellow labels on visible links only; the link opens |
| 14 | GitHub repo page: `F` on a file link | Opens in a background tab; you stay put |
| 15 | MDN article: `gi` | Search field focused, pill says INSERT |
| 16 | MDN sidebar or docs.rs source view: `j`, `G`, `gg` | The panel under the pointer area scrolls, smoothly for jumps |
| 17 | Open 5 tabs, `b`, type part of a title, Enter | Fuzzy list with favicons; switches tab; `b` Enter goes back |
| 18 | `?`, type "copy" | Copy actions listed with their keys; Enter runs one |
| 19 | `g`, wait | Panel lists `gg`, `gt`, `gu`, ... above the pill |
| 20 | `yy` then `P` | "Copied URL" message; the URL opens in a new tab |
| 21 | Add `passthrough_sites = ["mail.google.com"]`, `:config-reload`, open Gmail | Pill says PASSTHROUGH; Gmail's own keys work |
| 22 | Dark mode (System Settings) | Palette, pill and panel switch to the dark palette |

Phase 3 gate: two pages side by side, save/relaunch/restore a workspace,
open a URL from a terminal, edit a GitHub comment in Neovim.

| # | Steps | Expected |
|---|---|---|
| 23 | On docs.rs, `:vsplit github.com` | Two pages side by side; `<C-w>w` moves focus; `<C-w>x` swaps; `<C-w>o` ends the split |
| 24 | Open 3 tabs, `gp` on one, `:workspace save research`, quit, relaunch | Last session reopens (restore_session); `:workspace open research` (or `gw`) restores the tabs, pin and split |
| 25 | From Ghostty: `cargo run -p browserctl -- open https://docs.rs`, then `tabs`, `focus --tab 1`, `current --json` | Tab opens in the front window; list, focus and JSON work; with a private window in front, it is skipped |
| 26 | `editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]`, `:config-reload`; on a GitHub issue click the comment box, `:edit` (or `ge` from Normal) | Neovim opens with the text; `:w` updates the box live; GitHub's preview shows the text; `:q` ends the session |
| 27 | `:edit!` in a password field | Refused: "Password fields never leave the browser" |
| 28 | `gh`, `gb`, `gB`, `:downloads`, `:profile` | History and bookmarks searchable and open on Enter; bookmark bubble; downloads page; profile list |

Phase 4 gate: a large docs.rs or MDN page navigable like a document.

| # | Steps | Expected |
|---|---|---|
| 29 | MDN `Array` page: `gO`, type "flat", Enter | Outline with indented sections; jumps to `flat()`; ← folds a section, → unfolds |
| 30 | VoiceOver on the outline | Rows read as list options, "collapsed" on folded ones |
| 31 | docs.rs item page: `]]` / `[[`, `]c` | Moves heading to heading, to the next example |
| 32 | `yc` on an example; `v`, pick a paragraph, `3j`, `y` | Code copied exactly; selection grows by lines and is copied |
| 33 | `yM`, paste into a Markdown editor | Title, headings, code fences with language, tables, links |
| 34 | `:extract links editor` | A read-only Markdown list of links opens in the editor |
| 35 | `gl`, type part of a link text, Enter | Navigates there |

Tab bar and page color (decision 38):

| # | Steps | Expected |
|---|---|---|
| 36 | Tabs on top, open docs.rs, then netflix.com | The active tab, toolbar and page are one surface: white on docs.rs, black on Netflix; no line or gap where the toolbar meets the page; text and icons stay readable on both |
| 37 | Hover, click, middle-click, drag a tab; right-click one | Soft fill on hover, × appears; click selects; middle-click and × close; drag reorders; Chromium's tab menu opens |
| 38 | Drag empty tab-row space; double-click it | The window moves; it zooms |
| 39 | `:vertical-tabs on` with 30 tabs | Rows with full titles; the active row is a card in the page's color; the wheel scrolls rows a whole row at a time; "New tab" stays at the bottom; switching to a tab out of view scrolls it in |
| 40 | `gp` on two tabs, in both layouts | Pinned tabs become icon tiles in one capsule (in the sidebar, as many to a row as fit) |
| 41 | Light and dark mode, both layouts | One even chrome color around the page; nothing of Chromium's strip shows |
| 42 | Right-click a tab, "Add tab to new group", name it; add another tab | Chromium's editor opens; a chip in the group's color before its tabs, a line under them (a header row and a side line in the sidebar) |
| 43 | Click the group's header; click it again | The group folds (the chip shows its tab count; the active tab moves out); it opens again |
| 44 | Right-click the group's header | Chromium's group editor: rename, color, ungroup, close, move to new window |
| 45 | Drag a tab down into the page and let go | It fades once clear of the bar; a new window opens with that tab under the mouse |
| 46 | Drag a tab onto another window's tabs | It moves there, at the drop place, and is selected |
| 47 | Sidebar: drag its right edge | Resize cursor; it resizes, snaps near the default width, folds to icons when dragged narrow; the width is kept after relaunch |
| 48 | Click the address on a site | A card opens over it with the address selected where it was; no outline box, no dropdown yet |
| 49 | Type "youtu" | Completes to "youtube.com" (selected); rows with search glyphs, favicons, quiet addresses; the first row highlighted |
| 50 | ↓ twice, Enter; then ⌘L, type a search, ⌘Enter | The third row opens here; the search opens in a new tab |
| 51 | Type the title of an open tab, click its "Switch to tab" row | Switches to that tab |
| 52 | Click the address, then click the page; ⌘L then Esc | The card closes and the address shows again each time |
| 53 | Any page in Normal mode | No bar under the page; the page has the same margin on its sides and bottom, rounded bottom corners; nothing over the page |
| 54 | Click a text field; type `g` in Normal mode; `:help open` | A pill in the page's bottom-left corner: INSERT; NORMAL g with the which-key panel; the help panel above the pill. Each goes away when done |
| 55 | Start a large download | The pill shows "↓ 1 · n%" until it finishes |
| 56 | Press Cmd-S on a page, then again | Tabs go (row or sidebar); the toolbar sits beside the traffic lights, the page fills the window under it, the row is the page's color with no line between them. Cmd-S brings the tabs back as they were |
| 57 | Tabs hidden: drag the empty toolbar space or the space under the traffic lights | The window moves |
| 58 | Cmd-S in Google Docs or in the Settings config editor | The page saves; the tabs stay. Shift-Cmd-S opens Save Page As |
| 59 | Settings > Appearance > Hide tabs on; open a new window | Every window hides its tabs; the new one starts hidden. Off brings them back |
| 60 | Open HTTPS; right-click the address, then type `:site`, in both layouts and with tabs hidden | Page Info opens under the address and shows permissions/cookies/certificate details; no sliders or ♫ button in the toolbar, even while a video plays |
| 61 | Start microphone/camera capture in two tabs, then pin, compact, group-collapse and hide tabs | Sensitive tab badges remain where tabs are visible; Recording/Sharing stays in the toolbar, identifies capturing origins, and stops only the selected tab's user capture |
| 62 | Start screen/window/tab sharing, navigate or move/close a capturing tab with the capture menu open | The indicator follows Chromium's capture state; stale menu entries cannot operate on replacement documents or tabs moved to another window; the current stream can be stopped |
| 63 | Open a private window, switch tab layouts and hide tabs; enable high contrast/forced colours | Private stays explicit; page tint does not override the accessibility theme |
| 64 | Save a project workspace, restore into a new window, change its tabs and wait for autosave, then run `browserctl workspace here` | The saved project association survives and the folder still matches; a front window with browserctl disabled is skipped |

Record results with build args, commit and date in this file.
