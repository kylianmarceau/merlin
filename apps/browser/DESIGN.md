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
  soft group. A loading tab shows a spinner in place of its icon. Dragging
  a tab reorders it within its group, the joined shape following it.
  Downloads, the command menu, Library, Settings and profiles sit at the
  right. The card gets one 46 pt toolbar: hide tabs, back, forward, reload,
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
Glass panels put `popover` vibrancy (within-window blending) under a
translucent fill and draw their edge on top.

| Surface | Fill | Radius | Shadow | Blocks the page |
| --- | --- | --- | --- | --- |
| Popover, suggestions | glass, `surfacePopover` / `surfaceMenu` | 18 | `popover` / `menu` | No |
| Find bar | glass, `surfacePopover` | pill | `popover` | No |
| Command bar | `surfacePalette` | 18 | `dialog` | Light `scrim`; a press on it cancels |
| New-tab pop-up | `surfacePalette` | 18 | `dialog` | `newTabVeil` over the page card only |
| Dialog | glass, `surfaceDialog` | 18 | `dialog` | Yes, with `scrim` |
| Sheet (Settings, Library) | `surfaceSheetBody` / `surfaceSheet` | 16 | `dialog` | Yes, with `scrim` |
| Toast | `surfaceToast` capsule | pill | `toast` | No |

Popover content follows the downloads panel: an uppercase `MenuSection`
label, `PopoverRow`s inset 18 pt with a 14 pt title and a 12 pt detail, small
`RoundButton`s for row actions (dark for the main one, soft for the rest), a
hairline `MenuSeparator` and a quiet `MenuFooter` ("View all downloads ›").
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
