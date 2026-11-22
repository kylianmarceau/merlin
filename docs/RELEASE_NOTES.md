Merlin 0.5.8, a keyboard-driven browser for macOS built on Chromium.

**Requirements:** a Mac with Apple Silicon (M1 or later), macOS 14 Sonoma
or later (raised from macOS 13 in 0.1.0-beta.1). Intel Macs, Windows and Linux are not supported.

## What's new in 0.5.8

* **A new first launch.** Watch a short film set in a Norwegian fjord under the northern lights, then choose your appearance, tab placement and workspace colour. You can mute, skip or replay the film. Merlin skips it automatically when Reduce Motion is on.
* **An interactive keyboard tutorial.** Practise following a link hint and jumping down the page in an offline field guide. Both exercises also work with a mouse. Setup resumes where you left off, and Help › Keyboard Tutorial reopens the guide anytime.
* **Clearer installer layout.** The document labels in the disk image stay above the Finder scrollbar.

## What's new in 0.5.7

* **Downloads stays visible.** Open recent downloads from the top tab strip or sidebar even after clearing the list.

## What's new in 0.5.6

* **A new look for New Tab.** Merlin’s pixel falcon sits above the search box, and the round Go button carries the logo’s terminal prompt (`>_`).

## What's new in 0.5.5

* **Fewer interruptions.** Bookmarking, copying a link, and zooming no longer bring up floating notifications. The status line under the page shows command results and browser errors. Update availability appears in Settings › General › Updates.

## What's new in 0.5.4

* **Picture in Picture for WebKit video.** Supported videos can float when you switch tabs, including when the player disables the page’s Picture in Picture control. Right-click or Control-click a video to enter or exit Picture in Picture, even over custom player controls.
* **Quieter tab closing.** The notification that appeared after closing a tab has been removed.

## What's new in 0.5.3

* **Neutral Dark mode.** The window, sidebar, Settings and new tab page now use charcoal gray. The workspace colour still appears on highlights and controls.
* **Ten workspace colours.** Graphite, Gold, Teal, Indigo, Lavender, Rose and Ruby join Sage, Ocean and Ember under Settings › Appearance. Choose Graphite for gray accents.

## What's new in 0.5.2

* **Wider tabs on top.** Standard tabs now reach 173 points when there’s room, giving page titles more space.

## What's new in 0.5.1

* **Keep pinned tabs available.** ⌘W closes the page and keeps its pin and the browser window open. Click the pin to reload the page.
* **A steady New Tab button.** The sidebar shows one New Tab button and keeps it visible when the tab list fills.
* **Updated Dock icon.** Merlin’s default icon matches the size of other macOS Dock icons more closely.

## What's new in 0.5.0

* **Keep video in view.** WebKit tabs can now enter picture-in-picture
  automatically when you switch away, like Chromium tabs. The sidebar
  media player lets you play, pause and skip when the site supports it.
  Tabs show when media is paused or muted.
* **Organize tabs and favourites by dragging.** Drop tabs together to
  group them, and organize favourites into folders. Folders and tab groups
  show how many unread tabs they contain. Tabs can also be renamed and
  given a custom icon from their menu.
* **More room for top tabs.** The tab strip scrolls when tabs reach their
  minimum width and holds their widths while you close tabs in succession.
* **Clearer browser feedback.** Merlin shows page zoom changes, draws its
  own back and forward swipe indicator, and displays site sign-in prompts
  and page dialogs in the browser shell. Closing a tab offers to reopen it.
* **Easier to find settings and history.** Search Settings to find a
  preference, and see repeat visits to the same page together in History.
* **A new app icon.** The pixel falcon is Merlin's default app icon and
  appears on the new tab page.

## What's new in 0.4.0

A pass over the whole interface to make it calmer and more finished, in
the spirit of Dia.

* **A cleaner sidebar.** Your Bookmarks bar folder now sits in the sidebar
  under your pinned tabs (fold it with its heading, or turn it off in
  Settings › Appearance › Bookmarks). Drag the sidebar's right edge to
  resize it; double-click the edge to reset it. A "Current tab" button
  appears when the active tab is scrolled out of sight. Double-clicking the
  empty space under your tabs opens a new one.
* **Hover cards.** Resting on a tab shows its full title and address with
  one-click actions: pin, bookmark, split, mute and copy link. A pinned tab
  that has wandered off its page shows a dot, and a way back to the page it
  was pinned on.
* **Tooltips with shortcuts** on the window's buttons, and holding (or
  right-clicking) Back or Forward lists the pages that way.
