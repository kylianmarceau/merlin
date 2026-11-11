# Merlin's React Native macOS shell

This replaces Merlin's Views-based interface. It uses the UI stack and
host/engine separation researched in Ardia, with original Merlin components and
styling. It is not a WebUI skin or a second browser engine. The migration is
source-complete and passes source, syntax and dependency checks; it is **not yet
runtime-qualified** (see the checklist at the end).

## Ownership

| Layer | Location | Owns |
| --- | --- | --- |
| Chromium | `overlay/chrome/browser/ui/modal_browser/merlin_react_*` | Browser windows, WebContents, navigation, profile data, permissions, find sessions and dialog decisions |
| C ABI | `packages/engine/include/` | Versioned engine calls/events and host root creation; no C++ objects cross the framework boundary |
| Native presentation bridge | `packages/engine/macos/` | Expo modules, native WebContents attachment and SF Symbols |
| Presentation | `apps/browser/src/ui/` | React Native macOS components, shared tokens, dialogs, focus and local form drafts |
| State | `apps/browser/src/state/` | A Zustand store for each window, validated Chromium snapshots and transient panels |
| Host process | `apps/browser/macos/MerlinShell-macOS/` | Loads Chromium, calls `ChromeMain`, and supplies React roots to engine-owned windows |

The pinned stack is React 19.1.4, React Native 0.81.6, React Native macOS 0.81.9,
Expo 54.0.37, Expo Modules Core 3.0.30, Zustand 5.0.8 and Hermes. This uses React
Native's classic bridge (`RCT_NEW_ARCH_ENABLED=0`), matching the researched
integration. Chromium remains responsible for process startup and the event
loop. The host must not call `NSApplicationMain` or install a competing delegate.

Normal browser windows use a custom Views-backed macOS window containing one
React root, without constructing `BrowserView`. Each active page's existing
NSView is embedded beneath the React toolbar. Popups/app windows still use the
upstream window implementation during this migration. One shared React bridge
serves all normal windows; each root receives an opaque native window ID.

Calls run on Chromium's UI thread. The bridge checks window/tab ownership and
validates prompt actions. Snapshots have session and revision IDs; subscriptions
are established before the initial read, and stale snapshots are discarded.
Native changes are coalesced outside tab-strip mutation callbacks. React never
maintains a second authoritative tab list or writes Chromium profile files.

`visibleSurface` selects one modal surface per window. Permission and script
decisions take priority over menus/settings/errors. Quiet permission requests
wait for an explicit reveal. Dialog callbacks, permitted actions and input
drafts stay tied to native request IDs. A short input guard prevents a click
that opened a prompt from also answering it.

## Source checks (no app rebuild)

From the repository root:

```sh
pnpm ui:check
pnpm ui:test
python3 scripts/apply_patches.py --check
python3 scripts/test_react_assembly.py
```

The ABI headers under `packages/engine/include/` are canonical. Run
`python3 scripts/sync_shell_headers.py` after editing them. `ui:check` verifies
the overlay copies match before TypeScript checking.

## Build when ready

These commands are for the maintainer to run. Source checks do not build or
launch the app. Requirements: Apple Silicon, full Xcode, Node 22.13+,
pnpm 10.28.2 and CocoaPods. The React shell requires macOS 14 or later.

1. Apply the overlay/patches and rebuild the **non-component** Chromium app
   using the existing `scripts/apply_overlay.sh` and
   `scripts/build_release.sh` workflow. The framework must export
   `MerlinEngineGetAPI`; an older engine will fail the assembly check.
2. Build the presentation host:

   ```sh
   scripts/build_react_shell.sh
   ```

   This installs the locked JS dependencies, runs UI checks, updates Pods and
   builds the macOS target with a bundled Hermes program. It does not rebuild
   Chromium. The default output is
   `apps/browser/build/native/Build/Products/Release/MerlinShell.app`.
3. Assemble the two products into a **fresh** output path:

   ```sh
   python3 scripts/assemble_react_app.py \
     --engine-app "$HOME/chromium/src/out/Release/Merlin.app" \
     --shell-app apps/browser/build/native/Build/Products/Release/MerlinShell.app \
     --output apps/browser/build/assembled/Merlin.app
   ```

   Add `--check-only` to check the required products and exported ABI first.
   Assembly preserves Chromium's framework, helper bundles, app identity,
   icons, URL handlers and permission descriptions, adds the React resources
   and Hermes, and replaces only the browser executable. It refuses to
   overwrite an existing output or silently replace colliding resources.
   Neither input app is modified.
