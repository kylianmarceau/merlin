# End-to-end tests

These tests drive a real, assembled `Merlin.app`: Chromium, the React Native
shell and Merlin's modal layer together, as people run it. They replace the
in-Chromium `ModalBrowserBrowserTest` and `MerlinIdentityBrowserTest` suites
that were deleted with the Views interface in `5729e15`, and they need no
Chromium checkout or `browser_tests` build.

```bash
scripts/run_e2e_tests.sh                    # everything, about 45 seconds
scripts/run_e2e_tests.sh test_hints         # one module
MERLIN_APP=/path/to/Merlin.app scripts/run_e2e_tests.sh
MERLIN_E2E_PIP=1 scripts/run_e2e_tests.sh test_auto_pip   # shows a floating window
MERLIN_E2E_DESKTOP=1 scripts/run_e2e_tests.sh test_downloads  # opens a file and Finder
scripts/run_e2e_tests.sh --allow-other-build                # test a build of other sources
```

The app defaults to `apps/browser/build/assembled/Merlin.app`, then
`/Applications/Merlin.app`. Requirements: the system `python3` (3.9 or later,
no packages) and Xcode's command line tools.

## Which build was tested

Every run starts by naming the app it tests: its path, the Mach-O UUIDs of the
host executable and `Merlin Framework`, the commit it was assembled from and
the checkout's commit. Quote that header when reporting a result.

`scripts/assemble_react_app.py` records `sourceCommit` and `sourceChanges` (a
digest of uncommitted changes to the product sources: `overlay`, `patches`,
`apps/browser`, `packages`, `tools` and the lockfiles) in the app's
`Contents/Resources/merlin-shell-build.json`. The runner refuses an app whose
product sources differ from the checkout's (an app from a commit that changed
only tests, docs or scripts still matches), and one assembled before the
record existed, such as an installed release, so a pass always describes the
code in front of you. Changing or committing tests, docs or scripts needs no
new build. To test another
build on purpose, such as an installed release, pass `--allow-other-build` (or
set `MERLIN_E2E_ALLOW_OTHER_BUILD=1` when running `unittest` directly); the
header then says why it differs. `python3 tests/e2e/merlin_e2e.py
--check-build` prints the header and checks without running anything.

The record says which sources the products were assembled with. That the
products themselves were built from those sources is the assembler's check
of each product's build stamp. An app assembled with `--allow-stale` says so
in its record, and the runner refuses it like an app from another commit.

## How it works

Each test class starts one Merlin and each test starts from one tab on a
fixture page (`MerlinTestCase.reset`).