* **A quieter address field.** At rest it reads "site / page title"; with
  the pointer on it, the full address appears with bookmark and copy-link
  buttons. The star left the toolbar for the address field.
* **⌘S slides the tabs away**, and the traffic lights go with them. Move
  the pointer to the window's left edge (or top, with tabs on top) and the
  tabs float in over the page until the pointer leaves.
* **Bookmarks.** ⌘D and the bookmark button save straight into the
  Bookmarks bar, with an Edit button in the confirmation. The Bookmarks bar
  can show always, only on new tabs (the new default) or never.
* **Tabs.** New tabs can open at the top of the list (Settings ›
  Appearance › Tabs). Tabs playing sound get a mute button; sleeping tabs
  are dimmed. The tab menu gains Reload, Mute, Add to Bookmarks bar, Copy
  Link, Close Tabs Below and, for pinned tabs, Back to Pinned Page. Long
  titles fade out instead of running under the close button.
* **Fewer Chrome leftovers.** The menu bar no longer offers Chrome's Lens,
  AI Mode, Cast, vertical tabs, Name Window or Extensions items, or a
  second Enter Full Screen. The start page is called New Tab everywhere,
  never chrome://newtab.
* Pinning the first or only tab now shows at once; before, the tabs kept
  showing it unpinned until something else changed.

Known issue: after the pointer leaves the address field upwards or out of
the window, its copy-link button can stay hidden until the next click.

## What's new in 0.3.3

* **Typing in the new-tab pop-up no longer flickers.** The suggestions
  under the new-tab pop-up, the start page and the address field used to
  grey out and lose their highlight for a moment on every key. They now
  stay put until the new ones arrive.
* **No more green shade behind pop-ups.** The command bar (`:` and ⌘K),
  the new-tab pop-up and ⌘L in the centre no longer darken the window
  with a green tint; a click outside them still closes them. Settings and
  the Library dim it in neutral grey. In dark mode, those pop-ups stay
  readable over white pages.
* **Clear in the downloads panel works.** It removed only the ten most
  recent downloads, so with a longer history the next ten took their place
  and nothing seemed to happen. It now clears every finished download.
* **Escape closes Settings and the Library**, however they were opened,
  and the keyboard goes back to the page afterwards. Escape in the address
  field or the start page's search box also closes an open popover first.
* **About shows Merlin's version.** Settings › About showed Chromium's
  version and "Mac OS X"; it now shows Merlin's version, the Chromium
  engine on its own line, and macOS.
* The Merlin menu no longer says "Nothing matches" twice.

## What's new in 0.3.2

* **One profile warning, not five.** If part of your profile can't be
  opened at launch, Merlin now says "Something went wrong when opening
  your profile" once. It used to ask once for every database it couldn't
  open, about five times in a row, and could open an extra empty window
  behind the dialogs.

## What's new in 0.3.1

This release fixes what two audits of 0.3.0 found. Most of it is about
Merlin doing what it says: the address, lock and site panel tell the truth,
private WebKit browsing ends when it should, and buttons that did nothing
now work.

**Updating from 0.3.0:** releases are now signed with one Merlin
certificate instead of a fresh ad-hoc signature each time. This update
changes the signature once: macOS asks once more before Merlin can read its
saved passwords, and camera and microphone access are asked for again.
Later updates keep both.

### Fixes

* **The downloads panel's buttons work.** Every button on a download
  (pause, resume, retry, show in Finder and the rest) failed with "Unknown
  download action".
* **The address and lock are Chromium's.** The address field shows an
  address the way Chrome does (no user name or password, look-alike
  hosts in punycode), and the lock comes from the page's real security
  state, not from whether the address starts with `https`.
* **The site panel tells the truth.** It no longer says ads are blocked
  while blocking is off or its rules are still loading, and its toggle
  acts on the page it describes, even if you switched tabs meanwhile.
* **Workspaces save everything.** Making, renaming or collapsing a tab
  group, pinning a tab, changing a split and moving the window are now
  saved, and so is the last change before you close a window.
* **Editing in your editor (`ge`) keeps your text** if the window closes
  while the editor is open, and Merlin reads a save only once the editor
  has finished writing it.
* **Failures are reported.** Exporting bookmarks says Saved only when the
  file was written, and the Library shows "Couldn't load" with Try Again
  instead of an empty list when History, Bookmarks or Downloads fail.
* **Restore tabs after a crash.** If Merlin quits unexpectedly, the next
  launch asks whether to restore your tabs instead of opening an empty
  window.
* **Pages are released after `alert()`, `confirm()` and `prompt()`.** A
  page stayed stuck after you answered one of its dialogs.
