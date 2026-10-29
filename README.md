<div align="center">

<img src="branding/merlin-app-icon.svg" alt="Merlin" width="128">

# Merlin

**The browser for people who think with the keyboard.**

Neovim-style modes, a real command line and a Rust core, built on Chromium for macOS.

[Features](#features) · [Keys](#keys) · [Build](#build-from-source) · [Configure](#configuration) · [browserctl](#browserctl) · [Docs](#documentation)

</div>

---

Merlin is an everyday browser that you can drive entirely from the keyboard.
Follow links with two keystrokes, split pages side by side, jump between the
headings of a long doc, edit any text field in Neovim, and script the
browser from your terminal. Underneath it is Chromium, so sites, extensions,
DevTools and security work the way you expect.

It never gets in your way: typing in a page's text field is never taken
over, sites with their own shortcuts can have their keys back, and every
binding can be changed.

## Features

### Modes

| Mode | What it is for |
|---|---|
| **Normal** | Moving around: scroll, follow links, switch tabs, run commands |
| **Insert** | Typing in a page; entered automatically when a text field gets focus |
| **Visual** | Selecting text with Vim motions, then `y` to copy |
| **Command** | The `:` command line, with completion |
| **Hint** | Labels on every link or field; type a label to act on it |
| **Passthrough** | Every key goes to the site (Gmail, Figma, web terminals, games) |

The current mode, workspace and page are always shown in the status bar
under the page.

### Navigation

* **Link hints**: `f` follows a link, `F` opens it in a new tab, `yf` copies
  it, `gi` jumps to a text field. Hints reach into iframes and web
  components.
* **One palette for everything**: `:` for commands and URLs, `b` for tabs,
  `?` to search every command and its keys, with fuzzy matching.
* **Which-key hints** show what a prefix like `g` or `<C-w>` can do next.
* **Smooth, smart scrolling** with counts: `5j`, `gg`, `G`, `<C-d>`.
* **Marks and macros**: `ma` then `'a` to come back, `qa` … `q` then `@a` to replay.

### Reading the web like a document

* `gO` opens the **page outline**: headings, code blocks and tables,
  fuzzy-searchable and foldable.
* `]]` / `[[` jump between headings, `]c` / `[c` between code blocks,
  `]t` / `[t` between tables.
* `gl` lists **every link on the page**, searchable.
* `yM` copies the whole page as **clean Markdown**; `:extract` also does
  text, links, code and headings, to the clipboard or your editor.
* `yc` copies a code block; `v` starts a selection you extend with Vim motions.
* `:read` opens Reading mode.

### Tabs, splits and workspaces

* **Two layouts**: a slim tab sidebar, or soft pill tabs on top
  (`:set tabs=top`).
* **Splits**: `<C-w>v` side by side, `<C-w>s` top and bottom, `<C-w>w` to
  move between them, `<C-w>x` to swap, `<C-w>o` to close the split.
* **Pinned tabs** with `gp`.
* **Workspaces**: `:workspace save research` and `:workspace open research`,
  or `gw` to pick one. Workspaces save themselves as you work, and your last
  session comes back at launch, even after a crash.
* **Project workspaces**: tie a workspace to a folder, then run
  `browserctl workspace here` in that repo to bring its tabs back.
* Private windows (`:private`), new windows (`:window`) and profiles
  (`:profile work`).

### Your editor, everywhere

Press `ge` to pick a text field, or `Ctrl+Shift+E` while typing in one, and
it opens in your editor. Every save is written back to the page. Password
and payment fields never leave the browser.

### Merlin's own look

Warm stone and charcoal colors in light and dark, the page on a rounded
card, a status bar instead of an address bar, and a start page with your
workspaces and recently closed tabs one key away.

## Keys

Press `?` in the browser to search every command and its current keys. The
most used ones:

| Key | Action | Key | Action |
|---|---|---|---|
| `j` `k` `h` `l` | Scroll | `gg` / `G` | Top / bottom |
| `<C-d>` / `<C-u>` | Half page down / up | `<C-f>` / `<C-b>` | Page down / up |
| `f` / `F` | Follow link / in new tab | `gi` | Focus a text field |
| `o` / `O` | Open URL or search / in new tab | `t` | New tab |
| `H` / `L` | Back / forward | `r` / `R` | Reload / without cache |
| `J` / `K` | Next / previous tab | `b` | Switch tab |
| `d` / `u` | Close tab / reopen it | `gp` | Pin tab |
| `/` then `n` `N` | Find in page | `gu` / `gU` | Up one level / site root |
| `yy` | Copy URL | `ym` | Copy Markdown link |
| `yf` | Copy a link | `yc` | Copy a code block |
| `yM` | Copy page as Markdown | `p` / `P` | Open URL from clipboard |
| `gO` | Page outline | `gl` | Links on the page |
| `]]` `[[` | Next / previous heading | `]c` `[c` | Next / previous code block |
| `<C-w>v` / `<C-w>s` | Split side by side / stacked | `<C-w>o` | End split |
| `gw` | Workspaces | `gh` / `gb` | Search history / bookmarks |
| `ge` | Edit a field in your editor | `v` | Select text (Visual) |
| `ma` / `'a` | Set / go to mark | `M` | Merlin menu |
| `i` | Insert mode | `<C-v>` | Passthrough mode |
| `:` | Command line | `?` | Search commands and keys |

`Esc` returns to Normal mode. In Passthrough, `Shift+Esc` does.

## Build from source

Merlin is built on top of a Chromium checkout. This repository holds only
Merlin's own code (`overlay/`) and a short list of small patches to
Chromium (`patches/`), so it stays small and easy to review.

**You need:** a Mac with Apple Silicon, full Xcode, about 100 GB of free
disk space, 16 GB of memory or more, and a few hours for the first download
and build.

```bash
# 1. Chromium's tools
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git ~/depot_tools
export PATH="$PATH:$HOME/depot_tools"

# 2. Merlin
git clone https://github.com/kylianmarceau/merlin.git
cd merlin

# 3. Check your machine, then download Chromium at the pinned release (long)
scripts/bootstrap_chromium.sh
scripts/bootstrap_chromium.sh --fetch

# 4. Link Merlin into the checkout and apply its patches
scripts/apply_overlay.sh

# 5. Build (long the first time)
cd ~/chromium/src
gn gen out/Modal
autoninja -C out/Modal chrome

# 6. Run
open out/Modal/Merlin.app
```

The Chromium checkout goes to `~/chromium` by default; set `CHROMIUM_DIR`
to use another folder (no spaces in the path). The Chromium release Merlin
is built on is pinned in [`UPSTREAM_PIN`](UPSTREAM_PIN).

## Configuration

Merlin reads `~/.config/modal_browser/config.toml` (or
`$XDG_CONFIG_HOME/modal_browser/config.toml`). Everything is optional, and
`:config-reload` applies changes without restarting. Mistakes are shown with
their line number, and everything else still applies.

```toml
[options]
tabs = "top"                  # or "side"
hint_chars = "sadfjklewcmpgh"
smooth_scroll = true
restore_session = true
passthrough_sites = ["mail.google.com", "*.figma.com"]

# Edit fields in terminal Neovim, inside Ghostty
editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty",
          "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]

[keys.normal]
"<C-n>" = "tabnext"
",g" = "open https://github.com"
",v" = "vsplit"

[aliases]
issues = "open github.com/issues"
notes = "workspace open notes"

[unmap]
normal = ["d"]                # give this key back to sites
```

Every option is explained in
[`docs/config.example.toml`](docs/config.example.toml).

## browserctl

`browserctl` controls the running browser from a terminal, Neovim or a
script. It talks over a Unix socket that only your user can open: there is
no network listener, and private windows are invisible to it.

```bash
scripts/install_browserctl.sh                # installs to ~/.local/bin
```

```bash
browserctl open https://docs.rs              # new tab
browserctl open --current rust lifetimes     # search in the current tab
browserctl tabs --json
browserctl focus --tab 3
browserctl current
browserctl selection                         # the selected text
browserctl workspace save|open|delete <name>
browserctl workspace here                    # this folder's workspace
browserctl command 'vsplit https://docs.rs'  # run any : command
```

Turn it off with `browserctl = false` in the config.

## Privacy

Merlin adds no telemetry, no accounts, no update checks and no AI services:
its own layer makes no network requests at all. It writes only your
workspaces and the temporary files used while you edit a field, all
readable by your user only. [`docs/PRIVACY.md`](docs/PRIVACY.md) lists every
file, socket and piece of page data it touches.

## What to know

Merlin is Chromium, so rendering, JavaScript, site isolation, the sandbox,
permissions, passwords, autofill, DevTools, PDFs, profiles and extensions
work as in Chromium. A few things do not:

* **No Google Sync.** Bookmarks and passwords stay in your local profile.
* **No DRM or proprietary codecs.** Netflix, Spotify's web player and some
  H.264-only video will not play.
* **Chrome Web Store installs may need manual steps.** Unpacked and `.crx`
  extensions work.
* **No automatic updates yet.** Rebuild on a new pin to get Chromium's
  security fixes.
* **macOS on Apple Silicon only** for now.

## Development

```bash
scripts/check.sh               # format, lint, Rust and C++ tests, script and patch checks
scripts/run_browser_tests.sh   # browser tests inside Chromium, headless
scripts/check_upstream.py      # is a Chromium security release waiting?
cargo run -p modalctl          # try the modal core in a terminal, no Chromium needed
```

The Rust core (modes, keymaps, commands, config, hints, workspaces) builds
and tests on its own with `cargo`, without a Chromium checkout.

| Path | What it holds |
|---|---|
| `overlay/components/modal_browser/` | The Rust core and its bridge to C++ |
| `overlay/chrome/browser/ui/modal_browser/` | The browser side: input, palette, status bar, Merlin's pages |
| `patches/` | Every edit to Chromium's own files, one small patch each |
| `tools/` | `browserctl`, `modalctl` and a test harness that fakes the browser |
| `branding/` | Name, logo and colors |
| `scripts/` | Setup, build, test and packaging scripts |

## Documentation

* [Architecture](docs/ARCHITECTURE.md): how the layers fit together and where Merlin hooks into Chromium
* [Decisions](docs/DECISIONS.md): what was chosen, why, and what it costs
* [Testing](docs/TESTING.md): test suites, results and the manual test plan
* [Upstream](docs/UPSTREAM.md): the pinned Chromium release, every patch, and the update process
* [Privacy](docs/PRIVACY.md): every file, socket and piece of page data Merlin touches
* [Branding](branding/README.md): name, logo and palette

## Reporting issues

Open an issue with the version (from `chrome://version`), the steps to
reproduce, and whether stock Chromium at the same version behaves the same.
Please don't report security problems in a public issue; contact the
maintainer privately instead.

## Acknowledgements

Merlin is built on [Chromium](https://www.chromium.org/). The keyboard model
owes a lot to Vim, Neovim, Vimium, qutebrowser and Tridactyl.
