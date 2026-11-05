# Decisions

Each entry: what we chose, why, and what it costs.

## 1. Fork Chromium directly

Chosen over CEF, Electron, WebKit/Wry and a new engine (decided before this
session). It gives full access to the browser shell, extensions, profiles,
DevTools and native UI. Cost: a large C++ codebase and a permanent
rebase/security-update duty (see `UPSTREAM.md`).

## 2. Overlay + patches repository, not a long-lived Chromium branch

This repo holds our code in `overlay/` (mirroring `src/` paths) and every
upstream edit as a small file in `patches/`. `scripts/apply_overlay.sh`
symlinks the overlay into a checkout and applies the patches. Brave
(brave-core) and Electron use variants of this layout.

* Why: upstream edits stay visible and countable (today: 3 patches, about
  45 added lines, 6 files, one of them test-only), rebases become "re-apply N small patches", and the
  Rust core builds and tests without a 100 GB checkout.
* Cost: a sync script to maintain. Symlinked overlay directories work with
  `gn gen`, `gn check` and the build (confirmed 2026-10-25).

## 3. Use Chromium's embedder hook for ownership

`EmbedderBrowserWindowFeatures` exists in Chromium for downstream embedders.
The controller lives there, so core `BrowserWindowFeatures` is untouched. The
only edit outside embedder files is a 12-line hook in
`BrowserView::PreHandleKeyboardEvent`, because no observer API offers
consumable key events there. Lookup does not go through the embedder class,
whose `From()` is unusable upstream (see `ARCHITECTURE.md`). A third,
test-only patch links our browser tests into `browser_tests`.

## 4. Rust decides, C++ executes

The Rust core returns typed actions and never calls browser APIs.

* Why: logic stays deterministic and unit-testable (89 tests run in under a
  second), FFI is one-directional with no shared mutable state, and Chromium
  keeps ownership of lifetimes and threading.
* Cost: every new browser capability needs a new `Action` variant plus a
  `BrowserOps` method in C++.

## 5. cxx for interop, pinned to Chromium's vendored version

`cxx` is Chromium's standard (`//docs/rust/ffi.md`). Cargo builds pin
`=1.0.202`, the version vendored at the pinned tag, so the bridge we test is
the one GN will build. Crubit is the stated future direction upstream; we
will revisit when Rust-calls-C++ support lands there.

## 6. Portable C++ router between bridge and Chromium

`ModalInputRouter` includes nothing from Chromium and talks to an abstract
`BrowserOps`. The Chromium implementation is one-line calls to `chrome::`
functions; the harness implementation is an in-memory browser.

* Why: the real C++ that consumes the bridge is compiled (clang,
  `-Wall -Wextra -Werror`) and tested today, before any Chromium build.
* Cost: one virtual call per action; negligible next to the action itself.

## 7. Zero third-party Rust dependencies in the core

Every crate must be vendored in Chromium, and **no TOML crate is vendored
at 156.0.8078.48** (`serde` and `serde_json` are).

Decided in Phase 2: **a strict TOML subset parser in the core**
(`core/src/toml_lite.rs`, about 440 lines; tests in `core/tests/config.rs`). It accepts tables,
dotted and quoted keys, strings, integers, booleans and arrays, and rejects
floats, dates, inline tables, multi-line strings and arrays of tables with
a line-numbered error.

* Why: users get real TOML syntax today, with no `//third_party` import
  (which would be a large patch to maintain on every rebase). Anything the
  subset accepts means the same to a full TOML parser, so switching to the
  `toml` crate later breaks no one's file.
* Cost: a small parser to own. It is bounded (256 KiB input) and fuzzable,
  and the browser reads the file off the UI thread.

## 8. Chromium Views for UI, no second shell

The palette's input is a standard `views::Textfield`, so editing, IME,
accessibility and keyboard layouts behave like every other Chromium field.
All three surfaces (palette, status pill, hint layer) are child widgets set
up like `FindBarHost`, including `Activatable::kNo`, whose comments document
macOS focus bugs Chromium already hit, and `ThemeCopyingWidget` so they
follow the window's light/dark theme. Their look is painted by hand from one
set of tokens (`modal_style.cc`) rather than borrowed from Chrome's dialogs,
so the product has its own visual language. No SwiftUI shell.

## 9. Safety defaults

* Never read typing as commands: an editable focus check runs on every key,
  independent of mode state.
* IME composition is never pre-handled (Chromium guarantees it; we check too).
* Command-key shortcuts are never swallowed.
* `javascript:`, `data:`, `blob:`, `filesystem:`, `vbscript:` URLs are refused
  by commands in Rust and again in C++, because the same registry will serve
  `browserctl` and plugins.
* Inputs are bounded (8 KiB command lines, URLs and clipboard text, 8-key
  sequences, counts up to 9999, 2000 hint targets, 500 tabs, 256 KiB config).
