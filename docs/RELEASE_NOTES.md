Merlin 0.2.0, a keyboard-driven browser for macOS built on
Chromium 157.0.8103.26.

**Requirements:** a Mac with Apple Silicon (M1 or later), macOS 14 Sonoma
or later (raised from macOS 13 in 0.1.0-beta.1). Intel Macs, Windows and Linux are not supported.

## Stable release

Merlin 0.2.0 is the first stable release. It uses the same compiled browser
as 0.2.0-beta.19, repackaged with the stable version and a fresh ad-hoc
signature. Existing browser profiles and settings are kept.

## Install

Install with [Homebrew](https://brew.sh):

```bash
brew install --cask kylianmarceau/tap/merlin
```

After the first launch attempt, approve Merlin in **System Settings >
Privacy & Security > Open Anyway**. To update, quit Merlin, then run:

```bash
brew update
brew upgrade --cask kylianmarceau/tap/merlin
```

The [Merlin tap](https://github.com/kylianmarceau/homebrew-tap) tracks stable
releases and checks hourly for updates. GitHub schedules can be delayed.
Your browser profile and settings are kept.

For a direct download:

1. Download `Merlin-<version>-arm64.dmg` below. To check the download,
   compare `shasum -a 256 ~/Downloads/Merlin-*.dmg` with the `.sha256` file.
2. Open the disk image and drag **Merlin** into **Applications**.
3. Open Merlin. macOS will say it can't check the app for malicious
   software: Merlin is not notarized by Apple.
4. Open **System Settings > Privacy & Security**, find the message about
   Merlin and click **Open Anyway**, then confirm **Open**. You only do
   this once per download.

To update a direct download, quit Merlin and replace the app in Applications.
Your bookmarks, passwords, history, workspaces and `config.toml` are kept. Merlin doesn't
update itself: **Watch > Custom > Releases** on this repository to hear
about new versions, including Chromium security updates.

## What's new since 0.2.0-beta.18

* **Videos float when you switch tabs.** A video playing with sound moves
  to a picture-in-picture window when you leave its tab, and goes back
  into the page when you return. Paused or muted videos stay put, and a
  window you floated yourself is never replaced. Turn it off in
  **Settings > General > Float videos when you switch tabs**.
* **Rounded picture-in-picture windows.** The floating video window now
  has rounded corners and a matching shadow, like Safari's.
* **Peek at a link.** `gf` labels the links on the page and opens the one
  you pick in a card floating over it; `:peek <address>` does the same for
  an address. Esc or switching tabs closes it, and **Open in Tab**
  (Command-Return) keeps the page as a tab next to the current one.
* **Tab groups you can see.** Groups, including those restored from a
  workspace, now show in the sidebar (a header with the group's colour and
  name, and a coloured line beside its tabs) and along the top (a label
  and a tint behind its tabs). Click a group to collapse it; right-click
  it to rename, recolour, ungroup or close it. A tab's menu adds it to a
  new or existing group or removes it. From the keyboard, `:group name`
  groups the current tab and `:ungroup` takes it out. `browserctl tabs`
  lists each tab's group.

## What's new since 0.2.0-beta.17

* **A new tab page that matches the icon.** The painted mound above the
  search box is replaced by the app icon's globe and wing, in the same
  thick paint and your workspace colour. The globe peeks over the top of
  the search box, with the wing arched over it to the falcon.

## What's new since 0.2.0-beta.16

* **Choosing Daylight works.** Picking the Daylight app icon in Settings
  showed Merlin's old flat falcon in the Dock. It now shows Daylight, while
  Merlin runs and after you quit.
* **The app icons use the original painting.** All nine colour themes are
  now drawn from the first Wrapped painting. Midnight is that original,
  so the separate Original choice is gone; if you had picked it, Merlin
  shows Midnight. Daylight, the default, is now on a white ground.

## What's new since 0.2.0-beta.15

* **A new, painted app icon.** Merlin's icon is now a falcon's wing of
  thick paint wrapped round a gilded globe, on a cream ground (Daylight).
* **Choose your app icon.** Settings › Appearance › App Icon offers ten
  colour themes: Daylight, Midnight, Original, Cobalt, Ember, Ocean,
  Aurora, Gilt, Forest and Blush. The Dock and the app switcher change at
  once, and the Dock keeps your choice after you quit Merlin. With macOS's
  Tinted or Clear icon style, Merlin shows its standard icon so macOS can
  restyle it.

## What's new since 0.2.0-beta.14

* **Drag downloads out.** Drag a finished file from the downloads panel
  or the Library to the desktop, a Finder window, Mail or a page's upload
  field, just as you would from Finder. Clicking it still opens it.
* **A loading bar instead of a spinner.** While a page loads, a thin bar
  runs along the bottom of the address field: quickly at first, then
  creeping on until the page is ready, then it fills and fades. Tabs no
  longer show a spinner. A tab that loads in the background gently pulses
  its icon.
* **Clearer download starts.** When a download starts, the file's icon
  lifts off the page and flies into the Downloads button, which nudges as
  it lands. While files arrive, a ring around the button fills with their
  progress (it circles until the size is known), with a count when several
  are downloading. With Reduce Motion the icon only fades.
* **Drag tabs into split view or a new window.** Drag a tab from the tabs
  onto the left or right half of the page to show it beside the current
  tab in a split view; the half it will take lights up. Drag a tab out of
  the window to give it a window of its own, under the pointer. In the
  sidebar you can now also drag tabs up and down to reorder them. A tab's
  right-click menu has **Open in Split View** and **Move to New Window**.

## What's new since 0.2.0-beta.13

* **Glass or Classic.** Settings › Appearance › Interface style. On
  macOS 26 or later, **Glass** draws popovers, menus and pop-ups in Apple's
  Liquid Glass. **Transparency** goes from nearly solid, through frosted
  (the default), to clear glass. You can tint the glass with your workspace
  colour and choose how strongly. **Classic** keeps everything solid.
  Toolbar buttons and the address bar look the same in both.
* **A new downloads panel.** Smaller and quieter: each file has its
  Finder icon, one line with its size, and a thin progress bar while it
  downloads. Show in Finder appears when you point at a file. Open folder,
  Remove and Retry are in its right-click menu, and **Clear** empties the
  list. With tabs on top, the Downloads button now sits at the far right,
  so the panel opens at the edge of the window rather than over the
  middle of the page.
* **New settings in General.** Make Merlin your default browser, open it
  at login, and ask before quitting with ⌘Q or before closing a window
  with several tabs. Choose whether typed text that looks like a website
  opens it or searches. Export your bookmarks to an HTML file.
* **Update checks, off by default.** Settings › General › Updates can ask
  GitHub Releases for a newer version when you click **Check Now**, or
  every eight hours. Choose the Stable or Beta channel. Merlin never
  downloads or installs anything itself.
* **New settings in Appearance.** Show the address bar in the toolbar or
  the sidebar. Choose a compact toolbar, a bookmarks bar, borderless
  windows, and a frame around the page (which can disappear in full
  screen). Set how strongly the selected tab glows, use thin scroll bars,
  and pick one of five alternate app icons (the Dock shows it while Merlin is open).
* **⌘L** opens the address in a pop-up in the middle of the window.

## What's new since 0.2.0-beta.12

* **Fixed: fullscreen video and PDFs kept the tabs and toolbar.** A
  page's fullscreen button (a YouTube video, a PDF, a game) made the whole
  window fullscreen but left the tabs, toolbar and address bar around the
  page. Now the page alone fills the screen, as in Chrome, and Esc brings
  everything back. Control-Command-F still makes the window fullscreen with
  its tabs and toolbar. Leaving fullscreen with the green button or Mission
  Control now also ends the page's fullscreen.

## What's new since 0.2.0-beta.11

* **Faster to open.** Merlin opens your existing windows about 120 ms
  sooner (460 ms from launch to the first page, against 577 ms before, on
  an M2). Chromium kept a temporary link to Merlin's program for an
  auto-updater Merlin doesn't have, and macOS then checked the whole program
  again before every launch. The window also appears as soon as it has
  drawn, without waiting for an empty frame first.
* **Faster tab switching.** Switching tabs shows the page sooner, about a
  display frame faster with few tabs open and more with many: the page's
  drawing surface is ready before you switch instead of being made during
  the switch, and the tab strip no longer rebuilds itself on every switch.
* Nothing looks or works differently.

## What's new since 0.2.0-beta.10

* **Fixed: Control-Tab did nothing on a Netflix tab.** While a WebKit page
  (Netflix and the other streaming sites) had the keys, Control-Tab and
  Control-Shift-Tab went to the page, and Netflix's player kept them. The
  browser's own tab, window and quit shortcuts now always reach Merlin
  first, as they do on Chromium pages.

## What's new since 0.2.0-beta.9

* **Fixed: Netflix went black after switching tabs.** Coming back to a
  Netflix tab showed a black picture while the sound played on. The video
  now stays on screen.

## What's new since 0.2.0-beta.8

* **Netflix plays.** Netflix, Disney+, Max, Prime Video, Hulu, Apple TV,
  Spotify's web player and similar services now open in WebKit, Safari's
  engine, inside the same tab, and their video plays. The tab looks and
  behaves like any other; Back from the site's first page returns to where
  you were. WebKit keeps its own sign-ins, so sign in to these services
  once more. Turn this off in **Settings > General > Protected video**, or
  right-click any tab to open its site in the other engine.
* **Widevine is gone.** It never got Netflix to play in Merlin's Chromium,
  so Merlin no longer downloads it. H.264 and AAC video still play.

## What's new since 0.2.0-beta.7

* **Fixed: Enter on the start page answers at once.** After typing an
  address or search on the start page and pressing Enter, the start page
  stayed on screen until the site had drawn, so it looked as if nothing
  had happened. It now clears straight away while the page loads.

## What's new since 0.2.0-beta.6

* **Fixed: you can see the cursor in text fields in Light mode.** With
  Merlin set to Light on a Mac in dark mode, the blinking cursor in the
  address bar, start page, pop-ups and find bar was drawn white on white.
  It is now black in Light mode and white in Dark mode.

## What's new since 0.2.0-beta.5

* **Fixed: Enter opens the highlighted suggestion.** On the start page and
  in the new-tab pop-up, typing `youtu` and pressing Enter searched Google
  for "youtu" even though YouTube was highlighted. Enter now opens the
  highlighted suggestion, and the first press of the down arrow moves to
  the next one.

## What's new since 0.2.0-beta.4

* **The toolbar matches the page.** With tabs on top, the active tab and
  toolbar take the colour the site draws along its top edge, so they run
  straight on into the page: YouTube's dark header gets a dark toolbar,
  GitHub's black one a black toolbar and a white page a white one, with
  no line between them. Text and icons turn light or dark to suit.
  Settings > Appearance > Site colour still offers the brand-colour styles
  (Soft and Vivid) and White.

## What's new since 0.2.0-beta.3

* **Fixed: pages no longer fade in.** Every page load used to stall and
  then cross-fade from black or grey into the new page. Pages now appear
  as soon as they paint, as in other browsers.
* **Start page searches** keep the start page up until the results paint,
  instead of flashing an empty page first.
* Address bar suggestions appear without an animation.

## What's new since 0.2.0-beta.2

* **Fixed: GitHub and other sites closing with "This page stopped
  working".** Pages that use web workers were ended by the browser because
  of a missing piece of the ad blocker; they now load normally.
* **Fixed: `:vsplit` and `:split`** now show both halves (one side used to
  stay blank). `:hsplit` works as another name for `:split`.
* **Ctrl+Tab walks through every recent tab again.** A tap goes to the tab
  you used last; hold `Ctrl` to see every tab as a card with a preview and
  press `Tab` to move through them. It had been stuck switching between
  two tabs.
* **New tabs as a pop-up:** `⌘T` opens the pop-up straight away, without a
  blank tab flashing open and closed behind it, and the cursor is in the
  search field, so typing and Escape work at once.
* **Pop-ups:** the command bar (`:` and `⌘K`), the new-tab pop-up and Run a
  Command are now the same size, in the middle of the window, and appear
  without a fade.
* **Start page:** its search field shows suggestions as you type, like the
  address bar.
* The toolbar and tab colours change instantly, and Merlin follows
  macOS's Reduce Motion setting.

## What's new since 0.1.0-beta.1

* **A new native interface.** The browser window, sidebar, address bar,
  pop-ups and Settings are now drawn natively (React Native for macOS)
  instead of with Chromium's own UI, in Merlin's new Tide design: one
  tinted shell over vibrancy, a white page card, glass pop-ups and
  Merlin's own icons.
* **New start page** with the workspace orb, and an option in
  Settings > Appearance to open new tabs as a search pop-up over the
  current page.
* **Tabs** join the toolbar, and switching tabs is faster.
* Escape now leaves the address bar, Find and the command bar.
* Widevine, AAC and H.264 for streaming sites (Spotify's web player and
  similar).
* Lighter: no Google field trials, Gemini, Cast or remote desktop host,
  and English only (about 47 MB smaller).
* Modal keys are optional: with them off, Cmd-K opens Merlin's menu and
  dragging a tab to the page's edge splits the window.

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
* `Ctrl+Tab` goes back to the tab you used last; hold `Ctrl` to see every
  open tab as a card and press `Tab` to move through them. Settings >
  General switches it to tab order.
* `⌘Q` quits at once, with no "Hold ⌘Q to Quit" panel.
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
* **Ad blocking is on by default and new.** If a site misbehaves, run
  `:adblock site toggle` on it, or turn protection off in Settings >
  Blocking.
* **No Google services:** no Sync, and features that need Google API keys
  don't work: Safe Browsing lookups, spell-check dictionary downloads,
  Translate and Google location.
* **Streaming sites run in WebKit.** Netflix and other DRM services open in
  WebKit, which keeps its own sign-ins and has no modal keys, link hints,
  find in page, downloads, ad blocking or Chromium history. After a
  restart such a tab comes back as the page before the site.
* **Chrome Web Store installs may be refused** or need manual steps;
  unpacked and `.crx` extensions work.
* **One profile.** Use workspaces and private windows to separate things.
* **Modal browsing has no switch in the new Settings yet.** To turn the
  modal keys on or off, set `modal_browsing = true` or `false` in
  `~/.config/modal_browser/config.toml` (Settings > Config File shows it).

## Reporting problems

Open an [issue](https://github.com/kylianmarceau/merlin/issues) with the
version from `chrome://version`, your macOS version and the steps to
reproduce. Report security problems privately: see
[SECURITY.md](https://github.com/kylianmarceau/merlin/blob/main/SECURITY.md).
