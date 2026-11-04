The first public beta of Merlin, a keyboard-driven browser for macOS built
on Chromium 157.0.8103.26.

**Requirements:** a Mac with Apple Silicon (M1 or later), macOS 13 Ventura
or later. Intel Macs, Windows and Linux are not supported.

## Install

1. Download `Merlin-<version>-arm64.dmg` below. To check the download,
   compare `shasum -a 256 ~/Downloads/Merlin-*.dmg` with the `.sha256` file.
2. Open the disk image and drag **Merlin** into **Applications**.
3. Open Merlin. macOS will say it can't check the app for malicious
   software: Merlin is not notarized by Apple.
4. Open **System Settings > Privacy & Security**, find the message about
   Merlin and click **Open Anyway**, then confirm **Open**. You only do
   this once per download.

To update, quit Merlin and replace the app in Applications. Your bookmarks,
passwords, history, workspaces and `config.toml` are kept. Merlin doesn't
update itself: **Watch > Custom > Releases** on this repository to hear
about new versions, including Chromium security updates.

## What's in it

* Neovim-style modes: Normal, Insert, Visual, Command, Hint and Passthrough,
  with counts, remapping, aliases, marks and macros.
* Link hints (`f`, `F`, `yf`, `gi`) that reach into iframes and web
  components.
* One fuzzy palette for commands, URLs, tabs, history, bookmarks and
  workspaces; `?` searches every command and its keys.
* Reading tools: page outline (`gO`), heading/code/table jumps, a list of
  every link, copy the page as Markdown, Visual-mode selection, Reading mode.
* A tab sidebar or tabs on top, hidden tabs (`⌘S`), tab groups, pinned
  tabs and splits (`<C-w>v`, `<C-w>s`).
* Workspaces that save themselves, restore your session after a crash and
  can be tied to a project folder.
* Edit any text field in Neovim or your own editor (`ge`).
* `browserctl` to drive the browser from your terminal or editor.
* Merlin's own start page, Settings, address card and pop-ups, in light
  and dark.

Press `?` in the browser for every key, or read the
[README](https://github.com/kylianmarceau/merlin#readme).

## Known limitations

* **Not notarized.** macOS asks for approval on first launch (see Install).
* **No automatic updates.** Replace the app by hand for each release.
* **Ad blocking is opt-in and experimental.** To try it, quit Merlin and
  start it with `open -a Merlin --args --enable-features=MerlinAdblock`.
* **No Google services:** no Sync, and features that need Google API keys
  don't work: Safe Browsing lookups, spell-check dictionary downloads,
  Translate and Google location.
* **No DRM or proprietary codecs.** Netflix, Spotify's web player, Disney+
  and some H.264-only video won't play.
* **Chrome Web Store installs may be refused** or need manual steps;
  unpacked and `.crx` extensions work.
* **One profile.** Use workspaces and private windows to separate things.

## Reporting problems

Open an [issue](https://github.com/kylianmarceau/merlin/issues) with the
version from `chrome://version`, your macOS version and the steps to
reproduce. Report security problems privately: see
[SECURITY.md](https://github.com/kylianmarceau/merlin/blob/main/SECURITY.md).