* Page scripts run only in Chrome's isolated world, are constant text with
  numbers interpolated, and their results are type-checked as untrusted.
  Hint collection reads kinds and rectangles, never text or values.
* Tests use an in-memory clipboard; they never touch the system pasteboard.
* No telemetry, accounts or network calls added. No sandbox, site-isolation
  or HTTPS changes.

## 10. Default bindings follow qutebrowser/Vimium

`j/k/h/l`, `gg/G`, `H/L`, `J/K`, `gt/gT`, `d/u`, `o/O`, `t`, `:`, `/`, `f`,
`i`, `v`, `<C-v>` (passthrough), `<C-l>` (address bar). Familiar muscle
memory beats novelty. Known conflict: sites with their own single-key
shortcuts (GitHub). Answer: Passthrough now, site rules later.

## 11. Workspaces are not profiles

Recorded from the plan so code never blurs it: profiles are Chromium storage
identities (cookies, credentials); workspaces are UI/session groupings that
may reference a profile. No workspace code exists yet.

## 12. One palette for `:`, tabs and commands

`:` (command line with completions and history), `b`/`T` (tab switcher) and
`?` (every command and binding, searchable) are one floating card near the
top of the page, not a bottom command line plus separate pickers.

* Why: one surface to learn and to polish. A newcomer presses `?`, types
  what they want, and sees its key; an expert types `:` and gets Vim
  semantics (Tab cycles completions, Up/Down walk history). Placing it near
  the top center keeps it where the eye already is, as in launchers like
  Raycast.
* Cost: Vim users expect `:` at the bottom. Position is one function
  (`PaletteHost::Layout`) if we make it configurable.
* State lives in Rust (`core/src/palette.rs`): text, rows, ranking,
  selection, what Enter does. C++ renders it and forwards edits and
  navigation keys.

## 13. Link hints drawn by the browser, followed with a real click

Targets are collected by a constant script in Chrome's internal isolated
world (`page_scripts.cc`), so page scripts can neither see the collection
nor spoof it. Only each target's kind and rectangle come back. Rust labels
and filters; Views draws the labels in a click-through overlay widget; the
chosen element is re-measured and clicked with synthesized mouse events
through `RenderWidgetHost::ForwardMouseEvent`.

* Why not inject labels into the page (Vimium's approach): page CSS and
  scripts can restyle, hide or detect them, and a page could fake labels.
  Browser-drawn labels look the same on every site.
* Why a real click instead of `element.click()`: it goes through hit
  testing and grants user activation, so popups, `target=_blank` and sites
  that check `isTrusted` behave as with the mouse.
* `F` (new tab) and `yf` (copy) read the link's `href` and only open
  http(s), or file: from a file: page. A browser-initiated navigation must
  not let a page open `chrome://` URLs it could not open itself.
* Cost: main frame only for now; cross-process iframes need per-frame
  geometry. Hints hide on click, scroll or navigation rather than
  following the page.

## 14. Configuration lives in `~/.config/modal_browser/config.toml`

`$XDG_CONFIG_HOME` first, then `~/.config`, as Ghostty and Neovim do on
macOS, rather than `~/Library/Application Support`. Developers keep these
files in their dotfiles. The browser only reads the file; parsing and
validation are in Rust, so `cargo run -p modal_browser_core --example
check_config -- file.toml` checks a file without starting the browser.
Reload is explicit (`:config-reload`) for now, not a file watcher.

## 15. Per-site Passthrough instead of per-site bindings, for now

`passthrough_sites` starts Passthrough automatically on matching hosts
(Gmail, Google Docs, Figma) and ends it when you leave, unless you entered
it yourself. `[unmap]` gives single keys back to every site. Per-site
bindings need a site-scoped keymap and are left for later.

## 16. The initial shell builds on Chromium's own vertical tabs

Tabs start in a sidebar, using the vertical tab strip Chromium 156 ships
(`chrome/browser/ui/views/tabs/vertical/`), not a tab strip of our own.
`:vertical-tabs [on|off]` switches layout and `gs` (`:sidebar`) collapses or
expands it, so both are reachable from the keyboard and listed under `?`.

* How: `PrefService::SetDefaultPrefValue(prefs::kVerticalTabsEnabled, true)`
  each time a window opens (`vertical_tabs` in the config can set it to
  false). Only the default changes; a layout the user picks is stored as a
  user value and always wins, and Chromium's controller observes the pref
  and switches live. No upstream file is patched.
* Why: a sidebar of tabs is the most recognisable part of the
  Arc/Dia-style shell, it suits keyboard switching (`b`, `J`/`K`), and
  reusing Chromium's implementation keeps drag-and-drop, groups,
  accessibility and session restore working.
* Not done: Chrome's own theme is left alone (it follows system light and
  dark). Seeding it with our accent would mean changing how Chrome decides
  a profile has a user color theme, which fights its theme model; our own
  surfaces carry the accent instead. A redesigned toolbar and omnibox are
  later work.

