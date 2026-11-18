# Architecture

The browser's interface is the React Native macOS shell in `apps/browser`
(see its README): Chromium windows without BrowserView, a React root per
window, Chromium's pages embedded as native views. This document covers the
engine side: the modal input core, its Rust/C++ split and Chromium hooks.

When the interface fails, the pages don't: Chromium owns every tab, and a
React root only shows them. A failure while drawing a window stops at that
window's error boundary (`InterfaceBoundary.tsx`), which reports it to
Chromium's log (`shell.report`) and offers Reload Interface: Chromium
releases the window's root and creates another (`shell.reloadWindow`,
`RemountReactShell`). A failure outside React (a timer, an event handler, the
bundle) is fatal to React Native, whose release build would raise an
exception and end the browser; the host's fatal handler reloads the shared
bridge instead, at most three times a minute (`AppDelegate.mm`), and every
root runs the app again with its window ID.

A Chromium fork with a Rust core for the parts that make this browser
different. Chromium (C++) keeps everything it already does well: rendering,
networking, process isolation, extensions, DevTools, security UI. Merlin
keeps a single Chromium profile and offers no profile UI (patch 0051).

## Layers

```text
 Key press in a tab
      |
      v
 ReactBrowserWindow::PreHandleKeyboardEvent   (merlin_react_window_mac.mm)
      |  kRawKeyDown only, normal browser windows only
      v
 ModalBrowserController                        chrome/browser/ui/modal_browser/
      |  NativeWebKeyboardEvent -> KeyDown        Chromium-specific, thin
      |  WebContents focus state -> PageFocus
      v
 ModalInputRouter                              chrome/browser/ui/modal_browser/
      |  no Chromium includes; tested in tools/host_harness
      v
 cxx bridge: rust::Box<ffi::Session>           components/modal_browser/ffi/
      |  C++ -> Rust calls only; plain data back
      v
 ModalSession (Rust)                           components/modal_browser/core/
      modes, focus policy, key sequences, counts,
      keymap, command registry/parser, URL vs search
      |
      v  Outcome { disposition, actions[], mode, pending, timeout }
 ModalInputRouter -> BrowserOps (C++ interface)
      |
      v
 ModalBrowserController implements BrowserOps with chrome::NewTab,
 BrowserWindowInterface::OpenGURL, NavigationController::GoToOffset, ...
 Its palette, status, which-key and hint state go to the React Native shell
 in each window snapshot (ShellModalState); the shell draws them.
 Per window: an ExternalEditor session for :edit, and a share of the
 process-wide BrowserctlServer.

 browserctl (CLI) --JSON line--> Unix socket (0700 dir, same uid only)
      --> BrowserctlServer (IO thread) --> UI thread:
      core::ipc parses --> front window's controller runs it
```

Asynchronous work follows one pattern: Rust emits a request action, the
host does the work, then reports back through the router, and Rust decides
what happens next.

| Request action | Host work | Report back |
|---|---|---|
| `CollectHints{generation}` | isolated-world script collects visible targets | `hints_collected(generation, kinds)` |
| `ActivateHint{target}` | re-measure the element; click, open, copy or focus | (focus change, navigation) |
| `OpenClipboard` | `ui::Clipboard::ReadText` | `open_text(text)` |
| `ReloadConfig` | read the file on the thread pool | `load_config(text)` |
| `OpenPalette` | snapshot tabs (`set_tabs`), render `palette_state()` | `palette_input`, `palette_key`, `palette_select` |
| `RequestItems{source}` | history service, bookmark model, workspace directory, downloads | `set_items(source, items, now)` |
| `CollectDocument{generation}` | isolated-world extraction of headings, text, lists, code, tables | `document_collected(generation, blocks)` |
| `SnapshotWorkspace{name}` | list this window's tabs, pins and split pairs | `save_workspace(name, tabs, now)` then `WriteWorkspace` |
| `ReadWorkspace{name}` | read the file off the UI thread | `workspace_read(name, found, text)` then `RestoreWorkspace` |
| `InspectField{force}` | describe the focused field (never its value) | `field_info(info, force)` then `EditField{argv}` |