4. Package the assembled app through the existing ad-hoc signing workflow:

   ```sh
   MERLIN_APP="$PWD/apps/browser/build/assembled/Merlin.app" \
   MERLIN_SHELL_DSYM="$PWD/apps/browser/build/native/Build/Products/Release/MerlinShell.app.dSYM" \
   MERLIN_VERSION=0.1.0-beta.1 scripts/package_mac.sh
   ```

   `CHROMIUM_DIR` and `OUT` still identify the engine's credits, GN arguments
   and dSYMs. Keep both engine and shell dSYMs. GitHub Releases use free ad-hoc
   signing; Developer ID and notarization are outside the agreed release scope.
   Follow the installation checks in `docs/RELEASE.md` before publishing.

For Metro development, build with `CONFIGURATION=Debug`, assemble and sign the
app, then run `pnpm ui:dev` and launch the app's executable with
`MERLIN_USE_METRO=1`. Otherwise it uses its bundled JS, including in Debug.
The bare Xcode host cannot launch without the assembled engine framework.

## Implemented source paths

Every normal-window surface is now React. Chromium keeps the behavior; the
shell presents it.

| Surface | React | Chromium side |
| --- | --- | --- |
| Tabs, pinning, ordering, address, navigation, start page | `TabSidebar`, `App`, `StartPage` | `merlin_shell_bridge_mac.mm` |
| Split views (`:split`, `:vsplit`) | `App` renders both halves; the other half focuses on click | Snapshot `split`, page attachment and visibility in the window |
| Command palette, link hints, find in page | `CommandMenu`, hint overlay, `FindBox` | Modal controller, `merlin_react_find_bar.cc` |
| Settings: appearance, startup, search, downloads, privacy, blocking, performance, extensions, workspaces, keys, config file, about | `Settings` | `merlin_preferences.cc` (shared with the legacy page), `merlin_shell_services.cc` |
| History, bookmarks with folders, downloads | `Library` | `merlin_shell_services.cc`, `merlin_downloads.cc` |
| Extensions (run an action, turn on or off) | `Extensions` | `merlin_shell_services.cc` |
| Profiles (switch, add) | `Profiles` | `merlin_shell_services.cc` |
| Permissions, JavaScript dialogs, leave-page, close with downloads | `BrowserPrompt` | `merlin_react_permission_prompt.cc`, `merlin_react_script_dialog.cc` |
| Site information, bookmark editing, translate, open-in-app, update ready, caret browsing, private-window dialogs | `BrowserPrompt` | `merlin_react_window_mac.mm`, `ShowShellSiteInfo` |
| Save or update passwords | `BrowserPrompt` | `merlin_react_passwords.cc`, hooked by `patches/0071` |
| Save or update addresses, save cards locally | `BrowserPrompt` | `merlin_react_autofill.cc` |
| Color picker eye dropper | System color sampler | Chromium's macOS `ShowEyeDropper` |

Data Chromium produces on demand travels as a request: `EngineClient.request()`
sends a `requestId`, the engine acknowledges at once, and the answer arrives as a
`reply` event after the call returns. Replies are validated per method before
any component renders them. `panel.open` events let Chromium commands (menu
items, key equivalents, `:history`, `:settings` and so on) open React panels
instead of Chromium's pages.

Offers Chromium makes on its own (translation, saving a password, address or
card, opening a link in an app) are quiet: they wait behind the toolbar's
request button instead of interrupting the page.

### Deliberate limits

- Extension popups open as a tab with the extension's origin and permissions;
  there is no anchored extension popover yet. Side-panel extensions report that
  side panels are not part of Merlin.
- Reading mode needs Chromium's side panel and is reported as unavailable.
- Card upload to a payments account, IBAN, virtual cards and Autofill AI offers
  are not shown; their controllers see no bubble and continue.
- The fullscreen exit/security indicator remains Chromium's native bubble.
- Popup and app windows still use the upstream window implementation.
- Saved passwords, site permissions, cookies, certificates and similar
  specialist pages open Chromium's own pages from Settings.
- Send-tab-to-self (needs Google Sync) and enterprise download scanning still
  expect Chromium's toolbar; Merlin does not enable either.

Before declaring the migration complete, test the assembled app's actual window
lifecycle, tab/page focus, keyboard shortcuts, native view layering, light/dark
appearance, VoiceOver, private windows, multi-window routing, permission queues,
JavaScript/before-unload dialogs, fullscreen exit, downloads and shutdown;
also Settings and config saving, history paging, bookmark folders and moves,
split views (both halves visible, focus on click), password and address save
offers, translation, profile switching and extension actions.
Source and syntax checks cannot establish that these work at runtime. Compare
benchmarks only after a fresh build, using the same engine build type and test
conditions as the previous baseline.