## 17. Splits use Chromium's own split view

`:vsplit` and `:split` (and `<C-w>v`/`<C-w>s`) create Chromium 156's split
tabs (`TabStripModel::AddToNewSplit`, layouts `kSideBySide` and
`kStacked`), not a split surface of our own.

* Why: Chromium's split view already handles focus, resizing, the tab
  strip, session restore and accessibility. Our part is the keyboard:
  `<C-w>w` moves between the halves, `<C-w>x` swaps, `<C-w>o` ends it.
* Cost: two panes per split, as in Chromium. Vim's arbitrary window trees
  are out of reach without our own layout code.

## 18. Workspaces are JSON files in the user's data directory

`$XDG_DATA_HOME/modal_browser/workspaces/<name>.json` (else
`~/.local/share/...`), written atomically (`ImportantFileWriter`), mode
0600 in a 0700 directory. Encoding, decoding and validation are Rust
(`core/src/workspace.rs`); C++ only moves bytes.

* JSON, not TOML: workspaces are data the browser writes, not
  configuration people edit, and the browserctl protocol needed JSON
  anyway. One small strict parser (`core/src/json.rs`) serves both, so the
  core still has no third-party dependencies (decision 7).
* Versioned (`"version": 1`); newer files are refused with a message
  instead of being half-read and overwritten.
* Only URLs, titles, pins, split pairs and the active tab are stored. A
  workspace is not a profile (decision 11). Private windows never save.
* Reopening restores into the current window when it holds only a new-tab
  page, otherwise into a new window. A window opened from a workspace
  keeps its file up to date (`workspace_autosave`), so a crash loses at
  most the last few seconds.
* Cost: all tabs load at once on restore; Chromium's lazy session-restore
  loading is not used yet.

## 19. browserctl talks over a user-only Unix socket

`$TMPDIR/modal_browser/browserctl.sock` (or `--modal-browser-socket`,
`$MODAL_BROWSER_SOCKET`), served with `net::UnixDomainServerSocket` on the
IO thread. No TCP port, no DevTools protocol.

* Access: the directory is created 0700 and must be owned by this user;
  peers whose uid differs are refused by credential check; one request
  line of at most 64 KiB per connection; 8 connections at most; idle ones
  close after 30 s.
* Requests are parsed in Rust (`core/src/ipc.rs`, shared with the CLI) and
  unknown commands or fields are errors. `command` runs through the same
  registry as `:`, so script URLs are refused there too.
* Private windows are never listed, read or driven. `browserctl = false`
  turns the socket off.
* Cost: same-user processes can drive the browser. That is the same trust
  boundary as the profile directory, which they can already read.

## 20. The external editor watches the file instead of waiting for exit

`:edit` (or `ge`) copies the focused field into a private temporary file,
starts the configured editor from an argv list (no shell), and writes the
text back on every save while the editor runs.

