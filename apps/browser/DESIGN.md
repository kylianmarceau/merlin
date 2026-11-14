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
- **Sidebar** (252 pt, Settings > Appearance > Tabs, or `tabs = "side"`):
  the top 40 pt row holds the traffic lights, hide-sidebar, back, forward and
  reload. Under it, the address as a white pill (`fillShellControl`) showing
  the site, a waiting-request chip and the site-controls button; pinned tabs
  as favourite tiles (four across, 44 pt); then "Tabs" with New Tab and the
  open tabs (34 pt rows, the active one a white card with `shadow.tab`). The
  footer holds profiles and downloads on the left; extensions, the command
  menu, the Library and Settings on the right. The page card has **no
  toolbar** in this layout.
- **Tabs on top** (`tabs = "top"`): the "Joined" strip, 48 pt after 84 pt
  for the traffic lights, drawn over the card so the active tab can overlap
  its edge. Tabs sit on the bottom of the strip. The active one is a 38 pt
  shape with 10 pt top corners in the toolbar's colour, joined to the
  toolbar by a concave 10 pt ear at each bottom corner (rings clipped to a
  square, so nothing paints over the translucent shell); it slides to a
  newly active tab over 340 ms (`curve.slide`) and its colour cross-fades
  over 380 ms. Inactive tabs have no fill: a favicon, the title at body size
  fading out at its end (`Fade`, no ellipsis), a soft inset pill on hover
  and hairline dividers between quiet tabs; the close button shows on hover
  and on the active tab. Tabs share the width up to 148 pt, become icons
  below 96 pt and, past 40 pt, the rest collect behind a "+N" native menu
  (the active tab always stays in the strip). Pinned tabs are icons in a
  soft group. A background tab that is loading breathes its icon
  (`useBreathe`); the active tab's loading is the bar under the address.
  Dragging a tab reorders it within its group, the joined shape following
  it; pulled down past the strip it leaves the tabs (see Tab drops).
  The command menu, Library, Settings, profiles and, last, Downloads sit at
  the right, so the downloads panel hangs at the window's right edge.
  The card gets one 46 pt toolbar (32 pt when compact): hide tabs, back, forward, reload,
  the address (site in medium weight, the rest of the path quiet), bookmark
  and extensions.
- **Site colour** (tabs on top, Settings > Appearance): the joined tab and
  toolbar take the site's colour, from the engine (`Tab.color`: the page's
  theme-color, else its icon's main colour). *Soft* (default) mixes it with
  86% white and draws ink from the same hue; *Vivid* darkens it until white
  text reaches 4.5:1; *White* ignores it. New tab and crashed pages are
  always white. "Tint the window with the site colour" replaces the
  workspace tint of the shell too. `siteChrome()` in tokens.ts turns the
  colour into roles that `PaletteScope` patches over the toolbar and the
  active tab, so components still only name roles.
- **New tab page**: quiet. A mound of thick paint in the workspace colour
  (`PaintMark`: pre-rendered 2x images, one per workspace colour, slightly
  dimmed in dark mode), one search card with "Jump to a tab or file", and the
  window's other pages on one line under it, on the off-white ground.