* **Keys act on the page you see.** Link hints, marks (`m`) and the
  address field's Enter no longer act on another tab or an older list of
  suggestions when the answer arrives late, and two settings changed at
  once no longer undo each other in `config.toml`. The Config File editor
  refuses to save over changes made since you opened it.

### WebKit pages (Netflix and other streaming sites)

* **Private WebKit browsing ends with the last private window.** A new
  private window used to share the earlier ones' WebKit cookies and
  sign-ins.
* **WebKit pages' icons are fetched privately**, without cookies, and in
  memory only for private windows.
* **Clearing browsing data clears WebKit too**, and the private start
  page no longer claims that nothing at all is kept.
* **Bookmarks, workspaces, `browserctl` and `:yank` use the page WebKit
  shows**, not the page before it.
* **Tabs move between engines as you'd expect.** Opening an address from
  the address field, a bookmark or `browserctl` takes the tab to the right
  engine, changing a site's engine moves all its tabs, and sign-in
  pop-ups keep their link to the page that opened them.

### Interface

* **A window's interface can recover.** If it hits an error, the window
  says so and offers **Reload Interface** and **Copy Diagnostics**, and a
  failure of the interface's engine reloads every window, tabs intact,
  instead of crashing Merlin.
* **Manage bookmarks from the keyboard and VoiceOver.** Option-Up and
  Option-Down move a bookmark, Command-Delete removes it, and VoiceOver's
  Actions menu offers Move Up, Move Down, Edit and Delete. A row's buttons
  also appear when it has keyboard focus.
* **Allow browserctl** in **Settings > General** turns `browserctl` off or
  on without editing `config.toml`.
* **Finder shows Merlin's version** in Get Info, instead of Chromium's.
* **Less work while idle.** The toolbar no longer checks the page's
  colour every 1.2 seconds, only when the page may have changed, so
  Merlin wakes the Mac less and uses less CPU while you aren't using it.
* Control-Tab loads previews only for the cards it shows.
* A disabled slider can no longer be moved with the keys or VoiceOver,
  and says it is disabled.
* `:read` and `:script` are gone from the commands: they only ever
  printed an error.

### Install and release

* Releases use the hardened runtime and one signing certificate (see
  above). The disk image includes the notices for every component.
* `brew upgrade` quits Merlin before replacing it, and
  `brew uninstall --zap --cask merlin` also removes Merlin's data.

## What's new since 0.2.0

* **Fixed: dragging a tab onto the page opened a new window.** Dragging a
  tab from the top of the window onto the page always gave it a window of
  its own, instead of a split view. Now, as in Ardia, the page shows two
  drop zones, **Add left split** and **Add right split**, by its edges;
  they light up as the tab reaches them, and letting go there shows the
  tab on that side. Dragging the tab you are looking at splits it with the
  tab you used before it. Let go anywhere else on the page, or outside the
  window, for a new window; the card under the pointer shows which will
  happen.
* **Split views stay together in the tabs.** A split view's two tabs now
  show as one piece along the top (a split symbol, both titles and a line
  between them, on a soft background) and side by side on one background
  in the sidebar, so it's easy to see which tabs are split together. Drag
  the piece to move the split as a whole; pull one side down onto the page
  to take it out. A split tab's right-click menu has **Separate Split View**.
* **Turn modal keys on or off in Settings.** **Settings > Keys > Modal
  browsing** switches the keyboard layer off, so every key goes to the page
  as in any other browser. ⌘K, the menus and the mouse still reach
  everything. It writes `modal_browsing` in `config.toml`, so the file and
  the switch always agree. In 0.2.0 this needed an edit to the file.
* **No Profiles button.** Merlin has one profile. The toolbar's Profiles
  button could create more, but the rest of Merlin (workspaces, browserctl,
  the config file) only knows the one. Use workspaces and private windows to
  keep browsing apart.

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
  every link, copy the page as Markdown and Visual-mode selection. (Chromium's
  Reading mode needs its side panel, which Merlin doesn't have.)
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
* **No Reading mode.** Chromium's needs the side panel, which Merlin
  doesn't have. The outline (`gO`) and `yM` (copy as Markdown) cover some of
  it.
* **Error pages look like Chromium's.** Network errors and certificate
  warnings use Chromium's own styling.

## Reporting problems

Open an [issue](https://github.com/kylianmarceau/merlin/issues) with the
version from `chrome://version`, your macOS version and the steps to
reproduce. Report security problems privately, not in an issue: use
**Report a vulnerability** on the repository's
[Security tab](https://github.com/kylianmarceau/merlin/security) (see
[SECURITY.md](https://github.com/kylianmarceau/merlin/blob/main/SECURITY.md)).
