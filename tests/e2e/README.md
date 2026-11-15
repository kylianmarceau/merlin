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
```

The app defaults to `apps/browser/build/assembled/Merlin.app`, then
`/Applications/Merlin.app`. Requirements: the system `python3` (3.9 or later,
no packages) and Xcode's command line tools.

## How it works

Each test class starts one Merlin and each test starts from one tab on a
fixture page (`MerlinTestCase.reset`).

- **Isolation.** A throwaway `--user-data-dir`, `XDG_CONFIG_HOME` (so
  `config.toml`), `XDG_DATA_HOME` (so workspaces), browserctl socket and
  DevTools port; `--use-mock-keychain`. Your own Merlin keeps running and its
  profile, config, sign-ins and clipboard are not touched. No test reads or
  writes the clipboard. Shell preferences live in the app's macOS defaults,
  which tests only read.
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

## Limits

- **The A key can't be sent.** Its macOS key code is 0, which DevTools reads
  as "no native code", so the event skips Merlin. Tests use other letters, and
  hint tests set `hint_chars = "sdfjkl"`.
- **React's own surfaces aren't visible to the tests**: the command palette,
  hint labels, the status pill, Settings. Commands are run through browserctl
  instead of typed into the `:` line, and hints are chosen by label order.
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
| `test_workspaces` | browserctl `ping`, `open`, `tabs`, `focus`, `current`, `selection`, `command`, refusals, socket permissions; workspace save and restore with pins and splits, `list`, `here` |
| `test_editor` | `:edit` writes back with an ordinary input event, the editor receives the field's text, password fields never leave the browser |
| `test_adblock` | Ad requests blocked before the network, generic cosmetic filters, per-site toggle |
| `test_groups` | `:group` starts a named group and joins one by name, `:ungroup`, pinned tabs stay out (browserctl `tabs` reports each tab's group) |
| `test_peek` | `:peek` and `gf` open a floating page without a tab; Esc closes it, Cmd-Return keeps it as the next tab, a tab switch closes it |
| `test_auto_pip` | Opt-in (`MERLIN_E2E_PIP=1`). A video playing with sound floats when its tab is left and returns with it; a paused one stays |
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
