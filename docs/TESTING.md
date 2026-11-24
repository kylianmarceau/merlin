# Testing

How Merlin is tested, cheapest first. What each area supports, and which
suite covers it, is in [CAPABILITIES.md](CAPABILITIES.md).

## Test suites

| Command | Needs | What it proves |
|---|---|---|
| `scripts/check.sh` | Rust, Python, Node and pnpm, network | Everything below that needs no Chromium checkout: `cargo fmt`, Clippy with warnings as errors, the Rust core and bridge tests, the C++ router harness, `pnpm ui:check` and `ui:test`, the Python tool tests, page scripts parse, visual identity boundaries, bundled filter-list integrity, and that every patch applies to the pinned Chromium files. CI runs this same script on every push and pull request |
| `pnpm ui:check` | Node, pnpm | Shell ABI headers match the overlay copies; TypeScript compiles |
| `pnpm ui:test` | Node, pnpm | Shell state, protocol validation, design conventions (no colour, size or timing literals, no React Native shadows or `Modal`, imports only downwards) |
| `cargo test --workspace` | Rust, Xcode's clang | The Rust core (modes, keys, commands, config, palette, hints, workspaces, `browserctl` protocol), the cxx bridge, and the C++ router harness below |
| `python3 -m unittest discover -s scripts -p 'test_*.py'` | Python | Assembly refuses stale or colliding inputs, build stamps and dSYM matching, shipped notices, the shell vocabulary, the upstream checker |
| `scripts/fuzz.sh` | Rust | The core's parsers (JSON, `config.toml`, the `browserctl` protocol, key notation, `:open` targets) never panic on any input, and what they accept reads back the same. CI runs each target for 60 seconds a day; `cargo test` runs the same checks over seeds and mutations. See [fuzz/README.md](../fuzz/README.md) |
| `out/Release/modal_browser_unittests` | Chromium checkout | The parts of the overlay that need only `//base`: `config.toml` changes run read, change, write as one step on one sequence, so options set at once all land; a whole-file save from an older revision is refused; `SetOption` keeps the rest of the file |
| `scripts/run_browser_tests.sh` | Chromium build (`out/Modal`, `browser_tests`) | The ad blocker's browser tests inside Chromium; with a filter, upstream suites under Chromium's defaults |
| `scripts/run_e2e_tests.sh` | Assembled `Merlin.app` | About 160 tests through the real app: keys and modes, input methods and dead keys, hints, tabs and splits, config, `browserctl` and workspaces, private windows, session restore and crash recovery, the interface recovering from its own failures, the editor, downloads, prompts and page dialogs, the address field and site panel, ad blocking in each of its states, lean defaults, groups, Peek, WebKit tabs, picture in picture (opt-in) and identity. See [tests/e2e/README.md](../tests/e2e/README.md) |
| Release checklist | Assembled app, by hand | React surfaces the end-to-end tests can't see (`apps/browser/README.md`, "Release checklist") and the install test in [RELEASE.md](RELEASE.md) and [install-qualification.md](install-qualification.md) |

Not covered by any automated suite: the React surfaces themselves
(palette, hint labels, prompts, dialogs, Settings, Library), VoiceOver, and
loaded sessions with many tabs.

### Onboarding fixtures

On macOS, the import fixture runner builds synthetic profiles for Arc, Dia,
Chrome, Safari, Firefox, Zen, Brave, Edge and Helium in a temporary directory.

```sh
swiftc packages/engine/macos/SetupImport.swift tests/import/SetupImportFixtures.swift -o /tmp/merlin-import-fixtures
/tmp/merlin-import-fixtures
```

Run the native onboarding regressions against an assembled build with
`scripts/run_e2e_tests.sh test_welcome test_onboarding_behaviors`.
Use `scripts/preview_onboarding.sh /path/to/Merlin.app` to inspect a fresh
setup in its own profile. Check the sidebar and top-tab previews, keyboard
and VoiceOver focus after Continue and Back, and immediate changes with
Reduce Motion enabled. Narrow the window to check scrolling and the footer.

## Continuous integration

`.github/workflows/check.yml` runs `scripts/check.sh` on macOS for every
push and pull request, so a local pass and a CI pass mean the same thing.
`.github/workflows/daily.yml` compares `UPSTREAM_PIN` with Mac Stable and
opens an issue when a rebase is due, and runs each fuzz target for 60
seconds.
The Chromium build, browser tests and end-to-end tests stay manual: they
need a Chromium checkout and hours of build time.

## The C++ router harness