* Why watch: GUI launchers (`open -a`, a terminal's `-e`) often return at
  once. Writing back on each save works with any of them and feels live.
* Safety: passwords and fields marked `cc-*`, `one-time-code` or
  `*-password` never leave; names that merely look sensitive need `:edit!`.
  The value is read only after that check. Write-back goes to the same
  element (a random token kept in the isolated world), in the same frame
  and origin; if the page changed, the file is kept and its path shown so
  nothing is lost.
* Neovim in a terminal needs a terminal app to run in; the `editor` option
  says which (`["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]`). Without it,
  `$VISUAL`/`$EDITOR` are used as GUI editors.

## 21. Page structure is extracted in the isolated world, rendered in Rust

`gO` (outline), `gl` (links), `yM`/`:extract` (Markdown, text, links,
code, headings) and `]]`/`[[`/`]c`/`]t` all read the page through
constant scripts in Chrome's internal isolated world. The scripts return
blocks (kind, level, text, inline spans); Rust builds the outline and
renders Markdown with escaping, and drops link targets that are not web or
mail URLs.

* Why: one Markdown renderer, tested without a browser
  (`core/tests/document.rs`), and page content is treated as data: bounded
  (5000 blocks, 2 MB) and never persisted.
* Chromium's Reading mode stays available as `:read` for long-form
  reading; our outline is for navigating and copying, not restyling.
* Cost: main frame only; `main`/`article` is used when present, which
  suits docs sites but can miss content on unusual layouts.

## 22. Visual mode moves the page's own selection

`v` labels blocks of text; choosing one selects it and enters Visual mode,
where Vim motions call `Selection.modify` (`h`/`l` characters, `w`/`b`
words, `j`/`k` lines, `(`/`)` sentences, `{`/`}` paragraphs, `gg`/`G`)
and `y` copies. No caret of our own is drawn; the page's selection is the
caret.

* Cost: no Visual-line or block modes; motions follow the browser's idea
  of words and lines, which is good for prose and rough for code.

## 23. Page-level browser features through Chromium's command IDs

`:history`, `:bookmarks`, `:downloads`, `:settings`, `:extensions`,
`:devtools`, `:bookmark`, `:window`, `:private` run
`chrome::ExecuteCommand` with the same IDs as Chrome's menus, and the
`gh`/`gb`/`gw`/`:profile` palettes read history, bookmarks, workspaces and
profiles from their services. Nothing is reimplemented.

## 24. GitHub distribution without Developer ID or notarization

Updated 2026-11-02: the maintainer chose GitHub Releases without a paid
Apple Developer account. Skip Developer ID signing, notarization and
stapling; do not count them as blockers or recommend buying an account in
readiness reviews. Free ad-hoc signing needed for Apple Silicon is allowed.

Finish implementation, testing and packaging for that scope, including
installation from a downloaded artifact. `build/args.release.gn` remains the
distribution configuration, built by `scripts/build_release.sh`;
`scripts/package_mac.sh` ad-hoc signs the app and builds the DMG, checksum,
build info and dSYM archive (replaced 2026-11-04). Updates
remain manual (no Sparkle or Omaha). See [Release](RELEASE.md) for the
remaining work and unnotarized installation steps.

## 25. User-defined commands are aliases, not scripts

`[aliases]` in `config.toml` names a command line (`issues = "open
github.com/issues"`); typing the name runs it, with any extra words
appended. Aliases expand one level only (an alias of an alias is not
expanded), may not shadow built-in commands, and are validated when the
config loads. They appear in completion and under `?`, and bindings to them
bind what they stand for.

* Why: the plan's "controlled APIs for trusted plugins" starts with the
  registry every surface already shares. Aliases add names without adding
  power: nothing an alias does is beyond what the user could type.
* Real plugins (Lua or similar) wait for a permission model, as the plan
  says; `:script` is registered as planned so help shows where they go.

## 26. Marks and macros live in the core

`m{letter}` remembers the page and its scroll position, `'{letter}` (or
`` ` ``) goes back; lowercase marks stay on their page, uppercase ones
reopen it from anywhere. `q{a-z}` records the keys the modal layer handles
until the next `q`, `@{a-z}` replays them (`3@a`, `@@` repeats).

* Commands that take their argument from the next key (`m`, `'`, `q`, `@`)
  share one mechanism (`AwaitChar`), so which-key, counts and Esc behave
  the same for all of them.
* Macros replay through the same dispatch as real keys, with page focus
  assumed; keys the page would have received are dropped, a macro cannot
  play a macro, and one playback stops after 10,000 keys.
* Marks are per window and not saved to disk (Vim's viminfo equivalent is
  later work).

## 27. One chord is taken from text fields: the edit key

Typing in a field is never interpreted, with one exception: `edit_key`
(default Ctrl+Shift+E) opens the field in the external editor. It must use
Control or Command, so it can never be a character someone types; plain
Ctrl+E (end of line on macOS) is untouched. Before this, the only way to
`:edit` a field you were typing in was through `browserctl`.

## 28. Hints reach into iframes

Hint targets are collected in every live frame of the page (64 at most),
each in its own coordinates, and placed in the page by adding the
`frameElement` offsets the frame can see up to its local root and then
transforming through that root's view
(`RenderWidgetHostView::TransformPointToRootCoordSpaceF`). Clicks go to the
local root's widget, so out-of-process (cross-site) iframes get real input
events too. A same-process frame that cannot see up to its local root
(cross-origin within one process) is left out rather than mislabeled.

The outline and `:extract` still read the main frame only: content in
iframes is rarely the document a reader wants, and jumping back to it
needs the same frame tracking; it can follow when a page needs it.

## 29. Restored workspaces load lazily

Tabs other than the active one and its split partner are added with
`chrome::AddRestoredTab`, as session restore does: they show their title
and load when first selected. A 40-tab workspace opens at once.

## 30. Workspaces know their project

A workspace may name a project folder (`:workspace project <dir>`, or
`browserctl workspace project` from inside it). `browserctl workspace here`
opens the workspace whose project folder is the current directory or its
nearest ancestor, so a terminal in a repo can bring up that repo's tabs.
The folder is only matched as a path; the browser never reads it.

## 31. The product is called Merlin

The user-facing name is Merlin, with the fanned-tail mark on a cream tile
in `branding/` (first shipped as Kestrel with a diving-bird mark; renamed
in 37). `modal_browser` stays the internal code name in crates, Chromium
paths and `~/.config/modal_browser`, so nothing in the code or a tester's
config moves.

The build takes the name from `branding_file_path`, a GN argument, pointed
at `overlay/chrome/app/theme/merlin/BRANDING` by both args files, so
upstream's `chromium/BRANDING` is never edited. Patch 0004 is the only
upstream change: the Mac icon (`app.icns`, `Assets.car`) is read from
beside whichever BRANDING file is in use; `IDS_PRODUCT_NAME` says Merlin,
so menus read "About Merlin" and "Quit Merlin"; and `CrProductDirName`
is the short name, so the profile lives in `~/Library/Application
Support/Merlin` and never mixes with a real Chromium's. With default
branding that key is "Chromium", the same as upstream's fallback.

The compiled icons are checked in, as Chromium does with its own, and
`scripts/build_branding.sh` regenerates them from `branding/` and the
Icon Composer source. `MAC_BUNDLE_ID` was the placeholder
`local.merlin.Merlin` until 2026-11-04, when it became
`io.github.kylianmarceau.merlin` for GitHub releases. The remaining ~700 "Chromium" strings are left for a separate
pass.

## 32. Merlin's own look, mostly through Chromium's public hooks

The redesign replaces Chromium's look without forking
its UI. Each piece uses the narrowest hook that works:

* Colors: one mixer appended with
  `ColorProviderManager::AppendColorProviderInitializer`, redefining the
  `kColorSys*` base colors that the rest derive from. A Chrome theme, a
  user color, high contrast and forced colors switch it off.
* Start page: our own WebUI registered at runtime and made the new tab page
  through the default value of `kNewTabPageLocationOverride`, so a user or
  policy value still wins and private windows keep Chromium's page.
* Sidebar mode hides only the address field. Hiding the whole toolbar row
  crashed: bubbles anchor to its buttons and check that they exist.
* Three upstream patches, each small or generated: 0005 extends split
  view's inset and rounded corners to a single page, 0006 draws the active
  tab with the existing hover shape, 0007 renames the product in
  `chromium_strings.grd` and 15 other desktop string files by script.

`--modal-browser-upstream-defaults` still turns off everything except the
strings, which are compiled in; upstream tests that look for the word
"Chromium" in UI text now see "Merlin".

## 33. Nothing on screen names Chromium or Google

Round 2 of the redesign removes every visible trace of
Chromium, Chrome and Google, except the user agent, which keeps "Chrome" so
sites work, and merlin://credits, which must list Chromium's licenses.

* Strings: `scripts/rebrand_strings.py` rewrites the desktop string files
  and writes patch 0007. Word swaps are safe for "Chromium does X"
  sentences; legal lines are rewritten whole (OVERRIDES): the copyright
  reads "The Merlin Authors" and the license line "Made possible by
  open-source software", linking to credits.
* Logos: the GN argument `branding_path_component = "merlin"` makes grit
  read every product logo from Merlin folders in the overlay. Only
  chrome://version hard-codes `chromium/`, fixed by patch 0008. Logos
  drawn as code (WebUI icon sets, Views `.icon` files, the dark toolbar
  SVG) are replaced by `scripts/rebrand_icons.py`, patch 0009.
* `merlin://`: a display name. The bar, tab switcher, history, bookmarks
  and the ⌘L line show `chrome://x` as `merlin://x`; typing
  `merlin://x` opens `chrome://x`. The real scheme never changes, so
  Chromium's WebUI security checks, which key on `chrome://`, are
  untouched. Copying a URL (`yy`) and browserctl give the real URL.
* Assets are drawn from `branding/` (the tile, the glyph, the Syne
  wordmark) and checked in as PNGs, as Chromium does with its own.

## 34. Merlin's own pages, reached through one rewrite

Settings, History, Downloads and Bookmarks are Merlin WebUI pages
(chrome://merlin-settings and friends), not restyled Chromium pages:
Chromium's pages are large Polymer/Lit apps whose Google sections and
look cannot be removed without forking them.

* Reaching them takes patch 0010, one call in `HandleWebUI`. A runtime
  URL handler never sees chrome:// URLs (Chromium's WebUI handler claims
  them first), and serving a Merlin page under the `settings` host would
  share a data source name with Chromium's Settings, which Merlin still
  needs for its security pages.
* Security logic stays Chromium's. Site permissions, cookies, Safe
  Browsing, certificates, saved passwords, clearing data and the decision
  to keep a dangerous download open Chromium's own pages; Merlin hides
  their Google and AI menu and restyles, nothing more. Simple preferences
  are set directly through the prefs and services Chromium's settings use.
* `?classic` keeps Chromium's History, Downloads or Bookmarks page
  reachable, for the dangerous-download review.
* Pages are inline strings like the start page: no build step, nothing
  loaded until opened.

## 35. The Merlin menu is a palette, and ⋮ goes

Chromium's ⋮ menu and account button are taken out of view (1 px,
transparent, not clickable; hiding them outright crashed at startup when
the "Restore pages?" bubble anchored to ⋮). Their actions live in
the palette (`M`, `:palette menu`), where each row shows its key, and in
the Mac menu bar. `:browser <action>` covers what had no command. The
toolbar row stays in both layouts because it carries the anchors for
extension and download bubbles; removing it is what crashed in round 1.

## 36. Merlin draws its own back, forward, reload and address field

Chromium's buttons and location bar are hidden in the toolbar row, and
Merlin's own views take their place (`merlin_toolbar.cc`), added from
the controller like the spacer before them, so no patch. Restyling
Chromium's would have needed patches (its icons and the pill shape are
fixed in its views), and its field brings its own dropdown and focus
rules. The address field shows on sites and hides on the start page; it
displays the address and opens the palette to edit it, and its lock or
warning opens Chromium's page info. Hiding the whole row was looked at
again: `BrowserView::IsToolbarVisible()` has no hook, so it would need a
patch, and the download and extension bubbles would lose their anchors.

