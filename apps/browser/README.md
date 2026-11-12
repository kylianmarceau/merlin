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
| Engine module | `packages/engine/` | The `MerlinEngine` Expo module: calls, events and native page attachment |
| AppKit module | `packages/shell/` | One Expo module per AppKit view (`MerlinShell`, `MerlinShellSymbol`, …; pod `MerlinShellViews`): SF Symbols, vibrancy, shadowed surfaces, the window drag region, outside-press detection, context-menu areas and native menus |
| Platform | `apps/browser/src/platform/` | The only JS that imports the two native packages |
| State | `apps/browser/src/state/` | A Zustand store per window, its actions and hooks, validated snapshots and the rules for which overlays show |
| Components | `apps/browser/src/components/` | `ui/` (tokens, motion, about 30 shared pieces) and one folder per feature |
| Host process | `apps/browser/macos/MerlinShell-macOS/` | Loads Chromium, calls `ChromeMain`, and supplies React roots to engine-owned windows |

The pinned stack is React 19.1.4, React Native 0.81.6, React Native macOS 0.81.9,
Expo 54.0.37, Expo Modules Core 3.0.30, Zustand 5.0.8 and Hermes. This uses React
Native's classic bridge (`RCT_NEW_ARCH_ENABLED=0`), matching the researched
integration. Chromium remains responsible for process startup and the event
loop. The host must not call `NSApplicationMain` or install a competing delegate.

Browser windows and the pop-ups pages open use a custom Views-backed macOS
window containing one React root, without constructing `BrowserView`. Each
active page's existing NSView is embedded in the React layout. App and DevTools
windows keep the upstream implementation. One shared React bridge serves all
windows; each root receives an opaque native window ID.

`DESIGN.md` is the visual spec: surfaces, type, colour roles, spacing and
motion. `src/conventions.test.ts` enforces its rules (no colour, size or timing
literals outside the tokens, no React Native shadows or `Modal`, and imports
only downwards through lib, platform, state and components).

Calls run on Chromium's UI thread. The bridge checks window/tab ownership and
validates prompt actions. Snapshots have session and revision IDs; subscriptions
are established before the initial read, and stale snapshots are discarded.
Native changes are coalesced outside tab-strip mutation callbacks and sent at
most once a frame. React never maintains a second authoritative tab list or
writes Chromium profile files.

Speed-sensitive paths stay native:

- **Startup.** Chromium starts the React host in `PostCreateThreads`
  (`patches/0074`), so React Native's native modules and the Hermes bundle load
  while the profile loads, not when the first window asks for its view.
  `MERLIN_NO_PREWARM=1` turns this off for comparison, and
  `MERLIN_STARTUP_TRACE=<file>` logs the host's startup phases.
- **Tab switches.** When Chromium activates a tab, the engine moves the new
  page's view into the place React gave the previous one
  (`RevealActivePage`); React re-renders the sidebar after. Split views, the
  start page and crashed pages are React's own layout.
  `MERLIN_TRACE_FILE=<file>` logs each page shown, for benchmarks.
- **Snapshots.** Unchanged tabs and downloads keep their objects between
  snapshots (`state/store.ts`) and their rows are memoized, so a page load
  re-renders one row. Snapshots carry running and recent downloads only;
  the Library asks for the rest with `downloads.list`.

React Native macOS, Expo Modules Core and Expo Constants carry fixes from Ardia
(`pnpm-patches/`, applied by `pnpm install`): Auto Layout, mount order, timer
wakeups, touches, text input and a 60 ms font scan at launch among them.

`state/surfaces.ts` decides which overlays show. Site questions (permissions,
passwords, autofill, translation, site information) are anchored popovers
beside the address that leave the page usable; page and window questions are
dialogs. Both take priority over the command menu and the shell's own
popovers. Failures are toasts. Quiet requests wait behind a toolbar chip. Dialog callbacks, permitted actions and input
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
   Assembly refuses an engine or host older than its sources (the overlay,
   the patch series and the files it patches; the shell's JS and native
   code), so a stale build is never packaged; `--allow-stale` overrides it.
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

Every normal-window surface is React; the Views interface (tab bar, toolbar,
palette, hints, status pill, Control-Tab switcher, address editor and the
`chrome://merlin-*` pages) has been deleted. Chromium keeps the behavior; the
shell presents it. Command-comma and the History, Downloads and Bookmarks
menu items open the React panels (`patches/0073`). Control-Tab uses
Chromium's own most-recently-used switching, without an on-screen switcher.

| Surface | React | Chromium side |
| --- | --- | --- |
| Tabs in the sidebar or across the top, pinning, ordering, favicons, native tab menus, start page | `tabs/`, `favicon/`, `start/` | `merlin_shell_bridge_mac.mm` (`favicons.get`, 2x PNG) |
| Address field with Chromium's suggestions and inline completion | `omnibox/` | `MerlinSuggestions` through `omnibox.query`/`open`/`enter` |
| Split views (`:split`, `:vsplit`) | `window/PageArea` renders both halves; the other half focuses on click | Snapshot `split`, page attachment and visibility in the window |
| Command palette, link hints, find in page | `palette/`, `window/PageArea`, `find/` | Modal controller, `merlin_react_find_bar.cc` |
| Pop-up windows | `window/PopupWindow` | `patches/0068` (`TYPE_POPUP`), snapshot `kind` |
| Settings: appearance, startup, search, downloads, privacy, blocking, performance, extensions, workspaces, keys, config file, about | `Settings` | `merlin_preferences.cc`, `merlin_shell_services.cc` |
| History, bookmarks with folders, downloads | `Library` | `merlin_shell_services.cc`, `merlin_downloads.cc` |
| Extensions popover, and extension popups in place | `extensions/` | `merlin_shell_services.cc`, `merlin_react_extension_popup_mac.mm` |
| Profiles and recent downloads popovers | `profiles/`, `library/DownloadsPopover` | `merlin_shell_services.cc` |
| Permissions, JavaScript dialogs, leave-page, close with downloads | `site/` | `merlin_react_permission_prompt.cc`, `merlin_react_script_dialog.cc` |
| Site information, bookmark editing, translate, open-in-app, update ready, caret browsing, private-window dialogs | `site/` | `merlin_react_window_mac.mm`, `ShowShellSiteInfo` |
| Save or update passwords | `site/` | `merlin_react_passwords.cc`, hooked by `patches/0071` |
| Save or update addresses, save cards locally | `site/` | `merlin_react_autofill.cc` |
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

- Side-panel extensions report that side panels are not part of Merlin, and
  `chrome.action.openPopup()` from an extension is not supported.
- Reading mode needs Chromium's side panel and is reported as unavailable.
- Card upload to a payments account, IBAN, virtual cards and Autofill AI offers
  are not shown; their controllers see no bubble and continue.
- The fullscreen exit/security indicator remains Chromium's native bubble.
- App and DevTools windows still use the upstream window implementation.
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
offers, translation, profile switching and extension actions. Check the new
AppKit pieces in particular: sidebar vibrancy, popover shadows and layering
above the page, dragging and double-clicking the toolbar and sidebar strip,
outside clicks on the page closing popovers, right-click tab menus, favicons,
address suggestions, extension popups sizing to their content, and pop-up
windows. `pod install` (run by `build_react_shell.sh`) adds the new
`MerlinShellViews` pod.
Source and syntax checks cannot establish that these work at runtime. Compare
benchmarks only after a fresh build, using the same engine build type and test
conditions as the previous baseline.
