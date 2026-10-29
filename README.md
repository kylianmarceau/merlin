# Merlin

<img src="branding/merlin-app-icon.svg" alt="" width="96" align="right">

A macOS-first Chromium fork for people who think with the keyboard: an
everyday browser with Neovim-style modes, a real command line, and a Rust
core for the parts that make it different.

Name, logo and colors: [`branding/`](branding/README.md). `modal_browser`
remains the internal code name.

## What exists

* **Phase 1:** a Rust core for modes, focus-safe key handling, key
  sequences and counts, and a command registry, reached from `BrowserView`
  through a cxx bridge. Typing in page fields is never hijacked.
* **Phase 2 (keyboard-first alpha):** link hints (`f`, `F`, `yf`, `gi`),
  one palette for `:`, tabs (`b`) and commands (`?`), which-key hints,
  smart scrolling, clipboard motions, tabs in a sidebar, and
  `~/.config/modal_browser/config.toml`.
* **Phase 3 (daily driver and developer bridge):**
  * splits: `:vsplit [url]`, `:split [url]`, `<C-w>w` to move, `<C-w>x`
    to swap, `<C-w>o` to end
  * pins (`gp`), new and private windows (`:window`, `:private`), profiles
    (`:profile [name]`)
  * named workspaces: `:workspace save research`, `:workspace open
    research`, `gw` to pick one; windows opened from a workspace keep it
    saved; the last session reopens at launch
  * `browserctl` over a user-only Unix socket: `open`, `tabs --json`,
    `focus --tab N`, `current`, `selection`, `workspace save|open|list`,
    `command '<line>'`
  * edit a field in your editor (`ge` to pick one, Ctrl+Shift+E while
    typing in it, or `:edit`), written back on every save; passwords and
    payment fields never leave
  * workspaces tied to a project folder: `browserctl workspace here` in a
    repo opens that repo's tabs
  * history, bookmarks, downloads, settings, extensions and DevTools by
    keyboard: `gh`, `gb`, `gB`, `:downloads`, `:settings`, `:extensions`,
    `:devtools`
* **Phase 4 (a structurally navigable web):**
  * `gO`: the page outline (headings, code blocks, tables), fuzzy-searchable,
    foldable with ← →, Enter jumps
  * `]]`/`[[` headings, `]c`/`[c` code, `]t`/`[t` tables
  * `gl`: every link on the page, searchable
  * `yM` or `:extract markdown|text|links|code|headings [editor]`: clean
    Markdown and friends to the clipboard or your editor
  * `yc` copies a code block; `v` selects a block of text into Visual mode,
    where Vim motions extend the selection and `y` copies it
  * `:read` opens Chromium's Reading mode
  * hints reach into iframes (including cross-site ones) and web components
* **Also:** marks (`ma`, `'a`), macros (`qa` … `q`, `@a`), and your own
  commands in `[aliases]`.
* **Phase 5 (toward a beta):** session restore and workspace autosave for
  crash recovery, an upstream security-release checker, release build and
  signing scripts (not yet run: no Developer ID), license credits, a
  privacy inventory and an honest tester guide.

## Try it

```bash
scripts/check.sh               # fmt, clippy, Rust + C++ harness tests, script and patch checks
scripts/run_browser_tests.sh   # Chromium browser tests, headless, never takes focus
scripts/check_upstream.py      # is a Chromium security release waiting?
cargo run -p modalctl          # drive the modal core from a terminal
scripts/install_browserctl.sh  # then: browserctl tabs, browserctl workspace here
cargo run -p modal_browser_core --example check_config -- ~/.config/modal_browser/config.toml
scripts/bootstrap_chromium.sh  # what's missing to build the browser
```

With a built fork (see [`docs/TESTING.md`](docs/TESTING.md)):

```bash
~/chromium/src/out/Modal/Merlin.app/Contents/MacOS/Merlin --user-data-dir=/tmp/modal-profile
```

Press `?` to see everything you can do. To edit fields in terminal Neovim,
tell the browser which terminal to use, in `config.toml`:

```toml
[options]
editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]
```

## Docs

* [Architecture](docs/ARCHITECTURE.md): layers, FFI, focus policy, Chromium entry points
* [Decisions](docs/DECISIONS.md): what we chose and what it costs
* [Testing](docs/TESTING.md): commands, results, browser smoke test plan
* [Upstream](docs/UPSTREAM.md): pinned version, patch inventory, rebase and security process
* [Privacy](docs/PRIVACY.md): every file, socket and page read the fork adds