`tools/host_harness` compiles the real
`overlay/chrome/browser/ui/modal_browser/modal_input_router.cc` (the same
file GN builds) against the real cxx bridge, with `-Wall -Wextra -Werror`,
and drives it with `FakeBrowser`, an in-memory window with tabs, history and
scroll state. Its 30 scenarios cover:

1. `:` then `tabnew https://docs.rs` opens and focuses a new tab at that URL.
2. `o` pre-fills `open `; search terms open a search; `H`/`L` walk history.
3. `open docs.rs` becomes `https://docs.rs`.
4. Typos and `javascript:` URLs show errors and keep the command line open;
   Esc closes it.
5. Typing `jjkdgG:/ftu` in a text field reaches the page and changes
   nothing, including a rich-text field with a late focus notification.
6. Esc in a text field blurs it and returns to Normal; `j` then scrolls.
7. Bare Esc in Normal reaches the page.
8. `G`, `gg` with timer start and stop, `5j`, prefix timeout, `<C-d>`.
9. `J`/`K` with counts and wrap-around, `d`/`u`, `t`.
10. Cmd+T, Cmd+L, lone modifiers, dead keys and IME `Process` keys pass
    through, including mid-sequence.
11. Browser UI focus and IME composition are untouched.
12. Passthrough forwards Esc and letters; Shift+Esc exits.
13. Hint filter typing and Backspace; selecting a text field enters Insert.
14. `r`, `R`, `/`, `<C-l>`, `:help tabnew`, and an unknown command.
15. Tab completion and runtime key binding, including a rejected binding.
16. Hints: collect, label in page order, follow, `F` background tab, `yf`
    copy, `gi` with one field, Esc, stale answers after Esc ignored,
    navigation hides them.
17. Tab switcher: recent-first order, fuzzy filter, `:b 3`, `:b query`,
    `g0`/`g$`.
18. The command list runs a command; `:` Tab completion and Up history.
19. `yy`, `ym`, `P` with a clipboard answer, script URLs refused.
20. `gu`, `gU`, `n`/`N`.
21. Which-key entries after `g`, cleared by Esc.
22. Config: options, bindings, site passthrough, `:config-reload`, errors
    with line numbers, a missing file means defaults.
23. The config's vertical-tabs default, `gs` collapse, `:vertical-tabs`
    toggles, and a config default never overrides the user's own choice.
24. Splits: `<C-w>v`, `<C-w>w`, `<C-w>o`, `:split url` stacked, refusing a
    second split and script URLs; `gp` and `:pin off`.
25. Workspaces: save, open in another window that holds only a new tab
    (reused, pins and split pairs restored, active tab), missing names,
    delete, private windows refused.
26. Lists: the history palette loaded by the host, filtered, Enter opens; a
    bookmarklet is not opened; `:private`, `:downloads`, `gB`, `:devtools`.
27. Outline: `gO` requests the document, rows appear, search and Enter
    reveal the element; `]]`, `2[c`; `yM` copies escaped Markdown.
28. External editor and Visual mode: no editor configured, `$VISUAL` used,
    passwords refused even with `!`; `v` hints text blocks, motions with
    counts, `y` copies and clears.
29. `browserctl` requests parsed through the bridge, `open` through the
    session's URL rules, error and pong replies byte for byte, workspace
    name check, editor argv substitution.
30. Marks (`ma`, `'a`), a recorded macro replayed with `@b`, an alias from
    the config, and `workspace project` with `workspace_for_dir`.

## Browser tests (in Chromium)

```bash
autoninja -C ~/chromium/src/out/Modal chrome browser_tests
scripts/run_browser_tests.sh
scripts/run_browser_tests.sh 'BrowserViewTest.*:BrowserCommandsTest.*:BrowserCommandControllerBrowserTest.*'
scripts/run_browser_tests.sh 'FindInPageControllerTest.*'
```

The default suite is the ad blocker's (`MerlinAdblock*BrowserTest.*`).
`run_browser_tests.sh` runs headless and in the background: it passes
`--headless` and sets `MODAL_TESTS_IN_BACKGROUND=1`, so each test process is
a background app that never takes focus. Tests run serially with retries
off, and use a temporary `browserctl` socket, workspace directory and config
file, so a browser you are running is never touched. For upstream suites the
runner adds `--modal-browser-upstream-defaults`, which turns Merlin's
defaults back to Chromium's; the Find suite gets a 1280 by 900 window so the
find bar can move beside a match.

## End-to-end tests

`scripts/run_e2e_tests.sh` drives the assembled app over the DevTools
protocol and `browserctl`, with keys sent as native key events so they take
the real path. Each run names the app build it tested (the host and
framework UUIDs) and refuses an app older than its sources.
[tests/e2e/README.md](../tests/e2e/README.md)
describes the harness, the disposable profile and how to add a test.
