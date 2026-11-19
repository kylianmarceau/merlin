# Merlin shell design

How the React Native shell looks and moves, and the rules that keep it
consistent. `src/conventions.test.ts` enforces the rules marked **(tested)**.

## Look: Tide

One tinted shell, a white page card on it, glass popovers. The workspace
colour (Settings > Appearance: Sage, the default, Ocean or Ember) tints the
whole window over macOS vibrancy (`shellTint`). Dark ink is used for text and
primary buttons; the accent is only for focus, selection, switches and
progress. No icon chips or letter tiles in menus: rows lead with words, and
icons appear only where they say something (a file type, a device, a site).

The stored accent names predate Tide and stay as the browser saves them:
`fern` is Sage, `ocean` is Ocean and `iris` is Ember.

## Window

- **Shell**: vibrancy under `shellTint` fills the window whenever tabs show;
  its empty space drags the window.
- **Sidebar** (252 pt by default, 200–400 pt by dragging its right edge;
  double-click the edge to reset. Settings > Appearance > Tabs, or
  `tabs = "side"`): the top 40 pt row holds the traffic lights, hide-sidebar,
  back, forward and reload. Under it, the address as a white pill
  (`fillShellControl`) showing the site, a waiting-request chip and the
  site-controls button; pinned tabs as favourite tiles (`FavouriteGrid`,
  44 pt tall, sharing the width as in Ardia: one tile fills the row, two take
  half each, up to four across, then rows of four; lit almost white on hover
  and deeper while pressed, as in Dia; the chosen one tinted with its site's
  colour, `pinnedTileTint`, and ringed with it, `pinnedTileRing`, neutral
  for a near-black or near-white colour). A tile drags to a new slot: it
  lifts with a shadow, without scaling, and follows the pointer while the
  others spring aside, then settles into its slot on the `snappy` spring. A
  row dragged up over the tiles (or, with none yet, past the top of the
  list) is pinned where it is let go: the tiles make room for an outlined
  tile with its icon, and the row fades meanwhile. A trackpad tick marks
  each new slot (`tick`). A dashed rule closes the tiles (`DashedRule`); the
  Bookmarks section (the Bookmarks Bar folder, six rows, folding at its
  heading); then, under Dia's hairline, the open tabs with New Tab after
  the last (34 pt rows 3 pt apart, Dia's 37 pt pitch; the active one a
  white card with `shadow.tab`; a row is chosen as the button goes down and
  shows Dia's deeper pressed fill). With nothing above the tabs, the
  hairline fades in only once the list scrolls; a "Current tab" pill points to the active
  row when it is out of sight; double-clicking the empty space under the
  rows opens a tab; once the rows overflow, New Tab stays put under the
  list. Rows fade their titles (`Fade`, no ellipsis), show three bouncing
  bars while the tab plays (`Equaliser`; a press mutes it, and a muted tab
  shows a crossed speaker), a Safari badge on WebKit tabs, and, asleep, a
  quiet grey square in place of their icon, dimmed. Rows joining or leaving the list, and groups
  folding, animate as in Dia (`animateListChange`). A dragged row lifts
  into a white card with a shadow (no scale) and follows the pointer, while
  the rows it passes slide aside on the `snappy` spring with a trackpad tick
  at each place, as in Ardia (`rowShift`); let go, it springs into the gap
  and holds there until Chromium's order catches up. The footer is quiet: downloads on the left only
  while there are some; workspaces, extensions, the command menu, the
  Library and Settings on the right. The page card has **no toolbar** in
  this layout.
- **Tabs on top** (`tabs = "top"`): the "Joined" strip, 48 pt after 84 pt
  for the traffic lights, drawn over the card so the active tab can overlap
  its edge. Tabs sit on the bottom of the strip. The active one is a 38 pt
  shape with 10 pt top corners in the toolbar's colour, joined to the
  toolbar by a concave 10 pt ear at each bottom corner (rings clipped to a
  square, so nothing paints over the translucent shell); it slides to a
  newly active tab on the `slide` spring (response 0.34 s, damping 0.9),
  which carries its speed into a new slide that interrupts it, and its colour cross-fades
  over 380 ms. Inactive tabs have no fill: a favicon, the title at body size
  fading out at its end (`Fade`, no ellipsis), a soft inset pill on hover
  and, as in Dia, no dividers between tabs; the close button shows on hover
  and on the active tab. Tabs share the width up to 148 pt, become icons
  below 96 pt and, past 40 pt, the rest collect behind a "+N" native menu
  (the active tab always stays in the strip). Pinned tabs are icons in a
  soft group. While tabs slide after a close, a tab's close button fades and
  moves with it, and the hover card follows the tab that ends up under the
  pointer. A background tab that is loading breathes its icon
  (`useBreathe`); the active tab's loading is the bar under the address.
  A split view's two tabs are one piece, as in Ardia (`StripSplit`): the
  split symbol, each side's icon and title with a hairline between them,
  two cells wide, on a soft `splitChip` pill; when either side is active the
  joined shape runs under both and the focused side's title is the
  stronger. The sidebar puts a split's rows on the same pill.
  Dragging a tab, or a split as a whole, reorders it within its group a
  cell at a time and never into a split, the joined shape following it
  (`stripLayout.ts`); pulled down past the strip it leaves the tabs, fading
  while the others close up (see Tab drops).
  The command menu, Library, Settings and, last, Downloads (only while
  there are downloads) sit at the right, so the downloads panel hangs at the
  window's right edge. A tab that plays sound shows a speaker that mutes it;
  WebKit tabs carry a Safari badge on their icon.
  The card gets one 46 pt toolbar (32 pt when compact), as calm as Dia's:
  hide tabs, back, forward, reload, the address and extensions. Holding Back
  or Forward (or right-clicking it) lists the pages that way.
- **Site colour** (Settings > Appearance), in either layout as in Ardia:
  with tabs on top the joined tab and toolbar take the site's colour; in
  the sidebar layout the toolbar does whenever the card has one (tabs
  hidden, or the address in the toolbar). The colour comes from the engine
  (`Tab.color`: the page's theme-color, else its icon's main colour). *Soft* (default) mixes it with
  86% white and draws ink from the same hue; *Vivid* darkens it until white
  text reaches 4.5:1; *White* ignores it. New tab and crashed pages are
  always white. "Tint the window with the site colour" replaces the
  workspace tint of the shell too. `siteChrome()` in tokens.ts turns the
  colour into roles that `PaletteScope` patches over the toolbar and the
  active tab, so components still only name roles.
- **New tab page**: quiet. "Peek", the logo's globe and wing in thick
  paint in the workspace colour, the globe peeking over the search card
  (`PaintMark`: pre-rendered 2x images, one per workspace colour, slightly
  dimmed in dark mode; the card overlaps its bottom edge), one search card with "Jump to a tab or file", and the
  window's other pages on one line under it, on the off-white ground.
- **Open in this window**, under the new tab page's card: each of the
  window's other pages on a soft pill of its own (hover and pressed fills),
  4 pt apart, a long title shrinking to an ellipsis inside it.
- **New tabs as a pop-up** (Settings > Appearance, kept by the shell in
  AppKit's defaults rather than the profile): New Tab and Command-T open a
  search pop-up over the current page under a light veil; the sidebar's New
  Tab row reads "New tab…" meanwhile. Before typing it offers the window's
  other pages, then Chromium's suggestions; the tab opens only once a place
  is chosen. A blank tab Chromium opens itself gives way to the pop-up.
- **Address field**: at rest Dia's breadcrumb, the site in medium weight,
  then " / " and the page's title, quiet. With the pointer on it, the whole
  address and the page's actions (bookmark, copy link) show; a saved page
  keeps its filled bookmark in the accent, which pops as it is saved. The bookmark saves into the
  Bookmarks Bar folder, so the page appears in the bar and the sidebar. With
  modal browsing on, Insert mode rings the field in `modeInsert`.
- **Bookmarks bar** (Settings > Appearance > Bookmarks: Always, New Tab only
  (the default) or Never): under the toolbar, or at the top of the card when
  there is none. The Bookmarks Bar folder with each page's icon, then Other
  Bookmarks as a folder.
- **Command-S** hides the tabs in either layout; the sidebar slides away on
  Dia's spring (`spring.sidebar`: response 0.215 s, damping 0.79) and the
  traffic lights hide with it (`FullScreenWatch windowButtons`), so the
  card's toolbar starts at the edge. The pointer at the window's left edge
  (the top edge with tabs on top), a 3 pt strip that lets clicks through
  (8 pt, `edgeStripWide`, when the window is away from the screen's edge,
  where the pointer does not stop by itself),
  slides the tabs in over the page as a floating card in the shell's glass
  (`SidebarPeek`, `StripPeek`); they stay while the pointer is within 40 pt
  of them and spring away 200 ms after it leaves, unless the address is
  being typed in. A tab's right-click menu holds them in place; if the
  pointer left meanwhile they slide away once the menu closes.
- **Hover cards**: half a second's rest on a tab, a strip tab or a pinned
  tile shows its card (`HoverCardOverlay`): the whole title, the address and
  one-press actions in Dia's row of glyphs (pin, bookmark, split, mute, copy
  link; for a pinned tile that has left its page, back to it): 15 pt
  symbols on 24 pt squares that show a soft plate under the pointer
  (`IconButton` `card` size, `plate` look). Moving on to the next tab shows its
  card at once; the card stays while the pointer is on it, and no tooltip
  shows on top of it. As Dia's does, it
  goes when the keyboard moves on: a tab opened, closed or switched to, the
  find bar opened, or keys typed.
- **Tooltips** (`TooltipLayer`, `IconButton`'s `tip` and `keys`): every icon
  button names itself after the same half-second rest, with its shortcut as
  keycaps and Merlin's Normal-mode keys on a second line; they too follow
  the pointer at once from one button to the next. A pressed button's
  tooltip goes and stays away until the pointer leaves it. Under a sheet,
  dialog or peek only the controls inside it show tooltips
  (`TooltipCover`): hover reaches what is drawn over too.
- **Content card**: `contentBackground`, `radius.window`, `contentBorder`,
  `shadow.card`, inset 8 pt from the window edge (0 on the sidebar side).
- **Status line** under the page, only outside Normal mode: the mode and
  the keys typed so far. Half a second into an unfinished key sequence it
  lists the keys that can follow. What a command has to say goes to the HUD.
- **HUD** (`HudLayer`), as in Ardia: a short confirmation in a glass capsule
  16 pt inside the top of the page ("Link copied", "Added to the Bookmarks
  bar" with an Edit button, or a command's message, errors in
  `textDanger`). It grows from 92% on the `appear` spring, stays 1.8 s (a
  failure or one with a button the toast's 5 s) and goes by itself or on a
  click. A newer one replaces it.
- **Closed tabs**: closing a tab with a page on it brings a toast to the
  bottom centre, Closed “Title” with Reopen, which restores it with its
  history ("3 tabs closed" for several at once). Blank and new tab pages,
  which Chromium doesn't keep, and tabs dragged to another window offer
  none.
- **A window not in front**: the shell turns an opaque, lighter tone
  (`shellInactive`) and the tabs fade back to 62% (`inactiveTabs`), as in
  Dia.
- **Menu bar**: the View menu starts with Merlin's own commands, as in Dia:
  Show Tabs in Sidebar, Show Tabs on Top, Hide Tabs, Open Split View and
  Show Address in Toolbar, checked and enabled from the front window's
  state (`useViewMenu`). The Window menu names each window after its active
  tab, and a new tab is listed as New Tab, never by its address.
- **Pop-up windows** (sign-in, payment) show only a 40 pt title strip with the
  site's security icon and host, then the page. They never look like a full
  browser window.

## Surfaces

Every raised surface is a `Panel`: one fill, a hairline edge and a native layer
shadow. React Native's shadow props do nothing on macOS views. **(tested)**
Glass panels follow Settings › Appearance › Interface style:
with **Glass** (macOS 26 and later) they are macOS Liquid Glass
(`PopoverSurface`, drawn by the native `PopoverBubble`), with no extra edge
or shadow. Liquid Glass has only a regular and a clear look, and tint barely
changes the regular one, so `panelGlass()` maps Transparency in two halves:
below the middle a colour layer over the glass thickens it towards solid,
above it the regular glass cross-fades into clear; with **Classic** they are `surfacePopoverSolid` with a
half-point edge and a layer shadow, nothing showing through. Controls light
up the same way: `GlassFill` is a glass plate with Glass and a flat wash
(`rowHover`, `rowPressed`) with Classic.

On macOS 14 and 15 there is no Liquid Glass and Settings hides the choice:
panels and controls are always Classic, while the window around the page
keeps the system's sidebar vibrancy of the stored style (Glass by default),
so the desktop still shows faintly through the tinted shell.

| Surface | Fill | Radius | Shadow | Blocks the page |
| --- | --- | --- | --- | --- |
| Popover (with arrow) | glass panel | `bubble` 12 | `popover` | No |
| Suggestions | glass panel, no arrow | `bubble` 12 | `menu` | No |
| Find bar | glass panel | pill | `popover` | No |
| Command bar, new-tab and ⌘L pop-ups | glass panel | 18 | `dialog` | No dimming; a press outside cancels |
| Dialog | glass, `surfaceDialog` | 18 | `dialog` | Yes, with `scrim` |
| Sheet (Settings, Library) | `surfaceSheetBody` / `surfaceSheet` | 16 | `dialog` | Yes, with `scrim` |
| Toast | `surfaceToast` capsule | pill | `toast` | No |
| HUD | glass capsule, at least 72% colour | pill | `menu` | No |

Popover content follows Ardia's downloads panel: popovers are 300 pt wide,
centred on their control with a 20 × 9 pt arrow pointing at it, and grow
out of the arrow (scale 0.94 to 1). An anchored popover's glass keeps at
least an 82% colour layer (`anchoredGlass`), so a saturated page never
smears through its text and dark-mode text keeps its contrast. An uppercase `MenuSection` label
(24 pt, with a quiet text action such as Clear), rows inset 6 pt with 10 pt
of padding and a 6 pt corner (text 16 pt from the edge), a `row` title at
13/16 and a `rowDetail` line at 11/14, a half-point `MenuSeparator` and a
quiet `MenuFooter` ("View all downloads ›"). A download row is 40 pt with
the file's Finder icon at 24 pt; Show in Finder appears on hover and the
rest is in its right-click menu. A finished file drags out of its row like
a file in Finder (`FileDragArea`), to the desktop, Mail or a page.

- **Loading**: a 2 pt bar in `tabLoading` runs along the address field's
  bottom edge, inset by the field's corner radius (`LoadingBar`): to 28% in
  320 ms, then creeping towards 90% over 9 s, then to 100% and fading in
  260 ms once the page has loaded. No spinners in tabs.
- **Downloads button**: while files arrive a 2 pt `ProgressRing` around the
  arrow fills with their combined progress (circling until every size is
  known; muted while all are paused), with a count badge from two files up;
  it holds full for 900 ms as the last one finishes. A new download's Finder
  icon (40 pt) lifts off the middle of the window, arcs to the button
  (across first, then up) shrinking to a third, and the button nudges as it
  lands (`flyTo`, `useNudge`). Reduced motion only fades the icon in place.
- **Tab drops**, as in Ardia: a tab dragged out of the tabs (24 pt past the
  strip or the sidebar, or out of the window) follows the pointer as a
  small card whose trailing symbol says what letting go does. Each pane on
  screen other than the tab's own slides in a drop zone from each edge
  (`dropZone*` roles: a frosted card with a dashed edge, a half symbol and
  "Add left/right split"); 110 ms later they grow, and the one the tab's
  footprint reaches takes the accent and leans towards the pointer
  (`zoneRect`, `zoneHit`). Let go there and the tab shows on that side of
  the pane, in one native command (`tabs.split` with `beside`). A strip tab
  comes forward when pressed, so when the dragged tab is the only page on
  screen its own pane offers a split with the tab used most recently
  before it (`splitPartner`, from the store's `recentTabs`). Elsewhere on
  the page, or outside the window, it opens in a window of its own under
  the pointer; over the toolbar or sidebar nothing happens. Sidebar rows
  also reorder by dragging up or down. The tab menu has Open in Split View
  (or Separate Split View for a tab in one) and Move to New Window.
- **Tab menu**: as in Ardia, every item carries an SF Symbol (macOS 27
  hides menu images unless an item asks, so Merlin's do). Rename Tab… gives
  the tab a name of its own, shown wherever its title would be, and Change
  Icon puts one of a set of symbols in place of the page's icon; both last
  as long as the window (`tabLooks`), and the menu offers the page's title
  and icon back.
Buttons are pills: `primary` is dark ink, `secondary` a soft wash.

Settings is a tall sheet (780 pt, shorter on a small screen) with its
sections in a sidebar under a search field; a search lists matching settings
across every section, and choosing one opens its section, scrolls to it and
lights it in the accent for a moment (`searchSettings`, `useLit`). The
Library shows its sections as a segmented control beside its title, with a
search field under it. Its history folds repeat visits to the same page
within half an hour (a redirect, a reload) into one row (`foldRepeats`).

Overlays are layers inside the window, never separate windows: content <
sheets < dialogs < popovers < toasts. `Modal` is not used. **(tested)**

## Which surface to use

- **Popover**: anything tied to a control. Popovers open downwards from
  controls in the top half of the window and upwards from the sidebar footer. Extensions, an extension's own
  popup, recent downloads, address suggestions, and browser
  questions about the site: permissions, passwords, addresses and cards,
  translation, opening in an app, bookmarks and site information. Popovers
  close on a press anywhere outside them (including on the page), on Escape
  (the newest one first) and when the window loses focus. A browser question
  stays when the window loses focus; a press outside or Escape answers it
  with its own Done, Dismiss or Cancel, and one without such an answer
  stays until answered.
- **Native menu** (`NSMenu`): actions on a thing, such as a tab's right-click
  menu and its "…" button.
- **Dialog**: questions from the page (`alert`, `confirm`, `prompt`, leaving
  the page), attached to the top of the page; window questions (closing with
  downloads running, restarting to update) in the centre.
- **Sheet**: Settings and the Library.
- **HUD**: a confirmation of something just done, or a short message from a
  command. It never stays behind.
- **Toast**: a failure or notice that needs no answer. Toasts leave after 5 s
  or on click; at most three show.

Only one popover is open at a time. A browser question takes the popover
layer, and the command menu waits until it is answered.

## Type

System font. `greeting` 52/56 in Georgia (the new tab page only), `display`
30/36, `headline` 20/26, `input` 17/22, `title` 15/20 semibold, `callout` 14
(`calloutStrong` medium, for popover row titles), `body` 13/18, `label` 12
medium, `caption` 11, `section` 11 semibold uppercase with wide tracking,
`group` 11 semibold sentence case, `mono` 12 Menlo. Components choose a
`Text` variant and a colour role; they never set a font size, weight or family
directly. **(tested)**

## Colour

Colours are named roles in `src/components/ui/tokens.ts`, built for light and
dark from one sage-tinted neutral ramp and the chosen workspace colour. Use
roles by purpose: `textPrimary`/`textSecondary`/`textTertiary` for text,
`fillHover`/`fillPressed`/`fillSelected` for interaction (`fillShell*` and
`tabHover` on the tinted shell), `buttonPrimary` for primary buttons,
`accent` only for focus, selection, switches and progress, and status roles
(`danger`, `warning`, `success`) only for status. Colour literals appear
nowhere else. **(tested)**

Text fields show no system focus ring: an idle field is a soft fill, an
editing one turns white with a hairline `borderDefault` edge, and selected
text uses the light `textSelection` wash. Single-line inputs size to their
text inside a centred row, never stretched, so the text sits in the middle.

## Space and shape

Spacing steps are 2, 4, 8, 12, 16, 24, 32 and 48 pt (`space`). Controls are
28 pt tall, buttons 30 pt pills, sidebar rows 34 pt, popover rows 32 pt,
icons 16 pt (13 pt small). Radii: controls 8, rows 9, fields and tiles 10,
cards and the window card 12, sheets 16, popovers and dialogs 18. Components
size and space only with tokens. **(tested)**

## Motion

All timings live in `src/components/ui/motion.ts`. **(tested)**

- Popovers: 150 ms in with `curve.enter`, 100 ms out with `curve.exit`, from
  96% scale and 4 pt above.
- Menus and suggestions: 100 ms, from 98%.
- Things in the middle of the window grow in from 92% on the `appear`
  spring while they fade in, and fade out in 150 ms: dialogs, sheets and
  toasts (`presence` with `springIn`), and the centred pop-ups (command
  menu, new-tab and ⌘L pop-ups, naming dialogs; `useEntrance`). Toasts rise
  8 pt as they come.
- Refused input shakes, as a wrong macOS password does: three swings of
  ±6 pt dying away over 0.35 s (`useShake`, `Shake`). The find bar shakes
  when a search finds nothing (its text turns red), and again on Return;
  the command menu shakes on a command it can't run; the group dialog on an
  empty or taken name. With reduced motion it flashes red instead.
- Drags that pass a limit rubber-band: the sidebar's edge past its minimum
  or maximum width gives less and less, and springs back carrying the
  drag's speed when let go (`rubberBand`, `springBack`); near the default
  width it snaps there. Peeking tabs spring out as they sprang in.
- Trackpad ticks (`tick`, NSHapticFeedbackManager; only Force Touch
  trackpads feel them): a dragged tab or tile reaching a new place, a tab
  leaving the tabs or reaching a drop zone, a favourite pinned by drag, the
  sidebar's edge snapping to its default width or reaching a limit.
- Row hover washes come in over 50 ms and leave over 200 ms (`useHoverFade`),
  as in Dia; a row's close button fades over 100 ms. Switches use the
  `snappy` spring; the sidebar hiding, showing and peeking, the `sidebar` one.
- Tooltips and hover cards wait 500 ms, then follow the pointer at once for
  300 ms after one closes. A hover card arrives as Dia's: it fades over
  100 ms while its scale springs from 92% (response 0.25 s, damping 0.75)
  out of its corner nearest the tab, and leaves on a quicker spring
  (`useHoverCardMotion`). The HUD appears the same way, from 92% on the
  `appear` spring (response 0.3 s, damping 0.82; `useAppear`). Nothing
  anywhere scales up from zero.
- Presses: an icon button's glyph dips to 96%, a labelled button's contents
  to 98.5% and a round button to 94%, on the `press` spring, which never
  overshoots (`usePressScale`). Rows and tiles, used all day, hold still and
  show a deeper fill instead, as in Dia.
- Things just made pop: a page's bookmark as it is saved and a newly pinned
  favourite tile spring from 135% on the bouncy `pop` spring (`usePop`,
  `useArrival`).
- The address field's suggestions unfold from it over 130 ms on an
  exponential ease-out, as Dia's command bar grows (`useUnfold`); the field
  and its text hold still.
- A segmented control's thumb slides to the new choice on the `snappy`
  spring.
- The new tab page settles in from 99% as it fades in (`useSettle`), and a
  soft light behind its card breathes over 3.2 s (`AreaLight`).
- A playing tab's three bars bounce at their own pace (380, 520 and 440 ms;
  `useEqualiser`) and rest at uneven heights when it stops.
- "Reduce motion" in Settings makes every transition instant: springs,
  slides and growth become cuts and fades, and shakes become a red flash.

## Icons

SF Symbols only, tinted with a colour role (`iconPrimary`, `iconSecondary`,
`iconDisabled` or a status role), chosen to avoid Chromium's look: chevrons
for navigation, `shippingbox` for extensions, `arrow.down.to.line` for
downloads. Settings uses Merlin's own set: a window with its sidebar, a
switch, a closed eye, a no-entry sign, a speedometer, a box, stacked cards,
⌘, braces and the M. Native menus give each item a symbol, as Ardia's do. Every
small icon button (each ×, a row's mute) has the same 22 pt hover square. Page favicons are
fetched from Chromium as 2x PNGs into a fixed 16 pt slot (20 pt large) that
shows the globe until the image arrives, which then fades in over 100 ms, so
titles never shift. An icon that is all dark is drawn in `iconPrimary` in
dark mode, and one that is all light in light mode (`imageTone`). A page
without one shows the globe; bookmarks and
history rows ask for a page's icon by its address (`favicons.page`,
`PageFavicon`).

## Code layout

```
src/lib/          plain helpers (formatting, prompt labels)
src/platform/     the only code that imports @merlin/engine and @merlin/shell
src/state/        the window store, actions, hooks and surface rules
src/components/ui/        tokens, motion and the component library
src/components/<feature>/ tabs, omnibox, site, settings, library, …
```

Controls press with `Pressable` from `components/ui`, never React Native's
own: React Native macOS answers VoiceOver's press (VO-Space) only on views
with `onAccessibilityTap`, which the shell's `Pressable` always sets.

Imports go downwards only. Features build from `components/ui` (through its
index), `state` and `lib`; they never import `platform/`, the engine or the
store directly. `components/ui` may use `platform/shell` for AppKit views, and
`components/page` alone hosts Chromium's page view. **(tested)**
