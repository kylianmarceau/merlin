# Testing

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
| `scripts/check_page_scripts.py` | the JavaScript in `page_scripts.cc`, assembled as the C++ does, parses and can run twice in one scope (needs Node; skipped without it) |
| `scripts/verify_patches.sh` | all patches apply to the pinned upstream files (needs network); `TAG=<version>` checks another tag |

Not part of `check.sh` (they answer different questions):

| Command | What it tells you |
|---|---|
| `scripts/check_upstream.py` | whether a newer Mac Stable (security fixes) is out; exit 1 when a rebase is due |
| `scripts/licenses.sh` | third-party credits for the built browser |
| `scripts/package_mac.sh` | the signing and notarization steps (dry run unless `MODAL_SIGN=1`) |

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
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*:FindInPageControllerTest.*'
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

Phase 2 upstream regression: 135/136 headless (`BrowserViewTest`,
`BrowserCommandsTest`, `BrowserCommandControllerBrowserTest`,
`FindInPageControllerTest`); `FindInPageControllerTest.FindMovesWhenObscuring`
fails only headless (it checks the find bar's window position, which
headless fakes).

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
| Hints in iframes, at page zoom other than 100% | browser tests to be written |

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

Record results with build args, commit and date in this file.