Chromium's field-trial testing config, which non-official builds such as
Merlin's apply, draws back, forward, reload and home in one small web
view (`WebUIToolbarWebView`) instead of native buttons. Hiding that view
crashes Chromium's toolbar overflow check, which reads its bounds from
the proposed layout, so Merlin gives it no width instead and makes
"Show forward button" off by default, so nothing in it counts as
overflowed. Native buttons, when present, are simply hidden.


## 37. Kestrel is renamed Merlin, with a fanned-tail mark

The product is now Merlin. "Kestrel" is also the name of ASP.NET Core's
web server, which crowds every developer search. A merlin is a small,
fast falcon, so the bird-of-prey idea stays.

The mark is a merlin's tail, fanned: five wedge feathers around a round
hub, forest `#12352E` with the middle feather rust `#C4552D`, on a cream
`#F2ECE0` tile. One script draws it everywhere (`scripts/merlin_mark.py`):
the branding SVGs, the Icon Composer layer, the Views `.icon` glyphs and,
through `scripts/rebrand_icons.py`, the WebUI paths in patch 0009. The
wordmark keeps Syne Bold, now in forest.

Everything named `kestrel` moved to `merlin`: the overlay folders and
`branding_path_component`, the `merlin_*` sources, the patches, the
`merlin://` page addresses and the BRANDING file (bundle ID placeholder
`local.merlin.Merlin`, creator code `Mrln`). The profile folder follows
the short name, so it is now `~/Library/Application Support/Merlin`; a
Kestrel profile is not carried over. The interface accent stays Hint
yellow `#F6D44A`: it belongs to link hints, not to the logo.