Stale answers are safe: hint results carry a generation and are dropped
after Esc or a newer request; the palette re-reads state on every render.

**Rust decides, C++ executes.** The Rust core never calls a browser API. It
returns typed `Action`s. That keeps all input logic deterministic and
testable without a browser, and keeps Chromium in charge of object lifetimes,
threading and security checks.

## Repository layout

| Path | What | Built by |
|---|---|---|
| `overlay/components/modal_browser/core` | Rust core crate | Cargo now; GN `rust_static_library` in the fork |
| `overlay/components/modal_browser/ffi` | cxx bridge crate | Cargo (`build.rs`); GN `cxx_bindings` in the fork |
| `overlay/chrome/browser/ui/modal_browser` | C++ router (portable) and Chromium glue | Router: Cargo harness + GN. Glue: GN only |
| `patches/` | The only edits to upstream files | `scripts/apply_overlay.sh` |
| `tools/host_harness` | Compiles the real router `.cc` against the real bridge with a fake browser | Cargo only |
| `tools/modalctl` | Terminal REPL over the core (keys, hints, palette, config) | Cargo only |
| `tools/browserctl` | The `browserctl` CLI; shares `core::ipc` with the browser | Cargo only (a standalone binary, not part of the app bundle yet) |
| `docs/config.example.toml` | Documented example of the user config | `check_config` example validates it |

Core modules: `session` (state machine), `command` (registry, parser,
completion), `keymap`, `key`, `hints` (labels, filtering), `fuzzy`
(ranking), `palette` (palette model, lists, folding), `config` +
`toml_lite` (user configuration), `target` (URL vs search), `focus`,
`mode`, `action`, `workspace` (workspace files),
`document` (page structure, outline, Markdown), `editor` (external-edit
policy and command), `ipc` (browserctl protocol), `json` (strict JSON for
the last two).

Chromium-side files: `modal_browser_controller` (BrowserOps, observers),
`modal_input_router` (portable glue), `page_scripts` (isolated-world scripts
and result parsing), `merlin_shell_bridge_mac` and `merlin_react_*` (the React
shell's engine API, window and Chromium's questions), `config_file` (path, I/O),
`workspace_store` (workspace files, atomic writes), `external_editor`
(temporary file, editor process, save watching), `browserctl_server`
(Unix socket on the IO thread).

`merlin_safety_controls` supplies the private-window label and per-window
capture menu; site controls are the address field itself (`:site`, or a
right-click). It observes Chromium's media
capture service and the tab model; the tab bar separately subscribes to tab-alert
changes. Neither control depends on modal keys or the tab strip being visible.
Patch 0013 routes Page Info and permission anchors to the address field
when Chromium's location bar is hidden. Capture actions use validated tab
handles and Chromium's stop callbacks.

`overlay/` mirrors Chromium's `src/` layout. `scripts/apply_overlay.sh`
symlinks the two directories into a checkout, so our code never mixes with
upstream files.

## FFI and ownership

One `#[cxx::bridge(namespace = "modal_browser::ffi")]` in
`ffi/src/lib.rs`, as `//docs/rust/ffi.md` recommends.

* `Session` is an opaque Rust type. C++ owns it as `rust::Box<Session>`
  inside `ModalInputRouter`, which lives inside `ModalBrowserController`,
  which `EmbedderBrowserWindowFeatures` owns for exactly the window's
  lifetime: created in `InitPostWindowConstruction` for normal windows when
  the React shell is on (`--merlin-react-shell`, passed by the host; patches
  0001 and 0068), destroyed in `TearDownPreBrowserWindowDestruction`. Pop-up,
  app and DevTools windows have no controller.