- **Isolation.** A throwaway `--user-data-dir`, `XDG_CONFIG_HOME` (so
  `config.toml`), `XDG_DATA_HOME` (so workspaces), download folder (seeded
  into the profile's preferences, so nothing lands in `~/Downloads`),
  browserctl socket and DevTools port; `--use-mock-keychain`. WebKit pages
  get a folder of the run's own (`MERLIN_WEBKIT_TEST_FOLDER`): a data store
  made for the run (`WKWebsiteDataStore(forIdentifier:)`, removed when the
  instance closes) and an icon cache, so tests never read or clear your
  WebKit sign-ins. Your own Merlin keeps running and its
  profile, config, sign-ins and clipboard are not touched. No test reads or
  writes the clipboard. Shell preferences live in the app's macOS defaults,
  which tests only read. A process-only defaults argument disables the new-tab
  pop-up, so tab tests do not depend on your saved choice; the shell's unit
  tests cover the pop-up.
- **Never in front.** The app is launched with `open -g -j -n` and
  `background_app.m`, injected with `DYLD_INSERT_LIBRARIES`, makes the
  browser process a background app whose activation is prohibited, as the
  old browser-test shim did. Its window never takes the keyboard from you.
  This needs a build without the hardened runtime, which Merlin's ad-hoc
  signed releases are.
- **Real keys.** Keys go through DevTools' `Input.dispatchKeyEvent` with a
  native key code, so Chromium builds an NSEvent and the key takes the real
  path: `Browser::PreHandleKeyboardEvent` → `ReactBrowserWindow` →
  `ModalBrowserController`. A key without a native code would be marked
  `skip_if_unhandled` and never reach Merlin.
- **Observations** come from the page (DevTools `Runtime.evaluate`: scroll
  position, focus, a log of the keys the page received, visibility), from
  browserctl (tabs, pins, windows) and from the local server (which requests
  arrived). Every `*.test` host resolves to the local server.
- **The shell's own API.** browserctl's other requests take the modal
  command path. The shell's buttons and panels call the bridge instead
  (`EngineClient` → `merlin_shell_bridge_mac.mm` → services).
  `browser.shell_call(method, args)` sends `{"cmd": "shell-call", "method",
  "args"}`, which runs that method for the front window through the same
  dispatcher and returns its result; a request (`settings.*`, `bookmarks.*`,
  `downloads.list`...) answers once its reply event arrives, or fails after
  30 seconds. Method names are those in
  `packages/engine/include/merlin_shell_vocabulary.json`. Merlin accepts it
  only when started with `--merlin-test-shell-api` and a `--user-data-dir`,
  which the harness passes (a class sets `shell_api = False` to leave it
  out); a person's browser refuses it. Such an instance also leaves the
  system clipboard alone: yanks and copies say what they would copy.
- **Late answers.** Merlin asks pages things asynchronously (where a hint's
  target is, the scroll position for a mark) and must drop an answer that
  arrives after the page it describes stopped being the one shown.
  `browser.keep_page_busy(seconds)` blocks the active page's renderer, so
  Merlin's script there answers only afterwards, and `later(seconds, action)`
  does something else meanwhile (switch tabs through browserctl) on another
  thread, while the key press waits on the busy page.

## Limits

- **The A key can't be sent.** Its macOS key code is 0, which DevTools reads
  as "no native code", so the event skips Merlin. Tests use other letters, and
  hint tests set `hint_chars = "sdfjkl"`.
- **React's own surfaces aren't visible to the tests**: the command palette,
  hint labels, the status pill, Settings. Commands are run through browserctl
  instead of typed into the `:` line, and hints are chosen by label order.
  What those surfaces send can be: `shell_call` makes the same bridge calls,
  and `window.snapshot` returns what they are drawn from.
- **Labels typed within a couple of milliseconds of `f`** arrive before the
  page's hints are collected and are dropped, so hint tests pause 150 ms after
  `f`. 20 ms was always enough when measured, well below how fast people type.

## Coverage

| Module | Covers |
|---|---|
| `test_keys` | Typing in fields and rich editors is never a command; Esc; counts and sequences; unbound keys reach the page; Insert and Passthrough; inner scroll panels; `H`/`L`; `gu`; `]]`/`[[`; marks, and a mark whose page answers after a tab switch keeps that page's address; macros |
| `test_hints` | `f` follows, `F` opens in the background, a field hint enters Insert, `gi`, Esc cancels, hints in same-site and cross-site frames; an `F` answered after a tab switch opens nothing |
| `test_tabs` | `t`, `d`/`u`, `J`/`K`, `gp`, `:vsplit` with both halves visible, `<C-w>w`, `<C-w>o`, background tabs hidden |
| `test_config` | Bindings, `[unmap]`, `scroll_step`, a bad line keeps the rest, aliases, `passthrough_sites`, `modal_browsing = false` |
| `test_workspaces` | browserctl `ping`, `open`, `tabs`, `focus`, `current`, `selection`, `command`, refusals, socket permissions; workspace save and restore with pins and splits, `list`, `here`; autosave after a group is made, renamed, recoloured, collapsed or ungrouped, a pin or unpin, a split undone, and a window closed (`:browser close-window`) 0.5 s after a change, then reopened |
| `test_editor` | `:edit` writes back with an ordinary input event, the editor receives the field's text, password fields never leave the browser; a save written a piece at a time reaches the field only whole; an editor that exits 1 at once ends the edit with an error and no watch; closing the window mid-edit keeps the file and another window says where |
| `test_adblock` | Ad requests blocked before the network, generic cosmetic filters, per-site toggle |
| `test_groups` | `:group` starts a named group and joins one by name, `:ungroup`, pinned tabs stay out (browserctl `tabs` reports each tab's group) |
| `test_peek` | `:peek` and `gf` open a floating page without a tab; Esc closes it, Cmd-Return keeps it as the next tab, a tab switch closes it |
| `test_auto_pip` | Opt-in (`MERLIN_E2E_PIP=1`). A video playing with sound floats when its tab is left and returns with it; a paused one stays |
| `test_shell_api` | The shell's bridge through `shell-call`: calls and their errors, requests answered by their reply (bookmark folder and export, an export that fails), downloads listed; a suggestion opens only while Chromium's list still has that row's address at its index, and only for the latest query; three options set at once all land in `config.toml`, and a whole-file save from an older revision is refused; Settings' browserctl switch closes the socket; refused without the test switch |
| `test_address` | The address and security the snapshot gives the address field, from Chromium's formatter and security state: user names dropped (`accounts.google.com@evil.test`), ports kept, lookalike hosts left in punycode, international and right-to-left hosts, IPv6, long hosts; `insecure` for http, `internal` for Merlin's pages, and `dangerous` for an expired certificate before and after proceeding past its warning, in the site panel too (`fixtures/expired.test.*`, a throwaway certificate that expired in 2024) |
| `test_site_panel` | The site panel's ad-blocking line and button from the blocker's real state: on, off everywhere (no site toggle, a way to Settings), off for the site, and still loading (`--merlin-test-adblock-hold`, test-only: rules never load and pages load unblocked); its answer toggles the site it was opened for and reloads only that tab, only while it shows the same page, after a tab switch or a navigation |
| `test_downloads` | Every download action the shell sends, on downloads the fixture server holds in each state: pause and resume (also by `:browser download-pause`), cancel, retry after the connection drops, forget, and the refusals of each. Opening and showing a file put windows in front, so they run only with `MERLIN_E2E_DESKTOP=1` |
| `test_webkit` | Tabs shown in WebKit (fixture hosts on `*.localhost`, routed by `-MerlinShell.siteEngines`; the server tells WebKit's requests by their user agent): a routed site shows in WebKit in the same tab while Chromium's page leaves it, and other sites stay in Chromium; private windows open together share WebKit's cookies, the last private window to close ends the session, and normal windows never see private cookies; icons: a normal page's is cached in WebKit's own icon folder and never the app's shared URL cache, a private page's leaves no file in either, and no icon fetch sends or keeps a cookie; `privacy.clearData` clears cookies in both engines, a single site's in both while other sites keep theirs, refuses bad requests, and the site panel's "Forget this site" asks and then forgets; a WebKit tab's own address and title reach browserctl `current` and `tabs`, a bookmark, `:yank url`, a workspace (`"engine": "webkit"`) and its reopening, and session restore after quitting (`Merlin.restart`); hints, find, `:edit` and the outline refuse rather than act on Chromium's hidden page; a navigation browserctl starts behind a WebKit page shows even on the page before's site, a same-site `window.open` keeps a working `window.opener` (WebKit test instances let pages open windows without a click, since tests can't click them) and another site's opens a tab |
| `test_identity` | Chromium's own pages (passwords, settings, extensions, certificates, version) and error pages never say Chrome. Their styling stays Chromium's, a limitation in the README rather than a failing test |
| `test_defaults` | Lean defaults read from the running browser: blank new tabs, no AI Mode entry, Ctrl-Tab to the last tab used (`chrome://prefs-internals`); Memory Saver on, no on-device AI model, no background mode (`chrome://local-state`); Gemini, Lens, Help me write, Cast and the built-in AI APIs off (`chrome://version`'s command line, and the APIs absent from pages); no field trials or variations seed; no hidden Tab Search or prewarmed search page. `--modal-browser-upstream-defaults` turns the features back on |
| `test_private` | Private windows: their pages never reach history, a workspace or its autosave; browserctl `tabs`, `current`, `selection` and `command` answer for the normal window while a private one is in front |
| `test_session` | Session restore after quitting, with a pinned tab, and no private tab; after Merlin ends as a crash does (`kill -9`), the shell asks "Restore your tabs?", restores on Restore and opens nothing on Not now |
| `test_prompts` | A site permission (window management, each test on a `*.localhost` site of its own, since an answer stays with the site) allowed, blocked and dismissed through `permissions.answer`, with the page's own result and permission state; answers too soon, with an unknown action or to a closed prompt refused; `confirm`, `prompt` (typed answer through `prompts.update`) and `alert`; afterwards the field that had focus keeps it and Normal-mode keys act again |
| `test_input` | Input methods: keys an IME takes (`Process`), its marked and committed text and its Esc never run a command or leave Insert; dead keys (Option-E, E) reach the page in Normal mode, mid-sequence and in a field; focus from the page to the palette and back (a page key closes it and acts), to a field and back, and `:` typed in a field |
| `test_crash` | A renderer crash (`Page.crash`): the tab says so and keeps its address, other tabs keep working, and after a reload (the shell's button or `:reload`) keys and hints work again; the GPU process ended with SIGKILL comes back, ends no page, and keys, hints and drawing carry on |
| `test_interface` | A window's interface failing (`test.shell`, shell-call only): a failure while drawing reaches its error boundary, which Chromium logs, and `shell.reloadWindow` (Reload Interface) gives the window a new root with the same tabs, which then answers keys; a bridge reload brings every window back with its tabs; an uncaught error from a timer, which React Native's release build would raise as an exception that ends the browser, reloads the bridge instead |
| `test_adblock_states` | The ad blocker with rules of its own (`--merlin-test-adblock-rules`): off in Settings and back on, no lists, a list that fails to load (degraded, pages load, the site panel says why); while its rules load, requests wait for them, go ahead after two seconds, and a burst of 6,000 all settle with none ahead of the rules. The queue's fail-open past 2,048 waiting requests is out of a page's reach and untested |

### Not ported

Tests of the deleted Views surfaces (toolbar, tab bar, palette widget,
which-key, status pill, find bar, popovers, snapshots) have no equivalent
here. React's surfaces need a dev harness inside the shell (as Ardia has) to
be tested end to end. Preferences only readable inside Chromium are read
from Chromium's own pages instead (`test_defaults`).
