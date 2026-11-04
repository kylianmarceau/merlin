# Merlin-native pop-ups

Branch: `feature/merlin-native-ui`. Chromium pin: `157.0.8103.26`.

The visual identity work (see [VISUAL_IDENTITY.md](VISUAL_IDENTITY.md))
recoloured Chromium's pop-ups. They still had Chromium's shapes: pill and
outlined buttons, Material ripples, a switch whose thumb grows, checkbox
halos, full-width rules between sections, a big centered profile portrait
and three identical stacked permission buttons. This branch replaces those
shapes in two layers. Settings is unchanged; it is already Merlin's own
page and is the reference for everything here.

## Layer 1: Merlin controls everywhere (patch 0049)

`ui/views/merlin_style.{h,cc}` (new upstream file) holds the switch and the
metrics. It is off by default, so `views_unittests` and other embedders keep
upstream behaviour, and `modal_browser::InstallMerlinTheme()` turns it on
together with Merlin's colours. `--modal-browser-upstream-defaults` skips
both.

| Control | Chromium | Merlin |
| --- | --- | --- |
| Pop-up title (`STYLE_HEADLINE_4`) | 16 DIP medium | 14 DIP semibold; origin/name bold |
| Close button | circle highlight, ripple | 24 DIP rounded square, flat hover |
| Text buttons | outlined secondary, ripple | quiet fill, no outline, no ripple; gold only for the default action |
| Switch | 26×16 track, thumb grows when on, hover halo | 34×20 track, steady thumb, no halo (as in Settings) |
| Checkbox / radio | 2 DIP corners, halo, ripple | 4 DIP rounded square, gold fill, no halo |
| List rows (`HoverButton`) | full-bleed flood-fill ripple | rounded pill inset from the edges, flat |
| Page-info row padding | 20 DIP | 12 DIP (rows sit inside cards) |

Colours for these controls are set in `merlin_theme.cc` (quiet fill, hover
tint, switch track/thumb, checkbox and radio, bubble hairline).

## Layer 2: Merlin layouts for the most-seen pop-ups (patch 0050)

`overlay/chrome/browser/ui/modal_browser/merlin_popup_kit.{h,cc}`
(`:presentation` target) provides the pieces: a card background, a
gold-tinted icon tile and a choice list.

| Pop-up | Merlin layout |
| --- | --- |
| Permission prompt | Each request is a row with an icon tile. "Allow while visiting / Allow this time / Never allow" are rows of one card with equal weight, so no answer is pushed. |
| Site information | Security, permissions and site data are cards, like Settings groups; "Site settings" joins the site-data card; no full-width rules. |
| Profile menu | Avatar beside the name on a card instead of a large centered portrait on a coloured panel. |
| Media (audio) | Already Merlin-owned (patch 0044); picks up the new switch and rows. |

Every Chromium view keeps its controller, callbacks, IDs, element
identifiers, accessible names/roles and strings. Only presentation changes.

## Not yet covered by a Merlin layout

These get Layer 1 (Merlin title, buttons, switches, rows) but keep
Chromium's arrangement: downloads bubble, extensions menu, bookmark star,
zoom, translate, password save/manage, JavaScript alert/confirm, before
unload, HTTP auth, choosers, file-system access, desktop capture picker,
certificate selector and the WebUI profile picker. macOS context menus and
system sheets are native and stay native.

## Verification

* `scripts/verify_patches.sh`: all 48 patches apply to 157.0.8103.26.
* Every changed source file compiles with the exact `out/Modal` flags
  (checked into a scratch output, not the shared build tree).
* `MerlinIdentityBrowserTest.ProfileMenuPresentation` (new) captures the
  profile menu; `PermissionDecisionsAndSiteInfo` captures the permission
  prompt and site information and still checks all three decisions;
  `NativeTokensAndAccessibleOverrides` checks the switch is on and the
  button outline is gone.
* Not yet done: a linked build, the browser test run and light/dark
  screenshots.