* `ModalBrowserController::From(browser)` finds the controller through the
  window's `UnownedUserDataHost` (`ScopedUnownedUserData`, the
  `FindBarController` pattern). `EmbedderBrowserWindowFeatures::From()`
  cannot be used: upstream never registers that class, so it returns null.
* The controller draws nothing itself. Palette, status, which-key and hint
  state travel to the React window in each snapshot (`ShellModalState`), at
  most once a frame, and the shell draws them.
* Calls go one way, C++ to Rust. Results are shared structs (`Outcome`,
  `Action`, `Completion`) copied across. Rust holds no C++ pointers, so there
  is no aliasing or lifetime coupling to audit.
* Enum values arriving from C++ are range-checked in Rust: an unknown
  `FocusKind` is treated as "browser UI has focus" (the key is left alone),
  and an unknown `Mode` is rejected. Both have tests.
* Single sequence: the controller has a `SEQUENCE_CHECKER`; `Session` is only
  touched on the UI thread.
* Strings crossing into Rust must be UTF-8. DOM key names from
  `ui::KeycodeConverter` and `base::UTF16ToUTF8` output always are.
* The generated header sits at `components/modal_browser/ffi/src/lib.rs.h`
  in both builds (Cargo sets `include_prefix` to match GN), so C++ includes
  are identical.

## Key dispatch and focus policy

Where keys enter, at the pinned 157.0.8103.26:

* `Browser::PreHandleKeyboardEvent` hands key events headed to web content
  to the window's `BrowserWindow`, here `ReactBrowserWindow::PreHandleKeyboardEvent`
  (`merlin_react_window_mac.mm`), before the page sees them. Control-Tab and
  Control-Shift-Tab are taken first (the tab switcher), then the controller
  gets the key.
* Returning `HANDLED` for a `kRawKeyDown` makes `RenderWidgetHostImpl` drop
  the matching char and key-up events (`content/browser/renderer_host/render_widget_host_impl.cc:1909-1940`).
* IME composition events carry `skip_if_unhandled` and are never
  pre-handled at all (same lines). IME safety is structural, not a heuristic.
* The address field, find bar, palette field and other React text fields are
  AppKit views, so their keys never reach this hook.
* WebKit tabs (for DRM video, which Merlin's Chromium can't play) are a `WKWebView`, not a `WebContents`: they get
  no modal keys. Their browser shortcuts reach the shell first.
* Testing note: `content::SimulateKeyPress` and DevTools key events without a
  native key code are marked `skip_if_unhandled` and skip this hook. The
  end-to-end tests (`tests/e2e`) send `Input.dispatchKeyEvent` with native key
  codes, so keys take the real path.

Policy in `ModalSession` (`core/src/session.rs`), in order:

1. Browser UI focus or IME composition: forward, every mode.
2. Editable element focused (`WebContents::IsFocusedElementEditable()`,
   read synchronously per key) while in Normal/Visual: switch to Insert and
   forward. Typing is never read as commands, even if the asynchronous focus
   notification is late.
3. Insert: `<Esc>` returns to Normal and blurs the field
   (`WebContents::ClearFocusedElement`). Everything else goes to the page.
4. Passthrough: only `<S-Esc>` (configurable) is handled; the page gets `<Esc>`.
5. Normal/Visual: counts, then sequences. Unbound keys with nothing pending
   go to the page, so site shortcuts keep working. Command-key chords always
   reach the browser, even mid-sequence. Bare `<Esc>` with nothing pending
   reaches the page.
6. Ambiguous sequences (`g` bound and `gg` bound) return `timeout_ms`; the
   host owns the timer (`base::OneShotTimer`) and calls `on_timeout`.

## Commands

Every operation is a named command in one `CommandRegistry`. Key bindings
store command lines (`"scroll down"`, `"cmdline open"`), not closures, so
mappings, the `:` line, and later the palette, `browserctl` and plugins share
one path. Handlers are pure functions `Invocation -> Effects`, which is why
bindings can be validated by dry-running them at bind time.

