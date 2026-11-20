<div align="center">

<img src="branding/merlin-pixel.svg" alt="Merlin pixel falcon" width="112">

<h1>Merlin</h1>

<p>A Chromium browser for macOS that you can drive entirely from the keyboard, with Vim keys.</p>

<p>
  <a href="https://github.com/kylianmarceau/merlin/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/kylianmarceau/merlin?label=release&color=c2410c"></a>
  <img alt="Platform" src="https://img.shields.io/badge/macOS_14+-Apple_Silicon-292524">
  <img alt="Chromium" src="https://img.shields.io/badge/Chromium-157-292524">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-BSD--3--Clause-292524"></a>
</p>

<p>
  <a href="#install"><b>Install</b></a> ·
  <a href="#features">Features</a> ·
  <a href="#keys">Keys</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#privacy-and-your-data">Privacy</a> ·
  <a href="#limitations">Limitations</a> ·
  <a href="#build-from-source">Build</a>
</p>

</div>

<!-- TODO: add a screenshot of a browser window here, e.g.
<p align="center"><img src="docs/images/merlin.png" alt="Merlin with link hints on a page" width="900"></p>
-->

Merlin is Chromium with a modal keyboard layer and its own native macOS
interface. You can follow links, switch tabs, split the window, search your
history and edit text fields in Neovim without touching the mouse. Sites,
extensions, passwords and DevTools work as they do in Chrome.

Typing in a text field always goes to the page, and any site can have its
own shortcuts back. If you only want a clean Chromium, switch off
**Settings › Keys › Modal browsing**: every key then goes to the page, and
everything stays a click or ⌘K away.

> [!NOTE]
> Merlin needs an Apple Silicon Mac (M1 or later) and macOS 14 Sonoma or
> later. It is ad-hoc signed and not notarized by Apple, so macOS asks you to
> approve it once (see below).

## Install

### Homebrew

```bash
brew install --cask kylianmarceau/tap/merlin
```

### Direct download

1. Download `Merlin-<version>-arm64.dmg` from the
   [latest release](https://github.com/kylianmarceau/merlin/releases/latest).
   To check it, compare `shasum -a 256 ~/Downloads/Merlin-*.dmg` with the
   release's `.sha256` file.
2. Open the disk image and drag **Merlin** into **Applications**.

### First launch

Open Merlin. macOS says it can't check the app for malicious software,
because Merlin isn't notarized by Apple. Open **System Settings › Privacy &
Security**, click **Open Anyway** next to the message about Merlin, then
**Open**. You only do this once per download, and there is no need to turn
off Gatekeeper.

### Updating

Merlin doesn't update itself. Quit it, then:

```bash
brew update
brew upgrade --cask kylianmarceau/tap/merlin
```

Or download the new release and replace the app in Applications. Your
bookmarks, passwords, history, workspaces and `config.toml` are kept.
**Settings › General › Updates** can check GitHub for new versions (off by
default), and **Watch › Custom › Releases** on this repository announces
them. Releases follow Chromium's security updates: the aim is a release
within three days of a Chromium Stable security fix, and within a day for
bugs exploited in the wild.

### Uninstalling

```bash
brew uninstall --cask merlin
```

or drag Merlin from Applications to the Bin. `brew uninstall --zap --cask
merlin` removes your data as well; otherwise, to remove it, delete:

- `~/Library/Application Support/Merlin` and `~/Library/Caches/Merlin` (the
  browser profile and its cache)
- `~/.config/modal_browser` (configuration) and `~/.local/share/modal_browser`
  (workspaces)
- `~/Library/Preferences/io.github.kylianmarceau.merlin.plist` (interface
  settings)
- `~/Library/WebKit/io.github.kylianmarceau.merlin` and
  `~/Library/HTTPStorages/io.github.kylianmarceau.merlin` (sign-ins for
  streaming sites)

## Features

**Modes.** Normal for moving around, Insert for typing (entered
automatically when a field is focused), Visual for selecting text, Command
for the `:` line, Hint for link labels and Passthrough to send every key to
the site. Outside Normal mode a slim line under the page shows the mode and
the keys typed so far; in Normal mode nothing is shown.

**Link hints.** `f` labels every link on the page and you type the label to
follow it. `F` opens it in a new tab, `yf` copies it, `gi` jumps to a text
field and `gf` peeks at the link in a card floating over the page (`⌘↩` keeps
it as a tab, `Esc` closes it). Hints reach into iframes and web components.

**One palette.** `:` and ⌘K take commands, addresses and searches. `b`
switches tabs and `?` searches every command and shows its key. Everything
is fuzzy-matched. Pause after a prefix like `g` or `<C-w>` and the line
under the page lists every key that can follow.

**Long pages.** `gO` opens an outline of headings, code blocks and tables.
`]]` and `[[` jump between headings, `]c` between code blocks and `]t`
between tables. `gl` lists every link on the page, `yM` copies the page as
Markdown and `yc` copies a code block.

**Tabs and splits.** Tabs in a sidebar or along the top, or hidden with `⌘S`.
Split the window with `<C-w>v` or `<C-w>s`, or drag a tab onto either half
of the page. Pin tabs with `gp`. Group tabs from a tab's menu or with
`:group research`; a group can be renamed, recoloured and collapsed.
Control-Tab goes to the tab you used last; hold Control to see every tab as
a card.

**Workspaces.** Save a window with `:workspace save research` and reopen it
later with `gw`: its tabs, pins, splits, groups and place on screen come
back. Workspaces save as you go, and your last session comes back on launch,
even after a crash. A workspace can be tied to a project folder and opened
from that folder's terminal with `browserctl workspace here`.

**Edit in your editor.** Press `ge` to pick a field, or `Ctrl+Shift+E` while
typing, and the text opens in Neovim or any editor you configure. Saving
writes it back to the page. Password and payment fields are never sent out.

**Ad blocking.** On by default, using Brave's Rust filter engine natively,
not as an extension: network requests, cosmetic filters, scriptlets and
pop-ups. Choose lists and turn it off in **Settings › Blocking**, or for one
site with `:adblock site toggle`.

**Video.** H.264 and AAC play in Chromium. Netflix, Disney+, Prime Video,
Spotify's web player and other DRM services open in WebKit (Safari's engine)
inside the same tab, where they play. A video playing with sound floats in a
picture-in-picture window when you switch tabs and goes back when you
return.