## 38. Merlin draws its own tab bar

Chromium's tab strip, on top and in the sidebar, is replaced by Merlin's
(`merlin_tab_bar.{h,cc}`), modeled on Dia's. The chrome around the page
is one even color. The active tab takes the color of the page under it
(`merlin_page_color.{h,cc}`), so tab, toolbar and page read as one
surface: white above a white site, black above a black one. The others
sit flat with no separators and take a soft fill on hover; titles fade
out instead of ending in an ellipsis; × shows on hover; pinned tabs are
icon tiles in one capsule; open, close and reorder are animated.

* On top: the active tab is cut from the toolbar, with a rounded top and
  bottom corners that flare out into it. The toolbar is the top of the
  page card (rounded top corners, the page's width), and the address has
  no box: host and title as text, a fill on hover.
* In the sidebar: one row per tab, the active one a card in the page's
  color; a "New tab" row last; rows scroll a whole row at a time when
  they do not fit, and switching tabs scrolls the active one into view.
  A collapsed sidebar shows icons only.
* Page color: the majority color of the page as drawn (read from the
  compositor, scaled down) — the whole page, not just its top edge, so
  scrolling does not change it and the bar does not flicker as a page
  moves under a sticky header. Nothing when no color clearly dominates
  (a photo), then the toolbar's own. Read on load and first paint, then
  left alone; kept per tab so switching back shows it at once. Text and
  icons on it pick light or dark ink by its luminance. See PRIVACY.md.
* How: the bar is a child of `BrowserView` laid over Chromium's strip
  (`MerlinTabBarHost` keeps the bounds equal and follows the switch
  between top and sidebar). Chromium's strip stays in the layout,
  transparent and deaf to the mouse, so the window keeps its shape, the
  traffic lights keep their place and bubbles that anchor to the strip
  still find it. Every action goes through `TabStripModel` (select,
  close, move, Chromium's tab menu), so nothing else in Chromium sees a
  difference. The toolbar's own background must stay Chromium's (it is
  checked), so the page color is painted by a view under its children.
* Why patches: on the Mac, a click that `NonClientHitTest` calls caption
  never reaches a view; it moves the window. Chromium asks its own strip,
  which cannot know about Merlin's tabs. 0011 lets a view over the strip
  answer through `views::kHitTestComponentKey`, the property Chromium
  already uses for the same purpose in app windows. 0005 takes a radius
  per corner and hides the top separator, so the page meets the toolbar
  square and without a line.
* Tab groups: on top, a chip in the group's color with its name (a dot
  for an unnamed group) and a line in that color under its tabs; in the
  sidebar, a header row with a dot and a chevron, the rows set in a
  little with the line beside them. Clicking a header folds the group
  (its tabs hide; the chip shows how many) and the active tab moves out
  of it, as in Chromium; right-click opens Chromium's own group editor
  (name, color, ungroup, close, move to a new window).
* Dragging a tab well clear of the bar lifts it (it fades). Dropped over
  another window's tabs, it moves there, where it was dropped; anywhere
  else it opens in a new window with the tab under the mouse (a window's
  only tab moves its window instead). Unlike Chromium, the window does
  not follow the mouse during the drag; it appears on drop.
* The sidebar's edge resizes it: Merlin's bar has its own strip there
  and hands the drag to Chromium's sidebar, which snaps to the default
  width, folds to icons when dragged narrow, and saves the width.
* Not done: scrolling tabs on top (they shrink to their icons first),
  dragging a whole group by its header, and dropping onto a window whose
  tabs Chromium draws (fullscreen). In fullscreen, Chromium moves its
  strip into a separate widget; Merlin's bar steps aside and Chromium's
  shows.

## 39. Merlin edits the address in its own card

Clicking the address (or ⌘L) used to bring back Chromium's own field and
its dropdown, which looked like Chrome: an outlined box and Chrome's
result rows. Now the address lifts into a Merlin card
(`merlin_address_editor.{h,cc}`) that opens over it: the address,
selected, at the same place the toolbar showed it, with no box; as you
type, the card grows downward with the results, in the palette's colors,
shadow and row style.

* Results come from Chromium's address-bar engine
  (`merlin_suggestions.h`, shared with the start page): searches with
  the default engine, pages from history and bookmarks with their
  favicons and a quieter address, open tabs tagged "Switch to tab". The
  first result completes the text in place, as Chromium's field does.
* Keys as in Chromium's field: ↑/↓ pick a row, Enter opens it (⌥ or ⌘
  for a new tab), Tab accepts the completion, Esc or a click on the page
  closes the card and drops the edit. With no row picked, Enter reads the
  text as Chromium would (an address, or a search, keywords included).
  javascript:, data:, blob: and filesystem: addresses are not opened.
