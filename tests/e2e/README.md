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
products themselves were rebuilt from those sources is the assembler's
modification-time check (`--allow-stale` skips it).

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
| `test_keys` | Typing in fields and rich editors is never a command; Esc; counts and sequences; unbound keys reach the page; Insert and Passthrough; inner scroll panels; `H`/`L`; `gu`; `]]`/`[[`; marks; macros |
| `test_hints` | `f` follows, `F` opens in the background, a field hint enters Insert, `gi`, Esc cancels, hints in same-site and cross-site frames |
| `test_tabs` | `t`, `d`/`u`, `J`/`K`, `gp`, `:vsplit` with both halves visible, `<C-w>w`, `<C-w>o`, background tabs hidden |
| `test_config` | Bindings, `[unmap]`, `scroll_step`, a bad line keeps the rest, aliases, `passthrough_sites`, `modal_browsing = false` |
| `test_workspaces` | browserctl `ping`, `open`, `tabs`, `focus`, `current`, `selection`, `command`, refusals, socket permissions; workspace save and restore with pins and splits, `list`, `here`; autosave after a group is made, renamed, recoloured, collapsed or ungrouped, a pin or unpin, a split undone, and a window closed (`:browser close-window`) 0.5 s after a change, then reopened |
| `test_editor` | `:edit` writes back with an ordinary input event, the editor receives the field's text, password fields never leave the browser; a save written a piece at a time reaches the field only whole; an editor that exits 1 at once ends the edit with an error and no watch; closing the window mid-edit keeps the file and another window says where |
| `test_adblock` | Ad requests blocked before the network, generic cosmetic filters, per-site toggle |
| `test_groups` | `:group` starts a named group and joins one by name, `:ungroup`, pinned tabs stay out (browserctl `tabs` reports each tab's group) |
| `test_peek` | `:peek` and `gf` open a floating page without a tab; Esc closes it, Cmd-Return keeps it as the next tab, a tab switch closes it |
| `test_auto_pip` | Opt-in (`MERLIN_E2E_PIP=1`). A video playing with sound floats when its tab is left and returns with it; a paused one stays |
| `test_shell_api` | The shell's bridge through `shell-call`: calls and their errors, requests answered by their reply (bookmark folder and export, an export that fails), downloads listed; refused without the test switch |
| `test_address` | The address and security the snapshot gives the address field, from Chromium's formatter and security state: user names dropped (`accounts.google.com@evil.test`), ports kept, lookalike hosts left in punycode, international and right-to-left hosts, IPv6, long hosts; `insecure` for http, `internal` for Merlin's pages, and `dangerous` for an expired certificate before and after proceeding past its warning, in the site panel too (`fixtures/expired.test.*`, a throwaway certificate that expired in 2024) |
| `test_site_panel` | The site panel's ad-blocking line and button from the blocker's real state: on, off everywhere (no site toggle, a way to Settings), off for the site, and still loading (`--merlin-test-adblock-hold`, test-only: rules never load and pages load unblocked); its answer toggles the site it was opened for and reloads only that tab, only while it shows the same page, after a tab switch or a navigation |
| `test_downloads` | Every download action the shell sends, on downloads the fixture server holds in each state: pause and resume (also by `:browser download-pause`), cancel, retry after the connection drops, forget, and the refusals of each. Opening and showing a file put windows in front, so they run only with `MERLIN_E2E_DESKTOP=1` |
| `test_webkit` | Tabs shown in WebKit (fixture hosts on `*.localhost`, routed by `-MerlinShell.siteEngines`; the server tells WebKit's requests by their user agent): private windows open together share WebKit's cookies, the last private window to close ends the session, and normal windows never see private cookies; icons: a normal page's is cached in WebKit's own icon folder and never the app's shared URL cache, a private page's leaves no file in either, and no icon fetch sends or keeps a cookie; `privacy.clearData` clears cookies in both engines, a single site's in both while other sites keep theirs, refuses bad requests, and the site panel's "Forget this site" asks and then forgets; a WebKit tab's own address and title reach browserctl `current` and `tabs`, a bookmark, `:yank url`, a workspace (`"engine": "webkit"`) and its reopening, and session restore after quitting (`Merlin.restart`); hints, find, `:edit` and the outline refuse rather than act on Chromium's hidden page; a navigation browserctl starts behind a WebKit page shows even on the page before's site, a same-site `window.open` keeps a working `window.opener` (WebKit test instances let pages open windows without a click, since tests can't click them) and another site's opens a tab |
| `test_identity` | Chromium's own pages (passwords, settings, extensions, certificates, version) and error pages never say Chrome; error-page restyling (an expected failure, see below) |

### Known failure

`test_identity.test_network_errors_are_restyled` is marked
`expectedFailure`. `5729e15` deleted `RestyleMerlinPage` along with the Views
interface, so network error pages and certificate warnings show Chromium's own
styling again. Remove the marker once the React build restyles them; the
runner will report an unexpected success until then.

### Not ported

Tests of the deleted Views surfaces (toolbar, tab bar, palette widget,
which-key, status pill, find bar, popovers, snapshots) and of preferences
only readable inside Chromium (lean defaults, AI features off, memory saver)
have no equivalent here. React's surfaces need a dev harness inside the shell
(as Ardia has) to be tested end to end.