**Marks and macros.** `ma` sets a mark and `'a` returns to it. `qa` … `q`
records a macro and `@a` replays it. Counts work too, as in `5j`.

**Scripting.** `browserctl` controls the running browser from a terminal,
Neovim or a script. See [browserctl](#browserctl).

**Looks.** **Settings › Appearance** offers ten workspace colours, Glass (Liquid
Glass, on macOS 26) or Classic surfaces (macOS 14 and 15 always draw
Classic panels, over a translucent window), the address bar in the sidebar or the
toolbar, toolbars that take the site's colour, a bookmarks bar, a frame
around the page, a pixel falcon app icon, and eight painted alternatives.
Dark mode uses neutral charcoal surfaces. Merlin follows macOS's light and
dark mode and Reduce Motion.

## Keys

Press `?` in the browser for the full, searchable list. `Esc` returns to
Normal mode (`Shift+Esc` in Passthrough).

| Key | Action | Key | Action |
|---|---|---|---|
| `j` `k` `h` `l` | Scroll | `gg` / `G` | Top / bottom |
| `<C-d>` / `<C-u>` | Half page down / up | `H` / `L` | Back / forward |
| `f` / `F` | Follow link / in new tab | `gi` | Focus a text field |
| `o` / `O` | Open URL or search / in new tab | `t` | New tab |
| `J` / `K` | Next / previous tab | `b` | Switch tab |
| `d` / `u` | Close tab / reopen | `r` / `R` | Reload / hard reload |
| `/` then `n` `N` | Find in page | `yy` | Copy URL |
| `gO` | Page outline | `gl` | Links on the page |
| `<C-w>v` / `<C-w>s` | Split side by side / stacked | `<C-w>o` | Close split |
| `gw` | Workspaces | `ge` | Edit field in your editor |
| `:` or `⌘K` | Command line | `?` | Search commands and keys |

<details>
<summary><b>More keys</b></summary>
<br>

| Key | Action | Key | Action |
|---|---|---|---|
| `<C-f>` / `<C-b>` | Page down / up | `gu` / `gU` | Up one level / site root |
| `ym` | Copy Markdown link | `yf` | Copy a link |
| `yc` | Copy a code block | `yM` | Copy page as Markdown |
| `p` / `P` | Open URL from clipboard / in new tab | `gp` | Pin tab |
| `]]` / `[[` | Next / previous heading | `]c` / `[c` | Next / previous code block |
| `]t` / `[t` | Next / previous table | `<C-w>w` / `<C-w>x` | Next split / swap splits |
| `gf` | Peek at a link | `:group` / `:ungroup` | Group tab / take it out |
| `gh` / `gb` | Search history / bookmarks | `v` | Visual mode |
| `ma` / `'a` | Set / go to mark | `qa` … `q`, `@a` | Record / play macro |
| `i` | Insert mode | `<C-v>` | Passthrough mode |
| `M` | Merlin menu | `⌘S` | Hide / show tabs |

</details>

## Configuration

Merlin reads `~/.config/modal_browser/config.toml` (or
`$XDG_CONFIG_HOME/modal_browser/config.toml`). Every setting is optional;
**Settings › Config File** opens and saves it. Run `:config-reload` to apply
changes without restarting. Errors are reported with their line number, and
the rest of the file still loads.

```toml
[options]
modal_browsing = true         # false: every key goes to the page
hint_chars = "sadfjklewcmpgh"
smooth_scroll = true
passthrough_sites = ["mail.google.com", "*.figma.com"]

# Edit fields with Neovim in Ghostty
editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty",
          "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]

[keys.normal]
"<C-n>" = "tabnext"
",g" = "open https://github.com"

[aliases]
notes = "workspace open notes"

[unmap]
normal = ["d"]                # give this key back to sites
```

<details>
<summary><b>Every option</b></summary>
<br>

| Option | Default | What it does |
|---|---|---|
| `modal_browsing` | `true` | Modes, hints and key bindings. `false` sends every key to the page; Settings › Keys › Modal browsing writes this |
| `scroll_step` | `60` | Pixels per `j`/`k`/`h`/`l` step |
| `smooth_scroll` | `true` | Animate page-sized jumps (`gg`, `G`, `<C-d>`, `<C-f>`) |
| `sequence_timeout_ms` | `1000` | How long a prefix like `g` waits for the next key |
| `hint_chars` | `"sadfjklewcmpgh"` | Characters for hint labels, easiest first |
| `auto_insert` | `true` | Enter Insert mode when a text field gets focus |
| `vertical_tabs` | `true` | Tabs in a sidebar by default; a layout you pick in the window wins |
| `hide_tabs` | `false` | Start with the tabs hidden |
| `passthrough_exit` | `"<S-Esc>"` | The key that leaves Passthrough (plain `Esc` goes to the site) |
| `passthrough_sites` | `[]` | Sites that start in Passthrough; `"*.example.com"` also matches `example.com` |
| `restore_session` | `true` | Reopen last session's windows at launch; Settings › General › On startup wins |
| `workspace_autosave` | `true` | Keep a workspace's file up to date as its window changes |
| `browserctl` | `true` | Accept `browserctl` commands over a socket only you can reach |
| `editor` | `$VISUAL`, then `$EDITOR` | The program `:edit` runs, as a list; `"{file}"` is the temporary file |
| `edit_key` | `"<C-S-e>"` | While typing, opens the field in your editor |

Tables: `[keys.normal]` and `[keys.visual]` map keys in Vim notation (`<C-x>`
Control, `<D-x>` Command, `<A-x>` Option, `<S-x>` Shift) to command lines.
`[aliases]` defines your own commands, which appear in completion and under
`?`. `[unmap]` gives keys back to sites. Appearance is in Settings, not in
this file. [docs/config.example.toml](docs/config.example.toml) is a
commented example of everything.

</details>

## browserctl

`browserctl` talks to the running browser over a Unix socket that only your
user can open. There is no network listener, and private windows are not
visible to it.

It isn't in the app yet. Install it from a clone of this repository with
[Rust](https://rustup.rs):

```bash
git clone https://github.com/kylianmarceau/merlin.git
cd merlin
scripts/install_browserctl.sh                # installs to ~/.local/bin
```

```bash
browserctl open https://docs.rs              # open in a new tab
browserctl open --current rust lifetimes     # search in the current tab
browserctl tabs --json                       # list tabs, with their groups
browserctl focus --tab 3
browserctl selection                         # print the selected text
browserctl workspace here                    # open this folder's workspace
browserctl command 'vsplit https://docs.rs'  # run any : command
```

Turn it off with `browserctl = false` in the config.

## Privacy and your data

Merlin has no telemetry, crash reporting, accounts or AI features. On top of
Chromium it adds two kinds of network request, both over HTTPS with no
browsing data attached:

- **Filter lists** for the ad blocker, from EasyList and GitHub. Turn off
  automatic updates in **Settings › Blocking**.
- **Update checks** to GitHub Releases, only if you turn them on in
  **Settings › General › Updates**.

Gemini, Lens, Help me write, Cast and Google's field trials are off, and
Merlin has no Google API keys, so nothing goes to Google Sync or Safe
Browsing either (see [Limitations](#limitations)). Chromium's own requests,
such as extension updates from the Chrome Web Store, work as in Chromium.

[docs/PRIVACY.md](docs/PRIVACY.md) lists every file, socket and piece of
page data Merlin touches. Everything else stays on your Mac: the Chromium
profile in
`~/Library/Application Support/Merlin`, `config.toml`, workspaces (`0600`
JSON files), interface settings in macOS's defaults and WebKit's separate
site data for streaming services. Text you send to your editor goes through
a private temporary file, deleted when the edit ends (it is kept, and its
path shown, only if writing it back fails).

## Limitations

Merlin is Chromium underneath, so rendering, the sandbox, site isolation,
passwords, autofill, PDFs, DevTools and extensions behave as in Chrome.
These are the differences; [docs/CAPABILITIES.md](docs/CAPABILITIES.md) has
them all in one table, with how each is tested:

- **No Safe Browsing.** Chromium's phishing and malware lookups need Google
  API keys that Merlin doesn't have. Other security warnings, such as for
  certificates, still work.
- **No Google Sync, Translate or spell-check downloads**, for the same
  reason. Bookmarks and passwords stay on your Mac.
- **No automatic updates.** Use Homebrew or replace the app; see
  [Updating](#updating).
- **Streaming sites run in WebKit.** Merlin's Chromium has no Widevine.
  WebKit tabs keep their own sign-ins and have no modal keys, link hints,
  find in page, downloads, ad blocking or Chromium history; commands that
  need them say "Not available in WebKit tabs". Bookmarks, workspaces,
  `browserctl` and session restore keep the WebKit page itself, and Clear
  browsing data clears both engines. A site's sign-in pop-ups open in their
  own window. Right-click a tab to move a site between engines (every tab on
  it moves), or turn this off in **Settings › General › Protected video**.
- **One profile.** Use workspaces and private windows to keep browsing apart.
- **No Reading mode or side panels.** Extensions that use a side panel or
  `chrome.action.openPopup()` don't get them.
- **Chrome Web Store installs may need extra steps.** Unpacked and `.crx`
  extensions work.
- **Error pages look like Chromium's.** Network errors and certificate
  warnings use Chromium's own styling, in Merlin's name.
- **Apple Silicon only.** No Intel, Windows or Linux builds.

## Build from source

This repository holds only Merlin's code: the Chromium overlay (`overlay/`),
small patches to Chromium (`patches/`) and the React Native macOS interface
(`apps/browser/`, `packages/`). The build links the overlay into a Chromium
checkout at the version pinned in [`UPSTREAM_PIN`](UPSTREAM_PIN), builds the
engine and the interface separately, then assembles them into one app.

**Requirements:** an Apple Silicon Mac, full Xcode, about 100 GB of free
disk space and 16 GB of RAM, Python 3, Rust, Node 22.13 or later, pnpm 10.28
and CocoaPods. The first Chromium checkout and build take several hours.

```bash
# Chromium's tools
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git ~/depot_tools
export PATH="$PATH:$HOME/depot_tools"

# Merlin
git clone https://github.com/kylianmarceau/merlin.git
cd merlin

# Check the machine, then fetch Chromium at the pinned version
scripts/bootstrap_chromium.sh
scripts/bootstrap_chromium.sh --fetch

# Link Merlin into the checkout, apply the patches, add the blocker's data
scripts/apply_overlay.sh
~/chromium/src/third_party/cpython3/host/bin/python3 scripts/prepare_adblock_deps.py --src ~/chromium/src
python3 scripts/prepare_adblock_resources.py

# Build the engine (optimized, PGO) and the interface
scripts/build_release.sh
scripts/build_react_shell.sh

# Assemble them into one app
python3 scripts/assemble_react_app.py \
  --engine-app ~/chromium/src/out/Release/Merlin.app \
  --shell-app apps/browser/build/native/Build/Products/Release/MerlinShell.app \
  --output apps/browser/build/assembled/Merlin.app
open apps/browser/build/assembled/Merlin.app
```

Chromium is checked out to `~/chromium` by default; set `CHROMIUM_DIR` for
another path (without spaces). The engine on its own (`out/Release/Merlin.app`)
opens Chromium's windows without Merlin's interface or keys, so always run
the assembled app. Each build script stamps its product with the commit it
was built from and its binary's UUID (`scripts/stamp_build.py`). Assembly
refuses a product built from other sources, or rebuilt without its build
script, and an output that already exists. It records both products' commits,
the lockfiles' hashes and every binary's UUID, which the end-to-end tests
(`scripts/run_e2e_tests.sh`) and packaging check. Packaging a release is covered in
[docs/RELEASE.md](docs/RELEASE.md), and the interface's architecture and
Metro development setup in [apps/browser/README.md](apps/browser/README.md).

### Development

```bash
pnpm ui:check && pnpm ui:test  # interface types, state, protocol and design rules
scripts/check.sh               # formatting, lints, Rust and C++ tests, patch checks
scripts/run_browser_tests.sh   # ad-blocker tests inside Chromium (needs a build)
scripts/run_e2e_tests.sh       # end-to-end tests against the assembled app
scripts/check_upstream.py      # is there a newer Chromium security release?
cargo run -p modalctl          # try the modal core in a terminal, no Chromium needed
```

The Rust core (modes, keymaps, commands, config, hints, workspaces) and the
interface's checks build and test without a Chromium checkout.

| Path | Contents |
|---|---|
| `overlay/components/modal_browser/` | Rust modal core and its C++ bridge |
| `overlay/chrome/browser/ui/modal_browser/` | Modal controller, the React window and its engine bridge, config, preferences |
| `overlay/components/merlin_adblock/`, `overlay/chrome/{browser,renderer}/merlin_adblock/` | Ad blocker: Brave's engine, request interception, list updates, cosmetic filtering and scriptlets |
| `apps/browser/` | The React Native macOS interface and its host app |
| `packages/` | Native modules: the engine bridge, AppKit views, WebKit pages |
| `patches/` | Edits to Chromium's own files, one small patch each |
| `tools/` | `browserctl`, `modalctl` and a fake-browser test harness for the C++ router |
| `tests/e2e/` | End-to-end tests that drive the assembled app ([how they work](tests/e2e/README.md)) |
| `scripts/` | Setup, build, test and packaging |

## Documentation

| | |
|---|---|
| [Interface](apps/browser/README.md) | How the React Native shell, the engine bridge and Chromium fit together |
| [Design](apps/browser/DESIGN.md) | The interface's surfaces, type, colours, spacing and motion |
| [Architecture](docs/ARCHITECTURE.md) | The modal input core, its Rust and C++ split, and the Chromium hooks it uses |
| [Capabilities](docs/CAPABILITIES.md) | What is supported, what falls back and what is unavailable, and how each is tested |
| [Testing](docs/TESTING.md) | Every test suite, what it proves and what CI runs |
| [End-to-end tests](tests/e2e/README.md) | How the app is tested from the outside |
| [Upstream](docs/UPSTREAM.md) | The Chromium pin, every patch, and how to rebase onto a new Stable release |
| [Release](docs/RELEASE.md) | Building, packaging and installing a release |
| [Release notes](docs/RELEASE_NOTES.md) | What changed, and known issues |
| [Privacy](docs/PRIVACY.md) | Every file, socket and piece of page data Merlin touches |
| [Configuration example](docs/config.example.toml) | Every `config.toml` option, commented |
| [Security policy](SECURITY.md) | Reporting problems and supported versions |
| [Dependency patches](pnpm-patches/README.md) | Fixes carried for React Native macOS and Expo |

## Contributing

Bug reports and pull requests are welcome. Please include the version from
`chrome://version`, your macOS version, steps to reproduce, and whether stock
Chromium at the same version does the same.

## Security

Please don't report security problems in a public issue. Use **Report a
vulnerability** on this repository's
[Security tab](https://github.com/kylianmarceau/merlin/security), which opens
a private advisory ([SECURITY.md](SECURITY.md) has the details). Problems in Chromium itself belong in
[Chromium's tracker](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/);
Merlin picks up the fix with its next Chromium update. Only the newest
release gets fixes.

## License

Merlin's code is released under the [BSD 3-Clause License](LICENSE).
Chromium and the other bundled software keep their own licences, listed in
the credits shipped with each release.

Merlin is built on [Chromium](https://www.chromium.org/). Its keyboard model
borrows heavily from Vim, Neovim, Vimium, qutebrowser and Tridactyl, its ad
blocking uses [Brave's adblock-rust](https://github.com/brave/adblock-rust),
and parts of its macOS interface are adapted from
[Ardia](https://github.com/ardia-browser/ardia) (Apache 2.0; see [NOTICE](NOTICE)).