- **New tabs as a pop-up** (Settings > Appearance, kept by the shell in
  AppKit's defaults rather than the profile): New Tab and Command-T open a
  search pop-up over the current page under a light veil; the sidebar's New
  Tab row reads "New tab…" meanwhile. Before typing it offers the window's
  other pages, then Chromium's suggestions; the tab opens only once a place
  is chosen. A blank tab Chromium opens itself gives way to the pop-up.
- **Command-S** hides the tabs in either layout; the card then fills the
  window, keeps the toolbar and leaves 84 pt for the traffic lights.
- **Content card**: `contentBackground`, `radius.window`, `contentBorder`,
  `shadow.card`, inset 8 pt from the window edge (0 on the sidebar side).
- **Status line** under the page, only outside Normal mode or with
  something to say: the mode, the keys typed so far, or the last message
  (errors in `textDanger`). Half a second into an unfinished key sequence it
  lists the keys that can follow.
- **Pop-up windows** (sign-in, payment) show only a 40 pt title strip with the
  site's security icon and host, then the page. They never look like a full
  browser window.

## Surfaces

Every raised surface is a `Panel`: one fill, a hairline edge and a native layer
shadow. React Native's shadow props do nothing on macOS views. **(tested)**
Glass panels follow Settings › Appearance › Interface style
([decision 60](../../docs/DECISIONS.md#60-ardias-interface-style-general-and-appearance-settings)):
with **Glass** (macOS 26 and later) they are macOS Liquid Glass
(`PopoverSurface`, drawn by the native `PopoverBubble`), with no extra edge
or shadow. Liquid Glass has only a regular and a clear look, and tint barely
changes the regular one, so `panelGlass()` maps Transparency in two halves:
below the middle a colour layer over the glass thickens it towards solid,
above it the regular glass cross-fades into clear; with **Classic** they are `surfacePopoverSolid` with a
half-point edge and a layer shadow, nothing showing through. Controls light
up the same way: `GlassFill` is a glass plate with Glass and a flat wash
(`rowHover`, `rowPressed`) with Classic.

| Surface | Fill | Radius | Shadow | Blocks the page |
| --- | --- | --- | --- | --- |
| Popover (with arrow) | glass panel | `bubble` 12 | `popover` | No |
| Suggestions | glass panel, no arrow | `bubble` 12 | `menu` | No |
| Find bar | glass panel | pill | `popover` | No |
| Command bar | glass panel | 18 | `dialog` | Light `scrim`; a press on it cancels |
| New-tab and ⌘L pop-ups | glass panel | 18 | `dialog` | `newTabVeil` over the page card only |
| Dialog | glass, `surfaceDialog` | 18 | `dialog` | Yes, with `scrim` |
| Sheet (Settings, Library) | `surfaceSheetBody` / `surfaceSheet` | 16 | `dialog` | Yes, with `scrim` |
| Toast | `surfaceToast` capsule | pill | `toast` | No |

Popover content follows Ardia's downloads panel: popovers are 300 pt wide,
centred on their control with a 20 × 9 pt arrow pointing at it, and grow
out of the arrow (scale 0.94 to 1). An uppercase `MenuSection` label
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
- **Tab drops**: a tab dragged out of the tabs (24 pt past the strip or the
  sidebar, or out of the window) follows the pointer as a small card. Over
  the page, the half it would take lights up (`accentSoft` with a
  `splitFocus` edge) and slides as the pointer crosses the middle: let go
  and it shows beside the current tab in a split view. Outside the window
  it opens in a window of its own, under the pointer; dragging the current
  tab onto the page does the same. Sidebar rows also reorder by dragging up
  or down. The tab menu has Open in Split View and Move to New Window.
Buttons are pills: `primary` is dark ink, `secondary` a soft wash.

Settings shows its sections as icon tabs across the top; the Library as a
segmented control beside its title, with a search field under it.

Overlays are layers inside the window, never separate windows: content <
sheets < dialogs < popovers < toasts. `Modal` is not used. **(tested)**

## Which surface to use

- **Popover**: anything tied to a control. Popovers open downwards from
  controls in the top half of the window and upwards from the sidebar footer. Extensions, an extension's own
  popup, profiles, recent downloads, address suggestions, and browser
  questions about the site: permissions, passwords, addresses and cards,
  translation, opening in an app, bookmarks and site information. Popovers
  close on a press anywhere outside them (including on the page), on Escape
  and when the window loses focus. Browser questions close only when answered.
- **Native menu** (`NSMenu`): actions on a thing, such as a tab's right-click
  menu and its "…" button.
- **Dialog**: questions from the page (`alert`, `confirm`, `prompt`, leaving
  the page), attached to the top of the page; window questions (closing with
  downloads running, restarting to update) in the centre.
- **Sheet**: Settings and the Library.
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
- Dialogs and sheets: 220 ms in, 150 ms out, from 97–98.5% and 8–12 pt below,
  with the scrim fading alongside.
- Toasts rise 12 pt over 220 ms.
- Row hover highlights ease over 100 ms; switches use the `snappy` spring.
- "Reduce motion" in Settings makes every transition instant.

## Icons

SF Symbols only, tinted with a colour role (`iconPrimary`, `iconSecondary`,
`iconDisabled` or a status role), chosen to avoid Chromium's look: chevrons
for navigation, `shippingbox` for extensions, `arrow.down.to.line` for
downloads. Settings uses Merlin's own set: a window with its sidebar, a
switch, a closed eye, a no-entry sign, a speedometer, a box, stacked cards,
⌘, braces and the M. Native menus carry words only. Page favicons are
fetched from Chromium as 2x PNGs and fall back to a globe.

## Code layout

```
src/lib/          plain helpers (formatting, prompt labels)
src/platform/     the only code that imports @merlin/engine and @merlin/shell
src/state/        the window store, actions, hooks and surface rules
src/components/ui/        tokens, motion and the component library
src/components/<feature>/ tabs, omnibox, site, settings, library, …
```

Imports go downwards only. Features build from `components/ui` (through its
index), `state` and `lib`; they never import `platform/`, the engine or the
store directly. `components/ui` may use `platform/shell` for AppKit views, and
`components/page` alone hosts Chromium's page view. **(tested)**