* Rows are painted in one view; transparent option views expose their names,
  selection, positions and actions to accessibility. The text field controls
  the suggestion list and announces its active descendant while retaining
  keyboard focus. The card's
  widget cannot be activated, so the address keeps keyboard focus while
  the mouse is used on the rows.
* The card and suggestion engine translate `merlin://` aliases through the
  same Rust URL policy as commands. Internal pages show the same Merlin alias
  in the editor and passive address display; ordinary input still uses
  Chromium's address/search classifier.
* Chromium's field stays hidden in normal windows; features that need it
  still check IsLocationBarVisible().
* Not done: Chromium's special rows (pedals, answers, "Ask Google about
  this page", clipboard), keyword mode chips, and the text following the
  row picked with ↑/↓.

## 40. No status bar under the page

The bar under the page card (mode chip, page title, key hints) is gone:
it repeated what the toolbar shows and framed the page in a second strip.
The page card now has the same 8-point margin on its sides and bottom,
square at the top where it meets the toolbar and rounded below.

* The mode, the keys typed so far, the latest message and running
  downloads show in the floating pill the status used before the bar, in
  the bottom-left corner of the page, only while there is something to
  say. In Normal mode with nothing to report, nothing covers the page;
  Normal's name shows only in front of keys being typed.
* The which-key and help panel opens above the pill, as before.
* Dropped with the bar: the workspace name and the "? help, f hints,
  : command" key hints. `?` and `:` still work from anywhere.

## 41. Hide the tabs (Cmd-S)

As in Dia, Cmd-S hides the tabs entirely, the row on top or the sidebar,
and shows them again. The toolbar row moves up beside the window
controls, the page runs edge to edge under it with no card margin, and
the row and the space under the window controls take the page's color,
so the window is one surface. Tabs stay reachable from the keyboard
(Cmd-1 to 9, Ctrl-Tab, `b` for the tab list).

* Per window: Cmd-S or `:hide-tabs [on|off]` toggles the current window.
  Settings > Appearance > Hide tabs writes `hide_tabs` to the config file;
  that is the state new windows start in, and changing it applies to
  every open window. A reload that leaves `hide_tabs` alone does not undo
  a window's Cmd-S.
* Chromium has no "no tab strip" state for normal windows, so patch 0012
  adds one to BrowserView: the layout then treats the window like one in
  content fullscreen, with no tab strip at all, rather than Merlin
  covering Chromium's strip with something else.