Implemented: `open`, `tabnew`, `tabclose`, `tabnext`, `tabprevious`,
`tabrestore`, `tabfirst`, `tablast`, `tabs`, `buffer`, `back`, `forward`,
`reload[!]`, `up`, `root`, `scroll`, `find [next|previous]`,
`focus-address`, `cmdline`, `palette`, `hint
[follow|tab|yank|input|edit|code|select]`, `yank
[url|title|markdown|selection]`, `paste [tab]`, `mode`, `map`, `unmap`,
`config-reload`, `vertical-tabs [on|off]`, `sidebar [on|off]`, `nop`,
`help`, `vsplit`, `split`, `only`, `split-focus`, `split-swap`,
`pin`, `window`, `private`, `workspace [save|open|delete|list]`,
`history`, `bookmark`, `bookmarks`, `downloads`, `settings`,
`extensions`, `devtools`, `edit[!]`, `outline`, `links`, `extract`,
`jump`, `select`, `mark`, `jump-mark`, `marks`, `macro`, `peek`, `group`,
`ungroup`, `adblock`, `set`, `hide-tabs`, `site` and `browser`.
User-defined commands come from `[aliases]` in the config. The registry
holds only commands that work, and a test checks it: there is no `read`
(Chromium's Reading mode needs the side panel, which Merlin doesn't have)
and no `script` (plugins need a permission model first).

The same registry serves the keymap, the `:` line, the palettes and
`browserctl command`.

Handlers receive a read-only `Context` (registry, tab snapshot, options) and
return `Effects` (actions, a mode, keymap edits). They never mutate state,
so bindings are still validated by dry-running them.

`:open` input is classified in Rust (`core/src/target.rs`): script/data
schemes refused, bare hosts get `https://`, localhost/IP get `http://`,
anything else is a search. The C++ side then canonicalises with
`url_formatter::FixupURL`, re-checks the scheme, and resolves searches with
the omnibox's own `AutocompleteClassifier`, so the user's default search
engine applies.

## Chromium entry points used

All compiled at the pinned tag. The end-to-end tests exercise them through
the assembled app.

