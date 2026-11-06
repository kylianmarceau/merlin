# Merlin-native pop-ups

Branches: `feature/merlin-native-ui`, `feature/merlin-dia-popups`. Chromium pin: `157.0.8103.26`.

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
| Text buttons | outlined secondary, ripple | grey fill, no outline, no ripple; the default action a stronger grey |
| Switch | 26×16 track, thumb grows when on, hover halo | 34×20 track, steady thumb, no halo (as in Settings) |
| Checkbox / radio | 2 DIP corners, halo, ripple | 4 DIP rounded square, gold fill, no halo |
| List rows (`HoverButton`) | full-bleed flood-fill ripple | rounded pill inset from the edges, flat |
| Page-info row padding | 20 DIP | 12 DIP |

Colours for these controls are set in `merlin_theme.cc` (button greys, hover
tint, switch track/thumb, checkbox and radio, hairlines).

## Layer 2: Merlin popovers (patches 0049 and 0050)

The first card-based layouts still read as Chromium. Merlin now follows
Dia and macOS popovers: a plain grey panel that hangs from the toolbar
button that opened it, with a small arrow pointing at that button, no title
bar and no close button. A grey circle leads the message, and the two
answers are equal grey buttons.

| Piece | Where | Merlin |
| --- | --- | --- |
| Arrow | `BubbleDialogDelegate::CreateFrameView` (0049) | Bubbles that open downward from an anchor show an arrow, if they draw their own shadow and set no custom insets |
| No close button | `BubbleFrameView::ResetWindowControls` (0049) | Hidden on anchored bubbles that close when you click elsewhere; Esc still closes them |
| Panel and buttons | `merlin_theme.cc`, `branding/design_tokens.json` | `popover` panel, `popover_control` buttons, `popover_control_strong` for the default action; hairlines are a tint of the text color |
| Address | `merlin_toolbar.cc`, patch 0013 | Page Info and permission prompts hang from the address field, where the site is named, and open toward the middle of the window (`TOP_LEFT`). Right-click the address or type `:site` for Page Info |

`overlay/chrome/browser/ui/modal_browser/merlin_popup_kit.{h,cc}`
(`:presentation` target) provides the icon circle, the decision row and the
hairline.

| Pop-up | Merlin layout |
| --- | --- |
| Permission prompt | "site wants to" as a plain sentence with the site in medium weight; each request is a sentence led by its icon in a grey circle; "Never allow" and "Allow" side by side at equal width; "Allow this time" as a quiet link below. "Allow" is the same lasting grant as Chromium's "Allow while visiting the site", which stays as its tooltip. No close button: Esc dismisses. |
| Site information | Host as the heading, no close button, rows separated by inset hairlines instead of cards. |
| Profile menu | Not offered since patch 0051 (one profile). The restyle stays in patch 0050 in case a Chromium flow opens it. |
| Save password, media and other bubbles | Arrow, grey panel, grey buttons and no close button come from the frame and theme. |

Every Chromium view keeps its controller, callbacks, IDs, element
identifiers, accessible names/roles and strings. Only presentation changes.

## Layer 3: frosted glass (patch 0059)

Pop-up windows on macOS are frosted glass, after Dia
([decision 50](DECISIONS.md#50-frosted-glass-pop-ups)).

| Piece | Where | Merlin |
| --- | --- | --- |
| Blur | `ui/views/merlin_style_mac.mm` | `UpdatePopoverGlass()` adds an `NSVisualEffectView` (popover material, active, light or dark to match the panel) behind the window's content and masks it to the pop-up's outline. It ignores clicks, and only redraws its mask when the outline, size or scale changes |
| Bubbles | `bubble_border.cc` | Where the window server draws the shadow, the frame paints its colour as a tint (`PopoverGlassTint`), adds a hairline just inside the outline and updates the blur to the client area plus arrow |
| Client area | `bubble_frame_view.cc` | Chromium normally paints the client view with an opaque copy of the panel colour (an overdraw shortcut). Over glass it leaves the client view transparent, or the glass is hidden |
| Text | `label.cc` | Labels over glass draw greyscale-smoothed text, since subpixel text needs an opaque background |
| Menus | `menu_scroll_view_container.cc` | Menus Chromium draws itself paint the same tinted, rounded panel over the blur, unless the caller set its own colour |
| Address dropdown | `paint_util.cc` (`DrawGlassCard`), `merlin_address_editor.cc` | The card in its own child window gets the same blur; its drawn shadow stays outside the card |
| Find bar | `find_bar_view.cc` (patch 0061) | The bar's own child window gets the same blur, tint, edge and outside shadow as the address card; on solid it removes any blur left from before ([decision 52](DECISIONS.md#52-merlins-find-bar)) |
| Command menu | `palette_view.cc` | The palette's card uses `DrawGlassCard` too |
| Start page | `merlin_start_page.cc` | The suggestion list is web content, so it uses a translucent pop-up grey with a CSS `backdrop-filter` blur, at the same level |
| Setting | `merlin_style.cc`, `modal_browser_controller.cc` | `popup_transparency` (Settings > Appearance > Pop-up transparency) sets `SetPopoverTransparency()` when the config is read. Low, medium and high change the tint; solid adds no blur, so pop-ups keep their opaque panel. The address card and command menu keep their window between uses, so on solid they remove any blur left from before (`RemovePopoverGlass`) |
| Colours | `merlin_theme.cc` | Menus use the pop-up grey; button fills and menu highlights are text-colour tints, so they do not show as solid chips on the glass |

`HasPopoverGlass()` reads the widget's root layer (translucent widgets do not fill it opaquely) and is false for opaque or out-of-process windows, with the solid setting, off
macOS and with `--modal-browser-upstream-defaults`; those keep the opaque
panel. Right-click menus are native and unchanged.

## Not yet covered by a Merlin layout

These get Layer 1 (Merlin title, buttons, switches, rows) but keep
Chromium's arrangement: downloads bubble, extensions menu, bookmark star,
zoom, translate, password save/manage, JavaScript alert/confirm, before
unload, HTTP auth, choosers, file-system access, desktop capture picker,
certificate selector and the WebUI profile picker. macOS context menus and
system sheets are native and stay native.

## Verification, 2026-11-04

Branch `feature/merlin-dia-popups`, macOS arm64 `out/Modal` component build,
Chromium 157.0.8103.26.

| Check | Result |
| --- | --- |
| `scripts/verify_patches.sh` | All 50 patches apply to 157.0.8103.26 |
| `gn check` for modal_browser, permissions, page_info, profiles, title_origin_label | Passed |
| `scripts/generate_design_tokens.py --check` | Current |
| `chrome` and `browser_tests` build | Passed |
| Default browser suite (`scripts/run_browser_tests.sh ''`) | **148/148 passed** |
| Identity captures | Refreshed in `visual-identity-evidence/` |

`PermissionDecisionsAndSiteInfo` checks that site information and the
permission prompt show an arrow, open `TOP_LEFT` from the address field,
have no close button, and that all three decisions still reach the
delegate. `NativeTokensAndAccessibleOverrides` checks the popover and button
greys.

Still manual: VoiceOver on the new layouts, keyboard traversal of the
decision row, how the arrow and the macOS window shadow look on a real
display (captures show the bubble only), and pop-ups that need real
devices or accounts. The media pop-up keeps its own header close button.