* The page gets Cmd-S first. Sites that save with it (Docs, Figma, the
  config editor in Settings) keep doing so; Merlin's shortcut is a
  normal-priority accelerator that runs only when the page leaves the key
  alone. Save Page As moves to Shift-Cmd-S, in the File menu as before.

## 42. Safety controls remain available when tabs are hidden

The toolbar has a separate, keyboard-focusable site-controls button on web
pages, including secure HTTPS pages and while editing the address. It opens
Chromium's own Page Info UI for permissions, cookies and certificates; a lock
is not used as a claim that the site is trustworthy. Patch 0013 lets Page Info
and permission bubbles anchor to a visible replacement location icon when
the original location bar is hidden, rather than to hidden chips.

Pinned and compact tabs retain camera, microphone and capture badges, and
their accessible names and tooltips describe the alert. Merlin subscribes to
Chromium's tab-alert changes rather than waiting for a title change to repaint.
A toolbar Recording/Sharing control also lists capturing tabs in the current
window, including background tabs and those hidden in groups or by Cmd-S.
Users can view a capturing tab or stop its user-media/display-media capture
through Chromium's existing capture service. Menu actions retain tab handles
and revalidate window ownership and current capture state. Managed all-screen
capture remains subject to Chromium's separate policy restrictions.

Private windows show an explicit Private label in both tab layouts and with
tabs hidden. Page-colour tinting steps aside for high contrast and forced
colours, without invalidating the document's cached sample.

## 43. Workspace restoration transfers the project as well as the name

The restore action carries the optional project folder through Rust, the cxx
bridge and the portable router. When opening a new window, its session receives
both the workspace name and project before later autosaves. Previously only
the name reached the destination, so autosave could erase the saved project
association and break `browserctl workspace here`. An absent project clears
any old association; transferred paths are validated as on initial assignment.

`browserctl workspace here` also rechecks that its destination still accepts
browserctl after the asynchronous workspace lookup. Disabled and private
windows are excluded on both sides of that lookup.


## 44. One profile, no profile UI

The maintainer does not want profiles in the browser. Merlin keeps the one
Chromium profile it needs for storage (`Default`) and removes every way to
see or change it. Patch 0051 removes the Profiles menu (menu bar and Dock),
never shows the profile picker at startup or from a menu, turns off guest
mode and adding profiles (regardless of policy), and disables the profile
menu, close-profile, add, guest and manage commands. The picker still opens
for Chromium's recovery cases (a locked profile, or one that cannot open a
window), so the app is never left with nothing to show. Merlin's `:profile`
command, profiles palette and Settings "Profile name and picture" row are
gone. Workspaces and private windows cover separating browsing; decision 11
still holds.

## 45. Release builds use PGO; no search prewarm

The first release build measured Speedometer 3.1 about 20% below Brave and
Dia ([Performance](PERFORMANCE.md)). It was built without profile-guided
optimization because the checkout lacked Google's profile; Chrome, Brave and
Dia ship with it. `build/args.release.gn` now uses it: `.gclient` sets
`"checkout_pgo_profiles": True` (the bootstrap script adds it) and
`scripts/build_release.sh` refuses to build without the profile. It costs an
86 MB download per Chromium version and nothing at run time.

A trace of tab switches showed Merlin's browser-side switch work on par with
Brave's; the benchmark's 25 ms vs 11 ms difference did not reproduce. The one
Merlin-specific work in the trace was Chromium's search prewarm: with Google
as the default search engine, each tab prerenders a hidden
`google.com/search/warmup.html` when the address bar's results change, as on
a tab switch (up to 11.5 ms of browser main-thread work, a renderer and a
request to Google with its cookies). Merlin searches from its own address
card and start page and turns it off (patch 0052), as Brave effectively does
by not defaulting to Google. The cost: a first Google search in a tab may
start a little slower. `--enable-features=Prewarm` brings it back.

## Native ad blocker integration (2026-11-02)

Embed pinned `adblock` 0.13.3 through its own Cargo/GN wrapper and nonthrowing
CXX bridge. Use the compatible audited dependency graph rather than weakening
Chromium's dependency-age policy for 0.13.5. Keep the feature independent of
modal browsing and disabled by default until correctness, live playback and
performance qualification are complete.

A dedicated thread owns each non-Send engine, with a bounded serialized
builder and atomic generation replacement. Factory composition preserves
Chromium security/extension policies. Additional pre-Service-Worker checks,
worker brokers, socket hooks and renderer-cache partitions are necessary:
factory-only filtering misses synthetic/cache responses and decoded resources.
Shared/service workers use owning-origin exceptions; attributable dedicated
workers use their top-level document. Executable resources update with the
application, while fixed HTTPS list endpoints can refresh without visited URLs,
cookies or referrers. See [the evidence and limitations](ADBLOCK_IMPLEMENTATION.md).

This task implements and tests the blocker. Packaging and GitHub publication
are deferred at the maintainer's explicit request.