| Need | API | Where |
|---|---|---|
| Per-window owner | `EmbedderBrowserWindowFeatures` (Chromium's hook for embedders) | `chrome/browser/ui/browser_window/public/embedder_browser_window_features.h` |
| Open URL | `BrowserWindowInterface::OpenGURL` | `browser_window_interface.h:227` (marked for future removal upstream) |
| Tabs, reload, find, address bar | `chrome::NewTab/CloseTab/RestoreTab/SelectNextTab/Reload/Find/FocusLocationBar` | `chrome/browser/ui/browser_commands.h:104-309` |
| History with counts | `NavigationController::GoToOffset` | `content/public/browser/navigation_controller.h` |
| Focus state | `WebContents::IsFocusedElementEditable`, `ClearFocusedElement`, `WebContentsObserver::OnFocusChangedInPage` | `web_contents.h:1626-1629`, `web_contents_observer.h:994` |
| Search | `AutocompleteClassifier::Classify` | `components/omnibox/browser/autocomplete_classifier.h:60` |
| Scroll, hint collection | `RenderFrameHost::ExecuteJavaScriptInIsolatedWorld` + `ISOLATED_WORLD_ID_CHROME_INTERNAL` | `render_frame_host.h:624` |
| Hint click | `RenderWidgetHost::ForwardMouseEvent` (move, down, up) | `render_widget_host.h:183` |
| Tab ids, switching | `tabs::TabHandle`, `TabStripModel::ActivateTab`, `chrome::SelectNumberedTab/SelectLastTab` | `components/tabs/public/supports_handles.h`, `tab_strip_model.h:375` |
| Find next/previous | `chrome::FindNext/FindPrevious` | `browser_commands.h:293` |
| Clipboard | `ui::ScopedClipboardWriter`, `ui::Clipboard::ReadText` | `ui/base/clipboard/` |
| Favicons in the tab switcher | `favicon::ContentFaviconDriver::GetFavicon` | `components/favicon/content/` |
| Navigation, pointer activity | `WebContentsObserver::PrimaryPageChanged`, `DidGetUserInteraction` | `web_contents_observer.h:185,667` |
| Browser window without `BrowserView` | `BrowserWindow::CreateBrowserWindow` returns `CreateReactBrowserWindow` for normal and pop-up windows (patch 0068) | `chrome/browser/ui/views/frame/browser_window_factory.cc` |
| Tabs in a sidebar | `PrefService::SetDefaultPrefValue(prefs::kVerticalTabsEnabled)`, `tabs::VerticalTabStripStateController::SetVerticalTabsEnabled/RequestCollapse` | `components/prefs/pref_service.h:312`, `chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h` |
| Splits | `chrome::NewSplitTab`, `TabStripModel::AddToNewSplit/GetSplitForTab/GetSplitData/ReverseTabsInSplit/RemoveSplit` | `browser_commands.h:193`, `tab_strip_model.h:534-711` |
| Lazy restore | `chrome::AddRestoredTab` with one `SerializedNavigationEntry` per tab | `chrome/browser/ui/browser_tabrestore.h:46` |
| Hints in iframes | `RenderFrameHost::ForEachRenderFrameHost`, `IsCrossProcessSubframe`, `RenderWidgetHostView::TransformPointToRootCoordSpaceF`, the local root's `RenderWidgetHost::ForwardMouseEvent` | `render_frame_host.h:454,516`, `render_widget_host_view.h:114` |
| Pins | `TabStripModel::ExecuteContextMenuCommand(CommandTogglePinned)` (pins a split as a whole; `SetTabPinned` would pull one tab out of it), `IsTabPinned` | `tab_strip_model.h:518,798` |
| Session restore default | `SetDefaultPrefValue(prefs::kRestoreOnStartup, SessionStartupPref::kPrefValueLast)` | `chrome/browser/prefs/session_startup_pref.h:52` |
| Workspace windows | `chrome::OpenEmptyWindow`, `chrome::AddAndReturnTabAt`, `TabStripModel::CloseWebContentsAt` | `browser_commands.h:93`, `browser_tabstrip.h:33` |
| Menus by keyboard | `chrome::ExecuteCommand` with `IDC_SHOW_HISTORY`, `IDC_SHOW_DOWNLOADS`, `IDC_OPTIONS`, `IDC_MANAGE_EXTENSIONS`, `IDC_DEV_TOOLS_TOGGLE`, `IDC_BOOKMARK_THIS_TAB`, `IDC_NEW_WINDOW`, `IDC_NEW_INCOGNITO_WINDOW` | `chrome/app/chrome_command_ids.h` |
| History, bookmarks | `HistoryService::QueryHistory`, `BookmarkModel` tree | `history_service.h:340`, `bookmark_model.h` |
| browserctl socket | `net::UnixDomainServerSocket` (peer uid check) on the IO thread | `net/socket/unix_domain_server_socket_posix.h` |
| Front window for browserctl | `GlobalBrowserCollection::ForEach(..., Order::kActivation)` | `browser_collection.h:54` |
| External editor | `base::LaunchProcess` (argv, own process group, `disclaim_responsibility`), `base::SequenceBound` | `base/process/launch.h` |

## Known design debts

* Scrolling runs a constant script in Chrome's isolated world. It picks the
  focused element's scroller, the document, the scroller under the viewport
  center, or the largest visible scroller, in the focused frame. Synthesized
  wheel input would also cover canvas-based scrollers.
* Hints cover every frame, including cross-process iframes,
  except same-process frames that cannot see up to their local root. The
  outline and `:extract` read the main frame only. `:edit`, Visual mode and
  scrolling work in the focused frame.
* `browserctl` is built by Cargo and installed with
  `scripts/install_browserctl.sh`; it is not inside the app bundle.
* Marks are per window and not persisted.
* `OpenGURL` is slated for removal upstream; move to `TabListInterface` when
  it lands.
* Site-specific bindings (GitHub's `j`/`k`) do not exist yet;
  `passthrough_sites` and `[unmap]` cover those sites today.
* Error pages and certificate interstitials use Chromium's styling again
  since the Views interface was deleted, a limitation listed in the README.
* `modal_browser_controller.cc` (about 3,000 lines) and
  `merlin_shell_bridge_mac.mm` (about 1,300) hold too much; split the
  BrowserOps implementation, page scripts and shell snapshot code apart.

## Speed and memory defaults

* **No start-page WebUI.** New tabs open `about:blank` (the controller sets
  the new tab page override) and the shell draws the start page (`start/`)
  over it, so there is no WebUI page to load for a new tab.
* **No hidden Tab Search page.** The same target turns off Chromium's
  top-chrome WebUI preload (patch 0048); Merlin has its own tab switcher.
* **Typed addresses get a head start.** `MerlinSuggestions` reports to
  Chromium's address-bar predictor as `ChromeOmniboxClient` does: it
  registers results, asks `AutocompleteActionPredictor::RecommendAction`
  once per keystroke and when the top match changes, then preconnects or
  prerenders in the tab the field opens in; search prefetch and preload get
  each result. `Opened()` teaches the predictor, which prerenders only after
  repeated hits. Navigations carry `PAGE_TRANSITION_FROM_ADDRESS_BAR`, which
  prerender activation requires. Enter on the start page opens the top
  suggestion when the field still shows it. The `:` command line does not
  use this engine and gets none of it. Chromium's *Preload pages* setting
  and Energy Saver still decide whether any of it runs.
* **Memory Saver on by default** (a local-state default set by the
  controller; the Settings switch stores the user's choice).

## Native ad blocking

`MerlinAdblock` is independent of modal browsing and on by default;
`--disable-features=MerlinAdblock` is the kill switch.
A profile-keyed browser service owns preferences, exact-host exceptions,
readiness and document counts. Private profiles have independent in-memory
changes, no updater and no cache writes. Identical configurations share an
evaluator through a bounded weak registry.

Each evaluator constructs, accesses and destroys its Rust engine on one
**dedicated thread**. The upstream `single-thread` engine is not transferable
between threads, so a migratable sequenced task runner is insufficient.
A bounded background builder hands over serialized candidate data; publishing
is atomic and an invalid update retains the previous generation. No parser or
blocking engine wait runs on the browser UI thread.

Browser factory interception composes with Chromium's security and extension
policies. Complementary renderer and worker throttles check requests before
Service Worker synthetic/cache responses; native handshake hooks cover sockets.
Early Hints factories participate in embedder policies. Navigation CSP is
additive, including Service Worker responses. Decoded resource caches are
partitioned by browser-approved policy context and invalidated when settings
or rule generations change. Downloads and DevTools retain their own policies.

An acknowledged commit message delivers document configuration before the
first page script. MAIN-world scriptlets run in the actual main context;
helpers and isolated scriptlets use a reserved isolated world. Sandboxed
script-disabled and JavaScript-disabled documents receive no executable
scripts. Cosmetic observers, generic batches, queues and caches have explicit
bounds; BFCache and prerender preserve document lifetime semantics.

Lists and executable resources are separate trust boundaries. Fixed HTTPS
list updates use no cookies/referrers, validate complete candidates and keep a
rollback snapshot. Executable resources update only with the application.
The manifest records revisions, hashes, trust and licenses. The list audit
reports unsupported syntax rather than treating it as implemented behavior.
