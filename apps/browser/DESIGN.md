# Merlin shell design

How the React Native shell looks and moves, and the rules that keep it
consistent. `src/conventions.test.ts` enforces the rules marked **(tested)**.

## Window

- **Sidebar** (248 pt) on the left, drawn over macOS `sidebar` vibrancy
  (behind-window blending) with the `sidebarTint` wash. Its top 40 pt strip
  holds the traffic lights and the profile and sidebar buttons, and drags the
  window. Double-clicking empty space follows the system "double-click a
  title bar" setting.
- **Content card**: the page and its toolbar sit in one raised card
  (`contentBackground`, `radius.window`, `contentBorder`, `shadow.card`), inset
  8 pt from the window edge. When the sidebar is hidden the card fills the
  window and the toolbar leaves 84 pt for the traffic lights.
- **Toolbar** (46 pt): back, forward, reload, the address field, a chip for a
  waiting request, bookmark and extensions. Empty space drags the window.
- **Pop-up windows** (sign-in, payment) show only a 40 pt title strip with the
  site's security icon and host, then the page. They never look like a full
  browser window.

## Surfaces

Every raised surface is a `Panel`: one fill, a hairline edge and a native layer
shadow. React Native's shadow props do nothing on macOS views. **(tested)**

| Surface | Fill | Radius | Shadow | Blocks the page |
| --- | --- | --- | --- | --- |
| Popover | `surfacePopover` | 12 | `popover` | No |
| Menu, suggestions | `surfaceMenu` | 12 | `menu` | No |
| Dialog | `surfaceDialog` | 14 | `dialog` | Yes, with `scrim` |
| Sheet (Settings, Library) | `surfaceSheet` | 14 | `dialog` | Yes, with `scrim` |
| Toast | `surfaceToast` | 12 | `toast` | No |

Overlays are layers inside the window, never separate windows: content <
sheets < dialogs < popovers < toasts. `Modal` is not used. **(tested)**

## Which surface to use

- **Popover**: anything tied to a control. Extensions, an extension's own
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

System font. `display` 30/36, `headline` 20/26, `title` 15/20 semibold,
`callout` 14, `body` 13/18, `label` 12 medium, `caption` 11, `section` 10
semibold uppercase with wide tracking, `mono` 12 Menlo. Components choose a
`Text` variant and a colour role; they never set a font size, weight or family
directly. **(tested)**

## Colour

Colours are named roles in `src/components/ui/tokens.ts`, built for light and
dark from one neutral ramp and the chosen accent (Ocean, Iris or Fern). Use
roles by purpose: `textPrimary`/`textSecondary`/`textTertiary` for text,
`fillHover`/`fillPressed`/`fillSelected` for interaction, `accent` only for
the primary action, focus and selection, and status roles (`danger`,
`warning`, `success`) only for status. Colour literals appear nowhere else.
**(tested)**

## Space and shape

Spacing steps are 2, 4, 8, 12, 16, 24, 32 and 48 pt (`space`). Controls are
28 pt tall, rows 30 pt (44 pt with detail), icons 16 pt (13 pt small). Radii:
controls and rows 8, fields 10, cards and popovers 12, sheets and dialogs 14.
Components size and space only with tokens. **(tested)**

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
`iconDisabled` or a status role). Page favicons are fetched from Chromium as
2x PNGs and fall back to a globe.

## Code layout

```
src/lib/          plain helpers (formatting, prompt labels)
src/platform/     the only code that imports @merlin/engine and @merlin/shell
src/state/        the window store, actions, hooks and surface rules
src/components/ui/        tokens, motion and the component library
src/components/<feature>/ sidebar, omnibox, site, settings, library, …
```

Imports go downwards only. Features build from `components/ui` (through its
index), `state` and `lib`; they never import `platform/`, the engine or the
store directly. `components/ui` may use `platform/shell` for AppKit views, and
`components/page` alone hosts Chromium's page view. **(tested)**
